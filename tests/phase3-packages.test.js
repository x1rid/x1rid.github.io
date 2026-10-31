// Run from the repo root:  node tests/phase3-packages.test.js
const assert = require('assert');
const path = require('path');
const main = path.join(__dirname, '..', 'main');

global.window = global;          // installed-app code runs as `window.OSApps.register(...)`
global.OSAutoloadApps = false;  // no network discovery in Node
// --- tiny DOM/Blob stubs so the registry's installed-app loader can run in Node ---
const styles = [];
global.Blob = class { constructor(parts) { this.code = parts.join(''); } };
const blobs = new Map();
URL.createObjectURL = (b) => { const u = 'blob:test/' + blobs.size; blobs.set(u, b); return u; };
URL.revokeObjectURL = () => {};
global.document = {
  head: { appendChild(el) {
    if (el.tagName === 'script') {
      setTimeout(() => { try { new Function(blobs.get(el.src).code)(); el.onload(); } catch (e) { el.onerror(e); } }, 0);
    } else styles.push(el);
  } },
  createElement(tag) { return { tagName: tag, setAttribute() {}, set textContent(v) { this._t = v; } }; },
  querySelectorAll() { return []; },
  dispatchEvent() {},
};
global.CustomEvent = class { constructor(n, o) { this.type = n; this.detail = o && o.detail; } };

global.KernelEvents = { events: [], emit(n) { this.events.push(n); }, removeByPid() {}, ready: Promise.resolve(), diagnostics() { return {}; } };
const DB = require(path.join(main, 'kernel', 'kernel-db.js')).KernelDB;
require(path.join(main, 'kernel', 'process-table.js'));
require(path.join(main, 'kernel', 'syscalls.js'));
const P = require(path.join(main, 'kernel', 'packages.js')).KernelPackages;
require(path.join(main, 'app-registry.js'));

const PT = global.KernelProcessTable, K = global.Kernel, R = global.AppRegistry;
let passed = 0;
async function t(name, fn) { await fn(); passed += 1; console.log('  ok  ' + name); }
async function rejectsWith(p, code) {
  try { await p; } catch (e) { assert.strictEqual(e.code, code, 'got ' + e.code + ': ' + e.message); return; }
  assert.fail('expected ' + code);
}

const manifest = { manifestVersion: 1, id: 'hello', name: 'Hello', version: '1.0.0', kind: 'app', entry: 'main.js',
  styles: ['styles.css'], icon: 'assets/icon.svg', capabilities: ['sys.clipboard', 'fs.read:user'], window: { width: 300, height: 200 } };
const files = {
  'main.js': "window.OSApps.register('hello', { async main(proc){ const w = await proc.win.open({title:'Hello'}); } });",
  'styles.css': '.x{color:red}',
  'assets/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>'
};
const pkg = P.buildPackage(manifest, files);

// fake VFS holding the .pkg
const vfsFiles = { 'C:\\pkgs\\hello.pkg': JSON.stringify(pkg), 'C:\\pkgs\\bad.pkg': '{nope' };
global.VFS = {
  resolvePath: async (p) => (vfsFiles[p] !== undefined ? { id: p, type: 'file' } : null),
  readFile: async (id) => vfsFiles[id],
};

