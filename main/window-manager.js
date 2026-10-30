/**
 * @file main/window-manager.js
 * @description Snap/tiling/workspace integration for the existing desktop shell
 * window manager. The legacy inline manager still owns window creation, app
 * lifecycle, taskbar buttons, focus and persistence; this module augments it
 * with Windows 11-style snapping, snap layouts, Snap Assist, linked resizing,
 * virtual desktops, snap groups, app rules and an overview.
 *
 * INTEGRATION (the inline shell calls these):
 *   ShellWM.init(bridge)                   once after the shell functions exist
 *   ShellWM.onWindowRegistered(win, opts)  from registerWindow()
 *   ShellWM.restoreWindowState(win, record)
 *   ShellWM.nextZ(win)                     focus/z-order source
 *   ShellWM.beginDrag(event, win)          from startDrag()
 *   ShellWM.beginResize(event, win, dir)   from startResize()
 *   ShellWM.toggleMaximize(win)            returns true when handled
 *   ShellWM.ensureVisible(win)             switch desktop before focusing
 *   ShellWM.onDesktopResize()              re-fit snapped windows
 *   ShellWM.restoreGroupFor(win)           taskbar group restore
 *   ShellWM.snapshotState()                persisted window-manager state
 *   ShellWM.applyWorkspaceVisibility()     taskbar/desktop workspace filtering
 *
 * All listeners are installed once. Drag/resize handlers are removed on
 * pointerup and pointercancel, so repeated operations never stack listeners.
 */
