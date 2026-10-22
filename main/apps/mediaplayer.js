/* ---------------------------------------------------------------------------
 *  Windows 95 Media Player — Faithful classic styling & full feature set
 *  Adapted from benwiley4000/win95-media-player for the retro desktop.
 *  Supports local playlist, drag-and-drop MP4/MP3/Opus/WebM, file picking,
 *  full audio/video canvas, scrubber, and track control.
 * ------------------------------------------------------------------------- */
(() => {
    'use strict';

    const DEFAULT_PLAYLIST = [
        { title: "Computer Chronicles - Windows 95", src: "https://archive.org/download/CC1301_windows_95/CC1301_windows_95_512kb.mp4", isVideo: true },
        { title: "Crystal Castles - Suffocation", src: "./playlist/Crystal Castles - Suffocation [Z0NGdLr4img].opus", isVideo: false },
        { title: "Basshunter - In Her Eyes", src: "./playlist/6._Basshunter_-_In_Her_Eyes-pREJQbSl33Y.opus", isVideo: false },
        { title: "The Cure - Friday I'm In Love", src: "./playlist/The Cure - Friday I'm In Love [mGgMZpGYiy8].opus", isVideo: false }
    ];

    const ICON = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="2" y="3" width="20" height="18" fill="#07020a" stroke="#6f3a93"></rect>
            <rect x="4" y="5" width="16" height="10" fill="#130927" stroke="#4d286b"></rect>
            <path d="M10 7.5l5 3.5-5 3.5z" fill="#55ff99"></path>
            <rect x="4" y="17" width="16" height="2" fill="#c084fc"></rect>
        </svg>`;

    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00';
        const s = Math.floor(seconds);
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function mount(root, api) {
        let playlist = [...DEFAULT_PLAYLIST];
        let currentIdx = 0;
        let isPlaying = false;

        root.innerHTML = `
            <div class="w95-player-app">
                <input type="file" id="w95-file-input" accept="video/mp4,video/webm,video/ogg,audio/mp3,audio/opus,audio/ogg,audio/wav" style="display:none;">

                <!-- Classic Menu Bar -->
                <div class="w95-menubar" role="menubar">
                    <div class="w95-menu" tabindex="0">
                        <span class="w95-menu-title"><u>F</u>ile</span>
                        <div class="w95-menu-dropdown">
                            <div class="w95-menu-item" id="w95-menu-open"><u>O</u>pen... (Drop video here)</div>
                            <div class="w95-menu-separator"></div>
                            <div class="w95-menu-item" id="w95-menu-exit">E<u>x</u>it</div>
                        </div>
                    </div>
                    <div class="w95-menu" tabindex="0">
                        <span class="w95-menu-title"><u>E</u>dit</span>
                        <div class="w95-menu-dropdown">
                            <div class="w95-menu-item" id="w95-menu-copy"><u>C</u>opy</div>
                        </div>
                    </div>
                    <div class="w95-menu" tabindex="0">
                        <span class="w95-menu-title"><u>D</u>evice</span>
                        <div class="w95-menu-dropdown">
                            <div class="w95-menu-item" id="w95-menu-audio">Audio track</div>
                            <div class="w95-menu-item" id="w95-menu-video">Video track</div>
                        </div>
                    </div>
                    <div class="w95-menu" tabindex="0">
                        <span class="w95-menu-title"><u>H</u>elp</span>
                        <div class="w95-menu-dropdown">
                            <div class="w95-menu-item" id="w95-menu-about"><u>A</u>bout Media Player...</div>
                        </div>
                    </div>
                </div>

                <!-- Video / Visualizer Display Screen -->
                <div class="w95-screen-container" id="w95-drop-zone">
                    <div class="w95-drop-overlay" id="w95-drop-overlay">DROP VIDEO / AUDIO TO PLAY</div>
                    <video class="w95-video-el" id="w95-video" playsinline></video>
                    <div class="w95-audio-splash" id="w95-audio-splash">
                        <div class="w95-splash-icon">
                            <img src="./apps/mediaplayer/icons/audio.png" alt="Audio">
                        </div>
                        <div class="w95-splash-title" id="w95-splash-title">${playlist[0].title}</div>
                        <div class="w95-splash-hint">DRAG & DROP ANY MP4 VIDEO HERE</div>
                    </div>
                </div>

                <!-- Title & Status Header -->
                <div class="w95-info-strip">
                    <span class="w95-type-icon" id="w95-type-icon">
                        <img src="./apps/mediaplayer/icons/video.png" alt="Type" id="w95-indicator-icon">
                    </span>
                    <span class="w95-title-text" id="w95-title-display">${playlist[0].title}</span>
                    <span class="w95-state-text" id="w95-state-display">(stopped)</span>
                </div>

                <!-- Scrubber & Ruler Track -->
                <div class="w95-track-section">
                    <div class="w95-progress-outer">
                        <div class="w95-progress-track" id="w95-progress-track">
                            <div class="w95-thumb" id="w95-thumb" style="left: 0%;"></div>
                        </div>
                        <div class="w95-scroll-btns">
                            <button type="button" class="w95-scroll-btn" id="w95-scroll-back" title="Step Back (1 frame)">
                                <img src="./apps/mediaplayer/icons/backscroll.png" alt="Back">
                            </button>
                            <button type="button" class="w95-scroll-btn" id="w95-scroll-fwd" title="Step Forward (1 frame)">
                                <img src="./apps/mediaplayer/icons/forwardscroll.png" alt="Forward">
                            </button>
                        </div>
                    </div>
                    <div class="w95-ruler" aria-hidden="true">
                        <span>|</span><span>·</span><span>|</span><span>·</span><span>|</span><span>·</span><span>|</span><span>·</span><span>|</span>
                    </div>
                </div>

                <!-- Controls Strip -->
                <div class="w95-control-strip">
                    <div class="w95-btn-cluster">
                        <button type="button" class="w95-ctrl-btn" id="w95-btn-play" title="Play">
                            <img src="./apps/mediaplayer/icons/play.png" alt="Play">
                        </button>
                        <button type="button" class="w95-ctrl-btn" id="w95-btn-pause" title="Pause">
                            <img src="./apps/mediaplayer/icons/pause.png" alt="Pause">
                        </button>
                        <button type="button" class="w95-ctrl-btn" id="w95-btn-stop" title="Stop">
                            <img src="./apps/mediaplayer/icons/stop.png" alt="Stop">
                        </button>
                        <button type="button" class="w95-ctrl-btn" id="w95-btn-eject" title="Open File">
                            <img src="./apps/mediaplayer/icons/eject.png" alt="Open">
                        </button>
                    </div>

                    <div class="w95-separator"></div>

                    <div class="w95-btn-cluster">
                        <button type="button" class="w95-ctrl-btn" id="w95-btn-prev" title="Previous Track">
                            <img src="./apps/mediaplayer/icons/backskip.png" alt="Previous">
                        </button>
                        <button type="button" class="w95-ctrl-btn" id="w95-btn-rewind" title="Rewind">
                            <img src="./apps/mediaplayer/icons/backseek.png" alt="Rewind">
                        </button>
                        <button type="button" class="w95-ctrl-btn" id="w95-btn-fastfwd" title="Fast Forward">
                            <img src="./apps/mediaplayer/icons/forwardseek.png" alt="Fast Forward">
                        </button>
                        <button type="button" class="w95-ctrl-btn" id="w95-btn-next" title="Next Track">
                            <img src="./apps/mediaplayer/icons/forwardskip.png" alt="Next">
                        </button>
                    </div>

                    <div class="w95-separator"></div>

                    <div class="w95-btn-cluster">
                        <button type="button" class="w95-ctrl-btn" id="w95-btn-markin" title="Start Selection">
                            <img src="./apps/mediaplayer/icons/selectionstart.png" alt="Mark In">
                        </button>
                        <button type="button" class="w95-ctrl-btn" id="w95-btn-markout" title="End Selection">
                            <img src="./apps/mediaplayer/icons/selectionend.png" alt="Mark Out">
                        </button>
                    </div>

                    <!-- Digital Counter readout -->
                    <div class="w95-counter-box" id="w95-counter">00:00</div>
                </div>
            </div>`;

        const media = root.querySelector('#w95-video');
        const dropZone = root.querySelector('#w95-drop-zone');
        const dropOverlay = root.querySelector('#w95-drop-overlay');
        const fileInput = root.querySelector('#w95-file-input');
        const audioSplash = root.querySelector('#w95-audio-splash');
        const splashTitle = root.querySelector('#w95-splash-title');
        const titleDisplay = root.querySelector('#w95-title-display');
        const stateDisplay = root.querySelector('#w95-state-display');
        const counter = root.querySelector('#w95-counter');
        const indicatorIcon = root.querySelector('#w95-indicator-icon');

        const trackOuter = root.querySelector('#w95-progress-track');
        const thumb = root.querySelector('#w95-thumb');

        const btnPlay = root.querySelector('#w95-btn-play');
        const btnPause = root.querySelector('#w95-btn-pause');
        const btnStop = root.querySelector('#w95-btn-stop');
        const btnEject = root.querySelector('#w95-btn-eject');
        const btnPrev = root.querySelector('#w95-btn-prev');
        const btnNext = root.querySelector('#w95-btn-next');
        const btnRewind = root.querySelector('#w95-btn-rewind');
        const btnFastFwd = root.querySelector('#w95-btn-fastfwd');
        const btnScrollBack = root.querySelector('#w95-scroll-back');
        const btnScrollFwd = root.querySelector('#w95-scroll-fwd');

        const menuOpen = root.querySelector('#w95-menu-open');
        const menuExit = root.querySelector('#w95-menu-exit');
        const menuCopy = root.querySelector('#w95-menu-copy');
        const menuAbout = root.querySelector('#w95-menu-about');

        let isDraggingThumb = false;

        function loadMedia(item, autoplay = false) {
            media.src = item.src;
            titleDisplay.textContent = item.title;
            splashTitle.textContent = item.title;

            if (item.isVideo) {
                audioSplash.style.display = 'none';
                media.style.display = 'block';
                indicatorIcon.src = './apps/mediaplayer/icons/video.png';
            } else {
                audioSplash.style.display = 'flex';
                media.style.display = 'none';
                indicatorIcon.src = './apps/mediaplayer/icons/audio.png';
            }

            stateDisplay.textContent = '(stopped)';
            counter.textContent = '00:00';
            thumb.style.left = '0%';

            if (autoplay) {
                media.play().then(() => {
                    isPlaying = true;
                    stateDisplay.textContent = '(playing)';
                }).catch(() => {});
            }
        }

        function play() {
            media.play().then(() => {
                isPlaying = true;
                stateDisplay.textContent = '(playing)';
            }).catch(() => {});
        }

        function pause() {
            media.pause();
            isPlaying = false;
            stateDisplay.textContent = '(paused)';
        }

        function stop() {
            media.pause();
            media.currentTime = 0;
            isPlaying = false;
            stateDisplay.textContent = '(stopped)';
            counter.textContent = `00:00 / ${formatTime(media.duration)}`;
            thumb.style.left = '0%';
        }

        btnPlay.addEventListener('click', play);
        btnPause.addEventListener('click', pause);
        btnStop.addEventListener('click', stop);

        btnEject.addEventListener('click', () => fileInput.click());
        menuOpen.addEventListener('click', () => fileInput.click());

        btnPrev.addEventListener('click', () => {
            currentIdx = (currentIdx - 1 + playlist.length) % playlist.length;
            loadMedia(playlist[currentIdx], isPlaying);
        });

        btnNext.addEventListener('click', () => {
            currentIdx = (currentIdx + 1) % playlist.length;
            loadMedia(playlist[currentIdx], isPlaying);
        });

        btnRewind.addEventListener('click', () => {
            media.currentTime = Math.max(0, media.currentTime - 5);
        });

        btnFastFwd.addEventListener('click', () => {
            media.currentTime = Math.min(media.duration || 0, media.currentTime + 5);
        });

        btnScrollBack.addEventListener('click', () => {
            media.currentTime = Math.max(0, media.currentTime - (1 / 30));
        });

        btnScrollFwd.addEventListener('click', () => {
            media.currentTime = Math.min(media.duration || 0, media.currentTime + (1 / 30));
        });

        menuExit.addEventListener('click', () => {
            stop();
            if (api && typeof api.close === 'function') api.close();
        });

        menuCopy.addEventListener('click', () => {
            if (playlist[currentIdx]) {
                navigator.clipboard?.writeText(playlist[currentIdx].title);
            }
        });

        menuAbout.addEventListener('click', () => {
            alert('Windows 95 Media Player (Retro Web Edition)\nAdapted from benwiley4000/win95-media-player.\nSupports drag-and-drop video/audio.');
        });

        /* ── File Drag and Drop Support ───────────────────────────── */
        function handleFile(file) {
            if (!file) return;
            const objectUrl = URL.createObjectURL(file);
            const isVid = file.type.startsWith('video/') || file.name.match(/\.(mp4|webm|mkv|mov|avi)$/i);
            const newItem = {
                title: file.name,
                src: objectUrl,
                isVideo: Boolean(isVid)
            };
            playlist.unshift(newItem);
            currentIdx = 0;
            loadMedia(newItem, true);
        }

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropOverlay.style.display = 'flex';
        });

        dropZone.addEventListener('dragleave', (e) => {
            if (!dropZone.contains(e.relatedTarget)) {
                dropOverlay.style.display = 'none';
            }
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropOverlay.style.display = 'none';
            if (e.dataTransfer && e.dataTransfer.files.length) {
                handleFile(e.dataTransfer.files[0]);
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length) {
                handleFile(e.target.files[0]);
            }
        });

        /* ── Scrubber Navigation ─────────────────────────────────── */
        media.addEventListener('timeupdate', () => {
            if (!isDraggingThumb && media.duration) {
                const pct = (media.currentTime / media.duration) * 100;
                thumb.style.left = `${pct}%`;
                counter.textContent = `${formatTime(media.currentTime)} / ${formatTime(media.duration)}`;
            }
        });

        media.addEventListener('ended', () => {
            currentIdx = (currentIdx + 1) % playlist.length;
            loadMedia(playlist[currentIdx], true);
        });

        function seekFromPointer(clientX) {
            const rect = trackOuter.getBoundingClientRect();
            const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            thumb.style.left = `${pos * 100}%`;
            if (media.duration) {
                media.currentTime = pos * media.duration;
            }
        }

        let endPointerDrag = null;
        function stopPointerDrag() {
            if (typeof endPointerDrag === 'function') endPointerDrag();
        }

        trackOuter.addEventListener('pointerdown', (e) => {
            stopPointerDrag();
            isDraggingThumb = true;
            seekFromPointer(e.clientX);
            const onPointerMove = (moveEvt) => seekFromPointer(moveEvt.clientX);
            const onPointerUp = () => {
                isDraggingThumb = false;
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);
                endPointerDrag = null;
            };
            endPointerDrag = onPointerUp;
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
        });

        /* Start with the classic video */
        loadMedia(playlist[0], false);

        return function cleanup() {
            stopPointerDrag();
            media.pause();
            media.src = '';
        };
    }

    if (window.RetroApps) {
        window.RetroApps.register({
            id: 'mediaplayer',
            name: 'Media Player',
            tagline: 'Windows 95 Media Player — Audio & MP4 Video with drag-and-drop',
            meta: 'WIN95 · VIDEO/AUDIO · MP4',
            icon: ICON,
            mount
        });
    }
})();
