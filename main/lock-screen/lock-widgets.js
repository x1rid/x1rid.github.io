/**
 * @file main/lock-screen/lock-widgets.js
 * @description Local-only widget registry + WidgetHost for the lock screen.
 *
 * Content is rendered with textContent; widgets never inject HTML. A failing
 * widget falls back to neutral content and can never block login.
 *
 * PUBLIC API (window.LockWidgets)
 *   registry                       → Map<id, definition>
 *   WidgetHost.mount(root, opts)   → starts the host
 *   WidgetHost.unmount()           → cancels timers/listeners and clears DOM
 *   WidgetHost.refresh()           → re-reads settings + content
 *   WidgetHost.diagnostics()
 */

(function (window, document) {
  'use strict';

  const registry = new Map();

  const FACTS = [
    'The first computer bug was a literal moth taped into a 1947 logbook.',
    'A single byte can represent 256 values — enough for every retro palette.',
    'The Apollo Guidance Computer ran at roughly 2 MHz.',
    'Ctrl+Alt+Del was chosen because it was hard to press by accident.',
    'The VFS in this simulator keeps every profile in its own database.',
    'Pixel fonts work because the eye completes the missing curves.'
  ];

  const QUOTES = [
    'Simplicity is prerequisite for reliability. — Edsger W. Dijkstra',
    'The best way to predict the future is to invent it. — Alan Kay',
    'Programs must be written for people to read. — Harold Abelson',
    'Any sufficiently advanced technology is indistinguishable from magic. — Arthur C. Clarke'
  ];

  const BULLETINS = [
    'Virtual filesystem check: the active profile namespace is isolated.',
    'All simulated services are metadata only. No host process is touched.',
    'This desktop is a browser simulation, not a Windows security boundary.',
    'Window state is restored per profile after a reload.'
  ];

  function pick(list, context) {
    const seed = context && context.seed ? context.seed : Date.now();
    return list[Math.abs(Math.floor(seed / 37)) % list.length];
  }

  registry.set('fun-fact', {
    id: 'fun-fact',
    title: 'Did you know?',
    async getContent(context) {
      return {
        text: pick(FACTS, context),
        source: 'local-content'
      };
    },
    onActivate() {},
    onDeactivate() {}
  });

  registry.set('system-message', {
    id: 'system-message',
    title: 'System bulletin',
    async getContent(context) {
      return {
        text: context && context.profile
          ? 'Welcome back, ' + context.profile.displayName + '. ' + pick(BULLETINS, context)
          : pick(BULLETINS, context),
        source: 'simulated-system'
      };
    },
    onActivate() {},
    onDeactivate() {}
  });

  registry.set('daily-quote', {
    id: 'daily-quote',
    title: 'Daily quote',
    async getContent(context) {
      return { text: pick(QUOTES, context), source: 'local-content' };
    },
    onActivate() {},
    onDeactivate() {}
  });

  registry.set('mini-calendar', {
    id: 'mini-calendar',
    title: 'Calendar',
    async getContent(context) {
      const now = context && context.now instanceof Date ? context.now : new Date();
      const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const start = first.getDay();
      const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const cells = [];
      for (let i = 0; i < start; i += 1) cells.push('··');
      for (let day = 1; day <= total; day += 1) {
        cells.push(String(day).padStart(2, '0'));
      }
      return {
        text: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase(),
        lines: [
          days.join(' '),
          cells.slice(0, 35).join(' '),
          'TODAY ' + now.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit' })
        ],
        source: 'local-clock'
      };
    },
    onActivate() {},
    onDeactivate() {}
  });

  registry.set('signal-check', {
    id: 'signal-check',
    title: 'Signal check',
    async getContent(context) {
      const profile = context && context.profile;
      return {
        text: 'Profile link ' + (profile ? profile.displayName : 'unresolved') +
          ' · ambient environment nominal. Click to cycle.',
        source: 'simulated-system'
      };
    },
    onActivate() {},
    onDeactivate() {}
  });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  const WidgetHost = {
    _mounted: false,
    _root: null,
    _options: null,
    _index: 0,
    _ids: [],
    _timer: null,
    _onClick: null,
    _onVisibility: null,

    mount(root, options) {
      if (!root) return;
      this.unmount();
      this._mounted = true;
      this._root = root;
      this._options = options || {};
      this._ids = this._resolveIds();
      this._index = 0;
      this._onClick = (event) => {
        if (!this._resolveIds().length) return;
        if (event && event.target && event.target.closest &&
            event.target.closest('.lock-settings-panel')) return;
        this.next('interaction');
      };
      this._onKeydown = (event) => {
        if (event.target && event.target.closest &&
            event.target.closest('.lock-settings-panel')) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.next('interaction');
        }
      };
      root.addEventListener('click', this._onClick);
      root.addEventListener('keydown', this._onKeydown);
      this._onVisibility = () => {
        if (document.hidden) this._stopTimer();
        else this._schedule();
      };
      document.addEventListener('visibilitychange', this._onVisibility);
      this.refresh();
    },

    unmount() {
      this._stopTimer();
      if (this._root && this._onClick) this._root.removeEventListener('click', this._onClick);
      if (this._root && this._onKeydown) this._root.removeEventListener('keydown', this._onKeydown);
      if (this._onVisibility) document.removeEventListener('visibilitychange', this._onVisibility);
      this._ids.forEach((id) => {
        const widget = registry.get(id);
        if (widget && widget.onDeactivate) {
          try { widget.onDeactivate(); } catch (_error) { /* never break unmount */ }
        }
      });
      if (this._root) this._root.replaceChildren();
      this._mounted = false;
      this._root = null;
      this._options = null;
      this._ids = [];
      this._onClick = null;
      this._onKeydown = null;
      this._onVisibility = null;
    },

    _settings() {
      const opts = this._options || {};
      return typeof opts.getSettings === 'function' ? opts.getSettings() : null;
    },

    _resolveIds() {
      const lock = this._settings() || {};
      const widgets = lock.widgets || {};
      if (widgets.enabled === false) return [];
      const configured = Array.isArray(widgets.enabledIds) ? widgets.enabledIds : [];
      return configured.filter((id) => registry.has(id));
    },

    _stopTimer() {
      if (this._timer) window.clearInterval(this._timer);
      this._timer = null;
    },

    _schedule() {
      this._stopTimer();
      const lock = this._settings() || {};
      const widgets = lock.widgets || {};
      if (!this._mounted || document.hidden || widgets.rotation !== 'interval' || this._ids.length < 2) return;
      this._timer = window.setInterval(() => this.next('interval'), 12000);
    },

    next(reason) {
      const ids = this._resolveIds();
      if (!ids.length) {
        this._renderEmpty();
        return;
      }
      this._ids = ids;
      if (reason === 'interval' || reason === 'interaction') {
        this._index = (this._index + 1) % ids.length;
      }
      if (this._index >= ids.length) this._index = 0;
      this._renderCurrent();
    },

    refresh() {
      if (!this._mounted) return;
      this._ids = this._resolveIds();
      if (!this._ids.length) {
        this._renderEmpty();
        return;
      }
      this._index = Math.min(this._index, this._ids.length - 1);
      this._renderCurrent();
      this._schedule();
    },

    _renderEmpty() {
      if (!this._root) return;
      this._stopTimer();
      this._root.hidden = true;
      this._root.replaceChildren();
      if (this._root.setAttribute) this._root.setAttribute('aria-hidden', 'true');
    },

    async _renderCurrent() {
      if (!this._root) return;
      const id = this._ids[this._index];
      const widget = registry.get(id);
      this._root.hidden = false;
      this._root.removeAttribute('aria-hidden');

      const opts = this._options || {};
      const context = {
        profile: typeof opts.getProfile === 'function' ? opts.getProfile() : null,
        now: new Date(),
        seed: Date.now() + this._index * 1000
      };

      let content = null;
      try {
        content = widget ? await widget.getContent(context) : null;
      } catch (error) {
        if (typeof opts.reportError === 'function') opts.reportError(error, id);
        content = { text: 'This bulletin is temporarily unavailable.', source: 'fallback' };
      }
      if (!content || typeof content.text !== 'string') {
        content = { text: 'No content available.', source: 'fallback' };
      }
      if (!this._root) return;

      const card = el('article', 'lock-widget-card');
      card.setAttribute('data-widget-id', id || 'fallback');
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'article');
      const head = el('div', 'lock-widget-head');
      head.appendChild(el('span', 'lock-widget-title', widget ? widget.title : 'System'));
      head.appendChild(el('span', 'lock-widget-source', content.source || 'local'));
      card.appendChild(head);
      card.appendChild(el('p', 'lock-widget-text', content.text));
      if (Array.isArray(content.lines)) {
        const lines = el('pre', 'lock-widget-lines', content.lines.join('\n'));
        card.appendChild(lines);
      }
      this._root.replaceChildren(card);
      try {
        if (window.LockAnimationController) {
          window.LockAnimationController.play('widget-change', { host: this._root });
        }
      } catch (_error) { /* animation is optional */ }
    },

    diagnostics() {
      return {
        mounted: this._mounted,
        ids: registry.size ? Array.from(registry.keys()) : [],
        enabled: this._resolveIds(),
        index: this._index,
        rotating: Boolean(this._timer)
      };
    }
  };

  window.LockWidgets = {
    registry: registry,
    WidgetHost: WidgetHost
  };

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : { hidden: false, addEventListener: function () {} });
