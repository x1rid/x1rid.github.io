/* ---------------------------------------------------------------------------
 * shell/state.js
 *
 * Shared shell state: DOM references, the live window map, persisted-window-state bridge, z-order and
 * small helpers. Every other shell/*.js file reads and writes these bindings (classic scripts share one
 * global lexical scope, exactly as the old single inline closure did).
 *
 * Loaded as a classic script. Top-level bindings are shared between shell files;
 * runtime statements live in shellInit_* functions that boot.js calls in order
 * after window.ProfileReady.
 * ------------------------------------------------------------------------- */
'use strict';

/* Shared bindings (assigned in the shellInit_* chunks below). */
let desktop, taskbar, taskbarApps, taskbarClock, startButton, startMenu, startInput, startResults,
    startClose, shellToast, wallpaperToggle, showDesktopButton, clippyToggle, explorerNode,
    terminalTemplate, wallpaperCanvas, musicNode, programsNode, programsButton, taskbarMusic,
    miniOpen, miniPlay, miniNext, miniTrack, musicTrackTitle, musicStatus, musicProgress,
    musicTime, musicDuration, musicPlay, musicPrev, musicNext, musicVolume, musicVolumeValue,
    musicList, musicCount, musicSource, windows, restoringWindows, windowState, shellStartedAt,
    zCounter, activeWindowId, terminalCount, terminalSessions, shellShortcutsRegistered,
    toastTimer, showDesktopState, searchItems, searchActiveIndex, musicAudio, musicTracks,
    musicIndex, musicPlaying, musicLoading, musicBlocked, musicError, musicDiscovering,
    musicSeeking, musicPendingPlay, musicSourceReady, musicLoadToken, musicVolumeLevel,
    musicSourceLabel, clamp, escapeHtml;

function persistWindowState() {
    if (windowState && !restoringWindows) windowState.schedule();
}

function setActiveWindowMarker(id) {
    document.body.dataset.activeWindow = id || 'none';
}

function clearShowDesktopState() {
    if (!showDesktopState) return;
    showDesktopState = null;
    showDesktopButton.setAttribute('aria-pressed', 'false');
}

/* Original inline-script statements, lines 5-83+ */
function shellInit_state_1() {
    desktop = document.getElementById('desktop');

    taskbar = document.getElementById('taskbar');

    taskbarApps = document.getElementById('taskbar-apps');

    taskbarClock = document.getElementById('taskbar-clock');

    startButton = document.getElementById('start-button');

    startMenu = document.getElementById('start-menu');

    startInput = document.getElementById('start-input');

    startResults = document.getElementById('start-results');

    startClose = document.getElementById('start-close');

    shellToast = document.getElementById('shell-toast');

    wallpaperToggle = document.getElementById('wallpaper-toggle');

    showDesktopButton = document.getElementById('show-desktop');

    clippyToggle = document.getElementById('clippy-toggle');

    explorerNode = document.getElementById('explorer');

    terminalTemplate = document.getElementById('terminal-template');

    wallpaperCanvas = document.getElementById('wallpaper');

    musicNode = document.getElementById('music');

    programsNode = document.getElementById('programs');

    programsButton = document.getElementById('programs-button');

    taskbarMusic = document.getElementById('taskbar-music');

    miniOpen = document.getElementById('mini-open');

    miniPlay = document.getElementById('mini-play');

    miniNext = document.getElementById('mini-next');

    miniTrack = document.getElementById('mini-track');

    musicTrackTitle = document.getElementById('music-track-title');

    musicStatus = document.getElementById('music-status');

    musicProgress = document.getElementById('music-progress');

    musicTime = document.getElementById('music-time');

    musicDuration = document.getElementById('music-duration');

    musicPlay = document.getElementById('music-play');

    musicPrev = document.getElementById('music-prev');

    musicNext = document.getElementById('music-next');

    musicVolume = document.getElementById('music-volume');

    musicVolumeValue = document.getElementById('music-volume-value');

    musicList = document.getElementById('music-list');

    musicCount = document.getElementById('music-count');

    musicSource = document.getElementById('music-source');

    windows = new Map();

    restoringWindows = true;

    windowState = window.ProfileWindowState ? window.ProfileWindowState.create({
        profileId: (window.ProfileService && window.ProfileService.getActiveProfile() || {}).id,
        getWindows: () => windows,
        getWMState: () => (window.ShellWM ? window.ShellWM.snapshotState() : null)
    }) : null;

    if (windowState) windowState.setRestoring(true);

    shellStartedAt = Date.now();

    zCounter = 10;

    activeWindowId = null;

    terminalCount = 0;

    terminalSessions = new Map();

    shellShortcutsRegistered = false;

    toastTimer = 0;

    showDesktopState = null;

    searchItems = [];

    searchActiveIndex = -1;

    musicAudio = null;

    musicTracks = [];

    musicIndex = -1;

    musicPlaying = false;

    musicLoading = false;

    musicBlocked = false;

    musicError = false;

    musicDiscovering = true;

    musicSeeking = false;

    musicPendingPlay = false;

    musicSourceReady = false;

    musicLoadToken = 0;

    musicVolumeLevel = 0.45;

    musicSourceLabel = 'playlist/';

    clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    escapeHtml = (value) => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
