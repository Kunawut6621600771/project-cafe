/**
 * เทสต์ API หลังบ้าน : ยิง HTTP จริงเข้าเซิร์ฟเวอร์ที่ต่อฐานข้อมูลเทสต์
 * รัน : npm test
 */
require('./env');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// แทนการเชื่อมต่อผู้ให้บริการตรวจสลิปด้วยตัวปลอม (ต้องทำก่อน payments.js ถูกโหลด)
const slipVerify = require('../backend/utils/slip-verify');
const fakeProvider = { name: null, result: null, error: null };
slipVerify.providerName = () => fakeProvider.name;
slipVerify.verifyWithProvider = async () => {
  if (fakeProvider.error) throw fakeProvider.error;
  return fakeProvider.result;
};

const { db, closeDb } = require('../backend/database/db');
const { crc16 } = require('../backend/utils/promptpay');
const { startServer } = require('./server');

let api, server, productId;

/** สร้าง Mini QR แบบที่พิมพ์บนสลิปธนาคาร */
function slipQr(ref, bank = '004') {
  const tlv = (tag, v) => tag + String(v.length).padStart(2, '0') + v;
  const body = tlv('00', tlv('00', '000001') + tlv('01', bank) + tlv('02', ref)) + tlv('51', 'TH') + '9104';
  return body + crc16(body);
}

const setSettings = (obj) => api.call('PUT', '/settings', obj);
const order = (extra = {}) => api.call('POST', '/orders', {
  items: [{ product_id: productId, qty: 2 }], payment_method: 'cash', received: 500, ...extra,
});

before(async () => {
  api = await startServer();
  server = api.server;
  productId = (await db.get('SELECT id FROM products ORDER BY id LIMIT 1')).id;
  await db.run('UPDATE products SET price=50, cost=20 WHERE id=?', productId);
});

after(async () => {
  server.close();
  await closeDb();
});

beforeEach(() => {
  fakeProvider.name = null;
  fakeProvider.result = null;
  fakeProvider.error = null;
});

