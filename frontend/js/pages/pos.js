/** หน้าขายหน้าร้าน (POS) */
import { api } from '../api.js';
import { refreshQueueBadge } from '../app.js';
import {
  $, $$, esc, baht, baht2, num, toast, modal, emptyHTML, productThumb, isImgUrl,
  ORDER_TYPE, PAYMENT, PAYMENT_ICON, PAY_METHODS,
} from '../utils.js';
import { readSlip } from '../slip.js';
import { showReceipt } from '../receipt.js';

let nextUid = 1;      // รหัสบรรทัดในตะกร้า (ใช้แยกบรรทัดเท่านั้น)
const cart = {
  items: [],          // {uid, product, qty, options:[{id,name,price_delta}], note}
  type: 'takeaway',
  table: '',
  member: null,
  promo: null,        // {code,name,type,value,min_total}
  note: '',
};

let products = [], categories = [], activeCat = 'all', keyword = '';

export default {
  async render(root) {
    [categories, products] = await Promise.all([api.categories(), api.products({ available: 1 })]);

    root.innerHTML = `
      <div class="pos">
        <div class="pos-left">
          <div class="row" style="margin-bottom:12px">
            <div class="search" style="flex:1;max-width:340px">
              <input class="input" id="posSearch" placeholder="ค้นหาเมนู... (กด / เพื่อค้นหา)">
            </div>
            <div class="spacer"></div>
            <span class="badge b-gray" id="menuCount"></span>
          </div>
          <div class="cat-bar" id="catBar"></div>
          <div class="menu-grid" id="menuGrid"></div>
        </div>

        <div class="cart">
          <div class="cart-head">
            <div class="ttl">🛒 ตะกร้าสินค้า <span class="badge b-green" id="cartCount">0 รายการ</span>
              <div class="spacer"></div>
              <button class="btn btn-sm btn-ghost" id="clearCart" title="ล้างตะกร้า">🗑️</button>
            </div>
            <div class="type-tabs" id="typeTabs">
              ${Object.entries(ORDER_TYPE).map(([k, v]) =>
                `<button data-type="${k}" class="${cart.type === k ? 'active' : ''}">${v}</button>`).join('')}
            </div>
            <div id="tableBox" style="margin-top:9px;display:none">
              <input class="input" id="tableNo" placeholder="หมายเลขโต๊ะ เช่น A5" value="${esc(cart.table)}">
            </div>
          </div>

          <div class="cart-items" id="cartItems"></div>

          <div class="cart-foot">
            <div id="memberBox"></div>
            <div class="sum-line"><span>ยอดรวม</span><span id="sumSub" class="mono">฿0</span></div>
            <div class="sum-line" id="discLine" style="display:none;color:var(--red)">
              <span id="discLabel">ส่วนลด</span><span id="sumDisc" class="mono">-฿0</span>
            </div>
            <div class="sum-line total"><span>ยอดสุทธิ</span><span id="sumTotal" class="mono">฿0</span></div>
            <div class="row" style="gap:7px;margin-bottom:9px">
              <button class="btn btn-sm" id="btnMember" style="flex:1">👤 สมาชิก</button>
              <button class="btn btn-sm" id="btnPromo" style="flex:1">🎟️ ส่วนลด</button>
            </div>
            <button class="btn btn-primary btn-lg btn-block" id="btnPay" disabled>ชำระเงิน</button>
          </div>
        </div>
      </div>`;

    renderCats();
    renderMenu();
    renderCart();

    $('#posSearch').addEventListener('input', (e) => { keyword = e.target.value.trim(); renderMenu(); });
    $('#catBar').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      activeCat = b.dataset.cat;
      renderCats(); renderMenu();
    });
    $('#menuGrid').addEventListener('click', (e) => {
      const el = e.target.closest('.menu-item');
      if (!el || el.classList.contains('off')) return;
      openProduct(products.find((p) => p.id === Number(el.dataset.id)));
    });
    $('#typeTabs').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      cart.type = b.dataset.type;
      $$('#typeTabs button').forEach((x) => x.classList.toggle('active', x === b));
      $('#tableBox').style.display = cart.type === 'dine_in' ? 'block' : 'none';
    });
    $('#tableNo').addEventListener('input', (e) => { cart.table = e.target.value; });
    $('#clearCart').addEventListener('click', () => {
      if (!cart.items.length) return;
      cart.items = []; cart.member = null; cart.promo = null;
      renderCart(); toast('ล้างตะกร้าแล้ว', 'warn');
    });
    $('#btnMember').addEventListener('click', memberDialog);
    $('#btnPromo').addEventListener('click', promoDialog);
    $('#btnPay').addEventListener('click', payDialog);

    document.addEventListener('keydown', hotkey);
    root.addEventListener('ef:destroy', () => document.removeEventListener('keydown', hotkey));
  },
};

