/**
 * /api/payments : QR พร้อมเพย์ และตรวจสลิปโอนเงิน
 */
const router = require('express').Router();
const QRCode = require('qrcode');
const { db } = require('../database/db');
const { auth } = require('../middleware/auth');
const { wrap, getSetting, round2 } = require('../utils/helpers');
const { promptpayPayload, normalizeTarget, parseSlipQr, maskTarget } = require('../utils/promptpay');
const { providerName, verifyWithProvider, SlipError } = require('../utils/slip-verify');

const SLIP_MAX_AGE_HOURS = Number(process.env.SLIP_MAX_AGE_HOURS || 24);

/** error ที่ตัวจัดการ error กลางแปลงเป็น { error } พร้อม status ให้ */
const httpError = (status, message) => Object.assign(new Error(message), { status });
/** ยอดเงินต้องเป็นตัวเลขจริงและมากกว่า 0 (กัน NaN จากข้อมูลที่ไม่ใช่ตัวเลข) */
const isValidAmount = (n) => Number.isFinite(n) && n > 0;

// ---------------------------------------------------------------
// GET /api/payments/config : สถานะการตั้งค่ารับชำระเงิน
// ---------------------------------------------------------------
router.get('/config', auth, wrap(async (req, res) => {
  const id = await getSetting('promptpay_id', '');
  res.json({
    promptpay_ready: !!normalizeTarget(id),
    promptpay_masked: maskTarget(id),
    promptpay_name: await getSetting('promptpay_name', ''),
    // รูป QR รับเงินของร้าน (data URL ที่อัปโหลดในหน้าตั้งค่า) — ลูกค้าสแกนแล้วกรอกยอดเอง
    qr_image: await getSetting('promptpay_qr_image', ''),
    require_slip: (await getSetting('require_slip', '1')) === '1',
    slip_provider: providerName(),
  });
}));

// ---------------------------------------------------------------
// GET /api/payments/promptpay-qr?amount=125.50 : QR รับเงินตามยอด
// ---------------------------------------------------------------
router.get('/promptpay-qr', auth, wrap(async (req, res) => {
  const amount = round2(Number(req.query.amount || 0));
  if (!isValidAmount(amount)) return res.status(400).json({ error: 'ยอดเงินไม่ถูกต้อง' });
  const id = await getSetting('promptpay_id', '');
  if (!normalizeTarget(id)) {
    return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่าเลขพร้อมเพย์ของร้าน (ตั้งค่า → ข้อมูลร้าน)' });
  }
  const payload = promptpayPayload(id, amount);
  const svg = await QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  res.json({
    amount,
    payload,
    qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    name: await getSetting('promptpay_name', '') || await getSetting('shop_name', ''),
    target: maskTarget(id),
  });
}));

// ---------------------------------------------------------------
// POST /api/payments/verify-slip
//   body : { amount, qr_payload?, image? (data URL), manual_confirm? }
//   คืน  : { status: 'verified' | 'manual' | 'needs_confirm', slip }
// ---------------------------------------------------------------
/** ไม่มี API : อ่าน QR บนสลิป แล้วให้พนักงานยืนยันยอดเอง */
async function verifyManually(b, qr, expected, userId) {
  if (!qr) throw httpError(400, 'อ่าน QR บนสลิปไม่ได้ — ถ่ายรูปให้เห็น QR มุมสลิปชัดๆ แล้วลองใหม่');
  if (!b.manual_confirm) {
    return {
      status: 'needs_confirm',
      slip: { trans_ref: qr.trans_ref, sending_bank: qr.bank_name, expected_amount: expected },
      message: 'ยังไม่ได้เชื่อมต่อ API ตรวจสลิป — กรุณาตรวจยอดเงินและชื่อผู้รับบนสลิปด้วยตนเอง',
    };
  }
  const slip = await saveSlip({
    trans_ref: qr.trans_ref, provider: 'manual', status: 'manual', amount: null, expected,
    sending_bank: qr.bank_name, qr_payload: b.qr_payload, user_id: userId,
  });
  return { status: 'manual', slip };
}

/** เลขท้ายพร้อมเพย์ที่ธนาคารเปิดให้เห็น เช่น xxx-xxx-5678 → 5678 */
function proxyTail(receiverProxy) {
  const shown = String(receiverProxy || '').replace(/[^\dxX]/g, '');
  return shown.split(/[xX]/).at(-1);
}

/** ตรวจผลจากผู้ให้บริการ : สลิปซ้ำ / ยอดเงิน / บัญชีผู้รับ / อายุสลิป */
async function checkProviderResult(r, expected) {
  const used = await findUsed(r.trans_ref);
  if (used) throw httpError(409, used);

  if (Math.abs(round2(r.amount) - expected) > 0.009) {
    throw httpError(400, `ยอดเงินในสลิป ฿${r.amount.toFixed(2)} ไม่ตรงกับยอดที่ต้องชำระ ฿${expected.toFixed(2)}`);
  }

  const shopId = String(await getSetting('promptpay_id', '')).replaceAll(/\D/g, '');
  const tail = proxyTail(r.receiver_proxy);
  if (shopId && tail.length >= 3 && !shopId.endsWith(tail)) {
    throw httpError(400, `บัญชีผู้รับในสลิป (${r.receiver_proxy}) ไม่ใช่พร้อมเพย์ของร้าน`);
  }

  const ageH = r.date ? (Date.now() - new Date(r.date).getTime()) / 36e5 : 0;
  if (ageH > SLIP_MAX_AGE_HOURS) {
    throw httpError(400, `สลิปนี้เป็นรายการเก่าเกิน ${SLIP_MAX_AGE_HOURS} ชั่วโมง`);
  }
}

