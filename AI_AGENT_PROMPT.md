# AI Agent Prompt — x1rid.github.io

Purpose: what to keep in mind when an AI agent works on this repository.

## What this project is

A **static, dependency-free retro personal homepage** (purple/black Geocities
vibe), plus two standalone sub-sites (`dora/`, `l/`). Deployed to GitHub Pages
from the repository root (`/` embeds the self-contained `/main/` site without
navigating away from the root URL).

There is **no React, no bundler, no build step** and none should be introduced.

## Layout

- `main/index.html` — main page shell; markup + stylesheet/script tags only.
- `main/css/*.css` — page theme/layout modules in cascade order: `variables`,
  `base`, `marquee`, `layout`, `links`, `components`, `responsive` (keep
  `responsive` last). Feature sheets: `terminal.css` (terminal/neofetch/webpage
  pane), `music.css` (music widget/player), `sfx.css` (footer interface-sound
  control), `context-menu.css` (desktop link menu + copy toast), `mobile.css`
  (≤760px compact/tablet), `phone.css` (≤600px phone shell, linked with
  `media="(max-width:600px)"` so it is not fetched above that width).
- `main/*.js` — `draggable.js` (shared window/dock drag physics), `mobile.js`
  (the phone shell controller), `link-exchange.js`, `splitter.js`, `music.js`,
  `sfx.js` (opt-in synthesized interface sounds), `context-menu.js` (link-only
  desktop context menu), `iframe-policy.js` (hosts that refuse framing),
  `terminal.js`, `chrome.js` (status rail / page counter / focus state),
  `custom-cursor.js` (all defer, plain classic scripts).
- `main/data/` — `links.json` (link tiles) and `vfs.json` (terminal filesystem).
- `main/assets/` — pixel cursor sprites (`cursor-*.png`) + legacy cursor GIFs.
  `main/socials/` — profile avatar and the link-exchange icon set.
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
- There are **two** deliberate width boundaries: `760px` is compact/tablet
  layout (`responsive.css` + `mobile.css`) and `600px` is the phone shell
  (`phone.css` + `mobile.js`). The `max-width: 600px` string appears in exactly
  four places — the `phone.css` link, `mobile.js`'s `matchMedia`,
  `custom-cursor.js`'s guard, and the marquee script in `index.html` — and they
  must stay identical.
- `.content-area` is a `<main>` element (one landmark, no second one). In the
  Link Exchange view it is deliberately **frameless** (`.content-area:not(.terminal-mode)`);
  the terminal/webpage panes keep the console frame, and the sidebar keeps the
  site's panel recipe. Do not add a border back to the link view; the icon
  screen's own hairline bezel and faint wash are part of the tile, not a pane
  frame. Its heading `#main-section-title` renders `data-meta` through `::after`
  (entry count + active filter, written by `link-exchange.js`). The phone shell
  hides that heading (`phone.css`) and mirrors `data-meta` into the header's
  `.phone-view-meta` and the current view into `#phone-view-path` (both
  read-only) — never let the sources disagree.
- Panes are owned by `terminal.js` alone. `showPane()` emits one
  `site:panechange` event; `mobile.js` only projects it into
  `body[data-layout="phone"]` / `body[data-view]`. Never wrap, replace or
  re-register `showPane`, and never reparent desktop nodes in the phone shell
  (mirror with clones instead — `terminal.js` serialises `#webpages-list`
  straight to `localStorage`).
- Anything added to the phone shell must be reachable through the single
  `on()`/`off()` lifecycle in `mobile.js`: subscribe with `listen()`/`watch()`
  so it is removed on exit, or it will leak on every rotation.
- `.status-rail` sits between the marquee and the layout; `chrome.js` fills it
  with real values only and it is hidden at ≤760px. `.music-panel` reports
  `is-on` / `is-playing` so its LED and the rail cannot disagree with the
  player.
- `main/data/links.json` and `main/data/vfs.json` are optional data files:
  `link-exchange.js` and `terminal.js` keep inline fallbacks so the pages still
  work from `file://` and offline. Never make the fallback path depend on the
  fetch.
- `main/socials/icons/` holds one square SVG per link; older logo versions were
  preferred, generated marks fill the gaps (see `icons/SOURCES.md`). The hover
  animation is CSS in `css/links.css`, scoped to link-exchange tiles — no hover
  image is fetched, and reduced-motion users get colour-only feedback.
