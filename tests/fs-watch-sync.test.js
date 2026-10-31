/**
 * @file tests/fs-watch-sync.test.js
 * @description Phase 2.5 acceptance tests:
 *   1. fs.watch on VirtualFS and KernelSyscalls.
 *   2. Terminal echo > file creation triggering watch callbacks.
 *   3. Explorer observer receiving watch/bus events.
 *   4. dir and ls agreement.
 *   5. /proc directory listing live processes.
 *
 * Spec: OS_FOUNDATION.md Phase 2.5:
 *   "echo hi > a.txt in bash makes a.txt appear in Explorer; ls /proc lists live PIDs; dir and ls agree."
 */

'use strict';

const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

// Platform and kernel deps
const { OsError, OsErrors } = require(path.join(ROOT, 'main/kernel/platform/errors.js'));
const { KernelClock } = require(path.join(ROOT, 'main/kernel/platform/clock.js'));
const { KernelEvents } = require(path.join(ROOT, 'main/kernel/events.js'));
const { KernelLogger } = require(path.join(ROOT, 'main/kernel/platform/logger.js'));
const { SecurityUsers } = require(path.join(ROOT, 'main/security/users.js'));
const { SecurityAudit } = require(path.join(ROOT, 'main/security/audit.js'));
const { SecurityPermissions } = require(path.join(ROOT, 'main/security/permissions.js'));
const { KernelProcessTable } = require(path.join(ROOT, 'main/kernel/process-table.js'));

global.OsError = OsError;
global.OsErrors = OsErrors;
global.KernelClock = KernelClock;
global.KernelEvents = KernelEvents;
global.KernelLogger = KernelLogger;
global.SecurityUsers = SecurityUsers;
global.SecurityAudit = SecurityAudit;
global.SecurityPermissions = SecurityPermissions;
global.KernelProcessTable = KernelProcessTable;

const { KernelSyscalls, Kernel } = require(path.join(ROOT, 'main/kernel/syscalls.js'));
global.KernelSyscalls = KernelSyscalls;
global.Kernel = Kernel;

require(path.join(ROOT, 'main/fs/types.js'));

// Mock in-memory stores for VirtualFS unit testing
class MockNodeStore {
  constructor() {
    this.nodes = new Map();
  }
  async init() {}
  async getAllNodes() {
    return Array.from(this.nodes.values());
  }
  async putNode(node) {
    this.nodes.set(node.id, Object.assign({}, node));
  }
  async deleteNode(id) {
    this.nodes.delete(id);
  }
  async getRecycleRecord() { return null; }
  async putRecycleRecord() {}
  async deleteRecycleRecord() {}
}

class MockContentStore {
  constructor() {
    this.contents = new Map();
  }
  async init() {}
  async read(id) {
    const val = this.contents.get(id);
    return val ? { kind: 'text', value: val } : null;
  }
  async write(id, content) {
    const str = String(content || '');
    this.contents.set(id, str);
    return { size: str.length, kind: 'text' };
  }
  async delete(id) {
    this.contents.delete(id);
  }
}

const { VfsPathResolver } = require(path.join(ROOT, 'main/fs/path-resolver.js'));
global.VfsPathResolver = VfsPathResolver;

// Load VirtualFS
require(path.join(ROOT, 'main/fs/events.js'));
require(path.join(ROOT, 'main/fs/filesystem-service.js'));

const VirtualFS = global.VirtualFS;

let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

