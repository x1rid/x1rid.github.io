/**
 * @file main/kernel/platform/clock.js
 * @layer L0 — Platform
 * @owns  window.KernelClock
 * @needs [] — no dependencies
 * @emits []
 *
 * Spec reference: OS_FOUNDATION.md §7 Rule 3, §13, §6.1
 *
 * Provides a virtualizable, deterministic source of time for the OS.
 * Never use Date.now() directly for user-visible or simulated operations.
 *
 * Modes:
 *   - 'realtime': tracks real host Date.now() + offset (default)
 *   - 'fixed': frozen timestamp (for deterministic test mode / snapshots)
 *
 * Node-loadable for unit testing via standard guard.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031';

  let _mode = 'realtime'; // 'realtime' | 'fixed'
  let _fixedTs = null;
  let _offsetMs = 0;

  // Check test mode flag in browser environment
  if (typeof root.location !== 'undefined' && root.location.search) {
    try {
      const params = new URLSearchParams(root.location.search);
      if (params.get('test') === '1') {
        _mode = 'fixed';
        _fixedTs = 1730000000000; // Deterministic test timestamp (2024-10-27T03:33:20.000Z)
      }
    } catch (_) {}
  }

  function now() {
    if (_mode === 'fixed') {
      return _fixedTs;
    }
    return Date.now() + _offsetMs;
  }

  function isoNow() {
    return new Date(now()).toISOString();
  }

  function setFixed(ts) {
    if (ts === null || ts === undefined) {
      _mode = 'realtime';
      _fixedTs = null;
    } else {
      _mode = 'fixed';
      _fixedTs = Number(ts);
    }
  }

  function setOffset(deltaMs) {
    _offsetMs = Number(deltaMs) || 0;
  }

  function reset() {
    _mode = 'realtime';
    _fixedTs = null;
    _offsetMs = 0;
  }

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  const KernelClock = Object.freeze({
    version: VERSION,
    ready: ready,

    now: now,
    isoNow: isoNow,
    mode: function () { return _mode; },
    setFixed: setFixed,
    setOffset: setOffset,
    reset: reset,

    diagnostics: function () {
      return {
        version: VERSION,
        mode: _mode,
        now: now(),
        isoNow: isoNow(),
        offsetMs: _offsetMs,
        fixedTs: _fixedTs
      };
    }
  });

  root.KernelClock = KernelClock;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KernelClock: KernelClock };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
