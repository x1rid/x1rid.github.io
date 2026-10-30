document.addEventListener('DOMContentLoaded', () => {
    try {
        const terminal = document.getElementById('terminal');
        const terminalOutput = document.getElementById('terminal-output');
        const terminalInput = document.getElementById('terminal-input');
        const terminalPrompt = document.getElementById('terminal-prompt');
        const navLink = document.getElementById('nav-link-exchange');
        const navPC = document.getElementById('nav-pc-specs');
        const paneLink = document.getElementById('link-exchange');
        const panePC = document.getElementById('pc-specs');
        const content = document.querySelector('.content-area');
        const layout = document.querySelector('.layout-grid');
        const webpagesList = document.getElementById('webpages-list');

        const defaultPromptPrefix = (window.SiteConfig && window.SiteConfig.desktop && window.SiteConfig.desktop.hostname && window.SiteConfig.owner)
            ? `${window.SiteConfig.owner.displayName}@${window.SiteConfig.desktop.hostname}`
            : 'user@desktop';
        const historyStorageKey = 'terminal_history';
        const maxHistoryEntries = 200;
        const builtInCommands = [
            'cls',
            'dir',
            'ls',
            'cd',
            'touch',
            'cat',
            'start',
            'open',
            'echo',
            'man',
            'rm',
            'rmdir',
            'cp',
            'save',
            'load',
            'saved-files',
            'neofetch',
            'layout',
            'promptgap',
            'cursor',
            'sound',
            'help'
        ];

        let cwd = '/';
        let history = loadHistory();
        let historyIndex = history.length;

        /* ------------------------------------------------------------------
         * Phase 2.1 — Real VFS gateway.
         *
         * The terminal no longer owns a fake filesystem tree. All filesystem
         * operations go through the kernel syscall layer exposed by syscalls.js.
         *
         * Structured errors are mandatory. We use OsError/FsError from errors.js
         * whenever available and never throw bare strings.
         * ------------------------------------------------------------------ */
        const LEGACY_ERROR_MAP = Object.freeze({
            NOT_FOUND: 'ENOENT',
            NOT_A_DIRECTORY: 'ENOTDIR',
            NAME_CONFLICT: 'EEXIST',
            INVALID_NAME: 'EINVAL',
            INVALID_PATH: 'EINVAL',
            ACCESS_DENIED: 'EACCES',
            STORAGE_FULL: 'ENOSPC'
        });

        function createOsError(code, message, detail) {
            const Ctor = window.OsError || Error;
            const err = Ctor === Error ? new Error(message || code) : new Ctor(code, message, detail);
            err.name = 'OsError';
            err.code = code;
            if (detail !== undefined) err.detail = detail;
            return err;
        }

        function createFsError(code, message, detail) {
            const Ctor = window.FsError || window.OsError || Error;
            const err = Ctor === Error ? new Error(message || code) : new Ctor(code, message, detail);
            err.name = 'FsError';
            err.code = code;
            if (detail !== undefined) err.detail = detail;
            return err;
        }

        function normalizeFsError(err) {
            let code = 'EINVAL';
            let message = 'Unknown error';
            let detail;
            let name = 'FsError';

            if (typeof err === 'string') {
                message = err;
            } else if (err && typeof err === 'object') {
                code = err.code || code;
                message = err.message || message;
                detail = err.detail;
                name = err.name === 'OsError' ? 'OsError' : 'FsError';
            }

            if (Object.prototype.hasOwnProperty.call(LEGACY_ERROR_MAP, code)) {
                code = LEGACY_ERROR_MAP[code];
            }

            const Ctor = name === 'OsError'
                ? (window.OsError || Error)
                : (window.FsError || window.OsError || Error);

            const normalized = Ctor === Error ? new Error(message) : new Ctor(code, message, detail);
            normalized.name = name;
            normalized.code = code;
            if (detail !== undefined) normalized.detail = detail;
            return normalized;
        }

        function formatError(err) {
            const normalized = normalizeFsError(err);
            const code = normalized.code || 'ERROR';
            const message = normalized.message || 'Unknown error';
            let extra = '';

            if (normalized.detail && typeof normalized.detail === 'object') {
                const p = normalized.detail.path || normalized.detail.resource || normalized.detail.parent;
                if (p) extra = ` (${p})`;
            }

            return `${code}: ${message}${extra}`;
        }

        function getTerminalContext() {
            const owner = window.SiteConfig && window.SiteConfig.owner;
            const desktop = window.SiteConfig && window.SiteConfig.desktop;
            const uid = (owner && (owner.legacyUsername || owner.displayName)) || 'guest';

            return {
                uid: String(uid),
                pid: null,
                app: 'terminal',
                hostname: desktop && desktop.hostname ? desktop.hostname : undefined
            };
        }

        function getSyscallFn() {
            if (window.KernelSyscalls && typeof window.KernelSyscalls.syscall === 'function') {
                return window.KernelSyscalls.syscall.bind(window.KernelSyscalls);
            }

            if (window.Kernel && typeof window.Kernel.syscall === 'function') {
                return window.Kernel.syscall.bind(window.Kernel);
            }

            return null;
        }

        let vfsRoot = null;
        let rootDetectionPromise = null;

        async function syscallFs(name, args) {
            const call = getSyscallFn();

            if (!call) {
                throw createOsError('EBUSY', 'Filesystem service unavailable', { syscall: name });
            }

            let result;

            try {
                result = await call(getTerminalContext(), name, args);
            } catch (err) {
                throw normalizeFsError(err);
            }

            if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
                if (!result.ok) {
                    throw normalizeFsError(result.error || result.message || 'Syscall failed');
                }

                return result.value;
            }

            return result;
        }

        async function statRaw(fsPath) {
            return syscallFs('fs.stat', { path: fsPath });
        }

        async function detectVfsRoot(force = false) {
            if (vfsRoot && !force) return vfsRoot;
            if (rootDetectionPromise && !force) return rootDetectionPromise;

            rootDetectionPromise = (async () => {
                const candidates = ['/', 'C:\\'];

                for (const candidate of candidates) {
                    try {
                        await statRaw(candidate);
                        vfsRoot = candidate;
                        return vfsRoot;
                    } catch (err) {
                        const code = err && err.code;

                        if (code === 'ENOENT' || code === 'NOT_FOUND') {
                            continue;
                        }

                        /*
                         * If a root exists but denies stat, treat it as the root
                         * instead of falling back to a false path.
                         */
                        if (code === 'EACCES' || code === 'EPERM' || code === 'PROFILE_SCOPE') {
                            vfsRoot = candidate;
                            return vfsRoot;
                        }

                        if (code === 'EBUSY') {
                            vfsRoot = '/';
                            return vfsRoot;
                        }
                    }
                }

                vfsRoot = '/';
                return vfsRoot;
            })();

            try {
                return await rootDetectionPromise;
            } finally {
                rootDetectionPromise = null;
            }
        }

        function toFsPath(absPath) {
            const path = String(absPath || '/');

            if (/^[A-Za-z]:\\/.test(path)) {
                return path;
            }

            if (!vfsRoot || vfsRoot === '/') {
                return path;
            }

            if (vfsRoot === 'C:\\') {
                if (path === '/') return 'C:\\';
                return 'C:\\' + path.split('/').filter(Boolean).join('\\');
            }

            const root = String(vfsRoot).replace(/\/+$/, '');
            return path === '/' ? root : root + path;
        }

        async function statPath(absPath) {
            await detectVfsRoot();
            return statRaw(toFsPath(absPath || '/'));
        }

        function isMissingError(err) {
            const code = err && err.code;
            return code === 'ENOENT' || code === 'NOT_FOUND';
        }

        async function tryStatPath(absPath) {
            try {
                return await statPath(absPath);
            } catch (err) {
                const normalized = normalizeFsError(err);
                if (isMissingError(normalized)) return null;
                throw normalized;
            }
        }

        function isDirectory(node) {
            return !!(node && (node.type === 'directory' || node.type === 'dir'));
        }

        function isFile(node) {
            return !!(node && node.type === 'file');
        }

        async function listPath(absPath) {
            await detectVfsRoot();

            const value = await syscallFs('fs.list', { path: toFsPath(absPath || '/') });
            let entries = [];

            if (Array.isArray(value)) {
                entries = value;
            } else if (value && Array.isArray(value.entries)) {
                entries = value.entries;
            } else if (value && typeof value === 'object') {
                entries = Object.keys(value).map((key) => {
                    const item = value[key];

                    if (item && typeof item === 'object') {
                        return Object.assign({ name: key }, item);
                    }

                    return { name: key, type: item };
                });
            }

            return entries
                .filter((entry) => entry && (entry.name || entry.id))
                .map((entry) => Object.assign({}, entry, { name: entry.name || String(entry.id) }));
        }

        async function readPath(absPath) {
            await detectVfsRoot();

            const value = await syscallFs('fs.read', { path: toFsPath(absPath || '/') });

            if (typeof value === 'string') return value;
            if (value && typeof value.content === 'string') return value.content;
            if (value && typeof value.data === 'string') return value.data;

            return '';
        }

        async function writePath(absPath, content) {
            await detectVfsRoot();

            const safeContent = content === null || content === undefined ? '' : String(content);

            await syscallFs('fs.write', {
                path: toFsPath(absPath || '/'),
                content: safeContent
            });
        }

        async function removePath(absPath) {
            await detectVfsRoot();
            await syscallFs('fs.remove', { path: toFsPath(absPath || '/') });
        }

        function parentPath(absPath) {
            if (!absPath || absPath === '/') return '/';

            const segments = String(absPath).split('/').filter(Boolean);
            segments.pop();

            return segments.length ? `/${segments.join('/')}` : '/';
        }

        function pathBasename(absPath) {
            const segments = String(absPath || '').split('/').filter(Boolean);
            return segments.pop() || '/';
        }

        function joinPath(dir, name) {
            const cleanDir = String(dir || '/');
            const cleanName = String(name || '').replace(/^\/+|\/+$/g, '');

            if (!cleanName) return cleanDir;
            if (cleanDir === '/') return `/${cleanName}`;

            return `${cleanDir}/${cleanName}`;
        }

        function isServableWebRoot() {
            return !vfsRoot || vfsRoot === '/';
        }

        function toWebUrl(absPath) {
            return absPath;
        }

        if (terminalInput && terminalInput.parentElement) {
            terminalInput.parentElement.classList.add('terminal-input-line');
        }

        function loadHistory() {
            try {
                const raw = localStorage.getItem(historyStorageKey);
                const parsed = raw ? JSON.parse(raw) : [];
                if (!Array.isArray(parsed)) return [];
                return parsed.filter((entry) => typeof entry === 'string' && entry.trim());
            } catch (error) {
                return [];
            }
        }

        function saveHistory() {
            try {
                localStorage.setItem(historyStorageKey, JSON.stringify(history.slice(-maxHistoryEntries)));
            } catch (error) {
                // Ignore storage failures.
            }
        }

        function pushHistory(value) {
            const entry = String(value || '').trim();
            if (!entry) return;
            history.push(entry);
            history = history.slice(-maxHistoryEntries);
            historyIndex = history.length;
            saveHistory();
        }

        function removeSavedFile(name) {
            try {
                const key = 'terminal_saved_files_v1';
                const raw = localStorage.getItem(key);
                const map = raw ? JSON.parse(raw) : {};
                if (!Object.prototype.hasOwnProperty.call(map, name)) return false;
                delete map[name];
                localStorage.setItem(key, JSON.stringify(map));
                return true;
            } catch (e) { return false; }
        }

        function resolvePath(inputPath) {
            if (!inputPath) return cwd;
            if (inputPath === '.') return cwd;
            if (inputPath === '..') {
                if (cwd === '/') return '/';
                const segments = cwd.split('/').filter(Boolean);
                segments.pop();
                return segments.length ? `/${segments.join('/')}` : '/';
            }

            if (inputPath.startsWith('/')) {
                return inputPath.replace(/\/+$/, '') || '/';
            }

            const base = cwd === '/' ? '' : cwd;
            const combined = `${base}/${inputPath}`.replace(/\/+/g, '/');
            return `/${combined.replace(/^\/+/, '').replace(/\/+$/, '')}` || '/';
        }

        function getPromptText() {
            const suffix = cwd === '/' ? '~' : `~${cwd}`;
            return `${defaultPromptPrefix}:${suffix}$`;
        }

        function syncPromptWidth(target) {
            if (!target) return;
            target.style.setProperty('--terminal-prompt-width', `${getPromptText().length}ch`);
        }

        function setPrompt() {
            if (terminalPrompt) {
                terminalPrompt.textContent = getPromptText();
            }
            syncPromptWidth(terminal);
        }

        let scrollQueued = false;

        function scrollTerminalToBottom() {
            if (!terminal || scrollQueued) return;
            scrollQueued = true;
            requestAnimationFrame(() => {
                scrollQueued = false;
                terminal.scrollTop = terminal.scrollHeight;
            });
        }

        function focusInput() {
            if (terminalInput) {
                terminalInput.focus();
            }
        }

        function appendTextLine(text, className = '') {
            if (!terminalOutput) return;
            const line = document.createElement('div');
            line.className = `terminal-line terminal-text${className ? ` ${className}` : ''}`;
            line.textContent = text;
            terminalOutput.appendChild(line);
            scrollTerminalToBottom();
        }

        /* Appends many lines with one DOM write + one scroll. */
        function appendTextLines(lines, className = '') {
            if (!terminalOutput || !Array.isArray(lines) || !lines.length) return;
            const fragment = document.createDocumentFragment();
            lines.forEach((text) => {
                const line = document.createElement('div');
                line.className = `terminal-line terminal-text${className ? ` ${className}` : ''}`;
                line.textContent = String(text);
                fragment.appendChild(line);
            });
            terminalOutput.appendChild(fragment);
            scrollTerminalToBottom();
        }

        function createCommandEntry(promptText, commandText) {
            const entry = document.createElement('div');
            entry.className = 'terminal-line terminal-command-line';
            entry.style.setProperty('--terminal-prompt-width', `${promptText.length}ch`);

            const promptSpan = document.createElement('span');
            promptSpan.className = 'terminal-prompt';
            promptSpan.textContent = promptText;

            const commandSpan = document.createElement('span');
            commandSpan.className = 'terminal-command';
            commandSpan.textContent = commandText;

            entry.appendChild(promptSpan);
            entry.appendChild(commandSpan);
            return entry;
        }

        function appendCommandEcho(commandText) {
            if (!terminalOutput) return;
            terminalOutput.appendChild(createCommandEntry(getPromptText(), commandText));
            scrollTerminalToBottom();
        }

        let neofetchContent = null;

        function buildNeofetchContent() {
            const fragment = document.createDocumentFragment();

            const grid = document.createElement('div');
            grid.className = 'neofetch-grid';

            const logo = document.createElement('pre');
            logo.className = 'neofetch-logo';
            logo.setAttribute('aria-hidden', 'true');
            logo.textContent = [
                '        ,.=:!!t3Z3z.,',
                '       :tt:::tt333EE3',
                '       Et:::ztt33EEEL @Ee.,      ..,',
                '      ;tt:::tt333EE7 ;EEEEEEttttt33#',
                '     :Et:::zt333EEQ. $EEEEEttttt33QL',
                '     it::::tt333EEF @EEEEEEttttt33F',
                '    ;3=*^```"*4EEV :EEEEEEttttt33@.',
                '    ,.=::::!t=., ` @EEEEEEtttz33QF',
                '   ;::::::::zt33)   "4EEEtttji3P*',
                '  :t::::::::tt33.:Z3z..  `` ,..g.',
                '  i::::::::zt33F AEEEtttt::::ztF',
                ' ;:::::::::t33V ;EEEttttt::::t3',
                ' E::::::::zt33L @EEEtttt::::z3F',
                '{3=*^```"*4E3) ;EEEtttt:::::tZ`',
                '             ` :EEEEtttt::::z7',
                '                 "VEzjt:;;z>*`'
            ].join('\n');

            const info = document.createElement('div');
            info.className = 'neofetch-info';

            const title = document.createElement('div');
            title.className = 'neofetch-title';
            title.textContent = defaultPromptPrefix;

            const divider = document.createElement('div');
            divider.className = 'neofetch-divider';
            divider.textContent = '--------------';

            const rows = [
                ['OS:', 'Windows 11'],
                ['Build:', '25H2 (26200)'],
                ['Uptime:', '2 days, 23 hours, 5 minutes'],
                ['Resolution:', '1920x1080 @60Hz'],
                ['Terminal:', 'Windows Terminal'],
                ['Shell:', 'zsh'],
                ['Theme:', 'purple-black'],
                ['CPU:', 'Intel(R) Core(TM) i7-10610U CPU @ 1.80GHz'],
                ['GPU:', 'Intel(R) UHD Graphics'],
                ['Memory:', '11203 MB / 16102 MB (69% in use)'],
                ['Disk:', 'C:\\ 385.02 GB (19.34 GB free)']
            ];

            info.appendChild(title);
            info.appendChild(divider);

            const rowsFragment = document.createDocumentFragment();
            rows.forEach(([label, value]) => {
                const row = document.createElement('div');
                row.className = 'neofetch-row';

                const labelSpan = document.createElement('span');
                labelSpan.className = 'neofetch-label';
                labelSpan.textContent = label;

                const valueSpan = document.createElement('span');
                valueSpan.className = 'neofetch-value';
                valueSpan.textContent = value;

                row.appendChild(labelSpan);
                row.appendChild(valueSpan);
                rowsFragment.appendChild(row);
            });
            info.appendChild(rowsFragment);

            const palette = document.createElement('div');
            palette.className = 'neofetch-palette';
            palette.setAttribute('aria-hidden', 'true');
            ['#0b061d', '#2b1145', '#6f3a93', '#c084fc', '#ff4fd8', '#55ff99', '#f2eaff', '#05020c'].forEach((color) => {
                const block = document.createElement('span');
                block.style.background = color;
                palette.appendChild(block);
            });

            grid.appendChild(logo);
            grid.appendChild(info);
            info.appendChild(palette);
            fragment.appendChild(grid);
            return fragment;
        }

        function createNeofetchBlock() {
            const wrapper = document.createElement('div');
            wrapper.className = 'terminal-neofetch';
            wrapper.appendChild(createCommandEntry(getPromptText(), 'neofetch'));

            if (!neofetchContent) neofetchContent = buildNeofetchContent();
            wrapper.appendChild(neofetchContent.cloneNode(true));
            return wrapper;
        }

        function appendNeofetch() {
            if (!terminalOutput) return;
            terminalOutput.appendChild(createNeofetchBlock());
            scrollTerminalToBottom();
        }

        function hasNeofetchRendered() {
            return !!(terminalOutput && terminalOutput.querySelector('.terminal-neofetch'));
        }

        function runNeofetchIfNeeded() {
            if (hasNeofetchRendered()) return;
            pushHistory('neofetch');
            runCommand('neofetch');
        }

        // Simple man pages for built-in commands
        const manPages = {
            cls: 'Clear the terminal output. Usage: cls',
            dir: 'List files in the current directory. Usage: dir',
            ls: 'Alias for dir. Usage: ls',
            cd: 'Change directory. Usage: cd <path>',
            start: 'Open a local HTML file or external URL in the webpage pane. Usage: start <path|url>',
            open: 'Alias for start. Usage: open <path|url>',
            echo: 'Echo text to the terminal. Usage: echo <text>',
            man: 'Show manual pages for commands or view text files. Usage: man <command|path>',
            save: 'Save current open editor buffer to browser storage. Usage: save [name]',
            load: 'Load a saved file from browser storage into the editor. Usage: load <name>',
            'saved-files': 'List files saved in browser storage. Usage: saved-files',
            neofetch: 'Show system information art block. Usage: neofetch',
            layout: 'Set terminal layout. Usage: layout <compact|normal>',
            promptgap: 'Adjust prompt gap in px or keywords. Usage: promptgap <px|tight|normal|wide>',
            cursor: 'Switch the pointer scheme. Usage: cursor <ghost|classic|rail|native>',
            sound: 'Toggle retro interface sounds. Usage: sound <on|off|toggle|test>',
            help: 'Show a short help summary. Usage: help'
        };

        // expose current editor state for CLI commands
        let currentEditor = null;

        // Terminal pager/viewer overlay
        function openTextViewer(title, text) {
            if (!terminal) return;
            closeTextViewer();
            const overlay = document.createElement('div');
            overlay.className = 'terminal-pager';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-label', title || 'viewer');

            const header = document.createElement('div');
            header.className = 'terminal-pager-header';
            header.textContent = title || '';

            const closeBtn = document.createElement('button');
            closeBtn.className = 'terminal-pager-close';
            closeBtn.textContent = 'Close';
            closeBtn.addEventListener('click', closeTextViewer);
            header.appendChild(closeBtn);

            const body = document.createElement('pre');
            body.className = 'terminal-pager-body';
            body.textContent = String(text || '');

            overlay.appendChild(header);
            overlay.appendChild(body);
            document.body.appendChild(overlay);

            // focus for keyboard handling
            overlay.tabIndex = -1;
            overlay.focus();
            // support ESC to close
            overlay.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' || e.key === 'q') {
                    e.preventDefault();
                    closeTextViewer();
                }
            });
        }

        function closeTextViewer() {
            const existing = document.querySelector('.terminal-pager');
            if (existing && existing.parentElement) existing.parentElement.removeChild(existing);
        }

        // Advanced text editor/viewer with basic vim/nano-like controls
        function downloadTextFile(filename, content) {
            try {
                const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename || 'file.txt';
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (e) {
                // fallback: copy to clipboard
                try { navigator.clipboard.writeText(content); } catch (e) {}
            }
        }

        function openTextEditor(title, text, options = {}) {
            if (!terminal) return;
            closeTextViewer();
            const editable = !!options.editable;
            const filename = options.filename || 'file.txt';

            const overlay = document.createElement('div');
            overlay.className = 'terminal-pager terminal-pager-editor';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-label', title || 'editor');

            const header = document.createElement('div');
            header.className = 'terminal-pager-header';
            const titleSpan = document.createElement('span');
            titleSpan.textContent = title || filename;
            header.appendChild(titleSpan);

            const controls = document.createElement('div');

            if (editable) {
                const toggle = document.createElement('button');
                toggle.className = 'terminal-pager-toggle';
                toggle.textContent = 'Edit';
                controls.appendChild(toggle);

                const saveBtn = document.createElement('button');
                saveBtn.className = 'terminal-pager-save';
                saveBtn.textContent = 'Download';
                controls.appendChild(saveBtn);

                const saveBrowserBtn = document.createElement('button');
                saveBrowserBtn.className = 'terminal-pager-save-browser';
                saveBrowserBtn.textContent = 'Save to Browser';
                controls.appendChild(saveBrowserBtn);

                saveBtn.addEventListener('click', () => {
                    const val = textarea.value;
                    downloadTextFile(filename, val);
                });

                saveBrowserBtn.addEventListener('click', () => {
                    const val = textarea.value;
                    try { saveFileToStorage(filename, val); appendTextLine(`Saved to browser: ${filename}`, 'terminal-muted'); } catch (e) { appendTextLine('Failed to save to browser.', 'terminal-muted'); }
                });

                toggle.addEventListener('click', () => {
                    const isEditing = overlay.classList.toggle('editing');
                    toggle.textContent = isEditing ? 'View' : 'Edit';
                    if (isEditing) {
                        textarea.style.display = '';
                        pre.style.display = 'none';
                        textarea.focus();
                    } else {
                        pre.textContent = textarea.value;
                        pre.style.display = '';
                        textarea.style.display = 'none';
                    }
                });
            }

            const closeBtn = document.createElement('button');
            closeBtn.className = 'terminal-pager-close';
            closeBtn.textContent = 'Close';
            closeBtn.addEventListener('click', closeTextViewer);
            controls.appendChild(closeBtn);

            header.appendChild(controls);

            const pre = document.createElement('pre');
            pre.className = 'terminal-pager-body';
            pre.textContent = String(text || '');

            const textarea = document.createElement('textarea');
            textarea.className = 'terminal-pager-edit';
            textarea.value = String(text || '');
            textarea.style.display = 'none';

            overlay.appendChild(header);
            overlay.appendChild(pre);
            overlay.appendChild(textarea);
            document.body.appendChild(overlay);

            // track current editor for CLI commands
            currentEditor = {
                overlay,
                textarea,
                filename,
                path: options.path || null
            };

            // keyboard interactions
            let lastKey = '';
            overlay.tabIndex = -1;
            overlay.focus();

            overlay.addEventListener('keydown', (e) => {
                // Close with Esc or Ctrl+Q
                if (e.key === 'Escape' || (e.ctrlKey && e.key.toLowerCase() === 'q')) {
                    e.preventDefault();
                    closeTextViewer();
                    return;
                }

                // If editing: Ctrl+S to save (download)
                if (overlay.classList.contains('editing')) {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                        e.preventDefault();
                        downloadTextFile(filename, textarea.value);
                    }
                    return;
                }

                // Viewing mode navigation (vim-like)
                const bodyEl = pre;
                if (!bodyEl) return;

                if (e.key === 'j' || e.key === 'ArrowDown') {
                    bodyEl.scrollBy(0, 40);
                    e.preventDefault();
                } else if (e.key === 'k' || e.key === 'ArrowUp') {
                    bodyEl.scrollBy(0, -40);
                    e.preventDefault();
                } else if (e.key === 'G') {
                    bodyEl.scrollTop = bodyEl.scrollHeight;
                    e.preventDefault();
                } else if (e.key === 'g') {
                    if (lastKey === 'g') {
                        bodyEl.scrollTop = 0;
                    }
                    // wait for possible second 'g'
                    setTimeout(() => { lastKey = ''; }, 300);
                    lastKey = 'g';
                } else if (e.key === '/') {
                    // simple search prompt and scroll to first match
                    e.preventDefault();
                    const term = prompt('Search for:');
                    if (!term) return;
                    const txt = pre.textContent || '';
                    const idx = txt.toLowerCase().indexOf(term.toLowerCase());
                    if (idx >= 0) {
                        // approximate line position
                        const before = txt.slice(0, idx);
                        const lineCount = (before.match(/\n/g) || []).length;
                        const approxLineHeight = 18; // pixels
                        bodyEl.scrollTop = Math.max(0, lineCount * approxLineHeight - 12);
                    } else {
                        appendTextLine('Search not found.', 'terminal-muted');
                    }
                }
            });

            // initial mode
            if (editable) {
                overlay.classList.add('editable');
            }
        }

        function saveFileToStorage(name, content) {
            if (!name) throw new Error('Missing name');
            try {
                const key = 'terminal_saved_files_v1';
                const raw = localStorage.getItem(key);
                const map = raw ? JSON.parse(raw) : {};
                map[name] = {
                    content: String(content || ''),
                    modified: Date.now()
                };
                localStorage.setItem(key, JSON.stringify(map));
            } catch (e) {
                throw e;
            }
        }

        function loadFileFromStorage(name) {
            if (!name) return null;
            try {
                const key = 'terminal_saved_files_v1';
                const raw = localStorage.getItem(key);
                const map = raw ? JSON.parse(raw) : {};
                const entry = map[name];
                return entry ? entry.content : null;
            } catch (e) {
                return null;
            }
        }

        function listSavedFiles() {
            try {
                const key = 'terminal_saved_files_v1';
                const raw = localStorage.getItem(key);
                const map = raw ? JSON.parse(raw) : {};
                return Object.keys(map || {});
            } catch (e) { return []; }
        }

        function getCompletions(input) {
            const raw = String(input || '');
            const trailingSpace = /\s$/.test(raw);
            const trimmed = raw.replace(/\s+$/, '');
            const tokens = trimmed ? trimmed.split(/\s+/) : [];
            const commandPosition = tokens.length <= 1 && !trailingSpace;
            const partial = commandPosition ? (tokens[0] || '') : (trailingSpace ? '' : tokens[tokens.length - 1]);

            let candidates;
            if (commandPosition) {
                const node = getNode(cwd) || { children: {} };
                const currentChildren = Object.keys(node.children || {});
                const rootChildren = Object.keys((vfs['/'] && vfs['/'].children) || {});
                candidates = Array.from(new Set([...builtInCommands, ...currentChildren, ...rootChildren]));
            } else {
                const node = getNode(cwd) || { children: {} };
                candidates = Object.keys(node.children || {});
            }

            const matches = partial
                ? candidates.filter((entry) => entry.toLowerCase().startsWith(partial.toLowerCase()))
                : candidates;

            return { matches, partial, commandPosition };
        }

        function applyCompletion(input, match, commandPosition) {
            const raw = String(input || '');
            const trimmed = raw.replace(/\s+$/, '');
            if (!trimmed) return `${match} `;
            if (commandPosition) return `${match} `;

            const tokens = trimmed.split(/\s+/);
            tokens[tokens.length - 1] = match;
            return `${tokens.join(' ')} `;
        }

        function clearTerminal() {
            if (terminalOutput) {
                terminalOutput.innerHTML = '';
            }
        }

        function setLayoutMode(mode) {
            if (!terminal) return;
            terminal.style.height = mode === 'compact' ? '320px' : '450px';
        }

        function setTerminalGap(px) {
            if (!terminal) return;
            const value = Math.max(0, Number(px) || 0);
            terminal.style.setProperty('--terminal-gap', `${value}px`);
        }

        function runCommand(rawInput) {
            const raw = String(rawInput || '');
            const input = raw.trim();
            if (!input) return;

            const parts = input.split(/\s+/);
            let command = parts[0].toLowerCase();
            const arg = parts.slice(1).join(' ');

            // `open` is a user-facing alias for `start`
            if (command === 'open') command = 'start';

            if (command === 'cls') {
                clearTerminal();
                return;
            }

            if (command !== 'neofetch') {
                appendCommandEcho(input);
            }

            if (command === 'ls') {
                // alias for dir
                const node = getNode(cwd);
                if (!node || node.type !== 'dir') {
                    appendTextLine('File not found.', 'terminal-muted');
                    return;
                }

                const names = Object.keys(node.children || {}).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
                // mark repo files as read-only
                const display = names.map((n) => {
                    const childPath = `${cwd === '/' ? '' : cwd}/${n}`.replace(/\/+/g, '/');
                    const nodeAbs = resolvePath(childPath);
                    if (getNode(nodeAbs)) return `${n} (ro)`;
                    return n;
                });
                appendTextLine(display.length ? display.join('  ') : '(empty)', 'terminal-muted');
                return;
            }

            if (command === 'dir') {
                const node = getNode(cwd);
                if (!node || node.type !== 'dir') {
                    appendTextLine('File not found.', 'terminal-muted');
                    return;
                }

                const names = Object.keys(node.children || {}).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
                const display = names.map((n) => `${n}${getNode(resolvePath(`${cwd === '/' ? '' : cwd}/${n}`)) ? ' (ro)' : ''}`);
                appendTextLine(display.length ? display.join('  ') : '(empty)', 'terminal-muted');
                return;
            }

            if (command === 'cd') {
                if (!arg) {
                    appendTextLine(cwd, 'terminal-muted');
                    return;
                }

                const nextPath = resolvePath(arg);
                const node = getNode(nextPath);
                if (!node || node.type !== 'dir') {
                    appendTextLine('The system cannot find the path specified.', 'terminal-muted');
                    return;
                }

                cwd = nextPath;
                setPrompt();
                return;
            }

            if (command === 'start') {
                if (!arg) {
                    appendTextLine('Usage: start <path>', 'terminal-muted');
                    return;
                }

                if (/^https?:\/\//i.test(arg)) {
                    // Open remote site inside the page with unlock animation
                    openWebpage(arg, arg.replace(/^https?:\/\//, '').replace(/\/.*/, ''));
                    return;
                }

                const targetPath = resolvePath(arg);
                const node = getNode(targetPath);

                if (node && node.type === 'dir') {
                    // open index.html inside site pane
                    openWebpage(`${targetPath}/index.html`, targetPath.replace(/\//g, '') || targetPath);
                    return;
                }

                if (node && node.type === 'file') {
                    if (targetPath.toLowerCase().endsWith('.html')) {
                        openWebpage(targetPath, targetPath.split('/').pop());
                        return;
                    }
                    window.open(targetPath, '_blank', 'noopener');
                    return;
                }

                // fallback: open as relative URL inside pane if .html, otherwise new tab
                if (targetPath.toLowerCase().endsWith('.html')) {
                    openWebpage(targetPath, targetPath.split('/').pop());
                    return;
                }

                window.open(targetPath, '_blank', 'noopener');
                return;
            }

            if (command === 'man') {
                if (!arg) {
                    const keys = Object.keys(manPages).sort();
                    appendTextLines([
                        'Manual pages available:',
                        '  ' + keys.join('  '),
                        'Usage: man <command|path>  (press ESC or click Close to dismiss viewer)'
                    ], 'terminal-muted');
                    return;
                }

                const key = arg.toLowerCase();
                if (manPages[key]) {
                    openTextViewer(`man ${key}`, manPages[key] + '\n\n(Press ESC or click Close to dismiss)');
                    return;
                }

                // If it's a file path, attempt to fetch and display it
                try {
                    const targetPath = resolvePath(arg);
                    const node = getNode(targetPath);
                    if (node && node.type === 'file') {
                        // attempt to fetch the raw file from the server
                        fetch(targetPath).then((resp) => {
                            if (!resp.ok) throw new Error('Failed to fetch');
                            return resp.text();
                        }).then((txt) => {
                            openTextEditor(targetPath, txt, { editable: true, filename: (targetPath.split('/').pop() || 'file.txt') });
                        }).catch((err) => {
                            appendTextLine('Could not load file for viewing.', 'terminal-muted');
                        });
                        return;
                    }
                } catch (e) {
                    // ignore
                }

                appendTextLine(`No manual entry for ${arg}`, 'terminal-muted');
                return;
            }

            if (command === 'rm') {
                if (!arg) { appendTextLine('Usage: rm <name>', 'terminal-muted'); return; }
                const name = arg.trim();
                // if it's a repo file, deny
                const possibleRepo = resolvePath(name);
                if (getNode(possibleRepo)) {
                    appendTextLine('Cannot remove: file is part of the site and read-only.', 'terminal-muted');
                    return;
                }
                // try removing saved file
                if (removeSavedFile(name)) {
                    appendTextLine(`Removed ${name} from browser storage.`, 'terminal-muted');
                    return;
                }
                appendTextLine(`${name}: No such file`, 'terminal-muted');
                return;
            }

            if (command === 'rmdir') {
                if (!arg) { appendTextLine('Usage: rmdir <name>', 'terminal-muted'); return; }
                const name = arg.trim();
                const possibleRepo = resolvePath(name);
                // deny removing repo dirs
                const node = getNode(possibleRepo);
                if (node && node.type === 'dir') {
                    appendTextLine('Cannot remove: directory is part of the site and read-only.', 'terminal-muted');
                    return;
                }
                // remove saved files under prefix
                const saved = listSavedFiles();
                const prefix = name.endsWith('/') ? name : `${name}/`;
                const toRemove = saved.filter((k) => k.startsWith(prefix));
                if (!toRemove.length) {
                    appendTextLine('No saved files under that directory.', 'terminal-muted');
                    return;
                }
                toRemove.forEach((k) => removeSavedFile(k));
                appendTextLine(`Removed ${toRemove.length} saved files.`, 'terminal-muted');
                return;
            }

            if (command === 'cp') {
                // cp <source> <dest>
                const parts = input.split(/\s+/);
                if (parts.length < 3) { appendTextLine('Usage: cp <source> <dest>', 'terminal-muted'); return; }
                const source = parts[1];
                const dest = parts[2];
                // dest must not be a repo file
                if (getNode(resolvePath(dest))) {
                    appendTextLine('Cannot overwrite site files. Destination is read-only.', 'terminal-muted');
                    return;
                }
                // source: if it's a repo file, fetch it; if saved file, load from storage
                const srcRepoPath = resolvePath(source);
                if (getNode(srcRepoPath) && getNode(srcRepoPath).type === 'file') {
                    fetch(srcRepoPath).then((r) => { if (!r.ok) throw new Error('fetch failed'); return r.text(); }).then((txt) => {
                        try { saveFileToStorage(dest, txt); appendTextLine(`Copied ${source} -> ${dest}`, 'terminal-muted'); } catch (e) { appendTextLine('Failed to save destination.', 'terminal-muted'); }
                    }).catch(() => appendTextLine('Failed to read source file.', 'terminal-muted'));
                    return;
                }
                const savedContent = loadFileFromStorage(source);
                if (savedContent !== null) {
                    try { saveFileToStorage(dest, savedContent); appendTextLine(`Copied ${source} -> ${dest}`, 'terminal-muted'); } catch (e) { appendTextLine('Failed to save destination.', 'terminal-muted'); }
                    return;
                }
                appendTextLine('Source not found.', 'terminal-muted');
                return;
            }

            if (command === 'save') {
                // save current editor buffer to browser storage
                if (!currentEditor || !currentEditor.textarea) {
                    appendTextLine('No open editor to save.', 'terminal-muted');
                    return;
                }
                const name = arg && arg.trim() ? arg.trim() : (currentEditor.filename || 'file.txt');
                try {
                    saveFileToStorage(name, currentEditor.textarea.value);
                    appendTextLine(`Saved to browser: ${name}`, 'terminal-muted');
                } catch (e) {
                    appendTextLine('Failed to save to browser.', 'terminal-muted');
                }
                return;
            }

            if (command === 'load') {
                if (!arg) {
                    appendTextLine('Usage: load <name>', 'terminal-muted');
                    return;
                }
                const name = arg.trim();
                const content = loadFileFromStorage(name);
                if (content === null) {
                    appendTextLine(`No saved file named ${name}`, 'terminal-muted');
                    return;
                }
                openTextEditor(name, content, { editable: true, filename: name });
                appendTextLine(`Loaded ${name} into editor`, 'terminal-muted');
                return;
            }

            if (command === 'saved-files' || command === 'savedfiles') {
                const keys = listSavedFiles();
                appendTextLine(keys.length ? keys.join('  ') : '(no saved files)', 'terminal-muted');
                return;
            }

            if (command === 'echo') {
                if (arg) appendTextLine(arg);
                return;
            }

            if (command === 'neofetch') {
                appendNeofetch();
                return;
            }

            if (command === 'layout') {
                if (!arg) {
                    appendTextLine('Usage: layout <compact|normal>', 'terminal-muted');
                    return;
                }

                const mode = arg.toLowerCase();
                if (mode === 'compact') {
                    setLayoutMode('compact');
                    appendTextLine('Layout: compact', 'terminal-muted');
                    return;
                }

                setLayoutMode('normal');
                appendTextLine('Layout: normal', 'terminal-muted');
                return;
            }

            if (command === 'promptgap') {
                if (!arg) {
                    const gap = getComputedStyle(terminal).getPropertyValue('--terminal-gap').trim() || '0px';
                    appendTextLine(`Prompt gap: ${gap}`, 'terminal-muted');
                    return;
                }

                const keywords = {
                    tight: 0,
                    normal: 0,
                    wide: 4
                };

                const value = Object.prototype.hasOwnProperty.call(keywords, arg.toLowerCase()) ? keywords[arg.toLowerCase()] : Number(arg);
                if (!Number.isFinite(value) || value < 0) {
                    appendTextLine('Usage: promptgap <px|tight|normal|wide>', 'terminal-muted');
                    return;
                }

                setTerminalGap(value);
                appendTextLine(`Prompt gap set to ${value}px`, 'terminal-muted');
                return;
            }

            if (command === 'cursor') {
                const cursorApi = window.SiteCursor;
                if (!cursorApi || typeof cursorApi.setScheme !== 'function') {
                    appendTextLine('Cursor controls are unavailable.', 'terminal-muted');
                    return;
                }

                const value = arg.trim().toLowerCase();
                if (!value) {
                    appendTextLines([
                        `Cursor scheme: ${cursorApi.getScheme()}`,
                        `Effective: ${cursorApi.getEffectiveScheme()}`,
                        'Usage: cursor <ghost|classic|rail|native>',
                        '  ghost   - pixel arrow, link accent, ghost trail',
                        '  classic - original GIF cursor + rainbow trail',
                        '  rail    - native pointer + status-rail readout',
                        '  native  - native pointer, no effects'
                    ], 'terminal-muted');
                    return;
                }

                const result = cursorApi.setScheme(value);
                if (!result.ok) {
                    appendTextLine(`Unknown cursor scheme: ${value}`, 'terminal-muted');
                    appendTextLine('Usage: cursor <ghost|classic|rail|native>', 'terminal-muted');
                    return;
                }

                if (result.reason === 'touch') {
                    appendTextLine(`Cursor scheme saved: ${result.scheme} (desktop only; touch keeps the native pointer)`, 'terminal-muted');
                } else if (result.reason === 'reduced-motion') {
                    appendTextLine(`Cursor scheme saved: ${result.scheme} (reduced motion; using the native pointer)`, 'terminal-muted');
                } else {
                    appendTextLine(`Cursor scheme: ${result.scheme}`, 'terminal-muted');
                }
                return;
            }

            if (command === 'sound') {
                const sfxApi = window.SiteSfx;
                if (!sfxApi || typeof sfxApi.setEnabled !== 'function') {
                    appendTextLine('Interface sound controls are unavailable.', 'terminal-muted');
                    return;
                }

                const value = arg.trim().toLowerCase();
                if (!value) {
                    appendTextLines([
                        `Interface sounds: ${sfxApi.isEnabled() ? 'ON' : 'OFF'}`,
                        'Usage: sound <on|off|toggle|test>',
                        'Effects are synthesized locally and stay off until enabled.'
                    ], 'terminal-muted');
                    return;
                }

                if (value === 'test') {
                    if (!sfxApi.isEnabled()) {
                        appendTextLine('Interface sounds are off. Run "sound on" first.', 'terminal-muted');
                        return;
                    }
                    appendTextLine('Sound test: click, key, enter, success, error, pane, window, power-on.', 'terminal-muted');
                    const sequence = ['click', 'key', 'enter', 'success', 'error', 'pane', 'windowOpen', 'windowClose', 'enable'];
                    sequence.forEach((name, index) => {
                        window.setTimeout(() => sfxApi.play(name), 180 + index * 320);
                    });
                    return;
                }

                if (value !== 'on' && value !== 'off' && value !== 'toggle') {
                    appendTextLine(`Unknown sound setting: ${value}`, 'terminal-muted');
                    appendTextLine('Usage: sound <on|off|toggle|test>', 'terminal-muted');
                    return;
                }

                const next = value === 'toggle' ? !sfxApi.isEnabled() : value === 'on';
                sfxApi.setEnabled(next);
                appendTextLine(`Interface sounds: ${next ? 'ON' : 'OFF'}`, 'terminal-muted');
                return;
            }

            if (command === 'help') {
                appendTextLines([
                    'Available commands:',
                    '  cls        - Clear the terminal',
                    '  dir / ls   - List files in current directory',
                    '  cd <path>  - Change directory',
                    '  rm <name>  - Remove a saved browser file (site files are read-only)',
                    '  rmdir <n>  - Remove saved files under a saved directory prefix',
                    '  cp <s> <d> - Copy a repo or saved file into a saved file destination',
                    '  start <p>  - Open a local HTML or external URL inside the webpage pane',
                    '  open <p>   - Alias for start',
                    '  echo <txt> - Echo text back to the terminal',
                    '  man <cmd>  - Show a manual page or open a text file',
                    '  neofetch   - Show system info block',
                    '  layout     - Set layout to compact or normal',
                    '  promptgap  - Adjust prompt gap spacing',
                    '  cursor     - Switch pointer scheme: ghost, classic, rail, native',
                    '  sound      - Toggle retro interface sounds (on/off/test)',
                    '  save       - Save open editor buffer to browser storage',
                    '  load <n>   - Load saved file into editor',
                    '  saved-files- List files saved in browser storage',
                    '  help       - Show this help text'
                ], 'terminal-muted');
                return;
            }

            appendTextLine(`'${command}' is not recognized as an internal or external command.`, 'terminal-muted');
        }

        function clearActiveState() {
            [navLink, navPC].forEach((element) => element && element.classList.remove('active'));
            if (webpagesList) {
                Array.from(webpagesList.querySelectorAll('.webpage-btn')).forEach((button) => button.classList.remove('active'));
            }
        }

        function setActive(button) {
            clearActiveState();
            if (button) button.classList.add('active');
        }

        /* Restarts the entrance animation for a pane. */
        function animatePane(element) {
            if (!element) return;
            element.classList.remove('is-entering');
            void element.offsetWidth;
            element.classList.add('is-entering');
            element.addEventListener('animationend', () => {
                element.classList.remove('is-entering');
            }, { once: true });
        }

        function showPane(pane) {
            const terminalWrapper = document.getElementById('terminal-wrapper');
            const mainTitle = document.getElementById('main-section-title');
            const wpPane = document.getElementById('webpage-pane');

            // Hide every pane first so no residual layout space remains.
            [paneLink, panePC, wpPane].forEach((element) => {
                if (element) element.style.display = 'none';
            });

            const isTerminalPane = pane === 'pc' || pane === 'webpage';
            if (content) content.classList.toggle('terminal-mode', isTerminalPane);
            if (layout) layout.classList.toggle('terminal-layout', isTerminalPane);
            if (terminalWrapper) terminalWrapper.style.display = pane === 'webpage' ? 'none' : '';

            /* showPane stays the only owner of which pane is really open. It
               emits one event after the visibility changes, so the phone shell
               (mobile.js) can project the state instead of wrapping or
               replacing this function. */
            function emitPaneChange() {
                try {
                    document.dispatchEvent(new CustomEvent('site:panechange', { detail: { pane } }));
                } catch (e) {
                    /* CustomEvent unavailable: the phone projection stays put. */
                }
            }

            if (pane === 'webpage') {
                if (panePC) panePC.style.display = 'block';
                if (wpPane) wpPane.style.display = 'block';
                if (mainTitle) mainTitle.style.display = 'none';
                setActive(null);
                animatePane(wpPane);
                emitPaneChange();
                return;
            }

            if (pane === 'pc') {
                if (panePC) panePC.style.display = 'block';
                if (mainTitle) mainTitle.style.display = 'none';
                setActive(navPC);
                animatePane(panePC);
                emitPaneChange();
                return;
            }

            if (paneLink) paneLink.style.display = 'block';
            if (mainTitle) {
                mainTitle.textContent = 'LINK EXCHANGE';
                mainTitle.style.display = '';
            }
            setActive(navLink);
            animatePane(paneLink);
            emitPaneChange();
        }

        if (navLink) {
            navLink.addEventListener('click', () => {
                showPane('link');
            });
        }

        if (navPC) {
            navPC.addEventListener('click', (e) => {
                // Only auto-run neofetch for user-initiated clicks to avoid programmatic spamming
                showPane('pc');
                if (e && e.isTrusted) {
                    runNeofetchIfNeeded();
                }
            });
        }

        // Webpage navigation elements
        const webpagePane = document.getElementById('webpage-pane');
        const webpageIframe = document.getElementById('webpage-iframe');
        const webpageTitle = document.getElementById('webpage-title');
        const webpageBack = document.getElementById('webpage-back');
        const webpageFullscreen = document.getElementById('webpage-fullscreen');
        const webpageLoader = document.getElementById('webpage-loader');
        const unlockOverlay = document.getElementById('unlock-overlay');
        let webpageLoadToken = 0;
        let webpageLoadTimeout = null;
        let lastKnownContentHeight = 0;
        let currentWebpageUrl = null;
        const webpagesStorageKey = 'terminal_webpages_v1';

        function saveWebpagesList() {
            if (!webpagesList) return;
            try {
                const arr = Array.from(webpagesList.querySelectorAll('.webpage-tab')).map((tab) => {
                    const btn = tab.querySelector('.webpage-btn');
                    return {
                        url: btn ? (btn.getAttribute('data-url') || '') : (tab.getAttribute('data-url') || ''),
                        title: btn ? (btn.dataset.label || '') : ''
                    };
                }).filter((item) => item.url);
                localStorage.setItem(webpagesStorageKey, JSON.stringify(arr));
            } catch (e) {
                // ignore storage errors
            }
        }

        function loadWebpagesFromStorage() {
            if (!webpagesList) return;
            try {
                const raw = localStorage.getItem(webpagesStorageKey);
                if (!raw) return;
                const arr = JSON.parse(raw);
                if (!Array.isArray(arr)) return;
                arr.forEach((item) => {
                    if (!item || !item.url) return;
                    /* A saved tab whose site refuses framing can never render in
                       the pane, so drop it instead of resurrecting a dead tab. */
                    if (window.SiteIframes && !window.SiteIframes.canEmbed(item.url)) return;
                    const existing = webpageTabFor(item.url);
                    if (existing) {
                        updateWebpageTabLabel(existing, webpageDisplayName(item.title, item.url));
                    } else {
                        addWebpageButton(item.title || item.url, item.url);
                    }
                });
            } catch (e) {
                // ignore parse/storage errors
            }
        }

        function setWebpageButtonLabel(btn, label) {
            if (!btn) return;
            const text = String(label || '');
            btn.replaceChildren();
            const prompt = document.createElement('span');
            prompt.className = 'nav-prompt';
            prompt.setAttribute('aria-hidden', 'true');
            prompt.textContent = '>';
            btn.appendChild(prompt);
            btn.appendChild(document.createTextNode(text));
            btn.dataset.label = text;
        }

        /* Prefer the folder name for local pages ('/dora/index.html' → 'dora');
           only fall back to the raw passed-in name (hostnames, etc.). */
        function webpageDisplayName(name, url) {
            let display = name || '';
            try {
                if (url && url.startsWith('/')) {
                    const parts = url.split('/').filter(Boolean);
                    if (parts.length) {
                        if (parts.length > 1 && parts[parts.length - 1].toLowerCase().endsWith('.html')) {
                            display = parts[parts.length - 2] || parts[0];
                        } else {
                            display = parts[0];
                        }
                    } else {
                        display = '/';
                    }
                }
            } catch (e) {
                display = display || name || url;
            }
            return display || name || url;
        }

        function webpageTabFor(url) {
            if (!webpagesList || !url) return null;
            return Array.from(webpagesList.querySelectorAll('.webpage-tab'))
                .find((tab) => tab.getAttribute('data-url') === url) || null;
        }

        function updateWebpageTabLabel(tab, label) {
            if (!tab) return;
            const btn = tab.querySelector('.webpage-btn');
            if (btn) setWebpageButtonLabel(btn, label);
            const close = tab.querySelector('.webpage-tab-close');
            if (close) {
                close.setAttribute('aria-label', `Close ${label}`);
                close.title = `Close ${label}`;
            }
        }

        function closeWebpageTab(url) {
            const tab = webpageTabFor(url);
            if (!tab) return;

            /* Closing the page that is on screen also closes the pane. */
            if (currentWebpageUrl === url) closeWebpagePane();

            tab.classList.add('is-closing');
            window.setTimeout(() => {
                if (tab.parentElement) tab.parentElement.removeChild(tab);
                saveWebpagesList();
            }, 160);
        }

        function createWebpageTab(url, displayName) {
            const tab = document.createElement('div');
            tab.className = 'webpage-tab';
            tab.setAttribute('data-url', url);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = `webpage-${btoa(url).replace(/=/g,'')}`;
            btn.className = 'webpage-btn';
            btn.setAttribute('data-url', url);
            setWebpageButtonLabel(btn, displayName);
            btn.addEventListener('click', () => openWebpage(url, displayName));

            /* The cross is a real control, not a nested one: the tab wrapper
               holds the destination button and the close button as peers. */
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'webpage-tab-close';
            close.setAttribute('aria-label', `Close ${displayName}`);
            close.title = `Close ${displayName}`;
            close.addEventListener('click', (event) => {
                event.stopPropagation();
                closeWebpageTab(url);
            });

            tab.appendChild(btn);
            tab.appendChild(close);
            return tab;
        }

        function addWebpageButton(name, url) {
            if (!webpagesList || !url) return;
            const displayName = webpageDisplayName(name, url);
            // prefer existing tab by data-url if present
            const existing = webpageTabFor(url);
            if (existing) {
                updateWebpageTabLabel(existing, displayName);
                existing.setAttribute('data-url', url);
                saveWebpagesList();
                return existing.querySelector('.webpage-btn');
            }

            const tab = createWebpageTab(url, displayName);
            webpagesList.appendChild(tab);
            saveWebpagesList();
            return tab.querySelector('.webpage-btn');
        }

        function showUnlockAnimation() {
            if (!unlockOverlay) return Promise.resolve();
            unlockOverlay.style.display = 'flex';
            unlockOverlay.setAttribute('aria-hidden', 'false');
            return new Promise((resolve) => {
                setTimeout(() => {
                    unlockOverlay.style.display = 'none';
                    unlockOverlay.setAttribute('aria-hidden', 'true');
                    resolve();
                }, 700);
            });
        }

        function setWebpageLoading(isLoading) {
            if (!webpageLoader) return;
            webpageLoader.style.display = isLoading ? 'flex' : 'none';
            webpageLoader.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
        }

        function syncWebpageHeight() {
            if (!webpageIframe || !webpagePane) return;
            try {
                const doc = webpageIframe.contentDocument;
                if (!doc || !doc.documentElement || !doc.body) return;

                const contentHeight = Math.max(
                    doc.documentElement.scrollHeight,
                    doc.body.scrollHeight,
                    doc.documentElement.offsetHeight,
                    doc.body.offsetHeight
                );
                // if computed height is suspiciously small, prefer last known height
                const effectiveContentHeight = contentHeight > 64 ? contentHeight : (lastKnownContentHeight || contentHeight);
                const toolbarHeight = webpagePane.querySelector('.webpage-toolbar')?.offsetHeight || 48;
                const totalHeight = Math.max(effectiveContentHeight + toolbarHeight, toolbarHeight + 320);

                // set iframe + container to match content height, and ensure the outer pane
                // reserves enough space (toolbar + content). This prevents the canvas from
                // collapsing when the terminal wrapper is hidden.
                webpageIframe.style.height = `${effectiveContentHeight}px`;
                const container = webpagePane.querySelector('.webpage-container');
                if (container) container.style.height = `${effectiveContentHeight}px`;
                webpagePane.style.height = 'auto';
                webpagePane.style.minHeight = `${totalHeight}px`;

                if (effectiveContentHeight && effectiveContentHeight > 64) lastKnownContentHeight = effectiveContentHeight;
            } catch (error) {
                // On cross-origin or access failures, fall back to a sensible default height
                // so the canvas doesn't collapse.
                try {
                    const fallback = Math.max(320, lastKnownContentHeight || 480);
                    webpageIframe.style.height = `${fallback}px`;
                    const container = webpagePane.querySelector('.webpage-container');
                    if (container) container.style.height = `${fallback}px`;
                    webpagePane.style.minHeight = `${fallback}px`;
                } catch (e) {
                    // swallow
                }
            }
        }

        function stretchIframeDocument() {
            if (!webpageIframe) return;
            try {
                const doc = webpageIframe.contentDocument;
                if (!doc || !doc.documentElement || !doc.body) return;

                doc.documentElement.style.marginTop = '0';
                doc.documentElement.style.paddingTop = '0';
                doc.documentElement.style.padding = '0';
                doc.documentElement.style.minHeight = '0';
                doc.body.style.marginTop = '0';
                doc.body.style.paddingTop = '0';
                doc.body.style.padding = '0';
                doc.body.style.minHeight = '0';

                const scrollingElement = doc.scrollingElement || doc.documentElement;
                if (scrollingElement) {
                    scrollingElement.scrollTop = 0;
                    scrollingElement.scrollLeft = 0;
                }
                doc.documentElement.scrollTop = 0;
                doc.body.scrollTop = 0;
                doc.body.scrollLeft = 0;

                syncWebpageHeight();

                let styleTag = doc.getElementById('webpage-inner-height-fix');
                if (!styleTag) {
                    styleTag = doc.createElement('style');
                    styleTag.id = 'webpage-inner-height-fix';
                    doc.head.appendChild(styleTag);
                }

                styleTag.textContent = `
                    html, body {
                        margin: 0 !important;
                        padding: 0 !important;
                        min-height: 0 !important;
                    }
                    body > :first-child {
                        margin-top: 0 !important;
                    }
                    #root, #app, #__next, main, .container, .content, .page, .wrapper {
                        margin-top: 0 !important;
                        padding-top: 0 !important;
                    }
                `;
            } catch (error) {
                // Ignore cross-origin or sandbox access failures.
            }
        }

        function setActiveWebpageButton(url) {
            clearActiveState();
            if (!webpagesList || !url) return;
            Array.from(webpagesList.querySelectorAll('.webpage-btn')).forEach((b) => {
                const btnUrl = b.getAttribute('data-url') || '';
                const match = url && (btnUrl === url || b.id === `webpage-${btoa(url).replace(/=/g,'')}`);
                if (match) {
                    b.classList.add('active');
                } else {
                    b.classList.remove('active');
                }
            });
        }

        function openWebpage(url, title) {
            if (!webpagePane || !webpageIframe) return;

            const isLocalObjectUrl = typeof url === 'string' && (
                url.startsWith('blob:') || url.startsWith('data:')
            );

            if (!isLocalObjectUrl && window.SiteIframes && !window.SiteIframes.canEmbed(url)) {
                const policy = window.SiteIframes.embedPolicy(url);
                appendTextLine(`${policy.host || url} refuses to be embedded — opened in a new tab.`, 'terminal-muted');
                try { window.open(url, '_blank', 'noopener'); } catch (e) {}
                return;
            }

            const name = title || url.replace(/^https?:\/\//, '').replace(/\/.*/, '');
            const display = webpageDisplayName(name, url);
            const btn = addWebpageButton(display, url);
            if (btn) btn.setAttribute('data-url', url);
            webpageLoadToken += 1;
            const currentToken = webpageLoadToken;
            currentWebpageUrl = url;
            webpageTitle.textContent = display;
            // ensure layout and pane classes for webpage view, then hide terminal wrapper
            try { showPane('webpage'); } catch (e) {}
            const terminalWrapper = document.getElementById('terminal-wrapper');
            if (terminalWrapper) terminalWrapper.style.display = 'none';
            // ensure pc pane is visible and link pane hidden
            if (panePC) panePC.style.display = 'block';
            if (paneLink) paneLink.style.display = 'none';
            setActiveWebpageButton(url);
            setWebpageLoading(true);
            showUnlockAnimation();

            // clear any previous load timeout and set a new one to avoid infinite loading
            try { clearTimeout(webpageLoadTimeout); } catch (e) {}
            webpageLoadTimeout = setTimeout(() => {
                // if still loading after timeout, stop loader and apply fallback sizing
                setWebpageLoading(false);
                try { syncWebpageHeight(); } catch (e) {}
            }, 9000);

            window.requestAnimationFrame(() => {
                if (currentToken !== webpageLoadToken) return;
                webpageIframe.src = url;
            });
        }

        function closeWebpagePane() {
            if (!webpagePane) return;
            webpageLoadToken += 1;
            currentWebpageUrl = null;
            if (webpageIframe) webpageIframe.src = 'about:blank';
            try { clearTimeout(webpageLoadTimeout); } catch (e) {}
            // hide webpage pane and restore the link exchange
            webpagePane.style.display = 'none';
            const terminalWrapper = document.getElementById('terminal-wrapper');
            if (terminalWrapper) terminalWrapper.style.display = '';
            setActiveWebpageButton(null);
            setWebpageLoading(false);
            showPane('link');
        }

        /* The desktop link menu is deliberately decoupled from the terminal:
           it emits a small document event so the page pane stays a terminal
           concern. Only http(s) URLs can reach the embedded browser. */
        document.addEventListener('site:openpage', (event) => {
            const detail = event && event.detail ? event.detail : {};
            const raw = String(detail.url || '');
            if (!raw) return;

            let parsed;
            try {
                parsed = new URL(raw, window.location.href);
            } catch (_) {
                return;
            }
            if (!/^https?:$/.test(parsed.protocol)) return;

            openWebpage(parsed.href, String(detail.title || ''));
        });

        if (webpageBack) {
            webpageBack.addEventListener('click', closeWebpagePane);
        }

        if (webpageIframe) {
            webpageIframe.addEventListener('load', () => {
                try { clearTimeout(webpageLoadTimeout); } catch (e) {}
                // attempt to normalize injected page and then update title metadata
                stretchIframeDocument();
                try {
                    const doc = webpageIframe.contentDocument;
                    const url = webpageIframe.src || '';
                    let foundTitle = '';
                    if (doc && typeof doc.title === 'string') {
                        foundTitle = doc.title.trim();
                    }

                    // If we found a title and this is not a local workspace path, use it
                    if (foundTitle && /^https?:\/\//i.test(url)) {
                        webpageTitle.textContent = foundTitle;
                        const tab = webpageTabFor(currentWebpageUrl || url);
                        if (tab) {
                            updateWebpageTabLabel(tab, foundTitle);
                            // persist updated title
                            try { saveWebpagesList(); } catch (e) {}
                        }
                    }
                } catch (e) {
                    // cross-origin: ignore, fallback to existing label
                }

                // ensure sizes are synced immediately and for a short period afterwards
                try { syncWebpageHeight(); } catch (e) {}
                let adjustAttempts = 0;
                const adjustInterval = setInterval(() => {
                    try { syncWebpageHeight(); } catch (e) {}
                    adjustAttempts += 1;
                    if (adjustAttempts > 8) clearInterval(adjustInterval);
                }, 250);

                setWebpageLoading(false);
            });
        }

        if (webpageFullscreen) {
            webpageFullscreen.addEventListener('click', () => {
                if (!webpagePane) return;
                const container = webpagePane;
                if (!container.classList.contains('webpage-fullscreen')) {
                    // enter fullscreen mode (CSS fallback)
                    try { container.requestFullscreen?.(); } catch (e) {}
                    container.classList.add('webpage-fullscreen');
                    webpageFullscreen.textContent = '⤡';
                } else {
                    try { document.exitFullscreen?.(); } catch (e) {}
                    container.classList.remove('webpage-fullscreen');
                    webpageFullscreen.textContent = '⤢';
                }
            });
        }


        if (terminalInput) {
            terminalInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    const value = terminalInput.value;
                    terminalInput.value = '';
                    if (value.trim()) {
                        pushHistory(value);
                        runCommand(value);
                    }
                    return;
                }

                if (event.key === 'ArrowUp') {
                    if (!history.length) return;
                    historyIndex = historyIndex > 0 ? historyIndex - 1 : history.length - 1;
                    terminalInput.value = history[historyIndex] || '';
                    event.preventDefault();
                    return;
                }

                if (event.key === 'ArrowDown') {
                    if (!history.length) return;
                    if (historyIndex < history.length - 1) {
                        historyIndex += 1;
                        terminalInput.value = history[historyIndex] || '';
                    } else {
                        historyIndex = history.length;
                        terminalInput.value = '';
                    }
                    event.preventDefault();
                    return;
                }

                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
                    event.preventDefault();
                    clearTerminal();
                    return;
                }

                if (event.ctrlKey && event.key.toLowerCase() === 'c') {
                    if (!window.getSelection || !window.getSelection().toString()) {
                        event.preventDefault();
                        terminalInput.value = '';
                    }
                    return;
                }

                if (event.key === 'Tab') {
                    event.preventDefault();
                    const { matches, commandPosition } = getCompletions(terminalInput.value);
                    if (matches.length === 1) {
                        terminalInput.value = applyCompletion(terminalInput.value, matches[0], commandPosition);
                        historyIndex = history.length;
                        return;
                    }

                    if (matches.length > 1) {
                        appendTextLines([matches.join('  ')], 'terminal-muted');
                    }
                }
            });

            terminalInput.addEventListener('input', () => {
                historyIndex = history.length;
            });
        }

        /* Click anywhere in the terminal to focus the prompt. */
        if (terminal) {
            terminal.addEventListener('click', (event) => {
                if (event.target === terminalInput) return;
                const selection = window.getSelection ? window.getSelection() : null;
                if (selection && selection.type === 'Range' && String(selection).length) return;
                focusInput();
            });
        }

        // rehydrate previously discovered webpages (if any)
        try { loadWebpagesFromStorage(); } catch (e) {}

        setPrompt();
        setTerminalGap(0);

        /* One honest session line, printed immediately — no intro delay,
           no animation, and it never blocks the prompt. */
        (() => {
            const now = new Date();
            const date = [
                now.getFullYear(),
                String(now.getMonth() + 1).padStart(2, '0'),
                String(now.getDate()).padStart(2, '0'),
            ].join('-');
            const time = now.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            });
            appendTextLine(`[session ${date} ${time}] local · type help`, 'terminal-muted');
        })();

        // Mobile / touch-friendly behaviors: keep input visible when virtual keyboard appears
        if (terminalInput) {
            terminalInput.addEventListener('focus', () => {
                setTimeout(() => {
                    scrollTerminalToBottom();
                    try {
                        terminalInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    } catch (e) {
                        // fallback: no-op
                    }
                }, 120);
            });

            terminalInput.addEventListener('touchstart', () => {
                setTimeout(() => focusInput(), 50);
            });
        }

        let viewportQueued = false;
        function queueScrollToBottom() {
            if (viewportQueued) return;
            viewportQueued = true;
            requestAnimationFrame(() => {
                viewportQueued = false;
                scrollTerminalToBottom();
            });
        }

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', queueScrollToBottom, { passive: true });
            window.visualViewport.addEventListener('scroll', queueScrollToBottom, { passive: true });
        }

        window.addEventListener('resize', queueScrollToBottom, { passive: true });

        window.runCommand = runCommand;
        window.showPane = showPane;
        window.runNeofetchIfNeeded = runNeofetchIfNeeded;
    } catch (error) {
        console.error('terminal initialization failed', error);
    }
});
