/**
 * กระจายเหตุการณ์ "สถานะออเดอร์เปลี่ยน" ภายในเซิร์ฟเวอร์
 * ใช้ส่งต่อให้หน้าเว็บติดตามออเดอร์ (SSE) และแจ้งเตือนทาง LINE
 *
 * หมายเหตุ : เก็บในหน่วยความจำของโปรเซสเดียว ถ้ารันหลายโปรเซสต้องเปลี่ยนเป็น
 * PostgreSQL LISTEN/NOTIFY หรือ Redis pub/sub
 */
const { EventEmitter } = require('node:events');

const bus = new EventEmitter();
bus.setMaxListeners(0);   // ผู้ติดตามหนึ่งคน = หนึ่ง listener

/** แจ้งว่าออเดอร์ id นี้มีการเปลี่ยนแปลง */
const emitOrderChanged = (orderId) => bus.emit('order', Number(orderId));

/** ติดตามการเปลี่ยนแปลงของออเดอร์ id เดียว → คืนฟังก์ชันยกเลิกการติดตาม */
function onOrderChanged(orderId, fn) {
  const id = Number(orderId);
  const h = (changed) => { if (changed === id) fn(); };
  bus.on('order', h);
  return () => bus.off('order', h);
}

// ---------------------------------------------------------------
// URL สาธารณะของร้าน (ใช้สร้างลิงก์ติดตามออเดอร์ที่ลูกค้าเปิดจากมือถือได้)
//   1. PUBLIC_URL ใน .env (เช่นโดเมนจริงตอน deploy)
//   2. ถ้าไม่ตั้ง → จำจาก webhook ของ LINE ที่วิ่งเข้ามาล่าสุด (เช่นผ่าน Cloudflare Tunnel)
//      และบันทึกลงตาราง settings (public_url) ไว้ด้วย รีสตาร์ทเซิร์ฟเวอร์แล้วไม่หาย
// ---------------------------------------------------------------
let learnedUrl = null;

function rememberPublicUrl(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  const host = req.get('x-forwarded-host') || req.get('host');
  if (proto !== 'https' || !host) return;
  const url = `https://${host}`;
  if (url === learnedUrl) return;
  learnedUrl = url;
  // require ตอนใช้งาน : กันโหลดวนกันระหว่าง helpers ↔ db ตอนเริ่มเซิร์ฟเวอร์
  require('./helpers').setSetting('public_url', url)
    .catch((e) => console.error('[public_url] บันทึกไม่สำเร็จ:', e.message));
}

/** โหลด URL สาธารณะที่จำไว้ (เรียกตอนเปิดเซิร์ฟเวอร์) */
async function loadPublicUrl() {
  const saved = await require('./helpers').getSetting('public_url', '');
  if (saved && saved.startsWith('https://')) learnedUrl = saved;
  return learnedUrl;
}

/** URL สาธารณะแบบ https (LINE รับลิงก์ปุ่มเฉพาะ https) หรือ null ถ้ายังไม่รู้ */
function publicUrl() {
  const env = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (env.startsWith('https://')) return env;
  return learnedUrl;
}

const resetPublicUrl = () => { learnedUrl = null; };

module.exports = { emitOrderChanged, onOrderChanged, rememberPublicUrl, publicUrl, resetPublicUrl, loadPublicUrl };
