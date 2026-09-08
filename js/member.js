/**
 * WCC Membership Management System - Individual Member Profile Controller
 * Displays comprehensive member details across personal, address, educational,
 * professional, and WCC sections, with dynamic age, status editing, PDF, and QR modal.
 */

let currentMember = null;

document.addEventListener('DOMContentLoaded', async () => {
  AUTH.requireAuth();
  AUTH.initUIComponents();

  const urlParams = new URLSearchParams(window.location.search);
  const memberId = urlParams.get('id');

  // Enforce Member Privacy: General members cannot inspect other members' admin views
  const currentUser = AUTH.getCurrentUser();
  if (AUTH.isMember()) {
    if (!memberId || (currentUser && currentUser.memberId !== memberId)) {
      window.location.href = 'my-profile.html';
      return;
    }
  }

  if (!memberId) {
    showMemberNotFound('No Member ID specified in the URL.');
    return;
  }

  await loadMemberProfile(memberId);
});

async function loadMemberProfile(memberId) {
  try {
    currentMember = await API.fetchMemberById(memberId);
    if (!currentMember) {
      showMemberNotFound(`Member "${memberId}" was not found in the records.`);
      return;
    }

    renderProfileHeader(currentMember);
    renderProfileSections(currentMember);
    bindProfileActions(currentMember);
  } catch (err) {
    console.error('Error fetching member profile:', err);
    showMemberNotFound('An error occurred while loading member details.');
  }
}

/**
 * Render Top Hero Profile Header
 */
function renderProfileHeader(m) {
  const photoEl = document.getElementById('profilePhoto');
  const nameEl = document.getElementById('profileName');
  const idEl = document.getElementById('profileId');
  const statusEl = document.getElementById('profileStatusBadge');

  if (photoEl) {
    photoEl.src = m.photoUrl;
    photoEl.alt = m.name;
    photoEl.onerror = () => {
      photoEl.src = CONFIG.ORG_INFO.defaultAvatarPath;
    };
  }

  if (nameEl) nameEl.textContent = m.name;
  if (idEl) idEl.textContent = m.memberId;
  if (statusEl) statusEl.innerHTML = UTILS.renderStatusBadge(m.status);

  // Set document title
  document.title = `${m.name} (${m.memberId}) - WCC Member Profile`;
}

/**
 * Render structured information sections
 */
