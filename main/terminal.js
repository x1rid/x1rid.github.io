document.addEventListener('DOMContentLoaded', () => {
    try {
        const terminal = document.getElementById('terminal');
        const terminalOutput = document.getElementById('terminal-output');
        const terminalInput = document.getElementById('terminal-input');
        const terminalPrompt = document.getElementById('terminal-prompt');
        const navLink = document.getElementById('nav-link-exchange');
        const navPC = document.getElementById('nav-pc-specs');
        const navGameStats = document.getElementById('nav-game-stats');
        const paneLink = document.getElementById('link-exchange');
        const panePC = document.getElementById('pc-specs');
        const paneGameStats = document.getElementById('video-game-stats');
        const content = document.querySelector('.content-area');
        const layout = document.querySelector('.layout-grid');

        const defaultPromptPrefix = 'C:\\Users\\Krane';
        const historyStorageKey = 'terminal_history';
        const maxHistoryEntries = 200;
        const builtInCommands = ['cls', 'dir', 'ls', 'cd', 'start', 'open', 'echo', 'man', 'rm', 'rmdir', 'cp', 'neofetch', 'theme', 'layout', 'promptgap', 'help'];

        const vfs = {
            '/': {
                type: 'dir',
                children: {
                    'Google.html': { type: 'file' },
                    'LICENSE': { type: 'file' },
                    'README.md': { type: 'file' },
                    'build': { type: 'dir' },
                    'demo': { type: 'dir' },
                    'dora': { type: 'dir' },
                    'index.html': { type: 'file' },
                    'jsconfig.json': { type: 'file' },
                    'l': { type: 'dir' },
                    'main': { type: 'dir' },
                    'now.json': { type: 'file' },
                    'package.json': { type: 'file' },
                    'public': { type: 'dir' },
                    'src': { type: 'dir' },
                    'xp': { type: 'dir' }
                }
            },
            '/build': { type: 'dir', children: { 'assets': { type: 'dir' }, 'index.html': { type: 'file' }, 'main': { type: 'dir' }, 'manifest.json': { type: 'file' }, 'static': { type: 'dir' }, 'xp': { type: 'dir' } } },
            '/dora': { type: 'dir', children: { 'anushkaverse.html': { type: 'file' }, 'app-manifest.json': { type: 'file' }, 'app.html': { type: 'file' }, 'doraverse.html': { type: 'file' }, 'gallery': { type: 'dir' }, 'index.html': { type: 'file' }, 'manifest.json': { type: 'file' }, 'sw.js': { type: 'file' } } },
            '/l': { type: 'dir', children: { 'index.html': { type: 'file' } } },
            '/main': { type: 'dir', children: { 'index.html': { type: 'file' } } },
            '/public': { type: 'dir', children: { 'assets': { type: 'dir' }, 'cursor.js': { type: 'file' }, 'index.html': { type: 'file' }, 'main': { type: 'dir' }, 'manifest.json': { type: 'file' } } },
            '/src': { type: 'dir', children: { 'App.js': { type: 'file' }, 'assets': { type: 'dir' }, 'components': { type: 'dir' }, 'hooks': { type: 'dir' }, 'index.js': { type: 'file' }, 'serviceWorker.js': { type: 'file' }, 'WinXP': { type: 'dir' } } },
            '/xp': { type: 'dir', children: { 'index.html': { type: 'file' } } }
        };

        let cwd = '/';
        let history = loadHistory();
        let historyIndex = history.length;

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
                    if (node.children && Object.prototype.hasOwnProperty.call(node.children, seg)) {
                        node = node.children[seg];
                        continue;
                    }
                    // fallback: check absolute key in vfs map
                    const abs = '/' + segments.slice(0, i + 1).join('/');
                    if (vfs[abs]) {
                        node = vfs[abs];
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
            const suffix = cwd === '/' ? '' : cwd.replace(/\//g, '\\');
            return `${defaultPromptPrefix}${suffix}>`;
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

        function scrollTerminalToBottom() {
            if (!terminal) return;
            terminal.scrollTop = terminal.scrollHeight;
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

        function createNeofetchBlock() {
            const wrapper = document.createElement('div');
            wrapper.className = 'terminal-neofetch';

            wrapper.appendChild(createCommandEntry(getPromptText(), 'neofetch'));

            const grid = document.createElement('div');
            grid.className = 'neofetch-grid';

            const logo = document.createElement('pre');
            logo.className = 'neofetch-logo';
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
            title.textContent = 'Krane@DESKTOP-I83AHIP';

            const divider = document.createElement('div');
            divider.className = 'neofetch-divider';
            divider.textContent = '--------------';

            const rows = [
                ['OS:', 'Windows 11'],
                ['Build:', '25H2 (26200)'],
                ['Uptime:', '2 days, 23 hours, 5 minutes'],
                ['Resolution:', '1920x1080 @60Hz'],
                ['Terminal:', 'Administrator: Command Prompt - neofetch'],
                ['CPU:', 'Intel(R) Core(TM) i7-10610U CPU @ 1.80GHz'],
                ['GPU:', 'Intel(R) UHD Graphics'],
                ['Memory:', '11203 MB / 16102 MB (69% in use)'],
                ['Disk:', 'C:\\ 385.02 GB (19.34 GB free)']
            ];

            info.appendChild(title);
            info.appendChild(divider);

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
                info.appendChild(row);
            });

            const palette = document.createElement('div');
            palette.className = 'neofetch-palette';
            ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#eceff4'].forEach((color) => {
                const block = document.createElement('span');
                block.style.background = color;
                palette.appendChild(block);
            });

            grid.appendChild(logo);
            grid.appendChild(info);

            wrapper.appendChild(grid);
            wrapper.appendChild(palette);
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
            theme: 'Theme helper. Currently only default is available. Usage: theme [default]',
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

        async function loadSteamStats() {
            const output = document.getElementById('steam-stats-output');
            const loading = document.getElementById('steam-stats-loading');
            const endpoint = window.STEAM_STATS_ENDPOINT || 'https://YOUR-DEPLOYED-FUNCTION.example.com/api/steam-stats';

            if (!output || !loading) return;
            loading.textContent = 'Loading Steam data...';
            output.textContent = '';

            try {
                const response = await fetch(endpoint, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    credentials: 'omit'
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                loading.textContent = 'Loaded.';
                output.textContent = JSON.stringify(data, null, 2);
            } catch (error) {
                loading.textContent = 'Could not load Steam stats yet.';
                output.textContent = [
                    'Set window.STEAM_STATS_ENDPOINT to your deployed proxy URL.',
                    'Example response:',
                    '{',
                    '  "player": { "personaname": "..." },',
                    '  "stats": {...}',
                    '}'
                ].join('\n');
            }
        }

        function tryAutocomplete(input) {
            const query = String(input || '').trim();
            const node = getNode(cwd) || { children: {} };
            const currentChildren = Object.keys(node.children || {});
            const rootChildren = Object.keys((vfs['/'] && vfs['/'].children) || {});
            const candidates = Array.from(new Set([...builtInCommands, ...currentChildren, ...rootChildren]));
            if (!query) return candidates;
            return candidates.filter((entry) => entry.toLowerCase().startsWith(query.toLowerCase()));
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
            const command = parts[0].toLowerCase();
            const arg = parts.slice(1).join(' ');

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

            if (command === 'open') {
                // alias for start
                if (!arg) {
                    appendTextLine('Usage: open <path|url>', 'terminal-muted');
                    return;
                }
                // reuse start logic by delegating to runCommand
                runCommand(`start ${arg}`);
                return;
            }

            if (command === 'man') {
                if (!arg) {
                    appendTextLine('Manual pages available:', 'terminal-muted');
                    const keys = Object.keys(manPages).sort();
                    appendTextLine('  ' + keys.join('  '), 'terminal-muted');
                    appendTextLine('Usage: man <command|path>  (press ESC or click Close to dismiss viewer)', 'terminal-muted');
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
                // echo prints arguments exactly as provided
                appendCommandEcho(input);
                return;
            }

            if (command === 'neofetch') {
                appendNeofetch();
                return;
            }

            if (command === 'theme') {
                if (!arg || arg.toLowerCase() === 'default') {
                    appendTextLine('Theme: default', 'terminal-muted');
                    return;
                }

                appendTextLine('Only the default theme is available.', 'terminal-muted');
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
                appendTextLine('Available commands:', 'terminal-muted');
                appendTextLine('  cls        - Clear the terminal', 'terminal-muted');
                appendTextLine('  dir        - List files in current directory', 'terminal-muted');
                appendTextLine('  cd <path>  - Change directory', 'terminal-muted');
                appendTextLine('  rm <name>  - Remove a saved browser file (site files are read-only)', 'terminal-muted');
                appendTextLine('  rmdir <n>  - Remove saved files under a saved directory prefix', 'terminal-muted');
                appendTextLine('  cp <s> <d> - Copy a repo or saved file into a saved file destination', 'terminal-muted');
                appendTextLine('  start <p>  - Open a local HTML or external URL inside the webpage pane', 'terminal-muted');
                appendTextLine('  open <p>   - Alias for start', 'terminal-muted');
                appendTextLine('  echo <txt> - Echo text back to the terminal', 'terminal-muted');
                appendTextLine('  neofetch   - Show system info block', 'terminal-muted');
                appendTextLine('  theme      - Theme helper (default only)', 'terminal-muted');
                appendTextLine('  layout     - Set layout to compact or normal', 'terminal-muted');
                appendTextLine('  promptgap  - Adjust prompt gap spacing', 'terminal-muted');
                appendTextLine('  save       - Save open editor buffer to browser storage', 'terminal-muted');
                appendTextLine('  load <n>   - Load saved file into editor', 'terminal-muted');
                appendTextLine('  saved-files- List files saved in browser storage', 'terminal-muted');
                appendTextLine('  help       - Show this help text', 'terminal-muted');
                return;
            }

            appendTextLine(`'${command}' is not recognized as an internal or external command.`, 'terminal-muted');
        }

        function clearActiveState() {
            [navLink, navPC, navGameStats].forEach((element) => element && element.classList.remove('active'));
            if (webpagesList) {
                Array.from(webpagesList.children).forEach((button) => button.classList.remove('active'));
            }
        }

        function setActive(button) {
            clearActiveState();
            if (button) button.classList.add('active');
        }

        function showPane(pane) {
            const terminalWrapper = document.getElementById('terminal-wrapper');
            const shouldCollapseMobileHeader = pane !== 'link';
            if (document && document.body) {
                document.body.classList.toggle('mobile-header-collapsed', shouldCollapseMobileHeader);
            }
            [paneLink, panePC, paneGameStats, webpagePane].forEach((element) => {
                if (element) element.style.display = 'none';
            });
            if (pane === 'link') {
                if (paneLink) paneLink.style.display = 'block';
                if (terminalWrapper) terminalWrapper.style.display = '';
                if (content) content.classList.remove('terminal-mode');
                if (layout) layout.classList.remove('terminal-layout');
                setActive(navLink);
                return;
            }

            if (pane === 'webpage') {
                if (panePC) panePC.style.display = 'block';
                if (webpagePane) webpagePane.style.display = 'block';
                if (content) content.classList.add('terminal-mode');
                if (layout) layout.classList.add('terminal-layout');
                setActive(null);
                return;
            }

            if (pane === 'game-stats') {
                if (paneGameStats) paneGameStats.style.display = 'block';
                if (terminalWrapper) terminalWrapper.style.display = '';
                if (content) content.classList.remove('terminal-mode');
                if (layout) layout.classList.remove('terminal-layout');
                setActive(navGameStats);
                return;
            }

            if (paneLink) paneLink.style.display = 'none';
            if (panePC) panePC.style.display = 'block';
            // hide webpage pane and show terminal wrapper when switching to PC view
            if (terminalWrapper) terminalWrapper.style.display = '';
            if (content) content.classList.add('terminal-mode');
            if (layout) layout.classList.add('terminal-layout');
            setActive(navPC);
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

        if (navGameStats) {
            navGameStats.addEventListener('click', () => {
                showPane('game-stats');
                loadSteamStats();
            });
        }

        // Webpage navigation elements
        const webpagesList = document.getElementById('webpages-list');
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

        function addWebpageButton(name, url) {
            if (!webpagesList || !url) return;
            const id = `webpage-${btoa(url).replace(/=/g,'')}`;
            // prefer existing button by data-url if present
            const existingByData = Array.from(webpagesList.children).find((b) => b.getAttribute('data-url') === url);
            if (existingByData) {
                // update label if name provided
                if (name) existingByData.textContent = name;
                existingByData.setAttribute('data-url', url);
                saveWebpagesList();
                return existingByData;
            }

            if (document.getElementById(id)) return document.getElementById(id);
            const btn = document.createElement('button');
            btn.id = id;
            btn.className = 'webpage-btn';
            // determine display name: prefer provided name, but for local files use the folder name
            let displayName = name || '';
            try {
                if (url && url.startsWith('/')) {
                    const parts = url.split('/').filter(Boolean);
                    if (parts.length) {
                        if (parts.length > 1 && parts[parts.length - 1].toLowerCase().endsWith('.html')) {
                            displayName = parts[parts.length - 2] || parts[0];
                        } else {
                            displayName = parts[0];
                        }
                    } else {
                        displayName = '/';
                    }
                }
            } catch (e) {
                displayName = displayName || name || url;
            }

            btn.textContent = displayName;
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
            const btn = addWebpageButton(name, url);
            if (btn) btn.setAttribute('data-url', url);
            webpageLoadToken += 1;
            const currentToken = webpageLoadToken;
            webpageTitle.textContent = name;
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

                if (event.key === 'Tab') {
                    event.preventDefault();
                    const matches = tryAutocomplete(terminalInput.value);
                    if (matches.length === 1) {
                        terminalInput.value = matches[0];
                        return;
                    }

                    if (matches.length > 1) {
                        appendTextLine(matches.join('  '), 'terminal-muted');
                    }
                }
            });
        }

        // rehydrate previously discovered webpages (if any)
        try { loadWebpagesFromStorage(); } catch (e) {}

        setPrompt();
        setTerminalGap(0);

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

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => setTimeout(scrollTerminalToBottom, 80));
            window.visualViewport.addEventListener('scroll', () => setTimeout(scrollTerminalToBottom, 80));
        }

        window.addEventListener('resize', () => setTimeout(scrollTerminalToBottom, 100));

        window.runCommand = runCommand;
        window.showPane = showPane;
        window.runNeofetchIfNeeded = runNeofetchIfNeeded;
    } catch (error) {
        console.error('terminal initialization failed', error);
    }
});
