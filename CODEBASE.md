# Codebase Guide

Architecture notes for anyone working on this repository.

## Overview

This is a **static, dependency-free** personal site. Everything lives in plain
HTML/CSS/JS served directly by GitHub Pages. There is no bundler, no framework
and no build step.

- `main/` — the main retro homepage (what visitors see first)
- `dora/` — standalone side-project site (own PWA/manifest/sw)
- `l/`    — standalone link-tree page
- `index.html` (root) — full-viewport same-origin embed of `./main/index.html`;
  avoids an initial navigation redirect while keeping the main site self-contained
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
- `#main-section-title` — big heading, only shown for the Link Exchange pane;
  its `::after` renders `data-meta` (entry count + active filter) set by
  `link-exchange.js`
- `.content-area` is a `<main>` element; the status rail (`.status-rail`) sits
  between the marquee and `.layout-grid` and is filled by `chrome.js`

Grid: `.layout-grid` is `sidebar | 10px splitter | content`, sized by the
`--sidebar-width` custom property (defaults to the compact 220px).

External stylesheets: the `css/` modules above, then `terminal.css`,
`music.css`, `sfx.css`, `context-menu.css` (desktop link menu + copy toast),
`mobile.css (<=760px, compact/tablet)` and `phone.css (<=600px, phone shell —
linked with a media attribute, so it is not even fetched above that width)`.

## JavaScript (plain scripts, deferred)

| File | Responsibility |
|------|----------------|
| `draggable.js` | shared pointer-drag physics (`window.RetroDrag.makeDraggable`) for the music window + dock: pointer capture, clamping, persisted `{left, top}`, tap-vs-drag threshold, double-click reset |
| `mobile.js` | the phone shell controller (`<=600px`): projects `site:panechange` into `body[data-layout]`/`body[data-view]`, mirrors the current view path/meta and the saved-pages list into the single header, runs the terminal key strip, tracks the virtual keyboard (`--pt-keyboard-offset`), and hands fullscreen over to an "open in browser" action where Element Fullscreen is missing. One `on()`/`off()` lifecycle — every listener and observer it creates is removed on exit |
| `link-exchange.js` | renders tiles from `data/links.json` (inline fallback array); category filtering; per-tile brand accent; error fallback shows initials. Hover motion is CSS-only (`css/links.css`) |
| `splitter.js` | draggable + keyboard-resizable sidebar; dblclick resets; persists width in `localStorage['retroSidebarWidth']`; default/compact width = 220px |
| `music.js` | music widget + player (see Music below) |
| `sfx.js` | opt-in synthesized interface sounds: footer SFX toggle, `sound on|off|toggle|test`, distinct click/key/result/pane/window voices, gesture gate, persisted `retroSfxEnabled` |
| `context-menu.js` | desktop/fine-pointer link menu: Copy link, Open in new tab, Open in page pane (omitted for hosts that refuse framing); Shift bypass; Android-style copy toast; clipboard fallback; `site:openpage` event |
| `iframe-policy.js` | `window.SiteIframes`: known `X-Frame-Options` / `frame-ancestors` hosts, embed-URL exceptions, `embedPolicy()` / `canEmbed()` / `hostOf()` |
| `terminal.js` | the terminal, neofetch, fake VFS (`data/vfs.json`), in-page browsing; listens for `site:openpage` |
| `chrome.js` | status rail (pane / playback / clock), public page-view counter, `data-focus` window state |
| `custom-cursor.js` | pointer schemes: pixel ghost trail, legacy GIF/particle, rail telemetry, native |

## Desktop shell prototype

`main/desktop-shell.html` is an unlinked spike for a full desktop shell: live
wallpaper, taskbar, Start search, Explorer, terminal, music, draggable windows,
and a Programs shelf. It is intentionally not referenced by `main/index.html`
and is hidden below 761px so the phone shell stays untouched.

- The shell defines a tiny `window.RetroApps` registry, then loads
  `main/apps/minesweeper.js`, `paint.js`, `solitaire.js`, and `calculator.js`.
  Each app exports `register({ id, name, tagline, meta, icon, mount })`.
- `mount(root, api)` returns an optional cleanup. `api.setMeta(text)` updates
  the live window-title metadata; `api.close()` closes that window. The shell's
  window manager calls cleanup when the window is really removed.
