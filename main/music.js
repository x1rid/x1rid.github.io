/* -----------------------------------------------------------------------
 * Retro local music player
 *
 *  - Finds audio through playlist/playlist.json (GitHub Pages friendly)
 *  - Falls back to directory listings and a baked-in track list
 *  - Autoplays on load, starting minimized in the lower-right dock
 *  - Draggable, position-persistent purple/black window
 *  - One persistent HTMLAudioElement, smooth fades, no consecutive repeats
 * ----------------------------------------------------------------------- */
(() => {
    const PREF_ENABLED_KEY = 'retroMusicEnabled';
    const PREF_POSITION_KEY = 'retroMusicWindowPosition';
    const PREF_DOCK_KEY = 'retroMusicDockPosition';
    const PREF_VOLUME_KEY = 'retroMusicVolume';

    const DEFAULT_VOLUME = 0.18;
    const FADE_IN = 2.4;
    const FADE_OUT = 2.4;
    const MANUAL_FADE = 0.28;
    const AUDIO_EXTENSIONS = ['.opus', '.ogg', '.mp3', '.wav', '.m4a'];
    const AUDIO_RE = /\.(opus|ogg|mp3|wav|m4a)$/i;

    /* Used if the manifest cannot be fetched (file://, offline, first deploy). */
    const FALLBACK_TRACKS = [
        '6._Basshunter_-_In_Her_Eyes-pREJQbSl33Y.opus',
        'Crystal Castles - Suffocation [Z0NGdLr4img].opus',
        'Pretty_Scene_Girl-P8F1RjcWLjM.opus',
        "The Cure - Friday I'm In Love [mGgMZpGYiy8].opus"
    ];

    let playlist = [];
    let trackBase = null;
    let currentIndex = -1;
    let lastTrackIndex = -1;

    let audio = null;
    let isEnabled = true;
    let isPlaying = false;
    let isWindowVisible = false;
    let userVolume = DEFAULT_VOLUME;

    let fadeId = null;
    let fadeToken = 0;
    let isFadingOut = false;
    let trackToken = 0;
    let crossfadeTrack = -1;
    let isSeeking = false;
    let scanning = false;

    let winEl = null;
    let titleEl = null;
    let statusEl = null;
    let playPauseBtn = null;
    let prevBtn = null;
    let nextBtn = null;
    let toggleBtn = null;
    let rescanBtn = null;
    let listBtn = null;
    let listEl = null;
    let progressEl = null;
    let timeEl = null;
    let durationEl = null;
    let volumeEl = null;
    let countEl = null;
    let closeBtn = null;
    let minimizeBtn = null;
    let miniEl = null;
    let miniOpenBtn = null;
    let miniPlayBtn = null;
    let miniTrackEl = null;

    /* ------------------------------------------------------------------
     * Storage helpers
     * ------------------------------------------------------------------ */
    function readNumber(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback;
            const value = Number(raw);
            return Number.isFinite(value) ? value : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function write(key, value) {
        try {
            localStorage.setItem(key, String(value));
        } catch (_) {
            /* storage can be disabled */
        }
    }

    /* ------------------------------------------------------------------
     * Track labels
     * ------------------------------------------------------------------ */
    function getTrackNameFromFilename(filename) {
        if (!filename) return 'Unknown Track';
        let base = String(filename);
        try {
            base = decodeURIComponent(base);
        } catch (_) {
            /* keep raw name */
        }
        base = base.split('?')[0].split('#')[0].split(/[\\/]/).pop();
        return base
            .replace(AUDIO_RE, '')
            .replace(/\s*\[[A-Za-z0-9_-]{11}\]\s*$/, '')
            .replace(/-[A-Za-z0-9_-]{11}\s*$/, '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || 'Unknown Track';
    }

    function makeTrackUrl(filename, base) {
        const encoded = encodeURIComponent(filename);
        try {
            return new URL(encoded, base || document.baseURI).href;
        } catch (_) {
            return `playlist/${encoded}`;
        }
    }

    /* ------------------------------------------------------------------
     * Discovery
     * ------------------------------------------------------------------ */
    function candidateBases() {
        const raw = [
            'playlist/',
            '../main/playlist/',
            '/main/playlist/',
            '../playlist/',
            '/playlist/'
        ];
        const seen = new Set();
        const bases = [];

        raw.forEach((entry) => {
            if (location.protocol === 'file:' && entry.startsWith('/')) return;
            try {
                const url = new URL(entry, document.baseURI);
                url.hash = '';
                url.search = '';
                if (!url.pathname.endsWith('/')) url.pathname += '/';
                if (!seen.has(url.href)) {
                    seen.add(url.href);
                    bases.push(url.href);
                }
            } catch (_) {
                /* ignore malformed base */
            }
        });

        return bases;
    }

    function normalizeFilenames(list) {
        const seen = new Set();
        const files = [];

        (Array.isArray(list) ? list : []).forEach((item) => {
            if (!item) return;
            const value = typeof item === 'string'
                ? item
                : (item.file || item.name || item.filename || '');
            const clean = String(value).split('?')[0].split('#')[0];
            const filename = clean.split('/').pop();
            if (!filename || !AUDIO_RE.test(filename) || seen.has(filename)) return;
            seen.add(filename);
            files.push(filename);
        });

        return files;
    }

    async function readManifest(base, bust) {
        try {
            const url = new URL('playlist.json', base);
            if (bust) url.searchParams.set('v', String(Date.now()));
            const response = await fetch(url.href, {
                cache: bust ? 'no-store' : 'default',
                headers: { Accept: 'application/json' }
            });
            if (!response.ok) return null;
            const data = await response.json();
            const list = Array.isArray(data)
                ? data
                : (data && (data.tracks || data.files) || []);
            const files = normalizeFilenames(list);
            return files.length ? files : null;
        } catch (_) {
            return null;
        }
    }

    async function scanDirectory(base, bust) {
        try {
            const url = new URL(base);
            if (bust) url.searchParams.set('v', String(Date.now()));
            const response = await fetch(url.href, {
                cache: 'no-store',
                headers: { Accept: 'application/json, text/html;q=0.9, */*;q=0.2' }
            });
            if (!response.ok) return null;

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                return normalizeFilenames(await response.json());
            }

            const text = await response.text();
            if (!text || text.length > 750000) return null;

            const doc = new DOMParser().parseFromString(text, 'text/html');
            const files = [];
            doc.querySelectorAll('a[href]').forEach((anchor) => {
                const href = anchor.getAttribute('href') || '';
                const filename = href.split('?')[0].split('#')[0].split('/').pop();
                if (filename && AUDIO_RE.test(filename) && !files.includes(filename)) {
                    files.push(filename);
                }
            });
            return files.length ? files : null;
        } catch (_) {
            return null;
        }
    }

    function applyPlaylist(files, base) {
        const unique = normalizeFilenames(files);
        const previousName = currentIndex >= 0 && playlist[currentIndex]
            ? playlist[currentIndex].name
            : null;

        trackBase = base || trackBase || candidateBases()[0] || document.baseURI;
        playlist = unique.map((filename) => ({
            name: getTrackNameFromFilename(filename),
            filename,
            file: makeTrackUrl(filename, trackBase)
        }));

        if (previousName) {
            const found = playlist.findIndex((track) => track.name === previousName);
            currentIndex = found >= 0 ? found : Math.min(currentIndex, playlist.length - 1);
        }
        if (currentIndex < 0 || currentIndex >= playlist.length) {
            currentIndex = playlist.length ? pickRandomIndex() : -1;
        }

        renderTrackList();
        updateTrackUI();
    }

    async function discoverPlaylist(manual = false) {
        if (scanning) return;
        scanning = true;
        if (rescanBtn) rescanBtn.disabled = true;

        if (manual) setStatus('SCANNING');
        if (!playlist.length) {
            setTitle('DISCOVERING TRACKS...');
        }

        const bases = candidateBases();
        let foundBase = null;
        let files = [];

        /* Fast path: the committed manifest. */
        for (const base of bases) {
            const manifest = await readManifest(base, manual);
            if (manifest && manifest.length) {
                foundBase = base;
                files = manifest;
                break;
            }
        }

        /* Directory listing keeps local dev / python server auto-discovery. */
        if (!files.length || manual) {
            const scanBases = foundBase
                ? Array.from(new Set([foundBase, ...bases]))
                : bases;

            for (const base of scanBases) {
                const scanned = await scanDirectory(base, manual);
                if (scanned && scanned.length) {
                    if (!files.length) {
                        files = scanned;
                        foundBase = base;
                    } else {
                        files = files.concat(scanned);
                    }
                }
            }
        }

        if (!files.length) {
            files = FALLBACK_TRACKS.slice();
            foundBase = foundBase || bases[0] || document.baseURI;
        }

        applyPlaylist(files, foundBase);

        scanning = false;
        if (rescanBtn) rescanBtn.disabled = false;

        if (!playlist.length) {
            setStatus('NO TRACKS');
            setTitle('NO MUSIC FOUND');
            return;
        }

        if (manual) {
            setStatus(`FOUND ${playlist.length} TRACKS`);
            window.setTimeout(() => {
                if (!scanning) setStatus(isPlaying ? 'PLAYING' : (isEnabled ? 'READY' : 'MUSIC OFF'));
            }, 1400);
        } else if (isEnabled && !isPlaying) {
            playTrack(currentIndex, FADE_IN);
        } else {
            setStatus(isEnabled ? 'READY' : 'MUSIC OFF');
        }
    }

    /* ------------------------------------------------------------------
     * Audio fades
     * ------------------------------------------------------------------ */
    function stopFade() {
        if (fadeId !== null) {
            cancelAnimationFrame(fadeId);
            fadeId = null;
        }
        fadeToken += 1;
    }

    function fadeTo(target, durationSec, onDone) {
        if (!audio) {
            if (onDone) onDone();
            return;
        }

        stopFade();
        const token = fadeToken;
        const startVolume = audio.volume;
        const targetVolume = Math.max(0, Math.min(1, Number(target) || 0));
        const durationMs = Math.max(40, durationSec * 1000);

        if (durationMs <= 60 || Math.abs(startVolume - targetVolume) < 0.001) {
            audio.volume = targetVolume;
            if (onDone) onDone();
            return;
        }

        const startTime = performance.now();

        function step(now) {
            if (token !== fadeToken || !audio) return;
            // A rAF timestamp can land a hair before the performance.now() used
            // to schedule it, which would make progress (and the interpolated
            // volume) negative -> HTMLMediaElement throws IndexSizeError.
            const progress = Math.min(1, Math.max(0, (now - startTime) / durationMs));
            audio.volume = Math.min(1, Math.max(0, startVolume + (targetVolume - startVolume) * progress));

            if (progress < 1) {
                fadeId = requestAnimationFrame(step);
            } else {
                fadeId = null;
                if (onDone) onDone();
            }
        }

        fadeId = requestAnimationFrame(step);
    }

    /* ------------------------------------------------------------------
     * Playback
     * ------------------------------------------------------------------ */
    function pickRandomIndex() {
        if (!playlist.length) return -1;
        if (playlist.length === 1) return 0;
        let next = Math.floor(Math.random() * playlist.length);
        if (next === lastTrackIndex) next = (next + 1) % playlist.length;
        return next;
    }

    function setStatus(text) {
        const label = String(text || '').toUpperCase();
        if (statusEl) statusEl.textContent = label;

        const footerStatus = document.querySelector('.music-now-playing');
        if (footerStatus) {
            const track = currentIndex >= 0 ? playlist[currentIndex] : null;
            footerStatus.textContent = track
                ? `NOW PLAYING: ${track.name}`
                : `NOW PLAYING: ${label.toLowerCase()}`;
            footerStatus.title = footerStatus.textContent;
        }
    }

    function setTitle(text) {
        if (!titleEl) return;
        titleEl.textContent = text;
        titleEl.title = text;
    }

    function updateTrackUI() {
        const track = currentIndex >= 0 ? playlist[currentIndex] : null;
        setTitle(track ? track.name : (playlist.length ? 'READY' : 'NO TRACKS FOUND'));

        if (playPauseBtn) {
            playPauseBtn.textContent = isPlaying ? '❚❚' : '▶';
            playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
            playPauseBtn.classList.toggle('is-playing', isPlaying);
        }

        if (winEl) winEl.classList.toggle('is-playing', isPlaying);
        if (miniEl) miniEl.classList.toggle('is-playing', isPlaying);
        if (miniPlayBtn) {
            miniPlayBtn.textContent = isPlaying ? '❚❚' : '▶';
            miniPlayBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
        }
        if (miniTrackEl) {
            const miniLabel = track ? track.name : (isEnabled ? 'READY' : 'MUSIC OFF');
            miniTrackEl.textContent = miniLabel;
            miniTrackEl.title = miniLabel;
        }
        if (countEl) countEl.textContent = `${playlist.length} TRACK${playlist.length === 1 ? '' : 'S'}`;

        const toggleLabel = isEnabled ? 'SOUND: ON' : 'SOUND: OFF';
        if (toggleBtn) {
            toggleBtn.textContent = toggleLabel;
            toggleBtn.classList.toggle('is-on', isEnabled);
            toggleBtn.setAttribute('aria-pressed', String(isEnabled));
        }

        const footerToggle = document.querySelector('.music-toggle');
        if (footerToggle) {
            footerToggle.textContent = isEnabled ? 'ON' : 'OFF';
            footerToggle.classList.toggle('is-on', isEnabled);
            footerToggle.setAttribute('aria-pressed', String(isEnabled));
        }

        if (listEl) {
            listEl.querySelectorAll('.rp-track-item').forEach((item) => {
                const active = Number(item.dataset.index) === currentIndex;
                item.classList.toggle('is-current', active);
                if (active) item.setAttribute('aria-current', 'true');
                else item.removeAttribute('aria-current');
            });
        }

        /* The footer badge and the tab title tell the same truth as the
           player: nothing claims to be playing when it is not. */
        const footerPanel = document.querySelector('.music-panel');
        if (footerPanel) {
            footerPanel.classList.toggle('is-on', isEnabled);
            footerPanel.classList.toggle('is-playing', isPlaying);
        }

        document.title = track && isPlaying
            ? `r3d1bruh — ♫ ${track.name}`
            : 'r3d1bruh';
    }

    function updateProgress() {
        if (!audio) return;
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;

        if (progressEl && !isSeeking) {
            progressEl.value = duration > 0 ? String(Math.round((current / duration) * 1000)) : '0';
        }
        if (timeEl) timeEl.textContent = formatTime(current);
        if (durationEl) durationEl.textContent = formatTime(duration);

        /* 2px progress spine on the minimized dock — real position only. */
        if (miniEl) {
            const ratio = duration > 0 ? Math.min(1, current / duration) : 0;
            miniEl.style.setProperty('--rp-progress', String(ratio));
        }
    }

    function formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
        const total = Math.floor(seconds);
        const minutes = Math.floor(total / 60);
        const rest = total % 60;
        return `${minutes}:${String(rest).padStart(2, '0')}`;
    }

    function playTrack(index, fadeDuration = FADE_IN) {
        if (!playlist.length || index < 0 || index >= playlist.length) {
            setStatus('NO AUDIO FILES');
            return;
        }

        const token = ++trackToken;
        currentIndex = index;
        lastTrackIndex = index;
        crossfadeTrack = -1;
        updateTrackUI();
        updateProgress();

        const track = playlist[index];
        audio.src = track.file;
        audio.load();

        if (!isEnabled) {
            isPlaying = false;
            updateTrackUI();
            setStatus('MUSIC OFF');
            return;
        }

        audio.volume = 0;
        const playPromise = audio.play();
        if (!playPromise || typeof playPromise.then !== 'function') return;

        playPromise.then(() => {
            if (token !== trackToken) return;
            isPlaying = true;
            updateTrackUI();
            setStatus('PLAYING');
            fadeTo(userVolume, fadeDuration);
        }).catch((error) => {
            if (token !== trackToken) return;
            isPlaying = false;
            updateTrackUI();
            setStatus(error && error.name === 'NotAllowedError' ? 'PRESS PLAY' : 'TRACK UNAVAILABLE');
        });
    }

    function nextTrack() {
        if (!playlist.length) return;
        const nextIndex = pickRandomIndex();
        isFadingOut = false;
        stopFade();

        if (isPlaying && audio && !audio.paused) {
            fadeTo(0, MANUAL_FADE, () => playTrack(nextIndex, 0.9));
        } else {
            playTrack(nextIndex, FADE_IN);
        }
    }

    function previousTrack() {
        if (!playlist.length) return;
        if (audio && audio.currentTime > 3 && isPlaying) {
            audio.currentTime = 0;
            updateProgress();
            return;
        }
        const prevIndex = currentIndex <= 0 ? playlist.length - 1 : currentIndex - 1;
        isFadingOut = false;
        stopFade();
        playTrack(prevIndex, isPlaying ? 0.9 : FADE_IN);
    }

    function setEnabled(enabled) {
        isEnabled = Boolean(enabled);
        write(PREF_ENABLED_KEY, isEnabled);

        if (isEnabled) {
            if (playlist.length && (!audio.src || currentIndex < 0)) {
                playTrack(currentIndex >= 0 ? currentIndex : pickRandomIndex());
            } else if (audio && audio.src) {
                audio.volume = 0;
                const playPromise = audio.play();
                if (playPromise && typeof playPromise.then === 'function') {
                    playPromise.then(() => {
                        isPlaying = true;
                        updateTrackUI();
                        setStatus('PLAYING');
                        fadeTo(userVolume, FADE_IN);
                    }).catch(() => {
                        isPlaying = false;
                        updateTrackUI();
                        setStatus('PRESS PLAY');
                    });
                }
            } else {
                setStatus('NO TRACKS');
            }
        } else {
            isFadingOut = false;
            stopFade();
            if (audio) {
                audio.pause();
                audio.volume = 0;
            }
            isPlaying = false;
            setStatus('MUSIC OFF');
        }

        updateTrackUI();
    }

    function togglePlayPause() {
        if (!isEnabled) {
            setEnabled(true);
            return;
        }

        if (!audio || !audio.src) {
            if (playlist.length) playTrack(currentIndex >= 0 ? currentIndex : pickRandomIndex());
            else setStatus('NO TRACKS');
            return;
        }

        if (audio.paused || !isPlaying) {
            audio.volume = 0;
            const playPromise = audio.play();
            if (playPromise && typeof playPromise.then === 'function') {
                playPromise.then(() => {
                    isPlaying = true;
                    updateTrackUI();
                    setStatus('PLAYING');
                    fadeTo(userVolume, 1.2);
                }).catch(() => setStatus('PRESS PLAY'));
            }
        } else {
            fadeTo(0, 0.45, () => {
                audio.pause();
                isPlaying = false;
                updateTrackUI();
                setStatus('PAUSED');
            });
        }
    }

    /* ------------------------------------------------------------------
     * Track list
     * ------------------------------------------------------------------ */
    function renderTrackList() {
        if (!listEl) return;
        const fragment = document.createDocumentFragment();

        playlist.forEach((track, index) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'rp-track-item';
            item.dataset.index = String(index);
            item.title = track.name;

            const name = document.createElement('span');
            name.className = 'rp-track-name';
            name.textContent = track.name;

            item.appendChild(name);
            item.addEventListener('click', () => {
                if (!isEnabled) {
                    isEnabled = true;
                    write(PREF_ENABLED_KEY, true);
                }
                playTrack(index);
            });

            fragment.appendChild(item);
        });

        listEl.replaceChildren(fragment);
    }

    function toggleTrackList() {
        if (!listEl) return;
        const willShow = listEl.hidden;
        listEl.hidden = !willShow;
        if (listBtn) {
            listBtn.classList.toggle('is-on', willShow);
            listBtn.setAttribute('aria-expanded', String(willShow));
        }
        if (winDrag) winDrag.clamp();
    }

    function clamp(value, min, max) {
        if (max < min) return min;
        return Math.min(max, Math.max(min, value));
    }

    /* ------------------------------------------------------------------
     * Window + dock dragging
     * The pointer physics (capture, clamping, persistence) live in the shared
     * draggable.js module; this file only supplies the storage keys, corner
     * offsets and the dock's tap-vs-drag threshold. The controllers are
     * created in initFloatingWindow(), once the elements exist.
     * ------------------------------------------------------------------ */
    let winDrag = null;
    let miniDrag = null;

    /* Phone layout (<=600px, the same boundary as phone.css / mobile.js):
       the dock and the player are pinned by CSS there, so pointer dragging
       must not fight the stylesheet. The media query is re-read on every
       check, so rotating in and out of phone mode is handled live. */
    function isPhoneLayout() {
        return Boolean(window.matchMedia && window.matchMedia('(max-width: 600px)').matches);
    }

    function createDragControllers() {
        const api = window.RetroDrag;
        if (!api) return;

        if (winEl && !winDrag) {
            winDrag = api.makeDraggable(winEl, winEl.querySelector('#retro-titlebar'), {
                storageKey: PREF_POSITION_KEY,
                offset: 16,
                threshold: 0,           /* title bar: drag starts on pointer-down */
                ignoreButtons: true,    /* the min/max buttons keep their clicks */
                fallbackSize: { width: 326, height: 260 },
                allow: () => !isPhoneLayout()
            });
        }

        if (miniEl && !miniDrag) {
            miniDrag = api.makeDraggable(miniEl, miniEl, {
                storageKey: PREF_DOCK_KEY,
                offset: 14,
                threshold: 6,           /* a small movement stays a tap */
                cornerPinned: true,     /* docked with right/bottom by default */
                fallbackSize: { width: 250, height: 38 },
                dblclickReset: true,    /* double-click snaps it back home */
                allow: () => !isPhoneLayout()
            });
        }
    }

    /* ------------------------------------------------------------------
     * Window UI
     * ------------------------------------------------------------------ */
    function setWindowVisible(visible) {
        isWindowVisible = Boolean(visible);
        if (winEl) winEl.hidden = !isWindowVisible;
        /* While the player is put away, the minimized dock is the only UI. */
        if (miniEl) miniEl.hidden = isWindowVisible;

        if (isWindowVisible) {
            if (winDrag) winDrag.restore();
            requestAnimationFrame(() => { if (winDrag) winDrag.clamp(); });
        }
    }

    function initFloatingWindow() {
        if (document.getElementById('retro-music-window')) return;

        winEl = document.createElement('div');
        winEl.id = 'retro-music-window';
        winEl.className = 'retro-player';
        winEl.setAttribute('role', 'dialog');
        winEl.setAttribute('aria-label', 'Retro music player');
        winEl.innerHTML = `
            <div class="rp-titlebar" id="retro-titlebar">
                <div class="rp-title">
                    <span class="rp-led" aria-hidden="true"></span>
                    <span>RETRO.AUDIO</span>
                </div>
                <div class="rp-window-actions">
                    <button class="rp-window-btn" id="retro-btn-minimize" type="button" aria-label="Minimize music player" title="Minimize">_</button>
                    <button class="rp-window-btn" id="retro-btn-close" type="button" aria-label="Close music player" title="Close">×</button>
                </div>
            </div>
            <div class="rp-body">
                <div class="rp-screen">
                    <div class="rp-screen-top">
                        <div class="rp-track" id="retro-track-title" aria-live="polite">DISCOVERING TRACKS...</div>
                        <div class="rp-status" id="retro-track-status">SCANNING</div>
                    </div>
                    <div class="rp-visualizer" aria-hidden="true">
                        <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
                        <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
                    </div>
                    <div class="rp-progress-wrap">
                        <input class="rp-progress" id="retro-progress" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek">
                    </div>
                    <div class="rp-time">
                        <span id="retro-time">0:00</span>
                        <span id="retro-duration">0:00</span>
                    </div>
                </div>
                <div class="rp-controls">
                    <button class="rp-btn" id="retro-btn-prev" type="button" aria-label="Previous track">◀◀</button>
                    <button class="rp-btn rp-btn-primary" id="retro-btn-play" type="button" aria-label="Play">▶</button>
                    <button class="rp-btn" id="retro-btn-next" type="button" aria-label="Next track">▶▶</button>
                </div>
                <div class="rp-secondary">
                    <button class="rp-small" id="retro-btn-toggle" type="button" aria-pressed="false">SOUND: OFF</button>
                    <button class="rp-small" id="retro-btn-rescan" type="button" title="Rescan the playlist folder">RESCAN</button>
                    <label class="rp-volume-wrap" title="Volume">
                        <span>VOL</span>
                        <input class="rp-volume" id="retro-volume" type="range" min="0" max="100" step="1" aria-label="Volume">
                    </label>
                    <button class="rp-small" id="retro-btn-list" type="button" aria-expanded="false" title="Show track list">≡</button>
                </div>
                <div class="rp-list" id="retro-track-list" hidden></div>
                <div class="rp-foot">
                    <span>DRAG TITLE BAR</span>
                    <span id="retro-track-count">0 TRACKS</span>
                </div>
            </div>
        `;
        document.body.appendChild(winEl);

        /* Minimized dock — always parked in the lower-right corner. */
        miniEl = document.createElement('div');
        miniEl.id = 'retro-music-mini';
        miniEl.className = 'rp-mini';
        miniEl.hidden = true;
        miniEl.innerHTML = `
            <button class="rp-mini-main" id="retro-mini-open" type="button" title="Restore RETRO.AUDIO">
                <span class="rp-mini-led" aria-hidden="true"></span>
                <span class="rp-mini-text">
                    <span class="rp-mini-title">RETRO.AUDIO</span>
                    <span class="rp-mini-track" id="retro-mini-track">DISCOVERING TRACKS...</span>
                </span>
                <span class="rp-mini-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
                <span class="visually-hidden"> — open music player</span>
            </button>
            <button class="rp-mini-btn" id="retro-mini-play" type="button" aria-label="Play">▶</button>
        `;
        document.body.appendChild(miniEl);

        titleEl = winEl.querySelector('#retro-track-title');
        statusEl = winEl.querySelector('#retro-track-status');
        playPauseBtn = winEl.querySelector('#retro-btn-play');
        prevBtn = winEl.querySelector('#retro-btn-prev');
        nextBtn = winEl.querySelector('#retro-btn-next');
        toggleBtn = winEl.querySelector('#retro-btn-toggle');
        rescanBtn = winEl.querySelector('#retro-btn-rescan');
        listBtn = winEl.querySelector('#retro-btn-list');
        listEl = winEl.querySelector('#retro-track-list');
        progressEl = winEl.querySelector('#retro-progress');
        timeEl = winEl.querySelector('#retro-time');
        durationEl = winEl.querySelector('#retro-duration');
        volumeEl = winEl.querySelector('#retro-volume');
        countEl = winEl.querySelector('#retro-track-count');
        closeBtn = winEl.querySelector('#retro-btn-close');
        minimizeBtn = winEl.querySelector('#retro-btn-minimize');
        miniOpenBtn = miniEl.querySelector('#retro-mini-open');
        miniPlayBtn = miniEl.querySelector('#retro-mini-play');
        miniTrackEl = miniEl.querySelector('#retro-mini-track');

        createDragControllers();

        playPauseBtn.addEventListener('click', togglePlayPause);
        prevBtn.addEventListener('click', previousTrack);
        nextBtn.addEventListener('click', nextTrack);
        toggleBtn.addEventListener('click', () => setEnabled(!isEnabled));
        rescanBtn.addEventListener('click', () => discoverPlaylist(true));
        listBtn.addEventListener('click', toggleTrackList);
        closeBtn.addEventListener('click', () => setWindowVisible(false));
        minimizeBtn.addEventListener('click', () => setWindowVisible(false));
        miniOpenBtn.addEventListener('click', () => {
            if (miniDrag && miniDrag.wasDragged()) return;
            setWindowVisible(true);
        });
        miniPlayBtn.addEventListener('click', () => {
            if (miniDrag && miniDrag.wasDragged()) return;
            togglePlayPause();
        });

        progressEl.addEventListener('input', () => {
            if (!audio) return;
            isSeeking = true;
            const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
            if (duration > 0) {
                audio.currentTime = (Number(progressEl.value) / 1000) * duration;
                if (timeEl) timeEl.textContent = formatTime(audio.currentTime);
            }
        });
        progressEl.addEventListener('change', () => {
            isSeeking = false;
            updateProgress();
        });
        progressEl.addEventListener('pointerup', () => {
            isSeeking = false;
            updateProgress();
        });

        volumeEl.value = String(Math.round(userVolume * 100));
        volumeEl.addEventListener('input', () => {
            userVolume = clamp(Number(volumeEl.value) / 100, 0, 1);
            write(PREF_VOLUME_KEY, userVolume);
            if (audio && !isFadingOut) audio.volume = userVolume;
        });

        const footerToggle = document.querySelector('.music-toggle');
        if (footerToggle) footerToggle.addEventListener('click', () => setEnabled(!isEnabled));

        const footerOpen = document.querySelector('.music-link');
        if (footerOpen) footerOpen.addEventListener('click', () => setWindowVisible(true));

        winEl.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') setWindowVisible(false);
        });

        let wasPhoneLayout = isPhoneLayout();

        window.addEventListener('resize', () => {
            /* Phone mode hands placement to the stylesheet (clamp() clears the
               inline coordinates when dragging is not allowed). Returning to
               the desktop re-applies the saved spot; a plain desktop resize
               keeps the old clamp-only behaviour. */
            const phone = isPhoneLayout();

            if (phone) {
                if (winDrag) winDrag.clamp();
                if (miniDrag) miniDrag.clamp();
            } else if (wasPhoneLayout) {
                if (winDrag) winDrag.restore();
                if (miniDrag) miniDrag.restore();
            } else {
                if (winDrag) winDrag.clamp();
                if (miniDrag) miniDrag.clamp();
            }

            wasPhoneLayout = phone;
        }, { passive: true });

        /* Always boot minimized: the dock in the lower-right corner is the
           way in, and the set positions are restored when they are shown. */
        if (winDrag) winDrag.restore();
        setWindowVisible(false);
        updateTrackUI();
        if (miniDrag) miniDrag.restore();
    }

    /* Browsers only allow audible autoplay after a user gesture, so try on
       load and retry once on the first interaction that is not a play/pause
       control (those handle playback themselves). */
    function armAutoplayUnlock() {
        const isPlayControl = (target) => !!(target && target.closest &&
            target.closest('#retro-mini-play, #retro-btn-play, .music-toggle'));

        const unlock = (event) => {
            document.removeEventListener('pointerdown', unlock, true);
            document.removeEventListener('keydown', unlock, true);
            if (isPlayControl(event.target)) return;
            if (isEnabled && !isPlaying && playlist.length) {
                playTrack(currentIndex >= 0 ? currentIndex : pickRandomIndex(), 1.4);
            }
        };

        document.addEventListener('pointerdown', unlock, true);
        document.addEventListener('keydown', unlock, true);
    }

    /* ------------------------------------------------------------------
     * Audio engine
     * ------------------------------------------------------------------ */
    function initAudio() {
        audio = new Audio();
        audio.preload = 'metadata';
        audio.loop = false;
        audio.volume = 0;

        audio.addEventListener('loadedmetadata', updateProgress);
        audio.addEventListener('durationchange', updateProgress);
        audio.addEventListener('timeupdate', () => {
            updateProgress();

            if (!isPlaying || isFadingOut || !audio.duration) return;
            const remaining = audio.duration - audio.currentTime;

            /* Crossfade once per track, just before it ends. */
            if (remaining > 0 && remaining <= FADE_OUT && crossfadeTrack !== currentIndex) {
                crossfadeTrack = currentIndex;
                isFadingOut = true;
                const nextIndex = pickRandomIndex();
                fadeTo(0, Math.min(remaining, FADE_OUT), () => {
                    isFadingOut = false;
                    playTrack(nextIndex, FADE_IN);
                });
            }
        });

        audio.addEventListener('ended', () => {
            if (!isFadingOut) nextTrack();
        });

        audio.addEventListener('pause', () => {
            if (!isFadingOut && isPlaying && !audio.ended) {
                isPlaying = false;
                updateTrackUI();
            }
        });

        audio.addEventListener('error', () => {
            isPlaying = false;
            updateTrackUI();
            setStatus('TRACK UNAVAILABLE');
        });
    }

    /* ------------------------------------------------------------------
     * Boot
     * ------------------------------------------------------------------ */
    try {
        const storedEnabled = localStorage.getItem(PREF_ENABLED_KEY);
        /* Autoplay by default; only an explicit "off" keeps it silent. */
        isEnabled = storedEnabled === null ? true : storedEnabled === 'true';
    } catch (_) {
        isEnabled = true;
    }
    userVolume = clamp(readNumber(PREF_VOLUME_KEY, DEFAULT_VOLUME), 0, 1);

    function boot() {
        initAudio();
        initFloatingWindow();
        if (toggleBtn) toggleBtn.textContent = isEnabled ? 'SOUND: ON' : 'SOUND: OFF';
        updateTrackUI();
        armAutoplayUnlock();
        discoverPlaylist(false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
