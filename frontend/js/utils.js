/** ฟังก์ชันช่วยเหลือฝั่งหน้าเว็บ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** escape HTML กัน XSS */
export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** true ถ้าเป็น URL รูปภาพ (http.. หรือ /path) ไม่ใช่อีโมจิไอคอน */
export const isImgUrl = (s) => /^(https?:\/\/|\/)/.test(String(s || '').trim());

/** คืน HTML แสดงรูปเมนู : <img> ถ้าเป็น URL, อีโมจิถ้าไม่ใช่ */
export function productThumb(image, alt = '') {
  return isImgUrl(image)
    ? `<img src="${esc(image)}" alt="${esc(alt)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'☕'}))">`
    : esc(image || '☕');
}

export const baht = (n) => '฿' + Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 });
export const baht2 = (n) => '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (n, d = 0) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: d });

/** 2026-08-26 14:30:00 → 26 ส.ค. 14:30 */
export function fmtDateTime(s) {
  if (!s) return '-';
  const d = new Date(s.replace(' ', 'T'));
  if (isNaN(d)) return s;
  return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function fmtDate(s) {
  if (!s) return '-';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d)) return s;
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}
export function fmtTime(s) {
  if (!s) return '-';
  const d = new Date(String(s).replace(' ', 'T'));
  return isNaN(d) ? s : d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}
/** เวลาที่ผ่านมา : 5 นาทีที่แล้ว */
export function ago(s) {
  const d = new Date(String(s).replace(' ', 'T'));
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (isNaN(m)) return '-';
  if (m < 1) return 'เมื่อครู่';
  if (m < 60) return `${m} นาทีที่แล้ว`;
  if (m < 1440) return `${Math.floor(m / 60)} ชม.ที่แล้ว`;
  return fmtDate(s);
}
export const todayStr = () => new Date().toLocaleDateString('sv-SE');
export function dateShift(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('sv-SE');
}

// ---------------- ป้ายสถานะ ----------------
export const ORDER_STATUS = {
  pending:   { label: 'รอทำ',     cls: 'b-amber' },
  preparing: { label: 'กำลังทำ',   cls: 'b-blue' },
  ready:     { label: 'พร้อมเสิร์ฟ', cls: 'b-purple' },
  completed: { label: 'สำเร็จ',    cls: 'b-green' },
  cancelled: { label: 'ยกเลิก',    cls: 'b-red' },
};
export const ORDER_TYPE = { dine_in: 'ทานที่ร้าน', takeaway: 'กลับบ้าน', delivery: 'เดลิเวอรี่' };
export const PAYMENT = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', card: 'บัตรเครดิต', transfer: 'โอนเงิน', wallet: 'วอลเล็ต' };
export const PAYMENT_ICON = { cash: '💵', promptpay: '📱', card: '💳', transfer: '🏦', wallet: '👛' };
export const TIER = {
  silver:   { label: 'Silver',   cls: 'b-gray' },
  gold:     { label: 'Gold',     cls: 'b-amber' },
  platinum: { label: 'Platinum', cls: 'b-purple' },
};
export const ROLE = { owner: 'เจ้าของร้าน', manager: 'ผู้จัดการ', staff: 'พนักงาน' };
export const MOVE_TYPE = {
  in: { label: 'รับเข้า', cls: 'b-green' }, out: { label: 'ตัดออก', cls: 'b-gray' },
  adjust: { label: 'ปรับยอด', cls: 'b-blue' }, waste: { label: 'ของเสีย', cls: 'b-red' },
};

export const statusBadge = (s) => {
  const t = ORDER_STATUS[s] || { label: s, cls: 'b-gray' };
  return `<span class="badge ${t.cls}">${t.label}</span>`;
};

