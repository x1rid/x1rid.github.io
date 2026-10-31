/**
 * @file main/kernel/wm-layout.js
 * @layer L3 — Kernel (layout strategy registry — no DOM)
 * @owns  window.WMLayout
 * @needs [ 'KernelEvents' ]
 * @emits [ 'wm:layout-changed' ]
 *
 * Phase 5.5 — Window Manager Layout Registry.
 * Registers named layout strategies. The shell's window-host.js queries the
 * active layout when positioning windows. DOM is never touched here — the
 * shell adapter applies the positions.
 *
 * Built-in layouts:
 *   floating — current freeform drag behavior (default)
 *   tiling   — auto-tile all windows in equal columns
 *   stacked  — maximize every window; only top one visible
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p5.5';

  const _layouts = new Map();
  let _activeId = 'floating';

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  function emit(event, payload) {
    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit(event, payload);
    }
  }

  /**
   * Register a layout strategy.
   * @param {string} id
   * @param {object} layout  { name, describe(windows, viewport) → [{ pid, x, y, w, h }] }
   */
  function register(id, layout) {
    if (!id || !layout || typeof layout.describe !== 'function') {
      throw new Error('WMLayout.register: layout must have a describe(windows, viewport) function');
    }
    _layouts.set(id, layout);
  }

  /**
   * Set the active layout and emit event.
   * @param {string} id
   */
  function setLayout(id) {
    if (!_layouts.has(id)) throw new Error('WMLayout: unknown layout "' + id + '"');
    _activeId = id;
    emit('wm:layout-changed', { layoutId: id });
  }

  /**
   * Get the active layout id.
   */
  function getActive() { return _activeId; }

  /**
   * Compute window positions for the active layout.
   * @param {Array} windows  Array of { id, pid } window descriptors
   * @param {{ w: number, h: number }} viewport  Available desktop size
   * @returns {Array<{ id, x, y, w, h }>}
   */
  function describe(windows, viewport) {
    const layout = _layouts.get(_activeId);
    if (!layout) return [];
    return layout.describe(windows, viewport);
  }

  /**
   * List registered layout ids and names.
   */
  function list() {
    const out = [];
    _layouts.forEach(function (layout, id) {
      out.push({ id: id, name: layout.name || id });
    });
    return out;
  }

  // ── Built-in layouts ─────────────────────────────────────────────────────

  register('floating', {
    name: 'Floating',
    describe: function () { return []; } // floating = no override; windows stay where dragged
  });

  register('tiling', {
    name: 'Tiling',
    describe: function (windows, viewport) {
      const vp = viewport || { w: 1280, h: 720 };
      const n = windows.length;
      if (n === 0) return [];
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const w = Math.floor(vp.w / cols);
      const h = Math.floor(vp.h / rows);
      return windows.map(function (win, i) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        return { id: win.id, x: col * w, y: row * h, w: w, h: h };
      });
    }
  });

  register('stacked', {
    name: 'Stacked',
    describe: function (windows, viewport) {
      const vp = viewport || { w: 1280, h: 720 };
      return windows.map(function (win) {
        return { id: win.id, x: 0, y: 0, w: vp.w, h: vp.h };
      });
    }
  });

  const WMLayout = Object.freeze({
    version: VERSION,
    ready: ready,
    register: register,
    setLayout: setLayout,
    getActive: getActive,
    describe: describe,
    list: list,
    diagnostics: function () {
      return { version: VERSION, activeLayout: _activeId, layoutCount: _layouts.size };
    }
  });

  root.WMLayout = WMLayout;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WMLayout: WMLayout };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
