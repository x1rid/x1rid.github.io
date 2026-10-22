/**
 * @file main/profile/profile-db.js
 * @description Small IndexedDB wrapper for profile metadata and per-profile
 * persisted simulator state. This database never stores file contents: the
 * Virtual File System (vfs-db / vfs-db-guest) remains the single source of
 * truth for virtual files.
 *
 * Database: profile-db (version 2)
 *   - profiles       (keyPath: 'id')         → profile metadata + auth verifier
 *   - profile-state  (keyPath: 'profileId')  → validated UI/simulator state
 *   - system-config  (keyPath: 'profileId')  → profile-scoped virtual system
 *                                              configuration and rollback snapshot
 *
 * Version 2 is an additive migration: existing profile metadata and state are
 * untouched, and only the new object store is created.
 */

(function (window) {
  'use strict';

  const DB_NAME = 'profile-db';
  const DB_VERSION = 2;
  const STORE_PROFILES = 'profiles';
  const STORE_STATE = 'profile-state';
  const STORE_SYSTEM_CONFIG = 'system-config';

  function promisify(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () {
        reject(request.error || new Error('IndexedDB request failed'));
      };
    });
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB transaction failed')); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction aborted')); };
    });
  }

  class ProfileDB {
    constructor() {
      /** @type {IDBDatabase|null} */
      this.db = null;
      this._initPromise = null;
    }

    init() {
      if (this.db) return Promise.resolve(this);
      if (this._initPromise) return this._initPromise;

      this._initPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('IndexedDB is not supported in this environment'));
          return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_PROFILES)) {
            db.createObjectStore(STORE_PROFILES, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_STATE)) {
            db.createObjectStore(STORE_STATE, { keyPath: 'profileId' });
          }
          if (!db.objectStoreNames.contains(STORE_SYSTEM_CONFIG)) {
            db.createObjectStore(STORE_SYSTEM_CONFIG, { keyPath: 'profileId' });
          }
        };

        request.onsuccess = (event) => {
          this.db = event.target.result;
          this.db.onversionchange = () => {
            // Another tab wants to upgrade; release so it is not blocked.
            try { this.db.close(); } catch (_) { /* ignore */ }
            this.db = null;
            this._initPromise = null;
          };
          resolve(this);
        };

        request.onerror = () => {
          reject(request.error || new Error('Failed to open IndexedDB ' + DB_NAME));
        };

        request.onblocked = () => {
          console.warn('[ProfileDB] Open blocked by another tab using ' + DB_NAME);
        };
      });

      return this._initPromise;
    }

    _ensureDb() {
      if (!this.db) throw new Error('ProfileDB not initialized. Call init() first.');
    }

    /* ── Profiles ─────────────────────────────────────────────── */

    async getProfile(id) {
      this._ensureDb();
      if (!id) return null;
      const tx = this.db.transaction(STORE_PROFILES, 'readonly');
      const record = await promisify(tx.objectStore(STORE_PROFILES).get(id));
      return record || null;
    }

    async getAllProfiles() {
      this._ensureDb();
      const tx = this.db.transaction(STORE_PROFILES, 'readonly');
      const records = await promisify(tx.objectStore(STORE_PROFILES).getAll());
      return records || [];
    }

    async putProfile(profile) {
      this._ensureDb();
      if (!profile || !profile.id) throw new Error('putProfile requires a profile with an id');
      const tx = this.db.transaction(STORE_PROFILES, 'readwrite');
      tx.objectStore(STORE_PROFILES).put(profile);
      await txDone(tx);
      return profile;
    }

    async deleteProfile(id) {
      this._ensureDb();
      if (!id) return false;
      const tx = this.db.transaction(STORE_PROFILES, 'readwrite');
      tx.objectStore(STORE_PROFILES).delete(id);
      await txDone(tx);
      return true;
    }

    /* ── Per-profile state ────────────────────────────────────── */

    async getState(profileId) {
      this._ensureDb();
      if (!profileId) return null;
      const tx = this.db.transaction(STORE_STATE, 'readonly');
      const record = await promisify(tx.objectStore(STORE_STATE).get(profileId));
      return record || null;
    }

    async putState(record) {
      this._ensureDb();
      if (!record || !record.profileId) {
        throw new Error('putState requires a record with a profileId');
      }
      const tx = this.db.transaction(STORE_STATE, 'readwrite');
      tx.objectStore(STORE_STATE).put(record);
      await txDone(tx);
      return record;
    }

    async deleteState(profileId) {
      this._ensureDb();
      if (!profileId) return false;
      const tx = this.db.transaction(STORE_STATE, 'readwrite');
      tx.objectStore(STORE_STATE).delete(profileId);
      await txDone(tx);
      return true;
    }

    /* ── Per-profile virtual system configuration ─────────────── */

    async getSystemConfig(profileId) {
      this._ensureDb();
      if (!profileId) return null;
      const tx = this.db.transaction(STORE_SYSTEM_CONFIG, 'readonly');
      const record = await promisify(tx.objectStore(STORE_SYSTEM_CONFIG).get(profileId));
      return record || null;
    }

    async putSystemConfig(record) {
      this._ensureDb();
      if (!record || !record.profileId) {
        throw new Error('putSystemConfig requires a record with a profileId');
      }
      const tx = this.db.transaction(STORE_SYSTEM_CONFIG, 'readwrite');
      tx.objectStore(STORE_SYSTEM_CONFIG).put(record);
      await txDone(tx);
      return record;
    }

    async deleteSystemConfig(profileId) {
      this._ensureDb();
      if (!profileId) return false;
      const tx = this.db.transaction(STORE_SYSTEM_CONFIG, 'readwrite');
      tx.objectStore(STORE_SYSTEM_CONFIG).delete(profileId);
      await txDone(tx);
      return true;
    }
  }

  window.ProfileDB = ProfileDB;
  window.PROFILE_DB_NAME = DB_NAME;
  window.PROFILE_DB_VERSION = DB_VERSION;

})(typeof window !== 'undefined' ? window : globalThis);
