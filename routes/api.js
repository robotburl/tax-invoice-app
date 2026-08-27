const express = require('express');

// Auth middleware
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

module.exports = (pool) => {
  const router = express.Router();
  router.use(requireAuth);

  /* ─── COMPANIES ─── */

  // GET all companies for user
  router.get('/companies', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM companies WHERE user_id = $1 ORDER BY created_at ASC',
        [req.user.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create company
  router.post('/companies', async (req, res) => {
    try {
      const { name, tax_id, address, branch } = req.body;
      if (!name || !tax_id || !address) {
        return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
      }
      // Max 3 companies per user
      const count = await pool.query(
        'SELECT COUNT(*) FROM companies WHERE user_id = $1',
        [req.user.id]
      );
      if (parseInt(count.rows[0].count) >= 3) {
        return res.status(400).json({ error: 'สามารถเพิ่มได้สูงสุด 3 บริษัท' });
      }
      const result = await pool.query(
        'INSERT INTO companies (user_id, name, tax_id, address, branch) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [req.user.id, name, tax_id, address, branch || null]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE company
  router.delete('/companies/:id', async (req, res) => {
    return res.status(403).json({
      error: 'ระบบล็อกการลบไว้ — เอกสารทางบัญชีต้องเก็บรักษาไว้ หากจำเป็นต้องลบจริงให้ทำจากหลังบ้าน',
    });

    /* eslint-disable no-unreachable */
    try {
      await pool.query(
        'DELETE FROM companies WHERE id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ─── INVOICES ─── */

  // GET invoices - optional ?month=YYYY-MM&company_id=X
  router.get('/invoices', async (req, res) => {
    try {
      let query = `
        SELECT i.*, c.name as company_name
        FROM invoices i
        LEFT JOIN companies c ON c.id = i.company_id
        WHERE i.user_id = $1
      `;
      const params = [req.user.id];

      if (req.query.company_id) {
        params.push(req.query.company_id);
        query += ` AND i.company_id = $${params.length}`;
      }
      if (req.query.month) {
        params.push(req.query.month + '-01');
        query += ` AND DATE_TRUNC('month', i.capture_date) = DATE_TRUNC('month', $${params.length}::date)`;
      }
      query += ' ORDER BY i.capture_date DESC';

      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET monthly summary
  router.get('/invoices/summary', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', capture_date), 'YYYY-MM') as month,
          company_id,
          COUNT(*) as count,
          SUM(price) as total_price,
          SUM(vat) as total_vat,
          SUM(total) as total_amount
        FROM invoices
        WHERE user_id = $1
        GROUP BY DATE_TRUNC('month', capture_date), company_id
        ORDER BY DATE_TRUNC('month', capture_date) DESC
      `, [req.user.id]);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create invoice
  router.post('/invoices', async (req, res) => {
    try {
      const {
        company_id, seller_name, seller_tax,
        buyer_name, buyer_tax, buyer_address, buyer_branch,
        items, price, vat, total, invoice_date,
        image_data, address_mismatch, cost_type, notes,
        is_tax_invoice, doc_title,
      } = req.body;

      // เอกสารที่ไม่ใช่ใบกำกับภาษี (ใบแจ้งหนี้/ใบส่งสินค้า/ใบเสนอราคา) เคลม VAT ไม่ได้ — ไม่บันทึก
      if (is_tax_invoice === false) {
        return res.status(422).json({
          error: 'เอกสารนี้ไม่ใช่ใบกำกับภาษี จึงใช้ในระบบภาษีไม่ได้',
          docTitle: doc_title || '',
        });
      }

      // Verify company belongs to user
      if (company_id) {
        const co = await pool.query(
          'SELECT id FROM companies WHERE id = $1 AND user_id = $2',
          [company_id, req.user.id]
        );
        if (co.rows.length === 0) {
          return res.status(403).json({ error: 'บริษัทไม่ถูกต้อง' });
        }
      }

      // Duplicate check: same seller_tax + invoice_date + total
      if (seller_tax && invoice_date && total) {
        const dup = await pool.query(`
          SELECT id, capture_date FROM invoices
          WHERE user_id = $1
            AND seller_tax = $2
            AND invoice_date = $3
            AND total::numeric = $4::numeric
          LIMIT 1
        `, [req.user.id, seller_tax, invoice_date, total]);
        if (dup.rows.length > 0) {
          const dupDate = new Date(dup.rows[0].capture_date).toLocaleDateString('th-TH', {
            year: 'numeric', month: 'long', day: 'numeric'
          });
          return res.status(409).json({
            error: 'duplicate',
            message: `เอกสารนี้เคยบันทึกแล้ว เมื่อวันที่ ${dupDate}`,
            duplicateId: dup.rows[0].id,
          });
        }
      }

      const result = await pool.query(`
        INSERT INTO invoices (
          user_id, company_id, seller_name, seller_tax,
          buyer_name, buyer_tax, buyer_address, buyer_branch,
          items, price, vat, total, invoice_date,
          image_data, address_mismatch, cost_type, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        RETURNING *
      `, [
        req.user.id, company_id || null, seller_name, seller_tax,
        buyer_name, buyer_tax, buyer_address, buyer_branch,
        items, price || 0, vat || 0, total || 0, invoice_date,
        image_data || null, address_mismatch || false, cost_type || null, notes || null,
      ]);
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE invoice
  router.delete('/invoices/:id', async (req, res) => {
    return res.status(403).json({
      error: 'ระบบล็อกการลบไว้ — เอกสารทางบัญชีต้องเก็บรักษาไว้ หากจำเป็นต้องลบจริงให้ทำจากหลังบ้าน',
    });

    /* eslint-disable no-unreachable */
    try {
      await pool.query(
        'DELETE FROM invoices WHERE id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });


  /* ─── ANALYZE INVOICE WITH AI (auto-match company) ─── */
  router.post('/analyze', async (req, res) => {
    try {
      const { imageBase64 } = req.body;
      if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

      // Load all user's companies for auto-matching
      const coResult = await pool.query(
        'SELECT * FROM companies WHERE user_id = $1 ORDER BY created_at ASC',
        [req.user.id]
      );
      const userCompanies = coResult.rows;
      if (userCompanies.length === 0) {
        return res.status(400).json({ error: 'กรุณาเพิ่มบริษัทก่อนใช้งาน' });
      }

      // Build company list for AI prompt
      const coList = userCompanies.map((c, i) =>
        `[${i}] name="${c.name}" tax="${c.tax_id}" address="${c.address}"`
      ).join('\n');

      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1200,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
              { type: 'text', text: `วิเคราะห์เอกสารนี้และตอบกลับเป็น JSON เท่านั้น ไม่มีข้อความอื่น ไม่มี markdown:

ขั้นตอน 1: ดูว่าเป็นเอกสารประเภทใด
- ถ้าเป็น ใบกำกับภาษี / ใบเสร็จรับเงิน / TAX INVOICE → docType = "invoice"
- ถ้าเป็น ใบหัก ณ ที่จ่าย / ภงด.1/3/53 / WHT / Withholding Tax → docType = "wht"

ขั้นตอน 1.5 (สำคัญมาก): อ่าน "หัวเอกสาร" ตามตัวอักษรที่พิมพ์อยู่จริง แล้วระบุ 2 ค่านี้
- docTitle = ข้อความหัวเอกสารที่เห็นจริง ๆ เช่น "ใบกำกับภาษี/ใบเสร็จรับเงิน", "ใบส่งสินค้า/ใบแจ้งหนี้", "ใบเสนอราคา"
- isTaxInvoice = true เฉพาะเมื่อหัวเอกสารมีคำว่า "ใบกำกับภาษี" หรือ "TAX INVOICE" (รวมแบบ "ใบเสร็จรับเงิน/ใบกำกับภาษี", "ใบกำกับภาษีอย่างย่อ")
  ถ้าหัวเอกสารเป็น ใบแจ้งหนี้ / ใบวางบิล / ใบส่งสินค้า / ใบเสนอราคา / ใบสั่งซื้อ / Invoice / Delivery Note / Quotation / Purchase Order
  โดยไม่มีคำว่า "ใบกำกับภาษี" → isTaxInvoice = false (เอกสารพวกนี้ใช้เคลม VAT ไม่ได้ แม้จะมีบรรทัด VAT 7% อยู่ก็ตาม)
  ห้ามเดาว่าเป็นใบกำกับภาษีเพียงเพราะมีการคำนวณ VAT — ต้องเห็นคำว่า "ใบกำกับภาษี" จริง ๆ เท่านั้น

ขั้นตอน 2: ดึงข้อมูลตาม docType และตอบในรูปแบบ JSON นี้:
{
  "docType": "invoice หรือ wht",
  "docTitle": "",
  "isTaxInvoice": true,
  "sellerName":"","sellerTax":"",
  "buyerName":"","buyerTax":"","buyerAddress":"","buyerBranch":"",
  "items":"","price":"","vat":"","total":"","invoiceDate":"",
  "payerName":"","payerTax":"","payeeName":"","payeeTax":"",
  "whtType":"","incomeType":"","incomeAmount":"","whtRate":"","whtAmount":"","whtDate":"",
  "matchedCompanyIndex":-1,
  "costType":""
}

กฎ:
- invoice: price=ราคาก่อน VAT, vat=ภาษีมูลค่าเพิ่ม, total=ราคารวมสุทธิ, invoiceDate=DD/MM/YYYY
- wht: payerName=ผู้จ่ายเงิน, payeeName=ผู้รับเงิน(ถูกหัก), incomeAmount=ยอดเงินได้, whtRate=อัตรา%, whtAmount=ภาษีที่หัก, whtDate=DD/MM/YYYY
- matchedCompanyIndex = index บริษัทในระบบที่ตรงกับผู้ซื้อ(invoice) หรือผู้รับเงิน(wht) ถ้าไม่ตรงใส่ -1
- ถ้าไม่พบข้อมูลใส่ ""
- costType = ประเมินจากรายการสินค้า/บริการและชื่อผู้ขาย ว่าน่าจะเป็นต้นทุนประเภทใด ใช้ค่าใดค่าหนึ่งต่อไปนี้เท่านั้น:
  * "COGS" = ต้นทุนขาย เช่น วัตถุดิบ สินค้า บรรจุภัณฑ์ ค่าขนส่งสินค้า
  * "OPEX" = ค่าใช้จ่ายดำเนินงาน เช่น ค่าเช่า ค่าสาธารณูปโภค ค่าโฆษณา เงินเดือน ค่าบริการ ค่าซ่อมบำรุง
  * "CAPEX" = สินทรัพย์ถาวร เช่น เครื่องจักร อุปกรณ์ คอมพิวเตอร์ ยานพาหนะ อสังหาริมทรัพย์
  * "OTHER" = ไม่แน่ใจหรือไม่เข้าหมวดใด

บริษัทที่มีในระบบ:
${coList}` },
            ],
          }],
        }),
      });

      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text();
        return res.status(500).json({ error: 'Anthropic API error: ' + errText });
      }

      const data = await anthropicRes.json();
      const text = data.content?.map(i => i.text || '').join('') || '';
      let extracted;
      try {
        extracted = JSON.parse(text.replace(/```[a-z]*/g, '').replace(/```/g, '').trim());
      } catch (e) {
        return res.status(500).json({ error: 'AI อ่านผลลัพธ์ไม่สำเร็จ กรุณาลองใหม่' });
      }

      // Resolve matched company
      const idx = parseInt(extracted.matchedCompanyIndex);
      let matchedCompany = (idx >= 0 && idx < userCompanies.length) ? userCompanies[idx] : null;

      // Smart address match: if company matched by name/tax, auto-correct address
      let addressCorrected = false;
      if (matchedCompany && extracted.buyerAddress) {
        const normalize = s => (s || '').replace(/\s+/g, '').toLowerCase()
          .replace(/จังหวัด|อำเภอ|เขต|ตำบล|แขวง|จ\.|อ\.|ต\./g, '');

        const readAddr = normalize(extracted.buyerAddress);
        const dbAddr = normalize(matchedCompany.address);

        // Extract house number (first token) for comparison
        const getHouseNum = s => (s.match(/^[\d/]+/) || [''])[0];
        const houseMatch = getHouseNum(readAddr) === getHouseNum(dbAddr) && getHouseNum(dbAddr) !== '';

        // Count matching characters
        const matchScore = [...readAddr].filter((c, i) => dbAddr.includes(c)).length / Math.max(readAddr.length, 1);

        // If house number matches OR 70%+ character overlap → treat as match, use DB address
        if (houseMatch || matchScore >= 0.7) {
          extracted.buyerAddress = matchedCompany.address; // auto-correct to DB value
          extracted.buyerBranch = matchedCompany.branch || extracted.buyerBranch;
          addressCorrected = true;
        }
      }

      const isTaxInvoice = extracted.isTaxInvoice !== false;
      res.json({
        extracted, matchedCompany, userCompanies, addressCorrected,
        docType: extracted.docType || 'invoice',
        isTaxInvoice,
        docTitle: extracted.docTitle || '',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });


  /* ─── WHT RECORDS ─── */

  router.get('/wht', async (req, res) => {
    try {
      let query = `SELECT w.*, c.name as company_name FROM wht_records w
        LEFT JOIN companies c ON c.id = w.company_id
        WHERE w.user_id = $1`;
      const params = [req.user.id];
      if (req.query.company_id) { params.push(req.query.company_id); query += ` AND w.company_id = $${params.length}`; }
      if (req.query.month) { params.push(req.query.month + '-01'); query += ` AND DATE_TRUNC('month', w.capture_date) = DATE_TRUNC('month', $${params.length}::date)`; }
      query += ' ORDER BY w.capture_date DESC';
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/wht', async (req, res) => {
    try {
      const { company_id, payer_name, payer_tax, payee_name, payee_tax,
              wht_type, income_type, income_amount, wht_rate, wht_amount,
              wht_date, image_data, notes } = req.body;
      if (company_id) {
        const co = await pool.query('SELECT id FROM companies WHERE id = $1 AND user_id = $2', [company_id, req.user.id]);
        if (!co.rows.length) return res.status(403).json({ error: 'บริษัทไม่ถูกต้อง' });
      }
      // Duplicate check: same payer_tax + wht_date + wht_amount
      if (payer_tax && wht_date && wht_amount) {
        const dup = await pool.query(`
          SELECT id, capture_date FROM wht_records
          WHERE user_id = $1
            AND payer_tax = $2
            AND wht_date = $3
            AND wht_amount::numeric = $4::numeric
          LIMIT 1
        `, [req.user.id, payer_tax, wht_date, wht_amount]);
        if (dup.rows.length > 0) {
          const dupDate = new Date(dup.rows[0].capture_date).toLocaleDateString('th-TH', {
            year: 'numeric', month: 'long', day: 'numeric'
          });
          return res.status(409).json({
            error: 'duplicate',
            message: `เอกสารนี้เคยบันทึกแล้ว เมื่อวันที่ ${dupDate}`,
            duplicateId: dup.rows[0].id,
          });
        }
      }

      const result = await pool.query(`
        INSERT INTO wht_records (user_id,company_id,payer_name,payer_tax,payee_name,payee_tax,
          wht_type,income_type,income_amount,wht_rate,wht_amount,wht_date,image_data,notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [req.user.id, company_id||null, payer_name, payer_tax, payee_name, payee_tax,
         wht_type, income_type, income_amount||0, wht_rate||0, wht_amount||0,
         wht_date, image_data||null, notes||null]);
      res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/wht/:id', async (req, res) => {
    return res.status(403).json({
      error: 'ระบบล็อกการลบไว้ — เอกสารทางบัญชีต้องเก็บรักษาไว้ หากจำเป็นต้องลบจริงให้ทำจากหลังบ้าน',
    });

    /* eslint-disable no-unreachable */
    try {
      await pool.query('DELETE FROM wht_records WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /* ─── ANALYZE WHT ─── */
  router.post('/analyze-wht', async (req, res) => {
    try {
      const { imageBase64 } = req.body;
      if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

      const coResult = await pool.query('SELECT * FROM companies WHERE user_id = $1 ORDER BY created_at ASC', [req.user.id]);
      const userCompanies = coResult.rows;
      const coList = userCompanies.map((c,i) => `[${i}] name="${c.name}" tax="${c.tax_id}"`).join('\n');

      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: `อ่านใบหัก ณ ที่จ่าย (ภงด.53/WHT) และตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น:
{"payerName":"","payerTax":"","payeeName":"","payeeTax":"","whtType":"ภงด.53","incomeType":"","incomeAmount":"","whtRate":"","whtAmount":"","whtDate":"","matchedCompanyIndex":-1}
กฎ: incomeAmount=ยอดเงินได้, whtRate=อัตราภาษี%, whtAmount=ยอดภาษีที่หัก, whtDate=วันที่รูปแบบ DD/MM/YYYY
matchedCompanyIndex=index บริษัทผู้รับเงิน(payee)ที่ตรงกัน ถ้าไม่ตรงใส่ -1
บริษัทในระบบ:\n${coList}` }
          ]}]
        })
      });

      if (!anthropicRes.ok) { const e = await anthropicRes.text(); return res.status(500).json({ error: 'Anthropic API error: ' + e }); }
      const data = await anthropicRes.json();
      const text = data.content?.map(i => i.text||'').join('') || '';
      let extracted;
      try { extracted = JSON.parse(text.replace(/\`\`\`[a-z]*/g,'').replace(/\`\`\`/g,'').trim()); }
      catch(e) { return res.status(500).json({ error: 'AI อ่านผลลัพธ์ไม่สำเร็จ' }); }

      const idx = parseInt(extracted.matchedCompanyIndex);
      const matchedCompany = (idx >= 0 && idx < userCompanies.length) ? userCompanies[idx] : null;
      res.json({ extracted, matchedCompany, userCompanies });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /* ─── EXCEL EXPORT ─── */
  router.get('/export/excel', async (req, res) => {
    try {
      const { month, company_id, type } = req.query; // type = 'invoice'|'wht'|'all'
      const params = [req.user.id];
      let monthFilter = '';
      if (month) { params.push(month + '-01'); monthFilter = ` AND DATE_TRUNC('month', capture_date) = DATE_TRUNC('month', $${params.length}::date)`; }
      let coFilter = '';
      if (company_id) { params.push(company_id); coFilter = ` AND company_id = $${params.length}`; }

      const invRows = (!type || type === 'invoice' || type === 'all')
        ? (await pool.query(`SELECT * FROM invoices WHERE user_id = $1${monthFilter}${coFilter} ORDER BY capture_date ASC`, params)).rows
        : [];
      // WHT uses wht_date (document date) for month grouping, not capture_date
      let whtRows = [];
      if (!type || type === 'wht' || type === 'all') {
        let whtQuery = `SELECT * FROM wht_records WHERE user_id = $1`;
        const whtParams = [req.user.id];
        if (month) {
          whtParams.push(month + '-01');
          whtQuery += ` AND (
            CASE WHEN wht_date ~ '^\d{2}/\d{2}/\d{4}$' THEN
              TO_DATE(
                CASE WHEN SPLIT_PART(wht_date,'/',3)::int > 2500
                  THEN (SPLIT_PART(wht_date,'/',3)::int - 543)::text
                  ELSE SPLIT_PART(wht_date,'/',3)
                END || '-' || SPLIT_PART(wht_date,'/',2) || '-01',
                'YYYY-MM-DD'
              )
            ELSE DATE_TRUNC('month', capture_date)
            END
          ) = DATE_TRUNC('month', $${whtParams.length}::date)`;
        }
        if (company_id) { whtParams.push(company_id); whtQuery += ` AND company_id = $${whtParams.length}`; }
        whtQuery += ' ORDER BY wht_date ASC';
        whtRows = (await pool.query(whtQuery, whtParams)).rows;
      }

      // Build simple CSV-style JSON for client-side Excel generation
      res.json({
        invoices: invRows.map(r => ({
          'วันที่บันทึก': r.capture_date ? new Date(r.capture_date).toLocaleDateString('th-TH') : '',
          'วันที่ในบิล': r.invoice_date || '',
          'ผู้ขาย': r.seller_name || '',
          'เลขภาษีผู้ขาย': r.seller_tax || '',
          'รายการ': r.items || '',
          'ราคาก่อน VAT': r.price || 0,
          'VAT': r.vat || 0,
          'รวมสุทธิ': r.total || 0,
          'ประเภทต้นทุน': r.cost_type || '',
          'บริษัทผู้ซื้อ': r.buyer_name || '',
          'หมายเหตุ': r.notes || '',
        })),
        wht: whtRows.map(r => ({
          'วันที่บันทึก': r.capture_date ? new Date(r.capture_date).toLocaleDateString('th-TH') : '',
          'วันที่ในเอกสาร': r.wht_date || '',
          'ผู้จ่ายเงิน': r.payer_name || '',
          'เลขภาษีผู้จ่าย': r.payer_tax || '',
          'ประเภทเอกสาร': r.wht_type || '',
          'ประเภทเงินได้': r.income_type || '',
          'ยอดเงินได้': r.income_amount || 0,
          'อัตราภาษี %': r.wht_rate || 0,
          'ยอดภาษีหัก ณ ที่จ่าย': r.wht_amount || 0,
          'หมายเหตุ': r.notes || '',
        })),
        month: month || 'all',
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  /* ─── BACKFILL cost_type for existing invoices ─── */
  router.post('/invoices/backfill-cost-type', async (req, res) => {
    try {
      // Get all invoices without cost_type
      const result = await pool.query(
        `SELECT id, seller_name, seller_tax, items, image_data
         FROM invoices
         WHERE user_id = $1 AND (cost_type IS NULL OR cost_type = '')
         ORDER BY created_at ASC`,
        [req.user.id]
      );

      const rows = result.rows;
      if (!rows.length) return res.json({ updated: 0, message: 'ไม่มีรายการที่ต้องอัปเดต' });

      let updated = 0;
      const errors = [];

      for (const row of rows) {
        try {
          let costType = 'OTHER';

          if (row.image_data) {
            // Use AI vision to detect cost type from image
            const b64 = row.image_data.replace(/^data:image\/\w+;base64,/, '');
            const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 50,
                messages: [{
                  role: 'user',
                  content: [
                    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
                    { type: 'text', text: `ดูรายการสินค้า/บริการในใบกำกับภาษีนี้ แล้วตอบเพียงคำเดียว (COGS, OPEX, CAPEX, หรือ OTHER):
- COGS = วัตถุดิบ สินค้า บรรจุภัณฑ์ ค่าขนส่งสินค้า
- OPEX = ค่าเช่า สาธารณูปโภค โฆษณา บริการ ซ่อมบำรุง
- CAPEX = เครื่องจักร อุปกรณ์ คอมพิวเตอร์ ยานพาหนะ
- OTHER = ไม่แน่ใจ` }
                  ]
                }]
              })
            });

            if (aiRes.ok) {
              const data = await aiRes.json();
              const text = (data.content?.[0]?.text || '').trim().toUpperCase();
              if (['COGS','OPEX','CAPEX'].includes(text)) costType = text;
            }
          } else if (row.items || row.seller_name) {
            // Fallback: text-only analysis
            const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 50,
                messages: [{
                  role: 'user',
                  content: `ผู้ขาย: ${row.seller_name || ''}\nรายการ: ${row.items || ''}\n\nตอบเพียงคำเดียว (COGS, OPEX, CAPEX, หรือ OTHER) โดย COGS=วัตถุดิบ/สินค้า, OPEX=ค่าดำเนินงาน, CAPEX=สินทรัพย์ถาวร`
                }]
              })
            });

            if (aiRes.ok) {
              const data = await aiRes.json();
              const text = (data.content?.[0]?.text || '').trim().toUpperCase();
              if (['COGS','OPEX','CAPEX'].includes(text)) costType = text;
            }
          }

          await pool.query(
            'UPDATE invoices SET cost_type = $1 WHERE id = $2 AND user_id = $3',
            [costType, row.id, req.user.id]
          );
          updated++;

          // Small delay to avoid rate limiting
          await new Promise(r => setTimeout(r, 200));

        } catch (err) {
          errors.push({ id: row.id, error: err.message });
        }
      }

      res.json({
        total: rows.length,
        updated,
        errors: errors.length,
        message: `อัปเดตสำเร็จ ${updated}/${rows.length} รายการ`
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
