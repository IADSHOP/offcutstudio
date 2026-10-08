(() => {
  const KEY = 'offcutstudio.orders.v1';
  const adapter = {
    type: 'localStorage UX cache',
    key: KEY,
    scope: 'same browser and device only',
    readAll() {
      try {
        const value = JSON.parse(localStorage.getItem(KEY) || '[]');
        return Array.isArray(value) ? value.filter(order => order && typeof order.orderId === 'string') : [];
      } catch (_) { return []; }
    },
    write(order) {
      try {
        const orders = this.readAll();
        const index = orders.findIndex(item => item.orderId === order.orderId);
        if (index < 0) orders.push(order);
        else orders[index] = order;
        localStorage.setItem(KEY, JSON.stringify(orders));
        return order;
      } catch (_) { return null; }
    },
    remove(orderId) {
      try {
        const orders = this.readAll().filter(order => order.orderId !== orderId);
        localStorage.setItem(KEY, JSON.stringify(orders));
        return true;
      } catch (_) { return false; }
    }
  };
  window.OFFCUT_ORDER_STORAGE = Object.freeze(adapter);
})();
