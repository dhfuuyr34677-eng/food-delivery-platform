Component({
  properties: {
    selected: { type: Number, value: 0 },
  },
  data: {
    list: [
      { pagePath: '/pages/orders/orders', text: '订单', icon: '/images/orders.png' },
      { pagePath: '/pages/menu/menu', text: '菜单', icon: '/images/menu.png' },
      { pagePath: '/pages/dashboard/dashboard', text: '概览', icon: '/images/dashboard.png' },
      { pagePath: '/pages/settings/settings', text: '设置', icon: '/images/settings.png' },
    ],
  },
  methods: {
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index);
      if (index === this.data.selected) return;
      const item = this.data.list[index];
      wx.redirectTo({
        url: item.pagePath,
        fail: function(err) { console.error('Tab switch failed:', err); },
      });
    },
  },
});
