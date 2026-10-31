'use strict';
/* Phase 3.4 guard rails for the extracted shell (main/shell/*.js).
 * Run: node tests/shell-split.test.js
 *
 * The shell files are classic scripts that share ONE global lexical scope (that is how the
 * old inline closure's bindings stay shared). This test makes sure that stays safe:
 *   1. every shell file parses,
 *   2. no top-level name is declared twice across shell files,
 *   3. no other repo script declares a colliding top-level name,
 *   4. index.html loads the files in the right order, with boot.js last,
 *   5. the windowFactory seam is present and wired.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const MAIN = path.join(__dirname, '..', 'main');
const SHELL = path.join(MAIN, 'shell');
const ORDER = ['state', 'notifications', 'desktop', 'window-host', 'programs', 'music', 'terminal-host',
    'start-menu', 'apps', 'host-bridge', 'shortcuts-host', 'boot'];

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

function read(p) { return fs.readFileSync(p, 'utf8'); }

function topLevelNames(src) {
    const names = [];
    // `let a, b;` blocks and col-0 function declarations (generated files keep top-level code at col 0)
    src.replace(/^let ([\w$,\s]+);$/gm, (_, list) => { list.split(',').forEach((n) => n.trim() && names.push(n.trim())); return ''; });
    src.replace(/^(?:async\s+)?function\s+([\w$]+)/gm, (_, n) => { names.push(n); return ''; });
    return names;
}

const own = {};
ORDER.forEach((n) => { own[n] = read(path.join(SHELL, n + '.js')); });

t('every shell file parses as a classic script', () => {
    ORDER.forEach((n) => { new vm.Script(own[n], { filename: 'shell/' + n + '.js' }); });
});

t('no top-level name is declared twice across shell files', () => {
    const seen = new Map();
    ORDER.forEach((n) => {
        topLevelNames(own[n]).forEach((name) => {
            assert.ok(!seen.has(name), `"${name}" declared in both ${seen.get(name)}.js and ${n}.js`);
            seen.set(name, n);
        });
    });
    assert.ok(seen.size > 150, 'expected the extracted shell to declare 150+ names, got ' + seen.size);
});

t('no other repo script declares a colliding top-level name', () => {
    const mine = new Set();
    ORDER.forEach((n) => topLevelNames(own[n]).forEach((x) => mine.add(x)));
    const skip = new Set(ORDER.map((n) => path.join(SHELL, n + '.js')));
    const bad = [];
    (function walk(dir) {
        fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { if (!/^(vendor|node_modules|\.git)$/.test(e.name)) walk(full); return; }
            if (!/\.js$/.test(e.name) || skip.has(full)) return;
            read(full).split('\n').forEach((line, i) => {
                const m = /^(?:async\s+)?(?:const|let|var|class|function)\s+([\w$]+)/.exec(line);
                if (m && mine.has(m[1])) bad.push(`${path.relative(MAIN, full)}:${i + 1} declares ${m[1]}`);
            });
        });
    })(MAIN);
    assert.deepStrictEqual(bad, [], 'global name collisions:\n' + bad.join('\n'));
});

t('index.html loads shell scripts in order with boot.js last', () => {
    const html = read(path.join(MAIN, 'index.html'));
    const idx = ORDER.map((n) => html.indexOf(`./shell/${n}.js`));
    idx.forEach((i, k) => assert.ok(i > 0, ORDER[k] + '.js is not referenced by index.html'));
    for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1], `${ORDER[i]}.js must load after ${ORDER[i - 1]}.js`);
    assert.ok(html.indexOf('./shell/retro-apps.js') < idx[0], 'retro-apps.js must load before the shell');
    assert.ok(html.indexOf('./shell/vendor-programs.js') < idx[0], 'vendor-programs.js must load before the shell');
    assert.ok(html.indexOf('./shell/vendor-programs.js') > html.indexOf('./shell/retro-apps.js'));
    assert.ok(!/ProfileReady\.then/.test(html), 'boot logic must not live inline in index.html any more');
    assert.ok(html.split('\n').length < 400, 'index.html should stay a thin skeleton');
});

t('boot.js waits for ProfileReady and runs every init chunk', () => {
    const boot = own['boot'];
    assert.ok(/window\.ProfileReady\.then\(shellBoot\)/.test(boot));
    const chunks = [];
    ORDER.forEach((n) => own[n].replace(/^function (shellInit_\w+)\(\)/gm, (_, c) => { chunks.push(c); return ''; }));
    assert.ok(chunks.length >= 10);
    chunks.forEach((c) => assert.ok(boot.includes(c + '();'), c + ' is never called by shellBoot'));
});

t('windowFactory seam is wired into AppRegistry.configure', () => {
    assert.ok(/function shellWindowFactory\(/.test(own['window-host']));
    assert.ok(/windowFactory:\s*shellWindowFactory/.test(own['apps']));
    const f = own['window-host'];
    ['win.root =', 'win.setTitle =', 'win.close =', 'win.focus ='].forEach((s) => assert.ok(f.includes(s), 'factory must set ' + s));
    assert.ok(!/win\.onClose\(\)/.test(f.slice(f.indexOf('function shellWindowFactory'), f.indexOf('Original inline-script', f.indexOf('function shellWindowFactory')))),
        'factory must not call onClose itself (closeWindow already does)');
});

t('os:apps-changed re-renders the launcher', () => {
    assert.ok(/addEventListener\('os:apps-changed'/.test(own['start-menu']));
});

t('DesktopShellHost keeps its public shape', () => {
    const h = own['host-bridge'];
    ['windows', 'focusWindow', 'minimizeWindow', 'restoreWindow', 'closeWindow', 'toggleMaximize', 'openExplorer',
        'openTerminal', 'openMusic', 'openPrograms', 'openProgram', 'openSearch', 'closeSearch', 'toast', 'persist',
        'getProfile', 'getSavedState', 'saveShellState', 'isMusicPlaying', 'pauseMusic', 'setMasterVolume', 'forceEndTask']
        .forEach((k) => assert.ok(new RegExp('\\b' + k + '\\b').test(h), 'DesktopShellHost lost ' + k));
});

console.log('\n' + passed + ' tests passed');
