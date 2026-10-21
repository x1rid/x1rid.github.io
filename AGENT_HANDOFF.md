# AGENT HANDOFF & CONTINUITY DOCUMENT

## A. Project Overview
- **Project Purpose:** Personal retro-futuristic purple-themed web desktop environment and portfolio for `r3d1bruh` (`x1rid.github.io`).
- **Core Architecture:**
  - Vanilla HTML5 / CSS3 / ES JavaScript (zero framework runtime required, zero build step for deployment).
  - Strict palette token system defined in `main/css/variables.css` (`--surface-0` through `--surface-3`, `--ink-90`, `--signal-active`, etc.).
  - Complete multi-window desktop shell in `main/desktop-shell.html`.
  - Application ecosystem managed via `window.RetroApps.register({ id, name, tagline, meta, icon, mount })`.
  - Apps currently integrated into desktop shell:
    - **Minesweeper** (`main/apps/minesweeper.js`)
    - **Solitaire** (`main/apps/solitaire.js`)
    - **Calculator** (`main/apps/calculator.js`)
    - **Win95 Media Player** (`main/apps/mediaplayer.js`) — Faithful video & audio player with MP4 drag-and-drop, ruler, and controls.
    - **Winamp (Webamp)** (`main/vendor/98/programs/winamp/`) — Complete Winamp 2.9 interface with Butterchurn visualizer, equalizer, playlist, and skin support.
    - **Clippy Assistant** (`main/vendor/clippy/`)
    - **Terminal** & **Purple Explorer**

---

## B. Repository Import Inventory

### 1. `win95-media-player`
- **Original URL:** `https://github.com/benwiley4000/win95-media-player`
- **Destination:** `main/apps/mediaplayer.js` + `main/apps/mediaplayer/icons/` + styles in `main/apps.css`.
- **License:** MIT License (Copyright 2019 Ben Wiley).
- **Features Implemented:**
  - Authentic Windows 95 Media Player interface (menubar, video screen, information strip, ruler with frame-stepping buttons, transport controls, and digital counter).
  - Full **drag-and-drop support for any local MP4, WebM, OGG video and MP3, Opus, WAV audio files**.
  - Drop overlay with visual cues.
  - Interactive pointer-seeking scrubber track.
  - Pre-loaded with classic Windows 95 video ("Computer Chronicles") and user playlist audio tracks.

### 2. `webamp`
- **Original URL:** `https://github.com/captbaritone/webamp`
- **Destination:** Integrated via `main/vendor/98/programs/winamp/index.html` with official `webamp.bundle.min.js`, `butterchurn.min.js`, and `base-2.91.wsz`.
- **License:** MIT License (Copyright Jordan Eldredge).
- **Features Implemented:**
  - Full Winamp 2.9 retro player running in an authentic desktop window.
  - Multi-track playlist with local `.opus` tracks and classic intro.
  - Working 10-band graphic equalizer, spectrum analyzer, and milkdrop/butterchurn presets.

### 3. `98.js (programs/calculator)`
- **Original URL:** `https://github.com/1j01/98/tree/master/programs/calculator`
- **Destination:** `imported_repos/98js/programs/calculator/` (reference) + `main/apps/calculator.js`.
- **License:** MIT License (Isaiah Odhner / muzamil).
- **Status:** In-house zero-eval calculator verified and styled in purple tokens.

---

## C. Current Progress
- **Completed:**
  - Re-implemented `main/apps/mediaplayer.js` to match the exact visual layout and components of `win95-media-player`.
  - Added drag-and-drop video file support (`.mp4`, `.webm`, etc.) with instant playback.
  - Wired Webamp directly to use the full Winamp 2.9 UI with equalizer, skins, and playlist.
  - Validated syntax and assets across all files.
- **Next Action:**
  - Test video playback and verify drag-and-drop file loading in the running desktop shell.
