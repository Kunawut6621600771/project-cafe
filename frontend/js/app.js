/** ผู้ชายขายน้ำ — โครงหลักของแอป (router + layout) */
import { api, auth } from './api.js';
import { $, $$, toast, esc } from './utils.js';
import { initFx, initLoginFx, shakeLogin, pageEnter } from './fx.js';

import dashboard from './pages/dashboard.js';
import pos from './pages/pos.js';
import orders from './pages/orders.js';
import stock from './pages/stock.js';
import members from './pages/members.js';
import reports from './pages/reports.js';
import settings from './pages/settings.js';

const ROUTES = {
  dashboard: { title: 'แดชบอร์ด',      sub: 'ภาพรวมยอดขายและสถานะร้านวันนี้', icon: '📊', page: dashboard, group: 'ภาพรวม' },
  pos:       { title: 'ขายหน้าร้าน',    sub: 'เลือกเมนู คิดเงิน และออกใบเสร็จ', icon: '🛒', page: pos,       group: 'งานขาย' },
  orders:    { title: 'ออเดอร์',        sub: 'คิวหน้าร้านและประวัติการขาย',     icon: '🧾', page: orders,    group: 'งานขาย' },
  stock:     { title: 'คลังวัตถุดิบ',    sub: 'จัดการสต็อกและการรับเข้า-ตัดออก', icon: '📦', page: stock,     group: 'จัดการร้าน' },
  members:   { title: 'สมาชิก',         sub: 'ฐานลูกค้าและแต้มสะสม',           icon: '👥', page: members,   group: 'จัดการร้าน' },
  reports:   { title: 'รายงาน',         sub: 'ยอดขาย กำไร-ขาดทุน และสินค้าขายดี', icon: '📈', page: reports, group: 'จัดการร้าน', roles: ['owner', 'manager'] },
  settings:  { title: 'ตั้งค่าระบบ',     sub: 'ข้อมูลร้าน เมนู พนักงาน และโปรโมชั่น', icon: '⚙️', page: settings, group: 'ระบบ' },
};

const state = { route: 'dashboard', queueCount: 0 };

// ---------------------------------------------------------------
// เข้าสู่ระบบ
// ---------------------------------------------------------------
function bindLogin() {
  const form = $('#loginForm');
  const err = $('#loginError');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.style.display = 'none';
    const btn = $('#loginBtn');
    const lbl = btn.querySelector('.lbl');
    btn.disabled = true;
    btn.classList.add('is-loading');
    lbl.textContent = 'กำลังเข้าสู่ระบบ...';
    try {
      const r = await api.login($('#username').value.trim(), $('#password').value);
      auth.save(r.token, r.user);
      await startApp();
      toast(`ยินดีต้อนรับ ${r.user.full_name}`, 'ok');
    } catch (ex) {
      err.textContent = ex.message;
      err.style.display = 'block';
      shakeLogin();
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      lbl.textContent = 'เข้าสู่ระบบ';
    }
  });
}

function logout() {
  auth.clear();
  $('#app').classList.remove('active');
  $('#loginView').style.display = 'grid';
  location.hash = '';
}

// ---------------------------------------------------------------
// เมนูข้าง
// ---------------------------------------------------------------
function renderNav() {
  const user = auth.user;
  if (!user) return;
  const groups = {};
  Object.entries(ROUTES).forEach(([key, r]) => {
    if (r.roles && !r.roles.includes(user.role)) return;
    groups[r.group] ??= [];
    groups[r.group].push([key, r]);
  });

  $('#nav').innerHTML = Object.entries(groups).map(([g, items]) => `
    <div class="group-label">${esc(g)}</div>
    ${items.map(([key, r]) => `
      <a href="#/${key}" data-route="${key}" class="${state.route === key ? 'active' : ''}">
        <span class="ico">${r.icon}</span><span>${esc(r.title)}</span>
        ${key === 'orders' && state.queueCount ? `<span class="badge-n">${state.queueCount}</span>` : ''}
      </a>`).join('')}
  `).join('');

  $('#userName').textContent = user.full_name;
  $('#userRole').textContent = { owner: 'เจ้าของร้าน', manager: 'ผู้จัดการ', staff: 'พนักงาน' }[user.role];
  $('#userAvatar').textContent = user.full_name.charAt(0);
}

/** เรียกจากหน้าอื่นเพื่ออัปเดตตัวเลขคิวบนเมนู */
export async function refreshQueueBadge() {
  try {
    const q = await api.queue();
    state.queueCount = q.length;
    renderNav();
  } catch { /* เงียบไว้ */ }
}

// ---------------------------------------------------------------
// Router
// ---------------------------------------------------------------
async function route() {
  // ยังไม่ได้เข้าสู่ระบบ (หรือเซสชันหมดอายุ) → ไม่ต้องวาดหน้าใด ๆ
  if (!auth.token || !auth.user) return;

  const key = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
  const r = ROUTES[key] || ROUTES.dashboard;
  if (r.roles && !r.roles.includes(auth.user.role)) {
    toast('คุณไม่มีสิทธิ์เข้าถึงหน้านี้', 'err');
    location.hash = '#/dashboard';
    return;
  }
  state.route = ROUTES[key] ? key : 'dashboard';
  $$('.modal-bg').forEach((el) => el.remove());   // ปิด modal ที่ค้างอยู่เมื่อเปลี่ยนหน้า
  $('#pageTitle').textContent = r.title;
  $('#pageSub').textContent = r.sub;
  $('#sidebar').classList.remove('open');
  renderNav();
  window.scrollTo(0, 0);

  const page = $('#page');
  page.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลด...</div>';
  try {
    await r.page.render(page);
    pageEnter(page);
  } catch (e) {
    page.innerHTML = `<div class="card"><div class="card-body empty">
      <span class="em">⚠️</span>โหลดข้อมูลไม่สำเร็จ<br><small>${esc(e.message)}</small>
      <div style="margin-top:14px"><button class="btn" onclick="location.reload()">ลองใหม่</button></div>
    </div></div>`;
  }
}

// ---------------------------------------------------------------
// เริ่มระบบ
// ---------------------------------------------------------------
async function startApp() {
  $('#loginView').style.display = 'none';
  $('#app').classList.add('active');
  renderNav();

  try {
    const s = await api.settings();
    $('#brandName').textContent = s.shop_name || 'ผู้ชายขายน้ำ';
    $('#brandBranch').textContent = s.shop_branch || '';
    document.title = `${s.shop_name || 'ผู้ชายขายน้ำ'} — ระบบจัดการร้าน`;
  } catch { /* ใช้ค่าเริ่มต้น */ }

  refreshQueueBadge();
  await route();
}

function tickClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleDateString('th-TH', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  }) + ' · ' + now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------
window.addEventListener('hashchange', route);
window.addEventListener('ef:logout', () => { toast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'err'); logout(); });
$('#logoutBtn').addEventListener('click', logout);
$('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

bindLogin();
initLoginFx();
initFx();
tickClock();
setInterval(tickClock, 30000);
setInterval(() => { if (auth.token) refreshQueueBadge(); }, 60000);

if (auth.token) {
  try {
    await api.me();
    await startApp();
  } catch {
    logout();
  }
}
