/**
 * เทสต์หน้าเว็บ (ES modules ใน frontend/js) บน jsdom
 * หน้าเว็บคุยกับเซิร์ฟเวอร์เทสต์จริง ยกเว้น endpoint ที่ต้องการจำลองผลลัพธ์
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const { startServer } = require('./server.js');
const { closeDb } = require('../backend/database/db');

let srv, utils, settingsPage;
const overrides = new Map();   // path → () => Response (จำลองผลจาก API)
const realFetch = globalThis.fetch;

before(async () => {
  srv = await startServer();
  const dom = new JSDOM('<!doctype html><body><div id="brandBranch"></div><div id="root"></div></body>',
    { url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    KeyboardEvent: dom.window.KeyboardEvent, MouseEvent: dom.window.MouseEvent,
  });
  localStorage.setItem('ef_token', srv.token);
  localStorage.setItem('ef_user', JSON.stringify(srv.user));
  // fetch('/api/...') ของหน้าเว็บ → เซิร์ฟเวอร์เทสต์
  globalThis.fetch = (url, opt) => {
    const path = String(url);
    if (overrides.has(path)) return Promise.resolve(overrides.get(path)());
    return realFetch(srv.base + path, opt);
  };
  utils = await import('../frontend/js/utils.js');
  settingsPage = (await import('../frontend/js/pages/settings.js')).default;
});

after(async () => {
  globalThis.fetch = realFetch;
  srv.server.close();
  await closeDb();
});

beforeEach(() => overrides.clear());

const json = (body, status = 200) => () => new Response(JSON.stringify(body), { status });
const tick = () => new Promise((r) => setTimeout(r, 300));

// ---------------------------------------------------------------
describe('utils.js', () => {
  test('จัดรูปแบบวันที่/เวลา : ค่าว่าง / ไม่ใช่วันที่ / ปกติ', () => {
    for (const fn of [utils.fmtDateTime, utils.fmtDate, utils.fmtTime]) {
      assert.equal(fn(''), '-');
      assert.equal(fn('ไม่ใช่วันที่'), 'ไม่ใช่วันที่');
      assert.notEqual(fn('2026-08-26 14:30:00'), '2026-08-26 14:30:00');
    }
  });

  test('ago : ไม่ใช่วันที่ / เมื่อครู่ / นาที / ชั่วโมง', () => {
    assert.equal(utils.ago('xx'), '-');
    assert.equal(utils.ago(new Date().toISOString()), 'เมื่อครู่');
    assert.match(utils.ago(new Date(Date.now() - 5 * 60000).toISOString()), /นาที/);
    assert.match(utils.ago(new Date(Date.now() - 3 * 3600000).toISOString()), /ชม/);
  });

  test('toast : ไอคอนตามชนิด', () => {
    utils.toast('สำเร็จ', 'ok');
    utils.toast('ผิดพลาด', 'err');
    utils.toast('แจ้งให้ทราบ', 'info');
    const icons = [...document.querySelectorAll('#toasts .toast span:first-child')].map((s) => s.textContent);
    assert.deepEqual(icons, ['✅', '⚠️', 'ℹ️']);
  });

  test('modal : ปิดด้วยปุ่ม data-close / Escape แล้วเรียก onClose', () => {
    let closed = 0;
    const m1 = utils.modal({ title: 'A', body: 'x', onClose: () => closed++ });
    m1.el.querySelector('[data-close]').click();
    assert.equal(closed, 1);

    utils.modal({ title: 'B', body: 'y', footer: '<button>f</button>' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(document.querySelectorAll('.modal-bg').length, 0);
  });

  test('lineChart : เส้นพื้นที่ใต้กราฟ', () => {
    const svg = utils.lineChart([{ label: 'จ', value: 10 }, { label: 'อ', value: 20 }, { label: 'พ', value: 5 }]);
    assert.match(svg, /M [\d.]+,[\d.]+ L [\d.]+,[\d.]+ L [\d.]+,[\d.]+ L [\d.]+,[\d.]+ L/);
  });
});

// ---------------------------------------------------------------
describe('หน้าตั้งค่า', () => {
  const root = () => document.getElementById('root');
  const card = (i) => root().querySelectorAll('.slip-card')[i];

  async function renderShop(pay, line) {
    if (pay) overrides.set('/api/payments/config', json(pay));
    if (line) overrides.set('/api/line/status', json(line));
    await settingsPage.render(root());
    await tick();
  }

  test('ข้อมูลร้าน : ช่องกรอก คำแนะนำ และสถานะยังไม่เชื่อมต่อ', async () => {
    await renderShop(null, null);
    assert.ok(root().querySelector('#shop_name'));
    assert.ok(root().querySelectorAll('.field .hint').length >= 3);
    assert.ok(card(0).classList.contains('warn'));
    assert.match(card(0).textContent, /ยังไม่ได้เชื่อมต่อ API ตรวจสลิป/);
    assert.ok(card(1).classList.contains('warn'));
    assert.match(card(1).textContent, /ยังไม่ได้เชื่อมต่อ LINE/);
  });

  test('ตรวจสลิป EasySlip / SlipOK และ LINE เชื่อมต่อแล้ว', async () => {
    await renderShop({ slip_provider: 'easyslip' }, { configured: true, ok: true, name: 'บอท', basic_id: '@x', webhook: 'w' });
    assert.match(card(0).textContent, /EasySlip/);
    assert.ok(card(1).classList.contains('ok'));
    assert.match(card(1).textContent, /เชื่อมต่อบอท บอท/);

    await renderShop({ slip_provider: 'slipok' }, { configured: true, ok: false, error: 'token ผิด', webhook: 'w' });
    assert.match(card(0).textContent, /SlipOK/);
    assert.ok(card(1).classList.contains('err'));
    assert.match(card(1).textContent, /token ผิด/);
  });

  test('บันทึกการตั้งค่า : สำเร็จ / ผิดพลาด', async () => {
    await renderShop(null, null);
    root().querySelector('#shop_branch').value = 'สาขาเทสต์';
    root().querySelector('#saveShop').click();
    await tick();
    assert.equal(document.getElementById('brandBranch').textContent, 'สาขาเทสต์');

    overrides.set('/api/settings', json({ error: 'บันทึกไม่ได้' }, 500));
    root().querySelector('#saveShop').click();
    await tick();
    assert.match(document.querySelector('#toasts').textContent, /บันทึกไม่ได้/);
  });

  test('พนักงาน : ป้ายตำแหน่ง และฟอร์มแก้ไขมีช่องสถานะ', async () => {
    root().querySelector('[data-tab="users"]').click();
    await tick();
    const badges = [...root().querySelectorAll('tbody .badge')].map((b) => b.className);
    assert.ok(badges.some((c) => c.includes('b-purple')));
    assert.ok(badges.some((c) => c.includes('b-blue')));
    assert.ok(badges.some((c) => c.includes('b-gray')));

    root().querySelector('[data-edit]').click();
    assert.equal(document.querySelector('#uStatus').value, 'active');
    document.querySelector('.modal [data-close]').click();

    root().querySelector('#addUser').click();
    assert.equal(document.querySelector('#uStatus'), null);
    document.querySelector('.modal [data-close]').click();
  });
});
