/* ─── STATE ─── */
let currentUser = null;
let companies = [];
let invoices = [];
let activeTab = 'dashboard';
let activeCompany = 'all';
let activeDocFilter = 'all';
let currentBase64 = null;
let pendingRecord = null;

/* ─── INIT ─── */
async function init() {
  await fetchUser();
  await fetchCompanies();
  await fetchInvoices();
  await fetchWht();
  renderDashboard();
  // pre-render records
  if (activeTab === 'records') renderRecords();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

async function fetchUser() {
  try {
    const r = await fetch('/auth/me');
    if (!r.ok) { location.href = '/login.html'; return; }
    currentUser = await r.json();
    const ui = document.getElementById('user-info');
    ui.innerHTML = currentUser.picture
      ? `<img src="${currentUser.picture}" class="user-avatar" referrerpolicy="no-referrer"><span class="user-name">${esc(currentUser.name)}</span>`
      : `<span class="user-name">${esc(currentUser.name)}</span>`;
  } catch (e) { console.error(e); }
}

async function fetchCompanies() {
  try {
    const r = await fetch('/api/companies');
    if (r.ok) companies = await r.json();
  } catch (e) { console.error(e); }
}

async function fetchInvoices() {
  try {
    const r = await fetch('/api/invoices');
    if (r.ok) invoices = await r.json();
  } catch (e) { console.error(e); }
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/';
}

/* ─── NAVIGATION ─── */
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  if (tab === 'dashboard') renderDashboard();
  if (tab === 'records') { activeDocFilter='all'; renderRecords(); }
  if (tab === 'companies') renderCompanies();
  if (tab === 'report') { renderReport(); renderImageDownloadList(); }
  if (tab === 'users') {
    if (!currentUser || currentUser.role !== 'admin') { switchTab('dashboard'); return; }
    renderUsers();
  }
  document.querySelector('.content').scrollTop = 0;
}

/* ─── COMPANY BAR ─── */
function renderCompanyBar(containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  const all = btn('ทั้งหมด', 'all');
  el.appendChild(all);
  companies.forEach(c => {
    const short = c.name.replace(/บริษัท\s*/i, '').replace(/\s*จำกัด.*/i, '').trim();
    el.appendChild(btn(short || c.name, c.id));
  });
  function btn(label, id) {
    const b = document.createElement('button');
    b.className = 'company-pill' + (activeCompany === String(id) ? ' active' : '');
    b.textContent = label;
    b.onclick = () => { activeCompany = String(id); renderCompanyBar(containerId); if (activeTab === 'dashboard') renderDashboard(); else renderRecords(); };
    return b;
  }
}

/* ─── DASHBOARD ─── */
function renderDashboard() {
  renderCompanyBar('dashboard-company-bar');
  const now = new Date();
  const yr = now.getFullYear(), mo = now.getMonth();

  const inMonth = r => {
    const d = new Date(r.capture_date);
    return d.getFullYear() === yr && d.getMonth() === mo;
  };
  const inCo = r => activeCompany === 'all' || String(r.company_id) === activeCompany;

  const filtInv = invoices.filter(r => inCo(r) && inMonth(r));
  // Dashboard ใช้ capture_date (วันที่นำเข้า) สำหรับกรองเดือน
  const filtWht = whtRecords.filter(r => inCo(r) && inMonth(r));

  const tPre  = sum(filtInv, 'price');
  const tVat  = sum(filtInv, 'vat');
  const tTot  = sum(filtInv, 'total');
  const tWhtIncome = sum(filtWht, 'income_amount');
  const tWhtTax    = sum(filtWht, 'wht_amount');

  const MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card" style="grid-column:1/-1;background:var(--bg3);border-color:var(--border)">
      <div class="stat-label">📅 ${MONTHS[mo]} ${yr+543}</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px">
        <div><div style="font-size:11px;color:var(--text3)">🧾 ใบกำกับภาษี</div><div style="font-weight:600;font-size:15px">${filtInv.length} รายการ</div></div>
        <div><div style="font-size:11px;color:var(--text3)">📋 WHT</div><div style="font-weight:600;font-size:15px">${filtWht.length} รายการ</div></div>
      </div>
    </div>
    <div class="stat-card"><div class="stat-label">💰 ก่อน VAT</div><div class="stat-value">${fmt(tPre)}</div><div class="stat-sub">บาท</div></div>
    <div class="stat-card"><div class="stat-label">🏦 VAT รวม</div><div class="stat-value amber">${fmt(tVat)}</div><div class="stat-sub">บาท</div></div>
    <div class="stat-card"><div class="stat-label">🧾 ยอดสุทธิ VAT</div><div class="stat-value green">${fmt(tTot)}</div><div class="stat-sub">บาท</div></div>
    <div class="stat-card"><div class="stat-label">📋 ยอดเงินได้ WHT</div><div class="stat-value accent">${fmt(tWhtIncome)}</div><div class="stat-sub">บาท</div></div>
    <div class="stat-card" style="grid-column:1/-1"><div class="stat-label">✂️ ภาษีถูกหัก ณ ที่จ่าย</div><div class="stat-value" style="color:#a78bfa;font-size:24px">${fmt(tWhtTax)}</div><div class="stat-sub">บาท</div></div>
  `;

  // Recent records — both invoice and WHT, latest 5
  const rec = document.getElementById('recent-records');
  // Sort by capture_date newest first (วันที่นำเข้า ล่าสุดขึ้นก่อน)
  const lastInv = [...filtInv]
    .sort((a,b) => new Date(b.capture_date) - new Date(a.capture_date))
    .slice(0, 3);
  // WHT sort by capture_date (วันที่นำเข้า) ไม่ใช่ wht_date
  const lastWht = [...filtWht]
    .sort((a,b) => new Date(b.capture_date) - new Date(a.capture_date))
    .slice(0, 2);
  if (!lastInv.length && !lastWht.length) {
    rec.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>ยังไม่มีรายการ กดกล้องเพื่อเริ่มต้น</p></div>`;
    return;
  }
  let html = '';
  if (lastInv.length) html += `<div style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">🧾 ใบกำกับภาษีล่าสุด</div>${lastInv.map(renderInvoiceCard).join('')}`;
  if (lastWht.length) html += `<div style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin:${lastInv.length?'12':'0'}px 0 6px">📋 WHT ล่าสุด</div>${lastWht.map(renderWhtCard).join('')}`;
  rec.innerHTML = html;
}

/* ─── RECORDS ─── */
function setDocFilter(f) {
  activeDocFilter = f;
  ['all','invoice','wht'].forEach(t => {
    const btn = document.getElementById('filter-btn-' + t);
    if (btn) btn.className = t === f ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  });
  renderRecords();
}

function renderRecords() {
  const MONTHS_FULL = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  // Render company tabs
  const tabsEl = document.getElementById('records-company-tabs');
  if (tabsEl) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none';
    const mkPill = (label, id) => {
      const b = document.createElement('button');
      b.className = 'company-pill' + (activeCompany === String(id) ? ' active' : '');
      b.textContent = label;
      b.onclick = () => { activeCompany = String(id); renderRecords(); };
      return b;
    };
    wrap.appendChild(mkPill('ทั้งหมด', 'all'));
    companies.forEach(c => {
      const short = c.name.replace(/บริษัท /i,'').replace(/ จำกัด.*/i,'').trim() || c.name;
      wrap.appendChild(mkPill(short, c.id));
    });
    tabsEl.innerHTML = '';
    tabsEl.appendChild(wrap);
  }

  const el = document.getElementById('records-list');
  const filtInv = (activeDocFilter === 'wht') ? [] : invoices.filter(i =>
    activeCompany === 'all' || String(i.company_id) === activeCompany
  );
  const filtWht = (activeDocFilter === 'invoice') ? [] : whtRecords.filter(w =>
    activeCompany === 'all' || String(w.company_id) === activeCompany
  );

  if (!filtInv.length && !filtWht.length) {
    el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>ยังไม่มีรายการ</p></div>`;
    return;
  }

  const byMonth = {};
  filtInv.forEach(r => {
    const d = new Date(r.capture_date);
    const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    if (!byMonth[key]) byMonth[key] = { inv:[], wht:[] };
    byMonth[key].inv.push(r);
  });
  filtWht.forEach(r => {
    // WHT uses document date (wht_date DD/MM/YYYY) not capture date
    let key;
    if (r.wht_date) {
      const parts = r.wht_date.split('/');
      if (parts.length === 3) {
        let yr = parseInt(parts[2]); if (yr > 2500) yr -= 543;
        key = yr + '-' + parts[1].padStart(2,'0');
      }
    }
    if (!key) {
      const d = new Date(r.capture_date);
      key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    }
    if (!byMonth[key]) byMonth[key] = { inv:[], wht:[] };
    byMonth[key].wht.push(r);
  });

  el.innerHTML = Object.keys(byMonth).sort().reverse().map(key => {
    const [yr, mo] = key.split('-');
    const { inv, wht } = byMonth[key];
    const totals = [];
    if (inv.length) totals.push(`<span class="t-amt">฿ ${fmt(sum(inv,'total'))}</span><span class="t-vat">VAT ${fmt(sum(inv,'vat'))}</span>`);
    if (wht.length) totals.push(`<span style="color:var(--accent)">WHT ${fmt(sum(wht,'wht_amount'))} ฿</span>`);
    return `<div class="month-group">
      <div class="month-label">
        <span>${MONTHS_FULL[+mo-1]} ${+yr+543}</span>
        <div class="month-totals">${totals.join(' &nbsp;')}</div>
      </div>
      ${inv.length ? `<div style="font-size:11px;color:var(--text3);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.06em">🧾 ใบกำกับภาษี (${inv.length})</div>${inv.map(renderInvoiceCard).join('')}` : ''}
      ${wht.length ? `<div style="font-size:11px;color:var(--text3);margin:${inv.length?'12':'0'}px 0 6px;font-weight:600;text-transform:uppercase;letter-spacing:.06em">📋 WHT (${wht.length})</div>${wht.map(renderWhtCard).join('')}` : ''}
    </div>`;
  }).join('');
}

function renderWhtCard(w) {
  const thumb = w.image_data
    ? `<img src="${w.image_data}" class="invoice-thumb" onclick="showWhtImg(${w.id})" loading="lazy">`
    : `<div class="invoice-thumb-ph"><i class="fa-solid fa-file-invoice-dollar"></i></div>`;
  const d = new Date(w.capture_date);
  return `<div class="invoice-card">
    ${thumb}
    <div class="invoice-info">
      <div class="invoice-seller">${esc(w.payer_name||'-')}</div>
      <div class="invoice-items">${esc(w.wht_type||'')} ${esc(w.income_type||'')}</div>
      <span class="badge" style="background:var(--accent-bg);color:var(--accent);border:1px solid var(--accent)">📋 WHT</span>
      <div class="invoice-meta">
        <div class="invoice-total" style="color:var(--accent)">${fmt(w.wht_amount)} ฿</div>
        <div class="invoice-date">${w.wht_date||d.toLocaleDateString('th-TH')}</div>
      </div>
      ${uploaderLine(w)}
    </div>
  </div>`;
}


function renderInvoiceCard(inv) {
  const thumb = inv.image_data
    ? `<img src="${inv.image_data}" class="invoice-thumb" onclick="showImg(${inv.id})" loading="lazy">`
    : `<div class="invoice-thumb-ph"><i class="fa-solid fa-image"></i></div>`;
  const badge = inv.address_mismatch
    ? `<span class="badge badge-warn"><i class="fa-solid fa-triangle-exclamation"></i> ที่อยู่ไม่ตรง</span>`
    : `<span class="badge badge-ok"><i class="fa-solid fa-check"></i> ตรวจแล้ว</span>`;
  const d = new Date(inv.capture_date);
  return `<div class="invoice-card">
    ${thumb}
    <div class="invoice-info">
      <div class="invoice-seller">${esc(inv.seller_name || '-')}</div>
      <div class="invoice-items">${esc((inv.items || '').substring(0, 50))}</div>
      ${badge} ${costTypeBadge(inv.cost_type)}
      <div style="display:flex;gap:10px;margin-top:6px;flex-wrap:wrap">
        <div style="font-size:11px;color:var(--text3)">ก่อน VAT<br><span style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--text);font-weight:500">${fmt(inv.price)}</span></div>
        <div style="font-size:11px;color:var(--text3)">VAT<br><span style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--amber);font-weight:500">${fmt(inv.vat)}</span></div>
        <div style="font-size:11px;color:var(--text3)">รวมสุทธิ<br><span style="font-family:'IBM Plex Mono',monospace;font-size:14px;color:var(--green);font-weight:700">${fmt(inv.total)}</span></div>
        <div style="margin-left:auto;font-size:11px;color:var(--text3);text-align:right">${inv.invoice_date || d.toLocaleDateString('th-TH')}</div>
      </div>
      ${uploaderLine(inv)}
    </div>
  </div>`;
}

/* ─── COMPANIES ─── */
function renderCompanies() {
  const el = document.getElementById('companies-list');
  if (!companies.length) {
    el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-building"></i><p>ยังไม่มีบริษัท กดเพิ่มบริษัทเพื่อเริ่มต้น</p></div>`;
    return;
  }
  el.innerHTML = companies.map(c => `
    <div class="company-card">
      <div class="company-card-header">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="company-avatar">🏢</div>
          <div><div class="company-name">${esc(c.name)}</div><div class="company-tax">${esc(c.tax_id)}</div></div>
        </div>

      </div>
      <div class="company-address">${esc(c.address)}</div>
      ${c.branch ? `<div style="font-size:11px;color:var(--text3);margin-top:4px">📍 ${esc(c.branch)}</div>` : ''}
    </div>
  `).join('');
}

