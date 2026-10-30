/**
 * @file tests/vfs-schema-v2.test.js
 * @description Phase 2.3 — VFS schema v2 tests.
 *
 * Verifies:
 * 1. VFS_TYPES exposes VFS_SCHEMA_VERSION = 2 and DefaultMode constants.
 * 2. migrate_v1_to_v2 back-fills uid/gid/mode/accessedAt on existing nodes.
 * 3. Freshly created nodes via VirtualFS.createFile/createDirectory carry v2 fields.
 * 4. System nodes get uid=0, gid=0, mode=0o444.
 * 5. Owner nodes get uid=1, gid=1; dirs get mode=0o755; files get mode=0o644.
 * 6. readFile updates accessedAt.
 */

(function () {
  'use strict';

  // ─── minimal in-memory stubs ──────────────────────────────────────────────

  function makeNodeStore(initialNodes) {
    const store = new Map();
    (initialNodes || []).forEach(function (n) { store.set(n.id, JSON.parse(JSON.stringify(n))); });
    return {
      getAllNodes: async function () { return Array.from(store.values()); },
      putNode: async function (node) { store.set(node.id, JSON.parse(JSON.stringify(node))); },
      deleteNode: async function (id) { store.delete(id); },
      deleteRecycleRecord: async function () {},
      getNode: function (id) { return store.get(id); }
    };
  }

  function makeContentStore() {
    const data = new Map();
    return {
      write: async function (id, content) {
        const str = typeof content === 'string' ? content : '';
        data.set(id, { kind: 'text', value: str });
        return { kind: 'text', size: str.length };
      },
      read: async function (id) { return data.get(id) || { kind: 'text', value: '' }; },
      delete: async function (id) { data.delete(id); }
    };
  }

  function makeEvents() {
    const subs = [];
    return {
      subscribe: function (fn) { subs.push(fn); return function () {}; },
      publish: function (evt) { subs.forEach(function (fn) { fn(evt); }); }
    };
  }

  function makePathResolver() {
    return {
      resolvePath: function () { return null; },
      getPath: function () { return 'C:\\'; },
      validateName: function (name) { return name && name.length > 0 ? null : 'INVALID_NAME'; }
    };
  }

  // ─── load modules ────────────────────────────────────────────────────────

  const g = typeof globalThis !== 'undefined' ? globalThis : global;

  // VFS_TYPES / FsError from types.js
  require('../main/fs/types.js');
  // VfsMigrations from migrations.js
  require('../main/fs/migrations.js');

  // Minimal stubs for dependencies VirtualFS needs
  if (!g.VfsNodeStore) g.VfsNodeStore = function () {};
  if (!g.VfsContentStore) g.VfsContentStore = function () {};
  if (!g.VfsEvents) g.VfsEvents = function () { return makeEvents(); };
  if (!g.VfsPathResolver) g.VfsPathResolver = function () { return makePathResolver(); };

  require('../main/fs/filesystem-service.js');

  // ─── test helpers ────────────────────────────────────────────────────────

  let passed = 0;
  let failed = 0;

  function assert(condition, label) {
    if (condition) {
      console.log('  ✓', label);
      passed++;
    } else {
      console.error('  ✗', label);
      failed++;
    }
  }

  function assertEq(actual, expected, label) {
    if (actual === expected) {
      console.log('  ✓', label);
      passed++;
    } else {
      console.error('  ✗', label, '| got:', actual, 'expected:', expected);
      failed++;
    }
  }

  // ─── tests ───────────────────────────────────────────────────────────────

  async function run() {
    console.log('\n=== vfs-schema-v2.test.js ===\n');

    // ── 1. VFS_TYPES constants ──────────────────────────────────────────────
    console.log('Group 1: VFS_TYPES schema v2 constants');
    const TYPES = g.VFS_TYPES;
    assert(TYPES !== undefined, 'VFS_TYPES is defined');
    assertEq(TYPES.VFS_SCHEMA_VERSION, 2, 'VFS_SCHEMA_VERSION === 2');
    assert(TYPES.DefaultMode !== undefined, 'DefaultMode exported');
    assertEq(TYPES.DefaultMode.FILE, 0o644, 'DefaultMode.FILE === 0o644');
    assertEq(TYPES.DefaultMode.DIRECTORY, 0o755, 'DefaultMode.DIRECTORY === 0o755');
    assertEq(TYPES.DefaultMode.SYSTEM, 0o444, 'DefaultMode.SYSTEM === 0o444');

    // ── 2. migrate_v1_to_v2 back-fills fields ──────────────────────────────
    console.log('\nGroup 2: migrate_v1_to_v2 back-fills uid/gid/mode/accessedAt');
    const legacyNodes = [
      { id: 'root',   name: 'This PC',         type: 'directory', parentId: null,   createdAt: 1000, modifiedAt: 2000, attributes: { readOnly: true, system: true } },
      { id: 'cdrv',   name: 'Local Disk (C:)',  type: 'directory', parentId: 'root', createdAt: 1000, modifiedAt: 2000, attributes: { readOnly: true, system: false } },
      { id: 'file1',  name: 'readme.txt',       type: 'file',      parentId: 'cdrv', createdAt: 1000, modifiedAt: 3000, attributes: { readOnly: false, system: false } }
    ];
    const ns = makeNodeStore(legacyNodes);
    await g.VfsMigrations.migrate_v1_to_v2(ns);

    const root  = ns.getNode('root');
    const cdrv  = ns.getNode('cdrv');
    const file1 = ns.getNode('file1');

    // root: system+readOnly → uid=0, gid=0, mode=0o444
    assertEq(root.uid,  0,     'root.uid === 0 (system)');
    assertEq(root.gid,  0,     'root.gid === 0 (system)');
    assertEq(root.mode, 0o444, 'root.mode === 0o444 (system read-only)');
    assert(root.accessedAt === 2000, 'root.accessedAt seeded from modifiedAt');

    // cdrv: readOnly flag only → uid=0, gid=0, mode=0o444
    assertEq(cdrv.uid,  0,     'cdrv.uid === 0 (readOnly treated as system)');
    assertEq(cdrv.mode, 0o444, 'cdrv.mode === 0o444 (readOnly)');

    // file1: normal file → uid=1, gid=1, mode=0o644
    assertEq(file1.uid,  1,     'file1.uid === 1 (owner)');
    assertEq(file1.gid,  1,     'file1.gid === 1 (owner group)');
    assertEq(file1.mode, 0o644, 'file1.mode === 0o644 (regular file)');
    assert(file1.accessedAt === 3000, 'file1.accessedAt seeded from modifiedAt');

    // ── 3. migrate_v1_to_v2 is idempotent ──────────────────────────────────
    console.log('\nGroup 3: migrate_v1_to_v2 is idempotent');
    // Run migration a second time — values should not change
    const rootModeBefore = root.mode;
    await g.VfsMigrations.migrate_v1_to_v2(ns);
    const rootAfter = ns.getNode('root');
    assertEq(rootAfter.mode, rootModeBefore, 'Second migration run does not alter mode');

    // ── 4. VirtualFS.createFile stamps v2 fields ───────────────────────────
    console.log('\nGroup 4: createFile stamps uid/gid/mode/accessedAt');
    const emptyNs = makeNodeStore([
      { id: 'dir1', name: 'Documents', type: 'directory', parentId: null,   createdAt: 1, modifiedAt: 1, accessedAt: 1, uid: 1, gid: 1, mode: 0o755, attributes: { readOnly: false, system: false } }
    ]);
    const cs = makeContentStore();
    const vfs = new g.VirtualFS({
      nodeStore: emptyNs,
      contentStore: cs,
      pathResolver: makePathResolver(),
      events: makeEvents(),
      username: 'testuser'
    });
    // Manually populate nodes map
    vfs.nodes.set('dir1', emptyNs.getNode('dir1'));

    const newFile = await vfs.createFile('dir1', 'test.txt', 'hello');
    assertEq(newFile.uid,  1,     'createFile: uid === 1');
    assertEq(newFile.gid,  1,     'createFile: gid === 1');
    assertEq(newFile.mode, 0o644, 'createFile: mode === 0o644');
    assert(typeof newFile.accessedAt === 'number' && newFile.accessedAt > 0, 'createFile: accessedAt is a number > 0');

    // ── 5. VirtualFS.createDirectory stamps v2 fields ──────────────────────
    console.log('\nGroup 5: createDirectory stamps uid/gid/mode/accessedAt');
    const newDir = await vfs.createDirectory('dir1', 'SubDir');
    assertEq(newDir.uid,  1,     'createDirectory: uid === 1');
    assertEq(newDir.gid,  1,     'createDirectory: gid === 1');
    assertEq(newDir.mode, 0o755, 'createDirectory: mode === 0o755');
    assert(typeof newDir.accessedAt === 'number' && newDir.accessedAt > 0, 'createDirectory: accessedAt is a number > 0');

    // ── 6. readFile updates accessedAt ─────────────────────────────────────
    console.log('\nGroup 6: readFile updates accessedAt');
    const oldAccessed = newFile.accessedAt;
    // Artificially age it
    newFile.accessedAt = 0;
    vfs.nodes.set(newFile.id, newFile);

    await vfs.readFile(newFile.id);
    // Give the non-blocking putNode a tick
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
    const reloaded = emptyNs.getNode(newFile.id);
    assert(reloaded.accessedAt > 0, 'readFile updated accessedAt to > 0');

    // ─── summary ─────────────────────────────────────────────────────────
    console.log('\n────────────────────────────────────────────────');
    if (failed === 0) {
      console.log(`✅  tests/vfs-schema-v2.test.js  (${passed} passed, 0 failed)`);
    } else {
      console.error(`❌  tests/vfs-schema-v2.test.js  (${passed} passed, ${failed} FAILED)`);
      process.exitCode = 1;
    }
  }

  run().catch(function (err) {
    console.error('[vfs-schema-v2] Uncaught error:', err);
    process.exitCode = 1;
  });

})();
