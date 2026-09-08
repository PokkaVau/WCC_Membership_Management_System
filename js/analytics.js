/**
 * WCC Membership Management System - Analytics Controller
 * Renders 6 comprehensive Chart.js charts: Blood Group, Gender, District,
 * Upazila, Age Demographics, and Registration Timeline Trends.
 */

let charts = {};

document.addEventListener('DOMContentLoaded', async () => {
  AUTH.requireAdmin();
  AUTH.initUIComponents();

  await loadAnalytics();

  // Handle dark/light theme switch
  window.addEventListener('wcc-theme-changed', async () => {
    const members = await API.fetchMembers();
    renderAllCharts(members);
  });
});

async function loadAnalytics() {
  try {
    const members = await API.fetchMembers();
    renderSummaryBadges(members);
    renderAllCharts(members);
  } catch (err) {
    console.error('Analytics Error:', err);
    UTILS.showToast('Unable to load analytics data', 'error');
  }
}

function renderSummaryBadges(members) {
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };

  setVal('analyticsTotal', members.length);
  setVal('analyticsDistricts', new Set(members.map(m => m.district).filter(Boolean)).size);
  setVal('analyticsUpazilas', new Set(members.map(m => m.upazila).filter(Boolean)).size);
  const avgAge = Math.round(
    members.filter(m => m.age !== null).reduce((sum, m) => sum + m.age, 0) /
    (members.filter(m => m.age !== null).length || 1)
  );
  setVal('analyticsAvgAge', `${avgAge} yrs`);
}

