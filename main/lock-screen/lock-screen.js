/**
 * @file main/lock-screen/lock-screen.js
 * @description Immersive lock screen controller for the root desktop shell.
 *
 * Reuses the existing services:
 *   - ProfileService     profiles, custom usernames, simulated authentication,
 *                        session lock/unlock and profile activation (reload)
 *   - PersistenceService profile-scoped lockScreen preferences + avatar
 *   - ProfileUI          desktop lock/inert state and aria-hidden handling
 *   - SystemServices     event bus (when present)
 *   - LockAnimationController / LockWidgets / LockSecretEvents
 *
 * SECURITY NOTE: browser-only simulation. Credentials cannot be protected
 * from someone who controls DevTools or the served JavaScript. The hidden
 * administrator is deliberately absent from public account lists, but this is
 * not a real security boundary.
 */

(function (window, document) {
  'use strict';

  const BUILTIN_AVATARS = [
    'default-blue',
    'default-purple',
    'default-green',
    'default-orange',
    'default-mono',
    'retro-pixel'
  ];

  const BUILTIN_COLORS = {
    'default-blue': ['#1d4ed8', '#38bdf8', '#0b1024'],
    'default-purple': ['#7e22ce', '#c084fc', '#160524'],
    'default-green': ['#15803d', '#86efac', '#03140a'],
    'default-orange': ['#c2410c', '#fdba74', '#1b0a03'],
    'default-mono': ['#475569', '#e2e8f0', '#05070d'],
    'retro-pixel': ['#0f766e', '#5eead4', '#02110f']
  };

  const MAX_AVATAR_BYTES = 512 * 1024;
  const MAX_AVATAR_DIMENSION = 1024;
  const AVATAR_STORAGE_LIMIT = 600000;
  const AUTO_ENTER_KEY = 'desktop.lock.autoEnter';
  const THEME_KEY = 'desktop.lock.theme';
  const MAX_ERRORS = 20;

  function safeSessionGet(key) {
    try { return window.sessionStorage.getItem(key); } catch (_) { return null; }
  }

  function safeSessionSet(key, value) {
    try { window.sessionStorage.setItem(key, String(value)); } catch (_) { /* optional */ }
  }

  function safeSessionRemove(key) {
    try { window.sessionStorage.removeItem(key); } catch (_) { /* optional */ }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function escapeSvg(value) {
    return String(value).replace(/[<>&"']/g, function (character) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function builtinAvatar(key) {
    const isGuest = key === 'guest' || key === 'default-mono';
    const guestInner =
      '<circle cx="64" cy="46" r="18" fill="none" stroke="#ffffff" stroke-width="6"/>' +
      '<text x="64" y="53" fill="#ffffff" font-size="22" font-family="-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif" font-weight="600" text-anchor="middle">?</text>' +
      '<path d="M30 108c4-22 18-32 34-32s30 10 34 32" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round"/>';

    const userInner =
      '<circle cx="64" cy="46" r="18" fill="none" stroke="#ffffff" stroke-width="6"/>' +
      '<path d="M30 108c4-22 18-32 34-32s30 10 34 32" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round"/>';

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
      '<rect width="128" height="128" rx="64" fill="rgba(255,255,255,0.2)"/>' +
      (isGuest ? guestInner : userInner) +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function avatarSrc(avatar) {
    if (!avatar) return builtinAvatar('default-purple');
    if (avatar.kind === 'custom' && typeof avatar.value === 'string' &&
        /^data:image\/(?:png|jpeg|webp);base64,/i.test(avatar.value)) {
      return avatar.value;
    }
    return builtinAvatar(BUILTIN_COLORS[avatar.value] ? avatar.value : 'default-purple');
  }

  function defaultSettings() {
    if (window.PersistenceService && typeof window.PersistenceService.defaults === 'function') {
      return window.PersistenceService.defaults().lockScreen;
    }
    return {
      clock: { enabled: true, showSeconds: false, format: '24h', showDate: true },
      animation: { intensity: 'high', parallax: true, particles: true, respectReducedMotion: true, pauseWhenHidden: true },
      widgets: { enabled: true, enabledIds: ['fun-fact', 'system-message'], rotation: 'on-interaction' },
      audio: { enabled: false, ambientEnabled: false, effectsEnabled: true, volume: 0.25 },
      accounts: { showOwner: true, showGuest: true, showHiddenAccounts: false, allowAccountCreation: false },
      avatar: { kind: 'builtin', value: 'default-purple' }
    };
  }

  function messageFor(code) {
    const messages = {
      MISSING_USERNAME: 'Enter a username to continue.',
      MISSING_CREDENTIALS: 'Enter a username and password.',
      INVALID_CREDENTIALS: 'Sign-in failed. Check your credentials and try again.',
      LOGIN_UNAVAILABLE: 'Sign-in is temporarily unavailable. Try again.',
      NO_PASSWORD: 'This account has no password configured yet.',
      AVATAR_INVALID: 'That image cannot be used. Choose a PNG, JPEG, or WebP under 512 KB.',
      AVATAR_TOO_LARGE: 'That image is too large. Choose one under 512 KB and 1024×1024.',
      PROFILE_UNAVAILABLE: 'That account is unavailable.'
    };
    return messages[code] || messages.INVALID_CREDENTIALS;
  }

  // Themes are presentation-only. Authentication and profile state remain
  // entirely independent from this session-scoped preference.
  const LockTheme = {
    default: 'aurora',
    _current: 'aurora',
    themes: new Map([
      ['aurora', { id: 'aurora', label: 'Aurora' }],
      ['ember', { id: 'ember', label: 'Ember' }],
      ['noir', { id: 'noir', label: 'Noir' }]
    ]),
    list() { return Array.from(this.themes.values()); },
    current() { return this._current; },
    register(id, meta) {
      if (!id) return false;
      this.themes.set(id, Object.assign({ id: id, label: id }, meta || {}));
      return true;
    },
    apply(id, root) {
      const target = root || document.getElementById('lock-screen');
      const name = this.themes.has(id) ? id : this.default;
      this._current = name;
      if (target) target.dataset.lockTheme = name;
      safeSessionSet(THEME_KEY, name);
      return name;
    },
    restore(root) { return this.apply(safeSessionGet(THEME_KEY) || this.default, root); }
  };
  window.LockTheme = LockTheme;

  const LockScreenV2 = {
    ownsLockScreen: true,
    ready: null,

    _mounted: false,
    _root: null,
    _listeners: [],
    _clockTimer: null,
    _avatarCache: Object.create(null),
    _accountCache: [],
    _settings: null,
    _audioContext: null,
    _protocolErrors: [],

    state: {
      phase: 'locked',
      selectedProfileId: null,
      usernameInput: '',
      passwordInput: '',
      errorCode: null,
      busy: false,
      mode: 'signin'
    },

    /* ── Lifecycle ─────────────────────────────────────────────── */

    async mount(root) {
      if (this._mounted) return;
      this._root = root || document.getElementById('lock-screen');
      if (!this._root) return;
      this._root.dataset.lockV2 = 'true';
      this._mounted = true;

      try {
        await (window.ProfileUI && window.ProfileUI.ready
          ? window.ProfileUI.ready
          : Promise.resolve());
        await this._loadSettings();
        await this._loadAvatars();
        this._ensureChrome();
        LockTheme.restore(this._root);
        this._bindEvents();
        this._applySettings();
        this._renderAccounts();
        this._mountWidgets();
        this._syncSettingsPanel();
        this._startClock();

        // A screen-locked session (Super+L) restores into SessionLock instead.
        const sessionLocked = Boolean(window.ProfileUI &&
          typeof window.ProfileUI.isSessionLocked === 'function' &&
          window.ProfileUI.isSessionLocked());
        if (!sessionLocked) this._startEnvironment();

        if (sessionLocked) {
          this.state.phase = 'transitioning';
        } else if (safeSessionGet(AUTO_ENTER_KEY) === '1') {
          // Re-enter after a profile switch performed by the login flow.
          safeSessionRemove(AUTO_ENTER_KEY);
          const active = window.ProfileService ? window.ProfileService.getActiveProfile() : null;
          if (active && window.ProfileService.isUnlocked(active.id)) {
            await this._enterDesktop(true);
          } else {
            this._startGlance();
          }
        } else {
          this._startGlance();
        }

        if (window.LockAccessibility && typeof window.LockAccessibility.init === 'function') {
          window.LockAccessibility.init();
        }
      } catch (error) {
        await this.cleanup();
        throw error;
      }
    },

    async cleanup() {
      this._stopClock();
      this._stopEnvironment();
      if (window.LockWidgets) window.LockWidgets.WidgetHost.unmount();
      if (window.LockAnimationController) window.LockAnimationController.stopAll();
      this._listeners.forEach((entry) => {
        try { entry.target.removeEventListener(entry.type, entry.handler, entry.options); } catch (_) {}
      });
      this._listeners = [];
      this._mounted = false;
      this._root = null;
    },

    _listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      this._listeners.push({ target: target, type: type, handler: handler, options: options });
    },

    _ensureChrome() {
      const root = this._root;
      if (!root) return;
      if (!root.querySelector('.lock-wallpaper')) {
        const wallpaper = el('div', 'lock-wallpaper');
        wallpaper.setAttribute('aria-hidden', 'true');
        wallpaper.appendChild(el('div', 'lock-wallpaper-glow'));
        wallpaper.appendChild(el('div', 'lock-wallpaper-grain'));
        root.insertBefore(wallpaper, root.firstChild);
      }
      if (!root.querySelector('.lock-unlock-hint')) {
        const hint = el('div', 'lock-unlock-hint');
        hint.setAttribute('aria-hidden', 'true');
        hint.appendChild(el('span', 'uh-chevron'));
        hint.appendChild(el('span', null, 'Click or press any key to sign in'));
        root.appendChild(hint);
      }
      if (!root.querySelector('.lock-statusbar')) {
        const status = el('div', 'lock-statusbar');
        const identity = el('span', 'lock-statusbar-identity', 'r3d1 OS');
        status.appendChild(identity);
        root.appendChild(status);
      }
    },

    /* ── Settings ──────────────────────────────────────────────── */

    async _loadSettings() {
      let state = null;
      const profile = window.ProfileService ? window.ProfileService.getActiveProfile() : null;
      if (profile && window.PersistenceService) {
        state = window.PersistenceService.getCachedState(profile.id);
        if (!state) {
          try { state = await window.PersistenceService.loadProfileState(profile.id); } catch (_) { state = null; }
        }
      }
      const loaded = state && state.lockScreen ? state.lockScreen : null;
      // validateState fills missing lockScreen fields without replacing saved values.
      const validated = window.PersistenceService
        ? window.PersistenceService.validateState(
            state ? Object.assign({}, state, { lockScreen: loaded }) : { lockScreen: loaded }
          ).lockScreen
        : defaultSettings();
      this._settings = validated;
    },

    getSettings() {
      return this._settings || defaultSettings();
    },

    _profileId() {
      const profile = window.ProfileService ? window.ProfileService.getActiveProfile() : null;
      return profile ? profile.id : null;
    },

    async saveLockScreen(partial) {
      const profileId = this._profileId();
      if (!profileId || !window.PersistenceService) return false;
      this._settings = Object.assign({}, this.getSettings());
      Object.keys(partial || {}).forEach((key) => {
        if (partial[key] && typeof partial[key] === 'object' && !Array.isArray(partial[key])) {
          this._settings[key] = Object.assign({}, this._settings[key] || {}, partial[key]);
        } else {
          this._settings[key] = partial[key];
        }
      });
      await window.PersistenceService.queueSave(profileId, { lockScreen: this._settings });
      if (window.SystemServices && window.SystemServices.events &&
          typeof window.SystemServices.events.emit === 'function') {
        try {
          window.SystemServices.events.emit('system:settings-changed', {
            key: 'lockScreen',
            value: JSON.parse(JSON.stringify(this._settings)),
            committed: true
          });
        } catch (_) { /* event bus is optional */ }
      }
      this._applySettings();
      return true;
    },

    _applySettings() {
      const settings = this.getSettings();
      if (window.LockAnimationController) {
        window.LockAnimationController.setIntensity(settings.animation.intensity);
        window.LockAnimationController.setReducedMotion(
          settings.animation.respectReducedMotion &&
          window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        );
      }
      if (window.LockWidgets) {
        window.LockWidgets.WidgetHost.refresh();
      }
      this._renderClock();
    },

    /* ── Accounts and avatars ──────────────────────────────────── */

    async _loadAvatars() {
      const profiles = window.ProfileService ? window.ProfileService.listPublicProfiles() : [];
      const active = this._profileId();
      for (const profile of profiles) {
        if (profile.id === active) continue;
        try {
          const state = await window.PersistenceService.loadProfileState(profile.id);
          this._avatarCache[profile.id] = state.lockScreen.avatar;
        } catch (_) {
          this._avatarCache[profile.id] = { kind: 'builtin', value: 'default-purple' };
        }
      }
      if (active) this._avatarCache[active] = this.getSettings().avatar;
    },

    visibleAccounts() {
      const settings = this.getSettings();
      const accounts = settings.accounts || {};
      const profiles = window.ProfileService ? window.ProfileService.listPublicProfiles() : [];
      return profiles.filter((profile) => {
        if (profile.type === 'owner') return accounts.showOwner !== false;
        if (profile.type === 'guest') return accounts.showGuest !== false;
        return false; // unknown/custom types are opt-in and hidden by default
      }).map((profile) => ({
        id: profile.id,
        username: profile.username,
        displayName: profile.name,
        type: profile.type,
        avatar: this._avatarCache[profile.id] || this.getSettings().avatar
      }));
    },

    _renderAccounts() {
      if (!this._root) return;
      const host = this._root.querySelector('#lock-accounts');
      if (!host) return;
      const accounts = this.visibleAccounts();
      this._accountCache = accounts;
      host.replaceChildren();

      accounts.forEach((account) => {
        const card = el('button', 'lock-account-card');
        card.type = 'button';
        card.dataset.profileId = account.id;
        card.setAttribute('role', 'listitem');
        card.setAttribute('aria-pressed',
          this.state.selectedProfileId === account.id ? 'true' : 'false');

        const ring = el('span', 'lock-account-avatar');
        const img = el('img');
        img.src = avatarSrc(account.avatar);
        img.alt = '';
        img.width = 44;
        img.height = 44;
        ring.appendChild(img);
        card.appendChild(ring);

        const text = el('span', 'lock-account-copy');
        text.appendChild(el('span', 'lock-account-name', account.displayName));
        card.appendChild(text);
        host.appendChild(card);
      });

      this._renderPrimaryAvatar();
    },

    _renderPrimaryAvatar() {
      if (!this._root) return;
      const selected = this.state.selectedProfileId;
      const account = this._accountCache.find((entry) => entry.id === selected) || this._accountCache[0];
      const avatar = account ? account.avatar : this.getSettings().avatar;
      const img = this._root.querySelector('#lock-avatar-img');
      if (img) {
        img.src = avatarSrc(avatar);
        img.alt = account ? account.displayName + ' profile picture' : 'Profile picture';
      }
      const heading = this._root.querySelector('#lock-user-heading');
      if (heading) heading.textContent = account ? account.displayName : 'Sign in';
    },

    getAvatarSrc(profileId) {
      return avatarSrc(this._avatarFor(profileId || this._profileId()));
    },

    _avatarFor(profileId) {
      if (profileId === this._profileId()) return this.getSettings().avatar;
      return this._avatarCache[profileId] || { kind: 'builtin', value: 'default-purple' };
    },

    async validateImageFile(file) {
      if (!file) throw new Error('AVATAR_INVALID');
      const allowed = ['image/png', 'image/jpeg', 'image/webp'];
      if (allowed.indexOf(String(file.type || '').toLowerCase()) === -1) {
        throw new Error('AVATAR_INVALID');
      }
      if (file.size > MAX_AVATAR_BYTES) throw new Error('AVATAR_TOO_LARGE');

      const objectUrl = URL.createObjectURL(file);
      try {
        const image = await new Promise((resolve, reject) => {
          const node = new Image();
          node.onload = () => resolve(node);
          node.onerror = () => reject(new Error('AVATAR_INVALID'));
          node.src = objectUrl;
        });
        if (!image.naturalWidth || !image.naturalHeight ||
            image.naturalWidth > MAX_AVATAR_DIMENSION ||
            image.naturalHeight > MAX_AVATAR_DIMENSION) {
          throw new Error('AVATAR_TOO_LARGE');
        }
        const size = Math.min(256, Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('AVATAR_INVALID');
        const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
        const drawWidth = Math.round(image.naturalWidth * scale);
        const drawHeight = Math.round(image.naturalHeight * scale);
        context.drawImage(image, Math.round((size - drawWidth) / 2), Math.round((size - drawHeight) / 2), drawWidth, drawHeight);
        const dataUrl = canvas.toDataURL('image/webp', 0.86);
        if (!/^data:image\/webp;base64,/.test(dataUrl) || dataUrl.length > AVATAR_STORAGE_LIMIT) {
          throw new Error('AVATAR_TOO_LARGE');
        }
        return dataUrl;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    },

    async setAvatar(profileId, input) {
      const profile = window.ProfileService ? window.ProfileService.getProfile(profileId) : null;
      if (!profile) throw new Error('PROFILE_NOT_FOUND');
      if (profileId !== this._profileId() && !window.ProfileService.isUnlocked(profileId)) {
        throw new Error('PROFILE_NOT_ACTIVE');
      }

      let avatar;
      if (input && input.kind === 'builtin') {
        if (BUILTIN_AVATARS.indexOf(input.value) === -1) throw new Error('INVALID_AVATAR');
        avatar = { kind: 'builtin', value: input.value };
      } else if (input && input.kind === 'custom') {
        if (input.file) {
          avatar = { kind: 'custom', value: await this.validateImageFile(input.file) };
        } else if (typeof input.value === 'string' &&
                   /^data:image\/(?:png|jpeg|webp);base64,/i.test(input.value) &&
                   input.value.length <= AVATAR_STORAGE_LIMIT) {
          avatar = { kind: 'custom', value: input.value };
        } else {
          throw new Error('INVALID_AVATAR');
        }
      } else {
        throw new Error('INVALID_AVATAR_TYPE');
      }

      if (profileId === this._profileId()) {
        const next = Object.assign({}, this.getSettings(), { avatar: avatar });
        await this.saveLockScreen({ avatar: avatar });
        this._avatarCache[profileId] = avatar;
        this._settings = next;
      } else {
        const state = window.PersistenceService.getCachedState(profileId) ||
          await window.PersistenceService.loadProfileState(profileId);
        const lockScreen = Object.assign({}, state.lockScreen || this.getSettings(), { avatar: avatar });
        await window.PersistenceService.queueSave(profileId, { lockScreen: lockScreen });
        this._avatarCache[profileId] = avatar;
      }

      this._renderAccounts();
      this._syncSettingsPanel();
      try {
        document.dispatchEvent(new CustomEvent('profile:avatar-changed', {
          detail: { profileId: profileId, avatar: avatar }
        }));
      } catch (_) { /* event is optional */ }
      return avatar;
    },

    /* ── Clock and environment ─────────────────────────────────── */

    _startClock() {
      this._stopClock();
      this._renderClock();
      this._clockTimer = window.setInterval(() => this._renderClock(), 1000);
    },

    _stopClock() {
      if (this._clockTimer) window.clearInterval(this._clockTimer);
      this._clockTimer = null;
    },

    _renderClock() {
      if (!this._root) return;
      const settings = this.getSettings().clock || {};
      const clock = this._root.querySelector('#lock-clock');
      const date = this._root.querySelector('#lock-date');
      if (clock) {
        clock.hidden = settings.enabled === false;
        const now = new Date();
        const options = {
          hour: '2-digit',
          minute: '2-digit',
          hour12: settings.format === '12h'
        };
        if (settings.showSeconds) options.second = '2-digit';
        clock.textContent = now.toLocaleTimeString('en-US', options);
      }
      if (date) {
        date.hidden = settings.showDate === false;
        date.textContent = new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric'
        });
      }
    },

    _startEnvironment() {
      if (!window.LockAnimationController || !this._root) return;
      const animation = this.getSettings().animation || {};
      window.LockAnimationController.startEnvironment(this._root, {
        particles: animation.particles !== false,
        parallax: animation.parallax !== false,
        respectReducedMotion: animation.respectReducedMotion !== false
      });
    },

    _stopEnvironment() {
      if (window.LockAnimationController) window.LockAnimationController.stopEnvironment();
    },

    _mountWidgets() {
      if (!window.LockWidgets || !this._root) return;
      const host = this._root.querySelector('#lock-widgets');
      if (!host) return;
      window.LockWidgets.WidgetHost.mount(host, {
        getSettings: () => this.getSettings(),
        getProfile: () => {
          const profile = window.ProfileService ? window.ProfileService.getActiveProfile() : null;
          if (!profile) return null;
          const account = this._accountCache.find((entry) => entry.id === profile.id);
          return {
            id: profile.id,
            displayName: account ? account.displayName : profile.name
          };
        },
        reportError: (error, id) => this._reportError(error, 'widget:' + id)
      });
    },

    _reportError(error, operation) {
      const sanitized = {
        operation: operation,
        code: error && error.code ? error.code : 'ERROR',
        message: error && error.message ? String(error.message).slice(0, 240) : 'Unknown error',
        at: Date.now()
      };
      this._protocolErrors.push(sanitized);
      if (this._protocolErrors.length > MAX_ERRORS) this._protocolErrors.shift();
      console.warn('[LockScreenV2] ' + operation + ' failed', sanitized.message);
    },

    /* ── UI events ─────────────────────────────────────────────── */

    _bindEvents() {
      if (!this._root) return;
      const root = this._root;

      this._listen(root, 'pointerdown', () => {
        if (this.state.phase === 'glance') this._dismissGlance();
      });
      this._listen(root, 'wheel', () => {
        if (this.state.phase === 'glance') this._dismissGlance();
      }, { passive: true });
      this._listen(window, 'keydown', (event) => {
        if (this.state.phase === 'glance' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          this._dismissGlance();
        }
      });

      this._listen(root, 'click', (event) => {
        const target = event.target;
        if (!target || !target.closest) return;

        const account = target.closest('.lock-account-card');
        if (account) {
          event.preventDefault();
          this.selectProfile(account.dataset.profileId);
          return;
        }

        const action = target.closest('[data-lock-action]');
        if (!action) return;
        const name = action.dataset.lockAction;
        if (name === 'custom') {
          event.preventDefault();
          this.useCustomUsername();
        } else if (name === 'back') {
          event.preventDefault();
          this._backToAccounts();
        } else if (name === 'settings') {
          event.preventDefault();
          this._toggleSettings();
        } else if (name === 'close-settings') {
          event.preventDefault();
          this._toggleSettings(false);
        } else if (name === 'avatar-preset') {
          event.preventDefault();
          this.setAvatar(this._profileId(), {
            kind: 'builtin',
            value: action.dataset.avatar
          }).catch((error) => {
            this._showError(error.message === 'PROFILE_NOT_ACTIVE'
              ? 'Sign in to change this account picture.'
              : messageFor(error.message));
          });
        } else if (name === 'logout') {
          event.preventDefault();
          this.logout();
        }
      });

      this._listen(root, 'submit', (event) => {
        if (event.target && event.target.id === 'lock-credentials-form') {
          event.preventDefault();
          this.submitLogin();
        }
      });

      this._listen(root, 'change', (event) => {
        const target = event.target;
        if (!target) return;
        if (target.id === 'lock-avatar-file') {
          const file = target.files && target.files[0];
          target.value = '';
          if (!file) return;
          this.setAvatar(this._profileId(), { kind: 'custom', file: file })
            .catch((error) => {
              this._showError(messageFor(error.message));
              this._playAnimation('login-error');
            });
          return;
        }
        if (target.dataset && target.dataset.lockThemeChoice) {
          LockTheme.apply(target.value, this._root);
          return;
        }
        if (target.closest('.lock-settings-panel')) {
          this._onSettingChanged(target);
        }
      });

      this._listen(root, 'keydown', (event) => {
        if (event.key === 'Escape') {
          const panel = root.querySelector('#lock-settings-panel');
          if (panel && !panel.hidden) {
            event.preventDefault();
            this._toggleSettings(false);
          } else if (this.state.phase === 'entering-credentials') {
            event.preventDefault();
            this._backToAccounts();
          } else if (this.state.phase === 'selecting-account') {
            event.preventDefault();
            this._startGlance();
          }
        }
      });

      this._listen(document, 'profile:identity-changed', () => {
        this._renderAccounts();
      });
    },

    _toggleSettings(force) {
      if (!this._root) return;
      const panel = this._root.querySelector('#lock-settings-panel');
      if (!panel) return;
      const next = typeof force === 'boolean' ? force : panel.hidden;
      panel.hidden = !next;
      this._root.querySelectorAll('[data-lock-action="settings"]').forEach((button) => {
        button.setAttribute('aria-expanded', next ? 'true' : 'false');
      });
      if (next) {
        this._syncSettingsPanel();
        this._playAnimation('panel-open');
        const first = panel.querySelector('input, select, button');
        if (first) first.focus({ preventScroll: true });
      }
    },

    _onSettingChanged(target) {
      const setting = target.dataset.lockSetting;
      if (!setting) return;
      const value = target.type === 'checkbox' ? target.checked : target.value;
      const parts = setting.split('.');
      const partial = {};
      let cursor = partial;
      parts.forEach((part, index) => {
        if (index === parts.length - 1) cursor[part] = value;
        else { cursor[part] = {}; cursor = cursor[part]; }
      });

      if (setting === 'profile.displayName' || setting === 'profile.username') {
        const profile = window.ProfileService.getActiveProfile();
        if (!profile) return;
        window.ProfileService.updateIdentity(profile.id, {
          displayName: setting === 'profile.displayName' ? value : profile.name,
          username: setting === 'profile.username' ? value : profile.username
        }).then(() => {
          this._renderAccounts();
          this._syncSettingsPanel();
          this._showError('');
        }).catch((error) => {
          this._showError(error.code === 'USERNAME_TAKEN'
            ? 'That username is already in use.'
            : (error.message || 'Could not update the profile.'));
        });
        return;
      }

      this.saveLockScreen(partial).then(() => {
        if (setting.indexOf('widgets') === 0) this._mountWidgets();
        if (setting === 'animation.intensity' ||
            setting === 'animation.parallax' ||
            setting === 'animation.particles') {
          this._startEnvironment();
        }
        this._renderAccounts();
      }).catch((error) => this._reportError(error, 'settings'));
    },

    _renderAvatarPresets(panel) {
      const host = panel.querySelector('#lock-avatar-presets');
      if (!host || host.childElementCount) return;
      BUILTIN_AVATARS.forEach((key) => {
        const button = el('button', null);
        button.type = 'button';
        button.dataset.lockAction = 'avatar-preset';
        button.dataset.avatar = key;
        button.title = key.replace(/-/g, ' ');
        button.setAttribute('aria-label', 'Use ' + button.title + ' avatar');
        const img = el('img');
        img.src = builtinAvatar(key);
        img.alt = '';
        img.width = 28;
        img.height = 28;
        button.appendChild(img);
        host.appendChild(button);
      });
    },

    _renderThemePicker(panel) {
      let row = panel.querySelector('#lock-theme-row');
      if (!row) {
        const section = panel.querySelector('.lock-settings-section');
        if (!section) return;
        row = el('label', 'lock-setting-row');
        row.id = 'lock-theme-row';
        row.appendChild(el('span', null, 'Appearance'));
        const select = document.createElement('select');
        select.dataset.lockThemeChoice = 'true';
        LockTheme.list().forEach((theme) => {
          const option = document.createElement('option');
          option.value = theme.id;
          option.textContent = theme.label;
          select.appendChild(option);
        });
        row.appendChild(select);
        section.appendChild(row);
      }
      const select = row.querySelector('select');
      if (select) select.value = LockTheme.current();
    },

    _syncSettingsPanel() {
      if (!this._root) return;
      const panel = this._root.querySelector('#lock-settings-panel');
      if (!panel) return;
      this._renderAvatarPresets(panel);
      this._renderThemePicker(panel);
      const settings = this.getSettings();
      panel.querySelectorAll('[data-lock-setting]').forEach((input) => {
        const path = input.dataset.lockSetting.split('.');
        let value = settings;
        for (let i = 0; i < path.length; i += 1) value = value ? value[path[i]] : undefined;
        if (input.type === 'checkbox') input.checked = Boolean(value);
        else if (value != null) input.value = value;
      });

      const profile = window.ProfileService ? window.ProfileService.getActiveProfile() : null;
      const nameInput = panel.querySelector('[data-lock-setting="profile.displayName"]');
      const userInput = panel.querySelector('[data-lock-setting="profile.username"]');
      if (nameInput && profile) nameInput.value = profile.name || '';
      if (userInput && profile) userInput.value = profile.username || '';

      const guestNote = panel.querySelector('#lock-profile-note');
      if (guestNote) {
        guestNote.textContent = profile
          ? 'Editing the active profile (' + profile.name + '). Changes are saved to this profile only.'
          : 'No active profile is available.';
      }

      panel.querySelectorAll('[data-avatar]').forEach((button) => {
        const avatar = this._avatarFor(this._profileId());
        button.setAttribute('aria-pressed',
          avatar && avatar.kind === 'builtin' && avatar.value === button.dataset.avatar ? 'true' : 'false');
      });

      const preview = panel.querySelector('#lock-avatar-preview');
      if (preview) preview.src = avatarSrc(this._avatarFor(this._profileId()));
    },

    /* ── Account selection and login ───────────────────────────── */

    show() {
      if (!this._root) return;
      this.state.busy = false;
      this.state.phase = 'selecting-account';
      this.state.passwordInput = '';
      this.state.errorCode = null;
      this._clearCredentials();
      this._setFormVisible(false);
      this._renderAccounts();
      this._startEnvironment();
      this._mountWidgets();
      if (window.LockAnimationController) window.LockAnimationController.stopAll();
      if (window.ProfileUI && typeof window.ProfileUI._setLocked === 'function') {
        window.ProfileUI._setLocked(true);
      } else {
        this._root.classList.remove('is-unlocked');
        document.documentElement.classList.add('profile-locked');
      }
      this._startGlance();
    },

    requestUnlock() {
      this.show();
      this._dismissGlance();
      const selected = this.state.selectedProfileId;
      if (selected) this.selectProfile(selected);
      else this._focusFirstAccount();
    },

    _startGlance() {
      if (!this._root) return;
      this.state.phase = 'glance';
      this._root.classList.add('is-glance');
      this._setFormVisible(false);
      this._playAnimation('wake');
    },

    _dismissGlance() {
      if (!this._root || this.state.phase !== 'glance') return;
      this._root.classList.remove('is-glance');
      const accounts = this.visibleAccounts();
      const first = accounts[0];
      if (first) {
        this.selectProfile(first.id);
      } else {
        this.state.phase = 'selecting-account';
        this._setFormVisible(false);
        this._renderAccounts();
        this._focusFirstAccount();
      }
      this._playAnimation('glance-to-login');
    },

    focusSignIn() {
      this.requestUnlock();
    },

    selectProfile(profileId) {
      const account = this._accountCache.find((entry) => entry.id === profileId);
      if (!account) return;
      const profile = window.ProfileService.getProfile(profileId);
      if (!profile) return;
      this.state.selectedProfileId = profileId;
      this.state.usernameInput = profile.username;
      this.state.passwordInput = '';
      this.state.errorCode = null;
      this.state.mode = 'signin';
      this.state.phase = 'entering-credentials';
      this._renderAccounts();
      this._setFormVisible(true, profile);
      this._playAnimation('account-select');
      this._focusPassword();
    },

    useCustomUsername() {
      this.state.selectedProfileId = null;
      this.state.usernameInput = '';
      this.state.passwordInput = '';
      this.state.errorCode = null;
      this.state.mode = 'signin';
      this.state.phase = 'entering-credentials';
      this._renderAccounts();
      this._setFormVisible(true, null);
      this._playAnimation('custom-login-open');
      this._focusUsername();
    },

    _setFormVisible(visible, profile) {
      if (!this._root) return;
      const form = this._root.querySelector('#lock-credentials-form');
      const accounts = this._root.querySelector('#lock-accounts');
      const custom = this._root.querySelector('[data-lock-action="custom"]');
      const hint = this._root.querySelector('.lock-hint');
      const confirm = this._root.querySelector('#lock-password-confirm-wrap');
      const title = this._root.querySelector('#lock-credentials-title');
      const guestNote = this._root.querySelector('#lock-guest-note');
      const userField = this._root.querySelector('#lock-user-field');
      const signinBtn = this._root.querySelector('#lock-signin-btn');
      if (form) form.hidden = !visible;
      // Note: We keep #lock-accounts and custom visible in the bottom-left switcher!
      if (!visible) return;

      const username = this._root.querySelector('#lock-username');
      const password = this._root.querySelector('#lock-password');
      const selected = profile || this._accountCache.find((entry) => entry.id === this.state.selectedProfileId);
      if (username) username.value = selected ? selected.username : '';
      if (password) password.value = '';

      const isCustom = !selected || selected.id === 'custom' || !this.state.selectedProfileId;
      if (userField) userField.hidden = !isCustom;

      const isGuest = selected && selected.type === 'guest';
      const ownerNoPassword = profile && profile.type === 'owner' &&
        window.ProfileService && !window.ProfileService.hasOwnerPassword();
      this.state.mode = ownerNoPassword ? 'setup' : 'signin';
      if (confirm) confirm.hidden = !ownerNoPassword;

      const passField = this._root.querySelector('#lock-password-field');
      if (passField) passField.hidden = isGuest;
      if (signinBtn) {
        signinBtn.textContent = isGuest ? 'Sign in' : '→';
        signinBtn.title = 'Sign in';
        if (isGuest) {
          signinBtn.classList.add('guest-btn');
        } else {
          signinBtn.classList.remove('guest-btn');
        }
      }

      this._renderPrimaryAvatar();
      this._showError('');
    },

    _backToAccounts() {
      this.state.phase = 'selecting-account';
      this.state.selectedProfileId = null;
      this.state.usernameInput = '';
      this.state.passwordInput = '';
      this.state.errorCode = null;
      this.state.busy = false;
      this._clearCredentials();
      this._setFormVisible(false);
      this._renderAccounts();
      this._focusFirstAccount();
    },

    _clearCredentials() {
      const password = this._root && this._root.querySelector('#lock-password');
      const confirm = this._root && this._root.querySelector('#lock-password-confirm');
      if (password) password.value = '';
      if (confirm) confirm.value = '';
    },

    _focusUsername() {
      const input = this._root && this._root.querySelector('#lock-username');
      if (input) input.focus({ preventScroll: true });
    },

    _focusPassword() {
      const input = this._root && this._root.querySelector('#lock-password');
      if (input) input.focus({ preventScroll: true });
    },

    _focusFirstAccount() {
      const card = this._root && this._root.querySelector('.lock-account-card');
      if (card) card.focus({ preventScroll: true });
    },

    showError(code) {
      this._showError(code ? messageFor(code) : '');
    },

    _showError(text) {
      if (!this._root) return;
      const node = this._root.querySelector('#lock-error');
      if (!node) return;
      node.textContent = text || '';
      node.hidden = !text;
      this.state.errorCode = text || null;
      if (text) {
        const form = this._root.querySelector('#lock-credentials-form');
        if (form) form.setAttribute('aria-invalid', 'true');
        const password = this._root.querySelector('#lock-password');
        if (password) password.select();
      } else {
        const form = this._root.querySelector('#lock-credentials-form');
        if (form) form.removeAttribute('aria-invalid');
      }
    },

    async submitLogin() {
      if (this.state.busy) return;
      const root = this._root;
      const usernameInput = root && root.querySelector('#lock-username');
      const passwordInput = root && root.querySelector('#lock-password');
      const confirmInput = root && root.querySelector('#lock-password-confirm');
      const username = String(usernameInput ? usernameInput.value : '').trim();
      const password = String(passwordInput ? passwordInput.value : '');

      if (!username) {
        this.state.errorCode = 'MISSING_USERNAME';
        this._showError(messageFor('MISSING_USERNAME'));
        this._playAnimation('login-error');
        if (usernameInput) usernameInput.focus();
        return;
      }

      if (this.state.mode === 'setup') {
        if (!password) {
          this._showError('Choose an owner password to continue.');
          return;
        }
        if (confirmInput && password !== confirmInput.value) {
          this._showError('Passwords do not match.');
          return;
        }
      }

      this.state.busy = true;
      this.state.phase = 'authenticating';
      this.state.passwordInput = password;
      this._setBusy(true);

      try {
        let result;
        if (this.state.mode === 'setup') {
          try {
            await window.ProfileService.setOwnerPassword(password);
          } catch (error) {
            this._showError(error.code === 'PASSWORD_TOO_SHORT'
              ? 'Owner password must be at least 4 characters.'
              : 'Could not create the owner password.');
            this.state.phase = 'error';
            this._playAnimation('login-error');
            return;
          }
          result = await window.ProfileService.authenticate({ username: username, password: password });
        } else {
          result = await window.ProfileService.authenticate({ username: username, password: password });
        }

        if (!result || !result.ok) {
          this.state.phase = 'error';
          this._showError(messageFor('INVALID_CREDENTIALS'));
          this._playAnimation('login-error');
          this._playCue('error');
          return;
        }

        const profile = await window.ProfileService.getProfile(result.profileId);
        if (!profile || profile.status === 'disabled') {
          this.state.phase = 'error';
          this._showError(messageFor('PROFILE_UNAVAILABLE'));
          this._playAnimation('login-error');
          return;
        }

        this.state.phase = 'transitioning';
        this._playCue('success');

        const active = window.ProfileService.getActiveProfile();
        if (active && active.id === profile.id) {
          await this._enterDesktop(false);
        } else {
          // Session manager activation is the existing ProfileService reload
          // path. The flag lets the next boot reveal the desktop exactly once.
          safeSessionSet(AUTO_ENTER_KEY, '1');
          await window.ProfileService.setActiveProfile(profile.id);
        }
      } catch (error) {
        this._reportError(error, 'login');
        this.state.phase = 'error';
        this._showError(messageFor('LOGIN_UNAVAILABLE'));
        this._playAnimation('login-error');
      } finally {
        this.state.busy = false;
        this.state.passwordInput = '';
        this._clearCredentials();
        this._setBusy(false);
      }
    },

    _setBusy(busy) {
      if (!this._root) return;
      const form = this._root.querySelector('#lock-credentials-form');
      if (!form) return;
      form.setAttribute('aria-busy', busy ? 'true' : 'false');
      form.querySelectorAll('button, input').forEach((node) => {
        if (node.dataset.lockAction === 'back') node.disabled = busy;
        else if (node.type !== 'button' && node.tagName !== 'BUTTON') node.readOnly = busy;
        else node.disabled = busy;
      });
      const status = this._root.querySelector('#lock-status');
      if (status) status.textContent = busy ? 'AUTHENTICATING…' : '';
    },

    async _enterDesktop(fromReload) {
      this.state.phase = 'transitioning';
      this._playAnimation('desktop-reveal');
      await new Promise((resolve) => window.setTimeout(resolve, fromReload ? 40 : 260));
      if (window.ProfileUI && typeof window.ProfileUI._setLocked === 'function') {
        window.ProfileUI._setLocked(false);
      } else if (this._root) {
        this._root.classList.add('is-unlocked');
        this._root.setAttribute('aria-hidden', 'true');
        document.documentElement.classList.remove('profile-locked');
      }
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      if (window.LockAnimationController) window.LockAnimationController.stopAll();
      this._stopEnvironment();
      this.state.phase = 'locked';
      this.state.passwordInput = '';
      this.state.selectedProfileId = null;
      this._clearCredentials();
      this._showError('');
    },

    async lock() {
      if (window.ProfileWindowState && typeof window.ProfileWindowState.flushActive === 'function') {
        try { await window.ProfileWindowState.flushActive(); } catch (_) { /* reported elsewhere */ }
      }
      const profile = window.ProfileService ? window.ProfileService.getActiveProfile() : null;
      if (profile && window.ProfileService) window.ProfileService.lock(profile.id);
      if (window.LockAnimationController) window.LockAnimationController.stopAll();
      this.show();
      this._syncSettingsPanel();
    },

    lockSession() {
      this.lock();
    },

    async logout() {
      const profile = window.ProfileService ? window.ProfileService.getActiveProfile() : null;
      if (window.LockAnimationController) window.LockAnimationController.stopAll();
      this._stopEnvironment();
      if (!profile) {
        this.show();
        return;
      }
      if (profile.type === 'guest') {
        this.lock();
        return;
      }
      window.ProfileService.lock(profile.id);
      safeSessionRemove(AUTO_ENTER_KEY);
      try {
        await window.ProfileService.setActiveProfile('guest');
      } catch (error) {
        this._reportError(error, 'logout');
        this.show();
      }
    },

    _playAnimation(name) {
      if (window.LockAnimationController) window.LockAnimationController.play(name);
    },

    _playCue(kind) {
      const audio = this.getSettings().audio || {};
      if (!audio.enabled || audio.effectsEnabled === false) return;
      try {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        if (!this._audioContext) this._audioContext = new Context();
        const context = this._audioContext;
        if (context.state === 'suspended' && context.resume) context.resume();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const now = context.currentTime;
        oscillator.type = kind === 'error' ? 'square' : 'triangle';
        oscillator.frequency.setValueAtTime(kind === 'error' ? 180 : 523.25, now);
        if (kind === 'success') oscillator.frequency.exponentialRampToValueAtTime(783.99, now + 0.16);
        gain.gain.setValueAtTime(Math.max(0, Math.min(1, audio.volume == null ? 0.25 : audio.volume)) * 0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.3);
      } catch (_) { /* audio is optional */ }
    },

    /* ── Diagnostics ───────────────────────────────────────────── */

    diagnostics() {
      return {
        mounted: this._mounted,
        phase: this.state.phase,
        busy: this.state.busy,
        selectedProfileId: this.state.selectedProfileId,
        visibleAccounts: this._accountCache.map((entry) => entry.id),
        settings: JSON.parse(JSON.stringify(this.getSettings())),
        animations: window.LockAnimationController
          ? window.LockAnimationController.diagnostics() : null,
        widgets: window.LockWidgets ? window.LockWidgets.WidgetHost.diagnostics() : null,
        secretEvents: window.LockSecretEvents ? window.LockSecretEvents.diagnostics() : null,
        errors: this._protocolErrors.slice()
      };
    }
  };

  // Expose the trusted preset list and helpers for settings/testing without
  // exposing any hidden account data.
  LockScreenV2.BUILTIN_AVATARS = BUILTIN_AVATARS.slice();
  LockScreenV2.avatarSrc = avatarSrc;
  LockScreenV2.builtinAvatar = builtinAvatar;

  window.LockScreenV2 = LockScreenV2;

  function boot() {
    const root = document.getElementById('lock-screen');
    if (!root) return;
    LockScreenV2.ready = LockScreenV2.mount(root).catch((error) => {
      console.error('[LockScreenV2] Mount failed', error);
      LockScreenV2._reportError(error, 'mount');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : { addEventListener: function () {} });
