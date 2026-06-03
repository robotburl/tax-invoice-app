// Require login
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// Resolve the "owner_id" for any user:
// - owner → their own id
// - staff  → their owner_id
function resolveOwnerId(user) {
  return user.role === 'owner' ? user.id : user.owner_id;
}

// Check that a given company_id belongs to this user's owner scope
async function canAccessCompany(pool, user, companyId) {
  const ownerId = resolveOwnerId(user);
  if (user.role === 'owner') {
    const r = await pool.query(
      'SELECT id FROM companies WHERE id=$1 AND owner_id=$2',
      [companyId, ownerId]
    );
    return r.rows.length > 0;
  }
  // staff: check staff_access table
  const r = await pool.query(
    'SELECT id FROM staff_access WHERE staff_user_id=$1 AND company_id=$2',
    [user.id, companyId]
  );
  return r.rows.length > 0;
}

module.exports = { requireAuth, resolveOwnerId, canAccessCompany };