- The custom cursor must never hide the native cursor until its own sprites
  loaded (`custom-cursor.js` guards this). `ghost`/`classic` never run for touch
  input, phone widths (`<=600px`), or reduced-motion users. `rail` stays
  available under reduced motion (desktop only) and draws no custom pointer;
  touch/phone layouts still force native. Ghost sprites are
  `main/assets/cursor-*.png`; `classic` keeps `cursor{,-reversed}.gif`. The
  scheme is persisted in `localStorage['retroCursorScheme']` and switched with
  the terminal `cursor` command.
- Sidebar loads **compact by default** (220px). A user-dragged width persists in
  `localStorage['retroSidebarWidth']`.
- Sidebar webpage buttons (opened via `open <url>`) must reuse the
  `.sidebar-nav button` styling so they line up with Link Exchange/Neofetch.
  Each lives in a `.webpage-tab` wrapper with a `.webpage-tab-close` cross;
  closing the on-screen tab returns the pane to the link exchange. `mobile.js`
  mirrors the same wrapper into the phone pages list, so keep the close control
  a real peer button (never nest it inside `.webpage-btn`).
- `main/iframe-policy.js` owns the `window.SiteIframes` API. It blocks known
  `X-Frame-Options` / CSP `frame-ancestors` hosts from the page pane, while
  explicit embed URLs (YouTube `/embed/`, Spotify `/embed/`, SoundCloud player,
  Vimeo player, Google Maps embed) stay allowed. `context-menu.js` removes the
  page-pane action for blocked hosts, and `terminal.js` opens their URLs in a
  real tab. Unknown hosts stay embeddable — never guess from a failed iframe,
  because refusals still fire `load` and are indistinguishable from cross-origin
  pages.
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
- The footer counter is an approximate public page-view count from Abacus
  (`x1rid.github.io/visits`), not a unique-visitor metric. `main/chrome.js` uses
  `sessionStorage` only to avoid repeated hits in one tab, validates the numeric
  response, and shows `------` on failure. Never restore a local or joke-number
  fallback without changing the `TOTAL PAGE VIEWS` label and documentation.
- Terminal neofetch reuses a cached `DocumentFragment` (`cloneNode(true)`) —
  don't rebuild the DOM from scratch on every call, and keep it plain
  (no card/padding) so it lines up with the other commands.
- Interface sounds (`main/sfx.js`) are **opt-in** and off by default. They use
  `localStorage['retroSfxEnabled']`, are separate from the music player's own
  `retroMusicEnabled`, and must never start an `AudioContext` before a real
  pointer/key gesture or while disabled. They cover clicks, terminal
  keys/results, pane changes and the music window; hover, wheel and continuous
  drag stay silent. Voices must stay distinct (not all click variants), and
  `sound test` auditions them. The SFX master (`0.9`) stays above the music
  default volume (`0.06`); don't raise the music default without rechecking the
  mix.
- The desktop link menu (`main/context-menu.js`) is **link-scoped and
  desktop-only**: it handles `contextmenu` only for `http(s)` anchors on fine
  pointers above `600px`, leaving text selections, inputs, `mailto:` links,
  terminal output, iframes and empty space native. `Shift + right-click` must
  always bypass it (keyboard **Shift+F10** still opens the custom menu). Do not
  turn this into a global right-click handler. Copy success uses the bottom
  `.link-toast` and a short `.social-tile` flash; the page-pane action is the
  `site:openpage` document event consumed by `terminal.js` (never call terminal
  internals directly). The page-pane item is hidden when
  `window.SiteIframes.canEmbed(url)` is false. Keep the clipboard fallback and
  reduced-motion opt-out.
- localStorage keys: `terminal_history`, `terminal_webpages_v1`,
  `retroSidebarWidth`, `retroMusicEnabled`, `retroMusicWindowPosition`,
  `retroMusicDockPosition`, `retroMusicVolume`, `retroSfxEnabled`.
  The page counter uses the per-tab `sessionStorage` key
  `retroGlobalPageView`; it is not a local counter.

## Terminal command set

`cls`, `dir`/`ls`, `cd`, `start`/`open`, `echo`, `man` (pager), `rm`, `rmdir`,
`cp`, `save`, `load`, `saved-files`, `neofetch`, `layout compact|normal`,
`promptgap <px>`, `cursor <scheme>`, `sound on|off|toggle|test`, `help`, plus
Up/Down history, Tab completion, Ctrl+L/Ctrl+C. Keep `README.md` in sync when
adding commands.

## Docs to update alongside code

- `README.md` — user-facing summary (commands, music, how to run).
- `CODEBASE.md` — architecture notes (files, panes, storage keys, quirks).
- Update them whenever you change structure, commands, storage keys or assets.
