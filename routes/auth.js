// จัดการ session ของผู้ใช้ (ระบบเข้าสู่ระบบใช้อีเมล+รหัสผ่าน ดูที่ authRoutes.js)
module.exports = function (passport, pool) {
  passport.serializeUser((user, done) => done(null, user.id));

  passport.deserializeUser(async (id, done) => {
    try {
      const r = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      const user = r.rows[0];
      // บัญชีที่ถูกระงับให้หลุด session ทันที
      if (!user || user.is_active === false) return done(null, false);
      done(null, user);
    } catch (e) { done(e); }
  });
};
