/**
 * @file tests/unit/path-resolver.test.js
 * @description Unit tests for Phase 2.2 path dialect adapters and mount table.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const resolverPath = path.join(__dirname, '..', '..', 'main', 'fs', 'path-resolver.js');
const { VfsPathResolver } = require(resolverPath);

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

test('Windows path resolves to VFS node', () => {
  const resolver = new VfsPathResolver(null, { username: 'r3d1' });
  const nodes = makeNodes();

  const node = resolver.resolvePath(
    'C:\\Users\\r3d1\\Documents\\a.txt',
    nodes
  );

  assert.ok(node);
  assert.strictEqual(node.id, 'file-a');
});

test('POSIX home path maps to Windows-backed VFS node', () => {
  const resolver = new VfsPathResolver(null, { username: 'r3d1' });
  const nodes = makeNodes();

  // Fallback maps /home/rid to the single existing user directory r3d1.
  const node = resolver.resolvePath(
    '/home/rid/Documents/a.txt',
    nodes,
    'posix'
  );

  assert.ok(node);
  assert.strictEqual(node.id, 'file-a');
});

test('Windows path translates to POSIX home path', () => {
  const resolver = new VfsPathResolver(null, { username: 'r3d1' });
  const nodes = makeNodes();

  const posixPath = resolver.translatePath(
    'C:\\Users\\r3d1\\Documents\\a.txt',
    'posix',
    nodes
  );

  assert.strictEqual(posixPath, '/home/r3d1/Documents/a.txt');
});

test('POSIX home path translates to Windows path', () => {
  const resolver = new VfsPathResolver(null, { username: 'r3d1' });
  const nodes = makeNodes();

  const windowsPath = resolver.translatePath(
    '/home/rid/Documents/a.txt',
    'windows',
    nodes
  );

  assert.strictEqual(windowsPath, 'C:\\Users\\r3d1\\Documents\\a.txt');
});

test('/proc overlay exists', () => {
  const resolver = new VfsPathResolver(null, { username: 'r3d1' });
  const nodes = makeNodes();

  const proc = resolver.resolvePath('/proc', nodes, 'posix');

  assert.ok(proc);
  assert.strictEqual(proc.id, '__vfs_proc__');
});

test('POSIX validation allows colon but rejects slash', () => {
  const resolver = new VfsPathResolver();

  assert.strictEqual(resolver.validateName('foo:bar', 'posix'), null);
  assert.strictEqual(resolver.validateName('foo/bar', 'posix'), 'INVALID_NAME');
});

test('Windows validation rejects colon', () => {
  const resolver = new VfsPathResolver();

  assert.strictEqual(resolver.validateName('foo:bar'), 'INVALID_NAME');
});

test('canonical path uses /c/... form', () => {
  const resolver = new VfsPathResolver(null, { username: 'r3d1' });
  const nodes = makeNodes();

  const canonical = resolver.getCanonicalPath('file-a', nodes);

  assert.strictEqual(canonical, '/c/Users/r3d1/Documents/a.txt');
});

test('diagnostics returns plain JSON mount table', () => {
  const resolver = new VfsPathResolver();
  const diag = resolver.diagnostics();

  assert.strictEqual(diag.layer, 'L1');
  assert.ok(Array.isArray(diag.mounts));
  assert.ok(diag.mounts.some(m => m.mountPoint === '/mnt/c'));
  assert.ok(diag.mounts.some(m => m.mountPoint === '/proc'));
});
