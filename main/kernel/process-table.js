/**
 * @file main/kernel/process-table.js
 * @layer L3 — Kernel
 * @owns  window.KernelProcessTable
 * @needs [ 'KernelClock', 'KernelEvents', 'KernelLogger', 'OsError' ]
 * @emits [ 'proc:spawned', 'proc:exited', 'proc:crashed', 'proc:signal' ]
 *
 * Spec reference: OS_FOUNDATION.md §5.1, §6.1, §8 Phase 1.4 + Phase 3 (3.2 / 3.3)
 *
 * Phase 3 changes vs Phase 1:
 *   - caps are set at spawn and default to [] (default-deny). Legacy callers must pass caps.
 *   - SIGTERM can be vetoed ONCE per process (handler returns true / resolves true).
 *   - crash(pid, err): state -> 'zombie', emits proc:crashed. kill() on a zombie reaps it.
 *   - setReaper(fn): the app registry closes windows when a process dies.
 *   - snapshots are deep-ish copies (caps/windows/env/stats) so callers can't mutate the table.
 *   - summary(): process count + total memory for sys.info / Task Manager.
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p3';

  let _pidCounter = 1000; // Monotonic PID counter; starts at 1000 (1 = init)
  const _table = new Map(); // pid -> process record
  const _windowToPid = new Map(); // windowId -> pid
  const _signalHandlers = new Map(); // pid -> Map<signal, handlerFn>
  const _vetoUsed = new Set(); // pids that already used their one SIGTERM veto
  let _reaper = null; // fn(recordSnapshot, windowIds) called after a process dies

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

  function emit(name, payload, meta) {
    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      try { root.KernelEvents.emit(name, payload, meta); } catch (_) {}
    }
  }

  function audit(entry) {
    if (root.SecurityAudit && typeof root.SecurityAudit.record === 'function') {
      try { root.SecurityAudit.record(entry); } catch (_) {}
    }
  }

  function logError(msg, data) {
    if (root.KernelLogger && typeof root.KernelLogger.error === 'function') {
      root.KernelLogger.error('proc', msg, data);
    }
  }

  function snapshot(rec) {
    return Object.assign({}, rec, {
      env: Object.assign({}, rec.env),
      windows: rec.windows.slice(),
      caps: rec.caps.slice(),
      stats: Object.assign({}, rec.stats)
    });
  }

  function spawn(spec) {
    if (!spec || typeof spec !== 'object') {
      spec = {};
    }

    _pidCounter += 1;
    const pid = _pidCounter;
    const startedAt = getTime();
    const uid = String(spec.uid || getActiveUid());

    const record = {
      pid: pid,
      ppid: typeof spec.ppid === 'number' ? spec.ppid : 1,
      appId: String(spec.appId || 'unknown'),
      kind: spec.kind === 'service' || spec.kind === 'daemon' || spec.kind === 'task' ? spec.kind : 'app',
      name: String(spec.name || spec.appId || 'Process ' + pid),
      uid: uid,
      state: 'running', // starting -> running
      exitCode: null,
      startedAt: startedAt,
      cwd: String(spec.cwd || 'C:\\Users\\' + uid),
      env: Object.assign({ PATH: 'C:\\Windows\\system32', USER: uid }, spec.env),
      windows: Array.isArray(spec.windows) ? spec.windows.slice() : [],
      // Phase 3: default-deny. Only what the spawner explicitly grants.
      caps: Array.isArray(spec.caps) ? spec.caps.map(String) : [],
      stats: {
        cpuTicks: 0,
        memBytes: typeof spec.memBytes === 'number' ? spec.memBytes : 1024 * 1024 * 4, // 4MB simulated base
        syscalls: 0
      }
    };

    _table.set(pid, record);

    for (let i = 0; i < record.windows.length; i += 1) {
      _windowToPid.set(record.windows[i], pid);
    }

    emit('proc:spawned', {
      pid: pid,
      appId: record.appId,
      name: record.name,
      kind: record.kind,
      uid: record.uid,
      windows: record.windows.slice(),
      caps: record.caps.slice()
    }, { pid: pid });

    audit({
      action: 'proc:spawn',
      resource: record.appId,
      actor: { type: 'process', pid: record.ppid, uid: record.uid },
      result: 'allow',
      detail: { pid: pid, caps: record.caps.slice() }
    });

    return snapshot(record);
  }

  function get(pid) {
    const rec = _table.get(Number(pid));
    return rec ? snapshot(rec) : null;
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
        if (filter.pid !== undefined && rec.pid !== Number(filter.pid)) return;
        if (filter.state && rec.state !== filter.state) return;
        if (filter.appId && rec.appId !== filter.appId) return;
        if (filter.kind && rec.kind !== filter.kind) return;
        if (filter.uid && rec.uid !== filter.uid) return;
      }
      result.push(snapshot(rec));
    });
    return result;
  }

  function releaseResources(pid, rec) {
    const windowIds = rec.windows.slice();
    for (let i = 0; i < windowIds.length; i += 1) {
      _windowToPid.delete(windowIds[i]);
    }
    rec.windows = [];
    _signalHandlers.delete(pid);
    _vetoUsed.delete(pid);
    if (root.KernelEvents && typeof root.KernelEvents.removeByPid === 'function') {
      try { root.KernelEvents.removeByPid(pid); } catch (_) {}
    }
    return windowIds;
  }

  function kill(pid, exitCode) {
    const numPid = Number(pid);
    const rec = _table.get(numPid);
    if (!rec) return false;
    if (rec.state === 'exited') return true;

    const wasZombie = rec.state === 'zombie';
    rec.state = 'exited';
    if (!(wasZombie && exitCode === undefined)) {
      rec.exitCode = exitCode !== undefined ? Number(exitCode) : 0;
    }

    const windowIds = releaseResources(numPid, rec);

    emit('proc:exited', {
      pid: numPid,
      appId: rec.appId,
      name: rec.name,
      exitCode: rec.exitCode
    }, { pid: numPid });

    if (typeof _reaper === 'function' && windowIds.length) {
      try { _reaper(snapshot(rec), windowIds); } catch (err) { logError('Reaper error on pid ' + numPid, { err: err && err.message }); }
    }

    return true;
  }

  // An uncaught error inside an app: process becomes a zombie until it is reaped (kill).
  function crash(pid, err) {
    const numPid = Number(pid);
    const rec = _table.get(numPid);
    if (!rec || rec.state === 'exited' || rec.state === 'zombie') return false;

    rec.state = 'zombie';
    rec.exitCode = -1;
    _signalHandlers.delete(numPid);
    _vetoUsed.delete(numPid);
    if (root.KernelEvents && typeof root.KernelEvents.removeByPid === 'function') {
      try { root.KernelEvents.removeByPid(numPid); } catch (_) {}
    }

    const message = err && err.message ? String(err.message) : String(err || 'unknown error');
    logError('Process ' + numPid + ' (' + rec.appId + ') crashed', { err: message });
    emit('proc:crashed', {
      pid: numPid,
      appId: rec.appId,
      name: rec.name,
      error: message
    }, { pid: numPid });
    audit({
      action: 'proc:crash',
      resource: rec.appId,
      actor: { type: 'process', pid: numPid, uid: rec.uid },
      result: 'error',
      reason: message
    });
    return true;
  }

  function runHandler(numPid, handlerFn, sigName) {
    try {
      return handlerFn(sigName);
    } catch (err) {
      logError('Signal handler error on pid ' + numPid, { err: err && err.message });
      return false;
    }
  }

  function signal(pid, sig) {
    const numPid = Number(pid);
    const rec = _table.get(numPid);
    if (!rec || rec.state === 'exited') return false;

    const sigName = String(sig).toUpperCase();

    emit('proc:signal', { pid: numPid, signal: sigName }, { pid: numPid });

    // Zombies can't handle anything: any signal reaps them.
    if (rec.state === 'zombie') {
      kill(numPid);
      return true;
    }

    if (sigName === 'SIGKILL') {
      kill(numPid, -9);
      return true;
    }

    const handlers = _signalHandlers.get(numPid);
    const handlerFn = handlers && handlers.get(sigName);

    if (sigName !== 'SIGTERM') {
      if (handlerFn) runHandler(numPid, handlerFn, sigName);
      return true;
    }

    // SIGTERM: handler may veto ONCE by returning true (or a promise resolving true).
    if (!handlerFn || _vetoUsed.has(numPid)) {
      kill(numPid, 0);
      return true;
    }

    const decide = function (value) {
      const cur = _table.get(numPid);
      if (!cur || cur.state !== 'running') return;
      if (value === true && !_vetoUsed.has(numPid)) {
        _vetoUsed.add(numPid); // vetoed: stays running, next SIGTERM goes through
      } else {
        kill(numPid, 0);
      }
    };

    const result = runHandler(numPid, handlerFn, sigName);
    if (result && typeof result.then === 'function') {
      result.then(decide, function (err) {
        logError('Async signal handler failed on pid ' + numPid, { err: err && err.message });
        decide(false);
      });
    } else {
      decide(result);
    }
    return true;
  }

  function onSignal(pid, sig, handler) {
    if (typeof handler !== 'function') return false;
    const numPid = Number(pid);
    if (!_table.has(numPid)) return false;
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

  // Window closed. With no windows left an app process ends: SIGTERM is delivered
  // so the app can flush state, then the process is ended regardless (its window is
  // already gone, so a veto would just leave an orphan). Vetoes apply to explicit signals.
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
      if (rec.kind === 'app' && rec.windows.length === 0 && rec.state !== 'exited') {
        if (rec.state === 'running') signal(pid, 'SIGTERM');
        const after = _table.get(pid);
        if (after && after.state !== 'exited') kill(pid, after.state === 'zombie' ? undefined : 0);
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

  function setReaper(fn) {
    _reaper = typeof fn === 'function' ? fn : null;
    return true;
  }

  function summary() {
    let running = 0;
    let zombies = 0;
    let totalMemBytes = 0;
    let totalSyscalls = 0;
    _table.forEach(function (rec) {
      if (rec.state === 'running') running += 1;
      if (rec.state === 'zombie') zombies += 1;
      if (rec.state === 'running' || rec.state === 'zombie') {
        totalMemBytes += rec.stats.memBytes;
      }
      totalSyscalls += rec.stats.syscalls;
    });
    return {
      processCount: running + zombies,
      runningCount: running,
      zombieCount: zombies,
      totalMemBytes: totalMemBytes,
      totalSyscalls: totalSyscalls
    };
  }

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  const KernelProcessTable = Object.freeze({
    version: VERSION,
    ready: ready,

    spawn: spawn,
    kill: kill,
    crash: crash,
    signal: signal,
    onSignal: onSignal,
    get: get,
    getByWindow: getByWindow,
    list: list,
    attachWindow: attachWindow,
    detachWindow: detachWindow,
    updateStats: updateStats,
    setReaper: setReaper,
    summary: summary,

    diagnostics: function () {
      let activeCount = 0;
      let exitedCount = 0;
      let zombieCount = 0;
      _table.forEach(function (rec) {
        if (rec.state === 'running') activeCount += 1;
        else if (rec.state === 'zombie') zombieCount += 1;
        else exitedCount += 1;
      });
      return {
        version: VERSION,
        totalTracked: _table.size,
        activeCount: activeCount,
        zombieCount: zombieCount,
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
