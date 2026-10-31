/* Event Viewer App — main/apps/event-viewer/app.js
 * Shows KernelDB audit log entries + live KernelEvents stream.
 */
(function () {
  'use strict';
  const APP_ID = 'event-viewer';

  function createUI(win) {
    const root = win.root;
    root.innerHTML = '';
    root.style.cssText = 'display:flex;flex-direction:column;height:100%;font-family:monospace;background:#0d0d0d;color:#e0e0e0;';

    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;gap:8px;padding:6px 10px;border-bottom:1px solid #333;align-items:center;';
    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = '↺ Refresh';
    refreshBtn.style.cssText = 'background:#6c63ff;color:#fff;border:none;padding:4px 10px;cursor:pointer;font-family:monospace;font-size:11px;';
    const filterInput = document.createElement('input');
    filterInput.placeholder = 'Filter by type…';
    filterInput.style.cssText = 'flex:1;background:#111;border:1px solid #333;color:#e0e0e0;padding:4px;font-family:monospace;font-size:11px;';
    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(filterInput);

    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'flex:1;overflow:auto;';
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr style="background:#111;"><th style="padding:4px 8px;text-align:left;border-bottom:1px solid #333;color:#888;">TIME</th><th style="padding:4px 8px;text-align:left;border-bottom:1px solid #333;color:#888;">TYPE</th><th style="padding:4px 8px;text-align:left;border-bottom:1px solid #333;color:#888;">ACTOR</th><th style="padding:4px 8px;text-align:left;border-bottom:1px solid #333;color:#888;">ACTION</th><th style="padding:4px 8px;text-align:left;border-bottom:1px solid #333;color:#888;">OUTCOME</th></tr>';
    const tbody = document.createElement('tbody');
    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrap.appendChild(table);

    root.appendChild(toolbar);
    root.appendChild(tableWrap);

    let _allRows = [];

    function renderRows(filter) {
      tbody.innerHTML = '';
      const rows = filter ? _allRows.filter(function (r) {
        const f = filter.toLowerCase();
        return String(r.type || r.action || '').toLowerCase().includes(f);
      }) : _allRows;
      if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:12px;color:#555;text-align:center;">No events found.</td></tr>';
        return;
      }
      rows.forEach(function (entry) {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #1a1a1a';
        const ts = entry.ts ? new Date(entry.ts).toLocaleTimeString() : '--';
        const typeColor = entry.outcome === 'deny' ? '#ff4444' : (entry.type === 'audit' ? '#ffaa00' : '#55ff99');
        tr.innerHTML =
          '<td style="padding:3px 8px;color:#555;">' + ts + '</td>' +
          '<td style="padding:3px 8px;color:' + typeColor + ';">' + (entry.type || 'event') + '</td>' +
          '<td style="padding:3px 8px;color:#aaa;">' + (entry.actor || entry.uid || '') + '</td>' +
          '<td style="padding:3px 8px;">' + (entry.action || entry.syscall || entry.event || '') + '</td>' +
          '<td style="padding:3px 8px;color:' + (entry.outcome === 'deny' ? '#ff4444' : '#55ff99') + ';">' + (entry.outcome || 'ok') + '</td>';
        tbody.appendChild(tr);
      });
    }

    async function loadAudit() {
      _allRows = [];
      if (window.KernelDB && typeof window.KernelDB.getAll === 'function') {
        try {
          const audit = await window.KernelDB.getAll('audit');
          audit.forEach(function (a) {
            _allRows.push(Object.assign({ type: 'audit' }, a));
          });
        } catch (e) { /* ok */ }
      }
      // Also add live events from ring buffer if any
      _allRows.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      renderRows(filterInput.value.trim());
    }

    refreshBtn.addEventListener('click', loadAudit);
    filterInput.addEventListener('input', function () { renderRows(filterInput.value.trim()); });

    // Live events
    if (window.KernelEvents && typeof window.KernelEvents.on === 'function') {
      window.KernelEvents.on('*', function (event, data) {
        _allRows.unshift({ type: 'event', event: event, ts: Date.now(), outcome: 'ok', actor: '' });
        if (_allRows.length > 500) _allRows.pop();
        renderRows(filterInput.value.trim());
      });
    }

    loadAudit();
  }

  if (typeof window !== 'undefined' && window.OSApps && typeof window.OSApps.register === 'function') {
    window.OSApps.register(APP_ID, { mount: createUI });
  } else if (typeof window !== 'undefined') {
    window.addEventListener('os:apps-ready', function () {
      if (window.OSApps) window.OSApps.register(APP_ID, { mount: createUI });
    });
  }
}());
