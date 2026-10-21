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
    sfx.css         → footer interface-sound control styles
    context-menu.css→ desktop link menu + copy-confirmation styles
    mobile.css      → <=760px compact/tablet layout
    phone.css       → <=600px phone shell (linked with media="(max-width:600px)")
    draggable.js    → shared drag physics for the player window + dock
    custom-cursor.js→ cursor schemes (pixel ghost / classic / rail / native)
    context-menu.js → link-only desktop context menu + clipboard toast
    link-exchange.js→ link tiles (render, filters, magnetic hover, brand accents)
    splitter.js     → draggable sidebar divider
    music.js        → music widget + player
    sfx.js          → opt-in synthesized interface sounds
    terminal.js     → fake terminal + windows/webpage in-page browsing
    iframe-policy.js→ framing policy for the page pane (known blocked hosts)
    chrome.js       → status rail, public page-view counter, focused-window state
    mobile.js       → phone shell controller (<=600px): tab bar, pages mirror,
                      terminal key strip, virtual-keyboard geometry
    assets/         → pixel cursor sprites + classic cursor GIFs
    playlist/       → music tracks + playlist.json (manifest)
    socials/        → profile avatar + icons/ (one square SVG per link)
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
- `cursor ghost|classic|rail|native`
- `sound on|off|toggle|test`
- `help`

