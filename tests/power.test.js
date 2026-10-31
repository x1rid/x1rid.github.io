#!/usr/bin/env node
/**
 * @file tests/power.test.js
 * Phase 4.3 — PowerService unit tests.
 */
'use strict';

const path = require('path');
const g = global;

// Load KernelDB (memory backend in Node)
require(path.join(__dirname, '..', 'main', 'kernel', 'kernel-db.js'));
// Load PowerService
require(path.join(__dirname, '..', 'main', 'kernel', 'power.js'));

const KernelDB = g.KernelDB;
const PowerService = g.PowerService;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log('  ✅ ' + name);
    passed++;
  } catch (e) {
    console.error('  ❌ ' + name + ': ' + e.message);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

(async function () {
  console.log('power.test.js');

  // 1. Initial state is 'running'
  await test('PowerService.state is "running" initially', async function () {
    assert(PowerService.state === 'running', 'Expected state="running", got "' + PowerService.state + '"');
  });

  // 2. shutdown() sets state to 'shutdown'
  await test('shutdown() sets state to "shutdown"', async function () {
    await PowerService.shutdown();
    assert(PowerService.state === 'shutdown', 'Expected state="shutdown", got "' + PowerService.state + '"');
  });

  // Reset state via internal mechanism — reload the module for clean state
  // We test hibernate separately by using a fresh module load pattern

  // 3. hibernate() stores snapshot → KernelDB has 1 row in hibernate_snapshot
  await test('hibernate() stores snapshot in KernelDB', async function () {
    // Reset state for this test: use the internal approach
    // We know PowerService._state doesn't have a public setter, but we can test
    // by loading a fresh instance. Instead test that hibernate() stores to DB.

    // Make PowerService runnable again: patch state via diagnostics — not possible.
    // Instead test the DB write directly by calling hibernate. Even from 'shutdown' state
    // it writes the snapshot (state check only affects sleep wait).
    await PowerService.hibernate();
    const rows = await KernelDB.list('hibernate_snapshot');
    assert(rows.length >= 1, 'Expected at least 1 snapshot row, got ' + rows.length);
  });

  // 4. restore() returns true and clears snapshot
  await test('restore() returns true and clears snapshot', async function () {
    const result = await PowerService.restore();
    assert(result === true, 'Expected restore() to return true');
    const rows = await KernelDB.list('hibernate_snapshot');
    assert(rows.length === 0, 'Expected snapshot cleared after restore');
  });

  // 5. restore() returns false when no snapshot
  await test('restore() returns false when no snapshot', async function () {
    // Snapshot was already cleared
    const result = await PowerService.restore();
    assert(result === false, 'Expected restore() to return false when no snapshot');
  });

  // 6. version and ready
  await test('version is set', async function () {
    assert(typeof PowerService.version === 'string', 'Expected version string');
  });

  // 7. diagnostics()
  await test('diagnostics() returns state', async function () {
    const d = PowerService.diagnostics();
    assert(d && typeof d === 'object', 'Expected object');
    assert(typeof d.state === 'string', 'Expected state in diagnostics');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})();
