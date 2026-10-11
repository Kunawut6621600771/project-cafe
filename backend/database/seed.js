/**
 * ใส่ข้อมูลตั้งต้น : เมนู 80 รายการพร้อมรูป, หมวดหมู่, ตัวเลือก, บัญชีทดลอง, ค่าตั้งต้นของร้าน
 *   npm run seed
 * รันซ้ำได้ — อัปเดตเมนูตาม sku เดิม ไม่ลบข้อมูลที่ร้านเพิ่มเอง และไม่ทับค่าตั้งค่าที่แก้ไว้แล้ว
 */
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const { db, tx, initSchema, closeDb, DB_LABEL } = require('./db');
const { categories, optionGroups, products } = require('./menu-data');

const DEMO_USERS = [
  ['admin', 'admin123', 'เจ้าของร้าน', 'owner'],
  ['manager', 'manager123', 'ผู้จัดการร้าน', 'manager'],
  ['staff01', 'staff123', 'พนักงานหน้าร้าน', 'staff'],
];

const DEFAULT_SETTINGS = {
  shop_name: 'Espresso Flow',
  shop_branch: 'สาขาหลัก',
  receipt_footer: 'ขอบคุณที่ใช้บริการ แล้วพบกันใหม่ ☕',
  points_per_baht: '0.05',
  point_redeem_rate: '1',
  tier_gold_spend: '5000',
  tier_platinum_spend: '20000',
  promptpay_id: '',
  promptpay_name: '',
  require_slip: '1',
  use_queue: '1',
};

(async () => {
  console.log(`กำลังใส่ข้อมูลตั้งต้นลง ${DB_LABEL} ...`);
  await initSchema();

  await tx(async (t) => {
    for (const [username, pw, name, role] of DEMO_USERS) {
      await t.run(`INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)
                   ON CONFLICT (username) DO NOTHING`, username, bcrypt.hashSync(pw, 10), name, role);
    }
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      await t.run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO NOTHING', k, v);
    }

    // ---- หมวดหมู่ ----
    const catId = {};
    for (const [i, c] of categories.entries()) {
      const row = await t.get(`INSERT INTO categories (name,icon,sort_order) VALUES (?,?,?)
        ON CONFLICT (name) DO UPDATE SET icon=EXCLUDED.icon, sort_order=EXCLUDED.sort_order
        RETURNING id`, c.name, c.icon, i + 1);
      catId[c.key] = row.id;
    }

    // ---- กลุ่มตัวเลือก (จับคู่ด้วยชื่อกลุ่ม) ----
    const groupId = {};
    for (const [i, g] of optionGroups.entries()) {
      let row = await t.get('SELECT id FROM option_groups WHERE name=?', g.name);
      if (!row) {
        const id = await t.insert(`INSERT INTO option_groups (name,select_type,is_required,sort_order)
          VALUES (?,?,?,?)`, g.name, g.select_type, g.is_required, i + 1);
        for (const [j, [name, delta, isDefault = 0]] of g.options.entries()) {
          await t.run(`INSERT INTO options (group_id,name,price_delta,is_default,sort_order)
            VALUES (?,?,?,?,?)`, id, name, delta, isDefault, j + 1);
        }
        row = { id };
      }
      groupId[g.key] = row.id;
    }

    // ---- สินค้า (upsert ด้วย sku) ----
    for (const p of products) {
      const row = await t.get(`INSERT INTO products
          (category_id,sku,name,description,price,cost,image,is_recommended,sort_order)
          VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT (sku) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name,
          description=EXCLUDED.description, image=EXCLUDED.image, sort_order=EXCLUDED.sort_order
        RETURNING id`,
        catId[p.category], p.sku, p.name, p.description, p.price, p.cost, p.image,
        p.is_recommended, p.sort_order);
      await t.run('DELETE FROM product_option_groups WHERE product_id=?', row.id);
      for (const g of p.groups) {
        await t.run('INSERT INTO product_option_groups (product_id,group_id) VALUES (?,?)', row.id, groupId[g]);
      }
    }
  });

  const { c } = await db.get('SELECT COUNT(*) c FROM products');
  console.log(`✓ หมวดหมู่ ${categories.length} · กลุ่มตัวเลือก ${optionGroups.length} · เมนูทั้งหมดในระบบ ${c} รายการ`);
  console.log(`✓ บัญชีทดลอง : ${DEMO_USERS.map((u) => `${u[0]}/${u[1]}`).join(', ')}`);
  await closeDb();
})().catch(async (e) => {
  console.error('❌ seed ล้มเหลว:', e.message);
  await closeDb().catch(() => {});
  process.exit(1);
});
