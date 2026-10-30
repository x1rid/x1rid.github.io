/* -----------------------------------------------------------------------
 *  Page chrome — the small honest bits of the interface
 *
 *  Everything here reflects real state:
 *    - status rail: current pane, actual playback state, real local clock
 *    - page counter: an approximate third-party page-view count
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
    const railPointer = document.querySelector('.rail-pointer');
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
        // Use profile-derived display name when available; fall back to site handle
        const handle = (window.ProfileService && window.ProfileService.current &&
                        window.ProfileService.current().name) || 'r3d1bruh';
        railPane.textContent = `${handle}://${visiblePaneName()}`;
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

    /* ------------------------------------------------------------------
     * Cursor readout — only in the `rail` scheme. The custom cursor owns
     * pointer state otherwise; this is the native-cursor alternative.
     * Coordinates are viewport pixels, zero-padded so the rail does not
     * jitter, and the state vocabulary is the same one the cursor uses.
     * ------------------------------------------------------------------ */
    const POINTER_LABELS = {
        default: '—',
        link: 'LINK',
        text: 'TEXT',
        drag: 'DRAG',
        frame: 'FRAME',
        splitter: 'RESIZE',
        disabled: 'N/A',
    };

    function setPointerRail(active) {
        if (!railPointer) return;
        railPointer.hidden = !active;
        if (!active) railPointer.textContent = 'PTR ----,---- · —';
    }

    function onCursorChange(event) {
        const detail = event && event.detail ? event.detail : {};
        setPointerRail(detail.effective === 'rail');
    }

    function onPointerState(event) {
        if (!railPointer || railPointer.hidden) return;
        const detail = event && event.detail ? event.detail : {};

        if (detail.active === false) {
            railPointer.textContent = 'PTR ----,---- · —';
            return;
        }

        const x = String(Math.max(0, Math.round(Number(detail.x) || 0))).padStart(4, '0');
        const y = String(Math.max(0, Math.round(Number(detail.y) || 0))).padStart(4, '0');
        const label = POINTER_LABELS[detail.state] || '—';
        railPointer.textContent = `PTR ${x},${y} · ${label}`;
    }

    document.addEventListener('site:cursorchange', onCursorChange);
    document.addEventListener('site:pointerstate', onPointerState);

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

    /* The cursor module applies its stored scheme before this file runs, so
       read the current effective scheme once instead of waiting for an event. */
    if (window.SiteCursor && typeof window.SiteCursor.getEffectiveScheme === 'function') {
        setPointerRail(window.SiteCursor.getEffectiveScheme() === 'rail');
    }

    /* ------------------------------------------------------------------
     * Page counter — approximate global page views from a public counter API.
     * It is intentionally labelled as page views, not unique visitors.
     * ------------------------------------------------------------------ */
    const counter = document.querySelector('.hit-counter');
    if (counter) {
        const COUNTER_BASE = 'https://abacus.jasoncameron.dev';
        const COUNTER_KEY = 'x1rid.github.io/visits';
        const SESSION_KEY = 'retroGlobalPageView';
        const counted = (() => {
            try {
                return sessionStorage.getItem(SESSION_KEY) === '1';
            } catch (_) {
                return false;
            }
        })();
        const endpoint = `${COUNTER_BASE}/${counted ? 'get' : 'hit'}/${COUNTER_KEY}`;

        fetch(endpoint, { cache: 'no-store' })
            .then((response) => {
                if (!response.ok) throw new Error(`counter request failed: ${response.status}`);
                return response.json();
            })
            .then((data) => {
                const value = Number(data && data.value);
                if (!Number.isFinite(value) || value < 0) {
                    throw new Error('counter response did not contain a valid value');
                }
                counter.textContent = String(Math.floor(value)).padStart(6, '0');
                try {
                    sessionStorage.setItem(SESSION_KEY, '1');
                } catch (_) {
                    /* A blocked session store only affects hit deduplication. */
                }
            })
            .catch((error) => {
                console.warn('page counter unavailable:', error);
                counter.textContent = '------';
            });
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
