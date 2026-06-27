const { api } = require('../../utils/api');

const STATUS_MAP = {
  pending: '待确认',
  confirmed: '已确认',
  preparing: '制作中',
  delivering: '配送中',
  completed: '已完成',
  cancelled: '已取消',
};

Page({
  data: { orders: [], statusMap: STATUS_MAP },
  onShow() { this.loadOrders(); },
  async loadOrders() {
    try {
      const list = await api.get('/api/order');
      const orders = (list || []).map(function(o) {
        o.amountText = ((o.totalAmount || 0) / 100).toFixed(2);
        return o;
      });
      this.setData({ orders: orders });
    } catch (e) { console.error('loadOrders failed:', e); }
  },
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + id });
  },
});
