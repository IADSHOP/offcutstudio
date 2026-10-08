(() => {
  const STORAGE_KEY = 'offcutstudio.orders.v1';
  const LOOKUP_KEY = 'offcutstudio.lookup-session.v1';
  const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const storage = window.OFFCUT_ORDER_STORAGE;

  function readAll() {
    return storage?.readAll() || [];
  }

  function write(order) {
    return storage?.write(order) || null;
  }

  function randomCode() {
    const values = new Uint8Array(4);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(values);
    else for (let i = 0; i < values.length; i += 1) values[i] = Math.floor(Math.random() * 256);
    return [...values].map(value => ID_CHARS[value % ID_CHARS.length]).join('');
  }

  function requestId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const values = new Uint8Array(18);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(values);
    else for (let i = 0; i < values.length; i += 1) values[i] = Math.floor(Math.random() * 256);
    return [...values].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function createOrder(data) {
    const now = new Date();
    const date = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    let orderId;
    do { orderId = `OFF-${date}-${randomCode()}`; } while (readAll().some(order => order.orderId === orderId));
    const stamp = now.toISOString();
    return write({
      orderId,
      creationRequestId: requestId(),
      service: data.service,
      tier: data.tier,
      price: Number(data.price),
      pricingMode: data.pricingMode === 'quote' ? 'quote' : 'fixed',
      paymentMethod: data.paymentMethod,
      customerName: '',
      email: '',
      lineId: '',
      paymentStatus: 'PENDING PAYMENT',
      materialStatus: 'NOT SUBMITTED',
      productionStatus: 'NOT STARTED',
      createdAt: stamp,
      updatedAt: stamp,
      paymentReportedAt: '',
      paymentReportSubmitted: false,
      paymentTime: '',
      paymentReference: '',
      paymentNote: '',
      paymentLastFive: '',
      paymentScreenshotName: '',
      paymentNotificationStatus: 'NOT SENT',
      materialMethod: '',
      materialLink: '',
      materialNote: '',
      materialReportedAt: '',
      materialNotificationStatus: 'NOT SENT'
    });
  }

  function get(orderId) {
    return readAll().find(order => order.orderId === orderId) || null;
  }

  function update(orderId, changes) {
    const order = get(orderId);
    if (!order) return null;
    return write({ ...order, ...changes, orderId: order.orderId, updatedAt: new Date().toISOString() });
  }

  function rotateCollidingId(orderId) {
    const order = get(orderId);
    if (!order) return null;
    const previousId = order.orderId;
    let nextId;
    do {
      const now = new Date();
      const date = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      nextId = `OFF-${date}-${randomCode()}`;
    } while (readAll().some(item => item.orderId === nextId));
    if (storage?.remove && !storage.remove(previousId)) return null;
    return write({ ...order, orderId: nextId, creationRequestId: requestId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }

  function cacheRemote(order) {
    if (!order || typeof order.orderId !== 'string' || !/^OFF-\d{6}-[A-Z2-9]{4}$/i.test(order.orderId)) return null;
    return write(order);
  }

  function findByCredentials(orderId, email) {
    const order = get(String(orderId || '').trim().toUpperCase());
    if (!order || !order.email || order.email.trim().toLowerCase() !== String(email || '').trim().toLowerCase()) return null;
    return order;
  }

  function rememberLookup(order) {
    try {
      sessionStorage.setItem(LOOKUP_KEY, JSON.stringify({
        orderId: order.orderId,
        email: String(order.email || '').trim().toLowerCase()
      }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function isLookupAuthorized(order) {
    try {
      const session = JSON.parse(sessionStorage.getItem(LOOKUP_KEY) || 'null');
      return Boolean(session && session.orderId === order.orderId && session.email === String(order.email || '').trim().toLowerCase());
    } catch (_) {
      return false;
    }
  }

  function withOrder(path, order) {
    const params = new URLSearchParams({
      orderId: order.orderId,
      service: order.service,
      tier: order.tier,
      price: String(order.price),
      paymentMethod: order.paymentMethod
    });
    if (order.pricingMode === 'quote') params.set('pricingMode', 'quote');
    return `${path}?${params.toString()}`;
  }

  window.OFFCUT_ORDER_MODEL = Object.freeze({
    storage: Object.freeze({ type: storage?.type || 'unavailable', key: storage?.key || STORAGE_KEY, scope: storage?.scope || 'unavailable' }),
    create: createOrder,
    get,
    all: readAll,
    update,
    rotateCollidingId,
    cacheRemote,
    findByCredentials,
    rememberLookup,
    isLookupAuthorized,
    withOrder
  });
})();