function hotkey(e) {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    $('#posSearch')?.focus();
  }
}

// ---------------------------------------------------------------
function renderCats() {
  const counts = { all: products.length };
  products.forEach((p) => { counts[p.category_id] = (counts[p.category_id] || 0) + 1; });
  $('#catBar').innerHTML = `
    <button data-cat="all" class="${activeCat === 'all' ? 'active' : ''}">ทั้งหมด (${counts.all})</button>
    ${categories.map((c) => catButton(c, counts[c.id] || 0)).join('')}`;
}

function slipModeLabel(provider) {
  if (!provider) return 'อ่าน QR + ยืนยันโดยพนักงาน';
  return provider === 'easyslip' ? 'ตรวจผ่าน EasySlip' : 'ตรวจผ่าน SlipOK';
}

function catButton(c, count) {
  const cls = activeCat == c.id ? 'active' : '';
  return `<button data-cat="${c.id}" class="${cls}">
        ${c.icon} ${esc(c.name)} (${count})</button>`;
}

function filtered() {
  return products.filter((p) =>
    (activeCat === 'all' || p.category_id == activeCat) &&
    (!keyword || p.name.toLowerCase().includes(keyword.toLowerCase())));
}

/** วัตถุดิบหมด (ทำไม่ได้แม้แต่ 1 แก้ว) → ขายไม่ได้ */
const soldOut = (p) => !p.is_available || p.can_make === 0;
const LOW_MAKE = 10;

/** ดึงจำนวนที่ทำได้ใหม่หลังขาย (สต็อกถูกตัดตามสูตรแล้ว) */
async function refreshStock() {
  try {
    products = await api.products({ available: 1 });
    renderMenu();
  } catch { /* ไม่เป็นไร รอบหน้าค่อยโหลดใหม่ */ }
}

function renderMenu() {
  const list = filtered();
  $('#menuCount').textContent = `${list.length} เมนู`;
  $('#menuGrid').innerHTML = list.length ? list.map((p) => `
    <div class="menu-item ${soldOut(p) ? 'off' : ''}" data-id="${p.id}"
         ${p.can_make === 0 && p.is_available ? 'data-why="วัตถุดิบหมด"' : ''}>
      ${p.is_recommended ? '<span class="tag-rec">แนะนำ</span>' : ''}
      ${p.can_make > 0 && p.can_make <= LOW_MAKE ? `<span class="tag-left">เหลือ ${p.can_make}</span>` : ''}
      <div class="thumb">${productThumb(p.image, p.name)}</div>
      <div class="info">
        <div class="nm">${esc(p.name)}</div>
        <div class="pr">${baht(p.price)}</div>
      </div>
    </div>`).join('') : emptyHTML('ไม่พบเมนูที่ค้นหา', '🔍');
}