function renderProfileSections(m) {
  const renderField = (label, val, isHtml = false) => {
    const isProvided = val !== null && val !== undefined && String(val).trim() !== '';
    let displayVal = 'Not provided';
    if (isProvided) {
      displayVal = isHtml ? val : UTILS.escapeHTML(val);
    }
    const cssClass = isProvided ? 'profile-field-value' : 'profile-field-value not-provided';
    return `
      <div class="profile-field-item">
        <span class="profile-field-label">${label}</span>
        <span class="${cssClass}">${displayVal}</span>
      </div>
    `;
  };

  // 1. Personal Information
  const ageDisplay = m.age !== null ? `${m.age} years` : 'Not provided';
  const personalContainer = document.getElementById('personalInfoGrid');
  if (personalContainer) {
    personalContainer.innerHTML = `
      ${renderField('Full Name (English)', m.name)}
      ${renderField('পূর্ণ নাম (বাংলা)', m.nameBn)}
      ${renderField("Father's Name", m.father)}
      ${renderField("Mother's Name", m.mother)}
      ${renderField('NID / Birth Reg No', m.nid)}
      ${renderField('Date of Birth', m.formattedDob)}
      ${renderField('Calculated Age', ageDisplay)}
      ${renderField('Blood Group', UTILS.renderBloodBadge(m.bloodGroup), true)}
      ${renderField('Mobile Number', m.phone)}
      ${renderField('Email Address', m.email)}
    `;
  }

  // 2. Address Details
  const addressContainer = document.getElementById('addressInfoGrid');
  if (addressContainer) {
    addressContainer.innerHTML = `
      ${renderField('Present Address (বর্তমান ঠিকানা)', m.presentAddress)}
      ${renderField('Permanent Address (স্থায়ী ঠিকানা)', m.permanentAddress)}
    `;
  }

  // 3. Educational Information (Dynamically toggles based on currently studying vs graduated)
  const eduContainer = document.getElementById('educationInfoGrid');
  if (eduContainer) {
    const isStudying = (m.currentlyStudying === 'হ্যাঁ' || (m.currentlyStudying && String(m.currentlyStudying).toLowerCase().includes('yes')));
    if (isStudying) {
      eduContainer.innerHTML = `
        ${renderField('Currently Studying (বর্তমানে অধ্যয়নরত)', '<span class="badge badge-active">📖 হ্যাঁ (অধ্যয়নরত / Student)</span>', true)}
        ${renderField('Class / Year (কোন শ্রেণি/বর্ষে অধ্যয়নরত)', m.classYear || '-')}
        ${renderField('Current Institution (বর্তমান প্রতিষ্ঠান)', m.currentInstitution || m.institution || '-')}
        ${renderField('Last Public Exam (বিগত পাবলিক পরীক্ষা)', m.lastPublicExam || '-')}
        ${renderField('Public Exam Result (পাবলিক পরীক্ষার ফলাফল)', m.publicExamResult || '-')}
      `;
    } else {
      eduContainer.innerHTML = `
        ${renderField('Currently Studying (বর্তমানে অধ্যয়নরত)', '<span class="badge" style="background: rgba(255,255,255,0.08); color: var(--text-muted); border: 1px solid var(--border-color);">🎓 না (স্নাতক / পাশকৃত / Graduated)</span>', true)}
        ${renderField('Last Qualification (সর্বশেষ শিক্ষাগত যোগ্যতা)', m.lastQualification || m.degree || '-')}
        ${renderField('Last Result (সর্বশেষ একাডেমিক ফলাফল)', m.lastResult || '-')}
        ${renderField('Last Institution (সর্বশেষ প্রতিষ্ঠানের নাম)', m.lastInstitution || '-')}
        ${m.lastPublicExam ? renderField('Public Exam (বিগত পাবলিক পরীক্ষা)', `${m.lastPublicExam} ${m.publicExamResult ? `(${m.publicExamResult})` : ''}`) : ''}
      `;
    }
  }

  // 4. Professional Information
  const profContainer = document.getElementById('professionalInfoGrid');
  if (profContainer) {
    profContainer.innerHTML = `
      ${renderField('Profession (পেশা)', m.profession)}
      ${renderField('Workplace (কর্মস্থল / প্রতিষ্ঠান)', m.workplace || m.organization)}
    `;
  }

  // 5. WCC Membership Information
  const wccContainer = document.getElementById('wccInfoGrid');
  if (wccContainer) {
    wccContainer.innerHTML = `
      ${renderField('Member ID', m.memberId)}
      ${renderField('Membership Type', m.membershipType || 'General Member')}
      ${renderField('Assigned Wing', m.wing || 'General Wing')}
      ${renderField('Reason for Joining', m.reason)}
      ${renderField('Application Timestamp', m.formattedRegDate)}
      <div class="profile-field-item">
        <span class="profile-field-label">Membership Status</span>
        <span class="profile-field-value">${UTILS.renderStatusBadge(m.status)}</span>
      </div>
    `;
  }
}

/**
 * Bind Action Buttons (Back, Edit Status, PDF, Card, QR, Print)
 */
