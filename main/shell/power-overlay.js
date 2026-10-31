/**
 * @file main/shell/power-overlay.js
 * @layer Shell
 * @owns  (DOM overlay) — registers listeners on KernelEvents
 *
 * Phase 4.3 — Full-screen sleep overlay.
 * Listens for power:sleep-started / power:sleep-ended events.
 * Any keydown or click while overlay is visible calls PowerService.wakeFromSleep().
 *
 * Classic script — shares lexical scope with other shell files.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p4.3';

  let _overlay = null;

  function injectStyles() {
    if (document.getElementById('power-overlay-styles')) return;
    const style = document.createElement('style');
    style.id = 'power-overlay-styles';
    style.textContent = [
      '#power-sleep-overlay {',
      '  position:fixed;inset:0;z-index:999998;',
      '  background:#000;',
      '  display:flex;align-items:center;justify-content:center;',
      '  opacity:0;transition:opacity 0.6s ease;',
      '  cursor:none;',
      '}',
      '#power-sleep-overlay.visible { opacity:1; }',
      '#power-sleep-cursor {',
      '  width:2px;height:1.2em;background:#4fc3f7;',
      '  animation:blink-cursor 1s step-end infinite;',
      '  font-size:24px;',
      '}',
      '@keyframes blink-cursor { 0%,100%{opacity:1} 50%{opacity:0} }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function showOverlay() {
    injectStyles();
    if (_overlay) return;

    _overlay = document.createElement('div');
    _overlay.id = 'power-sleep-overlay';
    _overlay.setAttribute('aria-hidden', 'true');
    _overlay.innerHTML = '<div id="power-sleep-cursor"></div>';
    document.body.appendChild(_overlay);

    // Trigger CSS transition
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        _overlay && _overlay.classList.add('visible');
      });
    });

    _overlay.addEventListener('click', wakeUp, { once: false });
    document.addEventListener('keydown', wakeUp, { once: false });
  }

  function hideOverlay() {
    if (!_overlay) return;
    _overlay.classList.remove('visible');
    document.removeEventListener('keydown', wakeUp);

    const el = _overlay;
    _overlay = null;

    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 650);
  }

  function wakeUp() {
    if (root.PowerService && typeof root.PowerService.wakeFromSleep === 'function') {
      root.PowerService.wakeFromSleep();
    }
  }

  function init() {
    if (!root.KernelEvents || typeof root.KernelEvents.on !== 'function') return;

    root.KernelEvents.on('power:sleep-started', function () {
      showOverlay();
    });

    root.KernelEvents.on('power:sleep-ended', function () {
      hideOverlay();
    });

    root.KernelEvents.on('power:hibernate-started', function () {
      showOverlay();
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  root.PowerOverlay = { version: VERSION, show: showOverlay, hide: hideOverlay };

}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
