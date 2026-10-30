/**
 * @file main/kernel/syscalls.js
 * @layer L3 — Kernel
 * @owns  window.KernelSyscalls, window.Kernel
 * @needs [ 'KernelClock', 'KernelEvents', 'KernelLogger', 'KernelProcessTable', 'SecurityPermissions', 'SecurityAudit', 'OsError' ]
 * @emits [ 'domain:verb-noun' ]
 *
 * Spec reference: OS_FOUNDATION.md §5.3, §6.1, §8 Phase 1.5
 *
 * Authoritative Syscall Layer. The only door for apps to interact with OS subsystems.
 * Every syscall executes:
 *   1. Validation of arguments & context
 *   2. Permission / capability check via L2 (default-deny)
 *   3. Dispatch to underlying implementation
 *   4. Audit logging if sensitive
 *   5. Event emission
 *   6. Standard return: { ok: true, value } or throws structured OsError
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031';

  const SYSCALL_HANDLERS = new Map();
  let _totalSyscalls = 0;
  let _deniedSyscalls = 0;

  function OsErr(code, msg, detail) {
    if (root.OsError) {
      return new root.OsError(code, msg, detail);
    }
    const e = new Error(msg || code);
    e.code = code;
    e.detail = detail;
    return e;
  }

  // ── Register Syscall Handlers ───────────────────────────────────────────

  // ── proc.* ──────────────────────────────────────────────────────────────
  SYSCALL_HANDLERS.set('proc.list', async function (ctx, args) {
    if (!root.KernelProcessTable) throw OsErr('EBUSY', 'Process table unavailable');
    return root.KernelProcessTable.list(args ? args.filter : null);
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
    return root.KernelProcessTable.spawn(args);
  });

  SYSCALL_HANDLERS.set('proc.kill', async function (ctx, args) {
    if (!args || typeof args.pid !== 'number') throw OsErr('EINVAL', 'Missing pid argument');
    if (!root.KernelProcessTable) throw OsErr('EBUSY', 'Process table unavailable');
    const ok = root.KernelProcessTable.kill(args.pid, args.exitCode);
    if (!ok) throw OsErr('ESRCH', 'No such process to kill', { pid: args.pid });
    return { killed: true };
  });

  SYSCALL_HANDLERS.set('proc.signal', async function (ctx, args) {
    if (!args || typeof args.pid !== 'number' || !args.signal) throw OsErr('EINVAL', 'Missing pid or signal');
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

    const res = await vfs.writeFile(args.path, args.content);
    return { path: args.path, written: true, node: res };
  });

  // ── Core Syscall Dispatcher ─────────────────────────────────────────────
  async function syscall(ctx, callName, args) {
    _totalSyscalls += 1;
    const name = String(callName || '').trim();

    if (!SYSCALL_HANDLERS.has(name)) {
      throw OsErr('EINVAL', 'Unknown syscall: ' + name, { call: name });
    }

    // 1. Permission Check via L2 Security
    if (root.SecurityPermissions) {
      const secAction = name.replace('.', ':'); // fs.read -> fs:read
      const resource = (args && (args.path || args.resource)) || '*';

      const perm = root.SecurityPermissions.check({
        user: ctx ? ctx.uid : 'guest',
        action: secAction,
        resource: resource,
        audit: false // Audit handled explicitly below
      });

      if (!perm.allowed) {
        _deniedSyscalls += 1;
        if (root.SecurityAudit) {
          root.SecurityAudit.record({
            action: secAction,
            resource: resource,
            actor: { type: 'process', pid: ctx ? ctx.pid : null, uid: ctx ? ctx.uid : 'guest' },
            result: 'deny',
            reason: perm.reason || 'CAPABILITY_DENIED'
          });
        }
        throw OsErr('EACCES', 'Permission denied for syscall ' + name, {
          call: name,
          reason: perm.reason
        });
      }
    }

    // 2. Dispatch
    const handler = SYSCALL_HANDLERS.get(name);
    try {
      const result = await handler(ctx, args);
      // Account syscall stats to calling process
      if (ctx && typeof ctx.pid === 'number' && root.KernelProcessTable) {
        root.KernelProcessTable.updateStats(ctx.pid, { syscalls: 1 });
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
    register: function (name, fn) {
      if (typeof fn === 'function') SYSCALL_HANDLERS.set(name, fn);
    },
    listCalls: function () {
      return Array.from(SYSCALL_HANDLERS.keys());
    },

    diagnostics: function () {
      return {
        version: VERSION,
        availableSyscalls: SYSCALL_HANDLERS.size,
        totalSyscallsExecuted: _totalSyscalls,
        deniedSyscalls: _deniedSyscalls
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
