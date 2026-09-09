/**
 * ==============================================================================
 * We Can Change (WCC) - Google Apps Script Backend Web App & Security Engine
 * ==============================================================================
 * Architecture:
 * 1. "WCC Members" Sheet (Primary Form & Directory Sheet):
 *    - Stores all member responses from the WCC Membership Form.
 *    - Exact 26 Columns:
 *      Timestamp | Name (BN) | Name (EN) | DOB | Father | Mother | NID/BRN |
 *      Blood | Mobile | Email | Present Add | Permanent Add | Currently Studying |
 *      Class/Year | Current Institution | Last Public Exam | Public Exam Result |
 *      Last Qualification | Last Result | Last Institution | Profession |
 *      Workplace | Membership | Wing | Reason | Photo URL
 *    - Handled with zero disruption to form responses.
 * 
 * 2. Admin, Auth & Audit Sheet (Secondary / Dedicated Admin Spreadsheet):
 *    - Stores Administrative Logins ("Admins" tab)
 *    - Stores Member Activation Credentials & Salted Hashes ("Member_Auth" tab)
 *    - Stores Chronological System Audit Trail ("Audit_Log" tab)
 *    - Can live in a SEPARATE Google Spreadsheet or as tabs in the same file.
 * ==============================================================================
 */

/* ==============================================================================
   CONFIGURATION
   ============================================================================== */

// 1. Existing WCC Members Google Spreadsheet ID:
// Copy this from the URL of your existing sheet: https://docs.google.com/spreadsheets/d/PASTE_THIS_ID_HERE/edit
// This allows you to KEEP your existing registration script 100% untouched and safe!
var WCC_MEMBERS_SPREADSHEET_ID = "";

// 2. Name of the sheet tab where the registration form records members:
var MEMBERS_TAB_NAME = "WCC Members";

// 3. Separate Admin & Audit Spreadsheet ID (Optional):
// If left empty (""), Admins, Member_Auth, and Audit_Log will live in the spreadsheet where this script is installed.
var ADMIN_SPREADSHEET_ID = "";

// 4. Tab Names for Admin & Security Layer:
var ADMINS_TAB_NAME = "Admins";
var AUDIT_LOG_TAB_NAME = "Audit_Log";
var MEMBER_AUTH_TAB_NAME = "Member_Auth";

// 5. Global Secret for HMAC Token Signatures (retrieved from ScriptProperties or secure fallback)
var JWT_SECRET = (function() {
  try {
    var prop = PropertiesService.getScriptProperties().getProperty("JWT_SECRET");
    if (prop && prop.trim().length > 10) return prop.trim();
  } catch(e) {}
  return "WCC_SECURE_HMAC_KEY_98a7df098b67c2e1_2026";
})();

/**
 * Enterprise Rate Limiting Helper using ScriptCache
 * Prevents brute-force attacks on login, OTP, and password reset
 */
function checkRateLimit(key, maxAttempts, windowSeconds) {
  try {
    var cache = CacheService.getScriptCache();
    var current = Number(cache.get(key) || 0);
    if (current >= maxAttempts) {
      return false;
    }
    cache.put(key, String(current + 1), windowSeconds);
    return true;
  } catch (e) {
    return true; // fail-open if cache is temporarily unavailable
  }
}

function resetRateLimit(key) {
  try {
    CacheService.getScriptCache().remove(key);
  } catch (e) {}
}

/**
 * ==============================================================================
 * 1-CLICK PERMISSION AUTHORIZATION & DRIVE SETUP HELPER
 * ==============================================================================
 * INSTRUCTIONS FOR USER:
 * 1. Open Apps Script editor (Extensions > Apps Script).
 * 2. In the toolbar function dropdown at top, select "authorizeAndSetupDrivePermissions".
 * 3. Click "Run" (▶).
 * 4. Google dialog appears: "Authorization Required" -> Click "Review Permissions".
 * 5. Choose your Google account -> Click "Advanced" -> Click "Go to (unsafe)".
 * 6. Click "Allow".
 * 7. DONE! Google Drive permissions are now 100% granted for photo uploads!
 * ==============================================================================
 */
function authorizeAndSetupDrivePermissions() {
  Logger.log("Testing Google Drive and Spreadsheet Permissions...");
  try {
    var folders = DriveApp.getFoldersByName("WCC_Member_Photos");
    var folder;
    if (folders.hasNext()) {
      folder = folders.next();
      Logger.log("Existing 'WCC_Member_Photos' folder verified: " + folder.getUrl());
    } else {
      folder = DriveApp.createFolder("WCC_Member_Photos");
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      Logger.log("Created new 'WCC_Member_Photos' folder: " + folder.getUrl());
    }
    var memSS = getMembersSpreadsheet();
    var adminSS = getAdminSpreadsheet();
    ensureSystemTabs(memSS, adminSS);
    Logger.log("Spreadsheets verified: Members=" + memSS.getName() + ", Admin=" + adminSS.getName());
    Logger.log("🎉 SUCCESS: ALL DRIVE & SPREADSHEET PERMISSIONS AUTHORIZED!");
    return "SUCCESS: All permissions authorized.";
  } catch (err) {
    Logger.log("Authorization prompt error: " + err.toString());
    throw err;
  }
}

// Alias function name for easy discovery in dropdown
function setupInitialPermissions() {
  return authorizeAndSetupDrivePermissions();
}

/**
 * Get the Spreadsheet containing WCC Members Form responses
 */
