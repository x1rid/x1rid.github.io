/**
 * @file main/security/elevation.js
 * @layer L2 — Security
 * @owns  window.ElevationService
 * @needs [ 'KernelEvents', 'SecurityAudit' ]
 * @emits [ 'elevation:request-pending', 'elevation:request-approved', 'elevation:request-denied' ]
 *
 * Phase 4.1 — UAC/su/sudo fictional elevation service.
 * Provides audited elevation prompts. The DOM dialog is in shell/elevation-dialog.js.
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p4.1';

  // Elevated PIDs: pid -> token
  const _elevatedPids = new Map();
  // Tokens: token -> pid
  const _tokens = new Map();

  function shortUuid() {
    // Simple short UUID without crypto dependency for Node compat
    const hex = 'abcdef0123456789';
    let id = '';
    for (let i = 0; i < 16; i++) {
      id += hex[Math.floor(Math.random() * 16)];
    }
    return 'elev-' + id.slice(0, 8) + '-' + id.slice(8);
  }

  function emit(event, data) {
    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit(event, data);
    }
  }

  function auditRecord(action, pid, result, reason) {
    if (root.SecurityAudit && typeof root.SecurityAudit.record === 'function') {
      try {
        root.SecurityAudit.record({
          action: action,
          resource: 'elevation',
          actor: { type: 'process', pid: pid },
          result: result,
          reason: reason || 'user-prompt'
        });
      } catch (_) {}
    }
  }

  /**
   * Show UAC-style dialog in browser or auto-resolve in Node.
   * Returns Promise<boolean> — true = granted.
   */
  function showPrompt(pid, reason) {
    // Node test environment: auto-grant if env var set, else deny
    if (typeof window === 'undefined') {
      const autoGrant = (typeof process !== 'undefined' && process.env && process.env.ELEVATION_AUTO_GRANT === '1');
      return Promise.resolve(autoGrant);
    }

    // Browser: delegate to ElevationDialog if available, else auto-deny
    if (root.ElevationDialog && typeof root.ElevationDialog.show === 'function') {
      return root.ElevationDialog.show({ pid: pid, reason: reason });
    }

    // Fallback if dialog not loaded yet: deny
    return Promise.resolve(false);
  }

  /**
   * request(pid, reason) → Promise<{ granted: bool, token: string|null }>
   */
  async function request(pid, reason) {
    const safePid = typeof pid === 'number' ? pid : 0;
    const safeReason = String(reason || 'Unknown operation');

    emit('elevation:request-pending', { pid: safePid, reason: safeReason });

    const granted = await showPrompt(safePid, safeReason);

    if (granted) {
      const token = shortUuid();
      _elevatedPids.set(safePid, token);
      _tokens.set(token, safePid);
      auditRecord('elevation:grant', safePid, 'allow', safeReason);
      emit('elevation:request-approved', { pid: safePid, token: token, reason: safeReason });
      return { granted: true, token: token };
    } else {
      auditRecord('elevation:deny', safePid, 'deny', safeReason);
      emit('elevation:request-denied', { pid: safePid, reason: safeReason });
      return { granted: false, token: null };
    }
  }

  /**
   * revoke(token) — removes elevation for the token's pid
   */
  function revoke(token) {
    if (!token || !_tokens.has(token)) return;
    const pid = _tokens.get(token);
    _tokens.delete(token);
    if (_elevatedPids.get(pid) === token) {
      _elevatedPids.delete(pid);
    }
    emit('elevation:revoked', { pid: pid, token: token });
  }

  /**
   * isElevated(pid) → boolean
   */
  function isElevated(pid) {
    return _elevatedPids.has(pid);
  }

  const ready = Promise.resolve(true);

  const ElevationService = {
    version: VERSION,
    ready: ready,
    request: request,
    revoke: revoke,
    isElevated: isElevated,
    diagnostics: function () {
      return {
        version: VERSION,
        elevatedPids: Array.from(_elevatedPids.keys()),
        tokenCount: _tokens.size
      };
    }
  };

  root.ElevationService = ElevationService;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ElevationService: ElevationService };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
