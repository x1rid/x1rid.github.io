#!/usr/bin/env node
/**
 * Zero-dependency tests for Profile Isolation & Persistence Safety.
 * Tests:
 * 1. Independent VFS database opening per profile namespace (owner vs guest)
 * 2. Profile state validation and sanitization
 * 3. Concurrent queueSave serialization per profile
 * 4. State flush ensuring durability before switch
 * Run: node tests/profile-isolation.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

function createEnvironment() {
  const store = new Map();
  const session = new Map();
  const local = new Map();

  class MemoryProfileDB {
    async init() { return this; }
    async getProfile(id) { return store.get('prof:' + id) || null; }
    async getAllProfiles() {
      const res = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith('prof:')) res.push(v);
      }
      return res;
    }
    async putProfile(profile) {
      store.set('prof:' + profile.id, JSON.parse(JSON.stringify(profile)));
      return profile;
    }
    async getState(profileId) { return store.get('state:' + profileId) || null; }
    async putState(record) {
      store.set('state:' + record.profileId, JSON.parse(JSON.stringify(record)));
      return record;
    }
  }

  const windowStub = {
    ProfileDB: MemoryProfileDB,
    crypto: nodeCrypto.webcrypto,
    TextEncoder,
    TextDecoder,
    btoa: (v) => Buffer.from(v, 'binary').toString('base64'),
    atob: (v) => Buffer.from(v, 'base64').toString('binary'),
    setTimeout,
    clearTimeout,
    sessionStorage: {
      getItem: (k) => session.get(k) || null,
      setItem: (k, v) => session.set(k, String(v)),
      removeItem: (k) => session.delete(k)
    },
    localStorage: {
      getItem: (k) => local.get(k) || null,
      setItem: (k, v) => local.set(k, String(v)),
      removeItem: (k) => local.delete(k)
    },
    document: {
      documentElement: {
        classList: { contains: () => false, add: () => {}, remove: () => {} },
        dataset: {}
      },
      getElementById: () => null,
      dispatchEvent: () => true,
      addEventListener: () => {}
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    console
  };
  windowStub.window = windowStub;
  windowStub.globalThis = windowStub;

  const context = vm.createContext({
    window: windowStub,
    document: windowStub.document,
    globalThis: windowStub,
    console,
    CustomEvent: windowStub.CustomEvent,
    TextEncoder,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Promise,
    Map,
    Set
  });

  function load(relative) {
    const file = path.join(ROOT, relative);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: relative });
  }

  load('main/profile/profile-service.js');
  load('main/profile/persistence-service.js');

  return { window: windowStub, store };
}

async function runProfileTests() {
  console.log('--- Phase 3: Profile Isolation & Persistence Safety Tests ---');

  const env = createEnvironment();
  await env.window.ProfileService.init();

  const ps = env.window.PersistenceService;

  // 1. Profile State Isolation: Saving to 'guest' does not mutate 'owner'
  const guestState = await ps.loadProfileState('guest');
  guestState.settings.theme = 'solar';
  await ps.saveProfileState('guest', guestState);

  const ownerState = await ps.loadProfileState('owner');
  equal(ownerState.settings.theme, 'plum', 'Owner profile preserves default theme while guest has custom theme');
  const loadedGuest = await ps.loadProfileState('guest');
  equal(loadedGuest.settings.theme, 'solar', 'Guest profile persisted custom theme');

  // 2. QueueSave Debounced Commit & Flush
  const p1 = ps.queueSave('owner', { settings: { musicVolume: 80 } });
  const p2 = ps.queueSave('owner', { settings: { soundEnabled: false } });

  // Flush commits immediately
  await ps.flush('owner');
  await Promise.all([p1, p2]);

  const flushedOwner = await ps.loadProfileState('owner');
  equal(flushedOwner.settings.musicVolume, 80, 'Flushed queued musicVolume update committed');
  equal(flushedOwner.settings.soundEnabled, false, 'Flushed queued soundEnabled update committed');

  // 3. Schema & Input Sanitization
  const corruptInput = {
    schemaVersion: 999,
    settings: {
      musicVolume: 'invalid_number'
    },
    maliciousScript: '<script>alert(1)</script>'
  };

  await ps.saveProfileState('owner', corruptInput);
  const sanitized = await ps.loadProfileState('owner');
  equal(sanitized.schemaVersion, 4, 'Schema version remains locked to STATE_VERSION');
  equal(sanitized.settings.musicVolume, 45, 'Invalid volume sanitized to fallback');
  equal(sanitized.maliciousScript, undefined, 'Unknown arbitrary properties stripped on validate');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('Failures:\n - ' + failures.join('\n - '));
    process.exitCode = 1;
  }
}

runProfileTests().catch(err => {
  console.error('Unexpected error in profile tests:', err);
  process.exit(1);
});
