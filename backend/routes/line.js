/**
 * /api/line : LINE Bot แจ้งลูกค้าเมื่อเครื่องดื่มพร้อม
 *
 * ขั้นตอน
 *   1. ใบเสร็จแสดง QR → ลูกค้าสแกน → LINE เปิดแชทกับบอท พร้อมข้อความ "รับแจ้งเตือน ORD...-0003 รหัส K7Q2"
 *   2. ลูกค้ากดส่ง → webhook ผูก LINE userId กับออเดอร์
 *   3. พนักงานกด "พร้อมเสิร์ฟ" ในหน้าคิว → notifyReady() ส่งข้อความหาลูกค้า
 */
const crypto = require('node:crypto');
const router = require('express').Router();
const QRCode = require('qrcode');
const { db } = require('../database/db');
const { auth } = require('../middleware/auth');
const { wrap, getSetting } = require('../utils/helpers');
const line = require('../utils/line');

const queueNo = (orderNo) => `#${String(orderNo).split('-').pop()}`;

// ---------------------------------------------------------------
// ข้อความ
// ---------------------------------------------------------------
function readyMessage(o, items, shopName) {
  const list = items.slice(0, 8).map((i) => ({
    type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: i.product_name, size: 'sm', color: '#555555', flex: 5, wrap: true },
      { type: 'text', text: `x${i.qty}`, size: 'sm', color: '#111111', align: 'end', flex: 1 },
    ],
  }));
  return {
    type: 'flex',
    altText: `☕ ออเดอร์ ${queueNo(o.order_no)} พร้อมแล้ว! รับได้ที่เคาน์เตอร์`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#166534', paddingAll: '18px', contents: [
          { type: 'text', text: '☕ เครื่องดื่มพร้อมแล้ว!', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: shopName, color: '#bbf7d0', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          { type: 'text', text: 'หมายเลขคิว', size: 'sm', color: '#888888', align: 'center' },
          { type: 'text', text: queueNo(o.order_no), size: '3xl', weight: 'bold', align: 'center', color: '#166534' },
          { type: 'separator', margin: 'lg' },
          ...list,
          ...(o.table_no ? [{ type: 'text', text: `โต๊ะ ${o.table_no}`, size: 'sm', color: '#888888', margin: 'md' }] : []),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: o.order_type === 'dine_in' ? 'พนักงานกำลังนำไปเสิร์ฟที่โต๊ะ' : 'กรุณารับที่เคาน์เตอร์ได้เลยค่ะ',
            size: 'sm', align: 'center', color: '#555555', wrap: true },
        ],
      },
    },
  };
}

const text = (t) => ({ type: 'text', text: t });

/** ส่งแจ้งเตือน "พร้อมแล้ว" — ส่งครั้งเดียวต่อออเดอร์ ไม่ throw (log อย่างเดียว) */
async function notifyReady(orderId) {
  if (!line.configured()) return false;
  try {
    // จองสิทธิ์ส่งก่อน กันส่งซ้ำเมื่อกดหลายครั้ง
    const o = await db.get(`UPDATE orders SET line_notified_at=LOCALTIMESTAMP(0)
      WHERE id=? AND line_user_id IS NOT NULL AND line_notified_at IS NULL RETURNING *`, orderId);
    if (!o) return false;
    const items = await db.all('SELECT product_name, qty FROM order_items WHERE order_id=?', o.id);
    await line.push(o.line_user_id, readyMessage(o, items, await getSetting('shop_name', 'Espresso Flow')));
    return true;
  } catch (e) {
    console.error('[LINE] ส่งแจ้งเตือนไม่สำเร็จ:', e.message);
    await db.run('UPDATE orders SET line_notified_at=NULL WHERE id=?', orderId).catch(() => {});
    return false;
  }
}

// ---------------------------------------------------------------
// POST /api/line/webhook : รับ event จาก LINE (ต้องเป็น HTTPS สาธารณะ)
// ---------------------------------------------------------------
router.post('/webhook', wrap(async (req, res) => {
  if (!line.configured()) return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า LINE' });
  if (!line.verifySignature(req.rawBody, req.get('x-line-signature'))) {
    return res.status(401).json({ error: 'invalid signature' });
  }
  const events = req.body?.events || [];
  await Promise.all(events.map((ev) => handleEvent(ev).catch((e) => console.error('[LINE]', e.message))));
  res.json({ ok: true });
}));

