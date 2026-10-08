(() => {
  const page = document.querySelector('[data-checkout]');
  if (!page) return;

  const catalog = {
    'mini-vlog': {
      label: 'MINI VLOG',
      path: 'pricing-mini-vlog.html',
      tiers: {
        trial: { label: 'TRIAL｜限時體驗價', price: 499, source: '3 分鐘內・3GB 內', output: '15 秒–2 分鐘' },
        basic: { label: 'BASIC｜基礎版', price: 899, source: '5 分鐘內・5GB 內', output: '1–5 分鐘' },
        plus: { label: 'PLUS｜加強版', price: 1680, source: '12 分鐘內・12GB 內', output: '2–8 分鐘' },
        pro: { label: 'PRO｜專業版', price: 2880, source: '25 分鐘內・25GB 內', output: '2–12 分鐘' }
      }
    },
    gaming: {
      label: '遊戲實況精華',
      path: 'pricing-gaming.html',
      tiers: {
        basic: { label: 'BASIC｜基礎版', price: 1680, source: '30 分鐘內・30GB 內', output: '3–8 分鐘' },
        plus: { label: 'PLUS｜加強版', price: 2880, source: '60 分鐘內・60GB 內', output: '5–12 分鐘' },
        pro: { label: 'PRO｜專業版', price: 4980, source: '90 分鐘內・90GB 內', output: '8–15 分鐘' }
      }
    },
    youtube: {
      label: 'YOUTUBE 影片',
      path: 'pricing-youtube.html',
      tiers: {
        basic: { label: 'BASIC｜基礎版', price: 1880, source: '15 分鐘內・15GB 內', output: '3–8 分鐘' },
        plus: { label: 'PLUS｜加強版', price: 2980, source: '30 分鐘內・30GB 內', output: '5–12 分鐘' },
        pro: { label: 'PRO｜專業版', price: 4980, source: '60 分鐘內・60GB 內', output: '8–20 分鐘' }
      }
    },
    brand: {
      label: '品牌形象',
      path: 'pricing-brand.html',
      tiers: {
        basic: { label: 'BASIC｜基礎版', price: 1980, output: '15 秒–1 分鐘' },
        plus: { label: 'PLUS｜加強版', price: 2980, output: '30 秒–2 分鐘' },
        pro: { label: 'PRO｜專業版', price: 4980, output: '依製作需求', isQuoteBased: true }
      }
    },
    program: {
      label: '節目製作',
      path: 'pricing-program.html',
      tiers: {
        edit: { label: 'EDIT｜節目剪輯', price: 4980, isQuoteBased: true },
        production: { label: 'PRODUCTION｜完整節目製作', price: 10000, isQuoteBased: true }
      }
    }
  };

  const params = new URLSearchParams(window.location.search);
  const orderModel = window.OFFCUT_ORDER_MODEL;
  const orderApi = window.OFFCUT_ORDER_API;
  const orderIdFromUrl = params.get('orderId') || '';
  let activeOrder = orderModel?.get(orderIdFromUrl) || null;
  const requestedService = activeOrder?.service || params.get('service') || 'mini-vlog';
  const service = Object.prototype.hasOwnProperty.call(catalog, requestedService) ? requestedService : 'mini-vlog';
  const serviceInfo = catalog[service];
  const requestedTier = (activeOrder?.tier || params.get('tier') || 'basic').toLowerCase();
  const tier = Object.prototype.hasOwnProperty.call(serviceInfo.tiers, requestedTier) ? requestedTier : Object.keys(serviceInfo.tiers)[0];
  const tierInfo = serviceInfo.tiers[tier];
  const requestedPrice = params.get('price');
  const price = activeOrder?.price || (requestedPrice && /^\d{1,8}$/.test(requestedPrice) ? Number(requestedPrice) : tierInfo.price);
  const isQuoteBased = activeOrder?.pricingMode === 'quote' || params.get('isQuoteBased') === 'true' || params.get('quote') === 'true' || Boolean(tierInfo.isQuoteBased);
  const state = Object.freeze({ service, tier, price, isQuoteBased, customerName: activeOrder?.customerName || '', email: activeOrder?.email || '', lineId: activeOrder?.lineId || '', orderId: activeOrder?.orderId || '' });
  window.OFFCUT_CHECKOUT = state;

  const formattedPrice = `NT$${price.toLocaleString('en-US')}${isQuoteBased ? ' 起' : ''}`;
  page.querySelector('[data-summary-service]').textContent = serviceInfo.label;
  page.querySelector('[data-summary-tier]').textContent = tierInfo.label;
  page.querySelector('[data-summary-source]').textContent = tierInfo.source || '依製作需求確認';
  page.querySelector('[data-summary-output]').textContent = tierInfo.output || '依製作需求確認';
  page.querySelector('[data-summary-price]').textContent = formattedPrice;

  const quoteNote = page.querySelector('[data-quote-note]');
  quoteNote.hidden = !isQuoteBased;
  const back = page.querySelector('[data-detail-back]');
  back.href = serviceInfo.path;

  const agreements = [...page.querySelectorAll('[data-agreement]')];
  const paymentOptions = [...page.querySelectorAll('[data-payment-method]')];
  const continueButton = page.querySelector('[data-continue]');
  const status = page.querySelector('.checkout-status');
  const orderPanel = page.querySelector('[data-checkout-order]');
  const orderIdLabel = page.querySelector('[data-checkout-order-id]');
  const copyOrderButton = page.querySelector('[data-copy-order]');
  const copyFeedback = page.querySelector('[data-checkout-order-copy-feedback]');
  const backendNote = page.querySelector('[data-checkout-backend-note]');
  const paymentRoutes = {
    bank: 'payment-bank.html',
    linepay: 'payment-linepay.html',
    card: 'payment-card.html'
  };
  let termsAccepted = false;
  let planConfirmed = false;
  let paymentMethod = activeOrder?.paymentMethod || null;
  let remoteOrderState = activeOrder && orderApi?.configured ? 'pending' : 'unconfigured';
  let remoteSignature = '';
  let remoteGeneration = 0;
  let collisionRetries = 0;

  paymentOptions.forEach(input => { input.checked = input.value === paymentMethod; });

  function copyText(value, button, feedback) {
    const done = () => {
      if (feedback) feedback.textContent = '已複製';
      if (button) button.setAttribute('aria-label', '已複製');
      window.setTimeout(() => {
        if (feedback) feedback.textContent = '';
        if (button) button.removeAttribute('aria-label');
      }, 1600);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(done).catch(() => fallback());
    else fallback();
    function fallback() {
      const field = document.createElement('textarea');
      field.value = value;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      if (copied) done();
    }
  }

  const syncRemoteOrder = () => {
    if (!activeOrder || !orderApi?.configured) {
      remoteOrderState = 'unconfigured';
      return;
    }
    if (activeOrder.paymentStatus !== 'PENDING PAYMENT') {
      remoteOrderState = 'existing';
      return;
    }
    const signature = [activeOrder.orderId, activeOrder.service, activeOrder.tier, activeOrder.price, activeOrder.pricingMode, activeOrder.paymentMethod].join('|');
    if (signature === remoteSignature && ['pending', 'ready'].includes(remoteOrderState)) return;
    remoteSignature = signature;
    remoteOrderState = 'pending';
    const generation = ++remoteGeneration;
    orderApi.createOrder(activeOrder).then(result => {
      if (generation !== remoteGeneration) return;
      if (result.ok && result.order) {
        activeOrder = orderModel.update(activeOrder.orderId, result.order) || activeOrder;
        remoteOrderState = 'ready';
        collisionRetries = 0;
      } else if (result.code === 'ORDER_ID_COLLISION' && collisionRetries < 3) {
        collisionRetries += 1;
        const rotated = orderModel.rotateCollidingId(activeOrder.orderId);
        if (rotated) {
          activeOrder = rotated;
          remoteSignature = '';
          remoteOrderState = 'pending';
          syncCheckout();
          return;
        }
        remoteOrderState = 'failed';
      } else {
        remoteOrderState = 'failed';
      }
      syncCheckout();
    });
  };

  const syncCheckout = () => {
    termsAccepted = agreements[0]?.checked === true;
    planConfirmed = agreements[1]?.checked === true;
    paymentMethod = paymentOptions.find(input => input.checked)?.value || null;
    const complete = termsAccepted && planConfirmed && paymentMethod !== null;
    if (complete && !activeOrder && orderModel) {
      activeOrder = orderModel.create({ service, tier, price, pricingMode: isQuoteBased ? 'quote' : 'fixed', paymentMethod });
    } else if (complete && activeOrder?.paymentStatus === 'PENDING PAYMENT' && activeOrder.paymentMethod !== paymentMethod) {
      activeOrder = orderModel.update(activeOrder.orderId, { paymentMethod });
    }
    if (complete && activeOrder?.paymentStatus === 'PENDING PAYMENT') syncRemoteOrder();
    const alreadyReported = activeOrder?.paymentStatus === 'PAYMENT REVIEW';
    const canContinue = complete && Boolean(activeOrder) && activeOrder.paymentStatus === 'PENDING PAYMENT' && remoteOrderState === 'ready';
    continueButton.disabled = !canContinue;
    orderPanel.hidden = !activeOrder;
    if (activeOrder) orderIdLabel.textContent = activeOrder.orderId;
    status.textContent = alreadyReported
      ? '此訂單已回報付款，請等待 OFFCUT 確認。'
      : !orderApi?.configured && complete
        ? '線上訂單服務尚未完成設定，目前無法建立正式訂單。'
        : remoteOrderState === 'pending'
          ? '正在安全保存訂單…'
          : remoteOrderState === 'failed'
            ? '訂單服務暫時無法連線，請重新選擇付款方式或稍後重試；不需要重新下單。'
      : complete && !activeOrder
        ? '目前無法在此裝置保存訂單，請稍後再試。'
        : canContinue ? '' : '請完成條款確認並選擇付款方式';
    if (backendNote) backendNote.textContent = !orderApi?.configured
      ? '正式訂單服務尚未設定；目前顯示的編號僅為本機暫存。'
      : remoteOrderState === 'ready' || remoteOrderState === 'existing'
        ? '訂單已安全保存於 OFFCUT 訂單服務。'
        : remoteOrderState === 'pending'
          ? '正在保存訂單至 OFFCUT 訂單服務…'
          : '訂單服務暫時無法連線；訂單尚未建立。';
  };

  agreements.forEach(input => input.addEventListener('change', syncCheckout));
  paymentOptions.forEach(input => input.addEventListener('change', syncCheckout));
  copyOrderButton?.addEventListener('click', () => activeOrder && copyText(activeOrder.orderId, copyOrderButton, copyFeedback));
  syncCheckout();

  continueButton.addEventListener('click', () => {
    if (continueButton.disabled || !paymentMethod || !paymentRoutes[paymentMethod] || !activeOrder) return;
    const query = new URLSearchParams({ orderId: activeOrder.orderId, service, tier, price: String(price), paymentMethod });
    if (isQuoteBased) query.set('pricingMode', 'quote');
    window.location.href = `${paymentRoutes[paymentMethod]}?${query.toString()}`;
  });
})();
