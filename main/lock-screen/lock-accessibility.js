/**
 * @file main/lock-screen/lock-accessibility.js
 * @description Accessibility bar, On-Screen Keyboard, Power controls, and Network monitor for LockScreenV2.
 *
 * Node-loadable for testing. All DOM operations guarded with typeof document !== 'undefined'.
 */
(function (root) {
  'use strict';

  var VERSION = '20261101.p-polish';

  var _mounted = false;
  var _oskVisible = false;
  var _powerVisible = false;
  var _a11yVisible = false;
  var _netTooltipVisible = false;
  var _capsLock = false;
  var _shift = false;
  var _clockInterval = null;
  var _activeInput = null;

  var _a11yState = {
    highContrast: false,
    largeText: false,
    reduceMotion: false
  };

  function el(tag, className, text) {
    if (typeof document === 'undefined') return null;
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function getTargetInput() {
    if (typeof document === 'undefined') return null;
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      return active;
    }
    if (_activeInput && document.body.contains(_activeInput)) {
      return _activeInput;
    }
    var pwd = document.getElementById('lock-password');
    if (pwd && !pwd.disabled && pwd.offsetParent !== null) return pwd;
    var user = document.getElementById('lock-username');
    if (user && !user.disabled && user.offsetParent !== null) return user;
    return pwd || user || null;
  }

  function insertText(target, char) {
    if (!target) return;
    target.focus();
    var start = target.selectionStart != null ? target.selectionStart : target.value.length;
    var end = target.selectionEnd != null ? target.selectionEnd : start;
    var val = target.value || '';
    target.value = val.slice(0, start) + char + val.slice(end);
    target.selectionStart = target.selectionEnd = start + char.length;
    try {
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
  }

  function deleteChar(target) {
    if (!target) return;
    target.focus();
    var start = target.selectionStart != null ? target.selectionStart : target.value.length;
    var end = target.selectionEnd != null ? target.selectionEnd : start;
    var val = target.value || '';
    if (start === end && start > 0) {
      target.value = val.slice(0, start - 1) + val.slice(end);
      target.selectionStart = target.selectionEnd = start - 1;
    } else if (start < end) {
      target.value = val.slice(0, start) + val.slice(end);
      target.selectionStart = target.selectionEnd = start;
    }
    try {
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
  }

  /* -------------------------------------------------------------
   * On-Screen Keyboard (OSK)
   * ------------------------------------------------------------- */
  var OSK_LAYOUT = [
    [
      { normal: '`', shift: '~' },
      { normal: '1', shift: '!' },
      { normal: '2', shift: '@' },
      { normal: '3', shift: '#' },
      { normal: '4', shift: '$' },
      { normal: '5', shift: '%' },
      { normal: '6', shift: '^' },
      { normal: '7', shift: '&' },
      { normal: '8', shift: '*' },
      { normal: '9', shift: '(' },
      { normal: '0', shift: ')' },
      { normal: '-', shift: '_' },
      { normal: '=', shift: '+' },
      { action: 'backspace', label: '⌫ Back', wide: true }
    ],
    [
      { action: 'tab', label: 'Tab ⇥', wide: true },
      { normal: 'q', shift: 'Q' },
      { normal: 'w', shift: 'W' },
      { normal: 'e', shift: 'E' },
      { normal: 'r', shift: 'R' },
      { normal: 't', shift: 'T' },
      { normal: 'y', shift: 'Y' },
      { normal: 'u', shift: 'U' },
      { normal: 'i', shift: 'I' },
      { normal: 'o', shift: 'O' },
      { normal: 'p', shift: 'P' },
      { normal: '[', shift: '{' },
      { normal: ']', shift: '}' },
      { normal: '\\', shift: '|' }
    ],
    [
      { action: 'caps', label: 'Caps Lock', wide: true },
      { normal: 'a', shift: 'A' },
      { normal: 's', shift: 'S' },
      { normal: 'd', shift: 'D' },
      { normal: 'f', shift: 'F' },
      { normal: 'g', shift: 'G' },
      { normal: 'h', shift: 'H' },
      { normal: 'j', shift: 'J' },
      { normal: 'k', shift: 'K' },
      { normal: 'l', shift: 'L' },
      { normal: ';', shift: ':' },
      { normal: "'", shift: '"' },
      { action: 'enter', label: '↵ Enter', wide: true }
    ],
    [
      { action: 'shift', label: '⇧ Shift', wider: true },
      { normal: 'z', shift: 'Z' },
      { normal: 'x', shift: 'X' },
      { normal: 'c', shift: 'C' },
      { normal: 'v', shift: 'V' },
      { normal: 'b', shift: 'B' },
      { normal: 'n', shift: 'N' },
      { normal: 'm', shift: 'M' },
      { normal: ',', shift: '<' },
      { normal: '.', shift: '>' },
      { normal: '/', shift: '?' },
      { action: 'shift', label: '⇧ Shift', wider: true }
    ],
    [
      { action: 'space', label: 'Space', space: true }
    ]
  ];

  function renderOSKKeys(container) {
    if (!container) return;
    container.textContent = '';

    OSK_LAYOUT.forEach(function (row) {
      var rowEl = el('div', 'lock-osk-row');
      row.forEach(function (keyDef) {
        var keyBtn = el('button', 'lock-osk-key');
        keyBtn.type = 'button';
        keyBtn.tabIndex = -1; // keep focus on active input

        if (keyDef.wide) keyBtn.classList.add('wide');
        if (keyDef.wider) keyBtn.classList.add('wider');
        if (keyDef.space) keyBtn.classList.add('space');

        if (keyDef.action) {
          keyBtn.textContent = keyDef.label;
          keyBtn.dataset.oskAction = keyDef.action;
          if (keyDef.action === 'caps' && _capsLock) keyBtn.classList.add('active-mod');
          if (keyDef.action === 'shift' && _shift) keyBtn.classList.add('active-mod');
        } else {
          var char = (_shift || _capsLock) ? keyDef.shift : keyDef.normal;
          keyBtn.textContent = char;
          keyBtn.dataset.char = char;
          keyBtn.dataset.normal = keyDef.normal;
          keyBtn.dataset.shift = keyDef.shift;
        }

        keyBtn.addEventListener('pointerdown', function (e) {
          e.preventDefault(); // prevent losing focus from target input
          handleKey(keyDef);
        });

        rowEl.appendChild(keyBtn);
      });
      container.appendChild(rowEl);
    });
  }

  function handleKey(keyDef) {
    var target = getTargetInput();

    if (keyDef.action === 'backspace') {
      deleteChar(target);
    } else if (keyDef.action === 'caps') {
      _capsLock = !_capsLock;
      updateOSKLabels();
    } else if (keyDef.action === 'shift') {
      _shift = !_shift;
      updateOSKLabels();
    } else if (keyDef.action === 'space') {
      insertText(target, ' ');
    } else if (keyDef.action === 'tab') {
      var form = document.getElementById('lock-credentials-form');
      if (form) {
        var inputs = Array.prototype.slice.call(form.querySelectorAll('input:not([disabled])'));
        var idx = inputs.indexOf(target);
        if (idx !== -1 && inputs.length > 1) {
          var next = inputs[(idx + 1) % inputs.length];
          next.focus();
          _activeInput = next;
        }
      }
    } else if (keyDef.action === 'enter') {
      var signinBtn = document.getElementById('lock-signin-btn');
      if (signinBtn) signinBtn.click();
    } else {
      var char = (_shift || _capsLock) ? keyDef.shift : keyDef.normal;
      insertText(target, char);
      if (_shift) {
        _shift = false;
        updateOSKLabels();
      }
    }
  }

  function updateOSKLabels() {
    var osk = document.getElementById('lock-osk');
    if (!osk) return;
    var keys = osk.querySelectorAll('.lock-osk-key');
    Array.prototype.forEach.call(keys, function (k) {
      if (k.dataset.oskAction === 'caps') {
        k.classList.toggle('active-mod', _capsLock);
      } else if (k.dataset.oskAction === 'shift') {
        k.classList.toggle('active-mod', _shift);
      } else if (k.dataset.normal && k.dataset.shift) {
        var ch = (_shift || _capsLock) ? k.dataset.shift : k.dataset.normal;
        k.textContent = ch;
        k.dataset.char = ch;
      }
    });
  }

  function makeDraggable(handle, target) {
    if (!handle || !target) return;
    var isDragging = false;
    var startX, startY, initLeft, initTop;

    handle.addEventListener('pointerdown', function (e) {
      if (e.target && e.target.closest && e.target.closest('.lock-osk-close')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      var rect = target.getBoundingClientRect();
      initLeft = rect.left;
      initTop = rect.top;
      target.style.transform = 'none';
      target.style.left = initLeft + 'px';
      target.style.top = initTop + 'px';
      target.style.bottom = 'auto';
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', function (e) {
      if (!isDragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      var newLeft = Math.max(10, Math.min(window.innerWidth - target.offsetWidth - 10, initLeft + dx));
      var newTop = Math.max(10, Math.min(window.innerHeight - target.offsetHeight - 10, initTop + dy));
      target.style.left = newLeft + 'px';
      target.style.top = newTop + 'px';
    });

    function endDrag(e) {
      if (isDragging) {
        isDragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    }

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  function setupOSK() {
    var osk = document.getElementById('lock-osk');
    if (!osk) return;

    osk.textContent = '';
    var header = el('div', 'lock-osk-header');
    var title = el('span', 'lock-osk-title', '⌨ On-Screen Keyboard');
    var close = el('button', 'lock-osk-close', '×');
    close.type = 'button';
    close.title = 'Close Keyboard';
    close.addEventListener('click', function () {
      LockAccessibility.hideOSK();
    });

    header.appendChild(title);
    header.appendChild(close);
    osk.appendChild(header);

    var keysContainer = el('div', 'lock-osk-body');
    osk.appendChild(keysContainer);
    renderOSKKeys(keysContainer);

    makeDraggable(header, osk);

    // Track last focused input for the OSK
    document.addEventListener('focusin', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        _activeInput = e.target;
      }
    });
  }

  /* -------------------------------------------------------------
   * System Tray Controls
   * ------------------------------------------------------------- */

  function isNetOnline() {
    if (root.NetService && typeof root.NetService.isOnline === 'function') {
      return root.NetService.isOnline();
    }
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
    return true;
  }

  function updateNetStatus() {
    var dot = document.getElementById('lock-net-dot');
    var text = document.getElementById('lock-net-text');
    var online = isNetOnline();
    if (dot) dot.className = 'lock-net-dot' + (online ? '' : ' offline');
    if (text) text.textContent = online ? 'Online' : 'Offline';
  }

  function updateTrayClock() {
    var clockEl = document.getElementById('lock-tray-clock');
    if (!clockEl) return;
    var now = new Date();
    var h = String(now.getHours()).padStart(2, '0');
    var m = String(now.getMinutes()).padStart(2, '0');
    clockEl.textContent = h + ':' + m;
  }

  function setupTray() {
    var tray = document.getElementById('lock-tray');
    if (!tray) return;

    tray.textContent = '';

    // 1. Network status pill
    var netBtn = el('button', 'lock-tray-btn lock-tray-net', null);
    netBtn.type = 'button';
    netBtn.title = 'Network status';
    netBtn.setAttribute('aria-label', 'Network status');
    var netDot = el('span', 'lock-net-dot');
    netDot.id = 'lock-net-dot';
    var netIcon = el('span', 'lock-tray-icon', '🌐');
    var netText = el('span', 'lock-tray-label', 'Online');
    netText.id = 'lock-net-text';
    netBtn.appendChild(netDot);
    netBtn.appendChild(netIcon);
    netBtn.appendChild(netText);

    // Network popup info
    var netPopup = el('div', 'lock-tray-popup lock-net-popup');
    netPopup.id = 'lock-net-popup';
    netPopup.hidden = true;
    netPopup.innerHTML =
      '<div class="lock-popup-title">Network & Internet</div>' +
      '<div class="lock-popup-row"><span>Status:</span> <strong id="lock-net-status-label">Virtual Net Active</strong></div>' +
      '<div class="lock-popup-row"><span>Interface:</span> <code>r3d-vnet0</code></div>' +
      '<div class="lock-popup-row"><span>Gateway:</span> <code>10.0.0.1</code></div>';
    tray.appendChild(netPopup);

    netBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      _netTooltipVisible = !_netTooltipVisible;
      netPopup.hidden = !_netTooltipVisible;
      _powerVisible = false;
      _a11yVisible = false;
      syncPopups();
    });
    tray.appendChild(netBtn);

    // 2. On-screen keyboard button
    var oskBtn = el('button', 'lock-tray-btn lock-tray-osk', null);
    oskBtn.type = 'button';
    oskBtn.title = 'On-Screen Keyboard';
    oskBtn.setAttribute('aria-label', 'On-Screen Keyboard');
    var oskIcon = el('span', 'lock-tray-icon', '⌨');
    var oskLabel = el('span', 'lock-tray-label', 'Keyboard');
    oskBtn.appendChild(oskIcon);
    oskBtn.appendChild(oskLabel);
    oskBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      LockAccessibility.toggleOSK();
    });
    tray.appendChild(oskBtn);

    // 3. Accessibility menu button
    var a11yBtn = el('button', 'lock-tray-btn lock-tray-a11y', null);
    a11yBtn.type = 'button';
    a11yBtn.title = 'Accessibility options';
    a11yBtn.setAttribute('aria-label', 'Accessibility');
    var a11yIcon = el('span', 'lock-tray-icon', '♿');
    a11yBtn.appendChild(a11yIcon);

    var a11yMenu = el('div', 'lock-a11y-menu');
    a11yMenu.id = 'lock-a11y-menu';
    a11yMenu.hidden = true;
    a11yMenu.innerHTML =
      '<div class="lock-a11y-menu-title">Accessibility</div>' +
      '<div class="lock-a11y-row"><span>High Contrast</span><button type="button" class="lock-a11y-toggle" id="a11y-high-contrast" aria-pressed="false"></button></div>' +
      '<div class="lock-a11y-row"><span>Large Text</span><button type="button" class="lock-a11y-toggle" id="a11y-large-text" aria-pressed="false"></button></div>' +
      '<div class="lock-a11y-row"><span>Reduce Motion</span><button type="button" class="lock-a11y-toggle" id="a11y-reduce-motion" aria-pressed="false"></button></div>';
    tray.appendChild(a11yMenu);

    a11yBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      _a11yVisible = !_a11yVisible;
      _powerVisible = false;
      _netTooltipVisible = false;
      syncPopups();
    });
    tray.appendChild(a11yBtn);

    // Hook up a11y toggles
    setupA11yToggles(a11yMenu);

    // 4. Power menu button
    var powerBtn = el('button', 'lock-tray-btn lock-tray-power', null);
    powerBtn.type = 'button';
    powerBtn.title = 'Power options';
    powerBtn.setAttribute('aria-label', 'Power');
    var powerIcon = el('span', 'lock-tray-icon', '⏻');
    powerBtn.appendChild(powerIcon);

    var powerMenu = el('div', 'lock-power-menu');
    powerMenu.id = 'lock-power-menu';
    powerMenu.hidden = true;

    var sleepItem = el('button', 'lock-power-menu-item');
    sleepItem.type = 'button';
    sleepItem.innerHTML = '<span class="pm-icon">🌙</span><span>Sleep</span>';
    sleepItem.addEventListener('click', function () {
      LockAccessibility.hidePowerMenu();
      if (root.PowerService && typeof root.PowerService.sleep === 'function') {
        root.PowerService.sleep();
      }
    });

    var restartItem = el('button', 'lock-power-menu-item');
    restartItem.type = 'button';
    restartItem.innerHTML = '<span class="pm-icon">🔄</span><span>Restart</span>';
    restartItem.addEventListener('click', function () {
      LockAccessibility.hidePowerMenu();
      if (typeof window !== 'undefined' && window.confirm && !window.confirm('Restart the computer?')) {
        return;
      }
      if (root.PowerService && typeof root.PowerService.restart === 'function') {
        root.PowerService.restart();
      } else if (typeof location !== 'undefined') {
        location.reload();
      }
    });

    var sep = el('div', 'lock-power-menu-separator');

    var shutdownItem = el('button', 'lock-power-menu-item');
    shutdownItem.type = 'button';
    shutdownItem.innerHTML = '<span class="pm-icon">⏻</span><span>Shut down</span>';
    shutdownItem.addEventListener('click', function () {
      LockAccessibility.hidePowerMenu();
      if (typeof window !== 'undefined' && window.confirm && !window.confirm('Shut down the computer?')) {
        return;
      }
      if (root.PowerService && typeof root.PowerService.shutdown === 'function') {
        root.PowerService.shutdown();
      }
      showShutdownCurtain();
    });

    powerMenu.appendChild(sleepItem);
    powerMenu.appendChild(restartItem);
    powerMenu.appendChild(sep);
    powerMenu.appendChild(shutdownItem);
    tray.appendChild(powerMenu);

    powerBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      _powerVisible = !_powerVisible;
      _a11yVisible = false;
      _netTooltipVisible = false;
      syncPopups();
    });
    tray.appendChild(powerBtn);

    // 5. Tray Live Clock
    var clockSpan = el('span', 'lock-tray-clock');
    clockSpan.id = 'lock-tray-clock';
    tray.appendChild(clockSpan);
    updateTrayClock();

    if (_clockInterval) clearInterval(_clockInterval);
    _clockInterval = setInterval(updateTrayClock, 1000);

    // Global click dismisses popups
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.lock-tray')) return;
      _powerVisible = false;
      _a11yVisible = false;
      _netTooltipVisible = false;
      syncPopups();
    });

    updateNetStatus();
  }

  function syncPopups() {
    if (typeof document === 'undefined') return;
    var pMenu = document.getElementById('lock-power-menu');
    var aMenu = document.getElementById('lock-a11y-menu');
    var nPopup = document.getElementById('lock-net-popup');
    if (pMenu) pMenu.hidden = !_powerVisible;
    if (aMenu) aMenu.hidden = !_a11yVisible;
    if (nPopup) nPopup.hidden = !_netTooltipVisible;
  }

  function setupA11yToggles(container) {
    if (!container) return;
    var screen = document.getElementById('lock-screen');

    var hcBtn = container.querySelector('#a11y-high-contrast');
    if (hcBtn) {
      hcBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _a11yState.highContrast = !_a11yState.highContrast;
        hcBtn.classList.toggle('active', _a11yState.highContrast);
        hcBtn.setAttribute('aria-pressed', _a11yState.highContrast ? 'true' : 'false');
        applyA11yClasses(screen);
      });
    }

    var ltBtn = container.querySelector('#a11y-large-text');
    if (ltBtn) {
      ltBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _a11yState.largeText = !_a11yState.largeText;
        ltBtn.classList.toggle('active', _a11yState.largeText);
        ltBtn.setAttribute('aria-pressed', _a11yState.largeText ? 'true' : 'false');
        applyA11yClasses(screen);
      });
    }

    var rmBtn = container.querySelector('#a11y-reduce-motion');
    if (rmBtn) {
      rmBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _a11yState.reduceMotion = !_a11yState.reduceMotion;
        rmBtn.classList.toggle('active', _a11yState.reduceMotion);
        rmBtn.setAttribute('aria-pressed', _a11yState.reduceMotion ? 'true' : 'false');
        applyA11yClasses(screen);
      });
    }
  }

  function applyA11yClasses(screen) {
    if (!screen) return;
    var tags = [];
    if (_a11yState.highContrast) tags.push('high-contrast');
    if (_a11yState.largeText) tags.push('large-text');
    if (_a11yState.reduceMotion) tags.push('reduce-motion');
    screen.setAttribute('data-lock-a11y', tags.join(' '));
  }

  function showShutdownCurtain() {
    if (typeof document === 'undefined') return;
    var old = document.getElementById('lock-shutdown-curtain');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var curtain = el('div', 'lock-shutdown-curtain');
    curtain.id = 'lock-shutdown-curtain';
    curtain.innerHTML =
      '<div class="lock-shutdown-content">' +
      '<div class="lock-shutdown-icon">⏻</div>' +
      '<h2>System is shut down</h2>' +
      '<p>Click anywhere or press any key to power on</p>' +
      '</div>';
    document.body.appendChild(curtain);

    function powerOn() {
      document.removeEventListener('keydown', powerOn);
      curtain.removeEventListener('click', powerOn);
      if (curtain.parentNode) curtain.parentNode.removeChild(curtain);
      if (typeof location !== 'undefined') location.reload();
    }

    setTimeout(function () {
      document.addEventListener('keydown', powerOn, { once: true });
      curtain.addEventListener('click', powerOn, { once: true });
    }, 500);
  }

  /* -------------------------------------------------------------
   * Public Controller Interface
   * ------------------------------------------------------------- */
  var LockAccessibility = {
    version: VERSION,
    ready: Promise.resolve(true),

    init: function () {
      if (typeof document === 'undefined') return;
      setupOSK();
      setupTray();

      window.addEventListener('online', updateNetStatus);
      window.addEventListener('offline', updateNetStatus);
      if (root.KernelEvents && typeof root.KernelEvents.on === 'function') {
        root.KernelEvents.on('net:online-changed', updateNetStatus);
        root.KernelEvents.on('power:shutdown', function (e) {
          if (e && e.reason === 'shutdown') showShutdownCurtain();
        });
      }

      _mounted = true;
    },

    showOSK: function () {
      if (typeof document === 'undefined') return;
      var osk = document.getElementById('lock-osk');
      if (!osk) return;
      osk.hidden = false;
      _oskVisible = true;
      var oskBtn = document.querySelector('.lock-tray-osk');
      if (oskBtn) oskBtn.classList.add('active');
      var target = getTargetInput();
      if (target) target.focus();
    },

    hideOSK: function () {
      if (typeof document === 'undefined') return;
      var osk = document.getElementById('lock-osk');
      if (!osk) return;
      osk.hidden = true;
      _oskVisible = false;
      var oskBtn = document.querySelector('.lock-tray-osk');
      if (oskBtn) oskBtn.classList.remove('active');
    },

    toggleOSK: function () {
      if (_oskVisible) this.hideOSK();
      else this.showOSK();
    },

    showPowerMenu: function () {
      _powerVisible = true;
      syncPopups();
    },

    hidePowerMenu: function () {
      _powerVisible = false;
      syncPopups();
    },

    togglePowerMenu: function () {
      _powerVisible = !_powerVisible;
      syncPopups();
    },

    diagnostics: function () {
      return {
        version: VERSION,
        mounted: _mounted,
        oskVisible: _oskVisible,
        powerVisible: _powerVisible,
        a11yVisible: _a11yVisible,
        online: isNetOnline()
      };
    }
  };

  root.LockAccessibility = Object.freeze(LockAccessibility);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LockAccessibility: LockAccessibility };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
