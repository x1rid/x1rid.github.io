/* crash-dialog.js — shell/crash-dialog.js
 * DOM layer only. Listens for process:crashed event and shows a
 * Windows-style crash dialog (the "something went wrong" box).
 * Shares lexical scope with other shell scripts.
 */
(function () {
  'use strict';

  function showCrashDialog(pid, reason) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#1a1a2e;border:2px solid #ff4444;padding:24px;max-width:420px;width:90%;font-family:monospace;color:#e0e0e0;';

    box.innerHTML =
      '<div style="color:#ff4444;font-size:16px;font-weight:bold;margin-bottom:12px;">⚠ APPLICATION CRASH</div>' +
      '<div style="font-size:12px;color:#aaa;margin-bottom:8px;">Process ID: <strong style="color:#e0e0e0;">' + pid + '</strong></div>' +
      '<div style="font-size:12px;margin-bottom:16px;border-left:3px solid #ff4444;padding-left:8px;color:#ffb3b3;">' + String(reason || 'Unknown error').replace(/</g, '&lt;') + '</div>' +
      '<div style="font-size:11px;color:#666;margin-bottom:16px;">The process has been terminated. Any unsaved data in this process is lost.</div>' +
      '<div style="display:flex;gap:8px;">' +
      '<button id="_crash_ok" style="flex:1;background:#6c63ff;color:#fff;border:none;padding:6px;cursor:pointer;font-family:monospace;">OK</button>' +
      '<button id="_crash_details" style="flex:1;background:none;border:1px solid #555;color:#aaa;padding:6px;cursor:pointer;font-family:monospace;">Details</button>' +
      '</div>' +
      '<div id="_crash_detail_box" style="display:none;margin-top:12px;font-size:11px;color:#888;border:1px solid #333;padding:8px;max-height:120px;overflow-y:auto;"></div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelector('#_crash_ok').addEventListener('click', function () {
      overlay.remove();
    });
    box.querySelector('#_crash_details').addEventListener('click', function () {
      const detailBox = box.querySelector('#_crash_detail_box');
      detailBox.style.display = detailBox.style.display === 'none' ? 'block' : 'none';
      detailBox.textContent = 'PID: ' + pid + '\nReason: ' + reason + '\nTimestamp: ' + new Date().toISOString();
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
  }

  // Listen for process crashes
  if (typeof window !== 'undefined') {
    window.addEventListener('load', function () {
      if (window.KernelEvents && typeof window.KernelEvents.on === 'function') {
        window.KernelEvents.on('process:crashed', function (data) {
          showCrashDialog(data.pid, data.reason);
        });
      }
    });
  }

  if (typeof window !== 'undefined') {
    window.CrashDialog = { show: showCrashDialog };
  }
}());
