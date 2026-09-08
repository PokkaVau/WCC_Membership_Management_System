/**
 * WCC Membership Management System - API & Data Access Layer
 * Centralized data fetching, caching, member registration, member self-update,
 * audit trail logging, and multi-role operations.
 */

const API = {
  CACHE_KEY: 'wcc_members_cache_v3',
  CACHE_TIME_KEY: 'wcc_members_cache_time_v3',

  _inFlightFetchPromise: null,

  /**
   * Ping health check to verify endpoint availability (with generous 40s timeout for Google Apps Script cold starts)
   */
  async ping(customUrl = null) {
    const rawUrl = (customUrl || CONFIG.API_URL || '').trim();
    if (!rawUrl || rawUrl.includes('YOUR_SCRIPT_ID_HERE')) {
      return { ok: false, message: 'API URL not configured' };
    }

    const cleanBaseUrl = rawUrl.split('?')[0].replace(/\/+$/, '');
    const startTime = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 40000);

    try {
      const pingUrl = cleanBaseUrl + '?action=ping&_t=' + Date.now();
      const resp = await fetch(pingUrl, {
        method: 'GET',
        mode: 'cors',
        redirect: 'follow',
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const latency = Math.round(performance.now() - startTime);

      if (!resp.ok) {
        return { ok: false, status: resp.status, latency, message: `Server returned HTTP ${resp.status}` };
      }

      const text = await resp.text();
      const cleanText = text.replace(/^\uFEFF/, '').trim();
      let json = null;
      try {
        json = JSON.parse(cleanText);
      } catch(e) {
        return { ok: false, latency, message: 'Non-JSON response (check Google Apps Script: "Who has access: Anyone")' };
      }

      if (json && (json.status === 'error' || json.error)) {
        return {
          ok: false,
          latency,
          message: json.message || json.error || 'Apps Script returned an error response.'
        };
      }

      return {
        ok: true,
        latency,
        data: json,
        version: json.version || '2.4.0'
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const latency = Math.round(performance.now() - startTime);
      return {
        ok: false,
        latency,
        message: err.name === 'AbortError' ? 'Connection timed out (>40s)' : (err.message || 'Network request failed')
      };
    }
  },

  /**
   * Fetch all members. Checks high-speed local cache first.
   * Uses Request Deduplication and Stale-While-Revalidate for maximum responsiveness.
   */
  async fetchMembers(forceRefresh = false) {
    // Automatically invalidate cache if switching between mock and live API mode
    const modeKey = `${CONFIG.USE_MOCK_DATA}_${CONFIG.API_URL}`;
    const lastMode = localStorage.getItem('wcc_api_mode_v2');
    if (lastMode !== modeKey) {
      this.clearCache();
      localStorage.setItem('wcc_api_mode_v2', modeKey);
    }

    // 1. Instant Cache Return (Zero-wait 0ms UI rendering)
    if (!forceRefresh) {
      const cached = this.getCachedMembers();
      if (cached && cached.length > 0) {
        // Stale-While-Revalidate: If cache is older than 60s, trigger quiet background refresh
        const cacheAge = Date.now() - parseInt(localStorage.getItem(this.CACHE_TIME_KEY) || '0', 10);
        if (cacheAge > 60000 && !this._inFlightFetchPromise && !CONFIG.USE_MOCK_DATA) {
          setTimeout(() => this._backgroundRevalidate(), 100);
        }
        return cached;
      }
    }

    // 2. In-flight Request Deduplication: Return ongoing promise if already fetching
    if (!forceRefresh && this._inFlightFetchPromise) {
      return this._inFlightFetchPromise;
    }

    let fetchPromise = null;
    fetchPromise = (async () => {
      try {
        let rawData = [];

        if (CONFIG.USE_MOCK_DATA) {
          rawData = typeof getMockMembers === 'function' ? getMockMembers() : [];
          
          // Merge in any newly registered members from local storage
          const registered = this.getRegisteredMemberUsers();
          registered.forEach(reg => {
            if (!rawData.some(m => m.memberId === reg.memberId || m.email === reg.email)) {
              rawData.unshift(reg);
            }
          });
        } else {
          if (!CONFIG.API_URL || CONFIG.API_URL.includes('YOUR_SCRIPT_ID_HERE')) {
            throw new Error('API_URL is not configured. Please set a valid endpoint in Settings or enable USE_MOCK_DATA.');
          }

          // Robust fetcher with retry on cold-start timeout or transient network glitch
          const doFetch = async (attempt = 1) => {
            const controller = new AbortController();
            // Generous 45-second timeout for Google Apps Script cold start execution
            const timeoutId = setTimeout(() => controller.abort(), 45000);

            try {
              const cleanBaseUrl = (CONFIG.API_URL || '').split('?')[0].trim();
              const endpoint = cleanBaseUrl + '?action=members&_t=' + Date.now();
              const response = await fetch(endpoint, {
                method: 'GET',
                mode: 'cors',
                redirect: 'follow',
                cache: 'no-store',
                signal: controller.signal
              });
              clearTimeout(timeoutId);

              if (!response.ok) {
                throw new Error(`Failed to load member data from server (HTTP ${response.status})`);
              }

              const rawText = await response.text();
              const cleanText = rawText.replace(/^\uFEFF/, '').trim();
              let json;
              try {
                json = JSON.parse(cleanText);
              } catch (parseErr) {
                throw new Error('Server returned non-JSON response: ' + cleanText.slice(0, 120));
              }

              if (json && (json.status === 'error' || json.error)) {
                throw new Error(json.message || json.error || 'Apps Script returned an error.');
              }

              return json;
            } catch (fetchErr) {
              clearTimeout(timeoutId);
              if (attempt < 2) {
                console.warn(`Fetch attempt ${attempt} failed (${fetchErr.message}). Retrying in 1.5s...`);
                await new Promise(res => setTimeout(res, 1500));
                return doFetch(attempt + 1);
              }
              if (fetchErr.name === 'AbortError') {
                throw new Error('Google Apps Script request timed out (>45s). Please check your internet connection.');
              }
              throw fetchErr;
            }
          };

          const json = await doFetch(1);

          // Universal JSON data extractor supporting all Google Sheet API and Apps Script response formats
          if (Array.isArray(json)) {
            rawData = json;
          } else if (json && typeof json === 'object') {
            if (Array.isArray(json.members)) {
              rawData = json.members;
            } else if (Array.isArray(json.data)) {
              rawData = json.data;
            } else if (json.data && Array.isArray(json.data.members)) {
              rawData = json.data.members;
            } else if (json.data && Array.isArray(json.data.rows)) {
              rawData = json.data.rows;
            } else if (Array.isArray(json.records)) {
              rawData = json.records;
            } else if (Array.isArray(json.rows)) {
              rawData = json.rows;
            } else if (Array.isArray(json.items)) {
              rawData = json.items;
            } else if (Array.isArray(json.result)) {
              rawData = json.result;
            } else if (Array.isArray(json.values)) {
              // 2D Google Sheets values format [[headers...], [row1...]]
              const values = json.values;
              if (values.length > 1) {
                const headers = values[0].map(h => String(h || '').trim());
                rawData = values.slice(1).map(row => {
                  const obj = {};
                  headers.forEach((h, idx) => { obj[h] = row[idx] !== undefined ? row[idx] : ''; });
                  return obj;
                });
              }
            }
          }

          // Convert 2D array if rawData itself is a 2D array
          if (Array.isArray(rawData) && rawData.length > 1 && Array.isArray(rawData[0])) {
            const headers = rawData[0].map(h => String(h || '').trim());
            rawData = rawData.slice(1).map(row => {
              const obj = {};
              headers.forEach((h, idx) => { obj[h] = row[idx] !== undefined ? row[idx] : ''; });
              return obj;
            });
          }
        }

        const normalizedMembers = rawData
          .map(item => UTILS.normalizeMember(item))
          .filter(m => m && (m.name || m.nameBn || m.memberId || m.phone || m.email));

        this.setCachedMembers(normalizedMembers);
        return normalizedMembers;
      } catch (err) {
        console.error('API.fetchMembers error:', err);
        // Fallback 1: Return stale cache if available
        const stale = this.getCachedMembers(true);
        if (stale && stale.length > 0) {
          UTILS.showToast('Network issue: Showing offline cached data', 'warning');
          return stale;
        }

        // Fallback 2: If live mode failed completely and no cache exists, provide mock dataset gracefully so UI never breaks
        if (!CONFIG.USE_MOCK_DATA && typeof getMockMembers === 'function') {
          console.warn('Live API unavailable and no cache; falling back to offline demo dataset gracefully.');
          UTILS.showToast('Could not reach Google Sheet backend. Showing offline data temporarily.', 'warning');
          const mockFallback = getMockMembers().map(item => UTILS.normalizeMember(item));
          return mockFallback;
        }

        throw err;
      } finally {
        if (this._inFlightFetchPromise === fetchPromise) {
          this._inFlightFetchPromise = null;
        }
      }
    })();

    this._inFlightFetchPromise = fetchPromise;
    return fetchPromise;
  },

  /**
   * Quiet background revalidation to keep cached data fresh without blocking UI
   */
  async _backgroundRevalidate() {
    try {
      const fresh = await this.fetchMembers(true);
      if (fresh && fresh.length > 0) {
        window.dispatchEvent(new CustomEvent('wcc-members-refreshed', { detail: { members: fresh } }));
      }
    } catch (e) {
      console.warn('Background revalidation skipped:', e.message);
    }
  },

  /**
   * Safe Public Member Verification (QR Codes & ID Card Verification)
   * Contacts backend endpoint ?action=verifyMember without downloading the full members database
   */
  async verifyMemberPublic(memberId) {
    if (!memberId) return null;
    const cleanId = String(memberId).trim();

    // 1. If live API configured, request isolated public verification record
    if (!CONFIG.USE_MOCK_DATA && CONFIG.API_URL && !CONFIG.API_URL.includes('YOUR_SCRIPT_ID_HERE')) {
      try {
        const cleanBaseUrl = CONFIG.API_URL.split('?')[0].replace(/\/+$/, '');
        const targetUrl = cleanBaseUrl + '?action=verifyMember&id=' + encodeURIComponent(cleanId) + '&_t=' + Date.now();
        const resp = await fetch(targetUrl, {
          method: 'GET',
          mode: 'cors',
          redirect: 'follow',
          cache: 'no-store'
        });

        if (resp.ok) {
          const text = await resp.text();
          const cleanText = text.replace(/^\uFEFF/, '').trim();
          const json = JSON.parse(cleanText);
          if (json && json.status === 'success' && json.member) {
            return json.member;
          }
        }
      } catch (err) {
        console.warn('Remote public verification failed:', err);
      }
    }

    // 2. Offline / Mock fallback (only check mock or existing local cache if already present)
    const cached = this.getCachedMembers(true);
    if (cached && cached.length > 0) {
      const match = cached.find(m => m.memberId && m.memberId.toLowerCase() === cleanId.toLowerCase());
      if (match) {
        return {
          memberId: match.memberId,
          name: match.name,
          photoUrl: match.photoUrl,
          status: match.status,
          membershipType: match.membershipType,
          wing: match.wing,
          joiningYear: match.joiningYear || '2026'
        };
      }
    }

    return null;
  },

  /**
   * Retrieve a single member by their unique Member ID
   */
  async fetchMemberById(memberId) {
    if (!memberId) return null;
    const cleanId = String(memberId).trim().toLowerCase();
    const allMembers = await this.fetchMembers();
    return allMembers.find(m => m.memberId && m.memberId.toLowerCase() === cleanId) || null;
  },

  /**
   * Register/Activate a member (Email, Phone, or Member ID Verification + Password setting)
   */
  async registerMember(payload) {
    const rawIdentifier = String(payload.email || payload.identifier || payload.username || '').trim();
    const cleanPassword = String(payload.password || '').trim();

    if (!rawIdentifier || !cleanPassword) {
      return { success: false, message: 'Please provide your registered email, phone, or Member ID and a password.' };
    }

    if (cleanPassword.length < 6) {
      return { success: false, message: 'Password must be at least 6 characters long.' };
    }

    // Normalization helper for phone numbers (+880, 880, leading 0)
    const normalizePhone = (p) => {
      if (!p) return '';
      let digits = String(p).replace(/[^0-9]/g, '');
      if (digits.startsWith('880')) digits = digits.slice(3);
      else if (digits.startsWith('88')) digits = digits.slice(2);
      if (digits.startsWith('0')) digits = digits.slice(1);
      return digits;
    };

    const userPhoneDigits = normalizePhone(rawIdentifier);
    const cleanIdLower = rawIdentifier.toLowerCase();

    // Look up in all members to resolve identifier (Email, Phone, or Member ID)
    let allMembers = [];
    try {
      allMembers = await this.fetchMembers();
    } catch(e) {
      allMembers = this.getCachedMembers(true) || [];
    }

    const matched = allMembers.find(m => {
      if (m.email && m.email.toLowerCase() === cleanIdLower) return true;
      if (m.memberId && m.memberId.toLowerCase() === cleanIdLower) return true;
      if (userPhoneDigits && m.phone) {
        const mDigits = normalizePhone(m.phone);
        if (mDigits && mDigits === userPhoneDigits) return true;
      }
      return false;
    });

    const targetEmail = matched && matched.email ? matched.email.toLowerCase() : cleanIdLower;

    // 1. Live Google Apps Script Cloud Web App
    if (!CONFIG.USE_MOCK_DATA && CONFIG.API_URL && !CONFIG.API_URL.includes('YOUR_SCRIPT_ID_HERE')) {
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 35000) : null;

        const response = await fetch(CONFIG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'registerMember',
            email: targetEmail,
            password: cleanPassword
          }),
          signal: controller ? controller.signal : undefined
        });
        if (timeoutId) clearTimeout(timeoutId);

        const rawText = await response.text();
        const cleanText = rawText.replace(/^\uFEFF/, '').trim();
        let res = null;
        try {
          res = JSON.parse(cleanText);
        } catch(pe) {
          throw new Error('Server returned non-JSON response: ' + cleanText.slice(0, 100));
        }

        if (res.status === 'success') {
          // Cache in local registered members with Salted SHA-256 (Never store plaintext password)
          try {
            const registered = this.getRegisteredMemberUsers();
            const existingIdx = registered.findIndex(r => r.email && r.email.toLowerCase() === targetEmail);
            const salt = UTILS.generateSalt();
            const passwordHash = await UTILS.hashPassword(cleanPassword, salt);
            const userRecord = {
              ...(matched || {}),
              email: targetEmail,
              memberId: res.memberId || (matched ? matched.memberId : ''),
              name: res.name || (matched ? matched.name : 'Member'),
              passwordHash: passwordHash,
              salt: salt,
              status: 'Active',
              role: CONFIG.ROLES.MEMBER,
              isMember: true
            };
            delete userRecord.password; // Enforce zero plaintext password
            if (existingIdx >= 0) registered[existingIdx] = userRecord;
            else registered.push(userRecord);
            localStorage.setItem(CONFIG.STORAGE_KEYS.MEMBER_USERS, JSON.stringify(registered));
          } catch(e) {}

          this.clearCache();
          return { success: true, memberId: res.memberId, name: res.name, message: res.message };
        } else {
          return { success: false, message: res.message || 'Registration failed.' };
        }
      } catch (e) {
        console.error('Live registration error:', e);
        if (e.name === 'AbortError') {
          return { success: false, message: 'Registration request timed out (>35s). Please check your internet connection.' };
        }
        return { success: false, message: e.message || 'Could not connect to registration server. Please try again.' };
      }
    }

    // 2. Mock / Offline Mode
    if (!matched) {
      return {
        success: false,
        message: `The entered identifier "${rawIdentifier}" was not found in the WCC members registry. Please enter your registered email, phone number, or Member ID.`
      };
    }

    // Attach salted hash (Zero plaintext password in local storage)
    const registered = this.getRegisteredMemberUsers();
    const existingIdx = registered.findIndex(r => (r.email && r.email.toLowerCase() === matched.email.toLowerCase()) || (r.memberId && r.memberId === matched.memberId));
    const salt = UTILS.generateSalt();
    const passwordHash = await UTILS.hashPassword(cleanPassword, salt);
    const userRecord = {
      ...matched,
      passwordHash: passwordHash,
      salt: salt,
      status: 'Active',
      role: CONFIG.ROLES.MEMBER,
      isMember: true
    };
    delete userRecord.password;

    if (existingIdx >= 0) {
      registered[existingIdx] = userRecord;
    } else {
      registered.push(userRecord);
    }
    localStorage.setItem(CONFIG.STORAGE_KEYS.MEMBER_USERS, JSON.stringify(registered));

    // Record Audit Entry
    this.logAudit(
      matched.memberId,
      'Member',
      CONFIG.AUDIT_ACTIONS.MEMBER_SIGNUP,
      matched.memberId,
      `Member activated account using ${matched.email}.`
    );

    return {
      success: true,
      memberId: matched.memberId,
      name: matched.name,
      message: `Account activated for ${matched.name} (Member ID: ${matched.memberId})! You can now sign in.`
    };
  },

  /**
   * Upload Profile Photo directly to Google Drive folder "WCC_Member_Photos"
   * and update the Photo URL column in the Google Sheet.
   * Supports either a File object, a Data URL, or raw base64 string.
   */
  async uploadProfilePhoto(memberId, fileOrData, email = '') {
    if (!memberId && !email) {
      return { success: false, message: 'Member ID or Email is required for photo upload.' };
    }

    let base64Data = '';
    let mimeType = 'image/jpeg';
    let fileName = `${memberId || 'member'}_photo.jpg`;

    try {
      if (typeof File !== 'undefined' && fileOrData instanceof File) {
        // Automatically compress image via canvas (max 800px)
        const compressed = await UTILS.compressImage(fileOrData, 800, 0.85);
        base64Data = compressed.base64;
        mimeType = compressed.mimeType;
        fileName = compressed.fileName;
      } else if (typeof fileOrData === 'string') {
        if (fileOrData.startsWith('data:image/')) {
          const parts = fileOrData.split(',');
          const matchMime = parts[0].match(/:(.*?);/);
          if (matchMime) mimeType = matchMime[1];
          base64Data = parts[1];
        } else {
          base64Data = fileOrData;
        }
      } else if (fileOrData && fileOrData.base64) {
        base64Data = fileOrData.base64;
        mimeType = fileOrData.mimeType || 'image/jpeg';
        fileName = fileOrData.fileName || fileName;
      }

      if (!base64Data) {
        return { success: false, message: 'No valid image data available to upload.' };
      }

      // Live Google Apps Script: Primary direct uploadProfilePhoto endpoint
      if (!CONFIG.USE_MOCK_DATA && CONFIG.API_URL && !CONFIG.API_URL.includes('YOUR_SCRIPT_ID_HERE')) {
        try {
          const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              action: 'uploadProfilePhoto',
              memberId: memberId,
              email: email,
              photoBase64: base64Data,
              mimeType: mimeType,
              photoName: fileName
            })
          });

          const rawText = await response.text();
          const cleanText = rawText.replace(/^\uFEFF/, '').trim();
          let res = null;
          try {
            res = JSON.parse(cleanText);
          } catch(e) {}

          if (res && res.status === 'success' && res.photoUrl && String(res.photoUrl).startsWith('http')) {
            this.clearCache();
            return {
              success: true,
              photoUrl: res.photoUrl,
              message: res.message || 'Profile photo uploaded to Google Drive and saved.'
            };
          }

          // Handle server error responses truthfully
          const serverMsg = (res && res.message) ? res.message : '';
          if (serverMsg.includes('Unsupported action') || serverMsg.includes('uploadProfilePhot')) {
            return {
              success: false,
              photoUrl: '',
              message: 'Google Apps Script web app-এ "New version" ডিপ্লয় করা নেই। Apps Script-এ Deploy > Manage deployments > Edit > New version নির্বাচন করে Deploy করুন।'
            };
          }

          return {
            success: false,
            photoUrl: '',
            message: serverMsg || 'Photo upload to Google Drive failed on server.'
          };
        } catch (fetchErr) {
          console.error('Direct uploadProfilePhoto error:', fetchErr);
          return {
            success: false,
            photoUrl: '',
            message: 'Server connection failed during photo upload.'
          };
        }
      }

      // Offline / Local Mock Fallback: ONLY when CONFIG.USE_MOCK_DATA is explicitly active
      if (CONFIG.USE_MOCK_DATA) {
        const simulatedUrl = `data:${mimeType};base64,${base64Data}`;
        return {
          success: true,
          photoUrl: simulatedUrl,
          message: 'Offline mock preview mode: photo cached locally.'
        };
      }

      return {
        success: false,
        photoUrl: '',
        message: 'Could not connect to Google Apps Script API endpoint.'
      };
    } catch (err) {
      console.error('Photo upload error:', err);
      return { success: false, message: err.message || 'Failed to upload photo.' };
    }
  },

  /**
   * Member Self-Service Update (Only allows safe personal fields)
   */
  async updateMemberSelf(memberId, fields) {
    if (!memberId) throw new Error('Member ID is required.');

    const cleanId = String(memberId).trim().toLowerCase();

    // Sanitize payload to guarantee no raw base64 or oversized fields ever reach Google Sheets (50k limit)
    const sanitizedFields = {};
    for (const k in fields) {
      const val = fields[k];
      if (typeof val === 'string') {
        if (val.startsWith('data:image') || val.includes(';base64,') || val.length > 5000) {
          if (k === 'photo' || k === 'photoUrl') {
            // NEVER send raw base64 string as photo URL into Google Sheet cell
            continue;
          }
          sanitizedFields[k] = val.substring(0, 5000);
        } else {
          sanitizedFields[k] = val;
        }
      } else {
        sanitizedFields[k] = val;
      }
    }

    // 1. Live Google Apps Script Cloud Web App
    if (!CONFIG.USE_MOCK_DATA && CONFIG.API_URL && !CONFIG.API_URL.includes('YOUR_SCRIPT_ID_HERE')) {
      try {
        const response = await fetch(CONFIG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'updateMemberProfile',
            memberId: memberId,
            ...sanitizedFields
          })
        });
        const res = await response.json();
        if (res.status === 'success') {
          this.clearCache();
          return { success: true, photoUrl: res.photoUrl, message: res.message };
        } else {
          return { success: false, message: res.message || 'Profile update failed.' };
        }
      } catch (e) {
        console.error('Remote member update error:', e);
        return { success: false, message: 'Server communication failed.' };
      }
    }

    // 2. Mock Mode Profile Update
    const allMembers = await this.fetchMembers();
    const target = allMembers.find(m => m.memberId.toLowerCase() === cleanId);
    if (!target) return { success: false, message: 'Member profile not found.' };

    const changedKeys = [];
    const allowed = [
      'phone', 'email', 'presentAddress', 'permanentAddress',
      'currentlyStudying', 'classYear', 'currentInstitution', 'institution',
      'lastPublicExam', 'publicExamResult', 'lastQualification', 'degree',
      'lastResult', 'lastInstitution',
      'profession', 'workplace', 'photo', 'bloodGroup', 'gender', 'district', 'upazila'
    ];

    allowed.forEach(k => {
      if (fields[k] !== undefined && fields[k] !== target[k]) {
        changedKeys.push(`${k}: '${target[k] || ''}' -> '${fields[k]}'`);
        target[k] = fields[k];
      }
    });

    // Update alias consistency and student flag
    if (target.currentInstitution) target.institution = target.currentInstitution;
    if (target.lastQualification) target.degree = target.lastQualification;
    target.isStudent = (
      target.currentlyStudying === 'হ্যাঁ' ||
      (target.currentlyStudying && String(target.currentlyStudying).toLowerCase().includes('yes'))
    );

    // If password changed, update registered member store
    if (fields.newPassword) {
      const registered = this.getRegisteredMemberUsers();
      const rMatch = registered.find(m => m.memberId.toLowerCase() === cleanId);
      if (rMatch) {
        rMatch.password = fields.newPassword;
        localStorage.setItem(CONFIG.STORAGE_KEYS.MEMBER_USERS, JSON.stringify(registered));
      }
      changedKeys.push('Password updated');
    }

    this.setCachedMembers(allMembers);

    if (changedKeys.length > 0) {
      const currentUser = AUTH.getCurrentUser();
      const actorRole = currentUser ? currentUser.role : 'Member';
      const actorEmail = currentUser ? currentUser.email : memberId;
      this.logAudit(actorEmail, actorRole, CONFIG.AUDIT_ACTIONS.PROFILE_SELF_UPDATE, memberId, `Member details updated: ${changedKeys.join('; ')}`);
    }

    return {
      success: true,
      message: 'Profile details updated successfully.'
    };
  },

  /**
   * Update full member profile (accessible by both Admin and Member)
   */
  async updateMemberProfile(memberId, fields) {
    return this.updateMemberSelf(memberId, fields);
  },

  /**
   * Update member status (Admin Action)
   */
  async updateMemberStatus(memberId, newStatus) {
    const allMembers = await this.fetchMembers();
    const target = allMembers.find(m => m.memberId.toLowerCase() === String(memberId).toLowerCase());

    if (!target) {
      throw new Error(`Member ${memberId} not found`);
    }

    const oldStatus = target.status;
    target.status = newStatus;
    this.setCachedMembers(allMembers);

    const currentUser = AUTH.getCurrentUser();
    const actorEmail = currentUser ? currentUser.email : 'Admin';

    // Record audit event
    this.logAudit(actorEmail, 'Admin', CONFIG.AUDIT_ACTIONS.STATUS_CHANGE, memberId, `Changed membership status from '${oldStatus}' to '${newStatus}'`);

    // If live API, send update
    if (!CONFIG.USE_MOCK_DATA) {
      try {
        await fetch(CONFIG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'updateStatus',
            memberId: memberId,
            status: newStatus,
            actorEmail: actorEmail
          })
        });
      } catch (e) {
        console.warn('Backend status update request failed; cached locally.', e);
      }
    }

    return target;
  },

  /**
   * Log entry to Audit Log
   */
  logAudit(actor, role, actionType, targetId, details) {
    const entry = {
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      actor: actor || 'System',
      role: role || 'Staff',
      action: actionType || 'ACTIVITY',
      targetId: targetId || '-',
      details: details || ''
    };

    try {
      const logs = this.getCachedAuditLogs();
      logs.unshift(entry);
      // Keep most recent 300 logs
      if (logs.length > 300) logs.pop();
      localStorage.setItem(CONFIG.STORAGE_KEYS.AUDIT_CACHE, JSON.stringify(logs));
    } catch (e) {}

    // In live mode, send async log to backend
    if (typeof fetch !== 'undefined' && !CONFIG.USE_MOCK_DATA && CONFIG.API_URL && !CONFIG.API_URL.includes('YOUR_SCRIPT_ID_HERE')) {
      try {
        fetch(CONFIG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'logAudit',
            ...entry
          })
        }).catch(e => console.warn('Live audit log notice:', e.message));
      } catch (err) {}
    }
  },

  /**
   * Fetch all audit logs (Admin View)
   */
  async fetchAuditLogs() {
    if (!CONFIG.USE_MOCK_DATA && CONFIG.API_URL && !CONFIG.API_URL.includes('YOUR_SCRIPT_ID_HERE')) {
      try {
        const response = await fetch(`${CONFIG.API_URL}?action=auditLogs`, {
          headers: { 'Accept': 'application/json' }
        });
        const res = await response.json();
        if (res.status === 'success') {
          return res.logs || [];
        }
      } catch (e) {
        console.warn('Failed to fetch remote audit logs; using local cache.', e);
      }
    }
    return this.getCachedAuditLogs();
  },

  getCachedAuditLogs() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.AUDIT_CACHE);
      if (raw) return JSON.parse(raw);
    } catch (e) {}

    // Seed default audit trail entries if none exist
    const defaultLogs = [
      {
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        actor: 'System',
        role: 'Engine',
        action: 'SYSTEM_INIT',
        targetId: 'Core',
        details: 'WCC Audit Logging & Security System Active.'
      }
    ];
    localStorage.setItem(CONFIG.STORAGE_KEYS.AUDIT_CACHE, JSON.stringify(defaultLogs));
    return defaultLogs;
  },

  /**
   * Get registered member users from persistent storage
   */
  getRegisteredMemberUsers() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.MEMBER_USERS);
      if (raw) return JSON.parse(raw);
    } catch (e) {}

    // Seed a default registered member for offline testing with salted hash (no plaintext password)
    const defaultMember = [
      {
        memberId: 'WCC-2026-0001',
        name: 'Tanvir Ahmed',
        email: 'member@wecanchange.org',
        phone: '+880 1711-223344',
        bloodGroup: 'B+',
        status: 'Active',
        role: 'Member',
        salt: 'wcc_seed_salt_2026',
        passwordHash: '8b7d9959600d3d52623a854d9c49d67a99bbca68997ef3eb8a4a58ff093b77aa', // SHA-256('member123::wcc_seed_salt_2026')
        division: 'Dhaka',
        district: 'Dhaka',
        upazila: 'Dhanmondi',
        institution: 'University of Dhaka',
        department: 'Economics',
        profession: 'Student'
      }
    ];
    localStorage.setItem(CONFIG.STORAGE_KEYS.MEMBER_USERS, JSON.stringify(defaultMember));
    return defaultMember;
  },

  getCachedMembers(ignoreExpiry = false) {
    try {
      const isMockCache = localStorage.getItem('wcc_cache_is_mock') === 'true';
      // If we are currently in LIVE mode, never use mock cache!
      if (!CONFIG.USE_MOCK_DATA && isMockCache) {
        return null;
      }
      // If we are currently in MOCK mode, never use live cache!
      if (CONFIG.USE_MOCK_DATA && !isMockCache && localStorage.getItem('wcc_cache_is_mock') !== null) {
        return null;
      }

      const timeStr = localStorage.getItem(this.CACHE_TIME_KEY);
      if (!timeStr) return null;

      const cacheAge = Date.now() - parseInt(timeStr, 10);
      if (!ignoreExpiry && cacheAge > CONFIG.CACHE_TTL_MS) {
        return null;
      }

      const raw = localStorage.getItem(this.CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  setCachedMembers(members) {
    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(members));
      localStorage.setItem(this.CACHE_TIME_KEY, String(Date.now()));
      localStorage.setItem('wcc_cache_is_mock', CONFIG.USE_MOCK_DATA ? 'true' : 'false');
    } catch (e) {}
  },

  clearCache() {
    this._inFlightFetchPromise = null;
    localStorage.removeItem(this.CACHE_KEY);
    localStorage.removeItem(this.CACHE_TIME_KEY);
    localStorage.removeItem('wcc_members_cache_v2');
    localStorage.removeItem('wcc_members_cache_time_v2');
    localStorage.removeItem('wcc_cache_is_mock');
  },

  /**
   * Request Password Reset (Supports OTP or Identity Verification)
   */
  async requestPasswordReset(identifier, mode = 'check', extra = {}) {
    if (!identifier) return { success: false, message: 'Identifier is required.' };

    if (!CONFIG.USE_MOCK_DATA && CONFIG.API_URL && !CONFIG.API_URL.includes('YOUR_SCRIPT_ID_HERE')) {
      try {
        const response = await fetch(CONFIG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'requestPasswordReset',
            identifier: identifier,
            mode: mode,
            ...extra
          })
        });
        const res = await response.json();
        return {
          success: res.status === 'success',
          ...res
        };
      } catch (e) {
        console.error('Password reset request error:', e);
        return { success: false, message: 'Could not connect to server. Please try again.' };
      }
    }

    // Mock Mode Handler
    const members = await this.fetchMembers();
    const cleanId = String(identifier).trim().toLowerCase();
    const cleanPhone = cleanId.replace(/[^0-9]/g, '');
    const target = members.find(m => 
      (m.email && m.email.toLowerCase() === cleanId) ||
      (m.memberId && m.memberId.toLowerCase() === cleanId) ||
      (cleanPhone.length >= 8 && m.phone && m.phone.replace(/[^0-9]/g, '').slice(-10) === cleanPhone.slice(-10))
    );

    if (!target) {
      return { success: false, message: `No member record found for '${identifier}'.` };
    }

    const maskedEmail = target.email ? target.email.replace(/(.{2})(.*)(?=@)/, (m, a, b) => a + '***') : '';
    const maskedPhone = target.phone ? target.phone.slice(0, 3) + '****' + target.phone.slice(-3) : '';

    if (mode === 'check') {
      return {
        success: true,
        memberId: target.memberId,
        name: target.name,
        hasEmail: !!target.email,
        maskedEmail: maskedEmail,
        hasPhone: !!target.phone,
        maskedPhone: maskedPhone,
        message: 'Member record verified.'
      };
    }

    if (mode === 'send_otp') {
      localStorage.setItem('wcc_mock_reset_otp_' + target.memberId.toLowerCase(), '123456');
      return {
        success: true,
        method: 'otp',
        memberId: target.memberId,
        maskedEmail: maskedEmail || 'registered email',
        message: `[Demo Mode] A 6-digit OTP code has been sent to ${maskedEmail || 'your email'}. Demo Code: 123456`
      };
    }

    if (mode === 'verify_identity') {
      const providedDob = String(extra.dob || '').trim().toLowerCase();
      const actualDob = String(target.dob || '').trim().toLowerCase();
      const isDobMatch = providedDob && actualDob && (actualDob.includes(providedDob) || providedDob.includes(actualDob));
      if (!isDobMatch) {
        return { success: false, message: 'Provided Date of Birth did not match our records.' };
      }
      return {
        success: true,
        method: 'verified',
        memberId: target.memberId,
        resetToken: 'mock_token_' + Date.now(),
        message: 'Identity verified successfully! You can set your new password.'
      };
    }

    return { success: false, message: 'Invalid recovery mode.' };
  },

  /**
   * Complete Password Reset
   */
  async resetPassword(payload) {
    if (!payload.memberId || !payload.newPassword) {
      return { success: false, message: 'Member ID and New Password are required.' };
    }

    if (!CONFIG.USE_MOCK_DATA && CONFIG.API_URL && !CONFIG.API_URL.includes('YOUR_SCRIPT_ID_HERE')) {
      try {
        const response = await fetch(CONFIG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'resetPassword',
            ...payload
          })
        });
        const res = await response.json();
        return {
          success: res.status === 'success',
          ...res
        };
      } catch (e) {
        console.error('Reset password error:', e);
        return { success: false, message: 'Server communication error. Please try again.' };
      }
    }

    // Mock Mode Reset
    const salt = UTILS.generateSalt();
    const hash = UTILS.hashPassword(payload.newPassword, salt);
    let authUsers = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.AUTH_USERS) || '[]');
    const memberIndex = authUsers.findIndex(u => (u.memberId && u.memberId.toLowerCase() === payload.memberId.toLowerCase()) || (u.email && u.email.toLowerCase() === (payload.email || '').toLowerCase()));

    if (memberIndex !== -1) {
      authUsers[memberIndex].passwordHash = hash;
      authUsers[memberIndex].salt = salt;
    } else {
      authUsers.push({
        memberId: payload.memberId,
        email: payload.email || '',
        passwordHash: hash,
        salt: salt,
        role: 'Member',
        status: 'Active'
      });
    }
    localStorage.setItem(CONFIG.STORAGE_KEYS.AUTH_USERS, JSON.stringify(authUsers));

    return {
      success: true,
      message: 'Password reset successfully! You can now log in with your new password.'
    };
  }
};
