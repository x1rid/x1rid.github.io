/**
 * @file main/fs/explorer-adapter.js
 * @description Explorer UI adapter integrated directly with window.VFS.
 * Replaces hardcoded link arrays with real hierarchical Windows filesystem.
 */

(function (window) {
    'use strict';

    // Clipboard for file operations
    let fileClipboard = null; // { op: 'copy' | 'cut', nodeId: string, parentId: string }

    const state = {
        currentId: null, // string nodeId
        selected: null,  // selected nodeId
        sortKey: 'name',
        sortDir: 'asc',
        search: '',
        layout: 'details',
        history: [],
        historyIndex: -1,
        hovered: null,
        contextKey: null,
        renamingId: null,
        expanded: { root: true, 'c-drive': true }
    };

    // DOM Elements
    const explorer = document.getElementById('explorer');
    const tree = document.getElementById('tree');
    const treeTotal = document.getElementById('tree-total');
    const fileRows = document.getElementById('file-rows');
    const fileTable = document.getElementById('file-table');
    const tableWrap = document.getElementById('table-wrap');
    const breadcrumbs = document.getElementById('breadcrumbs');
    const search = document.getElementById('search');
    const statusCount = document.getElementById('status-count');
    const statusTarget = document.getElementById('status-target');
    const clock = document.getElementById('clock');
    const navBack = document.getElementById('nav-back');
    const navForward = document.getElementById('nav-forward');
    const navUp = document.getElementById('nav-up');
    const viewToggle = document.getElementById('view-toggle');
    const splitter = document.getElementById('splitter');
    const contextMenu = document.getElementById('context-menu');
    const dialogOverlay = document.getElementById('dialog-overlay');
    const dialogTitle = document.getElementById('dialog-title');
    const dialogBody = document.getElementById('dialog-body');
    const dialogOk = document.getElementById('dialog-ok');

    const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));

    function formatSize(bytes) {
        if (bytes == null || isNaN(bytes)) return '--';
        if (bytes === 0) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    }

    function formatDate(ts) {
        if (!ts) return '--';
        return new Date(ts).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function updateClock() {
        if (!clock) return;
        const now = new Date();
        clock.textContent = now.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    }
    updateClock();
    window.setInterval(updateClock, 15000);

    /* ── VFS Query Helpers ──────────────────────────────────── */

    function getVfs() {
        return window.VFS || null;
    }

    function isRecycleBinView() {
        return state.currentId === '__recycle__';
    }

    function isRootView() {
        return state.currentId === 'root';
    }

    function getItemsForCurrentView() {
        const vfs = getVfs();
        if (!vfs) return [];

        if (isRecycleBinView()) {
            const recycledNodes = vfs.getRecycleBin ? vfs.getRecycleBin() : [];
            return recycledNodes.map(rec => {
                const node = rec && rec.name ? rec : (vfs.getNode(rec.id) || rec);
                let displayType = 'Deleted Item';
                if (node.type === 'directory') displayType = 'Folder';
                else if (node.type === 'shortcut') displayType = 'Shortcut';
                else if (node.extension) displayType = node.extension.toUpperCase() + ' File';

                return {
                    id: node.id,
                    name: node.name,
                    type: displayType,
                    size: node.type === 'file' ? formatSize(node.size) : '--',
                    modified: formatDate(node.modifiedAt),
                    status: 'DELETED',
                    isFolder: node.type === 'directory',
                    isShortcut: node.type === 'shortcut',
                    node: node
                };
            });
        }

        if (isRootView()) {
            // Virtual "This PC" / "My Computer" view: C: drive + Recycle Bin
            const items = [];
            const drives = vfs.getChildren('root').filter(n => !n.attributes.hidden);
            drives.forEach(drive => {
                items.push({
                    id: drive.id,
                    name: drive.name,
                    type: 'Local Disk',
                    size: '--',
                    modified: formatDate(drive.modifiedAt),
                    status: 'SYSTEM',
                    isFolder: true,
                    isShortcut: false,
                    node: drive
                });
            });

            // Virtual Recycle Bin entry in This PC
            const recycleCount = vfs.getRecycleBin ? vfs.getRecycleBin().length : 0;
            items.push({
                id: '__recycle__',
                name: 'Recycle Bin',
                type: 'System Folder',
                size: recycleCount > 0 ? `${recycleCount} items` : 'Empty',
                modified: '--',
                status: 'SYSTEM',
                isFolder: true,
                isShortcut: false,
                node: null
            });

            return items;
        }

        // Standard directory view
        const currentDir = vfs.getNode(state.currentId);
        if (!currentDir) return [];

        const children = vfs.getChildren(state.currentId);
        return children
            .filter(node => !node.attributes.hidden)
            .map(node => {
                let displayType = 'File';
                if (node.type === 'directory') displayType = 'Folder';
                else if (node.type === 'shortcut') displayType = 'Shortcut';
                else if (node.extension) displayType = node.extension.toUpperCase() + ' File';

                return {
                    id: node.id,
                    name: node.name,
                    type: displayType,
                    size: node.type === 'file' ? formatSize(node.size) : '--',
                    modified: formatDate(node.modifiedAt),
                    status: 'READY',
                    isFolder: node.type === 'directory',
                    isShortcut: node.type === 'shortcut',
                    node: node
                };
            });
    }

    function sortValue(item) {
        if (state.sortKey === 'type') return item.type;
        if (state.sortKey === 'size') return item.node && item.node.size != null ? item.node.size : -1;
        if (state.sortKey === 'status') return item.status;
        if (state.sortKey === 'modified') return item.node ? item.node.modifiedAt : 0;
        return item.name;
    }

    function sortedItems(items) {
        const dir = state.sortDir === 'asc' ? 1 : -1;
        return items.slice().sort((a, b) => {
            if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
            const av = sortValue(a);
            const bv = sortValue(b);
            if (av === bv) return a.name.localeCompare(b.name);
            if (typeof av === 'number' && typeof bv === 'number') {
                return (av - bv) * dir;
            }
            return String(av).localeCompare(String(bv), undefined, {
                numeric: true,
                sensitivity: 'base'
            }) * dir;
        });
    }

    function visibleItems() {
        const query = state.search.trim().toLowerCase();
        let items = getItemsForCurrentView();
        if (query) {
            items = items.filter(item => [
                item.name,
                item.type,
                item.size,
                item.modified,
                item.status
            ].join(' ').toLowerCase().includes(query));
        }
        return sortedItems(items);
    }

    /* ── Tree Rendering ─────────────────────────────────────── */

    function renderTree() {
        const vfs = getVfs();
        if (!vfs || !tree) return;

        const currentId = state.currentId;

        // Recursive directory branch renderer
        function renderDirBranch(dirNode, depth) {
            const children = vfs.getChildren(dirNode.id)
                .filter(n => n.type === 'directory' && !n.attributes.hidden);
            
            const isExpanded = state.expanded[dirNode.id] !== false;
            const isSelected = dirNode.id === currentId;
            const hasChildren = children.length > 0;

            let html = `
                <div class="tree-row${isSelected ? ' is-selected' : ''}"
                     role="treeitem"
                     data-id="${escapeHtml(dirNode.id)}"
                     aria-expanded="${isExpanded}"
                     aria-selected="${isSelected}"
                     tabindex="${isSelected ? '0' : '-1'}"
                     title="${escapeHtml(dirNode.name)}"
                     style="--depth:${depth}">
                    <span class="twisty" aria-hidden="true">${hasChildren ? (isExpanded ? '▾' : '▸') : ''}</span>
                    <span class="folder-icon${isExpanded || isSelected ? ' is-open' : ''}${dirNode.attributes.system ? ' is-dim' : ''}" aria-hidden="true"></span>
                    <span class="tree-label">${escapeHtml(dirNode.name)}</span>
                    <span class="tree-count">${children.length}</span>
                </div>`;

            if (hasChildren) {
                html += `<div class="tree-group" role="group" ${isExpanded ? '' : 'hidden'}>`;
                children.forEach(child => {
                    html += renderDirBranch(child, depth + 1);
                });
                html += `</div>`;
            }

            return html;
        }

        const root = vfs.getNode('root');
        if (!root) {
            tree.innerHTML = '<div style="padding:10px;color:var(--ink-30);">Loading tree...</div>';
            return;
        }

        const rootOpen = state.expanded.root !== false;
        const rootSelected = currentId === 'root';
        const drives = vfs.getChildren('root').filter(n => n.type === 'directory');

        let treeHtml = `
            <div class="tree-row${rootSelected ? ' is-selected' : ''}"
                 role="treeitem"
                 data-id="root"
                 aria-expanded="${rootOpen}"
                 aria-selected="${rootSelected}"
                 tabindex="${rootSelected ? '0' : '-1'}"
                 title="This PC"
                 style="--depth:0">
                <span class="twisty" aria-hidden="true">${drives.length ? (rootOpen ? '▾' : '▸') : ''}</span>
                <span class="app-icon" aria-hidden="true">▣</span>
                <span class="tree-label">This PC</span>
            </div>
            <div class="tree-group" role="group" ${rootOpen ? '' : 'hidden'}>`;

        drives.forEach(drive => {
            treeHtml += renderDirBranch(drive, 1);
        });

        const recycleSelected = state.currentId === '__recycle__';
        const recycleCount = vfs.getRecycleBin ? vfs.getRecycleBin().length : 0;
        treeHtml += `
            <div class="tree-row${recycleSelected ? ' is-selected' : ''}"
                 role="treeitem"
                 data-id="__recycle__"
                 aria-selected="${recycleSelected}"
                 tabindex="${recycleSelected ? '0' : '-1'}"
                 title="Recycle Bin — ${recycleCount} deleted"
                 style="--depth:1">
                <span class="twisty" aria-hidden="true"></span>
                <span class="folder-icon${recycleSelected ? ' is-open' : ''}" aria-hidden="true"></span>
                <span class="tree-label">Recycle Bin</span>
                <span class="tree-count">${recycleCount}</span>
            </div>
        </div>`;

        tree.innerHTML = treeHtml;

        if (treeTotal) {
            const count = getItemsForCurrentView().length;
            treeTotal.textContent = `${count} OBJECTS`;
        }
    }

    /* ── Breadcrumbs ────────────────────────────────────────── */

    function renderBreadcrumbs() {
        if (!breadcrumbs) return;
        const vfs = getVfs();
        if (!vfs) return;

        if (isRecycleBinView()) {
            breadcrumbs.innerHTML = `
                <button class="crumb" type="button" data-id="root">This PC</button>
                <span class="crumb-sep" aria-hidden="true">\\</span>
                <span class="crumb is-current">Recycle Bin</span>`;
            return;
        }

        if (isRootView()) {
            breadcrumbs.innerHTML = `<span class="crumb is-current">This PC</span>`;
            return;
        }

        const chain = [];
        let curr = vfs.getNode(state.currentId);
        while (curr) {
            chain.unshift(curr);
            if (!curr.parentId) break;
            curr = vfs.getNode(curr.parentId);
        }

        if (!chain.length) {
            breadcrumbs.innerHTML = `<span class="crumb is-current">This PC</span>`;
            return;
        }

        const crumbs = chain.map((node, i) => {
            const isCurrent = i === chain.length - 1;
            const displayName = node.id === 'root' ? 'This PC' : node.name;
            if (isCurrent) {
                return `<span class="crumb is-current">${escapeHtml(displayName)}</span>`;
            }
            return `<button class="crumb" type="button" data-id="${escapeHtml(node.id)}">${escapeHtml(displayName)}</button>`;
        });

        breadcrumbs.innerHTML = crumbs.join('<span class="crumb-sep" aria-hidden="true">\\</span>');
    }

    /* ── List / Details Rendering ───────────────────────────── */

    function getIconHtml(item) {
        if (item.id === '__recycle__') {
            return `<span class="trash-icon" style="display:inline-block;width:14px;height:14px;vertical-align:middle;margin-right:2px;" aria-hidden="true"></span>`;
        }
        if (item.isFolder) {
            return `<span class="folder-icon" aria-hidden="true"></span>`;
        }
        if (item.isShortcut) {
            return `<span class="file-icon"><span class="shortcut" aria-hidden="true">↗</span>📄</span>`;
        }
        return `<span class="doc-icon" aria-hidden="true"></span>`;
    }

    function renderList() {
        if (!fileRows) return;
        const items = visibleItems();

        if (state.selected && !items.some(item => item.id === state.selected)) {
            state.selected = null;
        }

        if (!items.length) {
            fileRows.innerHTML = `<tr class="empty-row"><td colspan="5">${state.search ? 'NO FILES MATCH' : 'THIS FOLDER IS EMPTY'}</td></tr>`;
            updateStatus();
            return;
        }

        // Ordered columns: Name | Type | Size | Modified | Status
        fileRows.innerHTML = items.map((item, index) => {
            const selected = item.id === state.selected;
            const isRenaming = state.renamingId === item.id;
            const tabindex = selected || (!state.selected && index === 0) ? '0' : '-1';
            const classes = [
                selected ? 'is-selected' : '',
                fileClipboard && fileClipboard.nodeId === item.id && fileClipboard.op === 'cut' ? 'is-pending' : ''
            ].filter(Boolean).join(' ');

            let nameHtml;
            if (isRenaming) {
                nameHtml = `<input type="text" class="rename-input" value="${escapeHtml(item.name)}" spellcheck="false" autocomplete="off" />`;
            } else {
                nameHtml = `<span class="filename">${escapeHtml(item.name)}</span>`;
            }

            return `
                <tr class="${classes}"
                    data-id="${escapeHtml(item.id)}"
                    aria-selected="${selected}"
                    title="${escapeHtml(item.name)} — ${escapeHtml(item.type)}"
                    tabindex="${tabindex}">
                    <td class="col-name">
                        <span class="name-cell">
                            ${getIconHtml(item)}
                            ${nameHtml}
                        </span>
                    </td>
                    <td class="col-type">${escapeHtml(item.type)}</td>
                    <td class="col-size">${escapeHtml(item.size)}</td>
                    <td class="col-modified">${escapeHtml(item.modified)}</td>
                    <td class="col-status"><span class="status-label"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(item.status)}</span></td>
                </tr>`;
        }).join('');

        if (state.renamingId) {
            const renameInput = fileRows.querySelector('.rename-input');
            if (renameInput) {
                renameInput.focus();
                const currentItem = items.find(it => it.id === state.renamingId);
                const currentName = currentItem ? currentItem.name : renameInput.value;
                const dotIdx = currentName.lastIndexOf('.');
                if (dotIdx > 0 && currentItem && !currentItem.isFolder) {
                    renameInput.setSelectionRange(0, dotIdx);
                } else {
                    renameInput.select();
                }

                renameInput.addEventListener('keydown', async (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        await commitRename(state.renamingId, renameInput.value);
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        state.renamingId = null;
                        renderList();
                    }
                });
                renameInput.addEventListener('blur', async () => {
                    if (state.renamingId) {
                        await commitRename(state.renamingId, renameInput.value);
                    }
                });
            }
        }

        updateStatus();
    }

    function updateStatus() {
        if (!statusCount || !statusTarget) return;
        const items = visibleItems();
        const selected = items.find(item => item.id === state.selected);
        const hovered = items.find(item => item.id === state.hovered);

        if (selected) {
            statusCount.textContent = '1 selected';
        } else if (state.search) {
            statusCount.textContent = `${items.length} of ${getItemsForCurrentView().length} objects`;
        } else {
            statusCount.textContent = `${items.length} object${items.length === 1 ? '' : 's'}`;
        }

        if (hovered) {
            statusTarget.textContent = `${hovered.name} (${hovered.type}) — ${hovered.size}`;
        } else if (selected) {
            statusTarget.textContent = `${selected.name} (${selected.type}) — ${selected.size}`;
        } else {
            statusTarget.textContent = 'Double-click or press Enter to open · right-click for options';
        }
    }

    function updateToolbar() {
        if (navBack) navBack.disabled = state.historyIndex <= 0;
        if (navForward) navForward.disabled = state.historyIndex >= state.history.length - 1;
        
        const vfs = getVfs();
        const current = vfs ? vfs.getNode(state.currentId) : null;
        if (navUp) navUp.disabled = isRootView() || (!current || !current.parentId);
        
        if (viewToggle) {
            viewToggle.textContent = state.layout === 'list' ? 'LIST' : 'DETAILS';
            viewToggle.setAttribute('aria-pressed', String(state.layout === 'list'));
        }
    }

    function animateList() {
        if (!tableWrap) return;
        tableWrap.classList.remove('is-switching');
        void tableWrap.offsetWidth;
        tableWrap.classList.add('is-switching');
        window.setTimeout(() => tableWrap.classList.remove('is-switching'), 170);
    }

    function render() {
        renderTree();
        renderBreadcrumbs();
        renderList();
        updateToolbar();
    }

    /* ── Navigation ─────────────────────────────────────────── */

    function navigate(nodeId, push = true) {
        if (!nodeId || nodeId === state.currentId) return;
        
        if (push) {
            state.history = state.history.slice(0, state.historyIndex + 1);
            state.history.push(nodeId);
            state.historyIndex = state.history.length - 1;
        }

        state.currentId = nodeId;
        state.selected = null;
        state.search = '';
        state.hovered = null;
        state.renamingId = null;
        if (search) search.value = '';

        // Auto-expand parent chain in tree
        const vfs = getVfs();
        if (vfs && nodeId !== '__recycle__' && nodeId !== 'root') {
            let n = vfs.getNode(nodeId);
            while (n) {
                state.expanded[n.id] = true;
                if (!n.parentId) break;
                n = vfs.getNode(n.parentId);
            }
        }

        render();
        animateList();

        // Pseudo views (recycle bin) are not valid restore targets.
        if (nodeId !== '__recycle__') {
            window.__explorerCurrentId = nodeId;
            try {
                document.dispatchEvent(new CustomEvent('explorer:navigate', { detail: { id: nodeId } }));
            } catch (_) { /* CustomEvent is available in supported browsers */ }
        }
    }

    function goBack() {
        if (state.historyIndex <= 0) return;
        state.historyIndex -= 1;
        navigate(state.history[state.historyIndex], false);
    }

    function goForward() {
        if (state.historyIndex >= state.history.length - 1) return;
        state.historyIndex += 1;
        navigate(state.history[state.historyIndex], false);
    }

    function goUp() {
        if (isRecycleBinView()) {
            navigate('root');
            return;
        }
        if (isRootView()) return;
        const vfs = getVfs();
        if (!vfs) return;
        const curr = vfs.getNode(state.currentId);
        if (curr && curr.parentId) {
            navigate(curr.parentId);
        } else {
            navigate('root');
        }
    }

    /* ── File Operations & Context Menu ─────────────────────── */

    function hideContextMenu() {
        if (contextMenu) {
            contextMenu.hidden = true;
            contextMenu.innerHTML = '';
            state.contextKey = null;
        }
    }

    function showContextMenu(itemId, x, y) {
        const vfs = getVfs();
        if (!vfs || !contextMenu) return;

        state.contextKey = itemId;
        const node = itemId ? (itemId === '__recycle__' ? null : vfs.getNode(itemId)) : null;
        const isRecycle = isRecycleBinView();

        let menuHtml = '';

        if (isRecycle) {
            if (node || itemId) {
                menuHtml += `
                    <button class="menu-item" type="button" role="menuitem" data-action="restore"><span class="menu-icon" aria-hidden="true">↺</span>Restore</button>
                    <button class="menu-item" type="button" role="menuitem" data-action="perm-delete"><span class="menu-icon" aria-hidden="true">×</span>Delete Permanently</button>
                    <div class="menu-sep" role="separator"></div>`;
            } else {
                menuHtml += `
                    <button class="menu-item" type="button" role="menuitem" data-action="empty-bin"><span class="menu-icon" aria-hidden="true">🗑</span>Empty Recycle Bin</button>
                    <div class="menu-sep" role="separator"></div>`;
            }
        } else if (node) {
            // Selected item in normal directory
            menuHtml += `
                <button class="menu-item" type="button" role="menuitem" data-action="open"><span class="menu-icon" aria-hidden="true">▸</span>Open<span class="menu-shortcut">Enter</span></button>
                <div class="menu-sep" role="separator"></div>
                <button class="menu-item" type="button" role="menuitem" data-action="cut"><span class="menu-icon" aria-hidden="true">✂</span>Cut<span class="menu-shortcut">Ctrl+X</span></button>
                <button class="menu-item" type="button" role="menuitem" data-action="copy"><span class="menu-icon" aria-hidden="true">⧉</span>Copy<span class="menu-shortcut">Ctrl+C</span></button>
                <div class="menu-sep" role="separator"></div>
                <button class="menu-item" type="button" role="menuitem" data-action="delete"><span class="menu-icon" aria-hidden="true">🗑</span>Delete<span class="menu-shortcut">Del</span></button>
                <button class="menu-item" type="button" role="menuitem" data-action="rename"><span class="menu-icon" aria-hidden="true">✎</span>Rename<span class="menu-shortcut">F2</span></button>
                <div class="menu-sep" role="separator"></div>
                <button class="menu-item" type="button" role="menuitem" data-action="properties"><span class="menu-icon" aria-hidden="true">i</span>Properties<span class="menu-shortcut">Alt+Enter</span></button>`;
        } else if (itemId === '__recycle__') {
            menuHtml += `
                <button class="menu-item" type="button" role="menuitem" data-action="open"><span class="menu-icon" aria-hidden="true">▸</span>Open</button>
                <button class="menu-item" type="button" role="menuitem" data-action="empty-bin"><span class="menu-icon" aria-hidden="true">🗑</span>Empty Recycle Bin</button>`;
        } else {
            // Right click on empty directory space
            const hasPaste = fileClipboard !== null;
            menuHtml += `
                <button class="menu-item" type="button" role="menuitem" data-action="new-folder"><span class="menu-icon" aria-hidden="true">📁</span>New Folder<span class="menu-shortcut">Ctrl+Alt+N</span></button>
                <button class="menu-item" type="button" role="menuitem" data-action="new-file"><span class="menu-icon" aria-hidden="true">📄</span>New Text Document</button>
                <div class="menu-sep" role="separator"></div>
                <button class="menu-item" type="button" role="menuitem" data-action="paste" ${hasPaste ? '' : 'disabled'}><span class="menu-icon" aria-hidden="true">📋</span>Paste<span class="menu-shortcut">Ctrl+V</span></button>
                <div class="menu-sep" role="separator"></div>
                <button class="menu-item" type="button" role="menuitem" data-action="refresh"><span class="menu-icon" aria-hidden="true">↻</span>Refresh</button>`;
        }

        contextMenu.innerHTML = menuHtml;
        contextMenu.hidden = false;

        const rect = contextMenu.getBoundingClientRect();
        const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
        const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
        contextMenu.style.left = `${left}px`;
        contextMenu.style.top = `${top}px`;
    }

    async function commitRename(id, newName) {
        state.renamingId = null;
        const vfs = getVfs();
        if (!vfs || !newName || !newName.trim()) {
            renderList();
            return;
        }
        const trimmed = newName.trim();
        const node = vfs.getNode(id);
        if (!node || node.name === trimmed) {
            renderList();
            return;
        }
        try {
            await vfs.rename(id, trimmed);
            if (typeof window.toast === 'function') {
                window.toast(`RENAMED TO "${trimmed}"`, 1800);
            }
        } catch (err) {
            if (typeof window.toast === 'function') {
                window.toast(`RENAME FAILED: ${err.message}`, 3000);
            } else {
                openDialog('Rename Error', `<div class="prop-grid"><div class="prop-key">Error</div><div class="prop-value">${escapeHtml(err.message)}</div></div>`);
            }
        }
        renderList();
    }

    async function handleFileAction(action, itemId) {
        const vfs = getVfs();
        if (!vfs) return;

        hideContextMenu();

        if (action === 'open') {
            if (itemId === '__recycle__') {
                navigate('__recycle__');
            } else if (itemId) {
                openNode(vfs.getNode(itemId));
            }
        } else if (action === 'cut') {
            fileClipboard = { op: 'cut', nodeId: itemId, parentId: state.currentId };
            renderList();
            if (typeof window.toast === 'function') window.toast('ITEM CUT TO CLIPBOARD', 1400);
        } else if (action === 'copy') {
            fileClipboard = { op: 'copy', nodeId: itemId, parentId: state.currentId };
            if (typeof window.toast === 'function') window.toast('ITEM COPIED TO CLIPBOARD', 1400);
        } else if (action === 'paste') {
            if (fileClipboard && state.currentId && state.currentId !== '__recycle__' && state.currentId !== 'root') {
                try {
                    if (fileClipboard.op === 'cut') {
                        await vfs.move(fileClipboard.nodeId, state.currentId);
                        fileClipboard = null;
                        if (typeof window.toast === 'function') window.toast('ITEM MOVED', 1400);
                    } else if (fileClipboard.op === 'copy') {
                        await vfs.copy(fileClipboard.nodeId, state.currentId);
                        if (typeof window.toast === 'function') window.toast('ITEM COPIED', 1400);
                    }
                } catch (err) {
                    openDialog('Paste Error', `<div class="prop-grid"><div class="prop-key">Error</div><div class="prop-value">${escapeHtml(err.message)}</div></div>`);
                }
            }
        } else if (action === 'delete') {
            if (itemId) {
                try {
                    await vfs.delete(itemId);
                    if (typeof window.toast === 'function') window.toast('SENT TO RECYCLE BIN', 1600);
                } catch (err) {
                    openDialog('Delete Error', `<div class="prop-grid"><div class="prop-key">Error</div><div class="prop-value">${escapeHtml(err.message)}</div></div>`);
                }
            }
        } else if (action === 'perm-delete') {
            if (itemId) {
                try {
                    await vfs.permanentlyDelete(itemId);
                    render();
                    if (typeof window.toast === 'function') window.toast('PERMANENTLY DELETED', 1600);
                } catch (err) {
                    openDialog('Permanent Delete Error', `<div class="prop-grid"><div class="prop-key">Error</div><div class="prop-value">${escapeHtml(err.message)}</div></div>`);
                }
            }
        } else if (action === 'restore') {
            if (itemId) {
                try {
                    await vfs.restore(itemId);
                    render();
                    if (typeof window.toast === 'function') window.toast('RESTORED ITEM', 1600);
                } catch (err) {
                    openDialog('Restore Error', `<div class="prop-grid"><div class="prop-key">Error</div><div class="prop-value">${escapeHtml(err.message)}</div></div>`);
                }
            }
        } else if (action === 'empty-bin') {
            try {
                await vfs.emptyRecycleBin();
                render();
                if (typeof window.toast === 'function') window.toast('RECYCLE BIN EMPTIED', 1600);
            } catch (err) {
                openDialog('Recycle Bin Error', `<div class="prop-grid"><div class="prop-key">Error</div><div class="prop-value">${escapeHtml(err.message)}</div></div>`);
            }
        } else if (action === 'rename') {
            state.renamingId = itemId;
            renderList();
        } else if (action === 'properties') {
            if (itemId) openProperties(vfs.getNode(itemId));
        } else if (action === 'new-folder') {
            if (state.currentId && state.currentId !== '__recycle__' && state.currentId !== 'root') {
                try {
                    let baseName = 'New Folder';
                    let folderName = baseName;
                    let counter = 1;
                    const existing = vfs.getChildren(state.currentId);
                    while (existing.some(c => c.name.toLowerCase() === folderName.toLowerCase())) {
                        counter += 1;
                        folderName = `${baseName} (${counter})`;
                    }
                    const newDir = await vfs.createDirectory(state.currentId, folderName);
                    state.selected = newDir.id;
                    state.renamingId = newDir.id;
                    renderList();
                } catch (err) {
                    openDialog('Create Folder Error', `<div class="prop-grid"><div class="prop-key">Error</div><div class="prop-value">${escapeHtml(err.message)}</div></div>`);
                }
            }
        } else if (action === 'new-file') {
            if (state.currentId && state.currentId !== '__recycle__' && state.currentId !== 'root') {
                try {
                    let baseName = 'New Text Document';
                    let fileName = `${baseName}.txt`;
                    let counter = 1;
                    const existing = vfs.getChildren(state.currentId);
                    while (existing.some(c => c.name.toLowerCase() === fileName.toLowerCase())) {
                        counter += 1;
                        fileName = `${baseName} (${counter}).txt`;
                    }
                    const newFile = await vfs.createFile(state.currentId, fileName, { kind: 'text', value: '' });
                    state.selected = newFile.id;
                    state.renamingId = newFile.id;
                    renderList();
                } catch (err) {
                    openDialog('Create File Error', `<div class="prop-grid"><div class="prop-key">Error</div><div class="prop-value">${escapeHtml(err.message)}</div></div>`);
                }
            }
        } else if (action === 'refresh') {
            render();
        }
    }

    function openNode(node) {
        if (!node) return;
        if (node.id === '__recycle__') {
            navigate('__recycle__');
            return;
        }
        if (node.type === 'directory') {
            navigate(node.id);
            return;
        }
        if (node.type === 'shortcut') {
            const vfs = getVfs();
            const target = vfs ? vfs.getNode(node.targetId) : null;
            if (target) openNode(target);
            else openDialog('Broken Shortcut', `<div class="prop-grid"><div class="prop-key">Notice</div><div class="prop-value">The shortcut target no longer exists.</div></div>`);
            return;
        }

        // File Node - check association
        const ext = (node.extension || '').toLowerCase();
        if (['txt', 'md', 'json', 'js', 'css', 'html', 'log', 'ini', 'xml', 'yml'].includes(ext)) {
            const vfs = getVfs();
            vfs.readFile(node.id).then(content => {
                const text = content && content.kind === 'text' ? content.value : (content ? String(content.value) : '');
                openDialog(`${node.name} — Notepad`, `<textarea readonly style="width:100%;height:320px;background:var(--well-bg);color:var(--ink-90);font-family:monospace;font-size:12px;padding:8px;border:1px solid var(--bevel-dark);resize:vertical;box-sizing:border-box;">${escapeHtml(text)}</textarea>`);
            }).catch(err => {
                openDialog('Error Reading File', `<div class="prop-grid"><div class="prop-key">Error</div><div class="prop-value">${escapeHtml(err.message)}</div></div>`);
            });
        } else if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'ico', 'bmp'].includes(ext)) {
            const vfs = getVfs();
            vfs.readFile(node.id).then(content => {
                let src = '';
                if (!content) src = '';
                else if (content.kind === 'dataUrl') src = content.value;
                else if (content.kind === 'text' && ext === 'svg') src = 'data:image/svg+xml;utf8,' + encodeURIComponent(content.value);
                else if (content.kind === 'blob') src = URL.createObjectURL(content.value);
                else if (typeof content.value === 'string') src = content.value;
                openDialog(`${node.name} — Image Viewer`, `<div style="text-align:center;padding:12px;background:#000;"><img src="${escapeHtml(src)}" alt="${escapeHtml(node.name)}" style="max-width:100%;max-height:380px;object-fit:contain;image-rendering:pixelated;border:1px solid var(--line-hi);" /></div>`);
            }).catch(err => {
                openDialog('Error Reading File', `<div class="prop-grid"><div class="prop-key">Error</div><div class="prop-value">${escapeHtml(err.message)}</div></div>`);
            });
        } else if (['mp3', 'opus', 'wav', 'ogg', 'mp4', 'webm', 'flac', 'aac', 'm4a'].includes(ext)) {
            if (typeof window.openProgram === 'function') {
                window.openProgram('mediaplayer');
            }
        } else {
            openDialog('Open With', `<div class="prop-grid"><div class="prop-key">File</div><div class="prop-value">${escapeHtml(node.name)}</div><div class="prop-key">Status</div><div class="prop-value">No application associated with .${escapeHtml(ext)} files.</div></div>`);
        }
    }

    function openProperties(node) {
        if (!node) return;
        const vfs = getVfs();
        const path = vfs ? vfs.getPath(node.id) : '--';
        const rows = [
            propRow('Name', node.name),
            propRow('Type', node.type === 'directory' ? 'File Folder' : (node.extension ? node.extension.toUpperCase() + ' File' : 'File')),
            propRow('Location', path),
            propRow('Size', node.type === 'file' ? formatSize(node.size) : '--'),
            propRow('Created', formatDate(node.createdAt)),
            propRow('Modified', formatDate(node.modifiedAt)),
            propRow('Attributes', [
                node.attributes.readOnly ? 'Read-only' : '',
                node.attributes.hidden ? 'Hidden' : '',
                node.attributes.system ? 'System' : ''
            ].filter(Boolean).join(', ') || 'Normal')
        ];
        openDialog(`${node.name} Properties`, `<div class="prop-grid">${rows.join('')}</div>`);
    }

    function propRow(key, value) {
        return `<div class="prop-key">${escapeHtml(key)}</div><div class="prop-value">${escapeHtml(value)}</div>`;
    }

    function openDialog(title, html) {
        if (!dialogTitle || !dialogBody || !dialogOverlay) return;
        dialogTitle.textContent = title;
        dialogBody.innerHTML = html;
        dialogOverlay.hidden = false;
        if (dialogOk) dialogOk.focus();
    }

    function closeDialog() {
        if (dialogOverlay) {
            dialogOverlay.hidden = true;
            if (dialogBody) dialogBody.innerHTML = '';
        }
    }

    if (dialogOk) dialogOk.addEventListener('click', closeDialog);
    if (dialogOverlay) {
        dialogOverlay.addEventListener('click', (e) => {
            if (e.target === dialogOverlay) closeDialog();
        });
    }

    /* ── Desktop Icon Rendering ─────────────────────────────── */

    function renderDesktopIcons() {
        const vfs = getVfs();
        const desktopContainer = document.getElementById('desktop');
        if (!vfs || !desktopContainer) return;

        // Remove old dynamic desktop icons
        desktopContainer.querySelectorAll('.vfs-desktop-icon').forEach(el => el.remove());

        const desktopId = vfs.getKnownFolder('desktop');
        if (!desktopId) return;

        const children = vfs.getChildren(desktopId).filter(n => !n.attributes.hidden);
        
        // Vertical column layout starting in column 0 below My Computer and Recycle Bin
        const itemHeight = 84;
        const colWidth = 86;
        const startTop = 18;
        const startLeft = 18;
        const availableHeight = Math.max(300, window.innerHeight - 80);
        const maxRows = Math.max(3, Math.floor(availableHeight / itemHeight));

        children.forEach((node, i) => {
            // Offset by 2 for the fixed My Computer and Recycle Bin icons in column 0
            const slotIndex = i + 2;
            const col = Math.floor(slotIndex / maxRows);
            const row = slotIndex % maxRows;

            const btn = document.createElement('button');
            btn.className = 'desktop-icon vfs-desktop-icon';
            btn.setAttribute('aria-label', node.name);
            btn.title = node.name;
            btn.style.left = `${startLeft + col * colWidth}px`;
            btn.style.top = `${startTop + row * itemHeight}px`;

            let iconGlyph = '📄';
            if (node.type === 'directory') iconGlyph = '📁';
            else if (node.type === 'shortcut') iconGlyph = '↗';
            else {
                const ext = (node.extension || '').toLowerCase();
                if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'].includes(ext)) iconGlyph = '🖼';
                else if (['mp3', 'wav', 'ogg', 'mp4'].includes(ext)) iconGlyph = '🎵';
            }

            btn.innerHTML = `
                <span class="icon-glyph" aria-hidden="true">${iconGlyph}</span>
                <span class="icon-label">${escapeHtml(node.name)}</span>
            `;

            btn.addEventListener('dblclick', () => {
                if (node.type === 'directory') {
                    if (typeof window.openExplorer === 'function') window.openExplorer(node.id);
                } else {
                    openNode(node);
                }
            });

            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(node.id, e.clientX, e.clientY);
            });

            desktopContainer.appendChild(btn);
        });
    }

    /* ── Event Wiring ───────────────────────────────────────── */

    if (tree) {
        tree.addEventListener('click', (e) => {
            const row = e.target.closest('.tree-row');
            if (!row) return;

            const id = row.dataset.id;
            if (e.target.closest('.twisty') && id) {
                state.expanded[id] = !state.expanded[id];
                renderTree();
                return;
            }

            if (id) navigate(id);
        });
    }

    if (fileRows) {
        fileRows.addEventListener('click', (e) => {
            const row = e.target.closest('tr[data-id]');
            if (!row) return;
            state.selected = row.dataset.id;
            fileRows.querySelectorAll('tr').forEach(r => {
                const isSel = r.dataset.id === state.selected;
                r.classList.toggle('is-selected', isSel);
                r.setAttribute('aria-selected', String(isSel));
            });
            updateStatus();
        });

        fileRows.addEventListener('dblclick', (e) => {
            const row = e.target.closest('tr[data-id]');
            if (!row) return;
            const id = row.dataset.id;
            if (id === '__recycle__') {
                navigate('__recycle__');
                return;
            }
            const vfs = getVfs();
            if (vfs) openNode(vfs.getNode(id));
        });

        fileRows.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const row = e.target.closest('tr[data-id]');
            const id = row ? row.dataset.id : null;
            if (id) state.selected = id;
            showContextMenu(id, e.clientX, e.clientY);
        });

        fileRows.addEventListener('mouseover', (e) => {
            const row = e.target.closest('tr[data-id]');
            state.hovered = row ? row.dataset.id : null;
            updateStatus();
        });

        fileRows.addEventListener('mouseleave', () => {
            state.hovered = null;
            updateStatus();
        });
    }

    if (tableWrap) {
        tableWrap.addEventListener('contextmenu', (e) => {
            if (e.target.closest('tr[data-id]')) return;
            e.preventDefault();
            showContextMenu(null, e.clientX, e.clientY);
        });
        tableWrap.addEventListener('click', (e) => {
            if (!e.target.closest('tr[data-id]') && !e.target.closest('th')) {
                state.selected = null;
                renderList();
            }
        });
    }

    if (contextMenu) {
        contextMenu.addEventListener('click', (e) => {
            const btn = e.target.closest('.menu-item');
            if (!btn || btn.disabled) return;
            const action = btn.dataset.action;
            handleFileAction(action, state.contextKey || state.selected);
        });
    }

    if (breadcrumbs) {
        breadcrumbs.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-id]');
            if (btn) navigate(btn.dataset.id);
        });
    }

    if (search) {
        search.addEventListener('input', () => {
            state.search = search.value;
            renderList();
        });
    }

    if (navBack) navBack.addEventListener('click', goBack);
    if (navForward) navForward.addEventListener('click', goForward);
    if (navUp) navUp.addEventListener('click', goUp);

    if (fileTable) {
        fileTable.querySelectorAll('th[data-sort] button').forEach(button => {
            button.addEventListener('click', () => {
                const key = button.dataset.sortKey;
                if (state.sortKey === key) {
                    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    state.sortKey = key;
                    state.sortDir = 'asc';
                }
                updateSortHeaders();
                renderList();
            });
        });
    }

    function updateSortHeaders() {
        if (!fileTable) return;
        fileTable.querySelectorAll('th[data-sort]').forEach(th => {
            const active = th.dataset.sort === state.sortKey;
            if (active) {
                th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
            } else {
                th.removeAttribute('aria-sort');
            }
            const arrow = th.querySelector('.sort-arrow');
            if (arrow) arrow.textContent = active && state.sortDir === 'desc' ? '▼' : '▲';
        });
    }

    if (viewToggle) {
        viewToggle.addEventListener('click', () => {
            state.layout = state.layout === 'details' ? 'list' : 'details';
            if (explorer) explorer.classList.toggle('is-list', state.layout === 'list');
            updateToolbar();
        });
    }

    /* ── Splitter Resizing ──────────────────────────────────── */

    function setTreeWidth(width) {
        const clamped = Math.max(160, Math.min(360, width));
        if (explorer) explorer.style.setProperty('--tree-width', `${clamped}px`);
        if (splitter) splitter.setAttribute('aria-valuenow', String(Math.round(clamped)));
    }

    if (splitter) {
        splitter.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            const startX = event.clientX;
            const startWidth = parseFloat(getComputedStyle(explorer).getPropertyValue('--tree-width')) || 220;

            document.body.classList.add('is-resizing');
            try { splitter.setPointerCapture(event.pointerId); } catch (_) {}

            const onMove = (moveEvent) => {
                setTreeWidth(startWidth + moveEvent.clientX - startX);
            };

            const onUp = () => {
                document.body.classList.remove('is-resizing');
                splitter.removeEventListener('pointermove', onMove);
                splitter.removeEventListener('pointerup', onUp);
                splitter.removeEventListener('pointercancel', onUp);
            };

            splitter.addEventListener('pointermove', onMove);
            splitter.addEventListener('pointerup', onUp);
            splitter.addEventListener('pointercancel', onUp);
        });
    }

    /* ── Keyboard shortcuts (central service) ──────────────── */

    function openSelectedNode() {
        if (!state.selected) return false;
        if (state.selected === '__recycle__') {
            navigate('__recycle__');
            return true;
        }
        const vfs = getVfs();
        if (vfs) openNode(vfs.getNode(state.selected));
        return true;
    }

    if (window.ShortcutService) {
        const shortcuts = window.ShortcutService;
        const register = (spec) => shortcuts.register(spec);

        register({
            id: 'explorer.dismiss',
            keys: 'Escape',
            context: 'explorer',
            priority: 70,
            description: 'Close Explorer menus/dialogs',
            handler: () => {
                hideContextMenu();
                closeDialog();
            }
        });

        register({
            id: 'explorer.rename',
            keys: 'F2',
            context: 'explorer',
            priority: 60,
            description: 'Rename selected item',
            handler: () => {
                if (!state.selected) return false;
                state.renamingId = state.selected;
                renderList();
            }
        });

        register({
            id: 'explorer.delete',
            keys: 'Delete',
            context: 'explorer',
            priority: 60,
            description: 'Delete selected item',
            handler: (event) => {
                if (!state.selected) return false;
                handleFileAction(event.shiftKey ? 'perm-delete' : 'delete', state.selected);
            }
        });

        register({
            id: 'explorer.copy',
            keys: 'Ctrl+C',
            context: 'explorer',
            priority: 60,
            description: 'Copy selected item',
            handler: () => {
                if (!state.selected) return false;
                handleFileAction('copy', state.selected);
            }
        });

        register({
            id: 'explorer.cut',
            keys: 'Ctrl+X',
            context: 'explorer',
            priority: 60,
            description: 'Cut selected item',
            handler: () => {
                if (!state.selected) return false;
                handleFileAction('cut', state.selected);
            }
        });

        register({
            id: 'explorer.paste',
            keys: 'Ctrl+V',
            context: 'explorer',
            priority: 60,
            description: 'Paste into current folder',
            handler: () => {
                handleFileAction('paste', null);
            }
        });

        register({
            id: 'explorer.back',
            keys: 'Alt+ArrowLeft',
            context: 'explorer',
            priority: 55,
            description: 'Explorer back',
            handler: () => {
                goBack();
            }
        });

        register({
            id: 'explorer.forward',
            keys: 'Alt+ArrowRight',
            context: 'explorer',
            priority: 55,
            description: 'Explorer forward',
            handler: () => {
                goForward();
            }
        });

        register({
            id: 'explorer.up',
            keys: 'Backspace',
            context: 'explorer',
            priority: 55,
            description: 'Explorer up one folder',
            handler: () => {
                goUp();
            }
        });

        register({
            id: 'explorer.properties',
            keys: 'Alt+Enter',
            context: 'explorer',
            priority: 55,
            description: 'Selected item properties',
            handler: () => {
                if (!state.selected) return false;
                handleFileAction('properties', state.selected);
            }
        });

        register({
            id: 'explorer.open',
            keys: 'Enter',
            context: 'explorer',
            priority: 55,
            description: 'Open selected item',
            handler: openSelectedNode
        });

        register({
            id: 'explorer.new-folder',
            keys: 'Ctrl+Alt+N',
            context: 'explorer',
            priority: 55,
            description: 'New folder in current location',
            handler: () => {
                if (!state.currentId || state.currentId === 'root' || state.currentId === '__recycle__') {
                    return false;
                }
                handleFileAction('new-folder', null);
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (contextMenu && !contextMenu.hidden && !contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });

    window.addEventListener('resize', () => {
        renderDesktopIcons();
    });

    /* ── Public API & Shell Integration ─────────────────────── */

    window.navigateExplorer = (target) => {
        const vfs = getVfs();
        if (target === 'my-computer' || target === 'root') {
            navigate('root');
        } else if (target === 'recycle-bin' || target === '__recycle__') {
            navigate('__recycle__');
        } else if (vfs && typeof target === 'string' && (target.includes('\\') || target.includes('/'))) {
            const resolved = vfs.resolvePath(target);
            if (resolved) navigate(resolved.id);
        } else if (target) {
            navigate(target);
        }
    };

    window.openVfsNode = openNode;
    window.renderDesktopIcons = renderDesktopIcons;

    window.linkExchangeApp = {
        navigate: (view) => {
            window.navigateExplorer(view);
        },
        openReadme: () => {
            const vfs = getVfs();
            if (!vfs) return;
            const desktopId = vfs.getKnownFolder('desktop');
            if (!desktopId) return;
            const readmeNode = vfs.getChildren(desktopId)
                .find(n => n.name.toLowerCase() === 'readme.txt');
            if (readmeNode) openNode(readmeNode);
        },
        openLink: (name) => {
            const vfs = getVfs();
            if (vfs) {
                const needle = String(name || '').toLowerCase();
                for (const node of vfs.nodes.values()) {
                    if (node.name.toLowerCase() === needle || node.name.replace(/\.[^.]+$/, '').toLowerCase() === needle) {
                        openNode(node);
                        return { ok: true, item: { name: node.name, target: vfs.getPath(node.id) } };
                    }
                }
            }
            return { ok: false };
        },
        getLinks: () => {
            const vfs = getVfs();
            if (!vfs) return [];
            const desktopId = vfs.getKnownFolder('desktop');
            if (!desktopId) return [];
            return vfs.getChildren(desktopId).map(n => ({
                name: n.name,
                filename: n.name,
                category: n.type === 'directory' ? 'folder' : 'file',
                target: vfs.getPath(n.id) || n.name,
                icon: n.type === 'directory' ? '📁' : '📄',
                pending: false
            }));
        },
        getFolders: () => {
            const vfs = getVfs();
            if (!vfs) return [];
            const folders = [];
            const kf = vfs.knownFolders || {};
            const user = vfs.username || 'r3d1';
            if (kf.desktop) folders.push({ name: 'Desktop', view: kf.desktop, target: 'C:\\Users\\' + user + '\\Desktop', note: 'Desktop files' });
            if (kf.documents) folders.push({ name: 'Documents', view: kf.documents, target: 'C:\\Users\\' + user + '\\Documents', note: 'User documents' });
            if (kf.downloads) folders.push({ name: 'Downloads', view: kf.downloads, target: 'C:\\Users\\' + user + '\\Downloads', note: 'Downloads folder' });
            return folders;
        },
        getView: () => state.currentId
    };

    /* ── Initialization ─────────────────────────────────────── */

    if (statusTarget) statusTarget.textContent = 'CONNECTING TO VFS…';

    window.VirtualFSReady.then(async (vfs) => {
        // Subscribe to real-time events
        vfs.subscribe((event) => {
            if (event.parentId === state.currentId ||
                event.nodeId === state.currentId ||
                event.oldParentId === state.currentId ||
                event.type === 'node-recycled' ||
                event.type === 'node-restored') {
                render();
            }
            renderDesktopIcons();
        });

        // Initial location: the profile's last Explorer folder, else Desktop.
        const lastFolder = (window.ProfileState && window.ProfileState.apps &&
            window.ProfileState.apps.lastExplorerFolder) || window.__profileExplorerStart || null;
        const restored = lastFolder ? vfs.getNode(lastFolder) : null;
        const desktopId = (restored && restored.id) ||
            vfs.getKnownFolder('desktop') ||
            (vfs.getChildren('root')[0] ? vfs.getChildren('root')[0].id : 'root');
        state.currentId = desktopId;
        state.history = [desktopId];
        state.historyIndex = 0;
        window.__explorerCurrentId = desktopId;

        // Populate a sample welcoming readme.txt on Desktop if fresh
        const readmeFolder = vfs.getKnownFolder('desktop') || desktopId;
        const existingReadme = vfs.getChildren(readmeFolder)
            .find(n => n.name.toLowerCase() === 'readme.txt');
        if (!existingReadme) {
            try {
                await vfs.createFile(readmeFolder, 'readme.txt', {
                    kind: 'text',
                    value: 'Welcome to the Windows Desktop Emulator!\n\nThis desktop environment is powered by an authoritative, centralized Virtual Filesystem (VFS) backed durably by IndexedDB.\n\nFeatures:\n- Full hierarchical path resolution\n- CRUD operations: create, rename, copy, move, delete\n- True Recycle Bin with restoration\n- Real-time synchronization across Desktop, Explorer, and Apps\n- Offline persistence surviving browser reloads\n\nEnjoy exploring!\n-- r3d1'
                });
            } catch (_) {}
        }

        updateSortHeaders();
        render();
        renderDesktopIcons();
        if (statusTarget) statusTarget.textContent = 'READY';
    }).catch(err => {
        console.error('Failed to initialize Explorer VFS integration:', err);
        if (statusTarget) statusTarget.textContent = 'VFS INIT ERROR';
    });

})(typeof window !== 'undefined' ? window : globalThis);