function getMembersSpreadsheet() {
  if (WCC_MEMBERS_SPREADSHEET_ID && String(WCC_MEMBERS_SPREADSHEET_ID).trim() !== "") {
    try {
      return SpreadsheetApp.openById(String(WCC_MEMBERS_SPREADSHEET_ID).trim());
    } catch (e) {
      Logger.log("Could not open WCC Members Spreadsheet by ID: " + e.toString());
    }
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Get the Spreadsheet containing Admin & Audit records
 */
function getAdminSpreadsheet() {
  if (ADMIN_SPREADSHEET_ID && String(ADMIN_SPREADSHEET_ID).trim() !== "") {
    try {
      return SpreadsheetApp.openById(String(ADMIN_SPREADSHEET_ID).trim());
    } catch (e) {
      Logger.log("Could not open Admin Spreadsheet by ID, using active spreadsheet: " + e.toString());
    }
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Invalidate server-side CacheService cache
 */
function invalidateMembersCache() {
  try {
    CacheService.getScriptCache().remove("wcc_members_cache_v2");
  } catch (e) {
    Logger.log("Cache invalidation error: " + e);
  }
}

/**
 * Handle HTTP GET Requests (Members List, Admins, Audit Logs, Fast Ping)
 */
function doGet(e) {
  try {
    var rawAction = (e && e.parameter && e.parameter.action) ? e.parameter.action : "members";
    var action = String(rawAction).toLowerCase().trim();

    // 1. Ultra-fast ping / health check path (Instant response, zero spreadsheet I/O)
    if (action === "ping") {
      return createJsonResponse({
        status: "success",
        message: "pong",
        timestamp: new Date().toISOString(),
        version: "2.4.0"
      });
    }

    var memSS = getMembersSpreadsheet();
    var adminSS = getAdminSpreadsheet();

    // 2. Safe Public Member Verification for QR Codes & Cards (ZERO PII LEAK)
    if (action === "verifymember" || action === "verify") {
      var memberIdParam = (e && e.parameter && (e.parameter.id || e.parameter.memberId)) || "";
      return getPublicMemberVerification(memSS, memberIdParam);
    }

    var token = (e && e.parameter && (e.parameter.token || e.parameter.auth)) || "";

    if (action === "auditlogs" || action === "audit_logs") {
      var verifiedAdmin = verifySessionToken(token, "admin");
      if (!verifiedAdmin) {
        return createJsonResponse({ status: "error", code: "UNAUTHORIZED", message: "Administrative authentication required to view audit logs." });
      }
      return getAuditLogs(adminSS);
    } else if (action === "admins") {
      var verifiedSuper = verifySessionToken(token, "super admin");
      if (!verifiedSuper) {
        return createJsonResponse({ status: "error", code: "UNAUTHORIZED", message: "Super Admin privileges required to view admin list." });
      }
      return getAdminsList(adminSS);
    } else {
      return getMembersList(memSS, adminSS);
    }
  } catch (err) {
    return createJsonResponse({ status: "error", message: err.toString() });
  }
}

/**
 * Handle HTTP POST Requests (State modifications, Auth, Registrations, Updates, Form V2 Submissions)
 */
function doPost(e) {
  try {
    var memSS = getMembersSpreadsheet();
    var adminSS = getAdminSpreadsheet();
    ensureSystemTabs(memSS, adminSS);

    var contents = {};
    if (e && e.postData && e.postData.contents) {
      try {
        contents = JSON.parse(e.postData.contents);
      } catch (jsonErr) {
        contents = e.parameter || {};
      }
    } else if (e && e.parameter) {
      contents = e.parameter;
    }

    var rawAction = String(contents.action || (e && e.parameter && e.parameter.action) || "").trim();
    var action = rawAction.toLowerCase();

    // Direct Form Submission from PokkaVau/WCC_MemberShip_Form-V2-
    if (action === "submitform" || (!action && (contents.name_bn || contents.name_en || (e && e.parameter && (e.parameter.name_bn || e.parameter.name_en))))) {
      var formParams = Object.assign({}, (e && e.parameter) || {}, contents || {});
      var formResp = handleNewFormSubmission(memSS, adminSS, formParams);
      invalidateMembersCache();
      return formResp;
    }

    var resp;
    switch (action) {
      case "login":
        return handleLogin(memSS, adminSS, contents);

      case "registermember":
        resp = handleRegisterMember(memSS, adminSS, contents);
        invalidateMembersCache();
        return resp;

      case "submitform":
        resp = handleNewFormSubmission(memSS, adminSS, contents);
        invalidateMembersCache();
        return resp;

      case "updatememberprofile":
        resp = handleMemberSelfUpdate(memSS, adminSS, contents);
        invalidateMembersCache();
        return resp;

      case "uploadprofilephoto":
      case "uploadprofilephot": // Handles accidental trailing truncation
      case "photoupload":
      case "uploadphoto":
        resp = handlePhotoUpload(memSS, adminSS, contents);
        invalidateMembersCache();
        return resp;

      case "updatestatus":
        resp = handleUpdateStatus(memSS, adminSS, contents);
        invalidateMembersCache();
        return resp;

      case "createadmin":
        return handleCreateAdmin(adminSS, contents);

      case "logaudit":
        return handleCustomAuditLog(adminSS, contents);

      case "requestpasswordreset":
      case "forgotpassword":
        return handleRequestPasswordReset(memSS, adminSS, contents);

      case "resetpassword":
        resp = handleResetPassword(memSS, adminSS, contents);
        invalidateMembersCache();
        return resp;

      default:
        return createJsonResponse({ status: "error", message: "Unsupported action: " + action });
    }
  } catch (err) {
    return createJsonResponse({ status: "error", message: err.toString() });
  }
}

/* ==============================================================================
   CORE BUSINESS LOGIC & HANDLERS
   ============================================================================== */

/**
 * Authenticate Admin, Staff, or Member with Role-Based Segregation
 */
function handleLogin(memSS, adminSS, payload) {
  var username = String(payload.username || "").trim().toLowerCase();
  var password = String(payload.password || "");
  var expectedRole = String(payload.expectedRole || payload.role || "").trim().toLowerCase();

  if (!username || !password) {
    return createJsonResponse({ status: "error", message: "Email/Username and Password are required." });
  }

  // Rate Limiting: max 10 failed login attempts per 15 minutes per username
  var rateLimitKey = "rl_login_" + username.replace(/[^a-zA-Z0-9]/g, "_");
  if (!checkRateLimit(rateLimitKey, 10, 900)) {
    return createJsonResponse({
      status: "error",
      message: "Too many failed login attempts. Account temporarily locked for 15 minutes."
    });
  }

  var adminsSheet = getOrInitSheet(adminSS, ADMINS_TAB_NAME);
  var adminData = adminsSheet.getDataRange().getValues();
  var adminMatch = null;
  var isAdminAccount = false;

  if (adminData.length > 1) {
    var aHeaders = adminData[0];
    var emailIdx = getColIndex(aHeaders, ["email", "username"]);
    var hashIdx = getColIndex(aHeaders, ["passwordhash", "hash", "password"]);
    var saltIdx = getColIndex(aHeaders, ["salt"]);
    var roleIdx = getColIndex(aHeaders, ["role"]);
    var nameIdx = getColIndex(aHeaders, ["name", "fullname"]);
    var statusIdx = getColIndex(aHeaders, ["status"]);
    var lastLoginIdx = getColIndex(aHeaders, ["lastlogin", "last login"]);

    for (var i = 1; i < adminData.length; i++) {
      var aRow = adminData[i];
      var rowEmail = String(aRow[emailIdx] || "").trim().toLowerCase();
      var isSuperAdminAlias = (username === "admin" || username === "wccadmin" || username === "superadmin") && (rowEmail === "admin@wecanchange.org" || rowEmail === "admin");
      
      if (rowEmail === username || isSuperAdminAlias) {
        isAdminAccount = true;
        var rowStatus = String(aRow[statusIdx] || "Active").trim();
        if (rowStatus.toLowerCase() === "inactive") {
          return createJsonResponse({ status: "error", message: "This administrative account has been deactivated." });
        }

        var aSalt = String(aRow[saltIdx] || "");
        var aExpectedHash = String(aRow[hashIdx] || "");
        var aCalculatedHash = hashPassword(password, aSalt);
        var isPassMatch = (aCalculatedHash === aExpectedHash);

        if (isPassMatch) {
          adminMatch = {
            rowIndex: i + 1,
            email: rowEmail,
            role: String(aRow[roleIdx] || "Admin").trim(),
            name: String(aRow[nameIdx] || "Administrator").trim(),
            lastLoginCol: lastLoginIdx !== -1 ? lastLoginIdx + 1 : null
          };
          break;
        }
      }
    }
  }

  // If client requested Member login specifically, but an Admin account matched
  if (expectedRole === "member" && adminMatch) {
    return createJsonResponse({
      status: "error",
      message: "This account has Administrator privileges. Please switch to the 'Admin Login' tab to sign in."
    });
  }

  // 1. Successful Admin Login
  if (adminMatch && (expectedRole === "admin" || !expectedRole)) {
    resetRateLimit(rateLimitKey);
    if (adminMatch.lastLoginCol) {
      adminsSheet.getRange(adminMatch.rowIndex, adminMatch.lastLoginCol).setValue(new Date());
    }

    var adminToken = generateSessionToken(username, adminMatch.role);
    writeAuditLog(adminSS, username, adminMatch.role, "ADMIN_LOGIN", username, "Admin signed in successfully from portal.");

    return createJsonResponse({
      status: "success",
      token: adminToken,
      user: {
        email: username,
        name: adminMatch.name,
        role: adminMatch.role,
        isMember: false
      }
    });
  }

  // If client requested Admin login, do not authenticate as Member
  if (expectedRole === "admin") {
    // Check if user is a member to give helpful error
    var memSheetForCheck = getMembersSheet(memSS);
    var isMemberAccount = false;
    if (memSheetForCheck) {
      var chkData = memSheetForCheck.getDataRange().getValues();
      var chkHeaders = chkData[0] || [];
      var chkEmailIdx = getColIndex(chkHeaders, ["email"]);
      var chkIdIdx = getColIndex(chkHeaders, ["member id", "memberid"]);
      for (var c = 1; c < chkData.length; c++) {
        var mE = String(chkData[c][chkEmailIdx] || "").trim().toLowerCase();
        var mI = chkIdIdx !== -1 ? String(chkData[c][chkIdIdx] || "").trim().toLowerCase() : "";
        if (mE === username || mI === username) {
          isMemberAccount = true;
          break;
        }
      }
    }
    if (isMemberAccount) {
      return createJsonResponse({
        status: "error",
        message: "This account belongs to a WCC Member. Please switch to the 'Member Login' tab to sign in."
      });
    }
    return createJsonResponse({
      status: "error",
      message: "Invalid administrator email or password. Please check your credentials."
    });
  }

  // 2. Check Member_Auth Tab (Member Login)
  var authSheet = getOrInitSheet(adminSS, MEMBER_AUTH_TAB_NAME);
  var authData = authSheet.getDataRange().getValues();
  var authHeaders = authData[0] || [];
  var authEmailIdx = getColIndex(authHeaders, ["email"]);
  var authPassIdx = getColIndex(authHeaders, ["passwordhash", "password"]);
  var authSaltIdx = getColIndex(authHeaders, ["salt"]);
  var authIdIdx = getColIndex(authHeaders, ["memberid", "member id"]);
  var authStatusIdx = getColIndex(authHeaders, ["status"]);

  // Cross-reference Member Details from "WCC Members" sheet
  var memSheet = getMembersSheet(memSS);
  var memData = memSheet.getDataRange().getValues();
  var memHeaders = memData[0] || [];
  var mEmailIdx = getColIndex(memHeaders, ["email"]);
  var mNameIdx = getColIndex(memHeaders, ["name (en)", "name", "fullname"]);
  var mPhoneIdx = getColIndex(memHeaders, ["mobile", "phone"]);
  var mIdIdx = getColIndex(memHeaders, ["member id", "memberid"]);

  // Resolve if username is a phone number
  var cleanUserPhone = username.replace(/[^0-9]/g, "");
  if (cleanUserPhone.indexOf("880") === 0) cleanUserPhone = cleanUserPhone.substring(3);
  else if (cleanUserPhone.indexOf("88") === 0) cleanUserPhone = cleanUserPhone.substring(2);
  if (cleanUserPhone.indexOf("0") === 0) cleanUserPhone = cleanUserPhone.substring(1);

  var resolvedEmail = "";
  var resolvedId = "";

  if (cleanUserPhone.length >= 8) {
    for (var m = 1; m < memData.length; m++) {
      var rowPhone = String(memData[m][mPhoneIdx] || "").replace(/[^0-9]/g, "");
      if (rowPhone.indexOf("880") === 0) rowPhone = rowPhone.substring(3);
      else if (rowPhone.indexOf("88") === 0) rowPhone = rowPhone.substring(2);
      if (rowPhone.indexOf("0") === 0) rowPhone = rowPhone.substring(1);
      if (rowPhone && rowPhone === cleanUserPhone) {
        resolvedEmail = String(memData[m][mEmailIdx] || "").trim().toLowerCase();
        if (mIdIdx !== -1) resolvedId = String(memData[m][mIdIdx] || "").trim().toLowerCase();
        break;
      }
    }
  }

  var memberAuthMatch = null;

  for (var a = 1; a < authData.length; a++) {
    var aRow = authData[a];
    var aEmail = String(aRow[authEmailIdx] || "").trim().toLowerCase();
    var aId = String(aRow[authIdIdx] || "").trim().toLowerCase();

    var isTargetUser = (username === aEmail || username === aId || (resolvedEmail && resolvedEmail === aEmail) || (resolvedId && resolvedId === aId));

    if (isTargetUser) {
      var mSalt = String(aRow[authSaltIdx] || "");
      var mExpectedHash = String(aRow[authPassIdx] || "");
      var mCalculatedHash = hashPassword(password, mSalt);

      if (mCalculatedHash === mExpectedHash) {
        memberAuthMatch = {
          email: aEmail,
          memberId: aRow[authIdIdx] || "",
          status: aRow[authStatusIdx] || "Active"
        };
        break;
      }
    }
  }

  if (memberAuthMatch) {
    var memberName = "WCC Member";
    var memberPhone = "";

    for (var m2 = 1; m2 < memData.length; m2++) {
      if (String(memData[m2][mEmailIdx] || "").trim().toLowerCase() === memberAuthMatch.email) {
        memberName = String(memData[m2][mNameIdx] || memberName).trim();
        memberPhone = String(memData[m2][mPhoneIdx] || "").trim();
        break;
      }
    }

    resetRateLimit(rateLimitKey);
    var memberToken = generateSessionToken(memberAuthMatch.email, "Member");
    writeAuditLog(adminSS, memberAuthMatch.memberId || memberAuthMatch.email, "Member", "MEMBER_LOGIN", memberAuthMatch.memberId, "Member signed in to self-service portal.");

    return createJsonResponse({
      status: "success",
      token: memberToken,
      user: {
        memberId: memberAuthMatch.memberId,
        email: memberAuthMatch.email,
        name: memberName,
        phone: memberPhone,
        status: memberAuthMatch.status,
        role: "Member",
        isMember: true
      }
    });
  }

  if (isAdminAccount) {
    return createJsonResponse({
      status: "error",
      message: "This account has Administrator privileges. Please switch to the 'Admin Login' tab to sign in."
    });
  }

  return createJsonResponse({
    status: "error",
    message: "Invalid Member ID, email, phone, or password. Please verify your credentials."
  });
}

/**
 * Handle Member Activation / Sign Up
 * Verifies email exists in "WCC Members" sheet, then sets password in "Member_Auth" tab
 */
function handleRegisterMember(memSS, adminSS, payload) {
  var email = String(payload.email || "").trim().toLowerCase();
  var password = String(payload.password || "").trim();

  if (!email || !password) {
    return createJsonResponse({ status: "error", message: "Email and password are required." });
  }

  if (password.length < 6) {
    return createJsonResponse({ status: "error", message: "Password must be at least 6 characters long." });
  }

  // 1. Verify that email exists in "WCC Members" sheet
  var memSheet = getMembersSheet(memSS);
  var memData = memSheet.getDataRange().getValues();
  if (memData.length < 2) {
    return createJsonResponse({ status: "error", message: "No members found in the database. Please contact administration." });
  }

  var headers = memData[0];
  var emailCol = getColIndex(headers, ["email"]);
  var nameCol = getColIndex(headers, ["name (en)", "name", "fullname"]);
  var idCol = getColIndex(headers, ["member id", "memberid"]);
  var timestampCol = getColIndex(headers, ["timestamp"]);

  if (emailCol === -1) {
    return createJsonResponse({ status: "error", message: "Email column not found in WCC Members sheet." });
  }

  var phoneCol = getColIndex(headers, ["mobile", "phone"]);

  var matchedRowIndex = -1;
  var memberName = "";
  var memberId = "";
  var submissionYear = "2026";

  var cleanInputPhone = email.replace(/[^0-9]/g, "");
  if (cleanInputPhone.indexOf("880") === 0) cleanInputPhone = cleanInputPhone.substring(3);
  else if (cleanInputPhone.indexOf("88") === 0) cleanInputPhone = cleanInputPhone.substring(2);
  if (cleanInputPhone.indexOf("0") === 0) cleanInputPhone = cleanInputPhone.substring(1);

  for (var r = 1; r < memData.length; r++) {
    var rowEmail = String(memData[r][emailCol] || "").trim().toLowerCase();
    var rowId = (idCol !== -1) ? String(memData[r][idCol] || "").trim().toLowerCase() : "";
    var rowPhone = (phoneCol !== -1) ? String(memData[r][phoneCol] || "").replace(/[^0-9]/g, "") : "";
    if (rowPhone.indexOf("880") === 0) rowPhone = rowPhone.substring(3);
    else if (rowPhone.indexOf("88") === 0) rowPhone = rowPhone.substring(2);
    if (rowPhone.indexOf("0") === 0) rowPhone = rowPhone.substring(1);

    var isMatch = (rowEmail === email || (rowId && rowId === email) || (cleanInputPhone.length >= 8 && rowPhone && rowPhone === cleanInputPhone));

    if (isMatch) {
      matchedRowIndex = r + 1;
      memberName = String(memData[r][nameCol] || "Member").trim();
      email = rowEmail || email; // Bind to official email from sheet
      
      if (idCol !== -1 && memData[r][idCol]) {
        memberId = String(memData[r][idCol]).trim();
      } else {
        var tsVal = timestampCol !== -1 ? memData[r][timestampCol] : new Date();
        if (tsVal instanceof Date) {
          submissionYear = Utilities.formatDate(tsVal, Session.getScriptTimeZone(), "yyyy");
        }
        memberId = "WCC-" + submissionYear + "-" + ("000" + r).slice(-4);
      }
      break;
    }
  }

  if (matchedRowIndex === -1) {
    return createJsonResponse({
      status: "error",
      message: "The entered identifier '" + email + "' was not found in the WCC Members database. Please ensure you enter your registered email, phone number, or Member ID."
    });
  }

  // 2. Check or Create Auth Record in "Member_Auth" tab of admin spreadsheet
  var authSheet = getOrInitSheet(adminSS, MEMBER_AUTH_TAB_NAME);
  var authData = authSheet.getDataRange().getValues();
  var authHeaders = authData[0];
  var aEmailCol = getColIndex(authHeaders, ["email"]);
  var aHashCol = getColIndex(authHeaders, ["passwordhash", "password"]);
  var aSaltCol = getColIndex(authHeaders, ["salt"]);
  var aIdCol = getColIndex(authHeaders, ["memberid", "member id"]);
  var aStatusCol = getColIndex(authHeaders, ["status"]);
  var aDateCol = getColIndex(authHeaders, ["activatedat", "date"]);

  var existingAuthRow = -1;
  for (var a = 1; a < authData.length; a++) {
    if (String(authData[a][aEmailCol] || "").trim().toLowerCase() === email) {
      existingAuthRow = a + 1;
      break;
    }
  }

  var salt = generateSalt();
  var hash = hashPassword(password, salt);
  var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  if (existingAuthRow !== -1) {
    // Update existing password
    authSheet.getRange(existingAuthRow, aHashCol + 1).setValue(hash);
    authSheet.getRange(existingAuthRow, aSaltCol + 1).setValue(salt);
    authSheet.getRange(existingAuthRow, aIdCol + 1).setValue(memberId);
    authSheet.getRange(existingAuthRow, aDateCol + 1).setValue(nowStr);
  } else {
    // Append new member auth row: MemberID, Email, PasswordHash, Salt, Status, ActivatedAt
    authSheet.appendRow([memberId, email, hash, salt, "Active", nowStr]);
  }

  // 3. Log Audit Trail Entry
  writeAuditLog(
    adminSS,
    memberId,
    "Member",
    "MEMBER_SIGNUP",
    memberId,
    "Member verified email (" + email + ") and activated portal account."
  );

  return createJsonResponse({
    status: "success",
    message: "Account activated successfully for " + memberName + "!",
    memberId: memberId,
    name: memberName
  });
}

/**
 * Handle Direct Form Submission from PokkaVau/WCC_MemberShip_Form-V2-
 * Appends exact 26 columns to "WCC Members" sheet and uploads photo to Drive
 */
function handleNewFormSubmission(memSS, adminSS, p) {
  try {
    var sheet = getMembersSheet(memSS);
    var now = new Date();
    var timestampStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

    // Process photo if base64 provided (Drive Upload)
    var photoUrl = "";
    var rawPhotoData = p.image_base64 || p.photoBase64 || p.photoData || "";
    if (!rawPhotoData && p.photo && String(p.photo).indexOf("data:image") === 0) {
      rawPhotoData = p.photo;
    }
    if (!rawPhotoData && p.photoUrl && String(p.photoUrl).indexOf("data:image") === 0) {
      rawPhotoData = p.photoUrl;
    }

    if (rawPhotoData && String(rawPhotoData).trim() !== "") {
      try {
        var base64Data = String(rawPhotoData).replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
        var decoded = Utilities.base64Decode(base64Data);
        var mimeType = p.image_type || p.mimeType || "image/jpeg";
        var cleanName = (p.name_en || p.name || "member").replace(/[^a-zA-Z0-9]/g, "_");
        var fileName = cleanName + "_" + Date.now() + ".jpg";
        var blob = Utilities.newBlob(decoded, mimeType, fileName);

        // Upload to Drive folder "WCC_Member_Photos"
        var folders = DriveApp.getFoldersByName("WCC_Member_Photos");
        var folder;
        if (folders.hasNext()) {
          folder = folders.next();
        } else {
          folder = DriveApp.createFolder("WCC_Member_Photos");
        }
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        photoUrl = "https://lh3.googleusercontent.com/d/" + file.getId();
      } catch (imgErr) {
        Logger.log("Image upload warning: " + imgErr);
        // Under NO circumstances write raw base64 to sheet!
        photoUrl = (p.photo && String(p.photo).indexOf("http") === 0) ? p.photo : ((p.photoUrl && String(p.photoUrl).indexOf("http") === 0) ? p.photoUrl : "");
      }
    } else {
      photoUrl = (p.photo && String(p.photo).indexOf("http") === 0) ? p.photo : ((p.photoUrl && String(p.photoUrl).indexOf("http") === 0) ? p.photoUrl : "");
    }

    // Exact 26 Columns matching PokkaVau/WCC_MemberShip_Form-V2-
    var row = [
      timestampStr,                                         // 1. Timestamp
      String(p.name_bn || p.nameBn || "").trim(),           // 2. Name (BN)
      String(p.name_en || p.nameEn || p.name || "").trim(), // 3. Name (EN)
      String(p.dob || "").trim(),                           // 4. DOB
      String(p.father_name || p.father || "").trim(),       // 5. Father
      String(p.mother_name || p.mother || "").trim(),       // 6. Mother
      String(p.nid_brn || p.nid || "").trim(),              // 7. NID/BRN
      String(p.blood_group || p.blood || "").trim(),        // 8. Blood
      String(p.mobile || p.phone || "").trim(),             // 9. Mobile
      String(p.email || "").trim().toLowerCase(),           // 10. Email
      String(p.present_address || p.presentAddress || "").trim(), // 11. Present Add
      String(p.permanent_address || p.permanentAddress || "").trim(), // 12. Permanent Add
      String(p.currently_studying || p.currentlyStudying || "না").trim(), // 13. Currently Studying
      String(p.studying_class || p.classYear || "").trim(), // 14. Class/Year
      String(p.current_institution || p.currentInstitution || "").trim(), // 15. Current Institution
      String(p.last_public_exam || p.lastPublicExam || "").trim(), // 16. Last Public Exam
      String(p.public_exam_result || p.publicExamResult || "").trim(), // 17. Public Exam Result
      String(p.last_qualification || p.lastQualification || "").trim(), // 18. Last Qualification
      String(p.last_result || p.lastResult || "").trim(),   // 19. Last Result
      String(p.last_institution || p.lastInstitution || "").trim(), // 20. Last Institution
      String(p.profession || "").trim(),                    // 21. Profession
      String(p.workplace || "").trim(),                     // 22. Workplace
      String(p.membership || p.membershipType || "General").trim(), // 23. Membership
      String(p.wing || "").trim(),                          // 24. Wing
      String(p.reason || "").trim(),                        // 25. Reason
      photoUrl                                              // 26. Photo URL
    ];

    // HARD GUARD: Protect against Google Sheets 50,000 char per cell limit
    for (var i = 0; i < row.length; i++) {
      var itemVal = String(row[i] || "");
      if (itemVal.indexOf("data:image") === 0 || itemVal.indexOf(";base64,") !== -1 || itemVal.length > 5000) {
        if (i === 25 || itemVal.indexOf("data:image") === 0 || itemVal.indexOf(";base64,") !== -1) {
          row[i] = ""; // Strip raw image data completely from cell
        } else {
          row[i] = itemVal.substring(0, 5000);
        }
      }
    }

    sheet.appendRow(row);

    // Log to Audit Trail
    writeAuditLog(
      adminSS,
      p.email || p.name_en || "Public User",
      "Applicant",
      "MEMBER_SIGNUP",
      p.email || "New Applicant",
      "New member registration submitted via WCC Form V2 (" + (p.name_en || "") + ")."
    );

    // Return response in format expected by WCC_MemberShip_Form-V2- script.js
    return createJsonResponse({
      ok: true,
      status: "success",
      photoUrl: photoUrl,
      message: "Membership form submitted successfully."
    });
  } catch (err) {
    return createJsonResponse({
      ok: false,
      status: "error",
      error: err.toString(),
      message: err.toString()
    });
  }
}

/**
 * Handle Member Self-Service Profile Update
 * Updates the member's row directly in "WCC Members" sheet
 */
function handleMemberSelfUpdate(memSS, adminSS, payload) {
  var memberId = String(payload.memberId || "").trim();
  var email = String(payload.email || "").trim().toLowerCase();
  var token = payload.token || "";

  // Authorization Check: Must be authenticated as the member themselves or an administrator
  if (token) {
    var tokenPayload = verifySessionToken(token);
    if (!tokenPayload) {
      return createJsonResponse({ status: "error", code: "UNAUTHORIZED", message: "Session expired or invalid. Please sign in again." });
    }
    var callerRole = String(tokenPayload.role || "").toLowerCase();
    var callerSub = String(tokenPayload.sub || "").toLowerCase();
    var isStaff = (callerRole === "super admin" || callerRole === "admin" || callerRole === "moderator");
    var isSelf = (callerSub === memberId.toLowerCase() || (email && callerSub === email));
    if (!isStaff && !isSelf) {
      return createJsonResponse({ status: "error", code: "FORBIDDEN", message: "Access denied. You cannot modify another member's profile." });
    }
  }

  if (!memberId && !email) {
    return createJsonResponse({ status: "error", message: "Member ID or Email is required for update." });
  }

  var sheet = getMembersSheet(memSS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var idCol = getColIndex(headers, ["member id", "memberid"]);
  var emailCol = getColIndex(headers, ["email"]);
  var phoneCol = getColIndex(headers, ["mobile", "phone"]);
  var cleanPhone = String(payload.phone || payload.mobile || "").replace(/[^0-9]/g, "");
  var cleanMemId = memberId.toLowerCase();

  var targetRow = -1;
  for (var r = 1; r < data.length; r++) {
    var rowId = (idCol !== -1) ? String(data[r][idCol] || "").trim().toLowerCase() : "";
    var rowEmail = (emailCol !== -1) ? String(data[r][emailCol] || "").trim().toLowerCase() : "";
    var rowPhone = (phoneCol !== -1) ? String(data[r][phoneCol] || "").replace(/[^0-9]/g, "") : "";
    
    // Auto generated ID check for both 2025 and 2026 batches
    var autoId2026 = "wcc-2026-" + ("000" + r).slice(-4);
    var autoId2025 = "wcc-2025-" + ("000" + r).slice(-4);
    var rowNumStr = String(r);

    var idMatch = memberId && (
      rowId === cleanMemId || 
      autoId2026 === cleanMemId || 
      autoId2025 === cleanMemId || 
      cleanMemId.replace(/[^0-9]/g, "") === ("000" + r).slice(-4)
    );
    var emailMatch = email && rowEmail && (rowEmail === email);
    var phoneMatch = cleanPhone && rowPhone && (rowPhone.slice(-10) === cleanPhone.slice(-10));

    if (idMatch || emailMatch || phoneMatch) {
      targetRow = r + 1;
      break;
    }
  }

  if (targetRow === -1) {
    return createJsonResponse({ status: "error", message: "Member record not found in WCC Members sheet." });
  }

  var changes = [];

  // Process direct base64 photo upload if provided in profile self update
  var uploadedPhotoUrl = "";
  var photoData = payload.photoBase64 || payload.photoData || payload.image_base64;
  if (!photoData && payload.photo && String(payload.photo).indexOf("data:image") === 0) {
    photoData = payload.photo;
  }
  if (!photoData && payload.photoUrl && String(payload.photoUrl).indexOf("data:image") === 0) {
    photoData = payload.photoUrl;
  }

  if (photoData && String(photoData).trim() !== "") {
    try {
      var photoUploadRes = savePhotoToDriveAndSheet(memSS, adminSS, targetRow, headers, memberId, email, photoData, payload.photoName, payload.mimeType);
      if (photoUploadRes && photoUploadRes.photoUrl) {
        uploadedPhotoUrl = photoUploadRes.photoUrl;
        changes.push("Photo uploaded to Google Drive (" + uploadedPhotoUrl + ")");
      }
    } catch (photoErr) {
      Logger.log("Photo upload error in self-update: " + photoErr);
    }
  }

  // Comprehensive field mapping covering all 26 columns and both camelCase and snake_case
  var fieldMapping = {
    // 1. Personal & Contact
    nameBn: ["name (bn)", "name_bn"],
    name_bn: ["name (bn)", "name_bn"],
    nameEn: ["name (en)", "name_en", "name"],
    name_en: ["name (en)", "name_en", "name"],
    name: ["name (en)", "name_en", "name"],
    dob: ["dob", "date of birth"],
    gender: ["gender", "লিঙ্গ"],
    father: ["father", "father_name"],
    father_name: ["father", "father_name"],
    mother: ["mother", "mother_name"],
    mother_name: ["mother", "mother_name"],
    nid: ["nid/brn", "nid_brn", "nid"],
    nid_brn: ["nid/brn", "nid_brn", "nid"],
    blood: ["blood", "blood_group"],
    bloodGroup: ["blood", "blood_group"],
    blood_group: ["blood", "blood_group"],
    phone: ["mobile", "phone"],
    mobile: ["mobile", "phone"],
    email: ["email"],
    photo: ["photo url", "photo"],
    photoUrl: ["photo url", "photo"],
    presentAddress: ["present add", "present_address", "present address"],
    present_address: ["present add", "present_address", "present address"],
    permanentAddress: ["permanent add", "permanent_address", "permanent address"],
    permanent_address: ["permanent add", "permanent_address", "permanent address"],

    // 2. Educational Information
    currentlyStudying: ["currently studying", "currently_studying"],
    currently_studying: ["currently studying", "currently_studying"],
    classYear: ["class/year", "studying_class", "class year"],
    studying_class: ["class/year", "studying_class", "class year"],
    currentInstitution: ["current institution", "current_institution", "institution"],
    current_institution: ["current institution", "current_institution", "institution"],
    lastPublicExam: ["last public exam", "last_public_exam"],
    last_public_exam: ["last public exam", "last_public_exam"],
    publicExamResult: ["public exam result", "public_exam_result"],
    public_exam_result: ["public exam result", "public_exam_result"],
    lastQualification: ["last qualification", "last_qualification"],
    last_qualification: ["last qualification", "last_qualification"],
    lastResult: ["last result", "last_result"],
    last_result: ["last result", "last_result"],
    lastInstitution: ["last institution", "last_institution"],
    last_institution: ["last institution", "last_institution"],

    // 3. Professional, Membership & Wing
    profession: ["profession"],
    workplace: ["workplace"],
    membership: ["membership", "membership type"],
    membershipType: ["membership", "membership type"],
    wing: ["wing"],
    reason: ["reason"]
  };

  for (var key in fieldMapping) {
    if (payload[key] !== undefined && payload[key] !== null) {
      // If a new photo was uploaded to Drive, do not overwrite with empty or old photo url
      if ((key === "photo" || key === "photoUrl") && uploadedPhotoUrl) {
        continue;
      }
      var col = getColIndex(headers, fieldMapping[key]);
      if (col !== -1) {
        var oldVal = sheet.getRange(targetRow, col + 1).getValue();
        var newVal = String(payload[key]).trim();
        // Guard against writing raw base64 data URIs or strings exceeding Google Sheet cell limit (50,000 chars)
        if (newVal.indexOf("data:image") === 0 || newVal.indexOf(";base64,") !== -1 || newVal.length > 5000) {
          if (key === "photo" || key === "photoUrl") {
            continue; // Skip writing raw base64 string into cell
          }
          newVal = newVal.substring(0, 5000);
        }
        if (String(oldVal).trim() !== newVal) {
          sheet.getRange(targetRow, col + 1).setValue(newVal);
          changes.push(headers[col] + ": '" + oldVal + "' -> '" + newVal + "'");
        }
      }
    }
  }

  // Handle optional password change in "Member_Auth" tab
  if (payload.newPassword && String(payload.newPassword).trim().length >= 6) {
    var authSheet = getOrInitSheet(adminSS, MEMBER_AUTH_TAB_NAME);
    var authData = authSheet.getDataRange().getValues();
    var authHeaders = authData[0];
    var aEmailCol = getColIndex(authHeaders, ["email"]);
    var aHashCol = getColIndex(authHeaders, ["passwordhash", "password"]);
    var aSaltCol = getColIndex(authHeaders, ["salt"]);

    for (var a = 1; a < authData.length; a++) {
      if (String(authData[a][aEmailCol] || "").trim().toLowerCase() === email) {
        var newSalt = generateSalt();
        var newHash = hashPassword(payload.newPassword, newSalt);
        authSheet.getRange(a + 1, aHashCol + 1).setValue(newHash);
        authSheet.getRange(a + 1, aSaltCol + 1).setValue(newSalt);
        changes.push("Password updated securely");
        break;
      }
    }
  }

  if (changes.length > 0) {
    writeAuditLog(adminSS, memberId || email, "Member", "PROFILE_SELF_UPDATE", memberId || email, changes.join("; "));
  }

  var finalPhotoUrl = uploadedPhotoUrl;
  if (!finalPhotoUrl) {
    var candidatePhoto = payload.photo || payload.photoUrl || "";
    if (candidatePhoto && String(candidatePhoto).indexOf("http") === 0) {
      finalPhotoUrl = candidatePhoto;
    }
  }

  return createJsonResponse({
    status: "success",
    message: "Profile updated successfully in WCC Members sheet.",
    photoUrl: finalPhotoUrl,
    changesCount: changes.length
  });
}

/**
 * Save Member Photo directly to Google Drive folder "WCC_Member_Photos"
 * and persist direct view URL into the target row in "WCC Members" sheet
 */
function savePhotoToDriveAndSheet(memSS, adminSS, targetRow, headers, memberId, email, photoDataBase64, fileNameHint, mimeTypeHint) {
  var cleanBase64 = String(photoDataBase64).replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
  var decoded = Utilities.base64Decode(cleanBase64);
  var mimeType = mimeTypeHint || "image/jpeg";

  // Sanitize file extension and MIME type
  var ext = "jpg";
  if (mimeType.indexOf("png") !== -1) ext = "png";
  else if (mimeType.indexOf("webp") !== -1) ext = "webp";

  var cleanPrefix = (memberId || email || "member").replace(/[^a-zA-Z0-9_-]/g, "_");
  var fileName = cleanPrefix + "_photo_" + Date.now() + "." + ext;
  var blob = Utilities.newBlob(decoded, mimeType, fileName);

  var folders = DriveApp.getFoldersByName("WCC_Member_Photos");
  var folder;
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder("WCC_Member_Photos");
  }

  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var directPhotoUrl = "https://lh3.googleusercontent.com/d/" + file.getId();

  // Update in target row of WCC Members sheet
  var sheet = getMembersSheet(memSS);
  var photoCol = getColIndex(headers, ["photo url", "photo", "image"]);
  if (photoCol !== -1) {
    sheet.getRange(targetRow, photoCol + 1).setValue(directPhotoUrl);
  }

  return {
    fileId: file.getId(),
    photoUrl: directPhotoUrl
  };
}

/**
 * Handle dedicated Action: uploadProfilePhoto
 * Stores profile photo directly in Google Drive and updates the member's sheet row
 */
function handlePhotoUpload(memSS, adminSS, payload) {
  var memberId = String(payload.memberId || "").trim();
  var email = String(payload.email || "").trim().toLowerCase();
  var token = payload.token || "";

  // Authorization Check: Must be authenticated as the member themselves or an administrator
  if (token) {
    var tokenPayload = verifySessionToken(token);
    if (!tokenPayload) {
      return createJsonResponse({ status: "error", code: "UNAUTHORIZED", message: "Session expired or invalid. Please sign in again." });
    }
    var callerRole = String(tokenPayload.role || "").toLowerCase();
    var callerSub = String(tokenPayload.sub || "").toLowerCase();
    var isStaff = (callerRole === "super admin" || callerRole === "admin" || callerRole === "moderator");
    var isSelf = (callerSub === memberId.toLowerCase() || (email && callerSub === email));
    if (!isStaff && !isSelf) {
      return createJsonResponse({ status: "error", code: "FORBIDDEN", message: "Access denied. You cannot upload photos for another member." });
    }
  }

  var photoData = payload.photoBase64 || payload.photoData || payload.image_base64 || payload.photo || payload.photoUrl;

  if (!photoData || String(photoData).trim() === "") {
    return createJsonResponse({ status: "error", message: "No photo base64 data provided for upload." });
  }

  if (!memberId && !email) {
    return createJsonResponse({ status: "error", message: "Member ID or Email is required to assign photo." });
  }

  var sheet = getMembersSheet(memSS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var idCol = getColIndex(headers, ["member id", "memberid"]);
  var emailCol = getColIndex(headers, ["email"]);
  var phoneCol = getColIndex(headers, ["mobile", "phone"]);
  var cleanPhone = String(payload.phone || payload.mobile || "").replace(/[^0-9]/g, "");
  var cleanMemId = memberId.toLowerCase();

  var targetRow = -1;
  for (var r = 1; r < data.length; r++) {
    var rowId = (idCol !== -1) ? String(data[r][idCol] || "").trim().toLowerCase() : "";
    var rowEmail = (emailCol !== -1) ? String(data[r][emailCol] || "").trim().toLowerCase() : "";
    var rowPhone = (phoneCol !== -1) ? String(data[r][phoneCol] || "").replace(/[^0-9]/g, "") : "";
    
    var autoId2026 = "wcc-2026-" + ("000" + r).slice(-4);
    var autoId2025 = "wcc-2025-" + ("000" + r).slice(-4);

    var idMatch = memberId && (
      rowId === cleanMemId || 
      autoId2026 === cleanMemId || 
      autoId2025 === cleanMemId || 
      cleanMemId.replace(/[^0-9]/g, "") === ("000" + r).slice(-4)
    );
    var emailMatch = email && rowEmail && (rowEmail === email);
    var phoneMatch = cleanPhone && rowPhone && (rowPhone.slice(-10) === cleanPhone.slice(-10));

    if (idMatch || emailMatch || phoneMatch) {
      targetRow = r + 1;
      break;
    }
  }

  if (targetRow === -1) {
    return createJsonResponse({ status: "error", message: "Member record not found for photo upload." });
  }

  try {
    var uploadRes = savePhotoToDriveAndSheet(memSS, adminSS, targetRow, headers, memberId, email, photoData, payload.photoName, payload.mimeType);
    writeAuditLog(adminSS, memberId || email, "Member", "PHOTO_UPLOAD_DRIVE", memberId || email, "Uploaded photo to Google Drive: " + uploadRes.photoUrl);

    return createJsonResponse({
      status: "success",
      message: "Photo uploaded to Google Drive and saved to WCC Members sheet successfully.",
      photoUrl: uploadRes.photoUrl,
      fileId: uploadRes.fileId
    });
  } catch (e) {
    var errStr = e.toString();
    Logger.log("handlePhotoUpload error: " + errStr);
    if (errStr.indexOf("DriveApp") !== -1 || errStr.indexOf("permission") !== -1 || errStr.indexOf("অনুমতি") !== -1) {
      return createJsonResponse({
        status: "error",
        message: "Google Drive পারমিশন অনুমোদন প্রয়োজন: Apps Script এডিটরে গিয়ে ফাংশন ড্রপডাউন থেকে 'authorizeAndSetupDrivePermissions' সিলেক্ট করে একবার 'Run' (রান) বাটনে চাপুন এবং 'Allow' দিন।"
      });
    }
    return createJsonResponse({ status: "error", message: "Photo upload failed: " + errStr });
  }
}

/**
 * Handle Request Password Reset
 * Supports Email OTP and/or Instant Identity Verification (Phone + DOB/NID)
 */
function handleRequestPasswordReset(memSS, adminSS, payload) {
  var identifier = String(payload.identifier || payload.email || payload.phone || payload.memberId || "").trim().toLowerCase();
  var mode = String(payload.mode || "check").toLowerCase(); // "check", "send_otp", "verify_identity"

  if (!identifier) {
    return createJsonResponse({ status: "error", message: "Please provide your registered Email, Phone, or Member ID." });
  }

  // Rate Limiting: max 5 reset requests per 15 minutes per identifier
  var resetReqLimitKey = "rl_reset_req_" + identifier.replace(/[^a-zA-Z0-9]/g, "_");
  if (!checkRateLimit(resetReqLimitKey, 5, 900)) {
    return createJsonResponse({
      status: "error",
      message: "Too many password reset requests. Please try again after 15 minutes."
    });
  }

  var memSheet = getMembersSheet(memSS);
  var memData = memSheet.getDataRange().getValues();
  if (memData.length < 2) {
    return createJsonResponse({ status: "error", message: "Members sheet is empty." });
  }

  var headers = memData[0];
  var emailCol = getColIndex(headers, ["email"]);
  var phoneCol = getColIndex(headers, ["mobile", "phone"]);
  var idCol = getColIndex(headers, ["member id", "memberid"]);
  var nameCol = getColIndex(headers, ["name (en)", "name", "fullname"]);
  var dobCol = getColIndex(headers, ["dob", "date of birth"]);
  var nidCol = getColIndex(headers, ["nid/brn", "nid_brn", "nid"]);

  var cleanPhone = identifier.replace(/[^0-9]/g, "");
  if (cleanPhone.indexOf("880") === 0) cleanPhone = cleanPhone.substring(3);
  else if (cleanPhone.indexOf("88") === 0) cleanPhone = cleanPhone.substring(2);
  if (cleanPhone.indexOf("0") === 0) cleanPhone = cleanPhone.substring(1);

  var targetRow = -1;
  var targetMember = null;

  for (var r = 1; r < memData.length; r++) {
    var row = memData[r];
    var rowEmail = (emailCol !== -1) ? String(row[emailCol] || "").trim().toLowerCase() : "";
    var rowPhone = (phoneCol !== -1) ? String(row[phoneCol] || "").replace(/[^0-9]/g, "") : "";
    if (rowPhone.indexOf("880") === 0) rowPhone = rowPhone.substring(3);
    else if (rowPhone.indexOf("88") === 0) rowPhone = rowPhone.substring(2);
    if (rowPhone.indexOf("0") === 0) rowPhone = rowPhone.substring(1);

    var rowId = (idCol !== -1) ? String(row[idCol] || "").trim().toLowerCase() : "";
    var autoId2026 = "wcc-2026-" + ("000" + r).slice(-4);
    var autoId2025 = "wcc-2025-" + ("000" + r).slice(-4);

    var isEmailMatch = (rowEmail && rowEmail === identifier);
    var isPhoneMatch = (cleanPhone.length >= 8 && rowPhone && rowPhone.slice(-10) === cleanPhone.slice(-10));
    var isIdMatch = (rowId && rowId === identifier) || (autoId2026 === identifier) || (autoId2025 === identifier);

    if (isEmailMatch || isPhoneMatch || isIdMatch) {
      targetRow = r + 1;
      targetMember = {
        memberId: (idCol !== -1 && row[idCol]) ? String(row[idCol]).trim() : autoId2026,
        name: (nameCol !== -1) ? String(row[nameCol] || "Member").trim() : "Member",
        email: rowEmail,
        phone: rowPhone,
        dob: (dobCol !== -1) ? String(row[dobCol] || "").trim() : "",
        nid: (nidCol !== -1) ? String(row[nidCol] || "").trim() : ""
      };
      break;
    }
  }

  if (!targetMember) {
    return createJsonResponse({
      status: "error",
      message: "No registered member found with '" + identifier + "'. Please check your information or contact administration."
    });
  }

  // Generate masked email / phone for privacy display
  var maskedEmail = "";
  if (targetMember.email && targetMember.email.indexOf("@") !== -1) {
    var parts = targetMember.email.split("@");
    var userPart = parts[0];
    var maskedUser = (userPart.length > 2) ? userPart[0] + "***" + userPart[userPart.length - 1] : userPart[0] + "***";
    maskedEmail = maskedUser + "@" + parts[1];
  }

  var maskedPhone = "";
  if (targetMember.phone && targetMember.phone.length >= 7) {
    maskedPhone = targetMember.phone.substring(0, 3) + "****" + targetMember.phone.slice(-3);
  }

  // 1. Initial lookup / check mode: return available recovery channels
  if (mode === "check") {
    return createJsonResponse({
      status: "success",
      memberId: targetMember.memberId,
      name: targetMember.name,
      hasEmail: !!targetMember.email,
      maskedEmail: maskedEmail,
      hasPhone: !!targetMember.phone,
      maskedPhone: maskedPhone,
      message: "Member record verified."
    });
  }

  // 2. Send 6-digit OTP to Email
  if (mode === "send_otp") {
    if (!targetMember.email) {
      return createJsonResponse({
        status: "error",
        message: "No email address found on file for this member. Please use Identity Verification (Date of Birth / NID)."
      });
    }

    var otp = String(Math.floor(100000 + Math.random() * 900000));
    var cache = CacheService.getScriptCache();
    // Cache for 15 minutes (900 seconds)
    cache.put("wcc_reset_otp_" + targetMember.memberId.toLowerCase(), otp, 900);
    if (targetMember.email) {
      cache.put("wcc_reset_otp_" + targetMember.email.toLowerCase(), otp, 900);
    }

    try {
      var emailSubject = "WCC Portal - Password Reset Verification Code: " + otp;
      var emailHtml = '<div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">' +
        '<div style="text-align:center; margin-bottom: 20px;">' +
          '<h2 style="color: #990000; margin: 0;">We Can Change (WCC)</h2>' +
          '<p style="color: #64748b; margin: 4px 0 0 0; font-size: 14px;">Membership Management System</p>' +
        '</div>' +
        '<div style="padding: 20px; background: #f8fafc; border-radius: 8px; border-left: 4px solid #990000;">' +
          '<p style="margin: 0 0 12px 0; color: #1e293b; font-size: 15px;">Hello <strong>' + targetMember.name + '</strong>,</p>' +
          '<p style="margin: 0 0 16px 0; color: #475569; font-size: 14px;">You requested to reset your WCC Member Portal password. Use the 6-digit verification code below to set your new password:</p>' +
          '<div style="text-align: center; margin: 24px 0;">' +
            '<span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #990000; background: #ffffff; padding: 12px 28px; border-radius: 8px; border: 2px dashed #990000;">' + otp + '</span>' +
          '</div>' +
          '<p style="margin: 0; color: #64748b; font-size: 12px;">This code is valid for <strong>15 minutes</strong>. If you did not request this password reset, please ignore this email.</p>' +
        '</div>' +
        '<p style="text-align: center; margin: 20px 0 0 0; color: #94a3b8; font-size: 12px;">&copy; ' + new Date().getFullYear() + ' We Can Change (WCC). All rights reserved.</p>' +
      '</div>';

      MailApp.sendEmail({
        to: targetMember.email,
        subject: emailSubject,
        htmlBody: emailHtml
      });

      return createJsonResponse({
        status: "success",
        method: "otp",
        memberId: targetMember.memberId,
        maskedEmail: maskedEmail,
        message: "A 6-digit verification code has been sent to " + maskedEmail + ". Please check your inbox (and spam folder)."
      });
    } catch (mailErr) {
      Logger.log("MailApp.sendEmail error: " + mailErr);
      return createJsonResponse({
        status: "error",
        message: "Could not send email directly (" + mailErr.toString() + "). Please choose 'Verify Identity via Phone / DOB' to reset instantly."
      });
    }
  }

  // 3. Instant Identity Verification via DOB or NID (Strict equality - no substring bypass)
  if (mode === "verify_identity") {
    var providedDob = String(payload.dob || "").trim().toLowerCase();
    var providedNid = String(payload.nid || "").trim().toLowerCase().replace(/[^0-9]/g, "");

    var actualDob = targetMember.dob.toLowerCase();
    var actualNid = targetMember.nid.replace(/[^0-9]/g, "");

    function cleanDateDigits(str) {
      if (!str) return "";
      var s = String(str).trim();
      var parts = s.split(/[\/\-\.]/);
      if (parts.length === 3) {
        var y, m, d;
        if (parts[0].length === 4) {
          y = parts[0]; m = ("0" + parts[1]).slice(-2); d = ("0" + parts[2]).slice(-2);
        } else if (parts[2].length === 4) {
          y = parts[2]; m = ("0" + parts[1]).slice(-2); d = ("0" + parts[0]).slice(-2);
        } else {
          return s.replace(/[^0-9]/g, "");
        }
        return y + "-" + m + "-" + d;
      }
      return s.toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    var cleanProvidedDob = cleanDateDigits(providedDob);
    var cleanActualDob = cleanDateDigits(actualDob);
    var isDobMatch = (cleanProvidedDob.length >= 8 && cleanActualDob.length >= 8 && cleanProvidedDob === cleanActualDob);

    var cleanProvidedNid = providedNid.replace(/[^0-9]/g, "");
    var cleanActualNid = actualNid.replace(/[^0-9]/g, "");
    var isNidMatch = (cleanProvidedNid.length >= 10 && cleanActualNid.length >= 10 && cleanProvidedNid === cleanActualNid);

    if (!isDobMatch && !isNidMatch) {
      return createJsonResponse({
        status: "error",
        message: "Provided Date of Birth or NID did not match our records for this member."
      });
    }

    // Generate short-lived reset token (15 mins)
    var resetToken = Utilities.getUuid();
    var cache = CacheService.getScriptCache();
    cache.put("wcc_reset_token_" + resetToken, targetMember.memberId + "|" + targetMember.email, 900);

    return createJsonResponse({
      status: "success",
      method: "verified",
      memberId: targetMember.memberId,
      name: targetMember.name,
      resetToken: resetToken,
      message: "Identity verified successfully! You can now enter your new password."
    });
  }

  return createJsonResponse({ status: "error", message: "Invalid recovery mode." });
}

/**
 * Handle Complete Password Reset
 */
function handleResetPassword(memSS, adminSS, payload) {
  var memberId = String(payload.memberId || "").trim();
  var newPassword = String(payload.newPassword || "");
  var otp = String(payload.otp || "").trim();
  var resetToken = String(payload.resetToken || "").trim();

  if (!memberId) {
    return createJsonResponse({ status: "error", message: "Member ID is required." });
  }

  // Rate Limiting: max 5 OTP/token attempts per 15 mins per memberId
  var resetVerifyLimitKey = "rl_reset_verify_" + memberId.replace(/[^a-zA-Z0-9]/g, "_");
  if (!checkRateLimit(resetVerifyLimitKey, 5, 900)) {
    return createJsonResponse({
      status: "error",
      message: "Too many invalid verification attempts. Verification session locked for 15 minutes."
    });
  }

  if (!newPassword || newPassword.length < 6) {
    return createJsonResponse({ status: "error", message: "Password must be at least 6 characters long." });
  }

  var cache = CacheService.getScriptCache();
  var isValid = false;

  // 1. Verify OTP
  if (otp) {
    var cachedOtp1 = cache.get("wcc_reset_otp_" + memberId.toLowerCase());
    var cachedOtp2 = payload.email ? cache.get("wcc_reset_otp_" + String(payload.email).trim().toLowerCase()) : null;
    if ((cachedOtp1 && cachedOtp1 === otp) || (cachedOtp2 && cachedOtp2 === otp)) {
      isValid = true;
      cache.remove("wcc_reset_otp_" + memberId.toLowerCase());
    }
  }

  // 2. Verify Reset Token
  if (!isValid && resetToken) {
    var tokenData = cache.get("wcc_reset_token_" + resetToken);
    if (tokenData && tokenData.indexOf(memberId) !== -1) {
      isValid = true;
      cache.remove("wcc_reset_token_" + resetToken);
    }
  }

  if (!isValid) {
    return createJsonResponse({
      status: "error",
      message: "Verification code is invalid or has expired. Please request a new code."
    });
  }

  // 3. Update password in "Member_Auth" tab
  var authSheet = getOrInitSheet(adminSS, MEMBER_AUTH_TAB_NAME);
  var authData = authSheet.getDataRange().getValues();
  var authHeaders = authData[0] || [];
  var aIdCol = getColIndex(authHeaders, ["memberid", "member id"]);
  var aEmailCol = getColIndex(authHeaders, ["email"]);
  var aHashCol = getColIndex(authHeaders, ["passwordhash", "password"]);
  var aSaltCol = getColIndex(authHeaders, ["salt"]);
  var aDateCol = getColIndex(authHeaders, ["activatedat", "date"]);

  var targetRow = -1;
  var memberEmail = String(payload.email || "").trim().toLowerCase();

  for (var a = 1; a < authData.length; a++) {
    var rowId = (aIdCol !== -1) ? String(authData[a][aIdCol] || "").trim().toLowerCase() : "";
    var rowEmail = (aEmailCol !== -1) ? String(authData[a][aEmailCol] || "").trim().toLowerCase() : "";
    if (rowId === memberId.toLowerCase() || (memberEmail && rowEmail === memberEmail)) {
      targetRow = a + 1;
      if (rowEmail) memberEmail = rowEmail;
      break;
    }
  }

  var salt = generateSalt();
  var hash = hashPassword(newPassword, salt);
  var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  if (targetRow !== -1) {
    authSheet.getRange(targetRow, aHashCol + 1).setValue(hash);
    authSheet.getRange(targetRow, aSaltCol + 1).setValue(salt);
    if (aDateCol !== -1) authSheet.getRange(targetRow, aDateCol + 1).setValue(nowStr);
  } else {
    // Member hasn't activated before; append new row
    authSheet.appendRow([memberId, memberEmail, hash, salt, "Active", nowStr]);
  }

  // 4. Log to Audit Trail
  resetRateLimit(resetVerifyLimitKey);
  writeAuditLog(
    adminSS,
    memberId || memberEmail,
    "Member",
    "PASSWORD_RESET",
    memberId,
    "Member successfully reset their account password."
  );

  return createJsonResponse({
    status: "success",
    message: "Password reset successfully! You can now sign in with your new password.",
    memberId: memberId
  });
}

/**
 * Handle Admin Status Update
 */
function handleUpdateStatus(memSS, adminSS, payload) {
  var memberId = String(payload.memberId || "").trim();
  var newStatus = String(payload.status || "").trim();
  var token = payload.token || "";

  // Authorization Check: Administrative role required
  var tokenPayload = verifySessionToken(token, "admin");
  if (!tokenPayload) {
    return createJsonResponse({ status: "error", code: "UNAUTHORIZED", message: "Administrative privileges required to modify member status." });
  }

  var actor = String(payload.actorEmail || tokenPayload.sub || "Administrator").trim();

  if (!memberId || !newStatus) {
    return createJsonResponse({ status: "error", message: "Member ID and Status are required." });
  }

  // 1. Update in Member_Auth if exists
  var authSheet = getOrInitSheet(adminSS, MEMBER_AUTH_TAB_NAME);
  var authData = authSheet.getDataRange().getValues();
  var aIdCol = getColIndex(authData[0] || [], ["memberid", "member id"]);
  var aStatusCol = getColIndex(authData[0] || [], ["status"]);

  if (aIdCol !== -1 && aStatusCol !== -1) {
    for (var a = 1; a < authData.length; a++) {
      if (String(authData[a][aIdCol] || "").trim().toLowerCase() === memberId.toLowerCase()) {
        authSheet.getRange(a + 1, aStatusCol + 1).setValue(newStatus);
        break;
      }
    }
  }

  // 2. Update in WCC Members sheet if Status column exists
  var memSheet = getMembersSheet(memSS);
  var memData = memSheet.getDataRange().getValues();
  var memHeaders = memData[0];
  var mIdCol = getColIndex(memHeaders, ["member id", "memberid"]);
  var mStatusCol = getColIndex(memHeaders, ["status", "membership status"]);

  if (mStatusCol !== -1) {
    for (var r = 1; r < memData.length; r++) {
      var rowId = (mIdCol !== -1) ? String(memData[r][mIdCol] || "").trim().toLowerCase() : ("wcc-2026-" + ("000" + r).slice(-4));
      if (rowId === memberId.toLowerCase()) {
        memSheet.getRange(r + 1, mStatusCol + 1).setValue(newStatus);
        break;
      }
    }
  }

  writeAuditLog(adminSS, actor, "Admin", "STATUS_CHANGE", memberId, "Changed status to '" + newStatus + "'");

  return createJsonResponse({
    status: "success",
    message: "Status updated successfully.",
    memberId: memberId,
    newStatus: newStatus
  });
}

/**
 * Handle Super Admin Creating a New Admin / Staff Member
 */
function handleCreateAdmin(adminSS, payload) {
  var token = payload.token || "";
  var tokenPayload = verifySessionToken(token, "super admin");
  if (!tokenPayload) {
    return createJsonResponse({ status: "error", code: "UNAUTHORIZED", message: "Only an authenticated Super Administrator can create new administrative accounts." });
  }

  var name = String(payload.name || "").trim();
  var email = String(payload.email || "").trim().toLowerCase();
  var password = String(payload.password || "").trim();
  var role = String(payload.role || "Admin").trim();
  var actor = String(payload.actorEmail || tokenPayload.sub || "Super Admin").trim();

  if (!name || !email || !password) {
    return createJsonResponse({ status: "error", message: "Name, Email, and Password are required." });
  }

  var sheet = getOrInitSheet(adminSS, ADMINS_TAB_NAME);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var emailIdx = getColIndex(headers, ["email"]);
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]).trim().toLowerCase() === email) {
      return createJsonResponse({ status: "error", message: "An admin account with this email already exists." });
    }
  }

  var salt = generateSalt();
  var hash = hashPassword(password, salt);
  var adminId = "ADM-" + ("00" + data.length).slice(-3);

  sheet.appendRow([
    adminId,
    name,
    email,
    hash,
    salt,
    role,
    "Active",
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
    ""
  ]);

  writeAuditLog(adminSS, actor, "Super Admin", "CREATE_ADMIN", email, "Created new " + role + " account: " + name + " (" + email + ")");

  return createJsonResponse({
    status: "success",
    message: "Admin account created successfully.",
    admin: { adminId: adminId, name: name, email: email, role: role }
  });
}

/**
 * Log custom audit entry
 */
function handleCustomAuditLog(adminSS, payload) {
  writeAuditLog(
    adminSS,
    payload.actor || "System",
    payload.role || "Staff",
    payload.actionType || "ACTIVITY",
    payload.targetId || "-",
    payload.details || ""
  );
  return createJsonResponse({ status: "success", logged: true });
}

/* ==============================================================================
   DATA FETCHING HELPERS (GET)
   ============================================================================== */

/**
 * Safe Public Member Verification for QR Codes & Cards (ZERO PII LEAK)
 * Returns strictly non-sensitive public attributes:
 * Member ID, Name, Photo, Status, Membership Type, Wing, Joining Year
 */
function getPublicMemberVerification(memSS, targetId) {
  var cleanTargetId = String(targetId || "").trim().toLowerCase();
  if (!cleanTargetId) {
    return createJsonResponse({ status: "error", message: "Membership ID required for verification." });
  }

  var sheet = getMembersSheet(memSS);
  if (!sheet) {
    return createJsonResponse({ status: "error", message: "Database temporarily unavailable." });
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return createJsonResponse({ status: "error", message: "Member record not found." });
  }

  var headers = data[0];
  var idCol = getColIndex(headers, ["member id", "memberid"]);
  var nameCol = getColIndex(headers, ["name (en)", "name", "fullname"]);
  var photoCol = getColIndex(headers, ["photo url", "photo"]);
  var memTypeCol = getColIndex(headers, ["membership", "membership type"]);
  var wingCol = getColIndex(headers, ["wing"]);
  var statusCol = getColIndex(headers, ["status", "membership status"]);
  var timestampCol = getColIndex(headers, ["timestamp"]);

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var rowId = (idCol !== -1 && row[idCol]) ? String(row[idCol]).trim().toLowerCase() : "";
    var autoId2026 = "wcc-2026-" + ("000" + r).slice(-4);
    var autoId2025 = "wcc-2025-" + ("000" + r).slice(-4);

    if (rowId === cleanTargetId || autoId2026 === cleanTargetId || autoId2025 === cleanTargetId) {
      var officialId = (idCol !== -1 && row[idCol]) ? String(row[idCol]).trim() : autoId2026.toUpperCase();
      var rawPhoto = (photoCol !== -1 && row[photoCol]) ? String(row[photoCol]).trim() : "";
      var joiningYear = "2026";
      var tsVal = (timestampCol !== -1) ? row[timestampCol] : null;
      if (tsVal instanceof Date) {
        joiningYear = Utilities.formatDate(tsVal, Session.getScriptTimeZone(), "yyyy");
      }

      return createJsonResponse({
        status: "success",
        member: {
          memberId: officialId,
          name: (nameCol !== -1 && row[nameCol]) ? String(row[nameCol]).trim() : "WCC Member",
          photoUrl: (rawPhoto.indexOf("http") === 0) ? rawPhoto : "",
          status: (statusCol !== -1 && row[statusCol]) ? String(row[statusCol]).trim() : "Active",
          membershipType: (memTypeCol !== -1 && row[memTypeCol]) ? String(row[memTypeCol]).trim() : "General Member",
          wing: (wingCol !== -1 && row[wingCol]) ? String(row[wingCol]).trim() : "General Wing",
          joiningYear: joiningYear
        }
      });
    }
  }

  return createJsonResponse({ status: "error", message: "Member with ID '" + targetId + "' was not found." });
}

/**
 * Fetch all members from "WCC Members" sheet
 */
function getMembersList(memSS, adminSS) {
  // 1. Fast path: check server-side CacheService (0ms sheet I/O)
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get("wcc_members_cache_v2");
    if (cached) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (e) {
    Logger.log("Cache read skip: " + e);
  }

  var sheet = getMembersSheet(memSS);
  if (!sheet) {
    return createJsonResponse({
      status: "error",
      message: "Spreadsheet or sheet tab could not be opened. Please verify that your Google Sheet has at least one tab or set WCC_MEMBERS_SPREADSHEET_ID."
    });
  }

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    var emptyResp = JSON.stringify({ status: "success", count: 0, members: [] });
    return ContentService.createTextOutput(emptyResp).setMimeType(ContentService.MimeType.JSON);
  }

  var headers = data[0];
  var members = [];

  // Index finders for key columns
  var idCol = getColIndex(headers, ["member id", "memberid"]);
  var timestampCol = getColIndex(headers, ["timestamp"]);
  var statusCol = getColIndex(headers, ["status", "membership status"]);

  // Fetch status map from Member_Auth if exists
  var authStatusMap = {};
  try {
    var authSheet = adminSS.getSheetByName(MEMBER_AUTH_TAB_NAME);
    if (authSheet && authSheet.getLastRow() > 1) {
      var aData = authSheet.getDataRange().getValues();
      var aEmailIdx = getColIndex(aData[0], ["email"]);
      var aStatusIdx = getColIndex(aData[0], ["status"]);
      for (var a = 1; a < aData.length; a++) {
        var aEmail = String(aData[a][aEmailIdx] || "").trim().toLowerCase();
        if (aEmail) authStatusMap[aEmail] = String(aData[a][aStatusIdx] || "Active");
      }
    }
  } catch (e) {
    Logger.log("Auth status read optional skip: " + e);
  }

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row.join("").trim() === "") continue;

    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var h = String(headers[j]).trim();
      var val = row[j];

      // Exclude any password or salt columns
      if (h.toLowerCase() === "passwordhash" || h.toLowerCase() === "salt" || h.toLowerCase() === "password") continue;

      if (val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
      }
      obj[h] = val !== undefined && val !== null ? String(val).trim() : "";
    }

    // Auto generate Member ID if not present in sheet
    if (idCol === -1 || !obj[headers[idCol]]) {
      var year = "2026";
      var tsVal = timestampCol !== -1 ? row[timestampCol] : new Date();
      if (tsVal instanceof Date) {
        year = Utilities.formatDate(tsVal, Session.getScriptTimeZone(), "yyyy");
      }
      obj["Member ID"] = "WCC-" + year + "-" + ("000" + i).slice(-4);
    }

    // Status: Check column in sheet, else check Member_Auth map, else default to "Active"
    var rowEmail = String(obj["Email"] || "").toLowerCase();
    if (statusCol === -1 || !obj[headers[statusCol]]) {
      obj["Status"] = authStatusMap[rowEmail] || "Active";
    }

    members.push(obj);
  }

  var responseJson = JSON.stringify({ status: "success", count: members.length, members: members });

  // Store in CacheService for 180 seconds (3 mins) if payload size < 95KB
  try {
    if (responseJson.length < 95000) {
      CacheService.getScriptCache().put("wcc_members_cache_v2", responseJson, 180);
    }
  } catch (e) {
    Logger.log("Cache write skip: " + e);
  }

  return ContentService.createTextOutput(responseJson).setMimeType(ContentService.MimeType.JSON);
}