function renderAllCharts(members) {
  if (typeof Chart === 'undefined') return;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#D1D5DB' : '#4B5563';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

  Chart.defaults.color = textColor;
  Chart.defaults.font.family = "'Poppins', sans-serif";

  // Destroy existing chart instances before rebuilding
  Object.values(charts).forEach(c => { if (c) c.destroy(); });
  charts = {};

  // 1. Members by Blood Group
  const bloodLabels = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
  const bloodCounts = bloodLabels.map(bg => members.filter(m => m.bloodGroup === bg).length);
  const bloodCtx = document.getElementById('chartBloodGroup');
  if (bloodCtx) {
    charts.blood = new Chart(bloodCtx, {
      type: 'bar',
      data: {
        labels: bloodLabels,
        datasets: [{
          label: 'Total Members',
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
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: gridColor }, ticks: { stepSize: 1 } }
        }
      }
    });
  }

  // 2. Members by Gender
  const maleCount = members.filter(m => (m.gender || '').toLowerCase() === 'male').length;
  const femaleCount = members.filter(m => (m.gender || '').toLowerCase() === 'female').length;
  const otherGenderCount = members.length - maleCount - femaleCount;
  const genderCtx = document.getElementById('chartGender');
  if (genderCtx) {
    charts.gender = new Chart(genderCtx, {
      type: 'doughnut',
      data: {
        labels: ['Male', 'Female', 'Other'],
        datasets: [{
          data: [maleCount, femaleCount, otherGenderCount],
          backgroundColor: ['#1D3557', '#B62A35', '#F1AD1A'],
          borderColor: isDark ? '#191D24' : '#FFFFFF',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        },
        cutout: '65%'
      }
    });
  }

  // 3. Members by District (Top Districts)
  const districtCounts = {};
  members.forEach(m => {
    const d = m.district || 'Unspecified';
    districtCounts[d] = (districtCounts[d] || 0) + 1;
  });
  const sortedDistricts = Object.entries(districtCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const districtCtx = document.getElementById('chartDistrict');
  if (districtCtx) {
    charts.district = new Chart(districtCtx, {
      type: 'bar',
      indexAxis: 'y',
      data: {
        labels: sortedDistricts.map(d => d[0]),
        datasets: [{
          label: 'Members',
          data: sortedDistricts.map(d => d[1]),
          backgroundColor: '#F1AD1A',
          borderColor: '#A6772A',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: gridColor }, ticks: { stepSize: 1 } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  // 4. Members by Upazila (Top Upazilas)
  const upazilaCounts = {};
  members.forEach(m => {
    const u = m.upazila || 'Unspecified';
    upazilaCounts[u] = (upazilaCounts[u] || 0) + 1;
  });
  const sortedUpazilas = Object.entries(upazilaCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const upazilaCtx = document.getElementById('chartUpazila');
  if (upazilaCtx) {
    charts.upazila = new Chart(upazilaCtx, {
      type: 'bar',
      data: {
        labels: sortedUpazilas.map(u => u[0]),
        datasets: [{
          label: 'Members',
          data: sortedUpazilas.map(u => u[1]),
          backgroundColor: '#169053',
          borderColor: '#F1AD1A',
          borderWidth: 1,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: gridColor }, ticks: { stepSize: 1 } }
        }
      }
    });
  }

  // 5. Members by Age Group
  const ageGroups = {
    'Under 18': 0,
    '18–25': 0,
    '26–35': 0,
    '36–50': 0,
    '50+': 0
  };

  members.forEach(m => {
    const age = m.age;
    if (age !== null) {
      if (age < 18) ageGroups['Under 18']++;
      else if (age <= 25) ageGroups['18–25']++;
      else if (age <= 35) ageGroups['26–35']++;
      else if (age <= 50) ageGroups['36–50']++;
      else ageGroups['50+']++;
    }
  });

  const ageCtx = document.getElementById('chartAgeGroup');
  if (ageCtx) {
    charts.age = new Chart(ageCtx, {
      type: 'pie',
      data: {
        labels: Object.keys(ageGroups),
        datasets: [{
          data: Object.values(ageGroups),
          backgroundColor: ['#169053', '#F1AD1A', '#B62A35', '#1D3557', '#6B7280'],
          borderColor: isDark ? '#191D24' : '#FFFFFF',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });
  }

  // 6. Registration Timeline Trend
  const trendCounts = {};
  members.forEach(m => {
    if (m.registrationDate) {
      // Group by Month e.g., "2026-01"
      const ym = m.registrationDate.substring(0, 7);
      trendCounts[ym] = (trendCounts[ym] || 0) + 1;
    }
  });

  const sortedMonths = Object.keys(trendCounts).sort();
  const trendLabels = sortedMonths.map(ym => {
    const [y, m] = ym.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(m, 10) - 1]} ${y}`;
  });

  const trendCtx = document.getElementById('chartRegistrationTrend');
  if (trendCtx) {
    charts.trend = new Chart(trendCtx, {
      type: 'line',
      data: {
        labels: trendLabels.length ? trendLabels : ['Jan 2026', 'Feb 2026', 'Mar 2026'],
        datasets: [{
          label: 'Registrations',
          data: sortedMonths.length ? sortedMonths.map(k => trendCounts[k]) : [5, 12, 18],
          borderColor: '#F1AD1A',
          backgroundColor: 'rgba(241, 173, 26, 0.15)',
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#B62A35',
          pointBorderColor: '#F1AD1A',
          pointRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { grid: { color: gridColor } },
          y: { grid: { color: gridColor }, ticks: { stepSize: 1 } }
        }
      }
    });
  }

  // 7. Members by Wing (Form-V2 Wings)
  const officialWings = CONFIG.WCC_WINGS || [
    'শিক্ষা উইং',
    'সাংস্কৃতিক উইং',
    'স্বাস্থ্য উইং',
    'খেলাধুলা উইং',
    'পরিবেশ সংরক্ষণ উইং'
  ];
  const wingCounts = officialWings.map(wing => {
    return members.filter(m => (m.wing || '').trim() === wing).length;
  });
  // Also count any others
  const otherWingCount = members.filter(m => m.wing && !officialWings.includes(m.wing.trim())).length;
  const wingLabels = [...officialWings];
  const wingData = [...wingCounts];
  if (otherWingCount > 0) {
    wingLabels.push('অন্যান্য');
    wingData.push(otherWingCount);
  }

  const wingCtx = document.getElementById('chartWing');
  if (wingCtx) {
    charts.wing = new Chart(wingCtx, {
      type: 'polarArea',
      data: {
        labels: wingLabels,
        datasets: [{
          data: wingData,
          backgroundColor: [
            'rgba(22, 144, 83, 0.75)',
            'rgba(241, 173, 26, 0.75)',
            'rgba(182, 42, 53, 0.75)',
            'rgba(29, 53, 87, 0.75)',
            'rgba(142, 68, 173, 0.75)',
            'rgba(108, 117, 125, 0.75)'
          ],
          borderColor: isDark ? '#191D24' : '#FFFFFF',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12 } }
        },
        scales: {
          r: {
            grid: { color: gridColor },
            ticks: { display: false }
          }
        }
      }
    });
  }

  // 8. Members by Membership Type (General vs Lifetime)
  const generalCount = members.filter(m => (m.membershipType || '').toLowerCase().includes('general') || (m.membershipType || '').includes('সাধারণ')).length;
  const lifetimeCount = members.filter(m => (m.membershipType || '').toLowerCase().includes('lifetime') || (m.membershipType || '').includes('আজীবন')).length;
  const otherMembershipCount = members.length - generalCount - lifetimeCount;

  const membershipCtx = document.getElementById('chartMembershipType');
  if (membershipCtx) {
    charts.membership = new Chart(membershipCtx, {
      type: 'doughnut',
      data: {
        labels: ['General Member', 'Lifetime Member', 'Other'],
        datasets: [{
          data: [generalCount, lifetimeCount, Math.max(0, otherMembershipCount)],
          backgroundColor: ['#169053', '#F1AD1A', '#6B7280'],
          borderColor: isDark ? '#191D24' : '#FFFFFF',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        },
        cutout: '60%'
      }
    });
  }
}
