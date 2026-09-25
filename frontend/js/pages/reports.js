/** หน้ารายงาน */
import { api } from '../api.js';
import {
  $, $$, esc, baht, num, toast, emptyHTML, barChart, lineChart, donutChart,
  todayStr, dateShift, fmtDate,
} from '../utils.js';

let tab = 'sales';
const range = { date_from: dateShift(-29), date_to: todayStr(), group: 'day' };

export default {
  async render(root) {
    root.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-body" style="padding:14px">
          <div class="row wrap" style="gap:9px">
            <div><label style="font-size:11.5px;color:var(--muted)">ตั้งแต่</label>
              <input class="input" type="date" id="rFrom" value="${range.date_from}" style="width:152px"></div>
            <div><label style="font-size:11.5px;color:var(--muted)">ถึง</label>
              <input class="input" type="date" id="rTo" value="${range.date_to}" style="width:152px"></div>
            <div style="align-self:flex-end"><button class="btn btn-primary" id="applyRange">แสดงรายงาน</button></div>
            <div class="spacer"></div>
            <div class="row" style="gap:5px;align-self:flex-end">
              <button class="btn btn-sm" data-quick="7">7 วัน</button>
              <button class="btn btn-sm" data-quick="30">30 วัน</button>
              <button class="btn btn-sm" data-quick="90">90 วัน</button>
              <button class="btn btn-sm" data-quick="month">เดือนนี้</button>
            </div>
          </div>
        </div>
      </div>

      <div class="tabs">
        <button data-tab="sales" class="${tab === 'sales' ? 'active' : ''}">📈 ยอดขาย</button>
        <button data-tab="products" class="${tab === 'products' ? 'active' : ''}">☕ สินค้า</button>
        <button data-tab="pl" class="${tab === 'pl' ? 'active' : ''}">💰 กำไร-ขาดทุน</button>
        <button data-tab="staff" class="${tab === 'staff' ? 'active' : ''}">👤 พนักงาน</button>
      </div>
      <div id="rBody"></div>`;

    $('#applyRange').onclick = () => {
      range.date_from = $('#rFrom').value;
      range.date_to = $('#rTo').value;
      draw();
    };
    $$('[data-quick]', root).forEach((b) => b.onclick = () => {
      const q = b.dataset.quick;
      if (q === 'month') {
        const d = new Date();
        range.date_from = new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('sv-SE');
      } else range.date_from = dateShift(-(Number(q) - 1));
      range.date_to = todayStr();
      $('#rFrom').value = range.date_from;
      $('#rTo').value = range.date_to;
      draw();
    });
    $$('.tabs button', root).forEach((b) => b.onclick = () => {
      tab = b.dataset.tab;
      $$('.tabs button', root).forEach((x) => x.classList.toggle('active', x === b));
      draw();
    });

    await draw();
  },
};

async function draw() {
  const box = $('#rBody');
  box.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลด...</div>';
  if (tab === 'sales') await drawSales(box);
  else if (tab === 'products') await drawProducts(box);
  else if (tab === 'pl') await drawPL(box);
  else await drawStaff(box);
}

const kpi = (label, value, sub) => `
  <div class="card kpi"><div class="label">${label}</div>
    <div class="value">${value}</div>
    ${sub ? `<div class="delta"><span style="color:var(--muted)">${sub}</span></div>` : ''}</div>`;

// ---------------------------------------------------------------
async function drawSales(box) {
  const r = await api.salesReport(range);
  const s = r.summary;
  const chartData = r.rows.map((x) => ({
    label: x.period, short: x.period.slice(5).replace('-', '/'), value: x.revenue,
  }));

  box.innerHTML = `
    <div class="grid g-4" style="margin-bottom:16px">
      ${kpi('ยอดขายรวม', baht(s.revenue), `${num(s.orders)} บิล`)}
      ${kpi('กำไรขั้นต้น', baht(s.profit), `ต้นทุนขาย ${baht(s.cost)}`)}
      ${kpi('ยอดเฉลี่ยต่อบิล', baht(s.avg_ticket), `ขายได้ ${num(s.items_sold)} ชิ้น`)}
      ${kpi('กำไรสุทธิ', baht(s.net_profit), `หักค่าใช้จ่าย ${baht(s.expenses)}`)}
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head">
        <div><h3>แนวโน้มยอดขาย</h3>
          <div class="sub">${fmtDate(r.from)} – ${fmtDate(r.to)} · ส่วนลดรวม ${baht(s.discount)}</div></div>
        <div class="spacer"></div>
        <button class="btn btn-sm" id="expSales">⬇ ส่งออก CSV</button>
      </div>
      <div class="card-body">${chartData.length > 1 ? lineChart(chartData) : barChart(chartData)}</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>รายละเอียดรายวัน</h3></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>วันที่</th><th class="t-center">จำนวนบิล</th>
          <th class="t-right">ยอดขาย</th><th class="t-right">ส่วนลด</th>
          <th class="t-right">ต้นทุน</th><th class="t-right">กำไรขั้นต้น</th>
          <th class="t-right">เฉลี่ย/บิล</th><th class="t-right">อัตรากำไร</th></tr></thead>
        <tbody>${r.rows.length ? r.rows.slice().reverse().map((x) => `
          <tr><td>${fmtDate(x.period)}</td>
            <td class="t-center">${num(x.orders)}</td>
            <td class="t-right mono" style="font-weight:600">${baht(x.revenue)}</td>
            <td class="t-right mono" style="color:var(--red)">${x.discount ? '-' + baht(x.discount) : '-'}</td>
            <td class="t-right mono" style="color:var(--muted)">${baht(x.cost)}</td>
            <td class="t-right mono" style="color:var(--green-700);font-weight:600">${baht(x.profit)}</td>
            <td class="t-right mono">${baht(x.avg_ticket)}</td>
            <td class="t-right mono">${x.revenue ? Math.round(x.profit / x.revenue * 100) : 0}%</td></tr>`).join('')
          : `<tr><td colspan="8">${emptyHTML('ไม่มีข้อมูลในช่วงเวลานี้', '📊')}</td></tr>`}</tbody>
      </table></div>
    </div>`;

  $('#expSales').onclick = () => csv('sales', ['วันที่', 'บิล', 'ยอดขาย', 'ส่วนลด', 'ต้นทุน', 'กำไร'],
    r.rows.map((x) => [x.period, x.orders, x.revenue, x.discount, x.cost, x.profit]));
}

// ---------------------------------------------------------------
async function drawProducts(box) {
  const rows = await api.productReport(range);
  const top = rows.slice(0, 10);
  const byCat = {};
  rows.forEach((r) => { byCat[r.category] = (byCat[r.category] || 0) + r.revenue; });

  box.innerHTML = `
    <div class="grid" style="grid-template-columns:1.5fr 1fr;margin-bottom:16px">
      <div class="card">
        <div class="card-head"><h3>10 อันดับเมนูขายดี</h3><div class="sub">ตามจำนวนแก้ว/ชิ้น</div></div>
        <div class="card-body">${barChart(
          top.map((r) => ({ label: r.name, short: r.name.length > 8 ? r.name.slice(0, 7) + '…' : r.name, value: r.qty })),
          { format: (v) => num(Math.round(v)), highlightLast: false })}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>สัดส่วนรายได้ตามหมวด</h3></div>
        <div class="card-body">${donutChart(Object.entries(byCat).map(([k, v]) => ({ label: k, value: v })))}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>ยอดขายแยกตามเมนู</h3>
        <div class="spacer"></div>
        <button class="btn btn-sm" id="expProd">⬇ ส่งออก CSV</button></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>#</th><th>เมนู</th><th>หมวดหมู่</th><th class="t-right">จำนวนที่ขาย</th>
          <th class="t-right">ยอดขาย</th><th class="t-right">ต้นทุน</th>
          <th class="t-right">กำไร</th><th class="t-right">อัตรากำไร</th></tr></thead>
        <tbody>${rows.length ? rows.map((r, i) => `
          <tr><td style="color:var(--muted)">${i + 1}</td>
            <td><b>${esc(r.name)}</b></td>
            <td><span class="badge b-gray">${esc(r.category)}</span></td>
            <td class="t-right mono" style="font-weight:600">${num(r.qty)}</td>
            <td class="t-right mono">${baht(r.revenue)}</td>
            <td class="t-right mono" style="color:var(--muted)">${baht(r.cost)}</td>
            <td class="t-right mono" style="color:var(--green-700);font-weight:600">${baht(r.profit)}</td>
            <td class="t-right mono">${r.revenue ? Math.round(r.profit / r.revenue * 100) : 0}%</td></tr>`).join('')
          : `<tr><td colspan="8">${emptyHTML('ไม่มีข้อมูลในช่วงเวลานี้', '☕')}</td></tr>`}</tbody>
      </table></div>
    </div>`;

  $('#expProd').onclick = () => csv('products', ['เมนู', 'หมวด', 'จำนวน', 'ยอดขาย', 'ต้นทุน', 'กำไร'],
    rows.map((r) => [r.name, r.category, r.qty, r.revenue, r.cost, r.profit]));
}

// ---------------------------------------------------------------
async function drawPL(box) {
  const r = await api.profitLoss(range);
  const margin = r.revenue ? Math.round(r.net_profit / r.revenue * 100) : 0;
  const line = (label, value, opt = {}) => `
    <div style="display:flex;justify-content:space-between;padding:10px 0;
                border-bottom:1px ${opt.strong ? 'solid var(--line)' : 'dashed var(--line-2)'};
                ${opt.strong ? 'font-weight:700;font-size:15px' : ''}">
      <span style="${opt.indent ? 'padding-left:18px;color:var(--muted)' : ''}">${label}</span>
      <span class="mono" style="color:${opt.color || 'inherit'}">${value}</span></div>`;

  box.innerHTML = `
    <div class="grid g-4" style="margin-bottom:16px">
      ${kpi('รายได้จากการขาย', baht(r.revenue))}
      ${kpi('กำไรขั้นต้น', baht(r.gross_profit), `หักต้นทุนวัตถุดิบ ${baht(r.cogs)}`)}
      ${kpi('ค่าใช้จ่ายรวม', baht(r.total_expense))}
      ${kpi('กำไรสุทธิ', baht(r.net_profit), `อัตรากำไรสุทธิ ${margin}%`)}
    </div>

    <div class="grid" style="grid-template-columns:1.3fr 1fr">
      <div class="card">
        <div class="card-head"><h3>งบกำไรขาดทุน</h3>
          <div class="sub">${fmtDate(r.from)} – ${fmtDate(r.to)}</div>
          <div class="spacer"></div>
          <button class="btn btn-sm no-print" onclick="window.print()">🖨️ พิมพ์</button></div>
        <div class="card-body">
          ${line('<b>รายได้จากการขาย</b>', baht(r.revenue), { strong: true })}
          ${line('หัก : ต้นทุนขาย (วัตถุดิบตามสูตร)', '-' + baht(r.cogs), { indent: true, color: 'var(--red)' })}
          ${line('<b>กำไรขั้นต้น</b>', baht(r.gross_profit), { strong: true, color: 'var(--green-700)' })}
          <div style="margin-top:14px;font-weight:600;font-size:13px;color:var(--muted)">ค่าใช้จ่ายในการดำเนินงาน</div>
          ${r.expenses.map((e) => line(esc(e.category), '-' + baht(e.amount), { indent: true, color: 'var(--red)' })).join('')
            || line('<span style="color:var(--muted-2)">ไม่มีรายการ</span>', '-', { indent: true })}
          ${line('<b>รวมค่าใช้จ่าย</b>', '-' + baht(r.total_expense), { strong: true, color: 'var(--red)' })}
          <div style="margin-top:16px;padding:14px 16px;background:${r.net_profit >= 0 ? 'var(--green-50)' : 'var(--red-bg)'};
                      border-radius:12px;display:flex;justify-content:space-between;align-items:center">
            <div><div style="font-size:12px;color:var(--muted)">กำไร (ขาดทุน) สุทธิ</div>
              <div style="font-size:12px;color:var(--muted)">อัตรากำไรสุทธิ ${margin}%</div></div>
            <div style="font-size:27px;font-weight:700;color:${r.net_profit >= 0 ? 'var(--green-800)' : 'var(--red)'}">
              ${baht(r.net_profit)}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>สัดส่วนค่าใช้จ่าย</h3></div>
        <div class="card-body">
          ${r.expenses.length
            ? donutChart(r.expenses.map((e) => ({ label: e.category, value: e.amount })))
            : emptyHTML('ยังไม่มีรายการค่าใช้จ่าย', '🧾')}
          <div style="margin-top:18px">
            ${r.expenses.map((e) => `
              <div class="rank-row"><div style="flex:1">${esc(e.category)}</div>
                <b class="mono">${baht(e.amount)}</b></div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------
async function drawStaff(box) {
  const rows = await api.staffReport(range);
  const ROLES = { owner: 'เจ้าของร้าน', manager: 'ผู้จัดการ', staff: 'พนักงาน' };
  box.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h3>ยอดขายรายพนักงาน</h3>
        <div class="sub">${fmtDate(range.date_from)} – ${fmtDate(range.date_to)}</div></div>
      <div class="card-body">${barChart(
        rows.filter((r) => r.revenue > 0).map((r) => ({
          label: r.full_name,
          short: r.full_name.split(' ')[0],
          value: r.revenue,
        })), { highlightLast: false })}</div>
    </div>

    <div class="card">
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>#</th><th>ชื่อพนักงาน</th><th>ตำแหน่ง</th>
          <th class="t-center">จำนวนบิล</th><th class="t-right">ยอดขาย</th>
          <th class="t-right">เฉลี่ย/บิล</th><th style="width:150px">สัดส่วน</th></tr></thead>
        <tbody>${rows.map((r, i) => {
          const max = Math.max(...rows.map((x) => x.revenue), 1);
          return `<tr><td style="color:var(--muted)">${i + 1}</td>
            <td><b>${esc(r.full_name)}</b></td>
            <td><span class="badge b-gray">${ROLES[r.role] || r.role}</span></td>
            <td class="t-center">${num(r.orders)}</td>
            <td class="t-right mono" style="font-weight:600">${baht(r.revenue)}</td>
            <td class="t-right mono">${baht(r.avg_ticket)}</td>
            <td><div class="progress"><i style="width:${Math.round(r.revenue / max * 100)}%"></i></div></td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
}

function csv(name, head, rows) {
  const data = '﻿' + [head, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}_${range.date_from}_${range.date_to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('ส่งออกไฟล์เรียบร้อย', 'ok');
}
