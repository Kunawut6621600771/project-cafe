/**
 * /api/auth : เข้าสู่ระบบ / ข้อมูลผู้ใช้ปัจจุบัน / เปลี่ยนรหัสผ่าน
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database/db');
const { auth, signToken } = require('../middleware/auth');
const { wrap } = require('../utils/helpers');

// POST /api/auth/login
router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  }
  const user = await db.get('SELECT * FROM users WHERE username = ?', String(username).trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'บัญชีนี้ถูกระงับการใช้งาน' });
  }
  res.json({
    token: signToken(user),
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
  });
}));

// GET /api/auth/me
router.get('/me', auth, wrap(async (req, res) => {
  const user = await db.get(
    'SELECT id,username,full_name,role,phone,status,created_at FROM users WHERE id = ?', req.user.id
  );
  if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  res.json(user);
}));

// POST /api/auth/change-password
router.post('/change-password', auth, wrap(async (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
  }
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!user || !bcrypt.compareSync(old_password || '', user.password_hash)) {
    return res.status(400).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
  }
  await db.run(
    'UPDATE users SET password_hash=?, updated_at=LOCALTIMESTAMP(0) WHERE id=?',
    bcrypt.hashSync(new_password, 10), req.user.id
  );
  res.json({ message: 'เปลี่ยนรหัสผ่านเรียบร้อย' });
}));

module.exports = router;
