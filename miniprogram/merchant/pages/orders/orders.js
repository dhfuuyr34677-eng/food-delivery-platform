const { api } = require('../../utils/api');

const ALL_ACTIONS = ['accept', 'reject', 'prepare', 'deliver'];

const STATUS_ACTIONS = {
  pending: ['accept', 'reject'],
  confirmed: ['prepare'],
  preparing: ['deliver'],
};

const ACTION_LABELS = {
  accept: '接单', reject: '拒单', prepare: '开始制作', deliver: '开始配送',
};

Page({
  data: { orders: [] },
  onShow() { this.loadOrders(); },
  async loadOrders() {
    try {
      const list = await api.get('/api/order/merchant');
      const orders = (list || []).map(function(order) {
        order.amountText = ((order.totalAmount || 0) / 100).toFixed(2);
        order.addrText = (order.addressSnapshot && order.addressSnapshot.address) || '';
        order.actions = (STATUS_ACTIONS[order.status] || []).map(function(a) {
          return { action: a, label: ACTION_LABELS[a] || a };
        });
        return order;
      });
      this.setData({ orders: orders });
    } catch (e) { console.error('loadOrders failed:', e); }
  },
  async doAction(e) {
    const { id, action } = e.currentTarget.dataset;
    try {
      await api.post('/api/order/merchant/' + id + '/' + action);
      this.loadOrders();
    } catch {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },
});