(async () => {
  await t('kernel-db: append/list/count + schemaVersion stamp (memory backend)', async () => {
    assert.strictEqual(DB.diagnostics().backend, 'memory');
    await DB.append('audit', { call: 'fs.write', result: 'deny' });
    const rows = await DB.list('audit');
    assert.strictEqual(rows[0].schemaVersion, 1);
    assert.strictEqual(await DB.count('audit'), 1);
    assert.throws(() => DB.append('nope', {}), /Unknown kernel-db store/);
  });

  await t('denied syscall lands in kernel-db audit', async () => {
    await DB.clear('audit');
    const p = PT.spawn({ appId: 'x', caps: [] });
    await rejectsWith(K.syscall({ pid: p.pid, uid: 'owner' }, 'fs.read', { path: 'a' }), 'CAPABILITY_DENIED');
    await new Promise((r) => setTimeout(r, 5));
    const rows = await DB.list('audit');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].result, 'deny');
  });

  await t('package validation rejects traversal, wildcards, missing files', async () => {
    const bad = (mut) => P.validatePackage(mut(JSON.parse(JSON.stringify(pkg)))).ok;
    assert.ok(P.validatePackage(pkg).ok);
    assert.ok(!bad((p) => { p.manifest.entry = '../x.js'; return p; }));
    assert.ok(!bad((p) => { p.manifest.capabilities = ['*']; return p; }));
    assert.ok(!bad((p) => { delete p.files['main.js']; return p; }));
    assert.ok(!bad((p) => { p.files['evil.exe'] = 'x'; return p; }));
    assert.ok(!bad((p) => { p.pkgVersion = 2; return p; }));
  });

  await t('install requires explicit grant and a pkg.install cap', async () => {
    const noCap = PT.spawn({ appId: 'a', caps: ['fs.read:user'] });
    await rejectsWith(K.syscall({ pid: noCap.pid, uid: 'owner' }, 'pkg.install', { path: 'C:\\pkgs\\hello.pkg', grant: 'all' }), 'CAPABILITY_DENIED');
    const inst = PT.spawn({ appId: 'installer', caps: ['pkg.install', 'fs.read:user', 'sys.clipboard', 'pkg.list', 'pkg.remove'] });
    const ctx = { pid: inst.pid, uid: 'owner' };
    await rejectsWith(K.syscall(ctx, 'pkg.install', { path: 'C:\\pkgs\\hello.pkg' }), 'EINVAL');
    await rejectsWith(K.syscall(ctx, 'pkg.install', { path: 'C:\\pkgs\\bad.pkg', grant: 'all' }), 'EINVAL');
  });

  await t('installer cannot grant caps it does not hold', async () => {
    const inst = PT.spawn({ appId: 'installer2', caps: ['pkg.install', 'fs.read:user'] });
    await rejectsWith(K.syscall({ pid: inst.pid, uid: 'owner' }, 'pkg.install', { path: 'C:\\pkgs\\hello.pkg', grant: 'all' }), 'CAPABILITY_DENIED');
  });

  await t('install -> registry loads app with GRANTED caps only', async () => {
    await R.wirePackages();
    const inst = PT.spawn({ appId: 'installer3', caps: ['pkg.install', 'fs.read:user', 'sys.clipboard', 'pkg.list', 'pkg.remove'] });
    const ctx = { pid: inst.pid, uid: 'owner' };
    const r = await K.syscall(ctx, 'pkg.install', { path: 'C:\\pkgs\\hello.pkg', grant: ['sys.clipboard'] });
    assert.strictEqual(r.value.loaded, true, r.value.loadError);
    assert.deepStrictEqual(r.value.grantedCaps, ['sys.clipboard']);
    const def = R.list().find((a) => a.id === 'hello');
    assert.ok(def && def.installed);
    assert.deepStrictEqual(def.capabilities, ['sys.clipboard']);
    assert.ok(def.icon.indexOf('data:image/svg+xml') === 0);
    assert.ok(styles.some((s) => s._t === '.x{color:red}'));
    assert.ok(KernelEvents.events.includes('pkg:installed'));
    const list = await K.syscall(ctx, 'pkg.list', {});
    assert.strictEqual(list.value[0].id, 'hello');
  });

  await t('installed app launches with its granted caps and a pid', async () => {
    const winNode = { id: 'w-hello', root: {}, closed: false, onClose: null, setTitle() {}, close() { this.closed = true; this.onClose && this.onClose(); } };
    R.configure({ windowFactory: () => winNode });
    R.launch('hello');
    await new Promise((r) => setTimeout(r, 5));
    const run = R.running().find((x) => x.appId === 'hello');
    assert.deepStrictEqual(PT.get(run.pid).caps, ['sys.clipboard']);
  });

  await t('built-in ids cannot be hijacked by a package', async () => {
    R.register({ id: 'calc-builtin', name: 'Calc', launch: () => ({ id: 'z' }) });
    const hijack = P.buildPackage(Object.assign({}, manifest, { id: 'calc-builtin' }), files);
    await assert.rejects(() => P.install(null, hijack, 'all'), (e) => e.code === 'EBUSY');
    assert.strictEqual(await DB.get('installed_apps', 'calc-builtin'), null);
  });

  await t('remove unregisters the app and closes its window', async () => {
    const inst = PT.spawn({ appId: 'installer4', caps: ['pkg.remove'] });
    await K.syscall({ pid: inst.pid, uid: 'owner' }, 'pkg.remove', { id: 'hello' });
    assert.ok(!R.has('hello'));
    assert.strictEqual(R.running().filter((x) => x.appId === 'hello').length, 0);
    await rejectsWith(K.syscall({ pid: inst.pid, uid: 'owner' }, 'pkg.remove', { id: 'hello' }), 'ENOENT');
  });

  console.log('\n' + passed + ' tests passed');
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
