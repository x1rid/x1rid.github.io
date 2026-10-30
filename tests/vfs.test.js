#!/usr/bin/env node
/**
 * Zero-dependency tests for the Virtual Filesystem (VFS).
 * Tests node store, content store, path resolver, lifecycle events,
 * and VirtualFS operations (create, read, write, rename, move, delete, recycle, restore).
 * Run: node tests/vfs.test.js
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

/**
 * Creates an in-memory IndexedDB mock supporting stores and indices needed by VFS:
 * - nodes (id, parentId index, name index)
 * - file-contents (id)
 * - recycle-bin (id)
 */
function createMockIndexedDB() {
  const databases = new Map();

  class MockIDBRequest {
    constructor() {
      this.result = null;
      this.error = null;
      this.onsuccess = null;
      this.onerror = null;
    }
    _succeed(res) {
      this.result = res;
      if (typeof this.onsuccess === 'function') {
        this.onsuccess({ target: this });
      }
    }
    _fail(err) {
      this.error = err;
      if (typeof this.onerror === 'function') {
        this.onerror({ target: this });
      }
    }
  }

  class MockObjectStore {
    constructor(dataMap, indices) {
      this._data = dataMap;
      this._indices = indices || new Map();
    }
    get(key) {
      const req = new MockIDBRequest();
      queueMicrotask(() => {
        const item = this._data.get(key);
        req._succeed(item ? JSON.parse(JSON.stringify(item)) : undefined);
      });
      return req;
    }
    put(value) {
      const req = new MockIDBRequest();
      queueMicrotask(() => {
        const copy = JSON.parse(JSON.stringify(value));
        this._data.set(copy.id, copy);
        req._succeed(copy.id);
      });
      return req;
    }
    delete(key) {
      const req = new MockIDBRequest();
      queueMicrotask(() => {
        this._data.delete(key);
        req._succeed(undefined);
      });
      return req;
    }
    getAll() {
      const req = new MockIDBRequest();
      queueMicrotask(() => {
        const items = Array.from(this._data.values()).map(v => JSON.parse(JSON.stringify(v)));
        req._succeed(items);
      });
      return req;
    }
    createIndex(name) {
      this._indices.set(name, true);
    }
    index(name) {
      return {
        getAll: (val) => {
          const req = new MockIDBRequest();
          queueMicrotask(() => {
            const matches = Array.from(this._data.values())
              .filter(item => item[name] === val)
              .map(v => JSON.parse(JSON.stringify(v)));
            req._succeed(matches);
          });
          return req;
        }
      };
    }
  }

  class MockDatabase {
    constructor(name) {
      this.name = name;
      this.stores = new Map();
      this.objectStoreNames = {
        contains: (s) => this.stores.has(s)
      };
    }
    createObjectStore(name) {
      const storeMap = new Map();
      const store = new MockObjectStore(storeMap);
      this.stores.set(name, storeMap);
      return store;
    }
    transaction(storeNames) {
      return {
        objectStore: (name) => {
          if (!this.stores.has(name)) {
            throw new Error('Object store not found: ' + name);
          }
          return new MockObjectStore(this.stores.get(name));
        }
      };
    }
  }

  return {
    open(name) {
      const req = new MockIDBRequest();
      queueMicrotask(() => {
        let db = databases.get(name);
        if (!db) {
          db = new MockDatabase(name);
          databases.set(name, db);
          if (typeof req.onupgradeneeded === 'function') {
            req.onupgradeneeded({ target: { result: db } });
          }
        }
        req._succeed(db);
      });
      return req;
    }
  };
}

function createEnvironment() {
  const mockIDB = createMockIndexedDB();
  const windowStub = {
    indexedDB: mockIDB,
    crypto: nodeCrypto.webcrypto,
    TextEncoder,
    TextDecoder,
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
    console
  };
  windowStub.window = windowStub;
  windowStub.globalThis = windowStub;

  const context = vm.createContext(windowStub);

  function load(relative) {
    const file = path.join(ROOT, relative);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: relative });
  }

  load('main/fs/types.js');
  load('main/fs/node-store.js');
  load('main/fs/content-store.js');
  load('main/fs/path-resolver.js');
  load('main/fs/events.js');
  load('main/fs/filesystem-service.js');
  load('main/fs/migrations.js');
  load('main/fs/init.js');

  return { window: windowStub, context };
}

