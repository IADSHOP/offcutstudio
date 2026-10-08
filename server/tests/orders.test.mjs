import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import worker, { OffcutOrders } from '../worker.mjs';

class SqlMock {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  exec(query, ...args) {
    const statement = this.db.prepare(query);
    if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(query)) return { toArray: () => statement.all(...args) };
    return statement.run(...args);
  }
}

function makeContext() {
  const sql = new SqlMock();
  const alarms = [];
  return {
    alarms,
    storage: {
      sql,
      transactionSync(callback) { sql.db.exec('BEGIN IMMEDIATE'); try { const result = callback(); sql.db.exec('COMMIT'); return result; } catch (error) { sql.db.exec('ROLLBACK'); throw error; } },
      setAlarm: async when => alarms.push(when)
    }
  };
}

const relay = [];
const cases = [];
const test = (name, run) => cases.push({ name, run });
const originalFetch = globalThis.fetch;
const origin = 'http://127.0.0.1:4173';
const ephemeralSecret = () => `${crypto.randomUUID()}${crypto.randomUUID()}`;
const relaySecret = ephemeralSecret();
const adminSecret = ephemeralSecret();
const env = {
  ALLOWED_ORIGINS: `https://iadshop.github.io,${origin}`,
  GMAIL_RELAY_URL: 'https://relay.invalid/exec',
  RELAY_SECRET: relaySecret,
  ADMIN_SECRET: adminSecret,
  ORDERS: null
};
const ctx = makeContext();
const durable = new OffcutOrders(ctx, env);
env.ORDERS = { idFromName: () => 'offcut-test', get: () => ({ fetch: request => durable.fetch(request) }) };
const call = async body => worker.fetch(new Request('https://offcut.test/orders', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' }, body: JSON.stringify(body)
}), env);
const orderSeed = {
  creationRequestId: '8e83584d-3e83-4ff7-927b-0e4ea84b029f',
  orderId: 'OFF-261009-A7K3', service: 'mini-vlog', tier: 'basic', price: 899,
  pricingMode: 'fixed', paymentMethod: 'bank'
};
const report = {
  ...orderSeed, customerName: 'Test User', email: 'offcut-test@example.com', lineId: '@offcut-test',
  paymentLastFive: '12345', paymentTime: '', paymentReference: '12345', paymentNote: 'test only'
};

test('MINI VLOG BASIC order is persisted, payment report is idempotent, and lookup works across sessions', async () => {
  const create = await call({ action: 'createOrder', order: orderSeed });
  assert.equal(create.status, 200);
  assert.equal((await create.json()).order.orderId, orderSeed.orderId);

  const badPrice = await call({ action: 'createOrder', order: { ...orderSeed, price: 1 } });
  assert.equal(badPrice.status, 400);

  const firstReport = await call({ action: 'reportPayment', order: report });
  const first = await firstReport.json();
  assert.equal(first.ok, true);
  assert.equal(first.order.paymentStatus, 'PAYMENT REVIEW');
  assert.equal(first.notification, 'QUEUED');

  const retry = await call({ action: 'reportPayment', order: report });
  assert.equal((await retry.json()).ok, true);
  assert.equal(durable.rows('SELECT id,state FROM outbox').length, 1);

  const changedRetry = await call({ action: 'reportPayment', order: { ...report, paymentNote: 'altered' } });
  assert.equal(changedRetry.status, 400);

  const wrongEmail = await call({ action: 'lookupOrder', orderId: orderSeed.orderId, email: 'wrong@example.com' });
  assert.equal((await wrongEmail.json()).ok, false);
  const lookup = await call({ action: 'lookupOrder', orderId: orderSeed.orderId, email: report.email });
  const found = await lookup.json();
  assert.equal(found.ok, true);
  assert.equal(found.order.price, 899);
  assert.equal(found.order.email, undefined);
});

test('Gmail outbox uses fixed recipient, expected subject and full PAYMENT REVIEW content once', async () => {
  let failOnce = true;
  globalThis.fetch = async (url, options) => {
    if (failOnce) { failOnce = false; return Response.json({ ok: false }, { status: 503 }); }
    relay.push({ url: String(url), body: JSON.parse(options.body) });
    return Response.json({ ok: true });
  };
  await durable.alarm();
  assert.equal(durable.rows('SELECT state,attempts FROM outbox')[0].state, 'PENDING');
  assert.equal(durable.rows('SELECT state,attempts FROM outbox')[0].attempts, 1);
  assert.equal(durable.rows('SELECT data FROM orders')[0].data.includes('PAYMENT REVIEW'), true);
  await durable.alarm();
  await durable.alarm();
  assert.equal(relay.length, 1);
  assert.equal(relay[0].body.secret, relaySecret);
  assert.equal(relay[0].body.key, `payment_report:${orderSeed.orderId}`);
  assert.equal(relay[0].body.message.to, 'offcut.studio.2026@gmail.com');
  assert.equal(relay[0].body.message.subject, `[OFFCUT] 新付款回報｜${orderSeed.orderId}`);
  for (const line of ['SERVICE\nmini-vlog', 'TIER\nbasic', 'AMOUNT\nNT$899', 'BANK LAST FIVE\n12345', 'PAYMENT TIME\n未提供', 'PAYMENT REFERENCE\n12345', 'CUSTOMER NOTE\ntest only', 'STATUS\nPAYMENT REVIEW']) {
    assert.ok(relay[0].body.message.text.includes(line), `missing email field: ${line}`);
  }
  assert.equal(durable.rows('SELECT state FROM outbox')[0].state, 'SENT');
});

