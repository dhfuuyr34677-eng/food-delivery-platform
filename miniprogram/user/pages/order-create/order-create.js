const { api } = require('../../utils/api');

Page({
  data: {
    shopId: '',
    items: [],
    addresses: [],
    selectedAddress: null,
    remark: '',
    totalAmount: 0,
    submitting: false,
  },
  onLoad(options) {
    const items = JSON.parse(decodeURIComponent(options.items));
    this.setData({ shopId: options.shopId, items });
    this.loadAddresses();
  },
  async loadAddresses() {
    try {
      const list = await api.get('/api/user/addresses');
      this.setData({ addresses: list, selectedAddress: list.find((a) => a.isDefault) || list[0] });
    } catch {}
  },
  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },
  selectAddress() {
    wx.navigateTo({ url: '/pages/addresses/addresses?select=true' });
  },
  onAddressSelected(addr) {
    this.setData({ selectedAddress: addr });
  },
  async submitOrder() {
    if (!this.data.selectedAddress) {
      return wx.showToast({ title: '请选择地址', icon: 'none' });
    }
    this.setData({ submitting: true });
    try {
      const res = await api.post('/api/order', {
        shopId: this.data.shopId,
        addressId: this.data.selectedAddress.id,
        items: this.data.items,
        remark: this.data.remark,
      });
      wx.redirectTo({ url: '/pages/order-detail/order-detail?id=' + res.orderId });
    } catch {
      wx.showToast({ title: '下单失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
