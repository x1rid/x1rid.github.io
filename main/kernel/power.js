/**
 * @file main/kernel/power.js
 * @layer L3 — Kernel
 * @owns  window.PowerService
 * @needs [ 'KernelDB', 'KernelEvents', 'KernelProcessTable', 'ProfileWindowState' ]
 * @emits [
 *   'power:sleep-started', 'power:sleep-ended',
 *   'power:hibernate-started', 'power:hibernate-restored',
 *   'power:restart-initiated', 'power:shutdown'
 * ]
 *
 * Phase 4.3 — Sleep / hibernate / restart / shutdown / safe-mode.
 * Hibernate snapshot stored in KernelDB store `hibernate_snapshot`.
 * DOM sleep overlay is in shell/power-overlay.js.
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p4.3';
  const STORE = 'hibernate_snapshot';
  const SNAPSHOT_KEY = 'current';

  // 'running' | 'sleeping' | 'hibernating' | 'shutdown'
  let _state = 'running';

  // Sleep wake-up promise resolver
  let _sleepResolve = null;

  function emit(event, data) {
    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit(event, data || {});
    }
  }

  function getDB() { return root.KernelDB || null; }

  async function dbPut(record) {
    const db = getDB();
    if (!db) return;
    try { await db.put(STORE, record); } catch (_) {}
  }

  async function dbGetAll() {
    const db = getDB();
    if (!db) return [];
    try { return await db.list(STORE); } catch (_) { return []; }
  }

  async function dbClear() {
    const db = getDB();
    if (!db) return;
    try { await db.clear(STORE); } catch (_) {}
  }

  /**
   * sleep() — emits sleep-started, waits for wakeFromSleep() call.
   */
  function sleep() {
    if (_state !== 'running') return Promise.resolve();
    _state = 'sleeping';
    emit('power:sleep-started', { ts: new Date().toISOString() });

    return new Promise(function (resolve) {
      _sleepResolve = resolve;
    });
  }

  /**
   * wakeFromSleep() — called by power-overlay.js on user input.
   */
  function wakeFromSleep() {
    if (_state !== 'sleeping' && _state !== 'hibernating') return;
    _state = 'running';
    emit('power:sleep-ended', { ts: new Date().toISOString() });
    if (_sleepResolve) {
      _sleepResolve();
      _sleepResolve = null;
    }
  }

  /**
   * hibernate() — snapshot process table + windows, then enter sleep state.
   */
  async function hibernate() {
    // Snapshot state first
    let processes = [];
    let windows = [];

    try {
      if (root.KernelProcessTable && typeof root.KernelProcessTable.list === 'function') {
        processes = root.KernelProcessTable.list();
      }
    } catch (_) {}

    try {
      if (root.ProfileWindowState && typeof root.ProfileWindowState.snapshotActive === 'function') {
        const snap = root.ProfileWindowState.snapshotActive();
        windows = snap ? snap : [];
      }
    } catch (_) {}

    const snapshot = {
      id: SNAPSHOT_KEY,
      schemaVersion: 1,
      ts: new Date().toISOString(),
      processes: processes,
      windows: windows
    };

    await dbPut(snapshot);

    _state = 'hibernating';
    emit('power:hibernate-started', { ts: snapshot.ts });

    // In browser: sleep overlay will handle it
    return Promise.resolve();
  }

  /**
   * restore() — restore from hibernate snapshot if one exists.
   * Returns true if restored, false if no snapshot.
   */
  async function restore() {
    const rows = await dbGetAll();
    if (!rows || rows.length === 0) return false;

    const snapshot = rows[0];

    // Restore windows
    try {
      if (root.ProfileWindowState && typeof root.ProfileWindowState.importAll === 'function' && snapshot.windows) {
        root.ProfileWindowState.importAll(snapshot.windows);
      }
    } catch (_) {}

    await dbClear();

    _state = 'running';
    emit('power:hibernate-restored', { ts: new Date().toISOString() });
    return true;
  }

  /**
   * restart() — teardown and reload.
   */
  async function restart() {
    emit('power:restart-initiated', { ts: new Date().toISOString() });
    emit('power:shutdown', { reason: 'restart' });
    if (typeof location !== 'undefined') {
      location.reload();
    }
  }

  /**
   * shutdown() — emit shutdown, set state.
   */
  async function shutdown() {
    _state = 'shutdown';
    emit('power:shutdown', { reason: 'shutdown', ts: new Date().toISOString() });
  }

  /**
   * safeMode() — restart with ?safe=1
   */
  async function safeMode() {
    if (typeof location !== 'undefined') {
      location.assign(location.href + '?safe=1');
    }
  }

  const ready = Promise.resolve(true);

  const PowerService = {
    version: VERSION,
    ready: ready,

    get state() { return _state; },

    sleep: sleep,
    wakeFromSleep: wakeFromSleep,
    hibernate: hibernate,
    restore: restore,
    restart: restart,
    shutdown: shutdown,
    safeMode: safeMode,

    diagnostics: function () {
      return {
        version: VERSION,
        state: _state,
        hasSleepResolver: _sleepResolve !== null
      };
    }
  };

  root.PowerService = PowerService;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PowerService: PowerService };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
