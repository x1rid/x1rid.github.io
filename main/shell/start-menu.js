/* ---------------------------------------------------------------------------
 * shell/start-menu.js
 *
 * Start menu / OS-wide search: result building, scoring, launching, open/close and input wiring.
 * Re-renders when AppRegistry dispatches os:apps-changed.
 *
 * Loaded as a classic script. Top-level bindings are shared between shell files;
 * runtime statements live in shellInit_* functions that boot.js calls in order
 * after window.ProfileReady.
 * ------------------------------------------------------------------------- */
'use strict';

/* ── Start = OS-wide search only ────────────────────────── */
function scoreSearchItem(item, query) {
    const title = item.title.toLowerCase();
    const subtitle = item.subtitle.toLowerCase();
    const keywords = (item.keywords || '').toLowerCase();
    let score = 99;
    if (title === query) score = 0;
    else if (title.startsWith(query)) score = 1;
    else if (title.includes(query)) score = 2;
    else if (subtitle.includes(query)) score = 3;
    else if (keywords.includes(query)) score = 4;
    if (score < 99) {
        if (item.kind === 'app') score -= 0.4;
        else if (item.kind === 'folder') score -= 0.2;
        else if (item.kind === 'file') score -= 0.1;
    }
    return score;
}

function buildSearchItems() {
    const items = [];

    // Applications come from the registry, never from a second hard-coded
    // Start/taskbar list. Hidden definitions (for example the legacy
    // Programs shelf) stay out of the unified launcher.
    const registry = window.AppRegistry;
    if (registry) {
        registry.list().forEach((definition) => {
            if (!definition || definition.hidden) return;
            items.push({
                id: `app-${definition.id}`,
                kind: definition.kind === 'program' ? 'program' : 'app',
                app: definition.id,
                program: definition.kind === 'program' ? definition.id : undefined,
                title: definition.name,
                subtitle: definition.tagline || definition.meta || 'Application',
                icon: definition.icon || '\u25B8',
                type: definition.kind === 'program' ? 'PROGRAM' : 'APP',
                keywords: `${definition.id} ${definition.name} ${definition.tagline || ''} ${definition.meta || ''} app application`
            });
        });
    }

    windows.forEach((win) => {
        if (!win || win.closed) return;
        items.push({
            id: `window-${win.id}`,
            kind: 'window',
            windowId: win.id,
            title: win.taskbarTitle || win.title || win.id,
            subtitle: (win.minimized ? 'Minimized window' : 'Open window') +
                ' \u00B7 Desktop ' + (workspaceOfWindow(win) + 1),
            icon: win.icon || '\u25A3',
            type: 'WINDOW',
            keywords: `${win.appId || ''} ${win.title || ''} ${win.id} open window`
        });
    });

    const commands = window.DesktopEnvironment &&
        typeof window.DesktopEnvironment.listCommands === 'function'
        ? window.DesktopEnvironment.listCommands()
        : [];
    commands.forEach((command) => {
        items.push({
            id: `command-${command.id}`,
            kind: 'command',
            run: command.run,
            title: command.title,
            subtitle: command.subtitle || 'Desktop command',
            icon: command.icon || '\u25B8',
            type: 'COMMAND',
            keywords: `${command.id} ${command.title} ${command.keywords || ''} command action`
        });
    });

    const vfs = window.VFS;
    if (vfs && vfs.nodes) {
        // Index known folders
        const known = [
            { name: 'This PC', id: 'root', icon: '▣', desc: 'System Root' },
            { name: 'Recycle Bin', id: '__recycle__', icon: '🗑', desc: 'Deleted files and folders' }
        ];
        const kf = vfs.knownFolders || {};
        if (kf.desktop) known.push({ name: 'Desktop', id: kf.desktop, icon: '📁', desc: 'Desktop folder' });
        if (kf.documents) known.push({ name: 'Documents', id: kf.documents, icon: '📁', desc: 'Documents folder' });
        if (kf.downloads) known.push({ name: 'Downloads', id: kf.downloads, icon: '📁', desc: 'Downloads folder' });
        if (kf.music) known.push({ name: 'Music', id: kf.music, icon: '📁', desc: 'Music folder' });
        if (kf.pictures) known.push({ name: 'Pictures', id: kf.pictures, icon: '📁', desc: 'Pictures folder' });
        if (kf.videos) known.push({ name: 'Videos', id: kf.videos, icon: '📁', desc: 'Videos folder' });

        known.forEach(k => {
            items.push({
                id: `vfs-known-${k.id}`,
                kind: 'vfs',
                nodeId: k.id,
                title: k.name,
                subtitle: k.desc,
                icon: k.icon,
                type: 'SYSTEM',
                keywords: `${k.name} folder known system vfs`
            });
        });

        // Index all active non-hidden, non-recycled VFS nodes
        for (const node of vfs.nodes.values()) {
            if (node.id === 'root' || node.parentId === '__recycle__' || (node.attributes && node.attributes.hidden)) {
                continue;
            }
            const path = vfs.getPath(node.id) || node.name;
            const isDir = node.type === 'directory';
            items.push({
                id: `vfs-node-${node.id}`,
                kind: 'vfs',
                nodeId: node.id,
                title: node.name,
                subtitle: path,
                icon: isDir ? '📁' : '📄',
                type: isDir ? 'FOLDER' : (node.extension ? node.extension.toUpperCase() : 'FILE'),
                keywords: `${node.name} ${node.extension || ''} ${path} ${isDir ? 'folder directory' : 'file document'} vfs`
            });
        }
    }

    return items;
}

