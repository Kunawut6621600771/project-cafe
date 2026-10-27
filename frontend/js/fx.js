/** ผู้ชายขายน้ำ — ลูกเล่นหน้าจอ (แอนิเมชัน / เอฟเฟกต์) ไม่ยุ่งกับข้อมูล */
import { $, $$ } from './utils.js';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** คำทักทายตามช่วงเวลา */
function greeting(h) {
  if (h < 5) return '🌙 ดึกแล้ว พักผ่อนบ้างนะ';
  if (h < 11) return '☀️ อรุณสวัสดิ์ เริ่มชงแก้วแรกกัน';
  if (h < 13) return '🍽️ สวัสดียามเที่ยง';
  if (h < 17) return '☕ สวัสดียามบ่าย';
  if (h < 20) return '🌇 สวัสดียามเย็น';
  return '🌙 สวัสดียามค่ำ';
}

function tickLogin() {
  const now = new Date();
  const c = $('#loginClock');
  if (!c) return;
  c.textContent = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  $('#loginDate').textContent = now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'short' });
  $('#loginGreet').textContent = greeting(now.getHours());
}

/** ลูกเล่นหน้าเข้าสู่ระบบ */
export function initLoginFx() {
  tickLogin();
  setInterval(tickLogin, 20000);

  const pw = $('#password');
  const eye = $('#pwToggle');
  eye.addEventListener('click', () => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    eye.textContent = show ? '🙈' : '👁️';
    eye.classList.toggle('on', show);
    eye.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
  });

  // เมาส์ขยับ → การ์ดเอียงตามเล็กน้อย (parallax)
  const card = $('.login-card');
  const wrap = $('#loginView');
  // หลังแอนิเมชันเปิดตัวจบ ปลด animation ออก ไม่งั้น fill-mode จะทับ transform ของ parallax
  card.addEventListener('animationend', (e) => { if (e.animationName === 'cardIn') card.style.animation = 'none'; });
  if (!reduced() && window.matchMedia('(pointer: fine)').matches) {
    wrap.addEventListener('mousemove', (e) => {
      const x = e.clientX / window.innerWidth - 0.5;
      const y = e.clientY / window.innerHeight - 0.5;
      card.style.transform = `perspective(1400px) rotateY(${x * 3}deg) rotateX(${-y * 3}deg)`;
    });
    wrap.addEventListener('mouseleave', () => { card.style.transform = ''; });
  }
}

/** สั่นการ์ดเมื่อเข้าสู่ระบบไม่สำเร็จ */
export function shakeLogin() {
  const card = $('.login-card');
  card.style.transform = '';
  card.style.animation = '';
  card.classList.remove('shake');
  void card.offsetWidth;
  card.classList.add('shake');
}

/** คลื่นวงกลมตอนคลิกปุ่ม */
function bindRipple() {
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.btn, .cat-bar button');
    if (!btn || btn.disabled || reduced()) return;
    const r = btn.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
    btn.style.overflow = 'hidden';
    btn.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
  });
}

/** ตัวเลขใน KPI นับขึ้นจาก 0 */
function countUp(root) {
  if (reduced()) return;
  $$('.kpi .value', root).forEach((el) => {
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.textContent));
    if (!node) return;
    const m = node.textContent.match(/^(\D*?)(\d[\d,]*)(\.\d+)?(.*)$/s);
    if (!m) return;
    const [, pre, int, dec = '', post] = m;
    const target = Number(int.replace(/,/g, '') + dec);
    if (!target) return;
    const digits = dec ? dec.length - 1 : 0;
    const fmt = (v) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const t0 = performance.now();
    const dur = 900;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      node.textContent = pre + (int.includes(',') ? fmt(target * e) : (target * e).toFixed(digits)) + post;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** เรียกหลังวาดหน้าใหม่ : ลอยขึ้นทีละส่วน + หัวข้อเลื่อนเข้า + นับตัวเลข */
export function pageEnter(page) {
  page.classList.remove('enter');
  void page.offsetWidth;
  page.classList.add('enter');
  clearTimeout(page._fxT);
  page._fxT = setTimeout(() => page.classList.remove('enter'), 1100);
  ['#pageTitle', '#pageSub'].forEach((sel) => {
    const el = $(sel);
    el.classList.remove('swap');
    void el.offsetWidth;
    el.classList.add('swap');
  });
  countUp(page);
}

/** ป้ายจำนวนในตะกร้าเด้งเมื่อมีการเปลี่ยนแปลง */
function bindCartBump() {
  new MutationObserver((list) => {
    for (const m of list) {
      const el = (m.target.nodeType === 3 ? m.target.parentElement : m.target)?.closest?.('#cartCount');
      if (el) {
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
        return;
      }
    }
  }).observe($('#page'), { subtree: true, childList: true, characterData: true });
}

export function initFx() {
  bindRipple();
  bindCartBump();
}