function openCompanyModal() { openModal('company-modal'); }

async function saveCompany() {
  const name = v('co-name'), tax_id = v('co-tax'), address = v('co-addr'), branch = v('co-branch');
  if (!name || !tax_id || !address) { toast('กรุณากรอกข้อมูลให้ครบ', true); return; }
  try {
    const r = await fetch('/api/companies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, tax_id, address, branch }),
    });
    const data = await r.json();
    if (!r.ok) { toast(data.error || 'เกิดข้อผิดพลาด', true); return; }
    companies.push(data);
    closeModal('company-modal');
    renderCompanies();
    toast('✓ บันทึกบริษัทสำเร็จ');
    ['co-name','co-tax','co-addr','co-branch'].forEach(id => { document.getElementById(id).value = ''; });
  } catch (e) { toast('เกิดข้อผิดพลาด', true); }
}

async function deleteCompany(id) {
  // ระบบล็อกการลบไว้ — เอกสารและข้อมูลบัญชีต้องเก็บรักษา
  toast('ระบบล็อกการลบไว้ หากจำเป็นต้องลบให้แจ้งผู้ดูแลระบบ', true);
  return;
  // eslint-disable-next-line no-unreachable
  if (!confirm('ลบบริษัทนี้?')) return;
  await fetch('/api/companies/' + id, { method: 'DELETE' });
  companies = companies.filter(c => c.id !== id);
  renderCompanies();
}

/* ─── CAPTURE ─── */
// iOS Safari: programmatically activate label by showing action sheet
// The label#nav-file-input is at body level, pointer-events:none by default
// We enable it on demand via openCaptureFromNav

// Called when user picks image via the nav camera button directly
function openCaptureModal() {
  if (!companies.length) { toast('กรุณาเพิ่มบริษัทก่อน', true); switchTab('companies'); return; }
  const pz = document.getElementById('preview-zone');
  if (pz) pz.innerHTML = `
    <i class="fa-solid fa-file-image" style="font-size:36px;margin-bottom:10px;opacity:.5"></i>
    <div style="font-size:13px;margin-bottom:16px">เลือกรูปใบกำกับภาษี</div>
    <label style="display:inline-flex;align-items:center;gap:8px;background:var(--accent);color:#fff;padding:12px 20px;border-radius:10px;cursor:pointer;font-size:14px;font-weight:500">
      <i class="fa-solid fa-upload"></i> เลือกรูปหรือถ่ายรูป
      <input type="file" accept="image/*" style="display:none" onchange="handleFileSelect(event)">
    </label>
    <div style="font-size:11px;color:var(--text3);margin-top:10px">รองรับ JPG, PNG, HEIC</div>`;
  document.getElementById('ai-result').innerHTML = '';
  document.getElementById('analyze-btn').style.display = 'none';
  document.getElementById('confirm-btn').style.display = 'none';
  currentBase64 = null; pendingRecord = null;
  openModal('capture-modal');
}


function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  toast('กำลังโหลดรูป...');
  const canvas = document.createElement('canvas');
  const img = new Image();
  const reader = new FileReader();
  reader.onload = ev => {
    img.onload = () => {
      const MAX = 1400;
      let w = img.width, h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      currentBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      const pz = document.getElementById('preview-zone');
      pz.innerHTML = `
        <img src="data:image/jpeg;base64,${currentBase64}" style="max-width:100%;max-height:200px;border-radius:8px;margin-bottom:8px">
        <div style="font-size:11px;color:var(--text2);margin-bottom:8px">✓ ${esc(file.name)}</div>
        <div style="display:flex;gap:8px">
          <label for="file-input-camera" class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0">
            <i class="fa-solid fa-rotate-right"></i> ถ่ายใหม่
          </label>
          <label for="file-input-gallery" class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0">
            <i class="fa-solid fa-images"></i> เลือกใหม่
          </label>
        </div>`;
      document.getElementById('analyze-btn').style.display = 'inline-flex';
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function analyzeInvoice() {
  if (!currentBase64) { toast('กรุณาเลือกรูปภาพก่อน', true); return; }
  const res = document.getElementById('ai-result');
  res.innerHTML = `<div class="extracted-panel"><div style="text-align:center;padding:24px"><div class="loading-dots"><span></span><span></span><span></span></div><div style="margin-top:10px;color:var(--text3);font-size:13px">AI กำลังอ่านและวิเคราะห์...</div></div></div>`;
  document.getElementById('analyze-btn').disabled = true;
  document.getElementById('confirm-btn').style.display = 'none';
  try {
    const resp = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: currentBase64 }),
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'เกิดข้อผิดพลาด');
    displayInvoiceResult(result);
  } catch (err) {
    res.innerHTML = `<div class="extracted-panel" style="text-align:center;padding:20px;color:var(--red)"><i class="fa-solid fa-circle-exclamation" style="font-size:24px;margin-bottom:8px;display:block"></i>${esc(err.message||'เกิดข้อผิดพลาด')}</div>`;
  }
  document.getElementById('analyze-btn').disabled = false;
}

function updatePendingCompany(companyId) {
  if (pendingRecord) {
    pendingRecord.company_id = companyId ? parseInt(companyId) : null;
  }
}

async function confirmRecord() {
  if (!pendingRecord) return;
  // Close status popup if open
  const sp = document.getElementById('status-popup');
  if (sp) sp.remove();
  try {
    const r = await fetch('/api/invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingRecord),
    });
    const data = await r.json();
    if (r.status === 409) {
      showDuplicateWarning(data.message, 'capture-modal');
      return;
    }
    if (r.status === 422) { toast(data.error || 'เอกสารนี้ไม่ใช่ใบกำกับภาษี', true); return; }
    if (!r.ok) { toast(data.error || 'บันทึกไม่สำเร็จ', true); return; }
    invoices.unshift(data);
    closeModal('capture-modal');
    toast('✓ บันทึกรายการสำเร็จ');
    renderDashboard();
  } catch (e) { toast('เกิดข้อผิดพลาด', true); }
}

/* ─── IMAGE VIEWER ─── */
function showImg(id) {
  const inv = invoices.find(i => i.id === id);
  if (!inv?.image_data) return;
  const d = new Date(inv.capture_date);
  document.getElementById('img-modal-body').innerHTML = `
    <img src="${inv.image_data}" style="width:100%;border-radius:8px">
    <div style="font-size:12px;color:var(--text2);margin-top:10px">
      <div>ผู้ขาย: ${esc(inv.seller_name||'-')}</div>
      <div>ถ่ายวันที่: ${d.toLocaleString('th-TH')}</div>
    </div>`;
  openModal('img-modal');
}

