// Run from the repo root:  node tests/phase3-kernel.test.js
const assert = require('assert');
const path = require('path');
const main = path.join(__dirname, '..', 'main');

global.KernelEvents = { events: [], emit(n, p) { this.events.push(n); }, removeByPid() {}, ready: Promise.resolve(), diagnostics() { return {}; } };
require(path.join(main, 'kernel', 'process-table.js'));
require(path.join(main, 'kernel', 'syscalls.js'));
require(path.join(main, 'app-registry.js'));

const PT = global.KernelProcessTable;
const K = global.Kernel;
const KS = global.KernelSyscalls;
let passed = 0;
async function t(name, fn) { await fn(); passed += 1; console.log('  ok  ' + name); }
async function rejectsWith(p, code) {
  try { await p; } catch (e) { assert.strictEqual(e.code, code); return; }
  assert.fail('expected ' + code);
}

(async () => {
  await t('spawn is default-deny and snapshots are copies', async () => {
    const p = PT.spawn({ appId: 'a' });
    assert.deepStrictEqual(p.caps, []);
    p.caps.push('hack');
    assert.deepStrictEqual(PT.get(p.pid).caps, []);
  });

  await t('denied syscall -> CAPABILITY_DENIED + audit entry', async () => {
    const p = PT.spawn({ appId: 'a', caps: ['fs.read:user'] });
    await rejectsWith(K.syscall({ pid: p.pid, uid: 'owner' }, 'fs.write', { path: 'x', content: '' }), 'CAPABILITY_DENIED');
    const last = KS.auditLog().pop();
    assert.strictEqual(last.result, 'deny');
    assert.strictEqual(last.cap, 'fs.write:user');
  });

  await t('granted cap works, stats count syscalls', async () => {
    const p = PT.spawn({ appId: 'b', caps: ['sys.clipboard'] });
    const ctx = { pid: p.pid, uid: 'owner' };
    await K.syscall(ctx, 'sys.clipboard.set', { text: 'hi' });
    const r = await K.syscall(ctx, 'sys.clipboard.get', {});
    assert.strictEqual(r.value.text, 'hi');
    assert.strictEqual(PT.get(p.pid).stats.syscalls, 2);
  });

  await t('forged ctx.caps cannot beat the process table', async () => {
    const p = PT.spawn({ appId: 'c', caps: [] });
    await rejectsWith(K.syscall({ pid: p.pid, uid: 'owner', caps: ['*'] }, 'sys.info', {}), 'CAPABILITY_DENIED');
  });

  await t('legacy wildcard grants everything', async () => {
    const p = PT.spawn({ appId: 'legacy', caps: ['*'] });
    const r = await K.syscall({ pid: p.pid, uid: 'owner' }, 'sys.info', {});
    assert.ok(r.value.processCount > 0);
  });

  await t('proc.spawn cannot escalate caps', async () => {
    const p = PT.spawn({ appId: 'd', caps: ['proc.spawn', 'sys.clipboard'] });
    const ctx = { pid: p.pid, uid: 'owner' };
    await rejectsWith(K.syscall(ctx, 'proc.spawn', { appId: 'kid', caps: ['fs.write:user'] }), 'CAPABILITY_DENIED');
    const ok = await K.syscall(ctx, 'proc.spawn', { appId: 'kid', caps: ['sys.clipboard'] });
    assert.deepStrictEqual(ok.value.caps, ['sys.clipboard']);
    assert.strictEqual(ok.value.ppid, p.pid);
  });

  await t('settings round trip + validation', async () => {
    const p = PT.spawn({ appId: 'e', caps: ['sys.settings:read', 'sys.settings:write'] });
    const ctx = { pid: p.pid, uid: 'owner' };
    await K.syscall(ctx, 'sys.settings.set', { values: { 'appearance.theme': 'light' } });
    const r = await K.syscall(ctx, 'sys.settings.get', { key: 'appearance.theme' });
    assert.strictEqual(r.value.value, 'light');
    await rejectsWith(K.syscall(ctx, 'sys.settings.set', { key: 'bad key!', value: 1 }), 'EINVAL');
    assert.ok(global.KernelEvents.events.includes('sys:settings-changed'));
  });

  await t('proc.list accepts direct filter', async () => {
    const p = PT.spawn({ appId: 'f', caps: ['proc.list'] });
    const r = await K.syscall({ pid: p.pid, uid: 'owner' }, 'proc.list', { appId: 'f' });
    assert.strictEqual(r.value.length, 1);
  });

  await t('SIGTERM veto works exactly once', async () => {
    const p = PT.spawn({ appId: 'g' });
    PT.onSignal(p.pid, 'SIGTERM', () => true);
    PT.signal(p.pid, 'SIGTERM');
    assert.strictEqual(PT.get(p.pid).state, 'running');
    PT.signal(p.pid, 'SIGTERM');
    assert.strictEqual(PT.get(p.pid).state, 'exited');
  });

  await t('async veto + handler returning false exits', async () => {
    const a = PT.spawn({ appId: 'h1' });
    PT.onSignal(a.pid, 'SIGTERM', async () => true);
    PT.signal(a.pid, 'SIGTERM');
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(PT.get(a.pid).state, 'running');
    const b = PT.spawn({ appId: 'h2' });
    PT.onSignal(b.pid, 'SIGTERM', () => false);
    PT.signal(b.pid, 'SIGTERM');
    assert.strictEqual(PT.get(b.pid).state, 'exited');
  });

  await t('SIGKILL ignores handlers', async () => {
    const p = PT.spawn({ appId: 'i' });
    PT.onSignal(p.pid, 'SIGTERM', () => true);
    PT.signal(p.pid, 'SIGKILL');
    assert.strictEqual(PT.get(p.pid).state, 'exited');
    assert.strictEqual(PT.get(p.pid).exitCode, -9);
  });

  await t('crash -> zombie + proc:crashed, kill reaps', async () => {
    const p = PT.spawn({ appId: 'j' });
    PT.crash(p.pid, new Error('boom'));
    assert.strictEqual(PT.get(p.pid).state, 'zombie');
    assert.ok(global.KernelEvents.events.includes('proc:crashed'));
    PT.kill(p.pid);
    assert.strictEqual(PT.get(p.pid).state, 'exited');
    assert.strictEqual(PT.get(p.pid).exitCode, -1);
  });

  await t('closing the last window ends an app process; reaper closes windows on kill', async () => {
    const p = PT.spawn({ appId: 'k', windows: ['w-1'] });
    PT.detachWindow('w-1');
    assert.strictEqual(PT.get(p.pid).state, 'exited');
    let reaped = null;
    PT.setReaper((rec, wins) => { reaped = wins; });
    const q = PT.spawn({ appId: 'l', windows: ['w-2'] });
    PT.kill(q.pid);
    assert.deepStrictEqual(reaped, ['w-2']);
    PT.setReaper(null);
  });

  await t('audit mode logs but allows', async () => {
    const p = PT.spawn({ appId: 'm' });
    KS.setCapabilityMode('audit');
    await K.syscall({ pid: p.pid, uid: 'owner' }, 'sys.info', {});
    assert.strictEqual(KS.auditLog().pop().result, 'would-deny');
    KS.setCapabilityMode('enforce');
  });

  await t('manifest validation', async () => {
    const R = global.AppRegistry;
    const good = { manifestVersion: 1, id: 'notepad', name: 'Notepad', entry: 'main.js', capabilities: ['fs.read:user'] };
    assert.ok(R.validateManifest(good).ok);
    assert.ok(!R.validateManifest(Object.assign({}, good, { entry: '../evil.js' })).ok);
    assert.ok(!R.validateManifest(Object.assign({}, good, { entry: 'https://x.io/a.js' })).ok);
    assert.ok(!R.validateManifest(Object.assign({}, good, { capabilities: ['*'] })).ok);
    assert.ok(!R.validateManifest(Object.assign({}, good, { manifestVersion: 2 })).ok);
    assert.ok(!R.validateManifest(Object.assign({}, good, { id: 'Bad Id' })).ok);
  });

  await t('legacy inline app still launches and gets wildcard caps', async () => {
    const R = global.AppRegistry;
    const win = { id: 'legacy-1', closed: false, onClose: null };
    R.register({ id: 'calc', name: 'Calc', launch: () => win });
    R.launch('calc');
    const pid = R.running()[0].pid;
    assert.deepStrictEqual(PT.get(pid).caps, ['*']);
    win.onClose();
    assert.strictEqual(PT.get(pid).state, 'exited');
  });

  console.log('\n' + passed + ' tests passed');
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
