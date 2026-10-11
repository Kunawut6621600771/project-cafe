/**
 * แปลง path ใน coverage/lcov.info เป็น path สัมพัทธ์กับโปรเจกต์ (ใช้ / เสมอ)
 * เพื่อให้ SonarScanner จับคู่ไฟล์ได้ ไม่ว่าจะสแกนจากเครื่องไหนหรือใน Docker
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'coverage', 'lcov.info');

const out = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => {
  if (!line.startsWith('SF:')) return line;
  return 'SF:' + path.relative(root, line.slice(3)).split(path.sep).join('/');
});
fs.writeFileSync(file, out.join('\n'));
console.log('✓ coverage/lcov.info ใช้ path สัมพัทธ์แล้ว');