/* ─── DUPLICATE WARNING ─── */
function showDuplicateWarning(message, modalId) {
  // Remove existing popup
  const ex = document.getElementById('dup-popup');
  if (ex) ex.remove();

  const popup = document.createElement('div');
  popup.id = 'dup-popup';
  popup.style.cssText = 'position:fixed;inset:0;z-index:400;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.75)';
  popup.innerHTML = `
    <div style="background:var(--bg2);border:1px solid #4a1a1a;border-radius:16px;width:100%;max-width:400px;padding:24px;text-align:center">
      <div style="font-size:48px;margin-bottom:12px">🔴</div>
      <div style="font-weight:700;font-size:17px;color:var(--red);margin-bottom:10px">เอกสารซ้ำ!</div>
      <div style="font-size:14px;color:var(--text2);margin-bottom:20px;line-height:1.7;background:var(--red-bg);border:1px solid #4a1a1a;border-radius:10px;padding:12px">
        ${esc(message)}<br>
        <span style="font-size:12px;color:var(--text3);margin-top:4px;display:block">ระบบไม่บันทึกเอกสารซ้ำ</span>
      </div>
      <button onclick="document.getElementById('dup-popup').remove()" class="btn btn-ghost" style="width:100%">
        ปิด
      </button>
    </div>`;
  document.body.appendChild(popup);
  popup.onclick = e => { if (e.target === popup) popup.remove(); };
}

/* ─── เอกสารไม่ใช่ใบกำกับภาษี ─── */
function showNotTaxInvoice(ex, company, docTitle) {
  const existing = document.getElementById('status-popup');
  if (existing) existing.remove();

  const row = (k, v) => `<div class="field-row"><span class="field-key">${k}</span><span class="field-val">${esc(v || '-')}</span></div>`;

  const popup = document.createElement('div');
  popup.id = 'status-popup';
  popup.style.cssText = 'position:fixed;inset:0;z-index:300;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.65)';
  popup.innerHTML = `
    <div style="background:var(--bg2);border:1px solid #4a1a1a;border-radius:20px 20px 0 0;width:100%;max-width:600px;padding:20px;padding-bottom:max(20px,env(safe-area-inset-bottom));animation:slideUp .25s ease">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="font-size:26px">🚫</div>
        <div>
          <div style="font-weight:700;font-size:16px;color:var(--red)">ใช้ในระบบภาษีไม่ได้</div>
          <div style="font-size:12px;color:var(--text2)">เอกสารนี้ไม่ใช่ใบกำกับภาษี — ไม่บันทึก</div>
        </div>
        <button onclick="document.getElementById('status-popup').remove()" style="margin-left:auto;background:none;border:none;color:var(--text2);font-size:20px;cursor:pointer;padding:4px">✕</button>
      </div>

      <div style="background:var(--red-bg);border:1px solid #4a1a1a;border-radius:10px;padding:12px;font-size:13px;color:var(--text);line-height:1.7;margin-bottom:12px">
        อ่านหัวเอกสารได้ว่า <b style="color:var(--red)">${esc(docTitle || 'ไม่ใช่ใบกำกับภาษี')}</b><br>
        <span style="font-size:12px;color:var(--text2)">เอกสารประเภทใบแจ้งหนี้ ใบวางบิล ใบส่งสินค้า และใบเสนอราคา นำมาเคลมภาษีซื้อไม่ได้ แม้จะมีบรรทัด VAT 7% ก็ตาม — ต้องขอ<b>ใบกำกับภาษี</b>จากผู้ขายเมื่อชำระเงินแล้ว</span>
      </div>

      <div class="extracted-section" style="margin-bottom:6px">
        <div class="extracted-section-title">ข้อมูลที่อ่านได้จากเอกสาร</div>
        ${row('ผู้ขาย', ex.sellerName)}
        ${row('เลขภาษีผู้ขาย', ex.sellerTax)}
        ${row('ผู้ซื้อ', ex.buyerName)}
        ${row('เลขภาษีผู้ซื้อ', ex.buyerTax)}
        ${row('ยอดรวม', ex.total ? fmt(ex.total) + ' ฿' : '')}
        ${row('VAT', ex.vat ? fmt(ex.vat) + ' ฿' : '')}
        ${row('วันที่', ex.invoiceDate)}
        ${company ? row('ตรงกับบริษัท', company.name) : ''}
      </div>

      <button onclick="document.getElementById('status-popup').remove();closeModal('capture-modal')" class="btn btn-ghost" style="width:100%;margin-top:12px">เข้าใจแล้ว</button>
    </div>`;
  document.body.appendChild(popup);

  const cb = document.getElementById('confirm-btn');
  if (cb) cb.style.display = 'none';
}

