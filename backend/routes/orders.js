/**
 * /api/orders : ขายหน้าร้าน (POS), คิวออเดอร์, ประวัติการขาย
 */
const router = require('express').Router();
const { db, tx } = require('../database/db');
const { auth, requireRole } = require('../middleware/auth');
const { wrap, getSetting, nextOrderNo, calcTier, round2 } = require('../utils/helpers');

// ---------------------------------------------------------------
// GET /api/orders  : ประวัติออเดอร์ (มีตัวกรอง + แบ่งหน้า)
// ---------------------------------------------------------------
router.get('/', auth, wrap(async (req, res) => {
  const { status, order_type, payment_method, date_from, date_to, q } = req.query;
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, parseInt(req.query.limit || '20', 10));

  const where = [], args = [];
  if (status) { where.push('o.status = ?'); args.push(status); }
  if (order_type) { where.push('o.order_type = ?'); args.push(order_type); }
  if (payment_method) { where.push('o.payment_method = ?'); args.push(payment_method); }
  if (date_from) { where.push('o.created_at::date >= ?::date'); args.push(date_from); }
  if (date_to) { where.push('o.created_at::date <= ?::date'); args.push(date_to); }
  if (q) { where.push('(o.order_no ILIKE ? OR m.name ILIKE ? OR m.phone ILIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const W = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const { c: total } = await db.get(`SELECT COUNT(*) c FROM orders o
    LEFT JOIN members m ON m.id=o.member_id ${W}`, args);

  const rows = await db.all(`
    SELECT o.*, m.name AS member_name, m.phone AS member_phone, u.full_name AS cashier,
           (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS item_count,
           (SELECT string_agg(oi.product_name || ' x' || oi.qty, ', ')
              FROM order_items oi WHERE oi.order_id=o.id) AS items_summary
    FROM orders o
    LEFT JOIN members m ON m.id = o.member_id
    LEFT JOIN users   u ON u.id = o.user_id
    ${W}
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ? OFFSET ?`, [...args, limit, (page - 1) * limit]);

  res.json({ data: rows, page, limit, total, pages: Math.ceil(total / limit) || 1 });
}));

// ---------------------------------------------------------------
// GET /api/orders/queue : คิวที่ยังทำไม่เสร็จ (หน้าครัว)
// ---------------------------------------------------------------
router.get('/queue', auth, wrap(async (req, res) => {
  const rows = await db.all(`
    SELECT o.*, u.full_name AS cashier
    FROM orders o LEFT JOIN users u ON u.id=o.user_id
    WHERE o.status IN ('pending','preparing','ready')
    ORDER BY o.created_at ASC`);
  const items = await db.all(`SELECT * FROM order_items WHERE order_id IN
    (SELECT id FROM orders WHERE status IN ('pending','preparing','ready'))`);
  res.json(rows.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.id) })));
}));

// ---------------------------------------------------------------
// GET /api/orders/:id : รายละเอียด + ใบเสร็จ
// ---------------------------------------------------------------
router.get('/:id', auth, wrap(async (req, res) => {
  const o = await db.get(`
    SELECT o.*, m.name AS member_name, m.phone AS member_phone, m.code AS member_code,
           u.full_name AS cashier, pr.name AS promotion_name
    FROM orders o
    LEFT JOIN members m ON m.id=o.member_id
    LEFT JOIN users u   ON u.id=o.user_id
    LEFT JOIN promotions pr ON pr.id=o.promotion_id
    WHERE o.id = ?`, req.params.id);
  if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });
  o.items = await db.all('SELECT * FROM order_items WHERE order_id=?', o.id);
  o.shop = {
    name: await getSetting('shop_name', 'Espresso Flow'),
    branch: await getSetting('shop_branch', ''),
    address: await getSetting('shop_address', ''),
    phone: await getSetting('shop_phone', ''),
    tax_id: await getSetting('shop_tax_id', ''),
    footer: await getSetting('receipt_footer', 'ขอบคุณที่ใช้บริการ'),
  };
  res.json(o);
}));

// ---------------------------------------------------------------
// POST /api/orders : สร้างออเดอร์ + ตัดสต็อก + สะสมแต้ม
// ---------------------------------------------------------------
router.post('/', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: 'กรุณาเลือกสินค้าอย่างน้อย 1 รายการ' });

  // ---- คำนวณราคาฝั่งเซิร์ฟเวอร์ (ไม่เชื่อราคาจาก client) ----
  const lines = [];
  let subtotal = 0, costTotal = 0;
  for (const it of items) {
    const p = await db.get('SELECT * FROM products WHERE id=?', it.product_id);
    if (!p) return res.status(400).json({ error: `ไม่พบสินค้ารหัส ${it.product_id}` });
    if (!p.is_available) return res.status(400).json({ error: `"${p.name}" ปิดการขายอยู่` });

    const qty = Math.max(1, parseInt(it.qty || 1, 10));
    const chosen = [];
    for (const id of it.options || []) {
      const opt = await db.get('SELECT * FROM options WHERE id=?', id);
      if (opt) chosen.push(opt);
    }
    const optPrice = chosen.reduce((s, o) => s + Number(o.price_delta), 0);
    const lineTotal = round2((Number(p.price) + optPrice) * qty);

    subtotal += lineTotal;
    costTotal += Number(p.cost) * qty;
    lines.push({
      product: p, qty, optPrice, lineTotal,
      optionsText: chosen.map((o) => o.name).join(', '),
      optionsJson: JSON.stringify(chosen.map((o) => ({ id: o.id, name: o.name, price: o.price_delta }))),
      note: it.note || null,
    });
  }
  subtotal = round2(subtotal);

  // ---- ส่วนลด ----
  let discount = 0, promotionId = null;
  if (b.promotion_code) {
    const pr = await db.get('SELECT * FROM promotions WHERE code=? AND is_active=1', b.promotion_code);
    if (!pr) return res.status(400).json({ error: 'ไม่พบโค้ดส่วนลดนี้' });
    if (subtotal < pr.min_total) {
      return res.status(400).json({ error: `ต้องซื้อขั้นต่ำ ${pr.min_total} บาทจึงใช้โค้ดนี้ได้` });
    }
    discount = pr.type === 'percent' ? round2(subtotal * pr.value / 100) : Number(pr.value);
    promotionId = pr.id;
  } else if (b.discount) {
    discount = Math.min(round2(Number(b.discount)), subtotal);
  }

  // ---- ใช้แต้มแลกส่วนลด ----
  let pointsUsed = 0;
  const member = b.member_id ? await db.get('SELECT * FROM members WHERE id=?', b.member_id) : null;
  if (b.points_used && member) {
    const rate = Number(await getSetting('point_redeem_rate', 1));
    pointsUsed = Math.min(parseInt(b.points_used, 10), member.points);
    discount = round2(discount + pointsUsed * rate);
  }
  discount = Math.min(discount, subtotal);
  const total = round2(subtotal - discount);

  const payment = b.payment_method || 'cash';
  const received = payment === 'cash' ? round2(Number(b.received || total)) : total;
  if (payment === 'cash' && received < total) {
    return res.status(400).json({ error: 'จำนวนเงินที่รับมาน้อยกว่ายอดที่ต้องชำระ' });
  }
  const pointsEarned = member ? Math.floor(total * Number(await getSetting('points_per_baht', 0.05))) : 0;
  const status = b.status || 'completed';
  const tier = member ? await calcTier(round2(member.total_spent + total)) : null;

  // ---- บันทึกทั้งหมดใน transaction เดียว ----
  const orderId = await tx(async (t) => {
    const orderNo = await nextOrderNo(t);
    const shift = await t.get("SELECT id FROM shifts WHERE status='open' ORDER BY id DESC LIMIT 1");

    const oid = await t.insert(`INSERT INTO orders
      (order_no,order_type,table_no,member_id,user_id,shift_id,subtotal,discount,promotion_id,total,
       cost_total,payment_method,received,change_amount,points_earned,status,note,paid_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      orderNo, b.order_type || 'takeaway', b.table_no || null, member ? member.id : null,
      req.user.id, shift ? shift.id : null, subtotal, discount, promotionId, total,
      round2(costTotal), payment, received, round2(received - total), pointsEarned, status,
      b.note || null, status === 'completed' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null);

    for (const l of lines) {
      await t.run(`INSERT INTO order_items
        (order_id,product_id,product_name,qty,unit_price,options_price,options_text,options_json,unit_cost,line_total,note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        oid, l.product.id, l.product.name, l.qty, l.product.price,
        l.optPrice, l.optionsText, l.optionsJson, l.product.cost, l.lineTotal, l.note);
    }

    // ---- ตัดสต็อกตามสูตร ----
    const usage = new Map();
    for (const l of lines) {
      const rows = await t.all('SELECT * FROM recipes WHERE product_id=?', l.product.id);
      rows.forEach((r) => usage.set(r.ingredient_id, (usage.get(r.ingredient_id) || 0) + r.qty * l.qty));
    }
    for (const [ingId, used] of usage) {
      const ing = await t.get('SELECT * FROM ingredients WHERE id=?', ingId);
      if (!ing) continue;
      const after = round2(ing.stock_qty - used);
      await t.run(`UPDATE ingredients SET stock_qty = stock_qty - ?,
                   updated_at=LOCALTIMESTAMP(0) WHERE id=?`, used, ingId);
      await t.run(`INSERT INTO stock_movements
        (ingredient_id,type,qty,balance_after,cost,ref_type,ref_id,note,user_id)
        VALUES (?,'out',?,?,?,'order',?,?,?)`,
        ingId, -used, after, round2(used * ing.cost_per_unit), oid, `ขาย ${orderNo}`, req.user.id);
    }

    // ---- แต้มสมาชิก ----
    if (member) {
      let balance = member.points;
      if (pointsUsed > 0) {
        balance -= pointsUsed;
        await t.run(`INSERT INTO point_transactions (member_id,points,balance_after,reason,order_id)
                     VALUES (?,?,?,?,?)`, member.id, -pointsUsed, balance, 'แลกแต้มเป็นส่วนลด', oid);
      }
      if (pointsEarned > 0) {
        balance += pointsEarned;
        await t.run(`INSERT INTO point_transactions (member_id,points,balance_after,reason,order_id)
                     VALUES (?,?,?,?,?)`, member.id, pointsEarned, balance, `ซื้อสินค้า ${orderNo}`, oid);
      }
      await t.run(`UPDATE members SET points=?, total_spent=?, visits=visits+1,
                   last_visit=CURRENT_DATE, tier=? WHERE id=?`,
        balance, round2(member.total_spent + total), tier, member.id);
    }

    // ---- อัปเดตยอดกะ ----
    if (shift && status === 'completed') {
      await t.run('UPDATE shifts SET total_sales=total_sales+?, total_orders=total_orders+1 WHERE id=?',
        total, shift.id);
    }
    return oid;
  });

  const order = await db.get('SELECT * FROM orders WHERE id=?', orderId);
  order.items = await db.all('SELECT * FROM order_items WHERE order_id=?', orderId);
  res.status(201).json(order);
}));

// ---------------------------------------------------------------
// PATCH /api/orders/:id/status : เปลี่ยนสถานะออเดอร์
// ---------------------------------------------------------------
router.patch('/:id/status', auth, wrap(async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });

  const o = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });
  if (o.status === 'cancelled') return res.status(400).json({ error: 'ออเดอร์นี้ถูกยกเลิกไปแล้ว' });
  if (status === 'cancelled') return res.status(400).json({ error: 'กรุณาใช้เมนูยกเลิกออเดอร์' });

  await db.run(`UPDATE orders SET status=?, updated_at=LOCALTIMESTAMP(0),
                paid_at = CASE WHEN ?='completed' AND paid_at IS NULL
                          THEN LOCALTIMESTAMP(0) ELSE paid_at END WHERE id=?`,
    status, status, o.id);
  res.json(await db.get('SELECT * FROM orders WHERE id=?', o.id));
}));

// ---------------------------------------------------------------
// POST /api/orders/:id/cancel : ยกเลิก + คืนสต็อก + คืนแต้ม
// ---------------------------------------------------------------
router.post('/:id/cancel', auth, requireRole('owner', 'manager'), wrap(async (req, res) => {
  const o = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });
  if (o.status === 'cancelled') return res.status(400).json({ error: 'ออเดอร์นี้ถูกยกเลิกไปแล้ว' });

  // คำนวณ tier ใหม่นอก transaction (calcTier ต้องอ่านตาราง settings)
  const m0 = o.member_id ? await db.get('SELECT * FROM members WHERE id=?', o.member_id) : null;
  const newTier = m0 ? await calcTier(Math.max(0, round2(m0.total_spent - o.total))) : null;

  await tx(async (t) => {
    // คืนสต็อก
    const items = await t.all('SELECT * FROM order_items WHERE order_id=?', o.id);
    const usage = new Map();
    for (const it of items) {
      if (!it.product_id) continue;
      const rows = await t.all('SELECT * FROM recipes WHERE product_id=?', it.product_id);
      rows.forEach((r) => usage.set(r.ingredient_id, (usage.get(r.ingredient_id) || 0) + r.qty * it.qty));
    }
    for (const [ingId, qty] of usage) {
      const ing = await t.get('SELECT * FROM ingredients WHERE id=?', ingId);
      if (!ing) continue;
      const after = round2(ing.stock_qty + qty);
      await t.run('UPDATE ingredients SET stock_qty=?, updated_at=LOCALTIMESTAMP(0) WHERE id=?', after, ingId);
      await t.run(`INSERT INTO stock_movements
        (ingredient_id,type,qty,balance_after,cost,ref_type,ref_id,note,user_id)
        VALUES (?,'in',?,?,?,'order',?,?,?)`,
        ingId, qty, after, round2(qty * ing.cost_per_unit), o.id,
        `ยกเลิกออเดอร์ ${o.order_no}`, req.user.id);
    }

    // คืน/หักแต้มสมาชิก
    if (m0) {
      const balance = Math.max(0, m0.points - o.points_earned);
      const spent = Math.max(0, round2(m0.total_spent - o.total));
      await t.run('UPDATE members SET points=?, total_spent=?, visits=GREATEST(0,visits-1), tier=? WHERE id=?',
        balance, spent, newTier, m0.id);
      await t.run(`INSERT INTO point_transactions (member_id,points,balance_after,reason,order_id)
                   VALUES (?,?,?,?,?)`,
        m0.id, -o.points_earned, balance, `ยกเลิกออเดอร์ ${o.order_no}`, o.id);
    }

    if (o.shift_id && o.status === 'completed') {
      await t.run('UPDATE shifts SET total_sales=total_sales-?, total_orders=GREATEST(0,total_orders-1) WHERE id=?',
        o.total, o.shift_id);
    }

    await t.run(`UPDATE orders SET status='cancelled', note=COALESCE(note,'') || ?,
                 updated_at=LOCALTIMESTAMP(0) WHERE id=?`,
      ` [ยกเลิก: ${req.body?.reason || 'ไม่ระบุเหตุผล'}]`, o.id);
  });

  res.json({ message: 'ยกเลิกออเดอร์และคืนสต็อกเรียบร้อย' });
}));

module.exports = router;
