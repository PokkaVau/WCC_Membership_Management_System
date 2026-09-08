/**
 * WCC Membership Management System - Membership Card Studio Controller
 * Renders ID-1 standard membership cards (Front & Back) with QR codes,
 * and handles PNG download, PDF download, and direct printing.
 */

let activeCardMember = null;

document.addEventListener('DOMContentLoaded', async () => {
  AUTH.requireAuth();
  AUTH.initUIComponents();

  await initializeCardStudio();
});

async function initializeCardStudio() {
  try {
    const allMembers = await API.fetchMembers();
    populateMemberSelector(allMembers);

    const urlParams = new URLSearchParams(window.location.search);
    const targetId = urlParams.get('id');

    let selected = null;
    if (targetId) {
      selected = allMembers.find(m => m.memberId.toLowerCase() === targetId.toLowerCase());
    }
    if (!selected && allMembers.length > 0) {
      selected = allMembers[0];
    }

    if (selected) {
      const selectEl = document.getElementById('cardMemberSelect');
      if (selectEl) selectEl.value = selected.memberId;
      renderMembershipCard(selected);
    }

    bindCardActions();
  } catch (e) {
    console.error('Card Studio Initialization Error:', e);
    UTILS.showToast('Failed to load card studio data', 'error');
  }
}

function populateMemberSelector(members) {
  const select = document.getElementById('cardMemberSelect');
  if (!select) return;

  select.innerHTML = members.map(m => `
    <option value="${UTILS.escapeHTML(m.memberId)}">
      ${UTILS.escapeHTML(m.name)} (${UTILS.escapeHTML(m.memberId)}) - ${UTILS.escapeHTML(m.status)}
    </option>
  `).join('');

  select.addEventListener('change', async (e) => {
    const m = await API.fetchMemberById(e.target.value);
    if (m) renderMembershipCard(m);
  });
}

/**
 * Render Front and Back card templates
 */
function renderMembershipCard(m) {
  activeCardMember = m;

  // 1. Front Elements
  const frontPhoto = document.getElementById('cardFrontPhoto');
  const frontName = document.getElementById('cardFrontName');
  const frontId = document.getElementById('cardFrontId');
  const frontBlood = document.getElementById('cardFrontBlood');
  const frontStatus = document.getElementById('cardFrontStatus');
  const frontType = document.getElementById('cardFrontType');

  if (frontPhoto) {
    frontPhoto.src = m.photoUrl;
    frontPhoto.onerror = () => { frontPhoto.src = CONFIG.ORG_INFO.defaultAvatarPath; };
  }
  if (frontName) frontName.textContent = m.name;
  if (frontId) frontId.textContent = m.memberId;
  if (frontBlood) frontBlood.textContent = m.bloodGroup || 'N/A';
  if (frontStatus) frontStatus.textContent = (m.status || 'Pending').toUpperCase();
  if (frontType) frontType.textContent = m.membershipType || 'General Member';

  // 2. Back Elements
  const backId = document.getElementById('cardBackId');
  const backQrContainer = document.getElementById('cardBackQr');
  const backIssueDate = document.getElementById('cardBackIssueDate');

  if (backId) backId.textContent = m.memberId;
  if (backIssueDate) backIssueDate.textContent = m.formattedJoiningDate !== 'Not provided' ? m.formattedJoiningDate : m.formattedRegDate;

  if (backQrContainer) {
    const verifyUrl = `${CONFIG.VERIFY_BASE_URL}?id=${encodeURIComponent(m.memberId)}`;
    QR_SYSTEM.renderQRCode(backQrContainer, verifyUrl, 66);
  }
}

/**
 * Bind Card Studio actions (Download PNG, Download PDF, Print)
 */
