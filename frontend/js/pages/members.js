/** หน้าสมาชิก */
import { api, auth } from '../api.js';
import {
  $, $$, esc, baht, num, toast, modal, confirmBox, emptyHTML,
  TIER, fmtDate, fmtDateTime,
} from '../utils.js';

const filter = { q: '', tier: '', page: 1 };

export default {
  async render(root) {
    root.innerHTML = '<div id="mBody"><div class="loading"><div class="spinner"></div>กำลังโหลด...</div></div>';
    await draw();
  },
};

async function draw() {
  const box = $('#mBody');
  const [s, r] = await Promise.all([api.memberSummary(), api.members(filter)]);

  box.innerHTML = `
    <div class="grid g-4" style="margin-bottom:16px">
      ${card('👥', '#eff6ff', '#2563eb', 'สมาชิกทั้งหมด', `${num(s.total)} <small>คน</small>`, `เพิ่มใหม่เดือนนี้ ${s.new_this_month} คน`)}
      ${card('💎', '#f5f3ff', '#7c3aed', 'ระดับ Platinum', `${num(s.platinum)} <small>คน</small>`, `Gold ${s.gold} · Silver ${s.silver}`)}
      ${card('⭐', '#fffbeb', '#b45309', 'แต้มสะสมรวม', `${num(s.total_points)} <small>แต้ม</small>`, 'มูลค่า ' + baht(s.total_points))}
      ${card('💰', '#f0fdf4', '#15803d', 'ยอดซื้อเฉลี่ย/คน', baht(s.avg_spent))}
    </div>

    <div class="card">
      <div class="card-head">
        <div class="search" style="width:290px">
          <input class="input" id="mQ" placeholder="ค้นหาชื่อ / เบอร์โทร / รหัสสมาชิก" value="${esc(filter.q)}">
        </div>
        <select class="select" id="mTier" style="width:150px">
          <option value="">ทุกระดับ</option>
          <option value="platinum">Platinum</option>
          <option value="gold">Gold</option>
          <option value="silver">Silver</option>
        </select>
        <div class="spacer"></div>
        <span class="badge b-gray">${num(r.total)} คน</span>
        <button class="btn btn-sm btn-primary" id="addMember">+ สมัครสมาชิก</button>
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>รหัส</th><th>ชื่อ-นามสกุล</th><th>เบอร์โทร</th><th>ระดับ</th>
            <th class="t-right">แต้มสะสม</th><th class="t-right">ยอดซื้อสะสม</th>
            <th class="t-center">จำนวนครั้ง</th><th>มาล่าสุด</th><th class="t-center"></th>
          </tr></thead>
          <tbody>${r.data.length ? r.data.map((m) => `
            <tr>
              <td class="mono" style="color:var(--muted);font-size:12.5px">${esc(m.code)}</td>
              <td><b>${esc(m.name)}</b></td>
              <td class="mono">${esc(m.phone || '-')}</td>
              <td><span class="badge ${TIER[m.tier].cls}">${TIER[m.tier].label}</span></td>
              <td class="t-right mono" style="font-weight:600">${num(m.points)}</td>
              <td class="t-right mono">${baht(m.total_spent)}</td>
              <td class="t-center">${num(m.visits)}</td>
              <td style="font-size:12.5px;color:var(--muted)">${fmtDate(m.last_visit)}</td>
              <td class="t-center"><button class="btn btn-sm" data-view="${m.id}">ดูโปรไฟล์</button></td>
            </tr>`).join('') : `<tr><td colspan="9">${emptyHTML('ไม่พบสมาชิก', '👥')}</td></tr>`}
          </tbody>
        </table>
      </div>
      ${r.pages > 1 ? `<div class="pager">
        ${Array.from({ length: r.pages }, (_, i) => i + 1).map((i) =>
          `<button data-page="${i}" class="${i === r.page ? 'active' : ''}">${i}</button>`).join('')}
      </div>` : ''}
    </div>`;

  $('#mTier').value = filter.tier;
  $('#mQ').oninput = (e) => {
    filter.q = e.target.value.trim(); filter.page = 1;
    clearTimeout(window._mt); window._mt = setTimeout(draw, 300);
  };
  $('#mTier').onchange = (e) => { filter.tier = e.target.value; filter.page = 1; draw(); };
  $('#addMember').onclick = () => memberForm(null);
  $$('[data-view]', box).forEach((b) => b.onclick = () => profile(b.dataset.view));
  $$('[data-page]', box).forEach((b) => b.onclick = () => { filter.page = Number(b.dataset.page); draw(); });
}

