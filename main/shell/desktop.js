/* ---------------------------------------------------------------------------
 * shell/desktop.js
 *
 * Desktop surface: Clippy assistant, live wallpaper canvas, taskbar clock, show-desktop and tray wiring.
 *
 * Loaded as a classic script. Top-level bindings are shared between shell files;
 * runtime statements live in shellInit_* functions that boot.js calls in order
 * after window.ProfileReady.
 * ------------------------------------------------------------------------- */
'use strict';

/* Shared bindings (assigned in the shellInit_* chunks below). */
let CLIPPY_VISIBILITY_KEY, clippyAgent, clippyLoading, clippyWanted, wallpaperContext, motionQuery,
    wallpaperStars, wallpaperWidth, wallpaperHeight, wallpaperFrame, wallpaperLast, wallpaperPaused;

function rememberClippyVisibility(visible) {
    try { sessionStorage.setItem(CLIPPY_VISIBILITY_KEY, visible ? '1' : '0'); } catch (_error) { /* optional preference */ }
}

function preferredClippyVisibility() {
    try {
        const stored = sessionStorage.getItem(CLIPPY_VISIBILITY_KEY);
        return stored === null ? true : stored === '1';
    } catch (_error) {
        return true;
    }
}

function updateClippyToggle() {
    if (!clippyToggle) return;
    clippyToggle.setAttribute('aria-pressed', String(clippyWanted));
    clippyToggle.setAttribute('aria-label', clippyWanted ? 'Hide assistant' : 'Show assistant');
    clippyToggle.title = clippyWanted ? 'Hide assistant' : 'Show assistant';
}

function positionClippy() {
    if (!clippyAgent || !clippyWanted) return;
    const taskbarHeight = taskbar ? taskbar.getBoundingClientRect().height : 36;
    const left = Math.max(12, window.innerWidth - 152);
    const top = Math.max(12, window.innerHeight - taskbarHeight - 128);
    clippyAgent.moveTo(left, top, 0);
}

function hideClippy() {
    clippyWanted = false;
    rememberClippyVisibility(false);
    updateClippyToggle();
    if (clippyAgent) clippyAgent.hide(true);
}

function showClippy({ introduce = false } = {}) {
    clippyWanted = true;
    rememberClippyVisibility(true);
    updateClippyToggle();

    if (clippyAgent) {
        clippyAgent.show(true);
        positionClippy();
        if (introduce) clippyAgent.speak('I am ready to help with this desktop.');
        return;
    }
    if (clippyLoading || !window.clippy) return;

    clippyLoading = true;
    window.clippy.BASE_PATH = './vendor/clippy/agents/';
    window.clippy.load('Clippy', (agent) => {
        clippyLoading = false;
        clippyAgent = agent;
        if (!clippyWanted) {
            agent.hide(true);
            return;
        }
        agent.show(true);
        positionClippy();
        if (introduce) agent.speak('It looks like you are exploring a retro desktop.');
    }, () => {
        clippyLoading = false;
        clippyWanted = false;
        updateClippyToggle();
        toast('ASSISTANT ASSETS UNAVAILABLE', 3000);
    });
}

function makeStars() {
    const count = Math.max(70, Math.round((wallpaperWidth * wallpaperHeight) / 6500));
    wallpaperStars = Array.from({ length: count }, (_, index) => {
        const layer = index % 3;
        return {
            x: Math.random() * wallpaperWidth,
            y: Math.random() * wallpaperHeight,
            size: layer === 2 ? 2 : 1,
            speed: layer === 0 ? 1.2 : (layer === 1 ? 2.6 : 4.2),
            phase: Math.random() * Math.PI * 2,
            alpha: layer === 0 ? 0.3 : (layer === 1 ? 0.52 : 0.82)
        };
    });
}

function drawWallpaper(dt) {
    if (!wallpaperContext) return;
    wallpaperContext.clearRect(0, 0, wallpaperWidth, wallpaperHeight);
    const now = performance.now() / 1000;
    const animate = !wallpaperPaused && !motionQuery.matches;

    wallpaperStars.forEach((star) => {
        if (animate) {
            star.x -= star.speed * dt;
            if (star.x < -2) {
                star.x = wallpaperWidth + 2;
                star.y = Math.random() * wallpaperHeight;
            }
        }
        const twinkle = 0.65 + 0.35 * Math.sin(now * 0.7 + star.phase);
        const alpha = star.alpha * twinkle;
        wallpaperContext.fillStyle = `rgba(242, 234, 255, ${alpha.toFixed(3)})`;
        wallpaperContext.fillRect(Math.round(star.x), Math.round(star.y), star.size, star.size);
        if (star.size > 1) {
            wallpaperContext.fillStyle = `rgba(192, 132, 252, ${(alpha * 0.35).toFixed(3)})`;
            wallpaperContext.fillRect(Math.round(star.x) - 1, Math.round(star.y), 4, 1);
            wallpaperContext.fillRect(Math.round(star.x), Math.round(star.y) - 1, 1, 4);
        }
    });
}

