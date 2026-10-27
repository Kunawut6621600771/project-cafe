/**
 * /api/line : LINE Bot แจ้งสถานะออเดอร์ให้ลูกค้า
 *
 * ขั้นตอน
 *   1. ใบเสร็จแสดง QR → ลูกค้าสแกน → LINE เปิดแชทกับบอท พร้อมข้อความ "รับแจ้งเตือน ORD...-0003 รหัส K7Q2"
 *   2. ลูกค้ากดส่ง → webhook ผูก LINE userId กับออเดอร์ แล้วตอบกลับพร้อมลิงก์ติดตามสถานะแบบเรียลไทม์
 *   3. พนักงานเปลี่ยนสถานะในหน้าคิว → notifyStatus() ส่งข้อความหาลูกค้าทุกขั้น
 *      (กำลังทำ → พร้อมเสิร์ฟ → รับแล้ว / ยกเลิก)
 *      ตั้ง LINE_NOTIFY=ready ใน .env ถ้าต้องการแจ้งเฉพาะตอนพร้อมเสิร์ฟ (ประหยัดโควตาข้อความ)
 */
const crypto = require('node:crypto');
const router = require('express').Router();
const QRCode = require('qrcode');
const { db } = require('../database/db');
const { auth } = require('../middleware/auth');
const { wrap, getSetting } = require('../utils/helpers');
const line = require('../utils/line');
const { emitOrderChanged, rememberPublicUrl, publicUrl } = require('../utils/order-events');

const queueNo = (orderNo) => `#${String(orderNo).split('-').pop()}`;

/** ลิงก์หน้าติดตามออเดอร์ (null ถ้ายังไม่รู้ URL สาธารณะแบบ https) */
function trackUrl(o) {
  const base = publicUrl();
  return base && o.line_token ? `${base}/track/${o.order_no}?t=${o.line_token}` : null;
}

// ---------------------------------------------------------------
// ข้อความ (Flex Message)
// ---------------------------------------------------------------
const STEPS = [
  { key: 'pending',   label: 'รับออเดอร์' },
  { key: 'preparing', label: 'กำลังทำ' },
  { key: 'ready',     label: 'พร้อมเสิร์ฟ' },
  { key: 'completed', label: 'รับแล้ว' },
];

const STYLE = {
  pending:   { color: '#8a5a2b', title: '🧾 รับออเดอร์แล้ว',            note: 'บาริสต้าจะเริ่มทำให้เร็ว ๆ นี้ เราจะแจ้งทุกขั้นตอนค่ะ' },
  preparing: { color: '#b45309', title: '👩‍🍳 กำลังชงเครื่องดื่มของคุณ', note: 'อีกสักครู่จะพร้อมแล้วค่ะ ☕' },
  ready:     { color: '#166534', title: '☕ เครื่องดื่มพร้อมแล้ว!',      note: null },
  completed: { color: '#1e3a8a', title: '🙏 ขอบคุณที่อุดหนุนค่ะ',        note: 'หวังว่าจะได้พบกันอีกนะคะ' },
  cancelled: { color: '#991b1b', title: '❌ ออเดอร์ถูกยกเลิก',          note: 'หากมีข้อสงสัย ติดต่อพนักงานที่เคาน์เตอร์ได้เลยค่ะ' },
};

/** แถบความคืบหน้า 4 ขั้น */
function progressBox(status) {
  const idx = STEPS.findIndex((s) => s.key === status);
  return {
    type: 'box', layout: 'horizontal', margin: 'lg', spacing: 'xs',
    contents: STEPS.map((s, i) => ({
      type: 'box', layout: 'vertical', flex: 1, spacing: 'xs', contents: [
        { type: 'box', layout: 'vertical', height: '6px', cornerRadius: '3px', contents: [],
          backgroundColor: i <= idx ? '#16a34a' : '#e5e7eb' },
        { type: 'text', text: s.label, size: 'xxs', align: 'center',
          color: i === idx ? '#111111' : '#999999', weight: i === idx ? 'bold' : 'regular' },
      ],
    })),
  };
}