/* ─── STATUS POPUP ─── */
function showInvoiceStatus(ex, company, addrOk, taxOk, nameOk, result={}) {
  // เอกสารที่ไม่ใช่ใบกำกับภาษี (ใบแจ้งหนี้/ใบส่งสินค้า/ใบเสนอราคา) เคลม VAT ไม่ได้ → ไม่ให้บันทึก
  if (result.isTaxInvoice === false) {
    showNotTaxInvoice(ex, company, result.docTitle);
    return;
  }

  const issues = [];
  const ok = [];

  if (!company) {
    issues.push({ icon: '🏢', text: 'ไม่พบบริษัทที่ตรงกัน — กรุณาเลือกบริษัทเอง', level: 'error' });
  } else {
    if (nameOk) ok.push('ชื่อบริษัทตรงกัน ✓');
    else issues.push({ icon: '🏢', text: `ชื่อบริษัทไม่ตรง: อ่านได้ "${ex.buyerName||'-'}"`, level: 'warn' });

    if (taxOk) ok.push('เลขภาษีตรงกัน ✓');
    else issues.push({ icon: '🔢', text: `เลขภาษีไม่ตรง: อ่านได้ "${ex.buyerTax||'-'}"`, level: 'warn' });

    if (!addrOk && ex.buyerAddress) {
      issues.push({ icon: '📍', text: 'ที่อยู่ไม่ตรงกับในระบบ จะบันทึกพร้อมหมายเหตุ', level: 'warn' });
    } else if (addrOk) {
      ok.push(result && result.addressCorrected ? 'ที่อยู่ตรงกัน (ปรับอัตโนมัติ) ✓' : 'ที่อยู่ตรงกัน ✓');
    }
  }

  if (!ex.total || ex.total === '') issues.push({ icon: '💰', text: 'ไม่พบยอดเงินรวม — กรุณาตรวจสอบ', level: 'error' });
  if (!ex.invoiceDate) issues.push({ icon: '📅', text: 'ไม่พบวันที่ในใบกำกับ', level: 'warn' });
  if (!ex.sellerName) issues.push({ icon: '🏪', text: 'ไม่พบชื่อผู้ขาย', level: 'warn' });
  if (!ex.vat || ex.vat === '') issues.push({ icon: '🧾', text: 'ไม่พบยอด VAT — อาจไม่มี VAT ในใบนี้', level: 'info' });

  // Build popup HTML
  const hasError = issues.some(i => i.level === 'error');
  const hasWarn = issues.some(i => i.level === 'warn');
  const statusColor = hasError ? 'var(--red)' : hasWarn ? 'var(--amber)' : 'var(--green)';
  const statusBg = hasError ? 'var(--red-bg)' : hasWarn ? 'var(--amber-bg)' : 'var(--green-bg)';
  const statusBorder = hasError ? '#4a1a1a' : hasWarn ? '#4a3a10' : '#1a4a30';
  const statusIcon = hasError ? '❌' : hasWarn ? '⚠️' : '✅';
  const statusTitle = hasError ? 'พบข้อมูลที่ต้องแก้ไข' : hasWarn ? 'พบข้อมูลที่ควรตรวจสอบ' : 'อ่านข้อมูลสำเร็จ';

  const issueHTML = issues.map(i => {
    const c = i.level === 'error' ? 'var(--red)' : i.level === 'warn' ? 'var(--amber)' : 'var(--accent)';
    return `<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px">
      <span>${i.icon}</span>
      <span style="color:${c}">${esc(i.text)}</span>
    </div>`;
  }).join('');

  const okHTML = ok.length ? `<div style="font-size:11px;color:var(--green);margin-top:6px">${ok.map(t=>'✓ '+t).join(' &nbsp; ')}</div>` : '';

  // Show as overlay popup
  const existing = document.getElementById('status-popup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'status-popup';
  popup.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;z-index:300;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.6);padding:0`;
  popup.innerHTML = `
    <div style="background:var(--bg2);border:1px solid ${statusBorder};border-radius:20px 20px 0 0;width:100%;max-width:600px;padding:20px;padding-bottom:max(20px,env(safe-area-inset-bottom));animation:slideUp .25s ease">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="font-size:24px">${statusIcon}</div>
        <div>
          <div style="font-weight:600;font-size:15px;color:${statusColor}">${statusTitle}</div>
          ${company ? `<div style="font-size:12px;color:var(--text2)">บันทึกเข้า: ${esc(company.name)}</div>` : ''}
        </div>
        <button onclick="document.getElementById('status-popup').remove()" style="margin-left:auto;background:none;border:none;color:var(--text2);font-size:20px;cursor:pointer;padding:4px">✕</button>
      </div>
      ${issueHTML}
      ${okHTML}
      <div style="display:flex;gap:8px;margin-top:14px">
        <button onclick="document.getElementById('status-popup').remove()" class="btn btn-ghost" style="flex:1">ตรวจสอบอีกครั้ง</button>
        <button onclick="document.getElementById('status-popup').remove();confirmRecord()" class="btn btn-success" style="flex:1"><i class="fa-solid fa-check"></i> ยืนยันบันทึก</button>
      </div>
    </div>`;
  document.body.appendChild(popup);

  // Hide the old confirm button since popup has its own
  document.getElementById('confirm-btn').style.display = 'none';
}

/* ─── UTILS ─── */
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function v(id) { return document.getElementById(id)?.value?.trim() || ''; }
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function sum(arr, key) { return arr.reduce((s, r) => s + (parseFloat(r[key]) || 0), 0); }
function fmt(n) {
  if (n === null || n === undefined || n === '') return '-';
  const v = parseFloat(n); if (isNaN(v)) return '-';
  return v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
let toastTimer;
function toast(msg, err = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = err ? 'var(--red-bg)' : 'var(--card2)';
  el.style.color = err ? 'var(--red)' : 'var(--text)';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// Close modals on backdrop click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
});

// ── Global camera button handler ──
function showCameraSheet() {
  if (!companies.length) { toast('กรุณาเพิ่มบริษัทก่อน', true); switchTab('companies'); return; }
  // Reset inputs so same file can be re-selected
  const c = document.getElementById('sheet-input-camera');
  const g = document.getElementById('sheet-input-gallery');
  if (c) c.value = '';
  if (g) g.value = '';
  document.getElementById('camera-sheet').style.display = 'block';
}
function hideCameraSheet() {
  document.getElementById('camera-sheet').style.display = 'none';
}

function handleGlobalFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('camera-sheet').style.display = 'none';
  if (!companies.length) { toast('กรุณาเพิ่มบริษัทก่อน', true); switchTab('companies'); return; }

  // Show loading overlay while AI detects doc type
  showAutoDetectOverlay();

  const canvas = document.createElement('canvas');
  const img = new Image();
  const reader = new FileReader();
  reader.onload = ev => {
    img.onload = async () => {
      const MAX = 1400;
      let w = img.width, h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const b64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

      try {
        // Call analyze API — AI detects docType automatically
        const resp = await fetch('/api/analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: b64 }),
        });
        const result = await resp.json();
        hideAutoDetectOverlay();
        if (!resp.ok) { toast(result.error || 'เกิดข้อผิดพลาด', true); return; }

        if (result.docType === 'wht') {
          // Route to WHT modal with result pre-loaded
          whtBase64 = b64;
          openModal('wht-modal');
          renderWhtResult(result, b64, file.name);
        } else {
          // Route to invoice modal with result pre-loaded
          currentBase64 = b64;
          openModal('capture-modal');
          renderInvoiceResult(result, b64, file.name);
        }
      } catch(err) {
        hideAutoDetectOverlay();
        toast('เกิดข้อผิดพลาด: ' + err.message, true);
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function showAutoDetectOverlay() {
  const el = document.createElement('div');
  el.id = 'auto-detect-overlay';
  el.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,.8);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px';
  el.innerHTML = `
    <div class="loading-dots"><span></span><span></span><span></span></div>
    <div style="color:var(--text2);font-size:14px">AI กำลังวิเคราะห์เอกสาร...</div>
    <div style="color:var(--text3);font-size:12px">ตรวจสอบประเภทและดึงข้อมูล</div>`;
  document.body.appendChild(el);
}

function hideAutoDetectOverlay() {
  const el = document.getElementById('auto-detect-overlay');
  if (el) el.remove();
}

function renderInvoiceResult(result, b64, filename) {
  const ex = result.extracted;
  const company = result.matchedCompany;

  // Update preview zone
  const pz = document.getElementById('preview-zone');
  if (pz) pz.innerHTML = `
    <img src="data:image/jpeg;base64,${b64}" style="max-width:100%;max-height:200px;border-radius:8px;margin-bottom:8px">
    <div style="font-size:11px;color:var(--text2);margin-bottom:8px">✓ ${esc(filename)}</div>
    <label style="display:inline-flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--border);color:var(--text2);padding:8px 14px;border-radius:8px;cursor:pointer;font-size:12px">
      <i class="fa-solid fa-rotate-right"></i> เลือกใหม่
      <input type="file" accept="image/*" style="display:none" onchange="handleFileSelect(event)">
    </label>`;

  // Show result directly
  document.getElementById('analyze-btn').style.display = 'none';
  document.getElementById('confirm-btn').style.display = 'none';
  document.getElementById('ai-result').innerHTML = '';

  // Reuse analyzeInvoice display logic by setting state and calling render
  currentBase64 = b64;
  pendingRecord = null;

  // Trigger the display with pre-fetched result
  displayInvoiceResult(result);
}

function renderWhtResult(result, b64, filename) {
  const pz = document.getElementById('wht-preview-zone');
  if (pz) pz.innerHTML = `
    <img src="data:image/jpeg;base64,${b64}" style="max-width:100%;max-height:200px;border-radius:8px;margin-bottom:8px">
    <div style="font-size:11px;color:var(--text2);margin-bottom:8px">✓ ${esc(filename)}</div>
    <label style="display:inline-flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--border);color:var(--text2);padding:8px 14px;border-radius:8px;cursor:pointer;font-size:12px">
      <i class="fa-solid fa-rotate-right"></i> เลือกใหม่
      <input type="file" accept="image/*" style="display:none" onchange="handleWhtFileSelect(event)">
    </label>`;
  document.getElementById('wht-analyze-btn').style.display = 'none';
  whtBase64 = b64;
  pendingWht = null;
  displayWhtResult(result);
}

// Register SW + init
init();

/* ─── WHT MODULE ─── */
let whtRecords = [];
let whtBase64 = null;
let pendingWht = null;
let activeWhtCompany = 'all';

async function fetchWht() {
  try {
    const r = await fetch('/api/wht');
    if (r.ok) whtRecords = await r.json();
  } catch(e) { console.error(e); }
}

function openWhtModal() {
  if (!companies.length) { toast('กรุณาเพิ่มบริษัทก่อน', true); switchTab('companies'); return; }
  document.getElementById('wht-preview-zone').innerHTML = `
    <i class="fa-solid fa-file-invoice-dollar" style="font-size:36px;margin-bottom:10px;opacity:.5"></i>
    <div style="font-size:13px;margin-bottom:16px">เลือกรูปใบหัก ณ ที่จ่าย</div>
    <label style="display:inline-flex;align-items:center;gap:8px;background:var(--accent);color:#fff;padding:12px 20px;border-radius:10px;cursor:pointer;font-size:14px;font-weight:500">
      <i class="fa-solid fa-upload"></i> เลือกรูปหรือถ่ายรูป
      <input type="file" accept="image/*" style="display:none" onchange="handleWhtFileSelect(event)">
    </label>`;
  document.getElementById('wht-ai-result').innerHTML = '';
  document.getElementById('wht-analyze-btn').style.display = 'none';
  document.getElementById('wht-confirm-btn').style.display = 'none';
  whtBase64 = null; pendingWht = null;
  openModal('wht-modal');
}

function handleWhtFileSelect(e) {
  const file = e.target.files[0]; if (!file) return;
  toast('กำลังโหลดรูป...');
  const canvas = document.createElement('canvas');
  const img = new Image();
  const reader = new FileReader();
  reader.onload = ev => {
    img.onload = () => {
      const MAX = 1400;
      let w = img.width, h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      whtBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      const pz = document.getElementById('wht-preview-zone');
      pz.innerHTML = `
        <img src="data:image/jpeg;base64,${whtBase64}" style="max-width:100%;max-height:200px;border-radius:8px;margin-bottom:8px">
        <div style="font-size:11px;color:var(--text2);margin-bottom:8px">✓ ${esc(file.name)}</div>
        <label style="display:inline-flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--border);color:var(--text2);padding:8px 14px;border-radius:8px;cursor:pointer;font-size:12px">
          <i class="fa-solid fa-rotate-right"></i> เลือกใหม่
          <input type="file" accept="image/*" style="display:none" onchange="handleWhtFileSelect(event)">
        </label>`;
      document.getElementById('wht-analyze-btn').style.display = 'inline-flex';
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function analyzeWht() {
  if (!whtBase64) { toast('กรุณาเลือกรูปก่อน', true); return; }
  const res = document.getElementById('wht-ai-result');
  res.innerHTML = `<div class="extracted-panel"><div style="text-align:center;padding:24px"><div class="loading-dots"><span></span><span></span><span></span></div><div style="margin-top:10px;color:var(--text3);font-size:13px">AI กำลังอ่านใบหัก ณ ที่จ่าย...</div></div></div>`;
  document.getElementById('wht-analyze-btn').disabled = true;
  document.getElementById('wht-confirm-btn').style.display = 'none';
  try {
    const resp = await fetch('/api/analyze-wht', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: whtBase64 }),
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'เกิดข้อผิดพลาด');
    const ex = result.extracted;
    const company = result.matchedCompany;

    // Date check > 6 months
    if (ex.whtDate) {
      const parts = ex.whtDate.split('/');
      if (parts.length === 3) {
        let yr = parseInt(parts[2]); if (yr > 2500) yr -= 543;
        const dt = new Date(yr, parseInt(parts[1])-1, parseInt(parts[0]));
        const diff = (new Date().getFullYear() - dt.getFullYear())*12 + (new Date().getMonth() - dt.getMonth());
        if (diff > 6) {
          res.innerHTML = `<div class="extracted-panel" style="text-align:center;padding:24px">
            <div style="font-size:40px;margin-bottom:10px">⚠️</div>
            <div style="font-weight:600;font-size:16px;color:var(--amber);margin-bottom:8px">เอกสารมีอายุเกิน 6 เดือน</div>
            <div style="font-size:13px;color:var(--text2)">วันที่: <strong>${esc(ex.whtDate)}</strong> — ผ่านมา <strong style="color:var(--amber)">${diff} เดือน</strong></div>
            <div style="background:var(--amber-bg);border:1px solid var(--amber);border-radius:10px;padding:12px;font-size:13px;color:var(--amber);margin-top:12px">ไม่สามารถบันทึกได้</div>
          </div>`;
          document.getElementById('wht-analyze-btn').disabled = false;
          return;
        }
      }
    }

    const coOptions = result.userCompanies.map(c =>
      `<option value="${c.id}" ${company && c.id===company.id ? 'selected':''}>${c.name}</option>`
    ).join('');

    const matchBadge = company
      ? `<span style="background:var(--green-bg);color:var(--green);border:1px solid #1a4a30;padding:2px 8px;border-radius:10px;font-size:10px">✓ จับคู่อัตโนมัติ</span>`
      : `<span style="background:var(--amber-bg);color:var(--amber);border:1px solid #4a3a10;padding:2px 8px;border-radius:10px;font-size:10px">⚠ เลือกบริษัทเอง</span>`;

    pendingWht = {
      company_id: company ? company.id : null,
      payer_name: ex.payerName, payer_tax: ex.payerTax,
      payee_name: ex.payeeName, payee_tax: ex.payeeTax,
      wht_type: ex.whtType, income_type: ex.incomeType,
      income_amount: ex.incomeAmount, wht_rate: ex.whtRate,
      wht_amount: ex.whtAmount, wht_date: ex.whtDate,
      image_data: 'data:image/jpeg;base64,' + whtBase64,
    };

    res.innerHTML = `<div class="extracted-panel">
      <div class="extracted-section">
        <div class="extracted-section-title">บันทึกเข้าบริษัท ${matchBadge}</div>
        <select class="form-input" id="wht-company-sel" onchange="pendingWht.company_id=this.value?parseInt(this.value):null" style="margin-top:6px">
          <option value="">-- เลือกบริษัท --</option>${coOptions}
        </select>
      </div>
      <div class="extracted-section">
        <div class="extracted-section-title">ผู้จ่ายเงิน (ที่หักภาษี)</div>
        <div class="field-row"><span class="field-key">ชื่อ</span><span class="field-val">${esc(ex.payerName||'-')}</span></div>
        <div class="field-row"><span class="field-key">เลขภาษี</span><span class="field-val mono">${esc(ex.payerTax||'-')}</span></div>
      </div>
      <div class="extracted-section">
        <div class="extracted-section-title">ผู้รับเงิน (ถูกหักภาษี)</div>
        <div class="field-row"><span class="field-key">ชื่อ</span><span class="field-val green">${esc(ex.payeeName||'-')}</span></div>
        <div class="field-row"><span class="field-key">เลขภาษี</span><span class="field-val mono">${esc(ex.payeeTax||'-')}</span></div>
      </div>
      <div class="extracted-section">
        <div class="extracted-section-title">รายละเอียด WHT</div>
        <div class="field-row"><span class="field-key">ประเภทเอกสาร</span><span class="field-val">${esc(ex.whtType||'-')}</span></div>
        <div class="field-row"><span class="field-key">ประเภทเงินได้</span><span class="field-val">${esc(ex.incomeType||'-')}</span></div>
        <div class="field-row"><span class="field-key">ยอดเงินได้</span><span class="field-val mono">${fmt(ex.incomeAmount)} ฿</span></div>
        <div class="field-row"><span class="field-key">อัตราภาษี</span><span class="field-val mono" style="color:var(--amber)">${ex.whtRate||'-'} %</span></div>
        <div class="field-row"><span class="field-key">ยอดภาษีหัก ณ ที่จ่าย</span><span class="field-val mono green" style="font-size:16px;font-weight:600">${fmt(ex.whtAmount)} ฿</span></div>
        <div class="field-row"><span class="field-key">วันที่เอกสาร</span><span class="field-val">${esc(ex.whtDate||'-')}</span></div>
      </div>
    </div>`;
    document.getElementById('wht-confirm-btn').style.display = 'inline-flex';
  } catch(err) {
    res.innerHTML = `<div class="extracted-panel" style="text-align:center;padding:20px;color:var(--red)"><i class="fa-solid fa-circle-exclamation" style="font-size:24px;margin-bottom:8px;display:block"></i>${esc(err.message)}</div>`;
  }
  document.getElementById('wht-analyze-btn').disabled = false;
}

async function confirmWht() {
  if (!pendingWht) return;
  try {
    const r = await fetch('/api/wht', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingWht),
    });
    const data = await r.json();
    if (r.status === 409) {
      showDuplicateWarning(data.message, 'wht-modal');
      return;
    }
    if (!r.ok) { toast(data.error || 'บันทึกไม่สำเร็จ', true); return; }
    whtRecords.unshift(data);
    closeModal('wht-modal');
    toast('✓ บันทึก WHT สำเร็จ');
    renderWht();
  } catch(e) { toast('เกิดข้อผิดพลาด', true); }
}

function renderReport() {
  renderWht();
  populateMonthSelector();
}

function renderWht() {
  renderCompanyBar('wht-company-bar', activeWhtCompany, id => { activeWhtCompany = id; renderWht(); });
  populateMonthSelector();
  const filtered = whtRecords.filter(w => activeWhtCompany === 'all' || String(w.company_id) === activeWhtCompany);
  const el = document.getElementById('wht-list');
  if (!filtered.length) { el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-file-invoice-dollar"></i><p>ยังไม่มีรายการ WHT</p></div>`; return; }

  const byMonth = {};
  filtered.forEach(w => {
    // WHT uses document date (wht_date) for month grouping
    let key;
    if (w.wht_date) {
      const parts = w.wht_date.split('/');
      if (parts.length === 3) {
        let yr = parseInt(parts[2]); if (yr > 2500) yr -= 543;
        key = yr + '-' + parts[1].padStart(2,'0');
      }
    }
    if (!key) {
      const d = new Date(w.capture_date);
      key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    }
    (byMonth[key] = byMonth[key] || []).push(w);
  });
  const MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  el.innerHTML = Object.keys(byMonth).sort().reverse().map(key => {
    const [yr, mo] = key.split('-');
    const rows = byMonth[key];
    const tIncome = sum(rows, 'income_amount');
    const tWht = sum(rows, 'wht_amount');
    return `<div class="month-group">
      <div class="month-label">
        <span>${MONTHS[+mo-1]} ${+yr+543}</span>
        <div class="month-totals">
          <span class="t-amt">รายได้ ${fmt(tIncome)} ฿</span>
          <span class="t-vat">WHT ${fmt(tWht)} ฿</span>
        </div>
      </div>
      ${rows.map(w => {
        const thumb = w.image_data
          ? `<img src="${w.image_data}" class="invoice-thumb" onclick="showWhtImg(${w.id})" loading="lazy">`
          : `<div class="invoice-thumb-ph"><i class="fa-solid fa-file-invoice-dollar"></i></div>`;
        const d = new Date(w.capture_date);
        return `<div class="invoice-card">
          ${thumb}
          <div class="invoice-info">
            <div class="invoice-seller">${esc(w.payer_name||'-')}</div>
            <div class="invoice-items">${esc(w.wht_type||'')} ${esc(w.income_type||'')}</div>
            <span class="badge badge-ok"><i class="fa-solid fa-file-invoice-dollar"></i> WHT</span>
            <div class="invoice-meta">
              <div class="invoice-total" style="color:var(--accent)">${fmt(w.wht_amount)} ฿</div>
              <div class="invoice-date">${w.wht_date||d.toLocaleDateString('th-TH')}</div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

function showWhtImg(id) {
  const w = whtRecords.find(x => x.id === id);
  if (!w?.image_data) return;
  document.getElementById('img-modal-body').innerHTML = `
    <img src="${w.image_data}" style="width:100%;border-radius:8px">
    <div style="font-size:12px;color:var(--text2);margin-top:10px">
      <div>ผู้จ่าย: ${esc(w.payer_name||'-')}</div>
      <div>วันที่: ${new Date(w.capture_date).toLocaleString('th-TH')}</div>
    </div>`;
  openModal('img-modal');
}

/* ─── EXCEL DOWNLOAD ─── */
function populateMonthSelector() {
  const sel = document.getElementById('excel-month-sel');
  if (!sel) return;
  const months = new Set();
  // Always include current month
  const now = new Date();
  months.add(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  [...invoices, ...whtRecords].forEach(r => {
    const d = new Date(r.capture_date);
    months.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  });
  const MONTHS_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const current = sel.value;
  sel.innerHTML = '<option value="">ทุกเดือน</option>';
  [...months].sort().reverse().forEach(key => {
    const [yr, mo] = key.split('-');
    sel.innerHTML += `<option value="${key}" ${key===current?'selected':''}>${MONTHS_TH[+mo-1]} ${+yr+543}</option>`;
  });
}

async function downloadExcel(type) {
  try {
    const month = document.getElementById('excel-month-sel')?.value || '';
    const coId = activeWhtCompany !== 'all' ? activeWhtCompany : '';
    const params = new URLSearchParams({ type });
    if (month) params.append('month', month);
    if (coId) params.append('company_id', coId);

    toast('กำลังสร้างไฟล์...');

    const r = await fetch('/api/export/excel?' + params);
    const data = await r.json();
    if (!r.ok) { toast(data.error || 'เกิดข้อผิดพลาด', true); return; }

    const hasInv = data.invoices?.length > 0;
    const hasWht = data.wht?.length > 0;
    if (!hasInv && !hasWht) { toast('ไม่มีข้อมูลในช่วงเวลานี้', true); return; }

    const monthLabel = month || 'ทั้งหมด';

    // Use SheetJS to generate real .xlsx
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
    const wb = XLSX.utils.book_new();

    if (hasInv && (type === 'invoice' || type === 'all')) {
      const ws = XLSX.utils.json_to_sheet(data.invoices);
      // Set column widths
      ws['!cols'] = [{wch:14},{wch:14},{wch:30},{wch:16},{wch:30},{wch:16},{wch:20},{wch:14},{wch:14},{wch:14}];
      XLSX.utils.book_append_sheet(wb, ws, 'ใบกำกับภาษี');
    }
    if (hasWht && (type === 'wht' || type === 'all')) {
      const ws = XLSX.utils.json_to_sheet(data.wht);
      ws['!cols'] = [{wch:14},{wch:14},{wch:30},{wch:16},{wch:14},{wch:20},{wch:14},{wch:12},{wch:16},{wch:20}];
      XLSX.utils.book_append_sheet(wb, ws, 'WHT หัก ณ ที่จ่าย');
    }

    const filename = `Tax_Report_${monthLabel}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast(`✓ ดาวน์โหลด ${filename} สำเร็จ`);
  } catch(e) {
    console.error(e);
    toast('เกิดข้อผิดพลาด: ' + e.message, true);
  }
}

/* ─── COST TYPE HELPERS ─── */
const COST_TYPE_CONFIG = {
  'COGS':  { label: 'COGS ต้นทุนขาย',        color: '#f97316', bg: '#2a1500', border: '#7c3510' },
  'OPEX':  { label: 'OPEX ดำเนินงาน',         color: '#38bdf8', bg: '#0a1f2a', border: '#0e4a6a' },
  'CAPEX': { label: 'CAPEX สินทรัพย์',        color: '#a78bfa', bg: '#1a0f2a', border: '#4a2a7a' },
  'OTHER': { label: 'OTHER ไม่ระบุ',           color: '#6b75a0', bg: '#1a1e2e', border: '#3a4060' },
};

function costTypeBadge(costType) {
  if (!costType) return '';
  const cfg = COST_TYPE_CONFIG[costType] || COST_TYPE_CONFIG['OTHER'];
  return `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.border}">${cfg.label}</span>`;
}

/* ─── SHARED DISPLAY FUNCTIONS ─── */
function displayInvoiceResult(result) {
  const ex = result.extracted;
  const company = result.matchedCompany;
  const res = document.getElementById('ai-result');

  const addrOk = result.addressCorrected || (company && ex.buyerAddress === company.address);
  const taxOk = company && (ex.buyerTax||'').replace(/\D/g,'') === (company.tax_id||'').replace(/\D/g,'');
  const nameOk = company && ex.buyerName && (
    ex.buyerName.includes(company.name.slice(0,8)) || company.name.includes((ex.buyerName||'').slice(0,8))
  );
  const addrNote = result.addressCorrected ? '(ปรับข้อมูลเป็นของระบบอัตโนมัติ)' : '';

  // Date check > 6 months
  if (ex.invoiceDate) {
    const parts = ex.invoiceDate.split('/');
    if (parts.length === 3) {
      let yr = parseInt(parts[2]); if (yr > 2500) yr -= 543;
      const dt = new Date(yr, parseInt(parts[1])-1, parseInt(parts[0]));
      const diff = (new Date().getFullYear()-dt.getFullYear())*12+(new Date().getMonth()-dt.getMonth());
      if (diff > 6) {
        res.innerHTML = `<div class="extracted-panel" style="text-align:center;padding:24px">
          <div style="font-size:40px;margin-bottom:10px">⚠️</div>
          <div style="font-weight:600;font-size:16px;color:var(--amber);margin-bottom:8px">ใบกำกับภาษีมีอายุเกิน 6 เดือน</div>
          <div style="font-size:13px;color:var(--text2);margin-bottom:4px">วันที่ในบิล: <strong style="color:var(--text)">${esc(ex.invoiceDate)}</strong></div>
          <div style="font-size:13px;color:var(--text2);margin-bottom:16px">ผ่านมาแล้ว <strong style="color:var(--amber)">${diff} เดือน</strong></div>
          <div style="background:var(--amber-bg);border:1px solid var(--amber);border-radius:10px;padding:12px;font-size:13px;color:var(--amber)">ไม่สามารถบันทึกได้</div>
        </div>`;
        return;
      }
    }
  }

  const coOptions = result.userCompanies.map(c =>
    `<option value="${c.id}" ${company && c.id===company.id?'selected':''}>${c.name}</option>`
  ).join('');
  const matchBadge = company
    ? `<span style="background:var(--green-bg);color:var(--green);border:1px solid #1a4a30;padding:2px 8px;border-radius:10px;font-size:10px">✓ จับคู่อัตโนมัติ</span>`
    : `<span style="background:var(--amber-bg);color:var(--amber);border:1px solid #4a3a10;padding:2px 8px;border-radius:10px;font-size:10px">⚠ เลือกบริษัทเอง</span>`;

  pendingRecord = {
    company_id: company ? company.id : null,
    seller_name: ex.sellerName, seller_tax: ex.sellerTax,
    buyer_name: ex.buyerName, buyer_tax: ex.buyerTax,
    buyer_address: ex.buyerAddress, buyer_branch: ex.buyerBranch,
    items: ex.items, price: ex.price, vat: ex.vat, total: ex.total,
    invoice_date: ex.invoiceDate,
    image_data: 'data:image/jpeg;base64,' + currentBase64,
    address_mismatch: !addrOk && !!ex.buyerAddress,
    cost_type: ex.costType || 'OTHER',
  };

  res.innerHTML = `<div class="extracted-panel">
    <div class="extracted-section">
      <div class="extracted-section-title">บันทึกเข้าบริษัท ${matchBadge}</div>
      <select class="form-input" id="matched-company-sel" onchange="updatePendingCompany(this.value)" style="margin-top:6px">
        <option value="">-- เลือกบริษัท --</option>${coOptions}
      </select>
    </div>
    <div class="extracted-section">
      <div class="extracted-section-title">ผู้ขาย</div>
      <div class="field-row"><span class="field-key">ชื่อ</span><span class="field-val">${esc(ex.sellerName||'-')}</span></div>
      <div class="field-row"><span class="field-key">เลขภาษี</span><span class="field-val mono">${esc(ex.sellerTax||'-')}</span></div>
    </div>
    <div class="extracted-section">
      <div class="extracted-section-title">ผู้ซื้อในใบกำกับ</div>
      <div class="field-row"><span class="field-key">ชื่อ</span><span class="field-val ${nameOk?'green':''}">${esc(ex.buyerName||'-')}</span></div>
      <div class="field-row"><span class="field-key">เลขภาษี</span><span class="field-val mono ${taxOk?'green':''}">${esc(ex.buyerTax||'-')}</span></div>
      <div class="field-row"><span class="field-key">ที่อยู่</span><span class="field-val green">${esc((ex.buyerAddress||'-').slice(0,60))} <span style="font-size:10px;color:var(--text3)">${addrNote}</span></span></div>
    </div>
    <div class="extracted-section">
      <div class="extracted-section-title">ประเภทต้นทุน (คาดการณ์)</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
        ${costTypeBadge(ex.costType)}
        <select class="form-input" style="flex:1;font-size:12px" onchange="pendingRecord.cost_type=this.value">
          <option value="COGS" ${ex.costType==='COGS'?'selected':''}>COGS — ต้นทุนขาย</option>
          <option value="OPEX" ${ex.costType==='OPEX'?'selected':''}>OPEX — ค่าใช้จ่ายดำเนินงาน</option>
          <option value="CAPEX" ${ex.costType==='CAPEX'?'selected':''}>CAPEX — สินทรัพย์ถาวร</option>
          <option value="OTHER" ${(!ex.costType||ex.costType==='OTHER')?'selected':''}>OTHER — ไม่ระบุ</option>
        </select>
      </div>
    </div>
    <div class="extracted-section">
      <div class="extracted-section-title">ยอดเงิน</div>
      ${ex.items?`<div class="field-row"><span class="field-key">รายการ</span><span class="field-val" style="font-size:11px">${esc(ex.items.slice(0,60))}</span></div>`:''}
      <div class="field-row"><span class="field-key">ก่อน VAT</span><span class="field-val mono">${fmt(ex.price)} ฿</span></div>
      <div class="field-row"><span class="field-key">VAT</span><span class="field-val mono" style="color:var(--amber)">${fmt(ex.vat)} ฿</span></div>
      <div class="field-row"><span class="field-key">รวมสุทธิ</span><span class="field-val mono green" style="font-size:16px;font-weight:600">${fmt(ex.total)} ฿</span></div>
      <div class="field-row"><span class="field-key">วันที่บิล</span><span class="field-val">${esc(ex.invoiceDate||'-')}</span></div>
    </div>
    ${!addrOk && ex.buyerAddress ? `<div style="background:var(--amber-bg);border:1px solid var(--amber);border-radius:8px;padding:10px;font-size:12px;color:var(--amber);margin-top:4px">⚠️ ที่อยู่ไม่ตรง — จะบันทึกพร้อมหมายเหตุ</div>` : ''}
  </div>`;

  if (pendingRecord) {
    pendingRecord.is_tax_invoice = result.isTaxInvoice !== false;
    pendingRecord.doc_title = result.docTitle || '';
  }

  showInvoiceStatus(ex, company, addrOk, taxOk, nameOk, result);
}

function displayWhtResult(result) {
  const ex = result.extracted;
  const company = result.matchedCompany;
  const res = document.getElementById('wht-ai-result');

  // Date check > 6 months
  if (ex.whtDate) {
    const parts = ex.whtDate.split('/');
    if (parts.length === 3) {
      let yr = parseInt(parts[2]); if (yr > 2500) yr -= 543;
      const dt = new Date(yr, parseInt(parts[1])-1, parseInt(parts[0]));
      const diff = (new Date().getFullYear()-dt.getFullYear())*12+(new Date().getMonth()-dt.getMonth());
      if (diff > 6) {
        res.innerHTML = `<div class="extracted-panel" style="text-align:center;padding:24px">
          <div style="font-size:40px;margin-bottom:10px">⚠️</div>
          <div style="font-weight:600;font-size:16px;color:var(--amber);margin-bottom:8px">เอกสารมีอายุเกิน 6 เดือน</div>
          <div style="font-size:13px;color:var(--text2)">วันที่: <strong>${esc(ex.whtDate)}</strong> — ผ่านมา <strong style="color:var(--amber)">${diff} เดือน</strong></div>
          <div style="background:var(--amber-bg);border:1px solid var(--amber);border-radius:10px;padding:12px;font-size:13px;color:var(--amber);margin-top:12px">ไม่สามารถบันทึกได้</div>
        </div>`;
        return;
      }
    }
  }

  const coOptions = result.userCompanies.map(c =>
    `<option value="${c.id}" ${company && c.id===company.id?'selected':''}>${c.name}</option>`
  ).join('');
  const matchBadge = company
    ? `<span style="background:var(--green-bg);color:var(--green);border:1px solid #1a4a30;padding:2px 8px;border-radius:10px;font-size:10px">✓ จับคู่อัตโนมัติ</span>`
    : `<span style="background:var(--amber-bg);color:var(--amber);border:1px solid #4a3a10;padding:2px 8px;border-radius:10px;font-size:10px">⚠ เลือกบริษัทเอง</span>`;

  pendingWht = {
    company_id: company ? company.id : null,
    payer_name: ex.payerName, payer_tax: ex.payerTax,
    payee_name: ex.payeeName, payee_tax: ex.payeeTax,
    wht_type: ex.whtType, income_type: ex.incomeType,
    income_amount: ex.incomeAmount, wht_rate: ex.whtRate,
    wht_amount: ex.whtAmount, wht_date: ex.whtDate,
    image_data: 'data:image/jpeg;base64,' + whtBase64,
  };

  res.innerHTML = `<div class="extracted-panel">
    <div class="extracted-section">
      <div class="extracted-section-title">บันทึกเข้าบริษัท ${matchBadge}</div>
      <select class="form-input" onchange="pendingWht.company_id=this.value?parseInt(this.value):null" style="margin-top:6px">
        <option value="">-- เลือกบริษัท --</option>${coOptions}
      </select>
    </div>
    <div class="extracted-section">
      <div class="extracted-section-title">ผู้จ่ายเงิน (ที่หักภาษี)</div>
      <div class="field-row"><span class="field-key">ชื่อ</span><span class="field-val">${esc(ex.payerName||'-')}</span></div>
      <div class="field-row"><span class="field-key">เลขภาษี</span><span class="field-val mono">${esc(ex.payerTax||'-')}</span></div>
    </div>
    <div class="extracted-section">
      <div class="extracted-section-title">ผู้รับเงิน (ถูกหักภาษี)</div>
      <div class="field-row"><span class="field-key">ชื่อ</span><span class="field-val green">${esc(ex.payeeName||'-')}</span></div>
      <div class="field-row"><span class="field-key">เลขภาษี</span><span class="field-val mono">${esc(ex.payeeTax||'-')}</span></div>
    </div>
    <div class="extracted-section">
      <div class="extracted-section-title">รายละเอียด WHT</div>
      <div class="field-row"><span class="field-key">ประเภทเอกสาร</span><span class="field-val">${esc(ex.whtType||'-')}</span></div>
      <div class="field-row"><span class="field-key">ประเภทเงินได้</span><span class="field-val">${esc(ex.incomeType||'-')}</span></div>
      <div class="field-row"><span class="field-key">ยอดเงินได้</span><span class="field-val mono">${fmt(ex.incomeAmount)} ฿</span></div>
      <div class="field-row"><span class="field-key">อัตราภาษี</span><span class="field-val mono" style="color:var(--amber)">${ex.whtRate||'-'} %</span></div>
      <div class="field-row"><span class="field-key">ยอดภาษีหัก ณ ที่จ่าย</span><span class="field-val mono green" style="font-size:16px;font-weight:600">${fmt(ex.whtAmount)} ฿</span></div>
      <div class="field-row"><span class="field-key">วันที่เอกสาร</span><span class="field-val">${esc(ex.whtDate||'-')}</span></div>
    </div>
  </div>`;
  document.getElementById('wht-confirm-btn').style.display = 'inline-flex';
}

/* ─── IMAGE DOWNLOAD ─── */
function renderImageDownloadList() {
  const el = document.getElementById('image-download-list');
  if (!el) return;

  const month = document.getElementById('excel-month-sel')?.value || '';
  const MONTHS_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

  // Filter invoices by capture_date month
  const filtInv = invoices.filter(r => {
    if (!r.image_data) return false;
    if (!month) return true;
    const d = new Date(r.capture_date);
    const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    return key === month;
  });

  // Filter WHT by wht_date month
  const filtWht = whtRecords.filter(r => {
    if (!r.image_data) return false;
    if (!month) return true;
    if (r.wht_date) {
      const parts = r.wht_date.split('/');
      if (parts.length === 3) {
        let yr = parseInt(parts[2]); if (yr > 2500) yr -= 543;
        const key = yr + '-' + parts[1].padStart(2,'0');
        return key === month;
      }
    }
    const d = new Date(r.capture_date);
    const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    return key === month;
  });

  const total = filtInv.length + filtWht.length;

  // Update download all button text
  const btn = document.getElementById('dl-all-img-btn');
  if (btn) btn.innerHTML = `<i class="fa-solid fa-download"></i> โหลดทั้งหมด (${total} ใบ)`;

  if (!total) {
    el.innerHTML = `<div class="empty-state" style="padding:20px"><i class="fa-solid fa-images"></i><p>ไม่มีรูปในช่วงนี้</p></div>`;
    return;
  }

  // Build grid
  let html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">';

  filtInv.forEach(r => {
    const label = (r.seller_name || 'ใบเสร็จ').slice(0, 12);
    const date = r.invoice_date || new Date(r.capture_date).toLocaleDateString('th-TH');
    html += `<div style="position:relative;cursor:pointer" onclick="downloadSingleImage('${r.id}','invoice')" title="${esc(r.seller_name||'')} ${date}">
      <img src="${r.image_data}" style="width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px;border:2px solid var(--border)">
      <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.8));padding:4px 6px;border-radius:0 0 8px 8px">
        <div style="font-size:9px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</div>
        <div style="font-size:8px;color:rgba(255,255,255,.7)">${date}</div>
      </div>
      <div style="position:absolute;top:4px;right:4px;background:var(--green-bg);border:1px solid var(--green);border-radius:4px;padding:1px 4px;font-size:8px;color:var(--green)">VAT</div>
    </div>`;
  });

  filtWht.forEach(r => {
    const label = (r.payer_name || 'WHT').slice(0, 12);
    const date = r.wht_date || new Date(r.capture_date).toLocaleDateString('th-TH');
    html += `<div style="position:relative;cursor:pointer" onclick="downloadSingleImage('${r.id}','wht')" title="${esc(r.payer_name||'')} ${date}">
      <img src="${r.image_data}" style="width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px;border:2px solid var(--border)">
      <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.8));padding:4px 6px;border-radius:0 0 8px 8px">
        <div style="font-size:9px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</div>
        <div style="font-size:8px;color:rgba(255,255,255,.7)">${date}</div>
      </div>
      <div style="position:absolute;top:4px;right:4px;background:var(--accent-bg);border:1px solid var(--accent);border-radius:4px;padding:1px 4px;font-size:8px;color:var(--accent)">WHT</div>
    </div>`;
  });

  html += '</div>';
  el.innerHTML = html;
}

function downloadSingleImage(id, type) {
  const rec = type === 'wht'
    ? whtRecords.find(r => String(r.id) === String(id))
    : invoices.find(r => String(r.id) === String(id));
  if (!rec?.image_data) { toast('ไม่พบรูปภาพ', true); return; }

  const seller = type === 'wht' ? (rec.payer_name || 'WHT') : (rec.seller_name || 'invoice');
  const date = type === 'wht' ? (rec.wht_date || '') : (rec.invoice_date || '');
  const filename = `${type.toUpperCase()}_${seller.replace(/[^a-zA-Zก-ฮ0-9]/g,'_').slice(0,20)}_${date.replace(/\//g,'-')}.jpg`;

  const a = document.createElement('a');
  a.href = rec.image_data;
  a.download = filename;
  a.click();
  toast(`✓ ดาวน์โหลด ${filename}`);
}

async function downloadAllImages() {
  const month = document.getElementById('excel-month-sel')?.value || '';

  const filtInv = invoices.filter(r => {
    if (!r.image_data) return false;
    if (!month) return true;
    const d = new Date(r.capture_date);
    return (d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0')) === month;
  });

  const filtWht = whtRecords.filter(r => {
    if (!r.image_data) return false;
    if (!month) return true;
    if (r.wht_date) {
      const parts = r.wht_date.split('/');
      if (parts.length === 3) {
        let yr = parseInt(parts[2]); if (yr > 2500) yr -= 543;
        return (yr + '-' + parts[1].padStart(2,'0')) === month;
      }
    }
    const d = new Date(r.capture_date);
    return (d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0')) === month;
  });

  const all = [
    ...filtInv.map(r => ({ rec: r, type: 'invoice' })),
    ...filtWht.map(r => ({ rec: r, type: 'wht' }))
  ];

  if (!all.length) { toast('ไม่มีรูปในช่วงนี้', true); return; }

  toast(`กำลังดาวน์โหลด ${all.length} รูป...`);

  // Download one by one with small delay to avoid browser blocking
  for (let i = 0; i < all.length; i++) {
    const { rec, type } = all[i];
    const seller = type === 'wht' ? (rec.payer_name || 'WHT') : (rec.seller_name || 'invoice');
    const date = type === 'wht' ? (rec.wht_date || '') : (rec.invoice_date || '');
    const num = String(i + 1).padStart(2, '0');
    const filename = `${num}_${type.toUpperCase()}_${seller.replace(/[^a-zA-Zก-ฮ0-9]/g,'_').slice(0,15)}_${date.replace(/\//g,'-')}.jpg`;
    const a = document.createElement('a');
    a.href = rec.image_data;
    a.download = filename;
    a.click();
    await new Promise(r => setTimeout(r, 300));
  }
  toast(`✓ ดาวน์โหลด ${all.length} รูปสำเร็จ`);
}

/* ─── BACKFILL COST TYPE ─── */
async function runBackfill() {
  const btn = document.getElementById('backfill-btn');
  const status = document.getElementById('backfill-status');

  btn.disabled = true;
  btn.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div> AI กำลังวิเคราะห์...';
  status.style.display = 'block';
  status.style.color = 'var(--text2)';
  status.textContent = 'กำลังส่งข้อมูลให้ AI วิเคราะห์... อาจใช้เวลาสักครู่';

  try {
    const r = await fetch('/api/invoices/backfill-cost-type', { method: 'POST' });
    const data = await r.json();

    if (!r.ok) throw new Error(data.error);

    status.style.color = 'var(--green)';
    status.textContent = `✓ ${data.message}${data.errors ? ` (ข้อผิดพลาด ${data.errors} รายการ)` : ''}`;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> วิเคราะห์เสร็จแล้ว';

    // Reload invoices to show updated cost_type
    await fetchInvoices();
    renderDashboard();
    toast(`✓ ${data.message}`);
  } catch (err) {
    status.style.color = 'var(--red)';
    status.textContent = '✗ เกิดข้อผิดพลาด: ' + err.message;
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> AI วิเคราะห์ประเภทต้นทุนรายการเก่า';
  }
}


/* แสดงว่าใครเป็นคนสแกนเอกสารนี้ */
function uploaderLine(rec) {
  const who = rec.uploaded_by_name || rec.uploaded_by_email;
  if (!who) return '';
  const isMe = currentUser && rec.uploaded_by === currentUser.id;
  return `<div style="font-size:10px;color:var(--text3);margin-top:5px">
    <i class="fa-solid fa-user" style="font-size:9px"></i> สแกนโดย ${esc(who)}${isMe ? ' (คุณ)' : ''}
  </div>`;
}


/* ─── เมนูบัญชี (มุมขวาบน) ─── */
function openAccountMenu() {
  const existing = document.getElementById('acct-menu');
  if (existing) { existing.remove(); return; }

  const isAdmin = currentUser && currentUser.role === 'admin';
  const item = (icon, label, onclick, color) => `
    <button onclick="document.getElementById('acct-menu').remove();${onclick}"
      style="display:flex;align-items:center;gap:12px;width:100%;padding:14px 18px;background:none;border:none;
             border-bottom:1px solid rgba(255,255,255,.06);color:${color || 'var(--text)'};
             font-size:15px;font-family:inherit;cursor:pointer;text-align:left">
      <i class="fa-solid ${icon}" style="width:20px;text-align:center;font-size:14px"></i>${label}
    </button>`;

  const html = `
    <div id="acct-menu" style="position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center"
         onclick="if(event.target===this)this.remove()">
      <div style="background:var(--bg2);border-radius:20px 20px 0 0;width:100%;max-width:600px;overflow:hidden;
                  padding-bottom:max(8px,env(safe-area-inset-bottom));animation:slideUp .2s ease">
        <div style="padding:18px 18px 12px">
          <div style="font-weight:700;font-size:16px">${esc(currentUser?.name || '')}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">${esc(currentUser?.email || '')}</div>
          <div style="font-size:11px;margin-top:6px;color:${isAdmin ? 'var(--accent)' : 'var(--text3)'}">
            ● ${isAdmin ? 'ผู้ดูแลระบบ' : 'ผู้ใช้ทั่วไป'}
          </div>
        </div>
        ${isAdmin ? item('fa-users', 'จัดการผู้ใช้', "switchTab('users')") : ''}
        ${item('fa-key', 'เปลี่ยนรหัสผ่านของฉัน', 'openChangePassword()')}
        ${item('fa-right-from-bracket', 'ออกจากระบบ', 'logout()', 'var(--red)')}
        <button onclick="document.getElementById('acct-menu').remove()"
          style="width:100%;padding:14px;background:none;border:none;color:var(--text2);font-size:14px;font-family:inherit;cursor:pointer">
          ปิด
        </button>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

/* ─── เปลี่ยนรหัสผ่านของตัวเอง ─── */
function openChangePassword() {
  const html = `
    <div id="pw-modal" style="position:fixed;inset:0;z-index:500;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.7)">
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;width:100%;max-width:380px;padding:22px">
        <div style="font-weight:700;font-size:17px;margin-bottom:16px">เปลี่ยนรหัสผ่าน</div>
        <label class="form-label">รหัสผ่านเดิม</label>
        <input class="form-input" id="pw-old" type="password" autocomplete="current-password">
        <label class="form-label" style="margin-top:10px">รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)</label>
        <input class="form-input" id="pw-new" type="password" autocomplete="new-password">
        <label class="form-label" style="margin-top:10px">ยืนยันรหัสผ่านใหม่</label>
        <input class="form-input" id="pw-new2" type="password" autocomplete="new-password">
        <div id="pw-msg" style="color:var(--red);font-size:12px;min-height:18px;margin-top:10px"></div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost" style="flex:1" onclick="document.getElementById('pw-modal').remove()">ยกเลิก</button>
          <button class="btn btn-primary" style="flex:1" onclick="submitChangePassword()">บันทึก</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function submitChangePassword() {
  const msg = document.getElementById('pw-msg');
  const oldP = document.getElementById('pw-old').value;
  const newP = document.getElementById('pw-new').value;
  const newP2 = document.getElementById('pw-new2').value;
  msg.textContent = '';
  if (newP !== newP2) { msg.textContent = 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน'; return; }
  if (newP.length < 8) { msg.textContent = 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร'; return; }
  try {
    const r = await fetch('/api/me/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: oldP, newPassword: newP }),
    });
    const d = await r.json();
    if (!r.ok) { msg.textContent = d.error || 'เปลี่ยนรหัสผ่านไม่สำเร็จ'; return; }
    document.getElementById('pw-modal').remove();
    toast('✓ เปลี่ยนรหัสผ่านแล้ว');
  } catch { msg.textContent = 'เชื่อมต่อไม่ได้'; }
}

/* ─── จัดการผู้ใช้ (เฉพาะผู้ดูแลระบบ) ─── */
let usersCache = [];

async function renderUsers() {
  const box = document.getElementById('users-list');
  if (!box) return;
  box.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:12px">กำลังโหลด…</div>';
  try {
    const r = await fetch('/api/users');
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      box.innerHTML = `<div style="color:var(--red);font-size:13px;padding:12px">${esc(d.error || 'โหลดรายชื่อไม่สำเร็จ')}</div>`;
      return;
    }
    usersCache = await r.json();
  } catch {
    box.innerHTML = '<div style="color:var(--red);font-size:13px;padding:12px">เชื่อมต่อไม่ได้</div>';
    return;
  }

  box.innerHTML = usersCache.map(u => {
    const isMe = currentUser && u.id === currentUser.id;
    const roleLabel = u.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้ทั่วไป';
    const roleColor = u.role === 'admin' ? 'var(--accent)' : 'var(--text2)';
    const scans = Number(u.invoice_count || 0) + Number(u.wht_count || 0);
    return `
    <div class="card" style="padding:14px 16px;margin-bottom:10px;${u.is_active ? '' : 'opacity:.55'}">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:180px">
          <div style="font-weight:600;font-size:15px">
            ${esc(u.name)}${isMe ? ' <span style="font-size:11px;color:var(--text3)">(คุณ)</span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">${esc(u.email)}</div>
          <div style="font-size:11px;margin-top:5px">
            <span style="color:${roleColor}">● ${roleLabel}</span>
            <span style="color:var(--text3)"> · สแกนแล้ว ${scans} รายการ</span>
            ${u.is_active ? '' : '<span style="color:var(--amber)"> · ถูกระงับ</span>'}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="resetUserPassword(${u.id})">
            <i class="fa-solid fa-key"></i> รหัสผ่าน
          </button>
          ${isMe ? '' : `
            <button class="btn btn-ghost btn-sm" onclick="toggleUserRole(${u.id})">
              <i class="fa-solid fa-user-shield"></i> ${u.role === 'admin' ? 'ลดเป็นผู้ใช้' : 'ตั้งเป็นแอดมิน'}
            </button>
            <button class="btn btn-ghost btn-sm" onclick="toggleUserActive(${u.id})">
              <i class="fa-solid fa-${u.is_active ? 'ban' : 'circle-check'}"></i> ${u.is_active ? 'ระงับ' : 'เปิดใช้'}
            </button>`}
        </div>
      </div>
    </div>`;
  }).join('');
}

function openUserModal() {
  const html = `
    <div id="user-modal" style="position:fixed;inset:0;z-index:400;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.7)">
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;width:100%;max-width:400px;padding:22px">
        <div style="font-weight:700;font-size:17px;margin-bottom:16px">เพิ่มผู้ใช้ใหม่</div>
        <label class="form-label">ชื่อ-นามสกุล</label>
        <input class="form-input" id="nu-name" placeholder="เช่น สมชาย ใจดี">
        <label class="form-label" style="margin-top:10px">อีเมล</label>
        <input class="form-input" id="nu-email" type="email" inputmode="email" placeholder="name@company.com">
        <label class="form-label" style="margin-top:10px">รหัสผ่านเริ่มต้น (อย่างน้อย 8 ตัว)</label>
        <input class="form-input" id="nu-pass" type="text" placeholder="ตั้งรหัสให้ผู้ใช้">
        <label class="form-label" style="margin-top:10px">สิทธิ์</label>
        <select class="form-input" id="nu-role">
          <option value="user">ผู้ใช้ทั่วไป — สแกน ดูเอกสาร ดาวน์โหลดได้</option>
          <option value="admin">ผู้ดูแลระบบ — จัดการผู้ใช้และบริษัทได้ด้วย</option>
        </select>
        <div id="nu-msg" style="color:var(--red);font-size:12px;min-height:18px;margin-top:10px"></div>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="btn btn-ghost" style="flex:1" onclick="document.getElementById('user-modal').remove()">ยกเลิก</button>
          <button class="btn btn-primary" style="flex:1" onclick="createUser()">เพิ่มผู้ใช้</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function createUser() {
  const msg = document.getElementById('nu-msg');
  msg.textContent = '';
  const body = {
    name: v('nu-name'),
    email: v('nu-email'),
    password: document.getElementById('nu-pass').value,
    role: v('nu-role') || 'user',
  };
  try {
    const r = await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { msg.textContent = d.error || 'เพิ่มผู้ใช้ไม่สำเร็จ'; return; }
    document.getElementById('user-modal').remove();
    toast('✓ เพิ่มผู้ใช้แล้ว — แจ้งรหัสผ่านให้เจ้าตัวเปลี่ยนเองภายหลัง');
    renderUsers();
  } catch { msg.textContent = 'เชื่อมต่อไม่ได้'; }
}

async function toggleUserRole(id) {
  const u = usersCache.find(x => x.id === id); if (!u) return;
  const next = u.role === 'admin' ? 'user' : 'admin';
  if (!confirm(`เปลี่ยนสิทธิ์ของ ${u.name} เป็น "${next === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้ทั่วไป'}" ?`)) return;
  await patchUser(id, { role: next });
}

async function toggleUserActive(id) {
  const u = usersCache.find(x => x.id === id); if (!u) return;
  const next = !u.is_active;
  if (!confirm(next ? `เปิดใช้งานบัญชี ${u.name} ?` : `ระงับบัญชี ${u.name} ? (เข้าระบบไม่ได้ แต่ข้อมูลที่สแกนไว้ยังอยู่)`)) return;
  await patchUser(id, { is_active: next });
}

async function patchUser(id, body) {
  try {
    const r = await fetch(`/api/users/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'แก้ไขไม่สำเร็จ', true); return; }
    toast('✓ บันทึกแล้ว');
    renderUsers();
  } catch { toast('เชื่อมต่อไม่ได้', true); }
}

async function resetUserPassword(id) {
  const u = usersCache.find(x => x.id === id); if (!u) return;
  const pass = prompt(`ตั้งรหัสผ่านใหม่ให้ ${u.name}\n(อย่างน้อย 8 ตัวอักษร)`);
  if (!pass) return;
  try {
    const r = await fetch(`/api/users/${id}/password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'ตั้งรหัสไม่สำเร็จ', true); return; }
    toast('✓ ตั้งรหัสผ่านใหม่แล้ว');
  } catch { toast('เชื่อมต่อไม่ได้', true); }
}
