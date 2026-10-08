// OFFCUT Gmail relay only. It never reads or stores order data.
// Set RELAY_SECRET in Script Properties. Deploy as Me / Anyone.
const OFFCUT_RELAY = Object.freeze({
  recipient: 'offcut.studio.2026@gmail.com',
  senderName: 'OFFCUT STUDIO',
  sentKeyPrefix: 'sent:',
  dedupeTtlMs: 48 * 60 * 60 * 1000,
  maxTextLength: 30000,
  maxHtmlLength: 60000
});

function doPost(e) {
  let lock;
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 100000) return json_({ ok: false, error: 'invalid-request' });
    const payload = JSON.parse(raw);
    const props = PropertiesService.getScriptProperties();
    const expected = props.getProperty('RELAY_SECRET');
    if (!expected || !constantTimeEquals_(String(payload.secret || ''), expected)) return json_({ ok: false, error: 'unauthorized' });

    const key = String(payload.key || '');
    if (!/^payment_report:OFF-\d{6}-[A-HJ-NP-Z2-9]{4}$/.test(key) &&
        !/^material_link:OFF-\d{6}-[A-HJ-NP-Z2-9]{4}:[A-Za-z0-9_-]{12,64}$/.test(key) &&
        !/^usb_delivery:OFF-\d{6}-[A-HJ-NP-Z2-9]{4}$/.test(key)) {
      return json_({ ok: false, error: 'invalid-idempotency-key' });
    }

    const message = payload.message || {};
    if (message.to !== OFFCUT_RELAY.recipient || typeof message.subject !== 'string' ||
        !message.subject.trim() || message.subject.length > 200 || typeof message.text !== 'string' ||
        !message.text.trim() || message.text.length > OFFCUT_RELAY.maxTextLength ||
        (message.html !== undefined && (typeof message.html !== 'string' || message.html.length > OFFCUT_RELAY.maxHtmlLength))) {
      return json_({ ok: false, error: 'invalid-message' });
    }

    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return json_({ ok: false, error: 'busy' });
    const propertyKey = OFFCUT_RELAY.sentKeyPrefix + key;
    if (props.getProperty(propertyKey)) return json_({ ok: true, deduplicated: true });
    pruneSentKeys_(props);
    if (MailApp.getRemainingDailyQuota() < 1) return json_({ ok: false, error: 'quota-exhausted' });

    const options = { to: OFFCUT_RELAY.recipient, subject: message.subject, body: message.text, name: OFFCUT_RELAY.senderName };
    if (message.html) options.htmlBody = message.html;
    MailApp.sendEmail(options);
    props.setProperty(propertyKey, String(Date.now()));
    return json_({ ok: true, deduplicated: false });
  } catch (error) {
    console.error('OFFCUT Gmail Relay failed:', String(error && error.message || error).slice(0, 300));
    return json_({ ok: false, error: 'send-failed' });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function authorizeMail() {
  MailApp.getRemainingDailyQuota();
}

function doGet() {
  return json_({ ok: true, service: 'OFFCUT Gmail Relay' });
}

function pruneSentKeys_(props) {
  const cutoff = Date.now() - OFFCUT_RELAY.dedupeTtlMs;
  const stored = props.getProperties();
  Object.keys(stored).filter(key => key.indexOf(OFFCUT_RELAY.sentKeyPrefix) === 0 && Number(stored[key]) < cutoff)
    .forEach(key => props.deleteProperty(key));
}

function constantTimeEquals_(left, right) {
  if (!left || !right) return false;
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    diff |= (left.charCodeAt(index % left.length) || 0) ^ (right.charCodeAt(index % right.length) || 0);
  }
  return diff === 0;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
