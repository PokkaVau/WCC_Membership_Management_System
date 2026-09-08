/**
 * WCC Membership Management System - Central Configuration File
 * All API endpoints, Google Sheet column mappings, and organization settings
 * are defined here. Do not hardcode URLs in other files.
 * Aligned with PokkaVau/WCC_MemberShip_Form-V2-
 */

const CONFIG = {
  // Production Google Sheet / Google Apps Script Web App API Endpoint:
  API_URL: (function() {
    try {
      var saved = localStorage.getItem('wcc_custom_api_url');
      if (saved && typeof saved === 'string') {
        var clean = saved.trim();
        if (clean.startsWith('https://script.google.com/')) {
          var base = clean.split('?')[0].replace(/\/+$/, '');
          return base.endsWith('/exec') ? base : base + '/exec';
        }
      }
    } catch(e) {}
    // Official deployed Google Apps Script Web App for WCC Membership Dashboard
    return "https://script.google.com/macros/s/AKfycbxYDH6QzTipavRXVWcNiUIqOqzq_E7Wy8rp2aYIMwSY0T3o9d8X9oGrTBPYG3SDD6nB/exec";
  })(),

  // Persistent API Connection Status Flag:
  // By default, the API is ALWAYS CONNECTED across all pages and browser sessions.
  // It ONLY disconnects when an administrator explicitly clicks "Disconnect" in settings.
  IS_API_CONNECTED: (function() {
    try {
      return localStorage.getItem('wcc_api_status') !== 'disconnected';
    } catch(e) {
      return true;
    }
  })(),

  // Development / Mock Data Flag:
  // Derived automatically from persistent connection status.
  // ONLY true if administrator has explicitly disconnected the API.
  USE_MOCK_DATA: (function() {
    try {
      return localStorage.getItem('wcc_api_status') === 'disconnected';
    } catch(e) {
      return false;
    }
  })(),

  // Helper method to set connection state and persist across the entire system
  setConnectionStatus: function(isConnected, customUrl) {
    this.IS_API_CONNECTED = !!isConnected;
    this.USE_MOCK_DATA = !isConnected;
    try {
      if (isConnected) {
        localStorage.setItem('wcc_api_status', 'connected');
        localStorage.setItem('wcc_use_mock_data', 'false');
        localStorage.removeItem('wcc_cache_is_mock');
      } else {
        localStorage.setItem('wcc_api_status', 'disconnected');
        localStorage.setItem('wcc_use_mock_data', 'true');
        localStorage.setItem('wcc_cache_is_mock', 'true');
      }
      if (customUrl) {
        var clean = String(customUrl).trim().split('?')[0].replace(/\/+$/, '');
        if (!clean.endsWith('/exec') && clean.includes('/macros/s/')) {
          clean += '/exec';
        }
        this.API_URL = clean;
        localStorage.setItem('wcc_custom_api_url', clean);
      }
      window.dispatchEvent(new CustomEvent('wcc-connection-changed', { detail: { isConnected: !!isConnected } }));
    } catch (e) {}
  },

  // Cache settings in milliseconds (5 minutes)
  CACHE_TTL_MS: 5 * 60 * 1000,

  // Verification Base URL for QR codes:
  VERIFY_BASE_URL: window.location.origin + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + '/verify.html',

  // Organization Information & Branding (We Can Change - Jhalokathi, Bangladesh)
  ORG_INFO: {
    name: "We Can Change",
    acronym: "WCC",
    slogan: "Empowering People, Changing Society",
    address: "Jhalokathi, Bangladesh",
    email: "info@wecanchange.org",
    phone: "+880 1700-000000",
    website: "https://wecanchange.org",
    logoPath: "assets/logo/WCC_logo.png",
    defaultAvatarPath: "assets/images/default-avatar.svg"
  },

  // Central Google Sheet Column Name Mapping Layer:
  // Exact 26 Columns from the "WCC Members" registration form sheet (PokkaVau/WCC_MemberShip_Form-V2-):
  // Timestamp | Name (BN) | Name (EN) | DOB | Father | Mother | NID/BRN | Blood | Mobile | Email |
  // Present Add | Permanent Add | Currently Studying | Class/Year | Current Institution |
  // Last Public Exam | Public Exam Result | Last Qualification | Last Result | Last Institution |
  // Profession | Workplace | Membership | Wing | Reason | Photo URL
  MEMBER_FIELDS: {
    // 1. Core Identity & Form Timestamp
    memberId: "Member ID",                   // Auto-assigned (e.g. WCC-2026-0001) if not in sheet
    timestamp: "Timestamp",                  // Submission timestamp
    registrationDate: "Timestamp",           // Alias for registration date
    nameBn: "Name (BN)",                     // পূর্ণ নাম (বাংলা)
    name: "Name (EN)",                       // পূর্ণ নাম (ইংরেজী)
    nameEn: "Name (EN)",                     // Alias
    dob: "DOB",                              // জন্ম তারিখ (Date of Birth)
    father: "Father",                        // পিতার নাম (Father's Name)
    mother: "Mother",                        // মাতার নাম (Mother's Name)
    nid: "NID/BRN",                          // জাতীয় পরিচয়পত্র / জন্ম নিবন্ধন নম্বর
    bloodGroup: "Blood",                     // রক্তের গ্রুপ (Blood Group)
    phone: "Mobile",                         // মোবাইল নম্বর (Mobile Phone)
    email: "Email",                          // ইমেইল ঠিকানা (Email Address)
    photo: "Photo URL",                      // ছবির লিংক (Google Drive Direct URL)
    presentAddress: "Present Add",           // বর্তমান ঠিকানা (Present Address)
    permanentAddress: "Permanent Add",       // স্থায়ী ঠিকানা (Permanent Address)

    // 2. Education & Academic Background
    currentlyStudying: "Currently Studying", // বর্তমানে অধ্যয়নরত কিনা (হ্যাঁ/না)
    classYear: "Class/Year",                 // শ্রেণি / বর্ষ
    currentInstitution: "Current Institution", // বর্তমান শিক্ষা প্রতিষ্ঠান
    institution: "Current Institution",      // Alias
    lastPublicExam: "Last Public Exam",      // সর্বশেষ পাবলিক পরীক্ষা
    publicExamResult: "Public Exam Result",  // পাবলিক পরীক্ষার ফলাফল
    lastQualification: "Last Qualification", // সর্বশেষ শিক্ষাগত যোগ্যতা
    degree: "Last Qualification",            // Alias
    lastResult: "Last Result",               // সর্বশেষ রেজাল্ট
    lastInstitution: "Last Institution",     // সর্বশেষ প্রতিষ্ঠান

    // 3. Professional, Organization & Wing
    profession: "Profession",                // পেশা / পদবী
    workplace: "Workplace",                  // বর্তমান কর্মস্থল / প্রতিষ্ঠানের নাম ও ঠিকানা
    organization: "Workplace",               // Alias
    membershipType: "Membership",            // মেম্বারশিপ ধরণ (General / Lifetime)
    wing: "Wing",                            // উইং (শিক্ষা, সাংস্কৃতিক, স্বাস্থ্য, খেলাধুলা, পরিবেশ সংরক্ষণ)
    reason: "Reason",                        // যুক্ত হওয়ার উদ্দেশ্য ও ভবিষ্যৎ পরিকল্পনা
    status: "Status"                         // স্ট্যাটাস (Active / Pending / Inactive)
  },

  // Official WCC Wings from Form-V2
  WINGS: [
    "শিক্ষা উইং",
    "সাংস্কৃতিক উইং",
    "স্বাস্থ্য উইং",
    "খেলাধুলা উইং",
    "পরিবেশ সংরক্ষণ উইং"
  ],

  // Official Membership Types from Form-V2
  MEMBERSHIP_TYPES: [
    "General",
    "Lifetime"
  ],

  // Currently Studying options from Form-V2
  STUDYING_OPTIONS: [
    "হ্যাঁ",
    "না"
  ],

  // Class/Year options from Form-V2
  CLASS_YEAR_OPTIONS: [
    "৬ষ্ঠ শ্রেণি", "৭ম শ্রেণি", "৮ম শ্রেণি", "৯ম শ্রেণি", "১০ম শ্রেণি",
    "SSC", "একাদশ শ্রেণি", "দ্বাদশ শ্রেণি", "HSC", "Diploma",
    "১ম বর্ষ", "২য় বর্ষ", "৩য় বর্ষ", "৪র্থ বর্ষ", "Masters", "অন্যান্য"
  ],

  // Last Public Exam options from Form-V2
  LAST_PUBLIC_EXAM_OPTIONS: [
    "PSC / প্রাথমিক শিক্ষা সমাপনী",
    "JSC / জুনিয়র স্কুল সার্টিফিকেট",
    "SSC / সমমান",
    "Dakhil / দাখিল",
    "HSC / সমমান",
    "Alim / আলিম",
    "Diploma in Engineering",
    "Diploma in Medical Technology",
    "O-Level",
    "A-Level",
    "সমমানের অন্যান্য পরীক্ষা",
    "কোনো পাবলিক পরীক্ষা দেওয়া হয়নি"
  ],

  // Last Qualification options from Form-V2
  LAST_QUALIFICATION_OPTIONS: [
    "SSC / সমমান",
    "HSC / সমমান",
    "Diploma",
    "Bachelor / Honours",
    "Masters",
    "O-Level",
    "A-Level",
    "অন্যান্য"
  ],

  // Blood Groups supported in Bengali and English
  BLOOD_GROUPS: [
    "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-",
    "এ+", "এ-", "বি+", "বি-", "এবি+", "এবি-", "ও+", "ও-"
  ],

  // Allowed Membership Statuses
  STATUSES: ["Active", "Pending", "Inactive", "Suspended", "Rejected"],

  // User Roles & Access Control
  ROLES: {
    SUPER_ADMIN: "Super Admin",
    ADMIN: "Admin",
    MODERATOR: "Moderator",
    VIEWER: "Viewer",
    MEMBER: "Member"
  },

  // Audit Log Action Types
  AUDIT_ACTIONS: {
    LOGIN: "LOGIN",
    LOGOUT: "LOGOUT",
    MEMBER_SIGNUP: "MEMBER_SIGNUP",
    PROFILE_SELF_UPDATE: "PROFILE_SELF_UPDATE",
    STATUS_CHANGE: "STATUS_CHANGE",
    CREATE_ADMIN: "CREATE_ADMIN",
    ADMIN_EDIT: "ADMIN_EDIT"
  },

  // Storage Keys for multi-user concurrent sessions & caching
  STORAGE_KEYS: {
    SESSION: "wcc_active_session",
    THEME: "wcc_theme_preference_v2",
    AUDIT_CACHE: "wcc_audit_cache_v2",
    MEMBER_USERS: "wcc_registered_member_users",
    CUSTOM_API_URL: "wcc_custom_api_url",
    USE_MOCK_DATA: "wcc_use_mock_data"
  }
};

// Freeze config object to prevent accidental runtime mutation
if (typeof Object.freeze === 'function') {
  Object.freeze(CONFIG.MEMBER_FIELDS);
  Object.freeze(CONFIG.ROLES);
}
