/** ผู้ชายขายน้ำ — ใบเสร็จรับเงิน (แสดงบนจอ + พิมพ์เฉพาะใบเสร็จ) */
import { api } from './api.js';
import { $, esc, baht2, modal, ORDER_TYPE, PAYMENT, fmtDateTime } from './utils.js';

// ---------------------------------------------------------------
// ไอคอน (SVG ในตัว พิมพ์ออกได้แม้ปิด "พิมพ์พื้นหลัง")
// ---------------------------------------------------------------
const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <circle cx="32" cy="32" r="31" fill="#2b1a0f"/>
  <circle cx="32" cy="32" r="27" fill="none" stroke="#e8c9a0" stroke-width="1.2" stroke-dasharray="2 2.5"/>
  <path d="M34 19.5 36.5 11l3.2-.8" fill="none" stroke="#e8c9a0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M22 21.5h19l-2.4 21.6a3 3 0 0 1-3 2.7h-8.2a3 3 0 0 1-3-2.7z" fill="#fdf7ee"/>
  <path d="M23.1 29h16.8l-1.6 14a2 2 0 0 1-2 1.8h-9.6a2 2 0 0 1-2-1.8z" fill="#8c5226"/>
  <path d="M23.4 31.7c2.8 1.3 5.3-.9 8.1 0 2.9.9 5.3 1.3 8.1 0l-.3 2.6c-2.8 1.2-5.2-.4-7.8-.4-2.7 0-5.3 1.7-7.8.4z" fill="#f6e3cb"/>
  <rect x="20" y="18.9" width="23" height="3.4" rx="1.7" fill="#e0a463"/>
  <path d="M17 51h30" stroke="#e8c9a0" stroke-width="2.2" stroke-linecap="round"/>
