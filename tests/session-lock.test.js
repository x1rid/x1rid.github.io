'use strict';
/**
 * GNOME-style active-session lock: state machine, clock formatting and the
 * ProfileService session-lock API (lockSession / unlockSession) that reuses
 * ProfileService.authenticate.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) { passed += 1; console.log('  \u2713 ' + message); }
  else { failed += 1; console.error('  \u2717 ' + message); }
}
function equal(actual, expected, message) {
  ok(actual === expected, message + (actual === expected ? '' : ' (got ' + JSON.stringify(actual) + ')'));
}

function createEnvironmentBase() {
  const local = new Map();
  const session = new Map();
  const storage = (map) => ({
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  });
  const events = [];
  const profiles = new Map();
  class MemoryProfileDB {
    async init() { return this; }
    async getProfile(id) { return profiles.get(id) || null; }
    async getAllProfiles() { return Array.from(profiles.values()); }
    async putProfile(profile) { profiles.set(profile.id, JSON.parse(JSON.stringify(profile))); return profile; }
    async deleteProfile(id) { return profiles.delete(id); }
    async getState() { return null; }
    async putState() { return null; }
    async getSystemConfig() { return null; }
    async putSystemConfig() { return null; }
  }
  const documentStub = {
    dispatchEvent(event) { events.push(event); return true; },
    getElementById() { return null; },
    addEventListener() {}
  };
  const windowStub = {
    ProfileDB: MemoryProfileDB,
    TextEncoder,
    TextDecoder,
    btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
    atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
    localStorage: storage(local),
    sessionStorage: storage(session),
    crypto: webcrypto,
    isSecureContext: true,
    location: { reload() {} },
    addEventListener() {},
    dispatchEvent(event) { events.push(event); return true; },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    }
  };
  windowStub.window = windowStub;
  return { windowStub, documentStub, session, events, context: null };
}

function createEnvironmentContext(withDocument) {
  const base = createEnvironmentBase();
  const windowStub = base.windowStub;
  const session = base.session;
  const events = base.events;
  const documentStub = withDocument ? base.documentStub : undefined;
  const context = vm.createContext({
    window: windowStub, globalThis: windowStub, document: documentStub, console,
    CustomEvent: windowStub.CustomEvent, TextEncoder, TextDecoder, URL, Intl,
    setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number,
    Boolean, RegExp, Error, Promise, Map, Set
  });
  return {
    window: windowStub,
    document: documentStub,
    session,
    events,
    load(relative) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, relative), 'utf8'), context, { filename: relative });
    }
  };
}

function stateMachineTests(SessionLock) {
  console.log('\n[session-lock] state machine');
  const S = SessionLock.LOCK_STATES;
  const P = SessionLock.PRESENTATION_STATES;
  equal(Object.keys(S).join(','), 'UNLOCKED,LOCKING,LOCKED,AUTHENTICATING,AUTH_FAILED,UNLOCKING',
    'exposes the six lock states');
  equal(S.AUTH_FAILED, 'auth_failed', 'AUTH_FAILED value matches spec');
  equal(P.CLOCK + ',' + P.AUTHENTICATION, 'clock,authentication', 'exposes the two presentation states');

  const changes = [];
  const m = SessionLock.createStateMachine((state, presentation) => changes.push(state + '/' + presentation));
  equal(m.state, S.UNLOCKED, 'starts unlocked');
  ok(!m.isLocked(), 'unlocked machine reports not locked');
  ok(!m.setPresentation(P.AUTHENTICATION), 'cannot reveal auth while unlocked');
  ok(!m.transition(S.UNLOCKING), 'cannot unlock from unlocked');
  ok(!m.transition(S.AUTHENTICATING), 'cannot authenticate from unlocked');
  ok(m.transition(S.LOCKING), 'unlocked -> locking');
  ok(m.isLocked(), 'locking counts as locked (input shielded)');
  ok(!m.setPresentation(P.AUTHENTICATION), 'auth cannot be revealed mid-lock animation');
  ok(m.transition(S.LOCKED), 'locking -> locked');
  equal(m.presentation, P.CLOCK, 'locked starts in clock presentation');
  ok(!m.transition(S.UNLOCKING), 'locked cannot skip authentication to unlock');
  ok(!m.transition(S.UNLOCKED), 'locked cannot jump to unlocked');
  ok(m.setPresentation(P.AUTHENTICATION), 'interaction reveals authentication');
  ok(m.setPresentation(P.CLOCK), 'escape returns to clock');
  ok(m.setPresentation(P.AUTHENTICATION), 'reveal again');
  ok(m.transition(S.AUTHENTICATING), 'locked -> authenticating');
  ok(!m.setPresentation(P.CLOCK), 'cannot hide auth while a check is in flight');
  ok(m.transition(S.AUTH_FAILED), 'authenticating -> auth_failed');
  equal(m.presentation, P.AUTHENTICATION, 'failure keeps the auth presentation');
  ok(m.transition(S.AUTHENTICATING), 'auth_failed -> authenticating (retry)');
  ok(m.transition(S.AUTH_FAILED), 'second failure');
  ok(m.setPresentation(P.CLOCK), 'escape after failure');
  equal(m.state, S.LOCKED, 'escape after failure returns state to locked');
  m.setPresentation(P.AUTHENTICATION);
  m.transition(S.AUTHENTICATING);
  ok(m.transition(S.UNLOCKING), 'authenticating -> unlocking');
  ok(!m.setPresentation(P.CLOCK), 'presentation frozen while unlocking');
  ok(m.transition(S.UNLOCKED), 'unlocking -> unlocked');
  equal(m.presentation, P.CLOCK, 'unlocked resets presentation to clock');
  ok(m.transition(S.LOCKED), 'unlocked -> locked directly (refresh restore)');
  ok(changes.length > 10, 'state changes are reported to the observer');
}

function formattingTests(SessionLock) {
  console.log('\n[session-lock] clock formatting');
  const date = new Date(2026, 10, 1, 5, 7, 9);
  equal(SessionLock.formatTime(date, { format: '24h' }, 'en-US'), '05:07', '24h format pads hour');
  equal(SessionLock.formatTime(new Date(2026, 10, 1, 0, 3), { format: '24h' }, 'en-US'), '00:03',
    '24h midnight renders 00, not 24');
  const twelve = SessionLock.formatTime(date, { format: '12h' }, 'en-US').replace(/\s/g, ' ');
  equal(twelve, '5:07 AM', '12h format uses unpadded hour and AM/PM');
  equal(SessionLock.formatTime(date, { format: '24h', showSeconds: true }, 'en-US'), '05:07:09',
    'seconds preference is honoured');
  equal(SessionLock.formatDate(date, 'en-US'), 'Sunday, November 1', 'date shows weekday, month, day');
}

async function serviceTests() {
  console.log('\n[session-lock] ProfileService session lock');
  const env = createEnvironmentContext(true);
  env.window.document = env.document;
  env.load('main/profile/profile-service.js');
  const service = env.window.ProfileService;
  await service.init();
  // Mirrors profile/boot.js: resolve then remember the booting profile.
  service._rememberActive(service.resolveActive());

  // Guest session.
  equal(service.getActiveProfile().id, 'guest', 'fresh boot resolves guest');
  ok(service.lockSession('guest'), 'guest session can be screen-locked');
  equal(service.peekSessionLock(), 'guest', 'lock marker records only the profile id');
  equal(env.session.get('desktop.sessionLock'), 'guest', 'marker lives in sessionStorage (no new database)');
  ok(service.isSessionLocked('guest'), 'isSessionLocked reflects the marker');
  const guestUnlock = await service.unlockSession('');
  ok(guestUnlock.ok, 'guest unlocks without a password');
  equal(service.peekSessionLock(), null, 'successful unlock clears the marker');
  equal(service.getActiveProfile().id, 'guest', 'unlock does not change the active profile');

  ok(!service.lockSession('owner'), 'cannot screen-lock a profile that is not active');

  // Owner session.
  await service.setOwnerPassword('correct horse');
  service._rememberActive(service.getProfile('owner'));
  equal(service.getActiveProfile().id, 'owner', 'owner session active');
  ok(service.lockSession(), 'owner session screen-locks the active profile by default');
  ok(service.isUnlocked('owner'), 'session lock does not tear down the owner session (no reload to guest)');
  const wrong = await service.unlockSession('nope');
  equal(wrong.ok, false, 'wrong password is rejected');
  equal(wrong.reason, 'invalid-credentials', 'failure reason is generic');
  equal(service.peekSessionLock(), 'owner', 'wrong password keeps the session locked');
  const empty = await service.unlockSession('');
  equal(empty.ok, false, 'empty password is rejected for owner');
  const right = await service.unlockSession('correct horse');
  ok(right.ok, 'correct owner password unlocks');
  equal(right.profileId, 'owner', 'unlock reports the active profile');
  equal(service.getActiveProfile().id, 'owner', 'owner remains the active profile after unlock');
  ok(env.events.some((e) => e.type === 'profile:session-unlocked'), 'emits profile:session-unlocked');

  // Marker for a different profile never unlocks the active one.
  env.session.set('desktop.sessionLock', 'guest');
  const mismatch = await service.unlockSession('correct horse');
  equal(mismatch.ok, false, 'marker / active profile mismatch fails closed');
  service.clearSessionLock();
  env.session.set('desktop.sessionLock', 'bogus');
  equal(service.peekSessionLock(), null, 'unknown marker ids are ignored');
  service.clearSessionLock();

  // Hidden administrator stays out of public projections.
  ok(!service.getProfiles().some((p) => p.type === 'administrator'),
    'administrator remains hidden from public profile list');
  const verifierLeak = JSON.stringify(service.getActiveProfile());
  ok(verifierLeak.indexOf('auth') === -1 && verifierLeak.indexOf('correct horse') === -1,
    'active profile projection exposes no verifier or password');
}

function wiringTests() {
  console.log('\n[session-lock] wiring');
  const host = fs.readFileSync(path.join(ROOT, 'main/shell/lock-screen-host.js'), 'utf8');
  ok(/keys:\s*\[\s*'Meta\+L'/.test(host), 'Super+L is registered through ShortcutService');
  ok(/SessionLock\.lock\(\)/.test(host), 'lockSystem delegates to SessionLock for an active session');
  const html = fs.readFileSync(path.join(ROOT, 'main/index.html'), 'utf8');
  const lockAt = html.indexOf('lock-screen/session-lock.js');
  ok(lockAt !== -1, 'index.html loads session-lock.js');
  ok(lockAt < html.indexOf('./shortcuts.js'), 'session-lock.js loads before shortcuts.js (key shield runs first)');
  ok(html.indexOf('lock-screen/session-lock.css') !== -1, 'index.html loads session-lock.css');
  const js = fs.readFileSync(path.join(ROOT, 'main/lock-screen/session-lock.js'), 'utf8');
  ok(!/innerHTML/.test(js), 'session lock renders text without innerHTML');
  ok(!/indexedDB/.test(js), 'session lock opens no database');
  ok(!/location\.reload/.test(js), 'session lock never reloads the page');
}

(async function main() {
  const env = createEnvironmentContext(false);
  env.load('main/lock-screen/session-lock.js');
  const SessionLock = env.window.SessionLock;
  ok(Boolean(SessionLock), 'SessionLock loads headlessly');
  stateMachineTests(SessionLock);
  formattingTests(SessionLock);
  await serviceTests();
  wiringTests();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})().catch((err) => { console.error(err); process.exit(1); });
