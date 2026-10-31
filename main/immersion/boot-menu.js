/**
 * @file main/immersion/boot-menu.js
 * @layer Shell (immersion)
 * @owns  window.BootMenuScreen
 *
 * Phase 4.4 — Fictional boot selection menu.
 * Arrow-key navigation, Enter to select.
 * Called by BiosScreen when user presses F8.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p4.4';

  const BOOT_ENTRIES = [
    'Windows (default)',
    'Linux personality',
    'Safe mode'
  ];

  let _overlay = null;
  let _selectedIndex = 0;
  let _keyHandler = null;
  let _opts = null;

  function injectStyles() {
    if (document.getElementById('boot-menu-styles')) return;
    const style = document.createElement('style');
    style.id = 'boot-menu-styles';
    style.textContent = [
      '#boot-menu-overlay {',
      '  position:fixed;inset:0;z-index:1000001;',
      '  background:#000;color:#e0e0e0;',
      '  font-family:"Cascadia Mono",monospace,Consolas,"Courier New";',
      '  font-size:14px;',
      '  display:flex;flex-direction:column;align-items:center;justify-content:center;',
      '}',
      '#boot-menu-box {',
      '  border:2px solid #4fc3f7;padding:32px 48px;min-width:400px;',
      '}',
      '#boot-menu-box h2 {',
      '  color:#4fc3f7;text-transform:uppercase;letter-spacing:3px;',
      '  margin:0 0 24px;font-size:13px;',
      '}',
      '.boot-entry {',
      '  padding:8px 16px;cursor:pointer;',
      '  border-left:3px solid transparent;',
      '  margin-bottom:4px;',
      '}',
      '.boot-entry.selected {',
      '  border-left-color:#4fc3f7;color:#4fc3f7;background:rgba(79,195,247,0.08);',
      '}',
      '#boot-menu-hint {',
      '  margin-top:24px;font-size:11px;color:#888;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function renderEntries() {
    const list = _overlay.querySelector('#boot-entry-list');
    if (!list) return;
    list.innerHTML = '';
    BOOT_ENTRIES.forEach(function (entry, idx) {
      const div = document.createElement('div');
      div.className = 'boot-entry' + (idx === _selectedIndex ? ' selected' : '');
      div.textContent = (idx === _selectedIndex ? '► ' : '  ') + entry;
      div.addEventListener('click', function () {
        _selectedIndex = idx;
        selectEntry();
      });
      list.appendChild(div);
    });
  }

  function selectEntry() {
    const entry = BOOT_ENTRIES[_selectedIndex];
    cleanup();
    if (entry === 'Safe mode') {
      if (root.PowerService && typeof root.PowerService.safeMode === 'function') {
        root.PowerService.safeMode();
      }
      return;
    }
    if (_opts && typeof _opts.onSelect === 'function') {
      _opts.onSelect(entry);
    }
  }

  function cleanup() {
    if (_keyHandler) {
      document.removeEventListener('keydown', _keyHandler);
      _keyHandler = null;
    }
    if (_overlay && _overlay.parentNode) {
      _overlay.parentNode.removeChild(_overlay);
    }
    _overlay = null;
  }

  function show(opts) {
    opts = opts || {};
    _opts = opts;
    _selectedIndex = 0;
    injectStyles();
    if (_overlay) cleanup();

    _overlay = document.createElement('div');
    _overlay.id = 'boot-menu-overlay';
    _overlay.setAttribute('aria-label', 'Boot menu');
    _overlay.innerHTML = [
      '<div id="boot-menu-box">',
      '  <h2>Select Boot Option</h2>',
      '  <div id="boot-entry-list"></div>',
      '  <div id="boot-menu-hint">↑↓ Navigate  &nbsp;  Enter Select  &nbsp;  Esc Cancel</div>',
      '</div>'
    ].join('');
    document.body.appendChild(_overlay);
    renderEntries();

    _keyHandler = function (e) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        _selectedIndex = (_selectedIndex - 1 + BOOT_ENTRIES.length) % BOOT_ENTRIES.length;
        renderEntries();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        _selectedIndex = (_selectedIndex + 1) % BOOT_ENTRIES.length;
        renderEntries();
      } else if (e.key === 'Enter') {
        selectEntry();
      } else if (e.key === 'Escape') {
        cleanup();
        // Fall back to default boot
        if (_opts && typeof _opts.onSelect === 'function') {
          _opts.onSelect(BOOT_ENTRIES[0]);
        }
      }
    };
    document.addEventListener('keydown', _keyHandler);
  }

  function hide() {
    cleanup();
  }

  const ready = Promise.resolve(true);

  const BootMenuScreen = {
    version: VERSION,
    ready: ready,
    show: show,
    hide: hide,
    diagnostics: function () {
      return { version: VERSION, visible: _overlay !== null, entries: BOOT_ENTRIES };
    }
  };

  root.BootMenuScreen = BootMenuScreen;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BootMenuScreen: BootMenuScreen };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
