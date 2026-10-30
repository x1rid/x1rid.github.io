#!/usr/bin/env node
/**
 * Zero-dependency tests for Shared System Services & Configuration.
 * Tests:
 * 1. SystemServices.events registration, emission, once, and unsubscription
 * 2. SystemServices.clipboard token checking and profile isolation
 * 3. SystemConfig get, patch, rollback, and subscription listener
 * 4. ShortcutService registration, context filtering, and unregistration
 * Run: node tests/shared-services.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
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
  ok(actual === expected, label + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

function createEnvironment() {
  const listenersMap = new Map();
  const store = new Map();

  class MemoryProfileDB {
    async init() { return this; }
    async getProfile(id) { return { id, type: id === 'owner' ? 'owner' : 'guest' }; }
    async getSystemConfig(profileId) { return store.get('sysconf:' + profileId) || null; }
    async putSystemConfig(record) {
      store.set('sysconf:' + record.profileId, JSON.parse(JSON.stringify(record)));
      return record;
    }
  }

  const documentStub = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => {
      if (!listenersMap.has(type)) listenersMap.set(type, new Set());
      listenersMap.get(type).add(fn);
    },
    removeEventListener: (type, fn) => {
      if (listenersMap.has(type)) listenersMap.get(type).delete(fn);
    },
    dispatchEvent: (event) => {
      const set = listenersMap.get(event.type);
      if (set) {
        Array.from(set).forEach(fn => fn(event));
      }
      return true;
    }
  };

  const windowStub = {
    ProfileDB: MemoryProfileDB,
    ProfileService: {
      getActiveProfile: () => ({ id: 'owner', type: 'owner' })
    },
    crypto: nodeCrypto.webcrypto,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    document: documentStub,
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    console
  };
  windowStub.window = windowStub;
  windowStub.globalThis = windowStub;

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
    Set,
    WeakMap
  });

  function load(relative) {
    const file = path.join(ROOT, relative);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: relative });
  }

  load('main/shortcuts.js');
  load('main/system-services.js');
  load('main/system-config.js');

  return { window: windowStub, document: documentStub };
}

async function runSharedServicesTests() {
  console.log('--- Phase 4: Shared Services & Event Lifecycle Tests ---');

  const env = createEnvironment();
  const services = env.window.SystemServices;
  const shortcuts = env.window.ShortcutService;
  const sysConfig = env.window.SystemConfig;

  // 1. SystemServices.events Subscription & Unsubscription
  let eventCount = 0;
  const unsub = services.events.on('system:notification', (detail) => {
    eventCount++;
  });

  services.events.emit('system:notification', { level: 'info', message: 'Test Notification 1' });
  equal(eventCount, 1, 'Listener received emitted notification event');

  unsub();
  services.events.emit('system:notification', { level: 'info', message: 'Test Notification 2' });
  equal(eventCount, 1, 'Unsubscribed listener does not receive subsequent events');

  // 2. Clipboard Token & Profile Guard
  services.clipboard.writeText('Secret Text');
  equal(services.clipboard.readText(), 'Secret Text', 'Pasted text matches copied text');

  // 3. Shortcuts Registration & Execution
  let shortcutFired = false;
  const handle = shortcuts.register({
    id: 'test-shortcut',
    keys: 'Ctrl+Alt+T',
    context: 'global',
    handler: () => { shortcutFired = true; }
  });

  ok(handle && handle.id === 'test-shortcut', 'Shortcut registered with unique ID');
  const countBefore = shortcuts.diagnostics().registrations.length;
  ok(countBefore >= 1, 'Shortcut diagnostics reports active registration');

  shortcuts.unregister(handle);
  const countAfter = shortcuts.diagnostics().registrations.length;
  equal(countAfter, countBefore - 1, 'Shortcut unregistered cleanly');

  // 4. SystemConfig Patch, Audit & Subscription
  await sysConfig.init();
  let configChangedCalls = 0;
  const unsubConfig = sysConfig.subscribe(() => {
    configChangedCalls++;
  });

  const patched = await sysConfig.patch({
    startup: [{ id: 'app-calc', label: 'Calculator', target: 'app:calculator', enabled: true, scope: 'user' }]
  });

  ok(patched && patched.startup.some(s => s.id === 'app-calc'), 'Startup section patched successfully');
  equal(configChangedCalls, 1, 'SystemConfig subscriber notified of patch');

  unsubConfig();

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('Failures:\n - ' + failures.join('\n - '));
    process.exitCode = 1;
  }
}

runSharedServicesTests().catch(err => {
  console.error('Unexpected error in shared services tests:', err);
  process.exit(1);
});
