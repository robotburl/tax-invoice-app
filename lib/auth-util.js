'use strict';
// เข้ารหัสรหัสผ่านด้วย scrypt (มีในตัว Node ไม่ต้องพึ่ง library ภายนอก)
const crypto = require('crypto');

const N = 16384, r = 8, p = 1, KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, { N, r, p });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  try {
    const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), KEYLEN, { N, r, p });
    const expected = Buffer.from(hashHex, 'hex');
    return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
  } catch { return false; }
}

// ให้ทุกคนในบริษัทเห็นข้อมูลชุดเดียวกัน โดยยึด id ของ admin คนแรกเป็นเจ้าของข้อมูล
let cachedOwnerId = null;
async function orgOwnerId(pool) {
  if (cachedOwnerId) return cachedOwnerId;
  const r = await pool.query(
    `SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`
  );
  cachedOwnerId = r.rows[0]?.id
    || (await pool.query('SELECT id FROM users ORDER BY id LIMIT 1')).rows[0]?.id
    || null;
  return cachedOwnerId;
}
function resetOwnerCache() { cachedOwnerId = null; }

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
}

module.exports = { hashPassword, verifyPassword, orgOwnerId, resetOwnerCache, requireAdmin };
