const express = require('express');
const { verifyPassword } = require('../lib/auth-util');

// จำกัดการเดารหัส: นับแยกตาม IP และอีเมลที่พยายามเข้า
const fails = new Map();
const MAX_FAILS = 8;
const WINDOW_MS = 15 * 60 * 1000;

function clientIp(req) {
  return req.headers['cf-connecting-ip']
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.ip || 'unknown';
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of fails) if (v.resetAt <= now) fails.delete(k);
}, 60 * 1000).unref();

function blocked(key) {
  const rec = fails.get(key);
  if (rec && rec.count >= MAX_FAILS && rec.resetAt > Date.now()) {
    return Math.ceil((rec.resetAt - Date.now()) / 60000);
  }
  return 0;
}
function addFail(key) {
  const now = Date.now();
  const rec = fails.get(key);
  if (!rec || rec.resetAt <= now) fails.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else rec.count += 1;
}

module.exports = (passport, pool) => {
  const router = express.Router();

  // ---------- เข้าสู่ระบบด้วยอีเมล + รหัสผ่าน ----------
  router.post('/login', async (req, res, next) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const password = String((req.body && req.body.password) || '');
    const ipKey = 'ip:' + clientIp(req);
    const emailKey = 'em:' + email;

    const wait = blocked(ipKey) || blocked(emailKey);
    if (wait) return res.status(429).json({ error: `พยายามเข้าระบบผิดหลายครั้ง กรุณารอ ${wait} นาที` });

    if (!email || !password) return res.status(400).json({ error: 'กรุณากรอกอีเมลและรหัสผ่าน' });

    try {
      const r = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
      const user = r.rows[0];

      if (!user || !verifyPassword(password, user.password_hash)) {
        addFail(ipKey); addFail(emailKey);
        return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
      }
      if (user.is_active === false) {
        return res.status(403).json({ error: 'บัญชีนี้ถูกระงับการใช้งาน' });
      }

      req.login(user, err => {
        if (err) return next(err);
        fails.delete(ipKey); fails.delete(emailKey);
        res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
      });
    } catch (e) { next(e); }
  });

  router.post('/logout', (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ ok: true });
      });
    });
  });

  router.get('/me', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
    const { id, email, name, picture, role } = req.user;
    res.json({ id, email, name, picture, role });
  });

  return router;
};
