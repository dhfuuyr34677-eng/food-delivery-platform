const { api, login } = require('../../utils/api');

Page({
  data: { userInfo: null, token: '' },
  onLoad() { this.checkLogin(); },
  checkLogin() {
    const token = wx.getStorageSync('token');
    if (token) {
      this.setData({ token });
      this.loadProfile();
    }
  },
  async doLogin() {
    try {
      const token = await login();
      this.setData({ token });
      this.loadProfile();
    } catch {
      wx.showToast({ title: '登录失败', icon: 'none' });
    }
  },
  async loadProfile() {
    try {
      const info = await api.get('/api/user/profile');
      this.setData({ userInfo: info });
    } catch {}
  },
  goAddresses() {
    wx.navigateTo({ url: '/pages/addresses/addresses' });
  },
  goOrders() {
    wx.redirectTo({ url: '/pages/orders/orders' });
  },
});
