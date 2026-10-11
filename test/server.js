/** เปิดเซิร์ฟเวอร์จริงบนพอร์ตสุ่ม + ล็อกอิน สำหรับเทสต์ */
require('./env');
const { initSchema } = require('../backend/database/db');

async function startServer() {
  await initSchema();
  const app = require('../backend/server');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  }).then((r) => r.json());

  /** เรียก API ด้วย token ของ admin → { status, body } */
  async function call(method, path, body, headers = {}) {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  }

  return { base, server, token: login.token, user: login.user, call };
}

module.exports = { startServer };
