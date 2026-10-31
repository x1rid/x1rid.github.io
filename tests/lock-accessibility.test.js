'use strict';

const assert = require('assert');
const path = require('path');

// Test LockAccessibility Node-loadability
const root = {};
require(path.join(__dirname, '..', 'main', 'lock-screen', 'lock-accessibility.js'));

const LockAccessibility = global.LockAccessibility || root.LockAccessibility;

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    console.log('  ok  ' + name);
    passed++;
  } catch (err) {
    console.error('  FAIL: ' + name, err);
    failed++;
  }
}

console.log('=== tests/lock-accessibility.test.js ===');

it('LockAccessibility is defined and frozen', () => {
  assert.ok(LockAccessibility, 'LockAccessibility should exist');
  assert.ok(Object.isFrozen(LockAccessibility), 'LockAccessibility should be frozen');
});

it('LockAccessibility has required API methods', () => {
  assert.strictEqual(typeof LockAccessibility.version, 'string');
  assert.ok(LockAccessibility.ready instanceof Promise);
  assert.strictEqual(typeof LockAccessibility.init, 'function');
  assert.strictEqual(typeof LockAccessibility.showOSK, 'function');
  assert.strictEqual(typeof LockAccessibility.hideOSK, 'function');
  assert.strictEqual(typeof LockAccessibility.toggleOSK, 'function');
  assert.strictEqual(typeof LockAccessibility.showPowerMenu, 'function');
  assert.strictEqual(typeof LockAccessibility.hidePowerMenu, 'function');
  assert.strictEqual(typeof LockAccessibility.togglePowerMenu, 'function');
  assert.strictEqual(typeof LockAccessibility.diagnostics, 'function');
});

it('diagnostics() returns valid diagnostic data', () => {
  const diag = LockAccessibility.diagnostics();
  assert.ok(diag, 'diagnostics should return an object');
  assert.strictEqual(diag.version, LockAccessibility.version);
  assert.strictEqual(typeof diag.oskVisible, 'boolean');
  assert.strictEqual(typeof diag.powerVisible, 'boolean');
  assert.strictEqual(typeof diag.a11yVisible, 'boolean');
});

it('safe execution of toggle methods in headless environment', () => {
  // Should not throw even without document/DOM
  LockAccessibility.showOSK();
  LockAccessibility.hideOSK();
  LockAccessibility.toggleOSK();
  LockAccessibility.showPowerMenu();
  LockAccessibility.hidePowerMenu();
  LockAccessibility.togglePowerMenu();
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
