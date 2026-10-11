/**
 * ตรวจสลิปโอนเงินผ่านผู้ให้บริการภายนอก
 *
 * ตั้งค่าใน .env
 *   SLIP_PROVIDER=easyslip   + EASYSLIP_API_KEY=...                 (https://developer.easyslip.com)
 *   SLIP_PROVIDER=slipok     + SLIPOK_API_KEY=... SLIPOK_BRANCH_ID=... (https://slipok.com)
 * ถ้าไม่ได้ตั้ง → provider = null : ระบบจะอ่าน QR บนสลิปเอง แล้วให้พนักงานยืนยันยอด
 *
 * ทุก provider คืนค่าในรูปแบบเดียวกัน :
 *   { trans_ref, amount, date, sending_bank, sender_name, receiver_name, receiver_account, receiver_proxy, raw }
 */

class SlipError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function providerName() {
  const p = String(process.env.SLIP_PROVIDER || '').toLowerCase();
  if (p === 'easyslip' && process.env.EASYSLIP_API_KEY) return 'easyslip';
  if (p === 'slipok' && process.env.SLIPOK_API_KEY && process.env.SLIPOK_BRANCH_ID) return 'slipok';
  return null;
}

/** แยก data URL → Blob สำหรับส่งแบบ multipart */
function dataUrlToBlob(dataUrl) {
  const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  return new Blob([Buffer.from(m[2], 'base64')], { type: m[1] });
}

async function readJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 200) }; }
}

// ---------------------------------------------------------------
// EasySlip  : GET /verify?payload=  หรือ POST /verify (multipart file)
// ---------------------------------------------------------------
const EASYSLIP_ERRORS = {
  invalid_payload: 'QR บนสลิปไม่ถูกต้อง',
  invalid_image: 'รูปสลิปไม่ถูกต้อง',
  slip_not_found: 'ไม่พบรายการโอนนี้ในระบบธนาคาร (อาจเป็นสลิปปลอม)',
  qrcode_not_found: 'ไม่พบ QR บนรูปสลิป',
  duplicate_slip: 'สลิปนี้เคยถูกตรวจสอบไปแล้ว',
  unauthorized: 'API key ของ EasySlip ไม่ถูกต้อง',
  quota_exceeded: 'โควตาตรวจสลิปของ EasySlip หมดแล้ว',
  access_denied: 'บัญชี EasySlip ไม่มีสิทธิ์ใช้งาน',
};

async function easyslip({ payload, image }) {
  const base = 'https://developer.easyslip.com/api/v1/verify';
  const headers = { Authorization: `Bearer ${process.env.EASYSLIP_API_KEY}` };
  let res;
  if (payload) {
    res = await fetch(`${base}?payload=${encodeURIComponent(payload)}`, { headers });
  } else {
    const blob = dataUrlToBlob(image);
    if (!blob) throw new SlipError('ไม่พบรูปสลิป', 'no_image');
    const form = new FormData();
    form.append('file', blob, 'slip.jpg');
    res = await fetch(base, { method: 'POST', headers, body: form });
  }
  const body = await readJson(res);
  if (!res.ok || body.status !== 200 || !body.data) {
    const key = body.message || `http_${res.status}`;
    throw new SlipError(EASYSLIP_ERRORS[key] || `EasySlip: ${key}`, key);
  }
  const d = body.data;
  const acc = (x) => x?.account?.bank?.account || '';
  return {
    trans_ref: d.transRef,
    amount: Number(d.amount?.amount ?? d.amount),
    date: d.date || null,
    sending_bank: d.sender?.bank?.short || d.sender?.bank?.name || null,
    sender_name: d.sender?.account?.name?.th || d.sender?.account?.name?.en || null,
    receiver_name: d.receiver?.account?.name?.th || d.receiver?.account?.name?.en || null,
    receiver_account: acc(d.receiver) || null,
    receiver_proxy: d.receiver?.account?.proxy?.account || null,
    raw: d,
  };
}

// ---------------------------------------------------------------
// SlipOK : POST /api/line/apikey/{branch}  (JSON {data} หรือ multipart files)
// ---------------------------------------------------------------
const SLIPOK_ERRORS = {
  1002: 'API key ของ SlipOK ไม่ถูกต้อง',
  1004: 'โควตาตรวจสลิปของ SlipOK หมดแล้ว',
  1006: 'รูปสลิปไม่ถูกต้อง',
  1007: 'ไม่พบ QR บนรูปสลิป',
  1008: 'QR บนสลิปไม่ถูกต้อง',
  1010: 'ธนาคารยังไม่ยืนยันรายการ กรุณารอสักครู่แล้วลองใหม่',
  1012: 'สลิปนี้เคยถูกใช้ไปแล้ว (สลิปซ้ำ)',
  1013: 'ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ',
  1014: 'บัญชีผู้รับเงินในสลิปไม่ใช่บัญชีของร้าน',
};

async function slipok({ payload, image, amount }) {
  const url = `https://api.slipok.com/api/line/apikey/${encodeURIComponent(process.env.SLIPOK_BRANCH_ID)}`;
  const headers = { 'x-authorization': process.env.SLIPOK_API_KEY };
  let res;
  if (payload) {
    res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: payload, amount, log: true }),
    });
  } else {
    const blob = dataUrlToBlob(image);
    if (!blob) throw new SlipError('ไม่พบรูปสลิป', 'no_image');
    const form = new FormData();
    form.append('files', blob, 'slip.jpg');
    form.append('amount', String(amount));
    form.append('log', 'true');
    res = await fetch(url, { method: 'POST', headers, body: form });
  }
  const body = await readJson(res);
  if (!body.success || !body.data?.success) {
    const code = body.code || body.data?.code;
    throw new SlipError(SLIPOK_ERRORS[code] || `SlipOK: ${body.message || res.status}`, String(code || res.status));
  }
  const d = body.data;
  const dt = d.transDate && d.transTime
    ? `${d.transDate.slice(0, 4)}-${d.transDate.slice(4, 6)}-${d.transDate.slice(6, 8)}T${d.transTime}+07:00`
    : null;
  return {
    trans_ref: d.transRef,
    amount: Number(d.amount),
    date: dt,
    sending_bank: d.sendingBank || null,
    sender_name: d.sender?.displayName || d.sender?.name || null,
    receiver_name: d.receiver?.displayName || d.receiver?.name || null,
    receiver_account: d.receiver?.account?.value || null,
    receiver_proxy: d.receiver?.proxy?.value || null,
    raw: d,
  };
}

/** ตรวจสลิปด้วย provider ที่ตั้งค่าไว้ (throw SlipError ถ้าไม่ผ่าน) */
async function verifyWithProvider(input) {
  const p = providerName();
  if (!p) throw new SlipError('ยังไม่ได้ตั้งค่า API ตรวจสลิป', 'no_provider');
  try {
    return { provider: p, ...(await (p === 'easyslip' ? easyslip(input) : slipok(input))) };
  } catch (e) {
    if (e instanceof SlipError) throw e;
    throw new SlipError(`เชื่อมต่อบริการตรวจสลิปไม่สำเร็จ: ${e.message}`, 'network');
  }
}

module.exports = { providerName, verifyWithProvider, SlipError };
