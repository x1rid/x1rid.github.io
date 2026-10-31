/**
 * @file main/kernel/syscalls.js
 * @layer L3 — Kernel
 * @owns  window.KernelSyscalls, window.Kernel
 * @needs [ 'KernelClock', 'KernelEvents', 'KernelLogger', 'KernelProcessTable', 'SecurityPermissions', 'SecurityAudit', 'OsError' ]
 * @emits [ 'domain:verb-noun' ]
 *
 * Spec reference: OS_FOUNDATION.md §5.3, §6.1, §8 Phase 1.5 + Phase 3 (3.2 / 3.3)
 *
 * Authoritative Syscall Layer. The only door for apps to interact with OS subsystems.
 * Every syscall executes:
 *   1. Validation of arguments & context
 *   2. Capability check (Phase 3) + permission check via L2 (default-deny)
 *   3. Dispatch to underlying implementation
 *   4. Audit logging (all denials + sensitive successes)
 *   5. Event emission
 *   6. Standard return: { ok: true, value } or throws structured OsError
 *
 * Phase 3 additions:
 *   - Capability grants: ctx.pid -> process record caps. Missing cap -> CAPABILITY_DENIED.
 *     Caps look like 'fs.read:user'. '*' (legacy apps only) grants everything; 'fs.*' style
 *     prefix wildcards are supported for kernel/first-party use.
 *   - Audit: in-memory ring buffer + SecurityAudit.record + KernelDB.append('audit', ...) when 3.5 lands.
 *   - New calls: sys.info, sys.clipboard.get/set, sys.settings.get/set, net.* (simulated stubs).
 *   - proc.spawn can never grant caps the caller doesn't hold (no privilege escalation).
 *
 * Trusted callers: ctx == null or ctx.pid === 1 (init/kernel) skip capability checks.
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p3';

  const SYSCALL_HANDLERS = new Map();
  let _totalSyscalls = 0;
  let _deniedSyscalls = 0;
  let _capMode = 'enforce'; // 'enforce' | 'audit' (audit = log would-be denials but allow; for migration/debug)

  function OsErr(code, msg, detail) {
    if (root.OsError) {
      return new root.OsError(code, msg, detail);
    }
    const e = new Error(msg || code);
    e.name = 'OsError';
    e.code = code;
    e.detail = detail;
    return e;
  }

  // ── Capability model ────────────────────────────────────────────────────
  // syscall name -> capability string the caller must hold. null = open to everyone.
  const CAP_REQUIRED = {
    'fs.stat': 'fs.read:user',
    'fs.list': 'fs.read:user',
    'fs.read': 'fs.read:user',
    'fs.watch': 'fs.read:user',
    'fs.write': 'fs.write:user',
    'fs.remove': 'fs.write:user',
    'proc.list': 'proc.list',
    'proc.info': 'proc.list',
    'proc.spawn': 'proc.spawn',
    'proc.kill': 'proc.kill',
    'proc.signal': 'proc.kill',
    'sys.time': null,
    'sys.log': null,
    'sys.notify': 'sys.notify',
    'sys.info': 'sys.info',
    'sys.clipboard.get': 'sys.clipboard',
    'sys.clipboard.set': 'sys.clipboard',
    'sys.settings.get': 'sys.settings:read',
    'sys.settings.set': 'sys.settings:write',
    'sec.whoami': null,
    'sec.check': null,
    'sec.elevate': null,
    'power.sleep': null,
    'power.hibernate': null,
    'power.restart': null,
    'power.shutdown': null,
    'power.state': null,
    'net.status': 'net.simulated',
    'net.fetch': 'net.simulated'
  };

  // Phase 3 calls that are gated by capabilities only (L2 rules don't know them yet).
  // Phase 4 power + elevation calls are also cap-only (open to all � no L2 rule).
  const CAP_ONLY_CALLS = new Set([
    'sys.info', 'sys.clipboard.get', 'sys.clipboard.set',
    'sys.settings.get', 'sys.settings.set', 'net.status', 'net.fetch',
    'sec.elevate', 'power.sleep', 'power.hibernate', 'power.restart', 'power.shutdown', 'power.state'
  ]);

  // Successful calls worth an audit line.
  const AUDIT_ON_ALLOW = new Set(['fs.write', 'fs.remove', 'proc.spawn', 'proc.kill', 'proc.signal', 'sys.settings.set']);

  function requiredCap(name) {
    if (Object.prototype.hasOwnProperty.call(CAP_REQUIRED, name)) return CAP_REQUIRED[name];
    return name; // unknown/new call: default-deny, caller needs a cap named after the call
  }

  function capGranted(caps, required) {
    if (!required) return true;
    if (!Array.isArray(caps)) return false;
    for (let i = 0; i < caps.length; i += 1) {
      const c = String(caps[i]);
      if (c === required) return true;
      if (c.charAt(c.length - 1) === '*' && required.indexOf(c.slice(0, -1)) === 0) return true;
    }
    return false;
  }

  function isTrusted(ctx) {
    return !ctx || ctx.pid === 1;
  }

  // The process table is the source of truth for caps; ctx.caps is only a fallback
  // for pids the table doesn't know (unit tests, early boot).
  function resolveCaps(ctx) {
    if (ctx && typeof ctx.pid === 'number' && root.KernelProcessTable) {
      const rec = root.KernelProcessTable.get(ctx.pid);
      if (rec) return rec.caps;
    }
    return ctx && Array.isArray(ctx.caps) ? ctx.caps : [];
  }

  // ── Audit ───────────────────────────────────────────────────────────────
  const AUDIT_MAX = 500;
  const _auditBuffer = [];

  function audit(entry) {
    const rec = Object.assign({ at: root.KernelClock && root.KernelClock.now ? root.KernelClock.now() : Date.now() }, entry);
    _auditBuffer.push(rec);
    if (_auditBuffer.length > AUDIT_MAX) _auditBuffer.shift();

    if (root.SecurityAudit && typeof root.SecurityAudit.record === 'function') {
      try {
        root.SecurityAudit.record({
          action: rec.call ? rec.call.replace('.', ':') : rec.action,
          resource: rec.resource || '*',
          actor: { type: 'process', pid: rec.pid, uid: rec.uid },
          result: rec.result,
          reason: rec.reason
        });
      } catch (_) {}
    }
    // 3.5: kernel-db audit table. Safe no-op until KernelDB exists.
    if (root.KernelDB && typeof root.KernelDB.append === 'function') {
      try {
        const p = root.KernelDB.append('audit', rec);
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (_) {}
    }
  }

  // ── Register Syscall Handlers ───────────────────────────────────────────

  // ── proc.* ──────────────────────────────────────────────────────────────
  SYSCALL_HANDLERS.set('proc.list', async function (ctx, args) {
    if (!root.KernelProcessTable) throw OsErr('EBUSY', 'Process table unavailable');
    // accepts { filter: {...} } or the filter fields directly: { state:'running' }
    const filter = args && typeof args === 'object' ? (args.filter || args) : null;
    return root.KernelProcessTable.list(filter);
  });

  SYSCALL_HANDLERS.set('proc.info', async function (ctx, args) {
    if (!args || typeof args.pid !== 'number') throw OsErr('EINVAL', 'Missing pid argument');
    if (!root.KernelProcessTable) throw OsErr('EBUSY', 'Process table unavailable');
    const p = root.KernelProcessTable.get(args.pid);
    if (!p) throw OsErr('ESRCH', 'No such process', { pid: args.pid });
    return p;
  });

  SYSCALL_HANDLERS.set('proc.spawn', async function (ctx, args) {
    if (!root.KernelProcessTable) throw OsErr('EBUSY', 'Process table unavailable');
    const spec = Object.assign({}, args);
    const requested = Array.isArray(spec.caps) ? spec.caps.map(String) : [];
    const callerCaps = isTrusted(ctx) ? ['*'] : resolveCaps(ctx);

    // A process can only hand out caps it holds itself.
    const notHeld = requested.filter(function (c) { return !capGranted(callerCaps, c); });
    if (notHeld.length) {
      throw OsErr('CAPABILITY_DENIED', 'Cannot grant capabilities the caller does not hold', {
        cap: notHeld[0], denied: notHeld, pid: ctx ? ctx.pid : null
      });
    }
    spec.caps = requested;
    if (ctx && typeof ctx.pid === 'number') spec.ppid = ctx.pid;
    if (ctx && ctx.uid) spec.uid = ctx.uid; // can't spawn as someone else
    return root.KernelProcessTable.spawn(spec);
  });

  SYSCALL_HANDLERS.set('proc.kill', async function (ctx, args) {
    if (!args || typeof args.pid !== 'number') throw OsErr('EINVAL', 'Missing pid argument');
    if (args.pid <= 1) throw OsErr('EPERM', 'Cannot kill init', { pid: args.pid });
    if (!root.KernelProcessTable) throw OsErr('EBUSY', 'Process table unavailable');
    const ok = root.KernelProcessTable.kill(args.pid, args.exitCode);
    if (!ok) throw OsErr('ESRCH', 'No such process to kill', { pid: args.pid });
    return { killed: true };
  });

  SYSCALL_HANDLERS.set('proc.signal', async function (ctx, args) {
    if (!args || typeof args.pid !== 'number' || !args.signal) throw OsErr('EINVAL', 'Missing pid or signal');
    if (args.pid <= 1) throw OsErr('EPERM', 'Cannot signal init', { pid: args.pid });
    if (!root.KernelProcessTable) throw OsErr('EBUSY', 'Process table unavailable');
    const ok = root.KernelProcessTable.signal(args.pid, args.signal);
    if (!ok) throw OsErr('ESRCH', 'No such process to signal', { pid: args.pid });
    return { delivered: true };
  });

  // ── sys.* ───────────────────────────────────────────────────────────────
  SYSCALL_HANDLERS.set('sys.time', async function () {
    const clock = root.KernelClock;
    return {
      timestamp: clock ? clock.now() : Date.now(),
      iso: clock ? clock.isoNow() : new Date().toISOString()
    };
  });

  SYSCALL_HANDLERS.set('sys.log', async function (ctx, args) {
    if (!args || !args.message) throw OsErr('EINVAL', 'Missing log message');
    const logger = root.KernelLogger;
    const lvl = args.level || 'info';
    if (logger && typeof logger[lvl] === 'function') {
      logger[lvl](args.tag || ('pid:' + (ctx ? ctx.pid : '?')), args.message, args.data);
    }
    return { logged: true };
  });

  SYSCALL_HANDLERS.set('sys.notify', async function (ctx, args) {
    if (!args || !args.message) throw OsErr('EINVAL', 'Missing notification message');
    if (root.KernelEvents) {
      root.KernelEvents.emit('sys:notification', {
        title: args.title || 'System Notification',
        message: args.message,
        type: args.type || 'info'
      }, { pid: ctx ? ctx.pid : null });
    }
    return { sent: true };
  });

  SYSCALL_HANDLERS.set('sys.info', async function (ctx) {
    const clock = root.KernelClock;
    const sum = root.KernelProcessTable && typeof root.KernelProcessTable.summary === 'function'
      ? root.KernelProcessTable.summary()
      : { processCount: 0, runningCount: 0, zombieCount: 0, totalMemBytes: 0, totalSyscalls: 0 };
    return {
      name: 'OS Simulator',
      kernelVersion: VERSION,
      uid: ctx && ctx.uid ? ctx.uid : 'guest',
      timestamp: clock ? clock.now() : Date.now(),
      processCount: sum.processCount,
      runningCount: sum.runningCount,
      zombieCount: sum.zombieCount,
      totalMemBytes: sum.totalMemBytes,
      syscalls: { total: _totalSyscalls, denied: _deniedSyscalls }
    };
  });

  // Simulated clipboard (in-memory, never touches the host clipboard).
  const CLIP_MAX = 1024 * 1024;
  let _clipboard = { text: '', updatedAt: null };

  SYSCALL_HANDLERS.set('sys.clipboard.get', async function () {
    return { text: _clipboard.text, updatedAt: _clipboard.updatedAt };
  });

  SYSCALL_HANDLERS.set('sys.clipboard.set', async function (ctx, args) {
    if (!args || typeof args.text !== 'string') throw OsErr('EINVAL', 'text must be a string');
    if (args.text.length > CLIP_MAX) throw OsErr('EINVAL', 'Clipboard payload too large');
    _clipboard = { text: args.text, updatedAt: root.KernelClock && root.KernelClock.now ? root.KernelClock.now() : Date.now() };
    return { set: true, length: args.text.length };
  });

  // Settings: per-uid key/value. Interim persistence = localStorage; moves to profile-db in 3.5.
  const SETTING_KEY_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
  const SETTING_VALUE_MAX = 16 * 1024;
  const _settings = new Map(); // uid -> Map<key,value>

  function settingsFor(uid) {
    if (_settings.has(uid)) return _settings.get(uid);
    const m = new Map();
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem('os.settings.' + uid);
        if (raw) {
          const obj = JSON.parse(raw);
          Object.keys(obj).forEach(function (k) { m.set(k, obj[k]); });
        }
      }
    } catch (_) {}
    _settings.set(uid, m);
    return m;
  }

  function persistSettings(uid, m) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('os.settings.' + uid, JSON.stringify(Object.fromEntries(m)));
      }
    } catch (_) {}
  }

  SYSCALL_HANDLERS.set('sys.settings.get', async function (ctx, args) {
    const uid = String((ctx && ctx.uid) || 'owner');
    const m = settingsFor(uid);
    if (args && args.key !== undefined) {
      if (!SETTING_KEY_RE.test(String(args.key))) throw OsErr('EINVAL', 'Invalid settings key');
      const key = String(args.key);
      return { key: key, exists: m.has(key), value: m.has(key) ? m.get(key) : null };
    }
    return { settings: Object.fromEntries(m) };
  });

  SYSCALL_HANDLERS.set('sys.settings.set', async function (ctx, args) {
    if (!args || (args.key === undefined && (!args.values || typeof args.values !== 'object'))) {
      throw OsErr('EINVAL', 'Provide { key, value } or { values: {...} }');
    }
    const pairs = args.key !== undefined ? [[String(args.key), args.value]] : Object.entries(args.values);
    if (!pairs.length) throw OsErr('EINVAL', 'Nothing to set');

    const clean = [];
    pairs.forEach(function (pair) {
      const key = pair[0];
      if (!SETTING_KEY_RE.test(key)) throw OsErr('EINVAL', 'Invalid settings key: ' + key);
      let json;
      try { json = JSON.stringify(pair[1]); } catch (_) { json = undefined; }
      if (json === undefined) throw OsErr('EINVAL', 'Value for ' + key + ' is not JSON-serializable');
      if (json.length > SETTING_VALUE_MAX) throw OsErr('EINVAL', 'Value for ' + key + ' is too large');
      clean.push([key, JSON.parse(json)]);
    });

    const uid = String((ctx && ctx.uid) || 'owner');
    const m = settingsFor(uid);
    clean.forEach(function (pair) { m.set(pair[0], pair[1]); });
    persistSettings(uid, m);

    const keys = clean.map(function (p) { return p[0]; });
    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit('sys:settings-changed', { keys: keys, uid: uid }, { pid: ctx ? ctx.pid : null });
    }
    return { set: keys };
  });

  // ── net.* (simulated network only — never touches the real host network) ─
  SYSCALL_HANDLERS.set('net.status', async function () {
    return { simulated: true, online: false, interfaces: [] };
  });

  SYSCALL_HANDLERS.set('net.fetch', async function (ctx, args) {
    throw OsErr('EPERM', 'Network is simulated; real requests are not available', { url: args && args.url });
  });

  // ── sec.* ───────────────────────────────────────────────────────────────
  SYSCALL_HANDLERS.set('sec.whoami', async function (ctx) {
    const uid = ctx && ctx.uid ? ctx.uid : 'guest';
    const user = root.SecurityUsers ? root.SecurityUsers.getUser(uid) : { id: uid, role: uid === 'owner' ? 'administrator' : 'guest' };
    return { uid: uid, user: user, pid: ctx ? ctx.pid : null };
  });

  SYSCALL_HANDLERS.set('sec.check', async function (ctx, args) {
    if (!args || !args.action) throw OsErr('EINVAL', 'Missing action in check request');
    if (!root.SecurityPermissions) return { allowed: true };
    return root.SecurityPermissions.check(Object.assign({}, args, {
      user: ctx ? ctx.uid : 'guest',
      profileId: ctx ? ctx.uid : 'guest'
    }));
  });

  SYSCALL_HANDLERS.set('sec.elevate', async function (ctx, args) {
    if (!root.ElevationService) throw OsErr('ENOSYS', 'ElevationService not available');
    const result = await root.ElevationService.request(ctx ? ctx.pid : 0, args && args.reason || 'Unknown operation');
    if (!result.granted) throw OsErr('EPERM', 'Elevation denied');
    return { token: result.token };
  });

  // ── power.* ─────────────────────────────────────────────────────────────
  SYSCALL_HANDLERS.set('power.sleep', async function () {
    if (!root.PowerService) throw OsErr('ENOSYS', 'PowerService not available');
    return root.PowerService.sleep();
  });

  SYSCALL_HANDLERS.set('power.hibernate', async function () {
    if (!root.PowerService) throw OsErr('ENOSYS', 'PowerService not available');
    return root.PowerService.hibernate();
  });

  SYSCALL_HANDLERS.set('power.restart', async function () {
    if (!root.PowerService) throw OsErr('ENOSYS', 'PowerService not available');
    return root.PowerService.restart();
  });

  SYSCALL_HANDLERS.set('power.shutdown', async function () {
    if (!root.PowerService) throw OsErr('ENOSYS', 'PowerService not available');
    return root.PowerService.shutdown();
  });

  SYSCALL_HANDLERS.set('power.state', async function () {
    if (!root.PowerService) throw OsErr('ENOSYS', 'PowerService not available');
    return { state: root.PowerService.state };
  });

  // ── fs.* (Wraps VFS or mock) ───────────────────────────────────────────
  SYSCALL_HANDLERS.set('fs.stat', async function (ctx, args) {
    if (!args || !args.path) throw OsErr('EINVAL', 'Missing path argument');
    const vfs = root.VFS || (root.Kernel && root.Kernel.legacy ? root.Kernel.legacy.vfs : null);
    if (!vfs) throw OsErr('EBUSY', 'Filesystem unavailable');

    const node = await vfs.resolvePath(args.path);
    if (!node) throw OsErr('ENOENT', 'File or directory not found', { path: args.path });

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      size: node.size || 0,
      createdAt: node.createdAt,
      modifiedAt: node.modifiedAt
    };
  });

  SYSCALL_HANDLERS.set('fs.list', async function (ctx, args) {
    const vfs = root.VFS || (root.Kernel && root.Kernel.legacy ? root.Kernel.legacy.vfs : null);
    if (!vfs) throw OsErr('EBUSY', 'Filesystem unavailable');

    const targetPath = (args && args.path) || 'C:\\';
    const parentNode = await vfs.resolvePath(targetPath);
    if (!parentNode) throw OsErr('ENOENT', 'Directory not found', { path: targetPath });
    if (parentNode.type !== 'directory') throw OsErr('ENOTDIR', 'Not a directory', { path: targetPath });

    const children = vfs.getChildren(parentNode.id);
    return children.map(function (c) {
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        size: c.size || 0,
        createdAt: c.createdAt,
        modifiedAt: c.modifiedAt
      };
    });
  });

  SYSCALL_HANDLERS.set('fs.remove', async function (ctx, args) {
    if (!args || !args.path) throw OsErr('EINVAL', 'Missing path argument');
    const vfs = root.VFS || (root.Kernel && root.Kernel.legacy ? root.Kernel.legacy.vfs : null);
    if (!vfs) throw OsErr('EBUSY', 'Filesystem unavailable');

    const node = await vfs.resolvePath(args.path);
    if (!node) throw OsErr('ENOENT', 'File not found', { path: args.path });

    await vfs.delete(node.id);
    return { path: args.path, removed: true };
  });

  SYSCALL_HANDLERS.set('fs.read', async function (ctx, args) {
    if (!args || !args.path) throw OsErr('EINVAL', 'Missing path argument');
    const vfs = root.VFS || (root.Kernel && root.Kernel.legacy ? root.Kernel.legacy.vfs : null);
    if (!vfs) throw OsErr('EBUSY', 'Filesystem unavailable');

    const node = await vfs.resolvePath(args.path);
    if (!node) throw OsErr('ENOENT', 'File not found', { path: args.path });
    if (node.type === 'directory') throw OsErr('EISDIR', 'Is a directory', { path: args.path });

    const content = await vfs.readFile(node.id);
    return { path: args.path, content: content };
  });

  SYSCALL_HANDLERS.set('fs.write', async function (ctx, args) {
    if (!args || !args.path || args.content === undefined) throw OsErr('EINVAL', 'Missing path or content');
    const vfs = root.VFS || (root.Kernel && root.Kernel.legacy ? root.Kernel.legacy.vfs : null);
    if (!vfs) throw OsErr('EBUSY', 'Filesystem unavailable');

    let res;
    // Check if path exists
    let existingNode = null;
    try {
      existingNode = await vfs.resolvePath(args.path);
    } catch (_) {}

    if (existingNode) {
      if (existingNode.type === 'directory') throw OsErr('EISDIR', 'Is a directory', { path: args.path });
      res = await vfs.writeFile(existingNode.id, args.content);
    } else {
      // Create new file: resolve parent directory
      const cleanPath = String(args.path).replace(/\\/g, '/');
      const segments = cleanPath.split('/').filter(Boolean);
      const filename = segments.pop();
      const parentPath = segments.length === 0 ? '/' : (cleanPath.startsWith('/') ? '/' + segments.join('/') : segments.join('/'));

      let parentNode = null;
      try {
        parentNode = await vfs.resolvePath(parentPath);
      } catch (_) {}

      if (!parentNode) {
        // Fallback: try C:\ drive or Desktop if parent not found
        const desktopId = vfs.getKnownFolder ? vfs.getKnownFolder('desktop') : null;
        if (desktopId) {
          parentNode = vfs.getNode ? vfs.getNode(desktopId) : null;
        }
      }

      if (!parentNode) throw OsErr('ENOENT', 'Parent directory not found for ' + args.path, { path: args.path });
      res = await vfs.createFile(parentNode.id, filename, args.content);
    }

    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit('fs:file-saved', { path: args.path }, { pid: ctx ? ctx.pid : null });
    }
    return { path: args.path, written: true, node: res };
  });

  SYSCALL_HANDLERS.set('fs.watch', async function (ctx, args) {
    if (!args || !args.path) throw OsErr('EINVAL', 'Missing path argument');
    if (typeof args.callback !== 'function') throw OsErr('EINVAL', 'Missing or invalid callback argument');
    const vfs = root.VFS || (root.Kernel && root.Kernel.legacy ? root.Kernel.legacy.vfs : null);
    if (!vfs) throw OsErr('EBUSY', 'Filesystem unavailable');

    if (typeof vfs.watch !== 'function') {
      // Fallback if mock vfs only has subscribe
      if (typeof vfs.subscribe === 'function') {
        const unsub = vfs.subscribe(args.callback);
        return { path: args.path, unsubscribe: unsub };
      }
      throw OsErr('ENOSYS', 'VFS does not support watch');
    }

    const unsub = await vfs.watch(args.path, args.callback);
    return { path: args.path, unsubscribe: unsub };
  });

  // ── Core Syscall Dispatcher ─────────────────────────────────────────────
  async function syscall(ctx, callName, args) {
    _totalSyscalls += 1;
    const name = String(callName || '').trim();

    if (!SYSCALL_HANDLERS.has(name)) {
      throw OsErr('EINVAL', 'Unknown syscall: ' + name, { call: name });
    }

    const pid = ctx && typeof ctx.pid === 'number' ? ctx.pid : null;
    const uid = ctx && ctx.uid ? ctx.uid : 'guest';
    const resource = (args && (args.path || args.resource)) || '*';

    // 1. Capability check (Phase 3)
    const cap = requiredCap(name);
    if (!isTrusted(ctx) && cap && !capGranted(resolveCaps(ctx), cap)) {
      _deniedSyscalls += 1;
      const enforcing = _capMode === 'enforce';
      audit({ call: name, resource: resource, pid: pid, uid: uid, cap: cap,
              result: enforcing ? 'deny' : 'would-deny', reason: 'CAPABILITY_DENIED' });
      if (enforcing) {
        throw OsErr('CAPABILITY_DENIED', 'Capability denied', { cap: cap, pid: pid, call: name });
      }
    }

    // 2. Permission Check via L2 Security (skipped for cap-only Phase 3 calls)
    if (root.SecurityPermissions && !CAP_ONLY_CALLS.has(name)) {
      const secAction = name.replace('.', ':'); // fs.read -> fs:read

      const perm = root.SecurityPermissions.check({
        user: ctx ? ctx.uid : 'guest',
        action: secAction,
        resource: resource,
        audit: false // Audit handled explicitly below
      });

      if (!perm.allowed) {
        _deniedSyscalls += 1;
        audit({ call: name, resource: resource, pid: pid, uid: uid,
                result: 'deny', reason: perm.reason || 'L2_DENIED' });
        throw OsErr('EACCES', 'Permission denied for syscall ' + name, {
          call: name,
          reason: perm.reason
        });
      }
    }

    // 3. Dispatch
    const handler = SYSCALL_HANDLERS.get(name);
    try {
      const result = await handler(ctx, args);
      // Account syscall stats to calling process
      if (pid !== null && root.KernelProcessTable) {
        root.KernelProcessTable.updateStats(pid, { syscalls: 1 });
      }
      if (AUDIT_ON_ALLOW.has(name)) {
        audit({ call: name, resource: resource, pid: pid, uid: uid, result: 'allow' });
      }
      return { ok: true, value: result };
    } catch (err) {
      if (err instanceof Error && err.name === 'OsError') {
        throw err;
      }
      throw OsErr(err.code || 'EINVAL', err.message || 'Syscall error', { detail: err });
    }
  }

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  const KernelSyscalls = Object.freeze({
    version: VERSION,
    ready: ready,

    syscall: syscall,
    // register(name, fn, requiredCapability, { capOnly, audit })
    //   capOnly: skip the L2 SecurityPermissions rule lookup (gated by caps only)
    //   audit:   write an audit row for successful calls too
    register: function (name, fn, requiredCapability, options) {
      if (typeof fn !== 'function') return;
      SYSCALL_HANDLERS.set(name, fn);
      if (requiredCapability !== undefined) CAP_REQUIRED[name] = requiredCapability; // else default-deny by call name
      if (options && options.capOnly) CAP_ONLY_CALLS.add(name);
      if (options && options.audit) AUDIT_ON_ALLOW.add(name);
    },
    // does this ctx hold `cap`? (trusted kernel callers always do)
    holds: function (ctx, cap) {
      return isTrusted(ctx) || capGranted(resolveCaps(ctx), cap);
    },
    listCalls: function () {
      return Array.from(SYSCALL_HANDLERS.keys());
    },
    capabilityFor: requiredCap,
    setCapabilityMode: function (mode) {
      if (mode !== 'enforce' && mode !== 'audit') throw OsErr('EINVAL', 'mode must be "enforce" or "audit"');
      _capMode = mode;
      return _capMode;
    },
    capabilityMode: function () { return _capMode; },
    auditLog: function (limit) {
      const n = typeof limit === 'number' && limit > 0 ? limit : AUDIT_MAX;
      return _auditBuffer.slice(-n);
    },

    diagnostics: function () {
      return {
        version: VERSION,
        availableSyscalls: SYSCALL_HANDLERS.size,
        totalSyscallsExecuted: _totalSyscalls,
        deniedSyscalls: _deniedSyscalls,
        capabilityMode: _capMode,
        auditBuffered: _auditBuffer.length
      };
    }
  });

  // Construct Kernel facade (§5.3)
  const Kernel = {
    version: VERSION,
    ready: Promise.all([
      ready,
      root.KernelEvents ? root.KernelEvents.ready : Promise.resolve(),
      root.KernelProcessTable ? root.KernelProcessTable.ready : Promise.resolve()
    ]),
    syscall: syscall,
    get proc() { return root.KernelProcessTable; },
    get events() { return root.KernelEvents; },
    get clock() { return root.KernelClock; },
    get errors() { return root.KernelErrors; },
    log: function (lvl, msg, data) {
      if (root.KernelLogger && typeof root.KernelLogger[lvl] === 'function') {
        root.KernelLogger[lvl]('kernel', msg, data);
      }
    },
    legacy: {
      get vfs() { return root.VFS; }
    },
    diagnostics: function () {
      return {
        syscalls: KernelSyscalls.diagnostics(),
        processTable: root.KernelProcessTable ? root.KernelProcessTable.diagnostics() : null,
        events: root.KernelEvents ? root.KernelEvents.diagnostics() : null
      };
    }
  };

  root.KernelSyscalls = KernelSyscalls;
  root.Kernel = Kernel;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KernelSyscalls: KernelSyscalls, Kernel: Kernel };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
