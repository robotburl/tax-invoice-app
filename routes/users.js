const express = require('express');
const { hashPassword, requireAdmin, resetOwnerCache } = require('../lib/auth-util');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PUBLIC_COLS = 'id, email, name, role, is_active, created_at';

module.exports = (pool) => {
  const router = express.Router();

  // ---------- ของตัวเอง: เปลี่ยนรหัสผ่าน ----------
  router.post('/me/password', async (req, res, next) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' });
    }
    try {
      const { verifyPassword } = require('../lib/auth-util');
      const r = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      if (!verifyPassword(String(currentPassword || ''), r.rows[0]?.password_hash)) {
        return res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
      }
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2',
        [hashPassword(newPassword), req.user.id]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---------- เฉพาะผู้ดูแลระบบ ----------
  router.get('/users', requireAdmin, async (req, res, next) => {
    try {
      const r = await pool.query(`
        SELECT u.id, u.email, u.name, u.role, u.is_active, u.created_at,
               (SELECT COUNT(*) FROM invoices i WHERE i.uploaded_by = u.id) AS invoice_count,
               (SELECT COUNT(*) FROM wht_records w WHERE w.uploaded_by = u.id) AS wht_count
        FROM users u ORDER BY u.id`);
      res.json(r.rows);
    } catch (e) { next(e); }
  });

  router.post('/users', requireAdmin, async (req, res, next) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const role = req.body?.role === 'admin' ? 'admin' : 'user';
    const password = String(req.body?.password || '');

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' });
    if (!name) return res.status(400).json({ error: 'กรุณาใส่ชื่อผู้ใช้' });
    if (password.length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' });

    try {
      const dup = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
      if (dup.rows.length) return res.status(409).json({ error: 'อีเมลนี้มีผู้ใช้แล้ว' });

      const r = await pool.query(`
        INSERT INTO users (email, name, role, password_hash, is_active, created_by)
        VALUES ($1,$2,$3,$4,TRUE,$5) RETURNING ${PUBLIC_COLS}`,
        [email, name, role, hashPassword(password), req.user.id]);
      resetOwnerCache();
      res.status(201).json(r.rows[0]);
    } catch (e) { next(e); }
  });

  router.patch('/users/:id', requireAdmin, async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const sets = [], vals = [];
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      vals.push(req.body.name.trim()); sets.push(`name = $${vals.length}`);
    }
    if (req.body?.role === 'admin' || req.body?.role === 'user') {
      vals.push(req.body.role); sets.push(`role = $${vals.length}`);
    }
    if (typeof req.body?.is_active === 'boolean') {
      vals.push(req.body.is_active); sets.push(`is_active = $${vals.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' });

    try {
      // กันไม่ให้ระบบเหลือผู้ดูแลศูนย์คน หรือผู้ดูแลปิดบัญชีตัวเอง
      if (id === req.user.id && (req.body.role === 'user' || req.body.is_active === false)) {
        return res.status(400).json({ error: 'ไม่สามารถลดสิทธิ์หรือระงับบัญชีตัวเองได้' });
      }
      vals.push(id);
      const r = await pool.query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING ${PUBLIC_COLS}`, vals);
      if (!r.rows.length) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
      resetOwnerCache();
      res.json(r.rows[0]);
    } catch (e) { next(e); }
  });

  router.post('/users/:id/password', requireAdmin, async (req, res, next) => {
    const password = String(req.body?.password || '');
    if (password.length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' });
    try {
      const r = await pool.query(
        `UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING ${PUBLIC_COLS}`,
        [hashPassword(password), parseInt(req.params.id, 10)]);
      if (!r.rows.length) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
      res.json({ ok: true, user: r.rows[0] });
    } catch (e) { next(e); }
  });

  // ล็อกการลบเหมือนส่วนอื่นของระบบ — ระงับบัญชีแทน
  router.delete('/users/:id', requireAdmin, (req, res) => {
    res.status(403).json({ error: 'ระบบล็อกการลบไว้ — ใช้การระงับบัญชีแทน' });
  });

  return router;
};
