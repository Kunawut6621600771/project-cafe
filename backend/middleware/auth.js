/**
 * Middleware : ตรวจสอบสิทธิ์ด้วย JWT
 */
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'espresso-flow-dev-secret-change-me';
const EXPIRES = process.env.JWT_EXPIRES || '12h';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
    SECRET,
    { expiresIn: EXPIRES }
  );
}

/** ต้องล็อกอินก่อน */
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
}

/** จำกัดตามบทบาท เช่น requireRole('owner','manager') */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ใช้งานส่วนนี้' });
    }
    next();
  };
}

module.exports = { auth, requireRole, signToken, SECRET };
