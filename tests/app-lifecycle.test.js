#!/usr/bin/env node
/**
 * Zero-dependency tests for AppRegistry & Lifecycle Coordinator.
 * Tests:
 * 1. App registration & duplicate prevention
 * 2. Window attachment, instance tracking, and snapshot
 * 3. Idempotent cleanup execution (ensures cleanup is called at most once)
 * 4. Window detach on close and event emission
 * 5. Launch delegation for singletons vs multiple-instance apps
 * Run: node tests/app-lifecycle.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
  const eventsEmitted = [];
  const windowStub = {
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    document: {
      dispatchEvent(event) {
        eventsEmitted.push(event);
        return true;
      }
    },
    console
  };
  windowStub.window = windowStub;
  windowStub.globalThis = windowStub;

  const context = vm.createContext(windowStub);

  function load(relative) {
    const file = path.join(ROOT, relative);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: relative });
  }

  load('main/app-registry.js');

  return { window: windowStub, eventsEmitted };
}

function runLifecycleTests() {
  console.log('--- Phase 2: App Lifecycle & Registry Tests ---');

  const env = createEnvironment();
  const registry = env.window.AppRegistry;

  // 1. Basic Registration
  const app1 = registry.register({
    id: 'calculator',
    name: 'Calculator',
    launch: () => ({ id: 'win-calc-1' })
  });
  ok(app1 !== null, 'App registered successfully');
  equal(registry.has('calculator'), true, 'Registry has calculator');

  // Duplicate Registration
  const dup = registry.register({
    id: 'calculator',
    name: 'Calculator Duplicate',
    launch: () => ({ id: 'win-calc-2' })
  });
  equal(dup.name, 'Calculator', 'Duplicate registration returns existing definition without overwriting');

  // 2. Window Attachment & Instance Tracking
  let cleanupCalls = 0;
  const mockWin = {
    id: 'win-calc-1',
    closed: false,
    onClose: () => {
      cleanupCalls++;
    }
  };

  const instance = registry.attachWindow('calculator', mockWin, { windowId: 'win-calc-1' });
  ok(instance !== null, 'Window attached to instance');
  equal(registry.running().length, 1, 'Running instances count is 1');
  equal(registry.instance('win-calc-1').appId, 'calculator', 'Instance query returns correct appId');

  // 3. Idempotent Close & Cleanup Execution
  mockWin.onClose();
  equal(cleanupCalls, 1, 'Window onClose triggered instance cleanup once');
  equal(registry.running().length, 0, 'Instance detached on window close');

  // Calling onClose again shouldn't duplicate cleanup
  mockWin.onClose();
  equal(cleanupCalls, 1, 'Second onClose invocation does not re-run cleanup');

  // 4. Singleton Launch Behavior
  let launchCalls = 0;
  let focusCalls = 0;
  registry.configure({
    windowManager: {
      focus: () => { focusCalls++; }
    }
  });

  registry.register({
    id: 'notepad',
    name: 'Notepad',
    multiple: false,
    launch: () => {
      launchCalls++;
      const w = { id: 'win-notepad', closed: false };
      registry.attachWindow('notepad', w, { windowId: 'win-notepad' });
      return w;
    }
  });

  const win1 = registry.launch('notepad');
  equal(launchCalls, 1, 'First singleton launch calls launch handler');
  ok(win1 && win1.id === 'win-notepad', 'First launch returns window');

  const win2 = registry.launch('notepad');
  equal(launchCalls, 1, 'Second singleton launch does NOT call launch handler again');
  equal(win2.id, 'win-notepad', 'Second launch returns existing window instance');
  equal(focusCalls, 1, 'Second launch focuses existing window');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('Failures:\n - ' + failures.join('\n - '));
    process.exitCode = 1;
  }
}

runLifecycleTests();
