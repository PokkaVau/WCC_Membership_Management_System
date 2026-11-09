/**
 * WCC Membership Management System - Member Directory Controller
 * Handles global search, multi-filters, sorting, pagination, desktop table,
 * mobile cards, and filtered CSV export.
 */

let allMembersData = [];
let filteredMembersData = [];
let currentPage = 1;
let pageSize = 25;

document.addEventListener('DOMContentLoaded', async () => {
  AUTH.requireAdmin();
  AUTH.initUIComponents();

  await initializeMembersDirectory();

  // Auto-update directory if background revalidation brings fresh data
  window.addEventListener('wcc-members-refreshed', (e) => {
    if (e.detail && Array.isArray(e.detail.members) && e.detail.members.length > 0) {
      allMembersData = e.detail.members;
      populateFilterDropdowns(allMembersData);
      applyFiltersAndSort();
    }
  });
});

async function initializeMembersDirectory() {
  try {
    showTableLoading(true);
    allMembersData = await API.fetchMembers();
    filteredMembersData = [...allMembersData];

    populateFilterDropdowns(allMembersData);
    bindDirectoryEvents();

    // Check for URL query params (e.g., ?q=Tanvir or ?status=active)
    const urlParams = new URLSearchParams(window.location.search);
    const queryParam = urlParams.get('q');
    const statusParam = urlParams.get('status');

    if (queryParam) {
      const searchInput = document.getElementById('memberSearchInput');
      if (searchInput) searchInput.value = queryParam;
    }
    if (statusParam) {
      const statusSelect = document.getElementById('filterStatus');
      if (statusSelect) {
        statusSelect.value = statusParam;
        // Expand filter panel if a filter is active
        document.getElementById('filterPanel')?.classList.remove('hidden');
        document.getElementById('filterToggleBtn')?.classList.add('active');
      }
    }

    applyFiltersAndSort();
    initDuplicateAccountsFeature();
  } catch (err) {
    console.error('Failed to load members:', err);
    UTILS.showToast('Failed to load member directory: ' + (err.message || 'Network issue'), 'error');
    showTableError(err);
  } finally {
    showTableLoading(false);
  }
}

/**
 * Populate dynamic District and Upazila dropdowns from existing data
 */
function populateFilterDropdowns(members) {
  const districtSelect = document.getElementById('filterDistrict');
  const bloodSelect = document.getElementById('filterBloodGroup');

  if (districtSelect) {
    const districts = [...new Set(members.map(m => m.district).filter(Boolean))].sort();
    districts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      districtSelect.appendChild(opt);
    });
  }

  // Populate Upazila dynamically if district changes
  if (districtSelect) {
    districtSelect.addEventListener('change', () => {
      const selectedDistrict = districtSelect.value;
      const upazilaSelect = document.getElementById('filterUpazila');
      if (!upazilaSelect) return;

      upazilaSelect.innerHTML = '<option value="">All Upazilas</option>';
      const upazilas = [
        ...new Set(
          members
            .filter(m => !selectedDistrict || m.district === selectedDistrict)
            .map(m => m.upazila)
            .filter(Boolean)
        )
      ].sort();

      upazilas.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u;
        opt.textContent = u;
        upazilaSelect.appendChild(opt);
      });
    });
  }
}

/**
 * Wire up all event listeners (search, filters, sort, export, pagination)
 */