function bindCardActions() {
  // Download Front PNG
  const dlFrontBtn = document.getElementById('btnDownloadCardFrontPng');
  if (dlFrontBtn) {
    dlFrontBtn.addEventListener('click', () => downloadCardSidePng('cardFront', `WCC-Card-Front-${activeCardMember.memberId}.png`));
  }

  // Download Back PNG
  const dlBackBtn = document.getElementById('btnDownloadCardBackPng');
  if (dlBackBtn) {
    dlBackBtn.addEventListener('click', () => downloadCardSidePng('cardBack', `WCC-Card-Back-${activeCardMember.memberId}.png`));
  }

  // Download PDF
  const dlPdfBtn = document.getElementById('btnDownloadCardPdf');
  if (dlPdfBtn) {
    dlPdfBtn.addEventListener('click', generateCardPDF);
  }

  // Print Card
  const printBtn = document.getElementById('btnPrintCard');
  if (printBtn) {
    printBtn.addEventListener('click', () => window.print());
  }
}

/**
 * Capture card HTML element and download as high-resolution PNG
 */
async function downloadCardSidePng(elementId, filename) {
  if (typeof html2canvas === 'undefined') {
    UTILS.showToast('html2canvas library not loaded', 'error');
    return;
  }

  const el = document.getElementById(elementId);
  if (!el) return;

  try {
    UTILS.showToast('Rendering high-res card image...', 'info');
    const canvas = await html2canvas(el, {
      scale: 3, // 3x high DPI
      useCORS: true,
      backgroundColor: null
    });

    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    UTILS.showToast('Card image saved!', 'success');
  } catch (err) {
    console.error('html2canvas error:', err);
    UTILS.showToast('Failed to export card image.', 'error');
  }
}

/**
 * Generate official printable PDF with Front and Back side of Membership Card
 */
async function generateCardPDF() {
  if (!activeCardMember) return;
  if (!window.jspdf || !window.jspdf.jsPDF || typeof html2canvas === 'undefined') {
    UTILS.showToast('Libraries required for PDF not ready', 'error');
    return;
  }

  try {
    UTILS.showToast('Preparing Card PDF...', 'info');
    const frontEl = document.getElementById('cardFront');
    const backEl = document.getElementById('cardBack');

    const frontCanvas = await html2canvas(frontEl, { scale: 3, useCORS: true });
    const backCanvas = await html2canvas(backEl, { scale: 3, useCORS: true });

    const frontImg = frontCanvas.toDataURL('image/png');
    const backImg = backCanvas.toDataURL('image/png');

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(29, 53, 87);
    doc.text('WE CAN CHANGE (WCC)', 105, 25, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 110, 120);
    const hasBengali = (str) => /[\u0980-\u09FF]/.test(str || '');
    const safeDisplayName = (activeCardMember.nameEn && !hasBengali(activeCardMember.nameEn))
      ? activeCardMember.nameEn
      : (!hasBengali(activeCardMember.name) ? activeCardMember.name : '');
    const memberSubtitle = safeDisplayName
      ? `Member: ${safeDisplayName} (${activeCardMember.memberId})`
      : `Member Identification Record: ${activeCardMember.memberId}`;
    doc.text(memberSubtitle, 105, 37, { align: 'center' });

    // Standard card dimensions in mm: 85.6mm x 53.98mm
    const cardWidth = 85.6;
    const cardHeight = 54;
    const startX = (210 - cardWidth) / 2;

    // Place Front Card
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text('FRONT SIDE', startX, 48);
    doc.addImage(frontImg, 'PNG', startX, 52, cardWidth, cardHeight);

    // Place Back Card
    doc.text('BACK SIDE (QR VERIFICATION)', startX, 120);
    doc.addImage(backImg, 'PNG', startX, 124, cardWidth, cardHeight);

    // Cut guide instructions
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text('Print Instructions: Print at 100% scale (no scaling) on heavy cardstock or PVC.', 105, 195, { align: 'center' });
    doc.text('Cut along the card border and laminate for official organizational use.', 105, 200, { align: 'center' });

    const filename = `WCC-Card-${activeCardMember.memberId}.pdf`;
    doc.save(filename);
    UTILS.showToast(`Saved ${filename}`, 'success');
  } catch (err) {
    console.error('Card PDF error:', err);
    UTILS.showToast('Failed to create Card PDF', 'error');
  }
}
