/**
 * @file main/window-manager-core.js
 * @description Pure geometry, layout, snap-zone, linked-resize, and persisted
 * window-manager state helpers. This file has no DOM dependencies so the same
 * rules can be exercised by Node tests and used by the browser integration.
 *
 * PUBLIC API (window.WindowManagerCore / module.exports):
 *   workArea(rect, taskbarRect)             → usable desktop rectangle
 *   layouts(), layout(id, customLayouts)    → normalized layout descriptor
 *   boundsForZone(layout, zoneId, area)     → exact pixel bounds
 *   findSnapIntent(point, area, options)    → { layout, zone, bounds, ... } | null
 *   clampBounds(bounds, area, constraints)  → constrained bounds
 *   resizeBounds(start, dir, dx, dy, ...)   → constrained bounds
 *   linkedResize(entries, divider, delta)   → [{ id, bounds }]
 *   autoGridLayout(count)                   → generated layout descriptor
 *   captureLayout(windows, area, name, id)  → custom layout descriptor
 *   createDefaultState() / sanitizeState(raw)
 *   SHORTCUT_DEFAULTS
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WindowManagerCore = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const VERSION = 1;
  const SNAP_THRESHOLD = 22;
  const DEFAULT_MIN_WIDTH = 320;
  const DEFAULT_MIN_HEIGHT = 180;
  const MAX_WORKSPACES = 9;
  const DEFAULT_WORKSPACE_COUNT = 4;

  const LAYOUTS = [
    {
      id: 'halves',
      name: '50 / 50 split',
      zones: [
        { id: 'left', label: 'Left half', x: 0, y: 0, width: 0.5, height: 1 },
        { id: 'right', label: 'Right half', x: 0.5, y: 0, width: 0.5, height: 1 }
      ]
    },
    {
      id: 'top-bottom',
      name: 'Top / bottom',
      zones: [
        { id: 'top', label: 'Top half', x: 0, y: 0, width: 1, height: 0.5 },
        { id: 'bottom', label: 'Bottom half', x: 0, y: 0.5, width: 1, height: 0.5 }
      ]
    },
    {
      id: 'quadrants',
      name: 'Four quadrants',
      zones: [
        { id: 'top-left', label: 'Top left', x: 0, y: 0, width: 0.5, height: 0.5 },
        { id: 'top-right', label: 'Top right', x: 0.5, y: 0, width: 0.5, height: 0.5 },
        { id: 'bottom-left', label: 'Bottom left', x: 0, y: 0.5, width: 0.5, height: 0.5 },
        { id: 'bottom-right', label: 'Bottom right', x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
      ]
    },
    {
      id: 'thirds',
      name: 'Three columns',
      zones: [
        { id: 'third-left', label: 'Left third', x: 0, y: 0, width: 1 / 3, height: 1 },
        { id: 'third-center', label: 'Center third', x: 1 / 3, y: 0, width: 1 / 3, height: 1 },
        { id: 'third-right', label: 'Right third', x: 2 / 3, y: 0, width: 1 / 3, height: 1 }
      ]
    },
    {
      id: 'main-sidebar',
      name: 'Main + sidebar',
      zones: [
        { id: 'main', label: 'Main', x: 0, y: 0, width: 0.66, height: 1 },
        { id: 'sidebar', label: 'Sidebar', x: 0.66, y: 0, width: 0.34, height: 1 }
      ]
    },
    {
      id: 'asymmetric',
      name: 'Asymmetric stack',
      zones: [
        { id: 'main', label: 'Main', x: 0, y: 0, width: 0.6, height: 1 },
        { id: 'aside-top', label: 'Top right', x: 0.6, y: 0, width: 0.4, height: 0.5 },
        { id: 'aside-bottom', label: 'Bottom right', x: 0.6, y: 0.5, width: 0.4, height: 0.5 }
      ]
    },
    {
      id: 'stack',
      name: 'Split + bottom',
      zones: [
        { id: 'top', label: 'Top', x: 0, y: 0, width: 1, height: 0.55 },
        { id: 'bottom-left', label: 'Bottom left', x: 0, y: 0.55, width: 0.5, height: 0.45 },
        { id: 'bottom-right', label: 'Bottom right', x: 0.5, y: 0.55, width: 0.5, height: 0.45 }
      ]
    }
  ];

  const SHORTCUT_DEFAULTS = {
    'snap-left': 'Ctrl+Alt+ArrowLeft',
    'snap-right': 'Ctrl+Alt+ArrowRight',
    'snap-up': 'Ctrl+Alt+ArrowUp',
    'snap-down': 'Ctrl+Alt+ArrowDown',
    'maximize': 'Ctrl+Alt+M',
    'minimize': 'Ctrl+Alt+H',
    'close': 'Alt+W',
    'cycle-next': 'Alt+PageDown',
    'cycle-prev': 'Alt+PageUp',
    'overview': 'Ctrl+Alt+O',
    'desktop-next': 'Ctrl+Alt+PageDown',
    'desktop-prev': 'Ctrl+Alt+PageUp',
    'move-desktop-next': 'Ctrl+Alt+Shift+PageDown',
    'move-desktop-prev': 'Ctrl+Alt+Shift+PageUp',
    'layout-chooser': 'Ctrl+Alt+K',
    'toggle-tiling': 'Ctrl+Alt+T',
    'restore-group': 'Ctrl+Alt+G',
    'float': 'Ctrl+Alt+F'
  };

  const SHORTCUT_LABELS = {
    'snap-left': 'Snap window left',
    'snap-right': 'Snap window right',
    'snap-up': 'Maximize / snap up',
    'snap-down': 'Snap window down',
    'maximize': 'Toggle maximize',
    'minimize': 'Minimize active window',
    'close': 'Close active window',
    'cycle-next': 'Cycle to next window',
    'cycle-prev': 'Cycle to previous window',
    'overview': 'Open workspace overview',
    'desktop-next': 'Next virtual desktop',
    'desktop-prev': 'Previous virtual desktop',
    'move-desktop-next': 'Move window to next desktop',
    'move-desktop-prev': 'Move window to previous desktop',
    'layout-chooser': 'Open snap-layout chooser',
    'toggle-tiling': 'Toggle automatic tiling',
    'restore-group': 'Restore snap group',
    'float': 'Float active window'
  };

  function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function round(value) {
    return Math.round(value);
  }

  function normalizeRect(rect) {
    if (!rect) return { x: 0, y: 0, width: 0, height: 0 };
    const x = isFiniteNumber(rect.x) ? rect.x : (isFiniteNumber(rect.left) ? rect.left : 0);
    const y = isFiniteNumber(rect.y) ? rect.y : (isFiniteNumber(rect.top) ? rect.top : 0);
    const width = isFiniteNumber(rect.width) ? rect.width : Math.max(0, (rect.right || 0) - x);
    const height = isFiniteNumber(rect.height) ? rect.height : Math.max(0, (rect.bottom || 0) - y);
    return { x: x, y: y, width: Math.max(0, width), height: Math.max(0, height) };
  }

  /**
   * Returns the usable desktop rectangle. The desktop element already excludes
   * the taskbar in this shell, but the taskbar is subtracted when it overlaps
   * so future dock positions (top/left/right) keep working.
   */
  function workArea(rect, taskbarRect) {
    const area = normalizeRect(rect);
    const taskbar = taskbarRect ? normalizeRect(taskbarRect) : null;
    if (!area.width || !area.height) return area;

    let left = area.x;
    let top = area.y;
    let right = area.x + area.width;
    let bottom = area.y + area.height;

    if (taskbar && taskbar.width > 0 && taskbar.height > 0) {
      const overlapsX = taskbar.x < right && taskbar.x + taskbar.width > left;
      const overlapsY = taskbar.y < bottom && taskbar.y + taskbar.height > top;
      if (overlapsX && overlapsY) {
        // Only subtract a dock-like strip, never an arbitrary floating panel.
        const coversWidth = taskbar.width / area.width > 0.5;
        const coversHeight = taskbar.height / area.height > 0.5;
        if (coversWidth && !coversHeight) {
          if (taskbar.y <= top) top = Math.max(top, taskbar.y + taskbar.height);
          else if (taskbar.y + taskbar.height >= bottom) bottom = Math.min(bottom, taskbar.y);
        } else if (coversHeight) {
          if (taskbar.x <= left) left = Math.max(left, taskbar.x + taskbar.width);
          else if (taskbar.x + taskbar.width >= right) right = Math.min(right, taskbar.x);
        }
      }
    }

    return {
      x: round(left),
      y: round(top),
      width: Math.max(1, round(right - left)),
      height: Math.max(1, round(bottom - top))
    };
  }

  function normalizeZone(zone, index) {
    const x = clamp(isFiniteNumber(zone.x) ? zone.x : 0, 0, 1);
    const y = clamp(isFiniteNumber(zone.y) ? zone.y : 0, 0, 1);
    const width = clamp(isFiniteNumber(zone.width) ? zone.width : 0, 0, 1 - x);
    const height = clamp(isFiniteNumber(zone.height) ? zone.height : 0, 0, 1 - y);
    return {
      id: typeof zone.id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(zone.id) ? zone.id : 'zone-' + index,
      label: typeof zone.label === 'string' ? zone.label.slice(0, 48) : '',
      x: x,
      y: y,
      width: Math.max(0.001, width),
      height: Math.max(0.001, height)
    };
  }

  function normalizeLayout(layout) {
    if (!layout || typeof layout !== 'object' || !Array.isArray(layout.zones) || !layout.zones.length) {
      return null;
    }
    const zones = layout.zones.slice(0, 12).map(normalizeZone);
    return {
      id: typeof layout.id === 'string' && /^[a-z0-9_-]{1,48}$/i.test(layout.id) ? layout.id : 'custom',
      name: typeof layout.name === 'string' ? layout.name.slice(0, 48) : 'Custom layout',
      custom: Boolean(layout.custom),
      zones: zones
    };
  }

  function layouts() {
    return LAYOUTS.map(function (layout) {
      return normalizeLayout(layout);
    });
  }

  function layout(id, customLayouts) {
    const key = String(id || '');
    const builtIn = LAYOUTS.filter(function (item) { return item.id === key; })[0];
    if (builtIn) return normalizeLayout(builtIn);
    const custom = Array.isArray(customLayouts) ? customLayouts : [];
    for (let i = 0; i < custom.length; i += 1) {
      if (custom[i] && custom[i].id === key) {
        const normalized = normalizeLayout(custom[i]);
        if (normalized) normalized.custom = true;
        return normalized;
      }
    }
    return null;
  }

  /**
   * Converts a zone's fractional rectangle into exact pixel bounds. Edges use
   * shared rounding so adjacent zones never leave a one-pixel gap or overlap.
   */
  function boundsForZone(layoutDescriptor, zoneId, area) {
    const descriptor = layoutDescriptor;
    const zoneKey = zoneId;
    const usable = normalizeRect(area);
    if (!descriptor || !usable.width || !usable.height) return null;

    if (zoneKey === 'maximized' || zoneKey === 'maximize') {
      return {
        x: usable.x,
        y: usable.y,
        width: usable.width,
        height: usable.height
      };
    }

    const zone = descriptor.zones.filter(function (item) { return item.id === zoneKey; })[0];
    if (!zone) return null;

    const left = round(usable.x + zone.x * usable.width);
    const top = round(usable.y + zone.y * usable.height);
    const right = round(usable.x + (zone.x + zone.width) * usable.width);
    const bottom = round(usable.y + (zone.y + zone.height) * usable.height);
    return {
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    };
  }

  /**
   * Detects a snap intent from the pointer position. A window is not snapped
   * merely because it crossed an edge: the pointer must be within `threshold`
   * of the work-area edge (and inside the desktop).
   */
  function findSnapIntent(point, area, options) {
    options = options || {};
    const usable = normalizeRect(area);
    if (!usable.width || !usable.height || !point) return null;
    if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return null;

    const threshold = isFiniteNumber(options.threshold)
      ? Math.max(1, options.threshold)
      : SNAP_THRESHOLD;
    const right = usable.x + usable.width;
    const bottom = usable.y + usable.height;

    // Keep a small tolerance for pointer coordinates at the very edge.
    if (point.x < usable.x - threshold || point.x > right + threshold ||
        point.y < usable.y - threshold || point.y > bottom + threshold) {
      return null;
    }

    const nearLeft = point.x - usable.x <= threshold;
    const nearRight = right - point.x <= threshold;
    const nearTop = point.y - usable.y <= threshold;
    const nearBottom = bottom - point.y <= threshold;

    let layoutId = 'halves';
    let zoneId = null;
    let label = '';

    if (nearLeft && nearTop) {
      layoutId = 'quadrants';
      zoneId = 'top-left';
      label = 'Top left';
    } else if (nearRight && nearTop) {
      layoutId = 'quadrants';
      zoneId = 'top-right';
      label = 'Top right';
    } else if (nearLeft && nearBottom) {
      layoutId = 'quadrants';
      zoneId = 'bottom-left';
      label = 'Bottom left';
    } else if (nearRight && nearBottom) {
      layoutId = 'quadrants';
      zoneId = 'bottom-right';
      label = 'Bottom right';
    } else if (nearTop) {
      return {
        layout: 'halves',
        zone: 'maximized',
        maximize: true,
        label: 'Maximize',
        bounds: { x: usable.x, y: usable.y, width: usable.width, height: usable.height }
      };
    } else if (nearBottom && options.enableBottomEdge !== false) {
      layoutId = 'top-bottom';
      zoneId = 'bottom';
      label = 'Bottom half';
    } else if (nearLeft) {
      layoutId = 'halves';
      zoneId = 'left';
      label = 'Left half';
    } else if (nearRight) {
      layoutId = 'halves';
      zoneId = 'right';
      label = 'Right half';
    }

    if (!zoneId) return null;
    const descriptor = layout(layoutId);
    const bounds = boundsForZone(descriptor, zoneId, usable);
    if (!bounds) return null;

    return {
      layout: layoutId,
      zone: zoneId,
      maximize: false,
      label: label,
      bounds: bounds
    };
  }

  function clampBounds(bounds, area, constraints) {
    const usable = normalizeRect(area);
    constraints = constraints || {};
    const maxWidth = Math.min(
      isFiniteNumber(usable.width) ? usable.width : Infinity,
      isFiniteNumber(constraints.maxWidth) ? constraints.maxWidth : Infinity
    );
    const maxHeight = Math.min(
      isFiniteNumber(usable.height) ? usable.height : Infinity,
      isFiniteNumber(constraints.maxHeight) ? constraints.maxHeight : Infinity
    );
    const minWidth = Math.min(
      isFiniteNumber(constraints.minWidth) ? constraints.minWidth : DEFAULT_MIN_WIDTH,
      maxWidth
    );
    const minHeight = Math.min(
      isFiniteNumber(constraints.minHeight) ? constraints.minHeight : DEFAULT_MIN_HEIGHT,
      maxHeight
    );

    const requestedWidth = isFiniteNumber(bounds.width) ? bounds.width : minWidth;
    const requestedHeight = isFiniteNumber(bounds.height) ? bounds.height : minHeight;
    const width = clamp(requestedWidth, minWidth, maxWidth);
    const height = clamp(requestedHeight, minHeight, maxHeight);
    const x = clamp(isFiniteNumber(bounds.x) ? bounds.x : usable.x, usable.x, usable.x + usable.width - width);
    const y = clamp(isFiniteNumber(bounds.y) ? bounds.y : usable.y, usable.y, usable.y + usable.height - height);

    return {
      x: round(x),
      y: round(y),
      width: round(width),
      height: round(height)
    };
  }

  function resizeBounds(start, dir, dx, dy, area, constraints) {
    const usable = normalizeRect(area);
    constraints = constraints || {};
    const minWidth = isFiniteNumber(constraints.minWidth) ? constraints.minWidth : DEFAULT_MIN_WIDTH;
    const minHeight = isFiniteNumber(constraints.minHeight) ? constraints.minHeight : DEFAULT_MIN_HEIGHT;
    const maxWidth = Math.min(
      isFiniteNumber(constraints.maxWidth) ? constraints.maxWidth : Infinity,
      usable.width
    );
    const maxHeight = Math.min(
      isFiniteNumber(constraints.maxHeight) ? constraints.maxHeight : Infinity,
      usable.height
    );

    let left = start.x;
    let top = start.y;
    let right = start.x + start.width;
    let bottom = start.y + start.height;
    const direction = String(dir || '');

    if (direction.indexOf('w') !== -1) {
      left = clamp(start.x + dx, usable.x, right - Math.min(minWidth, maxWidth));
    } else if (direction.indexOf('e') !== -1) {
      right = clamp(start.x + start.width + dx, left + Math.min(minWidth, maxWidth), usable.x + usable.width);
    }

    if (direction.indexOf('n') !== -1) {
      top = clamp(start.y + dy, usable.y, bottom - Math.min(minHeight, maxHeight));
    } else if (direction.indexOf('s') !== -1) {
      bottom = clamp(start.y + start.height + dy, top + Math.min(minHeight, maxHeight), usable.y + usable.height);
    }

    return clampBounds({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    }, usable, constraints);
  }

  /**
   * Resizes all windows sharing a divider. `entries` are
   * [{ id, bounds, minWidth, minHeight }]; `divider` is
   * { axis: 'x'|'y', position }. Returns [{ id, bounds }].
   */
  function linkedResize(entries, divider, delta, area, constraints) {
    const usable = normalizeRect(area);
    constraints = constraints || {};
    const fallbackMinWidth = isFiniteNumber(constraints.minWidth) ? constraints.minWidth : DEFAULT_MIN_WIDTH;
    const fallbackMinHeight = isFiniteNumber(constraints.minHeight) ? constraints.minHeight : DEFAULT_MIN_HEIGHT;
    const list = Array.isArray(entries) ? entries.filter(function (entry) {
      return entry && entry.bounds && isFiniteNumber(entry.bounds.x) && isFiniteNumber(entry.bounds.y);
    }) : [];
    if (!list.length || !divider || !isFiniteNumber(divider.position)) return [];

    const axis = divider.axis === 'y' ? 'y' : 'x';
    const position = divider.position;
    const epsilon = 0.75;
    const before = [];
    const after = [];

    list.forEach(function (entry) {
      const bounds = entry.bounds;
      if (axis === 'x') {
        const right = bounds.x + bounds.width;
        if (Math.abs(right - position) <= epsilon) before.push(entry);
        else if (Math.abs(bounds.x - position) <= epsilon) after.push(entry);
      } else {
        const bottom = bounds.y + bounds.height;
        if (Math.abs(bottom - position) <= epsilon) before.push(entry);
        else if (Math.abs(bounds.y - position) <= epsilon) after.push(entry);
      }
    });

    if (!before.length || !after.length) return [];

    let groupStart = Infinity;
    let groupEnd = -Infinity;
    before.forEach(function (entry) {
      if (axis === 'x') {
        groupStart = Math.min(groupStart, entry.bounds.x);
        groupEnd = Math.max(groupEnd, entry.bounds.x + entry.bounds.width);
      } else {
        groupStart = Math.min(groupStart, entry.bounds.y);
        groupEnd = Math.max(groupEnd, entry.bounds.y + entry.bounds.height);
      }
    });
    after.forEach(function (entry) {
      if (axis === 'x') {
        groupStart = Math.min(groupStart, entry.bounds.x);
        groupEnd = Math.max(groupEnd, entry.bounds.x + entry.bounds.width);
      } else {
        groupStart = Math.min(groupStart, entry.bounds.y);
        groupEnd = Math.max(groupEnd, entry.bounds.y + entry.bounds.height);
      }
    });

    let beforeMin = 0;
    let lower = -Infinity;
    before.forEach(function (entry) {
      const min = axis === 'x'
        ? (isFiniteNumber(entry.minWidth) ? entry.minWidth : fallbackMinWidth)
        : (isFiniteNumber(entry.minHeight) ? entry.minHeight : fallbackMinHeight);
      beforeMin = Math.max(beforeMin, min);
      if (axis === 'x') {
        lower = Math.max(lower, entry.bounds.x + min);
      } else {
        lower = Math.max(lower, entry.bounds.y + min);
      }
    });
    let afterMin = 0;
    let upper = Infinity;
    after.forEach(function (entry) {
      const min = axis === 'x'
        ? (isFiniteNumber(entry.minWidth) ? entry.minWidth : fallbackMinWidth)
        : (isFiniteNumber(entry.minHeight) ? entry.minHeight : fallbackMinHeight);
      afterMin = Math.max(afterMin, min);
      if (axis === 'x') {
        upper = Math.min(upper, entry.bounds.x + entry.bounds.width - min);
      } else {
        upper = Math.min(upper, entry.bounds.y + entry.bounds.height - min);
      }
    });

    if (!isFinite(lower)) lower = groupStart + beforeMin;
    if (!isFinite(upper)) upper = groupEnd - afterMin;
    if (lower > upper) return [];
    const next = clamp(position + delta, lower, upper);

    const updates = [];
    before.forEach(function (entry) {
      const bounds = entry.bounds;
      updates.push({
        id: entry.id,
        bounds: axis === 'x'
          ? { x: bounds.x, y: bounds.y, width: next - bounds.x, height: bounds.height }
          : { x: bounds.x, y: bounds.y, width: bounds.width, height: next - bounds.y }
      });
    });
    after.forEach(function (entry) {
      const bounds = entry.bounds;
      updates.push({
        id: entry.id,
        bounds: axis === 'x'
          ? { x: next, y: bounds.y, width: (bounds.x + bounds.width) - next, height: bounds.height }
          : { x: bounds.x, y: next, width: bounds.width, height: (bounds.y + bounds.height) - next }
      });
    });

    return updates;
  }

  function autoGridLayout(count) {
    const total = clamp(Math.round(count || 2), 1, 8);
    const columns = total <= 3 ? total : (total === 4 ? 2 : Math.ceil(total / 2));
    const rows = Math.ceil(total / columns);
    const zones = [];
    let index = 0;
    for (let row = 0; row < rows; row += 1) {
      const remaining = total - index;
      const rowColumns = Math.min(columns, remaining);
      for (let column = 0; column < rowColumns; column += 1) {
        zones.push({
          id: 'auto-' + index,
          label: 'Tile ' + (index + 1),
          x: column / rowColumns,
          y: row / rows,
          width: 1 / rowColumns,
          height: 1 / rows
        });
        index += 1;
      }
      if (index >= total) break;
    }
    return normalizeLayout({
      id: 'auto-grid',
      name: total + '-window grid',
      custom: true,
      zones: zones
    });
  }

  function captureLayout(windows, area, name, id) {
    const usable = normalizeRect(area);
    if (!usable.width || !usable.height) return null;
    const list = Array.isArray(windows) ? windows.filter(function (win) {
      return win && !win.closed && win.bounds &&
        isFiniteNumber(win.bounds.x) && isFiniteNumber(win.bounds.y);
    }) : [];
    if (!list.length) return null;

    const zones = list.slice(0, 12).map(function (win, index) {
      const bounds = win.bounds;
      const x = clamp((bounds.x - usable.x) / usable.width, 0, 1);
      const y = clamp((bounds.y - usable.y) / usable.height, 0, 1);
      const right = clamp((bounds.x + bounds.width - usable.x) / usable.width, 0, 1);
      const bottom = clamp((bounds.y + bounds.height - usable.y) / usable.height, 0, 1);
      return {
        id: typeof win.id === 'string'
          ? String(win.id).replace(/[^a-z0-9_-]/gi, '-').slice(0, 40)
          : 'zone-' + index,
        label: win.title ? String(win.title).slice(0, 48) : 'Zone ' + (index + 1),
        x: x,
        y: y,
        width: Math.max(0.001, right - x),
        height: Math.max(0.001, bottom - y)
      };
    });

    return normalizeLayout({
      id: id || ('custom-' + Date.now().toString(36)),
      name: name || 'Captured layout',
      custom: true,
      zones: zones
    });
  }

  function sanitizeWorkspaceName(value, index) {
    if (typeof value === 'string') {
      const trimmed = value.trim().slice(0, 32);
      if (trimmed) return trimmed;
    }
    return 'Desktop ' + (index + 1);
  }

  function sanitizeWorkspaces(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const count = clamp(list.length || DEFAULT_WORKSPACE_COUNT, 1, MAX_WORKSPACES);
    const workspaces = [];
    for (let i = 0; i < count; i += 1) {
      workspaces.push({
        id: i,
        name: sanitizeWorkspaceName(list[i] && list[i].name, i)
      });
    }
    return workspaces;
  }

  function sanitizeRules(raw) {
    const rules = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return rules;
    Object.keys(raw).slice(0, 48).forEach(function (appId) {
      if (!/^[a-z0-9_-]{1,64}$/i.test(appId)) return;
      const source = raw[appId];
      if (!source || typeof source !== 'object' || Array.isArray(source)) return;
      rules[appId] = {
        floating: Boolean(source.floating),
        alwaysOnTop: Boolean(source.alwaysOnTop),
        workspace: isFiniteNumber(source.workspace)
          ? clamp(Math.round(source.workspace), 0, MAX_WORKSPACES - 1)
          : null
      };
    });
    return rules;
  }

  function sanitizeShortcuts(raw) {
    const shortcuts = {};
    Object.keys(SHORTCUT_DEFAULTS).forEach(function (action) {
      shortcuts[action] = SHORTCUT_DEFAULTS[action];
    });
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return shortcuts;
    Object.keys(raw).slice(0, 64).forEach(function (action) {
      if (!Object.prototype.hasOwnProperty.call(SHORTCUT_DEFAULTS, action)) return;
      if (typeof raw[action] !== 'string') return;
      const value = raw[action].trim().slice(0, 40);
      if (value) shortcuts[action] = value;
    });
    // Older development builds shipped Ctrl+Alt+L for the layout chooser,
    // which collides with the shell lock shortcut. Move it to the safe default.
    if (shortcuts['layout-chooser'] === 'Ctrl+Alt+L') {
      shortcuts['layout-chooser'] = SHORTCUT_DEFAULTS['layout-chooser'];
    }
    return shortcuts;
  }

  function sanitizeCustomLayouts(raw) {
    const result = [];
    if (!Array.isArray(raw)) return result;
    raw.slice(0, 12).forEach(function (item, index) {
      const normalized = normalizeLayout(item);
      if (!normalized) return;
      normalized.custom = true;
      normalized.id = normalized.id === 'custom' ? 'custom-' + index : normalized.id;
      normalized.name = normalized.name || ('Custom ' + (index + 1));
      result.push(normalized);
    });
    return result;
  }

  function sanitizeWorkspaceLayouts(raw) {
    const result = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
    Object.keys(raw).slice(0, MAX_WORKSPACES).forEach(function (key) {
      const index = Number(key);
      if (!isFinite(index) || index < 0 || index >= MAX_WORKSPACES) return;
      if (typeof raw[key] !== 'string') return;
      const id = raw[key].trim().slice(0, 48);
      if (/^[a-z0-9_-]+$/i.test(id)) result[String(index)] = id;
    });
    return result;
  }

  function createDefaultState() {
    return {
      version: VERSION,
      activeWorkspace: 0,
      tilingEnabled: false,
      workspaces: sanitizeWorkspaces(null),
      workspaceLayouts: {},
      customLayouts: [],
      rules: {},
      shortcuts: sanitizeShortcuts(null),
      reduceMotion: false
    };
  }

  function sanitizeState(raw) {
    const state = createDefaultState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return state;

    state.workspaces = sanitizeWorkspaces(raw.workspaces);
    const maxWorkspace = state.workspaces.length - 1;
    state.activeWorkspace = isFiniteNumber(raw.activeWorkspace)
      ? clamp(Math.round(raw.activeWorkspace), 0, maxWorkspace)
      : 0;
    state.tilingEnabled = Boolean(raw.tilingEnabled);
    state.workspaceLayouts = sanitizeWorkspaceLayouts(raw.workspaceLayouts);
    state.customLayouts = sanitizeCustomLayouts(raw.customLayouts);
    state.rules = sanitizeRules(raw.rules);
    state.shortcuts = sanitizeShortcuts(raw.shortcuts);
    state.reduceMotion = Boolean(raw.reduceMotion);
    return state;
  }

  function isLayoutKnown(id, customLayouts) {
    return Boolean(layout(id, customLayouts));
  }

  return {
    VERSION: VERSION,
    SNAP_THRESHOLD: SNAP_THRESHOLD,
    DEFAULT_MIN_WIDTH: DEFAULT_MIN_WIDTH,
    DEFAULT_MIN_HEIGHT: DEFAULT_MIN_HEIGHT,
    MAX_WORKSPACES: MAX_WORKSPACES,
    DEFAULT_WORKSPACE_COUNT: DEFAULT_WORKSPACE_COUNT,
    SHORTCUT_DEFAULTS: SHORTCUT_DEFAULTS,
    SHORTCUT_LABELS: SHORTCUT_LABELS,
    LAYOUTS: LAYOUTS,
    workArea: workArea,
    layouts: layouts,
    layout: layout,
    boundsForZone: boundsForZone,
    findSnapIntent: findSnapIntent,
    clampBounds: clampBounds,
    resizeBounds: resizeBounds,
    linkedResize: linkedResize,
    autoGridLayout: autoGridLayout,
    captureLayout: captureLayout,
    sanitizeState: sanitizeState,
    createDefaultState: createDefaultState,
    isLayoutKnown: isLayoutKnown,
    normalizeLayout: normalizeLayout
  };
});
