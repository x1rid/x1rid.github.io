/**
 * @file main/shortcuts.js
 * @description Central, context-aware keyboard shortcut service for the desktop
 * shell. One capture-phase document listener dispatches registered shortcuts so
 * the shell, Explorer, Terminal, Start menu, and lock screen do not each install
 * competing global key handlers.
 *
 * Public API (window.ShortcutService):
 *   register(spec)            -> unsubscribe handle (also has .id)
 *   unregister(idOrHandle)    -> boolean
 *   setContext(name, active)  -> custom context flag for embedders/tests
 *   getContexts()             -> currently active context names
 *   diagnostics()             -> registration + conflict snapshot
 *   clear()                   -> remove every registration
 *
 * Registration spec:
 *   id          unique string (recommended; generated when omitted)
 *   keys        combo string or array of combo strings, e.g. 'Ctrl+Alt+N'
 *   context     context string or array; 'global' always matches
 *   priority    higher wins when more than one registration matches
 *   allowInEditable  allow while an input/textarea/contenteditable has focus
 *   allowWhenLocked  allow while ProfileUI reports the desktop is locked
 *   when        optional predicate (event, contexts) => boolean
 *   handler     function (event, contexts) => false to permit browser default
 *   description human-readable label for diagnostics
 *
 * Shortcut combinations use event.key names: Ctrl, Alt, Shift, Meta modifiers
 * plus Enter, Escape, Space, Tab, Backspace, Delete, Arrow*, PageUp/PageDown,
 * Home, End, F1-F12, or a single character. Browser-reserved shortcuts are
 * intentionally not registered globally. Context-specific legacy shortcuts
 * (Explorer back/forward, Terminal clear) remain scoped to their own windows.
 */
