/**
 * @file main/system-services.js
 * @description Shared desktop system services for the simulator shell.
 *
 * Loaded before Explorer, programs, and the shell boot block. Everything is a
 * plain `window.*` global; no modules, bundler, or backend.
 *
 * PUBLIC API (window.SystemServices)
 *   ready                         Promise resolved after profile + VFS boot
 *   events                        standard system event bus
 *   clipboard                     text + VFS-node clipboard
 *   dialogs                       Open/Save dialogs bound to the active VFS
 *   files                         file-association registry
 *   notifications                 toast / error reporting facade
 *   settings                      shared profile preference access
 *   diagnostics()                 service state snapshot for tests
 *
 * EVENT CONTRACT (dispatched synchronously on `document`)
 *   Every detail includes `type`, `profileId`, `emittedAt`, and a monotonically
 *   increasing `sequence`. A service changes its own state first, then emits,
 *   then resolves the caller's promise (where one exists).
 *
 *   system:clipboard-changed { kind, op, count, nodeIds, reason }
 *   system:clipboard-pasted  { op, count, targetId, completedNodeIds }
 *   system:dialog-open       { mode, title, folderId, path }
 *   system:dialog-close      { mode, reason, resultCode }
 *   system:file-opened       { nodeId, path, extension, handlerId|appId }
 *   system:file-saved        { nodeId, path, extension, appId }
 *   system:app-file-open     { appId, nodeId, path, extension }
 *   system:notification      { level, title, message, duration }
 *   system:error             { operation, code, message }
 *   system:settings-changed  { key, value, committed: true }
 *   system:services-ready    { version, vfsDb, hasVfs }
 *   system:config-loaded     { revision, restored, warnings }
 *   system:config-changed    { revision, updatedAt, reason, warnings }
 *   system:config-reset      { revision, updatedAt, section, reason }
 *   system:config-rollback   { revision, updatedAt, reason }
 *   system:config-error      { operation, code, message }
 *   system:audit             { id, action, result, actor, resource, reason, detail }
 *
 * Existing VFS (`node-*`), profile (`profile:*`), registry (`site:app*`), and
 * shell (`site:*`) events keep their previous contracts. This file does not
 * re-dispatch or rename them.
 */