router.post('/verify-slip', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const expected = round2(Number(b.amount || 0));
  if (!isValidAmount(expected)) return res.status(400).json({ error: 'ยอดเงินไม่ถูกต้อง' });

  const qr = b.qr_payload ? parseSlipQr(b.qr_payload) : null;
  if (b.qr_payload && !qr) {
    return res.status(400).json({ error: 'QR ในรูปนี้ไม่ใช่ QR ของสลิปธนาคาร (อาจเป็น QR รับเงิน หรือรูปไม่ชัด)' });
  }
  const usedQr = qr ? await findUsed(qr.trans_ref) : null;
  if (usedQr) return res.status(409).json({ error: usedQr });

  const provider = providerName();
  if (!provider) return res.json(await verifyManually(b, qr, expected, req.user.id));

  // ---- ตรวจกับผู้ให้บริการ ----
  let r;
  try {
    r = await verifyWithProvider({ payload: b.qr_payload || null, image: b.image || null, amount: expected });
  } catch (e) {
    if (e instanceof SlipError) return res.status(e.code === 'network' ? 502 : 400).json({ error: e.message });
    throw e;
  }
  await checkProviderResult(r, expected);

  const slip = await saveSlip({
    trans_ref: r.trans_ref, provider, status: 'verified', amount: r.amount, expected,
    sending_bank: r.sending_bank, sender_name: r.sender_name, receiver_name: r.receiver_name,
    receiver_account: [r.receiver_account, r.receiver_proxy].filter(Boolean).join(' / ') || null,
    slip_time: r.date, qr_payload: b.qr_payload || null, raw_json: JSON.stringify(r.raw), user_id: req.user.id,
  });
  res.json({ status: 'verified', slip });
}));

// ---------------------------------------------------------------
// GET /api/payments/slips : ประวัติการตรวจสลิป
// ---------------------------------------------------------------
router.get('/slips', auth, wrap(async (req, res) => {
  res.json(await db.all(`
    SELECT s.id, s.trans_ref, s.provider, s.status, s.amount, s.expected_amount, s.sending_bank,
           s.sender_name, s.receiver_name, s.slip_time, s.created_at, o.order_no, u.full_name AS checked_by
    FROM payment_slips s
    LEFT JOIN orders o ON o.id = s.order_id
    LEFT JOIN users u  ON u.id = s.user_id
    ORDER BY s.id DESC LIMIT ?`, Math.min(200, Number(req.query.limit || 50))));
}));

/** คืนข้อความ error ถ้าสลิปนี้ถูกผูกกับบิลแล้ว */
async function findUsed(transRef) {
  const row = await db.get(`SELECT s.order_id, o.order_no FROM payment_slips s
    LEFT JOIN orders o ON o.id=s.order_id WHERE s.trans_ref=?`, transRef);
  return row?.order_id ? `สลิปนี้ถูกใช้ชำระบิล ${row.order_no} ไปแล้ว (สลิปซ้ำ)` : null;
}

/** บันทึกสลิป (ถ้าเคยตรวจแต่ยังไม่ผูกบิล → อัปเดตแถวเดิม) */
async function saveSlip(s) {
  const row = await db.get(`INSERT INTO payment_slips
      (trans_ref,provider,status,amount,expected_amount,sending_bank,sender_name,receiver_name,
       receiver_account,slip_time,qr_payload,raw_json,user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (trans_ref) DO UPDATE SET provider=EXCLUDED.provider, status=EXCLUDED.status,
      amount=EXCLUDED.amount, expected_amount=EXCLUDED.expected_amount, sending_bank=EXCLUDED.sending_bank,
      sender_name=EXCLUDED.sender_name, receiver_name=EXCLUDED.receiver_name,
      receiver_account=EXCLUDED.receiver_account, slip_time=EXCLUDED.slip_time,
      qr_payload=EXCLUDED.qr_payload, raw_json=EXCLUDED.raw_json, user_id=EXCLUDED.user_id,
      created_at=LOCALTIMESTAMP(0)
    WHERE payment_slips.order_id IS NULL
    RETURNING id, trans_ref, provider, status, amount, expected_amount, sending_bank, sender_name,
              receiver_name, receiver_account, slip_time`,
    s.trans_ref, s.provider, s.status, s.amount, s.expected, s.sending_bank || null, s.sender_name || null,
    s.receiver_name || null, s.receiver_account || null, s.slip_time || null, s.qr_payload || null,
    s.raw_json || null, s.user_id);
  if (!row) throw Object.assign(new Error('สลิปนี้ถูกใช้ไปแล้ว'), { status: 409 });
  return row;
}

module.exports = router;
