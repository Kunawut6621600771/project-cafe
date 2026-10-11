/**
 * การเชื่อมต่อฐานข้อมูล PostgreSQL
 *
 * เขียน SQL ด้วย placeholder `?` ได้เหมือนเดิม โมดูลนี้จะแปลงเป็น $1,$2,... ให้เอง
 *   await db.all('SELECT * FROM products WHERE category_id=?', 3)
 *   await db.get('SELECT * FROM users WHERE id=?', 1)
 *   await db.run('UPDATE users SET phone=? WHERE id=?', '0812345678', 1)
 *   const id = await db.insert('INSERT INTO categories (name) VALUES (?)', 'ชา')
 *   await tx(async (t) => { await t.run(...); await t.insert(...); })
 */
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// ---- ปรับชนิดข้อมูลที่ pg ส่งกลับ ให้เข้ากับโค้ดเดิม/ฝั่ง frontend ----
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));   // int8 (COUNT/SUM) → number
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));   // numeric (ROUND) → number
types.setTypeParser(1114, (v) => v);                                     // timestamp → 'YYYY-MM-DD HH:MM:SS'
types.setTypeParser(1082, (v) => v);                                     // date      → 'YYYY-MM-DD'

const TIMEZONE = process.env.DB_TIMEZONE || 'Asia/Bangkok';

const baseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'espresso_flow',
    };

const pool = new Pool({
  ...baseConfig,
  // ตั้ง timezone ตั้งแต่ตอนเปิด connection → LOCALTIMESTAMP / CURRENT_DATE เป็นเวลาไทย
  options: `-c timezone=${TIMEZONE}`,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PGPOOL_MAX || 10),
});

pool.on('error', (err) => console.error('[PG POOL ERROR]', err.message));

/** ข้อความอธิบายปลายทางที่ต่ออยู่ (ใช้โชว์ตอนบูต / health check) */
const DB_LABEL = process.env.DATABASE_URL
  ? String(process.env.DATABASE_URL).replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')
  : `postgres://${baseConfig.user}@${baseConfig.host}:${baseConfig.port}/${baseConfig.database}`;

/** แปลง ? → $1,$2,... */
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** รับได้ทั้ง (sql, a, b, c) และ (sql, [a,b,c]) */
function norm(params) {
  return params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
}

function makeApi(runner) {
  const exec = (sql, ...params) => runner(toPg(sql), norm(params));
  return {
    query: exec,
    /** คืนทุกแถว */
    all: async (sql, ...params) => (await exec(sql, ...params)).rows,
    /** คืนแถวแรก (undefined ถ้าไม่มี) */
    get: async (sql, ...params) => (await exec(sql, ...params)).rows[0],
    /** สำหรับ INSERT/UPDATE/DELETE → { rowCount, rows } */
    run: async (sql, ...params) => {
      const r = await exec(sql, ...params);
      return { rowCount: r.rowCount, rows: r.rows };
    },
    /** INSERT แล้วคืนค่า id ที่เพิ่งสร้าง (แทน lastInsertRowid ของ SQLite) */
    insert: async (sql, ...params) => {
      const r = await runner(`${toPg(sql)} RETURNING id`, norm(params));
      return r.rows[0].id;
    },
  };
}

const db = { ...makeApi((text, values) => pool.query(text, values)), pool };

/**
 * รันหลายคำสั่งใน transaction เดียว
 *   await tx(async (t) => { const id = await t.insert(...); await t.run(...); return id; })
 */
async function tx(fn) {
  const client = await pool.connect();
  const t = makeApi((text, values) => client.query(text, values));
  try {
    await client.query('BEGIN');
    const result = await fn(t);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/** สร้างตารางทั้งหมดจาก schema.sql (idempotent) */
async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

/** ลบข้อมูลทุกตาราง (ใช้โดย reset.js) */
async function dropSchema() {
  await pool.query(`
    DROP VIEW  IF EXISTS v_product_sales, v_daily_sales CASCADE;
    DROP TABLE IF EXISTS payment_slips, order_items, orders, point_transactions, members,
                         stock_movements, recipes, ingredients,
                         product_option_groups, options, option_groups,
                         products, categories, promotions, shifts,
                         expenses, settings, users CASCADE;
  `);
}

async function closeDb() {
  await pool.end();
}

module.exports = { db, tx, initSchema, dropSchema, closeDb, pool, DB_LABEL, TIMEZONE };
