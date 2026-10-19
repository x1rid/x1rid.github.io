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
    /* Set while the minimized dock is being dragged, so the release does not
       also count as a click on it. */
    let miniDragged = false;

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
            const progress = Math.min(1, (now - startTime) / durationMs);
            audio.volume = startVolume + (targetVolume - startVolume) * progress;

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
        clampWindowPosition();
    }

    /* ------------------------------------------------------------------
     * Window placement + dragging
     * ------------------------------------------------------------------ */
    function clamp(value, min, max) {
        if (max < min) return min;
        return Math.min(max, Math.max(min, value));
    }

    function clampPosition(left, top) {
        const width = winEl ? winEl.offsetWidth : 326;
        const height = winEl ? winEl.offsetHeight : 260;
        const margin = 8;
        const maxLeft = Math.max(margin, window.innerWidth - width - margin);
        const maxTop = Math.max(margin, window.innerHeight - height - margin);
        return {
            left: clamp(left, margin, maxLeft),
            top: clamp(top, margin, maxTop)
        };
    }

    function applyPosition(left, top) {
        const position = clampPosition(left, top);
        if (!winEl) return position;
        winEl.style.left = `${Math.round(position.left)}px`;
        winEl.style.top = `${Math.round(position.top)}px`;
        return position;
    }

    function defaultPosition() {
        const width = winEl ? winEl.offsetWidth : 326;
        const height = winEl ? winEl.offsetHeight : 260;
        return clampPosition(
            window.innerWidth - width - 16,
            window.innerHeight - height - 16
        );
    }

    function restorePosition() {
        if (!winEl) return;
        let saved = null;
        try {
            const raw = localStorage.getItem(PREF_POSITION_KEY);
            saved = raw ? JSON.parse(raw) : null;
        } catch (_) {
            saved = null;
        }

        if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
            applyPosition(saved.left, saved.top);
        } else {
            const position = defaultPosition();
            applyPosition(position.left, position.top);
        }
    }

    function savePosition() {
        if (!winEl) return;
        const position = {
            left: Math.round(parseFloat(winEl.style.left) || 0),
            top: Math.round(parseFloat(winEl.style.top) || 0)
        };
        try {
            localStorage.setItem(PREF_POSITION_KEY, JSON.stringify(position));
        } catch (_) {
            /* ignore storage errors */
        }
    }

    function clampWindowPosition() {
        if (!winEl || winEl.hidden) return;
        const left = parseFloat(winEl.style.left);
        const top = parseFloat(winEl.style.top);
        const position = applyPosition(
            Number.isFinite(left) ? left : defaultPosition().left,
            Number.isFinite(top) ? top : defaultPosition().top
        );
        winEl.style.left = `${Math.round(position.left)}px`;
        winEl.style.top = `${Math.round(position.top)}px`;
    }

    /* ------------------------------------------------------------------
     * Minimized dock placement + dragging
     * (docks to the lower-right corner by default, position remembered)
     * ------------------------------------------------------------------ */
    function clampMiniPosition(left, top) {
        const width = miniEl ? miniEl.offsetWidth : 250;
        const height = miniEl ? miniEl.offsetHeight : 38;
        const margin = 8;
        const maxLeft = Math.max(margin, window.innerWidth - width - margin);
        const maxTop = Math.max(margin, window.innerHeight - height - margin);
        return {
            left: clamp(left, margin, maxLeft),
            top: clamp(top, margin, maxTop)
        };
    }

    function applyMiniPosition(left, top) {
        const position = clampMiniPosition(left, top);
        if (!miniEl) return position;
        /* Once moved, the dock is positioned from the top-left instead of
           being pinned by the corner offsets. */
        miniEl.style.right = 'auto';
        miniEl.style.bottom = 'auto';
        miniEl.style.left = `${Math.round(position.left)}px`;
        miniEl.style.top = `${Math.round(position.top)}px`;
        return position;
    }

    function defaultMiniPosition() {
        const width = miniEl ? miniEl.offsetWidth : 250;
        const height = miniEl ? miniEl.offsetHeight : 38;
        return clampMiniPosition(
            window.innerWidth - width - 14,
            window.innerHeight - height - 14
        );
    }

    function restoreMiniPosition() {
        if (!miniEl) return;
        let saved = null;
        try {
            const raw = localStorage.getItem(PREF_DOCK_KEY);
            saved = raw ? JSON.parse(raw) : null;
        } catch (_) {
            saved = null;
        }

        if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
            applyMiniPosition(saved.left, saved.top);
        } else {
            const position = defaultMiniPosition();
            applyMiniPosition(position.left, position.top);
        }
    }

    function saveMiniPosition() {
        if (!miniEl) return;
        const position = {
            left: Math.round(parseFloat(miniEl.style.left) || 0),
            top: Math.round(parseFloat(miniEl.style.top) || 0)
        };
        try {
            localStorage.setItem(PREF_DOCK_KEY, JSON.stringify(position));
        } catch (_) {
            /* ignore storage errors */
        }
    }

    function resetMiniPosition() {
        try {
            localStorage.removeItem(PREF_DOCK_KEY);
        } catch (_) {
            /* ignore storage errors */
        }
        const position = defaultMiniPosition();
        applyMiniPosition(position.left, position.top);
    }

    function clampMiniPositionNow() {
        if (!miniEl || miniEl.hidden) return;
        const left = parseFloat(miniEl.style.left);
        const top = parseFloat(miniEl.style.top);
        applyMiniPosition(
            Number.isFinite(left) ? left : defaultMiniPosition().left,
            Number.isFinite(top) ? top : defaultMiniPosition().top
        );
    }

    function makeMiniDraggable() {
        if (!miniEl) return;
        let drag = null;
        let moved = false;
        let moveRaf = 0;
        let pending = null;

        miniEl.addEventListener('pointerdown', (event) => {
            miniDragged = false;
            moved = false;
            pending = null;
            drag = null;
            if (event.button !== 0) return;
            const rect = miniEl.getBoundingClientRect();
            drag = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
                width: miniEl.offsetWidth,
                height: miniEl.offsetHeight
            };
        });

        miniEl.addEventListener('pointermove', (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;

            if (!moved) {
                const dx = event.clientX - drag.startX;
                const dy = event.clientY - drag.startY;
                /* Small movements are still taps (open the player). */
                if (Math.abs(dx) + Math.abs(dy) < 6) return;
                moved = true;
                miniDragged = true;
                miniEl.classList.add('is-dragging');
                try {
                    miniEl.setPointerCapture(event.pointerId);
                } catch (_) {
                    /* capture is best-effort */
                }
            }

            const margin = 8;
            const maxLeft = Math.max(margin, window.innerWidth - drag.width - margin);
            const maxTop = Math.max(margin, window.innerHeight - drag.height - margin);
            pending = {
                left: clamp(event.clientX - drag.offsetX, margin, maxLeft),
                top: clamp(event.clientY - drag.offsetY, margin, maxTop)
            };

            if (!moveRaf) {
                moveRaf = requestAnimationFrame(() => {
                    moveRaf = 0;
                    if (!pending || !miniEl) return;
                    miniEl.style.right = 'auto';
                    miniEl.style.bottom = 'auto';
                    miniEl.style.left = `${Math.round(pending.left)}px`;
                    miniEl.style.top = `${Math.round(pending.top)}px`;
                });
            }

            event.preventDefault();
        });

        function endMiniDrag(event) {
            if (!drag || (event && event.pointerId !== drag.pointerId)) return;
            if (moveRaf) {
                cancelAnimationFrame(moveRaf);
                moveRaf = 0;
            }
            if (moved && pending && miniEl) {
                miniEl.style.right = 'auto';
                miniEl.style.bottom = 'auto';
                miniEl.style.left = `${Math.round(pending.left)}px`;
                miniEl.style.top = `${Math.round(pending.top)}px`;
                saveMiniPosition();
            }
            drag = null;
            pending = null;
            if (miniEl) miniEl.classList.remove('is-dragging');
        }

        miniEl.addEventListener('pointerup', endMiniDrag);
        miniEl.addEventListener('pointercancel', endMiniDrag);
        miniEl.addEventListener('lostpointercapture', endMiniDrag);

        /* Double-click snaps it back to the lower-right corner. */
        miniEl.addEventListener('dblclick', () => {
            if (miniDragged) return;
            resetMiniPosition();
        });
    }

    function makeDraggable(handle) {
        let drag = null;
        let moveRaf = 0;
        let pending = null;

        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || event.target.closest('button')) return;
            const rect = winEl.getBoundingClientRect();
            drag = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
                width: winEl.offsetWidth,
                height: winEl.offsetHeight
            };
            handle.setPointerCapture(event.pointerId);
            winEl.classList.add('is-dragging');
            event.preventDefault();
        });

        handle.addEventListener('pointermove', (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            const margin = 8;
            const maxLeft = Math.max(margin, window.innerWidth - drag.width - margin);
            const maxTop = Math.max(margin, window.innerHeight - drag.height - margin);
            pending = {
                left: clamp(event.clientX - drag.offsetX, margin, maxLeft),
                top: clamp(event.clientY - drag.offsetY, margin, maxTop)
            };

            if (!moveRaf) {
                moveRaf = requestAnimationFrame(() => {
                    moveRaf = 0;
                    if (!pending || !winEl) return;
                    winEl.style.left = `${Math.round(pending.left)}px`;
                    winEl.style.top = `${Math.round(pending.top)}px`;
                });
            }
        });

        function endDrag(event) {
            if (!drag || (event && event.pointerId !== drag.pointerId)) return;
            if (moveRaf) {
                cancelAnimationFrame(moveRaf);
                moveRaf = 0;
            }
            if (pending && winEl) {
                winEl.style.left = `${Math.round(pending.left)}px`;
                winEl.style.top = `${Math.round(pending.top)}px`;
            }
            drag = null;
            pending = null;
            winEl.classList.remove('is-dragging');
            savePosition();
        }

        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);
        handle.addEventListener('lostpointercapture', endDrag);
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
            restorePosition();
            requestAnimationFrame(clampWindowPosition);
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
            <button class="rp-mini-main" id="retro-mini-open" type="button" aria-label="Open music player" title="Restore RETRO.AUDIO">
                <span class="rp-mini-led" aria-hidden="true"></span>
                <span class="rp-mini-text">
                    <span class="rp-mini-title">RETRO.AUDIO</span>
                    <span class="rp-mini-track" id="retro-mini-track">DISCOVERING TRACKS...</span>
                </span>
                <span class="rp-mini-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
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

        makeDraggable(winEl.querySelector('#retro-titlebar'));
        makeMiniDraggable();

        playPauseBtn.addEventListener('click', togglePlayPause);
        prevBtn.addEventListener('click', previousTrack);
        nextBtn.addEventListener('click', nextTrack);
        toggleBtn.addEventListener('click', () => setEnabled(!isEnabled));
        rescanBtn.addEventListener('click', () => discoverPlaylist(true));
        listBtn.addEventListener('click', toggleTrackList);
        closeBtn.addEventListener('click', () => setWindowVisible(false));
        minimizeBtn.addEventListener('click', () => setWindowVisible(false));
        miniOpenBtn.addEventListener('click', () => {
            if (miniDragged) return;
            setWindowVisible(true);
        });
        miniPlayBtn.addEventListener('click', () => {
            if (miniDragged) return;
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

        window.addEventListener('resize', () => {
            clampWindowPosition();
            clampMiniPositionNow();
        }, { passive: true });

        /* Always boot minimized: the dock in the lower-right corner is the
           way in, and the set positions are restored when they are shown. */
        restorePosition();
        setWindowVisible(false);
        updateTrackUI();
        restoreMiniPosition();
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