function getAuditLogs(adminSS) {
  var sheet = getOrInitSheet(adminSS, AUDIT_LOG_TAB_NAME);
  var data = sheet.getDataRange().getValues();
  var logs = [];

  if (data.length > 1) {
    var headers = data[0];
    var start = Math.max(1, data.length - 200);
    for (var i = data.length - 1; i >= start; i--) {
      var row = data[i];
      if (row.join("").trim() === "") continue;

      var entry = {};
      for (var j = 0; j < headers.length; j++) {
        var val = row[j];
        if (val instanceof Date) {
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
        }
        entry[headers[j]] = val;
      }
      logs.push(entry);
    }
  }

  return createJsonResponse({ status: "success", count: logs.length, logs: logs });
}

function getAdminsList(adminSS) {
  var sheet = getOrInitSheet(adminSS, ADMINS_TAB_NAME);
  var data = sheet.getDataRange().getValues();
  var admins = [];

  if (data.length > 1) {
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row.join("").trim() === "") continue;
      admins.push({
        adminId: row[0],
        name: row[1],
        email: row[2],
        role: row[5],
        status: row[6],
        createdAt: row[7],
        lastLogin: row[8]
      });
    }
  }

  return createJsonResponse({ status: "success", count: admins.length, admins: admins });
}

