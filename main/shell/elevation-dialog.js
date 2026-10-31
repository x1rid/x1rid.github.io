/**
 * @file main/shell/elevation-dialog.js
 * @layer Shell
 * @owns  window.ElevationDialog
 *
 * Phase 4.1 — UAC-style fictional elevation dialog.
 * Provides a DOM modal that ElevationService.request() calls in the browser.
 * Services never touch DOM; this shell file is the DOM-touching layer.
 *
 * Classic script — shares lexical scope with other shell files.
 * Depends on: toast() from notifications.js (optional)
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p4.1';

  function injectStyles() {
    if (document.getElementById('elevation-dialog-styles')) return;
    const style = document.createElement('style');
    style.id = 'elevation-dialog-styles';
    style.textContent = [
      '#elevation-overlay {',
      '  position:fixed;inset:0;z-index:99999;',
      '  background:rgba(0,0,0,0.65);',
      '  display:flex;align-items:center;justify-content:center;',
      '  font-family:var(--font-mono,"Cascadia Mono",monospace);',
      '}',
      '#elevation-box {',
      '  background:#1a1a2e;border:2px solid #4fc3f7;',
      '  border-radius:4px;padding:24px 32px;min-width:360px;max-width:520px;',
      '  color:#e0e0e0;box-shadow:0 8px 32px rgba(0,0,0,0.8);',
      '}',
      '#elevation-box h2 {',
      '  margin:0 0 8px;font-size:14px;color:#4fc3f7;',
      '  text-transform:uppercase;letter-spacing:2px;',
      '}',
      '#elevation-box .elev-shield {',
      '  font-size:32px;margin-bottom:8px;display:block;',
      '}',
      '#elevation-box .elev-reason {',
      '  margin:12px 0;font-size:12px;color:#aaa;word-break:break-word;',
      '  background:#111;padding:8px;border-left:3px solid #4fc3f7;',
      '}',
      '#elevation-box .elev-warn {',
      '  font-size:11px;color:#ff8a65;margin-bottom:16px;',
      '}',
      '#elevation-box .elev-actions {',
      '  display:flex;gap:12px;justify-content:flex-end;',
      '}',
      '#elevation-box button {',
      '  padding:6px 20px;border:1px solid currentColor;cursor:pointer;',
      '  font-size:12px;font-family:inherit;border-radius:2px;',
      '}',
      '#elevation-box .elev-yes {',
      '  background:#4fc3f7;color:#000;border-color:#4fc3f7;',
      '}',
      '#elevation-box .elev-no {',
      '  background:transparent;color:#e0e0e0;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  /**
   * show({ pid, reason }) → Promise<boolean>
   * Resolves true if user clicked Yes, false otherwise.
   */
  function show(opts) {
    opts = opts || {};
    const pid = opts.pid || 0;
    const reason = String(opts.reason || 'An application requires elevated privileges.');

    return new Promise(function (resolve) {
      injectStyles();

      const overlay = document.createElement('div');
      overlay.id = 'elevation-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'elevation-title');

      overlay.innerHTML = [
        '<div id="elevation-box">',
        '  <span class="elev-shield" aria-hidden="true">🛡️</span>',
        '  <h2 id="elevation-title">Elevation Request</h2>',
        '  <p style="font-size:12px;margin:0 0 4px;">',
        '    Process <code>PID&nbsp;' + pid + '</code> is requesting elevated privileges.',
        '  </p>',
        '  <div class="elev-reason">' + escapeHtml(reason) + '</div>',
        '  <p class="elev-warn">⚠ Only allow if you trust this operation.</p>',
        '  <div class="elev-actions">',
        '    <button class="elev-no" id="elevation-no" aria-label="Deny elevation">No</button>',
        '    <button class="elev-yes" id="elevation-yes" aria-label="Allow elevation">Yes</button>',
        '  </div>',
        '</div>'
      ].join('');

      document.body.appendChild(overlay);

      function cleanup(result) {
        document.body.removeChild(overlay);
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }

      function onKey(e) {
        if (e.key === 'Escape') { cleanup(false); }
        if (e.key === 'Enter') { cleanup(true); }
      }

      overlay.querySelector('#elevation-yes').addEventListener('click', function () { cleanup(true); });
      overlay.querySelector('#elevation-no').addEventListener('click', function () { cleanup(false); });
      document.addEventListener('keydown', onKey);

      // Focus the No button by default (secure UX: default-deny)
      overlay.querySelector('#elevation-no').focus();
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const ElevationDialog = {
    version: VERSION,
    show: show
  };

  root.ElevationDialog = ElevationDialog;

}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
