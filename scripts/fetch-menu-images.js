/**
 * ดาวน์โหลดรูปเมนูจริงจาก API ภายนอก มาเก็บที่ frontend/assets/menu/<sku>.jpg
 * แล้วเขียนแหล่งที่มา/สัญญาอนุญาตไว้ที่ frontend/assets/menu/CREDITS.md
 *
 *   node scripts/fetch-menu-images.js            → โหลดเฉพาะรูปที่ยังไม่มี
 *   node scripts/fetch-menu-images.js --force    → โหลดใหม่ทั้งหมด
 *   node scripts/fetch-menu-images.js IC01 FR03  → โหลดใหม่เฉพาะ sku ที่ระบุ
 *
 * แหล่งรูป : Unsplash (Unsplash License), TheMealDB, Openverse (Creative Commons)
 */
const fs = require('node:fs');
const path = require('node:path');
const { products } = require('../backend/database/menu-data');

const OUT = path.join(__dirname, '..', 'frontend', 'assets', 'menu');
const CACHE = path.join(OUT, 'sources.json');   // ผลค้นหา + เครดิต (commit ไว้เพื่อให้โหลดซ้ำได้ผลเดิม)
const UA = 'EspressoFlow/1.0 (cafe POS demo)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.status === 429) { await sleep(5000 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }
  throw new Error(`429 ${url}`);
}

async function download(url, file) {
  let r;
  for (let i = 0; i < 4; i++) {
    r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.status !== 429) break;
    await sleep(5000 * (i + 1));
  }
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 3000) throw new Error(`ไฟล์เล็กผิดปกติ (${buf.length} bytes) ${url}`);
  fs.writeFileSync(file, buf);
  return buf.length;
}

/** แปลง spec ของสินค้า → { url, credit } */
async function resolve(spec, cache) {
  const [kind, rest] = [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)];

  if (kind === 'unsplash') {
    return {
      url: `https://images.unsplash.com/photo-${rest}?w=640&h=640&fit=crop&crop=entropy&q=72&fm=jpg`,
      credit: { source: 'Unsplash', license: 'Unsplash License', link: `https://unsplash.com/photos/${rest}` },
    };
  }

  if (kind === 'mealdb') {
    const d = await getJson(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(rest)}`);
    const m = (d.meals || []).find((x) => x.strMeal.toLowerCase() === rest.toLowerCase()) || (d.meals || [])[0];
    if (!m) throw new Error(`TheMealDB ไม่พบ "${rest}"`);
    return {
      url: m.strMealThumb,
      credit: { source: 'TheMealDB', title: m.strMeal, license: 'TheMealDB (free API)', link: `https://www.themealdb.com/meal/${m.idMeal}` },
    };
  }

  if (kind === 'ov') {
    const [q, idx = '0'] = rest.split('#');
    if (!cache.openverse[q]) {
      const d = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}`
        + '&license_type=commercial&extension=jpg&page_size=20');
      // เลือกรูปสัดส่วนใกล้จัตุรัส ความละเอียดพอใช้
      cache.openverse[q] = d.results
        .filter((r) => r.width >= 500 && r.height >= 400 && r.width / r.height < 1.7 && r.width / r.height > 0.6)
        .map((r) => ({
          id: r.id, url: r.url, thumb: r.thumbnail, title: r.title, creator: r.creator,
          license: `CC ${r.license.toUpperCase()} ${r.license_version || ''}`.trim(),
          link: r.foreign_landing_url,
        }));
      await sleep(1200);
    }
    const pick = cache.openverse[q][Number(idx)];
    if (!pick) throw new Error(`Openverse ไม่พบรูปที่เหมาะสมสำหรับ "${q}"`);
    // ขอรูปขนาด ~640px แทนต้นฉบับ : Flickr ใช้ _z, Wikimedia ใช้ /thumb/.../500px- (ขนาดที่ Wikimedia อนุญาต)
    let url = pick.url;
    if (/staticflickr\.com/.test(url)) url = url.replace(/(_[a-z])?\.jpg$/, '_z.jpg');
    const wm = url.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/(\w\/\w\w)\/([^/]+)$/);
    if (wm) url = `${wm[1]}/thumb/${wm[2]}/${wm[3]}/500px-${wm[3]}`;
    return {
      url,
      credit: { source: 'Openverse', title: pick.title, creator: pick.creator, license: pick.license, link: pick.link },
    };
  }

  throw new Error(`ไม่รู้จักแหล่งรูป: ${spec}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  cache.openverse ||= {};
  cache.credits ||= {};

  let ok = 0, skip = 0, fail = 0;
  for (const p of products) {
    const file = path.join(OUT, `${p.sku}.jpg`);
    const want = only.length ? only.includes(p.sku) : (force || !fs.existsSync(file));
    if (!want) { skip++; continue; }
    try {
      const { url, credit } = await resolve(p.img, cache);
      let size;
      try {
        size = await download(url, file);
      } catch (e) {
        // Flickr บางรูปไม่มีขนาด _z → ใช้ต้นฉบับ
        if (!url.endsWith('_z.jpg')) throw e;
        size = await download(url.slice(0, -'_z.jpg'.length) + '.jpg', file);
      }
      cache.credits[p.sku] = { name: p.name, spec: p.img, ...credit };
      console.log(`✓ ${p.sku} ${p.name}  (${Math.round(size / 1024)} KB)`);
      ok++;
    } catch (e) {
      console.log(`✗ ${p.sku} ${p.name}  → ${e.message}`);
      fail++;
    }
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  }

  // ---- เขียนเครดิต ----
  const lines = products.filter((p) => cache.credits[p.sku]).map((p) => {
    const c = cache.credits[p.sku];
    const who = [c.title && `"${c.title}"`, c.creator && `โดย ${c.creator}`].filter(Boolean).join(' ');
    return `| ${p.sku} | ${p.name} | ${who || '-'} | ${c.source} | ${c.license} | [ลิงก์](${c.link}) |`;
  });
  fs.writeFileSync(path.join(OUT, 'CREDITS.md'), [
    '# ที่มาของรูปเมนู',
    '',
    'รูปทั้งหมดดาวน์โหลดด้วย `node scripts/fetch-menu-images.js` จาก Unsplash, TheMealDB และ Openverse',
    'รูปจาก Openverse อยู่ภายใต้สัญญาอนุญาต Creative Commons ตามที่ระบุ — หากนำไปใช้เชิงพาณิชย์ต้องให้เครดิตเจ้าของผลงาน',
    '',
    '| SKU | เมนู | ผลงาน | แหล่ง | สัญญาอนุญาต | ต้นฉบับ |',
    '|-----|------|-------|-------|-------------|---------|',
    ...lines,
    '',
  ].join('\n'));

  console.log(`\nเสร็จ : โหลด ${ok} · ข้าม ${skip} · ล้มเหลว ${fail}`);
  if (fail) process.exitCode = 1;
})();