function bindDirectoryEvents() {
  // Search input with debounce
  const searchInput = document.getElementById('memberSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', UTILS.debounce(() => {
      currentPage = 1;
      applyFiltersAndSort();
    }, 200));
  }

  // Toggle filter panel
  const filterToggleBtn = document.getElementById('filterToggleBtn');
  const filterPanel = document.getElementById('filterPanel');
  if (filterToggleBtn && filterPanel) {
    filterToggleBtn.addEventListener('click', () => {
      filterPanel.classList.toggle('hidden');
      filterToggleBtn.classList.toggle('active');
    });
  }

  // Filter change triggers
  const filterInputs = document.querySelectorAll('.filter-input');
  filterInputs.forEach(input => {
    input.addEventListener('change', () => {
      currentPage = 1;
      applyFiltersAndSort();
    });
  });

  // Reset filters button
  const resetBtn = document.getElementById('resetFiltersBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetAllFilters);
  }

  // Sorting
  const sortSelect = document.getElementById('sortBySelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      applyFiltersAndSort();
    });
  }

  // Page size selector
  const pageSizeSelect = document.getElementById('pageSizeSelect');
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
      pageSize = parseInt(e.target.value, 10) || 25;
      currentPage = 1;
      renderCurrentPage();
    });
  }

  // Export buttons
  const exportAllBtn = document.getElementById('exportAllBtn');
  if (exportAllBtn) {
    exportAllBtn.addEventListener('click', () => {
      UTILS.exportToCSV(allMembersData, `WCC-All-Members-${new Date().toISOString().slice(0, 10)}.csv`);
    });
  }

  const exportFilteredBtn = document.getElementById('exportFilteredBtn');
  if (exportFilteredBtn) {
    exportFilteredBtn.addEventListener('click', () => {
      UTILS.exportToCSV(filteredMembersData, `WCC-Filtered-Members-${new Date().toISOString().slice(0, 10)}.csv`);
    });
  }
}

/**
 * Filter, sort, and re-render
 */
function applyFiltersAndSort() {
  const searchTerm = (document.getElementById('memberSearchInput')?.value || '').trim().toLowerCase();
  const statusVal = (document.getElementById('filterStatus')?.value || '').trim().toLowerCase();
  const genderVal = (document.getElementById('filterGender')?.value || '').trim().toLowerCase();
  const bloodVal = (document.getElementById('filterBloodGroup')?.value || '').trim().toUpperCase();
  const districtVal = (document.getElementById('filterDistrict')?.value || '').trim().toLowerCase();
  const upazilaVal = (document.getElementById('filterUpazila')?.value || '').trim().toLowerCase();
  const wingVal = (document.getElementById('filterWing')?.value || '').trim().toLowerCase();
  const membershipVal = (document.getElementById('filterMembership')?.value || '').trim().toLowerCase();
  const studentVal = (document.getElementById('filterStudent')?.value || '').trim().toLowerCase();
  const professionVal = (document.getElementById('filterProfession')?.value || '').trim().toLowerCase();

  // 1. Filtering
  filteredMembersData = allMembersData.filter(m => {
    // Search query match across all Form-V2 fields
    if (searchTerm) {
      const match = (
        (m.name && m.name.toLowerCase().includes(searchTerm)) ||
        (m.nameBn && m.nameBn.toLowerCase().includes(searchTerm)) ||
        (m.memberId && m.memberId.toLowerCase().includes(searchTerm)) ||
        (m.phone && m.phone.toLowerCase().includes(searchTerm)) ||
        (m.email && m.email.toLowerCase().includes(searchTerm)) ||
        (m.bloodGroup && m.bloodGroup.toLowerCase().includes(searchTerm)) ||
        (m.rawBloodGroup && m.rawBloodGroup.toLowerCase().includes(searchTerm)) ||
        (m.wing && m.wing.toLowerCase().includes(searchTerm)) ||
        (m.membershipType && m.membershipType.toLowerCase().includes(searchTerm)) ||
        (m.presentAddress && m.presentAddress.toLowerCase().includes(searchTerm)) ||
        (m.permanentAddress && m.permanentAddress.toLowerCase().includes(searchTerm)) ||
        (m.currentInstitution && m.currentInstitution.toLowerCase().includes(searchTerm)) ||
        (m.profession && m.profession.toLowerCase().includes(searchTerm)) ||
        (m.father && m.father.toLowerCase().includes(searchTerm)) ||
        (m.mother && m.mother.toLowerCase().includes(searchTerm)) ||
        (m.nid && m.nid.toLowerCase().includes(searchTerm))
      );
      if (!match) return false;
    }

    // Status filter
    if (statusVal && (m.status || '').toLowerCase() !== statusVal) return false;

    // Gender filter
    if (genderVal && (m.gender || '').toLowerCase() !== genderVal) return false;

    // Blood group filter
    if (bloodVal && (m.bloodGroup || '').toUpperCase() !== bloodVal) return false;

    // Wing filter
    if (wingVal && !(m.wing && m.wing.toLowerCase().includes(wingVal))) return false;

    // Membership Type filter
    if (membershipVal && !(m.membershipType && m.membershipType.toLowerCase().includes(membershipVal))) return false;

    // District filter
    if (districtVal && !(m.permanentAddress && m.permanentAddress.toLowerCase().includes(districtVal)) && !(m.presentAddress && m.presentAddress.toLowerCase().includes(districtVal))) return false;

    // Upazila filter
    if (upazilaVal && !(m.permanentAddress && m.permanentAddress.toLowerCase().includes(upazilaVal)) && !(m.presentAddress && m.presentAddress.toLowerCase().includes(upazilaVal))) return false;

    // Student filter (currently studying হ্যাঁ / না)
    if (studentVal) {
      if (studentVal === 'student' && !m.isStudent) return false;
      if (studentVal === 'non-student' && m.isStudent) return false;
    }

    // Profession filter
    if (professionVal && !(m.profession && m.profession.toLowerCase().includes(professionVal))) return false;

    return true;
  });

  // 2. Sorting
  const sortBy = document.getElementById('sortBySelect')?.value || 'newest';

  filteredMembersData.sort((a, b) => {
    switch (sortBy) {
      case 'name_asc':
        return (a.name || '').localeCompare(b.name || '');
      case 'name_desc':
        return (b.name || '').localeCompare(a.name || '');
      case 'oldest':
        return new Date(a.registrationDate || 0) - new Date(b.registrationDate || 0);
      case 'id_asc':
        return (a.memberId || '').localeCompare(b.memberId || '');
      case 'dob':
        return new Date(a.dob || 0) - new Date(b.dob || 0);
      case 'newest':
      default:
        return new Date(b.registrationDate || 0) - new Date(a.registrationDate || 0);
    }
  });

  renderCurrentPage();
}

