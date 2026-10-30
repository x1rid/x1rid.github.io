/**
 * @file tests/path-resolver.test.js
 * @description Phase 2.2 path dialect adapters and mount table tests.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const resolverPath = path.join(__dirname, '..', 'main', 'fs', 'path-resolver.js');
const { VfsPathResolver } = require(resolverPath);

let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) {
    passed++;
    console.log(`ok   ${message}`);
  } else {
    failed++;
    console.error(`FAIL ${message}`);
  }
}

function makeNodes() {
  const nodes = new Map();

  nodes.set('root', {
    id: 'root',
    name: 'This PC',
    type: 'directory',
    parentId: null,
    createdAt: 0,
    modifiedAt: 0,
    attributes: { hidden: false, readOnly: false, system: true }
  });

  nodes.set('c-drive', {
    id: 'c-drive',
    name: 'C:',
    type: 'directory',
    parentId: 'root',
    createdAt: 0,
    modifiedAt: 0,
    attributes: { hidden: false, readOnly: false, system: true }
  });

  nodes.set('users-dir', {
    id: 'users-dir',
    name: 'Users',
    type: 'directory',
    parentId: 'c-drive',
    createdAt: 0,
    modifiedAt: 0,
    attributes: { hidden: false, readOnly: false, system: true }
  });

  nodes.set('user-r3d1', {
    id: 'user-r3d1',
    name: 'r3d1',
    type: 'directory',
    parentId: 'users-dir',
    createdAt: 0,
    modifiedAt: 0,
    attributes: { hidden: false, readOnly: false, system: true }
  });

  nodes.set('documents-dir', {
    id: 'documents-dir',
    name: 'Documents',
    type: 'directory',
    parentId: 'user-r3d1',
    createdAt: 0,
    modifiedAt: 0,
    attributes: { hidden: false, readOnly: false, system: true }
  });

  nodes.set('file-a', {
    id: 'file-a',
    name: 'a.txt',
    type: 'file',
    parentId: 'documents-dir',
    createdAt: 0,
    modifiedAt: 0,
    attributes: { hidden: false, readOnly: false, system: false },
    mimeType: 'text/plain',
    size: 2
  });

  return nodes;
}

console.log('--- Phase 2.2: Path Dialect and Mount Table Tests ---');

// Test 1: Windows path resolution
{
  const resolver = new VfsPathResolver(null, { username: 'r3d1' });
  const nodes = makeNodes();
  const node = resolver.resolvePath('C:\\Users\\r3d1\\Documents\\a.txt', nodes);
  ok(node && node.id === 'file-a', 'Windows path resolves to VFS node');
}

// Test 2: POSIX home path mapping
{
  const resolver = new VfsPathResolver(null, { username: 'r3d1' });
  const nodes = makeNodes();
  const node = resolver.resolvePath('/home/rid/Documents/a.txt', nodes, 'posix');
  ok(node && node.id === 'file-a', 'POSIX home path maps to Windows-backed VFS node');
}

// Test 3: Windows to POSIX translation
{
  const resolver = new VfsPathResolver(null, { username: 'r3d1' });
  const nodes = makeNodes();
  const posixPath = resolver.translatePath('C:\\Users\\r3d1\\Documents\\a.txt', 'posix', nodes);
  ok(posixPath === '/home/r3d1/Documents/a.txt', 'Windows path translates to POSIX home path');
}

// Test 4: POSIX to Windows translation
{
  const resolver = new VfsPathResolver(null, { username: 'r3d1' });
  const nodes = makeNodes();
  const windowsPath = resolver.translatePath('/home/rid/Documents/a.txt', 'windows', nodes);
  ok(windowsPath === 'C:\\Users\\r3d1\\Documents\\a.txt', 'POSIX home path translates to Windows path');
}

// Test 5: /proc overlay exists
{
  const resolver = new VfsPathResolver(null, { username: 'r3d1' });
  const nodes = makeNodes();
  const proc = resolver.resolvePath('/proc', nodes, 'posix');
  ok(proc && proc.id === '__vfs_proc__', '/proc overlay exists');
}

// Test 6: POSIX filename validation
{
  const resolver = new VfsPathResolver();
  ok(resolver.validateName('foo:bar', 'posix') === null, 'POSIX validation allows colon');
  ok(resolver.validateName('foo/bar', 'posix') === 'INVALID_NAME', 'POSIX validation rejects slash');
}

// Test 7: Windows filename validation
{
  const resolver = new VfsPathResolver();
  ok(resolver.validateName('foo:bar') === 'INVALID_NAME', 'Windows validation rejects colon');
}

// Test 8: Canonical path form
{
  const resolver = new VfsPathResolver(null, { username: 'r3d1' });
  const nodes = makeNodes();
  const canonical = resolver.getCanonicalPath('file-a', nodes);
  ok(canonical === '/c/Users/r3d1/Documents/a.txt', 'canonical path uses /c/... form');
}

// Test 9: Diagnostics
{
  const resolver = new VfsPathResolver();
  const diag = resolver.diagnostics();
  ok(diag.layer === 'L1' && Array.isArray(diag.mounts) && diag.mounts.some(m => m.mountPoint === '/mnt/c'), 'diagnostics returns plain JSON mount table');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
