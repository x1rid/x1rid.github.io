/* -----------------------------------------------------------------------
 *  Page chrome — the small honest bits of the interface
 *
 *  Everything here reflects real state:
 *    - status rail: current pane, actual playback state, real local clock
 *    - visit counter: this browser's local visit count (never a fake number)
 *    - focused-window state: which column/window was last used
 *
 *  Every part degrades silently when its markup is missing.
 * ----------------------------------------------------------------------- */
(() => {
    'use strict';

    /* ------------------------------------------------------------------
     * Status rail
     * ------------------------------------------------------------------ */
    const railPane = document.querySelector('.rail-pane');
    const railTrack = document.querySelector('.rail-track');
    const railClock = document.querySelector('.rail-clock');
    const contentArea = document.querySelector('.content-area');

    const PANES = [
        ['link-exchange', 'link-exchange'],
        ['pc-specs', 'neofetch'],
        ['webpage-pane', 'web'],
    ];

    function visiblePaneName() {
        for (let i = 0; i < PANES.length; i += 1) {
            const element = document.getElementById(PANES[i][0]);
            if (element && element.style.display !== 'none') return PANES[i][1];
        }
        return PANES[0][1];
    }

    function syncPane() {
        if (!railPane) return;
        railPane.textContent = `r3d1bruh://${visiblePaneName()}`;
    }

    function syncTrack() {
        if (!railTrack) return;

        const nowPlaying = document.querySelector('.music-now-playing');
        const player = document.getElementById('retro-music-window');
        const dock = document.getElementById('retro-music-mini');

        let label = nowPlaying ? String(nowPlaying.textContent || '').trim() : '';
        label = label.replace(/^now playing:\s*/i, '').trim();

        const idleLabels = ['', 'ready', 'music off', 'no audio files', 'track unavailable', 'scanning'];
        const hasTrack = !idleLabels.includes(label.toLowerCase());
        const isPlaying = Boolean(
            (player && player.classList.contains('is-playing')) ||
            (dock && dock.classList.contains('is-playing'))
        );

        if (hasTrack && isPlaying) {
            railTrack.textContent = `♫ ${label}`;
            railTrack.classList.add('is-playing');
        } else if (hasTrack) {
            railTrack.textContent = 'PAUSED';
            railTrack.classList.remove('is-playing');
        } else {
            railTrack.textContent = '--';
            railTrack.classList.remove('is-playing');
        }
    }

    function syncClock() {
        if (!railClock) return;
        railClock.textContent = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
    }

    if ('MutationObserver' in window) {
        if (contentArea) {
            new MutationObserver(syncPane).observe(contentArea, {
                attributes: true,
                attributeFilter: ['style'],
                subtree: true,
            });
        }

        const nowPlaying = document.querySelector('.music-now-playing');
        if (nowPlaying) {
            new MutationObserver(syncTrack).observe(nowPlaying, {
                characterData: true,
                childList: true,
                subtree: true,
            });
        }

        ['retro-music-window', 'retro-music-mini'].forEach((id) => {
            const element = document.getElementById(id);
            if (element) {
                new MutationObserver(syncTrack).observe(element, {
                    attributes: true,
                    attributeFilter: ['class'],
                });
            }
        });
    }

    syncPane();
    syncTrack();
    syncClock();
    window.setInterval(syncClock, 30000);

    /* ------------------------------------------------------------------
     * Visit counter — local to this browser, incremented once per session.
     * Starts at the old joke value on a first visit.
     * ------------------------------------------------------------------ */
    const counter = document.querySelector('.hit-counter');
    if (counter) {
        try {
            const VISITS_KEY = 'retroVisits';
            const SESSION_KEY = 'retroVisitSession';

            const raw = localStorage.getItem(VISITS_KEY);
            let visits = raw === null ? 1336 : Number(raw);
            if (!Number.isFinite(visits) || visits < 0) visits = 1336;

            if (!sessionStorage.getItem(SESSION_KEY)) {
                visits += 1;
                localStorage.setItem(VISITS_KEY, String(visits));
                sessionStorage.setItem(SESSION_KEY, '1');
            }

            counter.textContent = String(visits).padStart(6, '0');
        } catch (_) {
            /* Storage disabled: keep the static fallback number. */
        }
    }

    /* ------------------------------------------------------------------
     * Focused window — only after real interaction, so touch, no-JS and
     * first-load users never see the page change on its own.
     * ------------------------------------------------------------------ */
    const container = document.querySelector('.geocities-container');

    function zoneFor(target) {
        if (!container || !target || typeof target.closest !== 'function') return null;
        if (target.closest('#retro-music-window, #retro-music-mini, .music-panel')) return 'music';
        if (target.closest('.sidebar')) return 'sidebar';
        if (target.closest('.content-area')) return 'content';
        return null;
    }

    function onInteraction(event) {
        if (!container) return;
        const zone = zoneFor(event.target);
        if (zone) {
            container.dataset.focus = zone;
        } else if (container.dataset.focus === 'music') {
            /* Clicking back onto the desktop releases the music window. */
            delete container.dataset.focus;
        }
    }

    document.addEventListener('pointerdown', onInteraction, true);
    document.addEventListener('focusin', onInteraction, true);
})();
