/** ล้างตารางทั้งหมดแล้วสร้าง schema เปล่าใหม่ : npm run reset */
require('dotenv').config();
const { dropSchema, initSchema, closeDb, DB_LABEL } = require('./db');

(async () => {
  console.log(`กำลังล้างฐานข้อมูล ${DB_LABEL} ...`);
  await dropSchema();
  console.log('✓ ลบตารางทั้งหมดแล้ว');
  await initSchema();
  console.log('✓ สร้างตารางเปล่าใหม่แล้ว');
  await closeDb();
})().catch((e) => {
  console.error('❌ reset ล้มเหลว:', e.message);
  process.exit(1);
});
