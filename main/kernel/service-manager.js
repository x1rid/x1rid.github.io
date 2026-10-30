/**
 * @file main/kernel/service-manager.js
 * @layer L3 — Kernel
 * @owns  window.KernelServiceManager, window.KernelReady
 * @needs [ 'KernelClock', 'KernelEvents', 'KernelLogger', 'OsError' ]
 * @emits [ 'sys:service-started', 'sys:service-stopped', 'sys:service-error' ]
 *
 * Spec reference: OS_FOUNDATION.md §5.7, §6.1, §8 Phase 1.6
 *
 * Declarative Service Dependency Manager and Boot Orchestrator.
 * Resolves dependency order for kernel/system services, tracks readiness,
 * and exports window.KernelReady.
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031';

  const _services = new Map(); // name -> { name, needs, start, stop, state, readyPromise, resolveReady }
  let _bootSequence = [];

  function OsErr(code, msg, detail) {
    if (root.OsError) {
      return new root.OsError(code, msg, detail);
    }
    const e = new Error(msg || code);
    e.code = code;
    e.detail = detail;
    return e;
  }

  function register(name, def) {
    const sName = String(name || '').trim();
    if (!sName) throw OsErr('EINVAL', 'Invalid service name');
    if (_services.has(sName)) return;

    let res;
    let rej;
    const readyP = new Promise(function (resolve, reject) {
      res = resolve;
      rej = reject;
    });

    const record = {
      name: sName,
      needs: Array.isArray(def.needs) ? def.needs.map(String) : [],
      start: typeof def.start === 'function' ? def.start : async function () {},
      stop: typeof def.stop === 'function' ? def.stop : async function () {},
      state: 'registered', // registered | starting | running | stopped | error
      readyPromise: readyP,
      resolveReady: res,
      rejectReady: rej,
      startedAt: null
    };

    _services.set(sName, record);
  }

  async function start(name, visited) {
    const sName = String(name || '').trim();
    const rec = _services.get(sName);
    if (!rec) {
      // Check if global exists directly on window (e.g. KernelEvents, VFS)
      if (root[sName] && root[sName].ready) {
        await root[sName].ready;
        return;
      }
      throw OsErr('ENOENT', 'Service not registered: ' + sName);
    }

    if (rec.state === 'running') return rec.readyPromise;
    if (rec.state === 'starting') return rec.readyPromise;

    const visiting = visited ? new Set(visited) : new Set();
    if (visiting.has(sName)) {
      throw OsErr('EINVAL', 'Circular service dependency detected: ' + sName);
    }
    visiting.add(sName);

    // 1. Resolve and start dependencies first
    for (let i = 0; i < rec.needs.length; i += 1) {
      const depName = rec.needs[i];
      await start(depName, visiting);
    }

    // 2. Start this service
    rec.state = 'starting';
    try {
      const startRes = await rec.start();
      rec.state = 'running';
      rec.startedAt = root.KernelClock ? root.KernelClock.now() : Date.now();
      rec.resolveReady(startRes);

      if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
        root.KernelEvents.emit('sys:service-started', { service: sName });
      }

      _bootSequence.push(sName);
      return startRes;
    } catch (err) {
      rec.state = 'error';
      rec.rejectReady(err);
      if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
        root.KernelEvents.emit('sys:service-error', { service: sName, error: err.message });
      }
      throw err;
    }
  }

  async function startAll() {
    const list = Array.from(_services.keys());
    for (let i = 0; i < list.length; i += 1) {
      await start(list[i]);
    }
  }

  async function stop(name) {
    const rec = _services.get(String(name));
    if (!rec || rec.state !== 'running') return false;

    rec.state = 'stopping';
    try {
      await rec.stop();
      rec.state = 'stopped';
      if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
        root.KernelEvents.emit('sys:service-stopped', { service: rec.name });
      }
      return true;
    } catch (err) {
      rec.state = 'error';
      throw err;
    }
  }

  function get(name) {
    const rec = _services.get(String(name));
    if (!rec) return null;
    return {
      name: rec.name,
      needs: rec.needs.slice(),
      state: rec.state,
      startedAt: rec.startedAt
    };
  }

  function list() {
    return Array.from(_services.values()).map(function (rec) {
      return {
        name: rec.name,
        needs: rec.needs.slice(),
        state: rec.state,
        startedAt: rec.startedAt
      };
    });
  }

  // Define KernelReady promise
  let kernelReadyResolve;
  const KernelReady = new Promise(function (resolve) {
    kernelReadyResolve = resolve;
  });

  const KernelServiceManager = Object.freeze({
    version: VERSION,
    ready: Promise.resolve(),

    register: register,
    start: start,
    startAll: startAll,
    stop: stop,
    get: get,
    list: list,

    diagnostics: function () {
      return {
        version: VERSION,
        registeredCount: _services.size,
        bootSequence: _bootSequence.slice()
      };
    }
  });

  // Auto-register and mark core subsystems ready
  register('KernelPlatform', {
    needs: [],
    start: async function () {
      if (root.KernelErrors) await root.KernelErrors.ready;
      if (root.KernelClock) await root.KernelClock.ready;
      if (root.KernelLogger) await root.KernelLogger.ready;
    }
  });

  register('KernelEvents', {
    needs: ['KernelPlatform'],
    start: async function () {
      if (root.KernelEvents) await root.KernelEvents.ready;
    }
  });

  register('Security', {
    needs: ['KernelEvents'],
    start: async function () {
      if (root.SecurityPermissions) await root.SecurityPermissions.ready;
    }
  });

  register('KernelProcessTable', {
    needs: ['Security'],
    start: async function () {
      if (root.KernelProcessTable) await root.KernelProcessTable.ready;
    }
  });

  register('KernelSyscalls', {
    needs: ['KernelProcessTable'],
    start: async function () {
      if (root.KernelSyscalls) await root.KernelSyscalls.ready;
    }
  });

  // Kick off startAll and resolve KernelReady once complete
  startAll().then(function () {
    kernelReadyResolve();
    if (root.KernelLogger && typeof root.KernelLogger.info === 'function') {
      root.KernelLogger.info('boot', 'Kernel subsystems initialized and KernelReady resolved');
    }
  }).catch(function (err) {
    console.error('[KernelServiceManager] Core subsystem boot failed:', err);
  });

  root.KernelServiceManager = KernelServiceManager;
  root.KernelReady = KernelReady;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KernelServiceManager: KernelServiceManager, KernelReady: KernelReady };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
