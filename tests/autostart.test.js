#!/usr/bin/env node
/**
 * @file tests/autostart.test.js
 * Phase 4.2 — AutostartService unit tests.
 */
'use strict';

const path = require('path');
const g = global;

// AutostartService uses KernelDB — it will fall back to memory backend in Node
require(path.join(__dirname, '..', 'main', 'kernel', 'autostart.js'));

const AutostartService = g.AutostartService;

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
  console.log('autostart.test.js');

  // 1. register → list returns entry
  await test('register("calc", {}) → list() returns entry', async function () {
    await AutostartService.register('calc', {});
    const entries = await AutostartService.list();
    const found = entries.find(function (e) { return e.appId === 'calc'; });
    assert(found !== undefined, 'Expected calc entry in list');
  });

  // 2. unregister → list is empty
  await test('unregister("calc") → list() is empty', async function () {
    await AutostartService.unregister('calc');
    const entries = await AutostartService.list();
    const found = entries.find(function (e) { return e.appId === 'calc'; });
    assert(found === undefined, 'Expected calc to be removed from list');
  });

  // 3. run() with empty list resolves without error
  await test('run() with empty list resolves without error', async function () {
    await AutostartService.run();
    assert(true, 'run() completed');
  });

  // 4. version and ready
  await test('version is set', async function () {
    assert(typeof AutostartService.version === 'string', 'Expected version string');
    assert(AutostartService.version.length > 0, 'Expected non-empty version');
  });

  // 5. diagnostics()
  await test('diagnostics() returns object', async function () {
    const d = AutostartService.diagnostics();
    assert(d && typeof d === 'object', 'Expected diagnostics object');
    assert(typeof d.version === 'string', 'Expected version in diagnostics');
  });

  // 6. register with once flag
  await test('register with once:true appears in list', async function () {
    await AutostartService.register('notepad', { once: true, delay: 0 });
    const entries = await AutostartService.list();
    const found = entries.find(function (e) { return e.appId === 'notepad'; });
    assert(found !== undefined, 'Expected notepad entry');
    assert(found.opts.once === true, 'Expected once flag set');
    // Cleanup
    await AutostartService.unregister('notepad');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})();
