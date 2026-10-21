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
  const MEMORY_FALLBACK = Object.create(null);
  const SCHEMA_VERSION = 1;
  const MIN_PASSWORD_LENGTH = 4;

  /** Canonical profile definitions. */
  const DEFINITIONS = [
    {
      id: 'guest',
      name: 'Guest',
      type: 'guest',
      username: 'guest',
      dbName: 'vfs-db-guest',
      description: 'Shared, password-free session for visitors.'
    },
    {
      id: 'owner',
      name: 'r3d1bruh',
      type: 'owner',
      username: 'r3d1', // keep legacy path C:\Users\r3d1 intact
      dbName: 'vfs-db', // legacy database: existing data is preserved as-is
      description: 'Owner profile, gated by a locally stored password verifier.'
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

    getProfiles() {
      const self = this;
      return DEFINITIONS.map(function (def) {
        const stored = self._profiles.get(def.id);
        return stored ? clone(stored) : Object.assign({}, def);
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
      if (requested === 'owner' && !this.isUnlocked('owner')) {
        return this.getProfile('guest');
      }
      return this.getProfile(requested === 'owner' ? 'owner' : 'guest');
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
      if (profile.type === 'owner' && !this.isUnlocked('owner')) {
        const error = new Error('Owner profile is locked');
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

    isUnlocked(profileId) {
      const profile = this.getProfile(profileId);
      if (!profile) return false;
      if (profile.type === 'guest') return true;
      return this._unlocked.has(profile.id) || safeSessionGet(UNLOCK_KEY) === '1';
    },

    lock(profileId) {
      const profile = this.getProfile(profileId);
      if (!profile) return false;
      this._unlocked.delete(profile.id);
      if (profile.type === 'owner') safeSessionSet(UNLOCK_KEY, '0');
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
