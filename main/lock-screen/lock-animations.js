/**
 * @file main/lock-screen/lock-animations.js
 * @description Central animation controller for the immersive lock screen.
 *
 * Every named animation registers here. The controller owns intensity,
 * reduced-motion fallback, page-visibility pausing, and a single animation
 * frame loop for the starfield + cursor parallax. Nothing else starts an
 * independent particle loop.
 *
 * PUBLIC API (window.LockAnimationController)
 *   register(name, definition)          → name -> { start(ctx), minimal? }
 *   play(name, options)                 → starts a registered animation
 *   stop(name) / stopAll()
 *   setIntensity('low'|'medium'|'high')
 *   setReducedMotion(boolean)
 *   startEnvironment(root, options)     → ambient stars + parallax
 *   stopEnvironment()
 *   diagnostics()
 */

(function (window, document) {
  'use strict';

  const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

  function motionQuery() {
    try {
      return window.matchMedia ? window.matchMedia(REDUCED_QUERY) : null;
    } catch (_error) {
      return null;
    }
  }

  function lockRoot() {
    return document.getElementById('lock-screen');
  }

  function classHandle(root, className, duration) {
    if (!root) return { cancel: function () {}, cleanup: function () {} };
    let timer = null;
    let cancelled = false;

    function cleanup() {
      if (timer) window.clearTimeout(timer);
      timer = null;
      root.classList.remove(className);
    }

    // Restart the CSS animation reliably.
    root.classList.remove(className);
    void root.offsetWidth;
    root.classList.add(className);

    timer = window.setTimeout(function () {
      timer = null;
      if (!cancelled) root.classList.remove(className);
    }, duration);

    return {
      cancel: function () {
        cancelled = true;
        cleanup();
      },
      cleanup: cleanup
    };
  }

  const controller = {
    registry: new Map(),
    active: new Map(),
    intensity: 'high',
    reducedMotion: false,
    pageVisible: true,
    _env: null,
    _motion: null,
    _onVisibility: null,

    register(name, definition) {
      if (!name || !definition || typeof definition.start !== 'function') {
        throw new TypeError('LockAnimationController.register requires a name and start()');
      }
      this.registry.set(name, definition);
      return this;
    },

    play(name, options) {
      const definition = this.registry.get(name);
      if (!definition) return null;
      if (!this.pageVisible) return null;

      this.stop(name);

      if (this.reducedMotion) {
        if (definition.minimal) {
          const minimal = definition.minimal(Object.assign({}, options || {}, { root: lockRoot() }));
          if (minimal) this.active.set(name, minimal);
          return minimal;
        }
        return null;
      }

      const handle = definition.start(Object.assign({
        intensity: this.intensity,
        root: lockRoot()
      }, options || {}));
      if (handle) this.active.set(name, handle);
      return handle || null;
    },

    stop(name) {
      const handle = this.active.get(name);
      if (!handle) return;
      try { if (handle.cancel) handle.cancel(); } catch (_error) { /* ignore */ }
      try { if (handle.cleanup) handle.cleanup(); } catch (_error) { /* ignore */ }
      this.active.delete(name);
    },

    stopAll() {
      Array.from(this.active.keys()).forEach((name) => this.stop(name));
    },

    setIntensity(value) {
      this.intensity = ['low', 'medium', 'high'].indexOf(value) === -1 ? 'high' : value;
      const root = lockRoot();
      if (root) root.dataset.lockIntensity = this.intensity;
      if (this._env) this._env.intensity = this.intensity;
    },

    setReducedMotion(value) {
      this.reducedMotion = Boolean(value);
      const root = lockRoot();
      if (root) root.dataset.lockReduced = this.reducedMotion ? 'true' : 'false';
      if (this.reducedMotion) this.stopAll();
    },

    startEnvironment(root, options) {
      this.stopEnvironment();
      if (!root) return;
      const opts = options || {};
      const query = motionQuery();
      this.reducedMotion = Boolean(opts.respectReducedMotion !== false && query && query.matches);

      const canvas = root.querySelector('#lock-stars');
      const state = {
        root: root,
        canvas: canvas,
        ctx: canvas && canvas.getContext ? canvas.getContext('2d') : null,
        intensity: this.intensity,
        particles: opts.particles !== false,
        parallax: opts.parallax !== false,
        reduced: this.reducedMotion,
        raf: null,
        width: 0,
        height: 0,
        dpr: 1,
        stars: [],
        pointerX: 0,
        pointerY: 0,
        targetX: 0,
        targetY: 0,
        lastFrame: 0
      };
      this._env = state;

      const countFor = function (level) {
        if (level === 'low') return 24;
        if (level === 'medium') return 56;
        return 96;
      };

      function resize() {
        if (!canvas) return;
        const rect = root.getBoundingClientRect();
        state.width = Math.max(1, Math.round(rect.width));
        state.height = Math.max(1, Math.round(rect.height));
        state.dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(state.width * state.dpr);
        canvas.height = Math.round(state.height * state.dpr);
        canvas.style.width = state.width + 'px';
        canvas.style.height = state.height + 'px';
        if (state.ctx) state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
        const count = countFor(state.intensity);
        state.stars = new Array(count).fill(0).map(function () {
          return {
            x: Math.random() * state.width,
            y: Math.random() * state.height,
            depth: 0.25 + Math.random() * 0.75,
            size: Math.random() < 0.82 ? 1 : 2,
            phase: Math.random() * Math.PI * 2
          };
        });
      }

      function draw(now) {
        state.raf = window.requestAnimationFrame(draw);
        if (!state.ctx) return;
        if (state.lastFrame && now - state.lastFrame < 32) return; // ~30fps cap
        const delta = state.lastFrame ? Math.min(80, now - state.lastFrame) : 16;
        state.lastFrame = now;

        state.pointerX += (state.targetX - state.pointerX) * 0.055;
        state.pointerY += (state.targetY - state.pointerY) * 0.055;

        const ctx = state.ctx;
        ctx.clearRect(0, 0, state.width, state.height);

        if (state.parallax) {
          root.style.setProperty('--lock-px', state.pointerX.toFixed(2) + 'px');
          root.style.setProperty('--lock-py', state.pointerY.toFixed(2) + 'px');
        }

        if (!state.particles) return;
        const drift = state.reduced ? 0 : 1;
        for (let i = 0; i < state.stars.length; i += 1) {
          const star = state.stars[i];
          star.phase += 0.008 * drift;
          star.y += (0.008 + star.depth * 0.022) * delta * 0.06 * drift;
          if (star.y > state.height + 2) {
            star.y = -2;
            star.x = Math.random() * state.width;
          }
          const px = star.x + state.pointerX * star.depth * 0.6;
          const py = star.y + state.pointerY * star.depth * 0.6;
          const alpha = 0.25 + (Math.sin(star.phase) + 1) * 0.22;
          ctx.fillStyle = star.depth > 0.7
            ? 'rgba(216,180,254,' + alpha + ')'
            : 'rgba(148,163,255,' + alpha * 0.9 + ')';
          ctx.fillRect(Math.round(px), Math.round(py), star.size, star.size);
        }
      }

      function onPointer(event) {
        if (!state.parallax) return;
        const rect = root.getBoundingClientRect();
        state.targetX = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 26;
        state.targetY = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 18;
      }

      resize();
      this.setIntensity(this.intensity);
      root.dataset.lockReduced = state.reduced ? 'true' : 'false';

      if (!state.reduced) {
        state.raf = window.requestAnimationFrame(draw);
        if (state.parallax) root.addEventListener('pointermove', onPointer, { passive: true });
      }
      window.addEventListener('resize', resize, { passive: true });

      state.cleanup = function () {
        if (state.raf) window.cancelAnimationFrame(state.raf);
        state.raf = null;
        root.removeEventListener('pointermove', onPointer);
        window.removeEventListener('resize', resize);
        root.style.removeProperty('--lock-px');
        root.style.removeProperty('--lock-py');
      };
      state.onPointer = onPointer;
      state.resize = resize;
    },

    stopEnvironment() {
      if (this._env && this._env.cleanup) this._env.cleanup();
      this._env = null;
    },

    _setPageVisible(visible) {
      this.pageVisible = Boolean(visible);
      const root = lockRoot();
      if (root) root.dataset.lockPaused = this.pageVisible ? 'false' : 'true';
      const env = this._env;
      if (!env) return;
      if (!this.pageVisible) {
        if (env.raf) window.cancelAnimationFrame(env.raf);
        env.raf = null;
        this.stopAll();
      } else if (!env.reduced && !env.raf) {
        // Restart the single environment loop after the tab becomes visible.
        this.startEnvironment(env.root, {
          particles: env.particles,
          parallax: env.parallax,
          respectReducedMotion: true
        });
      }
    },

    diagnostics() {
      return {
        registered: Array.from(this.registry.keys()),
        active: Array.from(this.active.keys()),
        intensity: this.intensity,
        reducedMotion: this.reducedMotion,
        pageVisible: this.pageVisible,
        environment: Boolean(this._env)
      };
    }
  };

  // Desktop reveal: staged CSS transition, cancelled on cleanup.
  controller.register('account-select', {
    start: function () {
      return classHandle(lockRoot(), 'is-account-selecting', 420);
    },
    minimal: function (ctx) {
      return classHandle(ctx.root, 'is-account-selecting', 1);
    }
  });

  controller.register('custom-login-open', {
    start: function () {
      return classHandle(lockRoot(), 'is-custom-login', 360);
    }
  });

  controller.register('login-error', {
    start: function () {
      return classHandle(lockRoot(), 'is-login-error', 520);
    },
    minimal: function (ctx) {
      return classHandle(ctx.root, 'is-login-error', 1);
    }
  });

  controller.register('desktop-reveal', {
    start: function () {
      return classHandle(lockRoot(), 'is-desktop-revealing', 820);
    },
    minimal: function (ctx) {
      return classHandle(ctx.root, 'is-desktop-revealing', 1);
    }
  });

  controller.register('widget-change', {
    start: function (ctx) {
      const host = ctx && ctx.host ? ctx.host : document.getElementById('lock-widgets');
      return classHandle(host, 'is-changing', 240);
    }
  });

  controller.register('panel-open', {
    start: function () {
      return classHandle(lockRoot(), 'is-settings-open', 280);
    }
  });

  const query = motionQuery();
  controller.setReducedMotion(Boolean(query && query.matches));
  if (query) {
    const onChange = function (event) { controller.setReducedMotion(event.matches); };
    if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange);
    else if (typeof query.addListener === 'function') query.addListener(onChange);
  }

  controller._onVisibility = function () {
    controller._setPageVisible(!document.hidden);
  };
  document.addEventListener('visibilitychange', controller._onVisibility);
  controller.pageVisible = !document.hidden;

  window.LockAnimationController = controller;

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : { hidden: false, addEventListener: function () {} });
