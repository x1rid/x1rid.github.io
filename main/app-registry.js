/**
 * @file main/app-registry.js
 * @description Central application registry and lifecycle coordinator.
 *
 * The shell owns window DOM nodes. This module owns the logical application
 * contract and the list of running application instances:
 *
 *   register(def)                   register an application definition (legacy inline apps)
 *   get(id) / list() / has(id)      inspect definitions
 *   launch(id, options)             start, focus, or restore an application
 *   focus(id) / minimize(id)        control a running instance
 *   restore(id) / close(id)
 *   attachWindow(appId, win)        bind a shell window to an instance
 *   detachWindow(windowId, reason)  release an instance
 *   running()                       snapshots of running instances
 *   context()                       active profile + VFS for launch handlers
 *
 * Phase 3.1 additions (manifest apps):
 *   loadApp(id) / loadApps(ids)     fetch apps/<id>/manifest.json, inject styles, load entry script
 *   OSApps.register(id, impl)       called by an app's entry script: { async main(proc, args) }
 *   validateManifest(obj)           manifestVersion 1 schema check
 *   adaptRetroApps()                non-destructive bridge so window.RetroApps keeps working
 *
 * Phase 3.2 additions: every process is spawned with caps from the manifest
 * (`capabilities`). Legacy inline definitions get ['*'] so nothing breaks until migrated.
 *
 * A legacy definition supplies:
 *   id, name, tagline, meta, icon, source, kind, fileTypes, multiple,
 *   launch(context, options) -> window
 *
 * Duplicate launch policy: applications are singletons by default. A
 * definition sets `multiple: true` when each launch must create a new
 * instance (the shell terminal does this). Singleton launches focus or restore
 * the existing instance instead of creating a second window.
 *
 * Window creation: the shell supplies configure({ windowFactory(opts) -> win, windowManager }).
 * `win` needs { id, root, node?, closed, onClose, close(), setTitle?(), focus?() }.
 * If no factory is configured a plain floating-div fallback is used so manifest apps still run.
 *
 * The registry never touches persistence.
 */

