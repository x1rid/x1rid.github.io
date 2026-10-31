/**
 * @file main/lock-screen/session-lock.js
 * @layer Shell (lock presentation)
 *
 * Ubuntu GNOME-style active-session lock (Super+L). It is a shield laid over
 * the running desktop: windows, apps, VFS and the active profile are never
 * touched. It owns presentation only and reuses:
 *   - ProfileService.lockSession / unlockSession / peekSessionLock
 *     (unlockSession verifies through ProfileService.authenticate)
 *   - ProfileUI.setSessionLocked (inert + ShortcutService "locked" context)
 *   - ProfileWindowState.flushActive (persist window layout before locking)
 *   - KernelClock + LockScreenV2 clock preferences
 *
 * Public API: window.SessionLock
 *   lock({ restore })  unlock()  isLocked()  getState()  getPresentation()
 *   showAuthentication()  showClock()
 *   LOCK_STATES  PRESENTATION_STATES  createStateMachine()  formatTime()  formatDate()
 *
 * The state machine and formatters are DOM-free so Node tests can load them.
 */
(function (root) {
  'use strict';

  const LOCK_STATES = Object.freeze({
    UNLOCKED: 'unlocked',
    LOCKING: 'locking',
    LOCKED: 'locked',
    AUTHENTICATING: 'authenticating',
    AUTH_FAILED: 'auth_failed',
    UNLOCKING: 'unlocking'
  });

  const PRESENTATION_STATES = Object.freeze({
    CLOCK: 'clock',
    AUTHENTICATION: 'authentication'
  });

  const TRANSITIONS = Object.freeze({
    unlocked: ['locking', 'locked'],
    locking: ['locked'],
    locked: ['authenticating'],
    authenticating: ['auth_failed', 'unlocking', 'locked'],
    auth_failed: ['authenticating', 'locked'],
    unlocking: ['unlocked']
  });

  const S = LOCK_STATES;
  const P = PRESENTATION_STATES;

  const ERROR_TEXT = 'Sorry, that didn\u2019t work. Please try again.';
  const UNAVAILABLE_TEXT = 'Authentication is unavailable. Please try again.';
  const AUTH_IDLE_MS = 30000;
  const SHIELD_MS = 420;

  function createStateMachine(onChange) {
    const machine = {
      state: S.UNLOCKED,
      presentation: P.CLOCK,
      can(next) {
        return (TRANSITIONS[this.state] || []).indexOf(next) !== -1;
      },
      transition(next) {
        if (!this.can(next)) return false;
        const previous = this.state;
        this.state = next;
        if (next === S.UNLOCKED || next === S.LOCKING) this.presentation = P.CLOCK;
        if (typeof onChange === 'function') onChange(this.state, this.presentation, previous);
        return true;
      },
      setPresentation(next) {
        if (next !== P.CLOCK && next !== P.AUTHENTICATION) return false;
        if (this.state === S.UNLOCKED || this.state === S.LOCKING || this.state === S.UNLOCKING) {
          return false;
        }
        if (this.state === S.AUTHENTICATING && next === P.CLOCK) return false;
        if (next === this.presentation) return true;
        const previous = this.state;
        if (next === P.CLOCK && this.state === S.AUTH_FAILED) this.state = S.LOCKED;
        this.presentation = next;
        if (typeof onChange === 'function') onChange(this.state, this.presentation, previous);
        return true;
      },
      isLocked() {
        return this.state !== S.UNLOCKED;
      }
    };
    return machine;
  }

  function prefers12h(locale) {
    try {
      return Boolean(new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12);
    } catch (_) {
      return false;
    }
  }

  function formatTime(date, prefs, locale) {
    const options = prefs || {};
    const twelve = options.format === '12h' ? true
      : options.format === '24h' ? false
        : prefers12h(locale);
    const fmt = twelve
      ? { hour: 'numeric', minute: '2-digit', hour12: true }
      : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    if (options.showSeconds) fmt.second = '2-digit';
    return date.toLocaleTimeString(locale, fmt);
  }

  function formatDate(date, locale) {
    return date.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function now() {
    const clock = root.KernelClock;
    if (clock && typeof clock.now === 'function') {
      const value = Number(clock.now());
      if (Number.isFinite(value)) return new Date(value);
    }
    return new Date();
  }

  function locale() {
    const nav = root.navigator;
    return (nav && (nav.languages && nav.languages[0] || nav.language)) || undefined;
  }

  function isPrintable(event) {
    return typeof event.key === 'string' && event.key.length === 1 &&
      !event.ctrlKey && !event.metaKey && !event.altKey;
  }

  const MODIFIER_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'OS', 'CapsLock', 'NumLock',
    'ScrollLock', 'Fn', 'AltGraph', 'Dead', 'Unidentified'];

  const ICONS = {
    network: 'M12 18.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM4.2 11.6a11 11 0 0 1 15.6 0l-1.5 1.5a8.9 8.9 0 0 0-12.6 0zM7.4 14.8a6.5 6.5 0 0 1 9.2 0l-1.5 1.5a4.4 4.4 0 0 0-6.2 0zM1 8.4a15.5 15.5 0 0 1 22 0l-1.5 1.5a13.4 13.4 0 0 0-19 0z',
    volume: 'M3 9h4l5-4v14l-5-4H3zM15.5 8.5a5 5 0 0 1 0 7l-1.4-1.4a3 3 0 0 0 0-4.2zM18.3 5.7a9 9 0 0 1 0 12.6l-1.4-1.4a7 7 0 0 0 0-9.8z',
    battery: 'M8 4h8v2h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2zM7 8v12h10V8z M8.5 12h7v6.5h-7z',
    power: 'M11 3h2v10h-2zM7.05 6.05l1.41 1.41A6 6 0 1 0 15.54 7.46l1.41-1.41A8 8 0 1 1 7.05 6.05z',
    arrow: 'M5 11h10.2l-4.6-4.6L12 5l7 7-7 7-1.4-1.4 4.6-4.6H5z',
    chevron: 'M6.4 15.4 12 9.8l5.6 5.6L19 14l-7-7-7 7z'
  };

  function svg(name, size) {
    const ns = 'http://www.w3.org/2000/svg';
    const node = root.document.createElementNS(ns, 'svg');
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('width', String(size || 16));
    node.setAttribute('height', String(size || 16));
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('focusable', 'false');
    const path = root.document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[name]);
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('fill-rule', 'evenodd');
    node.appendChild(path);
    return node;
  }

  function el(tag, className, attrs) {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function reducedMotion() {
    try {
      return root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
      return false;
    }
  }

  function wait(ms) {
    return new Promise(function (resolve) { root.setTimeout(resolve, ms); });
  }

  const SessionLock = {
    LOCK_STATES: LOCK_STATES,
    PRESENTATION_STATES: PRESENTATION_STATES,
    TRANSITIONS: TRANSITIONS,
    createStateMachine: createStateMachine,
    formatTime: formatTime,
    formatDate: formatDate,

    _machine: null,
    _root: null,
    _nodes: null,
    _clockTimer: null,
    _idleTimer: null,
    _profile: null,
    _returnFocus: null,
    _keysBound: false,

    init() {
      if (this._machine) return;
      this._machine = createStateMachine(this._onStateChange.bind(this));
      this._bindKeys();
    },

    getState() { return this._machine ? this._machine.state : S.UNLOCKED; },
    getPresentation() { return this._machine ? this._machine.presentation : P.CLOCK; },
    isLocked() { return Boolean(this._machine && this._machine.isLocked()); },

    /* ── DOM ─────────────────────────────────────────────────────────── */

    _ensureDom() {
      if (this._root) return this._root;
      const doc = root.document;
      const lock = el('div', 'gnome-lock', {
        id: 'session-lock',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Screen locked',
        tabindex: '-1'
      });
      lock.hidden = true;

      const backdrop = el('div', 'gnome-lock-backdrop', { 'aria-hidden': 'true' });
      const wallpaper = el('div', 'gnome-lock-wallpaper');
      backdrop.append(wallpaper, el('div', 'gnome-lock-dim'));

      const topbar = el('div', 'gnome-lock-topbar', { 'aria-hidden': 'true' });
      const indicators = el('div', 'gnome-lock-indicators');
      indicators.append(svg('network', 15), svg('volume', 15), svg('battery', 15), svg('power', 15));
      topbar.appendChild(indicators);

      const shield = el('div', 'gnome-lock-shield');
      const clock = el('div', 'gnome-lock-clock');
      const time = el('time', 'gnome-lock-time', { 'aria-live': 'off' });
      const date = el('div', 'gnome-lock-date');
      clock.append(time, date);
      shield.appendChild(clock);

      const hint = el('div', 'gnome-lock-hint', { 'aria-hidden': 'true' });
      hint.append(svg('chevron', 20), el('span', '', { text: 'Click or press a key to unlock' }));

      const form = el('form', 'gnome-lock-auth', { novalidate: '', autocomplete: 'off' });
      const avatar = el('div', 'gnome-lock-avatar', { 'aria-hidden': 'true' });
      const avatarImg = el('img', '', { alt: '', draggable: 'false' });
      const avatarInitial = el('span', 'gnome-lock-initial');
      avatar.append(avatarImg, avatarInitial);
      const name = el('div', 'gnome-lock-name', { id: 'session-lock-name' });
      const entry = el('div', 'gnome-lock-entry');
      const input = el('input', 'gnome-lock-input', {
        type: 'password',
        placeholder: 'Password',
        autocomplete: 'current-password',
        autocapitalize: 'off',
        spellcheck: 'false',
        'aria-label': 'Password',
        'aria-describedby': 'session-lock-name session-lock-error'
      });
      const submit = el('button', 'gnome-lock-submit', { type: 'submit', 'aria-label': 'Unlock' });
      submit.append(svg('arrow', 16), el('span', 'gnome-lock-spinner', { 'aria-hidden': 'true' }));
      entry.append(input, submit);
      const unlockButton = el('button', 'gnome-lock-unlock', { type: 'submit', text: 'Unlock' });
      const caps = el('div', 'gnome-lock-caps', { text: 'Caps lock is on.' });
      caps.hidden = true;
      const error = el('div', 'gnome-lock-error', { id: 'session-lock-error', role: 'alert', 'aria-live': 'assertive' });
      form.append(avatar, name, entry, unlockButton, caps, error);

      const stage = el('div', 'gnome-lock-stage');
      stage.append(shield, hint, form);
      lock.append(backdrop, topbar, stage);
      doc.body.appendChild(lock);

      this._root = lock;
      this._nodes = {
        wallpaper: wallpaper, time: time, date: date, form: form, avatarImg: avatarImg,
        avatarInitial: avatarInitial, name: name, entry: entry, input: input,
        submit: submit, unlockButton: unlockButton, caps: caps, error: error
      };
      this._bindPointer();
      return lock;
    },

    _bindPointer() {
      const self = this;
      const lock = this._root;
      lock.addEventListener('pointerdown', function (event) {
        self._resetIdle();
        if (self.getPresentation() === P.CLOCK) {
          event.preventDefault();
          self.showAuthentication();
        }
      });
      lock.addEventListener('wheel', function (event) {
        event.preventDefault();
        if (self.getPresentation() === P.CLOCK) self.showAuthentication();
      }, { passive: false });
      lock.addEventListener('contextmenu', function (event) {
        if (event.target !== self._nodes.input) event.preventDefault();
        event.stopPropagation();
      });
      this._nodes.form.addEventListener('submit', function (event) {
        event.preventDefault();
        event.stopPropagation();
        self._submit();
      });
      this._nodes.input.addEventListener('input', function () { self._resetIdle(); });
    },

    /* ── Keyboard shielding ──────────────────────────────────────────── */

    _bindKeys() {
      if (this._keysBound || !root.addEventListener) return;
      this._keysBound = true;
      const self = this;
      const swallow = function (event) {
        if (!self.isLocked()) return;
        event.stopImmediatePropagation();
        if (event.type === 'keydown') self._onKeyDown(event);
        else if (!self._isInsideForm(event.target)) event.preventDefault();
        if (event.type === 'keyup') self._updateCaps(event);
      };
      ['keydown', 'keypress', 'keyup'].forEach(function (type) {
        root.addEventListener(type, swallow, true);
      });
    },

    _isInsideForm(target) {
      return Boolean(this._nodes && target && target.nodeType === 1 && this._nodes.form.contains(target));
    },

    _isTypingTarget(target) {
      return Boolean(this._nodes && target === this._nodes.input && !this._nodes.input.disabled);
    },

    _onKeyDown(event) {
      const state = this.getState();
      this._resetIdle();
      this._updateCaps(event);
      // Let the browser keep reload / devtools shortcuts; lock survives reload.
      const browserCombo = (event.ctrlKey || event.metaKey) && !event.altKey &&
        ['r', 'R', 'F5'].indexOf(event.key) !== -1;
      if (event.key === 'F5' || browserCombo) return;

      if (state === S.LOCKING || state === S.UNLOCKING) {
        event.preventDefault();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        this.showClock();
        return;
      }

      if (this.getPresentation() === P.CLOCK) {
        event.preventDefault();
        if (MODIFIER_KEYS.indexOf(event.key) !== -1) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const first = isPrintable(event) ? event.key : '';
        this.showAuthentication(first);
        return;
      }

      if (event.key === 'Tab') {
        this._trapFocus(event);
        return;
      }

      if (state === S.AUTHENTICATING) {
        event.preventDefault();
        return;
      }

      const input = this._nodes.input;
      if (this._isTypingTarget(event.target)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        this._submit();
        return;
      }
      if (!this._isGuest() && (isPrintable(event) || event.key === 'Backspace')) {
        event.preventDefault();
        input.focus({ preventScroll: true });
        if (isPrintable(event)) this._insert(event.key);
        else input.value = input.value.slice(0, -1);
        return;
      }
      if (event.key === ' ' && this._isInsideForm(event.target)) return;
      event.preventDefault();
    },

    _trapFocus(event) {
      const focusables = [this._nodes.input, this._nodes.submit, this._nodes.unlockButton]
        .filter(function (node) { return node && !node.disabled && node.offsetParent !== null; });
      event.preventDefault();
      if (!focusables.length) return;
      const index = focusables.indexOf(root.document.activeElement);
      const next = event.shiftKey
        ? focusables[(index <= 0 ? focusables.length : index) - 1]
        : focusables[(index + 1) % focusables.length];
      next.focus({ preventScroll: true });
    },

    _insert(text) {
      const input = this._nodes.input;
      const start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
      const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : input.value.length;
      input.value = input.value.slice(0, start) + text + input.value.slice(end);
      const caret = start + text.length;
      try { input.setSelectionRange(caret, caret); } catch (_) { /* unsupported */ }
    },

    _updateCaps(event) {
      if (!this._nodes || typeof event.getModifierState !== 'function') return;
      this._nodes.caps.hidden = this._isGuest() || !event.getModifierState('CapsLock');
    },

    /* ── Presentation ────────────────────────────────────────────────── */

    showAuthentication(firstCharacter) {
      if (!this._machine || !this._machine.setPresentation(P.AUTHENTICATION)) return false;
      if (this._isGuest()) {
        this._nodes.unlockButton.focus({ preventScroll: true });
      } else {
        const input = this._nodes.input;
        input.focus({ preventScroll: true });
        if (firstCharacter) this._insert(firstCharacter);
      }
      this._resetIdle();
      return true;
    },

    showClock() {
      if (!this._machine || !this._machine.setPresentation(P.CLOCK)) return false;
      this._nodes.input.value = '';
      this._nodes.error.textContent = '';
      if (root.document.activeElement && this._root.contains(root.document.activeElement)) {
        root.document.activeElement.blur();
      }
      this._root.focus({ preventScroll: true });
      this._clearIdle();
      return true;
    },

    _resetIdle() {
      this._clearIdle();
      if (this.getPresentation() !== P.AUTHENTICATION) return;
      const self = this;
      this._idleTimer = root.setTimeout(function () {
        if (self.getState() !== S.AUTHENTICATING && !self._nodes.input.value) self.showClock();
        else self._resetIdle();
      }, AUTH_IDLE_MS);
    },

    _clearIdle() {
      if (this._idleTimer) root.clearTimeout(this._idleTimer);
      this._idleTimer = null;
    },

    _onStateChange(state, presentation) {
      if (!this._root) return;
      this._root.dataset.state = state;
      this._root.dataset.presentation = presentation;
      const auth = presentation === P.AUTHENTICATION;
      this._nodes.form.setAttribute('aria-hidden', auth ? 'false' : 'true');
      this._nodes.form.inert = !auth;
      const busy = state === S.AUTHENTICATING;
      this._nodes.input.disabled = busy;
      this._nodes.submit.disabled = busy;
      this._nodes.unlockButton.disabled = busy;
      this._root.setAttribute('aria-busy', busy ? 'true' : 'false');
    },

    _isGuest() {
      return Boolean(this._profile && this._profile.type === 'guest');
    },

    _renderIdentity() {
      const service = root.ProfileService;
      this._profile = service && service.getActiveProfile ? service.getActiveProfile() : null;
      const profile = this._profile || { name: 'User', type: 'guest' };
      const nodes = this._nodes;
      nodes.name.textContent = profile.name || profile.username || 'User';
      nodes.avatarInitial.textContent = String(nodes.name.textContent).charAt(0).toUpperCase();
      let src = '';
      const v2 = root.LockScreenV2;
      if (v2 && typeof v2.getAvatarSrc === 'function' && this._profile) {
        try { src = v2.getAvatarSrc(this._profile.id) || ''; } catch (_) { src = ''; }
      }
      if (src) nodes.avatarImg.src = src;
      else nodes.avatarImg.removeAttribute('src');
      nodes.avatarImg.hidden = !src;
      nodes.avatarInitial.hidden = Boolean(src);
      const guest = this._isGuest();
      this._root.classList.toggle('is-guest', guest);
      nodes.entry.hidden = guest;
      nodes.unlockButton.hidden = !guest;
    },

    /* ── Wallpaper inheritance ───────────────────────────────────────── */

    refreshWallpaper() {
      if (!this._nodes) return;
      const doc = root.document;
      const layers = [];
      const canvas = doc.getElementById('wallpaper');
      if (canvas && canvas.width && canvas.height && typeof canvas.toDataURL === 'function') {
        try {
          const scale = Math.min(1, 640 / canvas.width);
          const copy = doc.createElement('canvas');
          copy.width = Math.max(1, Math.round(canvas.width * scale));
          copy.height = Math.max(1, Math.round(canvas.height * scale));
          copy.getContext('2d').drawImage(canvas, 0, 0, copy.width, copy.height);
          // PNG keeps the canvas transparency so the desktop gradient shows through.
          layers.push('url("' + copy.toDataURL('image/png') + '")');
        } catch (_) { /* tainted or unavailable canvas */ }
      }
      const desktop = doc.getElementById('desktop');
      const style = desktop && root.getComputedStyle ? root.getComputedStyle(desktop) : null;
      if (style && style.backgroundImage && style.backgroundImage !== 'none') layers.push(style.backgroundImage);
      this._nodes.wallpaper.style.backgroundImage = layers.join(', ');
      this._nodes.wallpaper.style.backgroundColor = (style && style.backgroundColor) || '';
    },

    /* ── Clock ───────────────────────────────────────────────────────── */

    _clockPrefs() {
      const v2 = root.LockScreenV2;
      try {
        return (v2 && typeof v2.getSettings === 'function' && v2.getSettings().clock) || {};
      } catch (_) {
        return {};
      }
    },

    _renderClock() {
      if (!this._nodes) return;
      const date = now();
      const prefs = this._clockPrefs();
      const lang = locale();
      this._nodes.time.textContent = formatTime(date, prefs, lang);
      this._nodes.time.setAttribute('datetime', date.toISOString());
      this._nodes.date.textContent = formatDate(date, lang);
      this._nodes.date.hidden = prefs.showDate === false;
    },

    _startClock() {
      this._stopClock();
      const self = this;
      const tick = function () {
        self._renderClock();
        const ms = now().getMilliseconds();
        self._clockTimer = root.setTimeout(tick, 1000 - ms + 15);
      };
      tick();
    },

    _stopClock() {
      if (this._clockTimer) root.clearTimeout(this._clockTimer);
      this._clockTimer = null;
    },

    _onVisibility() {
      if (!this.isLocked()) return;
      if (root.document.hidden) {
        this._stopClock();
      } else {
        this._startClock();
        this.refreshWallpaper();
      }
    },

    /* ── Lock / unlock ───────────────────────────────────────────────── */

    async lock(options) {
      this.init();
      const opts = options || {};
      const service = root.ProfileService;
      const ui = root.ProfileUI;
      if (this.isLocked() || !service || !ui || typeof ui.setSessionLocked !== 'function') return false;
      const profile = service.getActiveProfile ? service.getActiveProfile() : null;
      if (!profile) return false;
      if (!opts.restore) {
        if (typeof ui.isLocked === 'function' && ui.isLocked()) return false;
        if (root.ProfileWindowState && typeof root.ProfileWindowState.flushActive === 'function') {
          try { await root.ProfileWindowState.flushActive(); } catch (_) { /* best effort */ }
        }
        if (!service.lockSession(profile.id)) return false;
      }

      const doc = root.document;
      this._returnFocus = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
      if (typeof root.closeSearch === 'function') {
        try { root.closeSearch(false); } catch (_) { /* optional */ }
      }

      const lock = this._ensureDom();
      ui.setSessionLocked(true);
      this._renderIdentity();
      this.refreshWallpaper();
      this._nodes.input.value = '';
      this._nodes.error.textContent = '';
      this._startClock();

      const animate = !opts.restore && !reducedMotion();
      lock.classList.toggle('is-raised', animate);
      lock.hidden = false;
      if (opts.restore) {
        this._machine.transition(S.LOCKED);
        this._scheduleWallpaperRetries();
      } else {
        this._machine.transition(S.LOCKING);
        if (animate) {
          void lock.offsetHeight;
          lock.classList.remove('is-raised');
          await this._afterTransform(lock);
        }
        this._machine.transition(S.LOCKED);
      }
      lock.focus({ preventScroll: true });
      return true;
    },

    _scheduleWallpaperRetries() {
      // On a refresh the desktop canvas paints a few frames after boot.
      const self = this;
      [250, 1200].forEach(function (ms) {
        root.setTimeout(function () { if (self.isLocked()) self.refreshWallpaper(); }, ms);
      });
    },

    _afterTransform(node) {
      return new Promise(function (resolve) {
        let done = false;
        const finish = function () {
          if (done) return;
          done = true;
          node.removeEventListener('transitionend', onEnd);
          resolve();
        };
        const onEnd = function (event) {
          if (event.target === node && event.propertyName === 'transform') finish();
        };
        node.addEventListener('transitionend', onEnd);
        root.setTimeout(finish, SHIELD_MS + 120);
      });
    },

    async _submit() {
      const machine = this._machine;
      if (!machine || machine.presentation !== P.AUTHENTICATION || !machine.can(S.AUTHENTICATING)) return;
      const input = this._nodes.input;
      const password = this._isGuest() ? '' : input.value;
      if (!this._isGuest() && !password) {
        this._shake();
        input.focus({ preventScroll: true });
        return;
      }
      this._nodes.error.textContent = '';
      machine.transition(S.AUTHENTICATING);
      let result;
      try {
        result = await root.ProfileService.unlockSession(password);
      } catch (_) {
        result = { ok: false, reason: 'unavailable' };
      }
      if (!result || !result.ok) {
        machine.transition(S.AUTH_FAILED);
        input.value = '';
        this._nodes.error.textContent = result && result.reason === 'unavailable' ? UNAVAILABLE_TEXT : ERROR_TEXT;
        this._shake();
        if (this._isGuest()) this._nodes.unlockButton.focus({ preventScroll: true });
        else input.focus({ preventScroll: true });
        this._resetIdle();
        return;
      }
      await this.unlock();
    },

    _shake() {
      const entry = this._isGuest() ? this._nodes.unlockButton : this._nodes.entry;
      entry.classList.remove('is-shaking');
      void entry.offsetWidth;
      entry.classList.add('is-shaking');
      root.setTimeout(function () { entry.classList.remove('is-shaking'); }, 500);
    },

    /** Only reachable after ProfileService.unlockSession() succeeded. */
    async unlock() {
      const machine = this._machine;
      if (!machine || !machine.transition(S.UNLOCKING)) return false;
      this._clearIdle();
      this._nodes.input.value = '';
      const lock = this._root;
      if (reducedMotion()) {
        lock.classList.add('is-fading');
        await wait(160);
      } else {
        lock.classList.add('is-raised');
        await this._afterTransform(lock);
      }
      if (root.ProfileUI && typeof root.ProfileUI.setSessionLocked === 'function') {
        root.ProfileUI.setSessionLocked(false);
      }
      lock.hidden = true;
      lock.classList.remove('is-raised', 'is-fading');
      this._stopClock();
      machine.transition(S.UNLOCKED);
      const target = this._returnFocus;
      this._returnFocus = null;
      if (target && target.isConnected && typeof target.focus === 'function') {
        try { target.focus({ preventScroll: true }); } catch (_) { /* detached */ }
      }
      return true;
    },

    async _restoreIfLocked() {
      const ui = root.ProfileUI;
      if (ui && ui.ready) {
        try { await ui.ready; } catch (_) { return; }
      }
      if (ui && typeof ui.isSessionLocked === 'function' && ui.isSessionLocked()) {
        await this.lock({ restore: true });
      }
    }
  };

  root.SessionLock = SessionLock;

  if (root.document && root.addEventListener) {
    SessionLock.init();
    root.document.addEventListener('visibilitychange', function () { SessionLock._onVisibility(); });
    root.addEventListener('resize', function () {
      if (SessionLock.isLocked()) SessionLock.refreshWallpaper();
    });
    const start = function () { SessionLock._restoreIfLocked(); };
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
