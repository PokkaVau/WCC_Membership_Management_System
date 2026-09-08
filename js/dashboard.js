/**
 * WCC Membership Management System - Dashboard Controller
 * Computes live metrics, renders recent activity, and manages preview charts.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Session verification & role guard (Admins only)
  AUTH.requireAdmin();
  AUTH.initUIComponents();

  // 2. Load dashboard data
  await loadDashboard();

  // Wire refresh button if present
  const refreshBtn = document.getElementById('refreshDashboardBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('loading');
      await loadDashboard(true);
      refreshBtn.classList.remove('loading');
      UTILS.showToast('Dashboard data refreshed', 'success');
    });
  }

  // Auto-update dashboard when background revalidation finishes
  window.addEventListener('wcc-members-refreshed', (e) => {
    if (e.detail && Array.isArray(e.detail.members) && e.detail.members.length > 0) {
      calculateAndRenderMetrics(e.detail.members);
      renderRecentMembers(e.detail.members);
      renderPreviewCharts(e.detail.members);
    }
  });
});

let bloodPreviewChart = null;
let genderPreviewChart = null;

async function loadDashboard(forceRefresh = false) {
  try {
    const members = await API.fetchMembers(forceRefresh);
    calculateAndRenderMetrics(members);
    renderRecentMembers(members);
    renderPreviewCharts(members);
  } catch (err) {
    console.error('Error loading dashboard:', err);
    UTILS.showToast('Unable to load member data. Please check connection.', 'error');
  }
}

/**
 * Compute all 8 KPI metrics dynamically from the live dataset
 */
function calculateAndRenderMetrics(members) {
  const total = members.length;
  let active = 0;
  let pending = 0;
  let inactive = 0;
  let male = 0;
  let female = 0;
  let students = 0;
  let professionals = 0;

  members.forEach(m => {
    const st = (m.status || '').toLowerCase();
    if (st === 'active') active++;
    else if (st === 'pending') pending++;
    else inactive++; // inactive, suspended, or rejected

    const g = (m.gender || '').toLowerCase();
    if (g === 'male') male++;
    else if (g === 'female') female++;

    if (m.isStudent) {
      students++;
    } else if (m.profession && !m.profession.toLowerCase().includes('student')) {
      professionals++;
    }
  });

  // Update DOM elements safely
  const updateEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  updateEl('metricTotalMembers', total);
  updateEl('metricActiveMembers', active);
  updateEl('metricInactiveMembers', inactive);
  updateEl('metricMaleMembers', male);
  updateEl('metricFemaleMembers', female);
  updateEl('metricStudentMembers', students);
  updateEl('metricProfessionalMembers', professionals);

  // Top Demographic Strip
  updateEl('stripTotal', total);
  updateEl('stripActiveRatio', total > 0 ? Math.round((active / total) * 100) + '%' : '0%');
  updateEl('stripDistricts', new Set(members.map(m => m.district).filter(Boolean)).size);
  updateEl('stripStudents', students);
}

/**
 * Render the 5 most recent registrations
 */
function renderRecentMembers(members) {
  const container = document.getElementById('recentMembersTableBody');
  if (!container) return;

  if (!members || members.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="empty-state">No recent members found.</td></tr>`;
    return;
  }

  // Sort by registration date descending or memberId
  const sorted = [...members].sort((a, b) => {
    const da = new Date(a.registrationDate || 0);
    const db = new Date(b.registrationDate || 0);
    return db - da;
  }).slice(0, 6);

  container.innerHTML = sorted.map(m => `
    <tr>
      <td>
        <img src="${UTILS.escapeHTML(m.photoUrl)}" 
             alt="${UTILS.escapeHTML(m.name)}" 
             class="member-cell-photo" 
             onerror="this.onerror=null;this.src='${CONFIG.ORG_INFO.defaultAvatarPath}';" />
      </td>
      <td>
        <div class="member-cell-name">
          <a href="member.html?id=${encodeURIComponent(m.memberId)}" style="color:inherit; text-decoration:none;">
            ${UTILS.escapeHTML(m.name)}
          </a>
          <span class="member-cell-id">${UTILS.escapeHTML(m.memberId)}</span>
        </div>
      </td>
      <td>${UTILS.renderBloodBadge(m.bloodGroup)}</td>
      <td>${UTILS.escapeHTML(m.district || 'Not provided')}</td>
      <td>${UTILS.renderStatusBadge(m.status)}</td>
      <td>
        <div class="table-actions">
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

/**
 * Direct PDF download helper for recent members table
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

/**
 * Render Dashboard Chart Previews
 */
function renderPreviewCharts(members) {
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js library is not loaded; dashboard preview charts skipped.');
    return;
  }

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#D1D5DB' : '#4B5563';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

  // 1. Blood Group Distribution Chart
  const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
  const bloodCounts = bloodGroups.map(bg => members.filter(m => m.bloodGroup === bg).length);

  const bloodCanvas = document.getElementById('bloodPreviewChart');
  if (bloodCanvas) {
    if (bloodPreviewChart) bloodPreviewChart.destroy();
    bloodPreviewChart = new Chart(bloodCanvas, {
      type: 'bar',
      data: {
        labels: bloodGroups,
        datasets: [{
          label: 'Members',
          data: bloodCounts,
          backgroundColor: '#B62A35',
          borderColor: '#F1AD1A',
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#191D24',
            titleColor: '#F1AD1A',
            borderColor: '#F1AD1A',
            borderWidth: 1
          }
        },
        scales: {
          x: {
            ticks: { color: textColor },
            grid: { display: false }
          },
          y: {
            ticks: { color: textColor, stepSize: 1 },
            grid: { color: gridColor }
          }
        }
      }
    });
  }

  // 2. Gender Ratio Chart
  const maleCount = members.filter(m => (m.gender || '').toLowerCase() === 'male').length;
  const femaleCount = members.filter(m => (m.gender || '').toLowerCase() === 'female').length;
  const otherCount = members.length - maleCount - femaleCount;

  const genderCanvas = document.getElementById('genderPreviewChart');
  if (genderCanvas) {
    if (genderPreviewChart) genderPreviewChart.destroy();
    genderPreviewChart = new Chart(genderCanvas, {
      type: 'doughnut',
      data: {
        labels: ['Male', 'Female', 'Other'],
        datasets: [{
          data: [maleCount, femaleCount, otherCount],
          backgroundColor: ['#1D3557', '#B62A35', '#F1AD1A'],
          borderColor: isDark ? '#191D24' : '#FFFFFF',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: textColor, font: { family: 'Poppins' } }
          },
          tooltip: {
            backgroundColor: '#191D24',
            titleColor: '#F1AD1A'
          }
        },
        cutout: '70%'
      }
    });
  }
}

// Re-render preview charts on theme toggle
window.addEventListener('wcc-theme-changed', async () => {
  const members = await API.fetchMembers();
  renderPreviewCharts(members);
});
