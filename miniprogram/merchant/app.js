App({
  globalData: { token: '', shopId: '' },
  onLaunch() {
    const token = wx.getStorageSync('token');
    const shopId = wx.getStorageSync('shopId');
    if (token) { this.globalData.token = token; this.globalData.shopId = shopId; }
  },
});
