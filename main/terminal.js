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

        const defaultPromptPrefix = 'r3d1bruh@desktop';
        const historyStorageKey = 'terminal_history';
        const maxHistoryEntries = 200;
        const builtInCommands = ['cls', 'dir', 'ls', 'cd', 'start', 'open', 'echo', 'man', 'rm', 'rmdir', 'cp', 'save', 'load', 'saved-files', 'neofetch', 'layout', 'promptgap', 'help'];

        const vfs = {
            '/': {
                type: 'dir',
                children: {
                    '.gitignore': { type: 'file' },
                    '.prettierrc': { type: 'file' },
                    'AI_AGENT_PROMPT.md': { type: 'file' },
                    'CODEBASE.md': { type: 'file' },
                    'LICENSE': { type: 'file' },
                    'README.md': { type: 'file' },
                    'dora': { type: 'dir' },
                    'l': { type: 'dir' },
                    'main': { type: 'dir' },
                    'index.html': { type: 'file' },
                    'serve.py': { type: 'file' }
                }
            },
            '/dora': { type: 'dir', children: { 'anushkaverse.html': { type: 'file' }, 'app-manifest.json': { type: 'file' }, 'app.html': { type: 'file' }, 'doraverse.html': { type: 'file' }, 'gallery': { type: 'dir' }, 'index.html': { type: 'file' }, 'manifest.json': { type: 'file' }, 'sw.js': { type: 'file' } } },
            '/l': { type: 'dir', children: { 'index.html': { type: 'file' } } },
            '/main': { type: 'dir', children: { 'assets': { type: 'dir', children: { 'cursor.gif': { type: 'file' }, 'cursor-reversed.gif': { type: 'file' } } }, 'custom-cursor.js': { type: 'file' }, 'index.html': { type: 'file' }, 'link-exchange.js': { type: 'file' }, 'mobile.css': { type: 'file' }, 'mobile.js': { type: 'file' }, 'music.css': { type: 'file' }, 'music.js': { type: 'file' }, 'playlist': { type: 'dir' }, 'socials': { type: 'dir' }, 'splitter.js': { type: 'file' }, 'terminal.css': { type: 'file' }, 'terminal.js': { type: 'file' } } },
            '/main/playlist': { type: 'dir', children: { 'playlist.json': { type: 'file' }, 'Basshunter - In Her Eyes': { type: 'file' }, 'Crystal Castles - Suffocation': { type: 'file' }, 'Pretty Scene Girl': { type: 'file' }, 'The Cure - Friday Im In Love': { type: 'file' } } },
            '/main/socials': { type: 'dir', children: { 'pfp.webp': { type: 'file' }, 'xbox.svg': { type: 'file' }, 'github': { type: 'dir' }, 'reddit': { type: 'dir' }, 'discord': { type: 'dir' }, 'insta': { type: 'dir' }, 'snapchat': { type: 'dir' }, 'tiktok': { type: 'dir' }, 'x': { type: 'dir' }, 'linkedin': { type: 'dir' }, 'steam': { type: 'dir' } } }
        };

        let cwd = '/';
        let history = loadHistory();
        let historyIndex = history.length;

        /* ------------------------------------------------------------------
         * Optional external VFS — main/data/vfs.json
         * The inline tree above is the offline/file:// fallback. The tree is
         * read-only (site files can never be removed), so swapping the loaded
         * copy is safe at any point; if the fetch fails, nothing changes.
         * ------------------------------------------------------------------ */
        function applyExternalVfs(data) {
            if (!data || typeof data !== 'object' || !data['/'] || typeof data['/'] !== 'object') return;
            Object.keys(vfs).forEach((key) => { delete vfs[key]; });
            Object.keys(data).forEach((key) => { vfs[key] = data[key]; });
            if (!getNode(cwd)) cwd = '/';
        }

        fetch('./data/vfs.json')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => { if (data) applyExternalVfs(data); })
            .catch(() => {
                /* file:// or offline — the inline fallback tree is already active. */
            });

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

        function getNode(path) {
            try {
                if (!path) return null;
                if (path === '/') return vfs['/'] || null;
                const segments = String(path).split('/').filter(Boolean);
                let node = vfs['/'];
                for (let i = 0; i < segments.length; i++) {
                    const seg = segments[i];
                    if (!node) return null;
                    // Prefer the authoritative absolute entry: root children are
                    // bare { type: 'dir' } stubs used only for listing, so walking
                    // into them first would lose the real subtree (and make
                    // `cd main` + `ls` print "(empty)").
                    const abs = '/' + segments.slice(0, i + 1).join('/');
                    if (vfs[abs]) {
                        node = vfs[abs];
                        continue;
                    }
                    if (node.children && Object.prototype.hasOwnProperty.call(node.children, seg)) {
                        node = node.children[seg];
                        continue;
                    }
                    return null;
                }
                return node || null;
            } catch (e) {
                return null;
            }
        }

        function isRepoPath(path) {
            try {
                const abs = resolvePath(path);
                // a repo path is present in vfs or as a child under vfs
                if (getNode(abs)) return true;
                return false;
            } catch (e) { return false; }
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
            title.textContent = 'r3d1bruh@desktop';

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
                filename
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
                Array.from(webpagesList.children).forEach((button) => button.classList.remove('active'));
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

            const isTerminalPane = pane !== 'link';
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
        const webpagesStorageKey = 'terminal_webpages_v1';

        function saveWebpagesList() {
            if (!webpagesList) return;
            try {
                const arr = Array.from(webpagesList.children).map((b) => ({
                    url: b.getAttribute('data-url') || '',
                    title: (b.textContent || '').trim()
                })).filter((x) => x.url);
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
                    // avoid duplicating existing buttons
                    const existing = Array.from(webpagesList.children).find((b) => b.getAttribute('data-url') === item.url) || document.getElementById(`webpage-${btoa(item.url).replace(/=/g,'')}`);
                    if (existing) {
                        existing.textContent = item.title || existing.textContent;
                        existing.setAttribute('data-url', item.url);
                    } else {
                        const btn = addWebpageButton(item.title || item.url, item.url);
                        if (btn) btn.setAttribute('data-url', item.url);
                    }
                });
            } catch (e) {
                // ignore parse/storage errors
            }
        }

        function setWebpageButtonLabel(btn, label) {
            btn.replaceChildren();
            const prompt = document.createElement('span');
            prompt.className = 'nav-prompt';
            prompt.setAttribute('aria-hidden', 'true');
            prompt.textContent = '>';
            btn.appendChild(prompt);
            btn.appendChild(document.createTextNode(label));
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

        function addWebpageButton(name, url) {
            if (!webpagesList || !url) return;
            const displayName = webpageDisplayName(name, url);
            const id = `webpage-${btoa(url).replace(/=/g,'')}`;
            // prefer existing button by data-url if present
            const existingByData = Array.from(webpagesList.children).find((b) => b.getAttribute('data-url') === url);
            if (existingByData) {
                setWebpageButtonLabel(existingByData, displayName);
                existingByData.setAttribute('data-url', url);
                saveWebpagesList();
                return existingByData;
            }

            if (document.getElementById(id)) return document.getElementById(id);
            const btn = document.createElement('button');
            btn.id = id;
            btn.className = 'webpage-btn';

            setWebpageButtonLabel(btn, displayName);
            btn.setAttribute('data-url', url);
            btn.addEventListener('click', () => openWebpage(url, displayName));
            webpagesList.appendChild(btn);
            saveWebpagesList();
            return btn;
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
            Array.from(webpagesList.children).forEach((b) => {
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
            const name = title || url.replace(/^https?:\/\//, '').replace(/\/.*/, '');
            const display = webpageDisplayName(name, url);
            const btn = addWebpageButton(display, url);
            if (btn) btn.setAttribute('data-url', url);
            webpageLoadToken += 1;
            const currentToken = webpageLoadToken;
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

        if (webpageBack) {
            webpageBack.addEventListener('click', () => {
                if (!webpagePane) return;
                webpageLoadToken += 1;
                webpageIframe.src = 'about:blank';
                try { clearTimeout(webpageLoadTimeout); } catch (e) {}
                // hide webpage pane and restore terminal
                if (webpagePane) webpagePane.style.display = 'none';
                const terminalWrapper = document.getElementById('terminal-wrapper');
                if (terminalWrapper) terminalWrapper.style.display = '';
                setActiveWebpageButton(null);
                setWebpageLoading(false);
                showPane('link');
            });
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
                        if (webpagesList) {
                            // update corresponding button text if present
                            const btnByData = Array.from(webpagesList.children).find((b) => b.getAttribute('data-url') === url);
                            const btnById = document.getElementById(`webpage-${btoa(url).replace(/=/g,'')}`);
                            const btn = btnByData || btnById;
                            if (btn) {
                                btn.textContent = foundTitle;
                                // persist updated title
                                try { saveWebpagesList(); } catch (e) {}
                            }
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
