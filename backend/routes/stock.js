/**
 * /api/stock : วัตถุดิบ, รับเข้า/ตัดออก/ปรับยอด, ประวัติการเคลื่อนไหว
 */
const router = require('express').Router();
const { db, tx } = require('../database/db');
const { auth, requireRole } = require('../middleware/auth');
const { wrap, round2 } = require('../utils/helpers');

const manager = [auth, requireRole('owner', 'manager')];

// GET /api/stock/ingredients
router.get('/ingredients', auth, wrap(async (req, res) => {
  const { q, status } = req.query;
  const where = [], args = [];
  if (q) { where.push('(name ILIKE ? OR code ILIKE ? OR supplier ILIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (status === 'low') where.push('stock_qty <= min_qty AND stock_qty > 0');
  if (status === 'out') where.push('stock_qty <= 0');
  if (status === 'ok') where.push('stock_qty > min_qty');

  const rows = await db.all(`SELECT * FROM ingredients
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (stock_qty <= min_qty) DESC, name`, args);

  res.json(rows.map((r) => ({
    ...r,
    stock_value: round2(r.stock_qty * r.cost_per_unit),
    stock_status: r.stock_qty <= 0 ? 'out' : r.stock_qty <= r.min_qty ? 'low' : 'ok',
  })));
}));

// GET /api/stock/summary : การ์ดสรุปหน้าคลัง
router.get('/summary', auth, wrap(async (req, res) => {
  const s = await db.get(`SELECT
      COUNT(*) total,
      SUM(CASE WHEN stock_qty <= 0 THEN 1 ELSE 0 END) out_of_stock,
      SUM(CASE WHEN stock_qty > 0 AND stock_qty <= min_qty THEN 1 ELSE 0 END) low_stock,
      ROUND(SUM(stock_qty * cost_per_unit)::numeric, 2) stock_value
    FROM ingredients WHERE is_active=1`);
  const today = await db.get(`SELECT ROUND(SUM(cost)::numeric, 2) v FROM stock_movements
    WHERE type='out' AND created_at::date = CURRENT_DATE`);
  res.json({ ...s, today_usage_cost: today.v || 0 });
}));

// GET /api/stock/alerts : รายการที่ต้องสั่งซื้อ
router.get('/alerts', auth, wrap(async (req, res) => {
  res.json(await db.all(`SELECT id,code,name,unit,stock_qty,min_qty,supplier,
      ROUND((min_qty * 2 - stock_qty)::numeric, 2) AS suggest_order
    FROM ingredients WHERE is_active=1 AND stock_qty <= min_qty
    ORDER BY (stock_qty / NULLIF(min_qty,0)) ASC`));
}));

// GET /api/stock/movements
router.get('/movements', auth, wrap(async (req, res) => {
  const { ingredient_id, type, date_from, date_to } = req.query;
  const limit = Math.min(200, parseInt(req.query.limit || '50', 10));
  const where = [], args = [];
  if (ingredient_id) { where.push('m.ingredient_id = ?'); args.push(Number(ingredient_id)); }
  if (type) { where.push('m.type = ?'); args.push(type); }
  if (date_from) { where.push('m.created_at::date >= ?::date'); args.push(date_from); }
  if (date_to) { where.push('m.created_at::date <= ?::date'); args.push(date_to); }

  res.json(await db.all(`
    SELECT m.*, i.name AS ingredient_name, i.unit, u.full_name AS user_name
    FROM stock_movements m
    JOIN ingredients i ON i.id = m.ingredient_id
    LEFT JOIN users u  ON u.id = m.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY m.created_at DESC, m.id DESC LIMIT ?`, [...args, limit]));
}));

// POST /api/stock/ingredients
router.post('/ingredients', manager, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'กรุณาระบุชื่อวัตถุดิบ' });
  const code = b.code || await nextCode();

  const id = await tx(async (t) => {
    const newId = await t.insert(
      `INSERT INTO ingredients (code,name,unit,stock_qty,min_qty,cost_per_unit,supplier)
       VALUES (?,?,?,?,?,?,?)`,
      code, b.name, b.unit || 'กรัม', Number(b.stock_qty || 0), Number(b.min_qty || 0),
      Number(b.cost_per_unit || 0), b.supplier || null);
    if (Number(b.stock_qty) > 0) {
      await t.run(`INSERT INTO stock_movements (ingredient_id,type,qty,balance_after,cost,ref_type,note,user_id)
        VALUES (?,'in',?,?,?,'manual','ยอดยกมาเริ่มต้น',?)`,
        newId, Number(b.stock_qty), Number(b.stock_qty),
        round2(Number(b.stock_qty) * Number(b.cost_per_unit || 0)), req.user.id);
    }
    return newId;
  });

  res.status(201).json(await db.get('SELECT * FROM ingredients WHERE id=?', id));
}));

