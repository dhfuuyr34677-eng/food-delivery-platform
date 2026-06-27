const { api } = require('../../utils/api');

Page({
  data: { products: [] },
  onShow() { this.loadProducts(); },
  async loadProducts() {
    try {
      const list = await api.get('/api/merchant/products');
      const products = (list || []).map(function(p) {
        p.priceText = ((p.price || 0) / 100).toFixed(2);
        p.statusText = p.isAvailable ? '下架' : '上架';
        return p;
      });
      this.setData({ products: products });
    } catch (e) { console.error('loadProducts failed:', e); }
  },
  async addProduct() {
    wx.showModal({
      title: '新增商品', editable: true, placeholderText: '商品名称',
      success: async (res) => {
        if (!res.confirm || !res.content) return;
        try {
          await api.post('/api/merchant/products', { name: res.content, price: 1000 });
          this.loadProducts();
        } catch { wx.showToast({ title: '添加失败', icon: 'none' }); }
      },
    });
  },
  async toggleProduct(e) {
    const { id, available } = e.currentTarget.dataset;
    try {
      if (available === 'true') {
        await api.delete('/api/merchant/products/' + id);
      } else {
        await api.put('/api/merchant/products/' + id, { name: '已恢复', price: 1000 });
      }
      this.loadProducts();
    } catch (e) { console.error('toggleProduct failed:', e); }
  },
});
