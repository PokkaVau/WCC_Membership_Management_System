/**
 * WCC Membership Management System - Official A4 PDF Generator
 * Generates an official, publication-quality A4 membership record sheet
 * with 100% native Bengali (বাংলা) & English typography support via DOM rendering and high-res vector canvas.
 * File naming convention: WCC-Member-{memberId}.pdf
 */

const PDF_GENERATOR = {
  /**
   * Ensure required external libraries (jsPDF and html2canvas) are dynamically loaded if missing
   */
  async ensureLibraries() {
    const loadScript = (src) => {
      return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
          if (existing.dataset.loaded === 'true' || window.html2canvas || (window.jspdf && window.jspdf.jsPDF)) {
            return resolve();
          }
          existing.addEventListener('load', () => resolve());
          existing.addEventListener('error', (e) => reject(e));
          return;
        }
        const s = document.createElement('script');
        s.src = src;
        s.crossOrigin = 'anonymous';
        s.onload = () => {
          s.dataset.loaded = 'true';
          resolve();
        };
        s.onerror = (e) => reject(e);
        document.head.appendChild(s);
      });
    };

    if (!window.jspdf || !window.jspdf.jsPDF) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    }
    if (typeof html2canvas === 'undefined') {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }
  },

  /**
   * Helper to safely load an image URL into a Base64 DataURL (with timeout)
   */
  loadImageAsBase64(url, timeoutMs = 3500) {
    if (!url || typeof url !== 'string' || !url.trim() || url.toLowerCase().includes('no photo')) {
      return Promise.resolve(null);
    }
    if (url.startsWith('data:image')) {
      return Promise.resolve(url);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 160;
          canvas.height = img.naturalHeight || 160;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.90));
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = url;
    });
  },

  /**
   * HTML escape utility
   */
  escape(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  /**
   * Check if text contains Bengali Unicode codepoints
   */
  hasBengali(str) {
    return /[\u0980-\u09FF]/.test(str || '');
  },

  /**
   * Build complete printable A4 DOM sheet for the member
   */
  buildPrintSheetElement(member, photoDataUrl) {
    const sheet = document.createElement('div');
    sheet.id = 'wcc-member-a4-sheet';

    // Standard A4 dimensions at 96 DPI: 794px width x 1123px height
    sheet.style.cssText = `
      position: fixed;
      left: -9999px;
      top: 0;
      width: 794px;
      height: 1123px;
      box-sizing: border-box;
      background-color: #FFFFFF;
      color: #1E293B;
      font-family: 'Hind Siliguri', 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 0;
      overflow: hidden;
      z-index: -9999;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    `;

    // Names & Titles
    const nameBn = member.nameBn || (this.hasBengali(member.name) ? member.name : '');
    const nameEn = member.nameEn || (!this.hasBengali(member.name) ? member.name : '');
    const primaryName = nameBn || nameEn || member.name || 'Unnamed Member';
    const secondaryName = (nameBn && nameEn && nameBn !== nameEn) ? nameEn : '';

    // Status styling
    const status = (member.status || 'Active').toLowerCase();
    const statusBg = status === 'active' ? '#169053' : (status === 'pending' ? '#D97706' : '#DC2626');
    const statusText = member.status ? member.status.toUpperCase() : 'ACTIVE';

    // Education logic
    const isStudying = (member.currentlyStudying === 'হ্যাঁ' || String(member.currentlyStudying).toLowerCase().includes('yes'));
    const studyingLabel = isStudying ? 'হ্যাঁ (অধ্যয়নরত)' : 'না (সম্পন্ন)';

    // Date and Document Meta
    const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const regDateStr = member.formattedRegDate || member.timestamp || todayStr;
    const ageStr = member.age !== null && member.age !== undefined && member.age !== '' ? `${member.age} বছর` : '';
    const dobStr = member.formattedDob || member.dob || 'প্রযোজ্য নয়';
    const fullDobDisplay = ageStr ? `${dobStr} (বয়স: ${ageStr})` : dobStr;

    // Photo element
    let photoMarkup = '';
    if (photoDataUrl) {
      photoMarkup = `<img src="${photoDataUrl}" alt="Photo" style="width: 72px; height: 72px; object-fit: cover; border-radius: 4px; display: block;" />`;
    } else {
      photoMarkup = `
        <div style="width: 72px; height: 72px; border-radius: 4px; background: #191D24; color: #F1AD1A; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 700;">
          <span style="font-size: 16px; letter-spacing: 1px;">WCC</span>
          <span style="font-size: 8px; color: #94A3B8; margin-top: 2px;">MEMBER</span>
        </div>
      `;
    }

    sheet.innerHTML = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Poppins:wght@400;500;600;700;800&display=swap');
        #wcc-member-a4-sheet * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        .wcc-sec-title {
          display: flex;
          align-items: center;
          gap: 6px;
          border-bottom: 1.5px solid #E2E8F0;
          padding-bottom: 3px;
          margin-bottom: 6px;
        }
        .wcc-sec-title-bar {
          width: 4px;
          height: 13px;
          background-color: #1D3557;
          border-radius: 2px;
        }
        .wcc-sec-title-text {
          font-size: 11px;
          font-weight: 700;
          color: #1D3557;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .wcc-sec-title-bn {
          font-size: 10px;
          color: #64748B;
          font-weight: 600;
        }
        .wcc-kv-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          column-gap: 18px;
          row-gap: 5px;
          font-size: 9.5px;
          line-height: 1.35;
        }
        .wcc-kv-item {
          display: flex;
          align-items: baseline;
        }
        .wcc-kv-label {
          width: 115px;
          flex-shrink: 0;
          color: #64748B;
          font-weight: 600;
          font-size: 9px;
        }
        .wcc-kv-val {
          flex-grow: 1;
          color: #1E293B;
          font-weight: 500;
          font-size: 9.5px;
          word-break: break-word;
        }
        .wcc-kv-full {
          grid-column: 1 / -1;
        }
      </style>

      <!-- 1. Top Decorative Ribbon -->
      <div>
        <div style="height: 9px; background-color: #B62A35; width: 100%;"></div>
        <div style="height: 3px; background-color: #F1AD1A; width: 100%;"></div>
      </div>

      <!-- Main Body Container -->
      <div style="padding: 16px 28px 10px 28px; display: flex; flex-direction: column; flex-grow: 1; justify-content: space-between;">

        <!-- 2. Header Area -->
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <!-- Left: Logo & Organization Info -->
            <div style="display: flex; align-items: center; gap: 12px;">
              <img src="assets/logo/WCC_logo.png" alt="WCC Logo" style="width: 44px; height: 44px; object-fit: contain;" />
              <div>
                <h1 style="font-size: 18px; font-weight: 800; color: #1D3557; letter-spacing: 0.5px; line-height: 1.1;">WE CAN CHANGE (WCC)</h1>
                <p style="font-size: 9.5px; font-weight: 600; color: #B62A35; margin-top: 2px;">উই ক্যান চেইঞ্জ — একটি সমাজকল্যাণমূলক স্বেচ্ছাসেবী সংগঠন</p>
                <p style="font-size: 8px; color: #64748B;">Empowering People, Changing Society | Reg. Non-Profit Organization</p>
              </div>
            </div>

            <!-- Right: Document Badge -->
            <div style="text-align: right;">
              <div style="display: inline-block; background-color: #F8FAFC; border: 1px solid #CBD5E1; padding: 3px 8px; border-radius: 4px;">
                <div style="font-size: 9px; font-weight: 800; color: #B62A35; letter-spacing: 0.5px;">OFFICIAL MEMBERSHIP RECORD</div>
                <div style="font-size: 8px; color: #475569; margin-top: 1px;">তারিখ / Issue Date: ${todayStr}</div>
              </div>
            </div>
          </div>

          <!-- Divider -->
          <div style="height: 1.5px; background: linear-gradient(90deg, #B62A35 0%, #F1AD1A 50%, #1D3557 100%); margin-top: 8px; margin-bottom: 10px;"></div>
        </div>

        <!-- 3. Member Hero Profile Card -->
        <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 9px 12px; display: flex; align-items: center; gap: 14px; margin-bottom: 10px;">
          <!-- Photo Container -->
          <div style="width: 76px; height: 76px; border: 2px solid #F1AD1A; border-radius: 6px; padding: 1px; background: #FFFFFF; flex-shrink: 0; display: flex; align-items: center; justify-content: center; overflow: hidden;">
            ${photoMarkup}
          </div>

          <!-- Info Details -->
          <div style="flex-grow: 1;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <h2 style="font-size: 16px; font-weight: 700; color: #0F172A; line-height: 1.2;">${this.escape(primaryName)}</h2>
                ${secondaryName ? `<p style="font-size: 10.5px; font-weight: 500; color: #475569; margin-top: 1px;">${this.escape(secondaryName)}</p>` : ''}
              </div>
              <div style="text-align: right;">
                <span style="display: inline-block; background-color: #B62A35; color: #FFFFFF; font-size: 9.5px; font-weight: 700; padding: 2px 7px; border-radius: 3px; letter-spacing: 0.5px;">
                  ${this.escape(member.memberId || 'WCC-MEMBER')}
                </span>
              </div>
            </div>

            <!-- Badges Row -->
            <div style="display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; align-items: center;">
              <span style="background-color: ${statusBg}; color: #FFFFFF; font-size: 8.5px; font-weight: 700; padding: 2px 6px; border-radius: 3px;">
                ${statusText}
              </span>
              <span style="background-color: #FFFFFF; border: 1px solid #B62A35; color: #B62A35; font-size: 8.5px; font-weight: 700; padding: 1px 6px; border-radius: 3px;">
                রক্তের গ্রুপ: ${this.escape(member.bloodGroup || 'N/A')}
              </span>
              <span style="background-color: #1D3557; color: #FFFFFF; font-size: 8.5px; font-weight: 600; padding: 2px 6px; border-radius: 3px;">
                ${this.escape(member.membershipType || 'General Member')}
              </span>
              <span style="background-color: #FEF3C7; border: 1px solid #F59E0B; color: #92400E; font-size: 8.5px; font-weight: 600; padding: 1px 6px; border-radius: 3px;">
                ${this.escape(member.wing || 'সাধারণ উইং')}
              </span>
            </div>
          </div>
        </div>

        <!-- 4. Section: Personal Information -->
        <div style="margin-bottom: 9px;">
          <div class="wcc-sec-title">
            <div class="wcc-sec-title-bar"></div>
            <span class="wcc-sec-title-text">1. Personal & Family Information</span>
            <span class="wcc-sec-title-bn">(ব্যক্তিগত ও পারিবারিক তথ্য)</span>
          </div>
          <div class="wcc-kv-grid">
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">পূর্ণ নাম (বাংলা):</span>
              <span class="wcc-kv-val" style="font-weight: 600;">${this.escape(nameBn || member.name || '-')}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">Full Name (EN):</span>
              <span class="wcc-kv-val">${this.escape(nameEn || '-')}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">পিতার নাম:</span>
              <span class="wcc-kv-val">${this.escape(member.father || '-')}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">মাতার নাম:</span>
              <span class="wcc-kv-val">${this.escape(member.mother || '-')}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">জন্ম তারিখ ও বয়স:</span>
              <span class="wcc-kv-val">${this.escape(fullDobDisplay)}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">লিঙ্গ / Gender:</span>
              <span class="wcc-kv-val">${this.escape(member.gender || 'Not specified')}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">মোবাইল নম্বর:</span>
              <span class="wcc-kv-val" style="font-weight: 600; color: #0F172A;">${this.escape(member.phone || '-')}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">ইমেইল ঠিকানা:</span>
              <span class="wcc-kv-val">${this.escape(member.email || '-')}</span>
            </div>
            <div class="wcc-kv-item wcc-kv-full">
              <span class="wcc-kv-label">জাতীয় পরিচয়পত্র/NID:</span>
              <span class="wcc-kv-val">${this.escape(member.nid || 'প্রদান করা হয়নি')}</span>
            </div>
          </div>
        </div>

        <!-- 5. Section: Address Information -->
        <div style="margin-bottom: 9px;">
          <div class="wcc-sec-title">
            <div class="wcc-sec-title-bar"></div>
            <span class="wcc-sec-title-text">2. Residential Address</span>
            <span class="wcc-sec-title-bn">(ঠিকানার বিবরণ)</span>
          </div>
          <div class="wcc-kv-grid">
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">জেলা / District:</span>
              <span class="wcc-kv-val">${this.escape(member.district || '-')}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">উপজেলা / Upazila:</span>
              <span class="wcc-kv-val">${this.escape(member.upazila || '-')}</span>
            </div>
            <div class="wcc-kv-item wcc-kv-full">
              <span class="wcc-kv-label">বর্তমান ঠিকানা:</span>
              <span class="wcc-kv-val">${this.escape(member.presentAddress || 'প্রদান করা হয়নি')}</span>
            </div>
            <div class="wcc-kv-item wcc-kv-full">
              <span class="wcc-kv-label">স্থায়ী ঠিকানা:</span>
              <span class="wcc-kv-val">${this.escape(member.permanentAddress || 'প্রদান করা হয়নি')}</span>
            </div>
          </div>
        </div>

        <!-- 6. Section: Educational Background -->
        <div style="margin-bottom: 9px;">
          <div class="wcc-sec-title">
            <div class="wcc-sec-title-bar"></div>
            <span class="wcc-sec-title-text">3. Educational Background</span>
            <span class="wcc-sec-title-bn">(শিক্ষাগত বিবরণ)</span>
          </div>
          <div class="wcc-kv-grid">
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">বর্তমানে অধ্যয়নরত?:</span>
              <span class="wcc-kv-val" style="font-weight: 600; color: ${isStudying ? '#169053' : '#475569'};">${studyingLabel}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">শ্রেণি / শিক্ষাবর্ষ:</span>
              <span class="wcc-kv-val">${this.escape(member.classYear || '-')}</span>
            </div>
            <div class="wcc-kv-item wcc-kv-full">
              <span class="wcc-kv-label">শিক্ষা প্রতিষ্ঠান:</span>
              <span class="wcc-kv-val">${this.escape(member.currentInstitution || member.institution || member.lastInstitution || '-')}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">সর্বশেষ পরীক্ষা:</span>
              <span class="wcc-kv-val">${this.escape(member.lastPublicExam || member.lastQualification || member.degree || '-')}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">ফলাফল / GPA / CGPA:</span>
              <span class="wcc-kv-val" style="font-weight: 600;">${this.escape(member.publicExamResult || member.lastResult || '-')}</span>
            </div>
          </div>
        </div>

        <!-- 7. Section: Professional & Organizational Information -->
        <div style="margin-bottom: 9px;">
          <div class="wcc-sec-title">
            <div class="wcc-sec-title-bar"></div>
            <span class="wcc-sec-title-text">4. Professional & WCC Membership Details</span>
            <span class="wcc-sec-title-bn">(পেশাগত ও সদস্যপদ সংক্রান্ত)</span>
          </div>
          <div class="wcc-kv-grid">
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">পেশা / Profession:</span>
              <span class="wcc-kv-val">${this.escape(member.profession || '-')}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">কর্মস্থল / প্রতিষ্ঠান:</span>
              <span class="wcc-kv-val">${this.escape(member.workplace || member.organization || '-')}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">সদস্য আইডি / ID:</span>
              <span class="wcc-kv-val" style="font-weight: 700; color: #B62A35;">${this.escape(member.memberId || '-')}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">সদস্যপদের ধরন:</span>
              <span class="wcc-kv-val">${this.escape(member.membershipType || 'General Member')}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">নির্ধারিত উইং:</span>
              <span class="wcc-kv-val">${this.escape(member.wing || 'সাধারণ উইং')}</span>
            </div>
            <div class="wcc-kv-item">
              <span class="wcc-kv-label">নিবন্ধনের তারিখ:</span>
              <span class="wcc-kv-val">${this.escape(regDateStr)}</span>
            </div>
          </div>
        </div>

        <!-- 8. Official Signatures and Seal Area -->
        <div style="margin-top: 10px; padding-top: 6px; display: flex; justify-content: space-between; align-items: flex-end;">
          <!-- Member Signature -->
          <div style="text-align: center; width: 180px;">
            <div style="height: 28px;"></div>
            <div style="border-top: 1.2px dashed #94A3B8; padding-top: 4px;">
              <p style="font-size: 8.5px; font-weight: 600; color: #1E293B;">সদস্যের স্বাক্ষর</p>
              <p style="font-size: 7.5px; color: #64748B;">Member's Signature</p>
            </div>
          </div>

          <!-- Official Seal Badge -->
          <div style="text-align: center;">
            <div style="width: 64px; height: 64px; border: 2px dashed #B62A35; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; margin: 0 auto; color: #B62A35;">
              <span style="font-size: 7px; font-weight: 800; letter-spacing: 0.5px;">OFFICIAL</span>
              <span style="font-size: 9px; font-weight: 900;">WCC</span>
              <span style="font-size: 6.5px; font-weight: 700;">SEAL</span>
            </div>
            <p style="font-size: 7.5px; color: #64748B; margin-top: 3px;">অফিসিয়াল সিলমোহর</p>
          </div>

          <!-- Authorized Signature -->
          <div style="text-align: center; width: 180px;">
            <div style="height: 28px; display: flex; align-items: flex-end; justify-content: center;">
              <span style="font-family: 'Brush Script MT', cursive, sans-serif; font-size: 16px; color: #1D3557;">We Can Change</span>
            </div>
            <div style="border-top: 1.2px dashed #94A3B8; padding-top: 4px;">
              <p style="font-size: 8.5px; font-weight: 600; color: #1E293B;">অনুমোদিত স্বাক্ষরকারী (WCC)</p>
              <p style="font-size: 7.5px; color: #64748B;">Authorized Officer / Secretary</p>
            </div>
          </div>
        </div>

      </div>

      <!-- 9. Official Bottom Ribbon -->
      <div style="background-color: #191D24; padding: 6px 20px; text-align: center; border-top: 2px solid #F1AD1A;">
        <p style="font-size: 8px; color: #E2E8F0; letter-spacing: 0.3px;">
          <strong>We Can Change (WCC)</strong> &nbsp;|&nbsp; Empowering People, Changing Society &nbsp;|&nbsp; Official Web Portal: www.wecanchange.org
        </p>
      </div>
    `;

    return sheet;
  },

  /**
   * Primary entry point: Generates and downloads official A4 PDF for member
   */
  async generateMemberPDF(member) {
    if (!member) throw new Error('No member data provided for PDF generation.');

    try {
      // 1. Ensure jsPDF and html2canvas are loaded
      await this.ensureLibraries();

      // 2. Preload member photo as base64 to avoid cross-origin / tainted canvas issues
      const photoBase64 = await this.loadImageAsBase64(member.photoUrl || member.photo);

      // 3. Construct and mount offscreen printable DOM element
      const sheet = this.buildPrintSheetElement(member, photoBase64);
      document.body.appendChild(sheet);

      // 4. Ensure web fonts are completely loaded before capturing
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
      // Small pause for layout settle
      await new Promise(r => setTimeout(r, 120));

      // 5. High-resolution canvas capture
      const canvas = await html2canvas(sheet, {
        scale: 2, // 2x gives 1588x2246 sharp print resolution
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#FFFFFF'
      });

      // 6. Clean up temporary DOM sheet immediately
      if (sheet.parentNode) {
        sheet.parentNode.removeChild(sheet);
      }

      // 7. Embed into jsPDF A4 document
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // Standard A4 is 210mm x 297mm
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      doc.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');

      // 8. Trigger download
      const cleanId = (member.memberId || 'member').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `WCC-Member-${cleanId}.pdf`;
      doc.save(filename);

      return true;
    } catch (err) {
      console.error('Error generating official member PDF:', err);

      // Fallback: Remove sheet if still mounted
      const leftover = document.getElementById('wcc-member-a4-sheet');
      if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);

      throw err;
    }
  }
};
