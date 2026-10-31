/**
 * @file tests/net-service.test.js
 * Unit tests for Phase 5.1 NetService and FakeInternet.
 */
'use strict';

const { NetService } = require('../main/kernel/net-service.js');
const { FakeInternet } = require('../main/kernel/fake-internet.js');

global.FakeInternet = FakeInternet;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

(async function () {
  console.log('net-service.test.js');

  await test('FakeInternet routes ping', async function () {
    const res = await FakeInternet.route('http://r3dos.internal/ping', { method: 'GET' });
    assert(res.ok === true, 'Expected ok');
    assert(res.body === 'pong', 'Expected pong');
  });

  await test('FakeInternet returns 404 for unknown route', async function () {
    const res = await FakeInternet.route('http://r3dos.internal/nonexistent', { method: 'GET' });
    assert(res.status === 404, 'Expected 404');
    assert(res.ok === false, 'Expected not ok');
  });

  await test('FakeInternet serves packages list', async function () {
    const res = await FakeInternet.route('http://store.r3dos.internal/packages', { method: 'GET' });
    assert(res.status === 200, 'Expected 200');
    const data = JSON.parse(res.body);
    assert(Array.isArray(data.packages), 'Expected packages array');
    assert(data.packages.length >= 3, 'Expected >= 3 packages');
  });

  await test('NetService routes requests through FakeInternet', async function () {
    const res = await NetService.request('http://r3dos.internal/ping');
    assert(res.ok === true, 'Expected ok');
    assert(res.body === 'pong', 'Expected pong');
  });

  await test('NetService offline mode returns 503', async function () {
    NetService.setOnline(false);
    assert(!NetService.isOnline(), 'Should be offline');
    const res = await NetService.request('http://r3dos.internal/ping');
    assert(res.status === 503, 'Expected 503');
    NetService.setOnline(true);
    assert(NetService.isOnline(), 'Should be back online');
  });

  await test('Custom route can be registered and accessed', async function () {
    FakeInternet.register('r3dos.internal/custom-test', function () {
      return { status: 200, headers: {}, body: 'custom-data', ok: true };
    });
    const res = await NetService.request('http://r3dos.internal/custom-test');
    assert(res.body === 'custom-data', 'Expected custom data');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
