const { api } = require('../../utils/api');

Page({
  data: { addresses: [] },
  onShow() { this.loadList(); },
  async loadList() {
    try {
      const list = await api.get('/api/user/addresses');
      this.setData({ addresses: list });
    } catch {}
  },
  addAddr() {
    wx.showModal({
      title: '新增地址',
      editable: true,
      placeholderText: '请输入地址',
      success: async (res) => {
        if (!res.confirm || !res.content) return;
        try {
          await api.post('/api/user/addresses', {
            contactName: '新地址',
            phone: '13800000000',
            address: res.content,
            lat: 30.5 + Math.random() * 0.1,
            lng: 104.0 + Math.random() * 0.1,
          });
          this.loadList();
        } catch {
          wx.showToast({ title: '添加失败', icon: 'none' });
        }
      },
    });
  },
  async deleteAddr(e) {
    const id = e.currentTarget.dataset.id;
    try {
      await api.delete('/api/user/addresses/' + id);
      this.loadList();
    } catch {}
  },
});
