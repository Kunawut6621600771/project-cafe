/** หน้าออเดอร์ — คิวหน้าร้าน + ประวัติการขาย */
import { api, auth } from '../api.js';
import { refreshQueueBadge } from '../app.js';
import { showReceipt } from './pos.js';
import {
  $, $$, esc, baht, num, toast, modal, confirmBox, emptyHTML, statusBadge,
  ORDER_TYPE, PAYMENT, PAYMENT_ICON, fmtDateTime, fmtTime, ago, todayStr, dateShift,
} from '../utils.js';

const NEXT = { pending: 'preparing', preparing: 'ready', ready: 'completed' };
const NEXT_LABEL = { pending: 'เริ่มทำ', preparing: 'ทำเสร็จแล้ว', ready: 'ส่งให้ลูกค้าแล้ว' };

let tab = 'queue';
const filter = { date_from: dateShift(-6), date_to: todayStr(), status: '', order_type: '', q: '', page: 1 };

export default {
  async render(root) {
    root.innerHTML = `
      <div class="tabs">
        <button data-tab="queue" class="${tab === 'queue' ? 'active' : ''}">🔥 คิวหน้าร้าน</button>
        <button data-tab="history" class="${tab === 'history' ? 'active' : ''}">📋 ประวัติออเดอร์</button>
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

async function draw() {
  const box = $('#tabBody');
  box.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลด...</div>';
  if (tab === 'queue') await drawQueue(box);
  else await drawHistory(box);
}

// ---------------------------------------------------------------
// คิวหน้าร้าน
// ---------------------------------------------------------------
async function drawQueue(box) {
  const list = await api.queue();
  const cols = [
    ['pending', 'รอทำ', '#fffbeb', '#b45309'],
    ['preparing', 'กำลังทำ', '#eff6ff', '#1d4ed8'],
    ['ready', 'พร้อมเสิร์ฟ', '#f5f3ff', '#6d28d9'],
  ];

  box.innerHTML = `
    <div class="row" style="margin-bottom:14px">
      <span class="badge b-green">${list.length} ออเดอร์ในคิว</span>
      <div class="spacer"></div>
      <button class="btn btn-sm" id="reloadQ">🔄 รีเฟรช</button>
      <a href="#/pos" class="btn btn-sm btn-primary">+ เปิดออเดอร์ใหม่</a>
    </div>
    <div class="grid g-3">
      ${cols.map(([key, label, bg, fg]) => {
        const items = list.filter((o) => o.status === key);
        return `<div class="card">
          <div class="card-head" style="background:${bg}">
            <h3 style="color:${fg}">${label}</h3>
            <div class="spacer"></div><span class="badge b-gray">${items.length}</span>
          </div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:11px;min-height:130px">
            ${items.length ? items.map((o) => `
              <div class="card" style="box-shadow:none;border-color:var(--line)">
                <div style="padding:12px">
                  <div class="row">
                    <b class="mono" style="font-size:13px">${esc(o.order_no)}</b>
                    <div class="spacer"></div>
                    <span style="font-size:11.5px;color:var(--muted)">${ago(o.created_at)}</span>
                  </div>
                  <div style="font-size:12px;color:var(--muted);margin:3px 0 8px">
                    ${ORDER_TYPE[o.order_type]}${o.table_no ? ` · โต๊ะ ${esc(o.table_no)}` : ''} · ${baht(o.total)}
                  </div>
                  ${o.items.map((i) => `
                    <div style="font-size:12.5px;padding:3px 0;border-top:1px dashed var(--line-2)">
                      <b>${i.qty}x</b> ${esc(i.product_name)}
                      ${i.options_text ? `<div style="color:var(--muted);font-size:11px;padding-left:16px">${esc(i.options_text)}</div>` : ''}
                      ${i.note ? `<div style="color:var(--amber);font-size:11px;padding-left:16px">📝 ${esc(i.note)}</div>` : ''}
                    </div>`).join('')}
                  <button class="btn btn-sm btn-primary btn-block" style="margin-top:10px"
                          data-next="${o.id}" data-status="${o.status}">${NEXT_LABEL[o.status]} →</button>
                </div>
              </div>`).join('') : `<div class="empty" style="padding:24px">ไม่มีรายการ</div>`}
          </div>
        </div>`;
      }).join('')}
    </div>`;

  $('#reloadQ').onclick = draw;
  $$('[data-next]', box).forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try {
      await api.orderStatus(b.dataset.next, NEXT[b.dataset.status]);
      toast('อัปเดตสถานะเรียบร้อย', 'ok');
      refreshQueueBadge();
      draw();
    } catch (e) { toast(e.message, 'err'); b.disabled = false; }
  });
}

// ---------------------------------------------------------------
// ประวัติออเดอร์
// ---------------------------------------------------------------
async function drawHistory(box) {
  const r = await api.orders(filter);
  const sum = r.data.filter((o) => o.status === 'completed').reduce((s, o) => s + o.total, 0);

  box.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="card-body" style="padding:14px">
        <div class="row wrap" style="gap:9px">
          <div><label style="font-size:11.5px;color:var(--muted)">ตั้งแต่</label>
            <input class="input" type="date" id="fFrom" value="${filter.date_from}" style="width:150px"></div>
          <div><label style="font-size:11.5px;color:var(--muted)">ถึง</label>
            <input class="input" type="date" id="fTo" value="${filter.date_to}" style="width:150px"></div>
          <div><label style="font-size:11.5px;color:var(--muted)">สถานะ</label>
            <select class="select" id="fStatus" style="width:135px">
              <option value="">ทั้งหมด</option>
              <option value="completed">สำเร็จ</option>
              <option value="pending">รอทำ</option>
              <option value="preparing">กำลังทำ</option>
              <option value="ready">พร้อมเสิร์ฟ</option>
              <option value="cancelled">ยกเลิก</option>
            </select></div>
          <div><label style="font-size:11.5px;color:var(--muted)">ประเภท</label>
            <select class="select" id="fType" style="width:135px">
              <option value="">ทั้งหมด</option>
              ${Object.entries(ORDER_TYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
            </select></div>
          <div style="flex:1;min-width:180px"><label style="font-size:11.5px;color:var(--muted)">ค้นหา</label>
            <div class="search"><input class="input" id="fQ" placeholder="เลขที่บิล / ชื่อ / เบอร์" value="${esc(filter.q)}"></div></div>
          <div style="align-self:flex-end"><button class="btn btn-primary" id="btnFilter">ค้นหา</button></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><h3>ผลการค้นหา</h3><div class="sub">พบ ${num(r.total)} รายการ · ยอดขายในหน้านี้ ${baht(sum)}</div></div>
        <div class="spacer"></div>
        <button class="btn btn-sm" id="exportCsv">⬇ ส่งออก CSV</button>
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>เลขที่</th><th>วันที่/เวลา</th><th>รายการ</th><th>ลูกค้า</th>
            <th>ประเภท</th><th>ชำระ</th><th class="t-right">ยอดสุทธิ</th><th>สถานะ</th><th></th>
          </tr></thead>
          <tbody>
            ${r.data.length ? r.data.map((o) => `
              <tr>
                <td class="mono" style="font-weight:600">${esc(o.order_no)}</td>
                <td style="font-size:12.5px;color:var(--muted)">${fmtDateTime(o.created_at)}</td>
                <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)"
                    title="${esc(o.items_summary || '')}">${esc(o.items_summary || '-')}</td>
                <td>${o.member_name ? esc(o.member_name) : '<span style="color:var(--muted-2)">ทั่วไป</span>'}</td>
                <td>${ORDER_TYPE[o.order_type]}</td>
                <td>${PAYMENT_ICON[o.payment_method] || ''} ${PAYMENT[o.payment_method] || '-'}</td>
                <td class="t-right mono" style="font-weight:600">${baht(o.total)}</td>
                <td>${statusBadge(o.status)}</td>
                <td class="t-right"><button class="btn btn-sm" data-view="${o.id}">ดู</button></td>
              </tr>`).join('') : `<tr><td colspan="9">${emptyHTML('ไม่พบออเดอร์ตามเงื่อนไข', '🔍')}</td></tr>`}
          </tbody>
        </table>
      </div>
      ${pager(r)}
    </div>`;

  $('#fStatus').value = filter.status;
  $('#fType').value = filter.order_type;

  $('#btnFilter').onclick = () => {
    filter.date_from = $('#fFrom').value;
    filter.date_to = $('#fTo').value;
    filter.status = $('#fStatus').value;
    filter.order_type = $('#fType').value;
    filter.q = $('#fQ').value.trim();
    filter.page = 1;
    draw();
  };
  $('#fQ').onkeydown = (e) => { if (e.key === 'Enter') $('#btnFilter').click(); };
  $$('[data-page]', box).forEach((b) => b.onclick = () => { filter.page = Number(b.dataset.page); draw(); });
  $$('[data-view]', box).forEach((b) => b.onclick = () => viewOrder(b.dataset.view));
  $('#exportCsv').onclick = () => exportCsv(r.data);
}

