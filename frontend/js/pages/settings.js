/** หน้าตั้งค่าระบบ — ข้อมูลร้าน / เมนู / พนักงาน / โปรโมชั่น / ค่าใช้จ่าย / กะ */
import { api, auth } from '../api.js';
import {
  $, $$, esc, baht, num, toast, modal, confirmBox, emptyHTML, productThumb,
  ROLE, fmtDate, fmtDateTime, todayStr,
} from '../utils.js';
import { readSlip } from '../slip.js';

let tab = 'shop';

export default {
  async render(root) {
    const tabs = [
      ['shop', '🏪 ข้อมูลร้าน'],
      ['menu', '☕ จัดการเมนู'],
      ['cats', '🗂️ หมวดหมู่'],
      ['promo', '🎟️ โปรโมชั่น'],
      ['expense', '🧾 ค่าใช้จ่าย'],
      ['shift', '🔐 กะการขาย'],
      ...(auth.can('owner', 'manager') ? [['users', '👤 พนักงาน']] : []),
    ];
    root.innerHTML = `
      <div class="tabs">${tabs.map(([k, l]) =>
        `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <div id="sBody"></div>`;

    $$('.tabs button', root).forEach((b) => b.onclick = () => {
      tab = b.dataset.tab;
      $$('.tabs button', root).forEach((x) => x.classList.toggle('active', x === b));
      draw();
    });
    await draw();
  },
};

async function draw() {
  const box = $('#sBody');
  box.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลด...</div>';
  const fn = { shop: drawShop, menu: drawMenu, cats: drawCats, users: drawUsers,
               promo: drawPromo, expense: drawExpense, shift: drawShift }[tab];
  await fn(box);
}

// ---------------------------------------------------------------
// ข้อมูลร้าน
// ---------------------------------------------------------------
const hintHTML = (hint) => (hint ? '<div class="hint">' + hint + '</div>' : '');

function shopField(canEdit, id, label, val, hint = '', type = 'text') {
  const disabled = canEdit ? '' : 'disabled';
  return `
    <div class="field"><label>${label}</label>
      <input class="input" id="${id}" type="${type}" value="${esc(val ?? '')}" ${disabled}>
      ${hintHTML(hint)}</div>`;
}

function slipProviderHTML(provider) {
  if (provider) {
    const name = provider === 'easyslip' ? 'EasySlip' : 'SlipOK';
    return `<b>✅ เชื่อมต่อ API ตรวจสลิปแล้ว : ${name}</b>
                 <div>ระบบตรวจกับธนาคาร: ยอดเงิน บัญชีผู้รับ สลิปปลอม และสลิปซ้ำ</div>`;
  }
  return `<b>ยังไม่ได้เชื่อมต่อ API ตรวจสลิป</b>
                 <div>ตอนนี้ระบบอ่าน QR บนสลิปเพื่อกันสลิปซ้ำ แล้วให้พนักงานยืนยันยอดเอง
                 หากต้องการตรวจกับธนาคารอัตโนมัติ ให้สมัคร EasySlip หรือ SlipOK แล้วใส่ API key ในไฟล์ <code>.env</code>
                 (ดูตัวอย่างใน <code>.env.example</code>) จากนั้นรีสตาร์ทเซิร์ฟเวอร์</div>`;
}

function lineCardClass(ln) {
  if (!ln.configured) return 'warn';
  return ln.ok ? 'ok' : 'err';
}

function lineStatusHTML(ln) {
  if (ln.configured && ln.ok) {
    return `<b>✅ เชื่อมต่อบอท ${esc(ln.name)} (${esc(ln.basic_id)}) แล้ว</b>
                 <div>ใบเสร็จของออเดอร์ที่อยู่ในคิวจะมี QR ให้ลูกค้าสแกนรับแจ้งเตือน</div>`;
  }
  if (ln.configured) return `<b>เชื่อมต่อ LINE ไม่สำเร็จ</b><div>${esc(ln.error)}</div>`;
  return `<b>ยังไม่ได้เชื่อมต่อ LINE</b>
                 <div>สร้าง Messaging API channel ที่ LINE Developers แล้วใส่
                 <code>LINE_CHANNEL_SECRET</code> และ <code>LINE_CHANNEL_ACCESS_TOKEN</code> ในไฟล์ <code>.env</code> แล้วรีสตาร์ทเซิร์ฟเวอร์</div>`;
}

const SHOP_KEYS = ['shop_name', 'shop_branch', 'shop_address', 'shop_phone', 'shop_tax_id',
                   'shop_line_id', 'shop_facebook', 'shop_instagram', 'shop_website',
                   'open_time', 'close_time', 'receipt_footer', 'points_per_baht',
                   'point_redeem_rate', 'tier_gold_spend', 'tier_platinum_spend',
                   'promptpay_id', 'promptpay_name', 'promptpay_qr_image', 'require_slip', 'use_queue'];

/** อัปโหลดรูป QR รับเงิน : ตรวจว่าเป็น QR พร้อมเพย์จริง แล้วเก็บเป็นรูปย่อ (กดบันทึกการตั้งค่าเพื่อยืนยัน) */
function bindQrUpload() {
  const file = $('#qrFile');
  if (!file) return;
  const setImage = (src) => {
    $('#promptpay_qr_image').value = src;
    $('#qrThumb').innerHTML = src ? `<img src="${src}" alt="QR รับเงิน">` : '<span>ยังไม่มีรูป</span>';
  };
  file.onchange = async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    try {
      const { qr, image } = await readSlip(f);
      if (!qr) return toast('ไม่พบ QR ในรูปนี้ ลองใช้รูปที่ชัดกว่านี้', 'err');
      if (!qr.includes('A000000677010111')) return toast('QR นี้ไม่ใช่ QR พร้อมเพย์', 'err');
      setImage(image);
      toast('อ่าน QR พร้อมเพย์ได้ ✓ กด "บันทึกการตั้งค่า" เพื่อใช้งาน', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#qrRemove').onclick = () => { setImage(''); toast('ลบรูปแล้ว กด "บันทึกการตั้งค่า" เพื่อยืนยัน', 'warn'); };
}

async function saveShopSettings() {
  const body = Object.fromEntries(SHOP_KEYS.map((k) => [k, $('#' + k).value]));
  try {
    await api.saveSettings(body);
    toast('บันทึกการตั้งค่าเรียบร้อย', 'ok');
    $('#brandBranch').textContent = body.shop_branch;
    $('#brandName').textContent = body.shop_name || 'ผู้ชายขายน้ำ';
  } catch (e) { toast(e.message, 'err'); }
}

const SAVE_BAR = `<div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn btn-primary btn-lg" id="saveShop">บันทึกการตั้งค่า</button></div>`;

async function drawShop(box) {
  const [s, pay, ln] = await Promise.all([api.settings(), api.paymentConfig(), api.lineStatus()]);
  const canEdit = auth.can('owner', 'manager');
  const f = (...args) => shopField(canEdit, ...args);
  const dis = canEdit ? '' : 'disabled';

  box.innerHTML = `
    <div class="grid g-2">
      <div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h3>ข้อมูลร้าน</h3><div class="sub">ใช้แสดงบนใบเสร็จ</div></div>
        <div class="card-body">
          ${f('shop_name', 'ชื่อร้าน', s.shop_name)}
          ${f('shop_branch', 'สาขา', s.shop_branch)}
          <div class="field"><label>ที่อยู่</label>
            <textarea class="input" id="shop_address" rows="2" ${dis}>${esc(s.shop_address || '')}</textarea></div>
          <div class="grid g-2" style="gap:12px">
            ${f('shop_phone', 'เบอร์โทรศัพท์', s.shop_phone)}
            ${f('shop_tax_id', 'เลขประจำตัวผู้เสียภาษี', s.shop_tax_id)}
          </div>
          <div class="grid g-2" style="gap:12px">
            ${f('open_time', 'เวลาเปิด', s.open_time, '', 'time')}
            ${f('close_time', 'เวลาปิด', s.close_time, '', 'time')}
          </div>
          ${f('receipt_footer', 'ข้อความท้ายใบเสร็จ', s.receipt_footer)}
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h3>ช่องทางติดตาม & ติดต่อ</h3><div class="sub">แสดงท้ายใบเสร็จ (เว้นว่างได้)</div></div>
        <div class="card-body">
          <div class="grid g-2" style="gap:12px">
            ${f('shop_line_id', 'LINE Official Account', s.shop_line_id, 'เช่น @phuchaikhainam — เว้นว่างจะใช้ ID ของบอท LINE อัตโนมัติ')}
            ${f('shop_facebook', 'Facebook Page', s.shop_facebook, 'ชื่อเพจ หรือลิงก์เพจ')}
          </div>
          <div class="grid g-2" style="gap:12px">
            ${f('shop_instagram', 'Instagram', s.shop_instagram, 'เช่น phuchaikhainam')}
            ${f('shop_website', 'เว็บไซต์', s.shop_website, 'เช่น www.phuchaikhainam.com')}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>รับชำระเงิน (พร้อมเพย์)</h3><div class="sub">QR รับเงินหน้าร้าน + ตรวจสลิป</div></div>
        <div class="card-body">
          <div class="field"><label>รูป QR รับเงินของร้าน</label>
            <div class="qr-upload">
              <div class="qr-thumb" id="qrThumb">${s.promptpay_qr_image
                ? `<img src="${s.promptpay_qr_image}" alt="QR รับเงิน">` : '<span>ยังไม่มีรูป</span>'}</div>
              <div>
                ${canEdit ? `<label class="btn btn-sm">📤 อัปโหลด / เปลี่ยนรูป
                  <input type="file" id="qrFile" accept="image/*" hidden></label>
                <button type="button" class="btn btn-sm btn-ghost" id="qrRemove">ลบรูป</button>` : ''}
                <div class="hint" id="qrHint">รูป QR พร้อมเพย์จากแอปธนาคาร (เช่น "QR รับเงิน" ของ SCB)
                  ใช้เมื่อไม่ได้ใส่เลขพร้อมเพย์ด้านล่าง — ลูกค้าสแกนแล้วกรอกยอดเอง</div>
              </div>
            </div>
            <input type="hidden" id="promptpay_qr_image" value="${esc(s.promptpay_qr_image || '')}">
          </div>
          ${f('promptpay_id', 'เลขพร้อมเพย์ของร้าน (QR ล็อกยอด)', s.promptpay_id,
            'เบอร์มือถือ 10 หลัก หรือเลข 13 หลัก — ระบบสร้าง QR ที่ล็อกยอดให้ทุกบิล (ใช้ก่อนรูป QR ด้านบน)')}
          ${f('promptpay_name', 'ชื่อบัญชีที่แสดงใต้ QR', s.promptpay_name, 'เช่น ร้านผู้ชายขายน้ำ (นายสมชาย ใจดี)')}
          <div class="field"><label>ตรวจสลิปก่อนปิดบิล</label>
            <select class="input" id="require_slip" ${dis}>
              <option value="1" ${s.require_slip !== '0' ? 'selected' : ''}>บังคับ — พร้อมเพย์/โอนเงินต้องแนบสลิปที่ตรวจผ่าน</option>
              <option value="0" ${s.require_slip === '0' ? 'selected' : ''}>ไม่บังคับ — แนบสลิปหรือไม่ก็ได้</option>
            </select></div>
          <div class="slip-card ${pay.slip_provider ? 'ok' : 'warn'}" style="margin-top:0">
            <div>${slipProviderHTML(pay.slip_provider)}</div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-head"><h3>LINE Bot แจ้งเตือนลูกค้า</h3><div class="sub">ส่งข้อความเมื่อเครื่องดื่มพร้อมเสิร์ฟ</div></div>
        <div class="card-body">
          <div class="field"><label>ส่งออเดอร์จากหน้าขายเข้าคิวบาริสต้า</label>
            <select class="input" id="use_queue" ${dis}>
              <option value="1" ${s.use_queue !== '0' ? 'selected' : ''}>เปิด — ออเดอร์เข้าคิว รอทำ → กำลังทำ → พร้อมเสิร์ฟ → ส่งแล้ว</option>
              <option value="0" ${s.use_queue === '0' ? 'selected' : ''}>ปิด — บันทึกเป็น "สำเร็จ" ทันที (ไม่มีแจ้งเตือน LINE)</option>
            </select>
            <div class="hint">ยอดขายในรายงานนับเมื่อออเดอร์ถูกกด "ส่งให้ลูกค้าแล้ว"</div></div>
          <div class="slip-card ${lineCardClass(ln)}" style="margin-top:0">
            <div>${lineStatusHTML(ln)}
              <div style="margin-top:6px">Webhook URL : <code>${esc(ln.webhook)}</code>
                <div class="hint">LINE ต้องเรียกผ่าน HTTPS สาธารณะ — ถ้าเปิดร้านบนเครื่องนี้ ใช้ cloudflared หรือ ngrok แล้วใส่ URL นั้นแทน localhost</div></div>
            </div>
          </div>
        </div>
      </div>
      </div>

      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="card-head"><h3>ระบบสมาชิก</h3><div class="sub">กติกาการสะสมและแลกแต้ม</div></div>
          <div class="card-body">
            ${f('points_per_baht', 'อัตราสะสมแต้ม (แต้ม/บาท)', s.points_per_baht,
              `ปัจจุบัน : ซื้อ ${Math.round(1 / (Number(s.points_per_baht) || 0.05))} บาท = 1 แต้ม`, 'number')}
            ${f('point_redeem_rate', 'มูลค่าแต้มเมื่อแลก (บาท/แต้ม)', s.point_redeem_rate, '', 'number')}
            <div class="grid g-2" style="gap:12px">
              ${f('tier_gold_spend', 'ยอดสะสมขึ้น Gold', s.tier_gold_spend, '', 'number')}
              ${f('tier_platinum_spend', 'ยอดสะสมขึ้น Platinum', s.tier_platinum_spend, '', 'number')}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>บัญชีผู้ใช้ของฉัน</h3></div>
          <div class="card-body">
            <div class="row" style="gap:14px;margin-bottom:14px">
              <div class="avatar" style="width:46px;height:46px;border-radius:50%;background:var(--brand-100);
                   color:var(--brand-800);display:grid;place-items:center;font-size:19px;font-weight:700">
                ${esc(auth.user.full_name.charAt(0))}</div>
              <div><b style="font-size:15px">${esc(auth.user.full_name)}</b>
                <div style="color:var(--muted);font-size:12.5px">${esc(auth.user.username)} · ${ROLE[auth.user.role]}</div></div>
            </div>
            <button class="btn btn-block" id="changePw">🔑 เปลี่ยนรหัสผ่าน</button>
          </div>
        </div>
      </div>
    </div>
    ${canEdit ? SAVE_BAR : ''}`;

  const btn = $('#saveShop');
  if (btn) btn.onclick = saveShopSettings;
  bindQrUpload();

  $('#changePw').onclick = () => {
    const m = modal({
      title: 'เปลี่ยนรหัสผ่าน',
      body: `<div class="field"><label>รหัสผ่านเดิม</label><input class="input" type="password" id="oldPw" autofocus></div>
             <div class="field"><label>รหัสผ่านใหม่</label><input class="input" type="password" id="newPw">
               <div class="hint">อย่างน้อย 6 ตัวอักษร</div></div>
             <div class="field"><label>ยืนยันรหัสผ่านใหม่</label><input class="input" type="password" id="newPw2"></div>`,
      footer: `<button class="btn" data-close>ยกเลิก</button>
               <button class="btn btn-primary" id="savePw">บันทึก</button>`,
    });
    $('#savePw', m.el).onclick = async () => {
      const p1 = $('#newPw', m.el).value, p2 = $('#newPw2', m.el).value;
      if (p1 !== p2) return toast('รหัสผ่านใหม่ไม่ตรงกัน', 'err');
      try {
        await api.post('/auth/change-password', { old_password: $('#oldPw', m.el).value, new_password: p1 });
        m.close(); toast('เปลี่ยนรหัสผ่านเรียบร้อย', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
  };
}

// ---------------------------------------------------------------
// จัดการเมนู
// ---------------------------------------------------------------
async function drawMenu(box) {
  const [products, cats] = await Promise.all([api.products(), api.categories()]);
  const canEdit = auth.can('owner', 'manager');

  box.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h3>เมนูทั้งหมด</h3><div class="sub">${products.length} รายการ</div></div>
        <div class="spacer"></div>
        ${canEdit ? '<button class="btn btn-sm btn-primary" id="addProd">+ เพิ่มเมนูใหม่</button>' : ''}
      </div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th></th><th>ชื่อเมนู</th><th>หมวดหมู่</th><th class="t-right">ราคาขาย</th>
          <th class="t-right">ต้นทุน</th><th class="t-right">กำไร/หน่วย</th>
          <th class="t-center">สถานะ</th><th class="t-center">จัดการ</th></tr></thead>
        <tbody>${products.map((p) => `
          <tr>
            <td class="prod-thumb-cell">${productThumb(p.image, p.name)}</td>
            <td><b>${esc(p.name)}</b>${p.is_recommended ? ' <span class="badge b-amber">แนะนำ</span>' : ''}
              <div style="font-size:11.5px;color:var(--muted)">${esc(p.sku || '')} ${esc(p.description || '')}</div></td>
            <td><span class="badge b-gray">${esc(p.category_name || '-')}</span></td>
            <td class="t-right mono" style="font-weight:600">${baht(p.price)}</td>
            <td class="t-right mono" style="color:var(--muted)">${baht(p.cost)}</td>
            <td class="t-right mono" style="color:var(--green-700)">${baht(p.price - p.cost)}
              <small style="color:var(--muted)">(${p.price ? Math.round((p.price - p.cost) / p.price * 100) : 0}%)</small></td>
            <td class="t-center">
              <button class="btn btn-sm ${p.is_available ? 'btn-primary' : ''}" data-toggle="${p.id}">
                ${p.is_available ? 'เปิดขาย' : 'ปิดขาย'}</button></td>
            <td class="t-center">${canEdit ? `<button class="btn btn-sm" data-edit="${p.id}">แก้ไข</button>` : '-'}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  $$('[data-toggle]', box).forEach((b) => b.onclick = async () => {
    try { await api.patch(`/products/${b.dataset.toggle}/availability`); draw(); }
    catch (e) { toast(e.message, 'err'); }
  });
  const add = $('#addProd');
  if (add) add.onclick = () => productForm(null, cats);
  $$('[data-edit]', box).forEach((b) => b.onclick = async () => {
    productForm(await api.product(b.dataset.edit), cats);
  });
}

async function productForm(p, cats) {
  const isNew = !p;
  const ings = await api.ingredients();
  const recipe = p?.recipe || [];

  const m = modal({
    title: isNew ? 'เพิ่มเมนูใหม่' : `แก้ไขเมนู : ${p.name}`,
    wide: true,
    body: `
      <div class="grid g-2" style="gap:16px">
        <div>
          <div class="field"><label>ชื่อเมนู *</label><input class="input" id="pName" value="${esc(p?.name || '')}" autofocus></div>
          <div class="field"><label>คำอธิบาย</label><input class="input" id="pDesc" value="${esc(p?.description || '')}"></div>
          <div class="grid g-2" style="gap:12px">
            <div class="field"><label>หมวดหมู่</label>
              <select class="select" id="pCat">
                ${cats.map((c) => `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>
                  ${c.icon} ${esc(c.name)}</option>`).join('')}
              </select></div>
            <div class="field"><label>รูปเมนู (URL) หรืออีโมจิ</label>
              <input class="input" id="pImg" value="${esc(p?.image || '☕')}" placeholder="https://... หรือ ☕"></div>
          </div>
          <div class="grid g-2" style="gap:12px">
            <div class="field"><label>ราคาขาย (บาท) *</label>
              <input class="input" id="pPrice" type="number" step="0.5" value="${p?.price ?? ''}"></div>
            <div class="field"><label>ต้นทุนโดยประมาณ</label>
              <input class="input" id="pCost" type="number" step="0.5" value="${p?.cost ?? 0}"></div>
          </div>
          <div class="field"><label>รหัสสินค้า (SKU)</label><input class="input" id="pSku" value="${esc(p?.sku || '')}"></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer">
            <input type="checkbox" id="pRec" ${p?.is_recommended ? 'checked' : ''}> ตั้งเป็นเมนูแนะนำ</label>
        </div>

        <div>
          <div class="row" style="margin-bottom:8px">
            <b style="font-size:13.5px">สูตรการผลิต (ตัดสต็อกอัตโนมัติ)</b>
            <div class="spacer"></div>
            <button class="btn btn-sm" id="addRow">+ เพิ่มวัตถุดิบ</button>
          </div>
          <div style="font-size:11.5px;color:var(--muted);margin-bottom:9px">
            ระบุปริมาณวัตถุดิบต่อ 1 หน่วยขาย ระบบจะหักสต็อกให้อัตโนมัติทุกครั้งที่ขาย</div>
          <div id="recipeRows" style="max-height:290px;overflow-y:auto"></div>
          <div style="margin-top:10px;padding:10px 12px;background:var(--green-50);border-radius:9px;
                      display:flex;justify-content:space-between;font-size:13px">
            <span>ต้นทุนจากสูตร</span><b id="recipeCost">฿0.00</b>
          </div>
        </div>
      </div>`,
    footer: `${!isNew ? '<button class="btn btn-danger" id="delProd">ลบเมนู</button><div style="flex:1"></div>' : ''}
             <button class="btn" data-close>ยกเลิก</button>
             <button class="btn btn-primary" id="saveProd">บันทึก</button>`,
  });

  const rowsBox = $('#recipeRows', m.el);
  const addRow = (ingId = '', qty = '') => {
    const div = document.createElement('div');
    div.className = 'row';
    div.style.cssText = 'gap:6px;margin-bottom:6px';
    div.innerHTML = `
      <select class="select r-ing" style="flex:1">
        <option value="">— เลือกวัตถุดิบ —</option>
        ${ings.map((i) => `<option value="${i.id}" data-cost="${i.cost_per_unit}" data-unit="${esc(i.unit)}"
          ${i.id == ingId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}
      </select>
      <input class="input r-qty" type="number" step="0.01" value="${qty}" placeholder="ปริมาณ" style="width:92px">
      <span class="r-unit" style="width:44px;font-size:12px;color:var(--muted)"></span>
      <button class="btn btn-sm btn-ghost r-del" style="color:var(--red)">✕</button>`;
    rowsBox.appendChild(div);
    const upd = () => {
      const sel = $('.r-ing', div).selectedOptions[0];
      $('.r-unit', div).textContent = sel?.dataset.unit || '';
      calcCost();
    };
    $('.r-ing', div).onchange = upd;
    $('.r-qty', div).oninput = calcCost;
    $('.r-del', div).onclick = () => { div.remove(); calcCost(); };
    upd();
  };
  const calcCost = () => {
    let total = 0;
    $$('#recipeRows .row', m.el).forEach((r) => {
      const sel = $('.r-ing', r).selectedOptions[0];
      total += Number(sel?.dataset.cost || 0) * Number($('.r-qty', r).value || 0);
    });
    $('#recipeCost', m.el).textContent = '฿' + total.toFixed(2);
  };

  recipe.forEach((r) => addRow(r.ingredient_id, r.qty));
  if (!recipe.length) addRow();
  $('#addRow', m.el).onclick = () => addRow();

  $('#saveProd', m.el).onclick = async () => {
    const body = {
      name: $('#pName', m.el).value.trim(),
      description: $('#pDesc', m.el).value.trim() || null,
      category_id: Number($('#pCat', m.el).value),
      image: $('#pImg', m.el).value.trim() || '☕',
      price: Number($('#pPrice', m.el).value),
      cost: Number($('#pCost', m.el).value),
      sku: $('#pSku', m.el).value.trim() || null,
      is_recommended: $('#pRec', m.el).checked ? 1 : 0,
      is_available: p ? p.is_available : 1,
      recipe: $$('#recipeRows .row', m.el).map((r) => ({
        ingredient_id: Number($('.r-ing', r).value),
        qty: Number($('.r-qty', r).value),
      })).filter((r) => r.ingredient_id && r.qty > 0),
    };
    if (!body.name || !body.price) return toast('กรุณากรอกชื่อเมนูและราคาขาย', 'err');
    try {
      if (isNew) await api.post('/products', body);
      else await api.put(`/products/${p.id}`, body);
      m.close(); toast('บันทึกเมนูเรียบร้อย', 'ok'); draw();
    } catch (e) { toast(e.message, 'err'); }
  };

  const del = $('#delProd', m.el);
  if (del) del.onclick = async () => {
    if (!await confirmBox(`ลบเมนู "${p.name}" ?`, { danger: true, okText: 'ลบเมนู' })) return;
    try {
      const r = await api.del(`/products/${p.id}`);
      m.close(); toast(r.message, 'ok'); draw();
    } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------------------------------------------------------------
// หมวดหมู่
// ---------------------------------------------------------------
async function drawCats(box) {
  const cats = await api.categories();
  const canEdit = auth.can('owner', 'manager');
  box.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>หมวดหมู่สินค้า</h3><div class="spacer"></div>
        ${canEdit ? '<button class="btn btn-sm btn-primary" id="addCat">+ เพิ่มหมวดหมู่</button>' : ''}</div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>ไอคอน</th><th>ชื่อหมวดหมู่</th><th class="t-center">จำนวนสินค้า</th>
          <th class="t-center">ลำดับ</th><th class="t-center">สถานะ</th><th class="t-center"></th></tr></thead>
        <tbody>${cats.map((c) => `
          <tr><td style="font-size:20px">${esc(c.icon)}</td>
            <td><b>${esc(c.name)}</b></td>
            <td class="t-center">${num(c.product_count)}</td>
            <td class="t-center">${c.sort_order}</td>
            <td class="t-center">${c.is_active
              ? '<span class="badge b-green">ใช้งาน</span>' : '<span class="badge b-gray">ปิด</span>'}</td>
            <td class="t-center">${canEdit ? `<button class="btn btn-sm" data-edit="${c.id}">แก้ไข</button>
              <button class="btn btn-sm btn-ghost" data-del="${c.id}" style="color:var(--red)">ลบ</button>` : '-'}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  const add = $('#addCat');
  if (add) add.onclick = () => catForm(null);
  $$('[data-edit]', box).forEach((b) => b.onclick = () => catForm(cats.find((c) => c.id == b.dataset.edit)));
  $$('[data-del]', box).forEach((b) => b.onclick = async () => {
    const c = cats.find((x) => x.id == b.dataset.del);
    if (!await confirmBox(`ลบหมวดหมู่ "${c.name}" ?`, { danger: true, okText: 'ลบ' })) return;
    try { const r = await api.del(`/categories/${c.id}`); toast(r.message, 'ok'); draw(); }
    catch (e) { toast(e.message, 'err'); }
  });
}

function catForm(c) {
  const isNew = !c;
  const m = modal({
    title: isNew ? 'เพิ่มหมวดหมู่' : `แก้ไข : ${c.name}`,
    body: `<div class="grid g-2" style="gap:12px">
        <div class="field"><label>ชื่อหมวดหมู่ *</label><input class="input" id="cName" value="${esc(c?.name || '')}" autofocus></div>
        <div class="field"><label>ไอคอน</label><input class="input" id="cIcon" value="${esc(c?.icon || '☕')}" maxlength="4"></div>
      </div>
      <div class="field"><label>ลำดับการแสดง</label>
        <input class="input" id="cSort" type="number" value="${c?.sort_order ?? 0}"></div>`,
    footer: `<button class="btn" data-close>ยกเลิก</button>
             <button class="btn btn-primary" id="saveCat">บันทึก</button>`,
  });
  $('#saveCat', m.el).onclick = async () => {
    const body = {
      name: $('#cName', m.el).value.trim(),
      icon: $('#cIcon', m.el).value.trim() || '☕',
      sort_order: Number($('#cSort', m.el).value),
      is_active: 1,
    };
    if (!body.name) return toast('กรุณากรอกชื่อหมวดหมู่', 'err');
    try {
      if (isNew) await api.post('/categories', body);
      else await api.put(`/categories/${c.id}`, body);
      m.close(); toast('บันทึกเรียบร้อย', 'ok'); draw();
    } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------------------------------------------------------------
// พนักงาน
// ---------------------------------------------------------------
async function drawUsers(box) {
  const users = await api.users();
  const isOwner = auth.can('owner');
  box.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>พนักงานทั้งหมด</h3><div class="sub">${users.length} คน</div>
        <div class="spacer"></div>
        ${isOwner ? '<button class="btn btn-sm btn-primary" id="addUser">+ เพิ่มพนักงาน</button>' : ''}</div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>ชื่อ-นามสกุล</th><th>ชื่อผู้ใช้</th><th>ตำแหน่ง</th><th>เบอร์โทร</th>
          <th class="t-center">บิลที่ขาย</th><th class="t-right">ยอดขายรวม</th>
          <th class="t-center">สถานะ</th><th class="t-center"></th></tr></thead>
        <tbody>${users.map((u) => `
          <tr><td><b>${esc(u.full_name)}</b></td>
            <td class="mono">${esc(u.username)}</td>
            <td><span class="badge ${ROLE_BADGE[u.role] || 'b-gray'}">
              ${ROLE[u.role]}</span></td>
            <td class="mono">${esc(u.phone || '-')}</td>
            <td class="t-center">${num(u.total_orders)}</td>
            <td class="t-right mono">${baht(u.total_sales)}</td>
            <td class="t-center">${u.status === 'active'
              ? '<span class="badge b-green">ใช้งาน</span>' : '<span class="badge b-red">ระงับ</span>'}</td>
            <td class="t-center">${isOwner ? `<button class="btn btn-sm" data-edit="${u.id}">แก้ไข</button>` : '-'}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  const add = $('#addUser');
  if (add) add.onclick = () => userForm(null);
  $$('[data-edit]', box).forEach((b) => b.onclick = () => userForm(users.find((u) => u.id == b.dataset.edit)));
}

const ROLE_BADGE = { owner: 'b-purple', manager: 'b-blue' };

function statusField(status) {
  const sel = (v) => (status === v ? 'selected' : '');
  return `<div class="field"><label>สถานะ</label>
        <select class="select" id="uStatus">
          <option value="active" ${sel('active')}>ใช้งาน</option>
          <option value="inactive" ${sel('inactive')}>ระงับการใช้งาน</option>
        </select></div>`;
}

function userForm(u) {
  const isNew = !u;
  const m = modal({
    title: isNew ? 'เพิ่มพนักงาน' : `แก้ไข : ${u.full_name}`,
    body: `
      <div class="field"><label>ชื่อ-นามสกุล *</label><input class="input" id="uName" value="${esc(u?.full_name || '')}" autofocus></div>
      <div class="grid g-2" style="gap:12px">
        <div class="field"><label>ชื่อผู้ใช้ *</label>
          <input class="input" id="uUser" value="${esc(u?.username || '')}" ${isNew ? '' : 'disabled'}></div>
        <div class="field"><label>${isNew ? 'รหัสผ่าน *' : 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)'}</label>
          <input class="input" type="password" id="uPw"></div>
      </div>
      <div class="grid g-2" style="gap:12px">
        <div class="field"><label>ตำแหน่ง</label>
          <select class="select" id="uRole">
            ${Object.entries(ROLE).map(([k, v]) =>
              `<option value="${k}" ${u?.role === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select></div>
        <div class="field"><label>เบอร์โทรศัพท์</label><input class="input" id="uPhone" value="${esc(u?.phone || '')}"></div>
      </div>
      ${isNew ? '' : statusField(u.status)}`,
    footer: `<button class="btn" data-close>ยกเลิก</button>
             <button class="btn btn-primary" id="saveUser">บันทึก</button>`,
  });

  $('#saveUser', m.el).onclick = async () => {
    const body = {
      full_name: $('#uName', m.el).value.trim(),
      role: $('#uRole', m.el).value,
      phone: $('#uPhone', m.el).value.trim() || null,
    };
    const pw = $('#uPw', m.el).value;
    try {
      if (isNew) {
        await api.post('/users', { ...body, username: $('#uUser', m.el).value.trim(), password: pw });
      } else {
        await api.put(`/users/${u.id}`, {
          ...body, status: $('#uStatus', m.el).value, ...(pw ? { password: pw } : {}),
        });
      }
      m.close(); toast('บันทึกข้อมูลพนักงานเรียบร้อย', 'ok'); draw();
    } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------------------------------------------------------------
// โปรโมชั่น
// ---------------------------------------------------------------
async function drawPromo(box) {
  const list = await api.promotions();
  const canEdit = auth.can('owner', 'manager');
  box.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>โปรโมชั่นและส่วนลด</h3><div class="spacer"></div>
        ${canEdit ? '<button class="btn btn-sm btn-primary" id="addPromo">+ เพิ่มโปรโมชั่น</button>' : ''}</div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>โค้ด</th><th>ชื่อโปรโมชั่น</th><th class="t-center">ส่วนลด</th>
          <th class="t-right">ยอดขั้นต่ำ</th><th>ระยะเวลา</th><th class="t-center">สถานะ</th><th class="t-center"></th></tr></thead>
        <tbody>${list.length ? list.map((p) => `
          <tr><td class="mono"><b>${esc(p.code)}</b></td>
            <td>${esc(p.name)}</td>
            <td class="t-center"><span class="badge b-amber">
              ${p.type === 'percent' ? `-${p.value}%` : `-${baht(p.value)}`}</span></td>
            <td class="t-right mono">${p.min_total ? baht(p.min_total) : '-'}</td>
            <td style="font-size:12.5px;color:var(--muted)">
              ${p.start_date ? `${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}` : 'ไม่จำกัด'}</td>
            <td class="t-center">${p.is_active
              ? '<span class="badge b-green">ใช้งาน</span>' : '<span class="badge b-gray">ปิด</span>'}</td>
            <td class="t-center">${canEdit ? `<button class="btn btn-sm" data-edit="${p.id}">แก้ไข</button>` : '-'}</td>
          </tr>`).join('') : `<tr><td colspan="7">${emptyHTML('ยังไม่มีโปรโมชั่น', '🎟️')}</td></tr>`}</tbody>
      </table></div>
    </div>`;

  const add = $('#addPromo');
  if (add) add.onclick = () => promoForm(null);
  $$('[data-edit]', box).forEach((b) => b.onclick = () => promoForm(list.find((p) => p.id == b.dataset.edit)));
}

function promoForm(p) {
  const isNew = !p;
  const m = modal({
    title: isNew ? 'เพิ่มโปรโมชั่น' : `แก้ไข : ${p.name}`,
    body: `
      <div class="grid g-2" style="gap:12px">
        <div class="field"><label>โค้ดส่วนลด *</label>
          <input class="input mono" id="prCode" value="${esc(p?.code || '')}" placeholder="เช่น SUMMER20" autofocus></div>
        <div class="field"><label>ชื่อโปรโมชั่น *</label><input class="input" id="prName" value="${esc(p?.name || '')}"></div>
      </div>
      <div class="grid g-2" style="gap:12px">
        <div class="field"><label>ประเภทส่วนลด</label>
          <select class="select" id="prType">
            <option value="percent" ${p?.type === 'percent' ? 'selected' : ''}>ลดเป็นเปอร์เซ็นต์ (%)</option>
            <option value="amount" ${p?.type === 'amount' ? 'selected' : ''}>ลดเป็นจำนวนเงิน (บาท)</option>
          </select></div>
        <div class="field"><label>มูลค่าส่วนลด *</label>
          <input class="input" id="prValue" type="number" step="0.01" value="${p?.value ?? ''}"></div>
      </div>
      <div class="field"><label>ยอดซื้อขั้นต่ำ (บาท)</label>
        <input class="input" id="prMin" type="number" value="${p?.min_total ?? 0}"></div>
      <div class="grid g-2" style="gap:12px">
        <div class="field"><label>เริ่มต้น</label><input class="input" type="date" id="prStart" value="${esc(p?.start_date || '')}"></div>
        <div class="field"><label>สิ้นสุด</label><input class="input" type="date" id="prEnd" value="${esc(p?.end_date || '')}"></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer">
        <input type="checkbox" id="prActive" ${!p || p.is_active ? 'checked' : ''}> เปิดใช้งานโปรโมชั่นนี้</label>`,
    footer: `<button class="btn" data-close>ยกเลิก</button>
             <button class="btn btn-primary" id="savePromo">บันทึก</button>`,
  });

  $('#savePromo', m.el).onclick = async () => {
    const body = {
      code: $('#prCode', m.el).value.trim(),
      name: $('#prName', m.el).value.trim(),
      type: $('#prType', m.el).value,
      value: Number($('#prValue', m.el).value),
      min_total: Number($('#prMin', m.el).value),
      start_date: $('#prStart', m.el).value || null,
      end_date: $('#prEnd', m.el).value || null,
      is_active: $('#prActive', m.el).checked ? 1 : 0,
    };
    if (!body.code || !body.name || !body.value) return toast('กรุณากรอกโค้ด ชื่อ และมูลค่าส่วนลด', 'err');
    try {
      if (isNew) await api.post('/promotions', body);
      else await api.put(`/promotions/${p.id}`, body);
      m.close(); toast('บันทึกโปรโมชั่นเรียบร้อย', 'ok'); draw();
    } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------------------------------------------------------------
// ค่าใช้จ่าย
// ---------------------------------------------------------------
async function drawExpense(box) {
  if (!auth.can('owner', 'manager')) {
    box.innerHTML = emptyHTML('เฉพาะผู้จัดการขึ้นไปเท่านั้น', '🔒');
    return;
  }
  const list = await api.expenses({});
  const total = list.reduce((s, e) => s + e.amount, 0);
  box.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>ค่าใช้จ่ายร้าน</h3>
        <div class="sub">${list.length} รายการ · รวม ${baht(total)}</div></div>
        <div class="spacer"></div>
        <button class="btn btn-sm btn-primary" id="addExp">+ บันทึกค่าใช้จ่าย</button></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>วันที่</th><th>หมวดหมู่</th><th>รายการ</th>
          <th class="t-right">จำนวนเงิน</th><th>ผู้บันทึก</th><th class="t-center"></th></tr></thead>
        <tbody>${list.length ? list.map((e) => `
          <tr><td>${fmtDate(e.spent_at)}</td>
            <td><span class="badge b-gray">${esc(e.category)}</span></td>
            <td><b>${esc(e.title)}</b>${e.note ? `<div style="font-size:11.5px;color:var(--muted)">${esc(e.note)}</div>` : ''}</td>
            <td class="t-right mono" style="font-weight:600;color:var(--red)">${baht(e.amount)}</td>
            <td style="font-size:12.5px">${esc(e.user_name || '-')}</td>
            <td class="t-center"><button class="btn btn-sm btn-ghost" data-del="${e.id}" style="color:var(--red)">ลบ</button></td>
          </tr>`).join('') : `<tr><td colspan="6">${emptyHTML('ยังไม่มีรายการค่าใช้จ่าย', '🧾')}</td></tr>`}</tbody>
      </table></div>
    </div>`;

  $('#addExp').onclick = () => {
    const m = modal({
      title: 'บันทึกค่าใช้จ่าย',
      body: `
        <div class="grid g-2" style="gap:12px">
          <div class="field"><label>หมวดหมู่</label>
            <select class="select" id="eCat">
              ${['วัตถุดิบ', 'ค่าเช่า', 'เงินเดือน', 'สาธารณูปโภค', 'การตลาด', 'อุปกรณ์', 'อื่นๆ']
                .map((c) => `<option>${c}</option>`).join('')}
            </select></div>
          <div class="field"><label>วันที่</label><input class="input" type="date" id="eDate" value="${todayStr()}"></div>
        </div>
        <div class="field"><label>รายการ *</label><input class="input" id="eTitle" autofocus></div>
        <div class="field"><label>จำนวนเงิน (บาท) *</label><input class="input" id="eAmt" type="number" step="0.01"></div>
        <div class="field"><label>หมายเหตุ</label><input class="input" id="eNote"></div>`,
      footer: `<button class="btn" data-close>ยกเลิก</button>
               <button class="btn btn-primary" id="saveExp">บันทึก</button>`,
    });
    $('#saveExp', m.el).onclick = async () => {
      try {
        await api.post('/expenses', {
          category: $('#eCat', m.el).value,
          title: $('#eTitle', m.el).value.trim(),
          amount: Number($('#eAmt', m.el).value),
          spent_at: $('#eDate', m.el).value,
          note: $('#eNote', m.el).value.trim() || null,
        });
        m.close(); toast('บันทึกค่าใช้จ่ายเรียบร้อย', 'ok'); draw();
      } catch (e) { toast(e.message, 'err'); }
    };
  };

  $$('[data-del]', box).forEach((b) => b.onclick = async () => {
    if (!await confirmBox('ลบรายการค่าใช้จ่ายนี้ ?', { danger: true, okText: 'ลบ' })) return;
    try { await api.del(`/expenses/${b.dataset.del}`); toast('ลบเรียบร้อย', 'ok'); draw(); }
    catch (e) { toast(e.message, 'err'); }
  });
}

// ---------------------------------------------------------------
// กะการขาย
// ---------------------------------------------------------------
async function drawShift(box) {
  const cur = await api.currentShift();
  const history = auth.can('owner', 'manager') ? await api.get('/shifts') : [];

  box.innerHTML = `
    <div class="grid" style="grid-template-columns:1fr 1.3fr">
      <div class="card">
        <div class="card-head"><h3>กะปัจจุบัน</h3></div>
        <div class="card-body">
          ${cur ? `
            <div style="padding:14px;background:var(--green-50);border-radius:12px;margin-bottom:16px">
              <span class="badge b-green">กำลังเปิดกะ</span>
              <div style="margin-top:10px;font-size:12.5px;color:var(--muted)">เปิดโดย</div>
              <b>${esc(cur.full_name || '-')}</b>
              <div style="margin-top:8px;font-size:12.5px;color:var(--muted)">เวลาเปิด</div>
              <b>${fmtDateTime(cur.opened_at)}</b>
            </div>
            <div class="sum-line"><span>เงินสดตั้งต้น</span><b class="mono">${baht(cur.opening_cash)}</b></div>
            <div class="sum-line"><span>ยอดขายในกะ</span><b class="mono">${baht(cur.total_sales)}</b></div>
            <div class="sum-line"><span>จำนวนบิล</span><b class="mono">${num(cur.total_orders)}</b></div>
            <button class="btn btn-danger btn-block btn-lg" style="margin-top:14px" id="closeShift">ปิดกะและสรุปยอด</button>`
          : `<div class="empty" style="padding:24px"><span class="em">🔓</span>ยังไม่ได้เปิดกะ</div>
             <button class="btn btn-primary btn-block btn-lg" id="openShift">เปิดกะการขาย</button>`}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>ประวัติกะการขาย</h3></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>ผู้เปิดกะ</th><th>เปิด</th><th>ปิด</th>
            <th class="t-right">เงินตั้งต้น</th><th class="t-right">ยอดขาย</th>
            <th class="t-center">บิล</th><th class="t-center">สถานะ</th></tr></thead>
          <tbody>${history.length ? history.map((s) => `
            <tr><td><b>${esc(s.full_name || '-')}</b></td>
              <td style="font-size:12.5px">${fmtDateTime(s.opened_at)}</td>
              <td style="font-size:12.5px">${s.closed_at ? fmtDateTime(s.closed_at) : '-'}</td>
              <td class="t-right mono">${baht(s.opening_cash)}</td>
              <td class="t-right mono" style="font-weight:600">${baht(s.total_sales)}</td>
              <td class="t-center">${num(s.total_orders)}</td>
              <td class="t-center">${s.status === 'open'
                ? '<span class="badge b-green">เปิดอยู่</span>' : '<span class="badge b-gray">ปิดแล้ว</span>'}</td>
            </tr>`).join('') : `<tr><td colspan="7">${emptyHTML('ยังไม่มีประวัติ', '🔐')}</td></tr>`}</tbody>
        </table></div>
      </div>
    </div>`;

  const open = $('#openShift');
  if (open) open.onclick = () => {
    const m = modal({
      title: 'เปิดกะการขาย',
      body: `<div class="field"><label>เงินสดตั้งต้นในลิ้นชัก (บาท)</label>
        <input class="input" id="oCash" type="number" step="0.01" value="1000" autofocus></div>`,
      footer: `<button class="btn" data-close>ยกเลิก</button>
               <button class="btn btn-primary" id="doOpen">เปิดกะ</button>`,
    });
    $('#doOpen', m.el).onclick = async () => {
      try {
        await api.post('/shifts/open', { opening_cash: Number($('#oCash', m.el).value) });
        m.close(); toast('เปิดกะเรียบร้อย', 'ok'); draw();
      } catch (e) { toast(e.message, 'err'); }
    };
  };

  const close = $('#closeShift');
  if (close) close.onclick = () => {
    const m = modal({
      title: 'ปิดกะและสรุปยอด',
      body: `
        <div class="sum-line"><span>เงินสดตั้งต้น</span><b class="mono">${baht(cur.opening_cash)}</b></div>
        <div class="sum-line"><span>ยอดขายในกะ</span><b class="mono">${baht(cur.total_sales)}</b></div>
        <div class="field" style="margin-top:14px"><label>เงินสดที่นับได้จริงในลิ้นชัก (บาท)</label>
          <input class="input" id="cCash" type="number" step="0.01" autofocus></div>
        <div class="field"><label>หมายเหตุ</label><input class="input" id="cNote"></div>`,
      footer: `<button class="btn" data-close>ยกเลิก</button>
               <button class="btn btn-danger" id="doClose">ปิดกะ</button>`,
    });
    $('#doClose', m.el).onclick = async () => {
      try {
        const r = await api.post('/shifts/close', {
          closing_cash: Number($('#cCash', m.el).value),
          note: $('#cNote', m.el).value.trim() || null,
        });
        m.close();
        toast(`ปิดกะแล้ว · เงินสดที่ควรมี ${baht(r.expected_cash)} · ผลต่าง ${baht(r.diff)}`,
          Math.abs(r.diff) < 1 ? 'ok' : 'warn');
        draw();
      } catch (e) { toast(e.message, 'err'); }
    };
  };
}
