/** ผู้ชายขายน้ำ — หน้าติดตามออเดอร์ของลูกค้า (อัปเดตสดผ่าน Server-Sent Events) */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baht = (n) => '฿' + Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

const orderNo = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
const token = new URLSearchParams(location.search).get('t') || '';
const qs = `?t=${encodeURIComponent(token)}`;
const API = `/api/track/${encodeURIComponent(orderNo)}`;

const STEPS = [
  { key: 'pending', label: 'รับออเดอร์', ico: '🧾' },
  { key: 'preparing', label: 'กำลังทำ', ico: '☕' },
  { key: 'ready', label: 'พร้อมเสิร์ฟ', ico: '🔔' },
  { key: 'completed', label: 'รับแล้ว', ico: '✓' },
];

const VIEW = {
  pending:   { art: '🧾', title: 'รับออเดอร์แล้ว',            desc: 'ออเดอร์ของคุณอยู่ในคิว บาริสต้าจะเริ่มทำเร็ว ๆ นี้', accent: '#d4141c' },
  preparing: { art: '☕', title: 'กำลังชงเครื่องดื่มของคุณ',   desc: 'บาริสต้ากำลังตั้งใจทำให้อยู่ อีกสักครู่นะคะ',      accent: '#d97706' },
  ready:     { art: '🔔', title: 'พร้อมแล้ว!',                desc: '',                                                accent: '#16a34a' },
  completed: { art: '✅', title: 'ขอบคุณที่อุดหนุนค่ะ',        desc: 'ออเดอร์นี้รับไปเรียบร้อยแล้ว แล้วพบกันใหม่นะคะ',  accent: '#1e3a8a' },
  cancelled: { art: '❌', title: 'ออเดอร์ถูกยกเลิก',          desc: 'หากมีข้อสงสัย ติดต่อพนักงานที่เคาน์เตอร์ได้เลยค่ะ', accent: '#b91c1c' },
};

let last = null;

function renderSteps(status) {
  const idx = STEPS.findIndex((s) => s.key === status);
  const box = $('#steps');
  box.querySelectorAll('.step').forEach((el) => el.remove());
  STEPS.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = `step ${i < idx ? 'done' : ''} ${i === idx ? 'now' : ''}`;
    el.innerHTML = `<div class="dot">${i < idx ? '✓' : s.ico}</div>${s.label}`;
    box.appendChild(el);
  });
  // แถบเขียววิ่งจากจุดแรกถึงจุดปัจจุบัน (ช่วงระหว่างจุดกว้าง 75% ของแถว)
  $('#bar').style.width = idx <= 0 ? '0' : `${(idx / (STEPS.length - 1)) * 75}%`;
  box.style.display = status === 'cancelled' ? 'none' : '';
}

