/* ---------------------------------------------------------------------------
 * shell/boot.js
 *
 * Boot sequence. Runs after window.ProfileReady, executing every shellInit_* chunk in the exact order the
 * original inline script ran its top-level statements.
 *
 * Loaded as a classic script. Top-level bindings are shared between shell files;
 * runtime statements live in shellInit_* functions that boot.js calls in order
 * after window.ProfileReady.
 * ------------------------------------------------------------------------- */
'use strict';

/* Shared bindings (assigned in the shellInit_* chunks below). */
let programsWin, explorerWin, musicWin;

/* Original inline-script statements, lines 2913-2913+ */
function shellInit_boot_1() {
    /* ── Boot the shell ─────────────────────────────────────── */
    if (window.ShellWM && typeof window.ShellWM.init === 'function') {
        window.ShellWM.init({
            desktop,
            taskbar,
            windows,
            setBounds,
            focusWindow,
            minimizeWindow,
            restoreWindow,
            closeWindow,
            toggleMaximize,
            focusTopWindow,
            cycleWindow,
            persist: persistWindowState,
            toast,
            getActiveId: () => activeWindowId,
            savedState: window.ProfileState && window.ProfileState.windowManager,
            clearActive: () => {
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
            }
        });
    }
}

/* Original inline-script statements, lines 3024-3105+ */
function shellInit_boot_2() {
    programsWin = registerWindow(programsNode, {
        id: 'programs',
        appId: 'programs',
        title: 'Programs',
        taskbarTitle: 'Programs',
        icon: '\u25A6',
        minWidth: 460,
        minHeight: 320,
        bounds: nextProgramBounds('programs', 0),
        focusTarget: '#programs-grid button',
        startClosed: true
    });

    renderProgramTiles();

    explorerWin = registerWindow(explorerNode, {
        id: 'explorer',
        appId: 'explorer',
        title: 'Link Exchange',
        taskbarTitle: 'Link Exchange',
        icon: '▣',
        minWidth: 640,
        minHeight: 340,
        bounds: defaultExplorerBounds()
    });

    musicWin = registerWindow(musicNode, {
        id: 'music',
        appId: 'music',
        title: 'Music',
        taskbarTitle: 'Music',
        icon: '♪',
        minWidth: 360,
        minHeight: 320,
        bounds: nextMusicBounds(),
        focusTarget: '#music-play',
        startClosed: true
    });

    initMusic(musicWin);

    if (windowState && windowState.hasSavedState()) {
        const saved = windowState.savedWindows();
        Array.from(windows.values()).forEach((win) => {
            if (!win.closed) closeWindow(win.id);
        });
        restorePersistedWindows(saved);
        focusTopWindow();
    } else {
        const firstTerminal = openTerminal();
        minimizeWindow(firstTerminal.id);
        focusWindow('explorer', true);
    }

    restoringWindows = false;

    if (windowState) {
        windowState.setRestoring(false);
        windowState.schedule();
    }

    if (window.ShellWM) window.ShellWM.applyWorkspaceVisibility();

    updateTaskbarClock();

    window.setInterval(updateTaskbarClock, 1000);

    resizeWallpaper();

    syncWallpaperMotion();

    if (preferredClippyVisibility()) {
        showClippy();
    }

    window.addEventListener('resize', () => {
        if (window.ShellWM && window.ShellWM.ready) {
            window.ShellWM.onDesktopResize();
        } else {
            windows.forEach((win) => {
                if (!win.closed) fitWindowToDesktop(win);
            });
        }
        persistWindowState();
        resizeWallpaper();
        syncWallpaperMotion();
    });

    if (window.ProfileState && window.ProfileState.desktop &&
        window.ProfileState.desktop.wallpaperPaused) {
        wallpaperPaused = true;
        if (wallpaperToggle) wallpaperToggle.setAttribute('aria-pressed', 'true');
    }
}

function shellBoot() {
    shellInit_state_1();   // state
    shellInit_notifications_1();   // notifications
    shellInit_desktop_1();   // desktop
    shellInit_window_host_1();   // window-host
    shellInit_programs_1();   // programs
    shellInit_music_1();   // music
    shellInit_desktop_2();   // desktop
    shellInit_start_menu_1();   // start-menu
    shellInit_apps_1();   // apps
    shellInit_boot_1();   // boot
    shellInit_host_bridge_1();   // host-bridge
    shellInit_boot_2();   // boot
    shellInit_shortcuts_host_1();   // shortcuts-host

    // Phase 4.2: run autostart entries after full shell boot
    if (typeof AutostartService !== 'undefined') { AutostartService.run(); }
}

// Phase 4.4: BIOS fiction screen — show before ProfileReady if URL param set
if (typeof BiosScreen !== 'undefined' &&
    (location.search.includes('bios=1') || location.search.includes('restoring=hibernate'))) {
    BiosScreen.show({ onContinue: function () { BiosScreen.hide(); } });
}

// Phase 4.3: restore hibernate snapshot if requested
if (typeof PowerService !== 'undefined' && location.search.includes('restoring=hibernate')) {
    PowerService.restore();
}

window.ProfileReady.then(shellBoot).catch(function (error) {
    console.error('[Shell] Boot failed', error);
});
