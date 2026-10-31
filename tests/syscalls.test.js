#!/usr/bin/env node
/**
 * Zero-dependency unit tests for L3 Syscall Layer (kernel/syscalls.js).
 *
 * Run: node tests/syscalls.test.js
 */

'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { OsError, OsErrors } = require(path.join(ROOT, 'main/kernel/platform/errors.js'));
const { KernelClock } = require(path.join(ROOT, 'main/kernel/platform/clock.js'));
const { KernelEvents } = require(path.join(ROOT, 'main/kernel/events.js'));
const { KernelLogger } = require(path.join(ROOT, 'main/kernel/platform/logger.js'));
const { SecurityUsers } = require(path.join(ROOT, 'main/security/users.js'));
const { SecurityAudit } = require(path.join(ROOT, 'main/security/audit.js'));
const { SecurityPermissions } = require(path.join(ROOT, 'main/security/permissions.js'));
const { KernelProcessTable } = require(path.join(ROOT, 'main/kernel/process-table.js'));

global.OsError = OsError;
global.OsErrors = OsErrors;
global.KernelClock = KernelClock;
global.KernelEvents = KernelEvents;
global.KernelLogger = KernelLogger;
global.SecurityUsers = SecurityUsers;
global.SecurityAudit = SecurityAudit;
global.SecurityPermissions = SecurityPermissions;
global.KernelProcessTable = KernelProcessTable;

const { KernelSyscalls, Kernel } = require(path.join(ROOT, 'main/kernel/syscalls.js'));
global.KernelSyscalls = KernelSyscalls;
global.Kernel = Kernel;

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
  console.log('--- Phase 1.5: Kernel Syscall Layer Tests ---');

  const callerProc = KernelProcessTable.spawn({
    appId: 'test-runner',
    name: 'Test Runner',
    uid: 'owner',
    caps: ['fs.read:user', 'fs.write:user', 'proc.list', 'proc.spawn', 'proc.kill']
  });
  const ctx = { pid: callerProc.pid, uid: 'owner', caps: callerProc.caps };

  // ── 1. proc.* syscalls ───────────────────────────────────────────────────
  const listRes = await Kernel.syscall(ctx, 'proc.list');
  ok(listRes.ok === true, 'proc.list returned ok');
  ok(Array.isArray(listRes.value), 'proc.list returned process array');

  const spawnRes = await Kernel.syscall(ctx, 'proc.spawn', { appId: 'calc', name: 'Calculator' });
  ok(spawnRes.ok === true, 'proc.spawn returned ok');
  equal(spawnRes.value.appId, 'calc', 'Spawned process appId matches');

  const infoRes = await Kernel.syscall(ctx, 'proc.info', { pid: spawnRes.value.pid });
  ok(infoRes.ok === true, 'proc.info found newly spawned process');
  equal(infoRes.value.pid, spawnRes.value.pid, 'Process PID matches');

  // ── 2. sys.* syscalls ────────────────────────────────────────────────────
  const timeRes = await Kernel.syscall(ctx, 'sys.time');
  ok(timeRes.ok === true, 'sys.time succeeded');
  ok(typeof timeRes.value.timestamp === 'number', 'sys.time returns numeric timestamp');

  const logRes = await Kernel.syscall(ctx, 'sys.log', { message: 'Syscall test log', level: 'info' });
  ok(logRes.ok === true, 'sys.log succeeded');

  // ── 3. sec.* syscalls ────────────────────────────────────────────────────
  const whoamiRes = await Kernel.syscall(ctx, 'sec.whoami');
  ok(whoamiRes.ok === true, 'sec.whoami succeeded');
  equal(whoamiRes.value.uid, 'owner', 'sec.whoami reports caller uid');

  // ── 4. Permission enforcement & Default-Deny ─────────────────────────────
  let permError = null;
  try {
    // Attempting to write into protected system path must be denied by L2
    await Kernel.syscall(ctx, 'fs.write', { path: 'C:\\Windows\\system32\\kernel.dll', content: 'hack' });
  } catch (err) {
    permError = err;
  }
  ok(permError !== null, 'Syscall into protected path rejected with error');
  equal(permError.code, 'EACCES', 'Syscall rejection code is EACCES');

  // Unknown syscall handling
  let unknownError = null;
  try {
    await Kernel.syscall(ctx, 'invalid.call');
  } catch (err) {
    unknownError = err;
  }
  ok(unknownError !== null, 'Unknown syscall rejected');
  equal(unknownError.code, 'EINVAL', 'Unknown syscall reports EINVAL');

  // ── 5. Diagnostics ───────────────────────────────────────────────────────
  const diag = KernelSyscalls.diagnostics();
  ok(diag.availableSyscalls > 0, 'Diagnostics reports registered syscalls');
  ok(diag.totalSyscallsExecuted > 0, 'Diagnostics counts executed syscalls');
  ok(diag.deniedSyscalls > 0, 'Diagnostics counts denied syscalls');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(function (err) {
  console.error('Test execution failed:', err);
  process.exit(1);
});