function setActiveSearchIndex(index) {
    const buttons = Array.from(startResults.querySelectorAll('.search-result'));
    if (!buttons.length) {
        searchActiveIndex = -1;
        startInput.removeAttribute('aria-activedescendant');
        return;
    }
    searchActiveIndex = clamp(index, 0, buttons.length - 1);
    buttons.forEach((button, buttonIndex) => {
        button.classList.toggle('is-active', buttonIndex === searchActiveIndex);
    });
    const active = buttons[searchActiveIndex];
    startInput.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
}

function renderSearchResults(query) {
    const normalized = query.trim().toLowerCase();
    startResults.textContent = '';
    searchItems = [];
    searchActiveIndex = -1;
    startInput.removeAttribute('aria-activedescendant');

    if (!normalized) {
        const empty = document.createElement('div');
        empty.className = 'start-empty';
        empty.innerHTML = 'TYPE TO SEARCH<br><span class="start-empty-sub">apps · folders · links · files</span>';
        startResults.appendChild(empty);
        return;
    }

    const scored = buildSearchItems()
        .map((item) => ({ item, score: scoreSearchItem(item, normalized) }))
        .filter((entry) => entry.score < 99)
        .sort((a, b) => a.score - b.score || a.item.title.localeCompare(b.item.title))
        .slice(0, 16);

    if (!scored.length) {
        const empty = document.createElement('div');
        empty.className = 'start-empty';
        empty.textContent = `NO RESULTS FOR "${query.trim()}"`;
        startResults.appendChild(empty);
        return;
    }

    const groups = [
        ['APPS', 'app'],
        ['PROGRAMS', 'program'],
        ['OPEN WINDOWS', 'window'],
        ['COMMANDS', 'command'],
        ['FOLDERS', 'folder'],
        ['FILES', 'file'],
        ['LINKS', 'link']
    ];

    groups.forEach(([label, kind]) => {
        const groupItems = scored.filter((entry) => entry.item.kind === kind);
        if (!groupItems.length) return;
        const groupLabel = document.createElement('div');
        groupLabel.className = 'start-group-label';
        groupLabel.textContent = label;
        startResults.appendChild(groupLabel);

        groupItems.forEach(({ item }) => {
            const index = searchItems.length;
            searchItems.push(item);

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'search-result';
            button.id = `search-result-${index}`;
            button.dataset.index = String(index);
            button.setAttribute('role', 'option');
            button.tabIndex = -1;
            if (item.pending) button.classList.add('is-missing');

            const icon = document.createElement('span');
            icon.className = 'search-result-icon';
            icon.setAttribute('aria-hidden', 'true');
            const iconIsImage = typeof item.icon === 'string' &&
                (item.kind === 'link' || /^(data:image\/|(\.{0,2}\/)?[\w.-]+(\/[\w.-]+)*\.(svg|png|webp|gif|jpe?g)$)/i.test(item.icon));
            if (item.icon && iconIsImage) {
                const image = document.createElement('img');
                image.src = item.icon;
                image.alt = '';
                image.loading = 'lazy';
                image.addEventListener('error', () => {
                    image.remove();
                    icon.textContent = item.title.slice(0, 2).toUpperCase();
                }, { once: true });
                icon.appendChild(image);
            } else {
                icon.textContent = item.icon || '·';
            }

            const text = document.createElement('span');
            text.className = 'search-result-text';
            const title = document.createElement('span');
            title.className = 'search-result-title';
            title.textContent = item.title;
            const subtitle = document.createElement('span');
            subtitle.className = 'search-result-sub';
            subtitle.textContent = item.subtitle;
            text.append(title, subtitle);

            const type = document.createElement('span');
            type.className = 'search-result-type';
            type.textContent = item.type;

            button.append(icon, text, type);
            button.addEventListener('click', () => launchSearchItem(item));
            startResults.appendChild(button);
        });
    });

    setActiveSearchIndex(0);
    startResults.scrollTop = 0;
}

