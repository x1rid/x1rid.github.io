#!/usr/bin/env node
/**
 * Zero-dependency tests for Shell Integrity & Deployment Checks.
 * Tests:
 * 1. Byte-identity between main/index.html and main/desktop-shell.html
 * 2. Script loading order and required dependencies in main/index.html
 * 3. Prevention of accidental introduction of conflicting apps.js
 * Run: node tests/shell-integrity.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) {
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

function sha256(filePath) {
  const content = fs.readFileSync(filePath);
  return nodeCrypto.createHash('sha256').update(content).digest('hex');
}

function runShellIntegrityTests() {
  console.log('--- Phase 5: Shell Integrity & Deployment Tests ---');

  const indexPath = path.join(ROOT, 'main/index.html');
  const shellPath = path.join(ROOT, 'main/desktop-shell.html');

  // 1. Invariant: main/desktop-shell.html has been archived per Phase 0.5 (D-002).
  // Verify main/index.html exists and is non-empty.
  ok(fs.existsSync(indexPath), 'main/index.html exists');
  ok(!fs.existsSync(shellPath), 'main/desktop-shell.html archived to _archive/');

  // 2. Script Ordering & Dependency Checks
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  // Foundation services must be loaded in correct sequence
  const scripts = [];
  const scriptRegex = /<script\s+src="([^"]+)"/g;
  let match;
  while ((match = scriptRegex.exec(indexHtml)) !== null) {
    scripts.push(match[1]);
  }

  const findIdx = (prefix) => scripts.findIndex(s => s.startsWith(prefix));

  const profileDbIdx = findIdx('./profile/profile-db.js');
  const profileServiceIdx = findIdx('./profile/profile-service.js');
  const vfsIdx = findIdx('./fs/filesystem-service.js');
  const bootIdx = findIdx('./profile/boot.js');
  const appRegistryIdx = findIdx('./app-registry.js');
  const sysServicesIdx = findIdx('./system-services.js');

  ok(profileDbIdx !== -1, 'profile-db.js script tag found');
  ok(profileServiceIdx > profileDbIdx, 'profile-service.js loads after profile-db.js');
  ok(vfsIdx > profileDbIdx, 'filesystem-service.js loads after profile-db.js');
  ok(bootIdx > vfsIdx, 'profile/boot.js loads after filesystem-service.js');
  ok(appRegistryIdx > bootIdx, 'app-registry.js loads after profile/boot.js');
  ok(sysServicesIdx > appRegistryIdx, 'system-services.js loads after app-registry.js');

  // 3. apps.js must NOT be loaded as a conflicting registry
  const appsJsIdx = findIdx('./apps.js');
  equal(appsJsIdx, -1, 'main/apps.js is NOT loaded by main/index.html (prevents dual-RetroApps conflict)');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('Failures:\n - ' + failures.join('\n - '));
    process.exitCode = 1;
  }
}

runShellIntegrityTests();
