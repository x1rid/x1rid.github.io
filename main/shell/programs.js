/* ---------------------------------------------------------------------------
 * shell/programs.js
 *
 * Programs shelf, global context menu, and the legacy RetroApps program launcher (openProgram).
 *
 * Loaded as a classic script. Top-level bindings are shared between shell files;
 * runtime statements live in shellInit_* functions that boot.js calls in order
 * after window.ProfileReady.
 * ------------------------------------------------------------------------- */
'use strict';

/* Shared bindings (assigned in the shellInit_* chunks below). */
let PROGRAM_GLYPHS, PROGRAM_SIZES, PROGRAM_FILE_TYPES;

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

function openMyComputer() {
    openExplorer('root');
}

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
    });

    const body = node.querySelector('.program-app-body');
    const meta = node.querySelector('.program-meta');
    let cleanup = null;
    const appContext = window.AppRegistry
        ? window.AppRegistry.context()
        : { profile: null, profileId: null, vfs: window.VFS || null };

    const api = {
        app: def,
        profile: appContext.profile,
        profileId: appContext.profileId,
        vfs: appContext.vfs,
        registry: window.AppRegistry || null,
        instanceId: winId,
        initialNode: options.node || null,
        setMeta(value) {
            const text = String(value == null ? '' : value).trim();
            meta.textContent = text || def.meta || '';
        },
        close() {
            closeWindow(win.id);
        }
    };

    try {
        const mounted = def.mount(body, api);
        if (typeof mounted === 'function') cleanup = mounted;
    } catch (error) {
        console.error(`${def.name} failed to start:`, error);
        body.replaceChildren();
        const note = document.createElement('p');
        note.className = 'program-error';
        note.textContent = `${def.name} could not start in this browser. Try reloading, or use a current browser with canvas support.`;
        body.appendChild(note);
        toast(`${def.name.toUpperCase()} FAILED TO START`, 3200);
    }

    if (typeof cleanup === 'function') win.onClose = cleanup;
    if (window.AppRegistry) window.AppRegistry.attachWindow(def.id, win, { windowId: winId });
    if (options.focus !== false) focusWindow(win.id, true);
    persistWindowState();
    return win;
}

/* Original inline-script statements, lines 887-1156+ */
function shellInit_programs_1() {
    /* ------------------------------------------------------------------
     * Programs — launcher window + one window per program.
     * ------------------------------------------------------------------ */
    PROGRAM_GLYPHS = {
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

    PROGRAM_SIZES = {
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
    PROGRAM_FILE_TYPES = {
        mediaplayer: ['mp3', 'opus', 'wav', 'ogg', 'mp4', 'webm', 'flac', 'aac', 'm4a']
    };

    window.openRecycleBin = openRecycleBin;

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

    window.openProgram = openProgram;

    if (programsButton) {
        programsButton.addEventListener('click', () => {
            openPrograms();
        });
    }
}
