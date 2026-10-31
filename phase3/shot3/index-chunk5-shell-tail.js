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
                if (item.icon && item.kind === 'link') {
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

    /* ── Live wallpaper ─────────────────────────────────────── */
    const wallpaperContext = wallpaperCanvas.getContext('2d');
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let wallpaperStars = [];
    let wallpaperWidth = 1;
    let wallpaperHeight = 1;
    let wallpaperFrame = 0;
    let wallpaperLast = 0;
    let wallpaperPaused = false;

    function makeStars() {
        const count = Math.max(70, Math.round((wallpaperWidth * wallpaperHeight) / 6500));
        wallpaperStars = Array.from({ length: count }, (_, index) => {
            const layer = index % 3;
            return {
                x: Math.random() * wallpaperWidth,
                y: Math.random() * wallpaperHeight,
                size: layer === 2 ? 2 : 1,
                speed: layer === 0 ? 1.2 : (layer === 1 ? 2.6 : 4.2),
                phase: Math.random() * Math.PI * 2,
                alpha: layer === 0 ? 0.3 : (layer === 1 ? 0.52 : 0.82)
            };
        });
    }

    function drawWallpaper(dt) {
        if (!wallpaperContext) return;
        wallpaperContext.clearRect(0, 0, wallpaperWidth, wallpaperHeight);
        const now = performance.now() / 1000;
        const animate = !wallpaperPaused && !motionQuery.matches;

        wallpaperStars.forEach((star) => {
            if (animate) {
                star.x -= star.speed * dt;
                if (star.x < -2) {
                    star.x = wallpaperWidth + 2;
                    star.y = Math.random() * wallpaperHeight;
                }
            }
            const twinkle = 0.65 + 0.35 * Math.sin(now * 0.7 + star.phase);
            const alpha = star.alpha * twinkle;
            wallpaperContext.fillStyle = `rgba(242, 234, 255, ${alpha.toFixed(3)})`;
            wallpaperContext.fillRect(Math.round(star.x), Math.round(star.y), star.size, star.size);
            if (star.size > 1) {
                wallpaperContext.fillStyle = `rgba(192, 132, 252, ${(alpha * 0.35).toFixed(3)})`;
                wallpaperContext.fillRect(Math.round(star.x) - 1, Math.round(star.y), 4, 1);
                wallpaperContext.fillRect(Math.round(star.x), Math.round(star.y) - 1, 1, 4);
            }
        });
    }

    function tick(now) {
        wallpaperFrame = 0;
        const dt = Math.min(0.05, Math.max(0, (now - wallpaperLast) / 1000));
        wallpaperLast = now;
        drawWallpaper(dt);
        if (!wallpaperPaused && !document.hidden && !motionQuery.matches) {
            wallpaperFrame = window.requestAnimationFrame(tick);
        }
    }

    function startWallpaper() {
        if (wallpaperFrame || wallpaperPaused || document.hidden || motionQuery.matches) return;
        wallpaperLast = performance.now();
        wallpaperFrame = window.requestAnimationFrame(tick);
    }

    function stopWallpaper() {
        if (wallpaperFrame) window.cancelAnimationFrame(wallpaperFrame);
        wallpaperFrame = 0;
        drawWallpaper(0);
    }

    function syncWallpaperMotion() {
        if (wallpaperPaused || document.hidden || motionQuery.matches) stopWallpaper();
        else startWallpaper();
    }

    function resizeWallpaper() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        wallpaperWidth = Math.max(1, desktop.clientWidth);
        wallpaperHeight = Math.max(1, desktop.clientHeight);
        wallpaperCanvas.width = Math.round(wallpaperWidth * dpr);
        wallpaperCanvas.height = Math.round(wallpaperHeight * dpr);
        wallpaperContext.setTransform(dpr, 0, 0, dpr, 0, 0);
        makeStars();
        drawWallpaper(0);
    }

    wallpaperToggle.addEventListener('click', () => {
        wallpaperPaused = !wallpaperPaused;
        wallpaperToggle.setAttribute('aria-pressed', String(wallpaperPaused));
        wallpaperToggle.textContent = wallpaperPaused ? '✧' : '✦';
        const label = wallpaperPaused ? 'Resume live wallpaper' : 'Pause live wallpaper';
        wallpaperToggle.title = label;
        wallpaperToggle.setAttribute('aria-label', label);
        if (wallpaperPaused) {
            stopWallpaper();
            toast('LIVE WALLPAPER PAUSED');
        } else {
            startWallpaper();
            toast('LIVE WALLPAPER RESUMED');
        }
    });

    document.addEventListener('visibilitychange', syncWallpaperMotion);
    if (typeof motionQuery.addEventListener === 'function') {
        motionQuery.addEventListener('change', syncWallpaperMotion);
    } else if (typeof motionQuery.addListener === 'function') {
        motionQuery.addListener(syncWallpaperMotion);
    }

    /* ── Clock and show desktop ─────────────────────────────── */
    function updateTaskbarClock() {
        const now = new Date();
        taskbarClock.textContent = now.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        taskbarClock.title = now.toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    function toggleShowDesktop() {
        if (showDesktopState) {
            const restore = showDesktopState;
            showDesktopState = null;
            showDesktopButton.setAttribute('aria-pressed', 'false');
            restore.forEach((id) => {
                const win = windows.get(id);
                if (win && !win.closed) {
                    win.minimized = false;
                    win.node.classList.remove('is-minimized');
                }
            });
            if (restore.length) focusWindow(restore[restore.length - 1], true);
            syncTaskbar();
            persistWindowState();
            return;
        }

        const visible = Array.from(windows.values()).filter((win) => !win.closed && !win.minimized);
        if (!visible.length) return;
        showDesktopState = visible.map((win) => win.id);
        showDesktopButton.setAttribute('aria-pressed', 'true');
        visible.forEach((win) => minimizeWindow(win.id));
        persistWindowState();
    }

    showDesktopButton.addEventListener('click', toggleShowDesktop);

    /* ── Assistant tray button wiring ──────────────────────── */
    if (clippyToggle) {
        clippyToggle.addEventListener('click', () => {
            if (clippyWanted) {
                hideClippy();
            } else {
                showClippy({ introduce: true });
            }
        });
    }

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

    /* ── Application registry ───────────────────────────────── */
    function registerApplications() {
        const registry = window.AppRegistry;
        if (!registry) {
            console.warn('[Shell] Application registry unavailable.');
            return;
        }

        registry.configure({
            windowManager: {
                focus(windowId, focusTarget) {
                    focusWindow(windowId, focusTarget !== false);
                    return true;
                },
                minimize(windowId) {
                    minimizeWindow(windowId);
                    return true;
                },
                restore(windowId) {
                    restoreWindow(windowId);
                    return true;
                },
                close(windowId) {
                    closeWindow(windowId);
                    return true;
                },
                exists(windowId) {
                    const win = windows.get(windowId);
                    return Boolean(win && !win.closed);
                }
            }
        });

        registry.register({
            id: 'explorer',
            name: 'Explorer',
            tagline: 'Browse the active profile virtual filesystem.',
            meta: 'FILES \u00B7 VFS',
            icon: '\u25A3',
            source: 'IN-HOUSE',
            kind: 'system',
            launch(context, options) {
                return openExplorer(options);
            }
        });

        registry.register({
            id: 'programs',
            name: 'Programs',
            tagline: 'The installed application shelf.',
            meta: 'LAUNCHER \u00B7 IN-HOUSE',
            icon: '\u25A6',
            source: 'IN-HOUSE',
            kind: 'system',
            hidden: true,
            launch(context, options) {
                return openPrograms(options);
            }
        });

        registry.register({
            id: 'music',
            name: 'Music',
            tagline: 'Play the local playlist.',
            meta: 'AUDIO \u00B7 LOCAL',
            icon: '\u266A',
            source: 'IN-HOUSE',
            kind: 'system',
            launch(context, options) {
                return openMusic(options);
            }
        });

        registry.register({
            id: 'terminal',
            name: 'Terminal',
            tagline: 'Open a new r3sh terminal window.',
            meta: 'TTY \u00B7 R3SH',
            icon: '>_',
            source: 'IN-HOUSE',
            kind: 'system',
            multiple: true,
            launch(context, options) {
                return openTerminal(options);
            }
        });

        registry.register({
            id: 'cmd',
            name: 'Command Prompt',
            tagline: 'Windows Command Interpreter (cmd.exe)',
            meta: 'CLI \u00B7 MS-DOS / WIN32',
            icon: '>_',
            source: 'IN-HOUSE',
            kind: 'system',
            multiple: true,
            launch(context, options) {
                return openTerminal(Object.assign({ dialect: 'cmd', title: 'Command Prompt' }, options));
            }
        });

        registry.register({
            id: 'powershell',
            name: 'PowerShell',
            tagline: 'Windows PowerShell Command Automation',
            meta: 'CLI \u00B7 OBJECT PIPELINES',
            icon: '>_',
            source: 'IN-HOUSE',
            kind: 'system',
            multiple: true,
            launch(context, options) {
                return openTerminal(Object.assign({ dialect: 'powershell', title: 'Windows PowerShell' }, options));
            }
        });

        registry.register({
            id: 'bash',
            name: 'Bash',
            tagline: 'POSIX Bourne-Again SHell',
            meta: 'CLI \u00B7 POSIX PIPES & REDIRECTION',
            icon: '>_',
            source: 'IN-HOUSE',
            kind: 'system',
            multiple: true,
            launch(context, options) {
                return openTerminal(Object.assign({ dialect: 'bash', title: 'Bash' }, options));
            }
        });

        const programs = window.RetroApps ? window.RetroApps.list() : [];
        programs.forEach((program) => {
            const definition = window.RetroApps.get(program.id);
            if (!definition) return;
            registry.register({
                id: definition.id,
                name: definition.name,
                tagline: definition.tagline,
                meta: definition.meta,
                icon: definition.icon,
                source: definition.source || 'IN-HOUSE',
                frame: Boolean(definition.frame),
                kind: 'program',
                fileTypes: PROGRAM_FILE_TYPES[definition.id] || [],
                launch(context, options) {
                    return openProgram(definition.id, options);
                }
            });
        });
    }

    registerApplications();

    /* ── Boot the shell ─────────────────────────────────────── */
    if (window.ShellWM && typeof window.ShellWM.init === 'function') {
        window.ShellWM.init({
            desktop,
            taskbar,
            windows,
            setBounds,
            focusWindow,
            minimizeWindow,
            restoreWindow,
            closeWindow,
            toggleMaximize,
            focusTopWindow,
            cycleWindow,
            persist: persistWindowState,
            toast,
            getActiveId: () => activeWindowId,
            savedState: window.ProfileState && window.ProfileState.windowManager,
            clearActive: () => {
                activeWindowId = null;
                setActiveWindowMarker('none');
                if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.window')) {
                    document.activeElement.blur();
                }
                windows.forEach((win) => {
                    win.node.classList.remove('is-active');
                    win.node.classList.add('is-inactive');
                });
                syncTaskbar();
            }
        });
    }

    /* Desktop environment host bridge: the revamped taskbar, Start menu and
       system tray live in desktop-environment.js and consume the shell's
       existing live window map instead of maintaining a parallel copy. */
    window.DesktopShellHost = {
        version: '20261023',
        windows,
        get activeWindowId() { return activeWindowId; },
        registry: window.AppRegistry,
        wm: window.ShellWM,
        focusWindow,
        minimizeWindow,
        restoreWindow,
        closeWindow,
        toggleMaximize,
        openExplorer,
        openTerminal,
        openMusic,
        openPrograms,
        openProgram,
        openSearch,
        closeSearch,
        toast,
        persist: persistWindowState,
        getProfile() {
            return window.ProfileService && window.ProfileService.getActiveProfile
                ? window.ProfileService.getActiveProfile()
                : null;
        },
        getSavedState() {
            return window.ProfileState || null;
        },
        saveShellState(shell) {
            const profile = window.ProfileService && window.ProfileService.getActiveProfile
                ? window.ProfileService.getActiveProfile()
                : null;
            if (!profile || !window.PersistenceService ||
                typeof window.PersistenceService.queueSave !== 'function') {
                return Promise.resolve(false);
            }
            return window.PersistenceService.queueSave(profile.id, { shell: shell })
                .catch(function () { return false; });
        },
        isMusicPlaying() {
            return Boolean(musicAudio && !musicAudio.paused && !musicAudio.ended);
        },
        pauseMusic() {
            if (typeof pauseMusic === 'function') pauseMusic();
        },
        setMasterVolume(percent, muted) {
            const value = Math.max(0, Math.min(100, Number(percent)));
            if (musicVolume) {
                musicVolume.value = String(Math.round(value));
                musicVolumeValue.textContent = Math.round(value) + '%';
            }
            if (musicAudio) {
                musicAudio.volume = Math.max(0, Math.min(1, value / 100));
                musicAudio.muted = Boolean(muted);
            }
            document.dispatchEvent(new CustomEvent('sim:sound-changed', {
                detail: { volume: Math.round(value), muted: Boolean(muted) }
            }));
            return true;
        },
        forceEndTask(windowId) {
            const win = windows.get(windowId);
            if (!win || win.closed) return false;
            if (win.appId === 'music' && typeof pauseMusic === 'function') pauseMusic();
            if (typeof win.onClose === 'function') {
                try { win.onClose(); } catch (error) { console.warn('End task cleanup failed:', error); }
                win.onClose = null;
            }
            closeWindow(windowId);
            // Explicitly detach in case a launch path never attached a window.
            if (window.AppRegistry) window.AppRegistry.detachWindow(windowId, 'end-task');
            return true;
        }
    };
    document.dispatchEvent(new CustomEvent('desktop:host-ready'));

    const programsWin = registerWindow(programsNode, {
        id: 'programs',
        appId: 'programs',
        title: 'Programs',
        taskbarTitle: 'Programs',
        icon: '\u25A6',
        minWidth: 460,
        minHeight: 320,
        bounds: nextProgramBounds('programs', 0),
        focusTarget: '#programs-grid button',
        startClosed: true
    });
    renderProgramTiles();

    const explorerWin = registerWindow(explorerNode, {
        id: 'explorer',
        appId: 'explorer',
        title: 'Link Exchange',
        taskbarTitle: 'Link Exchange',
        icon: '▣',
        minWidth: 640,
        minHeight: 340,
        bounds: defaultExplorerBounds()
    });

    const musicWin = registerWindow(musicNode, {
        id: 'music',
        appId: 'music',
        title: 'Music',
        taskbarTitle: 'Music',
        icon: '♪',
        minWidth: 360,
        minHeight: 320,
        bounds: nextMusicBounds(),
        focusTarget: '#music-play',
        startClosed: true
    });
    initMusic(musicWin);

    if (windowState && windowState.hasSavedState()) {
        const saved = windowState.savedWindows();
        Array.from(windows.values()).forEach((win) => {
            if (!win.closed) closeWindow(win.id);
        });
        restorePersistedWindows(saved);
        focusTopWindow();
    } else {
        const firstTerminal = openTerminal();
        minimizeWindow(firstTerminal.id);
        focusWindow('explorer', true);
    }

    restoringWindows = false;
    if (windowState) {
        windowState.setRestoring(false);
        windowState.schedule();
    }
    if (window.ShellWM) window.ShellWM.applyWorkspaceVisibility();

    updateTaskbarClock();
    window.setInterval(updateTaskbarClock, 1000);
    resizeWallpaper();
    syncWallpaperMotion();

    if (preferredClippyVisibility()) {
        showClippy();
    }

    window.addEventListener('resize', () => {
        if (window.ShellWM && window.ShellWM.ready) {
            window.ShellWM.onDesktopResize();
        } else {
            windows.forEach((win) => {
                if (!win.closed) fitWindowToDesktop(win);
            });
        }
        persistWindowState();
        resizeWallpaper();
        syncWallpaperMotion();
    });

    if (window.ProfileState && window.ProfileState.desktop &&
        window.ProfileState.desktop.wallpaperPaused) {
        wallpaperPaused = true;
        if (wallpaperToggle) wallpaperToggle.setAttribute('aria-pressed', 'true');
    }

    function activeTerminalSession() {
        const focused = document.activeElement;
        const node = focused && focused.closest ? focused.closest('.window') : null;
        if (node && terminalSessions.has(node.id)) return terminalSessions.get(node.id);
        if (activeWindowId && terminalSessions.has(activeWindowId)) {
            return terminalSessions.get(activeWindowId);
        }
        return null;
    }

    function cycleWindow(direction) {
        const ordered = Array.from(windows.values()).filter((win) => !win.closed);
        if (!ordered.length) return false;
        ordered.sort((a, b) => Number(a.node.style.zIndex || 0) - Number(b.node.style.zIndex || 0));

        let index = ordered.findIndex((win) => win.id === activeWindowId);
        if (index === -1) index = direction > 0 ? -1 : 0;
        const target = ordered[(index + direction + ordered.length) % ordered.length];
        if (!target) return false;
        if (target.minimized) restoreWindow(target.id);
        focusWindow(target.id, true);
        return true;
    }

    function registerShellShortcuts() {
        if (shellShortcutsRegistered || !window.ShortcutService) return;
        shellShortcutsRegistered = true;

        const shortcuts = window.ShortcutService;
        const register = (spec) => shortcuts.register(spec);

        register({
            id: 'shell.start',
            keys: 'Ctrl+Escape',
            context: 'global',
            priority: 80,
            allowInEditable: true,
            description: 'Toggle Start search',
            handler: () => {
                if (startMenu.hidden) openSearch();
                else closeSearch(true);
            }
        });

        register({
            id: 'start.previous',
            keys: 'ArrowUp',
            context: 'start',
            priority: 90,
            allowInEditable: true,
            repeat: true,
            description: 'Previous Start result',
            handler: () => {
                setActiveSearchIndex(searchActiveIndex - 1);
            }
        });

        register({
            id: 'start.next',
            keys: 'ArrowDown',
            context: 'start',
            priority: 90,
            allowInEditable: true,
            repeat: true,
            description: 'Next Start result',
            handler: () => {
                setActiveSearchIndex(searchActiveIndex + 1);
            }
        });

        register({
            id: 'start.launch',
            keys: 'Enter',
            context: 'start',
            priority: 95,
            allowInEditable: true,
            description: 'Launch active Start result',
            handler: () => {
                if (searchActiveIndex >= 0) launchSearchItem(searchItems[searchActiveIndex]);
            }
        });

        register({
            id: 'start.close',
            keys: 'Escape',
            context: 'start',
            priority: 95,
            allowInEditable: true,
            description: 'Close Start search',
            handler: () => {
                closeSearch(true);
            }
        });

        register({
            id: 'shell.show-desktop',
            keys: 'Ctrl+Alt+D',
            context: 'unlocked',
            priority: 70,
            allowInEditable: true,
            description: 'Show or restore the desktop',
            handler: () => {
                toggleShowDesktop();
            }
        });

        register({
            id: 'terminal.history-previous',
            keys: 'ArrowUp',
            context: 'terminal',
            priority: 80,
            allowInEditable: true,
            repeat: true,
            description: 'Previous terminal command',
            handler: () => {
                const session = activeTerminalSession();
                if (!session || document.activeElement !== session.input) return false;
                const term = session.term;
                if (!term.history.length) return true;
                term.historyIndex = Math.max(0, term.historyIndex - 1);
                session.input.value = term.history[term.historyIndex] || '';
                return true;
            }
        });

        register({
            id: 'terminal.history-next',
            keys: 'ArrowDown',
            context: 'terminal',
            priority: 80,
            allowInEditable: true,
            repeat: true,
            description: 'Next terminal command',
            handler: () => {
                const session = activeTerminalSession();
                if (!session || document.activeElement !== session.input) return false;
                const term = session.term;
                if (!term.history.length) return true;
                if (term.historyIndex >= term.history.length - 1) {
                    term.historyIndex = term.history.length;
                    session.input.value = '';
                } else {
                    term.historyIndex += 1;
                    session.input.value = term.history[term.historyIndex] || '';
                }
                return true;
            }
        });

        register({
            id: 'terminal.clear',
            keys: 'Ctrl+L',
            context: 'terminal',
            priority: 80,
            allowInEditable: true,
            description: 'Clear terminal output',
            handler: () => {
                const session = activeTerminalSession();
                if (!session || document.activeElement !== session.input) return false;
                session.output.textContent = '';
                return true;
            }
        });
    }

    registerShellShortcuts();
}).catch(function (error) {
    console.error('[Shell] Boot failed', error);
});
</script>
<script src="./desktop-environment.js" defer></script>
<script src="./custom-cursor.js" defer></script>
<!-- Debug overlay: active only when URL contains ?debug=1 - no-op otherwise -->
<script src="./debug-overlay.js?v=20261031" defer></script>
</body>
</html>