function statusMessage(o, items, shopName) {
  const st = STYLE[o.status] || STYLE.pending;
  const list = items.slice(0, 8).map((i) => ({
    type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: i.product_name, size: 'sm', color: '#555555', flex: 5, wrap: true },
      { type: 'text', text: `x${i.qty}`, size: 'sm', color: '#111111', align: 'end', flex: 1 },
    ],
  }));
  const readyNote = o.order_type === 'dine_in' ? 'พนักงานกำลังนำไปเสิร์ฟที่โต๊ะ' : 'กรุณารับที่เคาน์เตอร์ได้เลยค่ะ';
  const link = trackUrl(o);

  return {
    type: 'flex',
    altText: `${st.title} ออเดอร์ ${queueNo(o.order_no)}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: st.color, paddingAll: '18px', contents: [
          { type: 'text', text: st.title, color: '#ffffff', weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: shopName, color: '#ffffffcc', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          { type: 'text', text: 'หมายเลขคิว', size: 'sm', color: '#888888', align: 'center' },
          { type: 'text', text: queueNo(o.order_no), size: '3xl', weight: 'bold', align: 'center', color: st.color },
          ...(o.status === 'cancelled' ? [] : [progressBox(o.status)]),
          { type: 'separator', margin: 'lg' },
          ...list,
          ...(o.table_no ? [{ type: 'text', text: `โต๊ะ ${o.table_no}`, size: 'sm', color: '#888888', margin: 'md' }] : []),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          { type: 'text', text: st.note || readyNote, size: 'sm', align: 'center', color: '#555555', wrap: true },
          ...(link && !['completed', 'cancelled'].includes(o.status) ? [{
            type: 'button', style: 'primary', color: '#166534', height: 'sm',
            action: { type: 'uri', label: 'ดูสถานะแบบเรียลไทม์', uri: link },
          }] : []),
        ],
      },
    },
  };
}

const text = (t) => ({ type: 'text', text: t });

async function buildMessage(o) {
  const items = await db.all('SELECT product_name, qty FROM order_items WHERE order_id=? ORDER BY id', o.id);
  return statusMessage(o, items, await getSetting('shop_name', 'ผู้ชายขายน้ำ'));
}

const notifyAll = () => (process.env.LINE_NOTIFY || 'all').toLowerCase() !== 'ready';

/**
 * ส่งสถานะล่าสุดของออเดอร์ให้ลูกค้าที่ผูก LINE ไว้ — ส่งครั้งเดียวต่อสถานะ
 * ไม่ throw (log อย่างเดียว) เพื่อไม่ให้การเปลี่ยนสถานะในร้านล้มเพราะ LINE
 */
async function notifyStatus(orderId) {
  if (!line.configured()) return false;
  try {
    const cur = await db.get('SELECT status FROM orders WHERE id=?', orderId);
    if (!cur || cur.status === 'pending' || (!notifyAll() && cur.status !== 'ready')) return false;
    // จองสิทธิ์ส่งก่อน กันส่งซ้ำเมื่อกดหลายครั้ง
    const o = await db.get(`UPDATE orders SET line_last_status=status,
        line_notified_at = CASE WHEN status='ready' THEN LOCALTIMESTAMP(0) ELSE line_notified_at END
      WHERE id=? AND line_user_id IS NOT NULL AND line_last_status IS DISTINCT FROM status RETURNING *`, orderId);
    if (!o) return false;
    await line.push(o.line_user_id, await buildMessage(o));
    return true;
  } catch (e) {
    console.error('[LINE] ส่งแจ้งเตือนไม่สำเร็จ:', e.message);
    await db.run('UPDATE orders SET line_last_status=NULL WHERE id=?', orderId).catch(() => {});
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
  rememberPublicUrl(req);   // จำโดเมนสาธารณะไว้สร้างลิงก์ติดตามออเดอร์
  const events = req.body?.events || [];
  await Promise.all(events.map((ev) => handleEvent(ev).catch((e) => console.error('[LINE]', e.message))));
  res.json({ ok: true });
}));

const HELP = 'สวัสดีค่ะ 👋 บอทนี้จะแจ้งสถานะเครื่องดื่มของคุณทุกขั้นตอน\n\n'
  + 'วิธีใช้ : สแกน QR บนใบเสร็จ แล้วกดส่งข้อความที่ขึ้นมาได้เลยค่ะ';

/** log สั้น ๆ ทุก event ที่ LINE ส่งมา (ใช้ตรวจว่าข้อความของลูกค้ามาถึงเซิร์ฟเวอร์หรือไม่) */
function logEvent(ev) {
  const who = ev.source?.userId ? `${ev.source.userId.slice(0, 9)}…` : '-';
  const msg = ev.message?.type === 'text' ? ` "${ev.message.text.slice(0, 60)}"` : '';
  console.log(`[LINE] ${ev.type}${ev.message ? `/${ev.message.type}` : ''} จาก ${who}${msg}`);
}

async function handleEvent(ev) {
  logEvent(ev);
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

  // ผูกลูกค้า + บันทึกว่าแจ้งสถานะปัจจุบันไปแล้ว (คำตอบด้านล่างคือสถานะนี้)
  const linked = await db.get(`UPDATE orders SET line_user_id=?, line_last_status=status,
      line_notified_at = CASE WHEN status='ready' THEN LOCALTIMESTAMP(0) ELSE NULL END
    WHERE id=? RETURNING *`, ev.source.userId, o.id);
  emitOrderChanged(o.id);
  return line.reply(ev.replyToken, await buildMessage(linked));
}

// ---------------------------------------------------------------
// GET /api/line/status : สถานะการเชื่อมต่อ (หน้าตั้งค่า)
// ---------------------------------------------------------------
router.get('/status', auth, wrap(async (req, res) => {
  const base = publicUrl() || `${req.protocol}://${req.get('host')}`;
  const webhook = `${base}/api/line/webhook`;
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
  // ออเดอร์ปิดแล้วไม่ต้องรับแจ้งเตือน แต่ยังส่ง LINE ID ไว้แสดงช่องทางติดตามบนใบเสร็จ
  if (['completed', 'cancelled'].includes(o.status)) {
    return res.json({ enabled: false, bot_name: bot.displayName, basic_id: bot.basicId });
  }

  const url = line.chatLink(bot.basicId, `รับแจ้งเตือน ${o.order_no} รหัส ${o.line_token}`);
  const qrData = async (text) => {
    const svg = await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  };
  const track = trackUrl(o);
  res.json({
    enabled: true,
    linked: !!o.line_user_id,
    url,
    track_url: track,
    qr: await qrData(url),
    bot_name: bot.displayName,
    basic_id: bot.basicId,
  });
}));

module.exports = router;
module.exports.notifyStatus = notifyStatus;
