/**
 * @file main/kernel/fake-internet.js
 * @layer L3 — Kernel
 * @owns  window.FakeInternet
 * @needs [ 'KernelEvents' ]
 * @emits []
 *
 * Phase 5.1 — Fake Internet Route Registry.
 * Provides a URL-routing system for the virtual network. Handlers can be
 * registered at runtime. Built-in routes cover the OS store, ping, and a
 * generic homepage.
 *
 * Route matching priority: exact > prefix > wildcard (*).
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p5.1';

  // Map of host+path patterns -> handler(req) -> response
  const _routes = new Map();
  // Ordered prefix routes: [{ prefix, handler }]
  const _prefixes = [];

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  /**
   * Parse a URL string into { host, path, query }.
   * Handles both http://host/path and host/path forms.
   */
  function parseUrl(url) {
    try {
      // Normalize: add protocol if missing so URL() can parse it
      const withProto = /^https?:\/\//.test(url) ? url : 'http://' + url;
      const u = new URL(withProto);
      return { host: u.hostname, path: u.pathname, query: u.search, href: withProto };
    } catch (e) {
      // Fallback: treat as path-only on localhost
      return { host: 'localhost', path: url, query: '', href: url };
    }
  }

  /**
   * Register an exact route handler.
   * @param {string} pattern  e.g. 'store.r3dos.internal/packages'
   * @param {function} handler  (req) => { status, headers, body }
   */
  function register(pattern, handler) {
    _routes.set(pattern, handler);
  }

  /**
   * Register a prefix route handler (lower priority than exact).
   * @param {string} prefix  e.g. 'store.r3dos.internal'
   * @param {function} handler  (req) => { status, headers, body }
   */
  function registerPrefix(prefix, handler) {
    _prefixes.push({ prefix: prefix, handler: handler });
  }

  /**
   * Route a request through the registry.
   * @param {string} url
   * @param {object} req  { method, headers, body }
   * @returns {Promise<{ status, headers, body, ok }>}
   */
  async function route(url, req) {
    const parsed = parseUrl(url);
    req = Object.assign({}, req, { url: url, parsed: parsed });

    // 1. Exact match: host + path
    const exact = parsed.host + parsed.path;
    if (_routes.has(exact)) {
      return _routes.get(exact)(req);
    }
    // Also try without leading slash for convenience
    const exactSlash = parsed.host + (parsed.path === '/' ? '' : parsed.path);
    if (_routes.has(exactSlash)) {
      return _routes.get(exactSlash)(req);
    }

    // 2. Prefix match
    for (let i = 0; i < _prefixes.length; i++) {
      const p = _prefixes[i];
      if (exact.startsWith(p.prefix)) {
        return p.handler(req);
      }
    }

    // 3. 404
    return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'Not Found: ' + url, ok: false };
  }

  // ── Built-in routes ──────────────────────────────────────────────────────

  // Ping
  register('r3dos.internal/ping', function () {
    return { status: 200, headers: { 'content-type': 'text/plain' }, body: 'pong', ok: true };
  });

  // OS homepage
  register('r3dos.internal/', function () {
    return {
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<html><body><h1>r3dOS Internal Network</h1><p>Welcome to the virtual internet.</p></body></html>',
      ok: true
    };
  });

  // Package store listing
  register('store.r3dos.internal/packages', function (req) {
    const packages = _getBuiltinPackages();
    if (req.method === 'GET') {
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, packages: packages }),
        ok: true
      };
    }
    return { status: 405, headers: {}, body: 'Method Not Allowed', ok: false };
  });

  // Package install (POST /packages/install)
  register('store.r3dos.internal/packages/install', function (req) {
    if (req.method !== 'POST') {
      return { status: 405, headers: {}, body: 'Method Not Allowed', ok: false };
    }
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (e) { /* ok */ }
    const id = body.id;
    if (!id) {
      return { status: 400, headers: {}, body: 'Missing package id', ok: false };
    }
    const pkg = _getBuiltinPackages().find(function (p) { return p.id === id; });
    if (!pkg) {
      return { status: 404, headers: {}, body: 'Package not found: ' + id, ok: false };
    }
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, installed: id, version: pkg.version }),
      ok: true
    };
  });

  // Fake email send
  register('mail.r3dos.internal/send', function (req) {
    return { status: 202, headers: {}, body: JSON.stringify({ ok: true, queued: true }), ok: true };
  });

  // Fake email inbox
  register('mail.r3dos.internal/inbox', function () {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { id: 'msg-001', from: 'system@r3dos.internal', subject: 'Welcome to r3dOS!', date: new Date().toISOString(), read: false, body: 'Thanks for installing r3dOS. Explore the system.' }
        ]
      }),
      ok: true
    };
  });

  // Fake chat rooms list
  register('chat.r3dos.internal/rooms', function () {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rooms: ['#general', '#dev', '#random'] }),
      ok: true
    };
  });

  // Fake chat history
  registerPrefix('chat.r3dos.internal/history', function (req) {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ user: 'system', text: 'Welcome to ' + req.parsed.path.split('/').pop(), ts: Date.now() }] }),
      ok: true
    };
  });

  function _getBuiltinPackages() {
    return [
      { id: 'vim', name: 'Vim', version: '9.1', description: 'The ubiquitous text editor (fictional)', size: 2048 },
      { id: 'curl', name: 'curl', version: '8.4', description: 'Transfer data with URLs (virtual)', size: 512 },
      { id: 'python3', name: 'Python 3', version: '3.12', description: 'Python interpreter (fictional)', size: 30720 },
      { id: 'htop', name: 'htop', version: '3.3', description: 'Interactive process viewer (fictional)', size: 256 },
      { id: 'git', name: 'Git', version: '2.43', description: 'Fast version control (fictional)', size: 4096 }
    ];
  }

  const FakeInternet = Object.freeze({
    version: VERSION,
    ready: ready,
    register: register,
    registerPrefix: registerPrefix,
    route: route,
    diagnostics: function () {
      return { version: VERSION, exactRoutes: _routes.size, prefixRoutes: _prefixes.length };
    }
  });

  root.FakeInternet = FakeInternet;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FakeInternet: FakeInternet };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
