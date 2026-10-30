#!/usr/bin/env node
/**
 * Zero-dependency unit tests for L3 Kernel Service Manager (kernel/service-manager.js).
 *
 * Run: node tests/service-manager.test.js
 */

'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { OsError } = require(path.join(ROOT, 'main/kernel/platform/errors.js'));
const { KernelClock } = require(path.join(ROOT, 'main/kernel/platform/clock.js'));
const { KernelEvents } = require(path.join(ROOT, 'main/kernel/events.js'));
const { KernelLogger } = require(path.join(ROOT, 'main/kernel/platform/logger.js'));

global.OsError = OsError;
global.KernelClock = KernelClock;
global.KernelEvents = KernelEvents;
global.KernelLogger = KernelLogger;

const { KernelServiceManager, KernelReady } = require(path.join(ROOT, 'main/kernel/service-manager.js'));

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

async function runTests() {
  console.log('--- Phase 1.6: Service Manager & Dependency Boot Tests ---');

  // ── 1. KernelReady promise check ───────────────────────────────────────────
  await KernelReady;
  ok(true, 'window.KernelReady promise resolves on core boot');

  // ── 2. Declarative Service Dependency Execution ────────────────────────────
  const executionOrder = [];

  KernelServiceManager.register('serviceA', {
    needs: [],
    start: async function () {
      executionOrder.push('A');
    }
  });

  KernelServiceManager.register('serviceB', {
    needs: ['serviceA'],
    start: async function () {
      executionOrder.push('B');
    }
  });

  KernelServiceManager.register('serviceC', {
    needs: ['serviceB'],
    start: async function () {
      executionOrder.push('C');
    }
  });

  await KernelServiceManager.start('serviceC');
  equal(executionOrder.join('->'), 'A->B->C', 'Services booted in declared dependency order');

  // ── 3. Circular Dependency Detection ───────────────────────────────────────
  KernelServiceManager.register('circX', {
    needs: ['circY'],
    start: async function () {}
  });

  KernelServiceManager.register('circY', {
    needs: ['circX'],
    start: async function () {}
  });

  let circularError = null;
  try {
    await KernelServiceManager.start('circX');
  } catch (err) {
    circularError = err;
  }
  ok(circularError !== null, 'Circular dependency caught and rejected');
  equal(circularError.code, 'EINVAL', 'Circular error code reports EINVAL');

  // ── 4. State & Diagnostics ─────────────────────────────────────────────────
  const infoC = KernelServiceManager.get('serviceC');
  equal(infoC.state, 'running', 'Started service reports state running');

  await KernelServiceManager.stop('serviceC');
  const stoppedC = KernelServiceManager.get('serviceC');
  equal(stoppedC.state, 'stopped', 'Stopped service reports state stopped');

  const diag = KernelServiceManager.diagnostics();
  ok(diag.registeredCount >= 3, 'Diagnostics reports registered service count');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(function (err) {
  console.error('Test execution failed:', err);
  process.exit(1);
});
