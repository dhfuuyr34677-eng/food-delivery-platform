const { api } = require('../../utils/api');

Page({
  data: { order: null, canCancel: false },
  onLoad(options) { this.loadOrder(options.id); },
  async loadOrder(id) {
    try {
      const order = await api.get('/api/order/' + id);
      order.amountText = ((order.totalAmount || 0) / 100).toFixed(2);
      if (order.items) {
        order.items = order.items.map(function(item) {
          item.amountText = ((item.unitPrice * item.quantity || 0) / 100).toFixed(2);
          return item;
        });
      }
      this.setData({
        order,
        canCancel: ['pending', 'preparing'].includes(order.status),
      });
    } catch (e) { console.error('loadOrder failed:', e); }
  },
  async cancelOrder() {
    try {
      await api.post('/api/order/' + this.data.order.id + '/cancel');
      this.loadOrder(this.data.order.id);
    } catch {
      wx.showToast({ title: '取消失败', icon: 'none' });
    }
  },
});
