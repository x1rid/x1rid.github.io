/**
 * @file main/profile/window-state.js
 * @description Profile-scoped window-state bridge.
 *
 * The window manager owns the live `windows` Map. This module only serializes
 * stable, restorable fields and hands them to the existing PersistenceService;
 * it is not a second persistence layer.
 *
 * Persisted fields (per window):
 *   appId, left, top, width, height, maximized, minimized
 *
 * Deliberately not persisted: focus, z-order, drag/resize in progress, context
 * menus, selections, terminal history, and application scratch state.
 *
 * PUBLIC API (window.ProfileWindowState)
 *   create({ profileId, getWindows })  → bridge instance (or null)
 *   snapshotActive()                   → current serializable window map
 *   flushActive()                      → snapshot + flush the active profile
 *   snapshot(windows)                  → serialize a windows Map
 *
 * The bridge refuses to queue writes after the active profile changes. This
 * prevents a late timer from one profile from writing another profile's state.
 */

(function (window) {
  'use strict';

  const MAX_WINDOWS = 32;
  const SAVE_DELAY_MS = 450;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  // Only windows the shell can reconstruct through its existing launch paths.
  const PERSISTENT_APP_IDS = {
    explorer: true,
    programs: true,
    music: true,
    terminal: true
  };

  let activeBridge = null;

  function currentProfileId() {
    try {
      const service = window.ProfileService;
      const profile = service && typeof service.getActiveProfile === 'function'
        ? service.getActiveProfile()
        : null;
      return profile && typeof profile.id === 'string' ? profile.id : null;
    } catch (_error) {
      return null;
    }
  }

  function logicalAppId(win) {
    if (!win) return null;
    const appId = String(win.appId || '').toLowerCase();
    if (appId === 'program') {
      const id = String(win.id || '');
      if (id.indexOf('program-') !== 0) return null;
      const programId = id.slice('program-'.length);
      return programId || null;
    }
    return PERSISTENT_APP_IDS[appId] ? appId : null;
  }

  function finiteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function boundsOf(value) {
    if (!value) return null;
    if (!finiteNumber(value.x) || !finiteNumber(value.y) ||
        !finiteNumber(value.width) || !finiteNumber(value.height)) {
      return null;
    }
    return {
      left: Math.round(value.x),
      top: Math.round(value.y),
      width: Math.round(value.width),
      height: Math.round(value.height)
    };
  }

  function snapshotWindows(windows) {
    const result = {};
    if (!windows || typeof windows.forEach !== 'function') return result;

    let count = 0;
    windows.forEach(function (win, id) {
      if (count >= MAX_WINDOWS) return;
      if (!win || win.closed) return;

      const appId = logicalAppId(win);
      if (!appId) return;

      // A maximized window's live bounds are the maximized rectangle. Persist
      // its pre-maximize bounds so unmaximize still returns to the right size.
      // Snapped windows persist their floating rectangle for the same reason;
      // the zone and any linked-resize bounds live in `snap`.
      const source = win.snap && win.snap.floating
        ? win.snap.floating
        : (win.maximized && win.previousBounds ? win.previousBounds : win);
      const bounds = boundsOf(source);
      if (!bounds) return;

      const record = {
        appId: appId,
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        maximized: Boolean(win.maximized),
        minimized: Boolean(win.minimized),
        workspace: Number.isFinite(Number(win.workspace)) ? Math.round(Number(win.workspace)) : 0,
        alwaysOnTop: Boolean(win.alwaysOnTop),
        tiling: Boolean(win.tiling),
        userOverride: Boolean(win.userOverride),
        snap: null
      };

      if (win.snap && typeof win.snap.layout === 'string' && typeof win.snap.zone === 'string') {
        const snapBounds = boundsOf(win.snap.bounds);
        record.snap = {
          layout: win.snap.layout,
          zone: win.snap.zone,
          groupId: typeof win.snap.groupId === 'string' ? win.snap.groupId : null,
          bounds: snapBounds
        };
      }

      result[String(id)] = record;
      count += 1;
    });

    return result;
  }

  function create(options) {
    options = options || {};
    const profileId = String(options.profileId || currentProfileId() || '');
    if (!profileId || typeof options.getWindows !== 'function') return null;

    let timer = 0;
    let disposed = false;
    let restoring = false;

    function isCurrentProfile() {
      return !disposed && currentProfileId() === profileId;
    }

    function snapshot() {
      return snapshotWindows(options.getWindows());
    }

    function snapshotWMState() {
      if (typeof options.getWMState !== 'function') return null;
      try {
        const value = options.getWMState();
        return value && typeof value === 'object' ? clone(value) : null;
      } catch (error) {
        console.warn('[ProfileWindowState] window-manager snapshot failed:', error);
        return null;
      }
    }

    function queueSnapshot() {
      if (!isCurrentProfile() || restoring) return Promise.resolve(null);
      if (!window.PersistenceService ||
          typeof window.PersistenceService.queueSave !== 'function') {
        return Promise.resolve(null);
      }
      const partial = {
        windows: snapshot(),
        apps: { windowsInitialized: true }
      };
      const wmState = snapshotWMState();
      if (wmState) partial.windowManager = wmState;
      return window.PersistenceService.queueSave(profileId, partial).catch(function () {
        // PersistenceService reports failures through console + profile:state-error.
        return null;
      });
    }

    function schedule() {
      if (!isCurrentProfile() || restoring) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        timer = 0;
        queueSnapshot();
      }, SAVE_DELAY_MS);
    }

    function flush() {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      if (!isCurrentProfile()) return Promise.resolve(false);

      const queued = queueSnapshot();
      const flushed = window.PersistenceService &&
        typeof window.PersistenceService.flush === 'function'
        ? window.PersistenceService.flush(profileId)
        : Promise.resolve(null);

      return Promise.all([queued, flushed]).then(function () {
        return true;
      }).catch(function () {
        return false;
      });
    }

    function savedWindows() {
      const state = window.ProfileState;
      return state && state.windows && typeof state.windows === 'object'
        ? state.windows
        : {};
    }

    function hasSavedState() {
      const state = window.ProfileState;
      return Boolean(state && state.apps && state.apps.windowsInitialized);
    }

    function setRestoring(value) {
      restoring = Boolean(value);
      if (restoring && timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
    }

    function dispose() {
      disposed = true;
      if (timer) window.clearTimeout(timer);
      timer = 0;
      if (activeBridge === bridge) activeBridge = null;
    }

    const bridge = {
      profileId: profileId,
      snapshot: snapshot,
      schedule: schedule,
      flush: flush,
      queueSnapshot: queueSnapshot,
      savedWindows: savedWindows,
      hasSavedState: hasSavedState,
      setRestoring: setRestoring,
      dispose: dispose
    };

    activeBridge = bridge;

    // Best-effort durability. The shell's existing autosave also flushes on
    // pagehide/visibilitychange; this closes the gap before its debounce fires.
    window.addEventListener('pagehide', function () { flush(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });

    return bridge;
  }

  function snapshotActive() {
    return activeBridge ? activeBridge.snapshot() : null;
  }

  function flushActive() {
    return activeBridge ? activeBridge.flush() : Promise.resolve(false);
  }

  window.ProfileWindowState = {
    create: create,
    snapshot: snapshotWindows,
    snapshotActive: snapshotActive,
    flushActive: flushActive
  };

})(typeof window !== 'undefined' ? window : globalThis);
