/**
 * พร้อมเพย์ (PromptPay) ตามมาตรฐาน EMVCo / Thai QR Payment
 *   - สร้าง payload สำหรับ QR รับเงินพร้อมระบุยอด
 *   - อ่าน "Mini QR" บนสลิปโอนเงินของธนาคาร (ได้ธนาคารผู้โอน + เลขอ้างอิงรายการ)
 */

const PROMPTPAY_AID = 'A000000677010111';

const BANKS = {
  '002': 'ธ.กรุงเทพ', '004': 'ธ.กสิกรไทย', '006': 'ธ.กรุงไทย', '011': 'ธ.ทหารไทยธนชาต',
  '014': 'ธ.ไทยพาณิชย์', '017': 'ธ.ซิตี้แบงก์', '022': 'ธ.ซีไอเอ็มบี', '024': 'ธ.ยูโอบี',
  '025': 'ธ.กรุงศรีอยุธยา', '030': 'ธ.ออมสิน', '033': 'ธ.อาคารสงเคราะห์', '034': 'ธ.ก.ส.',
  '066': 'ธ.อิสลามแห่งประเทศไทย', '067': 'ธ.ทิสโก้', '069': 'ธ.เกียรตินาคินภัทร', '073': 'ธ.แลนด์ แอนด์ เฮ้าส์',
};

/** CRC16-CCITT (poly 0x1021, init 0xFFFF) ที่ EMVCo ใช้ */
function crc16(str) {
  let crc = 0xffff;
  for (const byte of Buffer.from(str, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (tag, value) => `${tag}${String(value.length).padStart(2, '0')}${value}`;

/**
 * ตรวจและจัดรูปแบบเลขพร้อมเพย์
 * คืน { tag, value, type } — tag 01 = เบอร์มือถือ, 02 = เลขบัตรประชาชน/นิติบุคคล, 03 = e-Wallet
 */
function normalizeTarget(id) {
  const d = String(id || '').replace(/\D/g, '');
  if (/^0\d{9}$/.test(d)) return { tag: '01', value: `0066${d.slice(1)}`, type: 'phone' };
  if (/^66\d{9}$/.test(d)) return { tag: '01', value: `00${d}`, type: 'phone' };
  if (/^\d{13}$/.test(d)) return { tag: '02', value: d, type: 'national_id' };
  if (/^\d{15}$/.test(d)) return { tag: '03', value: d, type: 'ewallet' };
  return null;
}

/** สร้าง payload QR พร้อมเพย์ (amount ไม่ระบุ = QR แบบกรอกยอดเอง) */
function promptpayPayload(id, amount) {
  const target = normalizeTarget(id);
  if (!target) throw new Error('เลขพร้อมเพย์ไม่ถูกต้อง (ต้องเป็นเบอร์มือถือ 10 หลัก, เลขบัตร 13 หลัก หรือ e-Wallet 15 หลัก)');
  const hasAmount = amount != null && Number(amount) > 0;
  let data = tlv('00', '01')
    + tlv('01', hasAmount ? '12' : '11')
    + tlv('29', tlv('00', PROMPTPAY_AID) + tlv(target.tag, target.value))
    + tlv('58', 'TH')
    + tlv('53', '764')
    + (hasAmount ? tlv('54', Number(amount).toFixed(2)) : '');
  data += '6304';
  return data + crc16(data);
}

/** แยก TLV แบบ EMVCo (tag 2 หลัก, ความยาว 2 หลัก) */
function parseTlv(str) {
  const out = {};
  let i = 0;
  while (i + 4 <= str.length) {
    const tag = str.slice(i, i + 2);
    const len = Number(str.slice(i + 2, i + 4));
    if (!Number.isInteger(len) || i + 4 + len > str.length) return null;
    out[tag] = str.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return i === str.length ? out : null;
}

/**
 * อ่าน Mini QR บนสลิป
 * โครงสร้าง : 00 = { 00: API ID, 01: รหัสธนาคารผู้โอน, 02: เลขอ้างอิงรายการ }, 51 = ประเทศ, 91 = CRC
 * คืน null ถ้าไม่ใช่ QR ของสลิป
 */
function parseSlipQr(payload) {
  const s = String(payload || '').trim();
  const top = parseTlv(s);
  if (!top?.['00']) return null;
  const inner = parseTlv(top['00']);
  if (!inner?.['01'] || !inner['02']) return null;
  const crcOk = top['91'] ? crc16(s.slice(0, -4)) === top['91'].toUpperCase() : null;
  return {
    bank_code: inner['01'],
    bank_name: BANKS[inner['01']] || `ธนาคาร ${inner['01']}`,
    trans_ref: inner['02'],
    country: top['51'] || null,
    crc_ok: crcOk,
  };
}

/** ปิดบังเลขพร้อมเพย์สำหรับแสดงผล : 081-xxx-5678 */
function maskTarget(id) {
  const d = String(id || '').replace(/\D/g, '');
  if (d.length === 10) return `${d.slice(0, 3)}-xxx-${d.slice(6)}`;
  return d ? `x-xxxx-xxxxx-${d.slice(-3)}` : '';
}

module.exports = { promptpayPayload, normalizeTarget, parseSlipQr, maskTarget, crc16, BANKS };