(function (window, document) {
    'use strict';

    const VERSION = '20261107';

    const EVENTS = Object.freeze({
        CLIPBOARD_CHANGED: 'system:clipboard-changed',
        CLIPBOARD_PASTED: 'system:clipboard-pasted',
        DIALOG_OPEN: 'system:dialog-open',
        DIALOG_CLOSE: 'system:dialog-close',
        FILE_OPENED: 'system:file-opened',
        FILE_SAVED: 'system:file-saved',
        APP_FILE_OPEN: 'system:app-file-open',
        NOTIFICATION: 'system:notification',
        ERROR: 'system:error',
        SETTINGS_CHANGED: 'system:settings-changed',
        SERVICES_READY: 'system:services-ready',
        CONFIG_LOADED: 'system:config-loaded',
        CONFIG_CHANGED: 'system:config-changed',
        CONFIG_RESET: 'system:config-reset',
        CONFIG_ROLLBACK: 'system:config-rollback',
        CONFIG_ERROR: 'system:config-error',
        AUDIT: 'system:audit'
    });

    let sequence = 0;
    const listeners = new Map();

    function activeProfile() {
        try {
            if (window.ProfileService &&
                typeof window.ProfileService.getActiveProfile === 'function') {
                return window.ProfileService.getActiveProfile();
            }
        } catch (_error) {
            /* profile services are optional on legacy pages */
        }
        return null;
    }

    function activeProfileId() {
        const profile = activeProfile();
        return profile && typeof profile.id === 'string' ? profile.id : null;
    }

    function activeVfs() {
        return window.VFS && typeof window.VFS.getNode === 'function' ? window.VFS : null;
    }

    const vfsTokens = new WeakMap();
    let vfsSequence = 0;

    function tokenFor(vfs) {
        const profileId = vfs && typeof vfs.profileId === 'string'
            ? vfs.profileId
            : activeProfileId();
        const dbName = vfs && typeof vfs.dbName === 'string' ? vfs.dbName : 'no-vfs';
        if (!vfs) return String(profileId || 'unknown') + '|' + dbName + '|none';
        if (!vfsTokens.has(vfs)) {
            vfsTokens.set(vfs, 'vfs-' + (++vfsSequence));
        }
        return String(profileId || 'unknown') + '|' + dbName + '|' + vfsTokens.get(vfs);
    }

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function normalizeExtension(value) {
        return String(value == null ? '' : value)
            .trim()
            .toLowerCase()
            .replace(/^\./, '');
    }

    function emit(type, detail) {
        const payload = Object.assign({}, detail || {});
        payload.type = type;
        if (!payload.profileId) payload.profileId = activeProfileId();
        payload.emittedAt = Date.now();
        payload.sequence = ++sequence;

        const set = listeners.get(type);
        if (set) {
            Array.from(set).forEach(function (listener) {
                try {
                    listener(payload);
                } catch (error) {
                    console.warn('[SystemEvents] Listener failed for ' + type, error);
                }
            });
        }

        try {
            document.dispatchEvent(new CustomEvent(type, { detail: payload }));
        } catch (_error) {
            /* supported browsers always provide CustomEvent */
        }
        return payload;
    }

    const events = {
        EVENTS: EVENTS,

        on(type, listener) {
            const name = String(type == null ? '' : type);
            if (!name || typeof listener !== 'function') {
                throw new TypeError('SystemEvents.on requires an event name and function');
            }
            if (!listeners.has(name)) listeners.set(name, new Set());
            const set = listeners.get(name);
            set.add(listener);

            let active = true;
            return function unsubscribe() {
                if (!active) return;
                active = false;
                set.delete(listener);
                if (!set.size) listeners.delete(name);
            };
        },

        once(type, listener) {
            const off = events.on(type, function (detail) {
                off();
                listener(detail);
            });
            return off;
        },

        emit: emit,

        listenerCount(type) {
            const set = listeners.get(String(type == null ? '' : type));
            return set ? set.size : 0;
        }
    };

    /* ── Clipboard ─────────────────────────────────────────────────── */

    const clipboard = {
        _text: null,
        _files: null,

        _currentToken() {
            return tokenFor(activeVfs());
        },

        _clearSilently() {
            this._text = null;
            this._files = null;
        },

        _changed(reason) {
            const state = this.getState();
            emit(EVENTS.CLIPBOARD_CHANGED, {
                kind: state.kind,
                op: state.op,
                count: state.count,
                nodeIds: state.nodeIds,
                reason: reason || 'changed'
            });
        },

        clear(reason) {
            if (!this._text && !this._files) return false;
            this._clearSilently();
            this._changed(reason || 'cleared');
            return true;
        },

        getState() {
            if (this._text && this._text.token !== this._currentToken()) {
                this._clearSilently();
                this._changed('profile-change');
            }
            if (this._files && this._files.token !== this._currentToken()) {
                this._clearSilently();
                this._changed('profile-change');
            }
            if (this._text) {
                return {
                    kind: 'text',
                    op: null,
                    count: 1,
                    nodeIds: [],
                    length: this._text.value.length
                };
            }
            if (this._files) {
                return {
                    kind: 'files',
                    op: this._files.op,
                    count: this._files.nodeIds.length,
                    nodeIds: this._files.nodeIds.slice()
                };
            }
            return { kind: null, op: null, count: 0, nodeIds: [] };
        },

        writeText(value, options) {
            options = options || {};
            const text = value == null ? '' : String(value);
            this._files = null;
            this._text = {
                value: text,
                token: this._currentToken(),
                source: options.source || null,
                capturedAt: Date.now()
            };

            if (window.navigator && window.navigator.clipboard &&
                typeof window.navigator.clipboard.writeText === 'function') {
                try {
                    window.navigator.clipboard.writeText(text).catch(function () {
                        /* Browser clipboard writes are best-effort and permission-gated. */
                    });
                } catch (_error) {
                    /* Keep the in-simulator clipboard usable. */
                }
            }

            this._changed('write-text');
            return { ok: true, kind: 'text', length: text.length };
        },

        readText() {
            if (!this._text) return null;
            if (this._text.token !== this._currentToken()) {
                this._clearSilently();
                this._changed('profile-change');
                return null;
            }
            return this._text.value;
        },

        copyFiles(nodeIds, options) {
            return this.setFiles(nodeIds, 'copy', options);
        },

        cutFiles(nodeIds, options) {
            return this.setFiles(nodeIds, 'cut', options);
        },

        setFiles(nodeIds, op, options) {
            options = options || {};
            const vfs = activeVfs();
            if (!vfs) {
                return { ok: false, code: 'VFS_UNAVAILABLE', message: 'The active virtual filesystem is unavailable.' };
            }
            if (op !== 'copy' && op !== 'cut') {
                return { ok: false, code: 'INVALID_OPERATION', message: 'Clipboard operation must be copy or cut.' };
            }

            const list = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
            const unique = [];
            const seen = new Set();
            for (let i = 0; i < list.length; i += 1) {
                const id = list[i];
                if (!id || seen.has(id)) continue;
                const node = vfs.getNode(id);
                if (!node) {
                    return { ok: false, code: 'NOT_FOUND', message: 'A clipboard source no longer exists.' };
                }
                if (node.id === 'root' || node.id === 'c-drive' ||
                    node.parentId === '__recycle__') {
                    return { ok: false, code: 'ACCESS_DENIED', message: 'That item cannot be placed on the clipboard.' };
                }
                seen.add(id);
                unique.push(id);
            }

            if (!unique.length) {
                return { ok: false, code: 'NO_SELECTION', message: 'Select a virtual file or folder first.' };
            }

            this._text = null;
            this._files = {
                op: op,
                nodeIds: unique,
                token: this._currentToken(),
                source: options.source || null,
                capturedAt: Date.now()
            };

            const paths = unique.map(function (id) {
                return vfs.getPath(id);
            }).filter(Boolean);

            this._changed(op === 'cut' ? 'cut-files' : 'copy-files');
            return {
                ok: true,
                kind: 'files',
                op: op,
                count: unique.length,
                nodeIds: unique.slice(),
                paths: paths
            };
        },

        readFiles() {
            if (!this._files) return null;
            const vfs = activeVfs();
            if (!vfs || this._files.token !== this._currentToken()) {
                this._clearSilently();
                this._changed('profile-change');
                return null;
            }

            const valid = [];
            for (let i = 0; i < this._files.nodeIds.length; i += 1) {
                const node = vfs.getNode(this._files.nodeIds[i]);
                if (!node || node.parentId === '__recycle__') {
                    this._clearSilently();
                    this._changed('stale-source');
                    return null;
                }
                valid.push(node.id);
            }

            return {
                kind: 'files',
                op: this._files.op,
                nodeIds: valid,
                count: valid.length,
                paths: valid.map(function (id) { return vfs.getPath(id); })
            };
        },

        async paste(targetFolderId) {
            const vfs = activeVfs();
            if (!vfs) {
                return { ok: false, code: 'VFS_UNAVAILABLE', message: 'The active virtual filesystem is unavailable.' };
            }

            const hasFiles = Boolean(this._files);
            const entry = this.readFiles();
            if (!entry) {
                return {
                    ok: false,
                    code: hasFiles ? 'STALE_CLIPBOARD' : 'EMPTY_CLIPBOARD',
                    message: hasFiles
                        ? 'The clipboard belonged to another profile or the source was removed.'
                        : 'The clipboard is empty.'
                };
            }

            const target = vfs.getNode(targetFolderId);
            if (!target || target.type !== 'directory' || target.parentId === '__recycle__') {
                return { ok: false, code: 'NOT_A_DIRECTORY', message: 'Paste needs a valid destination folder.' };
            }

            const completed = [];
            for (let i = 0; i < entry.nodeIds.length; i += 1) {
                const nodeId = entry.nodeIds[i];
                try {
                    if (entry.op === 'cut') {
                        await vfs.move(nodeId, targetFolderId);
                    } else {
                        await vfs.copy(nodeId, targetFolderId);
                    }
                    completed.push(nodeId);
                } catch (error) {
                    return {
                        ok: false,
                        code: error && error.code ? error.code : 'PASTE_FAILED',
                        message: error && error.message ? error.message : 'Paste failed.',
                        completed: completed,
                        failedNodeId: nodeId
                    };
                }
            }

            if (entry.op === 'cut') this.clear('pasted');
            emit(EVENTS.CLIPBOARD_PASTED, {
                op: entry.op,
                count: completed.length,
                targetId: targetFolderId,
                completedNodeIds: completed
            });

            return {
                ok: true,
                op: entry.op,
                count: completed.length,
                completed: completed,
                targetId: targetFolderId
            };
        }
    };

    /* ── Notifications ─────────────────────────────────────────────── */

    const notifications = {
        _renderer: null,

        configure(options) {
            options = options || {};
            if (typeof options.renderer === 'function') this._renderer = options.renderer;
            return this;
        },

        notify(message, options) {
            options = options || {};
            const text = String(message == null ? '' : message);
            const level = String(options.level || 'info').toLowerCase();
            const duration = Number.isFinite(Number(options.duration))
                ? Math.max(0, Number(options.duration))
                : 2200;
            const detail = {
                level: level,
                title: options.title ? String(options.title) : '',
                message: text,
                duration: duration
            };

            emit(EVENTS.NOTIFICATION, detail);

            if (this._renderer) {
                try {
                    this._renderer(text, duration, detail);
                } catch (error) {
                    console.warn('[NotificationService] Renderer failed', error);
                }
            }
            return detail;
        },

        error(operation, error, options) {
            options = options || {};
            const code = error && error.code ? String(error.code) : 'ERROR';
            const message = error && error.message
                ? String(error.message)
                : String(error == null ? 'Unknown error' : error);
            const detail = {
                operation: String(operation == null ? '' : operation),
                code: code,
                message: message,
                profileId: activeProfileId()
            };

            emit(EVENTS.ERROR, detail);

            if (options.notify !== false) {
                const prefix = options.title || detail.operation || 'SYSTEM ERROR';
                this.notify(String(prefix).toUpperCase() + ': ' + message, {
                    level: 'error',
                    duration: options.duration || 3200,
                    title: prefix
                });
            }
            return detail;
        }
    };

    /* ── File associations ─────────────────────────────────────────── */

    const associations = new Map();

    function normalizeAssociation(input) {
        if (!input || typeof input !== 'object') return null;
        const id = String(input.id == null ? '' : input.id).trim();
        const extensions = (Array.isArray(input.extensions) ? input.extensions : [input.extensions])
            .map(normalizeExtension)
            .filter(Boolean);
        if (!id || !extensions.length) return null;

        return {
            id: id,
            extensions: Array.from(new Set(extensions)),
            label: String(input.label || id),
            open: typeof input.open === 'function' ? input.open : null,
            appId: input.appId ? String(input.appId).trim().toLowerCase() : null
        };
    }

    function resolveAssociation(extension) {
        const ext = normalizeExtension(extension);
        if (!ext) return null;

        let found = null;
        associations.forEach(function (association) {
            if (association.extensions.indexOf(ext) !== -1) found = association;
        });
        if (found) {
            return {
                kind: found.appId ? 'app' : 'handler',
                id: found.id,
                appId: found.appId,
                label: found.label,
                extensions: found.extensions.slice(),
                open: found.open
            };
        }

        if (window.AppRegistry && typeof window.AppRegistry.findByFileType === 'function') {
            const apps = window.AppRegistry.findByFileType(ext);
            if (apps.length) {
                return {
                    kind: 'app',
                    id: apps[0].id,
                    appId: apps[0].id,
                    label: apps[0].name,
                    extensions: apps[0].fileTypes.slice(),
                    open: null
                };
            }
        }
        return null;
    }

    const files = {
        register(input) {
            const association = normalizeAssociation(input);
            if (!association) {
                throw new TypeError('File association needs an id, extensions, and optional open handler');
            }
            if (associations.has(association.id)) {
                console.warn('[FileAssociationService] Replacing association ' + association.id);
            }
            associations.set(association.id, association);
            return association;
        },

        unregister(id) {
            return associations.delete(String(id == null ? '' : id));
        },

        resolve(extension) {
            return resolveAssociation(extension);
        },

        list() {
            const result = [];
            associations.forEach(function (association) {
                result.push({
                    id: association.id,
                    extensions: association.extensions.slice(),
                    label: association.label,
                    appId: association.appId
                });
            });
            result.sort(function (a, b) { return a.label.localeCompare(b.label); });
            return result;
        },

        async open(nodeOrId, options) {
            options = options || {};
            const vfs = activeVfs();
            if (!vfs) {
                return { ok: false, code: 'VFS_UNAVAILABLE', message: 'The active virtual filesystem is unavailable.' };
            }

            const node = typeof nodeOrId === 'string' ? vfs.getNode(nodeOrId) : nodeOrId;
            if (!node || !vfs.getNode(node.id)) {
                return { ok: false, code: 'NOT_FOUND', message: 'The file is not part of the active virtual filesystem.' };
            }
            if (node.parentId === '__recycle__') {
                return { ok: false, code: 'RECYCLED', message: 'Restore the file before opening it.' };
            }
            if (node.type === 'directory') {
                return { ok: false, code: 'IS_DIRECTORY', message: 'Folders open in Explorer.' };
            }

            const extension = normalizeExtension(node.extension);
            const association = resolveAssociation(extension);
            if (!association) {
                return {
                    ok: false,
                    code: 'NO_ASSOCIATION',
                    message: 'No application is associated with .' + extension + ' files.',
                    nodeId: node.id,
                    extension: extension
                };
            }

            const context = {
                profile: activeProfile(),
                profileId: activeProfileId(),
                vfs: vfs,
                path: vfs.getPath(node.id),
                extension: extension
            };

            try {
                if (association.open) {
                    const result = await association.open(node, context, options);
                    if (result && result.ok === false) return result;
                    emit(EVENTS.FILE_OPENED, {
                        nodeId: node.id,
                        path: context.path,
                        extension: extension,
                        handlerId: association.id
                    });
                    return {
                        ok: true,
                        kind: 'handler',
                        handlerId: association.id,
                        nodeId: node.id,
                        path: context.path,
                        extension: extension
                    };
                }

                if (window.AppRegistry && typeof window.AppRegistry.launch === 'function') {
                    const alreadyRunning = typeof window.AppRegistry.instance === 'function'
                        ? window.AppRegistry.instance(association.appId)
                        : null;
                    const win = window.AppRegistry.launch(
                        association.appId,
                        Object.assign({}, options, { node: node })
                    );
                    if (!win) {
                        return {
                            ok: false,
                            code: 'LAUNCH_FAILED',
                            message: association.label + ' could not start.',
                            appId: association.appId
                        };
                    }

                    if (alreadyRunning) {
                        emit(EVENTS.APP_FILE_OPEN, {
                            appId: association.appId,
                            nodeId: node.id,
                            path: context.path,
                            extension: extension
                        });
                    }
                    emit(EVENTS.FILE_OPENED, {
                        nodeId: node.id,
                        path: context.path,
                        extension: extension,
                        appId: association.appId
                    });
                    return {
                        ok: true,
                        kind: 'app',
                        appId: association.appId,
                        nodeId: node.id,
                        path: context.path,
                        extension: extension
                    };
                }

                return {
                    ok: false,
                    code: 'REGISTRY_UNAVAILABLE',
                    message: 'The application registry is unavailable.'
                };
            } catch (error) {
                const detail = notifications.error('Open file', error, { notify: false });
                return {
                    ok: false,
                    code: detail.code,
                    message: detail.message,
                    nodeId: node.id,
                    reported: true
                };
            }
        }
    };

    /* ── Open / Save dialog ────────────────────────────────────────── */

    const DIALOG_STYLE_ID = 'system-file-dialog-style';

    function installDialogStyles() {
        if (document.getElementById(DIALOG_STYLE_ID) || !document.head) return;
        const style = document.createElement('style');
        style.id = DIALOG_STYLE_ID;
        style.textContent = [
            '.system-file-dialog { z-index: 130; }',
            '.system-file-dialog .dialog { width: min(580px, calc(100vw - 48px)); }',
            '.system-file-dialog .dialog-body { display: flex; flex-direction: column; gap: 9px; }',
            '.file-dialog-path { display: flex; align-items: center; gap: 7px; min-height: 24px; }',
            '.file-dialog-path code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 4px 6px; background: var(--well-bg, #08030d); border: 1px solid var(--bevel-dark, #3b2451); color: var(--ink-70, #cda6ff); font: 11px/1.3 "Cascadia Mono", "Courier New", monospace; }',
            '.file-dialog-up { min-width: 58px; height: 24px; border: 1px solid var(--line-hi, #6f3a93); background: var(--surface-2, #1a0d2a); color: var(--ink-90, #f2eaff); font: 700 10px "Cascadia Mono", "Courier New", monospace; cursor: pointer; }',
            '.file-dialog-up:disabled { color: var(--ink-30, #5d4783); cursor: default; }',
            '.file-dialog-list { height: min(250px, 34vh); overflow: auto; border: 1px solid var(--bevel-dark, #3b2451); background: var(--well-bg, #08030d); }',
            '.file-dialog-row { width: 100%; display: flex; align-items: center; gap: 8px; padding: 5px 7px; border: 0; border-bottom: 1px solid var(--line, #2b173c); background: transparent; color: var(--ink-70, #cda6ff); font: 12px "Cascadia Mono", "Courier New", monospace; text-align: left; cursor: pointer; }',
            '.file-dialog-row:hover { background: rgba(192, 132, 252, 0.09); }',
            '.file-dialog-row.is-selected { background: var(--signal-active, #c084fc); color: #12081d; }',
            '.file-dialog-row .file-dialog-glyph { width: 18px; text-align: center; }',
            '.file-dialog-row .file-dialog-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.file-dialog-row .file-dialog-kind { color: inherit; opacity: 0.62; font-size: 10px; }',
            '.file-dialog-empty { padding: 20px 10px; color: var(--ink-50, #8b72b8); font-size: 11px; text-align: center; }',
            '.file-dialog-name { display: grid; grid-template-columns: 80px minmax(0, 1fr); align-items: center; gap: 8px; color: var(--ink-50, #8b72b8); font: 700 10px "Cascadia Mono", "Courier New", monospace; letter-spacing: 0.06em; text-transform: uppercase; }',
            '.file-dialog-name[hidden] { display: none; }',
            '.file-dialog-name input { height: 26px; padding: 0 7px; border: 1px solid var(--line-hi, #6f3a93); background: var(--well-bg, #08030d); color: var(--ink-90, #f2eaff); font: 12px "Cascadia Mono", "Courier New", monospace; outline: none; }',
            '.file-dialog-name input:focus { border-color: var(--signal-active, #c084fc); }',
            '.file-dialog-error { margin: 0; color: var(--signal-hot, #ff4fd8); font: 11px/1.45 "Cascadia Mono", "Courier New", monospace; }',
            '.file-dialog-error[hidden] { display: none; }',
            '.text-viewer-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px; }',
            '.text-viewer-toolbar .dialog-btn { min-width: 0; height: 24px; padding: 0 9px; }',
            '.text-viewer-toolbar .text-viewer-status { margin-left: auto; color: var(--ink-50, #8b72b8); font-size: 10px; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    const dialog = {
        _session: null,
        _dom: null,

        isOpen() {
            return Boolean(this._session);
        },

        open(options) {
            return this._ask('open', options);
        },

        save(options) {
            return this._ask('save', options);
        },

        _ensureDom() {
            if (this._dom && document.body && document.body.contains(this._dom.overlay)) {
                return this._dom;
            }
            if (!document.body) return null;
            installDialogStyles();

            const overlay = document.createElement('div');
            overlay.className = 'dialog-overlay system-file-dialog';
            overlay.id = 'system-file-dialog';
            overlay.hidden = true;
            overlay.setAttribute('data-system-modal', 'true');
            overlay.innerHTML = [
                '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="system-file-dialog-title">',
                '  <div class="dialog-titlebar" id="system-file-dialog-title">Open</div>',
                '  <div class="dialog-body">',
                '    <div class="file-dialog-path">',
                '      <button type="button" class="file-dialog-up" id="system-file-dialog-up">↑ Up</button>',
                '      <code id="system-file-dialog-path">This PC</code>',
                '    </div>',
                '    <div class="file-dialog-list" id="system-file-dialog-list" role="listbox" tabindex="0" aria-label="Files"></div>',
                '    <label class="file-dialog-name" id="system-file-dialog-name-row"><span>File name</span><input type="text" id="system-file-dialog-name" autocomplete="off" spellcheck="false"></label>',
                '    <p class="file-dialog-error" id="system-file-dialog-error" role="alert" hidden></p>',
                '  </div>',
                '  <div class="dialog-actions">',
                '    <button type="button" class="dialog-btn" id="system-file-dialog-cancel">Cancel</button>',
                '    <button type="button" class="dialog-btn" id="system-file-dialog-ok">Open</button>',
                '  </div>',
                '</div>'
            ].join('');
            document.body.appendChild(overlay);

            const dom = {
                overlay: overlay,
                title: overlay.querySelector('#system-file-dialog-title'),
                up: overlay.querySelector('#system-file-dialog-up'),
                path: overlay.querySelector('#system-file-dialog-path'),
                list: overlay.querySelector('#system-file-dialog-list'),
                nameRow: overlay.querySelector('#system-file-dialog-name-row'),
                name: overlay.querySelector('#system-file-dialog-name'),
                error: overlay.querySelector('#system-file-dialog-error'),
                cancel: overlay.querySelector('#system-file-dialog-cancel'),
                ok: overlay.querySelector('#system-file-dialog-ok')
            };

            dom.cancel.addEventListener('click', () => this.cancel('cancel-button'));
            dom.ok.addEventListener('click', () => this.confirm());
            dom.up.addEventListener('click', () => {
                const session = this._session;
                if (!session) return;
                const current = session.vfs.getNode(session.folderId);
                if (current && current.parentId) this._navigate(current.parentId);
            });
            dom.list.addEventListener('click', (event) => {
                const row = event.target.closest('[data-node-id]');
                if (!row || !this._session) return;
                this._select(row.dataset.nodeId);
            });
            dom.list.addEventListener('dblclick', (event) => {
                const row = event.target.closest('[data-node-id]');
                if (!row || !this._session) return;
                this._select(row.dataset.nodeId);
                const node = this._session.vfs.getNode(row.dataset.nodeId);
                if (node && node.type === 'directory') this._navigate(node.id);
                else this.confirm();
            });
            dom.name.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this.confirm();
                }
            });
            dom.overlay.addEventListener('click', (event) => {
                if (event.target === dom.overlay) this.cancel('backdrop');
            });
            dom.overlay.addEventListener('keydown', (event) => {
                if (!this._session) return;
                if (event.key === 'Escape') {
                    event.preventDefault();
                    this.cancel('escape');
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    this._moveSelection(event.key === 'ArrowDown' ? 1 : -1);
                }
            });

            this._dom = dom;
            return dom;
        },

        _ask(mode, options) {
            options = options || {};
            if (this._session) {
                return Promise.resolve({
                    ok: false,
                    code: 'DIALOG_BUSY',
                    message: 'Another file dialog is already open.'
                });
            }

            const vfs = activeVfs();
            if (!vfs) {
                return Promise.resolve({
                    ok: false,
                    code: 'VFS_UNAVAILABLE',
                    message: 'The active virtual filesystem is unavailable.'
                });
            }

            const dom = this._ensureDom();
            if (!dom) {
                return Promise.resolve({
                    ok: false,
                    code: 'DIALOG_UNAVAILABLE',
                    message: 'The desktop dialog host is not ready.'
                });
            }

            const filters = (Array.isArray(options.extensions) ? options.extensions : [])
                .map(normalizeExtension)
                .filter(Boolean);
            const start = options.startId ? vfs.getNode(options.startId) : null;

            let folderId = start && start.type === 'directory' && start.parentId !== '__recycle__'
                ? start.id
                : null;
            if (!folderId) {
                const known = vfs.getKnownFolder
                    ? (vfs.getKnownFolder('documents') || vfs.getKnownFolder('desktop'))
                    : null;
                folderId = known || (vfs.getNode('c-drive') ? 'c-drive' : 'root');
            }

            const session = {
                mode: mode,
                options: options,
                vfs: vfs,
                token: tokenFor(vfs),
                folderId: folderId,
                selectedId: null,
                filters: filters,
                resolve: null,
                shortcuts: []
            };

            dom.title.textContent = options.title || (mode === 'save' ? 'Save file' : 'Open file');
            dom.ok.textContent = mode === 'save' ? 'Save' : 'Open';
            dom.nameRow.hidden = mode !== 'save';
            dom.name.value = mode === 'save'
                ? String(options.suggestedName || options.name || '')
                : '';
            dom.error.hidden = true;
            dom.error.textContent = '';
            dom.list.scrollTop = 0;

            const promise = new Promise((resolve) => {
                session.resolve = resolve;
            });
            this._session = session;

            this._render();
            if (!this._session) return promise;
            dom.overlay.hidden = false;
            this._registerShortcuts();

            emit(EVENTS.DIALOG_OPEN, {
                mode: mode,
                title: dom.title.textContent,
                folderId: folderId,
                path: vfs.getPath(folderId)
            });

            window.setTimeout(() => {
                if (!this._session) return;
                if (mode === 'save') {
                    const dot = dom.name.value.lastIndexOf('.');
                    dom.name.focus();
                    if (dot > 0) dom.name.setSelectionRange(0, dot);
                    else dom.name.select();
                } else {
                    dom.list.focus();
                }
            }, 0);

            return promise;
        },

        _registerShortcuts() {
            const session = this._session;
            if (!session || !window.ShortcutService) return;
            const service = window.ShortcutService;
            try {
                session.shortcuts.push(service.register({
                    id: 'system.file-dialog.cancel',
                    keys: 'Escape',
                    context: 'global',
                    priority: 1000,
                    allowInEditable: true,
                    allowInDialog: true,
                    description: 'Cancel the shared file dialog',
                    handler: () => {
                        if (this._session) this.cancel('escape');
                    }
                }));
                session.shortcuts.push(service.register({
                    id: 'system.file-dialog.confirm',
                    keys: 'Enter',
                    context: 'global',
                    priority: 1000,
                    allowInEditable: true,
                    allowInDialog: true,
                    description: 'Confirm the shared file dialog',
                    handler: () => {
                        if (this._session) this.confirm();
                    }
                }));
            } catch (error) {
                console.warn('[FileDialogService] Could not register dialog shortcuts', error);
            }
        },

        _releaseShortcuts() {
            const session = this._session;
            if (!session) return;
            session.shortcuts.forEach(function (handle) {
                try { handle(); } catch (_error) { /* already gone */ }
            });
            session.shortcuts = [];
        },

        _render() {
            const session = this._session;
            const dom = this._dom;
            if (!session || !dom) return;
            if (tokenFor(session.vfs) !== session.token) {
                this._finish({
                    ok: false,
                    code: 'PROFILE_CHANGED',
                    message: 'The active profile changed; choose the file again.'
                }, 'profile-change');
                return;
            }

            const folder = session.vfs.getNode(session.folderId);
            if (!folder || folder.type !== 'directory' || folder.parentId === '__recycle__') {
                this._finish({
                    ok: false,
                    code: 'FOLDER_UNAVAILABLE',
                    message: 'The selected folder is no longer available.'
                }, 'folder-unavailable');
                return;
            }

            dom.path.textContent = session.vfs.getPath(folder.id) || folder.name;
            dom.up.disabled = !folder.parentId;

            const children = session.vfs.getChildren(folder.id)
                .filter(function (node) {
                    if (node.attributes && node.attributes.hidden) return false;
                    if (node.type === 'directory' || node.type === 'shortcut') return true;
                    if (node.type !== 'file') return false;
                    if (!session.filters.length) return true;
                    return session.filters.indexOf(normalizeExtension(node.extension)) !== -1;
                })
                .slice()
                .sort(function (a, b) {
                    const aDir = a.type === 'directory' ? 0 : 1;
                    const bDir = b.type === 'directory' ? 0 : 1;
                    if (aDir !== bDir) return aDir - bDir;
                    return a.name.localeCompare(b.name);
                });

            dom.list.replaceChildren();
            if (!children.length) {
                const empty = document.createElement('div');
                empty.className = 'file-dialog-empty';
                empty.textContent = session.filters.length
                    ? 'No matching files in this folder.'
                    : 'This folder is empty.';
                dom.list.appendChild(empty);
            } else {
                children.forEach((node) => {
                    const row = document.createElement('button');
                    row.type = 'button';
                    row.className = 'file-dialog-row';
                    row.dataset.nodeId = node.id;
                    row.setAttribute('role', 'option');
                    row.setAttribute('aria-selected', String(session.selectedId === node.id));
                    if (session.selectedId === node.id) row.classList.add('is-selected');

                    const glyph = document.createElement('span');
                    glyph.className = 'file-dialog-glyph';
                    glyph.textContent = node.type === 'directory' ? '📁'
                        : node.type === 'shortcut' ? '↗'
                        : (session.filters.indexOf(normalizeExtension(node.extension)) !== -1 ? '▤' : '📄');

                    const name = document.createElement('span');
                    name.className = 'file-dialog-name';
                    name.textContent = node.name;

                    const kind = document.createElement('span');
                    kind.className = 'file-dialog-kind';
                    kind.textContent = node.type === 'directory'
                        ? 'Folder'
                        : (node.extension ? node.extension.toUpperCase() : 'File');

                    row.append(glyph, name, kind);
                    dom.list.appendChild(row);
                });
            }

            if (dom.error.hidden) dom.name.setAttribute('aria-invalid', 'false');
        },

        _select(nodeId) {
            const session = this._session;
            const dom = this._dom;
            if (!session || !dom) return;
            const node = session.vfs.getNode(nodeId);
            if (!node) return;
            session.selectedId = node.id;
            if (session.mode === 'save' && node.type === 'file') {
                dom.name.value = node.name;
            }
            dom.list.querySelectorAll('[data-node-id]').forEach(function (row) {
                const selected = row.dataset.nodeId === nodeId;
                row.classList.toggle('is-selected', selected);
                row.setAttribute('aria-selected', String(selected));
            });
            dom.error.hidden = true;
            dom.name.setAttribute('aria-invalid', 'false');
        },

        _moveSelection(delta) {
            const session = this._session;
            const dom = this._dom;
            if (!session || !dom) return;
            const rows = Array.from(dom.list.querySelectorAll('[data-node-id]'));
            if (!rows.length) return;
            let index = rows.findIndex(function (row) {
                return row.dataset.nodeId === session.selectedId;
            });
            if (index === -1) index = delta > 0 ? -1 : 0;
            const next = (index + delta + rows.length) % rows.length;
            this._select(rows[next].dataset.nodeId);
            rows[next].scrollIntoView({ block: 'nearest' });
        },

        _navigate(folderId) {
            const session = this._session;
            if (!session) return;
            if (tokenFor(session.vfs) !== session.token) {
                this._finish({
                    ok: false,
                    code: 'PROFILE_CHANGED',
                    message: 'The active profile changed; choose the file again.'
                }, 'profile-change');
                return;
            }
            const folder = session.vfs.getNode(folderId);
            if (!folder || folder.type !== 'directory' || folder.parentId === '__recycle__') return;
            session.folderId = folder.id;
            session.selectedId = null;
            this._render();
            if (this._dom) this._dom.list.scrollTop = 0;
        },

        _showError(message) {
            const dom = this._dom;
            if (!dom) return;
            dom.error.textContent = message;
            dom.error.hidden = false;
            dom.name.setAttribute('aria-invalid', 'true');
        },

        confirm() {
            const session = this._session;
            const dom = this._dom;
            if (!session || !dom) return;

            if (tokenFor(session.vfs) !== session.token) {
                this._finish({
                    ok: false,
                    code: 'PROFILE_CHANGED',
                    message: 'The active profile changed; choose the file again.'
                }, 'profile-change');
                return;
            }

            const folder = session.vfs.getNode(session.folderId);
            if (!folder || folder.type !== 'directory') {
                this._finish({
                    ok: false,
                    code: 'FOLDER_UNAVAILABLE',
                    message: 'The destination folder is no longer available.'
                }, 'folder-unavailable');
                return;
            }

            if (session.mode === 'open') {
                const selected = session.selectedId ? session.vfs.getNode(session.selectedId) : null;
                if (!selected) {
                    this._showError('Select a file to open.');
                    return;
                }
                if (selected.type === 'directory') {
                    this._navigate(selected.id);
                    return;
                }
                if (selected.type !== 'file') {
                    this._showError('Shortcuts cannot be opened from this dialog.');
                    return;
                }
                if (session.filters.length &&
                    session.filters.indexOf(normalizeExtension(selected.extension)) === -1) {
                    this._showError('That file type is filtered out of this dialog.');
                    return;
                }

                this._finish({
                    ok: true,
                    mode: 'open',
                    nodeId: selected.id,
                    name: selected.name,
                    extension: normalizeExtension(selected.extension),
                    folderId: folder.id,
                    path: session.vfs.getPath(selected.id)
                }, 'open');
                return;
            }

            let name = String(dom.name.value || '').trim();
            if (!name) {
                this._showError('Enter a file name.');
                return;
            }

            const resolver = session.vfs.pathResolver;
            if (resolver && typeof resolver.validateName === 'function') {
                const nameError = resolver.validateName(name);
                if (nameError) {
                    this._showError('Invalid file name: ' + nameError);
                    return;
                }
            }

            if (session.filters.length && session.options.ensureExtension !== false &&
                !/\.[^./\\]+$/.test(name)) {
                name += '.' + session.filters[0];
            }

            const existing = session.vfs.getChildren(folder.id).find(function (node) {
                return node.name.toLowerCase() === name.toLowerCase();
            });

            if (existing && session.options.overwrite !== true) {
                this._showError('A file or folder named "' + name + '" already exists here.');
                return;
            }
            if (existing && existing.type !== 'file') {
                this._showError('That name belongs to a folder.');
                return;
            }

            const path = (session.vfs.getPath(folder.id) || '')
                .replace(/[\\/]+$/, '') + '\\' + name;

            this._finish({
                ok: true,
                mode: 'save',
                folderId: folder.id,
                name: name,
                extension: normalizeExtension(name.split('.').pop()),
                path: path,
                existingNodeId: existing ? existing.id : null
            }, 'save');
        },

        cancel(reason) {
            if (!this._session) return false;
            this._finish({
                ok: false,
                cancelled: true,
                code: 'CANCELLED',
                reason: reason || 'cancel'
            }, reason || 'cancel');
            return true;
        },

        _finish(result, reason) {
            const session = this._session;
            if (!session) return;
            this._releaseShortcuts();
            if (this._dom) {
                this._dom.overlay.hidden = true;
                this._dom.error.hidden = true;
                this._dom.error.textContent = '';
            }
            this._session = null;

            emit(EVENTS.DIALOG_CLOSE, {
                mode: session.mode,
                reason: reason || (result && result.ok ? 'confirm' : 'cancel'),
                resultCode: result && (result.code || (result.ok ? 'OK' : 'CANCELLED'))
            });
            session.resolve(result);
        }
    };

    /* ── Settings ──────────────────────────────────────────────────── */

    function getPath(source, parts) {
        let cursor = source;
        for (let i = 0; i < parts.length; i += 1) {
            if (!cursor || typeof cursor !== 'object') return undefined;
            cursor = cursor[parts[i]];
        }
        return cursor;
    }

    function setPath(target, parts, value) {
        let cursor = target;
        for (let i = 0; i < parts.length - 1; i += 1) {
            const key = parts[i];
            if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
            cursor = cursor[key];
        }
        cursor[parts[parts.length - 1]] = value;
    }

    function currentState() {
        const profileId = activeProfileId();
        if (profileId && window.PersistenceService &&
            typeof window.PersistenceService.getCachedState === 'function') {
            const cached = window.PersistenceService.getCachedState(profileId);
            if (cached) return cached;
        }
        if (window.ProfileState) return clone(window.ProfileState);
        if (window.PersistenceService && typeof window.PersistenceService.defaults === 'function') {
            return window.PersistenceService.defaults();
        }
        return { settings: {}, desktop: {} };
    }

    const settings = {
        get(key, fallback) {
            const parts = String(key == null ? '' : key).split('.').filter(Boolean);
            if (!parts.length) return fallback;
            if (parts.length === 1) parts.unshift('settings');
            const value = getPath(currentState(), parts);
            return value === undefined ? fallback : clone(value);
        },

        getAll() {
            const state = currentState();
            return {
                settings: clone(state.settings || {}),
                desktop: clone(state.desktop || {})
            };
        },

        async set(key, value) {
            const profileId = activeProfileId();
            if (!profileId) throw new Error('No active profile for settings');
            if (!window.PersistenceService ||
                typeof window.PersistenceService.queueSave !== 'function') {
                throw new Error('PersistenceService is unavailable');
            }

            const parts = String(key == null ? '' : key).split('.').filter(Boolean);
            if (parts.length === 1) parts.unshift('settings');
            if (parts.length !== 2 ||
                (parts[0] !== 'settings' && parts[0] !== 'desktop')) {
                const error = new Error('Unknown settings key: ' + key);
                error.code = 'UNKNOWN_SETTING';
                throw error;
            }

            const candidate = currentState();
            setPath(candidate, parts, value);
            const validated = window.PersistenceService.validateState(candidate);
            const safeValue = getPath(validated, parts);
            if (safeValue === undefined) {
                const error = new Error('Unknown settings key: ' + key);
                error.code = 'UNKNOWN_SETTING';
                throw error;
            }

            const partial = {};
            partial[parts[0]] = {};
            partial[parts[0]][parts[1]] = safeValue;

            if (typeof window.PersistenceService.applyState === 'function') {
                window.PersistenceService.applyState(profileId, validated);
            }

            await window.PersistenceService.queueSave(profileId, partial);
            emit(EVENTS.SETTINGS_CHANGED, {
                key: parts.join('.'),
                value: clone(safeValue),
                committed: true
            });
            return clone(safeValue);
        },

        subscribe(listener) {
            return events.on(EVENTS.SETTINGS_CHANGED, listener);
        }
    };

    /* ── Public surface ────────────────────────────────────────────── */

    const api = {
        version: VERSION,
        events: events,
        clipboard: clipboard,
        dialogs: dialog,
        files: files,
        notifications: notifications,
        settings: settings,

        get config() {
            return window.SystemConfig || null;
        },

        diagnostics() {
            const vfs = activeVfs();
            return {
                version: VERSION,
                profileId: activeProfileId(),
                vfsDb: vfs && vfs.dbName ? vfs.dbName : null,
                vfsToken: tokenFor(vfs),
                clipboard: clipboard.getState(),
                dialogOpen: dialog.isOpen(),
                notificationsConfigured: typeof notifications._renderer === 'function',
                associations: files.list(),
                config: window.SystemConfig &&
                    typeof window.SystemConfig.diagnostics === 'function'
                    ? window.SystemConfig.diagnostics()
                    : null,
                eventSequence: sequence
            };
        }
    };

    window.SystemServices = api;

    const boot = window.ProfileReady || window.VirtualFSReady || Promise.resolve();
    api.ready = Promise.resolve(boot).then(function () {
        const vfs = activeVfs();
        emit(EVENTS.SERVICES_READY, {
            version: VERSION,
            vfsDb: vfs && vfs.dbName ? vfs.dbName : null,
            hasVfs: Boolean(vfs)
        });
        return api;
    });

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : {});
