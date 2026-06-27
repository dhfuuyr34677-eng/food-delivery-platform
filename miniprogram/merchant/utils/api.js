const BASE_URL = 'http://127.0.0.1';

function request(options) {
  const token = wx.getStorageSync('token');
  const header = { 'Content-Type': 'application/json' };
  if (token) header['Authorization'] = 'Bearer ' + token;

  return new Promise((resolve, reject) => {
    wx.request({
      ...options,
      url: BASE_URL + options.url,
      header: { ...header, ...options.header },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(res.data);
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

async function login(username, password) {
  const data = await api.post('/api/merchant/login', { username, password });
  wx.setStorageSync('token', data.token);
  wx.setStorageSync('shopId', data.shopId);
}

async function register(data) {
  const res = await api.post('/api/merchant/register', data);
  wx.setStorageSync('token', res.token);
  wx.setStorageSync('shopId', res.shop.id);
}

module.exports = { api, login, register };
