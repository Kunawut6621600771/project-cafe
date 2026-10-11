/**
 * ฟังก์ชันช่วยเหลือทั่วไป
 * หมายเหตุ : ฟังก์ชันที่แตะฐานข้อมูลเป็น async ทั้งหมด (PostgreSQL)
 */
const { db } = require('../database/db');

/** ครอบ route handler ให้ error ตกไปที่ error middleware */
const wrap = (fn) => (req, res, next) => {
  try {
    Promise.resolve(fn(req, res, next)).catch(next);
  } catch (e) {
    next(e);
  }
};

/** อ่านค่า setting */
async function getSetting(key, def = null) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : def;
}

/** เขียนค่า setting (รับ tx client มาได้ ถ้าต้องอยู่ใน transaction) */
async function setSetting(key, value, conn = db) {
  await conn.run(
    `INSERT INTO settings (key,value,updated_at) VALUES (?,?,LOCALTIMESTAMP(0))
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`,
    key, String(value)
  );
}

/** สร้างเลขที่ออเดอร์ ORD20250826-0007 */
async function nextOrderNo(conn = db) {
  const row = await conn.get(`
    SELECT to_char(LOCALTIMESTAMP,'YYYYMMDD') AS d,
           (SELECT COUNT(*) FROM orders WHERE created_at::date = CURRENT_DATE) AS c`);
  return `ORD${row.d}-${String(Number(row.c) + 1).padStart(4, '0')}`;
}

/** สร้างรหัสสมาชิกถัดไป MB-0009 */
async function nextMemberCode(conn = db) {
  const row = await conn.get('SELECT code FROM members ORDER BY id DESC LIMIT 1');
  const n = row ? Number.parseInt(String(row.code).replace(/\D/g, ''), 10) + 1 : 1;
  return `MB-${String(n).padStart(4, '0')}`;
}

/** คำนวณระดับสมาชิกจากยอดสะสม */
async function calcTier(totalSpent) {
  const gold = Number(await getSetting('tier_gold_spend', 5000));
  const plat = Number(await getSetting('tier_platinum_spend', 20000));
  if (totalSpent >= plat) return 'platinum';
  if (totalSpent >= gold) return 'gold';
  return 'silver';
}

/** วันที่ (YYYY-MM-DD) เลื่อนจากวันนี้ตามเวลาของฐานข้อมูล */
async function dbDateShift(days) {
  const row = await db.get("SELECT (CURRENT_DATE + (? || ' day')::interval)::date AS v", String(days));
  return row.v;
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

module.exports = {
  wrap, getSetting, setSetting, nextOrderNo, nextMemberCode, calcTier, dbDateShift, round2,
};
