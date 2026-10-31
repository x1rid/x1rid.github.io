/* ---------------------------------------------------------------------------
 *  Vendored 98.js programs.
 *
 *  These are the upstream programs from https://github.com/1j01/98, copied
 *  under ./vendor/98 and re-pointed at the site palette by
 *  ./vendor/98/theme.css. They run in same-origin frames so their original
 *  scripts, menus, WebGL and WASM assets stay untouched.
 * ------------------------------------------------------------------------- */
(() => {
    'use strict';

    const ICONS = {
        flowerbox: `
            <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                <rect x="2" y="2" width="28" height="28" fill="#07020a" stroke="#6f3a93"></rect>
                <path d="M16 6l7 5v9l-7 5-7-5v-9z" fill="none" stroke="#c084fc" stroke-width="1.2"></path>
                <path d="M16 6v9m0 0l7-4m-7 4l-7-4m7 4v10" stroke="#ff4fd8" stroke-width="1"></path>
                <circle cx="16" cy="15" r="2.4" fill="#55ff99"></circle>
            </svg>`,
        notepad: `
            <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                <path d="M7 4h13l5 5v19H7z" fill="#0e061e" stroke="#6f3a93"></path>
                <path d="M20 4v6h5" fill="none" stroke="#6f3a93"></path>
                <path d="M11 15h10M11 19h10M11 23h7" stroke="#c084fc" stroke-width="1.3"></path>
            </svg>`,
        pinball: `
            <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                <rect x="2" y="2" width="28" height="28" fill="#07020a" stroke="#6f3a93"></rect>
                <path d="M9 24l5-12M23 24l-5-12" stroke="#c084fc" stroke-width="2.2"></path>
                <circle cx="16" cy="10" r="3" fill="#f2eaff" stroke="#ff4fd8"></circle>
                <path d="M8 27h16" stroke="#55ff99" stroke-width="1.4"></path>
            </svg>`,
        pipes: `
            <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                <rect x="2" y="2" width="28" height="28" fill="#07020a" stroke="#6f3a93"></rect>
                <path d="M8 24V14a6 6 0 016-6h10" fill="none" stroke="#c084fc" stroke-width="5"></path>
                <path d="M8 24V14a6 6 0 016-6h10" fill="none" stroke="#ff4fd8" stroke-width="1.4"></path>
                <path d="M6 6h4M22 22h4" stroke="#55ff99" stroke-width="2"></path>
            </svg>`,
        soundrecorder: `
            <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                <rect x="2" y="2" width="28" height="28" fill="#07020a" stroke="#6f3a93"></rect>
                <path d="M16 7a3 3 0 00-3 3v6a3 3 0 006 0v-6a3 3 0 00-3-3z" fill="none" stroke="#c084fc" stroke-width="1.4"></path>
                <path d="M10 16a6 6 0 0012 0M16 22v4M12 26h8" fill="none" stroke="#c084fc" stroke-width="1.4"></path>
                <path d="M5 14v4M27 14v4" stroke="#ff4fd8" stroke-width="1.2"></path>
            </svg>`,
        winamp: `
            <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                <rect x="2" y="2" width="28" height="28" fill="#07020a" stroke="#6f3a93"></rect>
                <path d="M13 8l11 8-11 8z" fill="#c084fc" stroke="#f2eaff" stroke-width="0.8"></path>
                <path d="M8 8v16M25 8v16" stroke="#ff4fd8" stroke-width="1.2"></path>
            </svg>`,
        controlpanel: `
            <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                <rect x="2" y="2" width="28" height="28" fill="#07020a" stroke="#6f3a93"></rect>
                <rect x="7" y="7" width="18" height="18" fill="none" stroke="#c084fc" stroke-width="1.2"></rect>
                <circle cx="16" cy="16" r="4" fill="#ff4fd8"/>
                <rect x="13" y="9" width="6" height="2" fill="#55ff99"/>
                <rect x="13" y="21" width="6" height="2" fill="#55ff99"/>
            </svg>`
    };

    const VENDOR_PROGRAMS = [
        {
            id: 'flowerbox',
            name: '3D FlowerBox',
            tagline: 'Polygon blossoms with real-time WebGL lighting.',
            meta: 'SCREENSAVER \u00B7 WEBGL',
            icon: ICONS.flowerbox,
            src: './vendor/98/programs/3D-FlowerBox/index.html'
        },
        {
            id: 'notepad',
            name: 'Notepad',
            tagline: 'Plain text, BrowserFS files, and the original menu engine.',
            meta: 'TEXT EDITOR \u00B7 98.JS',
            icon: ICONS.notepad,
            src: './vendor/98/programs/notepad/index.html'
        },
        {
            id: 'pinball',
            name: '3D Pinball',
            tagline: 'Space Cadet, compiled to WebAssembly and running locally.',
            meta: 'GAME \u00B7 WASM',
            icon: ICONS.pinball,
            src: './vendor/98/programs/pinball/space-cadet.html'
        },
        {
            id: 'pipes',
            name: '3D Pipes',
            tagline: 'Endless phosphor pipes from the classic screensaver.',
            meta: 'SCREENSAVER \u00B7 WEBGL',
            icon: ICONS.pipes,
            src: './vendor/98/programs/pipes/index.html'
        },
        {
            id: 'soundrecorder',
            name: 'Sound Recorder',
            tagline: 'Record, trim and play back audio without leaving the shell.',
            meta: 'AUDIO \u00B7 98.JS',
            icon: ICONS.soundrecorder,
            src: './vendor/98/programs/sound-recorder/index.html'
        },
        {
            id: 'winamp',
            name: 'Winamp',
            tagline: 'The llama whipping intro, playlist and spectrum visualizer.',
            meta: 'PLAYER \u00B7 WEBAMP',
            icon: ICONS.winamp,
            src: './vendor/98/programs/winamp/index.html'
        }
    ];

    VENDOR_PROGRAMS.forEach((program) => {
        window.RetroApps.register({
            id: program.id,
            name: program.name,
            tagline: program.tagline,
            meta: program.meta,
            icon: program.icon,
            source: '98.JS',
            frame: true,
            mount(root) {
                const frame = document.createElement('iframe');
                frame.className = 'program-frame';
                frame.title = program.name;
                frame.src = program.src;
                frame.setAttribute('allow', 'autoplay; fullscreen; gamepad');
                root.replaceChildren(frame);
                return () => {
                    frame.src = 'about:blank';
                    root.replaceChildren();
                };
            }
        });
    });

    /* Control Panel — in-house settings, same plum grammar as the shell. */
    window.RetroApps.register({
        id: 'controlpanel',
        name: 'Control Panel',
        tagline: 'Appearance, folder options, and desktop settings.',
        meta: 'SETTINGS \· IN-HOUSE',
        icon: ICONS.controlpanel,
        source: 'IN-HOUSE',
        frame: true,
        mount(root) {
            const frame = document.createElement('iframe');
            frame.className = 'program-frame';
            frame.title = 'Control Panel';
            frame.src = './vendor/control-panel/index.html';
            frame.setAttribute('allow', 'autoplay; fullscreen');
            root.replaceChildren(frame);
            return () => {
                frame.src = 'about:blank';
                root.replaceChildren();
            };
        }
    });

    /* JS Paint — dark plum utility theme, aligned with the desktop shell. */
    window.RetroApps.register({
        id: 'paint',
        name: 'JS Paint',
        tagline: 'Classic MS Paint with a dark plum utility theme.',
        meta: 'PAINT \· JSPAINT',
        icon: `
            <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                <rect x="2" y="3" width="28" height="26" fill="#07020a" stroke="#c084fc"></rect>
                <path d="M5 22l7-7 4 4-6 7z" fill="#c084fc" stroke="#f2eaff" stroke-width="0.8"></path>
                <path d="M16 18l5-8 3 2-4 8z" fill="#ff4fd8"></path>
                <circle cx="8" cy="8" r="2" fill="#55ff99"></circle>
                <rect x="20" y="24" width="6" height="2" fill="#c084fc"></rect>
            </svg>`,
        source: 'JSPAINT',
        frame: true,
        mount(root) {
            const frame = document.createElement('iframe');
            frame.className = 'program-frame';
            frame.title = 'JS Paint';
            frame.src = './vendor/jspaint/index.html';
            frame.setAttribute('allow', 'autoplay; fullscreen; clipboard-read; clipboard-write');
            root.replaceChildren(frame);
            return () => {
                frame.src = 'about:blank';
                root.replaceChildren();
            };
        }
    });
})();
