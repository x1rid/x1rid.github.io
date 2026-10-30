/**
 * @file main/profile/profile-service.js
 * @description Profile definitions, active-profile selection, and the minimal
 * owner password gate for the desktop simulator.
 *
 * PUBLIC API (window.ProfileService)
 *   await init()                          → initialize/migrate profile metadata
 *   getProfiles()                         → [{ id, name, type, username, dbName, ... }]
 *   getProfile(id)                        → profile copy or null
 *   getActiveProfile()                    → active profile copy or null
 *   resolveActive()                       → resolves the profile for this tab
 *   setActiveProfile(id)                  → switch + reload (async, flushes first)
 *   hasOwnerPassword()                    → boolean
 *   setOwnerPassword(password)            → first-time owner password setup
 *   unlock(profileId, password)           → { ok, reason?, needsSetup? }
 *   isUnlocked(profileId)                 → boolean
 *   lock(profileId)                       → re-lock an owner session
 *   subscribe(listener)                   → unsubscribe fn
 *
 * EVENTS (dispatched on `document`)
 *   profile:ready        { profile }
 *   profile:changed      { from, to }
 *   profile:state-loaded { profileId, state }
 *   profile:state-saved  { profileId, updatedAt }
 *   profile:state-error  { profileId, operation, error }
 *
 * SECURITY NOTE: this is a static, client-side application. The owner password
 * is a UI gate only. Anyone with access to the browser profile, IndexedDB, or
 * the application assets can inspect or bypass it. It is NOT confidentiality.
 */