// ---------------- Toast ----------------
export function toast(msg, type = 'ok') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${type === 'ok' ? '✅' : type === 'err' ? '⚠️' : 'ℹ️'}</span><span>${esc(msg)}</span>`;
  box.appendChild(el);
  setTimeout(() => {
    el.style.transition = '.2s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 200);
  }, 2800);
}

// ---------------- Modal ----------------
export function modal({ title, body, footer = '', wide = false, onClose }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="x" data-close>&times;</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(bg);
  const close = () => { bg.remove(); onClose && onClose(); };
  bg.addEventListener('click', (e) => {
    if (e.target === bg || e.target.hasAttribute('data-close')) close();
  });
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  return { el: bg, close, body: $('.modal-body', bg), foot: $('.modal-foot', bg) };
}

/** กล่องยืนยัน */
export function confirmBox(message, { title = 'ยืนยันการทำรายการ', danger = false, okText = 'ยืนยัน' } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: `<p style="font-size:14px;line-height:1.6">${esc(message)}</p>`,
      footer: `<button class="btn" data-close>ยกเลิก</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okText)}</button>`,
      onClose: () => resolve(false),
    });
    $('[data-ok]', m.el).addEventListener('click', () => { m.el.remove(); resolve(true); });
  });
}

// ---------------- กราฟ SVG ----------------
/** กราฟแท่ง : data = [{label, value}] */
export function barChart(data, { height = 190, format = baht, highlightLast = true } = {}) {
  if (!data.length) return '<div class="empty">ยังไม่มีข้อมูล</div>';
  const W = 620, H = height, pad = { t: 14, r: 8, b: 26, l: 44 };
  const max = Math.max(...data.map((d) => d.value), 1) * 1.15;
  const cw = (W - pad.l - pad.r) / data.length;
  const bw = Math.min(cw * 0.58, 46);

  const grid = [0, 0.25, 0.5, 0.75, 1].map((p) => {
    const y = pad.t + (H - pad.t - pad.b) * (1 - p);
    return `<line class="gridline" x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}"/>
            <text class="lbl" x="${pad.l - 7}" y="${y + 3.5}" text-anchor="end">${format(max * p)}</text>`;
  }).join('');

  const bars = data.map((d, i) => {
    const h = ((H - pad.t - pad.b) * d.value) / max;
    const x = pad.l + cw * i + (cw - bw) / 2;
    const y = H - pad.b - h;
    const hi = highlightLast && i === data.length - 1 ? ' hi' : '';
    return `<rect class="bar${hi}" x="${x}" y="${y}" width="${bw}" height="${Math.max(h, 1.5)}" rx="5">
              <title>${esc(d.label)} : ${format(d.value)}</title></rect>
            <text class="lbl" x="${x + bw / 2}" y="${H - pad.b + 15}" text-anchor="middle">${esc(d.short || d.label)}</text>`;
  }).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${bars}</svg>`;
}

/** กราฟเส้น + พื้นที่ใต้เส้น */
export function lineChart(data, { height = 190, format = baht } = {}) {
  if (data.length < 2) return barChart(data, { height, format });
  const W = 620, H = height, pad = { t: 14, r: 10, b: 26, l: 46 };
  const max = Math.max(...data.map((d) => d.value), 1) * 1.15;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const px = (i) => pad.l + (iw * i) / (data.length - 1);
  const py = (v) => pad.t + ih * (1 - v / max);

  const grid = [0, 0.5, 1].map((p) => {
    const y = pad.t + ih * (1 - p);
    return `<line class="gridline" x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}"/>
            <text class="lbl" x="${pad.l - 7}" y="${y + 3.5}" text-anchor="end">${format(max * p)}</text>`;
  }).join('');

  const pts = data.map((d, i) => `${px(i)},${py(d.value)}`).join(' ');
  const area = `M ${pad.l},${pad.t + ih} L ${pts.split(' ').join(' L ')} L ${px(data.length - 1)},${pad.t + ih} Z`;
  const dots = data.map((d, i) =>
    `<circle class="dot" cx="${px(i)}" cy="${py(d.value)}" r="3.5"><title>${esc(d.label)} : ${format(d.value)}</title></circle>`).join('');
  const labels = data.map((d, i) => (data.length > 14 && i % 3 !== 0) ? '' :
    `<text class="lbl" x="${px(i)}" y="${H - pad.b + 15}" text-anchor="middle">${esc(d.short || d.label)}</text>`).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="gGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#16a34a" stop-opacity=".28"/>
      <stop offset="100%" stop-color="#16a34a" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}<path class="area" d="${area}"/><polyline class="line" points="${pts}"/>${dots}${labels}</svg>`;
}

/** โดนัท : data = [{label, value}] */
export function donutChart(data, { size = 168 } = {}) {
  const colors = ['#16a34a', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#64748b'];
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return '<div class="empty">ยังไม่มีข้อมูล</div>';
  const R = size / 2, r = R * 0.62;
  let a = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    const ang = (d.value / total) * Math.PI * 2;
    const [x1, y1] = [R + R * Math.cos(a), R + R * Math.sin(a)];
    const [x2, y2] = [R + R * Math.cos(a + ang), R + R * Math.sin(a + ang)];
    const [ix2, iy2] = [R + r * Math.cos(a + ang), R + r * Math.sin(a + ang)];
    const [ix1, iy1] = [R + r * Math.cos(a), R + r * Math.sin(a)];
    const large = ang > Math.PI ? 1 : 0;
    a += ang;
    return `<path d="M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${r} ${r} 0 ${large} 0 ${ix1} ${iy1} Z"
             fill="${colors[i % colors.length]}"><title>${esc(d.label)} : ${Math.round(d.value / total * 100)}%</title></path>`;
  }).join('');

  const legend = data.map((d, i) =>
    `<div><i style="background:${colors[i % colors.length]}"></i>${esc(d.label)}
      <b style="margin-left:4px">${Math.round(d.value / total * 100)}%</b></div>`).join('');

  return `<div class="row" style="gap:20px;flex-wrap:wrap;align-items:center;justify-content:center">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}</svg>
    <div class="legend" style="flex-direction:column;gap:7px">${legend}</div></div>`;
}

export const loadingHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดข้อมูล...</div>';


/** ข้อความเมื่อไม่มีข้อมูล (msg เป็นข้อความคงที่ในโค้ด จึงใส่ HTML ได้) */
export const emptyHTML = (msg = 'ยังไม่มีข้อมูล', em = '📭') =>
  `<div class="empty"><span class="em">${em}</span>${msg}</div>`;
