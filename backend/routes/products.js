/**
 * /api/products, /api/categories, /api/options : จัดการเมนูสินค้า
 */
const router = require('express').Router();
const { db, tx } = require('../database/db');
const { auth, requireRole } = require('../middleware/auth');
const { wrap } = require('../utils/helpers');

const manager = [auth, requireRole('owner', 'manager')];

// ---------------- หมวดหมู่ ----------------
router.get('/categories', auth, wrap(async (req, res) => {
  const rows = await db.all(`
    SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
    FROM categories c ORDER BY c.sort_order, c.id`);
  res.json(rows);
}));

router.post('/categories', manager, wrap(async (req, res) => {
  const { name, icon = '☕', sort_order = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อหมวดหมู่' });
  const id = await db.insert('INSERT INTO categories (name,icon,sort_order) VALUES (?,?,?)',
    name, icon, sort_order);
  res.status(201).json(await db.get('SELECT * FROM categories WHERE id=?', id));
}));

router.put('/categories/:id', manager, wrap(async (req, res) => {
  const cur = await db.get('SELECT * FROM categories WHERE id=?', req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบหมวดหมู่' });
  const { name = cur.name, icon = cur.icon, sort_order = cur.sort_order, is_active = cur.is_active } = req.body || {};
  await db.run('UPDATE categories SET name=?,icon=?,sort_order=?,is_active=? WHERE id=?',
    name, icon, sort_order, is_active ? 1 : 0, req.params.id);
  res.json(await db.get('SELECT * FROM categories WHERE id=?', req.params.id));
}));

router.delete('/categories/:id', manager, wrap(async (req, res) => {
  const { c: used } = await db.get('SELECT COUNT(*) c FROM products WHERE category_id=?', req.params.id);
  if (used > 0) return res.status(400).json({ error: `ลบไม่ได้ มีสินค้า ${used} รายการอยู่ในหมวดนี้` });
  await db.run('DELETE FROM categories WHERE id=?', req.params.id);
  res.json({ message: 'ลบหมวดหมู่เรียบร้อย' });
}));

// ---------------- กลุ่มตัวเลือก ----------------
router.get('/options', auth, wrap(async (req, res) => {
  const groups = await db.all('SELECT * FROM option_groups ORDER BY sort_order, id');
  const opts = await db.all('SELECT * FROM options ORDER BY sort_order, id');
  res.json(groups.map((g) => ({ ...g, options: opts.filter((o) => o.group_id === g.id) })));
}));

// ---------------- สินค้า ----------------
router.get('/products', auth, wrap(async (req, res) => {
  const { category_id, q, available } = req.query;
  const where = [], args = [];
  if (category_id) { where.push('p.category_id = ?'); args.push(Number(category_id)); }
  if (available === '1') where.push('p.is_available = 1');
  if (q) { where.push('(p.name ILIKE ? OR p.sku ILIKE ?)'); args.push(`%${q}%`, `%${q}%`); }

  const products = await db.all(`
    SELECT p.*, c.name AS category_name, c.icon AS category_icon
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.sort_order, p.id`, args);

  // แนบกลุ่มตัวเลือกของแต่ละสินค้า
  const links = await db.all('SELECT * FROM product_option_groups');
  const groups = await db.all('SELECT * FROM option_groups ORDER BY sort_order');
  const opts = await db.all('SELECT * FROM options ORDER BY sort_order, id');

  res.json(products.map((p) => ({
    ...p,
    option_groups: links.filter((l) => l.product_id === p.id).map((l) => {
      const g = groups.find((x) => x.id === l.group_id);
      return g ? { ...g, options: opts.filter((o) => o.group_id === g.id) } : null;
    }).filter(Boolean),
  })));
}));

router.get('/products/:id', auth, wrap(async (req, res) => {
  const p = await db.get(`SELECT p.*, c.name AS category_name FROM products p
                          LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?`, req.params.id);
  if (!p) return res.status(404).json({ error: 'ไม่พบสินค้า' });
  p.recipe = await db.all(`SELECT r.*, i.name, i.unit, i.stock_qty, i.cost_per_unit
                           FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id
                           WHERE r.product_id=?`, p.id);
  p.option_group_ids = (await db.all('SELECT group_id FROM product_option_groups WHERE product_id=?', p.id))
    .map((r) => r.group_id);
  res.json(p);
}));

router.post('/products', manager, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || b.price == null) return res.status(400).json({ error: 'กรุณาระบุชื่อสินค้าและราคา' });
  const id = await db.insert(`INSERT INTO products
      (category_id,sku,name,description,price,cost,image,is_available,is_recommended,sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
    b.category_id || null, b.sku || null, b.name, b.description || null,
    Number(b.price), Number(b.cost || 0), b.image || '☕',
    b.is_available === 0 ? 0 : 1, b.is_recommended ? 1 : 0, Number(b.sort_order || 0));
  await saveRecipe(id, b.recipe);
  await saveOptionGroups(id, b.option_group_ids);
  res.status(201).json(await db.get('SELECT * FROM products WHERE id=?', id));
}));

router.put('/products/:id', manager, wrap(async (req, res) => {
  const cur = await db.get('SELECT * FROM products WHERE id=?', req.params.id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบสินค้า' });
  const b = { ...cur, ...req.body };
  await db.run(`UPDATE products SET category_id=?,sku=?,name=?,description=?,price=?,cost=?,
                image=?,is_available=?,is_recommended=?,sort_order=? WHERE id=?`,
    b.category_id || null, b.sku || null, b.name, b.description || null,
    Number(b.price), Number(b.cost || 0), b.image, b.is_available ? 1 : 0,
    b.is_recommended ? 1 : 0, Number(b.sort_order || 0), req.params.id);
  if (req.body.recipe) await saveRecipe(req.params.id, req.body.recipe);
  if (req.body.option_group_ids) await saveOptionGroups(req.params.id, req.body.option_group_ids);
  res.json(await db.get('SELECT * FROM products WHERE id=?', req.params.id));
}));

// เปิด/ปิดการขายอย่างเร็ว
router.patch('/products/:id/availability', auth, wrap(async (req, res) => {
  const p = await db.get('SELECT * FROM products WHERE id=?', req.params.id);
  if (!p) return res.status(404).json({ error: 'ไม่พบสินค้า' });
  const next = p.is_available ? 0 : 1;
  await db.run('UPDATE products SET is_available=? WHERE id=?', next, p.id);
  res.json({ id: p.id, is_available: next });
}));

router.delete('/products/:id', manager, wrap(async (req, res) => {
  const { c: sold } = await db.get('SELECT COUNT(*) c FROM order_items WHERE product_id=?', req.params.id);
  if (sold > 0) {
    await db.run('UPDATE products SET is_available=0 WHERE id=?', req.params.id);
    return res.json({ message: 'สินค้ามีประวัติการขาย จึงปิดการขายแทนการลบ' });
  }
  await db.run('DELETE FROM products WHERE id=?', req.params.id);
  res.json({ message: 'ลบสินค้าเรียบร้อย' });
}));

async function saveRecipe(productId, recipe) {
  if (!Array.isArray(recipe)) return;
  await tx(async (t) => {
    await t.run('DELETE FROM recipes WHERE product_id=?', productId);
    for (const r of recipe.filter((x) => x.ingredient_id && Number(x.qty) > 0)) {
      await t.run('INSERT INTO recipes (product_id,ingredient_id,qty) VALUES (?,?,?)',
        productId, r.ingredient_id, Number(r.qty));
    }
  });
}

async function saveOptionGroups(productId, ids) {
  if (!Array.isArray(ids)) return;
  await tx(async (t) => {
    await t.run('DELETE FROM product_option_groups WHERE product_id=?', productId);
    for (const g of ids) {
      await t.run(`INSERT INTO product_option_groups (product_id,group_id) VALUES (?,?)
                   ON CONFLICT DO NOTHING`, productId, g);
    }
  });
}

module.exports = router;
