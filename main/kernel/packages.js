/**
 * @file main/kernel/packages.js
 * @layer L3 — Kernel
 * @owns  window.KernelPackages
 * @needs [ 'KernelDB', 'KernelSyscalls', 'KernelEvents', 'OsError' ]
 * @emits [ 'pkg:installed', 'pkg:removed' ]
 *
 * Phase 3.5 installer. A `.pkg` is JSON stored in the VFS:
 *   { "pkgVersion": 1,
 *     "manifest": { ...same shape as apps/<id>/manifest.json... },
 *     "files": { "main.js": "<text>", "styles.css": "<text>", "assets/icon.svg": "<text>" } }
 *
 * Syscalls (registered here):  pkg.install {path, grant}   pkg.remove {id}   pkg.list {}
 *   grant = 'all' | ['cap', ...]  (REQUIRED; must be a subset of manifest.capabilities AND of the caller's caps)
 *
 * Layering: this module is L3 and never calls up into the app registry. The registry (L6)
 * subscribes with addGuard / onInstalled / onRemoved and loads or unloads the app itself.
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p3.5';
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
  const MAX_FILES = 64;
  const FILE_EXT_RE = /\.(js|css|svg|json|txt)$/i;

  const guards = [];
  const installedHooks = [];
  const removedHooks = [];

  function OsErr(code, msg, detail) {
    if (root.OsError) return new root.OsError(code, msg, detail);
    const e = new Error(msg || code);
    e.name = 'OsError';
    e.code = code;
    e.detail = detail;
    return e;
  }

  function now() {
    return root.KernelClock && typeof root.KernelClock.now === 'function' ? root.KernelClock.now() : Date.now();
  }

  function emit(name, payload, ctx) {
    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      try { root.KernelEvents.emit(name, payload, { pid: ctx && typeof ctx.pid === 'number' ? ctx.pid : null }); } catch (_) {}
    }
  }

  function safeRel(p) {
    return typeof p === 'string' && p.length > 0 && p.length <= 200 &&
      !/^([a-z][a-z0-9+.-]*:|\/|\\)/i.test(p) && p.split(/[\\/]/).indexOf('..') === -1;
  }

  function validatePackage(pkg) {
    const errors = [];
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return { ok: false, errors: ['package must be an object'] };
    if (pkg.pkgVersion !== 1) errors.push('pkgVersion must be 1');
    const m = pkg.manifest;
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      errors.push('manifest is required');
      return { ok: false, errors: errors };
    }
    if (m.manifestVersion !== 1) errors.push('manifest.manifestVersion must be 1');
    if (typeof m.id !== 'string' || !ID_RE.test(m.id)) errors.push('manifest.id is invalid');
    if (typeof m.name !== 'string' || !m.name.trim()) errors.push('manifest.name is required');
    if (m.kind != null && m.kind !== 'app') errors.push('only kind "app" is supported');
    if (!safeRel(m.entry)) errors.push('manifest.entry must be a relative path');
    if (m.styles != null && (!Array.isArray(m.styles) || !m.styles.every(safeRel))) errors.push('manifest.styles must be relative paths');
    if (m.icon != null && !safeRel(m.icon)) errors.push('manifest.icon must be a relative path');
    if (m.capabilities != null && (!Array.isArray(m.capabilities) || !m.capabilities.every(function (c) {
      return typeof c === 'string' && c.length > 0 && c.indexOf('*') === -1;
    }))) errors.push('manifest.capabilities must be strings without wildcards');

    const files = pkg.files;
    if (!files || typeof files !== 'object' || Array.isArray(files)) {
      errors.push('files must be an object of path -> text');
    } else {
      const names = Object.keys(files);
      let total = 0;
      if (names.length > MAX_FILES) errors.push('too many files (max ' + MAX_FILES + ')');
      names.forEach(function (n) {
        if (!safeRel(n) || !FILE_EXT_RE.test(n)) errors.push('bad file path: ' + n);
        if (typeof files[n] !== 'string') errors.push('file is not text: ' + n);
        else total += files[n].length;
      });
      if (total > MAX_TOTAL_BYTES) errors.push('package too large (max 2 MB)');
      if (m.entry && typeof files[m.entry] !== 'string') errors.push('entry file missing from files: ' + m.entry);
      (Array.isArray(m.styles) ? m.styles : []).forEach(function (s) {
        if (typeof files[s] !== 'string') errors.push('style file missing from files: ' + s);
      });
      if (m.icon && typeof files[m.icon] !== 'string') errors.push('icon file missing from files: ' + m.icon);
    }
    return { ok: errors.length === 0, errors: errors };
  }

  function requireDb() {
    if (!root.KernelDB) throw OsErr('EBUSY', 'kernel-db unavailable');
    return root.KernelDB;
  }

  function summary(rec) {
    return {
      id: rec.id,
      name: rec.manifest.name,
      version: rec.manifest.version || '',
      requestedCaps: (rec.manifest.capabilities || []).slice(),
      grantedCaps: rec.grantedCaps.slice(),
      installedAt: rec.installedAt,
      installedBy: rec.installedBy
    };
  }

  async function installPackage(ctx, pkg, grant, meta) {
    const db = requireDb();
    const check = validatePackage(pkg);
    if (!check.ok) throw OsErr('EINVAL', 'Invalid package: ' + check.errors.join('; '), { errors: check.errors });

    const manifest = pkg.manifest;
    const requested = Array.isArray(manifest.capabilities) ? manifest.capabilities.slice() : [];

    if (grant === undefined || grant === null) {
      throw OsErr('EINVAL', 'grant is required: pass "all" or the list of capabilities you approve', { requested: requested });
    }
    const granted = grant === 'all' ? requested : (Array.isArray(grant) ? grant.map(String) : null);
    if (!granted) throw OsErr('EINVAL', 'grant must be "all" or an array of capability names');
    granted.forEach(function (c) {
      if (requested.indexOf(c) === -1) throw OsErr('EINVAL', 'Cannot grant a capability the package did not request: ' + c, { cap: c });
      // an installer can't hand out more power than it holds itself (no escalation)
      if (root.KernelSyscalls && typeof root.KernelSyscalls.holds === 'function' && !root.KernelSyscalls.holds(ctx, c)) {
        throw OsErr('CAPABILITY_DENIED', 'Installer does not hold capability ' + c, { cap: c, pid: ctx ? ctx.pid : null });
      }
    });

    const record = {
      id: manifest.id,
      schemaVersion: 1,
      manifest: JSON.parse(JSON.stringify(manifest)),
      files: Object.assign({}, pkg.files),
      grantedCaps: Array.from(new Set(granted)),
      installedAt: now(),
      installedBy: ctx && ctx.uid ? ctx.uid : 'owner',
      source: (meta && meta.source) || null
    };

    for (let i = 0; i < guards.length; i += 1) guards[i](record); // guards throw to veto (e.g. id belongs to a built-in app)

    await db.put('installed_apps', record);
    emit('pkg:installed', { id: record.id, version: record.manifest.version || '', grantedCaps: record.grantedCaps.slice() }, ctx);

    const result = Object.assign(summary(record), { loaded: true });
    for (let j = 0; j < installedHooks.length; j += 1) {
      try { await installedHooks[j](record); } catch (err) {
        result.loaded = false;
        result.loadError = err && err.message ? String(err.message) : String(err);
      }
    }
    return result;
  }

  async function removePackage(ctx, id) {
    const db = requireDb();
    const key = String(id || '');
    const rec = await db.get('installed_apps', key);
    if (!rec) throw OsErr('ENOENT', 'Package not installed', { id: key });
    await db.delete('installed_apps', key);
    emit('pkg:removed', { id: key }, ctx);
    for (let i = 0; i < removedHooks.length; i += 1) {
      try { await removedHooks[i](key); } catch (_) {}
    }
    return { removed: true, id: key };
  }

  async function listInstalled() {
    return requireDb().list('installed_apps');
  }

  function buildPackage(manifest, files) {
    return { pkgVersion: 1, manifest: manifest, files: files };
  }

  // ── Syscalls ────────────────────────────────────────────────────────────
  function registerSyscalls() {
    const KS = root.KernelSyscalls;
    if (!KS || typeof KS.register !== 'function') return false;
    const opts = { capOnly: true, audit: true };

    KS.register('pkg.install', async function (ctx, args) {
      if (!args || !args.path) throw OsErr('EINVAL', 'Missing path argument');
      const read = await KS.syscall(ctx, 'fs.read', { path: args.path }); // reuses fs caps + VFS
      const raw = read.value.content;
      let pkg;
      try { pkg = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { throw OsErr('EINVAL', 'Package is not valid JSON', { path: args.path }); }
      return installPackage(ctx, pkg, args.grant, { source: args.path });
    }, 'pkg.install', opts);

    KS.register('pkg.remove', async function (ctx, args) {
      if (!args || !args.id) throw OsErr('EINVAL', 'Missing id argument');
      return removePackage(ctx, args.id);
    }, 'pkg.remove', opts);

    KS.register('pkg.list', async function () {
      const rows = await listInstalled();
      return rows.map(summary);
    }, 'pkg.list', { capOnly: true });
    return true;
  }

  const wired = registerSyscalls();

  const KernelPackages = Object.freeze({
    version: VERSION,
    syscallsRegistered: wired,
    validatePackage: validatePackage,
    buildPackage: buildPackage,
    // trusted-shell entry points (an install UI that already got user consent calls these with ctx = null)
    install: installPackage,
    remove: removePackage,
    listInstalled: listInstalled,
    addGuard: function (fn) { if (typeof fn === 'function') guards.push(fn); },
    onInstalled: function (fn) { if (typeof fn === 'function') installedHooks.push(fn); },
    onRemoved: function (fn) { if (typeof fn === 'function') removedHooks.push(fn); }
  });

  root.KernelPackages = KernelPackages;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KernelPackages: KernelPackages };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