(function (window) {
    'use strict';

    const definitions = new Map();
    const running = new Map();
    const pendingManifests = new Map();
    const loading = new Map();
    let services = {};
    let sequence = 0;
    let winSeq = 0;
    let zTop = 1000;

    const LEGACY_CAPS = ['*'];
    const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
    const DEFAULT_BASE = 'apps/';

    function normalizeId(value) {
        return String(value == null ? '' : value).trim().toLowerCase();
    }

    function stringValue(value, fallback) {
        if (value == null) return fallback;
        return String(value);
    }

    function normalizeFileTypes(value) {
        const raw = Array.isArray(value) ? value : (value == null ? [] : [value]);
        const seen = new Set();
        const result = [];
        raw.forEach(function (item) {
            String(item == null ? '' : item)
                .split(/[\s,]+/)
                .forEach(function (part) {
                    const extension = part.trim().toLowerCase().replace(/^\./, '');
                    if (!extension || seen.has(extension)) return;
                    seen.add(extension);
                    result.push(extension);
                });
        });
        return result;
    }

    function activeContext() {
        let profile = null;
        try {
            if (window.ProfileService &&
                typeof window.ProfileService.getActiveProfile === 'function') {
                profile = window.ProfileService.getActiveProfile();
            }
        } catch (_error) {
            profile = null;
        }

        const profileId = profile && typeof profile.id === 'string' ? profile.id : null;
        const vfs = window.VFS || null;

        return {
            profile: profile,
            profileId: profileId,
            owner: profileId === 'owner',
            guest: profileId === 'guest',
            vfs: vfs,
            username: vfs && typeof vfs.username === 'string' ? vfs.username : null
        };
    }

    // ── Manifest validation ────────────────────────────────────────────────

    function safeRelPath(p) {
        return typeof p === 'string' && p.length > 0 &&
            !/^([a-z][a-z0-9+.-]*:|\/|\\)/i.test(p) &&
            p.split(/[\\/]/).indexOf('..') === -1;
    }

    function validateManifest(m) {
        const errors = [];
        if (!m || typeof m !== 'object' || Array.isArray(m)) {
            return { ok: false, errors: ['manifest must be an object'], id: '' };
        }
        const id = normalizeId(m.id);
        if (m.manifestVersion !== 1) errors.push('manifestVersion must be 1');
        if (!ID_RE.test(id)) errors.push('id must match ' + ID_RE);
        if (typeof m.name !== 'string' || !m.name.trim()) errors.push('name is required');
        if (m.kind != null && m.kind !== 'app') errors.push('only kind "app" is supported in Phase 3');
        if (!safeRelPath(m.entry)) errors.push('entry must be a relative path inside the app folder');
        if (m.styles != null && (!Array.isArray(m.styles) || !m.styles.every(safeRelPath))) {
            errors.push('styles must be an array of relative paths');
        }
        if (m.icon != null && !safeRelPath(m.icon)) errors.push('icon must be a relative path');
        if (m.capabilities != null) {
            if (!Array.isArray(m.capabilities) || !m.capabilities.every(function (c) {
                return typeof c === 'string' && c.length > 0 && c.indexOf('*') === -1;
            })) {
                errors.push('capabilities must be an array of non-empty strings without wildcards');
            }
        }
        if (m.window != null && (typeof m.window !== 'object' || Array.isArray(m.window))) {
            errors.push('window must be an object');
        }
        return { ok: errors.length === 0, errors: errors, id: id };
    }

    function normalizeCaps(value, fallback) {
        if (!Array.isArray(value)) return fallback.slice();
        const seen = new Set();
        value.forEach(function (c) { if (c != null) seen.add(String(c)); });
        return Array.from(seen);
    }

    // ── Definitions ────────────────────────────────────────────────────────

    function normalizeDefinition(input) {
        if (!input || typeof input !== 'object') return null;
        const id = normalizeId(input.id);
        if (!id || typeof input.launch !== 'function') return null;

        const manifest = input.manifest && typeof input.manifest === 'object' ? input.manifest : null;

        return {
            id: id,
            name: stringValue(input.name, id),
            tagline: stringValue(input.tagline, ''),
            meta: stringValue(input.meta, ''),
            icon: stringValue(input.icon, ''),
            source: stringValue(input.source, 'IN-HOUSE'),
            kind: normalizeId(input.kind || 'app'),
            frame: Boolean(input.frame),
            fileTypes: normalizeFileTypes(input.fileTypes),
            multiple: Boolean(input.multiple || input.allowMultiple),
            hidden: Boolean(input.hidden),
            version: stringValue(input.version, ''),
            personality: Array.isArray(input.personality) ? input.personality.map(String) : [],
            manifest: manifest,
            legacy: !manifest,
            // manifest apps declare caps; legacy inline apps keep full access until migrated
            capabilities: manifest ? normalizeCaps(input.capabilities, []) : normalizeCaps(input.capabilities, LEGACY_CAPS),
            launch: input.launch,
            start: typeof input.start === 'function' ? input.start : null,
            focus: typeof input.focus === 'function' ? input.focus : null,
            minimize: typeof input.minimize === 'function' ? input.minimize : null,
            restore: typeof input.restore === 'function' ? input.restore : null,
            close: typeof input.close === 'function' ? input.close : null
        };
    }

    function publicDefinition(definition) {
        if (!definition) return null;
        return {
            id: definition.id,
            name: definition.name,
            tagline: definition.tagline,
            meta: definition.meta,
            icon: definition.icon,
            source: definition.source,
            kind: definition.kind,
            frame: definition.frame,
            fileTypes: definition.fileTypes.slice(),
            multiple: definition.multiple,
            hidden: definition.hidden,
            version: definition.version,
            personality: definition.personality.slice(),
            capabilities: definition.capabilities.slice(),
            legacy: definition.legacy
        };
    }

    function register(input) {
        const definition = normalizeDefinition(input);
        if (!definition) {
            if (input && input.id) {
                console.warn('[AppRegistry] Ignoring ' + input.id + ': launch(context, options) is required.');
            }
            return null;
        }
        if (definitions.has(definition.id)) {
            console.warn('[AppRegistry] Duplicate application id: ' + definition.id);
            return definitions.get(definition.id);
        }
        definitions.set(definition.id, definition);
        emit('os:apps-changed', { added: definition.id });
        return definition;
    }

    function unregister(id) {
        const key = normalizeId(id);
        if (!key || !definitions.has(key)) return false;
        definitions.delete(key);
        emit('os:apps-changed', { removed: key });
        return true;
    }

    function get(id) {
        return definitions.get(normalizeId(id)) || null;
    }

    function has(id) {
        return definitions.has(normalizeId(id));
    }

    function list() {
        const result = [];
        definitions.forEach(function (definition) {
            result.push(publicDefinition(definition));
        });
        result.sort(function (a, b) {
            return a.name.localeCompare(b.name);
        });
        return result;
    }

    function findByFileType(extension) {
        const ext = normalizeId(extension).replace(/^\./, '');
        if (!ext) return [];
        const result = [];
        definitions.forEach(function (definition) {
            if (definition.fileTypes.indexOf(ext) !== -1) {
                result.push(publicDefinition(definition));
            }
        });
        return result;
    }

    function emit(name, detail) {
        try {
            document.dispatchEvent(new CustomEvent(name, { detail: detail }));
        } catch (_error) {
            /* CustomEvent is available in every supported browser. */
        }
    }

    function kernelEmit(name, payload, pid) {
        try {
            if (window.KernelEvents && typeof window.KernelEvents.emit === 'function') {
                window.KernelEvents.emit(name, payload, { pid: pid });
            }
        } catch (_error) { /* never let telemetry break the app */ }
    }

    function runningSnapshot(instance) {
        return {
            key: instance.key,
            appId: instance.appId,
            windowId: instance.windowId,
            profileId: instance.profileId,
            startedAt: instance.startedAt,
            pid: instance.pid
        };
    }

    function runningFor(appId) {
        const id = normalizeId(appId);
        const result = [];
        running.forEach(function (instance) {
            if (instance.appId === id) result.push(instance);
        });
        return result;
    }

    function resolveInstance(target) {
        if (target && typeof target === 'object') {
            if (target.key != null && running.has(String(target.key))) {
                return running.get(String(target.key));
            }
            if (target.windowId != null && running.has(String(target.windowId))) {
                return running.get(String(target.windowId));
            }
            target = target.appId || target.id;
        }

        const key = String(target == null ? '' : target);
        if (key && running.has(key)) return running.get(key);

        const matches = runningFor(key);
        return matches.length ? matches[matches.length - 1] : null;
    }

    // ── Process table bridge ───────────────────────────────────────────────

    // When a process dies (Task Manager "End task", crash reap, proc.kill) close its windows.
    function reapWindows(_record, windowIds) {
        windowIds.forEach(function (windowId) {
            const instance = running.get(String(windowId));
            if (instance && !instance.closed) closeInstance(instance);
        });
    }

    function ensureReaper() {
        if (window.KernelProcessTable && typeof window.KernelProcessTable.setReaper === 'function') {
            window.KernelProcessTable.setReaper(reapWindows);
        }
    }

    function attachWindow(appId, win, options) {
        const definition = get(appId);
        if (!definition || !win || typeof win !== 'object') return null;

        options = options || {};
        const windowId = String(options.windowId || win.id || definition.id);
        const existing = running.get(windowId);
        if (existing) {
            existing.window = win;
            existing.definition = definition;
            return existing;
        }

        const context = activeContext();
        const cleanup = typeof win.onClose === 'function' ? win.onClose : null;

        // Associate a monotonic PID and grant the manifest's capabilities (§5.1, 3.2)
        let proc = null;
        if (window.KernelProcessTable && typeof window.KernelProcessTable.spawn === 'function') {
            ensureReaper();
            try {
                proc = window.KernelProcessTable.spawn({
                    appId: definition.id,
                    name: definition.name,
                    kind: 'app',
                    windows: [windowId],
                    uid: context.profileId || 'owner',
                    caps: definition.capabilities
                });
            } catch (err) {
                console.warn('[AppRegistry] KernelProcessTable.spawn error:', err);
            }
        }

        const instance = {
            key: windowId,
            appId: definition.id,
            windowId: windowId,
            pid: proc ? proc.pid : null,
            window: win,
            definition: definition,
            profileId: context.profileId,
            startedAt: Date.now(),
            closed: false,
            cleanup: cleanup,
            exitHooks: [],
            sequence: ++sequence
        };

        win.onClose = function () {
            if (instance.closed) return;
            instance.closed = true;
            if (typeof instance.cleanup === 'function') {
                try {
                    instance.cleanup();
                } catch (error) {
                    console.warn('[AppRegistry] Cleanup failed for ' + definition.id + ':', error);
                }
            }
            detachWindow(windowId, 'window-close');
        };

        running.set(windowId, instance);
        emit('site:appopen', runningSnapshot(instance));                       // legacy alias
        kernelEmit('win:opened', { windowId: windowId, appId: definition.id, pid: instance.pid }, instance.pid);
        return instance;
    }

    function detachWindow(windowId, reason) {
        const key = String(windowId == null ? '' : windowId);
        const instance = running.get(key);
        if (!instance) return false;
        running.delete(key);

        instance.exitHooks.splice(0).forEach(function (hook) {
            try { hook(reason || 'closed'); } catch (error) {
                console.warn('[AppRegistry] exit hook failed for ' + instance.appId + ':', error);
            }
        });

        // Notify KernelProcessTable of window detachment (emits proc:exited when last window goes)
        if (window.KernelProcessTable && typeof window.KernelProcessTable.detachWindow === 'function') {
            try {
                window.KernelProcessTable.detachWindow(key);
            } catch (_) {}
        }
        emit('site:appclose', {                                                // legacy alias of proc:exited
            key: instance.key,
            appId: instance.appId,
            windowId: instance.windowId,
            profileId: instance.profileId,
            startedAt: instance.startedAt,
            reason: reason || 'closed'
        });
        return true;
    }

    function focusInstance(instance, focusTarget) {
        if (!instance) return false;
        const definition = instance.definition;
        if (definition && definition.focus) {
            return definition.focus(activeContext(), instance) !== false;
        }
        if (services.windowManager &&
            typeof services.windowManager.focus === 'function') {
            services.windowManager.focus(instance.windowId, focusTarget !== false);
            return true;
        }
        if (instance.window && typeof instance.window.focus === 'function') {
            instance.window.focus();
            return true;
        }
        return false;
    }

    function closeInstance(instance) {
        if (!instance) return false;
        if (instance.definition && instance.definition.close) {
            return instance.definition.close(activeContext(), instance) !== false;
        }
        if (services.windowManager &&
            typeof services.windowManager.close === 'function') {
            services.windowManager.close(instance.windowId);
            return true;
        }
        if (instance.window && typeof instance.window.close === 'function') {
            instance.window.close();
            return true;
        }
        return false;
    }

    function launch(id, options) {
        const definition = get(id);
        if (!definition) {
            console.warn('[AppRegistry] Unknown application: ' + String(id));
            return null;
        }

        options = options || {};

        if (!definition.multiple) {
            const existing = runningFor(definition.id)[0];
            if (existing && existing.window && !existing.window.closed) {
                if (options.focus !== false) focusInstance(existing, true);
                emit('site:appactivate', runningSnapshot(existing));
                return existing.window;
            }
        }

        const context = activeContext();
        let win = null;
        try {
            win = definition.launch(context, options);
        } catch (error) {
            console.error('[AppRegistry] ' + definition.name + ' failed to launch:', error);
            return null;
        }

        if (!win) return null;
        if (win.window && win.window.node) win = win.window;
        if (!win || typeof win !== 'object') return null;

        const instance = attachWindow(definition.id, win, {
            windowId: options.windowId || win.id
        });

        emit('site:applaunch', {                                               // legacy alias of proc:spawned
            key: String(options.windowId || win.id || definition.id),
            appId: definition.id,
            windowId: String(win.id || ''),
            profileId: context.profileId,
            restoring: Boolean(options.restoring)
        });

        // Manifest apps: run main(proc, args) now that a pid + caps exist.
        if (instance && typeof definition.start === 'function') {
            try {
                definition.start(instance, options);
            } catch (error) {
                handleCrash(instance, error);
            }
        }
        return win;
    }

    function focus(target, focusTarget) {
        return focusInstance(resolveInstance(target), focusTarget);
    }

    function minimize(target) {
        const instance = resolveInstance(target);
        if (!instance) return false;
        if (instance.definition && instance.definition.minimize) {
            return instance.definition.minimize(activeContext(), instance) !== false;
        }
        if (services.windowManager &&
            typeof services.windowManager.minimize === 'function') {
            services.windowManager.minimize(instance.windowId);
            return true;
        }
        return false;
    }

    function restore(target) {
        const instance = resolveInstance(target);
        if (!instance) return false;
        if (instance.definition && instance.definition.restore) {
            return instance.definition.restore(activeContext(), instance) !== false;
        }
        if (services.windowManager &&
            typeof services.windowManager.restore === 'function') {
            services.windowManager.restore(instance.windowId);
            return true;
        }
        return false;
    }

    function close(target) {
        return closeInstance(resolveInstance(target));
    }

    function runningInstances() {
        const result = [];
        running.forEach(function (instance) {
            result.push(runningSnapshot(instance));
        });
        result.sort(function (a, b) {
            return a.startedAt - b.startedAt || a.windowId.localeCompare(b.windowId);
        });
        return result;
    }

    function instance(target) {
        const found = resolveInstance(target);
        return found ? runningSnapshot(found) : null;
    }

    function configure(options) {
        if (!options || typeof options !== 'object') return services;
        services = Object.assign({}, services, options);
        return services;
    }

    function context() {
        return activeContext();
    }

    // ── Manifest apps: window + process facade ─────────────────────────────

    function defaultWindowFactory(opts) {
        const id = 'appwin-' + (++winSeq);
        const node = document.createElement('div');
        node.setAttribute('data-window-id', id);
        node.style.cssText = 'position:fixed;display:flex;flex-direction:column;box-sizing:border-box;' +
            'background:#1b1d23;color:#e8e8ee;border:1px solid #3a3d48;border-radius:8px;overflow:hidden;' +
            'box-shadow:0 12px 40px rgba(0,0,0,.45);font:14px system-ui,sans-serif;' +
            'left:' + (60 + (winSeq * 28) % 220) + 'px;top:' + (50 + (winSeq * 28) % 160) + 'px;' +
            'width:' + (Number(opts.width) || 640) + 'px;height:' + (Number(opts.height) || 420) + 'px;' +
            'max-width:96vw;max-height:92vh;z-index:' + (++zTop) + ';' +
            (opts.resizable === false ? '' : 'resize:both;');

        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;' +
            'background:#262932;cursor:move;user-select:none;flex:0 0 auto;';
        const titleEl = document.createElement('span');
        titleEl.textContent = opts.title || 'Window';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u2715';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.style.cssText = 'background:none;border:0;color:inherit;cursor:pointer;font-size:14px;';
        bar.appendChild(titleEl);
        bar.appendChild(closeBtn);

        const rootEl = document.createElement('div');
        rootEl.style.cssText = 'flex:1 1 auto;overflow:auto;position:relative;';

        node.appendChild(bar);
        node.appendChild(rootEl);
        document.body.appendChild(node);

        const win = {
            id: id,
            node: node,
            root: rootEl,
            closed: false,
            onClose: null,
            setTitle: function (t) { titleEl.textContent = String(t); },
            focus: function () { node.style.zIndex = String(++zTop); },
            close: function () {
                if (win.closed) return;
                win.closed = true;
                if (node.parentNode) node.parentNode.removeChild(node);
                if (typeof win.onClose === 'function') win.onClose();
            }
        };

        closeBtn.addEventListener('click', function () { win.close(); });
        node.addEventListener('mousedown', function () { win.focus(); });
        bar.addEventListener('mousedown', function (ev) {
            if (ev.target === closeBtn) return;
            const rect = node.getBoundingClientRect();
            const dx = ev.clientX - rect.left;
            const dy = ev.clientY - rect.top;
            function move(e) {
                node.style.left = Math.max(0, e.clientX - dx) + 'px';
                node.style.top = Math.max(0, e.clientY - dy) + 'px';
            }
            function up() {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
            }
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });

        return win;
    }

    function createAppWindow(manifest) {
        const factory = typeof services.windowFactory === 'function' ? services.windowFactory : defaultWindowFactory;
        const w = manifest.window || {};
        const win = factory({
            appId: manifest.id,
            title: manifest.name,
            width: w.width || 640,
            height: w.height || 420,
            resizable: w.resizable !== false,
            icon: manifest.icon || ''
        });
        if (!win || !win.root) throw new Error('windowFactory must return a window with a .root element');
        return win;
    }

    function handleCrash(inst, error) {
        console.error('[AppRegistry] ' + inst.appId + ' crashed:', error);
        if (window.KernelProcessTable && typeof window.KernelProcessTable.crash === 'function' && inst.pid != null) {
            window.KernelProcessTable.crash(inst.pid, error);
        }
        try {
            const rootEl = inst.window && inst.window.root;
            if (rootEl) {
                rootEl.textContent = 'This app crashed: ' + (error && error.message ? error.message : String(error));
            }
        } catch (_) { /* window may be gone */ }
    }

    function startApp(inst, impl, options) {
        const pid = inst.pid;
        const win = inst.window;
        const table = window.KernelProcessTable;
        const record = pid != null && table ? table.get(pid) : null;
        const uid = inst.profileId || 'owner';

        const winApi = {
            id: win.id,
            root: win.root,
            setTitle: function (t) { if (typeof win.setTitle === 'function') win.setTitle(String(t)); },
            focus: function () { focusInstance(inst, true); },
            close: function () { closeInstance(inst); }
        };

        const proc = {
            pid: pid,
            appId: inst.appId,
            uid: uid,
            args: options && options.args !== undefined ? options.args : (options || {}),
            cwd: record ? record.cwd : '',
            env: record ? record.env : {},
            get caps() {
                const rec = pid != null && table ? table.get(pid) : null;
                return rec ? rec.caps : inst.definition.capabilities.slice();
            },
            // Phase 3: one window per process. Repeated open() returns the same window.
            win: {
                open: function (opts) {
                    if (opts && opts.title) winApi.setTitle(opts.title);
                    return Promise.resolve(winApi);
                }
            },
            syscall: function (name, args) {
                if (!window.Kernel || typeof window.Kernel.syscall !== 'function') {
                    return Promise.reject(new Error('Kernel syscalls unavailable'));
                }
                return window.Kernel.syscall({ pid: pid, uid: uid, caps: proc.caps }, name, args)
                    .then(function (r) { return r.value; });
            },
            onSignal: function (sig, handler) {
                return pid != null && table ? table.onSignal(pid, sig, handler) : false;
            },
            onExit: function (fn) {
                if (typeof fn === 'function') inst.exitHooks.push(fn);
            },
            exit: function (code) {
                if (pid != null && table) table.kill(pid, code);
                else closeInstance(inst);
            }
        };

        const failed = function (err) { handleCrash(inst, err); };
        try {
            const result = impl.main(proc, proc.args);
            if (result && typeof result.then === 'function') result.then(null, failed);
        } catch (err) {
            failed(err);
        }
    }

    function buildManifestDefinition(manifest, impl, base) {
        const w = manifest.window || {};
        return {
            id: manifest.id,
            name: manifest.name,
            tagline: stringValue(manifest.tagline, ''),
            meta: manifest.version ? 'v' + manifest.version : '',
            icon: manifest.icon ? base + manifest.icon : '',
            source: 'MANIFEST',
            kind: 'app',
            version: stringValue(manifest.version, ''),
            fileTypes: manifest.fileTypes,
            multiple: Boolean(manifest.multiple),
            personality: manifest.personality,
            capabilities: manifest.capabilities || [],
            manifest: Object.assign({}, manifest, { window: Object.assign({}, w) }),
            launch: function () { return createAppWindow(manifest); },
            start: function (inst, options) { startApp(inst, impl, options); }
        };
    }

    // ── Manifest loading ───────────────────────────────────────────────────

    // Called from an app's entry script: window.OSApps.register('notepad', { async main(proc, args) {} })
    function registerImpl(id, impl) {
        const key = normalizeId(id);
        const pending = pendingManifests.get(key);
        if (!pending) {
            console.warn('[OSApps] register("' + key + '") ignored: no manifest is loading for it. Use AppRegistry.loadApp("' + key + '").');
            return null;
        }
        if (!impl || typeof impl.main !== 'function') {
            console.warn('[OSApps] register("' + key + '") ignored: impl.main(proc, args) is required.');
            return null;
        }
        return register(buildManifestDefinition(pending.manifest, impl, pending.base));
    }

    function fetchManifest(key, base) {
        const inline = window.OSManifests && window.OSManifests[key];
        if (inline) return Promise.resolve(JSON.parse(JSON.stringify(inline)));
        if (typeof fetch !== 'function') return Promise.reject(new Error('fetch is unavailable'));
        return fetch(base + 'manifest.json', { cache: 'no-cache' }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        }).catch(function (err) {
            throw new Error('Could not load ' + base + 'manifest.json (' + (err && err.message) + '). ' +
                'Opened via file://? Serve the folder (python -m http.server) or define window.OSManifests.' + key + '.');
        });
    }

    function addStyle(appId, href) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.setAttribute('data-os-app', appId);
        document.head.appendChild(link);
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            const s = document.createElement('script');
            s.src = src;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('Failed to load script ' + src)); };
            document.head.appendChild(s);
        });
    }

    function loadApp(id, opts) {
        const key = normalizeId(id);
        if (!ID_RE.test(key)) return Promise.reject(new Error('Invalid app id: ' + String(id)));
        if (definitions.has(key)) return Promise.resolve(definitions.get(key));
        if (loading.has(key)) return loading.get(key);

        const root = String((opts && opts.base) || DEFAULT_BASE).replace(/\/*$/, '/');
        const base = root + key + '/';

        const p = fetchManifest(key, base).then(function (manifest) {
            const check = validateManifest(manifest);
            if (!check.ok) throw new Error('Invalid manifest for ' + key + ': ' + check.errors.join('; '));
            if (check.id !== key) throw new Error('Manifest id "' + check.id + '" does not match folder "' + key + '"');

            const clean = Object.assign({}, manifest, {
                id: key,
                kind: 'app',
                fileTypes: normalizeFileTypes(manifest.fileTypes),
                capabilities: normalizeCaps(manifest.capabilities, []),
                personality: Array.isArray(manifest.personality) ? manifest.personality.map(String) : []
            });
            pendingManifests.set(key, { manifest: clean, base: base });
            (clean.styles || []).forEach(function (href) { addStyle(key, base + href); });
            return loadScript(base + clean.entry);
        }).then(function () {
            const def = definitions.get(key);
            if (!def) throw new Error('Entry script for "' + key + '" never called OSApps.register("' + key + '", ...)');
            return def;
        }).then(function (def) {
            loading.delete(key);
            pendingManifests.delete(key);
            return def;
        }, function (err) {
            loading.delete(key);
            pendingManifests.delete(key);
            throw err;
        });

        loading.set(key, p);
        return p;
    }

    function loadApps(ids, opts) {
        const list = Array.isArray(ids) ? ids : [];
        return Promise.all(list.map(function (id) {
            return loadApp(id, opts).then(function (def) {
                return { id: normalizeId(id), ok: true, definition: def };
            }, function (err) {
                console.error('[AppRegistry] ' + id + ' failed to load:', err);
                return { id: normalizeId(id), ok: false, error: err };
            });
        }));
    }

    // Discover apps from apps/index.json ({ "apps": ["notepad", ...] }) or window.OSAppList.
    function autoload(opts) {
        const base = String((opts && opts.base) || DEFAULT_BASE).replace(/\/*$/, '/');
        const fromGlobal = Array.isArray(window.OSAppList) ? Promise.resolve(window.OSAppList) : null;
        const source = fromGlobal || (typeof fetch === 'function'
            ? fetch(base + 'index.json', { cache: 'no-cache' }).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            }).then(function (j) { return Array.isArray(j) ? j : (j && j.apps) || []; })
            : Promise.resolve([]));
        return source.then(function (ids) { return loadApps(ids, opts); }, function (err) {
            console.warn('[AppRegistry] app discovery skipped:', err && err.message);
            return [];
        });
    }

    // ── RetroApps adapter (never overwrites what index.html already defines) ─
    function adaptRetroApps() {
        const retro = window.RetroApps;
        if (!retro || typeof retro !== 'object') return false;
        if (typeof retro.register !== 'function') retro.register = register;
        if (typeof retro.launch !== 'function') retro.launch = launch;
        if (typeof retro.list !== 'function') retro.list = list;
        if (typeof retro.has !== 'function') retro.has = has;
        return true;
    }

    window.AppRegistry = {
        register: register,
        unregister: unregister,
        get: get,
        has: has,
        list: list,
        findByFileType: findByFileType,
        launch: launch,
        focus: focus,
        minimize: minimize,
        restore: restore,
        close: close,
        attachWindow: attachWindow,
        detachWindow: detachWindow,
        running: runningInstances,
        instance: instance,
        context: context,
        configure: configure,
        // Phase 3.1
        loadApp: loadApp,
        loadApps: loadApps,
        autoload: autoload,
        validateManifest: validateManifest,
        adaptRetroApps: adaptRetroApps
    };

    window.OSApps = Object.assign(window.OSApps || {}, {
        register: registerImpl,
        load: loadApp,
        loadAll: loadApps
    });

    adaptRetroApps();
    if (typeof document !== 'undefined' && document.addEventListener) {
        const boot = function () {
            adaptRetroApps();
            if (window.OSAutoloadApps !== false) autoload();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
        else setTimeout(boot, 0);
    }

})(typeof window !== 'undefined' ? window : globalThis);
