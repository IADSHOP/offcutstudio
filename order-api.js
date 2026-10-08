(() => {
  const rawEndpoint = String(window.OFFCUT_ORDER_API_URL || '').trim();
  let endpoint = '';
  try {
    const parsed = new URL(rawEndpoint);
    if (parsed.protocol === 'https:' || (['localhost', '127.0.0.1'].includes(parsed.hostname) && parsed.protocol === 'http:')) endpoint = parsed.toString();
  } catch (_) { /* remains unconfigured */ }
  const lineUrl = 'https://lin.ee/vr8g6ui';
  const formUrl = () => {
    const raw = String(window.OFFCUT_GOOGLE_FORM_URL || '').trim();
    if (!/^https:\/\/docs\.google\.com\/forms\//i.test(raw)) return '';
    return new URL(raw).toString();
  };

  async function request(action, data = {}) {
    if (!endpoint) return { ok: false, configured: false, reason: 'not-configured' };
    try {
      const response = await fetch(endpoint, {
        method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data })
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) return { ...result, configured: true, ok: false };
      return { ...result, configured: true };
    } catch (error) {
      console.warn('[OFFCUT] Order API request failed.', error);
      return { ok: false, configured: true, reason: 'network-error' };
    }
  }

  window.OFFCUT_ORDER_API = Object.freeze({
    configured: Boolean(endpoint),
    createOrder: order => request('createOrder', { order }),
    sendPaymentReport: order => request('reportPayment', { order }),
    submitMaterialLink: order => request('submitMaterialLink', { order }),
    selectUsb: order => request('selectUsb', { order }),
    lookup: (orderId, email) => request('lookupOrder', { orderId: orderId.trim().toUpperCase(), email: email.trim().toLowerCase() }),
    buildGoogleFormUrl(order) {
      const base = formUrl();
      if (!base) return '';
      const url = new URL(base);
      const fieldId = String(window.OFFCUT_GOOGLE_FORM_ORDER_ENTRY_ID || '').trim();
      if (/^\d+$/.test(fieldId)) url.searchParams.set(`entry.${fieldId}`, order.orderId);
      return url.toString();
    },
    lineUrl
  });
})();