// ---------------------------------------------------------------
describe('server', () => {
  test('ไม่เปิดเผย X-Powered-By และไม่เปิด CORS ให้โดเมนอื่น', async () => {
    const res = await fetch(api.base + '/api/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  test('ไม่มี token → 401', async () => {
    const res = await fetch(api.base + '/api/orders');
    assert.equal(res.status, 401);
  });

  test('token ปลอม → 401 เซสชันหมดอายุ', async () => {
    const res = await fetch(api.base + '/api/orders', { headers: { Authorization: 'Bearer nope' } });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------
describe('POST /api/orders', () => {
  test('ต้องมีสินค้าอย่างน้อย 1 รายการ', async () => {
    const r = await api.call('POST', '/orders', { items: [] });
    assert.equal(r.status, 400);
  });

  test('ไม่พบสินค้า / สินค้าปิดการขาย', async () => {
    assert.equal((await api.call('POST', '/orders', { items: [{ product_id: 999999 }] })).status, 400);
    const p = await db.get('SELECT id FROM products ORDER BY id DESC LIMIT 1');
    await db.run('UPDATE products SET is_available=0 WHERE id=?', p.id);
    const r = await api.call('POST', '/orders', { items: [{ product_id: p.id }] });
    await db.run('UPDATE products SET is_available=1 WHERE id=?', p.id);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /ปิดการขาย/);
  });

  test('คิดราคาฝั่งเซิร์ฟเวอร์ รวมตัวเลือก และทอนเงิน', async () => {
    const opt = await db.get('SELECT id, price_delta FROM options ORDER BY price_delta DESC LIMIT 1');
    const r = await api.call('POST', '/orders', {
      items: [{ product_id: productId, qty: 2, options: [opt.id, 999999], note: 'หวานน้อย' }],
      payment_method: 'cash', received: 500, status: 'completed',
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.subtotal, (50 + opt.price_delta) * 2);
    assert.equal(r.body.change_amount, 500 - r.body.total);
    assert.equal(r.body.items[0].note, 'หวานน้อย');
    assert.equal(r.body.status, 'completed');
  });

  test('เงินสดไม่พอ → 400', async () => {
    const r = await order({ received: 1 });
    assert.equal(r.status, 400);
  });

  test('ส่วนลดที่กรอกเอง ไม่เกินยอดรวม', async () => {
    const r = await order({ discount: 9999 });
    assert.equal(r.status, 201);
    assert.equal(r.body.total, 0);
  });

  test('โค้ดส่วนลด : ไม่พบ / ยอดไม่ถึง / เปอร์เซ็นต์ / จำนวนเงิน', async () => {
    await db.run(`INSERT INTO promotions (code,name,type,value,min_total) VALUES
      ('PCT10','ลด 10%','percent',10,0), ('BIG','ลด 20 บาท','amount',20,1000), ('AMT5','ลด 5 บาท','amount',5,0)`);
    assert.equal((await order({ promotion_code: 'NOPE' })).status, 400);
    const min = await order({ promotion_code: 'BIG' });
    assert.equal(min.status, 400);
    assert.match(min.body.error, /ขั้นต่ำ/);
    assert.equal((await order({ promotion_code: 'PCT10' })).body.discount, 10);
    assert.equal((await order({ promotion_code: 'AMT5' })).body.discount, 5);
  });

  test('สมาชิก : แลกแต้มเป็นส่วนลด + ได้แต้มใหม่ + ขึ้นระดับ', async () => {
    const m = await api.call('POST', '/members', { name: 'ทดสอบ แต้ม', phone: '0800000001' });
    assert.equal(m.status, 201);
    await db.run('UPDATE members SET points=30 WHERE id=?', m.body.id);
    await setSettings({ point_redeem_rate: '1', points_per_baht: '0.1' });

    const r = await order({ member_id: m.body.id, points_used: 10 });
    assert.equal(r.status, 201);
    assert.equal(r.body.discount, 10);
    assert.equal(r.body.points_earned, Math.floor(r.body.total * 0.1));

    const after = await db.get('SELECT points, visits FROM members WHERE id=?', m.body.id);
    assert.equal(after.points, 30 - 10 + r.body.points_earned);
    assert.equal(after.visits, 1);
    const tx = await db.all('SELECT points FROM point_transactions WHERE order_id=? ORDER BY id', r.body.id);
    assert.deepEqual(tx.map((t) => t.points), [-10, r.body.points_earned]);
  });

  test('สมาชิกไม่ได้แลกแต้ม และยอดเป็น 0 → ไม่มีรายการแต้ม', async () => {
    const m = await api.call('POST', '/members', { name: 'ทดสอบ ศูนย์', phone: '0800000002' });
    const r = await order({ member_id: m.body.id, discount: 9999 });
    assert.equal(r.status, 201);
    assert.equal(r.body.points_earned, 0);
    const rows = await db.all('SELECT * FROM point_transactions WHERE order_id=?', r.body.id);
    assert.equal(rows.length, 0);
  });

  test('ตัดสต็อกตามสูตร และบันทึกการเคลื่อนไหว', async () => {
    const ing = await api.call('POST', '/stock/ingredients', { name: 'เมล็ดกาแฟเทสต์', unit: 'กรัม', stock_qty: 1000, cost_per_unit: 0.5 });
    assert.equal(ing.status, 201);
    await db.run('INSERT INTO recipes (product_id, ingredient_id, qty) VALUES (?,?,18)', productId, ing.body.id);
    await db.run('INSERT INTO recipes (product_id, ingredient_id, qty) VALUES (?,?,1)', productId,
      await db.insert("INSERT INTO ingredients (name) VALUES ('ลบทิ้ง')"));
    await db.run("DELETE FROM ingredients WHERE name='ลบทิ้ง'");

    const r = await order();
    assert.equal(r.status, 201);
    const left = await db.get('SELECT stock_qty FROM ingredients WHERE id=?', ing.body.id);
    assert.equal(left.stock_qty, 1000 - 36);
    const mv = await db.get('SELECT qty, cost FROM stock_movements WHERE ref_id=? AND ref_type=?', r.body.id, 'order');
    assert.deepEqual(mv, { qty: -36, cost: 18 });
    await db.run('DELETE FROM recipes WHERE product_id=?', productId);
  });

  test('สถานะ : ใช้คิว → pending / ปิดคิว → completed และนับยอดเข้ากะ', async () => {
    await setSettings({ use_queue: '1' });
    assert.equal((await order()).body.status, 'pending');

    await setSettings({ use_queue: '0' });
    const shiftId = await db.insert("INSERT INTO shifts (user_id, status) VALUES (?, 'open')", api.user.id);
    const r = await order();
    assert.equal(r.body.status, 'completed');
    assert.equal(r.body.shift_id, shiftId);
    const s = await db.get('SELECT total_orders, total_sales FROM shifts WHERE id=?', shiftId);
    assert.deepEqual(s, { total_orders: 1, total_sales: r.body.total });
    await db.run("UPDATE shifts SET status='closed'");
    await setSettings({ use_queue: '1' });
  });

  describe('ชำระด้วยสลิป', () => {
    const newSlip = (ref, amount, orderId = null) => db.insert(
      `INSERT INTO payment_slips (trans_ref, provider, status, expected_amount, order_id)
       VALUES (?, 'manual', 'manual', ?, ?)`, ref, amount, orderId);

    test('บังคับแนบสลิป → พร้อมเพย์ไม่มีสลิป 400 / ไม่บังคับ → ผ่าน', async () => {
      await setSettings({ require_slip: '1' });
      assert.equal((await order({ payment_method: 'promptpay' })).status, 400);
      await setSettings({ require_slip: '0' });
      assert.equal((await order({ payment_method: 'transfer' })).status, 201);
      await setSettings({ require_slip: '1' });
    });

    test('ไม่พบสลิป / สลิปถูกใช้แล้ว / ยอดไม่ตรง', async () => {
      assert.equal((await order({ payment_method: 'promptpay', slip_id: 999999 })).status, 400);

      const used = await order();
      const usedSlip = await newSlip('USED-1', 100, used.body.id);
      assert.equal((await order({ payment_method: 'promptpay', slip_id: usedSlip })).status, 409);

      const wrong = await newSlip('WRONG-1', 1);
      const r = await order({ payment_method: 'promptpay', slip_id: wrong });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /ยอดบิลเปลี่ยน/);
    });

    test('สลิปถูกต้อง → ผูกกับบิล', async () => {
      const id = await newSlip('OK-1', 100);
      const r = await order({ payment_method: 'promptpay', slip_id: id });
      assert.equal(r.status, 201);
      assert.equal(r.body.received, 100);
      assert.equal((await db.get('SELECT order_id FROM payment_slips WHERE id=?', id)).order_id, r.body.id);
    });
  });
});

// ---------------------------------------------------------------
describe('GET /api/orders', () => {
  test('แบ่งหน้าและกรอง', async () => {
    const r = await api.call('GET', '/orders?page=2&limit=3&status=completed&payment_method=cash&order_type=takeaway');
    assert.equal(r.status, 200);
  });
});

// ---------------------------------------------------------------
describe('/api/payments', () => {
  test('promptpay-qr : ยอดไม่ถูกต้อง / ยังไม่ตั้งพร้อมเพย์ / สำเร็จ', async () => {
    assert.equal((await api.call('GET', '/payments/promptpay-qr?amount=abc')).status, 400);
    assert.equal((await api.call('GET', '/payments/promptpay-qr?amount=-5')).status, 400);
    await setSettings({ promptpay_id: '' });
    assert.equal((await api.call('GET', '/payments/promptpay-qr?amount=10')).status, 400);
    await setSettings({ promptpay_id: '0812345678' });
    const ok = await api.call('GET', '/payments/promptpay-qr?amount=10');
    assert.equal(ok.status, 200);
    assert.match(ok.body.qr, /^data:image\/svg\+xml;base64,/);
  });

  test('verify-slip : ยอดไม่ถูกต้อง / QR ไม่ใช่สลิป', async () => {
    assert.equal((await api.call('POST', '/payments/verify-slip', { amount: 'abc' })).status, 400);
    const bad = await api.call('POST', '/payments/verify-slip', { amount: 10, qr_payload: 'not-a-slip' });
    assert.equal(bad.status, 400);
  });

  test('ไม่มี API ตรวจสลิป : ไม่มี QR / รอยืนยัน / ยืนยันแล้ว / ใช้ซ้ำ', async () => {
    assert.equal((await api.call('POST', '/payments/verify-slip', { amount: 10 })).status, 400);

    const qr = slipQr('MANUAL001');
    const wait = await api.call('POST', '/payments/verify-slip', { amount: 10, qr_payload: qr });
    assert.equal(wait.body.status, 'needs_confirm');
    assert.equal(wait.body.slip.trans_ref, 'MANUAL001');

    const ok = await api.call('POST', '/payments/verify-slip', { amount: 10, qr_payload: qr, manual_confirm: true });
    assert.equal(ok.body.status, 'manual');

    // ตรวจซ้ำได้จนกว่าจะผูกกับบิล → ผูกแล้วใช้ซ้ำไม่ได้
    const billed = (await order()).body.id;
    await db.run('UPDATE payment_slips SET order_id=? WHERE trans_ref=?', billed, 'MANUAL001');
    const again = await api.call('POST', '/payments/verify-slip', { amount: 10, qr_payload: qr, manual_confirm: true });
    assert.equal(again.status, 409);
  });

  describe('ตรวจผ่านผู้ให้บริการ', () => {
    const good = (ref, extra = {}) => ({
      trans_ref: ref, amount: 10, receiver_proxy: 'xxx-xxx-5678', date: new Date().toISOString(),
      sending_bank: 'KBANK', sender_name: 'A', receiver_name: 'B', receiver_account: null, raw: {}, ...extra,
    });
    const verify = () => api.call('POST', '/payments/verify-slip', { amount: 10, image: 'data:image/png;base64,AA==' });

    before(() => setSettings({ promptpay_id: '0812345678' }));

    test('error จากผู้ให้บริการ : network → 502 / อื่นๆ → 400 / ไม่คาดคิด → 500', async () => {
      fakeProvider.name = 'easyslip';
      fakeProvider.error = new slipVerify.SlipError('เน็ตล่ม', 'network');
      assert.equal((await verify()).status, 502);
      fakeProvider.error = new slipVerify.SlipError('สลิปปลอม', 'invalid');
      assert.equal((await verify()).status, 400);
      fakeProvider.error = new Error('boom');
      assert.equal((await verify()).status, 500);
    });

    test('ยอดไม่ตรง / บัญชีผู้รับไม่ใช่ร้าน / สลิปเก่า', async () => {
      fakeProvider.name = 'easyslip';
      fakeProvider.result = good('P-AMT', { amount: 99 });
      assert.match((await verify()).body.error, /ไม่ตรงกับยอด/);
      fakeProvider.result = good('P-ACC', { receiver_proxy: 'xxx-xxx-9999' });
      assert.match((await verify()).body.error, /ไม่ใช่พร้อมเพย์ของร้าน/);
      fakeProvider.result = good('P-OLD', { date: '2020-01-01T00:00:00Z' });
      assert.match((await verify()).body.error, /เก่าเกิน/);
    });

    test('สลิปถูกต้อง → verified แล้วใช้ซ้ำไม่ได้', async () => {
      fakeProvider.name = 'slipok';
      fakeProvider.result = good('P-OK', { receiver_proxy: null, date: null });
      const ok = await verify();
      assert.equal(ok.status, 200);
      assert.equal(ok.body.status, 'verified');
      await db.run('UPDATE payment_slips SET order_id=(SELECT MAX(id) FROM orders) WHERE trans_ref=?', 'P-OK');
      assert.equal((await verify()).status, 409);
    });
  });
});

// ---------------------------------------------------------------
describe('API อื่นที่แก้ไข', () => {
  test('รายงานแดชบอร์ด', async () => {
    const r = await api.call('GET', '/reports/dashboard');
    assert.equal(r.status, 200);
  });

  test('ร้อยละเทียบเมื่อวาน : เมื่อวานมียอด', async () => {
    await db.run(`INSERT INTO orders (order_no, user_id, subtotal, total, status, created_at)
      VALUES ('ORD-YESTERDAY', ?, 40, 40, 'completed', LOCALTIMESTAMP(0) - INTERVAL '1 day')`, api.user.id);
    const r = await api.call('GET', '/reports/dashboard');
    assert.equal(r.status, 200);
  });

  test('สต็อก : สถานะ ok / low / out + การเคลื่อนไหว + แจ้งเตือน', async () => {
    await api.call('POST', '/stock/ingredients', { name: 'นมเทสต์', stock_qty: 5, min_qty: 10 });
    await api.call('POST', '/stock/ingredients', { name: 'น้ำตาลเทสต์', stock_qty: 0, min_qty: 1 });
    const list = await api.call('GET', '/stock/ingredients');
    const status = new Set(list.body.map((i) => i.stock_status));
    assert.deepEqual([...status].sort(), ['low', 'ok', 'out']);
    assert.equal((await api.call('GET', '/stock/movements?limit=5')).status, 200);
    assert.equal((await api.call('GET', '/stock/alerts')).status, 200);
  });

  test('สมาชิก : รายการแบ่งหน้า / ปรับแต้ม', async () => {
    assert.equal((await api.call('GET', '/members?page=1&limit=5')).status, 200);
    const m = await db.get('SELECT id FROM members ORDER BY id LIMIT 1');
    assert.equal((await api.call('POST', `/members/${m.id}/points`, { points: 'x' })).status, 400);
    assert.equal((await api.call('POST', `/members/${m.id}/points`, { points: 5, reason: 'โบนัส' })).status, 200);
  });
});

// ---------------------------------------------------------------
describe('LINE webhook', () => {
  const realFetch = globalThis.fetch;
  const sent = [];

  before(() => {
    process.env.LINE_CHANNEL_SECRET = 'test-secret';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    // ข้อความที่บอทส่งออกไปหา LINE → เก็บไว้ตรวจแทนการส่งจริง
    globalThis.fetch = async (url, opt) => {
      if (String(url).startsWith('https://api.line.me')) {
        sent.push(JSON.parse(opt.body));
        return new Response('{}', { status: 200 });
      }
      return realFetch(url, opt);
    };
  });

  after(() => {
    globalThis.fetch = realFetch;
    process.env.LINE_CHANNEL_SECRET = '';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
  });

  async function hook(events) {
    const raw = JSON.stringify({ events });
    const sig = crypto.createHmac('sha256', 'test-secret').update(raw).digest('base64');
    return realFetch(api.base + '/api/line/webhook', {
      method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'x-line-signature': sig },
    });
  }

  test('ลายเซ็นผิด → 401', async () => {
    const res = await realFetch(api.base + '/api/line/webhook', {
      method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', 'x-line-signature': 'bad' },
    });
    assert.equal(res.status, 401);
  });

  test('ส่งรหัสออเดอร์ (ตัวพิมพ์เล็กก็ได้) → ผูกออเดอร์กับลูกค้า', async () => {
    const created = await order();
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const o = created.body;
    await db.run("UPDATE orders SET line_token='AB12' WHERE id=?", o.id);
    const res = await hook([{
      type: 'message', replyToken: 'r1', source: { userId: 'U123' },
      message: { type: 'text', text: `${o.order_no.toLowerCase()} รหัส ab12` },
    }]);
    assert.equal(res.status, 200);
    assert.equal((await db.get('SELECT line_user_id FROM orders WHERE id=?', o.id)).line_user_id, 'U123');
    assert.ok(sent.some((m) => m.replyToken === 'r1'));
  });

  test('ข้อความอื่น → ตอบวิธีใช้', async () => {
    await hook([{ type: 'message', replyToken: 'r2', source: { userId: 'U1' }, message: { type: 'text', text: 'สวัสดี' } }]);
    assert.ok(sent.some((m) => m.replyToken === 'r2'));
  });
});