- `main/apps.css` supplies the shared launcher tiles, controls, and app skins.
  The apps are in-house, dependency-free ports re-themed with the site tokens;
  README credits the upstream projects that inspired them.
- Launch paths: taskbar `PROGRAMS`, Start search (`Programs`, then each app), or
  terminal `apps` / `apps <id>`.
- The shell is a single file with inline CSS/JS plus the shared app assets. It
  does not touch the production pane system in `terminal.js`/`mobile.js`.

## Terminal (`main/terminal.js`)

- Fake VFS (`const vfs`) mirrors the repository layout so `ls`/`cd` feel real,
  and is mirrored in `main/data/vfs.json`. The script swaps the JSON in when the
  fetch succeeds and keeps the inline tree otherwise (`file://`, offline). The
  tree is read-only — `rm`/`rmdir`/`cp` only touch localStorage saved files.
- `#terminal-output` is a flex column with `gap: 6px`. A sibling input line
  remains focused at all times regardless of which pane is visible.
- Commands: `cls`, `dir`/`ls`, `cd`, `start`/`open`, `echo`, `man`, `rm`,
  `rmdir`, `cp`, `save`, `load`, `saved-files`, `neofetch`,
  `layout compact|normal`, `promptgap <px>`, `cursor <scheme>`,
  `sound on|off|toggle|test`, `help`.
- Neofetch output is built once into a `DocumentFragment` and cloned (`cloneNode(true)`)
  per run — cheap and stable. It prints as plain terminal output (same font,
  line rhythm and left alignment as every other command — no card/padding/
  animation), so don't wrap it in a styled box again.
- `man` pages open in a pager (`q` to quit, arrows/space to scroll).
- Persistence (`localStorage`): `terminal_history`, `terminal_webpages_v1`.
- Webpages opened with `open`/`start` become temporary tabs in `#webpages-list`
  (below the page-nav buttons). Each `.webpage-tab` wrapper holds the
  destination `.webpage-btn` and a `.webpage-tab-close` cross; closing the tab
  that is on screen also closes the pane and returns to the link exchange.
  Those buttons reuse `.sidebar-nav button` styling so they align with Link
  Exchange / Neofetch, and clicking them shows `#webpage-pane` with an iframe.
- Before a page is embedded, `openWebpage()` asks `window.SiteIframes.canEmbed()`
  (`iframe-policy.js`). Known `X-Frame-Options` / CSP `frame-ancestors` hosts
  are opened in a real tab instead, and restored tabs for blocked hosts are
  skipped. Embed URLs on those hosts (YouTube `/embed/`, Spotify `/embed/`,
  SoundCloud/Vimeo players, Maps embeds) remain allowed.
- `terminal.js` also listens for `site:openpage` (`{ url, title }`) so the
  desktop link menu can reuse the webpage pane without importing terminal code.
  The listener accepts only `http(s)` URLs.

### Layout details worth knowing

- `.terminal-output` gap before the prompt must match the line gap, so a sent
  command does not visually jump (`:empty` guard keeps the first line at 0px).
- The neofetch grid stacks to one column below `max-width: 1040px` because the
  250px logo column leaves too little room for the info column.

## Link exchange (`main/link-exchange.js`)

- `main/data/links.json` holds `{ labels, links }`. `link-exchange.js`
  keeps an identical inline `FALLBACK_*` copy and only re-renders when the JSON
  differs, so a normal load never flashes.
- Entry shape: `{ name, category, url, icon = './socials/icons/*.svg' }`
  (icon paths are relative to `main/index.html`, not to the JSON file).
  Per-link hover accents live in the `TILE_ACCENTS` map in `link-exchange.js`
  and are applied as `--tile-accent`; they are presentation, not data.
- Icons are single square SVGs — no hover image is fetched. Hover/focus styling
  lives in `css/links.css`, scoped to `.link-exchange-grid`; the delegated
  pointer block at the end of `link-exchange.js` adds the magnetic lean/tilt,
  pointer sheen and sparse 4px sparks. `renderCategory` resets the active tile
  when filters re-render. Coarse pointers drop the lean/tilt/sheen, and the
  reduced-motion block in `css/responsive.css` keeps colour only.
- Broken images fall back to a two-letter initials span; the sheen and pixel
  layers stay in place.

## Desktop link menu (`main/context-menu.js`)

