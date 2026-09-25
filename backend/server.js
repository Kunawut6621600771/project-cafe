/**
 * Espresso Flow - ระบบจัดการร้านกาแฟ
 * Backend Server (Express + PostgreSQL)
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initSchema, db, DB_LABEL, TIMEZONE } = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

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
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(FRONTEND, 'index.html')));

// ---------------- Error handler ----------------
app.use((req, res) => res.status(404).json({ error: 'ไม่พบ endpoint นี้' }));
app.use((err, req, res, next) => {
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
(async () => {
  try {
    await initSchema();
  } catch (e) {
    console.error('\n❌ เชื่อมต่อ PostgreSQL ไม่สำเร็จ:', e.message);
    console.error('   ตรวจสอบว่า PostgreSQL ทำงานอยู่ และตั้งค่า DATABASE_URL / PG* ในไฟล์ .env แล้ว\n');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log('\n☕  Espresso Flow — ระบบจัดการร้านกาแฟ');
    console.log(`    เซิร์ฟเวอร์: http://localhost:${PORT}`);
    console.log(`    ฐานข้อมูล : ${DB_LABEL}  (timezone ${TIMEZONE})`);
    console.log('    บัญชีทดสอบ: admin / admin123\n');
  });
})();
