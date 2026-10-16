/**
 * /api/track : ลูกค้าติดตามสถานะออเดอร์แบบเรียลไทม์ (ไม่ต้องเข้าสู่ระบบ)
 *
 * ลิงก์ที่ลูกค้าได้ : /track/ORD20261011-0002?t=11EAD2
 *   - t = line_token ของออเดอร์ (สุ่ม) กันคนอื่นเดาเลขออเดอร์แล้วแอบดู
 *
 *   GET /api/track/:orderNo?t=...         → สถานะปัจจุบัน (JSON)
 *   GET /api/track/:orderNo/stream?t=...  → Server-Sent Events ส่งสถานะใหม่ทุกครั้งที่เปลี่ยน
 */
const router = require('express').Router();
const { db } = require('../database/db');
const { wrap, getSetting } = require('../utils/helpers');
const { onOrderChanged } = require('../utils/order-events');

const HEARTBEAT_MS = 25000;

async function findOrder(orderNo, token) {
  if (!orderNo || !token) return null;
  return db.get('SELECT * FROM orders WHERE order_no=? AND line_token=?',
    String(orderNo).toUpperCase(), String(token).toUpperCase());
}

/** ข้อมูลที่เปิดให้ลูกค้าเห็น (ไม่มีต้นทุน / ข้อมูลพนักงาน / ข้อมูลสมาชิก) */
async function snapshot(id) {
  const o = await db.get('SELECT * FROM orders WHERE id=?', id);
  const items = await db.all(
    'SELECT product_name, qty, options_text, line_total FROM order_items WHERE order_id=? ORDER BY id', id);
  return {
    order_no: o.order_no,
    queue_no: `#${String(o.order_no).split('-').pop()}`,
    status: o.status,
    order_type: o.order_type,
    table_no: o.table_no,
    total: o.total,
    created_at: o.created_at,
    updated_at: o.updated_at,
    line_linked: !!o.line_user_id,
    shop_name: await getSetting('shop_name', 'ผู้ชายขายน้ำ'),
    items,
  };
}

router.get('/:orderNo', wrap(async (req, res) => {
  const o = await findOrder(req.params.orderNo, req.query.t);
  if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์ หรือลิงก์ไม่ถูกต้อง' });
  res.set('Cache-Control', 'no-store');
  res.json(await snapshot(o.id));
}));

router.get('/:orderNo/stream', wrap(async (req, res) => {
  const o = await findOrder(req.params.orderNo, req.query.t);
  if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์ หรือลิงก์ไม่ถูกต้อง' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',   // ต้องตรงตัว ไม่มี charset ไม่งั้น Cloudflare Tunnel จะพักข้อมูลไว้
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',          // กัน proxy พักข้อมูลไว้ก่อนส่ง
  });
  res.write('retry: 3000\n\n');

  let closed = false;
  const send = async () => {
    if (closed) return;
    try {
      res.write(`event: status\ndata: ${JSON.stringify(await snapshot(o.id))}\n\n`);
    } catch (e) {
      console.error('[track]', e.message);
    }
  };

  const off = onOrderChanged(o.id, send);
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  req.on('close', () => { closed = true; off(); clearInterval(beat); });
  await send();
}));

module.exports = router;
