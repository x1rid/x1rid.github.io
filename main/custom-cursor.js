/* ============================================================================
 *  Animated GIF cursor + rainbow particle trail (optimized)
 *  ----------------------------------------------------------------------------
 *  Restores the retro custom cursor with its effects, but cheaper than the
 *  original:
 *    - Runs only when motion is allowed and the pointer is fine (not touch).
 *    - The native cursor is hidden only once the GIF has actually loaded.
 *    - The render loop stops when the pointer leaves the window or the tab is
 *      hidden, and restarts on the next move.
 *    - Particles are blitted from a pre-rendered hue sprite sheet instead of
 *      building a radial gradient for every particle on every frame.
 *    - Canvas DPR is capped at 1.5 to cut fill-rate cost on hi-DPI screens.
 * ========================================================================== */
(() => {
  'use strict';

  if (window.__CUSTOM_CURSOR_INIT__) return;
  window.__CUSTOM_CURSOR_INIT__ = true;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarsePointer = (navigator.maxTouchPoints > 0) ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  if (reduceMotion || coarsePointer) return;

  const NORMAL_URL = window.__CURSOR_NORMAL_URL || './assets/cursor.gif';
  const REVERSED_URL = window.__CURSOR_REVERSED_URL || './assets/cursor-reversed.gif';

  /* ── Tuning ─────────────────────────────────────────────────────────── */
  const MAX_PARTICLES = 150;
  const LIFE_MIN = 0.50;               // seconds
  const LIFE_MAX = 0.95;
  const SIZE_MIN = 1.4;                // particle core px
  const SIZE_MAX = 2.4;
  const DRAG = 0.90;                   // velocity retention per 60fps frame
  const SPEED_SPREAD = 0.12;           // how much mouse speed sprays particles
  const PARTICLES_PER_PX = 0.16;       // trail density while moving
  const IDLE_PARTICLES_PER_SEC = 16;   // gentle shimmer when idle
  const HUE_SPEED = 220;               // deg/sec rainbow rotation
  const SPRITE_COUNT = 36;             // hue steps in the sprite sheet
  const SPRITE_PX = 32;                // sprite source size
  const MAX_DPR = 1.5;

  /* Hide the native cursor only after the GIF is confirmed present. */
  const probe = new Image();
  probe.decoding = 'async';
  probe.onload = init;
  probe.onerror = () => { /* asset missing — keep the system cursor */ };
  probe.src = NORMAL_URL;

  let inited = false;

  function init() {
    if (inited) return;
    inited = true;

    document.documentElement.classList.add('custom-cursor-enabled');

    /* ── DOM ──────────────────────────────────────────────────────────── */
    const glowEl = document.createElement('div');
    glowEl.className = 'custom-cursor-glow';
    glowEl.setAttribute('aria-hidden', 'true');

    const canvas = document.createElement('canvas');
    canvas.id = 'cursor-trail';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });

    const cursorEl = document.createElement('div');
    cursorEl.className = 'custom-cursor-main';
    cursorEl.setAttribute('aria-hidden', 'true');
    cursorEl.style.backgroundImage = `url("${NORMAL_URL}")`;

    document.body.appendChild(glowEl);
    document.body.appendChild(canvas);
    document.body.appendChild(cursorEl);

    /* ── Sprite sheet: one soft glow per hue ──────────────────────────── */
    const sprites = [];
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
    const spriteFor = (hue) => sprites[Math.round((((hue % 360) + 360) % 360) / 360 * SPRITE_COUNT) % SPRITE_COUNT];

    /* ── Canvas sizing ────────────────────────────────────────────────── */
    let dpr = 1;
    function resizeCanvas() {
      const next = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
      const w = Math.floor(window.innerWidth * next);
      const h = Math.floor(window.innerHeight * next);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      dpr = next;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resizeCanvas();

    /* ── State ────────────────────────────────────────────────────────── */
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

    const rand = (min, max) => min + Math.random() * (max - min);

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

    /* ── Render loop ──────────────────────────────────────────────────── */
    function start() {
      if (running || document.hidden) return;
      running = true;
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    function frame(ts) {
      if (!visible || document.hidden) {
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
      const dist = Math.hypot(dx, dy);
      prevX = mouseX;
      prevY = mouseY;

      hueBase = (hueBase + HUE_SPEED * dt) % 360;

      distanceAccum += dist * PARTICLES_PER_PX + IDLE_PARTICLES_PER_SEC * dt;
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
          const p = particles[i];
          p.age += dt;
          const lifeT = p.age / p.life;
          if (lifeT >= 1) {
            particles.splice(i, 1);
            continue;
          }
          const drag = Math.pow(DRAG, dt * 60);
          p.vx *= drag;
          p.vy *= drag;
          p.x += p.vx * dt;
          p.y += p.vy * dt;

          const r = p.size * 2.4;
          ctx.globalAlpha = Math.sin((1 - lifeT) * (Math.PI / 2));
          ctx.drawImage(p.sprite, p.x - r, p.y - r, r * 2, r * 2);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      rafId = requestAnimationFrame(frame);
    }

    /* ── Visibility ───────────────────────────────────────────────────── */
    function show() {
      if (visible) return;
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
      cursorEl.style.display = 'none';
      glowEl.style.display = 'none';
      canvas.style.display = 'none';
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

    /* ── Events ───────────────────────────────────────────────────────── */
    const moveEvent = ('onpointermove' in window) ? 'pointermove' : 'mousemove';
    window.addEventListener(moveEvent, (event) => updatePointer(event.clientX, event.clientY), { passive: true });

    if ('onpointerdown' in window) {
      window.addEventListener('pointerdown', (event) => updatePointer(event.clientX, event.clientY), { passive: true });
    }

    window.addEventListener('pointerup', (event) => {
      addBurst(event.clientX, event.clientY);
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stop();
      } else if (visible) {
        start();
      }
    });

    document.addEventListener('mouseleave', hide);
    window.addEventListener('resize', () => { if (visible) resizeCanvas(); }, { passive: true });

    /* Reverse the cursor over interactive elements (links/buttons). */
    function setReversed(next) {
      if (next === reversed) return;
      reversed = next;
      cursorEl.style.backgroundImage = `url("${next ? REVERSED_URL : NORMAL_URL}")`;
    }

    document.addEventListener('mouseover', (event) => {
      const target = event.target;
      setReversed(!!(target && target.closest && target.closest('a, button, [role="button"]')));
    }, { passive: true });
  }
})();