const card = (ico, bg, fg, label, value, sub) => `
  <div class="card kpi"><div class="top">
    <div class="ico" style="background:${bg};color:${fg}">${ico}</div>
    <div><div class="label">${label}</div><div class="value">${value}</div>
      ${sub ? `<div class="delta"><span style="color:var(--muted)">${sub}</span></div>` : ''}</div>
  </div></div>`;

// ---------------------------------------------------------------
async function profile(id) {
  const m = await api.member(id);
  const dlg = modal({
    title: `โปรไฟล์สมาชิก : ${m.name}`,
    wide: true,
    body: `
      <div class="grid g-3" style="margin-bottom:18px">
        <div class="card kpi" style="box-shadow:none">
          <div class="label">แต้มสะสม</div><div class="value">${num(m.points)}</div>
          <div class="delta"><span style="color:var(--muted)">1 แต้ม = ฿1</span></div></div>
        <div class="card kpi" style="box-shadow:none">
          <div class="label">ยอดซื้อสะสม</div><div class="value">${baht(m.total_spent)}</div>
          <div class="delta"><span style="color:var(--muted)">${num(m.visits)} ครั้ง</span></div></div>
        <div class="card kpi" style="box-shadow:none">
          <div class="label">ระดับสมาชิก</div>
          <div class="value" style="font-size:20px;margin-top:6px"><span class="badge ${TIER[m.tier].cls}"
            style="font-size:14px;padding:5px 14px">${TIER[m.tier].label}</span></div>
          <div class="delta"><span style="color:var(--muted)">สมัครเมื่อ ${fmtDate(m.created_at)}</span></div></div>
      </div>

      <div class="grid g-2" style="gap:18px">
        <div>
          <h4 style="font-size:13.5px;margin-bottom:9px">ข้อมูลติดต่อ</h4>
          <table class="tbl" style="border:1px solid var(--line);border-radius:10px;overflow:hidden">
            <tbody>
              <tr><td style="color:var(--muted);width:110px">รหัสสมาชิก</td><td class="mono">${esc(m.code)}</td></tr>
              <tr><td style="color:var(--muted)">เบอร์โทร</td><td class="mono">${esc(m.phone || '-')}</td></tr>
              <tr><td style="color:var(--muted)">อีเมล</td><td>${esc(m.email || '-')}</td></tr>
              <tr><td style="color:var(--muted)">มาล่าสุด</td><td>${fmtDate(m.last_visit)}</td></tr>
            </tbody>
          </table>

          <h4 style="font-size:13.5px;margin:16px 0 9px">เมนูโปรด</h4>
          ${m.favorite.length ? m.favorite.map((f, i) => `
            <div class="rank-row"><div class="rank-no">${i + 1}</div>
              <div style="flex:1">${esc(f.product_name)}</div>
              <b>${num(f.qty)} แก้ว</b></div>`).join('') : emptyHTML('ยังไม่มีข้อมูล')}
        </div>

        <div>
          <h4 style="font-size:13.5px;margin-bottom:9px">ประวัติการซื้อล่าสุด</h4>
          <div style="max-height:200px;overflow-y:auto;border:1px solid var(--line);border-radius:10px">
            <table class="tbl"><tbody>
              ${m.orders.length ? m.orders.map((o) => `
                <tr><td class="mono" style="font-size:12.5px">${esc(o.order_no)}</td>
                  <td style="font-size:12px;color:var(--muted)">${fmtDateTime(o.created_at)}</td>
                  <td class="t-right mono"><b>${baht(o.total)}</b></td></tr>`).join('')
                : `<tr><td>${emptyHTML('ยังไม่เคยซื้อ')}</td></tr>`}
            </tbody></table>
          </div>

          <h4 style="font-size:13.5px;margin:16px 0 9px">ประวัติแต้ม</h4>
          <div style="max-height:170px;overflow-y:auto;border:1px solid var(--line);border-radius:10px">
            <table class="tbl"><tbody>
              ${m.point_history.length ? m.point_history.map((p) => `
                <tr><td style="font-size:12px">${esc(p.reason || '-')}
                    <div style="color:var(--muted);font-size:11px">${fmtDateTime(p.created_at)}</div></td>
                  <td class="t-right mono" style="font-weight:600;color:${p.points >= 0 ? 'var(--green-700)' : 'var(--red)'}">
                    ${p.points >= 0 ? '+' : ''}${p.points}</td></tr>`).join('')
                : `<tr><td>${emptyHTML('ยังไม่มีประวัติแต้ม')}</td></tr>`}
            </tbody></table>
          </div>
        </div>
      </div>`,
    footer: `
      ${auth.can('owner', 'manager') ? '<button class="btn" id="adjPoints">⭐ ปรับแต้ม</button>' : ''}
      <div style="flex:1"></div>
      <button class="btn" data-close>ปิด</button>
      <button class="btn btn-primary" id="editM">แก้ไขข้อมูล</button>`,
  });

  $('#editM', dlg.el).onclick = () => { dlg.close(); memberForm(m); };
  const ap = $('#adjPoints', dlg.el);
  if (ap) ap.onclick = () => { dlg.close(); pointsForm(m); };
}