test('external material link and USB handoff update material state without marking payment confirmed', async () => {
  const materialRequestId = 'mr0123456789abcdef0123456789abcdef0123';
  const material = await call({ action: 'submitMaterialLink', order: {
    ...report, materialLink: 'https://example.com/drive-folder', materialNote: 'test link', materialRequestId
  } });
  assert.equal((await material.json()).order.materialStatus, 'SUBMITTED');
  const usb = await call({ action: 'selectUsb', order: report });
  const usbOrder = await usb.json();
  assert.equal(usbOrder.order.materialStatus, 'AWAITING DELIVERY');
  assert.equal(usbOrder.order.paymentStatus, 'PAYMENT REVIEW');
  await durable.alarm();
  const sent = relay.filter(item => item.body.message.subject.startsWith('[OFFCUT]'));
  assert.equal(sent.length, 3);
  assert.ok(sent.some(item => item.body.key === `usb_delivery:${orderSeed.orderId}`));
  const reportAgain = await call({ action: 'lookupOrder', orderId: orderSeed.orderId, email: report.email });
  assert.equal((await reportAgain.json()).order.materialStatus, 'AWAITING DELIVERY');
});

test('admin status changes require independent secret and can confirm payment manually', async () => {
  const unauthorized = await worker.fetch(new Request('https://offcut.test/admin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'adminStatus', orderId: orderSeed.orderId, paymentStatus: 'PAID / CONFIRMED' })
  }), env);
  assert.equal(unauthorized.status, 401);
  const authorized = await worker.fetch(new Request('https://offcut.test/admin', {
    method: 'POST', headers: { Authorization: `Bearer ${adminSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'adminStatus', orderId: orderSeed.orderId, paymentStatus: 'PAID / CONFIRMED' })
  }), env);
  assert.equal((await authorized.json()).order.paymentStatus, 'PAID / CONFIRMED');
});

test('origin validation rejects unapproved storefronts', async () => {
  const response = await worker.fetch(new Request('https://offcut.test/orders', {
    method: 'POST', headers: { Origin: 'https://unapproved.example', 'Content-Type': 'application/json' }, body: '{}'
  }), env);
  assert.equal(response.status, 403);
});

test('Apps Script relay validates secret, pins recipient, and deduplicates retry', async () => {
  const script = readFileSync(new URL('../../google-apps-script/GmailRelay.gs', import.meta.url), 'utf8');
  const gasSecret = ephemeralSecret();
  const values = { RELAY_SECRET: gasSecret };
  const sent = [];
  const sandbox = {
    console,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => values[key] || null,
      setProperty: (key, value) => { values[key] = value; },
      getProperties: () => ({ ...values }),
      deleteProperty: key => { delete values[key]; }
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail: message => sent.push(message) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) }
  };
  vm.runInNewContext(script, sandbox);
  const key = `payment_report:${orderSeed.orderId}`;
  const message = { to: 'offcut.studio.2026@gmail.com', subject: `[OFFCUT] 新付款回報｜${orderSeed.orderId}`, text: 'STATUS\nPAYMENT REVIEW' };
  const post = payload => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(payload) } }).text);
  assert.equal(post({ secret: 'wrong', key, message }).error, 'unauthorized');
  assert.equal(post({ secret: gasSecret, key, message: { ...message, to: 'someone@example.com' } }).error, 'invalid-message');
  assert.equal(post({ secret: gasSecret, key, message }).ok, true);
  assert.equal(post({ secret: gasSecret, key, message }).deduplicated, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'offcut.studio.2026@gmail.com');
});

try {
  for (const item of cases) {
    await item.run();
    console.log(`PASS ${item.name}`);
  }
  console.log(`Passed ${cases.length} OFFCUT backend integration checks.`);
} finally {
  globalThis.fetch = originalFetch;
  ctx.storage.sql.db.close();
}

