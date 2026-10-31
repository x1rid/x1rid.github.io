/**
 * @file main/immersion/bios.js
 * @layer Shell (immersion)
 * @owns  window.BiosScreen
 *
 * Phase 4.4 — Fictional BIOS/UEFI POST screen.
 * Shown when URL contains ?bios=1 or ?restoring=hibernate.
 * Displays simulated hardware checks with typewriter effect.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p4.4';

  let _overlay = null;
  let _keyHandler = null;
  let _opts = null;

  const POST_LINES = [
    'UEFI BIOS v2.09.1402 — r3d1 Systems Inc.',
    'Copyright (C) 2026 r3d1 Technologies. All Rights Reserved.',
    '',
    'CPU: r3d1-X9 @ 4.20 GHz  [OK]',
    'RAM: 16384 MB DDR5-6000   [OK]',
    'GPU: r3d1 Arc 770         [OK]',
    'NVME: 2048 GB r3d1-Flash  [OK]',
    'NET:  r3d1 GigE           [OK]',
    '',
    'Initializing memory banks ............. OK',
    'Loading boot configuration ............ OK',
    'Detecting USB devices .................. OK',
    'Starting security subsystem ............ OK',
    '',
    'Boot device: NVME0 (r3d1-Flash 2TB)',
    'Loading OS kernel ...................... OK',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'Press F2 for BIOS Setup  |  F8 for Boot Menu  |  Any key to continue',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  ];

  function injectStyles() {
    if (document.getElementById('bios-screen-styles')) return;
    const style = document.createElement('style');
    style.id = 'bios-screen-styles';
    style.textContent = [
      '#bios-overlay {',
      '  position:fixed;inset:0;z-index:1000000;',
      '  background:#000;',
      '  color:#00c853;',
      '  font-family:"Cascadia Mono",monospace,Consolas,"Courier New";',
      '  font-size:13px;line-height:1.5;',
      '  padding:32px 40px;',
      '  box-sizing:border-box;',
      '  overflow:hidden;',
      '}',
      '#bios-content { white-space:pre; }',
      '#bios-content .bios-line { display:block; }',
      '#bios-content .bios-line.warn { color:#ffeb3b; }',
      '#bios-content .bios-line.hint { color:#4fc3f7; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function show(opts) {
    opts = opts || {};
    _opts = opts;
    injectStyles();
    if (_overlay) hide();

    _overlay = document.createElement('div');
    _overlay.id = 'bios-overlay';
    _overlay.setAttribute('aria-hidden', 'true');

    const content = document.createElement('div');
    content.id = 'bios-content';
    _overlay.appendChild(content);
    document.body.appendChild(_overlay);

    const allLines = POST_LINES.slice();
    if (opts.bootLog && Array.isArray(opts.bootLog)) {
      allLines.push('');
      allLines.push('── Boot Log ──────────────────────────────────────────────────');
      opts.bootLog.forEach(function (l) { allLines.push(String(l)); });
    }

    let lineIndex = 0;

    function addNextLine() {
      if (lineIndex >= allLines.length) {
        // Done printing — wait for key
        attachKeyHandler();
        return;
      }
      const text = allLines[lineIndex++];
      const span = document.createElement('span');
      span.className = 'bios-line';
      if (text.indexOf('Press F') === 0 || text.indexOf('━') === 0) span.classList.add('hint');
      span.innerHTML = escapeHtml(text) || '&nbsp;';
      content.appendChild(span);
      setTimeout(addNextLine, 80);
    }

    addNextLine();
  }

  function attachKeyHandler() {
    if (_keyHandler) return;
    _keyHandler = function (e) {
      if (e.key === 'F2') {
        // BIOS setup — fictional no-op for now
        return;
      }
      if (e.key === 'F8') {
        document.removeEventListener('keydown', _keyHandler);
        _keyHandler = null;
        if (root.BootMenuScreen && typeof root.BootMenuScreen.show === 'function') {
          root.BootMenuScreen.show({
            onSelect: function (entry) {
              if (_opts && typeof _opts.onContinue === 'function') _opts.onContinue(entry);
            }
          });
        }
        return;
      }
      // Any other key: continue boot
      document.removeEventListener('keydown', _keyHandler);
      _keyHandler = null;
      if (_opts && typeof _opts.onContinue === 'function') {
        _opts.onContinue('default');
      }
    };
    document.addEventListener('keydown', _keyHandler);
  }

  function hide() {
    if (_keyHandler) {
      document.removeEventListener('keydown', _keyHandler);
      _keyHandler = null;
    }
    if (_overlay && _overlay.parentNode) {
      _overlay.parentNode.removeChild(_overlay);
    }
    _overlay = null;
  }

  const ready = Promise.resolve(true);

  const BiosScreen = {
    version: VERSION,
    ready: ready,
    show: show,
    hide: hide,
    diagnostics: function () {
      return { version: VERSION, visible: _overlay !== null };
    }
  };

  root.BiosScreen = BiosScreen;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BiosScreen: BiosScreen };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