async function runTests() {
  console.log('\n=== fs-watch-sync.test.js ===\n');

  // Setup VFS instance
  const nodeStore = new MockNodeStore();
  const contentStore = new MockContentStore();
  const pathResolver = new VfsPathResolver(nodeStore, { username: 'r3d1' });
  const events = new global.VfsEvents();

  const vfs = new VirtualFS({
    nodeStore,
    contentStore,
    pathResolver,
    events,
    username: 'r3d1'
  });

  await vfs.init();
  global.VFS = vfs;

  console.log('Group 1: VirtualFS.watch API');
  {
    const desktopId = vfs.getKnownFolder('desktop');
    ok(desktopId != null, 'Desktop known folder found');

    const watchedEvents = [];
    const unsub = await vfs.watch('C:\\Users\\r3d1\\Desktop', (event) => {
      watchedEvents.push(event);
    });

    ok(typeof unsub === 'function', 'vfs.watch returns an unsubscribe function');

    // Create a file under Desktop
    const createdFile = await vfs.createFile(desktopId, 'a.txt', 'hi');
    ok(createdFile && createdFile.name === 'a.txt', 'File created via VFS');
    ok(watchedEvents.length === 1, 'vfs.watch callback triggered on createFile');
    ok(watchedEvents[0].nodeId === createdFile.id, 'Watched event contains correct nodeId');

    // Update the file
    await vfs.writeFile(createdFile.id, 'hi updated');
    ok(watchedEvents.length === 2, 'vfs.watch callback triggered on writeFile');
    ok(watchedEvents[1].type === 'node-updated', 'Watched event is node-updated');

    // Unsubscribe
    unsub();
    await vfs.writeFile(createdFile.id, 'hi again');
    ok(watchedEvents.length === 2, 'No further events received after unsubscribe');
  }

  console.log('\nGroup 2: Kernel fs.watch and fs.write Syscalls');
  {
    const ctx = { pid: 1042, uid: 'owner', caps: ['fs.read:user', 'fs.write:user'] };
    const watchedEvents = [];

    const watchRes = await Kernel.syscall(ctx, 'fs.watch', {
      path: 'C:\\Users\\r3d1\\Desktop',
      callback: (ev) => {
        watchedEvents.push(ev);
      }
    });

    ok(watchRes.ok === true, 'fs.watch syscall succeeded');
    ok(typeof watchRes.value.unsubscribe === 'function', 'fs.watch returns unsubscribe handler');

    // Write file via fs.write syscall
    const writeRes = await Kernel.syscall(ctx, 'fs.write', {
      path: 'C:\\Users\\r3d1\\Desktop\\sync.txt',
      content: 'hello watch'
    });

    ok(writeRes.ok === true, 'fs.write syscall succeeded');
    ok(watchedEvents.length >= 1, 'fs.watch callback invoked via syscall write');

    watchRes.value.unsubscribe();
  }

  console.log('\nGroup 3: Explorer & Shell Synchronization');
  {
    // Simulate Explorer view listening on Desktop folder
    const desktopId = vfs.getKnownFolder('desktop');
    let explorerRefreshed = false;

    // Explorer listener logic
    const unsubExplorer = await vfs.watch('C:\\Users\\r3d1\\Desktop', (ev) => {
      if (ev.parentId === desktopId || ev.nodeId === desktopId) {
        explorerRefreshed = true;
      }
    });

    // Simulate Terminal command: echo hi > a2.txt
    const ctx = { pid: 2000, uid: 'owner', caps: ['fs.write:user'] };
    await Kernel.syscall(ctx, 'fs.write', {
      path: 'C:\\Users\\r3d1\\Desktop\\a2.txt',
      content: 'hi'
    });

    ok(explorerRefreshed === true, 'Explorer immediately refreshed when file created via terminal syscall');
    unsubExplorer();
  }

  console.log('\nGroup 4: dir and ls Agreement');
  {
    const ctx = { pid: 1001, uid: 'owner', caps: ['fs.read:user'] };
    const listRes = await Kernel.syscall(ctx, 'fs.list', { path: 'C:\\Users\\r3d1\\Desktop' });
    ok(listRes.ok === true, 'fs.list succeeded');

    const fileNames = listRes.value.map(f => f.name);
    ok(fileNames.includes('a.txt'), 'a.txt is listed');
    ok(fileNames.includes('sync.txt'), 'sync.txt is listed');
    ok(fileNames.includes('a2.txt'), 'a2.txt is listed');

    // dir and ls use same underlying list logic
    const vfsChildren = vfs.getChildren(vfs.getKnownFolder('desktop')).map(c => c.name);
    assert.deepStrictEqual(fileNames.sort(), vfsChildren.sort());
    ok(true, 'dir and ls representation agree on directory contents');
  }

  console.log('\nGroup 5: /proc Live Process Listing');
  {
    // Ensure KernelProcessTable has processes
    KernelProcessTable.spawn({ appId: 'test-app', name: 'TestProcess' });

    const procNode = pathResolver.resolvePath('/proc', vfs.nodes, 'posix');
    ok(procNode != null, '/proc virtual directory resolves');

    const procChildren = [];
    for (const node of vfs.nodes.values()) {
      if (node.parentId === procNode.id) {
        procChildren.push(node.name);
      }
    }

    ok(procChildren.length > 0, '/proc contains active processes');
    ok(procChildren.includes('1'), '/proc contains PID 1');
  }

  console.log(`\n────────────────────────────────────────────────`);
  console.log(`✅  tests/fs-watch-sync.test.js  (${passed} passed, ${failed} failed)\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
