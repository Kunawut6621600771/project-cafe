/**
 * เปิดเซิร์ฟเวอร์ในเครื่องให้ LINE เข้าถึงได้ผ่าน Cloudflare Quick Tunnel (ฟรี ไม่ต้องสมัคร)
 * แล้วตั้ง Webhook URL ของ LINE Bot ให้อัตโนมัติ
 *
 *   npm run line:tunnel
 *
 * ต้องติดตั้ง cloudflared ก่อน : winget install Cloudflare.cloudflared
 * หมายเหตุ : URL ของ Quick Tunnel เปลี่ยนทุกครั้งที่รัน — สคริปต์นี้ตั้งค่าใหม่ให้ทุกครั้ง
 *           ตอนใช้งานจริงควร deploy ขึ้นโดเมนถาวรแล้วตั้ง PUBLIC_URL ใน .env
 */
require('dotenv').config();
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const PORT = process.env.PORT || 3000;
const LINE_API = process.env.LINE_API_BASE || 'https://api.line.me';
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

function findCloudflared() {
  const candidates = [
    process.env.CLOUDFLARED_PATH,
    String.raw`C:\Program Files (x86)\cloudflared\cloudflared.exe`,
    String.raw`C:\Program Files\cloudflared\cloudflared.exe`,
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || 'cloudflared';
}

async function lineApi(method, path, body) {
  const res = await fetch(LINE_API + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`LINE API ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** รอจน URL ของ tunnel ใช้งานได้จริง (DNS ของ trycloudflare ใช้เวลาสักพัก) */
async function waitReachable(url) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return true;
    } catch { /* ยังไม่พร้อม */ }
    await sleep(1500);
  }
  return false;
}

async function setupLine(url) {
  const endpoint = `${url}/api/line/webhook`;
  console.log(`\n🌐 URL สาธารณะ : ${url}`);
  process.stdout.write('⏳ รอให้ tunnel พร้อม...');
  if (!(await waitReachable(url))) {
    console.log('\n❌ เข้าถึง tunnel ไม่ได้ — ตรวจว่าเซิร์ฟเวอร์ (npm start) เปิดอยู่ที่พอร์ต', PORT);
    return;
  }
  console.log(' พร้อมแล้ว');

  if (!TOKEN) {
    console.log('⚠️  ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN ใน .env — ตั้ง Webhook URL เองเป็น:\n   ' + endpoint);
    return;
  }
  try {
    await lineApi('PUT', '/v2/bot/channel/webhook/endpoint', { endpoint });
    console.log(`✅ ตั้ง Webhook URL ของ LINE แล้ว : ${endpoint}`);
    const info = await lineApi('GET', '/v2/bot/channel/webhook/endpoint');
    const test = await lineApi('POST', '/v2/bot/channel/webhook/test', { endpoint });
    console.log(test.success
      ? '✅ LINE ทดสอบส่ง webhook มาที่เซิร์ฟเวอร์สำเร็จ'
      : `❌ LINE ทดสอบ webhook ไม่ผ่าน : ${test.statusCode || ''} ${test.reason || ''} ${test.detail || ''}`);
    if (!info.active) {
      console.log('\n⚠️  ยังไม่ได้เปิด "Use webhook" — ไปที่ LINE Developers Console → Messaging API → เปิด Use webhook');
    }
    console.log('\n📌 อย่าลืม : LINE Official Account Manager → ตั้งค่า → การตอบกลับ → ปิด "ข้อความตอบกลับอัตโนมัติ"');
    console.log('   ไม่งั้นลูกค้าจะได้ข้อความ "บัญชีนี้ไม่สามารถตอบข้อความได้" ซ้อนมาด้วย');
    console.log('\n🟢 พร้อมใช้งาน — เปิดหน้าต่างนี้ทิ้งไว้ (กด Ctrl+C เพื่อปิด tunnel)\n');
  } catch (e) {
    console.log('❌ ตั้งค่า LINE ไม่สำเร็จ :', e.message);
  }
}

function main() {
  const bin = findCloudflared();
  console.log(`🚇 เปิด Cloudflare Tunnel → http://localhost:${PORT}`);
  const cf = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`]);
  let found = false;
  const onData = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !found) {
      found = true;
      setupLine(m[0]);
    }
  };
  cf.stdout.on('data', onData);
  cf.stderr.on('data', onData);
  cf.on('error', (e) => {
    console.error('❌ เรียก cloudflared ไม่ได้ :', e.message);
    console.error('   ติดตั้งด้วย : winget install Cloudflare.cloudflared  (หรือตั้ง CLOUDFLARED_PATH ใน .env)');
    process.exit(1);
  });
  cf.on('exit', (code) => { console.log(`tunnel ปิดแล้ว (code ${code})`); process.exit(code || 0); });
  process.on('SIGINT', () => cf.kill());
}

main();
