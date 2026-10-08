(() => {
  const page = document.querySelector('[data-order-lookup]');
  const model = window.OFFCUT_ORDER_MODEL;
  const api = window.OFFCUT_ORDER_API;
  if (!page || !model) return;
  const form = page.querySelector('[data-lookup-form]');
  const error = page.querySelector('[data-lookup-error]');
  const backendNote = page.querySelector('[data-lookup-backend-note]');
  if (backendNote && api?.configured) backendNote.textContent = '訂單資訊由 OFFCUT 訂單服務同步。請輸入訂單編號與付款回報 Email。';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.hidden = true;
    const orderId = form.elements.orderId.value.trim().toUpperCase();
    const email = form.elements.email.value.trim().toLowerCase();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    if (api?.configured) {
      submit.textContent = '查詢中…';
      const result = await api.lookup(orderId, email);
      if (!result.ok || !result.order) {
        error.textContent = result.reason === 'not-found'
          ? '找不到符合的訂單編號與 Email。'
          : '暫時無法連線至訂單服務，請稍後再試。';
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = '查詢訂單 →';
        return;
      }
      const order = model.cacheRemote({ ...result.order, email });
      if (!order) {
        error.textContent = '訂單資料無法在此裝置暫存，請稍後再試。';
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = '查詢訂單 →';
        return;
      }
      model.rememberLookup(order);
      window.location.href = model.withOrder('order.html', order);
      return;
    }

    console.warn('[OFFCUT] Remote order backend not configured. Order lookup is limited to this device.');
    const order = model.findByCredentials(orderId, email);
    if (!order) {
      error.textContent = '找不到符合的本機訂單。請確認訂單編號與 Email，並使用建立訂單時的瀏覽器與裝置。';
      error.hidden = false;
      submit.disabled = false;
      return;
    }
    model.rememberLookup(order);
    window.location.href = model.withOrder('order.html', order);
  });
})();