</svg>`;

const ICON = {
  line: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="11" fill="#06C755"/>
    <path fill="#fff" d="M24 10c-9.4 0-17 6.1-17 13.6 0 6.7 6 12.3 14.2 13.4.6.1 1.3.4 1.5.9.2.4.1 1.1.1 1.5l-.2 1.4c-.1.4-.3 1.6 1.4.9 1.7-.7 9.3-5.5 12.7-9.4 2.3-2.6 3.4-5.2 3.4-8.2C41 16.1 33.4 10 24 10z"/>
    <text x="24" y="27" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-size="8.5" fill="#06C755">LINE</text></svg>`,
  facebook: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="#1877F2"/>
    <path fill="#fff" d="M26.5 38V25.6h4.2l.6-4.9h-4.8v-3.1c0-1.4.4-2.4 2.4-2.4h2.6v-4.4c-.4-.1-2-.2-3.8-.2-3.8 0-6.3 2.3-6.3 6.5v3.6h-4.2v4.9h4.2V38z"/></svg>`,
  instagram: `<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="igG" x1="0" y1="1" x2="1" y2="0">
    <stop offset="0" stop-color="#FEDA75"/><stop offset=".35" stop-color="#FA7E1E"/><stop offset=".6" stop-color="#D62976"/>
    <stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs><rect width="48" height="48" rx="13" fill="url(#igG)"/>
    <rect x="12" y="12" width="24" height="24" rx="7" fill="none" stroke="#fff" stroke-width="3"/>
    <circle cx="24" cy="24" r="5.5" fill="none" stroke="#fff" stroke-width="3"/><circle cx="31.5" cy="16.5" r="1.8" fill="#fff"/></svg>`,
  phone: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="#2b1a0f"/>
    <path fill="#fff" d="M19.3 13.5l2.6 5.6c.3.7.1 1.5-.4 2l-2.2 2c1.3 2.8 3.5 5 6.3 6.3l2-2.2c.5-.6 1.3-.7 2-.4l5.6 2.6c.8.4 1.2 1.2 1 2l-.8 3.4c-.2.8-.9 1.4-1.7 1.4C22.7 36.2 11.8 25.3 11.8 13c0-.8.6-1.5 1.4-1.7l3.4-.8c.8-.2 1.6.2 2 1z"/></svg>`,
  web: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="#8a5a34"/>
    <g fill="none" stroke="#fff" stroke-width="2.4"><circle cx="24" cy="24" r="12"/><path d="M12 24h24M24 12c-4 4-4 20 0 24M24 12c4 4 4 20 0 24"/></g></svg>`,
};

// ---------------------------------------------------------------
const queueNo = (orderNo) => `#${String(orderNo).split('-').pop()}`;
const handle = (s) => String(s || '').trim().replace(/^https?:\/\/(www\.)?(facebook|instagram)\.com\//i, '').replace(/\/$/, '');

function itemRow(i) {
  const subs = [i.options_text, i.note].filter(Boolean);
  return `
    <div class="rc-item">
      <div class="rc-item-name"><span class="q">${i.qty}×</span>${esc(i.product_name)}
        ${subs.map((s) => `<small>${esc(s)}</small>`).join('')}</div>
      <div class="rc-item-amt">${baht2(i.line_total)}</div>
    </div>`;
}

const row = (k, v, cls = '') => `<div class="rc-row ${cls}"><span>${k}</span><span>${v}</span></div>`;

/** ช่องทางติดตาม & ติดต่อ — แสดงเฉพาะช่องทางที่ตั้งไว้ */
function socialHTML(shop, lineId) {
  const items = [
    lineId && ['line', 'LINE', esc(lineId)],
    shop.facebook && ['facebook', 'Facebook', esc(handle(shop.facebook))],
    shop.instagram && ['instagram', 'Instagram', '@' + esc(handle(shop.instagram).replace(/^@/, ''))],
    shop.phone && ['phone', 'โทร', esc(shop.phone)],
    shop.website && ['web', 'เว็บไซต์', esc(shop.website.replace(/^https?:\/\//, ''))],
  ].filter(Boolean);
  if (!items.length) return '';
  const hours = shop.open_time && shop.close_time ? `<div class="rc-hours">เปิดทุกวัน ${esc(shop.open_time)} – ${esc(shop.close_time)} น.</div>` : '';
  return `
    <div class="rc-sec-title"><span>ติดตามเรา & ติดต่อร้าน</span></div>
    <div class="rc-social">
      ${items.map(([ico, label, val]) => `
        <div class="rc-soc">${ICON[ico]}<div><small>${label}</small><b>${val}</b></div></div>`).join('')}
    </div>${hours}`;
}

/** ส่วน LINE : QR รับแจ้งเตือน + QR ดูสถานะออนไลน์ */
function lineHTML(l) {
  if (!l?.enabled) return '';
  return `
    <div class="rc-line">
      <div class="rc-line-head">${ICON.line}<div><b>ติดตามสถานะออเดอร์ผ่าน LINE</b>
        <small>บาริสต้าจะแจ้งทุกขั้นตอน จนเครื่องดื่มพร้อมเสิร์ฟ</small></div></div>
      <div class="rc-qrs ${l.track_qr ? 'two' : ''}">
        <figure><img src="${l.qr}" alt="QR LINE"><figcaption>① สแกนด้วยแอป LINE<br>แล้ว<b>กดส่งข้อความ</b>ที่ขึ้นมา</figcaption></figure>
        ${l.track_qr ? `<figure><img src="${l.track_qr}" alt="QR ติดตามออเดอร์"><figcaption>② ดูสถานะสด<br>ผ่านเว็บ</figcaption></figure>` : ''}
      </div>
      ${l.linked ? '<div class="rc-linked">✓ ผูก LINE กับออเดอร์นี้แล้ว</div>' : ''}
    </div>`;
}

function receiptHTML(o, l) {
  const s = o.shop;
  const lineId = s.line_id || l?.basic_id || '';
  const paid = PAYMENT[o.payment_method] || '-';
  return `
  <div class="rc" id="receiptPrint">
    <header class="rc-head">
      <div class="rc-logo">${LOGO}</div>
      <div class="rc-name">${esc(s.name)}</div>
      ${s.branch ? `<div class="rc-branch">${esc(s.branch)}</div>` : ''}
      ${s.address ? `<div class="rc-addr">${esc(s.address)}</div>` : ''}
      ${s.phone ? `<div class="rc-addr">โทร. ${esc(s.phone)}</div>` : ''}
      ${s.tax_id ? `<div class="rc-addr">เลขประจำตัวผู้เสียภาษี ${esc(s.tax_id)}</div>` : ''}
    </header>

    <div class="rc-title"><b>ใบเสร็จรับเงิน</b><small>RECEIPT</small></div>

    <div class="rc-queue">
      <div><small>หมายเลขคิว</small><b>${queueNo(o.order_no)}</b></div>
      <div class="rc-type">${ORDER_TYPE[o.order_type] || ''}${o.table_no ? `<br>โต๊ะ ${esc(o.table_no)}` : ''}</div>
    </div>

    <div class="rc-meta">
      ${row('เลขที่', esc(o.order_no))}
      ${row('วันที่', fmtDateTime(o.created_at))}
      ${row('พนักงาน', esc(o.cashier || '-'))}
      ${o.member_name ? row('สมาชิก', esc(o.member_name)) : ''}
    </div>

    <div class="rc-items">
      <div class="rc-items-head"><span>รายการ</span><span>จำนวนเงิน</span></div>
      ${o.items.map(itemRow).join('')}
    </div>

    <div class="rc-sum">
      ${row('รวม', baht2(o.subtotal))}
      ${o.discount ? row(`ส่วนลด${o.promotion_name ? ` (${esc(o.promotion_name)})` : ''}`, `-${baht2(o.discount)}`, 'disc') : ''}
    </div>
    <div class="rc-total"><span>ยอดสุทธิ</span><b>${baht2(o.total)}</b></div>

    <div class="rc-pay">
      ${row('ชำระโดย', paid)}
      ${o.slip ? row('อ้างอิงสลิป', esc(o.slip.trans_ref)) : ''}
      ${o.payment_method === 'cash' ? row('รับเงิน', baht2(o.received)) + row('เงินทอน', baht2(o.change_amount)) : ''}
    </div>
    ${o.points_earned ? `<div class="rc-points">⭐ ได้รับ <b>+${o.points_earned}</b> แต้มสะสม</div>` : ''}

    <div id="lineBox">${lineHTML(l)}</div>
    <div id="socialBox">${socialHTML(s, lineId)}</div>

    <footer class="rc-foot">
      <div class="rc-thanks">${esc(s.footer || 'ขอบคุณที่ใช้บริการ')}</div>
      <div class="rc-cut"><span>✂</span></div>
      <div class="rc-powered">${esc(o.order_no)} · ระบบร้าน${esc(s.name)}</div>
    </footer>
  </div>`;
}

// ---------------------------------------------------------------
// พิมพ์เฉพาะใบเสร็จ : คัดลอกใบเสร็จไปไว้ใน #printArea แล้วซ่อนทุกอย่างอื่นตอนพิมพ์
// ---------------------------------------------------------------
async function printReceipt(node) {
  document.getElementById('printArea')?.remove();
  const area = document.createElement('div');
  area.id = 'printArea';
  area.innerHTML = node.outerHTML.replace('id="receiptPrint"', '');
  document.body.appendChild(area);
  // รอให้รูป QR โหลดเสร็จก่อนสั่งพิมพ์
  await Promise.all([...area.querySelectorAll('img')].map((img) => (img.complete ? null
    : new Promise((r) => { img.onload = r; img.onerror = r; }))));
  document.body.classList.add('print-receipt');
  const done = () => {
    document.body.classList.remove('print-receipt');
    area.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(() => { if (document.body.contains(area)) done(); }, 1000);
}

export async function showReceipt(orderId) {
  const [o, l] = await Promise.all([
    api.order(orderId),
    api.orderLineLink(orderId).catch(() => null),   // ไม่มี LINE ก็แสดงใบเสร็จตามปกติ
  ]);
  const m = modal({
    title: 'ใบเสร็จรับเงิน',
    body: `<div class="rc-paper">${receiptHTML(o, l)}</div>`,
    footer: `<button class="btn" data-close>ปิด</button>
             <button class="btn btn-primary" id="printBtn">🖨️ พิมพ์ใบเสร็จ</button>`,
  });
  m.el.classList.add('rc-modal');
  $('#printBtn', m.el).addEventListener('click', () => printReceipt($('#receiptPrint', m.el)));
}
