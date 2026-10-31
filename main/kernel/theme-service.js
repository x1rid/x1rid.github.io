/**
 * @file main/kernel/theme-service.js
 * @layer L3 — Kernel
 * @owns  window.ThemeService
 * @needs [ 'KernelDB', 'KernelEvents' ]
 * @emits [ 'theme:changed' ]
 *
 * Phase 5.4 — OS Theming Engine.
 * Swaps CSS custom properties on :root to apply a theme.
 * Persists choice to KernelDB store `user_prefs`.
 * Themes are loaded from main/themes/<id>.json via fetch.
 *
 * Node-loadable for unit testing (DOM ops are guarded).
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p5.4';
  const STORE = 'user_prefs';
  const PREF_KEY = 'activeTheme';

  const BUILTIN_IDS = ['default', 'dark', 'hacker', 'win95', 'macos'];

  // Inline theme definitions (fallback when fetch is unavailable)
  const BUILTIN_THEMES = {
    default: { id: 'default', name: 'Default', vars: {} },
    dark: { id: 'dark', name: 'Dark', vars: { '--os-bg': '#0a0a0a', '--os-surface': '#111', '--os-accent': '#6c63ff', '--os-text': '#e0e0e0', '--os-border': '#222' } },
    hacker: { id: 'hacker', name: 'Hacker', vars: { '--os-bg': '#000', '--os-surface': '#001100', '--os-accent': '#00ff41', '--os-text': '#00ff41', '--os-border': '#003300' } },
    win95: { id: 'win95', name: 'Windows 95', vars: { '--os-bg': '#008080', '--os-surface': '#c0c0c0', '--os-accent': '#000080', '--os-text': '#000', '--os-border': '#808080' } },
    macos: { id: 'macos', name: 'macOS', vars: { '--os-bg': '#1e1e2e', '--os-surface': '#2a2a3e', '--os-accent': '#007aff', '--os-text': '#f5f5f7', '--os-border': '#3a3a4e' } }
  };

  let _activeId = 'default';

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  function emit(event, payload) {
    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit(event, payload);
    }
  }

  function _applyVars(vars) {
    if (typeof document === 'undefined') return;
    const style = document.documentElement.style;
    // First, clear known theme vars
    BUILTIN_IDS.forEach(function (id) {
      const theme = BUILTIN_THEMES[id];
      if (theme) Object.keys(theme.vars).forEach(function (k) { style.removeProperty(k); });
    });
    // Apply new vars
    Object.keys(vars).forEach(function (k) { style.setProperty(k, vars[k]); });
  }

  async function _loadTheme(id) {
    if (BUILTIN_THEMES[id]) return BUILTIN_THEMES[id];
    // Try fetch from themes/<id>.json
    if (typeof fetch !== 'undefined') {
      try {
        const res = await fetch('./themes/' + id + '.json');
        if (res.ok) return res.json();
      } catch (e) { /* fallback */ }
    }
    return BUILTIN_THEMES.default;
  }

  async function _persistTheme(id) {
    if (root.KernelDB && typeof root.KernelDB.put === 'function') {
      try {
        await root.KernelDB.put(STORE, { id: PREF_KEY, value: id, schemaVersion: 1 });
      } catch (e) { /* ok */ }
    }
  }

  async function _loadPersistedTheme() {
    if (root.KernelDB && typeof root.KernelDB.get === 'function') {
      try {
        const rec = await root.KernelDB.get(STORE, PREF_KEY);
        if (rec && rec.value) return rec.value;
      } catch (e) { /* ok */ }
    }
    return 'default';
  }

  /**
   * Apply a theme by id.
   * @param {string} id
   */
  async function apply(id) {
    const theme = await _loadTheme(id);
    _applyVars(theme.vars || {});
    _activeId = id;
    await _persistTheme(id);
    emit('theme:changed', { themeId: id, name: theme.name });
    return theme;
  }

  /**
   * Get list of built-in theme descriptors.
   */
  function list() {
    return BUILTIN_IDS.map(function (id) {
      const t = BUILTIN_THEMES[id] || { id: id, name: id };
      return { id: t.id, name: t.name };
    });
  }

  /**
   * Get active theme id.
   */
  function getActive() { return _activeId; }

  // Boot: restore persisted theme
  if (typeof window !== 'undefined') {
    window.addEventListener('load', function () {
      _loadPersistedTheme().then(function (id) { apply(id); });
    });
  }

  const ThemeService = Object.freeze({
    version: VERSION,
    ready: ready,
    apply: apply,
    list: list,
    getActive: getActive,
    diagnostics: function () {
      return { version: VERSION, activeTheme: _activeId, builtinCount: BUILTIN_IDS.length };
    }
  });

  root.ThemeService = ThemeService;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ThemeService: ThemeService };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
