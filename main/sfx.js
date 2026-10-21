/* -----------------------------------------------------------------------
 * Retro interface sounds (opt-in)
 *
 *  - Off by default; the footer SFX control or `sound on` turns it on.
 *    `sound test` auditions the whole voice set once enabled.
 *  - Short Web Audio synth voices only: no audio files, no network, no
 *    autoplay before a user gesture.
 *  - Clicks and terminal keys confirm actions. Hover, wheel and continuous
 *    drag stay silent so the page does not become a click orchestra.
 *  - The music player has its own preference and volume. This module only
 *    owns interface effects.
 * ----------------------------------------------------------------------- */
(() => {
    'use strict';

    const STORAGE_KEY = 'retroSfxEnabled';
    /* Kept deliberately above the music player's default level (0.06 in
       music.js) so interface feedback cuts through the bed without needing a
       ducking sidechain. */
    const MASTER_GAIN = 0.9;
    const MAX_VOICES = 12;

    const INTERACTIVE_SELECTOR = [
        'a[href]',
        'button',
        'input',
        'select',
        'textarea',
        'summary',
        'label',
        '[role="button"]',
        '[role="link"]',
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="separator"]',
        '.social-tile',
        '.panel-splitter'
    ].join(',');

    const SKIP_CLICK_SELECTOR = '.sfx-toggle, .phone-keys, .terminal-input, #terminal-input';
    const ERROR_RE = /not recognized|usage:|cannot find|not found|no manual entry|could not|failed|unknown|invalid|unavailable|denied|permission/i;
    const ERROR_CHECK_COMMANDS = new Set([
        'dir', 'ls', 'cd', 'start', 'open', 'man', 'rm', 'rmdir', 'cp',
        'save', 'load', 'layout', 'promptgap', 'cursor', 'sound'
    ]);
    const BUILTIN_COMMANDS = new Set([
        'cls', 'dir', 'ls', 'cd', 'start', 'open', 'echo', 'man', 'rm',
        'rmdir', 'cp', 'save', 'load', 'saved-files', 'neofetch', 'layout',
        'promptgap', 'cursor', 'sound', 'help'
    ]);
    const COOLDOWN_MS = {
        click: 35,
        context: 90,
        key: 20,
        enter: 35,
        success: 180,
        error: 240,
        pane: 90,
        windowOpen: 110,
        windowClose: 110,
        enable: 0
    };
    const SOUND_NAMES = [
        'click', 'context', 'key', 'enter', 'success', 'error',
        'pane', 'windowOpen', 'windowClose', 'enable'
    ];

    let enabled = readPreference();
    let gestureArmed = false;
    let audioCtx = null;
    let master = null;
    let noiseBuffer = null;
    let panel = null;
    let toggleButton = null;
    let resultTimer = 0;
    const lastPlayed = Object.create(null);
    const activeVoices = new Set();

    function readPreference() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw === '1' || raw === 'true' || raw === 'on';
        } catch (_) {
            return false;
        }
    }

    function writePreference(value) {
        try {
            localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
        } catch (_) {
            /* storage can be disabled */
        }
    }

    function emitChange() {
        try {
            document.dispatchEvent(new CustomEvent('site:soundchange', {
                detail: { enabled }
            }));
        } catch (_) {
            /* CustomEvent is available in every browser this site supports. */
        }
    }

    function makeNoiseBuffer(context) {
        const length = Math.max(1, Math.floor(context.sampleRate * 0.4));
        const buffer = context.createBuffer(1, length, context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i += 1) {
            data[i] = Math.random() * 2 - 1;
        }
        return buffer;
    }

    function ensureContext() {
        if (audioCtx && audioCtx.state === 'closed') {
            audioCtx = null;
            master = null;
            noiseBuffer = null;
            activeVoices.clear();
        }

        if (audioCtx) {
            if (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted') {
                try {
                    audioCtx.resume().catch(() => {});
                } catch (_) {
                    /* older engines return undefined */
                }
            }
            return audioCtx;
        }

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;

        try {
            audioCtx = new AudioContextClass();
            master = audioCtx.createGain();
            master.gain.value = MASTER_GAIN;
            master.connect(audioCtx.destination);
            noiseBuffer = makeNoiseBuffer(audioCtx);
        } catch (_) {
            audioCtx = null;
            master = null;
            noiseBuffer = null;
            return null;
        }

        if (audioCtx.state === 'suspended') {
            try {
                audioCtx.resume().catch(() => {});
            } catch (_) {
                /* ignore */
            }
        }

        return audioCtx;
    }

    function jitter(frequency, cents) {
        const amount = (Math.random() * 2 - 1) * (cents / 1200);
        return Math.max(20, frequency * Math.pow(2, amount));
    }

    function tone(options) {
        if (!audioCtx || !master || activeVoices.size >= MAX_VOICES) return;

        const settings = options || {};
        const frequency = Math.max(20, Number(settings.frequency) || 220);
        const endFrequency = Number(settings.endFrequency) || 0;
        const duration = Math.max(0.012, Number(settings.duration) || 0.08);
        const delay = Math.max(0, Number(settings.delay) || 0);
        const peak = Math.max(0.0002, Number(settings.gain) || 0.04);
        const attack = Math.min(Math.max(0.002, Number(settings.attack) || 0.004), duration * 0.45);
        const start = audioCtx.currentTime + delay;

        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.type = settings.type || 'triangle';
        osc.frequency.setValueAtTime(frequency, start);
        if (endFrequency > 0 && Math.abs(endFrequency - frequency) > 0.5) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
        }

        gainNode.gain.setValueAtTime(0.0001, start);
        gainNode.gain.exponentialRampToValueAtTime(peak, start + attack);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        osc.connect(gainNode);
        gainNode.connect(master);
        activeVoices.add(osc);
        osc.addEventListener('ended', () => {
            activeVoices.delete(osc);
            osc.disconnect();
            gainNode.disconnect();
        }, { once: true });
        osc.start(start);
        osc.stop(start + duration + 0.02);
    }

    function noiseBurst(options) {
        if (!audioCtx || !master || !noiseBuffer || activeVoices.size >= MAX_VOICES) return;

        const settings = options || {};
        const duration = Math.max(0.01, Number(settings.duration) || 0.02);
        const delay = Math.max(0, Number(settings.delay) || 0);
        const peak = Math.max(0.0002, Number(settings.gain) || 0.05);
        const start = audioCtx.currentTime + delay;

        const source = audioCtx.createBufferSource();
        const filter = audioCtx.createBiquadFilter();
        const gainNode = audioCtx.createGain();

        source.buffer = noiseBuffer;
        filter.type = settings.type || 'bandpass';
        filter.frequency.setValueAtTime(Math.max(80, Number(settings.frequency) || 1800), start);
        filter.Q.setValueAtTime(Math.max(0.1, Number(settings.q) || 0.9), start);

        gainNode.gain.setValueAtTime(0.0001, start);
        gainNode.gain.exponentialRampToValueAtTime(peak, start + 0.002);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        source.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(master);
        activeVoices.add(source);
        source.addEventListener('ended', () => {
            activeVoices.delete(source);
            source.disconnect();
            filter.disconnect();
            gainNode.disconnect();
        }, { once: true });
        source.start(start);
        source.stop(start + duration + 0.01);
    }

    /* Each voice deliberately uses a different register, envelope and timbre.
       A click is a bright tick with a low thock; a key is almost pure high
       tick; Enter is a heavier carriage return; success is a rising arpeggio;
       error is a descending square-wave buzzer; panes and windows have their
       own relay/servo sounds. */
    const SOUNDS = {
        click() {
            noiseBurst({ duration: 0.014, gain: 0.15, frequency: jitter(2250, 170), q: 1.15 });
            tone({ frequency: jitter(205, 9), endFrequency: 132, duration: 0.032, type: 'triangle', gain: 0.075 });
        },

        context() {
            noiseBurst({ duration: 0.018, gain: 0.035, frequency: 360, q: 0.7 });
            tone({ frequency: 104, endFrequency: 64, duration: 0.12, type: 'sine', gain: 0.14 });
        },

        key() {
            noiseBurst({ duration: 0.008, gain: 0.12, frequency: jitter(3100, 230), q: 1.5 });
            tone({ frequency: jitter(760, 16), duration: 0.014, type: 'triangle', gain: 0.03 });
        },

        enter() {
            noiseBurst({ duration: 0.016, gain: 0.09, frequency: 1100, q: 1 });
            tone({ frequency: 154, endFrequency: 94, duration: 0.07, type: 'triangle', gain: 0.1 });
        },

        success() {
            /* Major arpeggio: unmistakably a phrase rather than a click. */
            tone({ frequency: 523.25, duration: 0.09, type: 'sine', gain: 0.085 });
            tone({ frequency: 659.25, duration: 0.11, type: 'sine', gain: 0.085, delay: 0.065 });
            tone({ frequency: 783.99, duration: 0.17, type: 'sine', gain: 0.09, delay: 0.13 });
            tone({ frequency: 1046.5, duration: 0.1, type: 'triangle', gain: 0.025, delay: 0.17 });
        },

        error() {
            /* Descending, slightly detuned square buzz. */
            noiseBurst({ duration: 0.012, gain: 0.03, frequency: 700, q: 0.6 });
            tone({ frequency: 196, endFrequency: 164.81, duration: 0.15, type: 'square', gain: 0.04 });
            tone({ frequency: 146.83, endFrequency: 123.47, duration: 0.17, type: 'square', gain: 0.04, delay: 0.1 });
            tone({ frequency: 98, endFrequency: 82, duration: 0.2, type: 'sine', gain: 0.06, delay: 0.08 });
        },

        pane() {
            /* Two-part relay: a hard tick, then a short lower confirmation. */
            noiseBurst({ duration: 0.011, gain: 0.08, frequency: 1450, q: 1.1 });
            tone({ frequency: 392, duration: 0.032, type: 'square', gain: 0.022 });
            tone({ frequency: 294, endFrequency: 247, duration: 0.1, type: 'triangle', gain: 0.065, delay: 0.045 });
        },

        windowOpen() {
            /* Rising servo/air sweep. */
            noiseBurst({ duration: 0.06, gain: 0.06, frequency: 520, q: 0.55 });
            tone({ frequency: 168, endFrequency: 420, duration: 0.19, type: 'sine', gain: 0.08 });
            tone({ frequency: 660, duration: 0.075, type: 'triangle', gain: 0.03, delay: 0.16 });
        },

        windowClose() {
            /* Falling mirror of windowOpen. */
            noiseBurst({ duration: 0.055, gain: 0.055, frequency: 420, q: 0.55 });
            tone({ frequency: 390, endFrequency: 145, duration: 0.19, type: 'sine', gain: 0.075 });
            tone({ frequency: 220, duration: 0.075, type: 'triangle', gain: 0.028, delay: 0.16 });
        },

        enable() {
            /* Power-on: a soft relay swell, a low hum and a near-simultaneous
               major chord. The chord (rather than an arpeggio) keeps this
               distinct from the success phrase. */
            noiseBurst({ duration: 0.1, gain: 0.035, frequency: 900, q: 0.45 });
            tone({ frequency: 98, duration: 0.42, type: 'sine', gain: 0.06 });
            [392, 523.25, 659.25, 783.99].forEach((frequency, index) => {
                tone({
                    frequency,
                    duration: 0.28,
                    type: 'triangle',
                    gain: 0.045,
                    delay: 0.02 + index * 0.012
                });
            });
            tone({ frequency: 1568, duration: 0.12, type: 'sine', gain: 0.018, delay: 0.2 });
        }
    };

    function play(name) {
        if (!enabled || document.visibilityState === 'hidden') return false;
        if (!SOUNDS[name]) return false;

        const now = Date.now();
        const cooldown = COOLDOWN_MS[name] || 0;
        if (lastPlayed[name] && now - lastPlayed[name] < cooldown) return false;

        /* Never create an AudioContext from a load-time or programmatic pane
           event. The browser only allows audio after a real user gesture. */
        if (!audioCtx && !gestureArmed) return false;
        if (!ensureContext()) return false;
        lastPlayed[name] = now;

        try {
            SOUNDS[name]();
        } catch (_) {
            return false;
        }
        return true;
    }

    function syncUI() {
        document.documentElement.dataset.sfx = enabled ? 'on' : 'off';

        if (panel) {
            panel.classList.toggle('is-on', enabled);
        }

        if (toggleButton) {
            toggleButton.textContent = enabled ? 'ON' : 'OFF';
            toggleButton.setAttribute('aria-pressed', String(enabled));
            toggleButton.setAttribute('aria-label', enabled
                ? 'Disable retro interface sounds'
                : 'Enable retro interface sounds');
            toggleButton.title = enabled
                ? 'Retro interface sounds: on'
                : 'Retro interface sounds: off';
        }
    }

    function setEnabled(value) {
        const next = Boolean(value);
        if (next === enabled) {
            syncUI();
            return enabled;
        }

        if (!next) play('click');
        enabled = next;
        writePreference(enabled);
        syncUI();
        emitChange();

        if (enabled) play('enable');
        return enabled;
    }

    function closestInteractive(target) {
        if (!target || typeof target.closest !== 'function') return null;
        if (target.closest(SKIP_CLICK_SELECTOR)) return null;

        const element = target.closest(INTERACTIVE_SELECTOR);
        if (!element) return null;
        if (element.closest('[disabled], [aria-disabled="true"]')) return null;
        return element;
    }

    function isTerminalInput(target) {
        return !!(target && typeof target.closest === 'function' &&
            target.closest('#terminal-input, .terminal-input'));
    }

    function onClick(event) {
        gestureArmed = true;
        if (!enabled) return;
        /* Keyboard activation is handled on keydown: the browser also emits a
           click with detail 0, which would double the sound. */
        if (event.detail === 0) return;
        if (closestInteractive(event.target)) play('click');
    }

    function onContextMenu(event) {
        gestureArmed = true;
        if (!enabled) return;
        if (closestInteractive(event.target)) play('context');
    }

    function resolveTerminalResult(command, output, beforeCount) {
        if (!output) return;

        const parts = String(command || '').trim().split(/\s+/);
        const name = parts[0].toLowerCase();
        if (name === 'sound') {
            const setting = (parts[1] || '').toLowerCase();
            /* Valid sound commands play their own click/chime. Invalid ones
               fall through to the normal error voice. */
            if (!setting || setting === 'on' || setting === 'off' ||
                setting === 'toggle' || setting === 'test') return;
        }

        const newLines = Array.from(output.children).slice(Math.max(0, beforeCount));
        const body = name === 'neofetch' ? newLines : newLines.slice(1);
        /* An opened man page can contain any prose. For man, only the first
           couple of lines are status output; scanning the whole page would
           turn quoted words like "not found" into a false error tone. */
        const checkLines = name === 'man' ? body.slice(0, 2) : body;
        const text = checkLines.map((line) => line.textContent || '').join('\n');

        const unknown = !BUILTIN_COMMANDS.has(name);
        const failed = unknown || (ERROR_CHECK_COMMANDS.has(name) && ERROR_RE.test(text));
        play(failed ? 'error' : 'success');
    }

    function onTerminalKey(event) {
        if (event.isComposing) return;

        const key = event.key;
        if (key === 'Enter') {
            play('enter');

            const input = event.target;
            const command = String(input && input.value || '').trim();
            if (!command) return;

            const output = document.getElementById('terminal-output');
            const beforeCount = output ? output.children.length : 0;

            if (resultTimer) clearTimeout(resultTimer);
            resultTimer = window.setTimeout(() => {
                resultTimer = 0;
                resolveTerminalResult(command, output, beforeCount);
            }, 90);
            return;
        }

        if (key === 'Backspace' || key === 'Delete') {
            play('key');
            return;
        }

        if (key && key.length === 1) play('key');
    }

    function onKeyDown(event) {
        gestureArmed = true;
        if (!enabled || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;

        if (isTerminalInput(event.target)) {
            onTerminalKey(event);
            return;
        }

        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            if (closestInteractive(event.target)) play('click');
        }
    }

    function onPaneChange() {
        play('pane');
    }

    function onWindowChange(event) {
        const detail = event && event.detail ? event.detail : {};
        if (detail.id !== 'music') return;
        play(detail.visible ? 'windowOpen' : 'windowClose');
    }

    function onStorage(event) {
        if (!event || event.key !== STORAGE_KEY) return;
        enabled = event.newValue === '1' || event.newValue === 'true' || event.newValue === 'on';
        syncUI();
        emitChange();
    }

    function onVisibilityChange() {
        if (document.visibilityState !== 'hidden' || !audioCtx || audioCtx.state !== 'running') return;
        try {
            audioCtx.suspend().catch(() => {});
        } catch (_) {
            /* ignore */
        }
    }

    function init() {
        panel = document.querySelector('.sfx-panel');
        toggleButton = document.querySelector('.sfx-toggle');

        if (panel) panel.hidden = false;
        if (toggleButton) {
            toggleButton.addEventListener('click', () => {
                setEnabled(!enabled);
            });
        }

        syncUI();

        document.addEventListener('click', onClick, true);
        document.addEventListener('contextmenu', onContextMenu, true);
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('site:panechange', onPaneChange);
        document.addEventListener('site:windowchange', onWindowChange);
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('storage', onStorage);
    }

    window.SiteSfx = {
        isEnabled() {
            return enabled;
        },
        setEnabled(value) {
            return setEnabled(value);
        },
        toggle() {
            return setEnabled(!enabled);
        },
        play(name) {
            return play(String(name || ''));
        },
        sounds: SOUND_NAMES.slice()
    };

    init();
})();
