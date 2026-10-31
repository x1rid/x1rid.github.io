/**
 * @file main/kernel/autostart.js
 * @layer L3 — Kernel
 * @owns  window.AutostartService
 * @needs [ 'KernelDB', 'KernelEvents' ]
 * @emits [ 'autostart:entry-registered', 'autostart:entry-removed', 'autostart:run-started', 'autostart:app-launched', 'autostart:launch-skipped' ]
 *
 * Phase 4.2 — Autostart service. Persists app launch entries in KernelDB.
 * run() is called by shell/boot.js after ProfileReady.
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p4.2';
  const STORE = 'autostart_entries';

  function emit(event, data) {
    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit(event, data || {});
    }
  }

  function getDB() {
    return root.KernelDB || null;
  }

  // In-memory fallback when KernelDB is absent (Node tests without DB setup)
  const _memStore = new Map();
  let _useMemory = false;

  function resolveBackend() {
    const db = getDB();
    if (!db) { _useMemory = true; }
    return db;
  }

  async function dbList() {
    const db = resolveBackend();
    if (_useMemory || !db) {
      return Array.from(_memStore.values());
    }
    try {
      return await db.list(STORE);
    } catch (e) {
      _useMemory = true;
      return Array.from(_memStore.values());
    }
  }

  async function dbPut(entry) {
    const db = resolveBackend();
    if (_useMemory || !db) {
      _memStore.set(entry.id, entry);
      return entry.id;
    }
    try {
      return await db.put(STORE, entry);
    } catch (_) {
      _useMemory = true;
      _memStore.set(entry.id, entry);
      return entry.id;
    }
  }

  async function dbDel(appId) {
    const db = resolveBackend();
    const key = 'autostart:' + appId;
    if (_useMemory || !db) {
      _memStore.delete(key);
      return;
    }
    try {
      await db.delete(STORE, key);
    } catch (_) {
      _useMemory = true;
      _memStore.delete(key);
    }
  }

  /**
   * register(appId, opts) — registers an app for autostart
   * opts: { delay?: ms, once?: bool }
   */
  async function register(appId, opts) {
    if (!appId || typeof appId !== 'string') throw new Error('AutostartService.register: appId required');
    opts = opts || {};
    const entry = {
      id: 'autostart:' + appId,
      schemaVersion: 1,
      appId: appId,
      delay: typeof opts.delay === 'number' ? opts.delay : 0,
      once: Boolean(opts.once),
      registeredAt: Date.now()
    };
    await dbPut(entry);
    emit('autostart:entry-registered', { appId: appId, opts: opts });
    return entry;
  }

  /**
   * unregister(appId)
   */
  async function unregister(appId) {
    if (!appId || typeof appId !== 'string') return;
    await dbDel(appId);
    emit('autostart:entry-removed', { appId: appId });
  }

  /**
   * list() → [{ appId, opts }]
   */
  async function list() {
    const rows = await dbList();
    return rows.map(function (r) {
      return { appId: r.appId, opts: { delay: r.delay, once: r.once } };
    });
  }

  /**
   * run() — called by shell/boot.js. Spawns all registered autostart apps.
   */
  async function run() {
    emit('autostart:run-started', {});
    const entries = await dbList();
    const toRemove = [];

    for (const entry of entries) {
      const launch = function () {
        if (root.AppRegistry && typeof root.AppRegistry.launch === 'function') {
          try {
            root.AppRegistry.launch(entry.appId);
            emit('autostart:app-launched', { appId: entry.appId });
          } catch (e) {
            emit('autostart:launch-skipped', { appId: entry.appId, reason: String(e) });
          }
        } else {
          emit('autostart:launch-skipped', { appId: entry.appId, reason: 'AppRegistry not available' });
        }
      };

      if (entry.delay && entry.delay > 0) {
        if (typeof setTimeout !== 'undefined') {
          setTimeout(launch, entry.delay);
        } else {
          launch();
        }
      } else {
        launch();
      }

      if (entry.once) {
        toRemove.push(entry.appId);
      }
    }

    // Remove once-entries
    for (const appId of toRemove) {
      await unregister(appId);
    }
  }

  const ready = Promise.resolve(true);

  const AutostartService = {
    version: VERSION,
    ready: ready,
    register: register,
    unregister: unregister,
    list: list,
    run: run,
    diagnostics: function () {
      return { version: VERSION, backend: _useMemory ? 'memory' : 'kernel-db' };
    }
  };

  root.AutostartService = AutostartService;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AutostartService: AutostartService };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