/**
 * Render table rows and mobile card tiles for the current active page
 */
function renderCurrentPage() {
  const tableBody = document.getElementById('membersTableBody');
  const mobileContainer = document.getElementById('mobileCardsContainer');
  const countEl = document.getElementById('resultsCountDisplay');

  const totalFiltered = filteredMembersData.length;
  const totalAll = allMembersData.length;

  if (countEl) {
    const startIdx = totalFiltered === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const endIdx = Math.min(currentPage * pageSize, totalFiltered);
    countEl.innerHTML = `Showing <strong>${startIdx}-${endIdx}</strong> of <strong>${totalFiltered}</strong> members${totalFiltered !== totalAll ? ` (filtered from ${totalAll})` : ''}`;
  }

  // Handle empty state
  if (totalAll === 0) {
    const emptyHtml = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state-icon">📂</div>
        <h4 class="empty-state-title">No member records found</h4>
        <p class="empty-state-desc">Your Google Sheet API is connected, but no member entries were found in the sheet.</p>
        <div style="display:flex; gap:0.75rem; justify-content:center; margin-top:1rem; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" onclick="initializeMembersDirectory()">Refresh Data</button>
          <a href="settings.html" class="btn btn-secondary">API Settings</a>
        </div>
      </div>
    `;
    if (tableBody) tableBody.innerHTML = `<tr><td colspan="7">${emptyHtml}</td></tr>`;
    if (mobileContainer) mobileContainer.innerHTML = emptyHtml;
    renderPaginationControls(0);
    return;
  }

  if (totalFiltered === 0) {
    const emptyHtml = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state-icon">🔍</div>
        <h4 class="empty-state-title">No members found</h4>
        <p class="empty-state-desc">No members matched your search or filter criteria. Try adjusting your parameters.</p>
        <button type="button" class="btn btn-secondary" onclick="resetAllFilters()">Reset All Filters</button>
      </div>
    `;
    if (tableBody) tableBody.innerHTML = `<tr><td colspan="7">${emptyHtml}</td></tr>`;
    if (mobileContainer) mobileContainer.innerHTML = emptyHtml;
    renderPaginationControls(0);
    return;
  }

  // Slice active page
  const startIndex = (currentPage - 1) * pageSize;
  const pageItems = filteredMembersData.slice(startIndex, startIndex + pageSize);

  // 1. Render Desktop Table Rows (7 clean responsive columns)
  if (tableBody) {
    tableBody.innerHTML = pageItems.map(m => `
      <tr>
        <td>
          <div class="member-profile-cell">
            <img src="${UTILS.escapeHTML(m.photoUrl)}" 
                 alt="${UTILS.escapeHTML(m.name)}" 
                 class="member-cell-photo" 
                 onerror="this.onerror=null;this.src='${CONFIG.ORG_INFO.defaultAvatarPath}';" />
            <div class="member-cell-info">
              <a href="member.html?id=${encodeURIComponent(m.memberId)}" class="member-cell-name">
                ${UTILS.escapeHTML(m.name)}
              </a>
              <span class="member-cell-id">
                ${UTILS.escapeHTML(m.memberId)}${m.gender ? ` &bull; ${UTILS.escapeHTML(m.gender)}` : ''}
              </span>
            </div>
          </div>
        </td>
        <td>
          ${UTILS.renderBloodBadge(m.bloodGroup)}
          ${m.lastBloodDonation ? `<div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 3px;" title="Last Blood Donation Date">🩸 ${UTILS.escapeHTML(m.formattedLastBloodDonation || m.lastBloodDonation)}</div>` : ''}
        </td>
        <td>
          <div class="member-contact-cell">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="contact-phone">📞 ${UTILS.escapeHTML(m.phone || 'Not provided')}</span>
              ${m.phone ? `<a href="${UTILS.getWhatsAppUrl(m.phone)}" target="_blank" rel="noopener noreferrer" class="badge" style="background:#25D366; color:#FFF; text-decoration:none; display:inline-flex; align-items:center; gap:2px; font-size:0.68rem; padding:1px 5px; border-radius:4px; font-weight:600;">💬 WA</a>` : ''}
            </div>
            <span class="contact-email" title="${UTILS.escapeHTML(m.email || '')}">✉️ ${UTILS.escapeHTML(m.email || 'Not provided')}</span>
          </div>
        </td>
        <td>
          <div class="member-location-cell">
            <span class="district-name">${UTILS.escapeHTML(m.district || 'Not provided')}</span>
            ${m.upazila ? `<span class="upazila-name">${UTILS.escapeHTML(m.upazila)}</span>` : ''}
          </div>
        </td>
        <td>${UTILS.renderStatusBadge(m.status)}</td>
        <td style="font-size: 0.82rem; color: var(--text-muted);">${UTILS.escapeHTML(m.formattedRegDate)}</td>
        <td style="text-align: right; padding-right: 1.5rem;">
          <div class="table-actions" style="justify-content: flex-end;">
            <a href="member.html?id=${encodeURIComponent(m.memberId)}" class="btn btn-sm btn-secondary" title="View Profile">
              View
            </a>
            <button type="button" onclick="downloadMemberPDFDirectly('${UTILS.escapeHTML(m.memberId)}')" class="btn btn-sm btn-crimson" title="Download PDF">
              PDF
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // 2. Render Mobile Cards View
  if (mobileContainer) {
    mobileContainer.innerHTML = pageItems.map(m => `
      <div class="member-card-item">
        <div class="member-card-header">
          <img src="${UTILS.escapeHTML(m.photoUrl)}" 
               alt="${UTILS.escapeHTML(m.name)}" 
               class="member-card-photo" 
               onerror="this.onerror=null;this.src='${CONFIG.ORG_INFO.defaultAvatarPath}';" />
          <div class="member-card-title">
            <span class="member-card-name">${UTILS.escapeHTML(m.name)}</span>
            <span class="member-card-id">${UTILS.escapeHTML(m.memberId)}</span>
          </div>
          <div>${UTILS.renderStatusBadge(m.status)}</div>
        </div>
        <div class="member-card-details">
          <div class="member-card-detail-item">
            <span class="lbl">Blood Group</span>
            <span class="val">${UTILS.renderBloodBadge(m.bloodGroup)}</span>
          </div>
          <div class="member-card-detail-item">
            <span class="lbl">Last Blood Date</span>
            <span class="val" style="font-size: 0.75rem;">${m.formattedLastBloodDonation || (m.lastBloodDonation ? UTILS.formatDate(m.lastBloodDonation) : 'তথ্য নেই')}</span>
          </div>
          <div class="member-card-detail-item">
            <span class="lbl">District</span>
            <span class="val">${UTILS.escapeHTML(m.district || 'N/A')}</span>
          </div>
          <div class="member-card-detail-item">
            <span class="lbl">Phone</span>
            <span class="val">${UTILS.escapeHTML(m.phone || 'N/A')}</span>
          </div>
        </div>
        <div class="member-card-footer">
          <a href="member.html?id=${encodeURIComponent(m.memberId)}" class="btn btn-sm btn-secondary" style="flex:1;">
            View
          </a>
          ${m.phone ? `
            <a href="${UTILS.getWhatsAppUrl(m.phone)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm" style="background:#25D366; color:#FFF; font-weight:600; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:3px; padding: 0.4rem 0.6rem;">
              💬 WA
            </a>
          ` : ''}
          <button type="button" onclick="downloadMemberPDFDirectly('${UTILS.escapeHTML(m.memberId)}')" class="btn btn-sm btn-crimson" style="flex:1;">
            PDF
          </button>
        </div>
      </div>
    `).join('');
  }

  renderPaginationControls(totalFiltered);
}

/**
 * Render pagination numbers & prev/next buttons
 */
function renderPaginationControls(totalItems) {
  const container = document.getElementById('paginationControls');
  if (!container) return;

  const totalPages = Math.ceil(totalItems / pageSize);
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `
    <button type="button" class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">
      &larr; Prev
    </button>
  `;

  // Determine window of page numbers
  const maxButtons = 5;
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);

  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  if (startPage > 1) {
    html += `<button type="button" class="page-btn" onclick="changePage(1)">1</button>`;
    if (startPage > 2) html += `<span style="padding:0 4px; color:var(--text-muted)">...</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `
      <button type="button" class="page-btn ${i === currentPage ? 'active' : ''}" onclick="changePage(${i})">
        ${i}
      </button>
    `;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span style="padding:0 4px; color:var(--text-muted)">...</span>`;
    html += `<button type="button" class="page-btn" onclick="changePage(${totalPages})">${totalPages}</button>`;
  }

  html += `
    <button type="button" class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">
      Next &rarr;
    </button>
  `;

  container.innerHTML = html;
}

function changePage(page) {
  currentPage = page;
  renderCurrentPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetAllFilters() {
  const searchInput = document.getElementById('memberSearchInput');
  if (searchInput) searchInput.value = '';

  const filterInputs = document.querySelectorAll('.filter-input');
  filterInputs.forEach(i => i.value = '');

  currentPage = 1;
  applyFiltersAndSort();
  UTILS.showToast('Filters reset', 'info');
}

/**
 * Direct PDF download trigger from table action button
 */
async function downloadMemberPDFDirectly(memberId) {
  try {
    UTILS.showToast(`Generating PDF for ${memberId}...`, 'info');
    const member = await API.fetchMemberById(memberId);
    if (!member) throw new Error('Member not found');
    await PDF_GENERATOR.generateMemberPDF(member);
  } catch (e) {
    console.error(e);
    UTILS.showToast('Failed to generate member PDF.', 'error');
  }
}

function showTableLoading(isLoading) {
  const loader = document.getElementById('tableLoadingIndicator');
  if (loader) loader.style.display = isLoading ? 'block' : 'none';
}

function showTableError(err) {
  const tableBody = document.getElementById('membersTableBody');
  const mobileContainer = document.getElementById('mobileCardsContainer');
  const msg = err && err.message ? err.message : 'Please verify your internet connection or Google Sheet API configuration in Settings.';

  const errorHtml = `
    <div class="empty-state" style="grid-column:1/-1;">
      <div class="empty-state-icon">⚠️</div>
      <h4 class="empty-state-title">Unable to load member data</h4>
      <p class="empty-state-desc" style="color:#FF6B6B; font-weight:600; max-width:600px; margin:0.5rem auto 1rem;">${UTILS.escapeHTML(msg)}</p>
      <div style="display:flex; gap:0.75rem; justify-content:center; flex-wrap:wrap;">
        <button type="button" class="btn btn-primary" onclick="initializeMembersDirectory()">Retry</button>
        <a href="settings.html" class="btn btn-secondary">API Settings</a>
      </div>
    </div>
  `;

  if (tableBody) {
    tableBody.innerHTML = `<tr><td colspan="7">${errorHtml}</td></tr>`;
  }
  if (mobileContainer) {
    mobileContainer.innerHTML = errorHtml;
  }
}

/**
 * Duplicate Accounts Manager (Detection & 1-Click Batch Deletion)
 */
let duplicateFeatureInitialized = false;

function initDuplicateAccountsFeature() {
  const btnOpen = document.getElementById('btnManageDuplicates');
  const badge = document.getElementById('duplicateBadge');
  const modal = document.getElementById('duplicateAccountsModal');
  const btnClose = document.getElementById('btnCloseDuplicatesModal');
  const btnCloseFooter = document.getElementById('btnCloseDuplicatesModalFooter');
  const btnDeleteAll = document.getElementById('btnDeleteAllDuplicates');
  const container = document.getElementById('duplicateGroupsContainer');
  const emptyState = document.getElementById('duplicateEmptyState');
  const banner = document.getElementById('duplicateSummaryBanner');
  const statsEl = document.getElementById('duplicateSummaryStats');

  if (!btnOpen || !modal) return;

  function updateBadge() {
    const groups = UTILS.findDuplicateGroups(allMembersData);
    const totalDups = groups.reduce((sum, g) => sum + g.duplicates.length, 0);
    if (badge) {
      if (totalDups > 0) {
        badge.textContent = totalDups;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
    return { groups, totalDups };
  }

  function renderDuplicates() {
    const { groups, totalDups } = updateBadge();

    if (groups.length === 0 || totalDups === 0) {
      container.innerHTML = '';
      emptyState.style.display = 'block';
      banner.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    banner.style.display = 'flex';
    statsEl.textContent = `মোট ${groups.length} টি ডুপ্লিকেট গ্রুপে ${totalDups} টি অপ্রয়োজনীয় অতিরিক্ত অ্যাকাউন্ট পাওয়া গেছে।`;
    btnDeleteAll.innerHTML = `<span>🗑️</span> 1-Click Delete All (${totalDups}) Duplicates`;

    container.innerHTML = groups.map(g => {
      const master = g.master;
      const dups = g.duplicates;

      return `
        <div class="card" style="border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1.15rem; background: var(--bg-card);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; padding-bottom: 0.65rem; border-bottom: 1px solid var(--border-subtle); flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <span style="font-size: 0.82rem; font-weight: 700; color: var(--wcc-gold); text-transform: uppercase;">
                ${UTILS.escapeHTML(g.matchType)}:
              </span>
              <strong style="font-size: 0.95rem; color: var(--text-primary); margin-left: 5px;">
                ${UTILS.escapeHTML(g.matchValue || '-')}
              </strong>
              <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 6px;">
                (${g.totalCount} accounts found)
              </span>
            </div>
            <button type="button" class="btn btn-sm btn-delete-group" data-ids="${dups.map(d => d.memberId).join(',')}" style="border: 1px solid var(--wcc-crimson); color: var(--wcc-crimson-light); background: transparent; font-size: 0.75rem; padding: 3px 8px; border-radius: 4px; cursor: pointer;">
              🗑️ Delete ${dups.length} Duplicate(s)
            </button>
          </div>

          <!-- Master / Original Record -->
          <div style="background: rgba(46, 204, 113, 0.08); border: 1px solid rgba(46, 204, 113, 0.3); border-radius: var(--radius-sm); padding: 0.6rem 0.85rem; margin-bottom: 0.65rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.65rem;">
              <span class="badge badge-active" style="font-size: 0.7rem; font-weight: 700;">🛡️ ORIGINAL (রাখা হবে)</span>
              <strong style="color: var(--text-primary); font-size: 0.88rem;">${UTILS.escapeHTML(master.name)}</strong>
              <span style="font-family: monospace; font-size: 0.78rem; color: var(--wcc-gold);">${UTILS.escapeHTML(master.memberId)}</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; gap: 0.85rem; align-items: center;">
              <span>📅 Reg: ${UTILS.escapeHTML(master.formattedRegDate || master.timestamp || '-')}</span>
              <span>🩸 ${UTILS.escapeHTML(master.bloodGroup || '-')}</span>
              <span>📞 ${UTILS.escapeHTML(master.phone || '-')}</span>
            </div>
          </div>

          <!-- Redundant Duplicate Records -->
          <div style="display: flex; flex-direction: column; gap: 0.45rem;">
            ${dups.map(d => `
              <div style="background: rgba(231, 76, 60, 0.06); border: 1px dashed rgba(231, 76, 60, 0.35); border-radius: var(--radius-sm); padding: 0.6rem 0.85rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                <div style="display: flex; align-items: center; gap: 0.65rem;">
                  <span class="badge badge-blood" style="font-size: 0.7rem;">⚠️ DUPLICATE</span>
                  <strong style="color: var(--text-primary); font-size: 0.85rem;">${UTILS.escapeHTML(d.name)}</strong>
                  <span style="font-family: monospace; font-size: 0.78rem; color: var(--text-muted);">${UTILS.escapeHTML(d.memberId)}</span>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; gap: 0.75rem; align-items: center;">
                  <span>📅 Reg: ${UTILS.escapeHTML(d.formattedRegDate || d.timestamp || '-')}</span>
                  <span>🩸 ${UTILS.escapeHTML(d.bloodGroup || '-')}</span>
                  <button type="button" class="btn btn-sm btn-single-delete" data-id="${UTILS.escapeHTML(d.memberId || '')}" data-email="${UTILS.escapeHTML(d.email || '')}" data-phone="${UTILS.escapeHTML(d.phone || '')}" style="background: transparent; color: #E74C3C; border: 1px solid rgba(231, 76, 60, 0.4); font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; cursor: pointer;" title="Delete this duplicate">
                    ✕ Delete
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Bind Group Delete Buttons
    container.querySelectorAll('.btn-delete-group').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ids = (btn.getAttribute('data-ids') || '').split(',').map(s => s.trim()).filter(Boolean);
        await executeDeleteMembers(ids);
      });
    });

    // Bind Single Delete Buttons
    container.querySelectorAll('.btn-single-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const email = btn.getAttribute('data-email');
        const phone = btn.getAttribute('data-phone');
        const ids = [id, email, phone].filter(Boolean);
        if (ids.length > 0) await executeDeleteMembers(ids);
      });
    });
  }

  async function executeDeleteMembers(idsToDelete) {
    if (!idsToDelete || idsToDelete.length === 0) return;

    const count = idsToDelete.length;
    const confirmMsg = `আপনি কি নিশ্চিতভাবে অতিরিক্ত ডুপ্লিকেট অ্যাকাউন্ট মুছে ফেলতে চান?\n\nএটি গুগল শিট থেকে স্থায়ীভাবে মুছে যাবে। আসল (Original) অ্যাকাউন্ট অক্ষত থাকবে।`;

    if (!confirm(confirmMsg)) return;

    btnDeleteAll.disabled = true;
    btnDeleteAll.innerHTML = `<span>⏳</span> Deleting...`;
    UTILS.showToast(`Deleting duplicate account(s)...`, 'info');

    try {
      const res = await API.deleteMembers(idsToDelete);
      if (res.success) {
        UTILS.showToast(res.message || `Duplicate account(s) deleted successfully!`, 'success');
        // Refresh directory data
        allMembersData = await API.fetchMembers();
        filteredMembersData = [...allMembersData];
        populateFilterDropdowns(allMembersData);
        applyFiltersAndSort();
        renderDuplicates();
      } else {
        UTILS.showToast(res.message || 'Failed to delete duplicate accounts.', 'error');
      }
    } catch (e) {
      console.error('Delete duplicate error:', e);
      UTILS.showToast('Error deleting accounts: ' + e.message, 'error');
    } finally {
      btnDeleteAll.disabled = false;
      btnDeleteAll.innerHTML = `<span>🗑️</span> 1-Click Delete All Duplicates`;
    }
  }

  if (!duplicateFeatureInitialized) {
    duplicateFeatureInitialized = true;

    btnOpen.addEventListener('click', () => {
      modal.classList.add('active');
      renderDuplicates();
    });

    const closeModal = () => modal.classList.remove('active');
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCloseFooter) btnCloseFooter.addEventListener('click', closeModal);

    btnDeleteAll.addEventListener('click', async () => {
      const groups = UTILS.findDuplicateGroups(allMembersData);
      const allDupIdentifiers = [];
      groups.forEach(g => {
        g.duplicates.forEach(d => {
          if (d.memberId) allDupIdentifiers.push(d.memberId);
          if (d.email) allDupIdentifiers.push(d.email);
          if (d.phone) allDupIdentifiers.push(d.phone);
        });
      });
      if (allDupIdentifiers.length === 0) {
        UTILS.showToast('No duplicate accounts to delete.', 'info');
        return;
      }
      await executeDeleteMembers(allDupIdentifiers);
    });
  }

  // Initial badge update
  updateBadge();
}