// ---------------------------------------------------------------
// เลือกตัวเลือกสินค้า
// ---------------------------------------------------------------
function openProduct(p) {
  if (!p) return;
  if (!p.option_groups?.length) return addToCart(p, 1, [], '');

  const m = modal({
    title: `${isImgUrl(p.image) ? '☕' : (p.image || '☕')} ${p.name}`,
    body: `
      ${isImgUrl(p.image) ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" style="width:100%;max-height:180px;object-fit:cover;border-radius:12px;margin-bottom:12px">` : ''}
      <div style="color:var(--muted);font-size:13px;margin-bottom:16px">${esc(p.description || '')}</div>
      ${p.option_groups.map((g) => `
        <div class="opt-group">
          <div class="gname">${esc(g.name)} ${g.is_required ? '<span>* จำเป็น</span>' : ''}</div>
          <div class="opt-list">
            ${g.options.map((o) => `
              <label><input type="${g.select_type === 'multi' ? 'checkbox' : 'radio'}"
                     name="g${g.id}" value="${o.id}" data-price="${o.price_delta}"
                     ${o.is_default ? 'checked' : ''}>
                <span>${esc(o.name)}</span></label>`).join('')}
          </div>
        </div>`).join('')}
      <div class="field"><label>หมายเหตุถึงบาริสต้า</label>
        <input class="input" id="itemNote" placeholder="เช่น แยกน้ำแข็ง / ไม่ใส่หลอด"></div>
      <div class="row" style="justify-content:space-between;padding-top:6px;border-top:1px solid var(--line-2)">
        <div class="qty" style="margin:0">
          <button type="button" id="qMinus">−</button><span id="qVal">1</span><button type="button" id="qPlus">+</button>
        </div>
        <div style="font-size:19px;font-weight:700" id="optTotal">${baht(p.price)}</div>
      </div>`,
    footer: `<button class="btn" data-close>ยกเลิก</button>
             <button class="btn btn-primary" id="addBtn">เพิ่มลงตะกร้า</button>`,
  });

  let qty = 1;
  const calc = () => {
    const extra = $$('input:checked', m.el).reduce((s, i) => s + Number(i.dataset.price), 0);
    $('#optTotal', m.el).textContent = baht((p.price + extra) * qty);
  };
  $('#qMinus', m.el).addEventListener('click', () => { qty = Math.max(1, qty - 1); $('#qVal', m.el).textContent = qty; calc(); });
  $('#qPlus', m.el).addEventListener('click', () => { qty++; $('#qVal', m.el).textContent = qty; calc(); });
  m.el.addEventListener('change', calc);

  $('#addBtn', m.el).addEventListener('click', () => {
    // ตรวจกลุ่มที่จำเป็น
    for (const g of p.option_groups) {
      if (g.is_required && !$(`input[name="g${g.id}"]:checked`, m.el)) {
        return toast(`กรุณาเลือก "${g.name}"`, 'err');
      }
    }
    const opts = $$('input:checked', m.el).map((i) => {
      const o = p.option_groups.flatMap((g) => g.options).find((x) => x.id === Number(i.value));
      return { id: o.id, name: o.name, price_delta: o.price_delta };
    });
    addToCart(p, qty, opts, $('#itemNote', m.el).value.trim());
    m.close();
  });
  calc();
}

function addToCart(product, qty, options, note) {
  const sig = options.map((o) => o.id).sort().join(',') + '|' + note;
  const found = cart.items.find((i) => i.product.id === product.id && i.sig === sig);
  if (found) found.qty += qty;
  else cart.items.push({ uid: nextUid++, product, qty, options, note, sig });
  renderCart();
  const inCart = cart.items.filter((i) => i.product.id === product.id).reduce((s, i) => s + i.qty, 0);
  if (product.can_make != null && inCart > product.can_make) {
    toast(`⚠️ วัตถุดิบพอทำ ${product.name} ได้อีกแค่ ${product.can_make} ที่ — ตรวจสต็อกก่อนรับออเดอร์`, 'warn');
  } else {
    toast(`เพิ่ม ${product.name} แล้ว`, 'ok');
  }
}

// ---------------------------------------------------------------
function lineTotal(it) {
  return (it.product.price + it.options.reduce((s, o) => s + o.price_delta, 0)) * it.qty;
}
function totals() {
  const subtotal = cart.items.reduce((s, i) => s + lineTotal(i), 0);
  let discount = 0, label = 'ส่วนลด';
  if (cart.promo && subtotal >= cart.promo.min_total) {
    discount = cart.promo.type === 'percent'
      ? Math.round(subtotal * cart.promo.value / 100)
      : Number(cart.promo.value);
    label = `ส่วนลด (${cart.promo.code})`;
  }
  discount = Math.min(discount, subtotal);
  return { subtotal, discount, label, total: subtotal - discount };
}

function renderCart() {
  const box = $('#cartItems');
  if (!box) return;
  box.innerHTML = cart.items.length ? cart.items.map((it) => `
    <div class="cart-line" data-uid="${it.uid}">
      <div style="flex:1;min-width:0">
        <div class="nm">${esc(it.product.name)}</div>
        ${it.options.length ? `<div class="op">${esc(it.options.map((o) => o.name).join(', '))}</div>` : ''}
        ${it.note ? `<div class="op" style="color:var(--amber)">📝 ${esc(it.note)}</div>` : ''}
        <div class="qty">
          <button data-act="minus">−</button><span>${it.qty}</span><button data-act="plus">+</button>
          <button data-act="del" style="border-color:transparent;color:var(--red)">🗑</button>
        </div>
      </div>
      <div class="price">${baht(lineTotal(it))}</div>
    </div>`).join('') : emptyHTML('ยังไม่มีสินค้าในตะกร้า<br><small>เลือกเมนูทางซ้ายเพื่อเริ่มขาย</small>', '🛒');

  box.onclick = (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const uid = Number(b.closest('.cart-line').dataset.uid);
    const it = cart.items.find((x) => x.uid === uid);
    if (b.dataset.act === 'plus') it.qty++;
    else if (b.dataset.act === 'minus') { it.qty--; if (it.qty <= 0) cart.items = cart.items.filter((x) => x.uid !== uid); }
    else cart.items = cart.items.filter((x) => x.uid !== uid);
    renderCart();
  };

  const t = totals();
  $('#cartCount').textContent = `${cart.items.reduce((s, i) => s + i.qty, 0)} รายการ`;
  $('#sumSub').textContent = baht(t.subtotal);
  $('#sumTotal').textContent = baht(t.total);
  $('#discLine').style.display = t.discount ? 'flex' : 'none';
  $('#discLabel').textContent = t.label;
  $('#sumDisc').textContent = '-' + baht(t.discount);
  $('#btnPay').disabled = !cart.items.length;
  $('#btnPay').textContent = cart.items.length ? `ชำระเงิน ${baht(t.total)}` : 'ชำระเงิน';

  $('#memberBox').innerHTML = cart.member ? `
    <div class="member-chip">
      <span>👤</span>
      <div style="flex:1"><b>${esc(cart.member.name)}</b>
        <div style="color:var(--muted);font-size:11.5px">${esc(cart.member.phone || '')} · ${num(cart.member.points)} แต้ม</div>
      </div>
      <button class="btn btn-sm btn-ghost" id="rmMember">✕</button>
    </div>` : '';
  const rm = $('#rmMember');
  if (rm) rm.onclick = () => { cart.member = null; renderCart(); };
}

// ---------------------------------------------------------------
function memberDialog() {
  const m = modal({
    title: 'เลือกสมาชิก',
    body: `
      <div class="search" style="margin-bottom:14px">
        <input class="input" id="mSearch" placeholder="ค้นหาชื่อ / เบอร์โทร / รหัสสมาชิก" autofocus>
      </div>
      <div id="mResult">${emptyHTML('พิมพ์เพื่อค้นหาสมาชิก', '🔍')}</div>`,
    footer: `<button class="btn" data-close>ปิด</button>
             <button class="btn btn-primary" id="newMember">+ สมัครสมาชิกใหม่</button>`,
  });

  let timer;
  $('#mSearch', m.el).addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (!q) {
      $('#mResult', m.el).innerHTML = emptyHTML('พิมพ์เพื่อค้นหาสมาชิก', '🔍');
      return;
    }
    timer = setTimeout(async () => showMemberResults(m, await api.searchMember(q)), 250);
  });

  $('#newMember', m.el).addEventListener('click', () => { m.close(); newMemberDialog(); });
}

function showMemberResults(m, list) {
  $('#mResult', m.el).innerHTML = list.length ? list.map((x) => `
    <div class="rank-row" style="cursor:pointer" data-id="${x.id}">
      <div class="rank-no" style="background:var(--brand-100);color:var(--brand-800)">${esc(x.name.charAt(0))}</div>
      <div style="flex:1"><b>${esc(x.name)}</b>
        <div style="font-size:12px;color:var(--muted)">${esc(x.phone || '-')} · ${esc(x.code)}</div></div>
      <div style="text-align:right"><b>${num(x.points)}</b><div style="font-size:11px;color:var(--muted)">แต้ม</div></div>
    </div>`).join('') : emptyHTML('ไม่พบสมาชิก');
  $$('#mResult .rank-row', m.el).forEach((r) => {
    r.onclick = () => {
      cart.member = list.find((x) => x.id === Number(r.dataset.id));
      renderCart(); m.close(); toast(`เลือกสมาชิก ${cart.member.name}`, 'ok');
    };
  });
}

function newMemberDialog() {
  const m = modal({
    title: 'สมัครสมาชิกใหม่',
    body: `
      <div class="field"><label>ชื่อ-นามสกุล *</label><input class="input" id="nName" autofocus></div>
      <div class="field"><label>เบอร์โทรศัพท์ *</label><input class="input" id="nPhone" placeholder="08X-XXX-XXXX"></div>
      <div class="field"><label>อีเมล</label><input class="input" id="nEmail" type="email"></div>`,
    footer: `<button class="btn" data-close>ยกเลิก</button>
             <button class="btn btn-primary" id="saveM">บันทึกและเลือก</button>`,
  });
  $('#saveM', m.el).addEventListener('click', async () => {
    try {
      const created = await api.post('/members', {
        name: $('#nName', m.el).value.trim(),
        phone: $('#nPhone', m.el).value.trim(),
        email: $('#nEmail', m.el).value.trim() || null,
      });
      cart.member = created;
      renderCart(); m.close();
      toast('สมัครสมาชิกเรียบร้อย', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });
}

async function promoDialog() {
  const promos = (await api.promotions()).filter((p) => p.is_active);
  const t = totals();
  const m = modal({
    title: 'เลือกส่วนลด',
    body: promos.length ? promos.map((p) => {
      const ok = t.subtotal >= p.min_total;
      return `<div class="rank-row" style="cursor:${ok ? 'pointer' : 'not-allowed'};opacity:${ok ? 1 : .45}"
                   data-code="${esc(p.code)}">
        <div class="rank-no" style="background:var(--amber-bg);color:#b45309">🎟️</div>
        <div style="flex:1"><b>${esc(p.name)}</b>
          <div style="font-size:12px;color:var(--muted)">โค้ด ${esc(p.code)}
            ${p.min_total ? `· ขั้นต่ำ ${baht(p.min_total)}` : ''}</div></div>
        <div><span class="badge b-amber">${p.type === 'percent' ? `-${p.value}%` : `-${baht(p.value)}`}</span></div>
      </div>`;
    }).join('') : emptyHTML('ยังไม่มีโปรโมชั่น', '🎟️'),
    footer: `<button class="btn" id="clearPromo">ไม่ใช้ส่วนลด</button>
             <button class="btn" data-close>ปิด</button>`,
  });
  $$('.rank-row[data-code]', m.el).forEach((r) => r.onclick = () => {
    const p = promos.find((x) => x.code === r.dataset.code);
    if (t.subtotal < p.min_total) return toast(`ต้องซื้อขั้นต่ำ ${baht(p.min_total)}`, 'err');
    cart.promo = p; renderCart(); m.close(); toast(`ใช้ส่วนลด ${p.name}`, 'ok');
  });
  $('#clearPromo', m.el).onclick = () => { cart.promo = null; renderCart(); m.close(); };
}

// ---------------------------------------------------------------
// ชำระเงิน
// ---------------------------------------------------------------
async function payDialog() {
  const t = totals();
  let payCfg;
  try { payCfg = await api.paymentConfig(); } catch (e) { return toast(e.message, 'err'); }

  const m = modal({
    title: 'ชำระเงิน',
    wide: true,
    body: `
      <div class="pay-layout">
        <div>
          <div style="text-align:center;padding:14px;background:var(--brand-50);border-radius:12px;margin-bottom:18px">
            <div style="color:var(--muted);font-size:13px">ยอดที่ต้องชำระ</div>
            <div style="font-size:34px;font-weight:700;color:var(--brand-800)" id="dueBig">${baht2(t.total)}</div>
            ${t.discount ? `<div style="font-size:12px;color:var(--red)">ประหยัดไป ${baht(t.discount)}</div>` : ''}
          </div>

          <div class="field"><label>ช่องทางชำระเงิน</label>
            <div class="pay-methods">
              ${PAY_METHODS.map((k, i) => `
                <label><input type="radio" name="pay" value="${k}" ${i === 0 ? 'checked' : ''}>
                  <span class="em">${PAYMENT_ICON[k]}</span>${PAYMENT[k]}</label>`).join('')}
            </div>
          </div>

          <div id="cashBox">
            <div class="field"><label>รับเงินมา</label>
              <input class="input" id="received" type="number" inputmode="decimal" value="${t.total}" style="font-size:19px;font-weight:600">
              <div class="quick-cash">
                ${[t.total, 100, 500, 1000].filter((v, i, a) => a.indexOf(v) === i)
                  .map((v) => `<button type="button" class="btn btn-sm" data-cash="${v}">${baht(v)}</button>`).join('')}
              </div>
            </div>
            <div class="sum-line total" style="margin:6px 0 0"><span>เงินทอน</span><span id="change">฿0</span></div>
          </div>

          ${cart.member ? `
            <div class="field" style="margin-top:14px">
              <label>ใช้แต้มสะสม (มี ${num(cart.member.points)} แต้ม · 1 แต้ม = ฿1)</label>
              <input class="input" id="usePoints" type="number" min="0" max="${Math.min(cart.member.points, t.total)}" value="0">
            </div>` : ''}

          <div class="field" style="margin-top:10px"><label>หมายเหตุออเดอร์</label>
            <input class="input" id="orderNote" placeholder="ไม่บังคับ"></div>
        </div>

        <div id="qrPane" class="qr-pane" style="display:none">
          <div id="qrBox"></div>
          <div class="slip-head">
            <b>ตรวจสลิปโอนเงิน</b>
            <span class="badge ${payCfg.slip_provider ? 'b-green' : 'b-amber'}">
              ${slipModeLabel(payCfg.slip_provider)}</span>
          </div>
          <label class="slip-drop" id="slipDrop">
            <input type="file" id="slipFile" accept="image/*" hidden>
            <span class="em">🧾</span>
            <b>แนบรูปสลิป</b>
            <small>คลิกเพื่อเลือก · ลากไฟล์มาวาง · หรือกด Ctrl+V</small>
          </label>
          <div id="slipResult"></div>
        </div>
      </div>`,
    footer: `<button class="btn" data-close>ยกเลิก</button>
             <button class="btn btn-primary btn-lg" id="confirmPay">ยืนยันการชำระเงิน</button>`,
    onClose: () => document.removeEventListener('paste', onPaste),
  });

  const recv = $('#received', m.el);
  const method = () => $('input[name="pay"]:checked', m.el).value;
  const isTransfer = () => ['promptpay', 'transfer'].includes(method());
  const due = () => Math.max(0, t.total - Number($('#usePoints', m.el)?.value || 0));

  let slip = null;          // สลิปที่ตรวจผ่านแล้ว { id, ... }
  let slipDue = null;       // ยอดตอนตรวจสลิป — ถ้ายอดเปลี่ยนต้องตรวจใหม่
  let qrTimer, qrFor = null;

  const refreshConfirm = () => {
    const needSlip = isTransfer() && payCfg.require_slip;
    $('#confirmPay', m.el).disabled = needSlip && !slip;
    $('#confirmPay', m.el).textContent = needSlip && !slip ? 'รอตรวจสลิป' : 'ยืนยันการชำระเงิน';
  };

  const calcChange = () => {
    const c = Number(recv.value || 0) - due();
    $('#change', m.el).textContent = baht2(Math.max(0, c));
    $('#change', m.el).style.color = c < 0 ? 'var(--red)' : 'var(--ink)';
    $('#dueBig', m.el).textContent = baht2(due());
    if (slip && slipDue !== due()) { slip = null; renderSlip({ state: 'error', msg: 'ยอดชำระเปลี่ยน กรุณาตรวจสลิปใหม่' }); }
    if (method() === 'promptpay') { clearTimeout(qrTimer); qrTimer = setTimeout(loadQr, 300); }
    refreshConfirm();
  };

  // ---- QR พร้อมเพย์ ----
  async function loadQr() {
    const box = $('#qrBox', m.el);
    if (!box || method() !== 'promptpay') return;
    const amount = due();
    if (qrFor === amount) return;
    qrFor = amount;
    // ไม่ได้ตั้งเลขพร้อมเพย์ แต่มีรูป QR ของร้าน (อัปโหลดในหน้าตั้งค่า) : ลูกค้าสแกนแล้วกรอกยอดเอง
    // ถ้าตั้งเลขพร้อมเพย์ไว้ จะใช้ QR ล็อกยอดด้านล่างแทน (ลูกค้าไม่ต้องพิมพ์ยอด)
    if (!payCfg.promptpay_ready && payCfg.qr_image) {
      box.innerHTML = staticQrHTML(payCfg.qr_image, amount);
      const full = () => showStaticQrFullscreen(payCfg.qr_image, amount);
      $('#ppQr', m.el).onclick = full;
      $('#ppFull', m.el).onclick = full;
      return;
    }
    if (!payCfg.promptpay_ready) {
      box.innerHTML = `<div class="slip-card warn">⚠️ ยังไม่ได้ตั้ง QR รับเงินของร้าน<br>
        <small>ไปที่ ตั้งค่า → ข้อมูลร้าน → รับชำระเงิน แล้วอัปโหลดรูป QR หรือใส่เลขพร้อมเพย์</small></div>`;
      return;
    }
    box.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังสร้าง QR...</div>';
    try {
      const q = await api.promptpayQr(amount);
      if (qrFor !== amount) return;
      box.innerHTML = `
        <div class="pp-card">
          <div class="pp-brand">Thai QR Payment · <b>PromptPay</b></div>
          <img src="${q.qr}" alt="QR พร้อมเพย์" class="pp-qr" id="ppQr" title="คลิกเพื่อขยายให้ลูกค้าสแกน">
          <div class="pp-amt">${baht2(q.amount)}</div>
          <div class="pp-name">${esc(q.name)} · ${esc(q.target)}</div>
          <button type="button" class="btn btn-sm" id="ppFull">🔍 ขยายให้ลูกค้าสแกน</button>
        </div>`;
      const full = () => showQrFullscreen(q);
      $('#ppQr', m.el).onclick = full;
      $('#ppFull', m.el).onclick = full;
    } catch (e) {
      qrFor = null;
      box.innerHTML = `<div class="slip-card err">${esc(e.message)}</div>`;
    }
  }

  // ---- สลิป ----
  function renderSlip(s) {
    const box = $('#slipResult', m.el);
    if (!box) return;
    const preview = s.preview ? `<img src="${s.preview}" class="slip-thumb" alt="สลิป">` : '';
    if (s.state === 'checking') {
      box.innerHTML = `<div class="slip-card">${preview}<div><div class="spinner" style="margin:0 0 6px"></div>กำลังตรวจสลิป...</div></div>`;
    } else if (s.state === 'ok') {
      const d = s.slip;
      box.innerHTML = `<div class="slip-card ok">${preview}<div>
        <b>✅ ${d.status === 'manual' ? 'พนักงานยืนยันสลิปแล้ว' : 'สลิปถูกต้อง'}</b>
        ${d.amount != null ? `<div>ยอดโอน <b>${baht2(d.amount)}</b></div>` : ''}
        ${d.sender_name ? `<div>จาก ${esc(d.sender_name)}</div>` : ''}
        ${d.sending_bank ? `<div>${esc(d.sending_bank)}</div>` : ''}
        <div class="mono ref">Ref: ${esc(d.trans_ref)}</div></div></div>`;
    } else if (s.state === 'confirm') {
      box.innerHTML = `<div class="slip-card warn">${preview}<div>
        <b>อ่าน QR สลิปได้ · รอพนักงานยืนยัน</b>
        <div>${esc(s.slip.sending_bank || '')}</div>
        <div class="mono ref">Ref: ${esc(s.slip.trans_ref)}</div>
        <label class="chk"><input type="checkbox" id="slipChk">
          ตรวจแล้ว : ยอดโอน <b>${baht2(s.slip.expected_amount)}</b> และชื่อผู้รับเป็นของร้าน</label>
        <button type="button" class="btn btn-sm btn-primary" id="slipOk" disabled>ยืนยันสลิป</button>
      </div></div>`;
      $('#slipChk', m.el).onchange = (e) => { $('#slipOk', m.el).disabled = !e.target.checked; };
      $('#slipOk', m.el).onclick = () => verify(s.input, true, s.preview);
    } else if (s.state === 'error') {
      box.innerHTML = `<div class="slip-card err">${preview}<div><b>❌ ตรวจสลิปไม่ผ่าน</b><div>${esc(s.msg)}</div></div></div>`;
    } else box.innerHTML = '';
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function verify(input, manual, preview) {
    renderSlip({ state: 'checking', preview });
    const amount = due();
    try {
      const r = await api.verifySlip({
        amount,
        qr_payload: input.qr,
        // ส่งรูปเฉพาะเมื่อมี API และอ่าน QR เองไม่ได้ (ประหยัดแบนด์วิดท์)
        image: payCfg.slip_provider && !input.qr ? input.image : undefined,
        manual_confirm: manual || undefined,
      });
      if (r.status === 'needs_confirm') {
        slip = null;
        renderSlip({ state: 'confirm', slip: r.slip, input, preview });
      } else {
        slip = r.slip; slipDue = amount;
        renderSlip({ state: 'ok', slip: r.slip, preview });
        toast('ตรวจสลิปเรียบร้อย', 'ok');
      }
    } catch (e) {
      slip = null;
      renderSlip({ state: 'error', msg: e.message, preview });
    }
    refreshConfirm();
  }

  async function onSlipFile(file) {
    if (!file) return;
    slip = null; refreshConfirm();
    renderSlip({ state: 'checking' });
    try {
      const input = await readSlip(file);
      if (!input.qr && !payCfg.slip_provider) {
        return renderSlip({ state: 'error', preview: input.image,
          msg: 'หา QR บนสลิปไม่เจอ — ใช้ภาพแคปหน้าจอจากแอปธนาคาร หรือถ่ายให้เห็น QR มุมสลิปชัดๆ' });
      }
      await verify(input, false, input.image);
    } catch (e) {
      renderSlip({ state: 'error', msg: e.message });
    }
  }

  function onPaste(e) {
    if (!isTransfer()) return;
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); onSlipFile(f); }
  }
  document.addEventListener('paste', onPaste);

  const drop = $('#slipDrop', m.el);
  $('#slipFile', m.el).onchange = (e) => { onSlipFile(e.target.files[0]); e.target.value = ''; };
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); onSlipFile(e.dataTransfer.files[0]); });

  recv.addEventListener('input', calcChange);
  $('#usePoints', m.el)?.addEventListener('input', calcChange);
  $$('[data-cash]', m.el).forEach((b) => b.onclick = () => { recv.value = b.dataset.cash; calcChange(); });
  m.el.addEventListener('change', (e) => {
    if (e.target.name !== 'pay') return;
    const k = e.target.value;
    $('#cashBox', m.el).style.display = k === 'cash' ? 'block' : 'none';
    $('#qrPane', m.el).style.display = isTransfer() ? 'block' : 'none';
    $('#qrBox', m.el).style.display = k === 'promptpay' ? 'block' : 'none';
    if (k !== 'cash') recv.value = due();
    if (k === 'promptpay') { qrFor = null; loadQr(); }
    refreshConfirm();
  });

  $('#confirmPay', m.el).addEventListener('click', async () => {
    const btn = $('#confirmPay', m.el);
    btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
    try {
      const payload = {
        order_type: cart.type,
        table_no: cart.type === 'dine_in' ? cart.table : null,
        member_id: cart.member?.id || null,
        promotion_code: cart.promo?.code || null,
        points_used: Number($('#usePoints', m.el)?.value || 0),
        payment_method: method(),
        received: Number(recv.value || 0),
        slip_id: isTransfer() ? slip?.id : undefined,
        note: $('#orderNote', m.el).value.trim() || null,
        items: cart.items.map((i) => ({
          product_id: i.product.id, qty: i.qty,
          options: i.options.map((o) => o.id), note: i.note || null,
        })),
      };
      const order = await api.createOrder(payload);
      m.close();
      cart.items = []; cart.member = null; cart.promo = null; cart.table = '';
      renderCart();
      refreshQueueBadge();
      toast(`บันทึกออเดอร์ ${order.order_no} เรียบร้อย`, 'ok');
      showReceipt(order.id);
      refreshStock();
    } catch (e) {
      toast(e.message, 'err');
      btn.disabled = false; refreshConfirm();
    }
  });
  calcChange();
}

/** การ์ด QR รูปของร้าน + ยอดที่ลูกค้าต้องกรอก */
function staticQrHTML(img, amount) {
  return `
    <div class="pp-card pp-static">
      <img src="${img}" alt="QR รับเงินของร้าน" class="pp-img" id="ppQr" title="คลิกเพื่อขยายให้ลูกค้าสแกน">
      <div class="pp-due"><small>ยอดที่ลูกค้าต้องกรอก</small><b>${baht2(amount)}</b></div>
      <button type="button" class="btn btn-sm" id="ppFull">🔍 ขยายให้ลูกค้าสแกน</button>
    </div>`;
}

function showStaticQrFullscreen(img, amount) {
  const el = document.createElement('div');
  el.className = 'qr-full';
  el.innerHTML = `
    <div class="pp-card big pp-static">
      <img src="${img}" alt="QR รับเงินของร้าน" class="pp-img">
      <div class="pp-due"><small>กรุณากรอกยอดโอน</small><b>${baht2(amount)}</b></div>
      <div class="pp-hint">สแกนด้วยแอปธนาคารใดก็ได้ · แตะเพื่อปิด</div>
    </div>`;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
}

/** QR เต็มจอสำหรับหันจอให้ลูกค้าสแกน */
function showQrFullscreen(q) {
  const el = document.createElement('div');
  el.className = 'qr-full';
  el.innerHTML = `
    <div class="pp-card big">
      <div class="pp-brand">Thai QR Payment · <b>PromptPay</b></div>
      <img src="${q.qr}" alt="QR พร้อมเพย์" class="pp-qr">
      <div class="pp-amt">${baht2(q.amount)}</div>
      <div class="pp-name">${esc(q.name)} · ${esc(q.target)}</div>
      <div class="pp-hint">สแกนด้วยแอปธนาคารใดก็ได้ · แตะเพื่อปิด</div>
    </div>`;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
}

