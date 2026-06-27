Component({
  properties: {
    selected: { type: Number, value: 0 },
  },
  data: {
    list: [
      { pagePath: '/pages/index/index', text: '首页', icon: '/images/home.png' },
      { pagePath: '/pages/orders/orders', text: '订单', icon: '/images/order.png' },
      { pagePath: '/pages/profile/profile', text: '我的', icon: '/images/profile.png' },
    ],
  },
  methods: {
    switchTab(e) {
      var index = Number(e.currentTarget.dataset.index);
      if (index === this.data.selected) return;
      var item = this.data.list[index];
      wx.redirectTo({
        url: item.pagePath,
        fail: function(err) { console.error('Tab switch failed:', err); },
      });
    },
  },
});