function pager(r) {
  if (r.pages <= 1) return '';
  const cur = r.page;
  const list = [];
  for (let i = 1; i <= r.pages; i++) {
    if (i === 1 || i === r.pages || Math.abs(i - cur) <= 2) list.push(i);
    else if (list[list.length - 1] !== '…') list.push('…');
  }
  return `<div class="pager">
    <button data-page="${cur - 1}" ${cur === 1 ? 'disabled' : ''}>‹</button>
    ${list.map((i) => i === '…' ? '<span style="padding:0 4px;color:var(--muted)">…</span>'
      : `<button data-page="${i}" class="${i === cur ? 'active' : ''}">${i}</button>`).join('')}
    <button data-page="${cur + 1}" ${cur === r.pages ? 'disabled' : ''}>›</button>
  </div>`;
}

async function viewOrder(id) {
  const o = await api.order(id);
  const canCancel = auth.can('owner', 'manager') && o.status !== 'cancelled';
  const m = modal({
    title: `ออเดอร์ ${o.order_no}`,
    wide: true,
    body: `
      <div class="grid g-2" style="margin-bottom:16px">
        <div>
          <div style="font-size:12px;color:var(--muted)">สถานะ</div>
          <div style="margin:4px 0 12px">${statusBadge(o.status)}</div>
          <div style="font-size:12px;color:var(--muted)">วันที่/เวลา</div>
          <div style="margin-bottom:12px">${fmtDateTime(o.created_at)}</div>
          <div style="font-size:12px;color:var(--muted)">พนักงานขาย</div>
          <div>${esc(o.cashier || '-')}</div>
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted)">ลูกค้า</div>
          <div style="margin-bottom:12px">${o.member_name ? `${esc(o.member_name)} (${esc(o.member_code || '')})` : 'ลูกค้าทั่วไป'}</div>
          <div style="font-size:12px;color:var(--muted)">ประเภท / ชำระเงิน</div>
          <div style="margin-bottom:12px">${ORDER_TYPE[o.order_type]}${o.table_no ? ` · โต๊ะ ${esc(o.table_no)}` : ''}
            · ${PAYMENT[o.payment_method] || '-'}</div>
          ${o.note ? `<div style="font-size:12px;color:var(--muted)">หมายเหตุ</div><div>${esc(o.note)}</div>` : ''}
        </div>
      </div>

      <table class="tbl" style="border:1px solid var(--line);border-radius:10px;overflow:hidden">
        <thead><tr><th>รายการ</th><th class="t-center">จำนวน</th>
          <th class="t-right">ราคา/หน่วย</th><th class="t-right">รวม</th></tr></thead>
        <tbody>${o.items.map((i) => `
          <tr><td><b>${esc(i.product_name)}</b>
            ${i.options_text ? `<div style="font-size:11.5px;color:var(--muted)">${esc(i.options_text)}</div>` : ''}
            ${i.note ? `<div style="font-size:11.5px;color:var(--amber)">📝 ${esc(i.note)}</div>` : ''}</td>
            <td class="t-center">${i.qty}</td>
            <td class="t-right mono">${baht(i.unit_price + i.options_price)}</td>
            <td class="t-right mono">${baht(i.line_total)}</td></tr>`).join('')}</tbody>
      </table>

      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line-2)">
        <div class="sum-line"><span>ยอดรวม</span><span class="mono">${baht(o.subtotal)}</span></div>
        ${o.discount ? `<div class="sum-line" style="color:var(--red)"><span>ส่วนลด${o.promotion_name ? ` (${esc(o.promotion_name)})` : ''}</span>
          <span class="mono">-${baht(o.discount)}</span></div>` : ''}
        <div class="sum-line total"><span>ยอดสุทธิ</span><span class="mono">${baht(o.total)}</span></div>
        ${o.points_earned ? `<div class="sum-line"><span>แต้มที่ได้รับ</span><span>+${o.points_earned} แต้ม</span></div>` : ''}
      </div>`,
    footer: `
      ${canCancel ? `<button class="btn btn-danger" id="cancelBtn">ยกเลิกออเดอร์</button>` : ''}
      <div class="spacer" style="flex:1"></div>
      <button class="btn" data-close>ปิด</button>
      <button class="btn btn-primary" id="rcpt">🧾 ดูใบเสร็จ</button>`,
  });

  $('#rcpt', m.el).onclick = () => { m.close(); showReceipt(o.id); };
  const cb = $('#cancelBtn', m.el);
  if (cb) cb.onclick = async () => {
    const ok = await confirmBox(
      `ยกเลิกออเดอร์ ${o.order_no} ยอด ${baht(o.total)} ?\nระบบจะคืนวัตถุดิบเข้าสต็อกและปรับแต้มสมาชิกอัตโนมัติ`,
      { title: 'ยืนยันการยกเลิก', danger: true, okText: 'ยกเลิกออเดอร์' });
    if (!ok) return;
    try {
      await api.cancelOrder(o.id, 'ยกเลิกโดยพนักงาน');
      m.close(); toast('ยกเลิกออเดอร์และคืนสต็อกเรียบร้อย', 'ok');
      refreshQueueBadge(); draw();
    } catch (e) { toast(e.message, 'err'); }
  };
}

function exportCsv(rows) {
  const head = ['เลขที่', 'วันที่', 'รายการ', 'ลูกค้า', 'ประเภท', 'ชำระเงิน', 'ยอดรวม', 'ส่วนลด', 'ยอดสุทธิ', 'สถานะ'];
  const body = rows.map((o) => [
    o.order_no, o.created_at, (o.items_summary || '').replace(/"/g, "'"),
    o.member_name || 'ทั่วไป', ORDER_TYPE[o.order_type], PAYMENT[o.payment_method] || '',
    o.subtotal, o.discount, o.total, o.status,
  ]);
  const csv = '﻿' + [head, ...body].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `orders_${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('ส่งออกไฟล์ CSV เรียบร้อย', 'ok');
}
