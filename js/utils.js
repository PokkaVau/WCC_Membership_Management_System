/**
 * WCC Membership Management System - Utility Functions
 * Data normalization, XSS escaping, age calculation, image fallbacks, toasts, CSV export
 */

const UTILS = {
  /**
   * Escape HTML special characters to prevent Cross-Site Scripting (XSS)
   */
  escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  /**
   * Convert Bengali numerals (০-৯) to English digits (0-9)
   */
  toEnglishDigits(str) {
    if (!str && str !== 0) return '';
    const bengaliMap = { '০':'0', '১':'1', '২':'2', '৩':'3', '৪':'4', '৫':'5', '৬':'6', '৭':'7', '৮':'8', '৯':'9' };
    return String(str).replace(/[০-৯]/g, d => bengaliMap[d] || d);
  },

  /**
   * Parse dates supporting ISO, DD/MM/YYYY, and Bengali month names
   */
  parseDate(dateStr) {
    if (!dateStr) return null;
    const clean = this.toEnglishDigits(dateStr).trim();
    if (!clean) return null;

    // 1. Try standard JS Date constructor
    const d = new Date(clean);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1900 && d.getFullYear() < 2150) {
      return d;
    }

    // 2. Format DD/MM/YYYY or D/M/YYYY or DD-MM-YYYY
    const dmParts = clean.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (dmParts) {
      const day = parseInt(dmParts[1], 10);
      const month = parseInt(dmParts[2], 10) - 1;
      const year = parseInt(dmParts[3], 10);
      const parsed = new Date(year, month, day);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    // 3. Bengali text months e.g. "০১ জানুয়ারি ১৯৮৯"
    const bMonths = {
      'জানুয়ারি': 0, 'জানুয়ারি': 0, 'ফেব্রুয়ারি': 1, 'ফেব্রুয়ারি': 1,
      'মার্চ': 2, 'এপ্রিল': 3, 'মে': 4, 'জুন': 5, 'জুলাই': 6,
      'আগস্ট': 7, 'সেপ্টেম্বর': 8, 'অক্টোবর': 9, 'নভেম্বর': 10, 'ডিসেম্বর': 11
    };
    for (const [bm, idx] of Object.entries(bMonths)) {
      if (String(dateStr).includes(bm)) {
        const nums = clean.match(/\d+/g);
        if (nums && nums.length >= 2) {
          const day = parseInt(nums[0], 10);
          const year = parseInt(nums[nums.length - 1], 10);
          const parsed = new Date(year, idx, day);
          if (!isNaN(parsed.getTime())) return parsed;
        }
      }
    }

    return null;
  },

  /**
   * Calculate dynamic age in years from Date of Birth string
   */
  calculateAge(dobString) {
    const birthDate = this.parseDate(dobString);
    if (!birthDate) return null;

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return (age >= 0 && age <= 120) ? age : null;
  },

  /**
   * Format date into readable string e.g. "15 Jan 2026"
   */
  formatDate(dateStr) {
    if (!dateStr) return 'Not provided';
    const d = this.parseDate(dateStr);
    if (!d) return String(dateStr);

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(d.getDate()).padStart(2, '0');
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  },

  /**
   * Convert Google Drive shareable link into a direct image stream link
   * Handles drive.google.com/file/d/ID/view -> lh3.googleusercontent.com/d/ID
   */
  convertGoogleDriveUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';

    // Match Google Drive file ID
    const driveMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || trimmed.match(/id=([a-zA-Z0-9_-]+)/);
    if (driveMatch && driveMatch[1]) {
      const fileId = driveMatch[1];
      return `https://lh3.googleusercontent.com/d/${fileId}`;
    }

    return trimmed;
  },

  /**
   * Get safe image URL with fallback to local default avatar
   */
  getSafeImageUrl(photoUrl) {
    if (!photoUrl || typeof photoUrl !== 'string' || !photoUrl.trim() || photoUrl.toLowerCase().includes('no photo')) {
      return CONFIG.ORG_INFO.defaultAvatarPath;
    }
    return this.convertGoogleDriveUrl(photoUrl);
  },

  /**
   * Extract District and Upazila automatically from address text
   */
  extractLocation(presentAddr, permanentAddr) {
    const combined = `${presentAddr || ''} ${permanentAddr || ''}`.toLowerCase();
    
    const districtCatalog = [
      { name: 'Jhalokathi', match: ['jhalokathi', 'jhalakati', 'jhalakathi', 'ঝালকাঠি', 'ঝালকাঠী'] },
      { name: 'Barishal', match: ['barishal', 'barisal', 'বরিশাল'] },
      { name: 'Pirojpur', match: ['pirojpur', 'পিরোজপুর'] },
      { name: 'Patuakhali', match: ['patuakhali', 'পটুয়াখালী', 'পটুয়াখালী'] },
      { name: 'Bhola', match: ['bhola', 'ভোলা'] },
      { name: 'Barguna', match: ['barguna', 'বরগুনা'] },
      { name: 'Dhaka', match: ['dhaka', 'ঢাকা'] },
      { name: 'Khulna', match: ['khulna', 'খুলনা'] },
      { name: 'Chattogram', match: ['chattogram', 'chittagong', 'চট্টগ্রাম'] },
      { name: 'Sylhet', match: ['sylhet', 'সিলেট'] },
      { name: 'Rajshahi', match: ['rajshahi', 'রাজশাহী'] },
      { name: 'Rangpur', match: ['rangpur', 'রংপুর'] },
      { name: 'Mymensingh', match: ['mymensingh', 'ময়মনসিংহ'] }
    ];

    let district = '';
    for (const d of districtCatalog) {
      if (d.match.some(term => combined.includes(term))) {
        district = d.name;
        break;
      }
    }

    const upazilaCatalog = [
      { name: 'Jhalokathi Sadar', match: ['sadar', 'সদর', 'ঝালকাঠি সদর', 'jhalokathi sadar', 'বাসন্ডা', 'কেওড়া', 'কেওরা', 'নৈকাঠি', 'পিপলিতা'] },
      { name: 'Nalchity', match: ['nalchity', 'nalchiti', 'নলছিটি'] },
      { name: 'Rajapur', match: ['rajapur', 'রাজাপুর'] },
      { name: 'Kathalia', match: ['kathalia', 'কাঠালিয়া', 'কাঁঠালিয়া', 'কাঁঠালিয়া', 'আমুয়া', 'আমুয়া'] },
      { name: 'Bakerganj', match: ['bakerganj', 'বাকেরগঞ্জ'] },
      { name: 'Dhanmondi', match: ['dhanmondi', 'ধানমন্ডি'] },
      { name: 'Mirpur', match: ['mirpur', 'মিরপুর'] },
      { name: 'Gulshan', match: ['gulshan', 'গুলশান'] }
    ];

    let upazila = '';
    for (const u of upazilaCatalog) {
      if (u.match.some(term => combined.includes(term))) {
        upazila = u.name;
        break;
      }
    }

    return {
      district: district || (combined.includes('ঝাল') ? 'Jhalokathi' : ''),
      upazila: upazila
    };
  },

  /**
   * Normalize raw member record from Google Sheet into a structured, clean object
   * Supports Google Sheet 26 columns, Form-V2 keys, camelCase, and Bengali field names
   */
  normalizeMember(raw) {
    if (!raw || typeof raw !== 'object') return null;

    // Helper to find value across multiple candidate header names and case-insensitive matches
    const getVal = (...keys) => {
      // 1. Exact candidate match
      for (const k of keys) {
        if (!k) continue;
        if (raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== '') {
          return String(raw[k]).trim();
        }
      }

      // 2. Normalized alphanumeric match (lowercase, letters and numbers only)
      const cleanTargetKeys = keys.filter(Boolean).map(k => k.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]/g, ''));
      const rawKeys = Object.keys(raw);
      for (const rk of rawKeys) {
        const cleanRk = rk.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]/g, '');
        if (cleanTargetKeys.includes(cleanRk)) {
          const v = raw[rk];
          if (v !== undefined && v !== null && String(v).trim() !== '') {
            return String(v).trim();
          }
        }
      }
      return '';
    };

    const nameEn = getVal('Name (EN)', 'name_en', 'nameEn', 'Name', 'Full Name', 'full_name', 'পূর্ণ নাম (ইংরেজী)', 'পূর্ণ নাম (ইংরেজি)', 'নাম (ইংরেজি)', 'নাম (ইংরেজী)', 'English Name');
    const nameBn = getVal('Name (BN)', 'name_bn', 'nameBn', 'পূর্ণ নাম (বাংলা)', 'নাম (বাংলা)', 'পূর্ণ নাম', 'নাম', 'Bangla Name');
    const name = nameEn || nameBn || getVal('name', 'fullname') || 'Unnamed Member';

    // Normalize phone (Convert Bengali digits, prepend leading 0 for 10-digit BD numbers)
    let rawPhone = getVal('Mobile', 'mobile', 'phone', 'phone_number', 'Mobile Number', 'মোবাইল', 'মোবাইল নম্বর', 'Phone');
    let phone = this.toEnglishDigits(rawPhone).replace(/[^\d+]/g, '');
    if (phone && /^\d{10}$/.test(phone)) {
      phone = '0' + phone;
    }

    const presentAddress = getVal('Present Add', 'present_address', 'presentAddress', 'Present Address', 'বর্তমান ঠিকানা');
    const permanentAddress = getVal('Permanent Add', 'permanent_address', 'permanentAddress', 'Permanent Address', 'স্থায়ী ঠিকানা', 'স্থায়ী ঠিকানা');
    
    // Explicit or auto-extracted district & upazila
    const explicitDistrict = getVal('District', 'district', 'জেলা');
    const explicitUpazila = getVal('Upazila', 'upazila', 'উপজেলা');
    const loc = this.extractLocation(presentAddress, permanentAddress);
    const district = explicitDistrict || loc.district || '';
    const upazila = explicitUpazila || loc.upazila || '';

    // NID / BRN (Convert Bengali digits)
    const rawNid = getVal('NID/BRN', 'nid_brn', 'nid', 'NID', 'জাতীয় পরিচয়পত্র', 'জাতীয় পরিচয়পত্র', 'জন্ম নিবন্ধন');
    const nid = this.toEnglishDigits(rawNid);

    const rawDob = getVal('DOB', 'dob', 'date_of_birth', 'Date of Birth', 'জন্ম তারিখ');

    const normalized = {
      timestamp: getVal('Timestamp', 'timestamp', 'registrationDate', 'টাইমস্ট্যাম্প'),
      registrationDate: getVal('Timestamp', 'timestamp', 'registrationDate', 'টাইমস্ট্যাম্প'),
      nameBn: nameBn,
      nameEn: nameEn,
      name: name,
      dob: rawDob,
      father: getVal('Father', 'father_name', 'father', 'পিতার নাম', "Father's Name"),
      mother: getVal('Mother', 'mother_name', 'mother', 'মাতার নাম', "Mother's Name"),
      nid: nid,
      bloodGroup: getVal('Blood', 'blood_group', 'bloodGroup', 'Blood Group', 'রক্তের গ্রুপ'),
      rawBloodGroup: getVal('Blood', 'blood_group', 'bloodGroup', 'Blood Group', 'রক্তের গ্রুপ'),
      phone: phone,
      email: getVal('Email', 'email', 'email_address', 'Email Address', 'ইমেইল', 'ই-মেইল'),
      presentAddress: presentAddress,
      permanentAddress: permanentAddress,
      district: district,
      upazila: upazila,
      gender: getVal('Gender', 'gender', 'লিঙ্গ'),
      currentlyStudying: getVal('Currently Studying', 'currently_studying', 'currentlyStudying', 'বর্তমানে অধ্যয়নরত?', 'বর্তমানে অধ্যয়নরত?') || 'না',
      classYear: getVal('Class/Year', 'studying_class', 'classYear', 'Class / Year', 'শ্রেণি / বর্ষ'),
      currentInstitution: getVal('Current Institution', 'current_institution', 'currentInstitution', 'বর্তমান শিক্ষা প্রতিষ্ঠান'),
      institution: getVal('Current Institution', 'current_institution', 'institution', 'বর্তমান শিক্ষা প্রতিষ্ঠান'),
      lastPublicExam: getVal('Last Public Exam', 'last_public_exam', 'lastPublicExam', 'সর্বশেষ পাবলিক পরীক্ষা'),
      publicExamResult: getVal('Public Exam Result', 'public_exam_result', 'publicExamResult', 'পাবলিক পরীক্ষার ফলাফল'),
      lastQualification: getVal('Last Qualification', 'last_qualification', 'lastQualification', 'সর্বশেষ শিক্ষাগত যোগ্যতা'),
      degree: getVal('Last Qualification', 'last_qualification', 'degree', 'সর্বশেষ শিক্ষাগত যোগ্যতা'),
      lastResult: getVal('Last Result', 'last_result', 'lastResult', 'সর্বশেষ রেজাল্ট'),
      lastInstitution: getVal('Last Institution', 'last_institution', 'lastInstitution', 'সর্বশেষ প্রতিষ্ঠান'),
      profession: getVal('Profession', 'profession', 'পেশা', 'পদবী'),
      workplace: getVal('Workplace', 'workplace', 'organization', 'কর্মস্থল'),
      organization: getVal('Workplace', 'workplace', 'organization', 'কর্মস্থল'),
      membershipType: getVal('Membership', 'membership', 'membershipType', 'মেম্বারশিপ ধরণ', 'মেম্বারশিপ') || 'General',
      wing: getVal('Wing', 'wing', 'উইং') || 'শিক্ষা উইং',
      reason: getVal('Reason', 'reason', 'উদ্দেশ্য'),
      photo: getVal('Photo URL', 'photo', 'photoUrl', 'ছবি', 'ছবি আপলোড', 'Image', 'Photo'),
      status: getVal('Status', 'status', 'স্ট্যাটাস') || 'Active',
      memberId: getVal('Member ID', 'member_id', 'memberId', 'সদস্য আইডি')
    };

    // Auto-generate consistent Member ID if missing from sheet
    if (!normalized.memberId || normalized.memberId === 'N/A' || normalized.memberId === '-') {
      const seed = normalized.email || normalized.phone || normalized.name || 'member';
      let hash = 0;
      for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash) + seed.charCodeAt(i);
      const suffix = String(Math.abs(hash) % 10000).padStart(4, '0');
      normalized.memberId = `WCC-2026-${suffix}`;
    }

    normalized.photoUrl = this.getSafeImageUrl(normalized.photo);
    normalized.age = this.calculateAge(normalized.dob);
    normalized.formattedDob = this.formatDate(normalized.dob);
    normalized.formattedRegDate = this.formatDate(normalized.registrationDate || normalized.timestamp);
    normalized.formattedJoiningDate = this.formatDate(normalized.joiningDate || normalized.registrationDate || normalized.timestamp);

    // Blood group clean & normalization (Support Bengali: 'এ+', 'বি+', 'ও+', 'এবি+' & English: 'A+', 'B+', 'O+', 'AB+')
    if (normalized.bloodGroup) {
      const bMap = {
        'এ+': 'A+', 'এ-': 'A-',
        'বি+': 'B+', 'বি-': 'B-',
        'এবি+': 'AB+', 'এবি-': 'AB-',
        'ও+': 'O+', 'ও-': 'O-'
      };
      const cleaned = normalized.bloodGroup.trim();
      normalized.bloodGroup = bMap[cleaned] || cleaned.toUpperCase().replace(/\s+/g, '');
    }

    // Student flag based on Form-V2 "বর্তমানে অধ্যয়নরত?" conditional logic
    normalized.isStudent = (
      normalized.currentlyStudying === 'হ্যাঁ' ||
      normalized.currentlyStudying.toLowerCase().includes('yes') ||
      Boolean(normalized.classYear) ||
      (normalized.profession && (normalized.profession.includes('ছাত্র') || normalized.profession.toLowerCase().includes('student')))
    );

    return normalized;
  },

  /**
   * Render HTML badge for membership status
   */
  renderStatusBadge(status) {
    const s = (status || 'pending').toLowerCase();
    let badgeClass = 'badge-pending';
    let icon = '🟡';

    if (s === 'active') {
      badgeClass = 'badge-active';
      icon = '🟢';
    } else if (s === 'inactive') {
      badgeClass = 'badge-inactive';
      icon = '🔴';
    } else if (s === 'suspended') {
      badgeClass = 'badge-suspended';
      icon = '⚫';
    } else if (s === 'rejected') {
      badgeClass = 'badge-inactive';
      icon = '✕';
    }

    return `<span class="badge ${badgeClass}">${icon} ${this.escapeHTML(status || 'Pending')}</span>`;
  },

  /**
   * Render Blood Group badge
   */
  renderBloodBadge(bg) {
    if (!bg) return '<span class="text-muted">-</span>';
    return `<span class="badge badge-blood">${this.escapeHTML(bg)}</span>`;
  },

  /**
   * Display floating toast notification
   */
  showToast(message, type = 'info', duration = 3500) {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';
    if (type === 'warning') icon = '🔔';

    toast.innerHTML = `<span>${icon}</span><span style="flex:1;">${this.escapeHTML(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  /**
   * Debounce helper for instant search inputs
   */
  debounce(func, delay = 250) {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  },

  /**
   * Export array of objects to CSV with UTF-8 BOM support
   */
  exportToCSV(data, filename = 'wcc-members.csv') {
    if (!data || !data.length) {
      this.showToast('No data available to export', 'warning');
      return;
    }

    const headers = [
      "Member ID", "Name", "Date of Birth", "Age", "Gender", "Blood Group",
      "Phone", "Email", "Division", "District", "Upazila", "Profession",
      "Institution", "Status", "Membership Type", "Registration Date"
    ];

    const rows = data.map(m => [
      m.memberId || '',
      m.name || '',
      m.dob || '',
      m.age !== null ? m.age : '',
      m.gender || '',
      m.bloodGroup || '',
      m.phone || '',
      m.email || '',
      m.division || '',
      m.district || '',
      m.upazila || '',
      m.profession || '',
      m.institution || '',
      m.status || '',
      m.membershipType || '',
      m.registrationDate || ''
    ]);

    // Build CSV string with proper quoting
    const csvLines = [headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',')];
    rows.forEach(r => {
      csvLines.push(r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','));
    });

    const csvContent = '\uFEFF' + csvLines.join('\r\n'); // Add BOM for Excel UTF-8
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    this.showToast(`Exported ${data.length} members to ${filename}`, 'success');
  },

  /**
   * Cryptographic SHA-256 Salted Hash (Web Crypto API with fallback)
   */
  async hashPassword(password, salt) {
    const combined = String(password) + "::" + String(salt);
    try {
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const enc = new TextEncoder();
        const buf = await crypto.subtle.digest('SHA-256', enc.encode(combined));
        return Array.from(new Uint8Array(buf))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      }
    } catch(e) {}
    // Portable fallback implementation
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    for (let i = 0; i < combined.length; i++) {
      const code = combined.charCodeAt(i);
      h0 = (h0 ^ (code * 31)) >>> 0;
      h1 = (h1 ^ (code * 17)) >>> 0;
      h2 = (h2 + code * 13) >>> 0;
      h3 = (h3 + (code << 5) - code) >>> 0;
    }
    return [h0, h1, h2, h3].map(n => n.toString(16).padStart(8, '0')).join('');
  },

  /**
   * Generate 16-character random cryptographic salt
   */
  generateSalt() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let salt = '';
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const vals = new Uint8Array(16);
      crypto.getRandomValues(vals);
      for (let i = 0; i < 16; i++) {
        salt += chars[vals[i] % chars.length];
      }
    } else {
      for (let i = 0; i < 16; i++) {
        salt += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }
    return salt;
  },

  /**
   * Client-side Canvas Image Compression
   * Resizes large files (e.g. 5MB) down to max 800px dimension and converts to JPEG/WebP
   * Returns { base64, mimeType, fileName, fileSizeKb }
   */
  compressImage(file, maxDimension = 800, quality = 0.85) {
    return new Promise((resolve, reject) => {
      if (!file) {
        return reject(new Error('No file provided for compression'));
      }
      // Strict MIME validation
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
      if (!validTypes.includes(file.type.toLowerCase())) {
        return reject(new Error('Invalid file format. Please upload a JPEG, PNG, or WebP image.'));
      }
      if (file.size > 10 * 1024 * 1024) {
        return reject(new Error('File size exceeds maximum allowed limit (10MB).'));
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error('Invalid or corrupted image data.'));
        img.onload = () => {
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;

          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          
          // White background for PNG transparency conversion
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const outputMime = 'image/jpeg';
          const base64Url = canvas.toDataURL(outputMime, quality);
          const rawBase64 = base64Url.split(',')[1];
          const approxKb = Math.round((rawBase64.length * 3) / 4 / 1024);

          resolve({
            dataUrl: base64Url,
            base64: rawBase64,
            mimeType: outputMime,
            fileName: file.name ? file.name.replace(/\.[^/.]+$/, "") + ".jpg" : "member_photo.jpg",
            fileSizeKb: approxKb,
            width,
            height
          });
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }
};
