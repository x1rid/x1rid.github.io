#!/usr/bin/env node
/**
 * Zero-dependency tests for the window-manager core geometry, snap zones,
 * linked resizing, persisted state validation, and window-state serialization.
 * Run: node tests/window-manager.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const Core = require(path.join(ROOT, 'main/window-manager-core.js'));

let passed = 0;
let failed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) {
    passed += 1;
    console.log('ok   ' + label);
  } else {
    failed += 1;
    failures.push(label);
    console.log('FAIL ' + label);
  }
}

function equal(actual, expected, label) {
  ok(actual === expected, label + ' (expected "' + expected + '", got "' + actual + '")');
}

function near(actual, expected, label, epsilon) {
  const tolerance = epsilon == null ? 1 : epsilon;
  ok(Math.abs(actual - expected) <= tolerance,
    label + ' (expected ~' + expected + ', got ' + actual + ')');
}

function sameBounds(actual, expected, label) {
  ok(actual &&
    actual.x === expected.x && actual.y === expected.y &&
    actual.width === expected.width && actual.height === expected.height,
    label + ' (' + JSON.stringify(actual) + ' vs ' + JSON.stringify(expected) + ')');
}

const AREA = { x: 0, y: 0, width: 1200, height: 800 };

function geometryTests() {
  const halves = Core.layout('halves');
  const left = Core.boundsForZone(halves, 'left', AREA);
  const right = Core.boundsForZone(halves, 'right', AREA);
  sameBounds(left, { x: 0, y: 0, width: 600, height: 800 }, 'left half bounds');
  sameBounds(right, { x: 600, y: 0, width: 600, height: 800 }, 'right half bounds');
  equal(left.x + left.width, right.x, 'adjacent halves share an exact edge');

  const quadrants = Core.layout('quadrants');
  const tl = Core.boundsForZone(quadrants, 'top-left', AREA);
  const tr = Core.boundsForZone(quadrants, 'top-right', AREA);
  const bl = Core.boundsForZone(quadrants, 'bottom-left', AREA);
  const br = Core.boundsForZone(quadrants, 'bottom-right', AREA);
  sameBounds(tl, { x: 0, y: 0, width: 600, height: 400 }, 'top-left quadrant');
  sameBounds(br, { x: 600, y: 400, width: 600, height: 400 }, 'bottom-right quadrant');
  equal(tr.x + tr.width, AREA.width, 'quadrants cover the right edge');
  equal(bl.y + bl.height, AREA.height, 'quadrants cover the bottom edge');

  const thirds = Core.layout('thirds');
  const thirdLeft = Core.boundsForZone(thirds, 'third-left', AREA);
  const thirdCenter = Core.boundsForZone(thirds, 'third-center', AREA);
  const thirdRight = Core.boundsForZone(thirds, 'third-right', AREA);
  equal(thirdLeft.x + thirdLeft.width, thirdCenter.x, 'three columns share left edge');
  equal(thirdCenter.x + thirdCenter.width, thirdRight.x, 'three columns share right edge');
  equal(thirdRight.x + thirdRight.width, AREA.width, 'three columns fill the work area');
}

function snapTests() {
  const center = Core.findSnapIntent({ x: 600, y: 400 }, AREA);
  equal(center, null, 'center pointer does not snap');

  const justInside = Core.findSnapIntent({ x: 30, y: 400 }, AREA);
  equal(justInside, null, 'pointer outside threshold does not snap');

  const left = Core.findSnapIntent({ x: 12, y: 400 }, AREA);
  ok(left && left.zone === 'left', 'left edge produces left-half intent');
  const leftBounds = Core.boundsForZone(Core.layout(left.layout), left.zone, AREA);
  sameBounds(left.bounds, leftBounds, 'drag preview matches final left-half bounds');

  const top = Core.findSnapIntent({ x: 600, y: 8 }, AREA);
  ok(top && top.maximize === true, 'top edge produces maximize intent');
  sameBounds(top.bounds, AREA, 'top edge preview fills the work area');

  const corner = Core.findSnapIntent({ x: 10, y: 10 }, AREA);
  ok(corner && corner.zone === 'top-left', 'top-left corner produces quarter intent');

  const bottomRight = Core.findSnapIntent({ x: 1190, y: 790 }, AREA);
  ok(bottomRight && bottomRight.zone === 'bottom-right', 'bottom-right corner produces quarter intent');

  const bottom = Core.findSnapIntent({ x: 600, y: 795 }, AREA);
  ok(bottom && bottom.zone === 'bottom', 'bottom edge produces bottom-half intent');

  const disabledBottom = Core.findSnapIntent({ x: 600, y: 795 }, AREA, { enableBottomEdge: false });
  equal(disabledBottom, null, 'bottom-half snapping can be disabled');

  const threshold = Core.findSnapIntent({ x: 22, y: 400 }, AREA);
  ok(threshold && threshold.zone === 'left', 'pointer exactly at the threshold snaps');
}

function boundsTests() {
  const clamped = Core.clampBounds(
    { x: -100, y: -100, width: 100, height: 100 },
    AREA,
    { minWidth: 320, minHeight: 200 }
  );
  sameBounds(clamped, { x: 0, y: 0, width: 320, height: 200 }, 'bounds are clamped to minimums and work area');

  const tooLarge = Core.clampBounds(
    { x: 0, y: 0, width: 5000, height: 5000 },
    AREA,
    { maxWidth: 900, maxHeight: 700 }
  );
  equal(tooLarge.width, 900, 'maximum width is respected');
  equal(tooLarge.height, 700, 'maximum height is respected');

  const resized = Core.resizeBounds(
    { x: 100, y: 100, width: 500, height: 400 },
    'w',
    900,
    0,
    AREA,
    { minWidth: 320, minHeight: 200 }
  );
  equal(resized.width, 320, 'west resize respects minimum width');
  equal(resized.x, 280, 'west resize stops at minimum width');
}

function linkedResizeTests() {
  const entries = [
    { id: 'left', bounds: { x: 0, y: 0, width: 600, height: 800 }, minWidth: 320 },
    { id: 'right', bounds: { x: 600, y: 0, width: 600, height: 800 }, minWidth: 320 }
  ];

  const updates = Core.linkedResize(entries, { axis: 'x', position: 600 }, 100, AREA, {});
  equal(updates.length, 2, 'linked resize updates both neighbours');
  const leftUpdate = updates.filter((item) => item.id === 'left')[0];
  const rightUpdate = updates.filter((item) => item.id === 'right')[0];
  equal(leftUpdate.bounds.width, 700, 'left window grows with the divider');
  equal(rightUpdate.bounds.x, 700, 'right window starts at the new divider');
  equal(rightUpdate.bounds.width, 500, 'right window shrinks with the divider');
  equal(leftUpdate.bounds.x + leftUpdate.bounds.width, rightUpdate.bounds.x,
    'linked resize keeps a shared edge');

  const extreme = Core.linkedResize(entries, { axis: 'x', position: 600 }, 900, AREA, {});
  const extremeLeft = extreme.filter((item) => item.id === 'left')[0];
  const extremeRight = extreme.filter((item) => item.id === 'right')[0];
  equal(extremeRight.bounds.width, 320, 'linked resize respects the right minimum width');
  equal(extremeLeft.bounds.width, 880, 'linked resize preserves overall group bounds');

  const horizontal = [
    { id: 'top', bounds: { x: 0, y: 0, width: 800, height: 400 }, minHeight: 200 },
    { id: 'bottom', bounds: { x: 0, y: 400, width: 800, height: 400 }, minHeight: 200 }
  ];
  const tall = Core.linkedResize(horizontal, { axis: 'y', position: 400 }, 300, AREA, {});
  const bottom = tall.filter((item) => item.id === 'bottom')[0];
  equal(bottom.bounds.height, 200, 'horizontal linked resize respects minimum height');
}

function layoutTests() {
  const captured = Core.captureLayout([
    { id: 'a', title: 'A', bounds: { x: 0, y: 0, width: 600, height: 800 } },
    { id: 'b', title: 'B', bounds: { x: 600, y: 0, width: 600, height: 800 } }
  ], AREA, 'Captured');
  ok(captured && captured.id.indexOf('custom-') === 0, 'capture creates a custom layout');
  equal(captured.zones.length, 2, 'captured layout keeps every zone');
  near(captured.zones[1].x, 0.5, 'captured zone is normalized relative to the work area', 0.001);

  const grid = Core.autoGridLayout(5);
  ok(grid && grid.zones.length === 5, 'auto grid generates a zone per window');
  equal(grid.zones[4].y, 0.5, 'auto grid wraps into rows');

  const state = Core.sanitizeState({
    activeWorkspace: 99,
    workspaces: [{ name: 'Main' }, { name: '  ' }],
    tilingEnabled: true,
    workspaceLayouts: { 0: 'thirds', bogus: 'halves' },
    customLayouts: [{ id: 'custom-a', name: 'A', zones: [{ id: 'one', x: 0, y: 0, width: 0.5, height: 1 }] }],
    rules: { terminal: { floating: true, workspace: 3 }, 'bad app': { floating: true } },
    shortcuts: { 'snap-left': 'Ctrl+Alt+K', bogus: 'Ctrl+X' },
    reduceMotion: true
  });
  equal(state.activeWorkspace, 1, 'active workspace is clamped to available desktops');
  equal(state.workspaces[1].name, 'Desktop 2', 'blank workspace names fall back');
  equal(state.workspaceLayouts['0'], 'thirds', 'workspace layout persists');
  equal(state.customLayouts.length, 1, 'custom layout persists');
  equal(state.rules.terminal.floating, true, 'app rule persists');
  ok(!state.rules['bad app'], 'invalid app rule ids are dropped');
  equal(state.shortcuts['snap-left'], 'Ctrl+Alt+K', 'shortcut override persists');
  equal(state.shortcuts['snap-right'], Core.SHORTCUT_DEFAULTS['snap-right'],
    'missing shortcuts fall back to defaults');
  const migrated = Core.sanitizeState({ shortcuts: { 'layout-chooser': 'Ctrl+Alt+L' } });
  equal(migrated.shortcuts['layout-chooser'], Core.SHORTCUT_DEFAULTS['layout-chooser'],
    'legacy layout chooser shortcut migrates off the lock shortcut');
  equal(state.reduceMotion, true, 'reduced-motion preference persists');

  const corrupt = Core.sanitizeState({ workspaces: 'nope', rules: [], customLayouts: {} });
  equal(corrupt.workspaces.length, Core.DEFAULT_WORKSPACE_COUNT,
    'corrupt workspace state falls back to defaults');
}

function createEnvironment() {
  const store = new Map();
  const session = new Map();

  class MemoryProfileDB {
    async init() { return this; }
    async getProfile(id) { return store.get(id) || null; }
    async getAllProfiles() { return Array.from(store.values()); }
    async putProfile(profile) { store.set(profile.id, JSON.parse(JSON.stringify(profile))); return profile; }
    async deleteProfile(id) { return store.delete(id); }
    async getState() { return null; }
    async putState() { return null; }
    async getSystemConfig() { return null; }
    async putSystemConfig() { return null; }
  }

  const documentStub = {
    dispatchEvent() { return true; },
    getElementById() { return null; },
    addEventListener() {}
  };

  const windowStub = {
    ProfileDB: MemoryProfileDB,
    crypto: nodeCrypto.webcrypto,
    TextEncoder,
    TextDecoder,
    btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
    atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
    setTimeout,
    clearTimeout,
    console,
    location: { reload() {} },
    sessionStorage: {
      getItem(key) { return session.has(key) ? session.get(key) : null; },
      setItem(key, value) { session.set(key, String(value)); },
      removeItem(key) { session.delete(key); }
    },
    localStorage: {
      getItem() { return null; },
      setItem() {}
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    }
  };
  windowStub.window = windowStub;

  const context = vm.createContext({
    window: windowStub,
    document: documentStub,
    globalThis: windowStub,
    console,
    CustomEvent: windowStub.CustomEvent,
    TextEncoder,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Promise,
    Map,
    Set
  });

  function load(relative) {
    const file = path.join(ROOT, relative);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: relative });
  }

  return { window: windowStub, store, session, load };
}

async function persistenceTests() {
  const env = createEnvironment();
  env.load('main/profile/profile-service.js');
  env.load('main/profile/persistence-service.js');
  await env.window.ProfileService.init();
  const service = env.window.PersistenceService;

  equal(service.STATE_VERSION, 4, 'persistence schema version advanced for window-manager state');

  const validated = service.validateState({
    windows: {
      explorer: {
        appId: 'explorer',
        left: 40, top: 50, width: 800, height: 500,
        maximized: false, minimized: false,
        workspace: 2,
        alwaysOnTop: true,
        tiling: false,
        userOverride: true,
        snap: {
          layout: 'quadrants',
          zone: 'top-left',
          groupId: 'wg-test',
          bounds: { left: 0, top: 0, width: 600, height: 400 }
        }
      },
      terminal: {
        appId: 'terminal',
        left: 20, top: 20, width: 400, height: 300,
        snap: { layout: 'not a valid layout!', zone: 'left' }
      }
    },
    windowManager: {
      activeWorkspace: 7,
      tilingEnabled: true,
      workspaces: [{ name: 'Main' }, { name: 'Build' }],
      workspaceLayouts: { 1: 'thirds', bogus: 'halves' },
      customLayouts: [{
        id: 'custom-a',
        name: 'Pair',
        zones: [{ id: 'left', x: 0, y: 0, width: 0.5, height: 1 }]
      }],
      rules: {
        terminal: { floating: true, alwaysOnTop: false, workspace: 1 },
        'bad app!': { floating: true }
      },
      shortcuts: {
        'snap-left': 'Ctrl+Alt+K',
        'bad action': 'Ctrl+X'
      },
      reduceMotion: true
    }
  });

  equal(validated.schemaVersion, 4, 'validated state uses the current schema version');
  equal(validated.windows.explorer.workspace, 2, 'window workspace persists');
  equal(validated.windows.explorer.alwaysOnTop, true, 'always-on-top persists');
  equal(validated.windows.explorer.snap.layout, 'quadrants', 'snap layout persists');
  equal(validated.windows.explorer.snap.zone, 'top-left', 'snap zone persists');
  equal(validated.windows.explorer.snap.groupId, 'wg-test', 'snap group id persists');
  equal(validated.windows.explorer.snap.bounds.width, 600, 'linked snap bounds persist');
  equal(validated.windows.terminal.snap, null, 'invalid snap layout is dropped without losing the window');

  equal(validated.windowManager.activeWorkspace, 1,
    'saved active workspace is clamped to the saved desktop list');
  equal(validated.windowManager.tilingEnabled, true, 'tiling mode persists');
  equal(validated.windowManager.workspaces[1].name, 'Build', 'workspace names persist');
  equal(validated.windowManager.workspaceLayouts['1'], 'thirds', 'per-desktop layout persists');
  equal(validated.windowManager.customLayouts.length, 1, 'custom tiling layout persists');
  equal(validated.windowManager.rules.terminal.floating, true, 'app rule persists');
  ok(!validated.windowManager.rules['bad app!'], 'invalid app rule is dropped');
  equal(validated.windowManager.shortcuts['snap-left'], 'Ctrl+Alt+K',
    'shortcut override persists');
  ok(!validated.windowManager.shortcuts['bad action'], 'unknown shortcut action is dropped');
  equal(validated.windowManager.reduceMotion, true, 'reduced-motion setting persists');

  const corrupt = service.validateState({
    windows: { explorer: { appId: 'explorer', left: 'nope', top: {}, width: null, height: [] } },
    windowManager: { workspaces: 'broken', customLayouts: 'nope', rules: 12 }
  });
  ok(corrupt.windows.explorer, 'corrupt geometry still restores a safe window record');
  equal(corrupt.windows.explorer.left, 0, 'corrupt geometry falls back to safe numbers');
  equal(corrupt.windowManager.workspaces.length, 4, 'corrupt workspace list falls back');
  equal(corrupt.windowManager.customLayouts.length, 0, 'corrupt custom layouts fall back');
}

function windowStateTests() {
  const env = createEnvironment();
  env.load('main/profile/window-state.js');
  const api = env.window.ProfileWindowState;
  const windows = new Map();

  windows.set('explorer', {
    id: 'explorer', appId: 'explorer', closed: false,
    x: 100, y: 80, width: 700, height: 500,
    maximized: false, minimized: false,
    workspace: 1, alwaysOnTop: true, tiling: false, userOverride: true,
    snap: {
      layout: 'halves', zone: 'left', groupId: 'wg-1',
      bounds: { x: 0, y: 0, width: 600, height: 800 },
      floating: { x: 100, y: 80, width: 700, height: 500 }
    }
  });
  windows.set('terminal-1', {
    id: 'terminal-1', appId: 'terminal', closed: false,
    x: 20, y: 20, width: 400, height: 300,
    maximized: true, minimized: false,
    previousBounds: { x: 30, y: 40, width: 420, height: 320 },
    workspace: 0
  });

  const snapshot = api.snapshot(windows);
  equal(snapshot.explorer.workspace, 1, 'window snapshot persists workspace');
  equal(snapshot.explorer.alwaysOnTop, true, 'window snapshot persists always-on-top');
  equal(snapshot.explorer.snap.layout, 'halves', 'window snapshot persists snap layout');
  equal(snapshot.explorer.snap.zone, 'left', 'window snapshot persists snap zone');
  equal(snapshot.explorer.snap.groupId, 'wg-1', 'window snapshot persists snap group');
  equal(snapshot.explorer.snap.bounds.width, 600, 'window snapshot persists snap bounds');
  equal(snapshot.explorer.left, 100, 'snapped window persists its floating rectangle');
  equal(snapshot['terminal-1'].left, 30, 'maximized window persists its restore rectangle');
}

(async function main() {
  try {
    geometryTests();
    snapTests();
    boundsTests();
    linkedResizeTests();
    layoutTests();
    await persistenceTests();
    windowStateTests();
  } catch (error) {
    failed += 1;
    failures.push('uncaught: ' + (error && error.stack ? error.stack : error));
    console.error(error);
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('Failures:\n - ' + failures.join('\n - '));
    process.exitCode = 1;
  }
})();
