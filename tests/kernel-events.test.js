#!/usr/bin/env node
/**
 * Zero-dependency unit tests for L3 Kernel Unified Event Bus (kernel/events.js).
 *
 * Run: node tests/kernel-events.test.js
 */

'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// Setup dependencies in global for Node run
const { KernelClock } = require(path.join(ROOT, 'main/kernel/platform/clock.js'));
const { KernelLogger } = require(path.join(ROOT, 'main/kernel/platform/logger.js'));
global.KernelClock = KernelClock;
global.KernelLogger = KernelLogger;

const { KernelEvents } = require(path.join(ROOT, 'main/kernel/events.js'));

let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) {
    passed += 1;
    console.log('ok   ' + label);
  } else {
    failed += 1;
    console.log('FAIL ' + label);
  }
}

function equal(actual, expected, label) {
  ok(actual === expected, label + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

console.log('--- Phase 1.2: Unified Event Bus (kernel/events.js) Tests ---');

// ── 1. Basic subscription & emission ─────────────────────────────────────────
let receivedData = null;
const unsub = KernelEvents.on('custom:test-event', function (evt) {
  receivedData = evt;
});

const env = KernelEvents.emit('custom:test-event', { message: 'hello world' });
ok(receivedData !== null, 'Listener received emitted event');
equal(receivedData.message, 'hello world', 'Payload content preserved');
equal(receivedData.type, 'custom:test-event', 'Payload type populated');
ok(typeof receivedData.sequence === 'number' && receivedData.sequence > 0, 'Event sequence attached');
ok(typeof receivedData.emittedAt === 'number' && receivedData.emittedAt > 0, 'Event emittedAt attached');

unsub();
receivedData = null;
KernelEvents.emit('custom:test-event', { message: 'should not arrive' });
equal(receivedData, null, 'Unsubscribe stops event delivery');

// ── 2. once() subscription ───────────────────────────────────────────────────
let onceCount = 0;
KernelEvents.once('custom:once-event', function () {
  onceCount += 1;
});

KernelEvents.emit('custom:once-event');
KernelEvents.emit('custom:once-event');
equal(onceCount, 1, 'once() handler only fires once');

// ── 3. Bi-directional Legacy Alias Bridge Tests ──────────────────────────────
// Scenario A: Emit legacy name -> canonical listener receives it
let canonicalReceived = null;
const unsubCanonical = KernelEvents.on('fs:node-created', function (evt) {
  canonicalReceived = evt;
});

KernelEvents.emit('node-created', { path: 'C:\\test.txt' });
ok(canonicalReceived !== null, 'Canonical listener received legacy node-created emission');
equal(canonicalReceived.type, 'fs:node-created', 'Event type normalized to canonical name');
equal(canonicalReceived.path, 'C:\\test.txt', 'Payload preserved through bridge');

// Scenario B: Emit canonical name -> legacy listener receives it
let legacyReceived = null;
const unsubLegacy = KernelEvents.on('node-created', function (evt) {
  legacyReceived = evt;
});

KernelEvents.emit('fs:node-created', { path: 'C:\\canonical.txt' });
ok(legacyReceived !== null, 'Legacy listener received canonical fs:node-created emission');
equal(legacyReceived.path, 'C:\\canonical.txt', 'Payload received by legacy subscriber');

unsubCanonical();
unsubLegacy();

// ── 4. App/Proc alias bridge check ───────────────────────────────────────────
let procReceived = null;
KernelEvents.on('proc:spawned', function (evt) {
  procReceived = evt;
});
KernelEvents.emit('site:applaunch', { appId: 'terminal' });
ok(procReceived !== null, 'site:applaunch routed to proc:spawned listener');
equal(procReceived.appId, 'terminal', 'App payload preserved through app launch bridge');

// ── 5. Error containment in listeners ────────────────────────────────────────
let subsequentFired = false;
KernelEvents.on('test:error-guard', function () {
  throw new Error('Exploding listener');
});
KernelEvents.on('test:error-guard', function () {
  subsequentFired = true;
});

let threw = false;
try {
  KernelEvents.emit('test:error-guard', { safe: true });
} catch (e) {
  threw = true;
}
equal(threw, false, 'KernelEvents.emit does not throw if a listener throws');
equal(subsequentFired, true, 'Subsequent listeners still execute after earlier listener error');

// ── 6. Diagnostics snapshot ──────────────────────────────────────────────────
const diag = KernelEvents.diagnostics();
equal(typeof diag.totalEmitted, 'number', 'Diagnostics reports totalEmitted');
ok(diag.totalEmitted > 0, 'Diagnostics reflects emission count');

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
