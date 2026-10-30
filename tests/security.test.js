#!/usr/bin/env node
/**
 * Zero-dependency unit tests for L2 Security modules:
 * - users.js (SecurityUsers)
 * - permissions.js (SecurityPermissions)
 * - audit.js (SecurityAudit)
 *
 * Run: node tests/security.test.js
 */

'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { KernelClock } = require(path.join(ROOT, 'main/kernel/platform/clock.js'));
const { KernelEvents } = require(path.join(ROOT, 'main/kernel/events.js'));
global.KernelClock = KernelClock;
global.KernelEvents = KernelEvents;

const { SecurityAudit } = require(path.join(ROOT, 'main/security/audit.js'));
const { SecurityUsers } = require(path.join(ROOT, 'main/security/users.js'));
global.SecurityAudit = SecurityAudit;
global.SecurityUsers = SecurityUsers;

const { SecurityPermissions } = require(path.join(ROOT, 'main/security/permissions.js'));
global.SecurityPermissions = SecurityPermissions;

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

console.log('--- Phase 1.3: Security Engine (users, permissions, audit) Tests ---');

// ── 1. SecurityUsers Tests ───────────────────────────────────────────────────
const owner = SecurityUsers.getUser('owner');
ok(owner !== null, 'SecurityUsers.getUser returns owner');
equal(owner.role, 'administrator', 'Owner has administrator role');

const guest = SecurityUsers.getUser('guest');
equal(guest.role, 'guest', 'Guest has guest role');

const adminGroup = SecurityUsers.getGroup('administrators');
ok(adminGroup !== null, 'SecurityUsers.getGroup returns administrators group');

// ── 2. SecurityPermissions Tests (Default-Deny Model) ────────────────────────
// Deny modification of system directory even for admin
const sysFileWrite = SecurityPermissions.check({
  user: owner,
  action: 'fs:write',
  resource: 'C:\\Windows\\system32\\drivers.sys'
});
equal(sysFileWrite.allowed, false, 'Modifying C:\\Windows is denied');
equal(sysFileWrite.reason, 'rule-deny', 'Deny rule matched');

// Allow user access to home directory
const homeWrite = SecurityPermissions.check({
  user: owner,
  action: 'fs:write',
  resource: 'C:\\Users\\Operator\\file.txt'
});
equal(homeWrite.allowed, true, 'User writing in C:\\Users is allowed');

// Boolean shorthand check
equal(SecurityPermissions.can('app:launch', 'terminal', { user: guest }), true, 'Guest can launch apps');
equal(SecurityPermissions.can('system:wipe', 'disk0', { user: guest }), false, 'Guest cannot wipe system (default-deny)');

// ── 3. SecurityAudit Tests ───────────────────────────────────────────────────
SecurityAudit.clear();
let auditEmitted = null;
KernelEvents.on('sec:audit', function (evt) {
  auditEmitted = evt;
});

SecurityAudit.record({
  action: 'sec:test-record',
  resource: 'test-resource',
  result: 'allow',
  reason: 'unit-test'
});

const auditEntries = SecurityAudit.getEntries();
equal(auditEntries.length, 1, 'Audit record persisted in buffer');
equal(auditEntries[0].action, 'sec:test-record', 'Audit action preserved');
ok(auditEmitted !== null, 'Audit event broadcast via KernelEvents bus');
equal(auditEmitted.action, 'sec:test-record', 'Event bus payload matches audit record');

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
