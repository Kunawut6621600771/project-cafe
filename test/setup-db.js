/** ล้างฐานข้อมูลเทสต์แล้วใส่ข้อมูลตั้งต้นใหม่ (รันก่อน node --test ทุกครั้ง) */
require('./env');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { dropSchema, closeDb } = require('../backend/database/db');

(async () => {
  await dropSchema();
  await closeDb();
  // seed สร้าง schema + เมนู + บัญชีทดลอง (รันแยก process ด้วย env ของฐานข้อมูลเทสต์)
  execFileSync(process.execPath, [path.join(__dirname, '..', 'backend', 'database', 'seed.js')],
    { env: process.env, stdio: 'inherit' });
})().catch((e) => {
  console.error('❌ เตรียมฐานข้อมูลเทสต์ไม่สำเร็จ:', e.message);
  process.exit(1);
});
