/* ---------------------------------------------------------------------------
 * shell/music.js
 *
 * Music player window (playlist discovery, transport, UI).
 *
 * Loaded as a classic script. Top-level bindings are shared between shell files;
 * runtime statements live in shellInit_* functions that boot.js calls in order
 * after window.ProfileReady.
 * ------------------------------------------------------------------------- */
'use strict';

/* Shared bindings (assigned in the shellInit_* chunks below). */
let MUSIC_VOLUME_KEY, MUSIC_FALLBACK_TRACKS;

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

/* Original inline-script statements, lines 1163-1164+ */
function shellInit_music_1() {
    /* ── Music ──────────────────────────────────────────────── */
    MUSIC_VOLUME_KEY = 'desktopShellMusicVolume';

    MUSIC_FALLBACK_TRACKS = [
        '6._Basshunter_-_In_Her_Eyes-pREJQbSl33Y.opus',
        'Crystal Castles - Suffocation [Z0NGdLr4img].opus',
        'Pretty_Scene_Girl-P8F1RjcWLjM.opus',
        "The Cure - Friday I'm In Love [mGgMZpGYiy8].opus"
    ];
}