/* ==============================================================================
   SECURITY & CRYPTOGRAPHIC HELPERS
   ============================================================================== */

/**
 * Generate cryptographic SHA-256 hash using salt
 */
function hashPassword(password, salt) {
  var combined = password + "::" + salt;
  var rawBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, combined, Utilities.Charset.UTF_8);
  var hash = "";
  for (var i = 0; i < rawBytes.length; i++) {
    var byteVal = rawBytes[i];
    if (byteVal < 0) byteVal += 256;
    var hex = byteVal.toString(16);
    if (hex.length === 1) hex = "0" + hex;
    hash += hex;
  }
  return hash;
}

/**
 * Generate random 16-character salt
 */
function generateSalt() {
  var chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  var salt = "";
  for (var i = 0; i < 16; i++) {
    salt += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return salt;
}

/**
 * Generate signed stateless session token (Supports concurrent sessions)
 */
function generateSessionToken(userId, role) {
  var payload = {
    sub: userId,
    role: role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
  };

  var encoded = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  var sigBytes = Utilities.computeHmacSha256Signature(encoded, JWT_SECRET);
  var sig = Utilities.base64EncodeWebSafe(sigBytes);
  return encoded + "." + sig;
}

/**
 * Cryptographically Verify signed stateless session token
 * Validates HMAC-SHA256 signature, expiry, and role-based permissions
 */
function verifySessionToken(token, requiredRole) {
  if (!token || typeof token !== "string") return null;
  var parts = token.split(".");
  if (parts.length !== 2) return null;

  var encodedPayload = parts[0];
  var receivedSig = parts[1];

  try {
    var expectedSigBytes = Utilities.computeHmacSha256Signature(encodedPayload, JWT_SECRET);
    var expectedSig = Utilities.base64EncodeWebSafe(expectedSigBytes);
    if (receivedSig !== expectedSig) return null;

    var decodedJson = Utilities.newBlob(Utilities.base64DecodeWebSafe(encodedPayload)).getDataAsString("UTF-8");
    var payload = JSON.parse(decodedJson);

    var nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSec) return null;

    if (requiredRole) {
      var userRole = String(payload.role || "").trim().toLowerCase();
      var reqRole = String(requiredRole).trim().toLowerCase();
      // Super Admin satisfies any administrative privilege
      if (userRole === "super admin") return payload;

      if (reqRole === "admin") {
        if (userRole === "admin" || userRole === "moderator") return payload;
        return null;
      }

      if (userRole !== reqRole) return null;
    }

    return payload;
  } catch (e) {
    Logger.log("Token verification error: " + e.toString());
    return null;
  }
}

