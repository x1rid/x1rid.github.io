/**
 * @file main/kernel/scheduler.js
 * @layer L3 — Kernel
 * @owns  window.KernelScheduler
 * @needs [ 'KernelDB', 'KernelEvents' ]
 * @emits [ 'scheduler:task-registered', 'scheduler:task-fired', 'scheduler:task-cancelled' ]
 *
 * Phase 4.2 — Simple task scheduler. Supports:
 *   - { interval: ms }  → setInterval
 *   - { at: ISOdate }   → setTimeout until that time
 *   - { cron: '* /N * * * *' } → simple * /N minute cron parser (no deps)
 *
 * In Node test environment timers are registered but not fired automatically.
 * Definitions persisted to KernelDB store `scheduled_tasks`.
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p4.2';
  const STORE = 'scheduled_tasks';

  // Live task handles: id -> { handle, type }
  const _handles = new Map();
  // In-memory fallback store
  const _memTasks = new Map();
  let _useMemory = false;

  function emit(event, data) {
    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit(event, data || {});
    }
  }

  function getDB() { return root.KernelDB || null; }

  async function dbPut(task) {
    const db = getDB();
    if (_useMemory || !db) { _memTasks.set(task.id, task); return; }
    try { await db.put(STORE, task); } catch (_) { _useMemory = true; _memTasks.set(task.id, task); }
  }

  async function dbDel(id) {
    const db = getDB();
    if (_useMemory || !db) { _memTasks.delete(id); return; }
    try { await db.delete(STORE, id); } catch (_) { _useMemory = true; _memTasks.delete(id); }
  }

  async function dbList() {
    const db = getDB();
    if (_useMemory || !db) { return Array.from(_memTasks.values()); }
    try { return await db.list(STORE); } catch (_) { _useMemory = true; return Array.from(_memTasks.values()); }
  }

  /**
   * Simple cron interval extractor.
   * Only supports "* /N * * * *" (every N minutes) pattern.
   * Returns ms or null.
   */
  function parseCronInterval(cron) {
    if (typeof cron !== 'string') return null;
    // Match "*/N * * * *"
    const m = cron.trim().match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
    if (m) return parseInt(m[1], 10) * 60 * 1000;
    // Match "* * * * *" (every minute)
    if (/^\*\s+\*\s+\*\s+\*\s+\*$/.test(cron.trim())) return 60 * 1000;
    return null;
  }

  function inBrowser() {
    return typeof window !== 'undefined' && typeof window.setTimeout === 'function';
  }

  /**
   * schedule(id, spec, handler)
   * spec: { cron: '* /5 * * * *' } | { interval: ms } | { at: ISOdate }
   */
  async function schedule(taskId, spec, handler) {
    if (!taskId || typeof taskId !== 'string') throw new Error('KernelScheduler.schedule: id required');
    if (!spec || typeof spec !== 'object') throw new Error('KernelScheduler.schedule: spec required');
    if (typeof handler !== 'function') throw new Error('KernelScheduler.schedule: handler must be a function');

    // Cancel existing if re-registering
    if (_handles.has(taskId)) cancel(taskId);

    const taskDef = {
      id: taskId,
      schemaVersion: 1,
      spec: spec,
      registeredAt: Date.now()
    };
    await dbPut(taskDef);
    emit('scheduler:task-registered', { id: taskId, spec: spec });

    if (!inBrowser()) {
      // Node: register but don't fire
      return taskDef;
    }

    function fire() {
      try {
        handler({ id: taskId, firedAt: Date.now() });
        emit('scheduler:task-fired', { id: taskId });
      } catch (e) {
        // Swallow handler errors to keep scheduler alive
      }
    }

    if (spec.interval && typeof spec.interval === 'number') {
      const handle = setInterval(fire, spec.interval);
      _handles.set(taskId, { handle: handle, type: 'interval' });

    } else if (spec.at) {
      const targetMs = new Date(spec.at).getTime();
      const delayMs = Math.max(0, targetMs - Date.now());
      const handle = setTimeout(function () {
        fire();
        _handles.delete(taskId);
      }, delayMs);
      _handles.set(taskId, { handle: handle, type: 'timeout' });

    } else if (spec.cron) {
      const intervalMs = parseCronInterval(spec.cron);
      if (intervalMs) {
        const handle = setInterval(fire, intervalMs);
        _handles.set(taskId, { handle: handle, type: 'interval' });
      }
    }

    return taskDef;
  }

  /**
   * cancel(id)
   */
  async function cancel(taskId) {
    if (_handles.has(taskId)) {
      const entry = _handles.get(taskId);
      if (entry.type === 'interval') clearInterval(entry.handle);
      else clearTimeout(entry.handle);
      _handles.delete(taskId);
    }
    await dbDel(taskId);
    emit('scheduler:task-cancelled', { id: taskId });
  }

  /**
   * list() → task definitions
   */
  async function list() {
    return dbList();
  }

  const ready = Promise.resolve(true);

  const KernelScheduler = {
    version: VERSION,
    ready: ready,
    schedule: schedule,
    cancel: cancel,
    list: list,
    diagnostics: function () {
      return {
        version: VERSION,
        activeTasks: _handles.size,
        backend: _useMemory ? 'memory' : 'kernel-db'
      };
    }
  };

  root.KernelScheduler = KernelScheduler;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KernelScheduler: KernelScheduler };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
