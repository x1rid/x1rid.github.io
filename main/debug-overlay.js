/**
 * @file main/debug-overlay.js
 * @layer L0 (platform utility — display only)
 * @description ?debug=1 diagnostics overlay.
 *
 * Activated by appending ?debug=1 to the page URL.
 * Shows live diagnostics() output from every registered service.
 * Read-only: this file never modifies any service state.
 *
 * Usage: open index.html?debug=1
 */
(function (window) {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  if (!params.has('debug')) return;   // no-op in normal mode

  const VERSION = '20261031';

  // ── Services to inspect ─────────────────────────────────────────────────
  // Add new entries as services are created. The key is a display label;
  // the value is the path on window (dot-separated).
  const SERVICE_MAP = {
    'VFS': 'VFS',
    'ProfileService': 'ProfileService',
    'ProfileReady': null,           // Promise — show resolved/pending
    'VirtualFSReady': null,         // Promise — show resolved/pending
    'AppRegistry': 'AppRegistry',
    'SystemServices': 'SystemServices',
    'SystemConfig': 'SystemConfig',
    'ShellWM': 'ShellWM',
    // Phase 1+ additions:
    'KernelErrors': 'KernelErrors',
    'KernelClock': 'KernelClock',
    'KernelLogger': 'KernelLogger',
    'KernelEvents': 'KernelEvents',
    'Kernel': 'Kernel',
    'KernelReady': null,
  };

  // ── DOM setup ────────────────────────────────────────────────────────────
  function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'os-debug-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: '420px',
      maxHeight: '100vh',
      overflowY: 'auto',
      background: 'rgba(10, 10, 10, 0.92)',
      color: '#d4f5a8',
      fontFamily: '"Courier New", monospace',
      fontSize: '11px',
      lineHeight: '1.5',
      padding: '10px',
      boxSizing: 'border-box',
      zIndex: '2147483647',
      borderLeft: '2px solid #3a3',
      pointerEvents: 'auto',
    });

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'font-weight:bold;font-size:13px;border-bottom:1px solid #3a3;padding-bottom:4px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;';
    header.innerHTML = '<span>🛠 OS Debug Overlay</span><span style="font-size:10px;opacity:0.6">v' + VERSION + '</span>';
    overlay.appendChild(header);

    // Minimize button
    const minBtn = document.createElement('button');
    minBtn.textContent = '–';
    minBtn.title = 'Minimize overlay';
    Object.assign(minBtn.style, {
      position: 'absolute',
      top: '8px',
      right: '36px',
      background: 'none',
      border: '1px solid #3a3',
      color: '#d4f5a8',
      cursor: 'pointer',
      padding: '0 4px',
      fontSize: '12px',
    });
    let minimized = false;
    const content = document.createElement('div');
    content.id = 'os-debug-content';
    minBtn.addEventListener('click', function () {
      minimized = !minimized;
      content.style.display = minimized ? 'none' : '';
      minBtn.textContent = minimized ? '+' : '–';
    });
    overlay.appendChild(minBtn);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close overlay (reload without ?debug=1 to suppress)';
    Object.assign(closeBtn.style, {
      position: 'absolute',
      top: '8px',
      right: '10px',
      background: 'none',
      border: '1px solid #3a3',
      color: '#d4f5a8',
      cursor: 'pointer',
      padding: '0 4px',
      fontSize: '12px',
    });
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    overlay.appendChild(closeBtn);

    overlay.appendChild(content);
    document.body.appendChild(overlay);
    return content;
  }

  // ── Diagnostics helpers ──────────────────────────────────────────────────
  function resolve(path) {
    if (!path) return undefined;
    return path.split('.').reduce(function (o, k) { return o && o[k]; }, window);
  }

  function safeCallDiagnostics(svc) {
    try {
      if (typeof svc.diagnostics === 'function') {
        return svc.diagnostics();
      }
      return '(no diagnostics() method)';
    } catch (e) {
      return '(diagnostics() threw: ' + e.message + ')';
    }
  }

  function renderValue(v, depth) {
    depth = depth || 0;
    if (v === null) return '<span style="color:#888">null</span>';
    if (v === undefined) return '<span style="color:#888">undefined</span>';
    if (typeof v === 'boolean') return '<span style="color:#80d8ff">' + v + '</span>';
    if (typeof v === 'number') return '<span style="color:#ffcc80">' + v + '</span>';
    if (typeof v === 'string') return '<span style="color:#f48fb1">"' + escHtml(String(v).slice(0, 80)) + '"</span>';
    if (typeof v === 'object' && depth < 3) {
      const lines = [];
      for (const k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) {
          lines.push('<span style="color:#aaa">' + escHtml(k) + '</span>: ' + renderValue(v[k], depth + 1));
        }
      }
      return '{' + lines.join(', ') + '}';
    }
    return escHtml(String(v).slice(0, 120));
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Render loop ──────────────────────────────────────────────────────────
  function renderSection(label, data) {
    const html = [];
    html.push('<details open style="margin-bottom:6px;border-top:1px solid #2a2a2a;padding-top:4px;">');
    html.push('<summary style="cursor:pointer;color:#8f8;font-weight:bold;">' + escHtml(label) + '</summary>');
    html.push('<pre style="margin:2px 0 0 10px;white-space:pre-wrap;word-break:break-all;">' + renderValue(data) + '</pre>');
    html.push('</details>');
    return html.join('');
  }

  function collectAndRender(content) {
    const sections = [];

    // URL params
    const urlInfo = {};
    params.forEach(function (v, k) { urlInfo[k] = v; });
    sections.push(renderSection('URL Params', urlInfo));

    // Boot promises
    ['ProfileReady', 'VirtualFSReady', 'KernelReady'].forEach(function (name) {
      const p = window[name];
      if (!p) {
        sections.push(renderSection(name, '(not yet defined)'));
        return;
      }
      // Promise state is not synchronously readable; track with .then/.catch
      if (p && typeof p.then === 'function') {
        const key = '_dbg_resolved_' + name;
        if (!(key in window)) {
          window[key] = 'pending';
          p.then(function () { window[key] = 'resolved ✅'; })
           .catch(function (e) { window[key] = 'rejected ❌ ' + e.message; });
        }
        sections.push(renderSection(name, window[key]));
      }
    });

    // Services
    for (const label in SERVICE_MAP) {
      const path = SERVICE_MAP[label];
      if (!path) continue;   // handled above (Promises)
      const svc = resolve(path);
      if (!svc) {
        sections.push(renderSection(label, '(not loaded)'));
      } else {
        const data = safeCallDiagnostics(svc);
        sections.push(renderSection(label, data));
      }
    }

    content.innerHTML = sections.join('');
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  function init() {
    const content = buildOverlay();

    // Initial render after a short delay so services have time to init
    let refreshHandle;
    function scheduleRefresh() {
      clearTimeout(refreshHandle);
      refreshHandle = setTimeout(function () {
        collectAndRender(content);
        scheduleRefresh();   // keep refreshing every 2 s
      }, 2000);
    }

    // First render
    collectAndRender(content);
    scheduleRefresh();

    // Manual refresh button
    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = '↺ Refresh';
    Object.assign(refreshBtn.style, {
      display: 'block',
      margin: '6px 0',
      background: 'none',
      border: '1px solid #3a3',
      color: '#d4f5a8',
      cursor: 'pointer',
      padding: '2px 8px',
      fontSize: '11px',
      width: '100%',
    });
    refreshBtn.addEventListener('click', function () { collectAndRender(content); });
    content.insertBefore(refreshBtn, content.firstChild);
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
