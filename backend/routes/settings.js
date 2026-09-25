/**
 * /api/settings, /api/users, /api/promotions, /api/expenses, /api/shifts
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, tx } = require('../database/db');
const { auth, requireRole } = require('../middleware/auth');
const { wrap, setSetting, round2 } = require('../utils/helpers');

const owner = [auth, requireRole('owner')];
const manager = [auth, requireRole('owner', 'manager')];

// ---------------- ตั้งค่าร้าน ----------------
router.get('/settings', auth, wrap(async (req, res) => {
  const rows = await db.all('SELECT key,value FROM settings');
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}));

router.put('/settings', manager, wrap(async (req, res) => {
  const body = req.body || {};
  await tx(async (t) => {
    for (const [k, v] of Object.entries(body)) await setSetting(k, v, t);
  });
  const rows = await db.all('SELECT key,value FROM settings');
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}));

// ---------------- พนักงาน ----------------
router.get('/users', manager, wrap(async (req, res) => {
  res.json(await db.all(`SELECT u.id,u.username,u.full_name,u.role,u.phone,u.status,u.created_at,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id AND o.status='completed') AS total_orders,
      (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.user_id=u.id AND o.status='completed') AS total_sales
    FROM users u ORDER BY u.id`));
}));

router.post('/users', owner, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.username || !b.password || !b.full_name) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้ รหัสผ่าน และชื่อ-นามสกุล' });
  }
  if (String(b.password).length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  if (await db.get('SELECT id FROM users WHERE username=?', b.username)) {
    return res.status(400).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' });
  }
  const id = await db.insert(`INSERT INTO users (username,password_hash,full_name,role,phone,pin)
    VALUES (?,?,?,?,?,?)`,
    b.username, bcrypt.hashSync(b.password, 10), b.full_name,
    ['owner', 'manager', 'staff'].includes(b.role) ? b.role : 'staff', b.phone || null, b.pin || null);
  res.status(201).json(
    await db.get('SELECT id,username,full_name,role,phone,status FROM users WHERE id=?', id));
}));

router.put('/users/:id', owner, wrap(async (req, res) => {
  const cur = await db.get('SELECT * FROM users WHERE id=?', req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  if (req.body.password && String(req.body.password).length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  }
  const b = { ...cur, ...req.body };
  await db.run(`UPDATE users SET full_name=?,role=?,phone=?,status=?,updated_at=LOCALTIMESTAMP(0)
                WHERE id=?`,
    b.full_name, b.role, b.phone || null, b.status, req.params.id);
  if (req.body.password) {
    await db.run('UPDATE users SET password_hash=? WHERE id=?',
      bcrypt.hashSync(req.body.password, 10), req.params.id);
  }
  res.json(await db.get('SELECT id,username,full_name,role,phone,status FROM users WHERE id=?', req.params.id));
}));

router.delete('/users/:id', owner, wrap(async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'ไม่สามารถลบบัญชีตัวเองได้' });
  await db.run("UPDATE users SET status='inactive' WHERE id=?", req.params.id);
  res.json({ message: 'ระงับการใช้งานบัญชีเรียบร้อย' });
}));

// ---------------- โปรโมชั่น ----------------
router.get('/promotions', auth, wrap(async (req, res) => {
  res.json(await db.all('SELECT * FROM promotions ORDER BY is_active DESC, id DESC'));
}));

router.post('/promotions', manager, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.code) return res.status(400).json({ error: 'กรุณาระบุชื่อและโค้ดส่วนลด' });
  const id = await db.insert(`INSERT INTO promotions (code,name,type,value,min_total,start_date,end_date,is_active)
    VALUES (?,?,?,?,?,?,?,?)`,
    String(b.code).toUpperCase(), b.name, b.type === 'amount' ? 'amount' : 'percent',
    Number(b.value || 0), Number(b.min_total || 0), b.start_date || null, b.end_date || null,
    b.is_active === 0 ? 0 : 1);
  res.status(201).json(await db.get('SELECT * FROM promotions WHERE id=?', id));
}));

router.put('/promotions/:id', manager, wrap(async (req, res) => {
  const cur = await db.get('SELECT * FROM promotions WHERE id=?', req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบโปรโมชั่น' });
  const b = { ...cur, ...req.body };
  await db.run(`UPDATE promotions SET code=?,name=?,type=?,value=?,min_total=?,start_date=?,end_date=?,is_active=?
                WHERE id=?`,
    String(b.code).toUpperCase(), b.name, b.type, Number(b.value), Number(b.min_total),
    b.start_date || null, b.end_date || null, b.is_active ? 1 : 0, req.params.id);
  res.json(await db.get('SELECT * FROM promotions WHERE id=?', req.params.id));
}));

router.delete('/promotions/:id', manager, wrap(async (req, res) => {
  await db.run('UPDATE promotions SET is_active=0 WHERE id=?', req.params.id);
  res.json({ message: 'ปิดใช้งานโปรโมชั่นเรียบร้อย' });
}));

// ---------------- ค่าใช้จ่าย ----------------
router.get('/expenses', manager, wrap(async (req, res) => {
  const { date_from, date_to, category } = req.query;
  const where = [], args = [];
  if (date_from) { where.push('e.spent_at >= ?::date'); args.push(date_from); }
  if (date_to) { where.push('e.spent_at <= ?::date'); args.push(date_to); }
  if (category) { where.push('e.category = ?'); args.push(category); }
  res.json(await db.all(`SELECT e.*, u.full_name AS user_name FROM expenses e
    LEFT JOIN users u ON u.id=e.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY e.spent_at DESC, e.id DESC LIMIT 200`, args));
}));

router.post('/expenses', manager, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.amount) return res.status(400).json({ error: 'กรุณาระบุรายการและจำนวนเงิน' });
  const id = await db.insert(`INSERT INTO expenses (category,title,amount,note,user_id,spent_at)
    VALUES (?,?,?,?,?,COALESCE(?::date, CURRENT_DATE))`,
    b.category || 'อื่นๆ', b.title, round2(b.amount), b.note || null, req.user.id, b.spent_at || null);
  res.status(201).json(await db.get('SELECT * FROM expenses WHERE id=?', id));
}));

router.delete('/expenses/:id', manager, wrap(async (req, res) => {
  await db.run('DELETE FROM expenses WHERE id=?', req.params.id);
  res.json({ message: 'ลบรายการค่าใช้จ่ายเรียบร้อย' });
}));

// ---------------- กะการขาย ----------------
router.get('/shifts/current', auth, wrap(async (req, res) => {
  const s = await db.get(`SELECT s.*, u.full_name FROM shifts s LEFT JOIN users u ON u.id=s.user_id
    WHERE s.status='open' ORDER BY s.id DESC LIMIT 1`);
  res.json(s || null);
}));

router.get('/shifts', manager, wrap(async (req, res) => {
  res.json(await db.all(`SELECT s.*, u.full_name FROM shifts s LEFT JOIN users u ON u.id=s.user_id
    ORDER BY s.id DESC LIMIT 50`));
}));

router.post('/shifts/open', auth, wrap(async (req, res) => {
  const open = await db.get("SELECT id FROM shifts WHERE status='open'");
  if (open) return res.status(400).json({ error: 'มีกะที่เปิดอยู่แล้ว กรุณาปิดกะก่อน' });
  const id = await db.insert('INSERT INTO shifts (user_id,opening_cash) VALUES (?,?)',
    req.user.id, round2(req.body?.opening_cash || 0));
  res.status(201).json(await db.get('SELECT * FROM shifts WHERE id=?', id));
}));

router.post('/shifts/close', auth, wrap(async (req, res) => {
  const s = await db.get("SELECT * FROM shifts WHERE status='open' ORDER BY id DESC LIMIT 1");
  if (!s) return res.status(400).json({ error: 'ไม่มีกะที่เปิดอยู่' });
  const { v: cash } = await db.get(`SELECT COALESCE(SUM(total),0) v FROM orders
    WHERE shift_id=? AND status='completed' AND payment_method='cash'`, s.id);
  const closing = round2(req.body?.closing_cash || 0);
  await db.run(`UPDATE shifts SET closed_at=LOCALTIMESTAMP(0), closing_cash=?, status='closed', note=?
                WHERE id=?`, closing, req.body?.note || null, s.id);
  const shift = await db.get('SELECT * FROM shifts WHERE id=?', s.id);
  res.json({ ...shift, expected_cash: round2(s.opening_cash + cash), diff: round2(closing - (s.opening_cash + cash)) });
}));

module.exports = router;
