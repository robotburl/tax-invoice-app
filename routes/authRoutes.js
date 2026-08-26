const express = require('express');

// จำกัดการเดา PIN ต่อ IP (อยู่หลัง Cloudflare จึงอ่าน CF-Connecting-IP)
const loginFails = new Map();
const MAX_FAILS = 8;
const WINDOW_MS = 15 * 60 * 1000;

function clientIp(req) {
  return req.headers['cf-connecting-ip']
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.ip || 'unknown';
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of loginFails) if (rec.resetAt <= now) loginFails.delete(ip);
}, 60 * 1000).unref();

module.exports = (passport, pool) => {
  const router = express.Router();
  const googleEnabled = !!process.env.GOOGLE_CLIENT_ID;

  // ---------- เข้าสู่ระบบด้วย PIN 4 หลัก ----------
  router.post('/pin', async (req, res, next) => {
    const ip = clientIp(req);
    const rec = loginFails.get(ip);
    if (rec && rec.count >= MAX_FAILS && rec.resetAt > Date.now()) {
      const waitMin = Math.ceil((rec.resetAt - Date.now()) / 60000);
      return res.status(429).json({ error: `ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ ${waitMin} นาที` });
    }

    const pin = String((req.body && req.body.pin) || '');
    const expected = String(process.env.APP_PIN || '');
    if (!expected) return res.status(500).json({ error: 'ยังไม่ได้ตั้งรหัส (APP_PIN)' });

    if (pin && pin === expected) {
      try {
        const r = await pool.query('SELECT * FROM users ORDER BY id LIMIT 1');
        const user = r.rows[0];
        if (!user) return res.status(500).json({ error: 'ไม่พบบัญชีผู้ใช้ในระบบ' });
        req.login(user, err => {
          if (err) return next(err);
          loginFails.delete(ip);
          res.json({ ok: true });
        });
      } catch (e) { next(e); }
      return;
    }

    const now = Date.now();
    if (!rec || rec.resetAt <= now) loginFails.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    else rec.count += 1;
    return res.status(401).json({ error: 'รหัสไม่ถูกต้อง' });
  });

  // ---------- Google OAuth (ปิดอยู่ เปิดคืนได้ด้วยการใส่ GOOGLE_CLIENT_ID) ----------
  if (googleEnabled) {
    router.get('/google', passport.authenticate('google', {
      scope: ['profile', 'email'],
      prompt: 'select_account',
    }));
    router.get('/google/callback',
      passport.authenticate('google', { failureRedirect: '/login.html?error=unauthorized' }),
      (req, res) => res.redirect('/')
    );
  } else {
    router.get('/google', (req, res) => res.redirect('/login.html'));
  }

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
    const { id, email, name, picture } = req.user;
    res.json({ id, email, name, picture });
  });

  return router;
};
