/* ---------------------------------------------------------------------------
 * shell/host-bridge.js
 *
 * window.DesktopShellHost: the bridge consumed by desktop-environment.js. Shape must stay stable.
 *
 * Loaded as a classic script. Top-level bindings are shared between shell files;
 * runtime statements live in shellInit_* functions that boot.js calls in order
 * after window.ProfileReady.
 * ------------------------------------------------------------------------- */
'use strict';

/* Original inline-script statements, lines 2948-3022+ */
function shellInit_host_bridge_1() {
    /* Desktop environment host bridge: the revamped taskbar, Start menu and
       system tray live in desktop-environment.js and consume the shell's
       existing live window map instead of maintaining a parallel copy. */
    window.DesktopShellHost = {
        version: '20261023',
        windows,
        get activeWindowId() { return activeWindowId; },
        registry: window.AppRegistry,
        wm: window.ShellWM,
        focusWindow,
        minimizeWindow,
        restoreWindow,
        closeWindow,
        toggleMaximize,
        openExplorer,
        openTerminal,
        openMusic,
        openPrograms,
        openProgram,
        openSearch,
        closeSearch,
        toast,
        persist: persistWindowState,
        getProfile() {
            return window.ProfileService && window.ProfileService.getActiveProfile
                ? window.ProfileService.getActiveProfile()
                : null;
        },
        getSavedState() {
            return window.ProfileState || null;
        },
        saveShellState(shell) {
            const profile = window.ProfileService && window.ProfileService.getActiveProfile
                ? window.ProfileService.getActiveProfile()
                : null;
            if (!profile || !window.PersistenceService ||
                typeof window.PersistenceService.queueSave !== 'function') {
                return Promise.resolve(false);
            }
            return window.PersistenceService.queueSave(profile.id, { shell: shell })
                .catch(function () { return false; });
        },
        isMusicPlaying() {
            return Boolean(musicAudio && !musicAudio.paused && !musicAudio.ended);
        },
        pauseMusic() {
            if (typeof pauseMusic === 'function') pauseMusic();
        },
        setMasterVolume(percent, muted) {
            const value = Math.max(0, Math.min(100, Number(percent)));
            if (musicVolume) {
                musicVolume.value = String(Math.round(value));
                musicVolumeValue.textContent = Math.round(value) + '%';
            }
            if (musicAudio) {
                musicAudio.volume = Math.max(0, Math.min(1, value / 100));
                musicAudio.muted = Boolean(muted);
            }
            document.dispatchEvent(new CustomEvent('sim:sound-changed', {
                detail: { volume: Math.round(value), muted: Boolean(muted) }
            }));
            return true;
        },
        forceEndTask(windowId) {
            const win = windows.get(windowId);
            if (!win || win.closed) return false;
            if (win.appId === 'music' && typeof pauseMusic === 'function') pauseMusic();
            if (typeof win.onClose === 'function') {
                try { win.onClose(); } catch (error) { console.warn('End task cleanup failed:', error); }
                win.onClose = null;
            }
            closeWindow(windowId);
            // Explicitly detach in case a launch path never attached a window.
            if (window.AppRegistry) window.AppRegistry.detachWindow(windowId, 'end-task');
            return true;
        }
    };

    document.dispatchEvent(new CustomEvent('desktop:host-ready'));
}
