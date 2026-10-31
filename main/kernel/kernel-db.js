/**
 * @file main/kernel/kernel-db.js
 * @layer L3 — Kernel
 * @owns  window.KernelDB
 * @needs [ 'OsError' ]
 *
 * Phase 3.5. IndexedDB database "kernel-db" (separate from vfs-db:<profile> and profile-db).
 *   store `audit`          autoIncrement rows: denied / sensitive syscall telemetry (capped, oldest trimmed)
 *   store `installed_apps` keyPath `id`: packages installed from .pkg files
 * Every row carries `schemaVersion`. Schema changes go through MIGRATIONS (indexed by target version).
 * Falls back to an in-memory backend when IndexedDB is unavailable (Node tests, private modes).
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p3.5';
  const DB_NAME = 'kernel-db';
  const DB_VERSION = 1;
  const SCHEMA_VERSION = 1;
  const AUDIT_MAX = 5000;
  const TRIM_EVERY = 100;

  const STORES = {
    audit: { autoIncrement: true },
    installed_apps: { keyPath: 'id' }
  };

  // target db version -> fn(db, tx). Add entries here; never edit old ones.
  const MIGRATIONS = {
    1: function (db) {
      Object.keys(STORES).forEach(function (name) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, STORES[name]);
      });
    }
  };

  function OsErr(code, msg, detail) {
    if (root.OsError) return new root.OsError(code, msg, detail);
    const e = new Error(msg || code);
    e.name = 'OsError';
    e.code = code;
    e.detail = detail;
    return e;
  }

  function checkStore(store) {
    if (!Object.prototype.hasOwnProperty.call(STORES, store)) {
      throw OsErr('EINVAL', 'Unknown kernel-db store: ' + store, { store: store });
    }
  }

  function clean(rec) {
    let copy;
    try { copy = JSON.parse(JSON.stringify(rec)); } catch (_) { throw OsErr('EINVAL', 'Record is not serializable'); }
    if (!copy || typeof copy !== 'object') throw OsErr('EINVAL', 'Record must be an object');
    if (copy.schemaVersion === undefined) copy.schemaVersion = SCHEMA_VERSION;
    return copy;
  }

  // ── Memory backend ─────────────────────────────────────────────────────
  function memoryBackend() {
    const data = {};
    const counters = {};
    Object.keys(STORES).forEach(function (s) { data[s] = new Map(); counters[s] = 0; });
    return {
      name: 'memory',
      add: async function (store, rec) { const k = ++counters[store]; data[store].set(k, Object.assign({ _key: k }, rec)); return k; },
      put: async function (store, rec) { data[store].set(rec.id, rec); return rec.id; },
      get: async function (store, key) { return data[store].has(key) ? JSON.parse(JSON.stringify(data[store].get(key))) : null; },
      all: async function (store) { return JSON.parse(JSON.stringify(Array.from(data[store].values()))); },
      del: async function (store, key) { return data[store].delete(key); },
      clear: async function (store) { data[store].clear(); },
      count: async function (store) { return data[store].size; },
      trim: async function (store, max) {
        const keys = Array.from(data[store].keys());
        keys.slice(0, Math.max(0, keys.length - max)).forEach(function (k) { data[store].delete(k); });
      }
    };
  }

  // ── IndexedDB backend ──────────────────────────────────────────────────
  function idbBackend() {
    const opening = new Promise(function (resolve, reject) {
      const req = root.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        for (let v = e.oldVersion + 1; v <= DB_VERSION; v += 1) {
          if (MIGRATIONS[v]) MIGRATIONS[v](req.result, req.transaction);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () {
        const err = req.error;
        reject(err && err.name === 'VersionError'
          ? OsErr('SCHEMA_MISMATCH', 'kernel-db was created by a newer version', { have: DB_VERSION })
          : (err || OsErr('EBUSY', 'Could not open kernel-db')));
      };
      req.onblocked = function () { reject(OsErr('EBUSY', 'kernel-db is blocked by another tab')); };
    });

    function run(store, mode, fn) {
      return opening.then(function (db) {
        return new Promise(function (resolve, reject) {
          const t = db.transaction(store, mode);
          const st = t.objectStore(store);
          let out;
          const r = fn(st);
          if (r) r.onsuccess = function () { out = r.result; };
          t.oncomplete = function () { resolve(out); };
          t.onerror = function () { reject(t.error); };
          t.onabort = function () { reject(t.error); };
        });
      });
    }

    return {
      name: 'indexeddb',
      opening: opening,
      add: function (store, rec) { return run(store, 'readwrite', function (s) { return s.add(rec); }); },
      put: function (store, rec) { return run(store, 'readwrite', function (s) { return s.put(rec); }); },
      get: function (store, key) { return run(store, 'readonly', function (s) { return s.get(key); }).then(function (v) { return v === undefined ? null : v; }); },
      all: function (store) { return run(store, 'readonly', function (s) { return s.getAll(); }); },
      del: function (store, key) { return run(store, 'readwrite', function (s) { return s.delete(key); }).then(function () { return true; }); },
      clear: function (store) { return run(store, 'readwrite', function (s) { return s.clear(); }); },
      count: function (store) { return run(store, 'readonly', function (s) { return s.count(); }); },
      trim: function (store, max) {
        return opening.then(function (db) {
          return new Promise(function (resolve, reject) {
            const t = db.transaction(store, 'readwrite');
            const st = t.objectStore(store);
            const cr = st.count();
            cr.onsuccess = function () {
              let extra = cr.result - max;
              if (extra <= 0) return;
              const cur = st.openCursor();
              cur.onsuccess = function () {
                const c = cur.result;
                if (!c || extra <= 0) return;
                c.delete();
                extra -= 1;
                c.continue();
              };
            };
            t.oncomplete = function () { resolve(); };
            t.onerror = function () { reject(t.error); };
          });
        });
      }
    };
  }

  let backend;
  let backendError = null;
  try {
    backend = root.indexedDB ? idbBackend() : memoryBackend();
  } catch (err) {
    backendError = err;
    backend = memoryBackend();
  }

  let appends = 0;
  const ready = (backend.opening ? backend.opening.then(function () { return true; }) : Promise.resolve(true))
    .catch(function (err) {
      // IndexedDB refused: keep the OS alive on the memory backend, remember why.
      backendError = err;
      backend = memoryBackend();
      return false;
    });

  async function withBackend(fn) {
    await ready;
    return fn(backend);
  }

  const KernelDB = Object.freeze({
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    ready: ready,

    append: function (store, rec) {
      checkStore(store);
      const row = clean(rec);
      return withBackend(function (b) {
        return b.add(store, row).then(function (key) {
          appends += 1;
          if (store === 'audit' && appends % TRIM_EVERY === 0) b.trim('audit', AUDIT_MAX).catch(function () {});
          return key;
        });
      });
    },
    put: function (store, rec) {
      checkStore(store);
      const row = clean(rec);
      if (store === 'installed_apps' && !row.id) throw OsErr('EINVAL', 'installed_apps rows need an id');
      return withBackend(function (b) { return b.put(store, row); });
    },
    get: function (store, key) { checkStore(store); return withBackend(function (b) { return b.get(store, key); }); },
    // list(store, { limit, newestFirst }) -> rows
    list: function (store, opts) {
      checkStore(store);
      return withBackend(function (b) { return b.all(store); }).then(function (rows) {
        if (opts && opts.newestFirst) rows = rows.slice().reverse();
        if (opts && typeof opts.limit === 'number' && opts.limit > 0) rows = rows.slice(0, opts.limit);
        return rows;
      });
    },
    delete: function (store, key) { checkStore(store); return withBackend(function (b) { return b.del(store, key); }); },
    clear: function (store) { checkStore(store); return withBackend(function (b) { return b.clear(store); }); },
    count: function (store) { checkStore(store); return withBackend(function (b) { return b.count(store); }); },

    diagnostics: function () {
      return {
        version: VERSION,
        backend: backend.name,
        fallbackReason: backendError ? String(backendError.message || backendError) : null,
        schemaVersion: SCHEMA_VERSION
      };
    }
  });

  root.KernelDB = KernelDB;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KernelDB: KernelDB };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