The terminal also supports command history with Up/Down arrows, Tab autocomplete,
Ctrl+L to clear, and persistent history in `localStorage`. Pages opened with
`open`/`start` (or from the link menu's page-pane action) stay in the sidebar
below Neofetch as temporary tabs. Each tab has a cross button that closes just
that tab; if it is on screen, the pane returns to the link exchange. Sites that
refuse framing (`X-Frame-Options` / CSP `frame-ancestors`) open in a real tab
instead of creating a dead pane tab.

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
- Starts at a quiet 6% volume by default, below the interface effects
- Optional background music remembered between visits

## Interface sounds

`main/sfx.js` is an **opt-in** layer, off by default and separate from the music
player's own sound preference. Turn it on with the footer `SFX` control or the
terminal `sound on|off|toggle|test` command; the choice persists in
`localStorage['retroSfxEnabled']`. While it is off, keyboard and pointer actions
stay silent; the music player still follows its own autoplay preference.

- Sounds are synthesized locally with Web Audio — no audio files, no network,
  no autoplay before the first user gesture.
- Only actions make noise: pointer clicks, right-click, terminal key/Enter and
  command results, pane changes, music-window open/close, and a short power-on
  chime when enabled. Each family has its own voice: click, low right-click
  thud, high typing tick, carriage-return Enter, rising success arpeggio,
  descending error buzz, pane relay, window sweep, and power-on chord.
- Hover, wheel and continuous drag stay silent on purpose.
- Interface sounds are mixed above the music bed; lower the music slider if the
  two compete.
- `sound test` plays the full voice set once so the differences are easy to
  hear.
- `sound` output is honest: `Interface sounds: ON|OFF`.

## Custom cursor

`main/custom-cursor.js` owns four persisted schemes, switchable with
`cursor ghost|classic|rail|native`:

- **ghost** (default) — a 32px pixel arrow, a lavender link accent instead of a
  finger, a magenta press frame, a small state badge for right-click, wheel and
  drag, a ten-frame Windows 95 ghost trail and a small 360° flower of lavender
  triangle petals when a link or button is pressed. It stands down over text fields, the splitter and
  embedded pages so the browser keeps its native I-beam/resize cursors.
- **classic** — the original 48px animated GIF, glow and rainbow particle
  trail, kept as an opt-in time capsule.
- **rail** — native pointer only; the status rail reports live coordinates and
  hit state (`PTR 0842,0411 · LINK`).
- **native** — no custom pointer at all.

Ghost and classic only run on fine pointers with motion allowed above the phone
shell (`<=600px`); reduced-motion users fall back to the native pointer, as do
touch/phone layouts. Rail and native still work under reduced motion; rail
telemetry is desktop-only. The scheme is stored in
`localStorage['retroCursorScheme']`.

## Link exchange

Tiles are defined in `main/data/links.json` — edit it to add or change a link
(the inline fallback in `link-exchange.js` keeps the page working offline).
Each tile uses one square SVG from `main/socials/icons/`; the old animated
`.gif`/`.webp` pairs are gone. The Link Exchange view is deliberately
frameless: the sidebar and terminal keep the panel frame, while the links sit
directly on a faint dot-grid desktop. Filters are underline tabs on a single
hairline (ALL, SOCIAL, DEV, PLAY, MORE), and tiles are unframed at rest so the
icon screen is the only surface that lights up.

Hover and keyboard focus are carried by the screen: the rounded icon screen
glows from within in the link's own accent colour, and the same layer spills a
little light past the bezel, so the inner and outer glow meet without a hard
seam. At rest the screen keeps a hairline purple edge and a barely-there cool
wash. On a fine pointer it leans a few pixels toward the cursor, tilts a degree
or two, a soft sheen follows the pointer, and a few 4px sparks mark enter,
movement and activation. The icon grows slightly, the label picks up the same
accent, and a tiny power LED lights in the screen corner. The icons stay close
to their natural size and shape so their details stay readable. The effect is
scoped to Link Exchange tiles; touch drops the lean/tilt/sheen, and
`prefers-reduced-motion` reduces it to colour-only feedback.

## Desktop link menu

On a desktop/fine pointer, right-click any `http(s)` link — including a Link
Exchange tile — for a small retro menu:

- **COPY LINK** copies the absolute URL and shows a bottom `LINK COPIED` snackbar
  with the destination (Android-style, but in the site's pixel styling).
- **OPEN IN NEW TAB** opens the link in a normal browser tab.
- **OPEN IN PAGE PANE** sends it to the existing terminal webpage pane and its
  saved-page list. The action is omitted for hosts that refuse framing
  (GitHub, Reddit, social platforms, Google/YouTube and similar), because those
  pages can only show a browser error inside an iframe.

The menu is deliberately link-scoped: text, inputs, empty space, `mailto:` links,
the terminal and embedded pages keep the browser's native menu. Hold **Shift**
while right-clicking for the native menu anywhere. The keyboard Menu key or
**Shift+F10** opens the custom menu; arrow keys move, and Escape closes it.
Touch and phone layouts always keep long-press native behavior. Motion is short
and step-based (menu boot/scan, toast slide/progress, a brief tile flash on copy)
and is removed under `prefers-reduced-motion`.

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

## Desktop shell prototype & Programs

`main/desktop-shell.html` is the unlinked desktop-shell spike: a purple
Explorer, taskbar, live wallpaper, start search, local music, and real windows.
It includes an in-house **Programs** shelf — Minesweeper, Paint, Solitaire, and
Calculator — opened from the taskbar `PROGRAMS` button, Start search, or the
shell terminal with `apps` / `apps <id>`.

The four programs are original, dependency-free implementations re-themed with
the site's own tokens. They are inspired by, not copied from, these projects:

- [Webamp](https://github.com/captbaritone/webamp) and
  [winamp2-js](https://github.com/captbaritone/winamp2-js) — media-player
  window grammar and the idea of a small, self-contained retro app.
- [JS Paint](https://github.com/1j01/jspaint) — pixel canvas tools, palette,
  undo, and keyboard shortcuts.
- [Pixel Art Maker](https://github.com/1j01/pixel-art-maker) — small canvas
  editor ergonomics.
- [muammar/minesweeper](https://github.com/muammar/minesweeper) and
  [nickarocho/minesweeper](https://github.com/nickarocho/minesweeper) —
  board behavior, flood reveal, flags, and chording.
- [Frans-Willem/Solitaire](https://github.com/Frans-Willem/Solitaire) —
  Klondike rules, draw modes, and win detection.
- [98.js](https://github.com/1j01/98), [98.css](https://github.com/jdan/98.css),
  [XP.css](https://github.com/botoxparty/XP.css), and
  [7.css](https://github.com/botoxparty/7.css) — window chrome and desktop
  interaction references. The prototype deliberately keeps the purple/black
  site palette instead of importing grey Windows chrome.
- [daedalOS](https://github.com/DustinBrett/daedalOS) — desktop-shell and
  window-manager organization ideas.

No upstream source is vendored. The Programs app files live in `main/apps/` and
register through the shell's `window.RetroApps` contract; `main/apps.css` holds
their shared skin.

## Development

```
python serve.py [port]   # default 5500
python verify.py         # static checks: JSON, asset refs, JS syntax
```

Then open http://127.0.0.1:5500/main/index.html

Committing is plain `git`; GitHub Pages serves the repository root.

## License

MIT — see [LICENSE](LICENSE).
