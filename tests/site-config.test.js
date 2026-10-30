#!/usr/bin/env node
/**
 * Zero-dependency unit tests for Site Configuration & Migration (Task 001).
 *
 * Run: node tests/site-config.test.js
 */

'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');

const configPath = path.join(ROOT, 'main/data/site-config.json');
const { VfsMigrations } = require(path.join(ROOT, 'main/fs/migrations.js'));

let passed = 0;
let failed = 0;

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

console.log('--- Task 001: Site Configuration & Identity Tests ---');

// ── 1. File existence & schemaVersion ────────────────────────────────────────
ok(fs.existsSync(configPath), 'main/data/site-config.json exists');

const raw = fs.readFileSync(configPath, 'utf8');
let parsed = null;
try {
  parsed = JSON.parse(raw);
} catch (e) {
  parsed = null;
}
ok(parsed !== null, 'site-config.json is valid JSON');
equal(parsed && parsed.schemaVersion, 1, 'schemaVersion is 1');
ok(parsed && parsed.owner && typeof parsed.owner.displayName === 'string', 'owner.displayName is defined');
ok(parsed && parsed.desktop && typeof parsed.desktop.hostname === 'string', 'desktop.hostname is defined');

// ── 2. Migration & Schema Validation ─────────────────────────────────────────
const validated = VfsMigrations.validateSiteConfig(parsed);
equal(validated.schemaVersion, 1, 'Validated schemaVersion matches 1');
equal(validated.owner.displayName, parsed.owner.displayName, 'Validated owner matches');

let caught = false;
try {
  VfsMigrations.validateSiteConfig({ invalid: true });
} catch (err) {
  caught = true;
}
ok(caught, 'Validator rejects missing schemaVersion');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
