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
- `verify.py` — zero-dependency static checks. Run `python verify.py` before
  committing: parses every JSON, proves every referenced asset exists
  (HTML/CSS/manifests/links/playlist) and `node --check`s every script.

## `main/index.html`

Slim HTML shell (~170 lines) holding the pane markup and the stylesheet/script
tags. All page CSS lives in the `main/css/` modules, loaded in cascade order:

| File | Contents |
|------|----------|
| `variables.css` | `:root` design tokens (colours, sizes) |
| `base.css` | reset, typography, scrollbars, outer container |
| `marquee.css` | top marquee |
| `layout.css` | grid, splitter, sidebar, content area, panes |
| `links.css` | link-exchange grid, tiles, badges |
| `components.css` | terminal-mode overrides, footer, hit counter, cursor |
| `responsive.css` | `@media` blocks — must stay last |

The split preserves the original inline declaration order exactly; keep that
property if you ever move rules between these files.

Panes:

- `#link-exchange` — link tiles grid + category tabs
- `#pc-specs` — terminal wrapper (`#terminal`) and webpage pane (`#webpage-pane`)
- `#main-section-title` — big heading, only shown for the Link Exchange pane

Grid: `.layout-grid` is `sidebar | 10px splitter | content`, sized by the
`--sidebar-width` custom property (defaults to the compact 220px).

External stylesheets: the `css/` modules above, then `terminal.css`,
`music.css`, `mobile.css (<=760px)`.

## JavaScript (plain scripts, deferred)

| File | Responsibility |
|------|----------------|
| `draggable.js` | shared pointer-drag physics (`window.RetroDrag.makeDraggable`) for the music window + dock: pointer capture, clamping, persisted `{left, top}`, tap-vs-drag threshold, double-click reset |
| `mobile.js` | mobile header behaviour / chevrons |
| `link-exchange.js` | renders tiles from `data/links.json` (inline fallback array); category filtering; animated GIF swap on `pointerenter`/`focusin`, back to `.webp` on leave/blur; error fallback shows initials |
| `splitter.js` | draggable + keyboard-resizable sidebar; dblclick resets; persists width in `localStorage['retroSidebarWidth']`; default/compact width = 220px |
| `music.js` | music widget + player (see Music below) |
| `terminal.js` | the terminal, neofetch, fake VFS (`data/vfs.json`), in-page browsing |
| `custom-cursor.js` | custom GIF cursor + particle trail |

## Terminal (`main/terminal.js`)

- Fake VFS (`const vfs`) mirrors the repository layout so `ls`/`cd` feel real,
  and is mirrored in `main/data/vfs.json`. The script swaps the JSON in when the
  fetch succeeds and keeps the inline tree otherwise (`file://`, offline). The
  tree is read-only — `rm`/`rmdir`/`cp` only touch localStorage saved files.
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

- `main/data/links.json` holds `{ labels, iconScale, links }`. `link-exchange.js`
  keeps an identical inline `FALLBACK_*` copy and only re-renders when the JSON
  differs, so a normal load never flashes.
- Entry shape: `{ name, category, url, icon = './socials/*.webp', gif? = './socials/*.gif' }`
  (icon paths are relative to `main/index.html`, not to the JSON file).
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
- The dock and the player window share `main/draggable.js`
  (`window.RetroDrag.makeDraggable`). The dock uses a 6px tap threshold (a click
  still restores, a drag never does), is pinned to `right/bottom: 14px` by
  default, persists in `retroMusicDockPosition`, is clamped back into view on
  resize, and a double-click snaps it home. Its width is fixed so it cannot grow
  off-screen when the track name changes.
- Browser autoplay policies block audible playback until the user interacts
  (`#retro-btn-play`, `.music-toggle`), so an unlock handler retries on the
  first pointer/key gesture and the status shows `PRESS PLAY` until then.
- Window: draggable, position persisted (`retroMusicWindowPosition`), default
  lower-right.
- `retroMusicEnabled` is the sound preference. Missing = on (autoplay);
  an explicit `false` (set by "SOUND: OFF") keeps it silent.

## Conventions

- Whole site stays purple/black (#470d69 / #130927 family).
- No dependencies or frameworks; if you must add one, discuss first.
- Keep scripts framework-free and classic (no ES modules) so they validate with
  `node --check` and still run from `file://`.
- Static first: every page should work on a plain static host, and data-backed
  features must keep working when their JSON is missing or slow.
- Run `python verify.py` before committing.

## Known quirks

- Root `index.html` is only a redirect wrapper; all styling lives under `main/`.
- `public/main/index.html`-style historical copies were removed with the old
  Windows-XP app; don't reintroduce mirrored copies of `main/`.
- `dora/` ships two deliberately divergent attendance apps: `index.html`
  (streaks, chips, desktop-height sync) and `app.html` (auth modal, confetti,
  calendar). Both are kept; `manifest.json` + `app-manifest.json` reference
  `./dora.webp` (512×512) and `sw.js` precaches both shells.
- `ls` of a root folder right after `cd main` (or any root folder) prints
  `(empty)`, because the root children carry bare `{ type: 'dir' }` stubs while
  the full tree lives under `/main`. `ls /` and deeper paths are complete.
  Pre-existing behaviour, left as is.
