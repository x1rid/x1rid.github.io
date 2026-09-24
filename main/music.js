/* -----------------------------------------------------------------------
 * Local Playlist Music Player & Retro Floating Utility Window
 *
 * - Discovers local audio files directly from /playlist/ (no playlist.json)
 * - Exposes RESCAN button to automatically detect new tracks dropped in /playlist/
 * - Fixed floating retro window at bottom-right (NO EVASIVE OR CURSOR-BASED MOVEMENT)
 * - Single persistent HTMLAudioElement
 * - Random track selection without immediate consecutive repeat
 * - 3-second smooth fade-in
 * - 3-second smooth fade-out
 * - Target volume: 0.15 (configurable)
 * - Close button (X) hides window without interrupting audio
 * - Reopen controls via footer and floating tray pill
 * - LocalStorage persistence: retroMusicEnabled & retroMusicWindowVisible
 * ----------------------------------------------------------------------- */
(() => {
  const PREF_ENABLED_KEY = 'retroMusicEnabled';
  const PREF_VISIBLE_KEY = 'retroMusicWindowVisible';
  const TARGET_VOLUME = 0.15;
  const FADE_DURATION = 3.0; // 3 seconds

  const AUDIO_EXTENSIONS = ['.opus', '.ogg', '.mp3', '.wav', '.m4a'];

  let playlist = []; // Array of { name: 'Song Title', file: 'playlist/filename.ext' }
  let currentIndex = -1;
  let lastTrackIndex = -1;
  let audio = null;
  let isEnabled = false;
  let isPlaying = false;
  let isWindowVisible = true;
  let fadeAnimationId = null;
  let isFadingOut = false;

  // DOM Elements
  let winEl = null;
  let titleEl = null;
  let statusEl = null;
  let playPauseBtn = null;
  let toggleBtn = null;
  let nextBtn = null;
  let rescanBtn = null;
  let closeBtn = null;
  let reopenBtn = null;

  /* ------------------------------------------------------------------
   * Helper: extract display title from filename
   * e.g. "Deftones - Be Quiet and Drive.opus" -> "Deftones - Be Quiet and Drive"
   * ------------------------------------------------------------------ */
  function getTrackNameFromFilename(filename) {
    if (!filename) return 'Unknown Track';
    try {
      filename = decodeURIComponent(filename);
    } catch (_) {}
    // Remove query params or hash if any
    const clean = filename.split('?')[0].split('#')[0];
    const base = clean.split('/').pop();
    // Remove supported extension
    return base.replace(/\.(opus|ogg|mp3|wav|m4a)$/i, '');
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
    const footerStatus = document.querySelector('.music-now-playing');
    if (footerStatus) {
      if (currentIndex >= 0 && playlist[currentIndex]) {
        footerStatus.textContent = `${text}: ${playlist[currentIndex].name}`;
      } else {
        footerStatus.textContent = text;
      }
    }
  }

  function updateTrackUI() {
    if (currentIndex < 0 || !playlist[currentIndex]) {
      if (titleEl) {
        titleEl.textContent = playlist.length ? 'READY' : 'NO TRACKS FOUND';
        titleEl.title = titleEl.textContent;
      }
      return;
    }

    const track = playlist[currentIndex];
    if (titleEl) {
      titleEl.textContent = track.name;
      titleEl.title = track.name;
    }

    const footerToggle = document.querySelector('.music-toggle');
    if (footerToggle) {
      footerToggle.textContent = isEnabled ? 'ON' : 'OFF';
      footerToggle.classList.toggle('is-on', isEnabled);
    }
  }

  /* ------------------------------------------------------------------
   * Audio Fades (3-second smoothly interpolated)
   * ------------------------------------------------------------------ */
  function cancelFade() {
    if (fadeAnimationId) {
      cancelAnimationFrame(fadeAnimationId);
      fadeAnimationId = null;
    }
    isFadingOut = false;
  }

  function fadeIn(durationSec = FADE_DURATION) {
    if (!audio) return;
    cancelFade();

    const startVol = audio.volume;
    const startTime = performance.now();
    const durationMs = Math.max(100, durationSec * 1000);

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      audio.volume = startVol + (TARGET_VOLUME - startVol) * progress;

      if (progress < 1) {
        fadeAnimationId = requestAnimationFrame(step);
      } else {
        audio.volume = TARGET_VOLUME;
        fadeAnimationId = null;
      }
    }
    fadeAnimationId = requestAnimationFrame(step);
  }

  function fadeOut(durationSec = FADE_DURATION, onComplete = null) {
    if (!audio) {
      if (onComplete) onComplete();
      return;
    }
    cancelFade();
    isFadingOut = true;

    const startVol = audio.volume;
    const startTime = performance.now();
    const durationMs = Math.max(100, durationSec * 1000);

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      audio.volume = Math.max(0, startVol * (1 - progress));

      if (progress < 1) {
        fadeAnimationId = requestAnimationFrame(step);
      } else {
        audio.volume = 0;
        isFadingOut = false;
        fadeAnimationId = null;
        if (onComplete) onComplete();
      }
    }
    fadeAnimationId = requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------------
   * Track Randomization
   * ------------------------------------------------------------------ */
  function pickRandomIndex() {
    if (!playlist.length) return -1;
    if (playlist.length === 1) return 0;

    let next = Math.floor(Math.random() * playlist.length);
    if (next === lastTrackIndex) {
      next = (next + 1) % playlist.length;
    }
    return next;
  }

  function playTrack(index) {
    if (!playlist.length || index < 0 || index >= playlist.length) {
      setStatus('NO AUDIO FILES');
      return;
    }

    currentIndex = index;
    lastTrackIndex = index;
    updateTrackUI();

    const track = playlist[index];
    audio.src = track.file;
    audio.load();

    if (!isEnabled) {
      setStatus('MUSIC: OFF');
      if (playPauseBtn) playPauseBtn.textContent = 'PLAY';
      return;
    }

    audio.volume = 0;
    const p = audio.play();
    if (p !== undefined) {
      p.then(() => {
        isPlaying = true;
        setStatus('● PLAYING');
        if (playPauseBtn) playPauseBtn.textContent = 'PAUSE';
        fadeIn(FADE_DURATION);
      }).catch((err) => {
        isPlaying = false;
        if (playPauseBtn) playPauseBtn.textContent = 'PLAY';
        if (err.name === 'NotAllowedError') {
          setStatus('CLICK TO START MUSIC');
        } else {
          setStatus('AUDIO UNAVAILABLE');
        }
      });
    }
  }

  function nextTrack() {
    if (!playlist.length) return;
    const nextIdx = pickRandomIndex();
    if (isPlaying) {
      fadeOut(FADE_DURATION, () => {
        playTrack(nextIdx);
      });
    } else {
      playTrack(nextIdx);
    }
  }

  function togglePlayPause() {
    if (!audio) return;
    if (!isEnabled) {
      toggleMusic(true);
      return;
    }

    if (audio.paused) {
      const p = audio.play();
      if (p !== undefined) {
        p.then(() => {
          isPlaying = true;
          setStatus('● PLAYING');
          if (playPauseBtn) playPauseBtn.textContent = 'PAUSE';
          fadeIn(1.5);
        }).catch(() => {
          setStatus('CLICK TO START MUSIC');
        });
      }
    } else {
      fadeOut(1.0, () => {
        audio.pause();
        isPlaying = false;
        setStatus('❚❚ PAUSED');
        if (playPauseBtn) playPauseBtn.textContent = 'PLAY';
      });
    }
  }

  function toggleMusic(forceState = null) {
    isEnabled = forceState !== null ? forceState : !isEnabled;
    try {
      localStorage.setItem(PREF_ENABLED_KEY, String(isEnabled));
    } catch (_) {}

    if (toggleBtn) {
      toggleBtn.textContent = isEnabled ? 'ON' : 'OFF';
    }
    const footerToggle = document.querySelector('.music-toggle');
    if (footerToggle) {
      footerToggle.textContent = isEnabled ? 'ON' : 'OFF';
      footerToggle.classList.toggle('is-on', isEnabled);
    }

    if (isEnabled) {
      if (currentIndex === -1) {
        const next = pickRandomIndex();
        playTrack(next);
      } else {
        audio.volume = 0;
        const p = audio.play();
        if (p !== undefined) {
          p.then(() => {
            isPlaying = true;
            setStatus('● PLAYING');
            if (playPauseBtn) playPauseBtn.textContent = 'PAUSE';
            fadeIn(FADE_DURATION);
          }).catch(() => {
            setStatus('CLICK TO START MUSIC');
          });
        }
      }
    } else {
      cancelFade();
      if (audio) {
        audio.pause();
        audio.volume = 0;
      }
      isPlaying = false;
      setStatus('MUSIC: OFF');
      if (playPauseBtn) playPauseBtn.textContent = 'PLAY';
    }
  }

  /* ------------------------------------------------------------------
   * Automatic Directory Scanner
   * ------------------------------------------------------------------ */
  async function scanDirectory(urlPath) {
    try {
      const resp = await fetch(urlPath, { cache: 'no-store' });
      if (!resp.ok) return null;

      const contentType = resp.headers.get('content-type') || '';

      // Case 1: Server returned JSON list of filenames directly
      if (contentType.includes('application/json')) {
        const json = await resp.json();
        if (Array.isArray(json) && json.length > 0) {
          return json.map((f) => (typeof f === 'string' ? f : f.file || f.name));
        }
      }

      // Case 2: Server returned an HTML directory index listing (standard dev servers like live-server, python, apache)
      const text = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      const links = Array.from(doc.querySelectorAll('a'));
      const foundFiles = [];

      for (const a of links) {
        const href = a.getAttribute('href');
        if (!href) continue;
        const cleanHref = href.split('?')[0].split('#')[0];
        const lower = cleanHref.toLowerCase();
        const matches = AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
        if (matches) {
          // Extract filename only
          const filename = cleanHref.split('/').pop();
          if (filename && !foundFiles.includes(filename)) {
            foundFiles.push(filename);
          }
        }
      }

      if (foundFiles.length > 0) {
        return foundFiles;
      }
    } catch (_) {}
    return null;
  }

  async function discoverPlaylist(isManualRescan = false) {
    if (isManualRescan) {
      setStatus('SCANNING...');
    }

    // Try relative and absolute paths to playlist directories
    const candidateEndpoints = [
      'playlist/',
      '../playlist/',
      '/playlist/',
      'main/playlist/',
      '/main/playlist/'
    ];

    let discoveredFilenames = null;
    let successfulBase = 'playlist/';

    for (const endpoint of candidateEndpoints) {
      const result = await scanDirectory(endpoint);
      if (result && result.length > 0) {
        discoveredFilenames = result;
        successfulBase = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
        break;
      }
    }

    if (discoveredFilenames && discoveredFilenames.length > 0) {
      playlist = discoveredFilenames.map((filename) => {
        return {
          name: getTrackNameFromFilename(filename),
          file: `${successfulBase}${filename}`
        };
      });

      if (isManualRescan) {
        setStatus(`FOUND ${playlist.length} TRACKS`);
        setTimeout(() => {
          setStatus(isPlaying ? '● PLAYING' : (isEnabled ? 'MUSIC: READY' : 'MUSIC: OFF'));
        }, 1500);
      } else {
        setStatus('MUSIC: READY');
      }

      if (currentIndex === -1 || currentIndex >= playlist.length) {
        currentIndex = pickRandomIndex();
      }
      updateTrackUI();

      if (isEnabled && !isPlaying) {
        playTrack(currentIndex);
      }
    } else {
      setStatus('NO MUSIC FOUND');
      if (titleEl) titleEl.textContent = 'NO TRACKS IN /playlist/';
    }
  }

  /* ------------------------------------------------------------------
   * Retro Floating Window (STATIONARY - NO EVASIVE MOVEMENT)
   * ------------------------------------------------------------------ */
  function initFloatingWindow() {
    if (document.getElementById('retro-music-window')) return;

    // Inject Windows 98 / XP styling with strictly fixed bottom-right position
    const style = document.createElement('style');
    style.id = 'retro-music-window-style';
    style.textContent = `
      .retro-win98 {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 300px;
        background: #c0c0c0;
        color: #000;
        border: 2px outset #ffffff;
        box-shadow: 2px 2px 12px rgba(0,0,0,0.6);
        font-family: 'Tahoma', 'MS Sans Serif', 'Segoe UI', sans-serif;
        font-size: 11px;
        z-index: 10050;
        box-sizing: border-box;
        user-select: none;
      }
      .retro-win98.is-hidden {
        display: none !important;
      }
      .retro-win98-titlebar {
        background: linear-gradient(90deg, #000080, #1084d0);
        color: #ffffff;
        padding: 3px 5px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-weight: bold;
        letter-spacing: 0.5px;
      }
      .retro-win98-title {
        display: flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .retro-win98-close {
        width: 16px;
        height: 14px;
        background: #c0c0c0;
        border: 1px outset #ffffff;
        color: #000000;
        font-size: 9px;
        line-height: 10px;
        font-weight: bold;
        cursor: pointer;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .retro-win98-close:active {
        border-style: inset;
        padding-top: 1px;
        padding-left: 1px;
      }
      .retro-win98-body {
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .retro-win98-screen {
        background: #000000;
        color: #55ff99;
        font-family: 'Courier New', monospace;
        padding: 8px;
        border: 2px inset #808080;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-height: 54px;
        justify-content: center;
      }
      .retro-win98-track-title {
        font-size: 12px;
        font-weight: bold;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #55ff99;
      }
      .retro-win98-status {
        color: #ffb7ff;
        font-weight: bold;
        font-size: 10px;
        letter-spacing: 0.5px;
      }
      .retro-win98-controls {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr 1fr;
        gap: 4px;
      }
      .retro-win98-btn {
        background: #c0c0c0;
        color: #000000;
        border: 2px outset #ffffff;
        padding: 4px 2px;
        font-family: inherit;
        font-size: 10px;
        font-weight: bold;
        cursor: pointer;
        text-align: center;
        outline: none;
      }
      .retro-win98-btn:active {
        border-style: inset;
        padding: 5px 1px 3px 3px;
      }
      .retro-win98-btn:focus-visible {
        outline: 1px dotted #000;
      }
      /* Reopen pill button in bottom tray */
      .retro-music-reopen-tab {
        position: fixed;
        bottom: 12px;
        right: 12px;
        background: #1b0b2e;
        color: #55ff99;
        border: 1px solid #6f3a93;
        padding: 4px 10px;
        font-family: 'Courier New', monospace;
        font-size: 11px;
        font-weight: bold;
        cursor: pointer;
        z-index: 10040;
        box-shadow: 0 0 8px rgba(160,32,240,0.3);
        display: none;
      }
      .retro-music-reopen-tab:hover {
        background: #2b1145;
        border-color: #55ff99;
      }
      @media (max-width: 600px) {
        .retro-win98 {
          width: calc(100vw - 24px);
          left: 12px !important;
          right: 12px !important;
          bottom: 12px !important;
        }
      }
    `;
    document.head.appendChild(style);

    winEl = document.createElement('div');
    winEl.id = 'retro-music-window';
    winEl.className = 'retro-win98';
    winEl.setAttribute('role', 'dialog');
    winEl.setAttribute('aria-label', 'Retro Music Player');

    winEl.innerHTML = `
      <div class="retro-win98-titlebar">
        <div class="retro-win98-title">
          <span>♪</span>
          <span>MUSIC PLAYER</span>
        </div>
        <button class="retro-win98-close" aria-label="Close music player" title="Close">✕</button>
      </div>
      <div class="retro-win98-body">
        <div class="retro-win98-screen">
          <div class="retro-win98-track-title" id="retro-track-title">DISCOVERING TRACKS...</div>
          <div class="retro-win98-status" id="retro-track-status">MUSIC: READY</div>
        </div>
        <div class="retro-win98-controls">
          <button class="retro-win98-btn" id="retro-btn-play">PLAY</button>
          <button class="retro-win98-btn" id="retro-btn-next">NEXT</button>
          <button class="retro-win98-btn" id="retro-btn-toggle">ON</button>
          <button class="retro-win98-btn" id="retro-btn-rescan" title="Scan /playlist/ for newly added songs">RESCAN</button>
        </div>
      </div>
    `;
    document.body.appendChild(winEl);

    // Reopen button
    reopenBtn = document.createElement('button');
    reopenBtn.className = 'retro-music-reopen-tab';
    reopenBtn.setAttribute('aria-label', 'Open music player');
    reopenBtn.textContent = '♪ MUSIC PLAYER';
    document.body.appendChild(reopenBtn);

    // Check visibility preference
    try {
      const savedVis = localStorage.getItem(PREF_VISIBLE_KEY);
      if (savedVis !== null) {
        isWindowVisible = savedVis === 'true';
      }
    } catch (_) {}

    if (!isWindowVisible) {
      winEl.classList.add('is-hidden');
      reopenBtn.style.display = 'block';
    }

    // Element bindings
    titleEl = winEl.querySelector('#retro-track-title');
    statusEl = winEl.querySelector('#retro-track-status');
    playPauseBtn = winEl.querySelector('#retro-btn-play');
    nextBtn = winEl.querySelector('#retro-btn-next');
    toggleBtn = winEl.querySelector('#retro-btn-toggle');
    rescanBtn = winEl.querySelector('#retro-btn-rescan');
    closeBtn = winEl.querySelector('.retro-win98-close');

    // Event listeners
    playPauseBtn.addEventListener('click', togglePlayPause);
    nextBtn.addEventListener('click', nextTrack);
    toggleBtn.addEventListener('click', () => toggleMusic());
    rescanBtn.addEventListener('click', () => discoverPlaylist(true));

    closeBtn.addEventListener('click', () => {
      isWindowVisible = false;
      winEl.classList.add('is-hidden');
      if (reopenBtn) reopenBtn.style.display = 'block';
      try {
        localStorage.setItem(PREF_VISIBLE_KEY, 'false');
      } catch (_) {}
    });

    reopenBtn.addEventListener('click', () => {
      isWindowVisible = true;
      winEl.classList.remove('is-hidden');
      reopenBtn.style.display = 'none';
      try {
        localStorage.setItem(PREF_VISIBLE_KEY, 'true');
      } catch (_) {}
    });

    // Also connect existing footer toggle button if present
    const footerToggle = document.querySelector('.music-toggle');
    if (footerToggle) {
      footerToggle.addEventListener('click', () => {
        toggleMusic();
      });
    }

    // Connect footer "PLAYER ↗" link to reopen floating window
    const footerOpenLink = document.querySelector('.music-link');
    if (footerOpenLink) {
      footerOpenLink.addEventListener('click', (e) => {
        e.preventDefault();
        isWindowVisible = true;
        winEl.classList.remove('is-hidden');
        if (reopenBtn) reopenBtn.style.display = 'none';
        try {
          localStorage.setItem(PREF_VISIBLE_KEY, 'true');
        } catch (_) {}
      });
    }
  }

  /* ------------------------------------------------------------------
   * Audio Engine Initialization
   * ------------------------------------------------------------------ */
  function initAudio() {
    audio = new Audio();
    audio.preload = 'metadata';
    audio.loop = false;
    audio.volume = 0;

    audio.addEventListener('timeupdate', () => {
      if (!audio || !audio.duration || isFadingOut) return;
      const remaining = audio.duration - audio.currentTime;
      // Start 3-second fadeout before track naturally finishes
      if (remaining <= FADE_DURATION && remaining > 0 && isPlaying) {
        fadeOut(Math.min(remaining, FADE_DURATION), () => {
          nextTrack();
        });
      }
    });

    audio.addEventListener('ended', () => {
      if (!isFadingOut) {
        nextTrack();
      }
    });

    audio.addEventListener('error', () => {
      setStatus('UNABLE TO LOAD TRACK');
      isPlaying = false;
      if (playPauseBtn) playPauseBtn.textContent = 'PLAY';
    });
  }

  // Restore stored preferences
  try {
    const saved = localStorage.getItem(PREF_ENABLED_KEY);
    if (saved !== null) {
      isEnabled = saved === 'true';
    } else {
      isEnabled = false;
    }
  } catch (_) {
    isEnabled = false;
  }

  // Startup lifecycle
  initAudio();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initFloatingWindow();
      if (toggleBtn) toggleBtn.textContent = isEnabled ? 'ON' : 'OFF';
      discoverPlaylist(false);
    });
  } else {
    initFloatingWindow();
    if (toggleBtn) toggleBtn.textContent = isEnabled ? 'ON' : 'OFF';
    discoverPlaylist(false);
  }
})();
