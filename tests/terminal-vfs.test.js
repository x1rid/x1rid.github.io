/**
 * Phase 2.1 sanity test.
 *
 * This is intentionally lightweight: it verifies that terminal.js no longer
 * contains the hardcoded fake VFS and that it uses the syscall-backed VFS
 * APIs plus structured error handling.
 *
 * Run:
 *   node tests/terminal-vfs.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Note: terminal.js lives in main/terminal.js
const terminalPath = path.join(__dirname, '..', 'main', 'terminal.js');
const source = fs.readFileSync(terminalPath, 'utf8');

assert.ok(
    !/const\s+vfs\s*=\s*\{/.test(source),
    'terminal.js must not contain a hardcoded const vfs object'
);

assert.ok(
    !/applyExternalVfs/.test(source),
    'terminal.js must not contain the fake external vfs applier'
);

assert.ok(
    !/fetch\(['"]\.\/data\/vfs\.json['"]\)/.test(source),
    'terminal.js must not fetch a fake vfs.json tree'
);

assert.ok(
    source.includes('KernelSyscalls') || source.includes('Kernel.syscall'),
    'terminal.js should call the kernel syscall layer'
);

assert.ok(
    source.includes('fs.stat'),
    'terminal.js should use fs.stat'
);

assert.ok(
    source.includes('fs.list'),
    'terminal.js should use fs.list'
);

assert.ok(
    source.includes('fs.read'),
    'terminal.js should use fs.read'
);

assert.ok(
    source.includes('fs.write'),
    'terminal.js should use fs.write'
);

assert.ok(
    source.includes('fs.remove'),
    'terminal.js should use fs.remove'
);

assert.ok(
    source.includes('touch'),
    'terminal.js should support touch'
);

assert.ok(
    source.includes('cat'),
    'terminal.js should support cat'
);

assert.ok(
    source.includes('OsError') || source.includes('FsError'),
    'terminal.js should use structured OS errors'
);

assert.ok(
    !/throw\s+['"`]/.test(source),
    'terminal.js must not throw bare string errors'
);

console.log('terminal-vfs Phase 2.1 tests passed');