function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#e5262e', '#ffffff', '#f87171', '#18181b', '#4ade80', '#fbbf24'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i');
    c.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};`
      + `--x:${(Math.random() - 0.5) * 160}px;--r:${Math.random() * 720}deg;--d:${2 + Math.random() * 2}s;`
      + `animation-delay:${Math.random() * 0.6}s`;
    box.appendChild(c);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 5000);
}

function render(d) {
  const v = VIEW[d.status] || VIEW.pending;
  const changed = last && last.status !== d.status;

  document.documentElement.style.setProperty('--accent', v.accent);
  $('#shop').textContent = d.shop_name;
  $('#queue').textContent = d.queue_no;
  $('#orderNo').textContent = d.order_no;
  $('#statusCard').className = `card status st-${d.status}`;
  $('#art').textContent = v.art;
  $('#title').textContent = v.title;
  const readyDesc = d.order_type === 'dine_in'
    ? `พนักงานกำลังนำไปเสิร์ฟที่โต๊ะ${d.table_no ? ` ${d.table_no}` : ''}`
    : 'กรุณารับเครื่องดื่มที่เคาน์เตอร์ได้เลยค่ะ';
  $('#desc').textContent = d.status === 'ready' ? readyDesc : v.desc;
  $('#banner').textContent = `🔔 คิว ${d.queue_no} พร้อมแล้ว — แสดงหน้านี้ที่เคาน์เตอร์ได้เลย`;
  renderSteps(d.status);

  $('#items').innerHTML = d.items.map((i) => `
    <div class="it">
      <div class="n">${esc(i.product_name)}${i.options_text ? `<small>${esc(i.options_text)}</small>` : ''}</div>
      <div class="x">x${i.qty}</div>
    </div>`).join('') + `<div class="total"><span>ยอดรวม</span><span>${baht(d.total)}</span></div>`;

  $('#updated').textContent = 'อัปเดตล่าสุด ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.title = d.status === 'ready' ? `🔔 คิว ${d.queue_no} พร้อมแล้ว!` : `${v.title} · คิว ${d.queue_no}`;

  if (['completed', 'cancelled'].includes(d.status)) setLive(false, 'ออเดอร์นี้ปิดแล้ว');

  if (changed && d.status === 'ready') {
    confetti();
    navigator.vibrate?.([200, 100, 200, 100, 400]);
  }
  last = d;
}

function setLive(on, label) {
  $('#live').classList.toggle('on', on);
  $('#live span').textContent = label;
}

function showError(msg) {
  $('#main').innerHTML = `<section class="card error"><div class="em">🔍</div>
    <h2 style="margin:10px 0 6px">ไม่พบออเดอร์</h2><p style="color:var(--muted)">${esc(msg)}</p></section>`;
  setLive(false, 'ไม่ได้เชื่อมต่อ');
}

async function poll() {
  try {
    const res = await fetch(API + qs, { cache: 'no-store' });
    const d = await res.json();
    if (!res.ok) return showError(d.error || 'ลิงก์ไม่ถูกต้อง');
    render(d);
  } catch { /* ออฟไลน์ชั่วคราว รอรอบถัดไป */ }
}

const FAST_POLL_MS = 4000;

/** ใช้แทน stream : ดึงสถานะทุก 4 วินาที (ช้ากว่านิดหน่อยแต่ผ่าน proxy ได้ทุกแบบ) */
function startPolling() {
  setLive(true, 'อัปเดตอัตโนมัติ');
  setInterval(() => { if (!document.hidden && !['completed', 'cancelled'].includes(last?.status)) poll(); }, FAST_POLL_MS);
}

function connect() {
  if (!('EventSource' in window)) return startPolling();

  const es = new EventSource(`${API}/stream${qs}`);
  let gotEvent = false;
  es.addEventListener('status', (e) => {
    gotEvent = true;
    setLive(true, 'อัปเดตสด');
    render(JSON.parse(e.data));
  });
  es.onerror = () => { if (gotEvent) setLive(false, 'กำลังเชื่อมต่อใหม่...'); };   // EventSource ต่อใหม่ให้เอง
  // proxy บางตัว (เช่น Cloudflare Quick Tunnel) พัก stream ไว้ไม่ส่งต่อ → ไม่ได้ข้อมูลใน 6 วิ ให้เปลี่ยนไปดึงเป็นรอบแทน
  setTimeout(() => {
    if (!gotEvent) {
      es.close();
      startPolling();
    }
  }, 6000);
}

// กลับมาที่แท็บ (มือถือมักตัดการเชื่อมต่อตอนพักหน้าจอ) → ดึงสถานะล่าสุดทันที
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
// สำรอง : ดึงซ้ำทุก 30 วินาที เผื่อ proxy บางตัวตัด stream
setInterval(poll, 30000);

if (!orderNo || !token) {
  showError('ลิงก์ไม่ครบ กรุณาเปิดจากข้อความใน LINE อีกครั้ง');
} else {
  poll().then(() => { if (last) connect(); });
}
