(() => {
  const page = document.querySelector('[data-payment-page]');
  const model = window.OFFCUT_ORDER_MODEL;
  if (!page || !model) return;

  const serviceLabels = {
    'mini-vlog': 'MINI VLOG', gaming: '遊戲實況精華', youtube: 'YOUTUBE 影片', brand: '品牌形象', program: '節目製作'
  };
  const tierLabels = {
    trial: 'TRIAL｜限時體驗價', basic: 'BASIC｜基礎版', plus: 'PLUS｜加強版', pro: 'PRO｜專業版',
    edit: 'EDIT｜節目剪輯', production: 'PRODUCTION｜完整節目製作'
  };
  const paymentLabels = { bank: '匯款', linepay: 'LINE PAY', card: '信用卡' };
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('orderId') || '';
  const order = model.get(orderId);
  const api = window.OFFCUT_ORDER_API;
  const expectedMethod = page.dataset.method;
  const copyFeedback = (selector, feedbackSelector, text, value) => {
    const button = page.querySelector(selector);
    if (!button) return;
    button.addEventListener('click', async () => {
      const feedback = page.querySelector(feedbackSelector);
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(String(value));
          copied = true;
        }
      } catch (_) { /* use the local fallback below */ }
      if (!copied) {
        const field = document.createElement('textarea');
        field.value = String(value);
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.append(field);
        field.select();
        copied = document.execCommand('copy');
        field.remove();
      }
      if (feedback) {
        feedback.textContent = copied ? '已複製' : '複製失敗';
        window.setTimeout(() => { feedback.textContent = ''; }, 1600);
      }
      if (copied) button.setAttribute('aria-label', `${text}已複製`);
    });
  };

  const back = page.querySelector('[data-payment-back]');
  if (order) back.href = model.withOrder('checkout.html', order);

  const noOrder = page.querySelector('[data-order-local-note]');
  const done = page.querySelector('[data-payment-done]');
  const status = page.querySelector('[data-payment-status-note]');
  if (!order) {
    noOrder.textContent = '此裝置找不到訂單資料。請返回「訂單資訊」使用訂單編號與 Email 查詢。';
    status.textContent = '無法載入此筆訂單。';
    done.disabled = true;
    return;
  }

  noOrder.textContent = api?.configured
    ? '此訂單已保存於 OFFCUT 訂單服務。付款回報後狀態會顯示為等待人工確認。'
    : 'OFFCUT 線上訂單服務尚未完成設定，目前無法進行正式付款回報。';

  const methodMatches = order.paymentMethod === expectedMethod;
  page.querySelector('[data-payment-order-id]').textContent = order.orderId;
  page.querySelector('[data-payment-service]').textContent = serviceLabels[order.service] || order.service;
  page.querySelector('[data-payment-tier]').textContent = tierLabels[order.tier] || order.tier;
  page.querySelector('[data-payment-price]').textContent = `NT$${Number(order.price).toLocaleString('en-US')}${order.pricingMode === 'quote' ? ' 起' : ''}`;
  page.querySelector('[data-quote-note]').hidden = order.pricingMode !== 'quote';
  const copyOrder = page.querySelector('[data-copy-order]');
  const orderFeedback = page.querySelector('[data-copy-order-feedback]');
  if (copyOrder) copyOrder.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(order.orderId);
      orderFeedback.textContent = '已複製';
      window.setTimeout(() => { orderFeedback.textContent = ''; }, 1600);
    } catch (_) {
      const field = document.createElement('textarea'); field.value = order.orderId; field.readOnly = true;
      field.style.position = 'fixed'; field.style.opacity = '0'; document.body.append(field); field.select();
      const copied = document.execCommand('copy'); field.remove();
      orderFeedback.textContent = copied ? '已複製' : '複製失敗';
      window.setTimeout(() => { orderFeedback.textContent = ''; }, 1600);
    }
  });

  const amount = String(Number(order.price));
  copyFeedback('[data-copy-amount]', '[data-copy-amount-feedback]', '付款金額', amount);
  copyFeedback('[data-copy-account]', '[data-copy-account-feedback]', '銀行帳號', '19201800126419');

  if (!methodMatches) {
    status.textContent = `這筆訂單的付款方式為「${paymentLabels[order.paymentMethod] || order.paymentMethod}」，請回訂單確認頁更換付款方式。`;
    done.disabled = true;
    return;
  }
  if (!api?.configured) {
    status.textContent = '線上訂單服務尚未完成設定。請聯繫 OFFCUT；不需要重新付款。';
    done.disabled = true;
    return;
  }
  if (order.paymentStatus === 'PAYMENT REVIEW') {
    if (order.paymentReportSubmitted) {
      status.textContent = '已收到您的付款回報，狀態為 PAYMENT REVIEW，等待 OFFCUT 確認付款。';
    } else {
      status.textContent = '請完成付款辨識資料，讓 OFFCUT 可以核對款項。';
      const resume = page.querySelector('[data-resume-report]');
      resume.href = model.withOrder('payment-complete.html', order);
      resume.hidden = false;
    }
    done.disabled = true;
    return;
  }
  if (order.paymentStatus !== 'PENDING PAYMENT') {
    status.textContent = `目前付款狀態：${order.paymentStatus}`;
    done.disabled = true;
    return;
  }

  done.disabled = false;
  done.addEventListener('click', () => {
    const updated = model.update(order.orderId, {
      paymentStatus: 'PAYMENT REVIEW',
      paymentReportedAt: new Date().toISOString(),
      paymentReportSubmitted: false
    });
    if (!updated) {
      status.textContent = '訂單資料無法保存，請稍後再試。';
      return;
    }
    window.location.href = model.withOrder('payment-complete.html', updated);
  });
})();