function launchSearchItem(item) {
    if (!item) return;
    closeSearch(false);

    if (typeof item.run === 'function') {
        try { item.run(); } catch (error) { console.error('Search command failed:', error); }
        return;
    }

    if (item.kind === 'window' && item.windowId) {
        focusWindow(item.windowId, true);
        return;
    }

    if (item.kind === 'app' || item.kind === 'program') {
        if (window.AppRegistry && item.app && window.AppRegistry.has(item.app)) {
            const win = window.AppRegistry.launch(item.app, { source: 'start-search' });
            if (win) toast(`${item.title.toUpperCase()} OPENED`, 1600);
            return;
        }
        if (item.kind === 'program' && item.program) {
            const win = openProgram(item.program);
            if (win) toast(`${item.title.toUpperCase()} OPENED`, 1600);
        }
        return;
    }

    if (item.kind === 'vfs' || item.nodeId) {
        const vfs = window.VFS;
        if (vfs) {
            if (item.nodeId === '__recycle__') {
                openRecycleBin();
                return;
            }
            const node = vfs.getNode(item.nodeId);
            if (node) {
                if (node.type === 'directory' || node.id === 'root') {
                    openExplorer(node.id);
                } else {
                    openExplorer(node.parentId);
                    if (typeof window.openVfsNode === 'function') {
                        window.openVfsNode(node);
                    }
                }
                toast(`OPENING ${item.title.toUpperCase()}`, 1600);
                return;
            }
        }
        openExplorer(item.nodeId);
        return;
    }

    if (item.kind === 'folder') {
        openExplorer(item.view);
        return;
    }

    if (item.kind === 'file') {
        openExplorer();
        if (window.linkExchangeApp) window.linkExchangeApp.openReadme();
        return;
    }

    if (item.kind === 'link') {
        const result = window.linkExchangeApp
            ? window.linkExchangeApp.openLink(item.link)
            : { ok: false };
        if (result.ok) toast(`OPENING ${result.item.name} — ${result.item.target}`, 1800);
        else toast(`TARGET MISSING — ${item.title} has no destination yet`, 3200);
    }
}

function openSearch(query = '') {
    if (!startMenu.hidden) {
        if (query) {
            startInput.value = query;
            renderSearchResults(query);
        }
        startInput.focus();
        startInput.select();
        return;
    }
    startMenu.hidden = false;
    startButton.setAttribute('aria-expanded', 'true');
    setActiveWindowMarker('start');
    startInput.value = query;
    renderSearchResults(query);
    startInput.focus();
    startInput.select();
}

function closeSearch(restoreFocus = true) {
    if (startMenu.hidden) return;
    startMenu.hidden = true;
    startButton.setAttribute('aria-expanded', 'false');
    startInput.value = '';
    startResults.textContent = '';
    searchItems = [];
    searchActiveIndex = -1;
    startInput.removeAttribute('aria-activedescendant');
    setActiveWindowMarker('none');
    startInput.blur();
    if (restoreFocus) startButton.focus();
}

/* Original inline-script statements, lines 2708-2756+ */
function shellInit_start_menu_1() {
    /* ── Start search wiring ────────────────────────────────── */
    startButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (startMenu.hidden) openSearch();
        else closeSearch(true);
    });

    startClose.addEventListener('click', () => closeSearch(true));

    startInput.addEventListener('input', () => {
        renderSearchResults(startInput.value);
    });

    startInput.addEventListener('keydown', (event) => {
        // The central ShortcutService owns these keys when it is available.
        if (window.ShortcutService) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            setActiveSearchIndex(searchActiveIndex + 1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            setActiveSearchIndex(searchActiveIndex - 1);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (searchActiveIndex >= 0) launchSearchItem(searchItems[searchActiveIndex]);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeSearch(true);
        }
    });

    document.addEventListener('pointerdown', (event) => {
        if (startMenu.hidden) return;
        if (startMenu.contains(event.target) || startButton.contains(event.target)) return;
        closeSearch(false);
    }, true);

    document.addEventListener('keydown', (event) => {
        if (window.ShortcutService) return;
        if (!startMenu.hidden && event.key === 'Escape') {
            event.preventDefault();
            closeSearch(true);
        }
    });

    taskbar.addEventListener('focusin', () => {
        if (startMenu.hidden) setActiveWindowMarker('none');
    });

    /* Manifest apps can arrive (or leave) at any time: keep the launcher and
       desktop surfaces in sync with the registry. */
    document.addEventListener('os:apps-changed', () => {
        if (!startMenu.hidden) renderSearchResults(startInput.value);
        renderProgramTiles();
        const env = window.DesktopEnvironment;
        if (env && typeof env.refresh === 'function') {
            try { env.refresh(); } catch (error) { console.warn('[Shell] desktop refresh failed:', error); }
        }
    });
}
