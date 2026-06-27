var BASE_URL = 'http://127.0.0.1';

function request(options) {
  const token = wx.getStorageSync('token');
  const header = { 'Content-Type': 'application/json' };
  if (token) header['Authorization'] = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    wx.request({
      ...options,
      url: `${BASE_URL}${options.url}`,
      header: { ...header, ...options.header },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else if (res.statusCode === 401) {
          wx.removeStorageSync('token');
          wx.showToast({ title: '请先登录', icon: 'none' });
          reject(res.data);
        } else {
          reject(res.data);
        }
      },
      fail: reject,
    });
  });
}

const api = {
  get: (url, data) => request({ url, data, method: 'GET' }),
  post: (url, data) => request({ url, data, method: 'POST' }),
  put: (url, data) => request({ url, data, method: 'PUT' }),
  delete: (url, data) => request({ url, data, method: 'DELETE' }),
};

// WeChat login
async function login() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (res) => {
        if (!res.code) return reject('wx.login failed');
        try {
          const data = await api.post('/api/user/login/wechat', { code: res.code });
          const token = data.token;
          wx.setStorageSync('token', token);
          resolve(token);
        } catch (e) {
          reject(e);
        }
      },
      fail: reject,
    });
  });
}

module.exports = { api, login };
