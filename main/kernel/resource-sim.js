/**
 * @file main/kernel/resource-sim.js
 * @layer L3 — Kernel
 * @owns  window.ResourceSim
 * @needs [ 'KernelEvents', 'KernelProcessTable', 'KernelScheduler' ]
 * @emits [ 'process:crashed', 'resource-sim:tick' ]
 *
 * Phase 5.3 — Process Resource Simulation.
 * Assigns fake CPU% and RAM to each process on spawn. KernelScheduler ticks
 * every 2s to jitter values ±2%. Exposes crash(pid, reason) for intentional
 * process crashes.
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p5.3';
  const TICK_INTERVAL_MS = 2000;

  // Map of pid -> { cpu, ram, crashed }
  const _resources = new Map();
  let _tickCount = 0;
  let _tickHandle = null;

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  function emit(event, payload) {
    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit(event, payload);
    }
  }

  function _randBetween(min, max) {
    return Math.round(min + Math.random() * (max - min));
  }

  function _jitter(val, range, min, max) {
    const delta = _randBetween(-range, range);
    return Math.min(max, Math.max(min, val + delta));
  }

  /**
   * Initialize resources for a newly spawned process.
   * @param {number} pid
   * @param {object} [opts]  { baseCpu, baseRam }
   */
  function init(pid, opts) {
    opts = opts || {};
    _resources.set(pid, {
      pid: pid,
      cpu: opts.baseCpu !== undefined ? opts.baseCpu : _randBetween(0, 12),
      ram: opts.baseRam !== undefined ? opts.baseRam : _randBetween(16, 256),
      crashed: false,
      crashReason: null
    });
  }

  /**
   * Remove resources for a pid (when process exits normally).
   * @param {number} pid
   */
  function remove(pid) {
    _resources.delete(pid);
  }

  /**
   * Get resource snapshot for one pid.
   * @param {number} pid
   */
  function get(pid) {
    const r = _resources.get(pid);
    return r ? Object.assign({}, r) : null;
  }

  /**
   * List all resource snapshots.
   */
  function list() {
    const out = [];
    _resources.forEach(function (r) { out.push(Object.assign({}, r)); });
    return out;
  }

  /**
   * Simulate a process crash.
   * @param {number} pid
   * @param {string} reason
   */
  function crash(pid, reason) {
    const r = _resources.get(pid);
    if (r) {
      r.crashed = true;
      r.crashReason = reason || 'Unknown error';
      r.cpu = 0;
    }
    emit('process:crashed', { pid: pid, reason: reason || 'Unknown error' });
    // Also ask process table to kill/zombie the pid
    if (root.KernelProcessTable && typeof root.KernelProcessTable.kill === 'function') {
      try { root.KernelProcessTable.kill(pid, 'SIGKILL'); } catch (e) { /* ok */ }
    }
  }

  /**
   * Tick: jitter all CPU/RAM values slightly.
   */
  function tick() {
    _tickCount++;
    _resources.forEach(function (r) {
      if (!r.crashed) {
        r.cpu = _jitter(r.cpu, 2, 0, 99);
        r.ram = _jitter(r.ram, 8, 8, 512);
      }
    });
    emit('resource-sim:tick', { tick: _tickCount, processes: list() });
  }

  /**
   * Start the background tick timer.
   */
  function startTick() {
    if (_tickHandle !== null) return;
    if (typeof setInterval !== 'undefined') {
      _tickHandle = setInterval(tick, TICK_INTERVAL_MS);
    }
  }

  /**
   * Stop the background tick timer.
   */
  function stopTick() {
    if (_tickHandle !== null && typeof clearInterval !== 'undefined') {
      clearInterval(_tickHandle);
      _tickHandle = null;
    }
  }

  // Auto-attach to process-table spawn/exit events
  function _attach() {
    if (!root.KernelEvents) return;
    root.KernelEvents.on('process:spawned', function (data) {
      if (data && data.pid) init(data.pid);
    });
    root.KernelEvents.on('process:exited', function (data) {
      if (data && data.pid) remove(data.pid);
    });
  }

  if (root.KernelEvents) {
    _attach();
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', function () {
      _attach();
      startTick();
    });
  }

  const ResourceSim = Object.freeze({
    version: VERSION,
    ready: ready,
    init: init,
    remove: remove,
    get: get,
    list: list,
    crash: crash,
    tick: tick,
    startTick: startTick,
    stopTick: stopTick,
    diagnostics: function () {
      return { version: VERSION, processCount: _resources.size, tickCount: _tickCount, tickActive: _tickHandle !== null };
    }
  });

  root.ResourceSim = ResourceSim;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ResourceSim: ResourceSim };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
