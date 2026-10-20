# x1rid.github.io

A purple/black retro personal homepage. Fully static — no build step, no
dependencies, no framework.

**Live:** https://x1rid.github.io (the root page embeds the `/main/` site without
an initial navigation redirect)

## Structure

```
index.html          → full-viewport entry wrapper for ./main/index.html
main/               → the retro homepage
    index.html      → page shell (markup + tags only)
    css/            → theme/layout modules (variables, base, marquee, layout,
                      links, components, responsive)
    data/           → links.json (link tiles) + vfs.json (terminal filesystem)
    terminal.css    → terminal / neofetch / webpage-pane styles
    music.css       → music widget + player styles
    mobile.css      → <=760px compact/tablet layout
    phone.css       → <=600px phone shell (linked with media="(max-width:600px)")
    draggable.js    → shared drag physics for the player window + dock
    custom-cursor.js→ animated GIF cursor + particle trail
    link-exchange.js→ link tiles (animated on hover only)
    splitter.js     → draggable sidebar divider
    music.js        → music widget + player
    terminal.js     → fake terminal + windows/webpage in-page browsing
    chrome.js       → status rail, public page-view counter, focused-window state
    mobile.js       → phone shell controller (<=600px): tab bar, pages mirror,
                      terminal key strip, virtual-keyboard geometry
    assets/         → cursor GIFs
    playlist/       → music tracks + playlist.json (manifest)
    socials/        → profile/social icons (.webp static, .gif animated)
dora/               → doraverse / anushkaverse side project site
l/                  → link-tree page
serve.py            → local dev server (also auto-lists /main/playlist)
verify.py           → static checks (JSON, asset references, JS syntax)
```

## Terminal

The `main/` page includes a fake terminal with these commands:

- `cls`
- `dir` / `ls`
- `cd`
- `start` / `open`
- `man`
- `echo`
- `rm`, `rmdir`, `cp`
- `save`, `load`, `saved-files`
- `neofetch`
- `layout compact|normal`
- `promptgap <px>`
- `help`

The terminal also supports command history with Up/Down arrows, Tab autocomplete,
Ctrl+L to clear, and persistent history in `localStorage`. Pages opened with
`open`/`start` stay in the sidebar below Neofetch.

## Music

Tracks live in `main/playlist/`. Add or remove audio files and update
`main/playlist/playlist.json` so the deployed (GitHub Pages) player can find them.
When running the local dev server (`python serve.py`) or any server that exposes a
directory listing, the player picks up new files automatically.

Features:

- Purple/black retro player window
- Autoplays on load, starting minimized in the lower-right dock until the
  dock is tapped (only an explicit "sound off" keeps it silent)
- Draggable dock (position remembered; double-click to re-dock it)
- Draggable title bar with saved position
- Track list, seek, volume and crossfades
- Optional background music remembered between visits

## Custom cursor

`main/custom-cursor.js` replaces the system cursor with an animated GIF (48px)
plus a rainbow particle trail. It only activates on fine pointers with motion
allowed, pauses when the tab is hidden or the pointer leaves the window, and is
hidden if the GIF fails to load.

## Link exchange

Tiles are defined in `main/data/links.json` — edit it to add or change a link
(the inline fallback in `link-exchange.js` keeps the page working offline).
Icons are static `.webp`; animated `.gif` versions are only fetched and played
while a tile is hovered or focused. Touch devices keep the static tile (a tap
navigates away), so scrolling never downloads an animation.

## Interface details

- The status rail above the desktop shows only real state: current pane, actual
  playback state (`--` / `PAUSED` when idle) and the local time.
- The footer shows approximate total page views from the public Abacus counter
  API. It counts page loads, not unique people, may be inflated, and displays
  `------` when the service is unavailable. The per-tab guard avoids repeated
  hits on reloads, but is not a visitor-deduplication system.
- `main/chrome.js` owns both, plus the focused-window border state. It hides
  the rail on phones and does nothing if its markup is missing.
- Without JavaScript the page still lists the links and hides controls that
  cannot work.

## Phones

`main/phone.css` + `main/mobile.js` are a separate shell for `<=600px` tracks,
not a squeezed desktop. Two deliberate boundaries exist: **`760px`** is the
compact/tablet layout (`responsive.css` + `mobile.css`, still the desktop's own
controls in one column) and **`600px`** is the phone shell.

- **Header** shows a `r3d1bruh://links`-style path for the current view plus
  its meta (entry count/filter, `local`, saved-page count). The music track is
  not mirrored here; it stays in the pinned bar.
- **Tab bar** replaces the sidebar: `LINKS`, `TERMINAL`, and `PAGES` (which
  appears only once a page has been opened with `open <url>`).
- **Music** is a pinned bar above the tab bar; the player is a bottom sheet.
  Neither is draggable on a phone (the desktop keeps dragging its floating
  windows).
- **Terminal** gets a key strip (↑ ↓ TAB ^C CLS HELP) because soft keyboards
  have no arrows, Tab or Ctrl, an input that never triggers Safari's zoom, and
  a height that accounts for the on-screen keyboard (`--pt-keyboard-offset`)
  and the fixed chrome (`--pt-fixed-stack`) exactly once each.
- `Escape` returns from Terminal or Pages to Links.
- The marquee is not rendered at this width, and `main/mobile.js` stops
  measuring it so a hidden banner costs nothing.

Panes stay owned by `terminal.js`: `showPane()` emits one `site:panechange`
event and the phone controller only projects it into
`body[data-layout="phone"]` / `body[data-view]`. Crossing the boundary
repeatedly is safe — every listener and observer the controller creates is
removed when phone mode exits.

## Development

```
python serve.py [port]   # default 5500
python verify.py         # static checks: JSON, asset refs, JS syntax
```

Then open http://127.0.0.1:5500/main/index.html

Committing is plain `git`; GitHub Pages serves the repository root.

## License

MIT — see [LICENSE](LICENSE).
