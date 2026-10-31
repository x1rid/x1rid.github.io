window.ProfileReady.then(() => {
    'use strict';

    const desktop = document.getElementById('desktop');
    const taskbar = document.getElementById('taskbar');
    const taskbarApps = document.getElementById('taskbar-apps');
    const taskbarClock = document.getElementById('taskbar-clock');
    const startButton = document.getElementById('start-button');
    const startMenu = document.getElementById('start-menu');
    const startInput = document.getElementById('start-input');
    const startResults = document.getElementById('start-results');
    const startClose = document.getElementById('start-close');
    const shellToast = document.getElementById('shell-toast');
    const wallpaperToggle = document.getElementById('wallpaper-toggle');
    const showDesktopButton = document.getElementById('show-desktop');
    const clippyToggle = document.getElementById('clippy-toggle');
    const explorerNode = document.getElementById('explorer');
    const terminalTemplate = document.getElementById('terminal-template');
    const wallpaperCanvas = document.getElementById('wallpaper');
    const musicNode = document.getElementById('music');
    const programsNode = document.getElementById('programs');
    const programsButton = document.getElementById('programs-button');
    const taskbarMusic = document.getElementById('taskbar-music');
    const miniOpen = document.getElementById('mini-open');
    const miniPlay = document.getElementById('mini-play');
    const miniNext = document.getElementById('mini-next');
    const miniTrack = document.getElementById('mini-track');
    const musicTrackTitle = document.getElementById('music-track-title');
    const musicStatus = document.getElementById('music-status');
    const musicProgress = document.getElementById('music-progress');
    const musicTime = document.getElementById('music-time');
    const musicDuration = document.getElementById('music-duration');
    const musicPlay = document.getElementById('music-play');
    const musicPrev = document.getElementById('music-prev');
    const musicNext = document.getElementById('music-next');
    const musicVolume = document.getElementById('music-volume');
    const musicVolumeValue = document.getElementById('music-volume-value');
    const musicList = document.getElementById('music-list');
    const musicCount = document.getElementById('music-count');
    const musicSource = document.getElementById('music-source');

    const windows = new Map();
    let restoringWindows = true;
    const windowState = window.ProfileWindowState ? window.ProfileWindowState.create({
        profileId: (window.ProfileService && window.ProfileService.getActiveProfile() || {}).id,
        getWindows: () => windows,
        getWMState: () => (window.ShellWM ? window.ShellWM.snapshotState() : null)
    }) : null;

    if (windowState) windowState.setRestoring(true);

    function persistWindowState() {
        if (windowState && !restoringWindows) windowState.schedule();
    }

    const shellStartedAt = Date.now();
    let zCounter = 10;
    let activeWindowId = null;
    let terminalCount = 0;
    const terminalSessions = new Map();
    let shellShortcutsRegistered = false;
    let toastTimer = 0;
    let showDesktopState = null;
    let searchItems = [];
    let searchActiveIndex = -1;
    let musicAudio = null;
    let musicTracks = [];
    let musicIndex = -1;
    let musicPlaying = false;
    let musicLoading = false;
    let musicBlocked = false;
    let musicError = false;
    let musicDiscovering = true;
    let musicSeeking = false;
    let musicPendingPlay = false;
    let musicSourceReady = false;
    let musicLoadToken = 0;
    let musicVolumeLevel = 0.45;
    let musicSourceLabel = 'playlist/';

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const escapeHtml = (value) => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    function setActiveWindowMarker(id) {
        document.body.dataset.activeWindow = id || 'none';
    }

    function clearShowDesktopState() {
        if (!showDesktopState) return;
        showDesktopState = null;
        showDesktopButton.setAttribute('aria-pressed', 'false');
    }

    function toast(message, duration = 2200) {
        shellToast.textContent = message;
        shellToast.hidden = false;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
            shellToast.hidden = true;
        }, duration);
    }

    // Keep the legacy `window.toast` hook working for persistence diagnostics
    // and hand the same renderer to the shared notification service.
    window.toast = toast;
    if (window.SystemServices) {
        window.SystemServices.notifications.configure({ renderer: toast });
    }

    /* ── Desktop assistant — local Clippy.js port ─────────────── */
    const CLIPPY_VISIBILITY_KEY = 'r3d1bruh.desktop.clippy.visible';
    let clippyAgent = null;
    let clippyLoading = false;
    let clippyWanted = false;

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

    /* ── Window manager ─────────────────────────────────────── */
    function windowWorkArea() {
        if (window.WindowManagerCore) {
            const desktopRect = desktop.getBoundingClientRect();
            const taskbarRect = taskbar ? taskbar.getBoundingClientRect() : null;
            return window.WindowManagerCore.workArea(
                { x: 0, y: 0, width: desktop.clientWidth, height: desktop.clientHeight },
                taskbarRect ? {
                    x: taskbarRect.left - desktopRect.left,
                    y: taskbarRect.top - desktopRect.top,
                    width: taskbarRect.width,
                    height: taskbarRect.height
                } : null
            );
        }
        return { x: 0, y: 0, width: desktop.clientWidth, height: desktop.clientHeight };
    }

    function setBounds(win, bounds, limits) {
        const area = windowWorkArea();
        const maxWidth = Math.max(1, area.width);
        const maxHeight = Math.max(1, area.height);
        const hardMaxWidth = Math.min(maxWidth, Number.isFinite(win.maxWidth) ? win.maxWidth : maxWidth);
        const hardMaxHeight = Math.min(maxHeight, Number.isFinite(win.maxHeight) ? win.maxHeight : maxHeight);
        const minWidth = Math.min(limits && Number.isFinite(limits.minWidth) ? limits.minWidth : win.minWidth, hardMaxWidth);
        const minHeight = Math.min(limits && Number.isFinite(limits.minHeight) ? limits.minHeight : win.minHeight, hardMaxHeight);
        const width = clamp(bounds.width, minWidth, hardMaxWidth);
        const height = clamp(bounds.height, minHeight, hardMaxHeight);
        const x = clamp(bounds.x, area.x, Math.max(area.x, area.x + area.width - width));
        const y = clamp(bounds.y, area.y, Math.max(area.y, area.y + area.height - height));
        win.x = Math.round(x);
        win.y = Math.round(y);
        win.width = Math.round(width);
        win.height = Math.round(height);
        win.node.style.left = `${win.x}px`;
        win.node.style.top = `${win.y}px`;
        win.node.style.width = `${win.width}px`;
        win.node.style.height = `${win.height}px`;
    }

    function fitWindowToDesktop(win) {
        const area = windowWorkArea();
        if (win.maximized) {
            setBounds(win, {
                x: area.x,
                y: area.y,
                width: area.width,
                height: area.height
            });
            return;
        }
        const pad = 12;
        const maxWidth = Math.max(win.minWidth, area.width - pad * 2);
        const maxHeight = Math.max(win.minHeight, area.height - pad * 2);
        const width = Math.min(win.width, maxWidth);
        const height = Math.min(win.height, maxHeight);
        setBounds(win, {
            x: Math.min(win.x, Math.max(area.x + pad, area.x + area.width - width - pad)),
            y: Math.min(win.y, Math.max(area.y + pad, area.y + area.height - height - pad)),
            width,
            height
        });
    }

    function defaultExplorerBounds() {
        const width = desktop.clientWidth;
        const height = desktop.clientHeight;
        const margin = width < 900 ? 18 : 32;
        const w = Math.min(1040, Math.max(640, width - margin * 2));
        const h = Math.min(660, Math.max(360, height - margin * 2));
        return {
            x: margin,
            y: Math.max(12, Math.floor((height - h) / 2) - 8),
            width: w,
            height: h
        };
    }

    function nextTerminalBounds() {
        const width = desktop.clientWidth;
        const height = desktop.clientHeight;
        const w = Math.min(440, Math.max(340, Math.round(width * 0.46)));
        const h = Math.min(300, Math.max(220, Math.round(height * 0.48)));
        const offset = (terminalCount - 1) * 22;
        return {
            x: Math.max(12, width - w - 24 - (offset % 120)),
            y: Math.max(12, height - h - 22 - (offset % 100)),
            width: w,
            height: h
        };
    }

    function nextMusicBounds() {
        const width = desktop.clientWidth;
        const height = desktop.clientHeight;
        const w = Math.min(460, Math.max(360, Math.round(width * 0.52)));
        const h = Math.min(430, Math.max(320, Math.round(height * 0.82)));
        return {
            x: Math.max(12, width - w - 24),
            y: Math.max(12, height - h - 22),
            width: w,
            height: h
        };
    }

    function addTaskbarButton(win) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'taskbar-app';
        button.dataset.windowId = win.id;
        button.title = win.taskbarTitle;
        button.innerHTML = `<span class="taskbar-app-icon" aria-hidden="true">${escapeHtml(win.icon)}</span><span class="taskbar-app-label">${escapeHtml(win.taskbarTitle)}</span>`;
        button.addEventListener('click', () => taskbarButtonClick(win.id));
        if (win.appId === 'explorer') taskbarApps.prepend(button);
        else taskbarApps.appendChild(button);
        win.taskbarButton = button;
    }

    function syncTaskbar() {
        windows.forEach((win) => {
            if (!win.taskbarButton) return;
            const onWorkspace = !window.ShellWM || workspaceOfWindow(win) === window.ShellWM.state.activeWorkspace;
            win.taskbarButton.hidden = !onWorkspace;
            const active = win.id === activeWindowId && !win.minimized && !win.closed && onWorkspace;
            const label = win.minimized ? `${win.taskbarTitle} (minimized)` : win.taskbarTitle;
            win.taskbarButton.classList.toggle('is-active', active);
            win.taskbarButton.classList.toggle('is-minimized', win.minimized);
            win.taskbarButton.setAttribute('aria-pressed', String(active));
            win.taskbarButton.title = label;
            win.taskbarButton.setAttribute('aria-label', label);
        });
        document.dispatchEvent(new CustomEvent('desktop:windows-changed'));
    }

    function workspaceOfWindow(win) {
        return Number.isFinite(Number(win.workspace)) ? Number(win.workspace) : 0;
    }

    function focusWindow(id, focus = false) {
        const win = windows.get(id);
        if (!win || win.closed) return;
        if (window.ShellWM) window.ShellWM.ensureVisible(win);
        if (win.minimized) {
            win.minimized = false;
            win.node.classList.remove('is-minimized');
            persistWindowState();
        }
        windows.forEach((other) => {
            other.node.classList.toggle('is-active', other.id === id);
            other.node.classList.toggle('is-inactive', other.id !== id);
        });
        win.node.style.zIndex = String(window.ShellWM ? window.ShellWM.nextZ(win) : ++zCounter);
        activeWindowId = id;
        setActiveWindowMarker(id);
        syncTaskbar();
        if (window.ShellWM) window.ShellWM.refreshDividers();

        if (focus) {
            const target = win.focusTarget ? win.node.querySelector(win.focusTarget) : win.node;
            if (target && document.contains(target)) {
                target.focus({ preventScroll: true });
            }
        }

        if (typeof win.onFocus === 'function') win.onFocus();
    }

    function focusTopWindow() {
        const workspace = window.ShellWM ? window.ShellWM.state.activeWorkspace : 0;
        const visible = Array.from(windows.values())
            .filter((win) => !win.closed && !win.minimized &&
                (!window.ShellWM || workspaceOfWindow(win) === workspace));
        if (!visible.length) {
            activeWindowId = null;
            setActiveWindowMarker('none');
            if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.window')) {
                document.activeElement.blur();
            }
            windows.forEach((win) => {
                win.node.classList.remove('is-active');
                win.node.classList.add('is-inactive');
            });
            syncTaskbar();
            return;
        }
        visible.sort((a, b) => Number(a.node.style.zIndex || 0) - Number(b.node.style.zIndex || 0));
        focusWindow(visible[visible.length - 1].id, true);
    }

    function minimizeWindow(id) {
        const win = windows.get(id);
        if (!win || win.closed) return;
        win.minimized = true;
        win.node.classList.add('is-minimized');
        win.node.classList.remove('is-active');
        if (activeWindowId === id) {
            activeWindowId = null;
            setActiveWindowMarker('none');
            focusTopWindow();
        }
        syncTaskbar();
        persistWindowState();
        if (window.ShellWM) window.ShellWM.refreshDividers();
    }

    function restoreWindow(id) {
        const win = windows.get(id);
        if (!win || win.closed) return;
        win.minimized = false;
        win.node.classList.remove('is-minimized');
        focusWindow(id, true);
        persistWindowState();
        if (window.ShellWM) window.ShellWM.refreshDividers();
        if (window.ShellWM) window.ShellWM.onWindowShown(win);
    }

    function closeWindow(id) {
        const win = windows.get(id);
        if (!win || win.closed) return;

        /* App mounts can return a cleanup; the window manager is the only
           thing that knows when the node really goes away. */
        if (typeof win.onClose === 'function') {
            try {
                win.onClose();
            } catch (error) {
                console.warn('window cleanup failed:', error);
            }
            win.onClose = null;
        }

        if (win.appId === 'explorer' || win.appId === 'music' || win.appId === 'programs') {
            win.closed = true;
            win.node.classList.add('is-closed');
            win.node.classList.remove('is-active');
            if (win.taskbarButton) {
                win.taskbarButton.remove();
                win.taskbarButton = null;
            }
            if (activeWindowId === id) {
                activeWindowId = null;
                setActiveWindowMarker('none');
                focusTopWindow();
            }
            syncTaskbar();
            persistWindowState();
            if (window.ShellWM) window.ShellWM.refreshDividers();
            return;
        }

        win.closed = true;
        win.node.remove();
        if (win.taskbarButton) win.taskbarButton.remove();
        windows.delete(id);
        if (activeWindowId === id) {
            activeWindowId = null;
            setActiveWindowMarker('none');
            focusTopWindow();
        }
        syncTaskbar();
        persistWindowState();
        if (window.ShellWM) window.ShellWM.refreshDividers();
    }

    function toggleMaximize(id) {
        const win = windows.get(id);
        if (!win || win.closed || win.minimized) return;
        if (window.ShellWM && window.ShellWM.ready) {
            window.ShellWM.toggleMaximize(win, { animate: true });
            persistWindowState();
            return;
        }
        const button = win.titlebar.querySelector('[data-action="maximize"]');
        if (win.maximized) {
            win.maximized = false;
            win.node.classList.remove('is-maximized');
            setBounds(win, win.previousBounds || {
                x: win.x,
                y: win.y,
                width: win.width,
                height: win.height
            });
            if (button) {
                button.textContent = '□';
                button.title = 'Maximize';
                button.setAttribute('aria-label', `Maximize ${win.title}`);
            }
        } else {
            win.previousBounds = {
                x: win.x,
                y: win.y,
                width: win.width,
                height: win.height
            };
            win.maximized = true;
            win.node.classList.add('is-maximized');
            setBounds(win, {
                x: 0,
                y: 0,
                width: desktop.clientWidth,
                height: desktop.clientHeight
            });
            if (button) {
                button.textContent = '❐';
                button.title = 'Restore';
                button.setAttribute('aria-label', `Restore ${win.title}`);
            }
        }
        focusWindow(id, true);
        persistWindowState();
    }

    function applyPersistedWindowState(win, record) {
        if (!win || !record) return;
        const left = Number(record.left);
        const top = Number(record.top);
        const width = Number(record.width);
        const height = Number(record.height);
        if (![left, top, width, height].every((value) => isFinite(value))) return;

        win.maximized = false;
        win.minimized = false;
        win.node.classList.remove('is-maximized', 'is-minimized');
        win.previousBounds = null;
        win.snap = null;
        if (Number.isFinite(Number(record.workspace))) win.workspace = Number(record.workspace);
        win.alwaysOnTop = Boolean(record.alwaysOnTop);
        win.tiling = Boolean(record.tiling);
        win.userOverride = Boolean(record.userOverride);
        setBounds(win, { x: left, y: top, width, height });

        if (window.ShellWM) window.ShellWM.restoreWindowState(win, record);

        if (record.maximized) {
            win.previousBounds = { x: win.x, y: win.y, width: win.width, height: win.height };
            toggleMaximize(win.id);
        }
        if (record.minimized) {
            minimizeWindow(win.id);
        }
        if (window.ShellWM) window.ShellWM.updateWindow(win);
    }

    function restorePersistedWindows(saved) {
        const registry = window.AppRegistry;
        if (!registry) {
            console.warn('[Shell] Application registry unavailable; skipping window restore.');
            return;
        }

        const ids = Object.keys(saved || {}).sort((a, b) => {
            const aMatch = /^terminal-(\d+)$/.exec(a);
            const bMatch = /^terminal-(\d+)$/.exec(b);
            if (aMatch && bMatch) return Number(aMatch[1]) - Number(bMatch[1]);
            return a.localeCompare(b);
        });

        ids.forEach((id) => {
            const record = saved[id];
            if (!record || !record.appId) return;

            const left = Number(record.left);
            const top = Number(record.top);
            const width = Number(record.width);
            const height = Number(record.height);
            if (![left, top, width, height].every((value) => isFinite(value))) return;
            const bounds = { x: left, y: top, width, height };

            /* Older saves used the generic "program" app id. The registry
               addresses program apps by their logical id. */
            const appId = record.appId === 'program' && id.indexOf('program-') === 0
                ? id.slice('program-'.length)
                : record.appId;

            const win = registry.launch(appId, {
                windowId: id,
                bounds: bounds,
                focus: false,
                restoring: true,
                record: record
            });

            if (win) applyPersistedWindowState(win, record);
        });
    }

    function registerWindow(node, opts) {
        const id = opts.id;
        node.id = id;
        node.classList.add('window');
        node.dataset.windowId = id;
        node.dataset.app = opts.appId;
        node.tabIndex = -1;

        const titlebar = node.querySelector('.titlebar');
        if (!titlebar) throw new Error('Window needs a titlebar');

        const controls = document.createElement('div');
        controls.className = 'window-controls';
        controls.innerHTML = `
            <button class="window-control" type="button" data-action="minimize" title="Minimize" aria-label="Minimize ${escapeHtml(opts.title)}">_</button>
            <button class="window-control" type="button" data-action="maximize" title="Maximize" aria-label="Maximize ${escapeHtml(opts.title)}">□</button>
            <button class="window-control" type="button" data-action="close" title="Close" aria-label="Close ${escapeHtml(opts.title)}">×</button>
        `;
        titlebar.appendChild(controls);

        ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach((dir) => {
            const handle = document.createElement('div');
            handle.className = `resize-handle ${dir}`;
            handle.dataset.dir = dir;
            handle.setAttribute('aria-hidden', 'true');
            node.appendChild(handle);
        });

        const win = {
            id,
            node,
            titlebar,
            appId: opts.appId,
            title: opts.title,
            taskbarTitle: opts.taskbarTitle || opts.title,
            icon: opts.icon || '▣',
            minWidth: opts.minWidth || 320,
            minHeight: opts.minHeight || 200,
            maxWidth: Number.isFinite(opts.maxWidth) ? opts.maxWidth : Infinity,
            maxHeight: Number.isFinite(opts.maxHeight) ? opts.maxHeight : Infinity,
            focusTarget: opts.focusTarget || null,
            onFocus: opts.onFocus || null,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            minimized: false,
            maximized: false,
            closed: false,
            previousBounds: null,
            snap: null,
            workspace: 0,
            alwaysOnTop: false,
            tiling: false,
            userOverride: false,
            taskbarButton: null
        };

        windows.set(id, win);
        setBounds(win, opts.bounds);

        if (window.ShellWM) window.ShellWM.onWindowRegistered(win, opts);

        node.addEventListener('pointerdown', () => {
            if (!win.closed) focusWindow(id);
        }, true);

        node.addEventListener('focusin', () => {
            if (!win.closed && !win.minimized) focusWindow(id);
        });

        node.addEventListener('pointerdown', (event) => {
            if (event.target.closest('input, textarea, button, a, tr, .tree-row, .splitter, [role="treeitem"], [role="row"], .resize-handle')) return;
            if (win.closed || win.minimized) return;
            const target = win.focusTarget ? win.node.querySelector(win.focusTarget) : win.node;
            if (target) target.focus({ preventScroll: true });
        });

        titlebar.addEventListener('pointerdown', (event) => startDrag(event, win));
        titlebar.addEventListener('dblclick', (event) => {
            if (!event.target.closest('.window-controls')) toggleMaximize(id);
        });

        node.querySelectorAll('.window-control').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const action = button.dataset.action;
                if (action === 'minimize') minimizeWindow(id);
                else if (action === 'maximize') toggleMaximize(id);
                else if (action === 'close') closeWindow(id);
            });
        });

        node.querySelectorAll('.resize-handle').forEach((handle) => {
            handle.addEventListener('pointerdown', (event) => startResize(event, win, handle.dataset.dir));
        });

        if (opts.startClosed) {
            win.closed = true;
            win.node.classList.add('is-closed');
            syncTaskbar();
        } else {
            addTaskbarButton(win);
            focusWindow(id);
        }
        persistWindowState();
        return win;
    }

    function startDrag(event, win) {
        if (event.button !== 0 || win.closed) return;
        if (event.target.closest('.window-controls, button, input, textarea, select, a, .resize-handle')) return;
        if (window.ShellWM && window.ShellWM.ready) {
            window.ShellWM.beginDrag(event, win);
            return;
        }
        if (win.maximized) return;
        event.preventDefault();
        focusWindow(win.id);

        const startX = event.clientX;
        const startY = event.clientY;
        const startLeft = win.x;
        const startTop = win.y;
        document.body.classList.add('is-dragging');

        const onMove = (moveEvent) => {
            const maxX = Math.max(0, desktop.clientWidth - 120);
            const maxY = Math.max(0, desktop.clientHeight - 34);
            win.x = clamp(startLeft + moveEvent.clientX - startX, 0, maxX);
            win.y = clamp(startTop + moveEvent.clientY - startY, 0, maxY);
            win.node.style.left = `${win.x}px`;
            win.node.style.top = `${win.y}px`;
        };

        const onUp = () => {
            document.body.classList.remove('is-dragging');
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            persistWindowState();
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }

    function startResize(event, win, dir) {
        if (event.button !== 0 || win.maximized || win.closed) return;
        if (window.ShellWM && window.ShellWM.ready) {
            window.ShellWM.beginResize(event, win, dir);
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        focusWindow(win.id, true);

        const startX = event.clientX;
        const startY = event.clientY;
        const startLeft = win.x;
        const startTop = win.y;
        const startWidth = win.width;
        const startHeight = win.height;
        const right = startLeft + startWidth;
        const bottom = startTop + startHeight;
        document.body.classList.add('is-resizing');

        const onMove = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            let left = startLeft;
            let top = startTop;
            let width = startWidth;
            let height = startHeight;

            if (dir.includes('w')) {
                left = clamp(startLeft + dx, 0, right - win.minWidth);
                width = right - left;
            } else if (dir.includes('e')) {
                width = clamp(startWidth + dx, win.minWidth, desktop.clientWidth - startLeft);
            }

            if (dir.includes('n')) {
                top = clamp(startTop + dy, 0, bottom - win.minHeight);
                height = bottom - top;
            } else if (dir.includes('s')) {
                height = clamp(startHeight + dy, win.minHeight, desktop.clientHeight - startTop);
            }

            setBounds(win, { x: left, y: top, width, height });
        };

        const onUp = () => {
            document.body.classList.remove('is-resizing');
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            persistWindowState();
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }

    function taskbarButtonClick(id) {
        const win = windows.get(id);
        if (!win || win.closed) return;
        clearShowDesktopState();
        if (win.minimized) {
            if (window.ShellWM && window.ShellWM.restoreGroupFor(win)) {
                persistWindowState();
                return;
            }
            restoreWindow(id);
        } else if (activeWindowId === id) minimizeWindow(id);
        else focusWindow(id, true);
    }

    function openExplorer(target) {
        const options = typeof target === 'string' ? { nodeId: target } : (target || {});
        const win = windows.get('explorer');
        if (!win) return null;
        clearShowDesktopState();
        if (win.closed) {
            win.closed = false;
            win.node.classList.remove('is-closed');
            if (window.ShellWM) win.workspace = window.ShellWM.state.activeWorkspace;
            if (!win.taskbarButton) addTaskbarButton(win);
            fitWindowToDesktop(win);
        } else if (win.minimized) {
            restoreWindow('explorer');
        }
        if (options.focus !== false) focusWindow('explorer', true);
        if (window.AppRegistry) window.AppRegistry.attachWindow('explorer', win);
        if (options.nodeId && typeof window.navigateExplorer === 'function') {
            window.navigateExplorer(options.nodeId);
        }
        persistWindowState();
        return win;
    }
    window.openExplorerWindow = openExplorer;

    function openMusic(options) {
        options = options || {};
        const win = windows.get('music');
        if (!win) return null;
        clearShowDesktopState();
        if (win.closed) {
            win.closed = false;
            win.node.classList.remove('is-closed');
            if (window.ShellWM) win.workspace = window.ShellWM.state.activeWorkspace;
            if (!win.taskbarButton) addTaskbarButton(win);
            fitWindowToDesktop(win);
        }
        if (options.focus !== false) focusWindow('music', true);
        if (window.AppRegistry) window.AppRegistry.attachWindow('music', win);
        persistWindowState();
        return win;
    }

    function openTerminal(options) {
        options = options || {};
        clearShowDesktopState();
        const requestedId = options.windowId || options.id;
        let number;
        if (requestedId && /^terminal-(\d+)$/.test(requestedId)) {
            number = Number(requestedId.slice('terminal-'.length));
            terminalCount = Math.max(terminalCount, number);
        } else {
            terminalCount += 1;
            number = terminalCount;
        }
        const fragment = terminalTemplate.content.cloneNode(true);
        const node = fragment.querySelector('.terminal-window');
        const id = requestedId || `terminal-${number}`;
        node.id = id;
        node.setAttribute('aria-label', `Terminal ${number}`);
        node.querySelector('.titlebar-title').textContent = `Terminal ${number}`;
        node.querySelector('.tty-cell').textContent = `TTY ${String(number).padStart(2, '0')}`;
        desktop.appendChild(node);

        const dialect = options.dialect || 'bash';
        const winTitle = options.title || (dialect === 'cmd' ? `Command Prompt ${number}` : (dialect === 'powershell' ? `Windows PowerShell ${number}` : `Terminal ${number}`));
        node.querySelector('.titlebar-title').textContent = winTitle;
        node.setAttribute('aria-label', winTitle);
        node.querySelector('.terminal-status-cell:nth-child(2)').textContent = dialect === 'cmd' ? 'cmd 4.10' : (dialect === 'powershell' ? 'powershell 5.1' : 'bash 5.1');

        const win = registerWindow(node, {
            id,
            appId: dialect === 'cmd' ? 'cmd' : (dialect === 'powershell' ? 'powershell' : (dialect === 'bash' ? 'bash' : 'terminal')),
            title: winTitle,
            taskbarTitle: winTitle,
            icon: '>_',
            minWidth: 340,
            minHeight: 220,
            bounds: options.bounds || nextTerminalBounds(),
            focusTarget: '.terminal-input'
        });

        initTerminal(win, options);
        if (window.AppRegistry) window.AppRegistry.attachWindow(win.appId, win, { windowId: id });
        if (options.focus !== false) focusWindow(id, true);
        persistWindowState();
        return win;
    }

    /* ------------------------------------------------------------------
     * Programs — launcher window + one window per program.
     * ------------------------------------------------------------------ */
    const PROGRAM_GLYPHS = {
        minesweeper: 'M',
        paint: 'P',
        solitaire: 'S',
        calculator: 'C',
        mediaplayer: 'M',
        flowerbox: 'F',
        notepad: 'N',
        pinball: 'B',
        pipes: 'I',
        soundrecorder: 'A',
        winamp: 'W'
    };

    const PROGRAM_SIZES = {
        minesweeper: { width: 560, height: 600, minWidth: 420, minHeight: 420 },
        paint: { width: 760, height: 640, minWidth: 480, minHeight: 440 },
        solitaire: { width: 660, height: 600, minWidth: 520, minHeight: 460 },
        calculator: { width: 360, height: 520, minWidth: 300, minHeight: 440 },
        mediaplayer: { width: 500, height: 420, minWidth: 360, minHeight: 320 },
        flowerbox: { width: 620, height: 640, minWidth: 420, minHeight: 440 },
        notepad: { width: 720, height: 580, minWidth: 480, minHeight: 380 },
        pinball: { width: 700, height: 620, minWidth: 520, minHeight: 480 },
        pipes: { width: 780, height: 620, minWidth: 520, minHeight: 420 },
        soundrecorder: { width: 640, height: 540, minWidth: 460, minHeight: 400 },
        winamp: { width: 340, height: 520, minWidth: 300, minHeight: 380 }
    };

    /* File types the shell already knows how to route to an application.
       Phase 3 publishes the metadata; the association UI is still owned by
       Explorer until the shared services phase. */
    const PROGRAM_FILE_TYPES = {
        mediaplayer: ['mp3', 'opus', 'wav', 'ogg', 'mp4', 'webm', 'flac', 'aac', 'm4a']
    };

    function programDefinition(id) {
        return window.RetroApps && typeof window.RetroApps.get === 'function'
            ? window.RetroApps.get(id)
            : null;
    }

    function nextProgramBounds(id, index) {
        const size = PROGRAM_SIZES[id] || { width: 620, height: 540, minWidth: 360, minHeight: 320 };
        const maxWidth = Math.max(300, desktop.clientWidth - 48);
        const maxHeight = Math.max(260, desktop.clientHeight - 48);
        const width = Math.min(size.width, maxWidth);
        const height = Math.min(size.height, maxHeight);
        const offset = (index % 4) * 22;
        return {
            x: Math.max(12, Math.round((desktop.clientWidth - width) / 2) + offset),
            y: Math.max(12, Math.round((desktop.clientHeight - height) / 2) - 8 + offset),
            width,
            height
        };
    }

    function renderProgramTiles() {
        const grid = document.getElementById('programs-grid');
        const count = document.getElementById('programs-count');
        if (!grid) return;

        const programs = window.RetroApps ? window.RetroApps.list() : [];
        grid.replaceChildren();

        programs.forEach((app, index) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'app-tile';
            tile.dataset.app = app.id;
            tile.style.setProperty('--tile-index', String(index));

            const icon = document.createElement('span');
            icon.className = 'app-tile-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.innerHTML = app.icon;

            const text = document.createElement('span');
            text.className = 'app-tile-text';

            const name = document.createElement('span');
            name.className = 'app-tile-name';
            name.textContent = app.name;

            const desc = document.createElement('span');
            desc.className = 'app-tile-desc';
            desc.textContent = app.tagline;

            const foot = document.createElement('span');
            foot.className = 'app-tile-foot';

            const meta = document.createElement('span');
            meta.textContent = app.meta;

            const open = document.createElement('span');
            open.className = 'app-tile-open';
            open.setAttribute('aria-hidden', 'true');
            open.textContent = 'OPEN \u25B8';

            foot.append(meta, open);
            text.append(name, desc, foot);
            tile.append(icon, text);
            tile.addEventListener('click', () => openProgram(app.id));

            grid.appendChild(tile);
        });

        if (count) count.textContent = `${programs.length} INSTALLED`;
        const status = document.getElementById('programs-status');
        if (status) status.textContent = programs.length ? 'READY' : 'NO PROGRAMS';
    }

    function openRecycleBin() {
        openExplorer('__recycle__');
    }
    window.openRecycleBin = openRecycleBin;

    function openMyComputer() {
        openExplorer('root');
    }
    window.openMyComputer = openMyComputer;

    /* ── Global context menu: disable browser menu, use shell menu ─ */
    document.addEventListener('contextmenu', (e) => {
        // A specific handler (e.g. Explorer rows) already took over.
        if (e.defaultPrevented) return;
        e.preventDefault();
        const menu = document.getElementById('context-menu');
        if (!menu) return;
        const target = e.target.closest('.desktop-icon, .window, .tree-row, .explorer, .desktop, #explorer') || document.body;
        const isDesktop = target.closest('.desktop-icon') || (target === document.getElementById('desktop'));
        const isRow = target.closest('.tree-row[data-view]');
        const isRecycle = target.closest('.desktop-icon[aria-label="Recycle Bin"]');
        const isMyComp = target.closest('.desktop-icon[aria-label="My Computer"]');

        menu.innerHTML = `
            <button class="menu-item" onclick="hideContextMenu(); ${isRecycle ? 'openRecycleBin();' : isMyComp ? 'openMyComputer();' : 'openPrograms();'}" role="menuitem"><span class="menu-icon">&#9654;</span> Open <span class="menu-shortcut">Enter</span></button>
            <div class="menu-sep"></div>
            <button class="menu-item" onclick="hideContextMenu();" role="menuitem" disabled><span class="menu-icon">&#9998;</span> Rename</button>
            <button class="menu-item" onclick="hideContextMenu();" role="menuitem" disabled><span class="menu-icon">&#9949;</span> Delete <span class="menu-shortcut">Del</span></button>
            <div class="menu-sep"></div>
            <button class="menu-item" onclick="hideContextMenu();" role="menuitem"><span class="menu-icon">&#128736;</span> Refresh</button>
            <button class="menu-item" onclick="hideContextMenu();" role="menuitem"><span class="menu-icon">&#9881;</span> Properties <span class="menu-shortcut">Alt+Enter</span></button>
        `;
        menu.hidden = false;
        const x = Math.min(e.clientX + 4, window.innerWidth - 230);
        const y = Math.min(e.clientY + 4, window.innerHeight - 240);
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
    });
    document.addEventListener('click', () => { const m = document.getElementById('context-menu'); if (m) m.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const m = document.getElementById('context-menu'); if (m) m.hidden = true; } });

    window.openPrograms = openPrograms;

    function openPrograms(options) {
        options = options || {};
        const win = windows.get('programs');
        if (!win) return null;
        clearShowDesktopState();
        if (win.closed) {
            win.closed = false;
            win.node.classList.remove('is-closed');
            if (window.ShellWM) win.workspace = window.ShellWM.state.activeWorkspace;
            if (!win.taskbarButton) addTaskbarButton(win);
            fitWindowToDesktop(win);
        }
        if (options.focus !== false) focusWindow('programs', true);
        if (window.AppRegistry) window.AppRegistry.attachWindow('programs', win);
        persistWindowState();
        return win;
    }

    function openProgram(id, options) {
        options = options || {};
        const def = programDefinition(id);
        if (!def) {
            toast(`PROGRAM NOT FOUND \u2014 ${String(id).toUpperCase()}`, 2600);
            return null;
        }

        const winId = options.windowId || `program-${def.id}`;
        const existing = windows.get(winId);
        if (existing && !existing.closed) {
            clearShowDesktopState();
            if (existing.minimized) restoreWindow(winId);
            else if (options.focus !== false) focusWindow(winId, true);
            return existing;
        }

        const size = PROGRAM_SIZES[def.id] || {};
        const node = document.createElement('section');
        node.className = 'window program-app-window';
        node.setAttribute('aria-label', def.name);
        node.innerHTML = `
            <header class="titlebar">
                <span class="program-title-icon" aria-hidden="true">${def.icon || '\u25A6'}</span>
                <span class="titlebar-title"></span>
                <span class="prototype-badge program-meta"></span>
            </header>
            <div class="program-app-body${def.frame ? ' program-app-body--frame' : ''}" tabindex="-1"></div>
            <footer class="program-statusbar">
                <span class="program-status-cell">${escapeHtml(def.id)}.exe</span>
                <span class="program-status-cell">${escapeHtml(def.source || 'IN-HOUSE')}</span>
                <span class="program-status-cell program-status-state"><span class="state-dot" aria-hidden="true"></span>LOCAL</span>
            </footer>
        `;
        node.querySelector('.titlebar-title').textContent = def.name;
        node.querySelector('.program-meta').textContent = def.meta || '';

        desktop.appendChild(node);

        const index = Array.from(windows.values()).filter((item) => item.appId === 'program').length;
        const win = registerWindow(node, {
            id: winId,
            appId: 'program',
            title: def.name,
            taskbarTitle: def.name,
            icon: PROGRAM_GLYPHS[def.id] || '\u25A6',
            minWidth: size.minWidth || 340,
            minHeight: size.minHeight || 320,
            bounds: options.bounds || nextProgramBounds(def.id, index),
            focusTarget: '.program-app-body'