function memberForm(m) {
  const isNew = !m;
  const dlg = modal({
    title: isNew ? 'สมัครสมาชิกใหม่' : `แก้ไขข้อมูล : ${m.name}`,
    body: `
      <div class="field"><label>ชื่อ-นามสกุล *</label><input class="input" id="fName" value="${esc(m?.name || '')}" autofocus></div>
      <div class="grid g-2" style="gap:12px">
        <div class="field"><label>เบอร์โทรศัพท์ *</label><input class="input" id="fPhone" value="${esc(m?.phone || '')}"></div>
        <div class="field"><label>วันเกิด</label><input class="input" type="date" id="fBirth" value="${esc(m?.birthdate || '')}"></div>
      </div>
      <div class="field"><label>อีเมล</label><input class="input" type="email" id="fEmail" value="${esc(m?.email || '')}"></div>
      <div class="field"><label>หมายเหตุ</label><textarea class="input" id="fNote" rows="2">${esc(m?.note || '')}</textarea></div>`,
    footer: `${!isNew && auth.can('owner', 'manager')
      ? '<button class="btn btn-danger" id="delM">ยกเลิกสมาชิก</button><div style="flex:1"></div>' : ''}
      <button class="btn" data-close>ยกเลิก</button>
      <button class="btn btn-primary" id="saveM">บันทึก</button>`,
  });

  $('#saveM', dlg.el).onclick = async () => {
    const body = {
      name: $('#fName', dlg.el).value.trim(),
      phone: $('#fPhone', dlg.el).value.trim(),
      email: $('#fEmail', dlg.el).value.trim() || null,
      birthdate: $('#fBirth', dlg.el).value || null,
      note: $('#fNote', dlg.el).value.trim() || null,
    };
    if (!body.name || !body.phone) return toast('กรุณากรอกชื่อและเบอร์โทรศัพท์', 'err');
    try {
      if (isNew) await api.post('/members', body);
      else await api.put(`/members/${m.id}`, body);
      dlg.close(); toast('บันทึกข้อมูลสมาชิกเรียบร้อย', 'ok'); draw();
    } catch (e) { toast(e.message, 'err'); }
  };

  const del = $('#delM', dlg.el);
  if (del) del.onclick = async () => {
    if (!await confirmBox(`ยกเลิกสมาชิก "${m.name}" ?`, { danger: true, okText: 'ยกเลิกสมาชิก' })) return;
    try { await api.del(`/members/${m.id}`); dlg.close(); toast('ยกเลิกสมาชิกเรียบร้อย', 'ok'); draw(); }
    catch (e) { toast(e.message, 'err'); }
  };
}

function pointsForm(m) {
  const dlg = modal({
    title: `ปรับแต้ม : ${m.name}`,
    body: `
      <div style="background:var(--green-50);padding:12px 14px;border-radius:10px;margin-bottom:16px">
        <div style="font-size:12px;color:var(--muted)">แต้มคงเหลือ</div>
        <div style="font-size:24px;font-weight:700">${num(m.points)} แต้ม</div>
      </div>
      <div class="field"><label>จำนวนแต้ม (ใส่ค่าติดลบเพื่อหักแต้ม)</label>
        <input class="input" id="pVal" type="number" placeholder="เช่น 50 หรือ -20" autofocus></div>
      <div class="field"><label>เหตุผล</label>
        <input class="input" id="pReason" placeholder="เช่น แต้มโบนัสวันเกิด"></div>`,
    footer: `<button class="btn" data-close>ยกเลิก</button>
             <button class="btn btn-primary" id="savePts">บันทึก</button>`,
  });
  $('#savePts', dlg.el).onclick = async () => {
    try {
      await api.post(`/members/${m.id}/points`, {
        points: Number($('#pVal', dlg.el).value),
        reason: $('#pReason', dlg.el).value.trim() || null,
      });
      dlg.close(); toast('ปรับแต้มเรียบร้อย', 'ok'); draw();
    } catch (e) { toast(e.message, 'err'); }
  };
}
