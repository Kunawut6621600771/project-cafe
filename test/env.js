/**
 * ตั้งค่า environment สำหรับเทสต์ — ต้อง require ไฟล์นี้ก่อนโมดูลอื่นของ backend
 * ใช้ฐานข้อมูลแยก (<ชื่อเดิม>_test) เพื่อไม่ให้เทสต์ไปแตะข้อมูลจริงของร้าน
 */
require('dotenv').config({ quiet: true });

const base = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/espresso_flow';
const url = new URL(base);
if (!url.pathname.endsWith('_test')) url.pathname += '_test';
process.env.DATABASE_URL = url.toString();

// ปิดการเชื่อมต่อภายนอกทั้งหมด (เทสต์จะตั้งค่าเองเมื่อต้องการ)
process.env.LINE_CHANNEL_SECRET = '';
process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
process.env.SLIP_PROVIDER = '';
process.env.CORS_ORIGIN = '';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
