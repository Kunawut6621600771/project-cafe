/**
 * /api/members : สมาชิก + แต้มสะสม
 */
const router = require('express').Router();
const { db, tx } = require('../database/db');
const { auth, requireRole } = require('../middleware/auth');
const { wrap, nextMemberCode } = require('../utils/helpers');

// GET /api/members
router.get('/', auth, wrap(async (req, res) => {
  const { q, tier } = req.query;
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Number.parseInt(req.query.limit || '20', 10));
  const where = ['is_active = 1'], args = [];
  if (q) { where.push('(name ILIKE ? OR phone ILIKE ? OR code ILIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (tier) { where.push('tier = ?'); args.push(tier); }
  const W = 'WHERE ' + where.join(' AND ');

  const { c: total } = await db.get(`SELECT COUNT(*) c FROM members ${W}`, args);
  const data = await db.all(`SELECT * FROM members ${W} ORDER BY total_spent DESC, id DESC LIMIT ? OFFSET ?`,
    [...args, limit, (page - 1) * limit]);
  res.json({ data, page, limit, total, pages: Math.ceil(total / limit) || 1 });
}));

// GET /api/members/summary
router.get('/summary', auth, wrap(async (req, res) => {
  const s = await db.get(`SELECT COUNT(*) total,
      SUM(CASE WHEN tier='platinum' THEN 1 ELSE 0 END) platinum,
      SUM(CASE WHEN tier='gold' THEN 1 ELSE 0 END) gold,
      SUM(CASE WHEN tier='silver' THEN 1 ELSE 0 END) silver,
      SUM(points) total_points,
      ROUND(AVG(total_spent)::numeric, 2) avg_spent
    FROM members WHERE is_active=1`);
  const { c: newThisMonth } = await db.get(`SELECT COUNT(*) c FROM members
    WHERE to_char(created_at,'YYYY-MM') = to_char(LOCALTIMESTAMP,'YYYY-MM')`);
  res.json({ ...s, new_this_month: newThisMonth });
}));

// GET /api/members/search?phone=
router.get('/search', auth, wrap(async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  res.json(await db.all(`SELECT * FROM members WHERE is_active=1
    AND (phone ILIKE ? OR name ILIKE ? OR code ILIKE ?) LIMIT 10`,
    `%${q}%`, `%${q}%`, `%${q}%`));
}));

// GET /api/members/:id
router.get('/:id', auth, wrap(async (req, res) => {
  const m = await db.get('SELECT * FROM members WHERE id=?', req.params.id);
  if (!m) return res.status(404).json({ error: 'ไม่พบสมาชิก' });
  m.orders = await db.all(`SELECT id,order_no,total,status,created_at FROM orders
    WHERE member_id=? ORDER BY created_at DESC LIMIT 10`, m.id);
  m.point_history = await db.all(`SELECT * FROM point_transactions WHERE member_id=?
    ORDER BY created_at DESC LIMIT 20`, m.id);
  m.favorite = await db.all(`SELECT oi.product_name, SUM(oi.qty) qty
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.member_id=? AND o.status='completed'
    GROUP BY oi.product_name ORDER BY qty DESC LIMIT 5`, m.id);
  res.json(m);
}));

// POST /api/members
router.post('/', auth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.phone) return res.status(400).json({ error: 'กรุณาระบุชื่อและเบอร์โทรศัพท์' });
  const dup = await db.get('SELECT id FROM members WHERE phone=?', b.phone);
  if (dup) return res.status(400).json({ error: 'เบอร์โทรศัพท์นี้เป็นสมาชิกอยู่แล้ว' });

  const id = await db.insert(`INSERT INTO members (code,name,phone,email,birthdate,note,points)
    VALUES (?,?,?,?,?,?,?)`,
    await nextMemberCode(), b.name, b.phone, b.email || null, b.birthdate || null,
    b.note || null, Number(b.points || 0));
  res.status(201).json(await db.get('SELECT * FROM members WHERE id=?', id));
}));

// PUT /api/members/:id
router.put('/:id', auth, wrap(async (req, res) => {
  const cur = await db.get('SELECT * FROM members WHERE id=?', req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบสมาชิก' });
  const b = { ...cur, ...req.body };
  await db.run('UPDATE members SET name=?,phone=?,email=?,birthdate=?,note=? WHERE id=?',
    b.name, b.phone, b.email || null, b.birthdate || null, b.note || null, req.params.id);
  res.json(await db.get('SELECT * FROM members WHERE id=?', req.params.id));
}));

// POST /api/members/:id/points : เพิ่ม/หักแต้มด้วยตนเอง
router.post('/:id/points', auth, requireRole('owner', 'manager'), wrap(async (req, res) => {
  const m = await db.get('SELECT * FROM members WHERE id=?', req.params.id);
  if (!m) return res.status(404).json({ error: 'ไม่พบสมาชิก' });
  const points = Number.parseInt(req.body?.points, 10);
  if (!Number.isFinite(points) || points === 0) return res.status(400).json({ error: 'จำนวนแต้มไม่ถูกต้อง' });
  const balance = m.points + points;
  if (balance < 0) return res.status(400).json({ error: `แต้มไม่พอ คงเหลือ ${m.points} แต้ม` });

  await tx(async (t) => {
    await t.run('UPDATE members SET points=? WHERE id=?', balance, m.id);
    await t.run(`INSERT INTO point_transactions (member_id,points,balance_after,reason)
                 VALUES (?,?,?,?)`, m.id, points, balance, req.body?.reason || 'ปรับแต้มโดยพนักงาน');
  });
  res.json({ message: 'ปรับแต้มเรียบร้อย', points: balance });
}));

// DELETE /api/members/:id
router.delete('/:id', auth, requireRole('owner', 'manager'), wrap(async (req, res) => {
  await db.run('UPDATE members SET is_active=0 WHERE id=?', req.params.id);
  res.json({ message: 'ยกเลิกสมาชิกเรียบร้อย' });
}));

module.exports = router;