(function (window, document) {
  'use strict';

  const Core = window.WindowManagerCore;
  if (!Core) {
    console.error('[ShellWM] WindowManagerCore is unavailable; window manager disabled.');
    return;
  }

  const VERSION = '20261022';
  const ANIMATION_MS = 190;
  const HOVER_LAYOUT_DELAY = 360;
  const ASSIST_DELAY = 230;
  const MAX_HISTORY = 40;

  let bridge = null;
  let ready = false;
  let state = Core.createDefaultState();
  let zNormal = 1000;
  let zTop = 100000;

  let layer = null;
  let previewEl = null;
  let previewLabel = null;
  let assistEl = null;
  let assistTimer = 0;
  let chooserEl = null;
  let chooserWin = null;
  let chooserHoverTimer = 0;
  let chooserCloseTimer = 0;
  let overviewEl = null;

  let drag = null;
  let dividerDrag = null;
  let shortcutHandles = [];
  let installedGlobalListeners = false;
  let reduceMotionQuery = null;
  const animationTimers = new WeakMap();

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function copyBounds(bounds) {
    if (!bounds) return null;
    return {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height)
    };
  }

  function validBounds(bounds) {
    return Boolean(bounds) &&
      isFinite(bounds.x) && isFinite(bounds.y) &&
      isFinite(bounds.width) && isFinite(bounds.height) &&
      bounds.width > 0 && bounds.height > 0;
  }

  function boundsFromRecord(bounds) {
    if (!bounds || typeof bounds !== 'object') return null;
    const x = Number(bounds.x != null ? bounds.x : bounds.left);
    const y = Number(bounds.y != null ? bounds.y : bounds.top);
    const width = Number(bounds.width);
    const height = Number(bounds.height);
    if (![x, y, width, height].every(function (value) { return isFinite(value); })) return null;
    return { x: x, y: y, width: width, height: height };
  }

  function allWindows() {
    if (!bridge || !bridge.windows || typeof bridge.windows.forEach !== 'function') return [];
    const list = [];
    bridge.windows.forEach(function (win) {
      if (win && !win.closed) list.push(win);
    });
    return list;
  }

  function windowsOnWorkspace(index) {
    return allWindows().filter(function (win) {
      return workspaceOf(win) === index;
    });
  }

  function workspaceOf(win) {
    const value = Number(win && win.workspace);
    return isFinite(value) ? clamp(Math.round(value), 0, state.workspaces.length - 1) : 0;
  }

  function activeWindow() {
    if (!bridge || !bridge.getActiveId) return null;
    const id = bridge.getActiveId();
    return id && bridge.windows ? (bridge.windows.get(id) || null) : null;
  }

  function getArea() {
    if (!bridge || !bridge.desktop) return { x: 0, y: 0, width: 1, height: 1 };
    const desktop = bridge.desktop;
    const desktopRect = desktop.getBoundingClientRect();
    let taskbarRect = null;
    if (bridge.taskbar) {
      const rect = bridge.taskbar.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        taskbarRect = {
          x: rect.left - desktopRect.left,
          y: rect.top - desktopRect.top,
          width: rect.width,
          height: rect.height
        };
      }
    }
    return Core.workArea({
      x: 0,
      y: 0,
      width: desktop.clientWidth,
      height: desktop.clientHeight
    }, taskbarRect);
  }

  function constraintsOf(win) {
    return {
      minWidth: win && isFinite(win.minWidth) ? win.minWidth : Core.DEFAULT_MIN_WIDTH,
      minHeight: win && isFinite(win.minHeight) ? win.minHeight : Core.DEFAULT_MIN_HEIGHT,
      maxWidth: win && isFinite(win.maxWidth) ? win.maxWidth : Infinity,
      maxHeight: win && isFinite(win.maxHeight) ? win.maxHeight : Infinity
    };
  }

  function snapConstraintsOf(win) {
    const constraints = constraintsOf(win);
    // Layout zones must be allowed to be narrower than an app's floating
    // minimum (three columns on a small desktop), but never collapse to zero.
    return {
      minWidth: Math.min(constraints.minWidth, 160),
      minHeight: Math.min(constraints.minHeight, 120),
      maxWidth: constraints.maxWidth,
      maxHeight: constraints.maxHeight
    };
  }

  function groupZoneOccupied(groupId, zoneId, exceptWin) {
    return windowsOnWorkspace(state.activeWorkspace).some(function (member) {
      return member !== exceptWin && member.snap &&
        member.snap.groupId === groupId &&
        member.snap.zone === zoneId;
    });
  }

  function adjacentGroupFor(win, layoutId, zoneId) {
    const existing = windowsOnWorkspace(state.activeWorkspace).filter(function (other) {
      return other !== win && other.snap &&
        other.snap.layout === layoutId &&
        other.snap.groupId &&
        other.snap.zone !== zoneId;
    });
    if (!existing.length) return null;
    // Prefer a group that does not already contain this zone.
    for (let i = 0; i < existing.length; i += 1) {
      const groupId = existing[i].snap.groupId;
      if (!groupZoneOccupied(groupId, zoneId, win)) return groupId;
    }
    return null;
  }

  function reduceMotion() {
    if (state.reduceMotion) return true;
    if (reduceMotionQuery && reduceMotionQuery.matches) return true;
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function applyReducedMotion() {
    const reduced = reduceMotion();
    document.body.classList.toggle('wm-reduced-motion', reduced);
    if (overviewEl) refreshOverview();
  }

  function persist() {
    if (bridge && typeof bridge.persist === 'function') bridge.persist();
  }

  function toast(message, duration) {
    if (bridge && typeof bridge.toast === 'function') bridge.toast(message, duration);
  }

  /* ------------------------------------------------------------------
   * Overlay chrome
   * ------------------------------------------------------------------ */
  function buildChrome() {
    layer = document.createElement('div');
    layer.className = 'wm-layer';
    layer.setAttribute('aria-hidden', 'true');

    previewEl = document.createElement('div');
    previewEl.className = 'wm-snap-preview';
    previewEl.hidden = true;

    previewLabel = document.createElement('span');
    previewLabel.className = 'wm-snap-preview-label';
    previewEl.appendChild(previewLabel);

    layer.appendChild(previewEl);
    bridge.desktop.appendChild(layer);

    document.addEventListener('pointerdown', onGlobalPointerDown, true);
    document.addEventListener('keydown', onGlobalKeyDown, true);
    reduceMotionQuery = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    if (reduceMotionQuery && typeof reduceMotionQuery.addEventListener === 'function') {
      reduceMotionQuery.addEventListener('change', applyReducedMotion);
    }
    installedGlobalListeners = true;
  }

  function onGlobalPointerDown(event) {
    if (!assistEl || assistEl.hidden) {
      // handled below for chooser/overview
    } else if (!assistEl.contains(event.target)) {
      hideSnapAssist();
    }
    if (chooserEl && !chooserEl.contains(event.target)) {
      const control = event.target.closest ? event.target.closest('.wm-layout-button, [data-action="maximize"]') : null;
      if (!control) closeLayoutChooser();
    }
  }

  function onGlobalKeyDown(event) {
    if (event.key === 'Escape') {
      if (assistEl && !assistEl.hidden) {
        hideSnapAssist();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (chooserEl) {
        closeLayoutChooser();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (overviewEl) {
        closeOverview();
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }

  function showPreview(intent, win) {
    if (!previewEl || !intent || !intent.bounds) return;
    const bounds = Core.clampBounds(intent.bounds, getArea(), snapConstraintsOf(win));
    previewEl.style.left = bounds.x + 'px';
    previewEl.style.top = bounds.y + 'px';
    previewEl.style.width = bounds.width + 'px';
    previewEl.style.height = bounds.height + 'px';
    previewLabel.textContent = intent.label || '';
    previewEl.hidden = false;
    previewEl.classList.add('is-visible');
  }

  function hidePreview() {
    if (!previewEl) return;
    previewEl.classList.remove('is-visible');
    previewEl.hidden = true;
  }

  /* ------------------------------------------------------------------
   * Bounds, maximize, snap
   * ------------------------------------------------------------------ */
  function updateMaximizeButton(win) {
    const button = win.titlebar && win.titlebar.querySelector('[data-action="maximize"]');
    if (!button) return;
    if (win.maximized) {
      button.textContent = '\u2750';
      button.title = 'Restore';
      button.setAttribute('aria-label', 'Restore ' + win.title);
    } else {
      button.textContent = '\u25A1';
      button.title = 'Maximize';
      button.setAttribute('aria-label', 'Maximize ' + win.title);
    }
  }

  function updateWindowClasses(win) {
    if (!win || !win.node) return;
    win.node.classList.toggle('wm-snapped', Boolean(win.snap));
    win.node.classList.toggle('wm-always-on-top', Boolean(win.alwaysOnTop));
    win.node.classList.toggle('wm-tiled', Boolean(win.tiling));
    win.node.dataset.workspace = String(workspaceOf(win));
    if (win.snap && win.snap.zone) {
      win.node.dataset.snapZone = win.snap.zone;
      win.node.dataset.snapLayout = win.snap.layout;
    } else {
      delete win.node.dataset.snapZone;
      delete win.node.dataset.snapLayout;
    }
  }

  function animateWindow(win) {
    if (!win || !win.node || reduceMotion()) return;
    const previous = animationTimers.get(win);
    if (previous) window.clearTimeout(previous);
    win.node.classList.add('wm-snap-anim');
    const timer = window.setTimeout(function () {
      win.node.classList.remove('wm-snap-anim');
      animationTimers.delete(win);
    }, ANIMATION_MS + 30);
    animationTimers.set(win, timer);
  }

  function applyBounds(win, bounds, animate) {
    if (!win || !bridge) return;
    const constraints = win.snap ? snapConstraintsOf(win) : constraintsOf(win);
    const next = Core.clampBounds(bounds, getArea(), constraints);
    if (animate) animateWindow(win);
    bridge.setBounds(win, next, constraints);
    return {
      x: win.x,
      y: win.y,
      width: win.width,
      height: win.height
    };
  }

  function floatingBounds(win) {
    if (win.snap && validBounds(win.snap.floating)) return copyBounds(win.snap.floating);
    if (win.maximized && validBounds(win.previousBounds)) return copyBounds(win.previousBounds);
    return copyBounds(win);
  }

  function createGroupId() {
    return 'wg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function maximizeWindow(win, animate) {
    if (!win) return;
    if (win.snap) {
      // Remember both the floating rectangle and the tile so restoring a
      // maximized tile returns to the same snap group.
      win.previousBounds = floatingBounds(win);
      win.previousSnap = {
        layout: win.snap.layout,
        zone: win.snap.zone,
        groupId: win.snap.groupId,
        bounds: copyBounds(win.snap.bounds),
        floating: copyBounds(win.snap.floating || floatingBounds(win))
      };
    } else {
      if (!win.maximized) win.previousBounds = copyBounds(win);
      win.previousSnap = null;
    }
    win.snap = null;
    win.maximized = true;
    win.userOverride = true;
    win.tiling = false;
    win.node.classList.add('is-maximized');
    win.node.classList.remove('is-minimized');
    win.node.classList.remove('wm-snapped');
    updateMaximizeButton(win);
    updateWindowClasses(win);
    applyBounds(win, getArea(), animate);
    if (bridge.focusWindow) bridge.focusWindow(win.id);
    persist();
    refreshDividers();
    hideSnapAssist();
  }

  function restoreFloating(win, animate) {
    if (!win) return;
    const target = floatingBounds(win) || {
      x: Math.max(0, win.x),
      y: Math.max(0, win.y),
      width: win.width,
      height: win.height
    };
    win.snap = null;
    win.maximized = false;
    win.tiling = false;
    win.userOverride = true;
    win.node.classList.remove('is-maximized', 'wm-snapped');
    updateMaximizeButton(win);
    updateWindowClasses(win);
    applyBounds(win, target, animate);
    persist();
    refreshDividers();
  }

  function toggleMaximize(win, options) {
    options = options || {};
    if (!win || win.closed) return false;
    if (win.minimized) {
      if (bridge.restoreWindow) bridge.restoreWindow(win.id);
    }
    if (win.snap && !win.maximized) {
      // Double-clicking or using the maximize button on a tile maximizes it;
      // drag-away, Float window, and the float shortcut still un-snap.
      maximizeWindow(win, options.animate !== false);
      return true;
    }
    if (win.maximized) {
      win.maximized = false;
      win.node.classList.remove('is-maximized');
      win.userOverride = true;
      if (win.previousSnap) {
        win.snap = win.previousSnap;
        win.previousSnap = null;
        win.node.classList.add('wm-snapped');
        updateMaximizeButton(win);
        updateWindowClasses(win);
        applyBounds(win, win.snap.bounds, options.animate !== false);
      } else {
        updateMaximizeButton(win);
        applyBounds(win, validBounds(win.previousBounds) ? win.previousBounds : {
          x: win.x, y: win.y, width: win.width, height: win.height
        }, options.animate !== false);
      }
      persist();
      refreshDividers();
      if (bridge.focusWindow) bridge.focusWindow(win.id);
    } else {
      maximizeWindow(win, options.animate !== false);
    }
    return true;
  }

  function applySnap(win, intent, options) {
    options = options || {};
    if (!win || win.closed || !intent) return false;

    if (intent.maximize) {
      maximizeWindow(win, options.animate !== false);
      return true;
    }

    const descriptor = intent.descriptor || Core.layout(intent.layout, state.customLayouts);
    if (!descriptor) return false;
    const zoneId = intent.zone;
    const zone = descriptor.zones.filter(function (item) { return item.id === zoneId; })[0];
    if (!zone) return false;

    if (win.minimized && bridge.restoreWindow) bridge.restoreWindow(win.id);

    const previousGroupId = win.snap && win.snap.groupId;
    const groupId = options.groupId ||
      (previousGroupId && !groupZoneOccupied(previousGroupId, zoneId, win) ? previousGroupId : null) ||
      adjacentGroupFor(win, descriptor.id, zoneId) ||
      createGroupId();
    const floating = floatingBounds(win);
    const rawBounds = intent.bounds || Core.boundsForZone(descriptor, zoneId, getArea());
    const finalBounds = Core.clampBounds(rawBounds, getArea(), snapConstraintsOf(win));

    win.snap = {
      layout: descriptor.id,
      zone: zoneId,
      groupId: groupId,
      bounds: copyBounds(finalBounds),
      floating: copyBounds(floating)
    };
    win.maximized = false;
    win.node.classList.remove('is-maximized');
    win.node.classList.add('wm-snapped');
    win.tiling = options.tiling === true;
    win.userOverride = options.tiling === true ? false : true;
    win.node.classList.toggle('wm-tiled', win.tiling);
    updateMaximizeButton(win);
    updateWindowClasses(win);
    applyBounds(win, finalBounds, options.animate !== false);
    if (options.focus !== false && bridge.focusWindow) bridge.focusWindow(win.id);
    persist();
    refreshDividers();
    if (options.assist !== false) scheduleSnapAssist(win);
    return true;
  }

  function snapToZone(win, layoutId, zoneId, options) {
    const descriptor = Core.layout(layoutId, state.customLayouts);
    if (!descriptor) {
      toast('LAYOUT UNAVAILABLE', 2200);
      return false;
    }
    const bounds = Core.boundsForZone(descriptor, zoneId, getArea());
    if (!bounds) {
      toast('ZONE UNAVAILABLE', 2200);
      return false;
    }
    return applySnap(win, {
      layout: layoutId,
      zone: zoneId,
      bounds: bounds
    }, options || {});
  }

  function snapIntentForSide(win, side, options) {
    const area = getArea();
    if (side === 'maximized') {
      return applySnap(win, {
        layout: 'halves', zone: 'maximized', maximize: true, bounds: area
      }, options || {});
    }
    if (side === 'left' || side === 'right') {
      return snapToZone(win, 'halves', side, options);
    }
    if (side === 'top') return snapToZone(win, 'top-bottom', 'top', options);
    if (side === 'bottom') return snapToZone(win, 'top-bottom', 'bottom', options);
    return false;
  }

  /* ------------------------------------------------------------------
   * Drag
   * ------------------------------------------------------------------ */
  function beginDrag(event, win) {
    if (!ready || !win || win.closed) return false;
    if (event.button !== 0) return false;
    if (event.target.closest && event.target.closest('.window-controls, button, input, textarea, select, a, .resize-handle, .wm-linked-divider')) {
      return false;
    }
    if (drag) endDrag(null);
    event.preventDefault();
    if (bridge.focusWindow) bridge.focusWindow(win.id);

    const area = getArea();
    let startBounds = copyBounds(win);
    let grabX = event.clientX - win.x;
    let grabY = event.clientY - win.y;

    // Dragging a snapped/maximized window restores its floating size under the
    // pointer instead of dragging a full-screen rectangle around.
    if (win.snap || win.maximized) {
      const floating = floatingBounds(win);
      if (floating) {
        startBounds = floating;
        const ratioX = win.snap ? clamp(grabX / Math.max(1, win.width), 0.05, 0.95) : 0.5;
        const ratioY = Math.min(0.55, clamp(grabY / Math.max(1, win.height), 0.02, 0.35));
        grabX = ratioX * floating.width;
        grabY = ratioY * floating.height;
      }
      win.snap = null;
      win.maximized = false;
      win.tiling = false;
      win.node.classList.remove('is-maximized', 'wm-snapped');
      updateMaximizeButton(win);
      updateWindowClasses(win);
      applyBounds(win, {
        x: event.clientX - grabX,
        y: event.clientY - grabY,
        width: startBounds.width,
        height: startBounds.height
      }, false);
      startBounds = copyBounds(win);
      grabX = event.clientX - win.x;
      grabY = event.clientY - win.y;
      refreshDividers();
      hideSnapAssist();
    }

    drag = {
      win: win,
      startX: event.clientX,
      startY: event.clientY,
      startBounds: startBounds,
      grabX: grabX,
      grabY: grabY,
      intent: null
    };

    win.node.classList.add('wm-dragging');
    document.body.classList.add('is-dragging');

    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
    return true;
  }

  function onDragMove(event) {
    if (!drag) return;
    const win = drag.win;
    if (!win || win.closed) {
      endDrag(event);
      return;
    }
    const area = getArea();
    let x = event.clientX - drag.grabX;
    let y = event.clientY - drag.grabY;

    // Keep a title-bar slice reachable instead of allowing the window to leave
    // the desktop entirely. This is a boundary clamp, not a snap.
    x = clamp(x, area.x - Math.min(120, win.width - 80), area.x + area.width - 80);
    y = clamp(y, area.y, area.y + area.height - 36);

    bridge.setBounds(win, {
      x: x,
      y: y,
      width: win.width,
      height: win.height
    });

    const intent = Core.findSnapIntent({
      x: event.clientX - area.x + area.x,
      y: event.clientY
    }, area, {
      threshold: 22,
      enableBottomEdge: true
    });

    drag.intent = intent;
    if (intent) showPreview(intent, win);
    else hidePreview();
  }

  function onDragEnd(event) {
    if (!drag) return;
    endDrag(event);
  }

  function endDrag() {
    if (!drag) return;
    const session = drag;
    drag = null;

    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragEnd);
    document.body.classList.remove('is-dragging');
    if (session.win && session.win.node) session.win.node.classList.remove('wm-dragging');
    hidePreview();

    const win = session.win;
    if (!win || win.closed) return;

    if (session.intent) {
      applySnap(win, session.intent, {
        animate: true,
        assist: true
      });
    } else {
      win.snap = null;
      win.tiling = false;
      win.userOverride = true;
      updateWindowClasses(win);
      refreshDividers();
      persist();
    }
  }

  /* ------------------------------------------------------------------
   * Free resize + linked divider resize
   * ------------------------------------------------------------------ */
  function beginResize(event, win, dir) {
    if (!ready || !win || win.closed) return false;
    if (event.button !== 0) return false;
    if (win.maximized) return false;
    event.preventDefault();
    event.stopPropagation();
    if (bridge.focusWindow) bridge.focusWindow(win.id, true);

    if (win.snap) {
      // A manual corner drag turns the tile into a floating window at its
      // current size so the drag feels direct.
      win.snap = null;
      win.maximized = false;
      win.node.classList.remove('is-maximized', 'wm-snapped');
      updateMaximizeButton(win);
      updateWindowClasses(win);
      refreshDividers();
      hideSnapAssist();
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const start = copyBounds(win);
    document.body.classList.add('is-resizing');

    function onMove(moveEvent) {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const next = Core.resizeBounds(start, dir, dx, dy, getArea(), constraintsOf(win));
      bridge.setBounds(win, next);
    }

    function onUp() {
      document.body.classList.remove('is-resizing');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      win.userOverride = true;
      win.tiling = false;
      persist();
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return true;
  }

  function dividerGroups() {
    const groups = new Map();
    allWindows().forEach(function (win) {
      if (!win.snap || !win.snap.groupId || !validBounds(win.snap.bounds)) return;
      if (workspaceOf(win) !== state.activeWorkspace) return;
      if (win.minimized || win.closed) return;
      const groupId = win.snap.groupId;
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId).push(win);
    });
    return groups;
  }

  function refreshDividers() {
    if (!layer) return;
    layer.querySelectorAll('.wm-linked-divider').forEach(function (node) { node.remove(); });

    dividerGroups().forEach(function (wins, groupId) {
      if (wins.length < 2) return;
      const verticalEdges = new Map();
      const horizontalEdges = new Map();

      function addEdge(map, key, win) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(win);
      }

      wins.forEach(function (win) {
        const bounds = win.snap.bounds;
        addEdge(verticalEdges, bounds.x, win);
        addEdge(verticalEdges, bounds.x + bounds.width, win);
        addEdge(horizontalEdges, bounds.y, win);
        addEdge(horizontalEdges, bounds.y + bounds.height, win);
      });

      verticalEdges.forEach(function (edgeWins, position) {
        const left = edgeWins.filter(function (win) {
          return Math.abs(win.snap.bounds.x + win.snap.bounds.width - position) <= 0.75;
        });
        const right = edgeWins.filter(function (win) {
          return Math.abs(win.snap.bounds.x - position) <= 0.75;
        });
        if (!left.length || !right.length) return;

        left.forEach(function (leftWin) {
          right.forEach(function (rightWin) {
            const top = Math.max(leftWin.snap.bounds.y, rightWin.snap.bounds.y);
            const bottom = Math.min(
              leftWin.snap.bounds.y + leftWin.snap.bounds.height,
              rightWin.snap.bounds.y + rightWin.snap.bounds.height
            );
            if (bottom - top < 24) return;
            addDivider({
              axis: 'x',
              position: position,
              start: top,
              end: bottom,
              groupId: groupId
            });
          });
        });
      });

      horizontalEdges.forEach(function (edgeWins, position) {
        const topWins = edgeWins.filter(function (win) {
          return Math.abs(win.snap.bounds.y + win.snap.bounds.height - position) <= 0.75;
        });
        const bottomWins = edgeWins.filter(function (win) {
          return Math.abs(win.snap.bounds.y - position) <= 0.75;
        });
        if (!topWins.length || !bottomWins.length) return;

        topWins.forEach(function (topWin) {
          bottomWins.forEach(function (bottomWin) {
            const left = Math.max(topWin.snap.bounds.x, bottomWin.snap.bounds.x);
            const right = Math.min(
              topWin.snap.bounds.x + topWin.snap.bounds.width,
              bottomWin.snap.bounds.x + bottomWin.snap.bounds.width
            );
            if (right - left < 24) return;
            addDivider({
              axis: 'y',
              position: position,
              start: left,
              end: right,
              groupId: groupId
            });
          });
        });
      });
    });
  }

  function addDivider(descriptor) {
    if (!layer) return;
    // Collapse duplicates produced by pairwise edge matching.
    const key = descriptor.axis + ':' + Math.round(descriptor.position) + ':' +
      Math.round(descriptor.start) + ':' + Math.round(descriptor.end);
    const existing = layer.querySelector('[data-divider-key="' + key + '"]');
    if (existing) return;

    const node = document.createElement('div');
    node.className = 'wm-linked-divider ' + (descriptor.axis === 'x' ? 'is-vertical' : 'is-horizontal');
    node.dataset.dividerKey = key;
    node.dataset.groupId = descriptor.groupId;
    node.dataset.axis = descriptor.axis;
    node.dataset.position = String(descriptor.position);
    node.setAttribute('aria-hidden', 'true');
    node.title = 'Drag to resize both windows';
    if (descriptor.axis === 'x') {
      node.style.left = descriptor.position + 'px';
      node.style.top = descriptor.start + 'px';
      node.style.height = (descriptor.end - descriptor.start) + 'px';
    } else {
      node.style.top = descriptor.position + 'px';
      node.style.left = descriptor.start + 'px';
      node.style.width = (descriptor.end - descriptor.start) + 'px';
    }
    node.addEventListener('pointerdown', function (event) {
      beginLinkedResize(event, descriptor);
    });
    layer.appendChild(node);
  }

  function beginLinkedResize(event, divider) {
    if (event.button !== 0 || dividerDrag) return;
    event.preventDefault();
    event.stopPropagation();
    const groupId = divider.groupId;
    const wins = allWindows().filter(function (win) {
      return win.snap && win.snap.groupId === groupId &&
        !win.closed && !win.minimized && validBounds(win.snap.bounds);
    });
    if (wins.length < 2) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const entries = wins.map(function (win) {
      const constraints = snapConstraintsOf(win);
      return {
        id: win.id,
        bounds: copyBounds(win.snap.bounds),
        minWidth: constraints.minWidth,
        minHeight: constraints.minHeight,
        maxWidth: constraints.maxWidth,
        maxHeight: constraints.maxHeight
      };
    });

    dividerDrag = { divider: divider, wins: wins, entries: entries };
    document.body.classList.add('wm-linked-resizing');
    const dividerNode = layer.querySelector('[data-divider-key="' +
      (divider.axis + ':' + Math.round(divider.position) + ':' +
        Math.round(divider.start) + ':' + Math.round(divider.end)) + '"]');
    if (dividerNode) dividerNode.classList.add('is-active');

    function onMove(moveEvent) {
      if (!dividerDrag) return;
      const delta = divider.axis === 'x'
        ? moveEvent.clientX - startX
        : moveEvent.clientY - startY;
      const updates = Core.linkedResize(entries, {
        axis: divider.axis,
        position: divider.position
      }, delta, getArea(), {});
      if (!updates.length) return;

      let newPosition = divider.position + delta;
      updates.forEach(function (update) {
        const win = bridge.windows.get(update.id);
        if (!win || win.closed) return;
        const next = copyBounds(update.bounds);
        bridge.setBounds(win, next, snapConstraintsOf(win));
        if (win.snap) win.snap.bounds = copyBounds({
          x: win.x, y: win.y, width: win.width, height: win.height
        });
        if (update.bounds.x > divider.position) newPosition = update.bounds.x;
        if (update.bounds.y > divider.position) newPosition = update.bounds.y;
      });

      if (dividerNode) {
        if (divider.axis === 'x') dividerNode.style.left = newPosition + 'px';
        else dividerNode.style.top = newPosition + 'px';
      }
    }

    function onUp() {
      document.body.classList.remove('wm-linked-resizing');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (dividerNode) dividerNode.classList.remove('is-active');
      dividerDrag = null;
      persist();
      refreshDividers();
      if (overviewEl) refreshOverview();
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  /* ------------------------------------------------------------------
   * Snap Assist
   * ------------------------------------------------------------------ */
  function scheduleSnapAssist(win) {
    window.clearTimeout(assistTimer);
    assistTimer = window.setTimeout(function () {
      showSnapAssist(win);
    }, reduceMotion() ? 0 : ASSIST_DELAY);
  }

  function hideSnapAssist() {
    window.clearTimeout(assistTimer);
    if (assistEl) {
      assistEl.hidden = true;
      assistEl.replaceChildren();
    }
  }

  function showSnapAssist(win) {
    if (!win || !win.snap || !bridge || typeof document === 'undefined') return;
    const layoutId = win.snap.layout;
    const descriptor = Core.layout(layoutId, state.customLayouts);
    if (!descriptor) return;

    const occupied = new Set();
    windowsOnWorkspace(state.activeWorkspace).forEach(function (other) {
      if (other.snap && other.snap.layout === layoutId && other.snap.zone) {
        occupied.add(other.snap.zone);
      }
    });
    const remaining = descriptor.zones.filter(function (zone) {
      return !occupied.has(zone.id);
    });
    const candidates = windowsOnWorkspace(state.activeWorkspace).filter(function (other) {
      return other.id !== win.id && !other.closed;
    });
    if (!remaining.length || !candidates.length) {
      hideSnapAssist();
      return;
    }

    if (!assistEl) {
      assistEl = document.createElement('div');
      assistEl.className = 'wm-snap-assist';
      assistEl.setAttribute('role', 'dialog');
      assistEl.setAttribute('aria-label', 'Snap Assist');
      bridge.desktop.appendChild(assistEl);
    }

    assistEl.replaceChildren();
    assistEl.hidden = false;

    const header = document.createElement('div');
    header.className = 'wm-assist-header';
    const title = document.createElement('strong');
    title.textContent = 'Snap Assist';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'wm-assist-close';
    close.textContent = '\u00D7';
    close.setAttribute('aria-label', 'Close Snap Assist');
    close.addEventListener('click', hideSnapAssist);
    header.appendChild(title);
    header.appendChild(close);

    const hint = document.createElement('p');
    hint.className = 'wm-assist-hint';
    hint.textContent = 'Choose a zone, then click a window.';

    const zoneRow = document.createElement('div');
    zoneRow.className = 'wm-assist-zones';
    let selectedZone = remaining[0].id;

    remaining.forEach(function (zone) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wm-assist-zone';
      button.dataset.zone = zone.id;
      button.textContent = zone.label || zone.id;
      if (zone.id === selectedZone) button.classList.add('is-selected');
      button.addEventListener('click', function () {
        selectedZone = zone.id;
        zoneRow.querySelectorAll('.wm-assist-zone').forEach(function (other) {
          other.classList.toggle('is-selected', other.dataset.zone === selectedZone);
        });
      });
      zoneRow.appendChild(button);
    });

    const list = document.createElement('div');
    list.className = 'wm-assist-list';
    candidates.forEach(function (candidate) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wm-assist-candidate';
      button.dataset.windowId = candidate.id;
      button.innerHTML = '<span class="wm-assist-icon" aria-hidden="true">' +
        escapeHtml(candidate.icon || '\u25A3') + '</span>' +
        '<span class="wm-assist-name">' + escapeHtml(candidate.title || candidate.id) + '</span>' +
        (candidate.minimized ? '<span class="wm-assist-min">minimized</span>' : '');
      button.addEventListener('click', function () {
        placeAssistCandidate(candidate, win, selectedZone);
      });
      list.appendChild(button);
    });

    assistEl.appendChild(header);
    assistEl.appendChild(hint);
    assistEl.appendChild(zoneRow);
    assistEl.appendChild(list);
  }

  function placeAssistCandidate(candidate, source, zoneId) {
    if (!candidate || !source || !source.snap) return;
    const layoutId = source.snap.layout;
    const groupId = source.snap.groupId;
    const descriptor = Core.layout(layoutId, state.customLayouts);
    if (!descriptor) return;
    if (candidate.minimized && bridge.restoreWindow) bridge.restoreWindow(candidate.id);
    snapToZone(candidate, layoutId, zoneId, {
      groupId: groupId,
      animate: true,
      assist: true
    });
    hideSnapAssist();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ------------------------------------------------------------------
   * Snap layout chooser
   * ------------------------------------------------------------------ */
  function openLayoutChooser(win, options) {
    options = options || {};
    if (!win || win.closed) {
      const active = activeWindow();
      if (!active) {
        toast('NO ACTIVE WINDOW', 2200);
        return;
      }
      win = active;
    }
    closeLayoutChooser();
    chooserWin = win;

    chooserEl = document.createElement('div');
    chooserEl.className = 'wm-layout-chooser';
    chooserEl.setAttribute('role', 'dialog');
    chooserEl.setAttribute('aria-label', 'Snap layouts');
    chooserEl.dataset.windowId = win.id;

    const header = document.createElement('div');
    header.className = 'wm-chooser-header';
    const title = document.createElement('strong');
    title.textContent = 'Snap layouts';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'wm-chooser-close';
    close.textContent = '\u00D7';
    close.setAttribute('aria-label', 'Close snap layouts');
    close.addEventListener('click', closeLayoutChooser);
    header.appendChild(title);
    header.appendChild(close);

    const grid = document.createElement('div');
    grid.className = 'wm-layout-grid';

    const customLayouts = state.customLayouts.slice();
    const builtIn = Core.layouts();
    builtIn.concat(customLayouts).forEach(function (descriptor) {
      const card = document.createElement('div');
      card.className = 'wm-layout-card';
      if (win.snap && win.snap.layout === descriptor.id) card.classList.add('is-current');

      const label = document.createElement('span');
      label.className = 'wm-layout-name';
      label.textContent = descriptor.name;

      const preview = document.createElement('div');
      preview.className = 'wm-layout-preview';
      descriptor.zones.forEach(function (zone) {
        const zoneButton = document.createElement('button');
        zoneButton.type = 'button';
        zoneButton.className = 'wm-layout-zone';
        zoneButton.style.left = (zone.x * 100) + '%';
        zoneButton.style.top = (zone.y * 100) + '%';
        zoneButton.style.width = (zone.width * 100) + '%';
        zoneButton.style.height = (zone.height * 100) + '%';
        zoneButton.title = zone.label || zone.id;
        zoneButton.setAttribute('aria-label', descriptor.name + ': ' + (zone.label || zone.id));
        if (win.snap && win.snap.layout === descriptor.id && win.snap.zone === zone.id) {
          zoneButton.classList.add('is-selected');
        }
        zoneButton.addEventListener('click', function (event) {
          event.stopPropagation();
          snapToZone(win, descriptor.id, zone.id, { animate: true, assist: true });
          closeLayoutChooser();
        });
        preview.appendChild(zoneButton);
      });

      card.appendChild(preview);
      card.appendChild(label);
      grid.appendChild(card);
    });

    const footer = document.createElement('div');
    footer.className = 'wm-chooser-footer';

    const topLabel = document.createElement('label');
    topLabel.className = 'wm-chooser-toggle';
    const topInput = document.createElement('input');
    topInput.type = 'checkbox';
    topInput.checked = Boolean(win.alwaysOnTop);
    topInput.addEventListener('change', function () {
      setAlwaysOnTop(win, topInput.checked);
    });
    topLabel.appendChild(topInput);
    topLabel.appendChild(document.createTextNode(' Always on top'));

    const floatButton = document.createElement('button');
    floatButton.type = 'button';
    floatButton.className = 'wm-chooser-action';
    floatButton.textContent = 'Float window';
    floatButton.addEventListener('click', function () {
      restoreFloating(win, true);
      closeLayoutChooser();
    });

    footer.appendChild(topLabel);
    footer.appendChild(floatButton);

    const hint = document.createElement('p');
    hint.className = 'wm-chooser-hint';
    hint.textContent = 'Hover the maximize button or press Ctrl+Alt+K.';

    chooserEl.appendChild(header);
    chooserEl.appendChild(grid);
    chooserEl.appendChild(footer);
    chooserEl.appendChild(hint);
    document.body.appendChild(chooserEl);

    const button = win.titlebar && win.titlebar.querySelector('[data-action="maximize"]');
    const rect = (button || win.node).getBoundingClientRect();
    const width = 330;
    const left = clamp(rect.right - width, 8, window.innerWidth - width - 8);
    const top = clamp(rect.bottom + 6, 8, Math.max(8, window.innerHeight - 360));
    chooserEl.style.left = left + 'px';
    chooserEl.style.top = top + 'px';

    if (options.passive) {
      chooserEl.classList.add('is-hover');
      chooserEl.addEventListener('pointerenter', function () {
        window.clearTimeout(chooserCloseTimer);
      });
      chooserEl.addEventListener('pointerleave', scheduleChooserClose);
    }
  }

  function scheduleChooserClose() {
    window.clearTimeout(chooserCloseTimer);
    chooserCloseTimer = window.setTimeout(closeLayoutChooser, 280);
  }

  function closeLayoutChooser() {
    window.clearTimeout(chooserHoverTimer);
    window.clearTimeout(chooserCloseTimer);
    if (chooserEl && chooserEl.parentNode) chooserEl.parentNode.removeChild(chooserEl);
    chooserEl = null;
    chooserWin = null;
  }

  /* ------------------------------------------------------------------
   * Workspaces
   * ------------------------------------------------------------------ */
  function applyWorkspaceVisibility() {
    if (!state.workspaces.length) state.workspaces = Core.createDefaultState().workspaces;
    state.activeWorkspace = clamp(state.activeWorkspace, 0, state.workspaces.length - 1);
    const active = state.activeWorkspace;

    allWindows().forEach(function (win) {
      const visible = workspaceOf(win) === active;
      win.node.classList.toggle('wm-off-workspace', !visible);
      win.node.setAttribute('aria-hidden', visible ? 'false' : 'true');
      if (win.taskbarButton) {
        win.taskbarButton.hidden = !visible;
        win.taskbarButton.classList.toggle('wm-off-workspace', !visible);
      }
      updateWindowClasses(win);
    });

    const current = activeWindow();
    if (current && workspaceOf(current) !== active) {
      if (bridge.clearActive) bridge.clearActive();
    }
    hideSnapAssist();
    hidePreview();
    refreshDividers();
    if (overviewEl) refreshOverview();
  }

  function focusTopOnWorkspace() {
    const list = windowsOnWorkspace(state.activeWorkspace)
      .filter(function (win) { return !win.minimized; })
      .sort(function (a, b) {
        return Number(a.node.style.zIndex || 0) - Number(b.node.style.zIndex || 0);
      });
    if (!list.length) {
      if (bridge.clearActive) bridge.clearActive();
      return;
    }
    if (bridge.focusWindow) bridge.focusWindow(list[list.length - 1].id, true);
  }

  function switchWorkspace(index) {
    const target = clamp(Math.round(Number(index) || 0), 0, state.workspaces.length - 1);
    if (target === state.activeWorkspace) return false;
    state.activeWorkspace = target;
    applyWorkspaceVisibility();
    focusTopOnWorkspace();
    persist();
    return true;
  }

  function addWorkspace() {
    if (state.workspaces.length >= Core.MAX_WORKSPACES) {
      toast('MAXIMUM 9 DESKTOPS', 2200);
      return false;
    }
    state.workspaces.push({
      id: state.workspaces.length,
      name: 'Desktop ' + (state.workspaces.length + 1)
    });
    persist();
    if (overviewEl) refreshOverview();
    else applyWorkspaceVisibility();
    return true;
  }

  function renameWorkspace(index, name) {
    const item = state.workspaces[index];
    if (!item) return false;
    const trimmed = String(name || '').trim().slice(0, 32);
    item.name = trimmed || ('Desktop ' + (index + 1));
    persist();
    if (overviewEl) refreshOverview();
    return true;
  }

  function remapWorkspaceKey(source, oldToNew) {
    const result = {};
    Object.keys(source || {}).forEach(function (key) {
      const oldIndex = Number(key);
      if (!isFinite(oldIndex) || !Object.prototype.hasOwnProperty.call(oldToNew, oldIndex)) return;
      result[String(oldToNew[oldIndex])] = source[key];
    });
    return result;
  }

  function reorderWorkspace(from, to) {
    const length = state.workspaces.length;
    const source = clamp(Math.round(Number(from) || 0), 0, length - 1);
    const target = clamp(Math.round(Number(to) || 0), 0, length - 1);
    if (source === target) return false;

    const records = state.workspaces.map(function (workspace, index) {
      return {
        workspace: { id: index, name: workspace.name },
        layout: state.workspaceLayouts[String(index)] || null,
        windows: windowsOnWorkspace(index)
      };
    });
    const moved = records.splice(source, 1)[0];
    records.splice(target, 0, moved);

    const oldToNew = {};
    records.forEach(function (record, newIndex) {
      oldToNew[record.workspace.id] = newIndex;
      record.windows.forEach(function (win) {
        win.workspace = newIndex;
      });
    });

    state.workspaces = records.map(function (record, index) {
      return { id: index, name: record.workspace.name };
    });

    const layouts = {};
    records.forEach(function (record, newIndex) {
      if (record.layout) layouts[String(newIndex)] = record.layout;
    });
    state.workspaceLayouts = layouts;

    Object.keys(state.rules).forEach(function (appId) {
      const rule = state.rules[appId];
      if (!rule || rule.workspace == null) return;
      rule.workspace = oldToNew[rule.workspace] == null ? 0 : oldToNew[rule.workspace];
    });

    state.activeWorkspace = oldToNew[state.activeWorkspace] == null
      ? 0
      : oldToNew[state.activeWorkspace];
    applyWorkspaceVisibility();
    persist();
    toast('DESKTOP ORDER UPDATED', 1600);
    return true;
  }

  function deleteWorkspace(index) {
    if (state.workspaces.length <= 1) {
      toast('AT LEAST ONE DESKTOP IS REQUIRED', 2400);
      return false;
    }
    const removeAt = clamp(Math.round(Number(index) || 0), 0, state.workspaces.length - 1);
    const destinationOld = removeAt === 0 ? 1 : removeAt - 1;
    const destinationName = state.workspaces[destinationOld].name;
    const oldLength = state.workspaces.length;

    // Build the old -> new index map before splicing so a deleted desktop can
    // hand its windows to a surviving desktop without off-by-one corruption.
    const oldToNew = {};
    let cursor = 0;
    for (let oldIndex = 0; oldIndex < oldLength; oldIndex += 1) {
      oldToNew[oldIndex] = oldIndex === removeAt
        ? (oldIndex > 0 ? oldIndex - 1 : 0)
        : cursor;
      if (oldIndex !== removeAt) cursor += 1;
    }

    const assignments = [];
    state.workspaces.forEach(function (workspace, oldIndex) {
      const destination = oldIndex === removeAt ? oldToNew[destinationOld] : oldToNew[oldIndex];
      windowsOnWorkspace(oldIndex).forEach(function (win) {
        assignments.push({ win: win, workspace: destination });
      });
    });

    state.workspaces.splice(removeAt, 1);

    assignments.forEach(function (assignment) {
      assignment.win.workspace = assignment.workspace;
    });

    const sourceLayouts = Object.assign({}, state.workspaceLayouts);
    delete sourceLayouts[String(removeAt)];
    state.workspaceLayouts = remapWorkspaceKey(sourceLayouts, oldToNew);

    Object.keys(state.rules).forEach(function (appId) {
      const rule = state.rules[appId];
      if (!rule || rule.workspace == null) return;
      if (rule.workspace === removeAt) rule.workspace = oldToNew[destinationOld];
      else if (oldToNew[rule.workspace] != null) rule.workspace = oldToNew[rule.workspace];
    });

    state.activeWorkspace = oldToNew[state.activeWorkspace] == null
      ? 0
      : oldToNew[state.activeWorkspace];
    state.workspaces.forEach(function (workspace, newIndex) {
      workspace.id = newIndex;
    });

    applyWorkspaceVisibility();
    persist();
    toast('DESKTOP REMOVED \u2014 WINDOWS MOVED TO ' + destinationName.toUpperCase(), 2600);
    return true;
  }

  function moveWindowToWorkspace(win, index) {
    if (!win || win.closed) return false;
    const target = clamp(Math.round(Number(index) || 0), 0, state.workspaces.length - 1);
    win.workspace = target;
    if (win.snap && win.snap.groupId) {
      // Keep a snap group on one desktop.
      allWindows().forEach(function (member) {
        if (member.snap && member.snap.groupId === win.snap.groupId) {
          member.workspace = target;
        }
      });
    }
    updateWindowClasses(win);
    applyWorkspaceVisibility();
    persist();
    return true;
  }

  function ensureVisible(win) {
    if (!win) return;
    const workspace = workspaceOf(win);
    if (workspace !== state.activeWorkspace) {
      state.activeWorkspace = workspace;
      applyWorkspaceVisibility();
      persist();
    }
  }

  /* ------------------------------------------------------------------
   * Tiling, custom layouts, app rules
   * ------------------------------------------------------------------ */
  function ruleAppId(win) {
    if (!win) return '';
    // Program windows share appId "program"; their window id is the app key
    // used by the rules UI (for example program-calculator).
    return win.appId === 'program' && win.id ? win.id : win.appId;
  }

  function ruleForApp(appId) {
    return state.rules[appId] || null;
  }

  function eligibleForTiling(win) {
    if (!win || win.closed || win.minimized) return false;
    if (workspaceOf(win) !== state.activeWorkspace) return false;
    if (win.userOverride) return false;
    const rule = ruleForApp(ruleAppId(win));
    if (rule && rule.floating) return false;
    return true;
  }

  function applyTilingWorkspace(options) {
    options = options || {};
    if (!state.tilingEnabled) return false;
    const workspace = state.activeWorkspace;
    const wins = windowsOnWorkspace(workspace).filter(eligibleForTiling);
    if (!wins.length) return false;

    const preferred = state.workspaceLayouts[String(workspace)] || 'halves';
    let descriptor = Core.layout(preferred, state.customLayouts);
    if (!descriptor) descriptor = Core.layout('halves');
    if (descriptor.zones.length < wins.length) {
      descriptor = Core.autoGridLayout(wins.length);
    }
    const groupId = 'tile-' + workspace;
    wins.forEach(function (win, index) {
      const zone = descriptor.zones[index % descriptor.zones.length];
      const bounds = Core.boundsForZone(descriptor, zone.id, getArea());
      applySnap(win, {
        layout: descriptor.id,
        zone: zone.id,
        bounds: bounds,
        descriptor: descriptor
      }, {
        groupId: groupId,
        animate: options.animate !== false,
        assist: false,
        focus: false,
        tiling: true
      });
    });
    persist();
    refreshDividers();
    return true;
  }

  function setTilingEnabled(enabled) {
    state.tilingEnabled = Boolean(enabled);
    persist();
    if (state.tilingEnabled) applyTilingWorkspace({ animate: true });
    if (overviewEl) refreshOverview();
  }

  function captureCustomLayout() {
    const wins = windowsOnWorkspace(state.activeWorkspace).filter(function (win) {
      return win.snap && validBounds(win.snap.bounds);
    });
    if (wins.length < 2) {
      toast('SNAP AT LEAST TWO WINDOWS FIRST', 2600);
      return null;
    }
    const name = 'Custom ' + (state.customLayouts.length + 1);
    const descriptor = Core.captureLayout(wins.map(function (win) {
      return { id: win.id, title: win.title, bounds: win.snap.bounds };
    }), getArea(), name);
    if (!descriptor) return null;
    state.customLayouts.push(descriptor);
    state.workspaceLayouts[String(state.activeWorkspace)] = descriptor.id;
    persist();
    if (overviewEl) refreshOverview();
    toast('LAYOUT SAVED \u2014 ' + descriptor.name.toUpperCase(), 2400);
    return descriptor;
  }

  function deleteCustomLayout(id) {
    state.customLayouts = state.customLayouts.filter(function (layout) {
      return layout.id !== id;
    });
    Object.keys(state.workspaceLayouts).forEach(function (key) {
      if (state.workspaceLayouts[key] === id) delete state.workspaceLayouts[key];
    });
    persist();
    if (overviewEl) refreshOverview();
  }

  function setWorkspaceLayout(layoutId) {
    const descriptor = Core.layout(layoutId, state.customLayouts);
    if (!descriptor) return false;
    state.workspaceLayouts[String(state.activeWorkspace)] = layoutId;
    persist();
    if (state.tilingEnabled) applyTilingWorkspace({ animate: true });
    return true;
  }

  function setAlwaysOnTop(win, enabled) {
    if (!win) return false;
    win.alwaysOnTop = Boolean(enabled);
    win.userOverride = true;
    updateWindowClasses(win);
    if (bridge.focusWindow) bridge.focusWindow(win.id);
    persist();
    if (overviewEl) refreshOverview();
    return true;
  }

  function setAppRule(appId, patch) {
    if (!appId) return false;
    const current = state.rules[appId] || {
      floating: false,
      alwaysOnTop: false,
      workspace: null
    };
    state.rules[appId] = {
      floating: patch && typeof patch.floating === 'boolean' ? patch.floating : current.floating,
      alwaysOnTop: patch && typeof patch.alwaysOnTop === 'boolean' ? patch.alwaysOnTop : current.alwaysOnTop,
      workspace: patch && patch.workspace != null
        ? clamp(Math.round(Number(patch.workspace)), 0, state.workspaces.length - 1)
        : current.workspace
    };
    persist();
    if (overviewEl) refreshOverview();
    return true;
  }

  /* ------------------------------------------------------------------
   * Snap groups
   * ------------------------------------------------------------------ */
  function onWindowShown(win) {
    if (!win || !state.tilingEnabled || win.userOverride) return false;
    return applyTilingWorkspace({ animate: true });
  }

  function restoreGroupFor(win) {
    if (!win || !win.snap || !win.snap.groupId) return false;
    const groupId = win.snap.groupId;
    const members = allWindows().filter(function (member) {
      return member.snap && member.snap.groupId === groupId;
    });
    if (!members.length) return false;
    members.forEach(function (member) {
      if (member.minimized && bridge.restoreWindow) bridge.restoreWindow(member.id);
    });
    if (bridge.focusWindow) bridge.focusWindow(win.id, true);
    refreshDividers();
    return true;
  }

  /* ------------------------------------------------------------------
   * Window registration / restore
   * ------------------------------------------------------------------ */
  function onWindowRegistered(win, opts) {
    opts = opts || {};
    if (!win) return;
    if (!isFinite(Number(win.workspace))) win.workspace = state.activeWorkspace;
    if (typeof win.alwaysOnTop !== 'boolean') win.alwaysOnTop = false;
    if (typeof win.userOverride !== 'boolean') win.userOverride = false;
    if (typeof win.tiling !== 'boolean') win.tiling = false;

    if (!opts.restoring) {
      const rule = ruleForApp(ruleAppId(win));
      if (rule) {
        if (rule.workspace != null) win.workspace = rule.workspace;
        if (rule.alwaysOnTop) win.alwaysOnTop = true;
        if (rule.floating) win.tiling = false;
      } else {
        win.workspace = state.activeWorkspace;
      }
    }

    addLayoutButton(win);
    attachTitlebarAffordances(win);
    updateWindowClasses(win);

    if (win.taskbarButton) {
      win.taskbarButton.hidden = workspaceOf(win) !== state.activeWorkspace;
    }

    if (!opts.restoring && state.tilingEnabled && !win.userOverride) {
      const rule = ruleForApp(ruleAppId(win));
      if (!rule || !rule.floating) {
        window.setTimeout(function () {
          if (!win.closed) applyTilingWorkspace({ animate: true });
        }, 0);
      }
    }
  }

  function addLayoutButton(win) {
    if (!win.titlebar) return;
    let controls = win.titlebar.querySelector('.window-controls');
    if (!controls) return;
    if (controls.querySelector('.wm-layout-button')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'window-control wm-layout-button';
    button.dataset.action = 'snap-layouts';
    button.title = 'Snap layouts (Ctrl+Alt+K)';
    button.setAttribute('aria-label', 'Snap layouts for ' + win.title);
    button.textContent = '\u25A6';
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      if (chooserEl && chooserWin === win) closeLayoutChooser();
      else openLayoutChooser(win);
    });
    controls.insertBefore(button, controls.firstChild);
  }

  function attachTitlebarAffordances(win) {
    if (!win.titlebar || win.titlebar.dataset.wmAffordances === '1') return;
    win.titlebar.dataset.wmAffordances = '1';
    const maximize = win.titlebar.querySelector('[data-action="maximize"]');
    if (!maximize) return;

    maximize.addEventListener('pointerenter', function () {
      window.clearTimeout(chooserHoverTimer);
      window.clearTimeout(chooserCloseTimer);
      chooserHoverTimer = window.setTimeout(function () {
        if (chooserEl || win.closed) return;
        openLayoutChooser(win, { passive: true });
      }, HOVER_LAYOUT_DELAY);
    });
    maximize.addEventListener('pointerleave', function () {
      window.clearTimeout(chooserHoverTimer);
      if (chooserEl && chooserEl.classList.contains('is-hover')) scheduleChooserClose();
    });
  }

  function restoreWindowState(win, record) {
    if (!win || !record) return;
    const workspace = Number(record.workspace);
    if (isFinite(workspace)) {
      win.workspace = clamp(Math.round(workspace), 0, state.workspaces.length - 1);
    }
    win.alwaysOnTop = Boolean(record.alwaysOnTop);
    win.tiling = Boolean(record.tiling);
    win.userOverride = Boolean(record.userOverride);

    const snap = record.snap;
    if (snap && typeof snap === 'object') {
      const descriptor = Core.layout(snap.layout, state.customLayouts);
      const zone = descriptor && descriptor.zones.filter(function (item) {
        return item.id === snap.zone;
      })[0];
      const savedBounds = boundsFromRecord(snap.bounds);
      const knownZone = descriptor && (zone || snap.zone === 'maximized');
      // Generated tiling layouts (auto-grid) are not registered presets. Keep
      // their saved rectangle so a reload does not lose a valid tile.
      if (knownZone || (!descriptor && savedBounds)) {
        const bounds = knownZone
          ? (savedBounds || Core.boundsForZone(descriptor, snap.zone, getArea()))
          : savedBounds;
        if (bounds) {
          win.snap = {
            layout: descriptor ? descriptor.id : snap.layout,
            zone: snap.zone,
            groupId: typeof snap.groupId === 'string' && snap.groupId
              ? snap.groupId
              : createGroupId(),
            bounds: Core.clampBounds(bounds, getArea(), snapConstraintsOf(win)),
            floating: {
              x: record.left,
              y: record.top,
              width: record.width,
              height: record.height
            }
          };
          win.node.classList.add('wm-snapped');
          applyBounds(win, win.snap.bounds, false);
          win.snap.bounds = copyBounds({
            x: win.x, y: win.y, width: win.width, height: win.height
          });
        }
      }
    }

    updateMaximizeButton(win);
    updateWindowClasses(win);
    if (win.alwaysOnTop) win.node.style.zIndex = String(++zTop);
  }

  function snapshotState() {
    return {
      version: Core.VERSION,
      activeWorkspace: state.activeWorkspace,
      tilingEnabled: state.tilingEnabled,
      workspaces: state.workspaces.map(function (item) {
        return { id: item.id, name: item.name };
      }),
      workspaceLayouts: Object.assign({}, state.workspaceLayouts),
      customLayouts: JSON.parse(JSON.stringify(state.customLayouts)),
      rules: JSON.parse(JSON.stringify(state.rules)),
      shortcuts: Object.assign({}, state.shortcuts),
      reduceMotion: Boolean(state.reduceMotion)
    };
  }

  /* ------------------------------------------------------------------
   * Overview
   * ------------------------------------------------------------------ */
  function openOverview() {
    if (overviewEl) return;
    overviewEl = document.createElement('div');
    overviewEl.className = 'wm-overview';
    overviewEl.setAttribute('role', 'dialog');
    overviewEl.setAttribute('aria-modal', 'true');
    overviewEl.setAttribute('aria-label', 'Workspace overview');
    overviewEl.addEventListener('click', onOverviewClick);
    overviewEl.addEventListener('change', onOverviewChange);
    document.body.appendChild(overviewEl);
    refreshOverview();
    const close = overviewEl.querySelector('[data-action="wm-overview-close"]');
    if (close) close.focus({ preventScroll: true });
  }

  function closeOverview() {
    if (!overviewEl) return;
    overviewEl.removeEventListener('click', onOverviewClick);
    overviewEl.removeEventListener('change', onOverviewChange);
    overviewEl.remove();
    overviewEl = null;
  }

  function onOverviewClick(event) {
    const target = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!target) {
      const card = event.target.closest ? event.target.closest('[data-window-id]') : null;
      if (card && overviewEl && overviewEl.contains(card)) {
        const win = bridge.windows.get(card.dataset.windowId);
        if (win) {
          ensureVisible(win);
          closeOverview();
          if (bridge.focusWindow) bridge.focusWindow(win.id, true);
        }
      }
      return;
    }
    const action = target.dataset.action;
    if (action === 'wm-overview-close') closeOverview();
    else if (action === 'wm-ws-switch') switchWorkspace(Number(target.dataset.index));
    else if (action === 'wm-ws-add') addWorkspace();
    else if (action === 'wm-card-focus') {
      const win = bridge.windows.get(target.dataset.windowId);
      if (win) {
        ensureVisible(win);
        closeOverview();
        if (bridge.focusWindow) bridge.focusWindow(win.id, true);
      }
    } else if (action === 'wm-card-minimize') {
      const win = bridge.windows.get(target.dataset.windowId);
      if (win && bridge.minimizeWindow) bridge.minimizeWindow(win.id);
    } else if (action === 'wm-card-close') {
      const win = bridge.windows.get(target.dataset.windowId);
      if (win && bridge.closeWindow) bridge.closeWindow(win.id);
    } else if (action === 'wm-capture-layout') {
      captureCustomLayout();
    } else if (action === 'wm-custom-delete') {
      deleteCustomLayout(target.dataset.layoutId);
    } else if (action === 'wm-custom-apply') {
      setWorkspaceLayout(target.dataset.layoutId);
      if (!state.tilingEnabled) setTilingEnabled(true);
    } else if (action === 'wm-toggle-tiling') {
      setTilingEnabled(!state.tilingEnabled);
    }
  }

  function onOverviewChange(event) {
    const target = event.target;
    if (!target || !target.dataset) return;
    if (target.dataset.action === 'wm-ws-rename') {
      renameWorkspace(Number(target.dataset.index), target.value);
    } else if (target.dataset.action === 'wm-layout-select') {
      setWorkspaceLayout(target.value);
    } else if (target.dataset.action === 'wm-rule-float') {
      setAppRule(target.dataset.app, { floating: target.checked });
    } else if (target.dataset.action === 'wm-rule-top') {
      setAppRule(target.dataset.app, { alwaysOnTop: target.checked });
    } else if (target.dataset.action === 'wm-rule-workspace') {
      setAppRule(target.dataset.app, { workspace: target.value === '' ? null : Number(target.value) });
    } else if (target.dataset.action === 'wm-shortcut') {
      applyShortcutOverrides(target.dataset.shortcut, target.value);
    } else if (target.dataset.action === 'wm-reduce-motion') {
      state.reduceMotion = Boolean(target.checked);
      applyReducedMotion();
      persist();
    }
  }

  function refreshOverview() {
    if (!overviewEl) return;
    overviewEl.replaceChildren();

    const header = document.createElement('header');
    header.className = 'wm-overview-header';
    header.innerHTML =
      '<div><span class="wm-overview-kicker">Window manager</span>' +
      '<h2>Workspace Overview</h2></div>';

    const actions = document.createElement('div');
    actions.className = 'wm-overview-actions';
    const tiling = document.createElement('button');
    tiling.type = 'button';
    tiling.className = 'wm-overview-action' + (state.tilingEnabled ? ' is-active' : '');
    tiling.dataset.action = 'wm-toggle-tiling';
    tiling.textContent = state.tilingEnabled ? 'Tiling: on' : 'Tiling: off';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'wm-overview-action';
    add.dataset.action = 'wm-ws-add';
    add.textContent = '+ Desktop';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'wm-overview-close';
    close.dataset.action = 'wm-overview-close';
    close.setAttribute('aria-label', 'Close overview');
    close.textContent = '\u00D7';
    actions.appendChild(tiling);
    actions.appendChild(add);
    actions.appendChild(close);
    header.appendChild(actions);
    overviewEl.appendChild(header);

    const tabs = document.createElement('div');
    tabs.className = 'wm-workspace-tabs';
    state.workspaces.forEach(function (workspace, index) {
      const tab = document.createElement('div');
      tab.className = 'wm-workspace-tab' + (index === state.activeWorkspace ? ' is-active' : '');
      const switchButton = document.createElement('button');
      switchButton.type = 'button';
      switchButton.className = 'wm-workspace-switch';
      switchButton.dataset.action = 'wm-ws-switch';
      switchButton.dataset.index = String(index);
      switchButton.textContent = String(index + 1);
      const input = document.createElement('input');
      input.className = 'wm-workspace-name';
      input.type = 'text';
      input.maxLength = 32;
      input.value = workspace.name;
      input.dataset.action = 'wm-ws-rename';
      input.dataset.index = String(index);
      input.setAttribute('aria-label', 'Name for desktop ' + (index + 1));
      const count = windowsOnWorkspace(index).length;
      const badge = document.createElement('span');
      badge.className = 'wm-workspace-count';
      badge.textContent = count + ' win';
      tab.appendChild(switchButton);
      tab.appendChild(input);
      tab.appendChild(badge);
      tabs.appendChild(tab);
    });
    overviewEl.appendChild(tabs);

    const body = document.createElement('div');
    body.className = 'wm-overview-body';

    const cards = document.createElement('div');
    cards.className = 'wm-window-cards';
    const windows = windowsOnWorkspace(state.activeWorkspace);
    if (!windows.length) {
      const empty = document.createElement('p');
      empty.className = 'wm-overview-empty';
      empty.textContent = 'No windows on this desktop.';
      cards.appendChild(empty);
    }
    windows.forEach(function (win) {
      const card = document.createElement('article');
      card.className = 'wm-window-card';
      card.dataset.windowId = win.id;
      if (win.id === bridge.getActiveId()) card.classList.add('is-active');
      if (win.minimized) card.classList.add('is-minimized');
      const snapText = win.snap
        ? Core.layout(win.snap.layout, state.customLayouts)
          ? (Core.layout(win.snap.layout, state.customLayouts).name + ' \u00B7 ' + win.snap.zone)
          : win.snap.layout + ' \u00B7 ' + win.snap.zone
        : (win.maximized ? 'Maximized' : 'Floating');
      card.innerHTML =
        '<div class="wm-card-head"><span class="wm-card-icon" aria-hidden="true">' +
        escapeHtml(win.icon || '\u25A3') + '</span><strong>' +
        escapeHtml(win.title || win.id) + '</strong></div>' +
        '<p class="wm-card-state">' + escapeHtml(snapText) +
        (win.alwaysOnTop ? ' \u00B7 on top' : '') +
        (win.minimized ? ' \u00B7 minimized' : '') + '</p>' +
        '<div class="wm-card-actions">' +
        '<button type="button" data-action="wm-card-focus" data-window-id="' + escapeHtml(win.id) + '">Focus</button>' +
        '<button type="button" data-action="wm-card-minimize" data-window-id="' + escapeHtml(win.id) + '">Minimize</button>' +
        '<button type="button" data-action="wm-card-close" data-window-id="' + escapeHtml(win.id) + '">Close</button>' +
        '</div>';
      cards.appendChild(card);
    });
    body.appendChild(cards);

    const side = document.createElement('aside');
    side.className = 'wm-overview-side';

    const layoutSection = document.createElement('section');
    layoutSection.className = 'wm-overview-section';
    const layoutTitle = document.createElement('h3');
    layoutTitle.textContent = 'Desktop layout';
    const layoutSelect = document.createElement('select');
    layoutSelect.dataset.action = 'wm-layout-select';
    const currentLayout = state.workspaceLayouts[String(state.activeWorkspace)] || 'halves';
    Core.layouts().concat(state.customLayouts).forEach(function (descriptor) {
      const option = document.createElement('option');
      option.value = descriptor.id;
      option.textContent = descriptor.name;
      if (descriptor.id === currentLayout) option.selected = true;
      layoutSelect.appendChild(option);
    });
    const capture = document.createElement('button');
    capture.type = 'button';
    capture.className = 'wm-overview-button';
    capture.dataset.action = 'wm-capture-layout';
    capture.textContent = 'Capture current arrangement';
    layoutSection.appendChild(layoutTitle);
    layoutSection.appendChild(layoutSelect);
    layoutSection.appendChild(capture);

    if (state.customLayouts.length) {
      const customList = document.createElement('div');
      customList.className = 'wm-custom-layouts';
      state.customLayouts.forEach(function (descriptor) {
        const row = document.createElement('div');
        row.className = 'wm-custom-row';
        row.innerHTML = '<span>' + escapeHtml(descriptor.name) + '</span>' +
          '<button type="button" data-action="wm-custom-apply" data-layout-id="' +
          escapeHtml(descriptor.id) + '">Apply</button>' +
          '<button type="button" data-action="wm-custom-delete" data-layout-id="' +
          escapeHtml(descriptor.id) + '">Delete</button>';
        customList.appendChild(row);
      });
      layoutSection.appendChild(customList);
    }
    side.appendChild(layoutSection);

    const rulesSection = document.createElement('section');
    rulesSection.className = 'wm-overview-section';
    rulesSection.innerHTML = '<h3>Window rules <span class="wm-section-hint">new windows</span></h3>';
    const appIds = [];
    allWindows().forEach(function (win) {
      const appId = ruleAppId(win);
      if (appIds.indexOf(appId) === -1) appIds.push(appId);
    });
    if (!appIds.length) {
      const empty = document.createElement('p');
      empty.className = 'wm-overview-empty';
      empty.textContent = 'Open an app to create a rule.';
      rulesSection.appendChild(empty);
    }
    appIds.slice(0, 10).forEach(function (appId) {
      const rule = state.rules[appId] || { floating: false, alwaysOnTop: false, workspace: null };
      const row = document.createElement('div');
      row.className = 'wm-rule-row';
      const name = document.createElement('span');
      name.textContent = appId;
      const floatLabel = document.createElement('label');
      const floatInput = document.createElement('input');
      floatInput.type = 'checkbox';
      floatInput.checked = Boolean(rule.floating);
      floatInput.dataset.action = 'wm-rule-float';
      floatInput.dataset.app = appId;
      floatLabel.appendChild(floatInput);
      floatLabel.appendChild(document.createTextNode(' float'));

      const topLabel = document.createElement('label');
      const topInput = document.createElement('input');
      topInput.type = 'checkbox';
      topInput.checked = Boolean(rule.alwaysOnTop);
      topInput.dataset.action = 'wm-rule-top';
      topInput.dataset.app = appId;
      topLabel.appendChild(topInput);
      topLabel.appendChild(document.createTextNode(' top'));

      const workspaceSelect = document.createElement('select');
      workspaceSelect.dataset.action = 'wm-rule-workspace';
      workspaceSelect.dataset.app = appId;
      const any = document.createElement('option');
      any.value = '';
      any.textContent = 'any desktop';
      workspaceSelect.appendChild(any);
      state.workspaces.forEach(function (workspace, index) {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = workspace.name;
        if (rule.workspace === index) option.selected = true;
        workspaceSelect.appendChild(option);
      });

      row.appendChild(name);
      row.appendChild(floatLabel);
      row.appendChild(topLabel);
      row.appendChild(workspaceSelect);
      rulesSection.appendChild(row);
    });
    side.appendChild(rulesSection);

    const shortcutSection = document.createElement('section');
    shortcutSection.className = 'wm-overview-section';
    shortcutSection.innerHTML = '<h3>Keyboard shortcuts</h3>';
    const shortcutList = document.createElement('div');
    shortcutList.className = 'wm-shortcut-list';
    Object.keys(Core.SHORTCUT_DEFAULTS).forEach(function (action) {
      const label = document.createElement('label');
      label.className = 'wm-shortcut-row';
      const text = document.createElement('span');
      text.textContent = Core.SHORTCUT_LABELS[action] || action;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = state.shortcuts[action] || Core.SHORTCUT_DEFAULTS[action];
      input.dataset.action = 'wm-shortcut';
      input.dataset.shortcut = action;
      input.setAttribute('aria-label', (Core.SHORTCUT_LABELS[action] || action) + ' shortcut');
      label.appendChild(text);
      label.appendChild(input);
      shortcutList.appendChild(label);
    });
    shortcutSection.appendChild(shortcutList);

    const motionLabel = document.createElement('label');
    motionLabel.className = 'wm-shortcut-row';
    const motionText = document.createElement('span');
    motionText.textContent = 'Reduce motion';
    const motionInput = document.createElement('input');
    motionInput.type = 'checkbox';
    motionInput.checked = Boolean(state.reduceMotion);
    motionInput.dataset.action = 'wm-reduce-motion';
    motionLabel.appendChild(motionText);
    motionLabel.appendChild(motionInput);
    shortcutSection.appendChild(motionLabel);
    side.appendChild(shortcutSection);

    body.appendChild(side);
    overviewEl.appendChild(body);
  }

  /* ------------------------------------------------------------------
   * Shortcuts
   * ------------------------------------------------------------------ */
  function shortestWindow() {
    const list = windowsOnWorkspace(state.activeWorkspace).filter(function (win) {
      return !win.minimized;
    });
    return list.length ? list[list.length - 1] : null;
  }

  function runForActive(handler) {
    const win = activeWindow() || shortestWindow();
    if (!win) {
      toast('NO ACTIVE WINDOW', 2000);
      return false;
    }
    ensureVisible(win);
    return handler(win);
  }

  function installShortcuts() {
    const service = window.ShortcutService;
    if (!service) return;
    shortcutHandles.forEach(function (handle) {
      try { service.unregister(handle); } catch (_error) { /* already gone */ }
    });
    shortcutHandles = [];

    function add(action, handler, options) {
      options = options || {};
      const keys = state.shortcuts[action] || Core.SHORTCUT_DEFAULTS[action];
      if (!keys) return;
      try {
        const handle = service.register({
          id: 'wm.' + action,
          keys: keys,
          context: 'unlocked',
          priority: options.priority || 72,
          allowInEditable: options.allowInEditable === true,
          description: Core.SHORTCUT_LABELS[action] || action,
          handler: handler
        });
        shortcutHandles.push(handle);
      } catch (error) {
        console.warn('[ShellWM] Could not register ' + action + ' (' + keys + '):', error.message);
      }
    }

    add('snap-left', function () {
      return runForActive(function (win) {
        snapIntentForSide(win, 'left', { animate: true, assist: true });
        return true;
      });
    });
    add('snap-right', function () {
      return runForActive(function (win) {
        snapIntentForSide(win, 'right', { animate: true, assist: true });
        return true;
      });
    });
    add('snap-up', function () {
      return runForActive(function (win) {
        snapIntentForSide(win, 'maximized', { animate: true });
        return true;
      });
    });
    add('snap-down', function () {
      return runForActive(function (win) {
        snapIntentForSide(win, 'bottom', { animate: true, assist: true });
        return true;
      });
    });
    add('maximize', function () {
      return runForActive(function (win) {
        toggleMaximize(win, { animate: true });
        return true;
      });
    });
    add('minimize', function () {
      return runForActive(function (win) {
        if (bridge.minimizeWindow) bridge.minimizeWindow(win.id);
        return true;
      });
    });
    add('close', function () {
      return runForActive(function (win) {
        if (bridge.closeWindow) bridge.closeWindow(win.id);
        return true;
      });
    }, { allowInEditable: false });
    add('cycle-next', function () {
      return bridge.cycleWindow ? bridge.cycleWindow(1) : false;
    }, { priority: 68 });
    add('cycle-prev', function () {
      return bridge.cycleWindow ? bridge.cycleWindow(-1) : false;
    }, { priority: 68 });
    add('overview', function () {
      if (overviewEl) closeOverview();
      else openOverview();
      return true;
    });
    add('desktop-next', function () {
      return switchWorkspace(state.activeWorkspace + 1);
    });
    add('desktop-prev', function () {
      return switchWorkspace(state.activeWorkspace - 1);
    });
    add('move-desktop-next', function () {
      return runForActive(function (win) {
        return moveWindowToWorkspace(win, state.activeWorkspace + 1);
      });
    });
    add('move-desktop-prev', function () {
      return runForActive(function (win) {
        return moveWindowToWorkspace(win, state.activeWorkspace - 1);
      });
    });
    add('layout-chooser', function () {
      const win = activeWindow();
      if (!win) {
        toast('NO ACTIVE WINDOW', 2000);
        return false;
      }
      openLayoutChooser(win);
      return true;
    });
    add('toggle-tiling', function () {
      setTilingEnabled(!state.tilingEnabled);
      toast(state.tilingEnabled ? 'AUTOMATIC TILING ON' : 'AUTOMATIC TILING OFF', 2200);
      return true;
    });
    add('restore-group', function () {
      return runForActive(function (win) {
        if (!restoreGroupFor(win)) {
          toast('NO SNAP GROUP', 2000);
          return false;
        }
        return true;
      });
    });
    add('float', function () {
      return runForActive(function (win) {
        restoreFloating(win, true);
        return true;
      });
    });
  }

  function applyShortcutOverrides(action, value) {
    if (!action || !Object.prototype.hasOwnProperty.call(Core.SHORTCUT_DEFAULTS, action)) {
      return false;
    }
    const keys = String(value || '').trim();
    state.shortcuts[action] = keys || Core.SHORTCUT_DEFAULTS[action];
    persist();
    installShortcuts();
    if (overviewEl) refreshOverview();
    return true;
  }

  /* ------------------------------------------------------------------
   * Init / diagnostics
   * ------------------------------------------------------------------ */
  function init(options) {
    if (ready) {
      return diagnostics();
    }
    if (!options || !options.desktop || !options.windows) {
      console.error('[ShellWM] init requires desktop and windows.');
      return null;
    }
    bridge = options;
    const saved = options.savedState ||
      (window.ProfileState && window.ProfileState.windowManager) ||
      null;
    state = Core.sanitizeState(saved);

    buildChrome();
    ready = true;
    applyReducedMotion();
    installShortcuts();
    applyWorkspaceVisibility();
    allWindows().forEach(function (win) {
      onWindowRegistered(win, { restoring: true });
    });
    refreshDividers();
    return diagnostics();
  }

  function diagnostics() {
    return {
      version: VERSION,
      ready: ready,
      activeWorkspace: state.activeWorkspace,
      workspaces: state.workspaces.map(function (item) { return item.name; }),
      tilingEnabled: state.tilingEnabled,
      customLayouts: state.customLayouts.length,
      reduceMotion: reduceMotion(),
      previewVisible: Boolean(previewEl && !previewEl.hidden),
      assistOpen: Boolean(assistEl && !assistEl.hidden),
      chooserOpen: Boolean(chooserEl),
      overviewOpen: Boolean(overviewEl),
      dividers: layer ? layer.querySelectorAll('.wm-linked-divider').length : 0,
      dragging: Boolean(drag),
      linkedResizing: Boolean(dividerDrag),
      shortcuts: shortcutHandles.map(function (handle) { return handle.id; }),
      windows: allWindows().map(function (win) {
        return {
          id: win.id,
          appId: win.appId,
          workspace: workspaceOf(win),
          minimized: Boolean(win.minimized),
          maximized: Boolean(win.maximized),
          alwaysOnTop: Boolean(win.alwaysOnTop),
          tiling: Boolean(win.tiling),
          userOverride: Boolean(win.userOverride),
          snap: win.snap ? {
            layout: win.snap.layout,
            zone: win.snap.zone,
            groupId: win.snap.groupId,
            bounds: copyBounds(win.snap.bounds)
          } : null,
          bounds: copyBounds(win)
        };
      })
    };
  }

  window.ShellWM = {
    version: VERSION,
    init: init,
    get ready() { return ready; },
    get state() { return state; },
    diagnostics: diagnostics,
    snapshotState: snapshotState,
    getWorkArea: getArea,
    nextZ: function (win) {
      if (win && win.alwaysOnTop) return ++zTop;
      return ++zNormal;
    },
    onWindowRegistered: onWindowRegistered,
    restoreWindowState: restoreWindowState,
    updateWindow: function (win) {
      if (!win) return;
      updateWindowClasses(win);
      if (win.taskbarButton) {
        win.taskbarButton.hidden = workspaceOf(win) !== state.activeWorkspace;
      }
    },
    beginDrag: beginDrag,
    beginResize: beginResize,
    toggleMaximize: toggleMaximize,
    restoreFloating: restoreFloating,
    applySnap: snapToZone,
    maximizeActive: function () {
      return runForActive(function (win) { toggleMaximize(win, { animate: true }); return true; });
    },
    ensureVisible: ensureVisible,
    onDesktopResize: function () {
      allWindows().forEach(function (win) {
        if (win.snap && validBounds(win.snap.bounds)) {
          const descriptor = Core.layout(win.snap.layout, state.customLayouts);
          if (descriptor) {
            const recomputed = Core.boundsForZone(descriptor, win.snap.zone, getArea());
            if (recomputed) {
              const bounds = Core.clampBounds(recomputed, getArea(), snapConstraintsOf(win));
              bridge.setBounds(win, bounds, snapConstraintsOf(win));
              win.snap.bounds = copyBounds({
                x: win.x, y: win.y, width: win.width, height: win.height
              });
            }
          }
        } else if (win.maximized) {
          bridge.setBounds(win, getArea());
        }
      });
      refreshDividers();
      persist();
    },
    applyWorkspaceVisibility: applyWorkspaceVisibility,
    switchWorkspace: switchWorkspace,
    addWorkspace: addWorkspace,
    renameWorkspace: renameWorkspace,
    deleteWorkspace: deleteWorkspace,
    reorderWorkspace: reorderWorkspace,
    moveWindowToWorkspace: moveWindowToWorkspace,
    onWindowShown: onWindowShown,
    restoreGroupFor: restoreGroupFor,
    setTilingEnabled: setTilingEnabled,
    applyTilingWorkspace: applyTilingWorkspace,
    setWorkspaceLayout: setWorkspaceLayout,
    captureCustomLayout: captureCustomLayout,
    deleteCustomLayout: deleteCustomLayout,
    setAppRule: setAppRule,
    setAlwaysOnTop: setAlwaysOnTop,
    setShortcut: applyShortcutOverrides,
    openLayoutChooser: openLayoutChooser,
    closeLayoutChooser: closeLayoutChooser,
    openOverview: openOverview,
    closeOverview: closeOverview,
    hideSnapAssist: hideSnapAssist,
    refreshDividers: refreshDividers,
    refreshOverview: refreshOverview,
    _test: {
      state: function () { return state; },
      snapToZone: snapToZone,
      applySnap: applySnap,
      restoreWindowState: restoreWindowState,
      windowById: function (id) { return bridge && bridge.windows ? bridge.windows.get(id) : null; },
      layout: function (id) { return Core.layout(id, state.customLayouts); },
      getArea: getArea
    }
  };
})(window, document);
