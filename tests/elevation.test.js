#!/usr/bin/env node
/**
 * @file tests/elevation.test.js
 * Phase 4.1 — ElevationService unit tests.
 */
'use strict';

const path = require('path');

// Set up global root before requiring modules
const g = global;

// Load ElevationService
require(path.join(__dirname, '..', 'main', 'security', 'elevation.js'));

const ElevationService = g.ElevationService;

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
  console.log('elevation.test.js');

  // 1. isElevated returns false before any request
  await test('isElevated(999) returns false initially', async function () {
    assert(ElevationService.isElevated(999) === false, 'Expected false for unelevated PID');
  });

  // 2. With ELEVATION_AUTO_GRANT=1, request resolves { granted: true, token: string }
  await test('request grants with ELEVATION_AUTO_GRANT=1', async function () {
    process.env.ELEVATION_AUTO_GRANT = '1';
    const result = await ElevationService.request(42, 'test');
    assert(result.granted === true, 'Expected granted=true');
    assert(typeof result.token === 'string' && result.token.length > 0, 'Expected token string');
    // Store token for next tests
    g._testToken = result.token;
  });

  // 3. After grant, isElevated returns true
  await test('isElevated(42) returns true after grant', async function () {
    assert(ElevationService.isElevated(42) === true, 'Expected true after elevation');
  });

  // 4. revoke(token) → isElevated returns false
  await test('revoke(token) clears elevation', async function () {
    ElevationService.revoke(g._testToken);
    assert(ElevationService.isElevated(42) === false, 'Expected false after revoke');
    delete g._testToken;
  });

  // 5. Without auto-grant, request resolves { granted: false, token: null }
  await test('request denies without ELEVATION_AUTO_GRANT (Node env)', async function () {
    delete process.env.ELEVATION_AUTO_GRANT;
    const result = await ElevationService.request(42, 'test');
    // In Node with no window and no ELEVATION_AUTO_GRANT → deny
    assert(result.granted === false, 'Expected granted=false without auto-grant');
    assert(result.token === null, 'Expected token=null on deny');
  });

  // 6. diagnostics()
  await test('diagnostics() returns version', async function () {
    const d = ElevationService.diagnostics();
    assert(d.version === '20261031.p4.1', 'Expected version string');
    assert(Array.isArray(d.elevatedPids), 'Expected elevatedPids array');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})();