- Only runs for fine pointers above the phone boundary (`>600px`); touch
  long-press keeps the native menu. It intercepts `contextmenu` only when the
  target is an `a[href]` resolving to `http(s)`. Text selections, inputs,
  editable nodes, `mailto:`/`tel:` links and empty space are left alone.
- Actions: **Copy link** (clipboard API, `execCommand` fallback), **Open in new
  tab** (temporary anchor with `noopener noreferrer`), **Open in page pane**
  (`document.dispatchEvent(new CustomEvent('site:openpage', ...))`). The last
  item is hidden when `window.SiteIframes.canEmbed(url)` is false, so hosts
  such as GitHub/Reddit/social platforms never offer a pane that can only show
  a refusal screen.
- `Shift + right-click` bypasses the custom menu. Escape closes and returns
  focus to the source link; the keyboard Menu key / Shift+F10 also opens it;
  arrow keys/Home/End move between items; Tab closes.
- The menu is created lazily and appended to `<body>`, with `z-index: 15000`
  below the custom cursor (`20000`). Positioning clamps to the viewport.
- Copy success shows one reusable `.link-toast` (bottom-center, `role=status`,
  auto-dismissed after 2.4s) and flashes the source `.social-tile`. Copy failure
  shows the same toast in the `error` tone. The toast and menu animate with short
  step-based keyframes and opt out under `prefers-reduced-motion`.

## Custom cursor (`main/custom-cursor.js`)

- Four schemes, persisted in `localStorage['retroCursorScheme']` and switched
  with `cursor ghost|classic|rail|native`:
  - `ghost` (default): 32px pixel arrow, lavender arrow over links/buttons
    (never a finger), magenta press frame, 12px state badge for right-click
    (`≡`), wheel (`↑ ↓ ← →`) and drag (`+`), plus six sampled ghost copies at
    30ms.
  - `classic`: the original 48px animated GIF, purple glow and rainbow canvas
    trail (`MAX_PARTICLES` 150, capped DPR 1.5, pre-rendered hue sprites).
  - `rail`: native pointer; `chrome.js` writes live coordinates + hit state into
    `.rail-pointer` (`PTR 0842,0411 · LINK`).
  - `native`: no custom pointer.
- `ghost` writes `custom-cursor-enabled` on `<html>` only after its PNGs load.
  It stands down (hides the custom lead) over inputs, contenteditable,
  `.terminal-output`, `.panel-splitter`, iframes and disabled controls, and
  restores the matching native cursor from CSS. The player/dock drag handles
  keep the custom pointer and show the `+` state; press/right-click/wheel/drag
  states are suppressed while the pointer is in a native zone.
- Hit testing is one shared vocabulary: `default`, `link`, `text`, `drag`,
  `frame`, `splitter`, `disabled`. `chrome.js` maps it to rail labels.
- Guards: `ghost`/`classic` skip coarse pointers, phone widths (`<=600px`) and
  reduced-motion users; `rail`/`native` still work under reduced motion.
  Asset failures fall back to native instead of hiding the pointer.
- Ghost trail is a fixed ring of six DOM sprites, sampled on `pointermove`,
  rendered in one rAF while samples are alive (240ms), and it stops when the
  pointer stops. No idle animation.

## Interface sounds (`main/sfx.js`)

- **Opt-in and separate from music.** Off unless the footer `SFX` control or
  `sound on` enables it; the choice persists in
  `localStorage['retroSfxEnabled']`. When off, pointer and keyboard actions do
  not create or resume an audio context. `sfx.js` also exposes
  `window.SiteSfx` (`isEnabled`, `setEnabled`, `toggle`, `play`, `sounds`).
- **Synthesized, not sampled.** All voices are short oscillator/noise envelopes
  through one master gain (`0.9`), with per-sound cooldowns and a 12-voice cap;
  there are no audio files, no fetches, and no third-party sounds. Voices are
  deliberately kept in separate registers/timbres: bright click, low
  right-click thud, high typing tick, heavier Enter, rising success arpeggio,
  descending square error buzz, two-part pane relay, window sweeps, and a
  power-on chord. `sound test` auditions the set.
- **Gesture gate.** `play()` refuses to create an `AudioContext` until a real
  pointer/key gesture has been seen, so a stored preference can never trigger
  an autoplay warning on load. The context suspends when the tab is hidden.
