// ============================================================
//  Staff & Invitation Management Module
//  ใช้ใน index.html โดย <script src="/js/staff.js">
// ============================================================

window.StaffModule = (function () {
  let _companies = [];

  function init(companies) {
    _companies = companies;
    renderStaffTab();
    loadStaff();
  }

  // ── Render tab shell ─────────────────────────────────────

  function renderStaffTab() {
    const el = document.getElementById('staff-tab-content');
    if (!el) return;
    el.innerHTML = `
      <div class="section-header">
        <span>จัดการพนักงาน</span>
        <button class="btn-primary" onclick="StaffModule.openInviteModal()">+ เชิญพนักงาน</button>
      </div>
      <div id="staff-list" class="staff-list">
        <div class="loading">กำลังโหลด...</div>
      </div>

      <!-- Invite Modal -->
      <div id="invite-modal" class="modal-overlay" style="display:none">
        <div class="modal-box">
          <div class="modal-title">เชิญพนักงาน</div>
          <label>อีเมล Gmail ของพนักงาน</label>
          <input id="invite-email" type="email" placeholder="staff@gmail.com" style="width:100%;margin:6px 0 12px">
          <label>บริษัทที่เข้าถึงได้</label>
          <div id="invite-company-checks" style="margin:6px 0 16px">
            ${_companies.map(c => `
              <label class="check-row">
                <input type="checkbox" name="inv-company" value="${c.id}"> ${c.name}
              </label>
            `).join('')}
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="StaffModule.closeInviteModal()">ยกเลิก</button>
            <button class="btn-primary" onclick="StaffModule.sendInvite()">ส่งลิงก์เชิญ</button>
          </div>
        </div>
      </div>

      <!-- Access Modal -->
      <div id="access-modal" class="modal-overlay" style="display:none">
        <div class="modal-box">
          <div class="modal-title" id="access-modal-title">แก้ไขการเข้าถึง</div>
          <div id="access-company-checks" style="margin:6px 0 16px"></div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="StaffModule.closeAccessModal()">ยกเลิก</button>
            <button class="btn-primary" onclick="StaffModule.saveAccess()">บันทึก</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Load staff list ──────────────────────────────────────

  async function loadStaff() {
    const el = document.getElementById('staff-list');
    if (!el) return;
    try {
      const [staffRes, invRes] = await Promise.all([
        fetch('/api/staff').then(r => r.json()),
        fetch('/api/invitations').then(r => r.json()),
      ]);

      let html = '';

      if (staffRes.length === 0 && invRes.filter(i => !i.used).length === 0) {
        html = '<div class="empty-state">ยังไม่มีพนักงาน<br>กด "+ เชิญพนักงาน" เพื่อส่งลิงก์เชิญ</div>';
      }

      staffRes.forEach(s => {
        const compNames = (s.company_ids || [])
          .map(cid => _companies.find(c => c.id === cid)?.name || cid)
          .join(', ') || 'ไม่มี';
        html += `
          <div class="staff-card">
            <img class="staff-avatar" src="${s.picture || ''}" onerror="this.style.display='none'">
            <div class="staff-info">
              <div class="staff-name">${s.name || s.email}</div>
              <div class="staff-email">${s.email}</div>
              <div class="staff-companies">📁 ${compNames}</div>
            </div>
            <div class="staff-actions">
              <button class="btn-small" onclick="StaffModule.openAccessModal(${s.id}, '${s.name || s.email}', ${JSON.stringify(s.company_ids || [])})">แก้ไข</button>
              <button class="btn-small btn-danger" onclick="StaffModule.removeStaff(${s.id}, '${s.name || s.email}')">ลบ</button>
            </div>
          </div>
        `;
      });

      const pending = invRes.filter(i => !i.used);
      if (pending.length) {
        html += '<div class="section-sub-header">ลิงก์เชิญที่รอการตอบรับ</div>';
        pending.forEach(inv => {
          const exp = new Date(inv.expires_at).toLocaleDateString('th-TH');
          html += `
            <div class="staff-card invite-pending">
              <div class="staff-info">
                <div class="staff-name">${inv.invitee_email}</div>
                <div class="staff-email">หมดอายุ: ${exp}</div>
              </div>
              <button class="btn-small" onclick="StaffModule.copyInvite('${inv.id}')">คัดลอกลิงก์</button>
            </div>
          `;
        });
      }

      el.innerHTML = html || '<div class="empty-state">ยังไม่มีพนักงาน</div>';
    } catch (e) {
      el.innerHTML = '<div class="error-state">โหลดข้อมูลไม่สำเร็จ</div>';
    }
  }

  // ── Invite ───────────────────────────────────────────────

  function openInviteModal() {
    document.getElementById('invite-modal').style.display = 'flex';
    document.getElementById('invite-email').value = '';
    document.querySelectorAll('input[name="inv-company"]').forEach(cb => cb.checked = false);
  }

  function closeInviteModal() {
    document.getElementById('invite-modal').style.display = 'none';
  }

  async function sendInvite() {
    const email = document.getElementById('invite-email').value.trim();
    if (!email) return alert('กรุณากรอกอีเมล');
    const company_ids = [...document.querySelectorAll('input[name="inv-company"]:checked')]
      .map(cb => parseInt(cb.value));

    try {
      const r = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, company_ids }),
      }).then(r => r.json());

      if (r.error) return alert('ผิดพลาด: ' + r.error);

      closeInviteModal();
      // Show invite URL
      const msg = `ลิงก์เชิญสำหรับ ${email}:\n\n${r.inviteUrl}\n\nส่งลิงก์นี้ให้พนักงาน (หมดอายุใน 7 วัน)`;
      if (confirm(msg + '\n\nคัดลอกลิงก์?')) {
        navigator.clipboard.writeText(r.inviteUrl).catch(() => {});
      }
      loadStaff();
    } catch (e) {
      alert('ส่งคำเชิญไม่สำเร็จ');
    }
  }

  async function copyInvite(inviteId) {
    // Re-fetch invites to find URL by id — simplified: re-generate from token
    alert('กรุณาส่งลิงก์เชิญใหม่จากปุ่ม "+ เชิญพนักงาน"');
  }

  // ── Access modal ─────────────────────────────────────────

  let _currentStaffId = null;

  function openAccessModal(staffId, name, currentCompanyIds) {
    _currentStaffId = staffId;
    document.getElementById('access-modal-title').textContent = `แก้ไขการเข้าถึง: ${name}`;
    const checks = document.getElementById('access-company-checks');
    checks.innerHTML = _companies.map(c => `
      <label class="check-row">
        <input type="checkbox" name="acc-company" value="${c.id}"
          ${currentCompanyIds.includes(c.id) ? 'checked' : ''}> ${c.name}
      </label>
    `).join('');
    document.getElementById('access-modal').style.display = 'flex';
  }

  function closeAccessModal() {
    document.getElementById('access-modal').style.display = 'none';
  }

  async function saveAccess() {
    const company_ids = [...document.querySelectorAll('input[name="acc-company"]:checked')]
      .map(cb => parseInt(cb.value));
    try {
      await fetch(`/api/staff/${_currentStaffId}/access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_ids }),
      });
      closeAccessModal();
      loadStaff();
    } catch (e) {
      alert('บันทึกไม่สำเร็จ');
    }
  }

  // ── Remove staff ─────────────────────────────────────────

  async function removeStaff(staffId, name) {
    if (!confirm(`ลบ ${name} ออกจากระบบ?`)) return;
    try {
      await fetch(`/api/staff/${staffId}`, { method: 'DELETE' });
      loadStaff();
    } catch (e) {
      alert('ลบไม่สำเร็จ');
    }
  }

  return { init, openInviteModal, closeInviteModal, sendInvite, copyInvite, openAccessModal, closeAccessModal, saveAccess, removeStaff };
})();