(function (window, document) {
  'use strict';

  const VERSION = '20261105';
  const MODIFIER_NAMES = ['ctrl', 'alt', 'shift', 'meta'];
  const registrations = new Map();
  const conflicts = [];
  const extraContexts = new Set();
  let nextId = 0;
  let nextSequence = 0;
  let installed = false;

  const KEY_ALIASES = {
    esc: 'escape',
    escape: 'escape',
    space: ' ',
    spacebar: ' ',
    del: 'delete',
    delete: 'delete',
    left: 'arrowleft',
    right: 'arrowright',
    up: 'arrowup',
    down: 'arrowdown',
    pageup: 'pageup',
    pagedown: 'pagedown',
    'page up': 'pageup',
    'page down': 'pagedown',
    return: 'enter',
    enter: 'enter',
    backspace: 'backspace',
    tab: 'tab'
  };

  function normalizeKeyName(value) {
    const raw = String(value == null ? '' : value).trim();
    if (raw === ' ') return ' ';
    if (!raw) return '';
    const lower = raw.toLowerCase();
    return KEY_ALIASES[lower] || lower;
  }

  function comboLabel(combo) {
    const parts = [];
    if (combo.ctrl) parts.push('Ctrl');
    if (combo.alt) parts.push('Alt');
    if (combo.shift) parts.push('Shift');
    if (combo.meta) parts.push('Meta');
    if (combo.key === ' ') parts.push('Space');
    else if (combo.key.length === 1) parts.push(combo.key.toUpperCase());
    else if (combo.key.indexOf('arrow') === 0) parts.push('Arrow' + combo.key.slice(5).charAt(0).toUpperCase() + combo.key.slice(6));
    else parts.push(combo.key.charAt(0).toUpperCase() + combo.key.slice(1));
    return parts.join('+');
  }

  function parseCombo(value) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError('Shortcut keys must be a non-empty string');
    }

    const pieces = value.split('+').map((piece) => piece.trim()).filter(Boolean);
    if (!pieces.length) {
      throw new TypeError('Shortcut keys must include a key');
    }

    const combo = {
      key: normalizeKeyName(pieces.pop()),
      ctrl: false,
      alt: false,
      shift: false,
      meta: false
    };
    if (!combo.key) {
      throw new TypeError('Shortcut keys must include a key');
    }

    pieces.forEach((piece) => {
      const modifier = piece.toLowerCase();
      if (modifier === 'ctrl' || modifier === 'control') combo.ctrl = true;
      else if (modifier === 'alt' || modifier === 'option') combo.alt = true;
      else if (modifier === 'shift') combo.shift = true;
      else if (modifier === 'meta' || modifier === 'cmd' || modifier === 'win' || modifier === 'command') combo.meta = true;
      else throw new TypeError('Unknown shortcut modifier: ' + piece);
    });

    combo.label = comboLabel(combo);
    return combo;
  }

  function normalizeKeys(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    const combos = list.filter((key) => typeof key === 'string' && key.trim()).map(parseCombo);
    if (!combos.length) {
      throw new TypeError('Shortcut must include at least one key combination');
    }
    return combos;
  }

  function normalizeContexts(context) {
    const list = Array.isArray(context) ? context : [context];
    const clean = list
      .filter((name) => typeof name === 'string' && name.trim())
      .map((name) => name.trim());
    return clean.length ? Array.from(new Set(clean)) : ['global'];
  }

  function isEditableElement(element) {
    if (!element || element.nodeType !== 1) return false;
    if (element.isContentEditable) return true;

    const tag = element.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = String(element.type || 'text').toLowerCase();
      return ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].indexOf(type) === -1;
    }

    const editableParent = element.closest && element.closest('[contenteditable=""], [contenteditable="true"], [role="textbox"]');
    return !!editableParent;
  }

  function isLocked() {
    // The legacy shell has no lock overlay. ProfileUI may still report a locked
    // owner session there, but there is nothing to unlock, so shortcuts should
    // keep working.
    if (!document.getElementById('lock-screen')) return false;
    return !!(window.ProfileUI &&
      typeof window.ProfileUI.isLocked === 'function' &&
      window.ProfileUI.isLocked());
  }

  function focusedElement(event) {
    if (event && event.target && event.target.nodeType === 1) return event.target;
    return document.activeElement;
  }

  function collectContexts(event) {
    const contexts = new Set(['global']);
    const focus = focusedElement(event);
    const editable = isEditableElement(focus);
    if (editable) contexts.add('editable');

    if (isLocked()) {
      contexts.add('locked');
      return contexts;
    }

    contexts.add('unlocked');

    const startMenu = document.getElementById('start-menu');
    if (startMenu && !startMenu.hidden) contexts.add('start');

    const active = document.body && document.body.dataset ? document.body.dataset.activeWindow : '';
    if (active && active !== 'none' && active !== 'start') {
      contexts.add('window');
      if (active === 'explorer') contexts.add('explorer');
      else if (active.indexOf('terminal') === 0) contexts.add('terminal');
      else contexts.add('app');
    }

    const focusedWindow = focus && focus.closest ? focus.closest('.window') : null;
    if (focusedWindow) {
      contexts.add('window');
      if (focusedWindow.id === 'explorer') contexts.add('explorer');
      else if (focusedWindow.id.indexOf('terminal') === 0) contexts.add('terminal');
      else contexts.add('app');
    }

    extraContexts.forEach((name) => contexts.add(name));
    return contexts;
  }

  function combosEqual(a, b) {
    return a.key === b.key &&
      a.ctrl === b.ctrl &&
      a.alt === b.alt &&
      a.shift === b.shift &&
      a.meta === b.meta;
  }

  function contextsOverlap(a, b) {
    if (a.indexOf('global') !== -1 || b.indexOf('global') !== -1) return true;
    return a.some((name) => b.indexOf(name) !== -1);
  }

  function comboMatches(event, combo) {
    if (normalizeKeyName(event.key) !== combo.key) return false;
    return !!event.ctrlKey === combo.ctrl &&
      !!event.altKey === combo.alt &&
      !!event.shiftKey === combo.shift &&
      !!event.metaKey === combo.meta;
  }

  function findConflicts(registration) {
    const found = [];
    registrations.forEach((other) => {
      if (!contextsOverlap(registration.contexts, other.contexts)) return;
      registration.combos.forEach((combo) => {
        other.combos.forEach((otherCombo) => {
          if (!combosEqual(combo, otherCombo)) return;
          found.push({
            combo: combo.label,
            id: registration.id,
            conflictsWith: other.id,
            contexts: registration.contexts.slice()
          });
        });
      });
    });
    return found;
  }

  function register(spec) {
    if (!spec || typeof spec !== 'object') {
      throw new TypeError('Shortcut registration must be an object');
    }
    if (typeof spec.handler !== 'function') {
      throw new TypeError('Shortcut registration requires a handler function');
    }

    const id = spec.id != null && String(spec.id).trim()
      ? String(spec.id).trim()
      : 'shortcut-' + (++nextId);
    if (registrations.has(id)) {
      throw new Error('Shortcut already registered: ' + id);
    }

    const registration = {
      id,
      combos: normalizeKeys(spec.keys),
      contexts: normalizeContexts(spec.context),
      priority: Number.isFinite(Number(spec.priority)) ? Number(spec.priority) : 0,
      allowInEditable: spec.allowInEditable === true,
      allowWhenLocked: spec.allowWhenLocked === true,
      repeat: spec.repeat === true,
      when: typeof spec.when === 'function' ? spec.when : null,
      handler: spec.handler,
      description: spec.description ? String(spec.description) : '',
      sequence: ++nextSequence
    };

    const found = findConflicts(registration);
    registrations.set(id, registration);
    if (found.length) {
      found.forEach((conflict) => {
        conflicts.push(conflict);
        if (window.console && typeof console.warn === 'function') {
          console.warn('[ShortcutService] Conflict: ' + conflict.combo +
            ' is registered by "' + conflict.conflictsWith + '" and "' + conflict.id + '"');
        }
      });
    }

    const handle = function unsubscribeShortcut() {
      return unregister(id);
    };
    handle.id = id;
    handle.dispose = handle;
    return handle;
  }

  function unregister(ref) {
    const id = typeof ref === 'string' ? ref : ref && ref.id;
    if (!id || !registrations.has(id)) return false;
    registrations.delete(id);
    for (let i = conflicts.length - 1; i >= 0; i -= 1) {
      if (conflicts[i].id === id || conflicts[i].conflictsWith === id) conflicts.splice(i, 1);
    }
    return true;
  }

  function setContext(name, active) {
    const context = String(name == null ? '' : name).trim();
    if (!context) return false;
    if (active) extraContexts.add(context);
    else extraContexts.delete(context);
    return true;
  }

  function getContexts() {
    return Array.from(collectContexts(null)).sort();
  }

  function diagnostics() {
    return {
      version: VERSION,
      contexts: getContexts(),
      registrations: Array.from(registrations.values()).map((registration) => ({
        id: registration.id,
        keys: registration.combos.map((combo) => combo.label),
        contexts: registration.contexts.slice(),
        priority: registration.priority,
        allowInEditable: registration.allowInEditable,
        allowWhenLocked: registration.allowWhenLocked,
        repeat: registration.repeat,
        description: registration.description
      })),
      conflicts: conflicts.map((conflict) => ({
        combo: conflict.combo,
        id: conflict.id,
        conflictsWith: conflict.conflictsWith,
        contexts: conflict.contexts.slice()
      }))
    };
  }

  function clear() {
    registrations.clear();
    conflicts.length = 0;
  }

  function handleKeyDown(event) {
    if (!event || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;

    const contexts = collectContexts(event);
    const locked = contexts.has('locked');
    const editable = contexts.has('editable');
    const matches = [];

    registrations.forEach((registration) => {
      if (locked && !registration.allowWhenLocked) return;
      if (editable && !registration.allowInEditable) return;
      if (!registration.contexts.some((name) => contexts.has(name))) return;
      if (registration.when) {
        let allowed = false;
        try {
          allowed = !!registration.when(event, contexts);
        } catch (error) {
          console.warn('[ShortcutService] when() failed for ' + registration.id + ':', error);
        }
        if (!allowed) return;
      }
      if (!registration.combos.some((combo) => comboMatches(event, combo))) return;
      if (event.repeat && registration.repeat !== true) return;
      matches.push(registration);
    });

    if (!matches.length) return;
    matches.sort((a, b) => (b.priority - a.priority) || (a.sequence - b.sequence));

    const registration = matches[0];
    let result;
    try {
      result = registration.handler(event, contexts);
    } catch (error) {
      console.error('[ShortcutService] Handler failed for ' + registration.id + ':', error);
      event.preventDefault();
      return;
    }
    if (result !== false) event.preventDefault();
  }

  function install() {
    if (installed) return;
    document.addEventListener('keydown', handleKeyDown, true);
    installed = true;
  }

  install();

  window.ShortcutService = {
    version: VERSION,
    register,
    unregister,
    setContext,
    getContexts,
    diagnostics,
    clear,
    isEditableElement
  };
})(window, document);