function tick(now) {
    wallpaperFrame = 0;
    const dt = Math.min(0.05, Math.max(0, (now - wallpaperLast) / 1000));
    wallpaperLast = now;
    drawWallpaper(dt);
    if (!wallpaperPaused && !document.hidden && !motionQuery.matches) {
        wallpaperFrame = window.requestAnimationFrame(tick);
    }
}

function startWallpaper() {
    if (wallpaperFrame || wallpaperPaused || document.hidden || motionQuery.matches) return;
    wallpaperLast = performance.now();
    wallpaperFrame = window.requestAnimationFrame(tick);
}

function stopWallpaper() {
    if (wallpaperFrame) window.cancelAnimationFrame(wallpaperFrame);
    wallpaperFrame = 0;
    drawWallpaper(0);
}

function syncWallpaperMotion() {
    if (wallpaperPaused || document.hidden || motionQuery.matches) stopWallpaper();
    else startWallpaper();
}

function resizeWallpaper() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    wallpaperWidth = Math.max(1, desktop.clientWidth);
    wallpaperHeight = Math.max(1, desktop.clientHeight);
    wallpaperCanvas.width = Math.round(wallpaperWidth * dpr);
    wallpaperCanvas.height = Math.round(wallpaperHeight * dpr);
    wallpaperContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    makeStars();
    drawWallpaper(0);
}

/* ── Clock and show desktop ─────────────────────────────── */
function updateTaskbarClock() {
    const now = new Date();
    taskbarClock.textContent = now.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    taskbarClock.title = now.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function toggleShowDesktop() {
    if (showDesktopState) {
        const restore = showDesktopState;
        showDesktopState = null;
        showDesktopButton.setAttribute('aria-pressed', 'false');
        restore.forEach((id) => {
            const win = windows.get(id);
            if (win && !win.closed) {
                win.minimized = false;
                win.node.classList.remove('is-minimized');
            }
        });
        if (restore.length) focusWindow(restore[restore.length - 1], true);
        syncTaskbar();
        persistWindowState();
        return;
    }

    const visible = Array.from(windows.values()).filter((win) => !win.closed && !win.minimized);
    if (!visible.length) return;
    showDesktopState = visible.map((win) => win.id);
    showDesktopButton.setAttribute('aria-pressed', 'true');
    visible.forEach((win) => minimizeWindow(win.id));
    persistWindowState();
}

/* Original inline-script statements, lines 117-120+ */
function shellInit_desktop_1() {
    /* ── Desktop assistant — local Clippy.js port ─────────────── */
    CLIPPY_VISIBILITY_KEY = 'r3d1bruh.desktop.clippy.visible';

    clippyAgent = null;

    clippyLoading = false;

    clippyWanted = false;
}

/* Original inline-script statements, lines 2541-2697+ */
function shellInit_desktop_2() {
    /* ── Live wallpaper ─────────────────────────────────────── */
    wallpaperContext = wallpaperCanvas.getContext('2d');

    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    wallpaperStars = [];

    wallpaperWidth = 1;

    wallpaperHeight = 1;

    wallpaperFrame = 0;

    wallpaperLast = 0;

    wallpaperPaused = false;

    wallpaperToggle.addEventListener('click', () => {
        wallpaperPaused = !wallpaperPaused;
        wallpaperToggle.setAttribute('aria-pressed', String(wallpaperPaused));
        wallpaperToggle.textContent = wallpaperPaused ? '✧' : '✦';
        const label = wallpaperPaused ? 'Resume live wallpaper' : 'Pause live wallpaper';
        wallpaperToggle.title = label;
        wallpaperToggle.setAttribute('aria-label', label);
        if (wallpaperPaused) {
            stopWallpaper();
            toast('LIVE WALLPAPER PAUSED');
        } else {
            startWallpaper();
            toast('LIVE WALLPAPER RESUMED');
        }
    });

    document.addEventListener('visibilitychange', syncWallpaperMotion);

    if (typeof motionQuery.addEventListener === 'function') {
        motionQuery.addEventListener('change', syncWallpaperMotion);
    } else if (typeof motionQuery.addListener === 'function') {
        motionQuery.addListener(syncWallpaperMotion);
    }

    showDesktopButton.addEventListener('click', toggleShowDesktop);

    /* ── Assistant tray button wiring ──────────────────────── */
    if (clippyToggle) {
        clippyToggle.addEventListener('click', () => {
            if (clippyWanted) {
                hideClippy();
            } else {
                showClippy({ introduce: true });
            }
        });
    }
}