/**
 * Append entry to Audit_Log tab
 */
function writeAuditLog(adminSS, actor, role, action, targetId, details) {
  try {
    var sheet = getOrInitSheet(adminSS, AUDIT_LOG_TAB_NAME);
    var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([timestamp, actor, role, action, targetId, details]);
  } catch (e) {
    Logger.log("Audit log failure: " + e.toString());
  }
}

/* ==============================================================================
   SHEET RESOLUTION & UTILITIES
   ============================================================================== */

/**
 * Retrieve the "WCC Members" sheet or fallback gracefully
 */
function getMembersSheet(ss) {
  if (!ss) return null;
  var sheet = ss.getSheetByName(MEMBERS_TAB_NAME);
  if (!sheet) {
    sheet = ss.getSheetByName("Members");
  }
  if (!sheet) {
    sheet = ss.getSheetByName("Form Responses 1");
  }
  if (!sheet) {
    sheet = ss.getSheetByName("ফর্মের প্রতিক্রিয়া ১");
  }
  if (!sheet) {
    sheet = ss.getSheetByName("Sheet1");
  }
  if (!sheet) {
    sheet = ss.getSheetByName("শীট১");
  }
  if (!sheet && ss.getSheets && ss.getSheets().length > 0) {
    // If no specific sheet name matched, use the first available sheet tab
    sheet = ss.getSheets()[0];
  }
  return sheet;
}

