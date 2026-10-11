/** หน้าคลังวัตถุดิบ */
import { api, auth } from '../api.js';
import {
  $, $$, esc, baht, baht2, num, toast, modal, confirmBox, emptyHTML,
  MOVE_TYPE, fmtDateTime,
} from '../utils.js';

let tab = 'list';
const filter = { q: '', status: '' };

export default {
  async render(root) {
    const s = await api.stockSummary();

    root.innerHTML = `
      <div class="grid g-4" style="margin-bottom:16px">
        ${card('📦', '#eff6ff', '#2563eb', 'วัตถุดิบทั้งหมด', `${num(s.total)} <small>รายการ</small>`)}
        ${card('⚠️', '#fffbeb', '#b45309', 'ใกล้หมด (ต่ำกว่าขั้นต่ำ)', `${num(s.low_stock)} <small>รายการ</small>`)}
        ${card('🚨', '#fef2f2', '#dc2626', 'หมดสต็อก', `${num(s.out_of_stock)} <small>รายการ</small>`)}
        ${card('💎', '#f0fdf4', '#15803d', 'มูลค่าสต็อกคงเหลือ', baht(s.stock_value),
          `ใช้ไปวันนี้ ${baht(s.today_usage_cost)}`)}
      </div>

      <div class="tabs">
        <button data-tab="list" class="${tab === 'list' ? 'active' : ''}">📋 รายการวัตถุดิบ</button>
        <button data-tab="moves" class="${tab === 'moves' ? 'active' : ''}">🔄 ประวัติการเคลื่อนไหว</button>
        <button data-tab="alerts" class="${tab === 'alerts' ? 'active' : ''}">🛒 รายการที่ควรสั่งซื้อ</button>
      </div>
      <div id="tabBody"></div>`;

    $$('.tabs button', root).forEach((b) => b.onclick = () => {
      tab = b.dataset.tab;
      $$('.tabs button', root).forEach((x) => x.classList.toggle('active', x === b));
      draw();
    });
    await draw();
  },
};

const card = (ico, bg, fg, label, value, sub) => `
  <div class="card kpi"><div class="top">
    <div class="ico" style="background:${bg};color:${fg}">${ico}</div>
    <div><div class="label">${label}</div><div class="value">${value}</div>
      ${sub ? `<div class="delta"><span style="color:var(--muted)">${sub}</span></div>` : ''}</div>
  </div></div>`;

async function draw() {
  const box = $('#tabBody');
  box.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลด...</div>';
  if (tab === 'list') await drawList(box);
  else if (tab === 'moves') await drawMoves(box);
  else await drawAlerts(box);
}

