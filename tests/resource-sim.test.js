/**
 * @file tests/resource-sim.test.js
 * Unit tests for Phase 5.3 ResourceSim.
 */
'use strict';

const { ResourceSim } = require('../main/kernel/resource-sim.js');

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
  console.log('resource-sim.test.js');

  await test('init creates resource record for pid', async function () {
    ResourceSim.init(100, { baseCpu: 5, baseRam: 64 });
    const r = ResourceSim.get(100);
    assert(r !== null, 'Expected record');
    assert(r.pid === 100, 'Expected pid 100');
    assert(r.cpu === 5, 'Expected cpu 5');
    assert(r.ram === 64, 'Expected ram 64');
    assert(r.crashed === false, 'Expected crashed false');
  });

  await test('list returns all tracked processes', async function () {
    ResourceSim.init(101, { baseCpu: 10, baseRam: 128 });
    const list = ResourceSim.list();
    const found100 = list.find(p => p.pid === 100);
    const found101 = list.find(p => p.pid === 101);
    assert(found100 && found101, 'Expected both pids in list');
  });

  await test('tick jitters CPU and RAM values', async function () {
    ResourceSim.tick();
    const r = ResourceSim.get(100);
    assert(typeof r.cpu === 'number', 'CPU should be a number');
    assert(typeof r.ram === 'number', 'RAM should be a number');
  });

  await test('crash marks process crashed and resets cpu', async function () {
    ResourceSim.crash(100, 'Out of memory');
    const r = ResourceSim.get(100);
    assert(r.crashed === true, 'Expected crashed true');
    assert(r.crashReason === 'Out of memory', 'Expected reason');
    assert(r.cpu === 0, 'CPU should drop to 0 on crash');
  });

  await test('remove cleans up pid record', async function () {
    ResourceSim.remove(100);
    assert(ResourceSim.get(100) === null, 'Pid 100 should be removed');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
