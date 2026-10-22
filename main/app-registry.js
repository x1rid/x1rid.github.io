/**
 * @file main/app-registry.js
 * @description Central application registry and lifecycle coordinator.
 *
 * The shell owns window DOM nodes. This module owns the logical application
 * contract and the list of running application instances:
 *
 *   register(def)                   register an application definition
 *   get(id) / list() / has(id)      inspect definitions
 *   launch(id, options)             start, focus, or restore an application
 *   focus(id) / minimize(id)        control a running instance
 *   restore(id) / close(id)
 *   attachWindow(appId, win)        bind a shell window to an instance
 *   detachWindow(windowId, reason)  release an instance
 *   running()                       snapshots of running instances
 *   context()                       active profile + VFS for launch handlers
 *
 * A definition supplies:
 *   id, name, tagline, meta, icon, source, kind, fileTypes, multiple,
 *   launch(context, options) -> window
 *
 * Duplicate launch policy: applications are singletons by default. A
 * definition sets `multiple: true` when each launch must create a new
 * instance (the shell terminal does this). Singleton launches focus or restore
 * the existing instance instead of creating a second window.
 *
 * The registry does not create windows itself and never touches persistence.
 * The shell supplies its window manager through configure(); running windows
 * remain addressable by window id so the registry stays useful even after a
 * node has been removed.
 */

(function (window) {
    'use strict';

    const definitions = new Map();
    const running = new Map();
    let services = {};
    let sequence = 0;

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

    function normalizeDefinition(input) {
        if (!input || typeof input !== 'object') return null;
        const id = normalizeId(input.id);
        if (!id || typeof input.launch !== 'function') return null;

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
            launch: input.launch,
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
            hidden: definition.hidden
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
        return definition;
    }

    function unregister(id) {
        const key = normalizeId(id);
        if (!key || !definitions.has(key)) return false;
        definitions.delete(key);
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

    function runningSnapshot(instance) {
        return {
            key: instance.key,
            appId: instance.appId,
            windowId: instance.windowId,
            profileId: instance.profileId,
            startedAt: instance.startedAt
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
        const instance = {
            key: windowId,
            appId: definition.id,
            windowId: windowId,
            window: win,
            definition: definition,
            profileId: context.profileId,
            startedAt: Date.now(),
            closed: false,
            cleanup: cleanup,
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
        emit('site:appopen', runningSnapshot(instance));
        return instance;
    }

    function detachWindow(windowId, reason) {
        const key = String(windowId == null ? '' : windowId);
        const instance = running.get(key);
        if (!instance) return false;
        running.delete(key);
        emit('site:appclose', {
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

        attachWindow(definition.id, win, {
            windowId: options.windowId || win.id
        });

        emit('site:applaunch', {
            key: String(options.windowId || win.id || definition.id),
            appId: definition.id,
            windowId: String(win.id || ''),
            profileId: context.profileId,
            restoring: Boolean(options.restoring)
        });
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
        const instance = resolveInstance(target);
        if (!instance) return false;
        if (instance.definition && instance.definition.close) {
            return instance.definition.close(activeContext(), instance) !== false;
        }
        if (services.windowManager &&
            typeof services.windowManager.close === 'function') {
            services.windowManager.close(instance.windowId);
            return true;
        }
        return false;
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
        configure: configure
    };

})(typeof window !== 'undefined' ? window : globalThis);
