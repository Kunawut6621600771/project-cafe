/** อ่านรูปสลิป : หา QR บนสลิป + ย่อรูปก่อนส่งไปตรวจ */

let jsQRPromise;
/** โหลดไลบรารี jsQR ครั้งแรกที่ใช้ */
function loadJsQR() {
  jsQRPromise ||= new Promise((resolve, reject) => {
    if (window.jsQR) return resolve(window.jsQR);
    const s = document.createElement('script');
    s.src = '/vendor/jsQR.js';
    s.onload = () => resolve(window.jsQR);
    s.onerror = () => { jsQRPromise = null; reject(new Error('โหลดตัวอ่าน QR ไม่สำเร็จ')); };
    document.head.appendChild(s);
  });
  return jsQRPromise;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดไฟล์รูปไม่ได้')); };
    img.src = url;
  });
}

function drawScaled(img, maxSide) {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { c, ctx };
}

/**
 * รับไฟล์รูปสลิป → { qr: ข้อความใน QR หรือ null, image: data URL (JPEG ย่อแล้ว), preview }
 * ลองอ่าน QR หลายขนาด เพราะ QR มุมสลิปมักเล็ก
 */
export async function readSlip(file) {
  if (!file?.type.startsWith('image/')) throw new Error('กรุณาเลือกไฟล์รูปภาพ');
  const [jsQR, img] = await Promise.all([loadJsQR(), loadImage(file)]);

  let qr = null;
  for (const side of [1600, 1000, 2400]) {
    const { c, ctx } = drawScaled(img, side);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const found = jsQR(data.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
    if (found?.data) { qr = found.data.trim(); break; }
  }

  const { c } = drawScaled(img, 1280);
  const image = c.toDataURL('image/jpeg', 0.85);
  return { qr, image };
}
