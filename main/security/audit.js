/**
 * @file main/security/audit.js
 * @layer L2 — Security
 * @owns  window.SecurityAudit
 * @needs [ 'KernelClock', 'KernelEvents' ]
 * @emits [ 'sec:audit' ]
 *
 * Spec reference: OS_FOUNDATION.md §3 (L2 Security), §6.1, §6.3
 *
 * Ring-buffered audit logging for all sensitive system & security operations.
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031';
  const MAX_AUDIT = 128;

  let _sequence = 0;
  const _entries = [];

  function getTime() {
    if (root.KernelClock && typeof root.KernelClock.now === 'function') {
      return root.KernelClock.now();
    }
    return Date.now();
  }

  function record(entry) {
    if (!entry || typeof entry !== 'object') return null;

    _sequence += 1;
    const recordObj = {
      id: 'aud-' + _sequence,
      timestamp: getTime(),
      action: String(entry.action || 'system:access'),
      result: entry.result === 'allow' || entry.result === 'deny' ? entry.result : (entry.result ? 'allow' : 'deny'),
      actor: entry.actor || { type: 'system', id: 'system' },
      resource: String(entry.resource || '*'),
      reason: String(entry.reason || 'standard-evaluation'),
      detail: entry.detail || null
    };

    _entries.push(recordObj);
    if (_entries.length > MAX_AUDIT) {
      _entries.shift();
    }

    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit('sec:audit', recordObj);
    } else if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
      try {
        document.dispatchEvent(new CustomEvent('system:audit', { detail: recordObj }));
      } catch (_) {}
    }

    return recordObj;
  }

  function getEntries(limit) {
    const lim = typeof limit === 'number' && limit > 0 ? limit : MAX_AUDIT;
    return _entries.slice(-lim);
  }

  function clear() {
    _entries.length = 0;
  }

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  const SecurityAudit = Object.freeze({
    version: VERSION,
    ready: ready,

    record: record,
    getEntries: getEntries,
    clear: clear,

    diagnostics: function () {
      return {
        version: VERSION,
        count: _entries.length,
        totalRecorded: _sequence
      };
    }
  });

  root.SecurityAudit = SecurityAudit;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SecurityAudit: SecurityAudit };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