// ---------------------------------------------------------------
async function drawList(box) {
  const list = await api.ingredients(filter);
  const canEdit = auth.can('owner', 'manager');

  box.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div class="search" style="width:280px"><input class="input" id="sQ" placeholder="ค้นหาวัตถุดิบ / ผู้ขาย" value="${esc(filter.q)}"></div>
        <select class="select" id="sStatus" style="width:160px">
          <option value="">สถานะทั้งหมด</option>
          <option value="ok">สต็อกปกติ</option>
          <option value="low">ใกล้หมด</option>
          <option value="out">หมดสต็อก</option>
        </select>
        <div class="spacer"></div>
        ${canEdit ? '<button class="btn btn-sm" id="addIng">+ เพิ่มวัตถุดิบ</button>' : ''}
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>รหัส</th><th>ชื่อวัตถุดิบ</th><th class="t-right">คงเหลือ</th><th class="t-right">ขั้นต่ำ</th>
            <th style="width:130px">ระดับสต็อก</th><th class="t-right">ต้นทุน/หน่วย</th>
            <th class="t-right">มูลค่า</th><th>ผู้ขาย</th><th class="t-center">จัดการ</th>
          </tr></thead>
          <tbody>${list.length ? list.map((i) => {
            const pct = Math.min(100, Math.round((i.stock_qty / (i.min_qty * 2 || 1)) * 100));
            const cls = { out: 'danger', low: 'warn' }[i.stock_status] || '';
            const badge = { ok: '<span class="badge b-green">ปกติ</span>',
                            low: '<span class="badge b-amber">ใกล้หมด</span>',
                            out: '<span class="badge b-red">หมด</span>' }[i.stock_status];
            return `<tr>
              <td class="mono" style="color:var(--muted);font-size:12.5px">${esc(i.code || '-')}</td>
              <td><b>${esc(i.name)}</b> ${badge}</td>
              <td class="t-right mono" style="font-weight:600">${num(i.stock_qty, 2)} <small style="color:var(--muted)">${esc(i.unit)}</small></td>
              <td class="t-right mono" style="color:var(--muted)">${num(i.min_qty, 2)}</td>
              <td><div class="progress ${cls}"><i style="width:${pct}%"></i></div></td>
              <td class="t-right mono">${baht2(i.cost_per_unit)}</td>
              <td class="t-right mono">${baht(i.stock_value)}</td>
              <td style="font-size:12.5px;color:var(--muted)">${esc(i.supplier || '-')}</td>
              <td class="t-center" style="white-space:nowrap">
                <button class="btn btn-sm btn-primary" data-move="${i.id}">รับเข้า</button>
                <button class="btn btn-sm" data-adj="${i.id}">ปรับ</button>
                ${canEdit ? `<button class="btn btn-sm btn-ghost" data-edit="${i.id}">✏️</button>` : ''}
              </td></tr>`;
          }).join('') : `<tr><td colspan="9">${emptyHTML('ไม่พบวัตถุดิบ', '📦')}</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;

  $('#sStatus').value = filter.status;
  $('#sQ').oninput = (e) => { filter.q = e.target.value.trim(); clearTimeout(window._st); window._st = setTimeout(draw, 300); };
  $('#sStatus').onchange = (e) => { filter.status = e.target.value; draw(); };
  const add = $('#addIng'); if (add) add.onclick = () => ingredientForm(null);
  $$('[data-move]', box).forEach((b) => b.onclick = () => moveForm(list.find((x) => x.id == b.dataset.move), 'in'));
  $$('[data-adj]', box).forEach((b) => b.onclick = () => moveForm(list.find((x) => x.id == b.dataset.adj), 'adjust'));
  $$('[data-edit]', box).forEach((b) => b.onclick = () => ingredientForm(list.find((x) => x.id == b.dataset.edit)));
}

// ---------------------------------------------------------------
async function drawMoves(box) {
  const [moves, ings] = await Promise.all([api.movements({ limit: 100 }), api.ingredients()]);
  box.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>ประวัติการเคลื่อนไหวสต็อก</h3><div class="sub">100 รายการล่าสุด</div>
        <div class="spacer"></div>
        <select class="select" id="mIng" style="width:220px">
          <option value="">วัตถุดิบทั้งหมด</option>
          ${ings.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}
        </select>
        <select class="select" id="mType" style="width:150px">
          <option value="">ทุกประเภท</option>
          ${Object.entries(MOVE_TYPE).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>วันที่/เวลา</th><th>วัตถุดิบ</th><th>ประเภท</th>
          <th class="t-right">จำนวน</th><th class="t-right">คงเหลือ</th>
          <th class="t-right">มูลค่า</th><th>หมายเหตุ</th><th>ผู้ทำรายการ</th></tr></thead>
        <tbody>${moves.length ? moves.map((m) => {
          const t = MOVE_TYPE[m.type];
          return `<tr>
            <td style="font-size:12.5px;color:var(--muted);white-space:nowrap">${fmtDateTime(m.created_at)}</td>
            <td><b>${esc(m.ingredient_name)}</b></td>
            <td><span class="badge ${t.cls}">${t.label}</span></td>
            <td class="t-right mono" style="font-weight:600;color:${m.qty >= 0 ? 'var(--green-700)' : 'var(--red)'}">
              ${m.qty >= 0 ? '+' : ''}${num(m.qty, 2)} ${esc(m.unit)}</td>
            <td class="t-right mono">${num(m.balance_after, 2)}</td>
            <td class="t-right mono" style="color:var(--muted)">${baht(m.cost)}</td>
            <td style="font-size:12.5px;color:var(--muted)">${esc(m.note || '-')}</td>
            <td style="font-size:12.5px">${esc(m.user_name || '-')}</td></tr>`;
        }).join('') : `<tr><td colspan="8">${emptyHTML('ยังไม่มีการเคลื่อนไหว', '🔄')}</td></tr>`}</tbody>
      </table></div>
    </div>`;

  const reload = async () => {
    const rows = await api.movements({ limit: 100, ingredient_id: $('#mIng').value, type: $('#mType').value });
    const tb = $('tbody', box);
    tb.innerHTML = rows.length ? rows.map((m) => {
      const t = MOVE_TYPE[m.type];
      return `<tr>
        <td style="font-size:12.5px;color:var(--muted);white-space:nowrap">${fmtDateTime(m.created_at)}</td>
        <td><b>${esc(m.ingredient_name)}</b></td>
        <td><span class="badge ${t.cls}">${t.label}</span></td>
        <td class="t-right mono" style="font-weight:600;color:${m.qty >= 0 ? 'var(--green-700)' : 'var(--red)'}">
          ${m.qty >= 0 ? '+' : ''}${num(m.qty, 2)} ${esc(m.unit)}</td>
        <td class="t-right mono">${num(m.balance_after, 2)}</td>
        <td class="t-right mono" style="color:var(--muted)">${baht(m.cost)}</td>
        <td style="font-size:12.5px;color:var(--muted)">${esc(m.note || '-')}</td>
        <td style="font-size:12.5px">${esc(m.user_name || '-')}</td></tr>`;
    }).join('') : `<tr><td colspan="8">${emptyHTML('ไม่พบรายการ')}</td></tr>`;
  };
  $('#mIng').onchange = reload;
  $('#mType').onchange = reload;
}

// ---------------------------------------------------------------
async function drawAlerts(box) {
  const list = await api.stockAlerts();
  box.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h3>รายการที่ควรสั่งซื้อ</h3>
          <div class="sub">วัตถุดิบที่คงเหลือต่ำกว่าหรือเท่ากับจุดสั่งซื้อ</div></div>
        <div class="spacer"></div>
        <button class="btn btn-sm" id="printPo">🖨️ พิมพ์ใบสั่งซื้อ</button>
      </div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>รหัส</th><th>วัตถุดิบ</th><th class="t-right">คงเหลือ</th>
          <th class="t-right">จุดสั่งซื้อ</th><th class="t-right">แนะนำให้สั่ง</th><th>ผู้ขาย</th><th class="t-center"></th></tr></thead>
        <tbody>${list.length ? list.map((i) => `
          <tr>
            <td class="mono" style="color:var(--muted);font-size:12.5px">${esc(i.code || '-')}</td>
            <td><b>${esc(i.name)}</b></td>
            <td class="t-right mono" style="color:${i.stock_qty <= 0 ? 'var(--red)' : 'var(--amber)'};font-weight:600">
              ${num(i.stock_qty, 2)} ${esc(i.unit)}</td>
            <td class="t-right mono">${num(i.min_qty, 2)}</td>
            <td class="t-right mono" style="font-weight:600">${num(Math.max(i.suggest_order, 0), 2)} ${esc(i.unit)}</td>
            <td style="font-size:12.5px;color:var(--muted)">${esc(i.supplier || '-')}</td>
            <td class="t-center"><button class="btn btn-sm btn-primary" data-move="${i.id}">รับเข้า</button></td>
          </tr>`).join('') : `<tr><td colspan="7">${emptyHTML('สต็อกเพียงพอทุกรายการ 🎉', '✅')}</td></tr>`}</tbody>
      </table></div>
    </div>`;

  $$('[data-move]', box).forEach((b) => b.onclick = async () => {
    const ings = await api.ingredients();
    moveForm(ings.find((x) => x.id == b.dataset.move), 'in');
  });
  $('#printPo').onclick = () => window.print();
}

// ---------------------------------------------------------------
function moveForm(ing, defType = 'in') {
  if (!ing) return;
  const m = modal({
    title: `จัดการสต็อก : ${ing.name}`,
    body: `
      <div style="background:var(--green-50);padding:12px 14px;border-radius:10px;margin-bottom:16px">
        <div style="font-size:12px;color:var(--muted)">คงเหลือปัจจุบัน</div>
        <div style="font-size:22px;font-weight:700">${num(ing.stock_qty, 2)} <small style="font-size:14px">${esc(ing.unit)}</small></div>
      </div>
      <div class="field"><label>ประเภทรายการ</label>
        <div class="pay-methods" style="grid-template-columns:repeat(4,1fr)">
          ${Object.entries(MOVE_TYPE).map(([k, v]) => `
            <label><input type="radio" name="mt" value="${k}" ${k === defType ? 'checked' : ''}>
              <span class="em">${{ in: '📥', out: '📤', adjust: '⚖️', waste: '🗑️' }[k]}</span>${v.label}</label>`).join('')}
        </div>
      </div>
      <div class="field"><label id="qtyLabel">จำนวน (${esc(ing.unit)})</label>
        <input class="input" id="mQty" type="number" step="0.01" min="0" autofocus></div>
      <div class="field" id="costField"><label>ต้นทุนต่อหน่วย (บาท)</label>
        <input class="input" id="mCost" type="number" step="0.01" value="${ing.cost_per_unit}">
        <div class="hint">รายการรับเข้าจะถูกบันทึกเป็นค่าใช้จ่ายหมวด "วัตถุดิบ" อัตโนมัติ</div></div>
      <div class="field"><label>หมายเหตุ</label>
        <input class="input" id="mNote" placeholder="เช่น สั่งซื้อจากไร่กาแฟดอยช้าง"></div>`,
    footer: `<button class="btn" data-close>ยกเลิก</button>
             <button class="btn btn-primary" id="saveMove">บันทึก</button>`,
  });

  m.el.addEventListener('change', (e) => {
    if (e.target.name !== 'mt') return;
    const t = e.target.value;
    $('#qtyLabel', m.el).textContent = t === 'adjust'
      ? `ยอดคงเหลือใหม่ (${ing.unit})` : `จำนวน (${ing.unit})`;
    $('#costField', m.el).style.display = t === 'in' ? 'block' : 'none';
  });
  $('#costField', m.el).style.display = defType === 'in' ? 'block' : 'none';

  $('#saveMove', m.el).onclick = async () => {
    const type = $('input[name="mt"]:checked', m.el).value;
    const qty = Number($('#mQty', m.el).value);
    if (!Number.isFinite(qty)) return toast('กรุณากรอกจำนวน', 'err');
    try {
      await api.moveStock({
        ingredient_id: ing.id, type, qty,
        cost_per_unit: type === 'in' ? Number($('#mCost', m.el).value) : undefined,
        note: $('#mNote', m.el).value.trim() || null,
      });
      m.close(); toast('บันทึกรายการสต็อกเรียบร้อย', 'ok'); draw();
    } catch (e) { toast(e.message, 'err'); }
  };
}

function ingredientForm(ing) {
  const isNew = !ing;
  const m = modal({
    title: isNew ? 'เพิ่มวัตถุดิบใหม่' : `แก้ไข : ${ing.name}`,
    body: `
      <div class="field"><label>ชื่อวัตถุดิบ *</label>
        <input class="input" id="iName" value="${esc(ing?.name || '')}" autofocus></div>
      <div class="grid g-2" style="gap:12px">
        <div class="field"><label>หน่วยนับ</label>
          <input class="input" id="iUnit" value="${esc(ing?.unit || 'กรัม')}" placeholder="กรัม / มล. / ใบ"></div>
        <div class="field"><label>จุดสั่งซื้อ (ขั้นต่ำ)</label>
          <input class="input" id="iMin" type="number" step="0.01" value="${ing?.min_qty ?? 0}"></div>
      </div>
      <div class="grid g-2" style="gap:12px">
        ${isNew ? `<div class="field"><label>ยอดยกมาเริ่มต้น</label>
          <input class="input" id="iQty" type="number" step="0.01" value="0"></div>` : ''}
        <div class="field"><label>ต้นทุนต่อหน่วย (บาท)</label>
          <input class="input" id="iCost" type="number" step="0.01" value="${ing?.cost_per_unit ?? 0}"></div>
      </div>
      <div class="field"><label>ผู้ขาย / ซัพพลายเออร์</label>
        <input class="input" id="iSup" value="${esc(ing?.supplier || '')}"></div>`,
    footer: `${!isNew ? '<button class="btn btn-danger" id="delIng">ลบ</button><div style="flex:1"></div>' : ''}
             <button class="btn" data-close>ยกเลิก</button>
             <button class="btn btn-primary" id="saveIng">บันทึก</button>`,
  });

  $('#saveIng', m.el).onclick = async () => {
    const body = {
      name: $('#iName', m.el).value.trim(),
      unit: $('#iUnit', m.el).value.trim(),
      min_qty: Number($('#iMin', m.el).value),
      cost_per_unit: Number($('#iCost', m.el).value),
      supplier: $('#iSup', m.el).value.trim() || null,
    };
    if (!body.name) return toast('กรุณากรอกชื่อวัตถุดิบ', 'err');
    try {
      if (isNew) await api.post('/stock/ingredients', { ...body, stock_qty: Number($('#iQty', m.el).value) });
      else await api.put(`/stock/ingredients/${ing.id}`, body);
      m.close(); toast('บันทึกเรียบร้อย', 'ok'); draw();
    } catch (e) { toast(e.message, 'err'); }
  };

  const del = $('#delIng', m.el);
  if (del) del.onclick = async () => {
    if (!await confirmBox(`ลบวัตถุดิบ "${ing.name}" ?`, { danger: true, okText: 'ลบ' })) return;
    try {
      const r = await api.del(`/stock/ingredients/${ing.id}`);
      m.close(); toast(r.message, 'ok'); draw();
    } catch (e) { toast(e.message, 'err'); }
  };
}
