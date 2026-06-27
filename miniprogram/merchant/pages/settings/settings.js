const { api, login } = require('../../utils/api');

Page({
  data: {
    shop: null,
    isLoggedIn: !!wx.getStorageSync('token'),
    showLogin: false,
    username: '',
    password: '',
  },
  onShow() {
    if (wx.getStorageSync('token')) {
      this.setData({ isLoggedIn: true });
      this.loadShop();
    }
  },
  async loadShop() {
    try {
      const shop = await api.get('/api/merchant/shop');
      const STATUS_TEXT = { pending: '审核中', active: '营业中', suspended: '已暂停' };
      shop.statusText = STATUS_TEXT[shop.status] || shop.status;
      this.setData({ shop });
    } catch (e) { console.error('loadShop failed:', e); }
  },
  showLoginForm() { this.setData({ showLogin: true }); },
  onUsernameInput(e) { this.setData({ username: e.detail.value }); },
  onPasswordInput(e) { this.setData({ password: e.detail.value }); },
  async doLogin() {
    try {
      await login(this.data.username, this.data.password);
      this.setData({ isLoggedIn: true, showLogin: false });
      this.loadShop();
    } catch {
      wx.showToast({ title: '登录失败', icon: 'none' });
    }
  },
  logout() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('shopId');
    this.setData({ isLoggedIn: false, shop: null });
  },
});
