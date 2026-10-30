#!/usr/bin/env node
/**
 * @file tests/run-tests.js
 * @description Unified Node.js test runner for all pure-module unit tests.
 *
 * Usage:
 *   node tests/run-tests.js
 *
 * Each test file must be self-contained, Node-loadable, and print a final
 * summary line matching:  <N> passed, <M> failed
 *
 * Exit code 0 = all green. Exit code 1 = any failure.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = __dirname;

// ── Browser-only tests (require window/document — skip in Node runner) ───────
// These run in tests/run.html or via Playwright. Do not run them with Node.
const BROWSER_ONLY_TESTS = new Set(['retro-browser.test.js']);

// ── Discover test files ─────────────────────────────────────────────────────
const TEST_FILES = fs
  .readdirSync(TESTS_DIR)
  .filter(f => f.endsWith('.test.js') && f !== 'run-tests.js' && !BROWSER_ONLY_TESTS.has(f))
  .sort()
  .map(f => path.join(TESTS_DIR, f));

if (TEST_FILES.length === 0) {
  console.log('No test files found in', TESTS_DIR);
  process.exit(0);
}

// ── Run each test file ──────────────────────────────────────────────────────
let totalPassed = 0;
let totalFailed = 0;
const results = [];

for (const testFile of TEST_FILES) {
  const label = path.relative(ROOT, testFile);
  process.stdout.write(`\n▶ ${label}\n`);

  try {
    const output = execFileSync(process.execPath, [testFile], {
      encoding: 'utf8',
      cwd: ROOT,
      timeout: 30_000,
    });

    process.stdout.write(output);

    // Parse summary line: "<N> passed, <M> failed"
    const match = output.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
    if (match) {
      const passed = parseInt(match[1], 10);
      const failed = parseInt(match[2], 10);
      totalPassed += passed;
      totalFailed += failed;
      results.push({ label, passed, failed, ok: failed === 0 });
    } else {
      // No summary line found — treat as 1 implicit test passed
      totalPassed += 1;
      results.push({ label, passed: 1, failed: 0, ok: true });
    }
  } catch (err) {
    process.stdout.write(err.stdout || '');
    process.stderr.write(err.stderr || '');
    totalFailed += 1;
    results.push({ label, passed: 0, failed: 1, ok: false, error: err.message });
  }
}

// ── Final summary ───────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log('TEST SUMMARY');
console.log('─'.repeat(60));
for (const r of results) {
  const icon = r.ok ? '✅' : '❌';
  console.log(`${icon}  ${r.label}  (${r.passed} passed, ${r.failed} failed)`);
}
console.log('─'.repeat(60));
console.log(`TOTAL: ${totalPassed} passed, ${totalFailed} failed`);
console.log('═'.repeat(60));

process.exit(totalFailed > 0 ? 1 : 0);
