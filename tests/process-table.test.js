#!/usr/bin/env node
/**
 * Zero-dependency unit tests for L3 Kernel Process Table (kernel/process-table.js)
 * and its integration with AppRegistry.
 *
 * Run: node tests/process-table.test.js
 */

'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { KernelClock } = require(path.join(ROOT, 'main/kernel/platform/clock.js'));
const { KernelEvents } = require(path.join(ROOT, 'main/kernel/events.js'));
global.KernelClock = KernelClock;
global.KernelEvents = KernelEvents;

const { KernelProcessTable } = require(path.join(ROOT, 'main/kernel/process-table.js'));
global.KernelProcessTable = KernelProcessTable;

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

console.log('--- Phase 1.4: Kernel Process Table Tests ---');

// ── 1. Monotonic spawn and lifecycle ─────────────────────────────────────────
const p1 = KernelProcessTable.spawn({ appId: 'terminal', name: 'Terminal' });
ok(p1 && typeof p1.pid === 'number', 'Spawn returns process with numeric pid');
equal(p1.appId, 'terminal', 'appId is set correctly');
equal(p1.state, 'running', 'Initial state is running');

const p2 = KernelProcessTable.spawn({ appId: 'calculator', name: 'Calculator' });
ok(p2.pid > p1.pid, 'Process PID increases monotonically (' + p2.pid + ' > ' + p1.pid + ')');

// ── 2. Retrieval & Process List ──────────────────────────────────────────────
const fetched = KernelProcessTable.get(p1.pid);
ok(fetched !== null, 'KernelProcessTable.get finds process');
equal(fetched.name, 'Terminal', 'Process record data intact');

const allProcs = KernelProcessTable.list();
ok(allProcs.length >= 2, 'KernelProcessTable.list returns active processes');

// ── 3. Window Association and Detach ─────────────────────────────────────────
KernelProcessTable.attachWindow(p1.pid, 'win-100');
const byWin = KernelProcessTable.getByWindow('win-100');
ok(byWin !== null, 'getByWindow resolves process');
equal(byWin.pid, p1.pid, 'Window resolves to correct pid');

// Detach window terminates app process when last window detached
KernelProcessTable.detachWindow('win-100');
const p1After = KernelProcessTable.get(p1.pid);
equal(p1After.state, 'exited', 'Process transitioned to exited state after window detachment');

// ── 4. Signals ───────────────────────────────────────────────────────────────
const p3 = KernelProcessTable.spawn({ appId: 'background-task', kind: 'task' });
let signalReceived = null;
KernelProcessTable.onSignal(p3.pid, 'SIGHUP', function (s) {
  signalReceived = s;
});

KernelProcessTable.signal(p3.pid, 'SIGHUP');
equal(signalReceived, 'SIGHUP', 'Signal delivered to registered handler');

KernelProcessTable.kill(p3.pid, 1);
const p3Exited = KernelProcessTable.get(p3.pid);
equal(p3Exited.state, 'exited', 'Kill terminates process');
equal(p3Exited.exitCode, 1, 'Kill stores exit code');

// ── 5. Diagnostics ───────────────────────────────────────────────────────────
const diag = KernelProcessTable.diagnostics();
ok(diag.totalTracked >= 3, 'Diagnostics reports tracked processes');
equal(typeof diag.activeCount, 'number', 'Diagnostics activeCount is numeric');

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
