(() => {
  const page = document.querySelector('[data-order-page]');
  const model = window.OFFCUT_ORDER_MODEL;
  const api = window.OFFCUT_ORDER_API;
  if (!page || !model) return;
  const params = new URLSearchParams(window.location.search);
  let order = model.get(params.get('orderId') || params.get('order') || '');
  const error = page.querySelector('[data-order-access-error]');
  const detail = page.querySelector('[data-order-detail]');
  if (!order || !model.isLookupAuthorized(order)) {
    error.textContent = order ? '請先以訂單編號與 Email 查詢訂單。' : '此裝置找不到這筆訂單。請使用建立訂單時的瀏覽器與裝置查詢。';
    error.hidden = false;
    return;
  }
  const services = { 'mini-vlog': 'MINI VLOG', gaming: '遊戲實況精華', youtube: 'YOUTUBE 影片', brand: '品牌形象', program: '節目製作' };
  const tiers = { trial: 'TRIAL｜限時體驗價', basic: 'BASIC｜基礎版', plus: 'PLUS｜加強版', pro: 'PRO｜專業版', edit: 'EDIT｜節目剪輯', production: 'PRODUCTION｜完整節目製作' };
  const methods = { bank: '匯款', linepay: 'LINE PAY', card: '信用卡' };
  const payment = { 'PENDING PAYMENT': '待付款', 'PAYMENT REVIEW': '等待付款確認', 'PAID / CONFIRMED': '已確認付款' };
  const materials = { 'NOT SUBMITTED': '尚未提交', SUBMITTED: '已提交', 'NEEDS MORE': '需補交素材', 'AWAITING DELIVERY': '等待 USB 寄送' };
  const production = { 'NOT STARTED': '尚未開始', 'IN PRODUCTION': '製作中', REVIEW: '待確認', COMPLETED: '已完成' };
  const backendNote = page.querySelector('[data-order-backend-note]');
  if (backendNote && api?.configured) backendNote.textContent = '訂單狀態由 OFFCUT 訂單服務同步。';
  const set = (selector, value) => { const node = page.querySelector(selector); if (node) node.textContent = value; };
  const render = () => {
    set('[data-order-id]', order.orderId);
    set('[data-order-service]', services[order.service] || order.service);
    set('[data-order-tier]', tiers[order.tier] || order.tier);
    set('[data-order-price]', `NT$${Number(order.price).toLocaleString('en-US')}${order.pricingMode === 'quote' ? ' 起' : ''}`);
    set('[data-order-method]', methods[order.paymentMethod] || order.paymentMethod);
    set('[data-payment-status]', payment[order.paymentStatus] || order.paymentStatus);
    set('[data-payment-status-en]', order.paymentStatus);
    set('[data-material-status]', materials[order.materialStatus] || order.materialStatus);
    set('[data-material-status-en]', order.materialStatus);
    set('[data-production-status]', production[order.productionStatus] || order.productionStatus);
    set('[data-production-status-en]', order.productionStatus);
    detail.hidden = false;

    const next = page.querySelector('[data-order-next-step]');
    next.replaceChildren();
    const makeLink = (href, text, primary = false) => {
      const link = document.createElement('a');
      link.className = primary ? 'flow-primary' : 'flow-text-link';
      link.href = href;
      link.textContent = text;
      next.append(link);
    };
    if (order.materialStatus === 'NEEDS MORE') {
      makeLink(model.withOrder('materials.html', order), '補交素材 →', true);
    } else if (order.paymentStatus === 'PENDING PAYMENT') {
      const route = order.paymentMethod === 'linepay' ? 'payment-linepay.html' : order.paymentMethod === 'card' ? 'payment-card.html' : 'payment-bank.html';
      makeLink(model.withOrder(route, order), '繼續付款 →', true);
    } else if (order.paymentStatus === 'PAYMENT REVIEW') {
      const message = document.createElement('p');
      message.className = 'order-waiting';
      message.textContent = '已收到您的付款回報，等待 OFFCUT 確認付款。';
      next.append(message);
      if (['NOT SUBMITTED', 'NEEDS MORE'].includes(order.materialStatus)) makeLink(model.withOrder('materials.html', order), order.materialStatus === 'NEEDS MORE' ? '補交素材 →' : '提交素材 →', true);
    } else if (order.paymentStatus === 'PAID / CONFIRMED' && ['NOT SUBMITTED', 'NEEDS MORE'].includes(order.materialStatus)) {
      makeLink(model.withOrder('materials.html', order), order.materialStatus === 'NEEDS MORE' ? '補交素材 →' : '提交素材 →', true);
    } else if (order.materialStatus === 'SUBMITTED') {
      const message = document.createElement('p');
      message.className = 'order-waiting';
      message.textContent = '素材已提交，等待 OFFCUT 確認。';
      next.append(message);
    } else if (order.materialStatus === 'AWAITING DELIVERY') {
      const message = document.createElement('p');
      message.className = 'order-waiting';
      message.textContent = '已選擇 USB 寄送，等待素材寄達；目前尚未收到素材。';
      next.append(message);
    }
  };

  render();
  page.querySelector('[data-copy-order]').addEventListener('click', async () => {
    let copied = false;
    try { await navigator.clipboard.writeText(order.orderId); copied = true; } catch (_) {
      const input = document.createElement('textarea'); input.value = order.orderId; input.readOnly = true;
      input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select();
      copied = document.execCommand('copy'); input.remove();
    }
    page.querySelector('[data-order-copy-feedback]').textContent = copied ? '已複製' : '複製失敗';
    window.setTimeout(() => { page.querySelector('[data-order-copy-feedback]').textContent = ''; }, 1600);
  });

  if (api?.configured && order.email) {
    api.lookup(order.orderId, order.email).then(result => {
      if (!result.ok || !result.order) {
        console.warn('[OFFCUT] Could not refresh this order from the remote order sheet.', result.reason);
        return;
      }
      const refreshed = model.cacheRemote({ ...result.order, email: order.email });
      if (refreshed) { order = refreshed; render(); }
    });
  }
})();
