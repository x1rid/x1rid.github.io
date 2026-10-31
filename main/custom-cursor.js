/* ============================================================================
 *  Retro interactive cursor
 *  ----------------------------------------------------------------------------
 *  Four schemes, persisted in localStorage and switchable from the terminal:
 *
 *    ghost    pixel arrow, lavender link accent, interactive-state badges and
 *             a Windows 95-style ghost trail (the default)
 *    classic  the original animated GIF cursor, glow and rainbow trail
 *    rail     native pointer; the status rail reports coordinates + hit state
 *    native   native pointer, no custom cursor
 *
 *  The ghost scheme stands down over text, the splitter and embedded pages so
 *  the browser keeps the cursor that actually fits those jobs. The trail is a
 *  fixed ring of ten sprites, not a particle system, and it stops when the
 *  pointer stops. Clicking a link or button opens a small flower of 2D
 *  triangle petals outward in every direction; anywhere else throws nothing.
 * ========================================================================== */
(() => {
  'use strict';

  if (window.__SITE_CURSOR_INIT__) return;
  window.__SITE_CURSOR_INIT__ = true;

  const STORAGE_KEY = 'retroCursorScheme';
  const DEFAULT_SCHEME = 'ghost';
  const SCHEMES = ['ghost', 'classic', 'rail', 'native'];

  const TRAIL_COUNT = 10;
  const TRAIL_STEP = 32;          // ms between ghost samples
  const TRAIL_LIFE = 420;         // ms a sample remains drawable
  const TRAIL_OPACITY = [
    0.46, 0.39, 0.33, 0.27, 0.22, 0.18, 0.145, 0.115, 0.09, 0.07
  ];

  const NATIVE_STATES = ['text', 'frame', 'splitter', 'disabled', 'screenlock'];

  const ASSETS = {
    arrow: './assets/cursor-arrow.png',
    arrowLink: './assets/cursor-arrow-link.png',
    arrowPress: './assets/cursor-arrow-press.png'
  };

  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  const coarsePointer = window.matchMedia
    ? window.matchMedia('(pointer: coarse)')
    : null;
  const phoneShell = window.matchMedia
    ? window.matchMedia('(max-width: 600px)')
    : null;

  let requested = readScheme();
  let effective = 'native';
  let teardown = null;

  /* ------------------------------------------------------------------
   * Scheme state
   * ------------------------------------------------------------------ */
  function readScheme() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (SCHEMES.indexOf(stored) !== -1) return stored;
    } catch (_) {
      /* Storage can be blocked; the default still works. */
    }
    return DEFAULT_SCHEME;
  }

  function persistScheme() {
    try {
      window.localStorage.setItem(STORAGE_KEY, requested);
    } catch (_) {
      /* A blocked store only costs persistence. */
    }
  }

  function isTouch() {
    return Boolean(coarsePointer && coarsePointer.matches) ||
      Boolean(phoneShell && phoneShell.matches);
  }

  function effectiveFor(scheme) {
    if (isTouch()) return 'native';
    if (reduceMotion && reduceMotion.matches && (scheme === 'ghost' || scheme === 'classic')) {
      return 'native';
    }
    return scheme;
  }

  function emitCursorChange(reason) {
    document.documentElement.dataset.cursorScheme = requested;
    document.documentElement.dataset.cursorEffective = effective;
    try {
      document.dispatchEvent(new CustomEvent('site:cursorchange', {
        detail: { scheme: requested, effective, reason: reason || '' }
      }));
    } catch (_) {
      /* CustomEvent is available in every browser this site supports. */
    }
  }

  function emitPointerState(state, x, y, active) {
    if (effective !== 'rail') return;
    try {
      document.dispatchEvent(new CustomEvent('site:pointerstate', {
        detail: { state, x, y, active: active !== false }
      }));
    } catch (_) {
      /* Telemetry is supplementary; never let it break the page. */
    }
  }

  function setScheme(next) {
    let value = String(next || '').trim().toLowerCase();
    if (value === 'off') value = 'native';
    if (SCHEMES.indexOf(value) === -1) {
      return { ok: false, reason: 'unknown', scheme: requested, effective };
    }

    requested = value;
    persistScheme();
    apply('command');

    let reason = '';
    if (effective !== requested) {
      reason = isTouch() ? 'touch' : 'reduced-motion';
    }
    return { ok: true, scheme: requested, effective, reason };
  }

  function apply(reason) {
    if (teardown) {
      teardown();
      teardown = null;
    }

    effective = effectiveFor(requested);
    document.documentElement.dataset.cursorScheme = requested;
    document.documentElement.dataset.cursorEffective = effective;

    if (effective === 'ghost') {
      teardown = setupGhost();
    } else if (effective === 'classic') {
      teardown = setupClassic();
    } else {
      teardown = setupTelemetry(effective === 'rail');
    }

    emitCursorChange(reason);
  }

  /* ------------------------------------------------------------------
   * Shared hit testing
   * ------------------------------------------------------------------ */
  function resolveTargetState(target) {
    if (!target || typeof target.closest !== 'function') return 'default';

    if (target.closest('iframe')) return 'frame';
    if (target.closest('.panel-splitter, .is-splitting, .splitter, .resize-handle, body.is-resizing')) return 'splitter';
    if (target.closest(
      'textarea, [contenteditable="true"], [contenteditable=""], ' +
      'input:not([type]), input[type="text"], input[type="search"], ' +
      'input[type="email"], input[type="url"], input[type="tel"], ' +
      'input[type="password"], input[type="number"], input[type="date"], ' +
      'input[type="time"], input[type="datetime-local"], input[type="month"], ' +
      'input[type="week"], .terminal-output, .terminal-pager-body'
    )) return 'text';
    if (target.closest(':disabled, [aria-disabled="true"]')) return 'disabled';
    /* Custom cursors paint under the sign-in/session-lock surfaces; there the
     * CSS restores the browser cursor, so stand the ghost pointer down. */
    if (target.closest('.lock-screen, .gnome-lock')) return 'screenlock';
    if (target.closest('.is-dragging')) return 'drag';
    if (target.closest('a, button, input, select, [role="button"], summary, label')) return 'link';
    if (target.closest('#retro-titlebar, #retro-music-mini')) return 'drag';
    return 'default';
  }

  /* ------------------------------------------------------------------
   * Rail telemetry (native pointer)
   * ------------------------------------------------------------------ */
  function setupTelemetry(railOn) {
    document.documentElement.classList.remove('custom-cursor-enabled');

    if (!railOn) {
      return function noop() {};
    }

    let lastTime = 0;
    let lastState = '';

    function report(event, force) {
      const state = resolveTargetState(event.target);
      const now = performance.now();

      if (!force && state === lastState && now - lastTime < 90) return;
      lastTime = now;
      lastState = state;
      emitPointerState(state, event.clientX, event.clientY, true);
    }

    function onMove(event) {
      if (event.pointerType === 'touch') return;
      report(event, false);
    }

    function onOver(event) {
      if (event.pointerType === 'touch') return;
      const state = resolveTargetState(event.target);
      if (state !== lastState) report(event, true);
    }

    function onLeave() {
      lastState = '';
      emitPointerState('default', 0, 0, false);
    }

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerover', onOver, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onLeave);

    emitPointerState('default', 0, 0, false);

    return function cleanupTelemetry() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerover', onOver);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('blur', onLeave);
    };
  }

  /* ------------------------------------------------------------------
   * Ghost scheme
   * ------------------------------------------------------------------ */
  function preloadImages(urls) {
    return Promise.all(urls.map((url) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = url;
    }))).then((results) => results.every(Boolean));
  }

  function setupGhost() {
    let alive = true;
    let lead = null;
    let sprite = null;
    let badge = null;
    const ghosts = [];
    const frameHandlers = [];

    let hoverKind = 'default';
    let action = null;
    let actionTimer = 0;
    let rafId = 0;
    let visible = false;
    let samples = [];
    let lastSample = 0;
    let down = null;
    let currentHotspot = { x: 1, y: 1 };
    let lastMove = { x: 0, y: 0 };

    /* Click petals: a random handful of lavender triangles that open outward
     * like a flower, drawn on their own canvas so the ghost trail stays simple. */
    const CLICK_PETAL_TOKENS = ['--signal-active', '--dr-accent', '--ink-70', '--dr-muted'];
    const CLICK_PETAL_FALLBACK = ['#c084fc', '#bd93f9', '#cda6ff', '#8b72b8'];
    const pixels = [];
    let pixelCanvas = null;
    let pixelCtx = null;
    let pixelRaf = 0;
    let pixelLast = 0;
    let pixelColors = null;

    preloadImages(Object.keys(ASSETS).map((key) => ASSETS[key])).then((ok) => {
      if (!alive) return;
      if (!ok) {
        effective = 'native';
        document.documentElement.dataset.cursorEffective = effective;
        document.documentElement.classList.remove('custom-cursor-enabled');
        emitCursorChange('asset-failed');
        return;
      }
      build();
    });

    function build() {
      document.documentElement.classList.add('custom-cursor-enabled');

      lead = document.createElement('div');
      lead.className = 'custom-cursor-main';
      lead.setAttribute('aria-hidden', 'true');

      sprite = document.createElement('div');
      sprite.className = 'custom-cursor-sprite';

      badge = document.createElement('span');
      badge.className = 'custom-cursor-badge';
      badge.setAttribute('aria-hidden', 'true');

      lead.appendChild(sprite);
      lead.appendChild(badge);
      document.body.appendChild(lead);

      for (let i = 0; i < TRAIL_COUNT; i += 1) {
        const ghost = document.createElement('div');
        ghost.className = 'custom-cursor-ghost';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.opacity = String(TRAIL_OPACITY[i]);
        document.body.appendChild(ghost);
        ghosts.push(ghost);
      }

      pixelCanvas = document.createElement('canvas');
      pixelCanvas.className = 'custom-cursor-pixels';
      pixelCanvas.setAttribute('aria-hidden', 'true');
      pixelCtx = pixelCanvas.getContext('2d', { alpha: true, desynchronized: true });
      if (pixelCtx) document.body.appendChild(pixelCanvas);

      /* Embedded pages own their pointer: hand it back to the browser. */
      Array.from(document.querySelectorAll('iframe')).forEach((frame) => {
        const onFrameEnter = () => {
          hoverKind = 'frame';
          hideLead();
        };
        frame.addEventListener('pointerenter', onFrameEnter);
        frameHandlers.push({ frame, handler: onFrameEnter });
      });

      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerdown', onDown, { passive: true });
      window.addEventListener('pointerup', onUp, { passive: true });
      window.addEventListener('pointercancel', onCancel, { passive: true });
      window.addEventListener('wheel', onWheel, { passive: true });
      window.addEventListener('contextmenu', onContextMenu, { passive: true });
      window.addEventListener('blur', hideAll);
      document.addEventListener('visibilitychange', onVisibility);
      document.documentElement.addEventListener('mouseleave', hideAll);
    }

    function isScrollAction(value) {
      return value === 'scrollUp' || value === 'scrollDown' ||
        value === 'scrollLeft' || value === 'scrollRight';
    }

    function visualFor() {
      const link = hoverKind === 'link';
      const baseImage = link ? ASSETS.arrowLink : ASSETS.arrow;
      const hotspot = { x: 1, y: 1 };

      let image = baseImage;
      let scale = 1;
      let rotate = 0;
      let badgeText = '';

      if (action === 'press') {
        image = ASSETS.arrowPress;
        scale = 0.86;
      } else if (action === 'context') {
        badgeText = '≡';
        rotate = 6;
        scale = 0.96;
      } else if (action === 'scrollUp') {
        badgeText = '↑';
        rotate = -6;
      } else if (action === 'scrollDown') {
        badgeText = '↓';
        rotate = 6;
      } else if (action === 'scrollLeft') {
        badgeText = '←';
        rotate = -6;
      } else if (action === 'scrollRight') {
        badgeText = '→';
        rotate = 6;
      } else if (action === 'drag' || hoverKind === 'drag') {
        badgeText = '+';
        scale = 0.92;
      }

      return { image, scale, rotate, badge: badgeText, hotspot, ghostImage: baseImage };
    }

    function applyVisual() {
      if (!alive || !lead) return;
      if (NATIVE_STATES.indexOf(hoverKind) !== -1) {
        hideLead();
        return;
      }

      const visual = visualFor();
      currentHotspot = visual.hotspot;
      sprite.style.backgroundImage = `url("${visual.image}")`;
      lead.style.setProperty('--cursor-scale', String(visual.scale));
      lead.style.setProperty('--cursor-rotate', `${visual.rotate}deg`);

      if (visual.badge) {
        badge.textContent = visual.badge;
        lead.dataset.badge = 'on';
      } else {
        badge.textContent = '';
        delete lead.dataset.badge;
      }

      ghosts.forEach((ghost) => {
        ghost.style.backgroundImage = `url("${visual.ghostImage}")`;
      });

      lead.style.display = 'block';
      visible = true;
      updateLeadPosition(lastMove.x, lastMove.y);
    }

    function updateLeadPosition(x, y) {
      if (!lead || !visible) return;
      lead.style.transform = `translate3d(${x - currentHotspot.x}px, ${y - currentHotspot.y}px, 0)`;
    }

    function hideLead() {
      if (lead) lead.style.display = 'none';
      visible = false;
      clearTrail();
    }

    function hideGhosts() {
      ghosts.forEach((ghost) => {
        ghost.style.display = 'none';
      });
    }

    function clearTrail() {
      samples = [];
      lastSample = 0;
      hideGhosts();
    }

    /* ------------------------------------------------------------------
     * Click pixels (ghost scheme, clickable targets only)
     * ------------------------------------------------------------------ */
    function readPixelColors() {
      let styles = null;
      try {
        styles = window.getComputedStyle(document.documentElement);
      } catch (_) {
        /* Fall through to the literal palette. */
      }
      return CLICK_PETAL_TOKENS.map((token, index) => {
        const value = styles ? styles.getPropertyValue(token).trim() : '';
        return value || CLICK_PETAL_FALLBACK[index];
      });
    }

    /* One equilateral triangle, tip pointing along `rotation`. */
    function drawTriangle(x, y, radius, rotation, color) {
      pixelCtx.fillStyle = color;
      pixelCtx.beginPath();
      for (let i = 0; i < 3; i += 1) {
        const angle = rotation + (i * Math.PI * 2) / 3;
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        if (i === 0) pixelCtx.moveTo(px, py);
        else pixelCtx.lineTo(px, py);
      }
      pixelCtx.closePath();
      pixelCtx.fill();
    }

    function resizePixelCanvas() {
      if (!pixelCanvas || !pixelCtx) return;
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const width = Math.floor(window.innerWidth * dpr);
      const height = Math.floor(window.innerHeight * dpr);
      if (pixelCanvas.width !== width || pixelCanvas.height !== height) {
        pixelCanvas.width = width;
        pixelCanvas.height = height;
      }
      pixelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function startPixelLoop() {
      if (!pixelCtx || pixelRaf) return;
      pixelLast = performance.now();
      pixelRaf = window.requestAnimationFrame(pixelStep);
    }

    function clearPixels() {
      if (pixelRaf) {
        window.cancelAnimationFrame(pixelRaf);
        pixelRaf = 0;
      }
      pixels.length = 0;
      if (pixelCtx) pixelCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (pixelCanvas) pixelCanvas.style.display = 'none';
    }

    function spawnClickPixels(x, y) {
      if (!pixelCtx || !pixelCanvas) return;
      resizePixelCanvas();
      if (!pixelColors) pixelColors = readPixelColors();

      /* A new flower every time: count, start angle, size, speed and spin
       * all vary per click. */
      const count = 6 + Math.floor(Math.random() * 4);
      const offset = Math.random() * Math.PI * 2;
      const palette = pixelColors.slice();
      for (let i = palette.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const swap = palette[i];
        palette[i] = palette[j];
        palette[j] = swap;
      }

      for (let i = 0; i < count; i += 1) {
        /* Even spokes around the compass, with a little jitter. */
        const angle = offset + (i / count) * Math.PI * 2 +
          (Math.random() - 0.5) * 0.36;
        const speed = 72 + Math.random() * 64;
        const curve = (Math.random() - 0.5) * 30;
        pixels.push({
          x,
          y,
          vx: Math.cos(angle) * speed - Math.sin(angle) * curve,
          vy: Math.sin(angle) * speed + Math.cos(angle) * curve,
          size: 3.4 + Math.random() * 2.0,
          rotation: angle + (Math.random() - 0.5) * 0.18,
          spin: (Math.random() - 0.5) * 1.3,
          age: 0,
          life: 0.46 + Math.random() * 0.22,
          color: palette[i % palette.length]
        });
      }
      if (pixels.length > 42) pixels.splice(0, pixels.length - 42);

      pixelCanvas.style.display = 'block';
      startPixelLoop();
    }

    function pixelStep(now) {
      pixelRaf = 0;
      if (!alive || !pixelCtx || !pixelCanvas) {
        pixels.length = 0;
        return;
      }

      const dt = Math.min(0.05, Math.max(0, (now - pixelLast) / 1000));
      pixelLast = now;
      resizePixelCanvas();
      pixelCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      for (let i = pixels.length - 1; i >= 0; i -= 1) {
        const pixel = pixels[i];
        pixel.age += dt;
        const lifeT = pixel.age / pixel.life;
        if (lifeT >= 1) {
          pixels.splice(i, 1);
          continue;
        }

        const drag = Math.pow(0.985, dt * 60);
        pixel.vx *= drag;
        pixel.vy *= drag;
        pixel.x += pixel.vx * dt;
        pixel.y += pixel.vy * dt;
        pixel.rotation += pixel.spin * dt;

        pixelCtx.globalAlpha = 1 - lifeT * lifeT;
        drawTriangle(pixel.x, pixel.y, pixel.size, pixel.rotation, pixel.color);
      }
      pixelCtx.globalAlpha = 1;

      if (pixels.length) {
        pixelRaf = window.requestAnimationFrame(pixelStep);
      } else {
        pixelCanvas.style.display = 'none';
      }
    }

    function startLoop() {
      if (!rafId) rafId = window.requestAnimationFrame(step);
    }

    function step(now) {
      rafId = 0;

      if (!alive || !visible || NATIVE_STATES.indexOf(hoverKind) !== -1 ||
        action === 'press' || action === 'context' || isScrollAction(action)) {
        hideGhosts();
        return;
      }

      while (samples.length && now - samples[0].t > TRAIL_LIFE) {
        samples.shift();
      }

      if (!samples.length) {
        hideGhosts();
        return;
      }

      let any = false;
      for (let i = 0; i < ghosts.length; i += 1) {
        const targetTime = now - (i + 1) * TRAIL_STEP;
        let sample = null;
        for (let j = samples.length - 1; j >= 0; j -= 1) {
          if (samples[j].t <= targetTime) {
            sample = samples[j];
            break;
          }
        }

        if (sample) {
          const fade = Math.max(0, Math.min(1, 1 - (now - sample.t) / TRAIL_LIFE));
          ghosts[i].style.transform =
            `translate3d(${sample.x - currentHotspot.x}px, ${sample.y - currentHotspot.y}px, 0)`;
          ghosts[i].style.opacity = String(TRAIL_OPACITY[i] * fade);
          ghosts[i].style.display = 'block';
          any = true;
        } else {
          ghosts[i].style.display = 'none';
        }
      }

      if (any || samples.length) {
        rafId = window.requestAnimationFrame(step);
      }
    }

    function clearActionTimer() {
      if (actionTimer) {
        window.clearTimeout(actionTimer);
        actionTimer = 0;
      }
    }

    function setActionTimer(ms) {
      clearActionTimer();
      actionTimer = window.setTimeout(() => {
        actionTimer = 0;
        if (!alive) return;
        action = null;
        clearTrail();
        if (NATIVE_STATES.indexOf(hoverKind) === -1) applyVisual();
        startLoop();
      }, ms);
    }

    function onMove(event) {
      if (event.pointerType === 'touch') return;

      lastMove = { x: event.clientX, y: event.clientY };
      const nextKind = resolveTargetState(event.target);

      if (nextKind !== hoverKind) {
        hoverKind = nextKind;
        clearTrail();
        if (!action || action === 'drag') applyVisual();
      }

      if (NATIVE_STATES.indexOf(hoverKind) !== -1) {
        if (action === 'press' || action === 'context' || isScrollAction(action)) {
          action = null;
          clearActionTimer();
        }
        hideLead();
        return;
      }

      /* The lead starts hidden until the first real pointer position is known. */
      if (!visible) applyVisual();
      updateLeadPosition(lastMove.x, lastMove.y);

      if (down && down.button === 0 && action === 'press') {
        const distance = Math.hypot(event.clientX - down.x, event.clientY - down.y);
        if (down.draggable && distance > 4) {
          action = 'drag';
          clearTrail();
          applyVisual();
        }
      }

      if (!action || action === 'drag') {
        const now = performance.now();
        if (now - lastSample >= TRAIL_STEP) {
          samples.push({ x: event.clientX, y: event.clientY, t: now });
          if (samples.length > 24) samples.shift();
          lastSample = now;
        }
        startLoop();
      }
    }

    function onDown(event) {
      if (event.pointerType === 'touch') return;
      if (NATIVE_STATES.indexOf(hoverKind) !== -1) return;

      lastMove = { x: event.clientX, y: event.clientY };

      if (event.button === 2) {
        clearActionTimer();
        action = 'context';
        clearTrail();
        applyVisual();
        setActionTimer(450);
        return;
      }

      if (event.button !== 0) return;

      /* Pixel burst only on actual controls, never on bare page clicks. */
      if (resolveTargetState(event.target) === 'link') {
        spawnClickPixels(event.clientX, event.clientY);
      }

      const target = event.target;
      const draggable = target && target.closest &&
        target.closest('#retro-titlebar, #retro-music-mini, .is-dragging');

      down = {
        x: event.clientX,
        y: event.clientY,
        button: 0,
        draggable: Boolean(draggable)
      };

      clearActionTimer();
      action = 'press';
      clearTrail();
      applyVisual();
    }

    function onUp(event) {
      if (event.pointerType === 'touch') return;
      if (event.button !== 0) return;
      if (!down && action !== 'press' && action !== 'drag') return;

      down = null;

      if (action === 'press' || action === 'drag') {
        action = null;
        clearActionTimer();
        hoverKind = resolveTargetState(event.target);
        clearTrail();
        applyVisual();
      }
    }

    function onCancel(event) {
      if (event.pointerType === 'touch') return;
      down = null;
      action = null;
      clearActionTimer();
      clearTrail();
      if (NATIVE_STATES.indexOf(hoverKind) === -1) applyVisual();
    }

    function onContextMenu(event) {
      if (NATIVE_STATES.indexOf(hoverKind) !== -1) return;
      if (typeof event.clientX === 'number') {
        lastMove = { x: event.clientX, y: event.clientY };
      }
      clearActionTimer();
      action = 'context';
      clearTrail();
      applyVisual();
      setActionTimer(450);
    }

    function onWheel(event) {
      if (event.ctrlKey) return;
      if (!event.deltaX && !event.deltaY) return;
      if (NATIVE_STATES.indexOf(hoverKind) !== -1) return;

      if (typeof event.clientX === 'number') {
        lastMove = { x: event.clientX, y: event.clientY };
      }
      clearActionTimer();

      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        action = event.deltaX < 0 ? 'scrollLeft' : 'scrollRight';
      } else {
        action = event.deltaY < 0 ? 'scrollUp' : 'scrollDown';
      }

      clearTrail();
      applyVisual();
      setActionTimer(320);
    }

    function hideAll() {
      down = null;
      action = null;
      clearActionTimer();
      clearTrail();
      clearPixels();
      if (lead) lead.style.display = 'none';
      visible = false;
    }

    function onVisibility() {
      if (document.hidden) hideAll();
    }

    function cleanup() {
      alive = false;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      clearActionTimer();
      clearPixels();

      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('blur', hideAll);
      document.removeEventListener('visibilitychange', onVisibility);
      document.documentElement.removeEventListener('mouseleave', hideAll);

      frameHandlers.forEach(({ frame, handler }) => {
        frame.removeEventListener('pointerenter', handler);
      });
      frameHandlers.length = 0;

      if (lead && lead.parentNode) lead.parentNode.removeChild(lead);
      ghosts.forEach((ghost) => {
        if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
      });
      ghosts.length = 0;

      if (pixelCanvas && pixelCanvas.parentNode) {
        pixelCanvas.parentNode.removeChild(pixelCanvas);
      }
      pixelCanvas = null;
      pixelCtx = null;
      pixelColors = null;

      document.documentElement.classList.remove('custom-cursor-enabled');
    }

    return cleanup;
  }

  /* ------------------------------------------------------------------
   * Classic scheme — the original GIF + rainbow particle trail
   * ------------------------------------------------------------------ */
  function setupClassic() {
    const NORMAL_URL = window.__CURSOR_NORMAL_URL || './assets/cursor.gif';
    const REVERSED_URL = window.__CURSOR_REVERSED_URL || './assets/cursor-reversed.gif';

    const MAX_PARTICLES = 150;
    const LIFE_MIN = 0.50;
    const LIFE_MAX = 0.95;
    const SIZE_MIN = 1.4;
    const SIZE_MAX = 2.4;
    const DRAG = 0.90;
    const SPEED_SPREAD = 0.12;
    const PARTICLES_PER_PX = 0.16;
    const IDLE_PARTICLES_PER_SEC = 16;
    const HUE_SPEED = 220;
    const SPRITE_COUNT = 36;
    const SPRITE_PX = 32;
    const MAX_DPR = 1.5;

    let alive = true;
    let inited = false;
    let cursorEl = null;
    let glowEl = null;
    let canvas = null;
    let ctx = null;

    const particles = [];
    let mouseX = 0;
    let mouseY = 0;
    let prevX = 0;
    let prevY = 0;
    let mouseVX = 0;
    let mouseVY = 0;
    let distanceAccum = 0;
    let hueBase = 0;
    let visible = false;
    let running = false;
    let rafId = 0;
    let lastTs = 0;
    let reversed = false;
    let sprites = [];

    const probe = new Image();
    probe.decoding = 'async';
    probe.onload = () => {
      if (alive) init();
    };
    probe.onerror = () => {
      if (!alive) return;
      document.documentElement.classList.remove('custom-cursor-enabled');
      effective = 'native';
      document.documentElement.dataset.cursorEffective = effective;
      emitCursorChange('asset-failed');
    };
    probe.src = NORMAL_URL;

    function failToNative() {
      document.documentElement.classList.remove('custom-cursor-enabled');
      effective = 'native';
      document.documentElement.dataset.cursorEffective = effective;
      emitCursorChange('asset-failed');
    }

    function init() {
      if (inited || !alive) return;
      inited = true;

      document.documentElement.classList.add('custom-cursor-enabled');

      glowEl = document.createElement('div');
      glowEl.className = 'custom-cursor-glow';
      glowEl.setAttribute('aria-hidden', 'true');

      canvas = document.createElement('canvas');
      canvas.id = 'cursor-trail';
      canvas.setAttribute('aria-hidden', 'true');
      ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
      if (!ctx) {
        failToNative();
        return;
      }

      cursorEl = document.createElement('div');
      cursorEl.className = 'custom-cursor-main custom-cursor-classic';
      cursorEl.setAttribute('aria-hidden', 'true');
      cursorEl.style.backgroundImage = `url("${NORMAL_URL}")`;

      document.body.appendChild(glowEl);
      document.body.appendChild(canvas);
      document.body.appendChild(cursorEl);

      for (let i = 0; i < SPRITE_COUNT; i += 1) {
        const hue = (i / SPRITE_COUNT) * 360;
        const sprite = document.createElement('canvas');
        sprite.width = sprite.height = SPRITE_PX;
        const sctx = sprite.getContext('2d');
        const grad = sctx.createRadialGradient(
          SPRITE_PX / 2, SPRITE_PX / 2, 0,
          SPRITE_PX / 2, SPRITE_PX / 2, SPRITE_PX / 2
        );
        grad.addColorStop(0, `hsla(${hue}, 100%, 72%, 1)`);
        grad.addColorStop(0.45, `hsla(${hue}, 100%, 60%, 0.55)`);
        grad.addColorStop(1, `hsla(${hue}, 100%, 60%, 0)`);
        sctx.fillStyle = grad;
        sctx.beginPath();
        sctx.arc(SPRITE_PX / 2, SPRITE_PX / 2, SPRITE_PX / 2, 0, Math.PI * 2);
        sctx.fill();
        sprites.push(sprite);
      }

      resizeCanvas();

      const moveEvent = ('onpointermove' in window) ? 'pointermove' : 'mousemove';
      window.addEventListener(moveEvent, onPointerMove, { passive: true });
      if ('onpointerdown' in window) {
        window.addEventListener('pointerdown', onPointerDown, { passive: true });
      }
      window.addEventListener('pointerup', onPointerUp, { passive: true });
      document.addEventListener('visibilitychange', onVisibility);
      document.addEventListener('mouseleave', hide);
      window.addEventListener('resize', onResize, { passive: true });
      document.addEventListener('mouseover', onMouseOver, { passive: true });
    }

    const rand = (min, max) => min + Math.random() * (max - min);

    function spriteFor(hue) {
      const index = Math.round((((hue % 360) + 360) % 360) / 360 * SPRITE_COUNT) % SPRITE_COUNT;
      return sprites[index];
    }

    function resizeCanvas() {
      if (!canvas || !ctx) return;
      const dpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
      const width = Math.floor(window.innerWidth * dpr);
      const height = Math.floor(window.innerHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function addParticle(x, y, speed, hue) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      const angle = Math.random() * Math.PI * 2;
      const burst = speed * SPEED_SPREAD;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * burst - mouseVX * 0.06,
        vy: Math.sin(angle) * burst - mouseVY * 0.06,
        age: 0,
        life: rand(LIFE_MIN, LIFE_MAX),
        size: rand(SIZE_MIN, SIZE_MAX),
        sprite: spriteFor(hue)
      });
    }

    function addBurst(x, y) {
      const count = 30;
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2;
        if (particles.length >= MAX_PARTICLES) particles.shift();
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * 220,
          vy: Math.sin(angle) * 220,
          age: 0,
          life: rand(LIFE_MIN, LIFE_MAX),
          size: rand(SIZE_MIN, SIZE_MAX),
          sprite: spriteFor(hueBase + i * 10)
        });
      }
      start();
    }

    function start() {
      if (running || document.hidden || !alive) return;
      running = true;
      lastTs = performance.now();
      rafId = window.requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    function frame(ts) {
      if (!visible || document.hidden || !alive) {
        stop();
        return;
      }

      const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
      lastTs = ts;

      cursorEl.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0)`;
      glowEl.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0)`;

      mouseVX = (mouseX - prevX) / Math.max(dt, 1e-6);
      mouseVY = (mouseY - prevY) / Math.max(dt, 1e-6);
      const dx = mouseX - prevX;
      const dy = mouseY - prevY;
      const distance = Math.hypot(dx, dy);
      prevX = mouseX;
      prevY = mouseY;

      hueBase = (hueBase + HUE_SPEED * dt) % 360;

      distanceAccum += distance * PARTICLES_PER_PX + IDLE_PARTICLES_PER_SEC * dt;
      const speed = Math.hypot(mouseVX, mouseVY);
      const spawn = Math.min(20, Math.floor(distanceAccum));
      if (spawn > 0) {
        distanceAccum -= spawn;
        for (let i = 0; i < spawn; i += 1) {
          const t = spawn === 1 ? 1 : i / (spawn - 1);
          addParticle(mouseX - dx * t, mouseY - dy * t, speed, hueBase + i * 6);
        }
      }

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (particles.length) {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = particles.length - 1; i >= 0; i -= 1) {
          const particle = particles[i];
          particle.age += dt;
          const lifeT = particle.age / particle.life;
          if (lifeT >= 1) {
            particles.splice(i, 1);
            continue;
          }
          const drag = Math.pow(DRAG, dt * 60);
          particle.vx *= drag;
          particle.vy *= drag;
          particle.x += particle.vx * dt;
          particle.y += particle.vy * dt;

          const radius = particle.size * 2.4;
          ctx.globalAlpha = Math.sin((1 - lifeT) * (Math.PI / 2));
          ctx.drawImage(
            particle.sprite,
            particle.x - radius,
            particle.y - radius,
            radius * 2,
            radius * 2
          );
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      rafId = window.requestAnimationFrame(frame);
    }

    function show() {
      if (!alive || visible) return;
      visible = true;
      resizeCanvas();
      cursorEl.style.display = 'block';
      glowEl.style.display = 'block';
      canvas.style.display = 'block';
      start();
    }

    function hide() {
      visible = false;
      stop();
      if (cursorEl) cursorEl.style.display = 'none';
      if (glowEl) glowEl.style.display = 'none';
      if (canvas) canvas.style.display = 'none';
    }

    function updatePointer(x, y) {
      mouseX = x;
      mouseY = y;
      if (!visible) {
        prevX = x;
        prevY = y;
        show();
      } else if (!running) {
        start();
      }
    }

    function setReversed(next) {
      if (next === reversed || !cursorEl) return;
      reversed = next;
      cursorEl.style.backgroundImage = `url("${next ? REVERSED_URL : NORMAL_URL}")`;
    }

    function onPointerMove(event) {
      if (event.pointerType === 'touch') return;
      updatePointer(event.clientX, event.clientY);
    }

    function onPointerDown(event) {
      if (event.pointerType === 'touch') return;
      updatePointer(event.clientX, event.clientY);
    }

    function onPointerUp(event) {
      if (event.pointerType === 'touch') return;
      addBurst(event.clientX, event.clientY);
    }

    function onMouseOver(event) {
      const target = event.target;
      setReversed(Boolean(target && target.closest && target.closest('a, button, [role="button"]')));
    }

    function onVisibility() {
      if (document.hidden) stop();
      else if (visible) start();
    }

    function onResize() {
      if (visible) resizeCanvas();
    }

    function cleanup() {
      alive = false;
      stop();
      const moveEvent = ('onpointermove' in window) ? 'pointermove' : 'mousemove';
      window.removeEventListener(moveEvent, onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('mouseleave', hide);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mouseover', onMouseOver);

      if (cursorEl && cursorEl.parentNode) cursorEl.parentNode.removeChild(cursorEl);
      if (glowEl && glowEl.parentNode) glowEl.parentNode.removeChild(glowEl);
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      cursorEl = null;
      glowEl = null;
      canvas = null;
      ctx = null;
      sprites = [];
      particles.length = 0;

      document.documentElement.classList.remove('custom-cursor-enabled');
    }

    return cleanup;
  }

  /* ------------------------------------------------------------------
   * Public controls + capability changes
   * ------------------------------------------------------------------ */
  window.SiteCursor = {
    getScheme: () => requested,
    getEffectiveScheme: () => effective,
    setScheme,
    schemes: SCHEMES.slice()
  };

  apply('init');

  function onCapabilityChange() {
    apply('capability');
  }

  if (phoneShell) {
    if (typeof phoneShell.addEventListener === 'function') {
      phoneShell.addEventListener('change', onCapabilityChange);
    } else if (typeof phoneShell.addListener === 'function') {
      phoneShell.addListener(onCapabilityChange);
    }
  }

  if (coarsePointer) {
    if (typeof coarsePointer.addEventListener === 'function') {
      coarsePointer.addEventListener('change', onCapabilityChange);
    } else if (typeof coarsePointer.addListener === 'function') {
      coarsePointer.addListener(onCapabilityChange);
    }
  }

  if (reduceMotion) {
    if (typeof reduceMotion.addEventListener === 'function') {
      reduceMotion.addEventListener('change', onCapabilityChange);
    } else if (typeof reduceMotion.addListener === 'function') {
      reduceMotion.addListener(onCapabilityChange);
    }
  }
})();
