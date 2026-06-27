const { api } = require('../../utils/api');

Page({
  data: { stats: null },
  onShow() { this.loadDashboard(); },
  async loadDashboard() {
    try {
      const stats = await api.get('/api/merchant/dashboard');
      stats.revenueText = ((stats.todayRevenue || 0) / 100).toFixed(2);
      this.setData({ stats });
    } catch (e) { console.error('loadDashboard failed:', e); }
  },
});
