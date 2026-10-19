# Codebase Guide

Architecture notes for anyone working on this repository.

## Overview

This is a **static, dependency-free** personal site. Everything lives in plain
HTML/CSS/JS served directly by GitHub Pages. There is no bundler, no framework
and no build step.

- `main/` — the main retro homepage (what visitors see first)
- `dora/` — standalone side-project site (own PWA/manifest/sw)
- `l/`    — standalone link-tree page
- `index.html` (root) — meta-redirect to `./main/index.html`
- `serve.py` — optional local dev server; adds automatic directory listing for
  `/playlist` and `/main/playlist` so the music player can rescan tracks

## `main/index.html`

Single HTML shell containing all pane markup plus an inline `<style>` block with
the theme (purple/black), layout grid, sidebar, splitter, link-exchange grid,
marquee, custom-cursor CSS and responsive rules.

Panes:

- `#link-exchange` — link tiles grid + category tabs
- `#pc-specs` — terminal wrapper (`#terminal`) and webpage pane (`#webpage-pane`)
- `#main-section-title` — big heading, only shown for the Link Exchange pane

Grid: `.layout-grid` is `sidebar | 10px splitter | content`, sized by the
`--sidebar-width` custom property (defaults to the compact 220px).

External stylesheets: `terminal.css`, `music.css`, `mobile.css (<=760px)`.

## JavaScript (plain scripts, deferred)

| File | Responsibility |
|------|----------------|
| `mobile.js` | mobile header behaviour / chevrons |
| `link-exchange.js` | renders tiles from a data array; category filtering; animated GIF swap on `pointerenter`/`focusin`, back to `.webp` on leave/blur; error fallback shows initials |
| `splitter.js` | draggable + keyboard-resizable sidebar; dblclick resets; persists width in `localStorage['retroSidebarWidth']`; default/compact width = 220px |
| `music.js` | music widget + player (see Music below) |
| `terminal.js` | the terminal, neofetch, fake VFS, in-page browsing |
| `custom-cursor.js` | custom GIF cursor + particle trail |

## Terminal (`main/terminal.js`)

- Fake VFS (`const vfs`) mirrors the repository layout so `ls`/`cd` feel real.
- `#terminal-output` is a flex column with `gap: 6px`. A sibling input line
  remains focused at all times regardless of which pane is visible.
- Commands: `cls`, `dir`/`ls`, `cd`, `start`/`open`, `echo`, `man`, `rm`,
  `rmdir`, `cp`, `save`, `load`, `saved-files`, `neofetch`,
  `layout compact|normal`, `promptgap <px>`, `help`.
- Neofetch output is built once into a `DocumentFragment` and cloned (`cloneNode(true)`)
  per run — cheap and stable. It prints as plain terminal output (same font,
  line rhythm and left alignment as every other command — no card/padding/
  animation), so don't wrap it in a styled box again.
- `man` pages open in a pager (`q` to quit, arrows/space to scroll).
- Persistence (`localStorage`): `terminal_history`, `terminal_webpages_v1`.
- Webpages opened with `open`/`start` become sidebar buttons in `#webpages-list`
  (below the page-nav buttons). Those buttons reuse `.sidebar-nav button` styling
  so they align with Link Exchange / Neofetch, and clicking them shows
  `#webpage-pane` with an iframe.

### Layout details worth knowing

- `.terminal-output` gap before the prompt must match the line gap, so a sent
  command does not visually jump (`:empty` guard keeps the first line at 0px).
- The neofetch grid stacks to one column below `max-width: 1040px` because the
  250px logo column leaves too little room for the info column.

## Link exchange (`main/link-exchange.js`)

- `LINKS`: `{ name, category, url, icon = './socials/*.webp', gif? = './socials/*.gif' }`.
- Tiles swap `img.src` webp⇄gif on hover/focus only; the GIF is fetched on
  first hover so idle tiles cost nothing.
- Broken images fall back to a two-letter initials span.

## Custom cursor (`main/custom-cursor.js`)

- GIFs live in `main/assets/` (`cursor.gif`, `cursor-reversed.gif`); reversed
  variant is shown over links/buttons.
- Guards: skips `prefers-reduced-motion`, coarse pointers/touch, and if the GIF
  404s (then the native cursor is never hidden).
- Rendering: canvas with capped DPR 1.5, pre-rendered hue sprite sheet (no
  per-frame gradients), `MAX_PARTICLES` 150, loop paused while the tab is
  hidden or the pointer has left the window.

## Music

- `main/playlist/playlist.json` is the committed manifest used by GitHub Pages
  (where directory listing is impossible). Keep it in sync with the `.opus`
  files. `serve.py` exposes `/main/playlist` as JSON for local rescans.
- The player autoplays on load (status `PLAYING`), and always opens
  **minimized**: the only UI is the dock in the lower-right corner
  (`#retro-music-mini`). Clicking/tapping the dock restores the full window;
  the window is put away again with `_` or `×`.
- The dock is draggable (pointer events with a 6px tap threshold, so a click
  still restores and a drag never does). Its position persists in
  `retroMusicDockPosition`, defaults to the lower-right corner, is clamped back
  into view on resize, and a double-click snaps it home. Its width is fixed so
  it cannot grow off-screen when the track name changes.
- Browser autoplay policies block audible playback until the user interacts
  (`#retro-btn-play`, `.music-toggle`), so an unlock handler retries on the
  first pointer/key gesture and the status shows `PRESS PLAY` until then.
- Window: draggable, position persisted (`retroMusicWindowPosition`), default
  lower-right. The minimized dock defaults to `right/bottom: 14px` and keeps
  whatever position it was dragged to.
- `retroMusicEnabled` is the sound preference. Missing = on (autoplay);
  an explicit `false` (set by "SOUND: OFF") keeps it silent.

## Conventions

- Whole site stays purple/black (#470d69 / #130927 family).
- No dependencies or frameworks; if you must add one, discuss first.
- Keep scripts framework-free so `node --check file.js` validates them.
- Static first: every page should work with a plain static host.

## Known quirks

- Root `index.html` is only a redirect wrapper; all styling lives under `main/`.
- `public/main/index.html`-style historical copies were removed with the old
  Windows-XP app; don't reintroduce mirrored copies of `main/`.