async function runVfsTests() {
  console.log('--- Phase 1: Virtual Filesystem Tests ---');

  const env = createEnvironment();
  const vfs = await env.window.VFSService.open({ id: 'test-profile', dbName: 'vfs-db-test', username: 'testuser' });

  ok(vfs !== null, 'VFS initialized successfully');
  equal(vfs.profileId, 'test-profile', 'VFS profileId set properly');
  equal(vfs.username, 'testuser', 'VFS username set properly');

  // 1. Initial Tree
  const root = vfs.getNode('root');
  ok(root && root.name === 'This PC', 'Root directory "This PC" seeded');
  const cDrive = vfs.getNode('c-drive');
  ok(cDrive && cDrive.name === 'Local Disk (C:)', 'C: Drive seeded');

  // Verify Known Folders (returns node ID)
  const desktopId = vfs.getKnownFolder('desktop');
  ok(desktopId !== null, 'Desktop known folder id found');
  const desktop = vfs.getNode(desktopId);
  ok(desktop && desktop.type === 'directory', 'Desktop known folder is a directory node');

  // 2. File Creation and Content Reading
  const file1 = await vfs.createFile(desktop.id, 'hello.txt', 'Hello, World!');
  ok(file1 && file1.name === 'hello.txt', 'File created with valid name');
  equal(file1.extension, 'txt', 'File extension parsed');
  equal(file1.size, 13, 'File size matches text content length');

  const content = await vfs.readFile(file1.id);
  ok(content && content.kind === 'text', 'readFile returns payload object with kind text');
  equal(content.value, 'Hello, World!', 'readFile returns accurate text content');

  // 3. Collision Prevention
  let collisionError = null;
  try {
    await vfs.createFile(desktop.id, 'HELLO.TXT', 'Duplicate test');
  } catch (err) {
    collisionError = err;
  }
  ok(collisionError && collisionError.code === 'NAME_CONFLICT', 'Collision prevented for case-insensitive duplicate file name');

  // 4. Renaming
  const renamed = await vfs.rename(file1.id, 'greetings.txt');
  equal(renamed.name, 'greetings.txt', 'File successfully renamed');
  equal(vfs.getNode(file1.id).name, 'greetings.txt', 'In-memory cache updated after rename');

  // 5. Directory Creation & Moving
  const subDir = await vfs.createDirectory(desktop.id, 'SubFolder');
  ok(subDir && subDir.type === 'directory', 'Directory created');

  const movedFile = await vfs.move(file1.id, subDir.id);
  equal(movedFile.parentId, subDir.id, 'File parentId updated on move');
  const subChildren = vfs.getChildren(subDir.id);
  ok(subChildren.some(c => c.id === file1.id), 'Moved file appears in destination children');

  // 6. Circular Move Prevention
  const subSubDir = await vfs.createDirectory(subDir.id, 'InnerFolder');
  let circularError = null;
  try {
    await vfs.move(subDir.id, subSubDir.id);
  } catch (err) {
    circularError = err;
  }
  ok(circularError && circularError.code === 'CIRCULAR_MOVE', 'Circular directory move rejected');

  // 7. Path Resolution
  const resolved = vfs.resolvePath('C:\\Users\\testuser\\Desktop\\SubFolder\\InnerFolder');
  ok(resolved && resolved.id === subSubDir.id, 'Path resolved via Windows-style path');

  // 8. Recycle Bin & Restoration
  await vfs.delete(movedFile.id);
  const recycledNode = vfs.getNode(movedFile.id);
  equal(recycledNode.parentId, '__recycle__', 'Deleted file parent moved to __recycle__');

  const restored = await vfs.restore(movedFile.id);
  equal(restored.parentId, subDir.id, 'Restored file returned to original parent folder');

  // 9. Permanent Deletion
  await vfs.permanentlyDelete(subSubDir.id);
  equal(vfs.getNode(subSubDir.id), undefined, 'Permanently deleted folder removed from memory cache');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('Failures:\n - ' + failures.join('\n - '));
    process.exitCode = 1;
  }
}

runVfsTests().catch(err => {
  console.error('Unexpected error in VFS test suite:', err);
  process.exit(1);
});