(function (window, document) {
  'use strict';

  const ACTIVE_KEY = 'desktop.activeProfile';
  const UNLOCK_KEY = 'desktop.ownerUnlocked';
  const ADMIN_UNLOCK_KEY = 'desktop.adminUnlocked';
  const MEMORY_FALLBACK = Object.create(null);
  const SCHEMA_VERSION = 1;
  const MIN_PASSWORD_LENGTH = 4;

  /** Canonical profile definitions. Hidden entries never appear in public lists. */
  const DEFINITIONS = [
    {
      id: 'guest',
      name: 'Guest',
      type: 'guest',
      username: 'guest',
      dbName: 'vfs-db-guest',
      description: 'Shared, password-free session for visitors.',
      hidden: false,
      showOnLogin: true
    },
    {
      id: 'owner',
      // NOTE (Phase 0.6): 'r3d1bruh' is the site-owner's handle; ideally loaded
      // from data/site-config.json so it can be changed without editing JS.
      // See docs/OPEN_QUESTIONS.md OQ-004. The username 'r3d1' preserves legacy
      // VFS paths (C:\Users\r3d1) for existing IndexedDB data; will be migrated
      // in Phase 2.3.
      name: 'r3d1bruh',
      type: 'owner',
      username: 'r3d1', // legacy VFS path root � do not change until Phase 2.3 migration
      dbName: 'vfs-db', // legacy database: existing data is preserved as-is
      description: 'Owner profile, gated by a locally stored password verifier.',
      hidden: false,
      showOnLogin: true
    },
    {
      id: 'admin',
      name: 'SYSTEM',
      type: 'administrator',
      username: 'sysadmin',
      dbName: 'vfs-db-admin',
      description: 'Hidden virtual administrator account (simulation only).',
      hidden: true,
      showOnLogin: false
    }
  ];

  const listeners = new Set();

  function emit(type, detail) {
    try {
      document.dispatchEvent(new CustomEvent(type, { detail: detail || {} }));
    } catch (err) {
      // CustomEvent exists everywhere we support; never let telemetry break flow.
      console.warn('[ProfileService] Could not dispatch ' + type, err);
    }
    listeners.forEach(function (listener) {
      try { listener(type, detail || {}); } catch (err) {
        console.warn('[ProfileService] listener failed for ' + type, err);
      }
    });
  }

  function clone(profile) {
    if (!profile) return null;
    const copy = {};
    Object.keys(profile).forEach(function (key) {
      // Never expose the password verifier through the public profile API.
      if (key !== 'auth') copy[key] = profile[key];
    });
    return copy;
  }

  function definitionFor(id) {
    return DEFINITIONS.find(function (def) { return def.id === id; }) || null;
  }

  function safeSessionGet(key) {
    try { return window.sessionStorage.getItem(key); } catch (_) { return null; }
  }

  function safeSessionSet(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch (_) { /* optional */ }
  }

  function safeSessionRemove(key) {
    try { window.sessionStorage.removeItem(key); } catch (_) { /* optional */ }
  }

  /* ── Password hashing helpers ─────────────────────────────────────────── */

  function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  }

  function fromBase64(value) {
    const binary = window.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function randomSalt() {
    const bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return toBase64(bytes);
  }

  function weakHash(password, saltB64, iterations) {
    // Deterministic fallback for non-secure contexts where WebCrypto is absent.
    // Clearly weaker than PBKDF2; documented as UI-only protection either way.
    let seed = saltB64 + ':' + password;
    let h1 = 0x811c9dc5;
    let h2 = 0x1000193;
    for (let round = 0; round < iterations; round++) {
      for (let i = 0; i < seed.length; i++) {
        const code = seed.charCodeAt(i);
        h1 = (h1 ^ code) >>> 0;
        h1 = Math.imul(h1, 16777619) >>> 0;
        h2 = (h2 + Math.imul(code + round, 2654435761)) >>> 0;
      }
      seed = h1.toString(16) + h2.toString(16);
    }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
  }

  async function deriveHash(password, saltB64, iterations) {
    if (window.crypto && window.crypto.subtle &&
        typeof window.crypto.subtle.importKey === 'function') {
      try {
        const keyMaterial = await window.crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(password),
          'PBKDF2',
          false,
          ['deriveBits']
        );
        const bits = await window.crypto.subtle.deriveBits(
          {
            name: 'PBKDF2',
            salt: fromBase64(saltB64),
            iterations: iterations,
            hash: 'SHA-256'
          },
          keyMaterial,
          256
        );
        return { algo: 'PBKDF2-SHA256', hash: toBase64(new Uint8Array(bits)) };
      } catch (err) {
        console.warn('[ProfileService] WebCrypto PBKDF2 failed; using fallback hash.', err);
      }
    }
    return { algo: 'ITER-FNV', hash: weakHash(password, saltB64, iterations) };
  }

  function constantTimeEqual(a, b) {
    const x = String(a || '');
    const y = String(b || '');
    if (x.length !== y.length) return false;
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
    return diff === 0;
  }

  /* ── Service ──────────────────────────────────────────────────────────── */

  const ProfileService = {
    _db: null,
    _profiles: new Map(),
    _active: null,
    _initialized: false,
    _initPromise: null,
    _unlocked: new Set(),

    async init() {
      if (this._initialized) return this;
      if (this._initPromise) return this._initPromise;

      this._initPromise = (async () => {
        this._db = new window.ProfileDB();
        await this._db.init();

        const existing = await this._db.getAllProfiles();
        const existingById = new Map();
        existing.forEach((record) => existingById.set(record.id, record));

        for (let i = 0; i < DEFINITIONS.length; i++) {
          const def = DEFINITIONS[i];
          const prior = existingById.get(def.id);
          if (prior) {
            // Never overwrite identity, auth, or creation data.
            const merged = Object.assign({}, def, prior, {
              name: prior.name || def.name,
              type: prior.type || def.type,
              username: prior.username || def.username,
              dbName: prior.dbName || def.dbName,
              hidden: def.hidden === true,
              showOnLogin: def.hidden === true ? false : prior.showOnLogin !== false,
              status: prior.status || 'active',
              schemaVersion: SCHEMA_VERSION,
              initialized: true
            });
            await this._db.putProfile(merged);
            this._profiles.set(merged.id, merged);
          } else {
            const now = Date.now();
            const record = {
              id: def.id,
              name: def.name,
              type: def.type,
              username: def.username,
              dbName: def.dbName,
              description: def.description,
              hidden: def.hidden === true,
              showOnLogin: def.showOnLogin !== false,
              status: 'active',
              createdAt: now,
              lastAccessAt: 0,
              schemaVersion: SCHEMA_VERSION,
              initialized: true,
              auth: null
            };
            await this._db.putProfile(record);
            this._profiles.set(record.id, record);
          }
        }

        if (safeSessionGet(UNLOCK_KEY) === '1') {
          this._unlocked.add('owner');
        }
        if (safeSessionGet(ADMIN_UNLOCK_KEY) === '1') {
          this._unlocked.add('admin');
        }

        this._initialized = true;
        return this;
      })();

      try {
        return await this._initPromise;
      } catch (err) {
        this._initPromise = null;
        throw err;
      }
    },

    /**
     * Public account-list query. Hidden virtual accounts are never returned;
     * use getProfile(id) only from trusted internal code that already has an
     * explicit id.
     */
    getProfiles() {
      const self = this;
      return DEFINITIONS.filter(function (def) {
        return def.hidden !== true;
      }).map(function (def) {
        const stored = self._profiles.get(def.id);
        const record = stored ? clone(stored) : Object.assign({}, def);
        delete record.hidden;
        delete record.auth;
        return record;
      });
    },

    /** Explicit login-screen projection; still excludes hidden accounts. */
    listPublicProfiles() {
      return this.getProfiles().filter(function (profile) {
        return profile.status !== 'disabled' && profile.showOnLogin !== false;
      });
    },

    getProfile(id) {
      if (!id || typeof id !== 'string') return null;
      const definition = definitionFor(id);
      if (!definition) return null;
      const stored = this._profiles.get(id);
      return stored ? clone(stored) : Object.assign({}, definition);
    },

    getActiveProfile() {
      return clone(this._active);
    },

    /**
     * Resolve which profile this tab should boot. A locked owner session falls
     * back to Guest rather than exposing owner data.
     */
    resolveActive() {
      const requested = safeSessionGet(ACTIVE_KEY);
      if ((requested === 'owner' || requested === 'admin') && !this.isUnlocked(requested)) {
        return this.getProfile('guest');
      }
      return this.getProfile(requested === 'owner' || requested === 'admin' ? requested : 'guest');
    },

    _rememberActive(profile) {
      const now = Date.now();
      profile.lastAccessAt = now;
      this._active = clone(profile);
      safeSessionSet(ACTIVE_KEY, profile.id);
      const stored = this._profiles.get(profile.id);
      if (stored) {
        stored.lastAccessAt = now;
        this._profiles.set(profile.id, stored);
        this._db.putProfile(stored).catch(function (err) {
          console.warn('[ProfileService] Could not persist lastAccessAt', err);
        });
      }
    },

    /**
     * Set the active profile and reload the shell so it boots from the incoming
     * profile's state. Pending writes for the outgoing profile are flushed
     * first; nothing is ever deleted by switching.
     */
    async setActiveProfile(id) {
      await this.init();
      const profile = this.getProfile(id);
      if (!profile) throw new Error('Unknown profile id: ' + id);
      if ((profile.type === 'owner' || profile.type === 'administrator') &&
          !this.isUnlocked(profile.id)) {
        const error = new Error('Profile is locked');
        error.code = 'PROFILE_LOCKED';
        throw error;
      }

      const outgoing = this.getActiveProfile();
      if (outgoing && window.PersistenceService &&
          typeof window.PersistenceService.flush === 'function') {
        // Never switch until the outgoing state is durable.
        await window.PersistenceService.flush(outgoing.id);
      }

      safeSessionSet(ACTIVE_KEY, profile.id);
      safeSessionSet(UNLOCK_KEY, profile.type === 'owner' && this.isUnlocked('owner') ? '1' : '0');
      emit('profile:changed', { from: outgoing ? outgoing.id : null, to: profile.id });

      if (window.location && typeof window.location.reload === 'function') {
        window.location.reload();
      }
      return profile;
    },

    hasOwnerPassword() {
      const owner = this._profiles.get('owner');
      return Boolean(owner && owner.auth && owner.auth.hash);
    },

    async setOwnerPassword(password) {
      await this.init();
      const value = String(password == null ? '' : password);
      if (value.length < MIN_PASSWORD_LENGTH) {
        const error = new Error('Password must be at least ' + MIN_PASSWORD_LENGTH + ' characters');
        error.code = 'PASSWORD_TOO_SHORT';
        throw error;
      }
      if (value.length > 256) {
        const error = new Error('Password is too long');
        error.code = 'PASSWORD_TOO_LONG';
        throw error;
      }
      const owner = this._profiles.get('owner');
      if (!owner) throw new Error('Owner profile is missing');
      if (owner.auth && owner.auth.hash && !this.isUnlocked('owner')) {
        const error = new Error('Owner password already exists');
        error.code = 'PASSWORD_EXISTS';
        throw error;
      }

      const iterations = 120000;
      const salt = randomSalt();
      const derived = await deriveHash(value, salt, iterations);
      owner.auth = {
        algo: derived.algo,
        iterations: iterations,
        salt: salt,
        hash: derived.hash,
        updatedAt: Date.now()
      };
      await this._db.putProfile(owner);
      this._profiles.set('owner', owner);
      this._unlocked.add('owner');
      safeSessionSet(UNLOCK_KEY, '1');
      return true;
    },

    async unlock(profileId, password) {
      await this.init();
      const profile = this.getProfile(profileId);
      if (!profile) return { ok: false, reason: 'unknown-profile' };
      if (profile.type === 'guest') {
        this._unlocked.add(profile.id);
        return { ok: true, profile: profile };
      }

      const stored = this._profiles.get('owner');
      if (!stored || !stored.auth || !stored.auth.hash) {
        return { ok: false, needsSetup: true, reason: 'no-password' };
      }

      const derived = await deriveHash(
        String(password == null ? '' : password),
        stored.auth.salt,
        stored.auth.iterations || 120000
      );

      if (!constantTimeEqual(derived.hash, stored.auth.hash)) {
        return { ok: false, reason: 'invalid-password' };
      }

      this._unlocked.add('owner');
      safeSessionSet(UNLOCK_KEY, '1');
      return { ok: true, profile: profile };
    },

    /**
     * Username + password authentication adapter used by the lock screen.
     * Returns only { ok, profileId, reason? }; it never reveals whether a
     * hidden account exists. Unknown usernames always fail generically.
     */
    async authenticate(credentials) {
      await this.init();
      const username = String(credentials && credentials.username || '').trim().toLowerCase();
      const password = String(credentials && credentials.password || '');
      const failure = { ok: false, reason: 'invalid-credentials' };
      if (!username) return failure;

      let matched = null;
      DEFINITIONS.some((def) => {
        const stored = this._profiles.get(def.id);
        const name = String(stored && stored.username || def.username || '').toLowerCase();
        if (name === username) {
          matched = stored || Object.assign({}, def);
          return true;
        }
        return false;
      });
      if (!matched) return failure;
      if (matched.status === 'disabled') return failure;

      if (matched.type === 'guest') {
        // Guest is intentionally password-free, but the username still has to
        // match. Any password input is ignored rather than creating a secret.
        this._unlocked.add(matched.id);
        return { ok: true, profileId: matched.id };
      }

      if (!matched.auth || !matched.auth.hash) {
        return { ok: false, reason: 'no-password' };
      }

      const derived = await deriveHash(
        password,
        matched.auth.salt,
        matched.auth.iterations || 120000
      );
      if (!constantTimeEqual(derived.hash, matched.auth.hash)) return failure;

      this._unlocked.add(matched.id);
      if (matched.type === 'owner') safeSessionSet(UNLOCK_KEY, '1');
      if (matched.type === 'administrator') safeSessionSet(ADMIN_UNLOCK_KEY, '1');
      return { ok: true, profileId: matched.id };
    },

    /**
     * Development/recovery path for the hidden administrator. The browser is
     * not a security boundary; this exists so the virtual account can be
     * configured deliberately, never automatically from an unknown username.
     */
    async enableHiddenAdmin(password, options) {
      await this.init();
      const dev = options && options.dev === true;
      let sessionDev = false;
      try {
        sessionDev = window.sessionStorage.getItem('desktop.devMode') === '1';
      } catch (_) { /* storage can be blocked */ }
      if (!dev && !sessionDev) {
        const error = new Error('Hidden admin setup requires explicit development mode');
        error.code = 'DEV_MODE_REQUIRED';
        throw error;
      }
      const value = String(password == null ? '' : password);
      if (value.length < MIN_PASSWORD_LENGTH || value.length > 256) {
        const error = new Error('Invalid administrator password length');
        error.code = 'INVALID_PASSWORD';
        throw error;
      }
      const admin = this._profiles.get('admin');
      if (!admin) throw new Error('Hidden administrator record is missing');
      const salt = randomSalt();
      const derived = await deriveHash(value, salt, 120000);
      admin.auth = {
        algo: derived.algo,
        iterations: 120000,
        salt: salt,
        hash: derived.hash,
        updatedAt: Date.now()
      };
      await this._db.putProfile(admin);
      this._profiles.set('admin', admin);
      return true;
    },

    /**
     * Persist a custom display name and login username. Usernames are unique
     * across the virtual account set, including the hidden administrator.
     */
    async updateIdentity(profileId, changes) {
      await this.init();
      const record = this._profiles.get(profileId);
      if (!record) {
        const error = new Error('Unknown profile id');
        error.code = 'PROFILE_NOT_FOUND';
        throw error;
      }
      const name = String(changes && changes.displayName != null ? changes.displayName : record.name).trim();
      const username = String(changes && changes.username != null ? changes.username : record.username).trim();
      if (!name || name.length > 40) {
        const error = new Error('Display name must be 1-40 characters');
        error.code = 'INVALID_DISPLAY_NAME';
        throw error;
      }
      if (!/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(username)) {
        const error = new Error('Username must be 3-32 safe characters');
        error.code = 'INVALID_USERNAME';
        throw error;
      }
      const lowered = username.toLowerCase();
      const taken = DEFINITIONS.some((def) => {
        if (def.id === profileId) return false;
        const other = this._profiles.get(def.id);
        return String(other && other.username || def.username || '').toLowerCase() === lowered;
      });
      if (taken) {
        const error = new Error('Username is already in use');
        error.code = 'USERNAME_TAKEN';
        throw error;
      }
      record.name = name;
      record.username = username;
      record.updatedAt = Date.now();
      await this._db.putProfile(record);
      this._profiles.set(profileId, record);
      if (this._active && this._active.id === profileId) {
        this._active = clone(record);
      }
      emit('profile:identity-changed', {
        profileId: profileId,
        displayName: record.name,
        username: record.username
      });
      return clone(record);
    },

    isUnlocked(profileId) {
      const profile = this.getProfile(profileId);
      if (!profile) return false;
      if (profile.type === 'guest') return true;
      if (profile.type === 'administrator') {
        return this._unlocked.has(profile.id) || safeSessionGet(ADMIN_UNLOCK_KEY) === '1';
      }
      return this._unlocked.has(profile.id) || safeSessionGet(UNLOCK_KEY) === '1';
    },

    lock(profileId) {
      const profile = this.getProfile(profileId);
      if (!profile) return false;
      this._unlocked.delete(profile.id);
      if (profile.type === 'owner') safeSessionSet(UNLOCK_KEY, '0');
      if (profile.type === 'administrator') safeSessionSet(ADMIN_UNLOCK_KEY, '0');
      emit('profile:locked', { profileId: profile.id });
      return true;
    },

    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('ProfileService.subscribe requires a function');
      }
      listeners.add(listener);
      return function () { listeners.delete(listener); };
    },

    /* Internal helpers used by boot.js profile-ui.js */
    _definitions: DEFINITIONS,
    _emit: emit
  };

  // Expose definitions for the boot/UI layers without allowing mutation.
  window.PROFILE_DEFINITIONS = Object.freeze(DEFINITIONS.map(function (def) {
    return Object.freeze(Object.assign({}, def));
  }));
  window.ProfileService = ProfileService;

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : { dispatchEvent: function () {} });
