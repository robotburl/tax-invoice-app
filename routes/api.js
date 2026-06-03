const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const { requireAuth, resolveOwnerId, canAccessCompany } = require('../middleware/auth');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cost per token (claude-sonnet-4-6)
const COST_INPUT_PER_TOKEN = 3 / 1_000_000;
const COST_OUTPUT_PER_TOKEN = 15 / 1_000_000;

module.exports = function (pool) {
  const router = express.Router();
  router.use(requireAuth);

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function trackUsage(pool, user, inputTokens, outputTokens) {
    const ownerId = resolveOwnerId(user);
    const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    const cost = inputTokens * COST_INPUT_PER_TOKEN + outputTokens * COST_OUTPUT_PER_TOKEN;
    await pool.query(`
      INSERT INTO api_usage (owner_id, uploaded_by, month, input_tokens, output_tokens, cost_usd, scan_count)
      VALUES ($1, $2, $3, $4, $5, $6, 1)
      ON CONFLICT (owner_id, month) DO UPDATE SET
        input_tokens  = api_usage.input_tokens  + EXCLUDED.input_tokens,
        output_tokens = api_usage.output_tokens + EXCLUDED.output_tokens,
        cost_usd      = api_usage.cost_usd      + EXCLUDED.cost_usd,
        scan_count    = api_usage.scan_count    + 1
    `, [ownerId, user.id, month, inputTokens, outputTokens, cost]);
  }

  // ── /api/me ───────────────────────────────────────────────────────────────

  router.get('/me', (req, res) => {
    const { id, email, name, picture, role, owner_id } = req.user;
    res.json({ id, email, name, picture, role, owner_id });
  });

  // ── Companies ─────────────────────────────────────────────────────────────

  // GET /api/companies — list companies this user can see
  router.get('/companies', async (req, res) => {
    try {
      const ownerId = resolveOwnerId(req.user);
      let rows;
      if (req.user.role === 'owner') {
        const r = await pool.query(
          'SELECT * FROM companies WHERE owner_id=$1 ORDER BY created_at',
          [ownerId]
        );
        rows = r.rows;
      } else {
        // staff: only companies in staff_access
        const r = await pool.query(`
          SELECT c.* FROM companies c
          JOIN staff_access sa ON sa.company_id = c.id
          WHERE sa.staff_user_id = $1
          ORDER BY c.created_at
        `, [req.user.id]);
        rows = r.rows;
      }
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/companies — owner only
  router.post('/companies', async (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
    const { name, tax_id, address, branch } = req.body;
    if (!name || !tax_id || !address) return res.status(400).json({ error: 'Missing fields' });
    try {
      const r = await pool.query(
        `INSERT INTO companies (owner_id, name, tax_id, address, branch) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.id, name, tax_id, address, branch || null]
      );
      res.json(r.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/companies/:id — owner only
  router.put('/companies/:id', async (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
    const { name, tax_id, address, branch } = req.body;
    try {
      const r = await pool.query(
        `UPDATE companies SET name=$1, tax_id=$2, address=$3, branch=$4
         WHERE id=$5 AND owner_id=$6 RETURNING *`,
        [name, tax_id, address, branch || null, req.params.id, req.user.id]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      res.json(r.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/companies/:id — owner only
  router.delete('/companies/:id', async (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
    try {
      await pool.query('DELETE FROM companies WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Staff management ──────────────────────────────────────────────────────

  // GET /api/staff — list staff under this owner
  router.get('/staff', async (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
    try {
      const r = await pool.query(`
        SELECT u.id, u.email, u.name, u.picture, u.created_at,
               ARRAY_AGG(sa.company_id) FILTER (WHERE sa.company_id IS NOT NULL) AS company_ids
        FROM users u
        LEFT JOIN staff_access sa ON sa.staff_user_id = u.id
        WHERE u.owner_id = $1 AND u.role = 'staff'
        GROUP BY u.id
        ORDER BY u.created_at
      `, [req.user.id]);
      res.json(r.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/staff/:id/access — update which companies a staff member can see
  router.put('/staff/:id/access', async (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
    const { company_ids } = req.body; // array of integers
    const staffId = parseInt(req.params.id);
    try {
      // Verify this staff belongs to this owner
      const check = await pool.query(
        'SELECT id FROM users WHERE id=$1 AND owner_id=$2 AND role=$3',
        [staffId, req.user.id, 'staff']
      );
      if (!check.rows.length) return res.status(404).json({ error: 'Staff not found' });

      await pool.query('DELETE FROM staff_access WHERE staff_user_id=$1', [staffId]);
      for (const cid of (company_ids || [])) {
        await pool.query(
          'INSERT INTO staff_access (staff_user_id, company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [staffId, cid]
        );
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/staff/:id — remove staff member
  router.delete('/staff/:id', async (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
    try {
      await pool.query('DELETE FROM users WHERE id=$1 AND owner_id=$2 AND role=$3',
        [req.params.id, req.user.id, 'staff']);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Invitations ───────────────────────────────────────────────────────────

  // POST /api/invitations — send invite (owner only)
  router.post('/invitations', async (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
    const { email, company_ids } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    // Max 4 staff per owner
    const staffCount = await pool.query(
      'SELECT COUNT(*) FROM users WHERE owner_id=$1 AND role=$2',
      [req.user.id, 'staff']
    );
    if (parseInt(staffCount.rows[0].count) >= 4) {
      return res.status(400).json({ error: 'สูงสุด 4 staff ต่อ owner' });
    }

    try {
      const token = crypto.randomBytes(24).toString('hex');
      await pool.query(
        `INSERT INTO invitations (owner_id, invitee_email, token, company_ids)
         VALUES ($1,$2,$3,$4)`,
        [req.user.id, email, token, company_ids || []]
      );
      const inviteUrl = `${process.env.BASE_URL || 'https://tax-invoice-app-production-b6e9.up.railway.app'}/invite/${token}`;
      res.json({ token, inviteUrl, email });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/invitations — list pending invites
  router.get('/invitations', async (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
    try {
      const r = await pool.query(
        `SELECT id, invitee_email, company_ids, used, created_at, expires_at
         FROM invitations WHERE owner_id=$1 ORDER BY created_at DESC`,
        [req.user.id]
      );
      res.json(r.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── AI Analyze ────────────────────────────────────────────────────────────

  router.post('/analyze', async (req, res) => {
    const { imageBase64, mimeType, companyId } = req.body;
    if (!imageBase64 || !mimeType) return res.status(400).json({ error: 'Missing image' });

    // Permission check
    if (companyId && !(await canAccessCompany(pool, req.user, companyId))) {
      return res.status(403).json({ error: 'No access to this company' });
    }

    const ownerId = resolveOwnerId(req.user);
    let companies = [];
    if (req.user.role === 'owner') {
      const r = await pool.query('SELECT * FROM companies WHERE owner_id=$1', [ownerId]);
      companies = r.rows;
    } else {
      const r = await pool.query(`
        SELECT c.* FROM companies c
        JOIN staff_access sa ON sa.company_id=c.id
        WHERE sa.staff_user_id=$1
      `, [req.user.id]);
      companies = r.rows;
    }

    const companiesJson = JSON.stringify(companies.map(c => ({
      id: c.id, name: c.name, tax_id: c.tax_id, address: c.address, branch: c.branch
    })));

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: imageBase64 }
            },
            {
              type: 'text',
              text: `วิเคราะห์เอกสารภาษีไทยนี้และตอบเป็น JSON เท่านั้น ห้ามมีข้อความนอก JSON

บริษัทของเรา: ${companiesJson}

ถ้าเป็นใบกำกับภาษี (VAT invoice) ให้ตอบ:
{
  "type": "invoice",
  "seller_name": "...", "seller_tax": "...",
  "buyer_name": "...", "buyer_tax": "...", "buyer_address": "...", "buyer_branch": "...",
  "items": "...", "price": 0, "vat": 0, "total": 0,
  "invoice_date": "YYYY-MM-DD",
  "matched_company_id": null,
  "address_mismatch": false,
  "duplicate_check": { "seller_tax": "...", "invoice_date": "...", "total": 0 }
}

ถ้าเป็นใบหัก ณ ที่จ่าย / ภงด.53 ให้ตอบ:
{
  "type": "wht",
  "payer_name": "...", "payer_tax": "...",
  "payee_name": "...", "payee_tax": "...",
  "wht_type": "ภงด.53", "income_type": "...",
  "income_amount": 0, "wht_amount": 0,
  "wht_date": "YYYY-MM-DD",
  "matched_company_id": null
}

ตรวจสอบว่า buyer_name/buyer_tax/buyer_address ตรงกับบริษัทในรายการหรือไม่ (เปรียบเทียบที่อยู่โดยดูตัวอักษรทับซ้อนกัน 70%+)
ถ้าตรง ให้ใส่ matched_company_id = id ของบริษัทนั้น และ address_mismatch = false/true
ถ้าไม่มีบริษัทตรง ให้ matched_company_id = null`
            }
          ]
        }]
      });

      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;
      await trackUsage(pool, req.user, inputTokens, outputTokens);

      const text = response.content[0].text.trim();
      const clean = text.replace(/```json|```/g, '').trim();
      const data = JSON.parse(clean);

      // Duplicate check for invoices
      if (data.type === 'invoice' && data.duplicate_check) {
        const { seller_tax, invoice_date, total } = data.duplicate_check;
        const dup = await pool.query(
          `SELECT id FROM invoices WHERE owner_id=$1 AND seller_tax=$2 AND invoice_date=$3 AND total=$4`,
          [ownerId, seller_tax, invoice_date, total]
        );
        data.is_duplicate = dup.rows.length > 0;
      }

      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Invoices ─────────────────────────────────────────────────────────────

  router.get('/invoices', async (req, res) => {
    try {
      const ownerId = resolveOwnerId(req.user);
      let rows;
      if (req.user.role === 'owner') {
        const r = await pool.query(
          `SELECT i.*, c.name as company_name, u.name as uploaded_by_name
           FROM invoices i
           LEFT JOIN companies c ON c.id=i.company_id
           LEFT JOIN users u ON u.id=i.uploaded_by
           WHERE i.owner_id=$1 ORDER BY i.capture_date DESC`,
          [ownerId]
        );
        rows = r.rows;
      } else {
        const r = await pool.query(`
          SELECT i.*, c.name as company_name, u.name as uploaded_by_name
          FROM invoices i
          LEFT JOIN companies c ON c.id=i.company_id
          LEFT JOIN users u ON u.id=i.uploaded_by
          WHERE i.owner_id=$1 AND i.company_id IN (
            SELECT company_id FROM staff_access WHERE staff_user_id=$2
          )
          ORDER BY i.capture_date DESC
        `, [ownerId, req.user.id]);
        rows = r.rows;
      }
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/invoices', async (req, res) => {
    const d = req.body;
    if (d.company_id && !(await canAccessCompany(pool, req.user, d.company_id))) {
      return res.status(403).json({ error: 'No access to this company' });
    }
    const ownerId = resolveOwnerId(req.user);
    try {
      const r = await pool.query(`
        INSERT INTO invoices
          (owner_id, uploaded_by, company_id, seller_name, seller_tax, buyer_name, buyer_tax,
           buyer_address, buyer_branch, items, price, vat, total, invoice_date, image_data, address_mismatch, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [ownerId, req.user.id, d.company_id, d.seller_name, d.seller_tax, d.buyer_name, d.buyer_tax,
         d.buyer_address, d.buyer_branch, d.items, d.price, d.vat, d.total,
         d.invoice_date, d.image_data, d.address_mismatch || false, d.notes || null]
      );
      res.json(r.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/invoices/:id', async (req, res) => {
    const ownerId = resolveOwnerId(req.user);
    try {
      await pool.query('DELETE FROM invoices WHERE id=$1 AND owner_id=$2', [req.params.id, ownerId]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── WHT Records ───────────────────────────────────────────────────────────

  router.get('/wht', async (req, res) => {
    try {
      const ownerId = resolveOwnerId(req.user);
      let rows;
      if (req.user.role === 'owner') {
        const r = await pool.query(
          `SELECT w.*, c.name as company_name, u.name as uploaded_by_name
           FROM wht_records w
           LEFT JOIN companies c ON c.id=w.company_id
           LEFT JOIN users u ON u.id=w.uploaded_by
           WHERE w.owner_id=$1 ORDER BY w.wht_date DESC`,
          [ownerId]
        );
        rows = r.rows;
      } else {
        const r = await pool.query(`
          SELECT w.*, c.name as company_name, u.name as uploaded_by_name
          FROM wht_records w
          LEFT JOIN companies c ON c.id=w.company_id
          LEFT JOIN users u ON u.id=w.uploaded_by
          WHERE w.owner_id=$1 AND w.company_id IN (
            SELECT company_id FROM staff_access WHERE staff_user_id=$2
          )
          ORDER BY w.wht_date DESC
        `, [ownerId, req.user.id]);
        rows = r.rows;
      }
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/wht', async (req, res) => {
    const d = req.body;
    if (d.company_id && !(await canAccessCompany(pool, req.user, d.company_id))) {
      return res.status(403).json({ error: 'No access to this company' });
    }
    const ownerId = resolveOwnerId(req.user);
    try {
      const r = await pool.query(`
        INSERT INTO wht_records
          (owner_id, uploaded_by, company_id, payer_name, payer_tax, payee_name, payee_tax,
           wht_type, income_type, income_amount, wht_amount, wht_date, image_data, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [ownerId, req.user.id, d.company_id, d.payer_name, d.payer_tax, d.payee_name, d.payee_tax,
         d.wht_type, d.income_type, d.income_amount, d.wht_amount, d.wht_date, d.image_data, d.notes || null]
      );
      res.json(r.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/wht/:id', async (req, res) => {
    const ownerId = resolveOwnerId(req.user);
    try {
      await pool.query('DELETE FROM wht_records WHERE id=$1 AND owner_id=$2', [req.params.id, ownerId]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Usage summary (owner only) ────────────────────────────────────────────

  router.get('/usage', async (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
    try {
      const r = await pool.query(
        `SELECT month, input_tokens, output_tokens, cost_usd, scan_count
         FROM api_usage WHERE owner_id=$1 ORDER BY month DESC`,
        [req.user.id]
      );
      res.json(r.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