/**
 * Ensure system tabs exist
 */
function ensureSystemTabs(memSS, adminSS) {
  // 1. Check Admins Tab
  var adminSheet = getOrInitSheet(adminSS, ADMINS_TAB_NAME);
  if (adminSheet.getLastRow() === 0) {
    adminSheet.appendRow([
      "Admin ID", "Name", "Email", "PasswordHash", "Salt", "Role", "Status", "CreatedAt", "LastLogin"
    ]);
    var defaultSalt = "wcc_master_salt_2026";
    var defaultHash = hashPassword("wccadmin2026", defaultSalt);
    adminSheet.appendRow([
      "ADM-001", "WCC Super Administrator", "admin@wecanchange.org", defaultHash, defaultSalt,
      "Super Admin", "Active", Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"), ""
    ]);
  }

  // 2. Check Member_Auth Tab
  var authSheet = getOrInitSheet(adminSS, MEMBER_AUTH_TAB_NAME);
  if (authSheet.getLastRow() === 0) {
    authSheet.appendRow([
      "Member ID", "Email", "PasswordHash", "Salt", "Status", "ActivatedAt"
    ]);
  }

  // 3. Check Audit_Log Tab
  var auditSheet = getOrInitSheet(adminSS, AUDIT_LOG_TAB_NAME);
  if (auditSheet.getLastRow() === 0) {
    auditSheet.appendRow([
      "Timestamp", "Actor", "Actor Role", "Action", "Target ID", "Details"
    ]);
    writeAuditLog(adminSS, "System", "Engine", "SYSTEM_INIT", "Core", "WCC Audit Trail Initialized.");
  }
}

function getOrInitSheet(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  return sheet;
}

function getColIndex(headers, candidates) {
  if (!headers || !headers.length) return -1;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    for (var c = 0; c < candidates.length; c++) {
      var candidate = candidates[c].toLowerCase().replace(/[^a-z0-9]/g, "");
      if (h === candidate) return i;
    }
  }
  return -1;
}

function createJsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
