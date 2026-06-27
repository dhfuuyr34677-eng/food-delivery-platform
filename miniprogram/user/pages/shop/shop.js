const { api } = require('../../utils/api');

Page({
  data: {
    shop: null,
    selectedItems: {},
    totalAmount: 0,
    totalCount: 0,
    cartAmountText: '0.00',
  },
  onLoad(options) {
    this.loadShop(options.id);
  },
  async loadShop(id) {
    try {
      const shop = await api.get('/api/shop/' + id);
      if (shop && shop.products) {
        shop.products = shop.products.map(function(p) {
          p.priceText = ((p.price || 0) / 100).toFixed(2);
          return p;
        });
        shop.cartAmountText = '0.00';
      }
      this.setData({ shop });
    } catch {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },
  addItem(e) {
    const { id } = e.currentTarget.dataset;
    const items = { ...this.data.selectedItems };
    items[id] = (items[id] || 0) + 1;
    this.calcTotal(items);
  },
  removeItem(e) {
    const { id } = e.currentTarget.dataset;
    const items = { ...this.data.selectedItems };
    if (items[id] > 1) items[id]--;
    else delete items[id];
    this.calcTotal(items);
  },
  calcTotal(items) {
    const products = this.data.shop?.products ?? [];
    let count = 0, amount = 0;
    for (const [id, qty] of Object.entries(items)) {
      const p = products.find((p) => p.id === id);
      if (p) { count += qty; amount += p.price * qty; }
    }
    this.setData({
      selectedItems: items,
      totalCount: count,
      totalAmount: amount,
      cartAmountText: (amount / 100).toFixed(2),
    });
  },
  goOrder() {
    if (this.data.totalCount === 0) {
      return wx.showToast({ title: '请选择商品', icon: 'none' });
    }
    const items = Object.entries(this.data.selectedItems).map(([id, qty]) => ({
      productId: id, quantity: qty,
    }));
    const shopId = this.data.shop?.id;
    const itemsStr = JSON.stringify(items);
    wx.navigateTo({ url: '/pages/order-create/order-create?shopId=' + shopId + '&items=' + encodeURIComponent(itemsStr) });
  },
});
