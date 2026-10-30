/**
 * @file main/kernel/process-table.js
 * @layer L3 — Kernel
 * @owns  window.KernelProcessTable
 * @needs [ 'KernelClock', 'KernelEvents', 'KernelLogger', 'OsError' ]
 * @emits [ 'proc:spawned', 'proc:exited', 'proc:crashed', 'proc:signal' ]
 *
 * Spec reference: OS_FOUNDATION.md §5.1, §6.1, §8 Phase 1.4
 *
 * Central in-memory process table tracking all active and exited processes.
 * Monotonic PID allocation, process lifecycle, signal dispatching, and window associations.
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031';

  let _pidCounter = 1000; // Monotonic PID counter; starts at 1000 (1 = init)
  const _table = new Map(); // pid -> process record
  const _windowToPid = new Map(); // windowId -> pid
  const _signalHandlers = new Map(); // pid -> Map<signal, handlerFn>

  function getTime() {
    if (root.KernelClock && typeof root.KernelClock.now === 'function') {
      return root.KernelClock.now();
    }
    return Date.now();
  }

  function getActiveUid() {
    if (root.SecurityUsers && typeof root.SecurityUsers.getCurrentUser === 'function') {
      const u = root.SecurityUsers.getCurrentUser();
      return (u && u.id) || 'owner';
    }
    if (root.ProfileService && typeof root.ProfileService.getActiveId === 'function') {
      return root.ProfileService.getActiveId();
    }
    return 'owner';
  }

  function spawn(spec) {
    if (!spec || typeof spec !== 'object') {
      spec = {};
    }

    _pidCounter += 1;
    const pid = _pidCounter;
    const startedAt = getTime();

    const record = {
      pid: pid,
      ppid: typeof spec.ppid === 'number' ? spec.ppid : 1,
      appId: String(spec.appId || 'unknown'),
      kind: spec.kind === 'service' || spec.kind === 'daemon' || spec.kind === 'task' ? spec.kind : 'app',
      name: String(spec.name || spec.appId || 'Process ' + pid),
      uid: String(spec.uid || getActiveUid()),
      state: 'running', // starting -> running
      exitCode: null,
      startedAt: startedAt,
      cwd: String(spec.cwd || 'C:\\Users\\' + (spec.uid || 'owner')),
      env: Object.assign({ PATH: 'C:\\Windows\\system32', USER: spec.uid || 'owner' }, spec.env),
      windows: Array.isArray(spec.windows) ? spec.windows.slice() : [],
      caps: Array.isArray(spec.caps) ? spec.caps.slice() : ['fs.read:user', 'fs.write:user'],
      stats: {
        cpuTicks: 0,
        memBytes: typeof spec.memBytes === 'number' ? spec.memBytes : 1024 * 1024 * 4, // 4MB simulated base
        syscalls: 0
      }
    };

    _table.set(pid, record);

    if (record.windows.length > 0) {
      for (let i = 0; i < record.windows.length; i += 1) {
        _windowToPid.set(record.windows[i], pid);
      }
    }

    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit('proc:spawned', {
        pid: pid,
        appId: record.appId,
        name: record.name,
        kind: record.kind,
        uid: record.uid,
        windows: record.windows
      }, { pid: pid });
    }

    return Object.assign({}, record);
  }

  function get(pid) {
    const rec = _table.get(Number(pid));
    return rec ? Object.assign({}, rec) : null;
  }

  function getByWindow(windowId) {
    const pid = _windowToPid.get(String(windowId));
    if (pid !== undefined) {
      return get(pid);
    }
    return null;
  }

  function list(filter) {
    const result = [];
    _table.forEach(function (rec) {
      if (filter && typeof filter === 'object') {
        if (filter.state && rec.state !== filter.state) return;
        if (filter.appId && rec.appId !== filter.appId) return;
        if (filter.kind && rec.kind !== filter.kind) return;
        if (filter.uid && rec.uid !== filter.uid) return;
      }
      result.push(Object.assign({}, rec));
    });
    return result;
  }

  function kill(pid, exitCode) {
    const rec = _table.get(Number(pid));
    if (!rec) return false;
    if (rec.state === 'exited') return true;

    rec.state = 'exited';
    rec.exitCode = exitCode !== undefined ? Number(exitCode) : 0;

    // Clean up window references
    for (let i = 0; i < rec.windows.length; i += 1) {
      _windowToPid.delete(rec.windows[i]);
    }

    // Clean up signal handlers and subscriptions
    _signalHandlers.delete(pid);
    if (root.KernelEvents && typeof root.KernelEvents.removeByPid === 'function') {
      root.KernelEvents.removeByPid(pid);
    }

    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit('proc:exited', {
        pid: pid,
        appId: rec.appId,
        name: rec.name,
        exitCode: rec.exitCode
      }, { pid: pid });
    }

    return true;
  }

  function signal(pid, sig) {
    const rec = _table.get(Number(pid));
    if (!rec || rec.state === 'exited') return false;

    const sigName = String(sig).toUpperCase();

    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit('proc:signal', {
        pid: pid,
        signal: sigName
      }, { pid: pid });
    }

    const handlers = _signalHandlers.get(pid);
    if (handlers && handlers.has(sigName)) {
      try {
        const handlerFn = handlers.get(sigName);
        const vetoed = handlerFn(sigName) === true;
        if (vetoed && sigName === 'SIGTERM') {
          return true; // Application vetoed termination
        }
      } catch (err) {
        if (root.KernelLogger) {
          root.KernelLogger.error('proc', 'Signal handler error on pid ' + pid, { err: err.message });
        }
      }
    }

    // Default signal semantics
    if (sigName === 'SIGKILL' || sigName === 'SIGTERM') {
      kill(pid, sigName === 'SIGKILL' ? -9 : 0);
    }

    return true;
  }

  function onSignal(pid, sig, handler) {
    if (typeof handler !== 'function') return false;
    const numPid = Number(pid);
    if (!_signalHandlers.has(numPid)) {
      _signalHandlers.set(numPid, new Map());
    }
    _signalHandlers.get(numPid).set(String(sig).toUpperCase(), handler);
    return true;
  }

  function attachWindow(pid, windowId) {
    const rec = _table.get(Number(pid));
    if (!rec) return false;
    const winStr = String(windowId);
    if (!rec.windows.includes(winStr)) {
      rec.windows.push(winStr);
    }
    _windowToPid.set(winStr, Number(pid));
    return true;
  }

  function detachWindow(windowId) {
    const winStr = String(windowId);
    const pid = _windowToPid.get(winStr);
    if (pid === undefined) return false;

    _windowToPid.delete(winStr);
    const rec = _table.get(pid);
    if (rec) {
      const idx = rec.windows.indexOf(winStr);
      if (idx !== -1) {
        rec.windows.splice(idx, 1);
      }
      // If it's an app process and has no windows remaining, terminate process
      if (rec.kind === 'app' && rec.windows.length === 0) {
        signal(pid, 'SIGTERM');
      }
    }
    return true;
  }

  function updateStats(pid, delta) {
    const rec = _table.get(Number(pid));
    if (!rec || !delta || typeof delta !== 'object') return;
    if (typeof delta.cpuTicks === 'number') rec.stats.cpuTicks += delta.cpuTicks;
    if (typeof delta.syscalls === 'number') rec.stats.syscalls += delta.syscalls;
    if (typeof delta.memBytes === 'number') rec.stats.memBytes = delta.memBytes;
  }

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  const KernelProcessTable = Object.freeze({
    version: VERSION,
    ready: ready,

    spawn: spawn,
    kill: kill,
    signal: signal,
    onSignal: onSignal,
    get: get,
    getByWindow: getByWindow,
    list: list,
    attachWindow: attachWindow,
    detachWindow: detachWindow,
    updateStats: updateStats,

    diagnostics: function () {
      let activeCount = 0;
      let exitedCount = 0;
      _table.forEach(function (rec) {
        if (rec.state === 'running') activeCount += 1;
        else exitedCount += 1;
      });
      return {
        version: VERSION,
        totalTracked: _table.size,
        activeCount: activeCount,
        exitedCount: exitedCount,
        lastPid: _pidCounter
      };
    }
  });

  root.KernelProcessTable = KernelProcessTable;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KernelProcessTable: KernelProcessTable };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
