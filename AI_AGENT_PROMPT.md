# AI Agent Prompt — x1rid.github.io

Purpose: what to keep in mind when an AI agent works on this repository.

## What this project is

A **static, dependency-free retro personal homepage** (purple/black Geocities
vibe), plus two standalone sub-sites (`dora/`, `l/`). Deployed to GitHub Pages
from the repository root (`/` redirects to `/main/index.html`).

There is **no React, no bundler, no build step** and none should be introduced.

## Layout

- `main/index.html` — main page shell; markup + stylesheet/script tags only.
- `main/css/*.css` — page theme/layout modules in cascade order: `variables`,
  `base`, `marquee`, `layout`, `links`, `components`, `responsive` (keep
  `responsive` last). Feature sheets: `terminal.css` (terminal/neofetch/webpage
  pane), `music.css` (music widget/player), `mobile.css` (≤760px).
- `main/*.js` — `draggable.js` (shared window/dock drag physics), `mobile.js`,
  `link-exchange.js`, `splitter.js`, `music.js`, `terminal.js`, `chrome.js`
  (status rail / visit counter / focus state), `custom-cursor.js`
  (all defer, plain classic scripts).
- `main/data/` — `links.json` (link tiles) and `vfs.json` (terminal filesystem).
- `main/assets/` — cursor gifs. `main/socials/` — profile/social icons.
- `main/playlist/` — music tracks + `playlist.json` (committed manifest).
- `serve.py` — dev server; `python serve.py [port]` (default 5500).
- `verify.py` — static checks; `python verify.py` (must print `VERIFY OK`).

## Hard rules

1. **Purple/black theme only** (dark purples: `#470d69`, `#130927`, accents
   `#c084fc`, `#ff4fd8`, neon green `#55ff99`). Don't add other hues.
2. **No dependencies / frameworks / build tools.** Modify plain source files.
3. **Performance matters**: lazy-loaded images, animations only on
   hover/interaction, cached fragments, capped canvas DPR.
4. Validate JS with `node --check main/<file>.js` after every edit.
5. Run `python verify.py` before committing — it parses every JSON, checks that
   every referenced asset exists (HTML/CSS/manifests/links/playlist) and
   `node --check`s every script. It must print `VERIFY OK`.
6. After behavioural changes, verify with `serve.py` + a browser (no console
   errors, no 4xx on load).
7. **Visual grammar** (see `CODEBASE.md` → Visual system): green = terminal /
   online, lavender = navigation / links / focus, magenta = now playing. Keep
   to the glow and motion budgets, use tokens from `variables.css` instead of
   literals, and never display invented state.

## Project-specific gotchas

- `main/css/` must be loaded in order and `responsive.css` must stay last, or
  the media-query overrides stop winning.
- `.content-area` is a `<main>` element (one landmark, no second one). Its
  heading `#main-section-title` renders `data-meta` through `::after`
  (entry count + active filter, written by `link-exchange.js`). `mobile.js`
  replaces that heading's innerHTML for the dropdown header and `mobile.css`
  suppresses the meta on phones — keep both behaviours in sync.
- `.status-rail` sits between the marquee and the layout; `chrome.js` fills it
  with real values only and it is hidden at ≤760px. `.music-panel` reports
  `is-on` / `is-playing` so its LED and the rail cannot disagree with the
  player.
- `main/data/links.json` and `main/data/vfs.json` are optional data files:
  `link-exchange.js` and `terminal.js` keep inline fallbacks so the pages still
  work from `file://` and offline. Never make the fallback path depend on the
  fetch.
- `main/socials/*.gif` are animated only on tile hover (`link-exchange.js`
  swaps `src` webp⇄gif); the GIF is fetched on first hover — keep it that way.
- The custom cursor should never hide the native cursor unless its own GIF
  loaded (`custom-cursor.js` guards this) and never runs for touch input or
  reduced-motion users. Cursor GIFs are `main/assets/cursor{,-reversed}.gif`.
- Sidebar loads **compact by default** (220px). A user-dragged width persists in
  `localStorage['retroSidebarWidth']`.
- Sidebar webpage buttons (opened via `open <url>`) must reuse the
  `.sidebar-nav button` styling so they line up with Link Exchange/Neofetch.
- `.terminal-output` must keep its gap to the prompt identical to the gap
  between output lines (or the just-sent command visually jumps). The `:empty`
  guard handles the first line.
- Neofetch grid stacks below `max-width: 1040px` (logo column is min 250px).
- Music autoplays on load and always starts minimized in the lower-right dock
  (`#retro-music-mini`); tapping the dock restores the player window. Audible
  autoplay needs a gesture, so keep the `armAutoplayUnlock()` retry in sync
  when touching playback controls.
- The player window and the minimized dock share `main/draggable.js`
  (`window.RetroDrag.makeDraggable`, loaded before `music.js`). The dock uses a
  6px tap threshold so a small movement stays a tap (`wasDragged()` guards the
  click) and a double-click resets it to the lower-right corner.
- Music: GitHub Pages cannot list directories — keep
  `main/playlist/playlist.json` in sync with the track files. The player also
  falls back to a baked-in list when discovery fails.
- Terminal neofetch reuses a cached `DocumentFragment` (`cloneNode(true)`) —
  don't rebuild the DOM from scratch on every call, and keep it plain
  (no card/padding) so it lines up with the other commands.
- localStorage keys: `terminal_history`, `terminal_webpages_v1`,
  `retroSidebarWidth`, `retroMusicEnabled`, `retroMusicWindowPosition`,
  `retroMusicDockPosition`, `retroMusicVolume`, `retroVisits`.
  (`retroVisitSession` is the per-tab session guard for `retroVisits`.)

## Terminal command set

`cls`, `dir`/`ls`, `cd`, `start`/`open`, `echo`, `man` (pager), `rm`, `rmdir`,
`cp`, `save`, `load`, `saved-files`, `neofetch`, `layout compact|normal`,
`promptgap <px>`, `help`, plus
Up/Down history, Tab completion, Ctrl+L/Ctrl+C. Keep `README.md` in sync when
adding commands.

## Docs to update alongside code

- `README.md` — user-facing summary (commands, music, how to run).
- `CODEBASE.md` — architecture notes (files, panes, storage keys, quirks).
- Update them whenever you change structure, commands, storage keys or assets.
