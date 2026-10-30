/**
 * @file main/profile/persistence-service.js
 * @description Validated, debounced persistence for per-profile simulator state.
 * File contents are never stored here; the VFS remains authoritative.
 *
 * PUBLIC API (window.PersistenceService)
 *   await loadProfileState(profileId)             → validated state
 *   await saveProfileState(profileId, state)      → resolves after the write commits
 *   queueSave(profileId, partialState)            → debounced write, returns promise
 *   await flush(profileId)                        → commit pending writes now
 *   await resetProfileState(profileId)            → resets settings only (never files)
 *   collectState()                                → snapshot current shell preferences
 *   applyState(profileId, state)                  → apply to localStorage + DOM
 *   bindAutoSave(profileId)                       → wire shell change sources
 *   getCachedState(profileId)                     → last validated snapshot
 *
 * EVENTS (dispatched on `document`)
 *   profile:state-loaded { profileId, state }
 *   profile:state-saved  { profileId, updatedAt, revision }
 *   profile:state-error  { profileId, operation, error }
 */

(function (window, document) {
  'use strict';

  const STATE_VERSION = 4;
  const MAX_WORKSPACES = 9;
  const MAX_CUSTOM_LAYOUTS = 12;
  const DEBOUNCE_MS = 700;
  const BUILTIN_AVATAR_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
  const CUSTOM_AVATAR_RE = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i;
  const MAX_CUSTOM_AVATAR_LENGTH = 600000;
  const LOCK_WIDGET_IDS = ['fun-fact', 'system-message', 'daily-quote', 'mini-calendar', 'signal-check'];

  const LOCAL_KEYS = {
    musicVolume: 'desktopShellMusicVolume',
    clippyVisible: 'r3d1bruh.desktop.clippy.visible',
    cursorScheme: 'retroCursorScheme',
    soundEnabled: 'retroSfxEnabled',
    theme: 'desktopTheme'
  };

  function defaultState() {
    return {
      schemaVersion: STATE_VERSION,
      desktop: {
        wallpaper: 'live',
        wallpaperPaused: false,
        iconsVisible: true
      },
      settings: {
        theme: 'plum',
        musicVolume: 45,
        clippyVisible: true,
        cursorScheme: 'ghost',
        soundEnabled: true
      },
      apps: {
        lastExplorerFolder: null,
        // Distinguishes a fresh profile (use the shell's default layout) from
        // a profile whose windows were all closed deliberately (restore none).
        windowsInitialized: false
      },
      windows: {},
      // Desktop-environment preferences (Stage 2+ of the shell revamp). Pins,
      // taskbar layout, tray state and simulated network/sound preferences are
      // profile-scoped. This is an additive section: older profiles receive the
      // defaults below and invalid values fall back per field in validation.
      shell: {
        pins: {
          taskbar: ['explorer', 'terminal', 'music', 'controlpanel'],
          start: ['explorer', 'terminal', 'music', 'controlpanel', 'paint', 'notepad']
        },
        recentApps: [],
        taskbar: {
          position: 'bottom',
          align: 'left',
          grouping: true,
          labels: false,
          iconSize: 'normal',
          autoHide: false,
          showWorkspaces: true,
          showClockDate: true
        },
        clock: {
          format: '24h',
          showSeconds: false,
          showDate: true
        },
        sound: {
          volume: 45,
          muted: false,
          output: 'desktop-speakers'
        },
        network: {
          connected: true,
          adapter: 'SIM-ETH0',
          name: 'Simulated Ethernet',
          ip: '10.0.0.42'
        },
        notifications: {
          quiet: false,
          history: []
        }
      },
      // Window-manager state is separate from per-window geometry. It covers
      // virtual desktops, tiling, user layouts, app rules and overrides for the
      // central shortcut registry. Unknown/corrupt fields are dropped on load.
      windowManager: {
        version: 1,
        activeWorkspace: 0,
        tilingEnabled: false,
        workspaces: [
          { id: 0, name: 'Desktop 1' },
          { id: 1, name: 'Desktop 2' },
          { id: 2, name: 'Desktop 3' },
          { id: 3, name: 'Desktop 4' }
        ],
        workspaceLayouts: {},
        customLayouts: [],
        rules: {},
        shortcuts: {},
        reduceMotion: false
      },
      // Lock-screen preferences are profile-scoped. Passwords and other
      // transient credentials are intentionally absent from this schema.
      lockScreen: {
        clock: {
          enabled: true,
          showSeconds: false,
          format: '24h',
          showDate: true
        },
        animation: {
          intensity: 'high',
          parallax: true,
          particles: true,
          respectReducedMotion: true,
          pauseWhenHidden: true
        },
        widgets: {
          enabled: true,
          enabledIds: ['fun-fact', 'system-message'],
          rotation: 'on-interaction'
        },
        audio: {
          enabled: false,
          ambientEnabled: false,
          effectsEnabled: true,
          volume: 0.25
        },
        accounts: {
          showOwner: true,
          showGuest: true,
          showHiddenAccounts: false,
          allowAccountCreation: false
        },
        avatar: {
          kind: 'builtin',
          value: 'default-purple'
        }
      }
    };
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null || Object.prototype.toString.call(value) === '[object Object]';
  }

  function clampNumber(value, min, max, fallback) {
    const number = typeof value === 'number' ? value : Number(value);
    if (!isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function asBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (value === '1' || value === 'true') return true;
    if (value === '0' || value === 'false') return false;
    return fallback;
  }

  function asSafeString(value, max, fallback) {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > max) return fallback;
    return trimmed;
  }

  function isWindowKey(value) {
    return typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 64 &&
      /^[a-z0-9_-]+$/i.test(value);
  }

  function validateSnapRecord(value) {
    if (!isPlainObject(value)) return null;
    const layout = asSafeString(value.layout, 48, '');
    const zone = asSafeString(value.zone, 32, '');
    if (!layout || !/^[a-z0-9_-]+$/i.test(layout)) return null;
    if (!zone || !/^[a-z0-9_-]+$/i.test(zone)) return null;
    const snap = {
      layout: layout.toLowerCase(),
      zone: zone.toLowerCase(),
      groupId: typeof value.groupId === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value.groupId)
        ? value.groupId
        : null,
      bounds: null
    };
    if (isPlainObject(value.bounds)) {
      snap.bounds = {
        left: Math.round(clampNumber(value.bounds.left, -10000, 100000, 0)),
        top: Math.round(clampNumber(value.bounds.top, -10000, 100000, 0)),
        width: Math.round(clampNumber(value.bounds.width, 120, 10000, 640)),
        height: Math.round(clampNumber(value.bounds.height, 80, 10000, 420))
      };
    }
    return snap;
  }

  function validateWindowRecord(value) {
    if (!isPlainObject(value)) return null;
    const appId = asSafeString(value.appId, 64, '');
    if (!appId || !/^[a-z0-9_-]+$/i.test(appId)) return null;

    return {
      appId: appId.toLowerCase(),
      left: Math.round(clampNumber(value.left, -10000, 100000, 0)),
      top: Math.round(clampNumber(value.top, -10000, 100000, 0)),
      width: Math.round(clampNumber(value.width, 120, 10000, 640)),
      height: Math.round(clampNumber(value.height, 80, 10000, 420)),
      maximized: asBoolean(value.maximized, false),
      minimized: asBoolean(value.minimized, false),
      workspace: Math.round(clampNumber(value.workspace, 0, MAX_WORKSPACES - 1, 0)),
      alwaysOnTop: asBoolean(value.alwaysOnTop, false),
      tiling: asBoolean(value.tiling, false),
      userOverride: asBoolean(value.userOverride, false),
      snap: validateSnapRecord(value.snap)
    };
  }

  function validateWorkspaces(value) {
    const fallback = defaultState().windowManager.workspaces;
    if (!Array.isArray(value) || !value.length) return fallback;
    const list = value.slice(0, MAX_WORKSPACES).map(function (item, index) {
      const name = isPlainObject(item) ? asSafeString(item.name, 32, '') : '';
      return { id: index, name: name || ('Desktop ' + (index + 1)) };
    });
    return list;
  }

  function validateLayoutZones(value) {
    if (!Array.isArray(value) || !value.length) return null;
    const zones = [];
    value.slice(0, 12).forEach(function (item, index) {
      if (!isPlainObject(item)) return;
      const x = clampNumber(item.x, 0, 1, 0);
      const y = clampNumber(item.y, 0, 1, 0);
      const width = clampNumber(item.width, 0.001, 1 - x, 0.5);
      const height = clampNumber(item.height, 0.001, 1 - y, 0.5);
      zones.push({
        id: /^[a-z0-9_-]{1,40}$/i.test(item.id || '') ? item.id : 'zone-' + index,
        label: asSafeString(item.label, 48, ''),
        x: x,
        y: y,
        width: width,
        height: height
      });
    });
    return zones.length ? zones : null;
  }

  function validateCustomLayouts(value) {
    if (!Array.isArray(value)) return [];
    const layouts = [];
    value.slice(0, MAX_CUSTOM_LAYOUTS).forEach(function (item, index) {
      if (!isPlainObject(item)) return;
      const id = asSafeString(item.id, 48, '');
      const zones = validateLayoutZones(item.zones);
      if (!id || !/^[a-z0-9_-]+$/i.test(id) || !zones) return;
      layouts.push({
        id: id.toLowerCase(),
        name: asSafeString(item.name, 48, 'Custom ' + (index + 1)),
        custom: true,
        zones: zones
      });
    });
    return layouts;
  }

  function validateWorkspaceLayouts(value) {
    const result = {};
    if (!isPlainObject(value)) return result;
    Object.keys(value).slice(0, MAX_WORKSPACES).forEach(function (key) {
      const index = Number(key);
      if (!isFinite(index) || index < 0 || index >= MAX_WORKSPACES) return;
      const layout = asSafeString(value[key], 48, '');
      if (layout && /^[a-z0-9_-]+$/i.test(layout)) result[String(index)] = layout;
    });
    return result;
  }

  function validateWMState(value) {
    const base = defaultState().windowManager;
    if (!isPlainObject(value)) return base;

    base.workspaces = validateWorkspaces(value.workspaces);
    base.activeWorkspace = Math.round(
      clampNumber(value.activeWorkspace, 0, base.workspaces.length - 1, 0)
    );
    base.tilingEnabled = asBoolean(value.tilingEnabled, false);
    base.workspaceLayouts = validateWorkspaceLayouts(value.workspaceLayouts);
    base.customLayouts = validateCustomLayouts(value.customLayouts);
    base.reduceMotion = asBoolean(value.reduceMotion, false);

    if (isPlainObject(value.rules)) {
      const rules = {};
      Object.keys(value.rules).slice(0, 48).forEach(function (appId) {
        if (!/^[a-z0-9_-]{1,64}$/i.test(appId)) return;
        const rule = value.rules[appId];
        if (!isPlainObject(rule)) return;
        rules[appId] = {
          floating: asBoolean(rule.floating, false),
          alwaysOnTop: asBoolean(rule.alwaysOnTop, false),
          workspace: rule.workspace == null
            ? null
            : Math.round(clampNumber(rule.workspace, 0, MAX_WORKSPACES - 1, 0))
        };
      });
      base.rules = rules;
    }

    if (isPlainObject(value.shortcuts)) {
      const shortcuts = {};
      Object.keys(value.shortcuts).slice(0, 64).forEach(function (action) {
        if (!/^[a-z0-9_-]{1,48}$/i.test(action)) return;
        const keys = asSafeString(value.shortcuts[action], 40, '');
        if (keys) shortcuts[action] = keys;
      });
      base.shortcuts = shortcuts;
    }

    return base;
  }

  function validateAvatar(raw) {
    if (!isPlainObject(raw)) {
      return { kind: 'builtin', value: 'default-purple' };
    }
    if (raw.kind === 'builtin' && typeof raw.value === 'string' &&
        BUILTIN_AVATAR_RE.test(raw.value)) {
      return { kind: 'builtin', value: raw.value };
    }
    if (raw.kind === 'custom' && typeof raw.value === 'string' &&
        raw.value.length <= MAX_CUSTOM_AVATAR_LENGTH && CUSTOM_AVATAR_RE.test(raw.value)) {
      return { kind: 'custom', value: raw.value };
    }
    return { kind: 'builtin', value: 'default-purple' };
  }

  function validateWidgetIds(value) {
    if (!Array.isArray(value)) return ['fun-fact', 'system-message'];
    const seen = Object.create(null);
    return value.filter(function (id) {
      if (typeof id !== 'string' || LOCK_WIDGET_IDS.indexOf(id) === -1) return false;
      if (seen[id]) return false;
      seen[id] = true;
      return true;
    }).slice(0, 5);
  }

  function oneOf(value, allowed, fallback) {
    return allowed.indexOf(value) === -1 ? fallback : value;
  }

  function validateLockScreen(raw) {
    const base = defaultState().lockScreen;
    if (!isPlainObject(raw)) return base;

    const clock = isPlainObject(raw.clock) ? raw.clock : {};
    base.clock.enabled = asBoolean(clock.enabled, base.clock.enabled);
    base.clock.showSeconds = asBoolean(clock.showSeconds, base.clock.showSeconds);
    base.clock.format = oneOf(clock.format, ['24h', '12h'], base.clock.format);
    base.clock.showDate = asBoolean(clock.showDate, base.clock.showDate);

    const animation = isPlainObject(raw.animation) ? raw.animation : {};
    base.animation.intensity = oneOf(animation.intensity, ['low', 'medium', 'high'], base.animation.intensity);
    base.animation.parallax = asBoolean(animation.parallax, base.animation.parallax);
    base.animation.particles = asBoolean(animation.particles, base.animation.particles);
    base.animation.respectReducedMotion = asBoolean(
      animation.respectReducedMotion, base.animation.respectReducedMotion
    );
    base.animation.pauseWhenHidden = asBoolean(
      animation.pauseWhenHidden, base.animation.pauseWhenHidden
    );

    const widgets = isPlainObject(raw.widgets) ? raw.widgets : {};
    base.widgets.enabled = asBoolean(widgets.enabled, base.widgets.enabled);
    base.widgets.enabledIds = validateWidgetIds(widgets.enabledIds);
    base.widgets.rotation = oneOf(
      widgets.rotation, ['on-interaction', 'interval', 'off'], base.widgets.rotation
    );

    const audio = isPlainObject(raw.audio) ? raw.audio : {};
    base.audio.enabled = asBoolean(audio.enabled, base.audio.enabled);
    base.audio.ambientEnabled = asBoolean(audio.ambientEnabled, base.audio.ambientEnabled);
    base.audio.effectsEnabled = asBoolean(audio.effectsEnabled, base.audio.effectsEnabled);
    base.audio.volume = clampNumber(audio.volume, 0, 1, base.audio.volume);

    const accounts = isPlainObject(raw.accounts) ? raw.accounts : {};
    base.accounts.showOwner = asBoolean(accounts.showOwner, base.accounts.showOwner);
    base.accounts.showGuest = asBoolean(accounts.showGuest, base.accounts.showGuest);
    base.accounts.showHiddenAccounts = false; // hidden accounts are never a UI setting
    base.accounts.allowAccountCreation = asBoolean(
      accounts.allowAccountCreation, base.accounts.allowAccountCreation
    );

    base.avatar = validateAvatar(raw.avatar);
    return base;
  }

  function sanitizeAppIdList(value, fallback, limit) {
    if (!Array.isArray(value)) return fallback.slice();
    const seen = Object.create(null);
    const result = [];
    value.forEach(function (item) {
      if (typeof item !== 'string') return;
      const id = item.trim().toLowerCase();
      if (!id || id.length > 64 || !/^[a-z0-9_-]+$/.test(id)) return;
      if (seen[id]) return;
      seen[id] = true;
      result.push(id);
    });
    return result.slice(0, limit || 32);
  }

  function validateNotificationHistory(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 30).reduce(function (list, item) {
      if (!isPlainObject(item)) return list;
      const message = asSafeString(item.message, 280, '');
      if (!message) return list;
      list.push({
        id: asSafeString(item.id, 64, 'notice-' + list.length),
        level: oneOf(item.level, ['info', 'success', 'warning', 'error'], 'info'),
        title: asSafeString(item.title, 80, ''),
        message: message,
        at: Math.round(clampNumber(item.at, 0, 4102444800000, Date.now()))
      });
      return list;
    }, []);
  }

  function validateShellState(raw) {
    const base = defaultState().shell;
    if (!isPlainObject(raw)) return base;

    const pins = isPlainObject(raw.pins) ? raw.pins : {};
    base.pins.taskbar = sanitizeAppIdList(pins.taskbar, base.pins.taskbar, 24);
    base.pins.start = sanitizeAppIdList(pins.start, base.pins.start, 48);
    base.recentApps = sanitizeAppIdList(raw.recentApps, [], 12);

    const taskbar = isPlainObject(raw.taskbar) ? raw.taskbar : {};
    base.taskbar.position = oneOf(taskbar.position, ['bottom', 'top', 'left', 'right'], base.taskbar.position);
    base.taskbar.align = oneOf(taskbar.align, ['left', 'center'], base.taskbar.align);
    base.taskbar.grouping = asBoolean(taskbar.grouping, base.taskbar.grouping);
    base.taskbar.labels = asBoolean(taskbar.labels, base.taskbar.labels);
    base.taskbar.iconSize = oneOf(taskbar.iconSize, ['small', 'normal'], base.taskbar.iconSize);
    base.taskbar.autoHide = asBoolean(taskbar.autoHide, base.taskbar.autoHide);
    base.taskbar.showWorkspaces = asBoolean(taskbar.showWorkspaces, base.taskbar.showWorkspaces);
    base.taskbar.showClockDate = asBoolean(taskbar.showClockDate, base.taskbar.showClockDate);

    const clock = isPlainObject(raw.clock) ? raw.clock : {};
    base.clock.format = oneOf(clock.format, ['12h', '24h'], base.clock.format);
    base.clock.showSeconds = asBoolean(clock.showSeconds, base.clock.showSeconds);
    base.clock.showDate = asBoolean(clock.showDate, base.clock.showDate);

    const sound = isPlainObject(raw.sound) ? raw.sound : {};
    base.sound.volume = Math.round(clampNumber(sound.volume, 0, 100, base.sound.volume));
    base.sound.muted = asBoolean(sound.muted, base.sound.muted);
    base.sound.output = oneOf(sound.output, ['desktop-speakers', 'headphones'], base.sound.output);

    const network = isPlainObject(raw.network) ? raw.network : {};
    base.network.connected = asBoolean(network.connected, base.network.connected);
    base.network.adapter = asSafeString(network.adapter, 24, base.network.adapter);
    base.network.name = asSafeString(network.name, 48, base.network.name);
    base.network.ip = asSafeString(network.ip, 40, base.network.ip);

    const notifications = isPlainObject(raw.notifications) ? raw.notifications : {};
    base.notifications.quiet = asBoolean(notifications.quiet, base.notifications.quiet);
    base.notifications.history = validateNotificationHistory(notifications.history);

    return base;
  }

  function validateState(raw) {
    const base = defaultState();
    if (!isPlainObject(raw)) return base;

    const sourceVersion = Number(raw.schemaVersion);
    if (Number.isFinite(sourceVersion) && sourceVersion > STATE_VERSION) {
      console.warn('[PersistenceService] State version ' + sourceVersion +
        ' is newer than supported ' + STATE_VERSION + '; keeping known fields only.');
    }

    const desktop = isPlainObject(raw.desktop) ? raw.desktop : {};
    base.desktop.wallpaper = asSafeString(desktop.wallpaper, 64, base.desktop.wallpaper);
    base.desktop.wallpaperPaused = asBoolean(desktop.wallpaperPaused, base.desktop.wallpaperPaused);
    base.desktop.iconsVisible = asBoolean(desktop.iconsVisible, base.desktop.iconsVisible);

    const settings = isPlainObject(raw.settings) ? raw.settings : {};
    base.settings.theme = asSafeString(settings.theme, 32, base.settings.theme);
    base.settings.musicVolume = Math.round(
      clampNumber(settings.musicVolume, 0, 100, base.settings.musicVolume)
    );
    base.settings.clippyVisible = asBoolean(settings.clippyVisible, base.settings.clippyVisible);
    base.settings.cursorScheme = asSafeString(settings.cursorScheme, 24, base.settings.cursorScheme);
    base.settings.soundEnabled = asBoolean(settings.soundEnabled, base.settings.soundEnabled);

    const apps = isPlainObject(raw.apps) ? raw.apps : {};
    base.apps.lastExplorerFolder = typeof apps.lastExplorerFolder === 'string' &&
      apps.lastExplorerFolder.length <= 128 &&
      apps.lastExplorerFolder.indexOf('__') !== 0
      ? apps.lastExplorerFolder
      : null;
    base.apps.windowsInitialized = asBoolean(apps.windowsInitialized, false);

    // Window records are accepted only when they carry an app identity and
    // JSON-safe geometry. Legacy geometry-only records are discarded because
    // the shell cannot know which application they belonged to.
    if (isPlainObject(raw.windows)) {
      const windows = {};
      Object.keys(raw.windows).slice(0, 32).forEach(function (key) {
        if (!isWindowKey(key)) return;
        const record = validateWindowRecord(raw.windows[key]);
        if (record) windows[key] = record;
      });
      base.windows = windows;
    }

    base.lockScreen = validateLockScreen(raw.lockScreen);
    base.windowManager = validateWMState(raw.windowManager);
    base.shell = validateShellState(raw.shell);
    return base;
  }

  function mergeState(target, partial) {
    if (!isPlainObject(partial)) return target;

    ['desktop', 'settings', 'apps'].forEach(function (section) {
      if (!isPlainObject(partial[section])) return;
      target[section] = Object.assign({}, target[section], partial[section]);
    });

    if (isPlainObject(partial.lockScreen)) {
      // Merge one level inside lockScreen so a settings UI can save only the
      // subsection it changed without dropping clock/widget/avatar defaults.
      const current = isPlainObject(target.lockScreen) ? target.lockScreen : {};
      const next = Object.assign({}, current);
      Object.keys(partial.lockScreen).forEach(function (key) {
        if (isPlainObject(partial.lockScreen[key]) && isPlainObject(current[key])) {
          next[key] = Object.assign({}, current[key], partial.lockScreen[key]);
        } else {
          next[key] = partial.lockScreen[key];
        }
      });
      target.lockScreen = next;
    }

    // A window snapshot is authoritative for the whole open-window set. It
    // must replace the map so closing the last window writes `{}` instead of
    // merging the empty snapshot back into stale records.
    if (isPlainObject(partial.windows)) {
      target.windows = Object.assign({}, partial.windows);
    }

    // Window-manager state is a single authoritative snapshot too. Validating
    // here keeps a malformed caller from poisoning the cached profile state.
    if (isPlainObject(partial.windowManager)) {
      target.windowManager = validateWMState(partial.windowManager);
    }

    // Shell preferences are saved as a full validated snapshot by the desktop
    // environment. Replacing the section keeps pin removal and notification
    // clearing authoritative instead of merging stale arrays back in.
    if (isPlainObject(partial.shell)) {
      target.shell = validateShellState(partial.shell);
    }

    return target;
  }

  function safeLocalGet(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeLocalSet(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
      return true;
    } catch (err) {
      console.warn('[PersistenceService] localStorage write failed for ' + key, err);
      return false;
    }
  }

  function safeSessionGet(key) {
    try { return window.sessionStorage.getItem(key); } catch (_) { return null; }
  }

  function safeSessionSet(key, value) {
    try {
      window.sessionStorage.setItem(key, String(value));
      return true;
    } catch (err) {
      console.warn('[PersistenceService] sessionStorage write failed for ' + key, err);
      return false;
    }
  }

  const PersistenceService = {
    _db: null,
    _cache: Object.create(null),
    _revisions: Object.create(null),
    _timers: Object.create(null),
    _chains: Object.create(null),
    _bound: Object.create(null),
    _waiters: Object.create(null),
    _unsubscribeVfs: null,

    _settleWaiters(profileId, error, value) {
      const waiters = this._waiters[profileId];
      if (!waiters || !waiters.length) return;
      this._waiters[profileId] = [];
      waiters.forEach(function (waiter) {
        if (error) waiter.reject(error);
        else waiter.resolve(value);
      });
    },

    async _getDb() {
      if (!this._db) {
        this._db = new window.ProfileDB();
        await this._db.init();
      }
      return this._db;
    },

    _assertProfile(profileId) {
      if (!profileId || typeof profileId !== 'string') {
        throw new Error('Invalid profile id');
      }
      if (!window.ProfileService) {
        throw new Error('ProfileService is not available');
      }
      const profile = window.ProfileService.getProfile(profileId);
      if (!profile) {
        throw new Error('Unknown profile id: ' + profileId);
      }
      if (profile.type !== 'guest' && profile.type !== 'owner' &&
          profile.type !== 'administrator') {
        throw new Error('Invalid profile type: ' + profile.type);
      }
      return profile;
    },

    _report(profileId, operation, error) {
      const detail = {
        profileId: profileId || null,
        operation: operation,
        error: error && error.message ? error.message : String(error)
      };
      console.error('[PersistenceService] ' + operation + ' failed', error);
      try {
        document.dispatchEvent(new CustomEvent('profile:state-error', { detail: detail }));
      } catch (_) { /* CustomEvent is available in supported browsers */ }
      if (typeof window.toast === 'function') {
        const quota = error && error.name === 'QuotaExceededError';
        window.toast(quota ? 'PROFILE STORAGE FULL' : 'PROFILE SAVE FAILED', 2600);
      }
    },

    async loadProfileState(profileId) {
      try {
        this._assertProfile(profileId);
        const db = await this._getDb();
        const record = await db.getState(profileId);
        const state = validateState(record ? record.data : null);
        this._cache[profileId] = state;
        if (!this._revisions[profileId]) this._revisions[profileId] = 0;
        try {
          document.dispatchEvent(new CustomEvent('profile:state-loaded', {
            detail: { profileId: profileId, state: clone(state), restored: Boolean(record) }
          }));
        } catch (_) { /* ignore */ }
        return clone(state);
      } catch (error) {
        this._report(profileId, 'load', error);
        const fallback = defaultState();
        this._cache[profileId] = fallback;
        return clone(fallback);
      }
    },

    /**
     * Persist the full state object. Resolves only after the transaction
     * commits. Rejects on validation or storage failure.
     */
    async saveProfileState(profileId, state) {
      this._assertProfile(profileId);
      const validated = validateState(state);
      this._cache[profileId] = validated;
      const committed = await this._commit(profileId);
      // Keep the DOM/localStorage mirrors in sync so a later collectState()
      // cannot silently clobber what the caller just saved.
      this.applyState(profileId, committed);
      return committed;
    },

    async _commit(profileId) {
      this._assertProfile(profileId);
      // Serialize writes per profile; each commit snapshots at execution time
      // so an older queued write can never clobber a newer snapshot.
      const previous = this._chains[profileId] || Promise.resolve();
      const next = previous.catch(function () { /* keep the chain alive */ }).then(async () => {
        const snapshot = clone(this._cache[profileId] || defaultState());
        const revision = (this._revisions[profileId] || 0) + 1;
        this._revisions[profileId] = revision;
        const db = await this._getDb();
        const updatedAt = Date.now();
        await db.putState({
          profileId: profileId,
          schemaVersion: STATE_VERSION,
          revision: revision,
          updatedAt: updatedAt,
          data: snapshot
        });
        try {
          document.dispatchEvent(new CustomEvent('profile:state-saved', {
            detail: { profileId: profileId, updatedAt: updatedAt, revision: revision }
          }));
        } catch (_) { /* ignore */ }
        return snapshot;
      });
      this._chains[profileId] = next;
      try {
        const snapshot = await next;
        this._settleWaiters(profileId, null, snapshot);
        return snapshot;
      } catch (error) {
        this._report(profileId, 'save', error);
        this._settleWaiters(profileId, error);
        throw error;
      } finally {
        if (this._chains[profileId] === next) this._chains[profileId] = null;
      }
    },

    queueSave(profileId, partialState) {
      try {
        this._assertProfile(profileId);
      } catch (error) {
        this._report(profileId, 'queue', error);
        return Promise.reject(error);
      }

      const current = this._cache[profileId] || defaultState();
      mergeState(current, partialState);
      this._cache[profileId] = validateState(current);

      if (this._timers[profileId]) {
        window.clearTimeout(this._timers[profileId]);
      }

      return new Promise((resolve, reject) => {
        if (!this._waiters[profileId]) this._waiters[profileId] = [];
        this._waiters[profileId].push({ resolve: resolve, reject: reject });
        this._timers[profileId] = window.setTimeout(() => {
          this._timers[profileId] = null;
          this._commit(profileId).catch(function () { /* reported in _commit */ });
        }, DEBOUNCE_MS);
      });
    },

    async flush(profileId) {
      const hadTimer = Boolean(this._timers[profileId]);
      if (hadTimer) {
        window.clearTimeout(this._timers[profileId]);
        this._timers[profileId] = null;
      }
      const hasPending = Boolean(this._waiters[profileId] && this._waiters[profileId].length);

      // A debounce timer or an unsettled queueSave means the in-memory cache is
      // newer than any in-flight write: commit it (chained behind that write).
      if (hadTimer || hasPending) {
        return this._commit(profileId);
      }
      if (this._chains[profileId]) {
        return this._chains[profileId];
      }
      return this._cache[profileId] || defaultState();
    },

    async resetProfileState(profileId) {
      this._assertProfile(profileId);
      const defaults = defaultState();
      this._cache[profileId] = defaults;
      if (this._timers[profileId]) {
        window.clearTimeout(this._timers[profileId]);
        this._timers[profileId] = null;
      }
      // Writing defaults (instead of dropping the record) keeps the change
      // observable and never touches virtual files or the recycle bin.
      await this._commit(profileId);
      return clone(defaults);
    },

    getCachedState(profileId) {
      const state = this._cache[profileId];
      return state ? clone(state) : null;
    },

    /* ── Shell state collection / application ───────────────────────── */

    collectState() {
      const state = defaultState();
      const root = document.documentElement;
      const wallpaperToggle = document.getElementById('wallpaper-toggle');
      const musicVolume = document.getElementById('music-volume');

      if (wallpaperToggle) {
        state.desktop.wallpaperPaused =
          wallpaperToggle.getAttribute('aria-pressed') === 'true';
      }
      state.desktop.iconsVisible = !root.classList.contains('profile-hide-icons');

      const storedTheme = safeLocalGet(LOCAL_KEYS.theme);
      state.settings.theme = root.dataset.theme || storedTheme || state.settings.theme;

      const storedMusic = Number(safeLocalGet(LOCAL_KEYS.musicVolume));
      if (isFinite(storedMusic)) {
        // The shell stores a 0..1 level; the profile state stores 0..100.
        const percent = storedMusic <= 1 ? storedMusic * 100 : storedMusic;
        state.settings.musicVolume = Math.round(Math.min(100, Math.max(0, percent)));
      } else if (musicVolume) {
        state.settings.musicVolume = Math.round(clampNumber(musicVolume.value, 0, 100, 45));
      }

      const storedClippy = safeSessionGet(LOCAL_KEYS.clippyVisible);
      if (storedClippy !== null) {
        state.settings.clippyVisible = storedClippy === '1';
      }

      const storedCursor = safeLocalGet(LOCAL_KEYS.cursorScheme) || root.dataset.cursorScheme;
      if (storedCursor) state.settings.cursorScheme = storedCursor;

      const storedSound = safeLocalGet(LOCAL_KEYS.soundEnabled);
      if (storedSound !== null) state.settings.soundEnabled = storedSound === '1';

      if (typeof window.__explorerCurrentId === 'string' &&
          window.__explorerCurrentId.indexOf('__') !== 0) {
        state.apps.lastExplorerFolder = window.__explorerCurrentId;
      }

      // A full-state save must not erase fields owned by the window bridge or
      // the initialized marker that distinguishes "fresh" from "all closed".
      const activeProfile = window.ProfileService &&
        typeof window.ProfileService.getActiveProfile === 'function'
        ? window.ProfileService.getActiveProfile()
        : null;
      const cached = activeProfile ? this._cache[activeProfile.id] : null;

      if (cached && cached.apps && cached.apps.windowsInitialized) {
        state.apps.windowsInitialized = true;
      }

      const windowSnapshot = window.ProfileWindowState &&
        typeof window.ProfileWindowState.snapshotActive === 'function'
        ? window.ProfileWindowState.snapshotActive()
        : null;

      if (windowSnapshot) {
        state.windows = windowSnapshot;
      } else if (cached && cached.windows) {
        state.windows = clone(cached.windows);
      }

      return state;
    },

    /**
     * Write preference keys that other modules read on boot. Safe to call
     * before the DOM is fully constructed.
     */
    applyStoredPreferences(profileId, state) {
      const validated = validateState(state);
      // The desktop shell reads a 0..1 level from localStorage.
      safeLocalSet(LOCAL_KEYS.musicVolume, validated.settings.musicVolume / 100);
      safeLocalSet(LOCAL_KEYS.cursorScheme, validated.settings.cursorScheme);
      safeLocalSet(LOCAL_KEYS.soundEnabled, validated.settings.soundEnabled ? '1' : '0');
      safeLocalSet(LOCAL_KEYS.theme, validated.settings.theme);
      safeSessionSet(LOCAL_KEYS.clippyVisible, validated.settings.clippyVisible ? '1' : '0');
      return validated;
    },

    /**
     * Apply DOM-dependent preferences. Called after DOMContentLoaded and before
     * the desktop shell boots.
     */
    applyDomState(profileId, state) {
      const validated = validateState(state);
      const root = document.documentElement;
      root.dataset.theme = validated.settings.theme;

      if (validated.desktop.iconsVisible) {
        root.classList.remove('profile-hide-icons');
      } else {
        root.classList.add('profile-hide-icons');
      }

      const musicVolume = document.getElementById('music-volume');
      if (musicVolume) {
        musicVolume.value = String(validated.settings.musicVolume);
        // Let the shell update its audio level + label through its own handler.
        try {
          musicVolume.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (_) { /* older browsers */ }
      }
      const musicValueLabel = document.getElementById('music-volume-value');
      if (musicValueLabel) musicValueLabel.textContent = validated.settings.musicVolume + '%';

      if (window.SiteCursor && typeof window.SiteCursor.setScheme === 'function') {
        try {
          const current = (root.dataset.cursorScheme || '').toLowerCase();
          if (current !== validated.settings.cursorScheme) {
            window.SiteCursor.setScheme(validated.settings.cursorScheme);
          }
        } catch (err) {
          console.warn('[PersistenceService] Could not apply cursor scheme', err);
        }
      }

      window.ProfileState = clone(validated);
      return validated;
    },

    async applyState(profileId, state) {
      const validated = this.applyStoredPreferences(profileId, state);
      this.applyDomState(profileId, validated);
      return validated;
    },

    /**
     * Wire the shell's existing preference controls to debounced saves.
     * Idempotent per profile.
     */
    bindAutoSave(profileId) {
      if (this._bound[profileId]) return;
      this._bound[profileId] = true;
      const self = this;

      function saveNow() {
        // Runs on the bubble phase, after the shell's own handler has already
        // updated the DOM/aria state we are about to snapshot.
        const collected = self.collectState();
        self.queueSave(profileId, {
          desktop: collected.desktop,
          settings: collected.settings,
          apps: collected.apps
        }).catch(function () { /* reported */ });
      }

      document.addEventListener('click', function (event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        if (target.closest('#wallpaper-toggle, #clippy-toggle, #start-lock-btn, [data-profile-setting]')) {
          saveNow();
        }
      }, false);

      document.addEventListener('input', function (event) {
        if (event.target && event.target.id === 'music-volume') saveNow();
      }, false);

      document.addEventListener('change', function (event) {
        if (event.target && event.target.id === 'music-volume') saveNow();
      }, false);

      document.addEventListener('site:cursorchange', saveNow);

      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          self.flush(profileId).catch(function () { /* reported */ });
        }
      });

      // Best-effort only: IndexedDB writes are async and may not finish while
      // the page is being torn down. Real durability comes from debounced saves.
      window.addEventListener('pagehide', function () {
        self.flush(profileId).catch(function () { /* reported */ });
      });

      if (window.VFS && typeof window.VFS.subscribe === 'function') {
        if (this._unsubscribeVfs) this._unsubscribeVfs();
        this._unsubscribeVfs = window.VFS.subscribe(function () { saveNow(); });
      }

      // Persist Explorer location whenever the adapter navigates.
      document.addEventListener('explorer:navigate', function (event) {
        const detail = event && event.detail ? event.detail : {};
        if (detail.id) {
          window.__explorerCurrentId = detail.id;
          saveNow();
        }
      });
    },

    defaults: defaultState,
    validateState: validateState,
    STATE_VERSION: STATE_VERSION
  };

  window.PersistenceService = PersistenceService;

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : { dispatchEvent: function () {} });
