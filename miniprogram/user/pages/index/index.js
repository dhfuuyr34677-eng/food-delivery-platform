var api = require('../../utils/api').api;

Page({
  data: { shops: [], loading: true },
  onLoad: function() { this.loadShops(); },
  loadShops: function() {
    var that = this;
    api.get('/api/shop/nearby').then(function(shops) {
      that.setData({ shops: shops, loading: false });
    }).catch(function() {
      that.setData({ loading: false });
    });
  },
  goShop: function(e) {
    var id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/shop/shop?id=' + id });
  },
});
