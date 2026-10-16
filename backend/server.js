/**
 * Espresso Flow - ระบบจัดการร้านกาแฟ
 * Backend Server (Express + PostgreSQL)
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { initSchema, db, DB_LABEL, TIMEZONE } = require('./database/db');
const { loadPublicUrl, publicUrl } = require('./utils/order-events');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');             // ไม่บอกเวอร์ชัน/เฟรมเวิร์กของเซิร์ฟเวอร์
// หน้าเว็บเสิร์ฟจากเซิร์ฟเวอร์นี้เอง (same-origin) จึงไม่เปิด CORS เว้นแต่ตั้ง CORS_ORIGIN (คั่นด้วย ,)
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : false }));
app.use(express.json({
  limit: '8mb',                          // รูปสลิปส่งมาเป็น base64
  // เก็บ body ดิบไว้ตรวจลายเซ็น webhook ของ LINE
  verify: (req, res, buf) => { if (req.originalUrl.startsWith('/api/line/webhook')) req.rawBody = buf; },
}));

// log แบบสั้น
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      console.log(`${new Date().toLocaleTimeString('th-TH')}  ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - t}ms)`);
    }
  });
  next();
});

// ---------------- API ----------------
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/products'));      // /categories /products /options
app.use('/api/orders', require('./routes/orders'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/members', require('./routes/members'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/payments', require('./routes/payments'));  // QR พร้อมเพย์ + ตรวจสลิป
app.use('/api/line', require('./routes/line'));          // LINE Bot แจ้งสถานะออเดอร์
app.use('/api/track', require('./routes/track'));        // ลูกค้าติดตามออเดอร์แบบเรียลไทม์ (สาธารณะ)
app.use('/api', require('./routes/settings'));      // /settings /users /promotions /expenses /shifts

app.get('/api/health', async (req, res, next) => {
  try {
    const { c } = await db.get('SELECT COUNT(*) c FROM products');
    res.json({
      status: 'ok',
      service: 'Espresso Flow API',
      database: DB_LABEL,
      timezone: TIMEZONE,
      products: c,
      time: new Date().toLocaleString('th-TH'),
    });
  } catch (e) {
    next(e);
  }
});

// ---------------- Frontend ----------------
const FRONTEND = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND));
// ไลบรารีอ่าน QR บนรูปสลิป (ใช้ฝั่งเบราว์เซอร์)
app.get('/vendor/jsQR.js', (req, res) => res.sendFile(require.resolve('jsqr/dist/jsQR.js')));
// หน้าติดตามออเดอร์ของลูกค้า (เปิดจากลิงก์ใน LINE)
app.get('/track/:orderNo', (req, res) => res.sendFile(path.join(FRONTEND, 'track.html')));
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(FRONTEND, 'index.html')));

// ---------------- Error handler ----------------
app.use((req, res) => res.status(404).json({ error: 'ไม่พบ endpoint นี้' }));
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'ไฟล์ใหญ่เกินไป' });
  console.error('[ERROR]', err.message);
  if (err.code === '23505') {               // unique_violation ของ PostgreSQL
    return res.status(400).json({ error: 'ข้อมูลซ้ำกับที่มีอยู่ในระบบ' });
  }
  if (err.code === '23503') {               // foreign_key_violation
    return res.status(400).json({ error: 'ข้อมูลนี้ถูกอ้างอิงอยู่ ไม่สามารถดำเนินการได้' });
  }
  res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ: ' + err.message });
});

// เตรียมฐานข้อมูลก่อนเปิดพอร์ต
async function start() {
  try {
    await initSchema();
    await loadPublicUrl();   // URL สาธารณะ (tunnel / โดเมน) ที่จำไว้ ใช้สร้างลิงก์ติดตามออเดอร์
  } catch (e) {
    console.error('\n❌ เชื่อมต่อ PostgreSQL ไม่สำเร็จ:', e.message);
    console.error('   ตรวจสอบว่า PostgreSQL ทำงานอยู่ และตั้งค่า DATABASE_URL / PG* ในไฟล์ .env แล้ว\n');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log('\n🧋  ผู้ชายขายน้ำ — ระบบจัดการร้าน (Espresso Flow)');
    console.log(`    เซิร์ฟเวอร์: http://localhost:${PORT}`);
    console.log(`    ฐานข้อมูล : ${DB_LABEL}  (timezone ${TIMEZONE})`);
    if (publicUrl()) console.log(`    URL สาธารณะ: ${publicUrl()}  (ลูกค้าเปิดลิงก์ติดตามออเดอร์ได้)`);
    console.log('    บัญชีทดสอบ: admin / admin123\n');
  });
}

// รันตรง (npm start) → เปิดเซิร์ฟเวอร์ / ถูก require จากเทสต์ → ส่ง app ออกไปใช้กับพอร์ตสุ่ม
if (require.main === module) start();

module.exports = app;