- **Scope is deliberate.** Clicks/right-clicks on interactive elements,
  terminal keys and command results, `site:panechange`, and
  `site:windowchange` (emitted by `music.js` for the player window) make sound.
  Hover, wheel and continuous drag do not.
- **Honest UI.** The `<html data-sfx>` attribute, `.sfx-panel.is-on`, the button
  text/`aria-pressed`, and the terminal `sound` output all derive from the same
  flag. The panel starts `hidden` in markup and `sfx.js` reveals it, so a failed
  script never leaves a dead control.

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
  lower-right. `setWindowVisible()` emits
  `site:windowchange` (`{ id: 'music', visible }`) so the interface-sound layer
  can add an open/close relay without reaching into the player.
- `retroMusicEnabled` is the sound preference. Missing = on (autoplay);
  an explicit `false` (set by "SOUND: OFF") keeps it silent. `DEFAULT_VOLUME`
  is `0.06`, intentionally below the interface-sound master gain (`0.9` in
  `sfx.js`); the volume slider still reaches `1.0`. The interface sounds use
  their own `retroSfxEnabled` key and own master gain.

## Conventions

- Whole site stays purple/black (#470d69 / #130927 family).
- No dependencies or frameworks; if you must add one, discuss first.
- Keep scripts framework-free and classic (no ES modules) so they validate with
  `node --check` and still run from `file://`.
- Static first: every page should work on a plain static host, and data-backed
  features must keep working when their JSON is missing or slow.
- Run `python verify.py` before committing.

## Visual system

Design tokens live in `main/css/variables.css`; feature stylesheets reference
them instead of hardcoding literals.

- **Accents mean exactly one thing each.** `--signal-ok` (green) = terminal +
  online/local state; `--signal-active` (lavender) = navigation, links, focus;
  `--signal-hot` (magenta) = now playing + attention. Green is no longer a
  generic hover colour, so it keeps its terminal meaning.
- **Glow budget.** At rest only the active nav marker, the music LED and the
  very faint cool wash inside link screens may carry light. Link-screen outer
  halos appear only in `:hover`/`:focus-visible`; everything else glows only in
  those states or `.is-playing`.
- **Motion budget.** Allowed: marquee (pauses on hover/focus), ~200ms pane
  switch, the small icon scale and power LED on link hover, the magnetic
  lean/tilt and pointer sheen (fine pointer only), the sparse 4px link sparks
  on enter/move/activation, LED/visualizer while actually playing, the
  pointer-driven ghost trail and its click-only triangle-petal burst, the short
  step-based link-menu open/close + scan sweep, the copy toast slide/progress,
  and the brief copy flash on a link tile. The ghost scheme has no idle glow;
  `classic` keeps the legacy glow as an explicit opt-in. Add nothing else, and
  gate new motion behind `prefers-reduced-motion` (see `context-menu.css` and
  `responsive.css`).
- **One signature detail.** 7px corner brackets on the framed surfaces —
  `.sidebar` and the terminal/webpage `.content-area`. The Link Exchange view
  is intentionally frameless, with its tiles unframed at rest; only the icon
  screen's hairline edge and near-black wash exist before interaction. Don't
  add a second decorative motif.
- **Focus law.** `base.css` defines one
  `:where(a, button, input, …):focus-visible` ring. Feature CSS may add an
  inset ring (e.g. the scrolling track list) but must never set
  `outline: none` on a focus state.
- **Honest values only.** The status rail, page counter and music labels show
  real state or `--` / `PAUSED`. Never invent a clock, a control, or a
  playback state.

## Known quirks

- Root `index.html` is only an entry wrapper; all site styling and behavior live
  under `main/`.
- `public/main/index.html`-style historical copies were removed with the old
  Windows-XP app; don't reintroduce mirrored copies of `main/`.
- `dora/` ships two deliberately divergent attendance apps: `index.html`
  (streaks, chips, desktop-height sync) and `app.html` (auth modal, confetti,
  calendar). Both are kept; `manifest.json` + `app-manifest.json` reference
  `./dora.webp` (512×512) and `sw.js` precaches both shells.
- `getNode` must keep preferring the absolute `vfs` entry over the root child
  stubs: root children are bare `{ type: 'dir' }` placeholders used only for
  listing, so walking into them first made `cd main` + `ls` print `(empty)`.
