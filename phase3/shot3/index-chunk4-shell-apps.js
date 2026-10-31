        });

        const body = node.querySelector('.program-app-body');
        const meta = node.querySelector('.program-meta');
        let cleanup = null;
        const appContext = window.AppRegistry
            ? window.AppRegistry.context()
            : { profile: null, profileId: null, vfs: window.VFS || null };

        const api = {
            app: def,
            profile: appContext.profile,
            profileId: appContext.profileId,
            vfs: appContext.vfs,
            registry: window.AppRegistry || null,
            instanceId: winId,
            initialNode: options.node || null,
            setMeta(value) {
                const text = String(value == null ? '' : value).trim();
                meta.textContent = text || def.meta || '';
            },
            close() {
                closeWindow(win.id);
            }
        };

        try {
            const mounted = def.mount(body, api);
            if (typeof mounted === 'function') cleanup = mounted;
        } catch (error) {
            console.error(`${def.name} failed to start:`, error);
            body.replaceChildren();
            const note = document.createElement('p');
            note.className = 'program-error';
            note.textContent = `${def.name} could not start in this browser. Try reloading, or use a current browser with canvas support.`;
            body.appendChild(note);
            toast(`${def.name.toUpperCase()} FAILED TO START`, 3200);
        }

        if (typeof cleanup === 'function') win.onClose = cleanup;
        if (window.AppRegistry) window.AppRegistry.attachWindow(def.id, win, { windowId: winId });
        if (options.focus !== false) focusWindow(win.id, true);
        persistWindowState();
        return win;
    }
    window.openProgram = openProgram;

    if (programsButton) {
        programsButton.addEventListener('click', () => {
            openPrograms();
        });
    }

    /* ── Music ──────────────────────────────────────────────── */
    const MUSIC_VOLUME_KEY = 'desktopShellMusicVolume';
    const MUSIC_FALLBACK_TRACKS = [
        '6._Basshunter_-_In_Her_Eyes-pREJQbSl33Y.opus',
        'Crystal Castles - Suffocation [Z0NGdLr4img].opus',
        'Pretty_Scene_Girl-P8F1RjcWLjM.opus',
        "The Cure - Friday I'm In Love [mGgMZpGYiy8].opus"
    ];

    function musicTrackName(filename) {
        let base = String(filename || 'Unknown Track');
        try {
            base = decodeURIComponent(base);
        } catch (_) {
            /* keep the raw name */
        }
        base = base.split('?')[0].split('#')[0].split(/[\\/]/).pop();
        return base
            .replace(/\.(opus|ogg|mp3|wav|m4a)$/i, '')
            .replace(/\s*\[[A-Za-z0-9_-]{11}\]\s*$/, '')
            .replace(/-[A-Za-z0-9_-]{11}\s*$/, '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || 'Unknown Track';
    }

    function musicTrackUrl(filename) {
        try {
            return new URL(`playlist/${encodeURIComponent(filename)}`, document.baseURI).href;
        } catch (_) {
            return `playlist/${encodeURIComponent(filename)}`;
        }
    }

    function normalizeMusicFiles(list) {
        const seen = new Set();
        const files = [];
        (Array.isArray(list) ? list : []).forEach((item) => {
            if (!item) return;
            const value = typeof item === 'string'
                ? item
                : (item.file || item.name || item.filename || '');
            const clean = String(value).split('?')[0].split('#')[0];
            const filename = clean.split('/').pop();
            if (!filename || !/\.(opus|ogg|mp3|wav|m4a)$/i.test(filename) || seen.has(filename)) return;
            seen.add(filename);
            files.push(filename);
        });
        return files;
    }

    function formatMusicTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
        const total = Math.floor(seconds);
        return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    }

    function musicStatusText() {
        if (musicError) return 'UNAVAILABLE';
        if (!musicTracks.length) return 'NO TRACKS';
        if (musicBlocked) return 'CLICK PLAY';
        if (musicLoading) return 'LOADING';
        if (musicPlaying) return 'PLAYING';
        if (musicAudio && Number.isFinite(musicAudio.currentTime) && musicAudio.currentTime > 0.1) return 'PAUSED';
        return 'READY';
    }

    function renderMusicList() {
        musicList.textContent = '';
        musicTracks.forEach((track, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'music-track';
            button.dataset.index = String(index);
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', 'false');
            button.title = track.name;

            const number = document.createElement('span');
            number.className = 'music-track-index';
            number.textContent = String(index + 1).padStart(2, '0');

            const name = document.createElement('span');
            name.className = 'music-track-name';
            name.textContent = track.name;

            const state = document.createElement('span');
            state.className = 'music-track-state';

            button.append(number, name, state);
            button.addEventListener('click', () => selectMusicTrack(index));
            musicList.appendChild(button);
        });
    }

    function updateMusicProgress() {
        if (!musicAudio) {
            musicTime.textContent = '0:00';
            musicDuration.textContent = '--:--';
            musicProgress.value = '0';
            musicProgress.disabled = true;
            return;
        }
        const duration = Number.isFinite(musicAudio.duration) ? musicAudio.duration : 0;
        const current = Number.isFinite(musicAudio.currentTime) ? musicAudio.currentTime : 0;
        if (!musicSeeking) {
            musicProgress.value = String(Math.round((duration > 0 ? clamp(current / duration, 0, 1) : 0) * 1000));
        }
        musicTime.textContent = formatMusicTime(current);
        musicDuration.textContent = duration > 0 ? formatMusicTime(duration) : '--:--';
        musicProgress.disabled = !musicTracks.length || duration <= 0;
    }

    function updateMusicUI() {
        const track = musicTracks[musicIndex] || null;
        const hasTracks = musicTracks.length > 0;
        const status = musicDiscovering ? 'SCANNING' : musicStatusText();
        musicTrackTitle.textContent = track
            ? track.name
            : (musicDiscovering ? 'LOADING PLAYLIST…' : 'PLAYLIST EMPTY');
        musicTrackTitle.title = track ? track.name : '';
        musicStatus.textContent = status;
        musicNode.classList.toggle('is-playing', musicPlaying);
        musicNode.classList.toggle('is-error', musicError);
        taskbarMusic.classList.toggle('is-playing', musicPlaying);

        const miniLabel = musicDiscovering || musicLoading
            ? 'LOADING…'
            : (musicError ? 'UNAVAILABLE' : (track ? track.name : 'NO TRACKS'));
        miniTrack.textContent = miniLabel;
        miniTrack.title = miniLabel;

        const playIcon = musicPlaying ? '❚❚' : '▶';
        const playLabel = musicPlaying ? 'Pause' : 'Play';
        musicPlay.textContent = playIcon;
        musicPlay.title = playLabel;
        musicPlay.setAttribute('aria-label', playLabel);
        musicPlay.disabled = !hasTracks;
        miniPlay.textContent = playIcon;
        miniPlay.title = playLabel;
        miniPlay.setAttribute('aria-label', playLabel);
        miniPlay.disabled = !hasTracks;
        musicPrev.disabled = !hasTracks;
        musicNext.disabled = musicTracks.length < 2;
        miniNext.disabled = musicTracks.length < 2;

        musicCount.textContent = `${musicTracks.length} TRACK${musicTracks.length === 1 ? '' : 'S'}`;
        musicSource.textContent = musicSourceLabel;

        const openLabel = track ? `Open Music — ${track.name}` : 'Open Music';
        miniOpen.title = openLabel;
        miniOpen.setAttribute('aria-label', openLabel);

        musicList.querySelectorAll('.music-track').forEach((button) => {
            const index = Number(button.dataset.index);
            const active = index === musicIndex;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', String(active));
            const state = button.querySelector('.music-track-state');
            if (!state) return;
            if (!active) {
                state.textContent = '';
                return;
            }
            state.textContent = musicError
                ? 'ERROR'
                : musicLoading
                    ? 'LOADING'
                    : musicPlaying
                        ? 'PLAYING'
                        : (musicAudio && musicAudio.currentTime > 0.1 ? 'PAUSED' : 'READY');
        });

        updateMusicProgress();
    }

    async function loadMusicTrack(index, autoplay) {
        if (!musicAudio || !musicTracks.length) return;
        const token = ++musicLoadToken;
        musicIndex = ((index % musicTracks.length) + musicTracks.length) % musicTracks.length;
        musicLoading = true;
        musicPendingPlay = Boolean(autoplay);
        musicBlocked = false;
        musicError = false;
        musicPlaying = false;
        musicSourceReady = false;
        musicSeeking = false;
        musicAudio.pause();
        const track = musicTracks[musicIndex];
        updateMusicUI();

        let blobUrl = track.blobUrl;
        if (!blobUrl) {
            try {
                const response = await fetch(track.url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const blob = await response.blob();
                blobUrl = URL.createObjectURL(blob);
                track.blobUrl = blobUrl;
            } catch (_) {
                if (token !== musicLoadToken) return;
                musicLoading = false;
                musicPendingPlay = false;
                musicError = true;
                updateMusicUI();
                return;
            }
        }

        if (token !== musicLoadToken) return;
        musicAudio.src = blobUrl;
        musicAudio.load();
        musicLoading = false;
        musicSourceReady = true;
        updateMusicUI();
        if (musicPendingPlay) {
            musicPendingPlay = false;
            playMusic();
        }
    }

    function playMusic() {
        if (!musicAudio || !musicTracks.length) return;
        if (musicLoading && !musicSourceReady) {
            musicPendingPlay = true;
            updateMusicUI();
            return;
        }
        if (!musicSourceReady) {
            loadMusicTrack(musicIndex, true);
            return;
        }
        musicPendingPlay = false;
        musicError = false;
        musicBlocked = false;
        try {
            const request = musicAudio.play();
            if (request && typeof request.then === 'function') {
                request.then(() => {
                    musicPlaying = true;
                    musicLoading = false;
                    updateMusicUI();
                }).catch(() => {
                    musicPlaying = false;
                    musicLoading = false;
                    musicBlocked = true;
                    updateMusicUI();
                });
            } else {
                musicPlaying = true;
                musicLoading = false;
                updateMusicUI();
            }
        } catch (_) {
            musicPlaying = false;
            musicLoading = false;
            musicBlocked = true;
            updateMusicUI();
        }
    }

    function pauseMusic() {
        if (!musicAudio) return;
        musicPendingPlay = false;
        musicAudio.pause();
        musicPlaying = false;
        musicBlocked = false;
        if (musicSourceReady) musicLoading = false;
        updateMusicUI();
    }

    function toggleMusic() {
        if (musicPlaying) {
            pauseMusic();
            return;
        }
        if (musicPendingPlay) {
            musicPendingPlay = false;
            updateMusicUI();
            return;
        }
        playMusic();
    }

    function nextMusic(forcePlay) {
        if (!musicTracks.length) return;
        const shouldPlay = typeof forcePlay === 'boolean' ? forcePlay : (musicPlaying || musicPendingPlay);
        if (musicTracks.length < 2) {
            if (shouldPlay) playMusic();
            return;
        }
        loadMusicTrack(musicIndex + 1, shouldPlay);
    }

    function previousMusic() {
        if (!musicTracks.length) return;
        if (musicTracks.length < 2) return;
        loadMusicTrack(musicIndex - 1, musicPlaying || musicPendingPlay);
    }

    function selectMusicTrack(index) {
        if (!musicTracks.length) return;
        loadMusicTrack(index, musicPlaying || musicPendingPlay);
    }

    async function discoverMusic() {
        musicDiscovering = true;
        updateMusicUI();
        let files = [];
        let source = 'playlist/playlist.json';
        try {
            const response = await fetch(new URL('playlist/playlist.json', document.baseURI).href, {
                headers: { Accept: 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                files = normalizeMusicFiles(
                    Array.isArray(data) ? data : ((data && (data.tracks || data.files)) || [])
                );
            }
        } catch (_) {
            /* fall through to the baked-in real files */
        }
        if (!files.length) {
            files = MUSIC_FALLBACK_TRACKS.slice();
            source = 'playlist/ · local files';
        }
        musicSourceLabel = source;
        musicTracks = files.map((filename) => ({
            name: musicTrackName(filename),
            filename,
            url: musicTrackUrl(filename)
        }));
        musicDiscovering = false;
        renderMusicList();
        if (!musicTracks.length) {
            musicIndex = -1;
            updateMusicUI();
            return;
        }
        loadMusicTrack(0, false);
    }

    function musicNowSummary() {
        const track = musicTracks[musicIndex];
        if (!track) return 'no tracks available';
        const duration = musicAudio && Number.isFinite(musicAudio.duration) && musicAudio.duration > 0
            ? ` · ${formatMusicTime(musicAudio.duration)}`
            : '';
        return `${track.name} · ${musicStatusText().toLowerCase()}${duration}`;
    }

    function initMusic(win) {
        musicAudio = new Audio();
        musicAudio.preload = 'metadata';
        musicAudio.loop = false;
        try {
            const raw = localStorage.getItem(MUSIC_VOLUME_KEY);
            if (raw !== null) {
                const value = Number(raw);
                if (Number.isFinite(value)) musicVolumeLevel = clamp(value, 0, 1);
            }
        } catch (_) {
            /* storage can be disabled */
        }
        musicAudio.volume = musicVolumeLevel;
        musicVolume.value = String(Math.round(musicVolumeLevel * 100));
        musicVolumeValue.textContent = `${Math.round(musicVolumeLevel * 100)}%`;

        musicAudio.addEventListener('loadedmetadata', () => {
            musicLoading = false;
            updateMusicUI();
        });
        musicAudio.addEventListener('durationchange', updateMusicProgress);
        musicAudio.addEventListener('timeupdate', updateMusicProgress);
        musicAudio.addEventListener('ended', () => nextMusic(true));
        musicAudio.addEventListener('error', () => {
            musicPlaying = false;
            musicLoading = false;
            musicPendingPlay = false;
            musicSourceReady = false;
            musicError = true;
            updateMusicUI();
        });
        musicAudio.addEventListener('play', () => {
            musicPlaying = true;
            musicBlocked = false;
            updateMusicUI();
        });
        musicAudio.addEventListener('pause', () => {
            if (musicLoading || !musicAudio || musicAudio.ended) return;
            musicPlaying = false;
            updateMusicUI();
        });

        musicPlay.addEventListener('click', toggleMusic);
        musicPrev.addEventListener('click', previousMusic);
        musicNext.addEventListener('click', () => nextMusic());
        miniOpen.addEventListener('click', openMusic);
        miniPlay.addEventListener('click', toggleMusic);
        miniNext.addEventListener('click', () => nextMusic());

        musicProgress.addEventListener('input', () => {
            if (!musicAudio) return;
            musicSeeking = true;
            const duration = Number.isFinite(musicAudio.duration) ? musicAudio.duration : 0;
            if (duration > 0) {
                musicAudio.currentTime = (Number(musicProgress.value) / 1000) * duration;
                musicTime.textContent = formatMusicTime(musicAudio.currentTime);
            }
        });
        const endSeek = () => {
            musicSeeking = false;
            updateMusicProgress();
        };
        musicProgress.addEventListener('change', endSeek);
        musicProgress.addEventListener('pointerup', endSeek);

        musicVolume.addEventListener('input', () => {
            musicVolumeLevel = clamp(Number(musicVolume.value) / 100, 0, 1);
            if (musicAudio) musicAudio.volume = musicVolumeLevel;
            musicVolumeValue.textContent = `${Math.round(musicVolumeLevel * 100)}%`;
            try {
                localStorage.setItem(MUSIC_VOLUME_KEY, String(musicVolumeLevel));
            } catch (_) {
                /* storage can be disabled */
            }
        });

        renderMusicList();
        updateMusicUI();
        discoverMusic();
    }

    /* ── Terminal ───────────────────────────────────────────── */
    function formatUptime(ms) {
        const total = Math.max(0, Math.floor(ms / 1000));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;
        if (hours) return `${hours}h ${minutes}m`;
        if (minutes) return `${minutes}m ${seconds}s`;
        return `${seconds}s`;
    }

    function initTerminal(win, options) {
        options = options || {};
        const dialect = options.dialect || 'bash';
        const node = win.node;
        const output = node.querySelector('.terminal-output');
        const form = node.querySelector('.terminal-form');
        const input = node.querySelector('.terminal-input');
        const promptElement = node.querySelector('.terminal-prompt');

        // Check if dialect session app is available
        let session = null;
        if (dialect === 'cmd' && window.CmdShellApp) {
            session = window.CmdShellApp.createSession({ cwd: 'C:\\Users\\user' });
        } else if (dialect === 'powershell' && window.PowerShellApp) {
            session = window.PowerShellApp.createSession({ cwd: 'C:\\Users\\user' });
        } else if (dialect === 'bash' && window.BashApp) {
            session = window.BashApp.createSession({ cwd: '/home/user' });
        }

        const term = {
            cwd: session ? session.cwd : '~',
            cwdId: (window.VFS ? window.VFS.getKnownFolder('userProfile') : null),
            history: [],
            historyIndex: 0,
            dialect: dialect,
            session: session
        };

        terminalSessions.set(win.id, { term, input, output, node });
        win.onClose = function() {
            terminalSessions.delete(win.id);
        };

        const vfsReady = () => window.VFS;
        const categories = ['all', 'social', 'dev', 'play', 'unavailable'];

        function promptText() {
            if (term.session) {
                return term.session.prompt;
            }
            const vfs = vfsReady();
            let display = term.cwd;
            if (vfs && term.cwdId) {
                const userProfileId = vfs.getKnownFolder('userProfile');
                if (term.cwdId === userProfileId) {
                    display = '~';
                } else {
                    const path = vfs.getPath(term.cwdId);
                    const userPath = vfs.getPath(userProfileId);
                    if (path && userPath && path.startsWith(userPath + '\\')) {
                        display = '~/' + path.slice(userPath.length + 1).replace(/\\/g, '/');
                    } else if (path) {
                        display = path.replace(/\\/g, '/');
                    }
                }
            }
            return `r3d1bruh@desktop:${display}$`;
        }

        function updatePrompt() {
            promptElement.textContent = promptText();
        }

        function line(text, className = '') {
            const row = document.createElement('div');
            row.className = `terminal-line${className ? ` ${className}` : ''}`;
            row.textContent = text;
            output.appendChild(row);
            output.scrollTop = output.scrollHeight;
        }

        function printCommand(prompt, command) {
            const row = document.createElement('div');
            row.className = 'terminal-line command';
            const prefix = document.createElement('span');
            prefix.className = 'prompt';
            prefix.textContent = prompt;
            row.appendChild(prefix);
            row.appendChild(document.createTextNode(` ${command}`));
            output.appendChild(row);
            output.scrollTop = output.scrollHeight;
        }

        function tokenize(value) {
            const tokens = [];
            const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
            let match;
            while ((match = pattern.exec(value)) !== null) {
                tokens.push(match[1] !== undefined ? match[1] : (match[2] !== undefined ? match[2] : match[3]));
            }
            return tokens;
        }

        function currentPath() {
            const vfs = vfsReady();
            if (vfs && term.cwdId) {
                return vfs.getPath(term.cwdId) || 'C:\\';
            }
            const home = (vfs && vfs.username) || 'r3d1'; return term.cwd === '~' ? 'C:\\Users\\' + home : 'C:\\Users\\' + home + '\\' + term.cwd;
        }

        function findFolder(value) {
            const name = String(value || '').toLowerCase();
            if (!name || name === '~' || name === '/' || name === 'home') return '~';
            const vfs = vfsReady();
            if (vfs) {
                const knownMap = {
                    'desktop': 'desktop', 'documents': 'documents', 'downloads': 'downloads',
                    'pictures': 'pictures', 'music': 'music', 'videos': 'videos',
                    'appdata': 'appData', 'program files': 'programFiles',
                    'programdata': 'programData', 'windows': 'windows'
                };
                if (knownMap[name]) {
                    const id = vfs.getKnownFolder(knownMap[name]);
                    if (id) return id;
                }
                const node = vfs.resolvePath(value) || vfs.resolvePath('C:\\Users\\' + (vfs.username || 'r3d1') + '\\' + value);
                if (node && node.type === 'directory') return node.id;
                if (term.cwdId) {
                    const children = vfs.getChildren(term.cwdId);
                    const child = children.find(c => c.name.toLowerCase() === name && c.type === 'directory');
                    if (child) return child.id;
                }
            }
            return null;
        }

        function linksForView(view) {
            const links = api() ? api().getLinks() : [];
            if (view === 'unavailable') return links.filter((item) => item.pending);
            if (view === 'all') return links;
            return links.filter((item) => item.category === view);
        }

        function formatTermSize(bytes) {
            if (bytes === 0) return '0 B';
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }

        function printLs(long) {
            const vfs = vfsReady();
            if (!vfs || !term.cwdId) {
                line('ls: filesystem not available', 'error');
                return;
            }
            const children = vfs.getChildren(term.cwdId)
                .filter(n => !n.attributes || !n.attributes.hidden);
            if (!children.length) {
                line('(empty)', 'dim');
                return;
            }
            children.sort((a, b) => {
                if (a.type === 'directory' && b.type !== 'directory') return -1;
                if (a.type !== 'directory' && b.type === 'directory') return 1;
                return a.name.localeCompare(b.name, undefined, {sensitivity: 'base'});
            });
            if (long) {
                children.forEach((node) => {
                    const isDir = node.type === 'directory';
                    const perm = node.attributes && node.attributes.readOnly ? 'dr--' : (isDir ? 'drwx' : '-rw-');
                    const size = isDir ? '--' : formatTermSize(node.size || 0);
                    const name = isDir ? node.name + '/' : node.name;
                    line(`${perm}  ${size.padEnd(10)} ${name}`);
                });
            } else {
                const names = children.map(n => n.type === 'directory' ? n.name + '/' : n.name);
                line(names.join('  '));
            }
        }

        function printLinks() {
            const links = api() ? api().getLinks() : [];
            if (!links.length) {
                line('links: no link data available', 'error');
                return;
            }
            links.forEach((item) => {
                const status = item.pending ? 'MISSING' : item.status;
                line(`${status.padEnd(8)} ${item.filename.padEnd(24)} ${item.pending ? '--' : item.target}`);
            });
        }

        function printHelp() {
            line('r3sh 0.1 — available commands', 'success');
            line('  help            show this list');
            line('  ls [-l]         list the current folder');
            line('  cd <dir>        change folder (link-exchange, social, dev, play, unavailable, ..)');
            line('  pwd             print the current path');
            line('  open <name>     open a folder, link, or readme.txt');
            line('  links           list every link and its status');
            line('  search [query]  open the desktop search');
            line('  music           open the music player');
            line('  apps [id]       open Programs or launch one app');
            line('  play            start the current track');
            line('  pause           pause the current track');
            line('  next            play the next track');
            line('  now             print the current track');
            line('  neofetch        system summary');
            line('  date            current date and time');
            line('  echo <text>     print text');
            line('  whoami          print the current user');
            line('  clear           clear the scrollback');
            line('  exit            close this terminal');
        }

        function runCommand(raw) {
            const tokens = tokenize(raw);
            const command = (tokens.shift() || '').toLowerCase();
            const args = tokens;

            if (!command) return true;

            if (command === 'help') {
                printHelp();
                return true;
            }

            if (command === 'ls' || command === 'dir') {
                printLs(args.includes('-l') || command === 'dir');
                return true;
            }

            if (command === 'cd') {
                const vfs = vfsReady();
                const target = args[0] || '~';
                if (target === '..' || target === '..\\' || target === '../') {
                    if (vfs && term.cwdId) {
                        const cur = vfs.getNode(term.cwdId);
                        if (cur && cur.parentId) {
                            term.cwdId = cur.parentId;
                            term.cwd = vfs.getNode(cur.parentId).name;
                        }
                    } else {
                        term.cwd = '~';
                    }
                } else if (target === '~' || target === '/' || target.toLowerCase() === 'home') {
                    if (vfs) {
                        term.cwdId = vfs.getKnownFolder('userProfile');
                        term.cwd = '~';
                    } else {
                        term.cwd = '~';
                    }
                } else {
                    const folder = findFolder(target);
                    if (!folder) {
                        line(`cd: no such directory: ${args[0]}`, 'error');
                        return true;
                    }
                    if (vfs) {
                        const node = vfs.getNode(folder);
                        term.cwdId = folder;
                        term.cwd = node ? node.name : folder;
                    } else {
                        term.cwd = folder;
                    }
                }
                updatePrompt();
                return true;
            }

            if (command === 'pwd') {
                line(currentPath());
                return true;
            }

            if (command === 'open') {
                if (!args.length) {
                    line('open: usage: open <file|folder>', 'error');
                    return true;
                }
                const target = args.join(' ');
                const vfs = vfsReady();
                if (!vfs) {
                    line('open: filesystem not available', 'error');
                    return true;
                }
                if (term.cwdId) {
                    const children = vfs.getChildren(term.cwdId);
                    const match = children.find(c => c.name.toLowerCase() === target.toLowerCase());
                    if (match) {
                        if (match.type === 'directory') {
                            openExplorer();
                            window.navigateExplorer(match.id);
                            line(`opened ${match.name} in Explorer`, 'success');
                        } else {
                            openExplorer();
                            window.navigateExplorer(match.id);
                            line(`opened ${match.name}`, 'success');
                        }
                        return false;
                    }
                }
                const node = vfs.resolvePath(target) || vfs.resolvePath('C:\\Users\\' + (vfs.username || 'r3d1') + '\\' + target);
                if (node) {
                    openExplorer();
                    window.navigateExplorer(node.id);
                    line(`opened ${node.name}`, 'success');
                    return false;
                }
                const folder = findFolder(target.toLowerCase());
                if (folder) {
                    openExplorer();
                    window.navigateExplorer(folder);
                    line(`opened in Explorer`, 'success');
                    return false;
                }
                line(`open: not found: ${target}`, 'error');
                return true;
            }

            if (command === 'mkdir') {
                const dirName = args.join(' ');
                if (!dirName) {
                    line('mkdir: usage: mkdir <name>', 'error');
                    return true;
                }
                const vfs = vfsReady();
                if (!vfs || !term.cwdId) {
                    line('mkdir: filesystem not available', 'error');
                    return true;
                }
                vfs.createDirectory(term.cwdId, dirName).then(() => {
                    line(`created directory: ${dirName}`, 'success');
                }).catch(err => {
                    line(`mkdir: ${err.message}`, 'error');
                });
                return true;
            }

            if (command === 'cat') {
                const fileName = args.join(' ');
                if (!fileName) {
                    line('cat: usage: cat <file>', 'error');
                    return true;
                }
                const vfs = vfsReady();
                if (!vfs || !term.cwdId) {
                    line('cat: filesystem not available', 'error');
                    return true;
                }
                const children = vfs.getChildren(term.cwdId);
                const match = children.find(c => c.name.toLowerCase() === fileName.toLowerCase() && c.type === 'file');
                if (!match) {
                    line(`cat: no such file: ${fileName}`, 'error');
                    return true;
                }
                vfs.readFile(match.id).then(content => {
                    const text = content.kind === 'text' ? content.value : '(binary content)';
                    text.split('\n').forEach(l => line(l));
                }).catch(err => {
                    line(`cat: ${err.message}`, 'error');
                });
                return true;
            }

            if (command === 'links') {
                printLinks();
                return true;
            }

            if (command === 'search') {
                const query = args.join(' ');
                openSearch(query);
                line(query ? `opening desktop search for "${query}"` : 'opening desktop search', 'dim');
                return false;
            }

            if (command === 'music') {
                openMusic();
                line('opened Music', 'success');
                return false;
            }

            if (command === 'apps' || command === 'programs') {
                const appId = (args[0] || '').toLowerCase();
                if (appId) {
                    const launched = openProgram(appId);
                    if (launched) {
                        line(`opened ${appId}`, 'success');
                        return false;
                    }
                    line(`apps: not found: ${args[0]}`, 'error');
                    return true;
                }
                openPrograms();
                const list = window.RetroApps ? window.RetroApps.list() : [];
                line(`opened Programs${list.length ? ` (${list.map((app) => app.id).join(', ')})` : ''}`, 'success');
                return false;
            }

            if (command === 'play') {
                if (!musicTracks.length) {
                    line('play: no tracks available', 'error');
                    return true;
                }
                playMusic();
                line('music: play requested', 'dim');
                return true;
            }

            if (command === 'pause') {
                if (!musicTracks.length) {
                    line('pause: no tracks available', 'error');
                    return true;
                }
                pauseMusic();
                line('music: paused', 'success');
                return true;
            }

            if (command === 'next') {
                if (musicTracks.length < 2) {
                    line('next: no next track', 'error');
                    return true;
                }
                nextMusic(true);
                line('music: next track', 'dim');
                return true;
            }

            if (command === 'now') {
                line(`music: ${musicNowSummary()}`, 'success');
                return true;
            }

            if (command === 'neofetch') {
                const links = api() ? api().getLinks() : [];
                const pending = links.filter((item) => item.pending).length;
                const visible = Array.from(windows.values()).filter((item) => !item.closed).length;
                line('r3d1bruh@desktop', 'success');
                line('-----------------', 'dim');
                line('OS: r3d1bruh desktop (shell prototype)');
                line('Shell: r3sh 0.1');
                line('WM: purple window manager');
                line('Terminal: r3term');
                line(`Uptime: ${formatUptime(Date.now() - shellStartedAt)}`);
                line(`Links: ${links.length} (${pending} missing)`);
                line(`Music: ${musicDiscovering ? 'scanning' : musicTracks.length ? `${musicTracks.length} tracks · ${musicStatusText().toLowerCase()}` : 'no tracks'}`);
                line(`Windows: ${visible}`);
                line(`Resolution: ${desktop.clientWidth}x${desktop.clientHeight}`);
                return true;
            }

            if (command === 'date') {
                line(new Date().toLocaleString());
                return true;
            }

            if (command === 'echo') {
                const rawArgs = args.join(' ');
                const redirMatch = rawArgs.match(/^(.*?)\s*(>>|>)\s*(.+)$/);
                if (redirMatch) {
                    const text = redirMatch[1].trim();
                    const isAppend = redirMatch[2] === '>>';
                    const targetFile = redirMatch[3].trim().replace(/^['"]|['"]$/g, '');
                    const vfs = vfsReady();
                    if (!vfs || !term.cwdId) {
                        line('echo: filesystem not available', 'error');
                        return true;
                    }

                    // Check if file already exists in cwd
                    const children = vfs.getChildren(term.cwdId);
                    const existing = children.find(c => c.name.toLowerCase() === targetFile.toLowerCase());

                    if (existing) {
                        if (isAppend) {
                            vfs.readFile(existing.id).then(curr => {
                                const prev = curr && curr.kind === 'text' ? curr.value : '';
                                const updated = prev ? prev + '\n' + text : text;
                                return vfs.writeFile(existing.id, updated);
                            }).then(() => {
                                line(`appended to ${targetFile}`, 'dim');
                            }).catch(err => {
                                line(`echo: ${err.message}`, 'error');
                            });
                        } else {
                            vfs.writeFile(existing.id, text).then(() => {
                                line(`wrote to ${targetFile}`, 'dim');
                            }).catch(err => {
                                line(`echo: ${err.message}`, 'error');
                            });
                        }
                    } else {
                        // Create new file
                        vfs.createFile(term.cwdId, targetFile, text).then(() => {
                            line(`created ${targetFile}`, 'dim');
                        }).catch(err => {
                            line(`echo: ${err.message}`, 'error');
                        });
                    }
                    return true;
                }

                line(args.join(' '));
                return true;
            }

            if (command === 'whoami') {
                line('r3d1bruh');
                return true;
            }

            if (command === 'clear') {
                output.textContent = '';
                return true;
            }

            if (command === 'exit') {
                closeWindow(win.id);
                return false;
            }

            line(`r3sh: command not found: ${command}`, 'error');
            return true;
        }

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const raw = input.value;
            const command = raw.trim();
            input.value = '';
            printCommand(promptText(), raw);
            if (command) {
                term.history.push(command);
                term.historyIndex = term.history.length;

                if (term.session) {
                    try {
                        const res = await term.session.execute(command, {
                            closeWindow: () => closeWindow(win.id)
                        });
                        if (win.closed) return;
                        if (res.stdout) {
                            if (res.stdout.includes('\x1b[2J\x1b[H')) {
                                output.textContent = '';
                            } else {
                                res.stdout.split('\n').forEach(l => {
                                    if (l || res.stdout.endsWith('\n')) line(l);
                                });
                            }
                        }
                        if (res.stderr) {
                            res.stderr.split('\n').forEach(l => {
                                if (l) line(l, 'error');
                            });
                        }
                    } catch (err) {
                        line(err.message || 'Execution error', 'error');
                    }
                    updatePrompt();
                    input.focus();
                } else {
                    const shouldRefocus = runCommand(command);
                    if (win.closed) return;
                    updatePrompt();
                    if (shouldRefocus !== false) input.focus();
                }
            } else {
                input.focus();
            }
        });

        input.addEventListener('keydown', (event) => {
            if (event.ctrlKey && event.key.toLowerCase() === 'c') {
                event.preventDefault();
                printCommand(promptText(), `${input.value}^C`);
                input.value = '';
            }
        });

        if (term.session) {
            term.session.banner.split('\n').forEach(l => {
                if (l) line(l);
            });
        } else {
            line('r3sh 0.1 — r3d1bruh desktop', 'success');
            line('Type "help" for commands. Start is a desktop-wide search.', 'dim');
            line('');
        }
        updatePrompt();
    }

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