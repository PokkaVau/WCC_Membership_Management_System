/**
 * WCC Membership Management System - Authentication & Multi-Role Session Guard
 * Provides enterprise multi-role authentication, stateless concurrent session management,
 * route guards, and audit trail generation for We Can Change (WCC).
 */

const AUTH = {
  SESSION_KEY: CONFIG.STORAGE_KEYS.SESSION,
  THEME_KEY: CONFIG.STORAGE_KEYS.THEME,

  /**
   * Attempt Role-Based Login across Admins and Members (Supports Concurrent Sessions)
   * @param {string} username - Email, Phone, Member ID, or Admin Username
   * @param {string} password - Password
   * @param {boolean} rememberMe - Whether to persist session in localStorage vs sessionStorage
   * @param {string} [expectedRole] - Optional expected role: 'admin' or 'member'
   */
  async login(username, password, rememberMe = false, expectedRole = null) {
    let cleanUser = String(username || '').trim().toLowerCase();
    const cleanPass = String(password || '').trim();
    const reqRole = expectedRole ? String(expectedRole).trim().toLowerCase() : null;

    if (!cleanUser || !cleanPass) {
      return { success: false, message: 'Please enter your username/email and password.' };
    }

    // Helper to normalize phone digits for Bangladeshi phone numbers (+880, 880, leading 0)
    const normalizePhone = (p) => {
      if (!p) return '';
      let digits = String(p).replace(/[^0-9]/g, '');
      if (digits.startsWith('880')) digits = digits.slice(3);
      else if (digits.startsWith('88')) digits = digits.slice(2);
      if (digits.startsWith('0')) digits = digits.slice(1);
      return digits;
    };

    const userPhoneDigits = normalizePhone(cleanUser);

    // If user entered phone number or Member ID, resolve to registered email from members database
    let resolvedEmail = '';
    let resolvedMemberId = '';
    try {
      const cached = typeof API !== 'undefined' ? API.getCachedMembers(true) : null;
      if (cached && cached.length > 0) {
        const found = cached.find(m => {
          if (m.memberId && m.memberId.toLowerCase() === cleanUser) return true;
          if (m.email && m.email.toLowerCase() === cleanUser) return true;
          if (userPhoneDigits && m.phone) {
            const mDigits = normalizePhone(m.phone);
            if (mDigits && mDigits === userPhoneDigits) return true;
          }
          return false;
        });
        if (found) {
          resolvedEmail = (found.email || '').toLowerCase();
          resolvedMemberId = (found.memberId || '').toUpperCase();
        }
      }
    } catch(e) {}

    // 1. Cloud Production Mode: Authenticate against Google Apps Script Web App
    let serverErrorMessage = null;
    if (!CONFIG.USE_MOCK_DATA && CONFIG.API_URL && !CONFIG.API_URL.includes('YOUR_SCRIPT_ID_HERE')) {
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        // 30-second timeout for Google Apps Script execution and cold start
        const timeoutId = controller ? setTimeout(() => controller.abort(), 30000) : null;

        // Try resolvedEmail if user entered a phone number, or raw cleanUser
        const loginIdentifier = resolvedEmail || cleanUser;

        const fetchOpts = {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'login',
            username: loginIdentifier,
            password: cleanPass,
            expectedRole: reqRole || undefined
          })
        };
        if (controller) fetchOpts.signal = controller.signal;

        const response = await fetch(CONFIG.API_URL, fetchOpts);
        if (timeoutId) clearTimeout(timeoutId);

        const rawText = await response.text();
        const cleanText = rawText.replace(/^\uFEFF/, '').trim();
        let res = null;
        try {
          res = JSON.parse(cleanText);
        } catch(pe) {
          console.warn('Non-JSON login response:', cleanText);
        }

        if (res && res.status === 'success' && res.token && res.user) {
          // Verify role segregation on client if expectedRole is specified
          if (reqRole === 'admin' && (res.user.isMember || res.user.role === CONFIG.ROLES.MEMBER)) {
            return {
              success: false,
              message: "This account belongs to a WCC Member. Please switch to the 'Member Login' tab."
            };
          }
          if (reqRole === 'member' && (!res.user.isMember && res.user.role !== CONFIG.ROLES.MEMBER)) {
            return {
              success: false,
              message: "This account has Administrator privileges. Please switch to the 'Admin Login' tab."
            };
          }

          const sessionData = {
            token: res.token,
            user: res.user,
            loginTime: new Date().toISOString()
          };

          const storage = rememberMe ? localStorage : sessionStorage;
          storage.setItem(this.SESSION_KEY, JSON.stringify(sessionData));

          // Cache in local registered members with Salted SHA-256 if member
          if (res.user.isMember || res.user.role === CONFIG.ROLES.MEMBER) {
            try {
              const registered = API.getRegisteredMemberUsers();
              const existingIdx = registered.findIndex(r => (r.email && r.email.toLowerCase() === res.user.email.toLowerCase()) || (r.memberId && r.memberId === res.user.memberId));
              const salt = UTILS.generateSalt();
              const passwordHash = await UTILS.hashPassword(cleanPass, salt);
              const userRecord = {
                ...res.user,
                passwordHash: passwordHash,
                salt: salt
              };
              delete userRecord.password;
              if (existingIdx >= 0) registered[existingIdx] = { ...registered[existingIdx], ...userRecord };
              else registered.push(userRecord);
              localStorage.setItem(CONFIG.STORAGE_KEYS.MEMBER_USERS, JSON.stringify(registered));
            } catch(e) {}
          }

          return { success: true, user: res.user };
        } else if (res && (res.status === 'error' || res.message)) {
          serverErrorMessage = res.message;
        }
      } catch (err) {
        console.warn('Remote authentication skipped or failed, trying local store:', err.message);
      }
    }

    // 2. Offline / Local Fallback Authentication Engine
    // Check if entered credentials match Default Super Admin or Registered Admins
    const isAdminUserIdentifier = (cleanUser === 'admin@wecanchange.org' || cleanUser === 'admin' || cleanUser === 'wccadmin' || cleanUser === 'superadmin');
    const isAdminPasswordMatch = (cleanPass === 'wccadmin2026' || cleanPass === 'admin123');

    // Also check any admins registered in localStorage
    let storedAdminMatch = null;
    try {
      const storedAdmins = JSON.parse(localStorage.getItem('wcc_registered_admins') || '[]');
      storedAdminMatch = storedAdmins.find(a => (a.email && a.email.toLowerCase() === cleanUser) || (a.username && a.username.toLowerCase() === cleanUser));
      if (storedAdminMatch) {
        if (storedAdminMatch.passwordHash && storedAdminMatch.salt) {
          const chk = await UTILS.hashPassword(cleanPass, storedAdminMatch.salt);
          if (chk !== storedAdminMatch.passwordHash) storedAdminMatch = null;
        } else if (storedAdminMatch.password && storedAdminMatch.password !== cleanPass) {
          storedAdminMatch = null;
        }
      }
    } catch(e) {}

    const isSystemAdmin = (isAdminUserIdentifier && isAdminPasswordMatch) || !!storedAdminMatch;

    // A. Handle ADMIN Role Request
    if (reqRole === 'admin') {
      if (isSystemAdmin) {
        const adminUser = storedAdminMatch ? {
          email: storedAdminMatch.email || 'admin@wecanchange.org',
          name: storedAdminMatch.name || 'WCC Administrator',
          role: storedAdminMatch.role || CONFIG.ROLES.SUPER_ADMIN,
          isMember: false
        } : {
          email: 'admin@wecanchange.org',
          name: 'WCC Super Administrator',
          role: CONFIG.ROLES.SUPER_ADMIN,
          isMember: false
        };

        const sessionData = {
          token: 'wcc_admin_token_' + Math.random().toString(36).substring(2) + Date.now(),
          user: adminUser,
          loginTime: new Date().toISOString()
        };

        const storage = rememberMe ? localStorage : sessionStorage;
        storage.setItem(this.SESSION_KEY, JSON.stringify(sessionData));

        if (typeof API !== 'undefined' && API.logAudit) {
          API.logAudit(adminUser.email, adminUser.role, CONFIG.AUDIT_ACTIONS.LOGIN, adminUser.email, 'Admin signed in to management dashboard.');
        }

        return { success: true, user: adminUser };
      }

      // Check if user accidentally entered Member credentials on Admin tab
      const isMemberCreds = await this._verifyMemberCredentials(cleanUser, cleanPass, userPhoneDigits, resolvedEmail, resolvedMemberId);
      if (isMemberCreds) {
        return {
          success: false,
          message: "This account belongs to a WCC Member. Please switch to the 'Member Login' tab."
        };
      }

      return {
        success: false,
        message: serverErrorMessage || 'Invalid administrator email or password. Please check your credentials.'
      };
    }

    // B. Handle MEMBER Role Request (or general login)
    if (isSystemAdmin && reqRole === 'member') {
      return {
        success: false,
        message: "This account has Administrator privileges. Please switch to the 'Admin Login' tab to sign in."
      };
    }

    // Member verification
    try {
      const registeredMembers = API.getRegisteredMemberUsers();
      for (const m of registeredMembers) {
        const matchEmail = m.email && m.email.toLowerCase() === cleanUser;
        const matchResolved = resolvedEmail && m.email && m.email.toLowerCase() === resolvedEmail;
        const matchId = (m.memberId && m.memberId.toLowerCase() === cleanUser) || (resolvedMemberId && m.memberId && m.memberId.toUpperCase() === resolvedMemberId);
        let matchPhone = false;
        if (userPhoneDigits && m.phone) {
          const mPhoneDigits = normalizePhone(m.phone);
          matchPhone = (mPhoneDigits && mPhoneDigits === userPhoneDigits);
        }

        if (matchEmail || matchResolved || matchId || matchPhone) {
          let passwordValid = false;
          if (m.passwordHash && m.salt) {
            const calculatedHash = await UTILS.hashPassword(cleanPass, m.salt);
            passwordValid = (calculatedHash === m.passwordHash);
          } else if (m.password) {
            if (m.password === cleanPass) {
              passwordValid = true;
              m.salt = UTILS.generateSalt();
              m.passwordHash = await UTILS.hashPassword(cleanPass, m.salt);
              delete m.password;
              localStorage.setItem(CONFIG.STORAGE_KEYS.MEMBER_USERS, JSON.stringify(registeredMembers));
            }
          }

          if (passwordValid) {
            const sessionData = {
              token: 'wcc_member_token_' + Math.random().toString(36).substring(2) + Date.now(),
              user: {
                memberId: m.memberId,
                name: m.name,
                email: m.email,
                phone: m.phone,
                status: m.status || 'Active',
                role: CONFIG.ROLES.MEMBER,
                isMember: true
              },
              loginTime: new Date().toISOString()
            };

            const storage = rememberMe ? localStorage : sessionStorage;
            storage.setItem(this.SESSION_KEY, JSON.stringify(sessionData));

            if (typeof API !== 'undefined' && API.logAudit) {
              API.logAudit(m.memberId, 'Member', CONFIG.AUDIT_ACTIONS.LOGIN, m.memberId, 'Member signed in to self-service portal.');
            }

            return { success: true, user: sessionData.user };
          }
        }
      }
    } catch (e) {
      console.error('Local member auth error:', e);
    }

    // Default fallback when role is unconstrained and matches admin
    if (!reqRole && isSystemAdmin) {
      const adminUser = {
        email: 'admin@wecanchange.org',
        name: 'WCC Super Administrator',
        role: CONFIG.ROLES.SUPER_ADMIN,
        isMember: false
      };
      const sessionData = {
        token: 'wcc_admin_token_' + Math.random().toString(36).substring(2) + Date.now(),
        user: adminUser,
        loginTime: new Date().toISOString()
      };
      const storage = rememberMe ? localStorage : sessionStorage;
      storage.setItem(this.SESSION_KEY, JSON.stringify(sessionData));
      return { success: true, user: adminUser };
    }

    return {
      success: false,
      message: serverErrorMessage || (reqRole === 'member'
        ? 'Invalid Member ID, email, or password. If you have not set your password yet, please activate your account via Member Sign Up.'
        : 'Invalid credentials entered. Please verify your username and password.')
    };
  },

  /**
   * Helper to check whether given credentials match a registered member
   * @private
   */
  async _verifyMemberCredentials(cleanUser, cleanPass, userPhoneDigits, resolvedEmail, resolvedMemberId) {
    try {
      const registeredMembers = API.getRegisteredMemberUsers();
      for (const m of registeredMembers) {
        const matchEmail = m.email && m.email.toLowerCase() === cleanUser;
        const matchResolved = resolvedEmail && m.email && m.email.toLowerCase() === resolvedEmail;
        const matchId = (m.memberId && m.memberId.toLowerCase() === cleanUser) || (resolvedMemberId && m.memberId && m.memberId.toUpperCase() === resolvedMemberId);
        let matchPhone = false;
        if (userPhoneDigits && m.phone) {
          const digits = String(m.phone).replace(/[^0-9]/g, '').slice(-10);
          if (digits && userPhoneDigits.endsWith(digits)) matchPhone = true;
        }

        if (matchEmail || matchResolved || matchId || matchPhone) {
          if (m.passwordHash && m.salt) {
            const calculatedHash = await UTILS.hashPassword(cleanPass, m.salt);
            if (calculatedHash === m.passwordHash) return true;
          } else if (m.password && m.password === cleanPass) {
            return true;
          }
        }
      }
    } catch(e) {}
    return false;
  },

  /**
   * Register a new member
   */
  async register(memberData) {
    return await API.registerMember(memberData);
  },

  /**
   * Check if current browser instance has an active session
   */
  isAuthenticated() {
    const sessionStr = localStorage.getItem(this.SESSION_KEY) || sessionStorage.getItem(this.SESSION_KEY);
    if (!sessionStr) return false;
    try {
      const session = JSON.parse(sessionStr);
      return Boolean(session && session.token);
    } catch (e) {
      return false;
    }
  },

  /**
   * Get current logged-in user profile
   */
  getCurrentUser() {
    const sessionStr = localStorage.getItem(this.SESSION_KEY) || sessionStorage.getItem(this.SESSION_KEY);
    if (!sessionStr) return null;
    try {
      return JSON.parse(sessionStr).user;
    } catch (e) {
      return null;
    }
  },

  /**
   * Check if current logged-in user is a general member
   */
  isMember() {
    const user = this.getCurrentUser();
    return Boolean(user && (user.isMember || user.role === CONFIG.ROLES.MEMBER));
  },

  /**
   * Check if current logged-in user is an administrator or staff
   */
  isAdmin() {
    const user = this.getCurrentUser();
    if (!user) return false;
    return user.role === CONFIG.ROLES.SUPER_ADMIN || user.role === CONFIG.ROLES.ADMIN || user.role === CONFIG.ROLES.MODERATOR || user.role === CONFIG.ROLES.VIEWER;
  },

  /**
   * Log out current user and redirect to login page preserving relevant role tab
   */
  logout() {
    const user = this.getCurrentUser();
    let roleParam = '';
    if (user) {
      API.logAudit(user.email || user.memberId || 'User', user.role || 'User', CONFIG.AUDIT_ACTIONS.LOGOUT, user.memberId || user.email || '-', 'User logged out.');
      roleParam = (user.isMember || user.role === CONFIG.ROLES.MEMBER) ? '?role=member' : '?role=admin';
    }
    localStorage.removeItem(this.SESSION_KEY);
    sessionStorage.removeItem(this.SESSION_KEY);
    window.location.href = 'index.html' + roleParam;
  },

  /**
   * Guard for general authenticated access
   */
  requireAuth() {
    if (!this.isAuthenticated()) {
      const currentPage = window.location.pathname.split('/').pop() || 'index.html';
      if (currentPage !== 'index.html' && currentPage !== 'signup.html' && currentPage !== 'verify.html' && currentPage !== '') {
        const isMemberRoute = (currentPage === 'my-profile.html');
        const roleParam = isMemberRoute ? 'role=member' : 'role=admin';
        window.location.href = `index.html?${roleParam}&redirect=${encodeURIComponent(currentPage)}`;
      }
    }
  },

  /**
   * Guard for Admin pages (dashboard, members directory, analytics, settings).
   * Prevents general members from accessing administrative controls.
   */
  requireAdmin() {
    this.requireAuth();
    if (this.isMember()) {
      // General member attempting to access admin dashboard -> redirect to member portal
      window.location.href = 'my-profile.html';
    }
  },

  /**
   * Guard for Member Portal.
   */
  requireMemberPortal() {
    if (!this.isAuthenticated()) {
      window.location.href = 'index.html?role=member&redirect=my-profile.html';
      return;
    }
    const user = this.getCurrentUser();
    if (!user) {
      window.location.href = 'index.html?role=member';
      return;
    }
  },

  /**
   * If already logged in, redirect user to their appropriate destination
   */
  redirectIfAuthenticated() {
    if (this.isAuthenticated()) {
      const user = this.getCurrentUser();
      if (user && (user.isMember || user.role === CONFIG.ROLES.MEMBER)) {
        window.location.href = 'my-profile.html';
      } else {
        window.location.href = 'dashboard.html';
      }
    }
  },

  /**
   * Initialize Theme (Dark/Light) from localStorage and wire up toggle button
   */
  initTheme() {
    let savedTheme = 'dark';
    try {
      savedTheme = localStorage.getItem(this.THEME_KEY) || 'dark';
    } catch (e) {
      savedTheme = 'dark';
    }

    document.documentElement.setAttribute('data-theme', savedTheme);
    document.documentElement.style.colorScheme = savedTheme;

    const toggleBtn = document.getElementById('themeToggleBtn');
    if (toggleBtn) {
      this.updateThemeButtonIcon(toggleBtn, savedTheme);
      toggleBtn.onclick = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        document.documentElement.style.colorScheme = next;
        try {
          localStorage.setItem(this.THEME_KEY, next);
        } catch (err) {}
        this.updateThemeButtonIcon(toggleBtn, next);

        window.dispatchEvent(new CustomEvent('wcc-theme-changed', { detail: { theme: next } }));
      };
    }
  },

  updateThemeButtonIcon(btn, theme) {
    if (!btn) return;
    if (theme === 'light') {
      btn.innerHTML = '🌙';
      btn.setAttribute('title', 'Switch to Dark Mode');
      btn.setAttribute('aria-label', 'Switch to Dark Mode');
    } else {
      btn.innerHTML = '☀️';
      btn.setAttribute('title', 'Switch to Light Mode');
      btn.setAttribute('aria-label', 'Switch to Light Mode');
    }
  },

  /**
   * Render or update live API connection status badge in the header
   */
  renderApiStatusBadge() {
    const headerRight = document.querySelector('.header-right');
    if (!headerRight) return;

    let badge = document.getElementById('headerApiStatusBadge');
    if (!badge) {
      badge = document.createElement('a');
      badge.id = 'headerApiStatusBadge';
      badge.href = 'settings.html';
      badge.className = 'header-api-status-badge';
      badge.style.cssText = 'display:inline-flex; align-items:center; gap:0.4rem; padding:0.32rem 0.75rem; border-radius:999px; font-size:0.75rem; font-weight:600; text-decoration:none; transition:all 0.2s ease; cursor:pointer;';
      headerRight.insertBefore(badge, headerRight.firstChild);
    }

    const isConnected = typeof CONFIG !== 'undefined' && CONFIG.IS_API_CONNECTED && !CONFIG.USE_MOCK_DATA;
    if (isConnected) {
      badge.style.background = 'rgba(46, 204, 113, 0.15)';
      badge.style.color = '#2ECC71';
      badge.style.border = '1px solid rgba(46, 204, 113, 0.35)';
      badge.title = 'Live API Connected & Active. Click to view Settings.';
      badge.innerHTML = '<span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#2ECC71; box-shadow:0 0 6px #2ECC71;"></span> <span>Live API Connected</span>';
    } else {
      badge.style.background = 'rgba(241, 173, 26, 0.15)';
      badge.style.color = 'var(--wcc-gold, #F1AD1A)';
      badge.style.border = '1px solid rgba(241, 173, 26, 0.35)';
      badge.title = 'API Disconnected (Demo Mode). Click to Connect Live API.';
      badge.innerHTML = '<span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--wcc-gold, #F1AD1A);"></span> <span>Demo Mode (Offline)</span>';
    }
  },

  /**
   * Initialize sidebar mobile drawer and header user UI
   */
  initUIComponents() {
    this.initTheme();
    this.renderApiStatusBadge();

    window.addEventListener('wcc-connection-changed', () => {
      this.renderApiStatusBadge();
    });

    // Wire mobile menu toggle
    const menuBtn = document.getElementById('menuToggleBtn');
    const sidebar = document.querySelector('.sidebar');
    let backdrop = document.querySelector('.sidebar-backdrop');

    if (!backdrop && sidebar) {
      backdrop = document.createElement('div');
      backdrop.className = 'sidebar-backdrop';
      document.body.appendChild(backdrop);
    }

    if (menuBtn && sidebar && backdrop) {
      menuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('active');
        backdrop.classList.toggle('active');
      });

      backdrop.addEventListener('click', () => {
        sidebar.classList.remove('active');
        backdrop.classList.remove('active');
      });
    }

    // Populate user details in header
    const user = this.getCurrentUser();
    if (user) {
      const nameEl = document.getElementById('headerUserName');
      const roleEl = document.getElementById('headerUserRole');
      if (nameEl) nameEl.textContent = user.name || user.email;
      if (roleEl) roleEl.textContent = user.role || (user.isMember ? 'WCC Member' : 'Administrator');

      // Add Member Portal link in sidebar if member or testing
      const sidebarNav = document.querySelector('.sidebar-nav');
      if (sidebarNav && user.isMember) {
        // Highlight active or member-specific items
      }
    }

    // Wire global header search
    const headerSearch = document.getElementById('headerGlobalSearch');
    if (headerSearch) {
      headerSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const val = headerSearch.value.trim();
          if (val) {
            window.location.href = `members.html?q=${encodeURIComponent(val)}`;
          }
        }
      });
    }
  }
};
