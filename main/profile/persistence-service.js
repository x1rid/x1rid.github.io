/**
 * @file main/profile/persistence-service.js
 * @description Validated, debounced persistence for per-profile simulator state.
 * File contents are never stored here; the VFS remains authoritative.
 *
 * PUBLIC API (window.PersistenceService)
 *   await loadProfileState(profileId)             → validated state
 *   await saveProfileState(profileId, state)      → resolves after the write commits
 *   queueSave(profileId, partialState)            → debounced write, returns promise
 *   await flush(profileId)                        → commit pending writes now
 *   await resetProfileState(profileId)            → resets settings only (never files)
 *   collectState()                                → snapshot current shell preferences
 *   applyState(profileId, state)                  → apply to localStorage + DOM
 *   bindAutoSave(profileId)                       → wire shell change sources
 *   getCachedState(profileId)                     → last validated snapshot
 *
 * EVENTS (dispatched on `document`)
 *   profile:state-loaded { profileId, state }
 *   profile:state-saved  { profileId, updatedAt, revision }
 *   profile:state-error  { profileId, operation, error }
 */

(function (window, document) {
  'use strict';

  const STATE_VERSION = 1;
  const DEBOUNCE_MS = 700;

  const LOCAL_KEYS = {
    musicVolume: 'desktopShellMusicVolume',
    clippyVisible: 'r3d1bruh.desktop.clippy.visible',
    cursorScheme: 'retroCursorScheme',
    soundEnabled: 'retroSfxEnabled',
    theme: 'desktopTheme'
  };

  function defaultState() {
    return {
      schemaVersion: STATE_VERSION,
      desktop: {
        wallpaper: 'live',
        wallpaperPaused: false,
        iconsVisible: true
      },
      settings: {
        theme: 'plum',
        musicVolume: 45,
        clippyVisible: true,
        cursorScheme: 'ghost',
        soundEnabled: true
      },
      apps: {
        lastExplorerFolder: null
      },
      windows: {}
    };
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function clampNumber(value, min, max, fallback) {
    const number = typeof value === 'number' ? value : Number(value);
    if (!isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function asBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (value === '1' || value === 'true') return true;
    if (value === '0' || value === 'false') return false;
    return fallback;
  }

  function asSafeString(value, max, fallback) {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > max) return fallback;
    return trimmed;
  }

  function validateState(raw) {
    const base = defaultState();
    if (!isPlainObject(raw)) return base;

    const sourceVersion = Number(raw.schemaVersion);
    if (Number.isFinite(sourceVersion) && sourceVersion > STATE_VERSION) {
      console.warn('[PersistenceService] State version ' + sourceVersion +
        ' is newer than supported ' + STATE_VERSION + '; keeping known fields only.');
    }

    const desktop = isPlainObject(raw.desktop) ? raw.desktop : {};
    base.desktop.wallpaper = asSafeString(desktop.wallpaper, 64, base.desktop.wallpaper);
    base.desktop.wallpaperPaused = asBoolean(desktop.wallpaperPaused, base.desktop.wallpaperPaused);
    base.desktop.iconsVisible = asBoolean(desktop.iconsVisible, base.desktop.iconsVisible);

    const settings = isPlainObject(raw.settings) ? raw.settings : {};
    base.settings.theme = asSafeString(settings.theme, 32, base.settings.theme);
    base.settings.musicVolume = Math.round(
      clampNumber(settings.musicVolume, 0, 100, base.settings.musicVolume)
    );
    base.settings.clippyVisible = asBoolean(settings.clippyVisible, base.settings.clippyVisible);
    base.settings.cursorScheme = asSafeString(settings.cursorScheme, 24, base.settings.cursorScheme);
    base.settings.soundEnabled = asBoolean(settings.soundEnabled, base.settings.soundEnabled);

    const apps = isPlainObject(raw.apps) ? raw.apps : {};
    base.apps.lastExplorerFolder = typeof apps.lastExplorerFolder === 'string' &&
      apps.lastExplorerFolder.length <= 128 &&
      apps.lastExplorerFolder.indexOf('__') !== 0
      ? apps.lastExplorerFolder
      : null;

    // Window geometry is accepted as a shallow, JSON-safe record only.
    if (isPlainObject(raw.windows)) {
      const windows = {};
      Object.keys(raw.windows).slice(0, 32).forEach(function (key) {
        if (key.length > 64) return;
        const value = raw.windows[key];
        if (!isPlainObject(value)) return;
        windows[key] = {
          left: clampNumber(value.left, -10000, 100000, 0),
          top: clampNumber(value.top, -10000, 100000, 0),
          width: clampNumber(value.width, 120, 10000, 640),
          height: clampNumber(value.height, 80, 10000, 420)
        };
      });
      base.windows = windows;
    }

    return base;
  }

  function mergeState(target, partial) {
    if (!isPlainObject(partial)) return target;
    ['desktop', 'settings', 'apps', 'windows'].forEach(function (section) {
      if (!isPlainObject(partial[section])) return;
      target[section] = Object.assign({}, target[section], partial[section]);
    });
    return target;
  }

  function safeLocalGet(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeLocalSet(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
      return true;
    } catch (err) {
      console.warn('[PersistenceService] localStorage write failed for ' + key, err);
      return false;
    }
  }

  function safeSessionGet(key) {
    try { return window.sessionStorage.getItem(key); } catch (_) { return null; }
  }

  function safeSessionSet(key, value) {
    try {
      window.sessionStorage.setItem(key, String(value));
      return true;
    } catch (err) {
      console.warn('[PersistenceService] sessionStorage write failed for ' + key, err);
      return false;
    }
  }

  const PersistenceService = {
    _db: null,
    _cache: Object.create(null),
    _revisions: Object.create(null),
    _timers: Object.create(null),
    _chains: Object.create(null),
    _bound: Object.create(null),
    _waiters: Object.create(null),
    _unsubscribeVfs: null,

    _settleWaiters(profileId, error, value) {
      const waiters = this._waiters[profileId];
      if (!waiters || !waiters.length) return;
      this._waiters[profileId] = [];
      waiters.forEach(function (waiter) {
        if (error) waiter.reject(error);
        else waiter.resolve(value);
      });
    },

    async _getDb() {
      if (!this._db) {
        this._db = new window.ProfileDB();
        await this._db.init();
      }
      return this._db;
    },

    _assertProfile(profileId) {
      if (!profileId || typeof profileId !== 'string') {
        throw new Error('Invalid profile id');
      }
      if (!window.ProfileService) {
        throw new Error('ProfileService is not available');
      }
      const profile = window.ProfileService.getProfile(profileId);
      if (!profile) {
        throw new Error('Unknown profile id: ' + profileId);
      }
      if (profile.type !== 'guest' && profile.type !== 'owner') {
        throw new Error('Invalid profile type: ' + profile.type);
      }
      return profile;
    },

    _report(profileId, operation, error) {
      const detail = {
        profileId: profileId || null,
        operation: operation,
        error: error && error.message ? error.message : String(error)
      };
      console.error('[PersistenceService] ' + operation + ' failed', error);
      try {
        document.dispatchEvent(new CustomEvent('profile:state-error', { detail: detail }));
      } catch (_) { /* CustomEvent is available in supported browsers */ }
      if (typeof window.toast === 'function') {
        const quota = error && error.name === 'QuotaExceededError';
        window.toast(quota ? 'PROFILE STORAGE FULL' : 'PROFILE SAVE FAILED', 2600);
      }
    },

    async loadProfileState(profileId) {
      try {
        this._assertProfile(profileId);
        const db = await this._getDb();
        const record = await db.getState(profileId);
        const state = validateState(record ? record.data : null);
        this._cache[profileId] = state;
        if (!this._revisions[profileId]) this._revisions[profileId] = 0;
        try {
          document.dispatchEvent(new CustomEvent('profile:state-loaded', {
            detail: { profileId: profileId, state: clone(state), restored: Boolean(record) }
          }));
        } catch (_) { /* ignore */ }
        return clone(state);
      } catch (error) {
        this._report(profileId, 'load', error);
        const fallback = defaultState();
        this._cache[profileId] = fallback;
        return clone(fallback);
      }
    },

    /**
     * Persist the full state object. Resolves only after the transaction
     * commits. Rejects on validation or storage failure.
     */
    async saveProfileState(profileId, state) {
      this._assertProfile(profileId);
      const validated = validateState(state);
      this._cache[profileId] = validated;
      const committed = await this._commit(profileId);
      // Keep the DOM/localStorage mirrors in sync so a later collectState()
      // cannot silently clobber what the caller just saved.
      this.applyState(profileId, committed);
      return committed;
    },

    async _commit(profileId) {
      this._assertProfile(profileId);
      // Serialize writes per profile; each commit snapshots at execution time
      // so an older queued write can never clobber a newer snapshot.
      const previous = this._chains[profileId] || Promise.resolve();
      const next = previous.catch(function () { /* keep the chain alive */ }).then(async () => {
        const snapshot = clone(this._cache[profileId] || defaultState());
        const revision = (this._revisions[profileId] || 0) + 1;
        this._revisions[profileId] = revision;
        const db = await this._getDb();
        const updatedAt = Date.now();
        await db.putState({
          profileId: profileId,
          schemaVersion: STATE_VERSION,
          revision: revision,
          updatedAt: updatedAt,
          data: snapshot
        });
        try {
          document.dispatchEvent(new CustomEvent('profile:state-saved', {
            detail: { profileId: profileId, updatedAt: updatedAt, revision: revision }
          }));
        } catch (_) { /* ignore */ }
        return snapshot;
      });
      this._chains[profileId] = next;
      try {
        const snapshot = await next;
        this._settleWaiters(profileId, null, snapshot);
        return snapshot;
      } catch (error) {
        this._report(profileId, 'save', error);
        this._settleWaiters(profileId, error);
        throw error;
      } finally {
        if (this._chains[profileId] === next) this._chains[profileId] = null;
      }
    },

    queueSave(profileId, partialState) {
      try {
        this._assertProfile(profileId);
      } catch (error) {
        this._report(profileId, 'queue', error);
        return Promise.reject(error);
      }

      const current = this._cache[profileId] || defaultState();
      mergeState(current, partialState);
      this._cache[profileId] = validateState(current);

      if (this._timers[profileId]) {
        window.clearTimeout(this._timers[profileId]);
      }

      return new Promise((resolve, reject) => {
        if (!this._waiters[profileId]) this._waiters[profileId] = [];
        this._waiters[profileId].push({ resolve: resolve, reject: reject });
        this._timers[profileId] = window.setTimeout(() => {
          this._timers[profileId] = null;
          this._commit(profileId).catch(function () { /* reported in _commit */ });
        }, DEBOUNCE_MS);
      });
    },

    async flush(profileId) {
      const hadTimer = Boolean(this._timers[profileId]);
      if (hadTimer) {
        window.clearTimeout(this._timers[profileId]);
        this._timers[profileId] = null;
      }
      const hasPending = Boolean(this._waiters[profileId] && this._waiters[profileId].length);

      // A debounce timer or an unsettled queueSave means the in-memory cache is
      // newer than any in-flight write: commit it (chained behind that write).
      if (hadTimer || hasPending) {
        return this._commit(profileId);
      }
      if (this._chains[profileId]) {
        return this._chains[profileId];
      }
      return this._cache[profileId] || defaultState();
    },

    async resetProfileState(profileId) {
      this._assertProfile(profileId);
      const defaults = defaultState();
      this._cache[profileId] = defaults;
      if (this._timers[profileId]) {
        window.clearTimeout(this._timers[profileId]);
        this._timers[profileId] = null;
      }
      // Writing defaults (instead of dropping the record) keeps the change
      // observable and never touches virtual files or the recycle bin.
      await this._commit(profileId);
      return clone(defaults);
    },

    getCachedState(profileId) {
      const state = this._cache[profileId];
      return state ? clone(state) : null;
    },

    /* ── Shell state collection / application ───────────────────────── */

    collectState() {
      const state = defaultState();
      const root = document.documentElement;
      const wallpaperToggle = document.getElementById('wallpaper-toggle');
      const musicVolume = document.getElementById('music-volume');

      if (wallpaperToggle) {
        state.desktop.wallpaperPaused =
          wallpaperToggle.getAttribute('aria-pressed') === 'true';
      }
      state.desktop.iconsVisible = !root.classList.contains('profile-hide-icons');

      const storedTheme = safeLocalGet(LOCAL_KEYS.theme);
      state.settings.theme = root.dataset.theme || storedTheme || state.settings.theme;

      const storedMusic = Number(safeLocalGet(LOCAL_KEYS.musicVolume));
      if (isFinite(storedMusic)) {
        // The shell stores a 0..1 level; the profile state stores 0..100.
        const percent = storedMusic <= 1 ? storedMusic * 100 : storedMusic;
        state.settings.musicVolume = Math.round(Math.min(100, Math.max(0, percent)));
      } else if (musicVolume) {
        state.settings.musicVolume = Math.round(clampNumber(musicVolume.value, 0, 100, 45));
      }

      const storedClippy = safeSessionGet(LOCAL_KEYS.clippyVisible);
      if (storedClippy !== null) {
        state.settings.clippyVisible = storedClippy === '1';
      }

      const storedCursor = safeLocalGet(LOCAL_KEYS.cursorScheme) || root.dataset.cursorScheme;
      if (storedCursor) state.settings.cursorScheme = storedCursor;

      const storedSound = safeLocalGet(LOCAL_KEYS.soundEnabled);
      if (storedSound !== null) state.settings.soundEnabled = storedSound === '1';

      if (typeof window.__explorerCurrentId === 'string' &&
          window.__explorerCurrentId.indexOf('__') !== 0) {
        state.apps.lastExplorerFolder = window.__explorerCurrentId;
      }

      return state;
    },

    /**
     * Write preference keys that other modules read on boot. Safe to call
     * before the DOM is fully constructed.
     */
    applyStoredPreferences(profileId, state) {
      const validated = validateState(state);
      // The desktop shell reads a 0..1 level from localStorage.
      safeLocalSet(LOCAL_KEYS.musicVolume, validated.settings.musicVolume / 100);
      safeLocalSet(LOCAL_KEYS.cursorScheme, validated.settings.cursorScheme);
      safeLocalSet(LOCAL_KEYS.soundEnabled, validated.settings.soundEnabled ? '1' : '0');
      safeLocalSet(LOCAL_KEYS.theme, validated.settings.theme);
      safeSessionSet(LOCAL_KEYS.clippyVisible, validated.settings.clippyVisible ? '1' : '0');
      return validated;
    },

    /**
     * Apply DOM-dependent preferences. Called after DOMContentLoaded and before
     * the desktop shell boots.
     */
    applyDomState(profileId, state) {
      const validated = validateState(state);
      const root = document.documentElement;
      root.dataset.theme = validated.settings.theme;

      if (validated.desktop.iconsVisible) {
        root.classList.remove('profile-hide-icons');
      } else {
        root.classList.add('profile-hide-icons');
      }

      const musicVolume = document.getElementById('music-volume');
      if (musicVolume) {
        musicVolume.value = String(validated.settings.musicVolume);
        // Let the shell update its audio level + label through its own handler.
        try {
          musicVolume.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (_) { /* older browsers */ }
      }
      const musicValueLabel = document.getElementById('music-volume-value');
      if (musicValueLabel) musicValueLabel.textContent = validated.settings.musicVolume + '%';

      if (window.SiteCursor && typeof window.SiteCursor.setScheme === 'function') {
        try {
          const current = (root.dataset.cursorScheme || '').toLowerCase();
          if (current !== validated.settings.cursorScheme) {
            window.SiteCursor.setScheme(validated.settings.cursorScheme);
          }
        } catch (err) {
          console.warn('[PersistenceService] Could not apply cursor scheme', err);
        }
      }

      window.ProfileState = clone(validated);
      return validated;
    },

    async applyState(profileId, state) {
      const validated = this.applyStoredPreferences(profileId, state);
      this.applyDomState(profileId, validated);
      return validated;
    },

    /**
     * Wire the shell's existing preference controls to debounced saves.
     * Idempotent per profile.
     */
    bindAutoSave(profileId) {
      if (this._bound[profileId]) return;
      this._bound[profileId] = true;
      const self = this;

      function saveNow() {
        // Runs on the bubble phase, after the shell's own handler has already
        // updated the DOM/aria state we are about to snapshot.
        const collected = self.collectState();
        self.queueSave(profileId, {
          desktop: collected.desktop,
          settings: collected.settings,
          apps: collected.apps
        }).catch(function () { /* reported */ });
      }

      document.addEventListener('click', function (event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        if (target.closest('#wallpaper-toggle, #clippy-toggle, #start-lock-btn, [data-profile-setting]')) {
          saveNow();
        }
      }, false);

      document.addEventListener('input', function (event) {
        if (event.target && event.target.id === 'music-volume') saveNow();
      }, false);

      document.addEventListener('change', function (event) {
        if (event.target && event.target.id === 'music-volume') saveNow();
      }, false);

      document.addEventListener('site:cursorchange', saveNow);

      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          self.flush(profileId).catch(function () { /* reported */ });
        }
      });

      // Best-effort only: IndexedDB writes are async and may not finish while
      // the page is being torn down. Real durability comes from debounced saves.
      window.addEventListener('pagehide', function () {
        self.flush(profileId).catch(function () { /* reported */ });
      });

      if (window.VFS && typeof window.VFS.subscribe === 'function') {
        if (this._unsubscribeVfs) this._unsubscribeVfs();
        this._unsubscribeVfs = window.VFS.subscribe(function () { saveNow(); });
      }

      // Persist Explorer location whenever the adapter navigates.
      document.addEventListener('explorer:navigate', function (event) {
        const detail = event && event.detail ? event.detail : {};
        if (detail.id) {
          window.__explorerCurrentId = detail.id;
          saveNow();
        }
      });
    },

    defaults: defaultState,
    validateState: validateState,
    STATE_VERSION: STATE_VERSION
  };

  window.PersistenceService = PersistenceService;

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : { dispatchEvent: function () {} });
