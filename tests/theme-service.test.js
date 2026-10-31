/**
 * @file tests/theme-service.test.js
 * Unit tests for Phase 5.4 ThemeService and Phase 5.5 WMLayout.
 */
'use strict';

const { ThemeService } = require('../main/kernel/theme-service.js');
const { SoundService } = require('../main/kernel/sound-service.js');
const { WMLayout } = require('../main/kernel/wm-layout.js');

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
  console.log('theme-service.test.js');

  // ThemeService tests
  await test('ThemeService lists built-in themes', function () {
    const list = ThemeService.list();
    assert(Array.isArray(list), 'List should be array');
    const ids = list.map(t => t.id);
    assert(ids.includes('default'), 'Should have default theme');
    assert(ids.includes('dark'), 'Should have dark theme');
    assert(ids.includes('hacker'), 'Should have hacker theme');
    assert(ids.includes('win95'), 'Should have win95 theme');
  });

  await test('ThemeService applies theme and updates active', async function () {
    const t = await ThemeService.apply('hacker');
    assert(t.id === 'hacker', 'Returned theme id mismatch');
    assert(ThemeService.getActive() === 'hacker', 'getActive should return hacker');
    await ThemeService.apply('default');
    assert(ThemeService.getActive() === 'default', 'Should revert to default');
  });

  // SoundService tests
  await test('SoundService lists registered packs', function () {
    const packs = SoundService.list();
    assert(Array.isArray(packs), 'Packs should be array');
    assert(packs.some(p => p.id === 'silent'), 'Should have silent pack');
  });

  await test('SoundService allows registering and activating packs', function () {
    SoundService.registerPack({ id: 'retro', name: 'Retro 8-bit', sounds: {} });
    SoundService.setPack('retro');
    assert(SoundService.getActivePack() === 'retro', 'Active pack should be retro');
    SoundService.setPack('silent');
  });

  // WMLayout tests
  await test('WMLayout default is floating', function () {
    assert(WMLayout.getActive() === 'floating', 'Default should be floating');
  });

  await test('WMLayout lists built-in layouts', function () {
    const list = WMLayout.list();
    const ids = list.map(l => l.id);
    assert(ids.includes('floating'), 'Should have floating layout');
    assert(ids.includes('tiling'), 'Should have tiling layout');
    assert(ids.includes('stacked'), 'Should have stacked layout');
  });

  await test('WMLayout tiling computes grid coordinates', function () {
    WMLayout.setLayout('tiling');
    const windows = [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }, { id: 'w4' }];
    const bounds = WMLayout.describe(windows, { w: 1000, h: 800 });
    assert(bounds.length === 4, 'Should compute bounds for 4 windows');
    assert(bounds[0].w === 500, 'Expected col width 500');
    assert(bounds[0].h === 400, 'Expected row height 400');
    WMLayout.setLayout('floating');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
