const { api } = require('../../utils/api');

Page({
  data: { settlements: [] },
  onShow() { this.loadList(); },
  async loadList() {
    try {
      const list = await api.get('/api/merchant/settlements');
      const STATUS_TEXT = { pending: '待结算', settled: '已结算', paid: '已打款' };
      const mapped = (list || []).map(function(item) {
        item.statusText = STATUS_TEXT[item.status] || item.status;
        item.amountText = ((item.netAmount || 0) / 100).toFixed(2);
        item.commissionText = ((item.commission || 0) / 100).toFixed(2);
        return item;
      });
      this.setData({ settlements: mapped });
    } catch (e) { console.error('loadSettlements failed:', e); }
  },
});
