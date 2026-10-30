#!/usr/bin/env node
/**
 * Zero-dependency unit tests for L0 Platform services:
 * - errors.js (OsError, OsErrors, KernelErrors)
 * - clock.js (KernelClock)
 * - logger.js (KernelLogger)
 *
 * Run: node tests/kernel-platform.test.js
 */

'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { OsError, OsErrors, KernelErrors } = require(path.join(ROOT, 'main/kernel/platform/errors.js'));
const { KernelClock } = require(path.join(ROOT, 'main/kernel/platform/clock.js'));
const { KernelLogger } = require(path.join(ROOT, 'main/kernel/platform/logger.js'));

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, label) {
  if (cond) {
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

console.log('--- Phase 1.1: Platform Foundation (errors, clock, logger) Tests ---');

// ── 1. OsError & Error Registry Tests ─────────────────────────────────────────
const err = new OsError(OsErrors.ENOENT, 'File missing', { path: 'C:\\test.txt' });
ok(err instanceof Error, 'OsError is an instance of Error');
ok(err instanceof OsError, 'OsError is an instance of OsError');
equal(err.name, 'OsError', 'OsError name property is set');
equal(err.code, 'ENOENT', 'OsError code property is set correctly');
equal(err.message, 'File missing', 'OsError message is set correctly');
equal(err.detail && err.detail.path, 'C:\\test.txt', 'OsError detail contains path');

const jsonErr = err.toJSON();
equal(jsonErr.code, 'ENOENT', 'toJSON preserves code');
equal(jsonErr.name, 'OsError', 'toJSON preserves name');
equal(jsonErr.detail.path, 'C:\\test.txt', 'toJSON preserves detail');

equal(OsErrors.ENOENT, 'ENOENT', 'OsErrors.ENOENT identity');
equal(OsErrors.EEXIST, 'EEXIST', 'OsErrors.EEXIST identity');
equal(OsErrors.EACCES, 'EACCES', 'OsErrors.EACCES identity');
equal(OsErrors.NOT_FOUND, 'NOT_FOUND', 'OsErrors legacy NOT_FOUND alias preserved');

const diagErrors = KernelErrors.diagnostics();
equal(typeof diagErrors.codesCount, 'number', 'KernelErrors.diagnostics returns codesCount');
ok(diagErrors.codesCount > 10, 'Registry contains comprehensive codes list');

// ── 2. KernelClock Tests ─────────────────────────────────────────────────────
KernelClock.reset();
equal(KernelClock.mode(), 'realtime', 'KernelClock defaults to realtime mode');
const t1 = KernelClock.now();
ok(typeof t1 === 'number' && t1 > 0, 'KernelClock.now returns valid timestamp in realtime');

KernelClock.setFixed(1700000000000);
equal(KernelClock.mode(), 'fixed', 'KernelClock switches to fixed mode');
equal(KernelClock.now(), 1700000000000, 'KernelClock.now returns fixed timestamp');
equal(KernelClock.isoNow(), new Date(1700000000000).toISOString(), 'KernelClock.isoNow matches fixed timestamp');

KernelClock.reset();
equal(KernelClock.mode(), 'realtime', 'KernelClock.reset reverts to realtime mode');

KernelClock.setOffset(5000);
const t2 = KernelClock.now();
const hostNow = Date.now();
ok(Math.abs(t2 - (hostNow + 5000)) < 100, 'KernelClock.setOffset shifts time forward');

KernelClock.reset();
equal(KernelClock.diagnostics().offsetMs, 0, 'KernelClock diagnostics reports clean reset');

// ── 3. KernelLogger Tests ────────────────────────────────────────────────────
KernelLogger.setLevel('debug');
KernelLogger.info('kernel', 'Booting subsystems', { phase: '1.1' });
KernelLogger.warn('fs', 'Mount cache empty');
KernelLogger.debug('proc', 'Process tick');

const entries = KernelLogger.getEntries();
ok(entries.length >= 3, 'KernelLogger buffered logged entries');

const lastEntry = entries[entries.length - 1];
equal(lastEntry.level, 'debug', 'Last entry level is debug');
equal(lastEntry.tag, 'proc', 'Last entry tag is proc');
equal(lastEntry.message, 'Process tick', 'Last entry message is preserved');

let receivedViaBus = null;
KernelLogger.connectBus(function (topic, payload) {
  if (topic === 'sys:log') {
    receivedViaBus = payload;
  }
});

KernelLogger.error('sec', 'Unauthorized call');
ok(receivedViaBus !== null, 'KernelLogger sends to connected event bus');
equal(receivedViaBus && receivedViaBus.level, 'error', 'Bus payload matches error log');

const diagLogger = KernelLogger.diagnostics();
equal(diagLogger.busConnected, true, 'KernelLogger diagnostics confirms bus connection');
ok(diagLogger.bufferCount > 0, 'KernelLogger diagnostics reports buffered entries');

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