const HELP = 'สวัสดีค่ะ 👋 บอทนี้จะแจ้งเตือนเมื่อเครื่องดื่มของคุณพร้อม\n\n'
  + 'วิธีใช้ : สแกน QR บนใบเสร็จ แล้วกดส่งข้อความที่ขึ้นมาได้เลยค่ะ';

async function handleEvent(ev) {
  if (ev.type === 'follow') return line.reply(ev.replyToken, text(HELP));
  if (ev.type !== 'message' || ev.message?.type !== 'text' || !ev.source?.userId) {
    return ev.replyToken && ev.type === 'message' ? line.reply(ev.replyToken, text(HELP)) : null;
  }

  const m = ev.message.text.match(/(ORD\d{8}-\d{4})[^A-Z0-9]+(?:รหัส\s*)?([A-Z0-9]{4,8})\b/i);
  if (!m) return line.reply(ev.replyToken, text(HELP));

  const o = await db.get('SELECT * FROM orders WHERE order_no=? AND line_token=?', m[1].toUpperCase(), m[2].toUpperCase());
  if (!o) return line.reply(ev.replyToken, text('ไม่พบออเดอร์นี้ กรุณาสแกน QR บนใบเสร็จอีกครั้งค่ะ'));
  if (o.status === 'cancelled') return line.reply(ev.replyToken, text(`ออเดอร์ ${queueNo(o.order_no)} ถูกยกเลิกแล้วค่ะ`));
  if (o.status === 'completed') return line.reply(ev.replyToken, text(`ออเดอร์ ${queueNo(o.order_no)} รับไปเรียบร้อยแล้วค่ะ ขอบคุณค่ะ 🙏`));

  await db.run('UPDATE orders SET line_user_id=?, line_notified_at=NULL WHERE id=?', ev.source.userId, o.id);

  const items = await db.all('SELECT product_name, qty FROM order_items WHERE order_id=?', o.id);
  if (o.status === 'ready') {
    await db.run('UPDATE orders SET line_notified_at=LOCALTIMESTAMP(0) WHERE id=?', o.id);
    return line.reply(ev.replyToken, readyMessage(o, items, await getSetting('shop_name', 'Espresso Flow')));
  }
  const summary = items.map((i) => `• ${i.product_name} x${i.qty}`).join('\n');
  return line.reply(ev.replyToken, text(
    `รับทราบค่ะ ✅ ออเดอร์ ${queueNo(o.order_no)}\n${summary}\n\nบาริสต้ากำลังเตรียมให้ จะแจ้งทันทีเมื่อพร้อมค่ะ ☕`));
}

// ---------------------------------------------------------------
// GET /api/line/status : สถานะการเชื่อมต่อ (หน้าตั้งค่า)
// ---------------------------------------------------------------
router.get('/status', auth, wrap(async (req, res) => {
  const webhook = `${req.protocol}://${req.get('host')}/api/line/webhook`;
  if (!line.configured()) return res.json({ configured: false, webhook });
  try {
    const bot = await line.getBotInfo();
    res.json({ configured: true, ok: true, name: bot.displayName, basic_id: bot.basicId, picture: bot.pictureUrl, webhook });
  } catch (e) {
    res.json({ configured: true, ok: false, error: e.message, webhook });
  }
}));

// ---------------------------------------------------------------
// GET /api/line/order-link/:id : QR สำหรับใบเสร็จ
// ---------------------------------------------------------------
router.get('/order-link/:id', auth, wrap(async (req, res) => {
  if (!line.configured()) return res.json({ enabled: false });
  let bot;
  try { bot = await line.getBotInfo(); } catch { return res.json({ enabled: false }); }

  const token = crypto.randomBytes(3).toString('hex').toUpperCase();
  const o = await db.get(`UPDATE orders SET line_token=COALESCE(line_token, ?) WHERE id=?
                          RETURNING order_no, line_token, status, line_user_id`, token, req.params.id);
  if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });
  if (['completed', 'cancelled'].includes(o.status)) return res.json({ enabled: false });

  const url = line.chatLink(bot.basicId, `รับแจ้งเตือน ${o.order_no} รหัส ${o.line_token}`);
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  res.json({
    enabled: true,
    linked: !!o.line_user_id,
    url,
    qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    bot_name: bot.displayName,
  });
}));

module.exports = router;
module.exports.notifyReady = notifyReady;
