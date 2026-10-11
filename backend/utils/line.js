/**
 * LINE Messaging API : ตรวจลายเซ็น webhook, ตอบกลับ, ส่งข้อความหาลูกค้า
 *
 * ตั้งค่าใน .env (ได้จาก LINE Developers Console → Messaging API channel)
 *   LINE_CHANNEL_SECRET=...
 *   LINE_CHANNEL_ACCESS_TOKEN=...
 */
const crypto = require('crypto');

// เปลี่ยนได้เพื่อทดสอบกับเซิร์ฟเวอร์จำลอง
const API = process.env.LINE_API_BASE || 'https://api.line.me';

const configured = () => !!(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN);

/** ตรวจ header x-line-signature = base64(HMAC-SHA256(channel secret, raw body)) */
function verifySignature(rawBody, signature) {
  if (!rawBody || !signature || !process.env.LINE_CHANNEL_SECRET) return false;
  const expected = crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(rawBody).digest();
  const got = Buffer.from(String(signature), 'base64');
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!res.ok) throw new Error(`LINE API ${res.status}: ${data.message || text}`);
  return data;
}

const reply = (replyToken, messages) =>
  call('POST', '/v2/bot/message/reply', { replyToken, messages: [].concat(messages) });

const push = (to, messages) =>
  call('POST', '/v2/bot/message/push', { to, messages: [].concat(messages) });

/** ข้อมูลบอท (basicId ใช้สร้างลิงก์เปิดแชท) — เก็บไว้ในหน่วยความจำ */
let botInfo = null;
async function getBotInfo() {
  if (!configured()) return null;
  if (!botInfo) botInfo = await call('GET', '/v2/bot/info');
  return botInfo;
}

/** ลิงก์เปิดแชทกับบอทพร้อมพิมพ์ข้อความไว้ให้ */
function chatLink(basicId, text) {
  return `https://line.me/R/oaMessage/${encodeURIComponent(basicId)}/?${encodeURIComponent(text)}`;
}

module.exports = { configured, verifySignature, reply, push, getBotInfo, chatLink };
