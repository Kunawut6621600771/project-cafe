/** หน้าแดชบอร์ด — ภาพรวมร้าน */
import { api } from '../api.js';
import {
  $, esc, baht, num, barChart, lineChart, donutChart, fmtTime, ago,
  statusBadge, ORDER_TYPE, PAYMENT, PAYMENT_ICON, emptyHTML,
} from '../utils.js';

const DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export default {
  async render(root) {
    const d = await api.dashboard();
    const t = d.today;

    const kpi = (ico, bg, label, value, delta) => `
      <div class="card kpi">
        <div class="top">
          <div class="ico" style="background:${bg.b};color:${bg.c}">${ico}</div>
          <div style="min-width:0">
            <div class="label">${label}</div>
            <div class="value">${value}</div>
            ${delta || ''}
          </div>
        </div>
      </div>`;

    const arrow = (v) => v >= 0
      ? `<div class="delta up">▲ ${Math.abs(v)}% <span style="color:var(--muted)">เทียบเมื่อวาน</span></div>`
      : `<div class="delta down">▼ ${Math.abs(v)}% <span style="color:var(--muted)">เทียบเมื่อวาน</span></div>`;

    const daily = d.daily.map((r) => {
      const dt = new Date(r.day);
      return { label: r.day, short: DAYS[dt.getDay()], value: r.revenue };
    });

    const hourly = d.hourly.map((h) => ({ label: `${h.hour}:00 น.`, short: h.hour, value: h.revenue }));

    root.innerHTML = `
      <div class="grid g-4" style="margin-bottom:16px">
        ${kpi('💰', { b: '#dcfce7', c: '#15803d' }, 'ยอดขายวันนี้', baht(t.revenue), arrow(t.revenue_change))}
        ${kpi('🧾', { b: '#eff6ff', c: '#2563eb' }, 'จำนวนออเดอร์', num(t.orders) + ' <small>บิล</small>', arrow(t.orders_change))}
        ${kpi('📈', { b: '#fffbeb', c: '#b45309' }, 'ยอดเฉลี่ยต่อบิล', baht(t.avg_ticket),
          `<div class="delta"><span style="color:var(--muted)">สมาชิก ${t.member_orders} บิล จาก ${t.orders} บิล</span></div>`)}
        ${kpi('✨', { b: '#f5f3ff', c: '#7c3aed' }, 'กำไรขั้นต้นวันนี้', baht(t.profit),
          `<div class="delta"><span style="color:var(--muted)">ต้นทุนขาย ${baht(t.cost)}</span></div>`)}
      </div>

      <div class="grid" style="grid-template-columns:1.55fr 1fr;margin-bottom:16px">
        <div class="card">
          <div class="card-head">
            <div><h3>ยอดขาย 7 วันล่าสุด</h3><div class="sub">รวม ${baht(d.daily.reduce((s, r) => s + r.revenue, 0))}</div></div>
            <div class="spacer"></div>
            <div class="row" style="gap:4px">
              <button class="btn btn-sm active" id="tabDaily">รายวัน</button>
              <button class="btn btn-sm" id="tabHourly">รายชั่วโมงวันนี้</button>
            </div>
          </div>
          <div class="card-body" id="chartBox">${barChart(daily)}</div>
        </div>

        <div class="card">
          <div class="card-head"><h3>สัดส่วนยอดขายตามหมวด</h3><div class="sub">&nbsp;30 วันล่าสุด</div></div>
          <div class="card-body">
            ${donutChart(d.by_category.map((c) => ({ label: c.category, value: c.revenue })))}
          </div>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
        <div class="card">
          <div class="card-head"><h3>เมนูขายดี</h3><div class="sub">&nbsp;30 วันล่าสุด</div></div>
          <div class="card-body" style="padding-top:6px">
            ${d.top_products.length ? d.top_products.slice(0, 6).map((p, i) => `
              <div class="rank-row">
                <div class="rank-no">${i + 1}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600">${esc(p.name)}</div>
                  <div class="progress" style="margin-top:5px">
                    <i style="width:${Math.round(p.qty / d.top_products[0].qty * 100)}%"></i>
                  </div>
                </div>
                <div style="text-align:right">
                  <div style="font-weight:700;font-size:13px">${num(p.qty)}</div>
                  <div style="font-size:11px;color:var(--muted)">${baht(p.revenue)}</div>
                </div>
              </div>`).join('') : emptyHTML('ยังไม่มียอดขาย')}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>ช่องทางชำระเงินวันนี้</h3></div>
          <div class="card-body" style="padding-top:8px">
            ${d.payments.length ? d.payments.map((p) => {
              const totalPay = d.payments.reduce((s, x) => s + x.amount, 0) || 1;
              return `<div class="rank-row">
                <div class="rank-no" style="background:var(--line-2)">${PAYMENT_ICON[p.method] || '💵'}</div>
                <div style="flex:1">
                  <div style="font-size:13px;font-weight:600">${PAYMENT[p.method] || p.method}</div>
                  <div class="progress" style="margin-top:5px"><i style="width:${Math.round(p.amount / totalPay * 100)}%"></i></div>
                </div>
                <div style="text-align:right">
                  <div style="font-weight:700;font-size:13px">${baht(p.amount)}</div>
                  <div style="font-size:11px;color:var(--muted)">${p.orders} บิล</div>
                </div>
              </div>`;
            }).join('') : emptyHTML('ยังไม่มีการขายวันนี้', '💤')}
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>วัตถุดิบใกล้หมด</h3><div class="spacer"></div>
            <a href="#/stock" class="btn btn-sm">ดูคลัง</a>
          </div>
          <div class="card-body" style="padding-top:8px">
            ${d.low_stock.length ? d.low_stock.map((s) => {
              const p = Math.min(100, Math.round((s.stock_qty / (s.min_qty || 1)) * 100));
              const cls = s.stock_qty <= 0 ? 'danger' : 'warn';
              return `<div class="rank-row">
                <div style="flex:1">
                  <div style="font-size:13px;font-weight:600">${esc(s.name)}</div>
                  <div class="progress ${cls}" style="margin-top:5px"><i style="width:${p}%"></i></div>
                </div>
                <div style="text-align:right">
                  <div style="font-weight:700;font-size:13px;color:${s.stock_qty <= 0 ? 'var(--red)' : 'var(--amber)'}">
                    ${num(s.stock_qty, 1)} ${esc(s.unit)}</div>
                  <div style="font-size:11px;color:var(--muted)">ขั้นต่ำ ${num(s.min_qty)}</div>
                </div>
              </div>`;
            }).join('') : emptyHTML('สต็อกเพียงพอทุกรายการ', '✅')}
          </div>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:1fr">
        <div class="card">
          <div class="card-head">
            <div><h3>ออเดอร์ล่าสุด</h3><div class="sub">${d.queue_count} รายการกำลังรอในคิว</div></div>
            <div class="spacer"></div>
            <a href="#/orders" class="btn btn-sm">ดูทั้งหมด</a>
            <a href="#/pos" class="btn btn-sm btn-primary">+ เปิดออเดอร์ใหม่</a>
          </div>
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr>
                <th>เลขที่</th><th>รายการ</th><th>ลูกค้า</th><th>ประเภท</th>
                <th>ชำระเงิน</th><th class="t-right">ยอดรวม</th><th>สถานะ</th><th>เวลา</th>
              </tr></thead>
              <tbody>${d.recent_orders.map((o) => `
                <tr>
                  <td class="mono" style="font-weight:600">${esc(o.order_no)}</td>
                  <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)">
                    ${esc(o.items_summary || '-')}</td>
                  <td>${o.member_name ? esc(o.member_name) : '<span style="color:var(--muted-2)">ลูกค้าทั่วไป</span>'}</td>
                  <td>${ORDER_TYPE[o.order_type] || o.order_type}</td>
                  <td>${PAYMENT_ICON[o.payment_method] || ''} ${PAYMENT[o.payment_method] || '-'}</td>
                  <td class="t-right mono" style="font-weight:600">${baht(o.total)}</td>
                  <td>${statusBadge(o.status)}</td>
                  <td style="color:var(--muted);font-size:12.5px">${fmtTime(o.created_at)}<br>
                    <small style="color:var(--muted-2)">${ago(o.created_at)}</small></td>
                </tr>`).join('') || '<tr><td colspan="8">' + emptyHTML('ยังไม่มีออเดอร์') + '</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;

    // สลับกราฟรายวัน / รายชั่วโมง
    const box = $('#chartBox', root);
    $('#tabDaily', root).addEventListener('click', (e) => {
      box.innerHTML = barChart(daily);
      e.target.classList.add('btn-primary'); $('#tabHourly', root).classList.remove('btn-primary');
    });
    $('#tabHourly', root).addEventListener('click', (e) => {
      box.innerHTML = hourly.length ? lineChart(hourly) : emptyHTML('วันนี้ยังไม่มีการขาย', '💤');
      e.target.classList.add('btn-primary'); $('#tabDaily', root).classList.remove('btn-primary');
    });
    $('#tabDaily', root).classList.add('btn-primary');
  },
};
