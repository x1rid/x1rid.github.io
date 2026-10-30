#!/usr/bin/env node
/**
 * Zero-dependency logic tests for the lock-screen/profile/persistence layer.
 * Run: node tests/lock-screen-logic.test.js
 *
 * These tests evaluate the real browser scripts against a minimal in-memory
 * ProfileDB. They do not replace the browser acceptance pass; they lock down the
 * authorization, hidden-account, and persisted-schema rules that are easy to
 * regress.
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
  ok(actual === expected, label + ' (expected ' + JSON.stringify(expected) +
    ', got ' + JSON.stringify(actual) + ')');
}

function createEnvironment() {
  const store = new Map();
  const session = new Map();

  class MemoryProfileDB {
    async init() { return this; }
    async getProfile(id) { return store.get(id) || null; }
    async getAllProfiles() { return Array.from(store.values()); }
    async putProfile(profile) { store.set(profile.id, JSON.parse(JSON.stringify(profile))); return profile; }
    async deleteProfile(id) { return store.delete(id); }
    async getState() { return null; }
    async putState() { return null; }
    async getSystemConfig() { return null; }
    async putSystemConfig() { return null; }
  }

  const documentStub = {
    dispatchEvent() { return true; },
    getElementById() { return null; },
    addEventListener() {}
  };

  const windowStub = {
    ProfileDB: MemoryProfileDB,
    crypto: nodeCrypto.webcrypto,
    TextEncoder,
    TextDecoder,
    btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
    atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
    setTimeout,
    clearTimeout,
    console,
    location: { reload() {} },
    sessionStorage: {
      getItem(key) { return session.has(key) ? session.get(key) : null; },
      setItem(key, value) { session.set(key, String(value)); },
      removeItem(key) { session.delete(key); }
    },
    localStorage: {
      getItem() { return null; },
      setItem() {}
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    }
  };
  windowStub.window = windowStub;

  const context = vm.createContext({
    window: windowStub,
    document: documentStub,
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

  return { window: windowStub, store, session, load };
}

async function profileTests() {
  const env = createEnvironment();
  env.load('main/profile/profile-service.js');
  const service = env.window.ProfileService;
  await service.init();

  const publicIds = service.getProfiles().map((profile) => profile.id).sort();
  equal(publicIds.join(','), 'guest,owner', 'public account list exposes only owner and guest');
  ok(!service.getProfiles().some((profile) => profile.type === 'administrator'),
    'public account list has no administrator type');
  ok(service.getProfile('admin') && service.getProfile('admin').type === 'administrator',
    'internal lookup can still address the hidden admin record');

  const unknown = await service.authenticate({ username: 'does-not-exist', password: 'x' });
  equal(unknown.ok, false, 'unknown username fails authentication');
  equal(unknown.profileId, undefined, 'unknown username receives no profile id');

  const adminGuess = await service.authenticate({ username: 'administrator', password: 'admin' });
  equal(adminGuess.ok, false, 'guessing an administrator username does not grant access');

  const guest = await service.authenticate({ username: 'guest', password: '' });
  equal(guest.ok, true, 'guest authenticates with no password');
  equal(guest.profileId, 'guest', 'guest resolves to the guest profile');

  const ownerBeforeSetup = await service.authenticate({ username: 'r3d1', password: 'anything' });
  equal(ownerBeforeSetup.ok, false, 'owner cannot authenticate before a password exists');
  equal(ownerBeforeSetup.reason, 'no-password', 'owner reports the setup-needed reason');

  await service.setOwnerPassword('correct-horse');
  const ownerBad = await service.authenticate({ username: 'r3d1', password: 'wrong' });
  equal(ownerBad.ok, false, 'owner rejects an incorrect password');
  const ownerGood = await service.authenticate({ username: 'r3d1', password: 'correct-horse' });
  equal(ownerGood.ok, true, 'owner accepts the correct password');
  equal(ownerGood.profileId, 'owner', 'owner resolves to the owner profile');

  const updated = await service.updateIdentity('owner', {
    displayName: 'Operator',
    username: 'operator.one'
  });
  equal(updated.username, 'operator.one', 'owner username can be customised');
  equal(updated.name, 'Operator', 'owner display name can be customised');
  const oldName = await service.authenticate({ username: 'r3d1', password: 'correct-horse' });
  equal(oldName.ok, false, 'the previous username stops working after a rename');
  const newName = await service.authenticate({ username: 'operator.one', password: 'correct-horse' });
  equal(newName.ok, true, 'the custom username authenticates');

  const duplicate = await service.updateIdentity('guest', { username: 'operator.one' }).then(
    () => null,
    (error) => error.code
  );
  equal(duplicate, 'USERNAME_TAKEN', 'usernames stay unique across accounts');

  const adminBefore = await service.authenticate({ username: 'sysadmin', password: 'hidden-pass' });
  equal(adminBefore.ok, false, 'hidden admin cannot log in before explicit setup');

  const denied = await service.enableHiddenAdmin('hidden-pass', {}).then(
    () => null,
    (error) => error.code
  );
  equal(denied, 'DEV_MODE_REQUIRED', 'hidden admin setup requires explicit development mode');

  await service.enableHiddenAdmin('hidden-pass', { dev: true });
  const adminGood = await service.authenticate({ username: 'sysadmin', password: 'hidden-pass' });
  equal(adminGood.ok, true, 'configured hidden admin authenticates through the same adapter');
  equal(adminGood.profileId, 'admin', 'hidden admin resolves to the admin profile');
  ok(!service.getProfiles().some((profile) => profile.id === 'admin'),
    'hidden admin stays absent from the public list after setup');
}

async function persistenceTests() {
  const env = createEnvironment();
  env.load('main/profile/profile-service.js');
  env.load('main/profile/persistence-service.js');
  await env.window.ProfileService.init();
  const service = env.window.PersistenceService;

  const defaults = service.defaults();
  equal(defaults.lockScreen.clock.format, '24h', 'lock-screen clock defaults to 24h');
  equal(defaults.lockScreen.animation.intensity, 'high', 'lock-screen animation defaults to high');
  equal(defaults.lockScreen.accounts.showHiddenAccounts, false,
    'hidden accounts are disabled by default');
  equal(defaults.lockScreen.widgets.enabledIds.join(','), 'fun-fact,system-message',
    'default widget set is stable');

  const validated = service.validateState({
    schemaVersion: 3,
    settings: { theme: 'plum' },
    lockScreen: {
      clock: { enabled: false, showSeconds: true, format: '12h', showDate: false },
      animation: { intensity: 'low', parallax: false, particles: false },
      widgets: { enabled: true, enabledIds: ['daily-quote', 'bogus', 'daily-quote'], rotation: 'interval' },
      accounts: { showHiddenAccounts: true },
      avatar: { kind: 'builtin', value: 'retro-pixel' },
      password: 'must-not-persist'
    }
  });

  equal(validated.lockScreen.clock.enabled, false, 'clock enabled setting persists');
  equal(validated.lockScreen.clock.showSeconds, true, 'clock seconds setting persists');
  equal(validated.lockScreen.clock.format, '12h', 'clock format persists');
  equal(validated.lockScreen.animation.intensity, 'low', 'animation intensity persists');
  equal(validated.lockScreen.animation.parallax, false, 'parallax setting persists');
  equal(validated.lockScreen.widgets.enabledIds.join(','), 'daily-quote',
    'unknown and duplicate widget ids are removed');
  equal(validated.lockScreen.widgets.rotation, 'interval', 'widget rotation persists');
  equal(validated.lockScreen.accounts.showHiddenAccounts, false,
    'hidden accounts cannot be enabled through persisted settings');
  equal(validated.lockScreen.avatar.value, 'retro-pixel', 'built-in avatar persists');
  ok(!Object.prototype.hasOwnProperty.call(validated.lockScreen, 'password'),
    'password-like fields are not persisted by the lock-screen schema');
  ok(!Object.prototype.hasOwnProperty.call(validated, 'password'),
    'password cannot be smuggled into the top-level state');

  const custom = 'data:image/webp;base64,' + Buffer.from('fake-image').toString('base64');
  const customState = service.validateState({
    lockScreen: { avatar: { kind: 'custom', value: custom } }
  });
  equal(customState.lockScreen.avatar.kind, 'custom', 'validated custom data URL persists');
  const unsafe = service.validateState({
    lockScreen: { avatar: { kind: 'custom', value: 'data:image/svg+xml;base64,PHN2Zz4=' } }
  });
  equal(unsafe.lockScreen.avatar.kind, 'builtin', 'SVG avatar uploads are rejected');
  equal(unsafe.lockScreen.avatar.value, 'default-purple', 'rejected avatar falls back safely');

  const badIntensity = service.validateState({
    lockScreen: { animation: { intensity: 'ultra' } }
  });
  equal(badIntensity.lockScreen.animation.intensity, 'high', 'invalid animation intensity falls back');
}

(async function main() {
  try {
    await profileTests();
    await persistenceTests();
  } catch (error) {
    failed += 1;
    failures.push('uncaught: ' + (error && error.stack ? error.stack : error));
    console.error(error);
  }

  console.log('---');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('FAILURES:');
    failures.forEach((failure) => console.log(' - ' + failure));
    process.exitCode = 1;
  }
})();
