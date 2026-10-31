/* ---------------------------------------------------------------------------
 * shell/window-host.js
 *
 * Window host: the real window manager (registerWindow, focus/minimize/maximize/close, drag/resize,
 * persistence restore) plus shellWindowFactory, the adapter wired to AppRegistry.configure({ windowFactory }).
 *
 * Loaded as a classic script. Top-level bindings are shared between shell files;
 * runtime statements live in shellInit_* functions that boot.js calls in order
 * after window.ProfileReady.
 * ------------------------------------------------------------------------- */
'use strict';

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

/* ---------------------------------------------------------------------------
 * Window seam: AppRegistry.configure({ windowFactory }).
 *
 * Manifest apps (notepad, calculator, installed .pkg apps, ...) are given a
 * real shell window here. The returned object satisfies the contract in
 * app-registry.js: { id, root, node, closed, onClose, close(), setTitle(),
 * focus() }. Apps render into win.root.
 *
 * Closing goes through closeWindow(), which already invokes (and clears)
 * win.onClose, so close() must not call onClose a second time.
 * ------------------------------------------------------------------------- */
let shellWinSeq = 0;

function shellSafeGlyph(icon) {
    const text = String(icon == null ? '' : icon).trim();
    // Manifest icons can be file names or markup; the title bar only takes a short text glyph.
    if (!text || text.length > 3 || /[<>\/\\.]/.test(text)) return '\u25A3';
    return text;
}

function shellWindowFactory(opts) {
    opts = opts || {};
    const appId = String(opts.appId || 'app');
    let winId;
    do { winId = 'appwin-' + (++shellWinSeq); } while (windows.has(winId));

    const glyph = shellSafeGlyph(opts.icon);
    const node = document.createElement('section');
    node.className = 'window program-app-window';
    node.setAttribute('aria-label', String(opts.title || appId));
    node.innerHTML = `
        <header class="titlebar">
            <span class="program-title-icon" aria-hidden="true"></span>
            <span class="titlebar-title"></span>
            <span class="prototype-badge program-meta"></span>
        </header>
        <div class="program-app-body" tabindex="-1"></div>
        <footer class="program-statusbar">
            <span class="program-status-cell"></span>
            <span class="program-status-cell">LOCAL</span>
        </footer>
    `;
    node.querySelector('.program-title-icon').textContent = glyph;
    node.querySelector('.titlebar-title').textContent = String(opts.title || appId);
    node.querySelector('.program-status-cell').textContent = appId + '.exe';
    desktop.appendChild(node);

    const index = Array.from(windows.values()).filter((item) => item.appId === appId).length;
    const bounds = nextProgramBounds(appId, index);
    const maxWidth = Math.max(300, desktop.clientWidth - 48);
    const maxHeight = Math.max(260, desktop.clientHeight - 48);
    const reqWidth = Number(opts.width);
    const reqHeight = Number(opts.height);
    if (Number.isFinite(reqWidth) && reqWidth > 0) bounds.width = Math.min(reqWidth, maxWidth);
    if (Number.isFinite(reqHeight) && reqHeight > 0) bounds.height = Math.min(reqHeight, maxHeight);
    bounds.x = Math.max(12, Math.round((desktop.clientWidth - bounds.width) / 2) + (index % 4) * 22);
    bounds.y = Math.max(12, Math.round((desktop.clientHeight - bounds.height) / 2) - 8 + (index % 4) * 22);

    const fixed = opts.resizable === false;
    const win = registerWindow(node, {
        id: winId,
        appId: appId,
        title: String(opts.title || appId),
        taskbarTitle: String(opts.title || appId),
        icon: glyph,
        minWidth: fixed ? bounds.width : Math.min(bounds.width, 320),
        minHeight: fixed ? bounds.height : Math.min(bounds.height, 220),
        maxWidth: fixed ? bounds.width : undefined,
        maxHeight: fixed ? bounds.height : undefined,
        bounds: bounds,
        focusTarget: '.program-app-body'
    });

    const body = node.querySelector('.program-app-body');
    const titleEl = node.querySelector('.titlebar-title');

    win.root = body;
    win.onClose = null;                        // assigned by AppRegistry on attach
    win.setTitle = function (title) {
        const text = String(title == null ? '' : title);
        titleEl.textContent = text;
        win.title = text;
        win.taskbarTitle = text;
        node.setAttribute('aria-label', text);
        if (win.taskbarButton) {
            win.taskbarButton.title = text;
            const label = win.taskbarButton.querySelector('.taskbar-app-label');
            if (label) label.textContent = text;
        }
        syncTaskbar();
    };
    win.close = function () {
        if (win.closed) return;
        closeWindow(win.id);                   // runs win.onClose exactly once
    };
    win.focus = function () {
        if (win.closed) return;
        if (win.minimized) restoreWindow(win.id);
        focusWindow(win.id, true);
    };
    return win;
}

/* Original inline-script statements, lines 818-818+ */
function shellInit_window_host_1() {
    window.openExplorerWindow = openExplorer;
}