function bindProfileActions(m) {
  // Back button
  const backBtn = document.getElementById('btnBackToMembers');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = 'members.html';
    });
  }

  // Edit Status Modal Trigger
  const editStatusBtn = document.getElementById('btnEditStatus');
  const editStatusModal = document.getElementById('editStatusModal');
  const statusSelect = document.getElementById('modalStatusSelect');
  const saveStatusBtn = document.getElementById('btnSaveStatus');
  const closeStatusModalBtn = document.getElementById('btnCloseStatusModal');
  const cancelStatusModalBtn = document.getElementById('btnCancelStatusModal');

  if (editStatusBtn && editStatusModal) {
    editStatusBtn.addEventListener('click', () => {
      if (statusSelect) statusSelect.value = m.status || 'Pending';
      editStatusModal.classList.add('active');
    });

    const closeModal = () => editStatusModal.classList.remove('active');
    if (closeStatusModalBtn) closeStatusModalBtn.addEventListener('click', closeModal);
    if (cancelStatusModalBtn) cancelStatusModalBtn.addEventListener('click', closeModal);

    if (saveStatusBtn && statusSelect) {
      saveStatusBtn.addEventListener('click', async () => {
        const newStatus = statusSelect.value;
        saveStatusBtn.classList.add('loading');
        try {
          await API.updateMemberStatus(m.memberId, newStatus);
          m.status = newStatus;
          renderProfileHeader(m);
          renderProfileSections(m);
          closeModal();
          UTILS.showToast(`Member status updated to ${newStatus}`, 'success');
        } catch (e) {
          UTILS.showToast('Failed to update status', 'error');
        } finally {
          saveStatusBtn.classList.remove('loading');
        }
      });
    }
  }

  // Edit Member Profile Modal (with dynamic conditional educational logic)
  const editProfileBtn = document.getElementById('btnEditMemberProfile');
  const editProfileModal = document.getElementById('editProfileModal');
  const closeEditModalBtn = document.getElementById('btnCloseEditModal');
  const cancelEditModalBtn = document.getElementById('btnCancelEditModal');
  const editProfileForm = document.getElementById('editProfileForm');

  if (editProfileBtn && editProfileModal && editProfileForm) {
    const studyRadios = editProfileForm.querySelectorAll('input[name="admin_currently_studying"]');
    const studyingYesBlock = document.getElementById('adminStudyingYesBlock');
    const studyingNoBlock = document.getElementById('adminStudyingNoBlock');
    const YES_REQUIRED_IDS = ['editClassYear', 'editCurrentInstitution'];
    const NO_REQUIRED_IDS = ['editLastQualification', 'editLastResult', 'editLastInstitution'];

    function clearModalField(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = '';
      el.required = false;
    }

    function updateStudyBlocks(preserveValues = false) {
      const checked = editProfileForm.querySelector('input[name="admin_currently_studying"]:checked');
      const val = checked ? checked.value : null;

      if (val === 'হ্যাঁ') {
        if (studyingYesBlock) studyingYesBlock.classList.add('open');
        if (studyingNoBlock) studyingNoBlock.classList.remove('open');
        YES_REQUIRED_IDS.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.required = true;
        });
        NO_REQUIRED_IDS.forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            el.required = false;
            if (!preserveValues) el.value = '';
          }
        });
      } else if (val === 'না') {
        if (studyingNoBlock) studyingNoBlock.classList.add('open');
        if (studyingYesBlock) studyingYesBlock.classList.remove('open');
        NO_REQUIRED_IDS.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.required = true;
        });
        YES_REQUIRED_IDS.forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            el.required = false;
            if (!preserveValues) el.value = '';
          }
        });
        if (!preserveValues) {
          clearModalField('editLastPublicExam');
          clearModalField('editPublicExamResult');
        }
      } else {
        if (studyingYesBlock) studyingYesBlock.classList.remove('open');
        if (studyingNoBlock) studyingNoBlock.classList.remove('open');
        YES_REQUIRED_IDS.concat(NO_REQUIRED_IDS).forEach(clearModalField);
      }
    }

    studyRadios.forEach(r => r.addEventListener('change', () => updateStudyBlocks(false)));

    editProfileBtn.addEventListener('click', () => {
      document.getElementById('editPhone').value = m.phone || '';
      document.getElementById('editEmail').value = m.email || '';
      document.getElementById('editPresentAddress').value = m.presentAddress || '';
      document.getElementById('editPermanentAddress').value = m.permanentAddress || '';

      const isStudying = (m.currentlyStudying === 'হ্যাঁ' || (m.currentlyStudying && String(m.currentlyStudying).toLowerCase().includes('yes')));
      const yesRadio = document.getElementById('admin_study_yes');
      const noRadio = document.getElementById('admin_study_no');
      if (isStudying) {
        if (yesRadio) yesRadio.checked = true;
      } else {
        if (noRadio) noRadio.checked = true;
      }

      document.getElementById('editClassYear').value = m.classYear || '';
      document.getElementById('editCurrentInstitution').value = m.currentInstitution || m.institution || '';
      document.getElementById('editLastPublicExam').value = m.lastPublicExam || '';
      document.getElementById('editPublicExamResult').value = m.publicExamResult || '';

      document.getElementById('editLastQualification').value = m.lastQualification || m.degree || '';
      document.getElementById('editLastResult').value = m.lastResult || '';
      document.getElementById('editLastInstitution').value = m.lastInstitution || '';

      updateStudyBlocks(true);

      document.getElementById('editProfession').value = m.profession || '';
      document.getElementById('editWorkplace').value = m.workplace || m.organization || '';
      document.getElementById('editGender').value = m.gender || '';
      document.getElementById('editBloodGroup').value = m.bloodGroup || '';
      document.getElementById('editPhoto').value = m.photo || m.photoUrl || '';
      
      const photoPreview = document.getElementById('editPhotoPreview');
      if (photoPreview) photoPreview.src = m.photoUrl || m.photo || CONFIG.ORG_INFO.defaultAvatarPath;
      const feedback = document.getElementById('photoUploadFeedback');
      if (feedback) {
        feedback.textContent = 'Max 5MB (Auto-compressed & stored in Google Drive)';
        feedback.style.color = 'var(--text-muted)';
      }
      adminSelectedPhoto = null;

      editProfileModal.classList.add('active');
    });

    let adminSelectedPhoto = null;
    const fileInput = document.getElementById('editPhotoFileInput');
    const triggerBtn = document.getElementById('btnTriggerPhotoUpload');
    const photoPreview = document.getElementById('editPhotoPreview');
    const photoFeedback = document.getElementById('photoUploadFeedback');

    if (triggerBtn && fileInput) {
      triggerBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        try {
          if (photoFeedback) {
            photoFeedback.textContent = 'Compressing image...';
            photoFeedback.style.color = 'var(--wcc-gold)';
          }
          const compressed = await UTILS.compressImage(file, 800, 0.85);
          adminSelectedPhoto = compressed;
          if (photoPreview) photoPreview.src = compressed.dataUrl;
          if (photoFeedback) {
            photoFeedback.textContent = `✓ Ready (${compressed.fileSizeKb} KB, ${compressed.width}×${compressed.height}px)`;
            photoFeedback.style.color = '#2ECC71';
          }
        } catch (err) {
          if (photoFeedback) {
            photoFeedback.textContent = '⚠️ ' + (err.message || 'Error processing image.');
            photoFeedback.style.color = '#FF6B6B';
          }
          adminSelectedPhoto = null;
        }
      });
    }

    const closeEditModal = () => editProfileModal.classList.remove('active');
    if (closeEditModalBtn) closeEditModalBtn.addEventListener('click', closeEditModal);
    if (cancelEditModalBtn) cancelEditModalBtn.addEventListener('click', closeEditModal);

    editProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const checkedStudy = editProfileForm.querySelector('input[name="admin_currently_studying"]:checked');
      const studyVal = checkedStudy ? checkedStudy.value : 'না';

      const saveBtn = document.getElementById('btnSaveProfileChanges');
      if (saveBtn) {
        saveBtn.classList.add('loading');
        saveBtn.textContent = 'Saving Changes...';
      }

      let drivePhotoUrl = document.getElementById('editPhoto').value.trim();
      if (adminSelectedPhoto) {
        if (saveBtn) saveBtn.textContent = 'Uploading photo to Drive...';
        const uploadRes = await API.uploadProfilePhoto(m.memberId, adminSelectedPhoto, m.email);
        if (uploadRes.success && uploadRes.photoUrl && uploadRes.photoUrl.startsWith('http')) {
          drivePhotoUrl = uploadRes.photoUrl;
          UTILS.showToast('Photo uploaded to Google Drive!', 'success');
        } else {
          UTILS.showToast(uploadRes.message || 'Photo upload to Drive failed.', 'error');
        }
      }

      if (saveBtn) saveBtn.textContent = 'Saving to Sheet...';

      const updates = {
        phone: document.getElementById('editPhone').value.trim(),
        email: document.getElementById('editEmail').value.trim(),
        presentAddress: document.getElementById('editPresentAddress').value.trim(),
        permanentAddress: document.getElementById('editPermanentAddress').value.trim(),
        currentlyStudying: studyVal,
        classYear: studyVal === 'হ্যাঁ' ? document.getElementById('editClassYear').value.trim() : '',
        currentInstitution: studyVal === 'হ্যাঁ' ? document.getElementById('editCurrentInstitution').value.trim() : '',
        lastPublicExam: studyVal === 'হ্যাঁ' ? document.getElementById('editLastPublicExam').value.trim() : (m.lastPublicExam || ''),
        publicExamResult: studyVal === 'হ্যাঁ' ? document.getElementById('editPublicExamResult').value.trim() : (m.publicExamResult || ''),
        lastQualification: studyVal === 'না' ? document.getElementById('editLastQualification').value.trim() : '',
        lastResult: studyVal === 'না' ? document.getElementById('editLastResult').value.trim() : '',
        lastInstitution: studyVal === 'না' ? document.getElementById('editLastInstitution').value.trim() : '',
        profession: document.getElementById('editProfession').value.trim(),
        workplace: document.getElementById('editWorkplace').value.trim(),
        gender: document.getElementById('editGender').value,
        bloodGroup: document.getElementById('editBloodGroup').value,
        photo: (drivePhotoUrl && drivePhotoUrl.startsWith('http')) ? drivePhotoUrl : (m.photo || m.photoUrl || '')
      };

      try {
        const res = await API.updateMemberProfile(m.memberId, updates);
        if (res.success) {
          Object.assign(m, updates);
          if (updates.photo) m.photoUrl = UTILS.convertGoogleDriveUrl(updates.photo);
          renderProfileHeader(m);
          renderProfileSections(m);
          closeEditModal();
          UTILS.showToast('Member details updated successfully!', 'success');
        } else {
          UTILS.showToast(res.message || 'Failed to update member profile', 'error');
        }
      } catch (err) {
        console.error(err);
        UTILS.showToast('Error updating member profile', 'error');
      } finally {
        if (saveBtn) {
          saveBtn.classList.remove('loading');
          saveBtn.textContent = 'Save Changes';
        }
      }
    });
  }

  // Download PDF Button
  const downloadPdfBtn = document.getElementById('btnDownloadPdf');
  if (downloadPdfBtn) {
    downloadPdfBtn.addEventListener('click', async () => {
      downloadPdfBtn.classList.add('loading');
      downloadPdfBtn.textContent = 'Generating PDF...';
      try {
        await PDF_GENERATOR.generateMemberPDF(m);
        UTILS.showToast('PDF downloaded successfully', 'success');
      } catch (err) {
        console.error(err);
        UTILS.showToast('Error generating PDF', 'error');
      } finally {
        downloadPdfBtn.classList.remove('loading');
        downloadPdfBtn.innerHTML = `<span>📄</span> Download PDF`;
      }
    });
  }

  // Generate QR Code Modal Trigger
  const qrBtn = document.getElementById('btnGenerateQr');
  const qrModal = document.getElementById('qrModal');
  const closeQrModalBtn = document.getElementById('btnCloseQrModal');
  const qrContainer = document.getElementById('qrCodeContainer');
  const qrLinkText = document.getElementById('qrLinkText');
  const copyQrLinkBtn = document.getElementById('btnCopyQrLink');

  if (qrBtn && qrModal) {
    qrBtn.addEventListener('click', () => {
      const verifyUrl = `${CONFIG.VERIFY_BASE_URL}?id=${encodeURIComponent(m.memberId)}`;
      if (qrContainer) {
        qrContainer.innerHTML = '';
        QR_SYSTEM.renderQRCode(qrContainer, verifyUrl, 200);
      }
      if (qrLinkText) qrLinkText.value = verifyUrl;
      qrModal.classList.add('active');
    });

    if (closeQrModalBtn) {
      closeQrModalBtn.addEventListener('click', () => qrModal.classList.remove('active'));
    }

    if (copyQrLinkBtn && qrLinkText) {
      copyQrLinkBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(qrLinkText.value);
        UTILS.showToast('Verification URL copied to clipboard!', 'success');
      });
    }
  }

  // Print Profile Button
  const printBtn = document.getElementById('btnPrintProfile');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      window.print();
    });
  }
}

function showMemberNotFound(message) {
  const container = document.getElementById('profileContentArea');
  if (container) {
    container.innerHTML = `
      <div class="card empty-state" style="margin: 2rem auto; max-width: 600px;">
        <div class="empty-state-icon">❌</div>
        <h3 class="empty-state-title">Member Not Found</h3>
        <p class="empty-state-desc">${UTILS.escapeHTML(message)}</p>
        <a href="members.html" class="btn btn-primary">&larr; Back to Member Directory</a>
      </div>
    `;
  }
}
