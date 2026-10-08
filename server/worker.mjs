const SHOP_EMAIL = 'offcut.studio.2026@gmail.com';
const EMAIL_LIMIT_PER_DAY = 40;
const ORDER_ID = /^OFF-\d{6}-[A-HJ-NP-Z2-9]{4}$/;
const EMAIL = /^\S+@\S+\.\S+$/;
const SERVICES = {
  'mini-vlog': { trial: 499, basic: 899, plus: 1680, pro: 2880 },
  gaming: { basic: 1680, plus: 2880, pro: 4980 },
  youtube: { basic: 1880, plus: 2980, pro: 4980 },
  brand: { basic: 1980, plus: 2980, pro: 4980 },
  program: { edit: 4980, production: 10000 }
};

const fail = (code, message) => { const error = new Error(message); Object.assign(error, { code }); throw error; };
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
const validText = (value, limit = 500) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
const clean = (value, limit = 500) => String(value ?? '').trim().slice(0, limit);

export class OffcutOrders {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, creation_request_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS payment_reports (order_id TEXT PRIMARY KEY, signature TEXT NOT NULL, data TEXT NOT NULL)');
    this.sql.exec("CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, data TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, detail TEXT NOT NULL DEFAULT '')");
    this.sql.exec('CREATE TABLE IF NOT EXISTS rate (ip TEXT NOT NULL, time INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS rate_ip ON rate(ip)');
  }

  rows(query, ...args) { return this.sql.exec(query, ...args).toArray(); }
  enqueue(id, message) { this.sql.exec("INSERT OR IGNORE INTO outbox (id,data,created_at) VALUES (?,?,?)", id, JSON.stringify(message), Date.now()); }

  public(order) {
    const { customerName, email, lineId, paymentLastFive, paymentTime, paymentReference, paymentNote, paymentScreenshotName, materialLink, materialNote, ...safe } = order;
    return safe;
  }

  async perform(action, payload, ip) {
    if (action === 'createOrder') return this.createOrder(payload, ip);
    if (action === 'reportPayment') return this.reportPayment(payload);
    if (action === 'lookupOrder') return this.lookupOrder(payload, ip);
    if (action === 'submitMaterialLink') return this.submitMaterial(payload, false);
    if (action === 'selectUsb') return this.submitMaterial(payload, true);
    fail('INVALID_REQUEST', '無效操作。');
  }

  createOrder(payload, ip) {
    const input = payload.order || {};
    const orderId = clean(input.orderId, 18).toUpperCase();
    const creationRequestId = clean(input.creationRequestId, 64);
    const service = clean(input.service, 40);
    const tier = clean(input.tier, 40);
    const paymentMethod = clean(input.paymentMethod, 20).toLowerCase();
    const price = Number(input.price);
    const pricingMode = input.pricingMode === 'quote' ? 'quote' : 'fixed';
    if (!ORDER_ID.test(orderId)) fail('INVALID_ORDER', '訂單編號格式錯誤。');
    if (!/^(?:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}|[a-f0-9]{36})$/i.test(creationRequestId)) fail('INVALID_REQUEST', '訂單建立識別碼無效，請重試。');
    if (!Object.hasOwn(SERVICES, service) || !Object.hasOwn(SERVICES[service], tier)) fail('INVALID_TIER', '方案資料無效，請返回重新選擇。');
    if (price !== SERVICES[service][tier] || !['bank', 'linepay', 'card'].includes(paymentMethod)) fail('INVALID_ORDER', '方案價格或付款方式無效，請重新確認。');
    if (service === 'brand' && tier === 'pro' || service === 'program') {
      if (pricingMode !== 'quote') fail('INVALID_ORDER', '此方案需依需求報價。');
    } else if (pricingMode !== 'fixed') fail('INVALID_ORDER', '此方案價格資料無效。');

    const now = new Date().toISOString();
    const order = {
      orderId, createdAt: clean(input.createdAt, 40) || now, updatedAt: now,
      service, tier, price, pricingMode, paymentMethod,
      customerName: '', email: '', lineId: '', paymentStatus: 'PENDING PAYMENT',
      materialStatus: 'NOT SUBMITTED', productionStatus: 'NOT STARTED',
      paymentReportedAt: '', paymentReportSubmitted: false, paymentTime: '',
      paymentReference: '', paymentNote: '', paymentLastFive: '', paymentScreenshotName: '',
      paymentNotificationStatus: 'NOT SENT', materialMethod: '', materialLink: '',
      materialNote: '', materialReportedAt: '', materialNotificationStatus: 'NOT SENT'
    };
    const signature = `${service}|${tier}|${price}|${pricingMode}`;
    const result = this.ctx.storage.transactionSync(() => {
      const prior = this.rows('SELECT * FROM orders WHERE id=?', orderId)[0];
      if (prior) {
        const old = JSON.parse(prior.data);
        if (prior.creation_request_id !== creationRequestId) fail('ORDER_ID_COLLISION', '訂單編號重複，系統正在重新建立識別碼。');
        if (prior.request_hash !== signature) fail('IDEMPOTENCY_CONFLICT', '訂單編號已用於其他方案，請返回訂單繼續操作。');
        if (old.paymentStatus !== 'PENDING PAYMENT' && old.paymentMethod !== paymentMethod) fail('ORDER_CLOSED', '付款回報後不可更換付款方式。');
        if (old.paymentStatus === 'PENDING PAYMENT' && old.paymentMethod !== paymentMethod) {
          old.paymentMethod = paymentMethod;
          old.updatedAt = now;
          this.sql.exec('UPDATE orders SET data=? WHERE id=?', JSON.stringify(old), orderId);
        }
        return old;
      }
      const priorRequest = this.rows('SELECT id FROM orders WHERE creation_request_id=?', creationRequestId)[0];
      if (priorRequest) fail('IDEMPOTENCY_CONFLICT', '訂單建立資料不一致，請返回後重試。');
      this.sql.exec('DELETE FROM rate WHERE time<?', Date.now() - 3600000);
      if (this.rows('SELECT count(*) AS n FROM rate WHERE ip=?', ip)[0].n >= 20) fail('RATE_LIMIT', '操作過於頻繁，請稍後再試。');
      this.sql.exec('INSERT INTO rate VALUES (?,?)', ip, Date.now());
      this.sql.exec('INSERT INTO orders (id,request_hash,creation_request_id,data) VALUES (?,?,?,?)', orderId, signature, creationRequestId, JSON.stringify(order));
      return order;
    });
    return { ok: true, order: this.public(result) };
  }

  async reportPayment(payload) {
    const input = payload.order || {};
    const orderId = clean(input.orderId, 18).toUpperCase();
    if (!ORDER_ID.test(orderId)) fail('INVALID_ORDER', '訂單編號格式錯誤。');
    const row = this.rows('SELECT * FROM orders WHERE id=?', orderId)[0];
    if (!row) fail('UNKNOWN_ORDER', '找不到此訂單，請返回結帳重新確認。');
    const existing = JSON.parse(row.data);
    if (!validText(input.customerName, 80) || !EMAIL.test(clean(input.email, 254)) || !validText(input.lineId, 100)) fail('INVALID_CONTACT', '請確認姓名、Email 與 LINE 聯絡資料。');
    if (input.paymentMethod !== existing.paymentMethod || Number(input.price) !== existing.price || input.service !== existing.service || input.tier !== existing.tier) fail('ORDER_MISMATCH', '付款回報資料與原訂單不符。');
    const lastFive = clean(input.paymentLastFive, 5);
    if (existing.paymentMethod === 'bank' && !/^\d{5}$/.test(lastFive)) fail('INVALID_REFERENCE', '請輸入 5 位匯款末五碼。');
    const report = {
      customerName: clean(input.customerName, 80), email: clean(input.email, 254).toLowerCase(),
      lineId: clean(input.lineId, 100), paymentLastFive: existing.paymentMethod === 'bank' ? lastFive : '',
      paymentTime: clean(input.paymentTime, 80), paymentReference: clean(input.paymentReference, 500),
      paymentNote: clean(input.paymentNote, 1000), paymentScreenshotName: clean(input.paymentScreenshotName, 200),
      paymentReportedAt: new Date().toISOString(), paymentStatus: 'PAYMENT REVIEW'
    };
    const signature = await digest(JSON.stringify({
      orderId, customerName: report.customerName, email: report.email, lineId: report.lineId,
      paymentLastFive: report.paymentLastFive, paymentTime: report.paymentTime,
      paymentReference: report.paymentReference, paymentNote: report.paymentNote,
      paymentMethod: existing.paymentMethod, amount: existing.price
    }));
    const result = this.ctx.storage.transactionSync(() => {
      const latest = JSON.parse(this.rows('SELECT data FROM orders WHERE id=?', orderId)[0].data);
      const prior = this.rows('SELECT * FROM payment_reports WHERE order_id=?', orderId)[0];
      if (prior) {
        if (prior.signature !== signature) fail('REPORT_ALREADY_SUBMITTED', '此付款回報已送出；請勿重新付款。如需更正，請聯繫 OFFCUT。');
        return latest;
      }
      if (latest.paymentStatus !== 'PENDING PAYMENT') fail('ORDER_CLOSED', '此訂單目前不接受新的付款回報。');
      Object.assign(latest, report, { paymentReportSubmitted: true, paymentNotificationStatus: 'QUEUED', updatedAt: report.paymentReportedAt });
      this.sql.exec('INSERT INTO payment_reports VALUES (?,?,?)', orderId, signature, JSON.stringify(report));
      this.sql.exec('UPDATE orders SET data=? WHERE id=?', JSON.stringify(latest), orderId);
      this.enqueue(`payment_report:${orderId}`, this.paymentEmail(latest));
      return latest;
    });
    this.ctx.storage.setAlarm(Date.now() + 1000);
    return { ok: true, accepted: true, notification: 'QUEUED', order: this.public(result) };
  }

  lookupOrder(payload, ip) {
    const orderId = clean(payload.orderId, 18).toUpperCase();
    const email = clean(payload.email, 254).toLowerCase();
    if (!ORDER_ID.test(orderId) || !EMAIL.test(email)) return { ok: false, reason: 'not-found' };
    this.sql.exec('DELETE FROM rate WHERE time<?', Date.now() - 3600000);
    if (this.rows('SELECT count(*) AS n FROM rate WHERE ip=?', ip)[0].n >= 40) fail('RATE_LIMIT', '查詢次數過多，請稍後再試。');
    this.sql.exec('INSERT INTO rate VALUES (?,?)', ip, Date.now());
    const row = this.rows('SELECT data FROM orders WHERE id=?', orderId)[0];
    if (!row) return { ok: false, reason: 'not-found' };
    const order = JSON.parse(row.data);
    if (!order.paymentReportSubmitted || order.email.toLowerCase() !== email) return { ok: false, reason: 'not-found' };
    return { ok: true, order: this.public(order) };
  }

  submitMaterial(payload, usb) {
    const input = payload.order || {};
    const orderId = clean(input.orderId, 18).toUpperCase();
    const row = this.rows('SELECT data FROM orders WHERE id=?', orderId)[0];
    if (!row) fail('UNKNOWN_ORDER', '找不到此訂單。');
    const existing = JSON.parse(row.data);
    if (!existing.paymentReportSubmitted || clean(input.email, 254).toLowerCase() !== existing.email.toLowerCase()) fail('INVALID_ACCESS', '請先完成付款回報並確認訂單 Email。');
    const materialLink = usb ? '' : clean(input.materialLink, 2000);
    if (!usb && !/^https?:\/\//i.test(materialLink)) fail('INVALID_LINK', '素材連結需以 http:// 或 https:// 開頭。');
    const method = usb ? 'USB' : 'EXTERNAL LINK';
    const status = usb ? 'AWAITING DELIVERY' : 'SUBMITTED';
    const eventKey = usb ? `usb_delivery:${orderId}` : `material_link:${orderId}:${clean(input.materialRequestId, 64)}`;
    if (!usb && !/^[A-Za-z0-9_-]{12,64}$/.test(clean(input.materialRequestId, 64))) fail('INVALID_REQUEST', '素材提交識別碼格式錯誤。');
    const next = { ...existing, materialMethod: method, materialLink, materialNote: clean(input.materialNote, 2000), materialStatus: status, materialReportedAt: new Date().toISOString(), materialNotificationStatus: 'QUEUED', updatedAt: new Date().toISOString() };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('UPDATE orders SET data=? WHERE id=?', JSON.stringify(next), orderId);
      this.enqueue(eventKey, this.materialEmail(next, usb));
    });
    this.ctx.storage.setAlarm(Date.now() + 1000);
    return { ok: true, accepted: true, notification: 'QUEUED', order: this.public(next) };
  }

  paymentEmail(order) {
    const method = { bank: 'BANK / 匯款', linepay: 'LINE PAY', card: 'CARD / 信用卡' }[order.paymentMethod];
    const fields = [
      ['ORDER ID', order.orderId], ['SERVICE', order.service], ['TIER', order.tier],
      ['AMOUNT', `NT$${order.price.toLocaleString('en-US')}${order.pricingMode === 'quote' ? ' 起' : ''}`],
      ['PAYMENT METHOD', method], ['CUSTOMER', order.customerName], ['EMAIL', order.email],
      ['LINE', order.lineId], ['BANK LAST FIVE', order.paymentMethod === 'bank' ? order.paymentLastFive : 'N/A'],
      ['PAYMENT TIME', order.paymentTime || '未提供'], ['PAYMENT REFERENCE', order.paymentReference || '未提供'],
      ['CUSTOMER NOTE', order.paymentNote || '無'], ['REPORTED AT', order.paymentReportedAt], ['STATUS', 'PAYMENT REVIEW']
    ];
    return { to: SHOP_EMAIL, subject: `[OFFCUT] 新付款回報｜${order.orderId}`, text: ['OFFCUT STUDIO', 'NEW PAYMENT REPORT', '', ...fields.flatMap(([label, value]) => [`${label}\n${value}`, ''])].join('\n').trim() };
  }

  materialEmail(order, usb) {
    return { to: SHOP_EMAIL, subject: `[OFFCUT] 客戶已提交素材｜${order.orderId}`, text: [
      'OFFCUT STUDIO', 'MATERIAL SUBMISSION', '', `ORDER ID\n${order.orderId}`, '',
      `SERVICE\n${order.service}`, '', `TIER\n${order.tier}`, '',
      `MATERIAL METHOD\n${usb ? 'USB DELIVERY SELECTED' : 'EXTERNAL LINK'}`, '',
      `MATERIAL LINK\n${order.materialLink || 'USB 寄送；請透過 LINE 聯繫。'}`, '',
      `MATERIAL NOTE\n${order.materialNote || '無'}`, '', `MATERIAL STATUS\n${order.materialStatus}`
    ].join('\n') };
  }

  async alarm() {
    const pending = this.rows("SELECT * FROM outbox WHERE state='PENDING' ORDER BY created_at LIMIT 10");
    for (const item of pending) {
      if (item.attempts >= 8 || Date.now() - item.created_at > 23 * 3600000) {
        this.sql.exec("UPDATE outbox SET state='FAILED',detail=? WHERE id=?", 'Retry limit reached; review Cloudflare logs and Gmail.', item.id);
        continue;
      }
      this.sql.exec('UPDATE outbox SET attempts=attempts+1 WHERE id=?', item.id);
      try {
        if (!this.env.GMAIL_RELAY_URL || !this.env.RELAY_SECRET) throw new Error('GMAIL_RELAY_URL or RELAY_SECRET is not configured.');
        const response = await fetch(this.env.GMAIL_RELAY_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: this.env.RELAY_SECRET, key: item.id, message: JSON.parse(item.data) })
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.ok !== true) throw new Error('Gmail Relay rejected the notification.');
        this.sql.exec("UPDATE outbox SET state='SENT',detail='' WHERE id=?", item.id);
      } catch (error) {
        const attempts = item.attempts + 1;
        const delay = Math.min(600000 * (2 ** Math.min(attempts - 1, 5)), 3600000);
        this.sql.exec("UPDATE outbox SET detail=? WHERE id=?", clean(error.message, 300), item.id);
        if (attempts < 8 && Date.now() - item.created_at < 23 * 3600000) await this.ctx.storage.setAlarm(Date.now() + delay);
        else this.sql.exec("UPDATE outbox SET state='FAILED' WHERE id=?", item.id);
      }
    }
    if (this.rows("SELECT id FROM outbox WHERE state='PENDING'").length) await this.ctx.storage.setAlarm(Date.now() + 600000);
  }

  async fetch(request) {
    try {
      const payload = await request.json();
      if (payload.action === 'adminStatus') {
        const row = this.rows('SELECT data FROM orders WHERE id=?', clean(payload.orderId, 18).toUpperCase())[0];
        if (!row) fail('UNKNOWN_ORDER', '找不到訂單。');
        const order = JSON.parse(row.data);
        const payments = ['PENDING PAYMENT', 'PAYMENT REVIEW', 'PAID / CONFIRMED', 'FAILED', 'REFUNDED'];
        const materials = ['NOT SUBMITTED', 'SUBMITTED', 'NEEDS MORE', 'AWAITING DELIVERY'];
        const production = ['NOT STARTED', 'IN PRODUCTION', 'REVIEW', 'COMPLETED'];
        if (payload.paymentStatus && !payments.includes(payload.paymentStatus)) fail('INVALID_STATUS', '付款狀態無效。');
        if (payload.materialStatus && !materials.includes(payload.materialStatus)) fail('INVALID_STATUS', '素材狀態無效。');
        if (payload.productionStatus && !production.includes(payload.productionStatus)) fail('INVALID_STATUS', '製作狀態無效。');
        if (payload.paymentStatus) order.paymentStatus = payload.paymentStatus;
        if (payload.materialStatus) order.materialStatus = payload.materialStatus;
        if (payload.productionStatus) order.productionStatus = payload.productionStatus;
        order.updatedAt = new Date().toISOString();
        this.sql.exec('UPDATE orders SET data=? WHERE id=?', JSON.stringify(order), order.orderId);
        return Response.json({ ok: true, order: this.public(order) });
      }
      if (payload.action === 'adminEmails') return Response.json({ ok: true, emails: this.rows('SELECT id,state,attempts,detail FROM outbox ORDER BY created_at DESC LIMIT 100') });
      if (payload.action === 'adminRetryEmail') {
        const id = clean(payload.id, 120);
        const failed = this.rows("SELECT id FROM outbox WHERE id=? AND state='FAILED'", id)[0];
        if (!failed) fail('UNKNOWN_NOTIFICATION', '找不到失敗的通知。');
        this.sql.exec("UPDATE outbox SET state='PENDING',attempts=0,created_at=?,detail='' WHERE id=?", Date.now(), id);
        await this.ctx.storage.setAlarm(Date.now() + 1000);
        return Response.json({ ok: true });
      }
      const ip = clean(payload.ip, 64) || 'unknown';
      return Response.json(await this.perform(payload.action, payload, ip));
    } catch (error) {
      const known = Boolean(error.code);
      return Response.json({ ok: false, code: error.code || 'SERVER_ERROR', message: known ? error.message : '訂單服務暫時無法使用，請重試原訂單；請勿重新付款。' }, { status: known ? 400 : 503 });
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    const isAdmin = url.pathname === '/admin';
    const corsOrigin = allowed.includes(origin) ? origin : 'null';
    const headers = { 'Access-Control-Allow-Origin': corsOrigin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed.includes(origin) ? 204 : 403, headers });
    if (request.method !== 'POST' || isAdmin && !env.ADMIN_SECRET || !isAdmin && (url.pathname !== '/orders' || !allowed.includes(origin))) return new Response('Forbidden', { status: 403, headers });
    if (isAdmin && request.headers.get('Authorization') !== `Bearer ${env.ADMIN_SECRET}`) return new Response('Unauthorized', { status: 401, headers });
    if (Number(request.headers.get('Content-Length') || 0) > 65536) return new Response('Too large', { status: 413, headers });
    let payload;
    try { const raw = await request.text(); if (raw.length > 65536) return new Response('Too large', { status: 413, headers }); payload = JSON.parse(raw); }
    catch { return Response.json({ ok: false, code: 'INVALID_REQUEST', message: '格式錯誤。' }, { status: 400, headers }); }
    const allowedActions = isAdmin ? ['adminStatus', 'adminEmails', 'adminRetryEmail'] : ['createOrder', 'reportPayment', 'lookupOrder', 'submitMaterialLink', 'selectUsb'];
    if (!allowedActions.includes(payload?.action)) return Response.json({ ok: false, code: 'INVALID_REQUEST', message: '無效操作。' }, { status: 400, headers });
    payload.ip = await digest(request.headers.get('CF-Connecting-IP') || 'unknown');
    const stub = env.ORDERS.get(env.ORDERS.idFromName('offcut-orders-production'));
    const response = await stub.fetch(new Request('https://offcut.internal/', { method: 'POST', body: JSON.stringify(payload) }));
    return new Response(response.body, { status: response.status, headers: { ...headers, 'Content-Type': 'application/json' } });
  }
};