// PUT /api/stock/ingredients/:id
router.put('/ingredients/:id', manager, wrap(async (req, res) => {
  const cur = await db.get('SELECT * FROM ingredients WHERE id=?', req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบวัตถุดิบ' });
  const b = { ...cur, ...req.body };
  await db.run(`UPDATE ingredients SET name=?,unit=?,min_qty=?,cost_per_unit=?,supplier=?,is_active=?,
                updated_at=LOCALTIMESTAMP(0) WHERE id=?`,
    b.name, b.unit, Number(b.min_qty), Number(b.cost_per_unit), b.supplier || null,
    b.is_active ? 1 : 0, req.params.id);
  res.json(await db.get('SELECT * FROM ingredients WHERE id=?', req.params.id));
}));

// DELETE /api/stock/ingredients/:id
router.delete('/ingredients/:id', manager, wrap(async (req, res) => {
  const { c: used } = await db.get('SELECT COUNT(*) c FROM recipes WHERE ingredient_id=?', req.params.id);
  if (used > 0) {
    await db.run('UPDATE ingredients SET is_active=0 WHERE id=?', req.params.id);
    return res.json({ message: 'วัตถุดิบถูกใช้ในสูตรอยู่ จึงปิดใช้งานแทนการลบ' });
  }
  await db.run('DELETE FROM ingredients WHERE id=?', req.params.id);
  res.json({ message: 'ลบวัตถุดิบเรียบร้อย' });
}));

// POST /api/stock/movements : รับเข้า / ตัดออก / ปรับยอด / ของเสีย
router.post('/movements', auth, wrap(async (req, res) => {
  const { ingredient_id, type, qty, note, cost_per_unit } = req.body || {};
  if (!['in', 'out', 'adjust', 'waste'].includes(type)) {
    return res.status(400).json({ error: 'ประเภทการเคลื่อนไหวไม่ถูกต้อง' });
  }
  const ing = await db.get('SELECT * FROM ingredients WHERE id=?', ingredient_id);
  if (!ing) return res.status(404).json({ error: 'ไม่พบวัตถุดิบ' });

  const amount = Number(qty);
  if (!Number.isFinite(amount)) return res.status(400).json({ error: 'จำนวนไม่ถูกต้อง' });

  let delta, balanceAfter;
  if (type === 'adjust') {
    balanceAfter = round2(amount);            // adjust = ตั้งยอดคงเหลือใหม่
    delta = round2(balanceAfter - ing.stock_qty);
  } else {
    if (amount <= 0) return res.status(400).json({ error: 'จำนวนต้องมากกว่า 0' });
    delta = type === 'in' ? amount : -amount;
    balanceAfter = round2(ing.stock_qty + delta);
    if (balanceAfter < 0) return res.status(400).json({ error: `สต็อกไม่พอ คงเหลือ ${ing.stock_qty} ${ing.unit}` });
  }

  const unitCost = cost_per_unit != null ? Number(cost_per_unit) : ing.cost_per_unit;

  await tx(async (t) => {
    await t.run(`UPDATE ingredients SET stock_qty=?, cost_per_unit=?,
                 updated_at=LOCALTIMESTAMP(0) WHERE id=?`, balanceAfter, unitCost, ing.id);
    await t.run(`INSERT INTO stock_movements
      (ingredient_id,type,qty,balance_after,cost,ref_type,note,user_id)
      VALUES (?,?,?,?,?,'manual',?,?)`,
      ing.id, type, delta, balanceAfter, round2(Math.abs(delta) * unitCost),
      note || null, req.user.id);

    // รับเข้าถือเป็นค่าใช้จ่ายวัตถุดิบ
    if (type === 'in') {
      await t.run(`INSERT INTO expenses (category,title,amount,note,user_id)
                   VALUES ('วัตถุดิบ',?,?,?,?)`,
        `รับเข้า ${ing.name} ${amount} ${ing.unit}`, round2(amount * unitCost), note || null, req.user.id);
    }
  });

  res.status(201).json({
    message: 'บันทึกการเคลื่อนไหวสต็อกเรียบร้อย',
    ingredient: await db.get('SELECT * FROM ingredients WHERE id=?', ing.id),
  });
}));

async function nextCode() {
  const row = await db.get('SELECT code FROM ingredients ORDER BY id DESC LIMIT 1');
  const n = row ? parseInt(String(row.code).replace(/\D/g, ''), 10) + 1 : 1;
  return `ING-${String(n).padStart(3, '0')}`;
}

module.exports = router;
