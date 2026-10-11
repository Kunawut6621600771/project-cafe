/** ตัวเชื่อมต่อ REST API */
const BASE = '/api';
const KEY_TOKEN = 'ef_token';
const KEY_USER = 'ef_user';

export const auth = {
  get token() { return localStorage.getItem(KEY_TOKEN); },
  get user() { try { return JSON.parse(localStorage.getItem(KEY_USER) || 'null'); } catch { return null; } },
  save(token, user) {
    localStorage.setItem(KEY_TOKEN, token);
    localStorage.setItem(KEY_USER, JSON.stringify(user));
  },
  clear() { localStorage.removeItem(KEY_TOKEN); localStorage.removeItem(KEY_USER); },
  can(...roles) { const u = this.user; return u && roles.includes(u.role); },
};

async function request(method, path, body) {
  const opt = { method, headers: {} };
  if (auth.token) opt.headers.Authorization = `Bearer ${auth.token}`;
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, opt);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }

  if (res.status === 401) {
    auth.clear();
    window.dispatchEvent(new CustomEvent('ef:logout'));
    throw new Error(data?.error || 'เซสชันหมดอายุ');
  }
  if (!res.ok) throw new Error(data?.error || `เกิดข้อผิดพลาด (${res.status})`);
  return data;
}

const qs = (o = {}) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v !== '' && v != null) p.append(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  get:  (p, q) => request('GET', p + qs(q)),
  post: (p, b) => request('POST', p, b || {}),
  put:  (p, b) => request('PUT', p, b || {}),
  patch:(p, b) => request('PATCH', p, b || {}),
  del:  (p)    => request('DELETE', p),

  // --- auth ---
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  me: () => request('GET', '/auth/me'),

  // --- สินค้า ---
  categories: () => request('GET', '/categories'),
  products: (q) => request('GET', '/products' + qs(q)),
  product: (id) => request('GET', `/products/${id}`),
  optionGroups: () => request('GET', '/options'),

  // --- ออเดอร์ ---
  orders: (q) => request('GET', '/orders' + qs(q)),
  order: (id) => request('GET', `/orders/${id}`),
  createOrder: (b) => request('POST', '/orders', b),
  orderStatus: (id, status) => request('PATCH', `/orders/${id}/status`, { status }),
  cancelOrder: (id, reason) => request('POST', `/orders/${id}/cancel`, { reason }),
  queue: () => request('GET', '/orders/queue'),

  // --- รับชำระเงิน ---
  paymentConfig: () => request('GET', '/payments/config'),
  promptpayQr: (amount) => request('GET', '/payments/promptpay-qr' + qs({ amount })),
  verifySlip: (b) => request('POST', '/payments/verify-slip', b),
  slips: (q) => request('GET', '/payments/slips' + qs(q)),

  // --- LINE Bot ---
  lineStatus: () => request('GET', '/line/status'),
  orderLineLink: (id) => request('GET', `/line/order-link/${id}`),

  // --- คลัง ---
  ingredients: (q) => request('GET', '/stock/ingredients' + qs(q)),
  stockSummary: () => request('GET', '/stock/summary'),
  stockAlerts: () => request('GET', '/stock/alerts'),
  movements: (q) => request('GET', '/stock/movements' + qs(q)),
  moveStock: (b) => request('POST', '/stock/movements', b),

  // --- สมาชิก ---
  members: (q) => request('GET', '/members' + qs(q)),
  member: (id) => request('GET', `/members/${id}`),
  memberSummary: () => request('GET', '/members/summary'),
  searchMember: (q) => request('GET', '/members/search' + qs({ q })),

  // --- รายงาน ---
  dashboard: () => request('GET', '/reports/dashboard'),
  salesReport: (q) => request('GET', '/reports/sales' + qs(q)),
  productReport: (q) => request('GET', '/reports/products' + qs(q)),
  staffReport: (q) => request('GET', '/reports/staff' + qs(q)),
  profitLoss: (q) => request('GET', '/reports/profit-loss' + qs(q)),

  // --- ตั้งค่า ---
  settings: () => request('GET', '/settings'),
  saveSettings: (b) => request('PUT', '/settings', b),
  users: () => request('GET', '/users'),
  promotions: () => request('GET', '/promotions'),
  expenses: (q) => request('GET', '/expenses' + qs(q)),
  currentShift: () => request('GET', '/shifts/current'),
};
