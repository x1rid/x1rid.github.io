# Mobile Implementation Brief — x1rid.github.io

Companion to `VISUAL_IMPROVEMENTS_BRIEF.md` and `VISUAL_SOPHISTICATION_NOTES.md`.
Status: **implementation-ready** — reviewed against the current code. The
approved plan uses a compact/tablet mode at 760px and a separate phone shell
at 600px, with an event-based pane contract and an explicitly lifecycle-safe
controller.

The ask: **a mobile implementation of the desktop, designed separately.** Same
site, same static architecture, same visual grammar — but layout, material,
aesthetics and several functions are re-decided for a phone and only then reused
by tablets and desktop where they are genuinely better. Nothing here needs a
build step, a framework, a dependency, a second copy of the site, or user-agent
sniffing.

---

## 1. Thesis

The desktop build is a **simulated CRT workstation**: a fixed multi-column grid,
a draggable splitter, floating windows you can drag around, hover states, a GIF
cursor, a status rail. Every one of those ideas assumes a mouse, a large
viewport, and a user who is sitting down.

A phone is the opposite environment: one hand, one column, one small viewport,
no hover, no cursor, a soft keyboard that covers half the screen, safe areas cut
by the notch, and a battery. Squeezing the workstation down produces the exact
problems §2 lists.

So the phone build keeps the **identity** — purple/black, monospace, the two
voices (UI voice / content voice), the honest-values rule, the corner bracket,
the glow and motion budgets, the same panes and the same data — and replaces the
**interaction model** with a handheld one:

| Desktop idea | Phone idea |
|---|---|
| Sidebar navigation | Fixed bottom tab bar (`LINKS / TERMINAL / PAGES`) |
| Splitter + multi-column grid | Single column, full-bleed views |
| Draggable floating windows | Bottom sheet + pinned station bar |
| Hover reveals (GIF swap, tile lift) | Immediate press feedback; optional previews are deferred until tested |
| Pane swapped inside a workstation window | Full-screen view per pane, own header |
| Status rail with clock | Status line in the header, **no clock** (the phone has one) |
| Custom cursor | Disabled (already is — coarse pointers) |

The rule for the rest of this document: **if a control or affordance is
meaningless on a phone, delete it on the phone rather than restyle it** — the
same spirit as the existing "never display invented state" law.

---

## 2. What mobile is today

### 2.1 The current mobile surface

| File | Role today | Notes |
|---|---|---|
| `main/mobile.css` | 319 lines, loaded with `media="(max-width:760px)"` | Almost entirely `!important` overrides on top of the desktop sheets |
| `main/mobile.js` | 97 lines, runs once if `matchMedia('(max-width:760px)')` matches | Transplants and clones DOM at runtime |
| `main/css/responsive.css` | `@media (max-width:760px)` block | Partial overlap with `mobile.css` (marquee/footer sizes appear in both) |
| `main/terminal.css` | `@media (max-width:600px)` block | A second, independent phone breakpoint |
| `main/music.css` | `@media (max-width:480px)` block | A third |
| `main/splitter.js` | `matchMedia('(max-width: 760px)')` | A fourth copy of the same breakpoint, in JS |

Four breakpoints (`1040 / 760 / 600 / 480`) in four files, plus two JS copies of
`760`. There is no single source of truth for "what is a phone".

### 2.2 What already works and must be preserved

- The custom cursor **correctly refuses to run** on coarse pointers and with
  reduced motion (`custom-cursor.js`). Keep the guard; consider skipping the
  script tag on phones entirely (§6.4).
- `showPane('link' | 'pc' | 'webpage')` is already the single view switch, and
  `body.mobile-header-collapsed` already drives the "collapse the header when
  the terminal opens" idea (`terminal.js` ~1069). The phone build should extend
  this, not fork it.
- The terminal keeps the input focused at all times and already listens to
  `visualViewport` resize/scroll to keep the last line visible
  (`terminal.js` ~1592). That is the right instinct, implemented on top of a
  layout that fights it (§2.3.5).
- The music dock (`.rp-mini`) is already "a compact station badge that opens the
  player". It is the correct phone concept wearing desktop clothes.
- `mobile.css` hides `.status-rail`, `.panel-splitter`, and the desktop
  `.section-title` correctly. The status rail genuinely has no room on a phone.
- Tap-vs-drag thresholding already exists in `draggable.js`.

### 2.3 What breaks, concretely

1. **The header is an `<h2>` used as a toggle.** `mobile.js` rewrites
   `#main-section-title`'s `innerHTML` into `▸ LINK EXCHANGE ▸`, moves it into
   the sidebar and makes it click-toggle a nav dropdown
   (`#mobile-nav-dropdown`, `max-height: 260px`). No `aria-expanded`, no
   `role="button"`, no keyboard path, and `mobile.css` line 319 has to kill that
   heading's `::after` metadata so the desktop "N ENTRIES · FILTER" line does
   not leak into it.
2. **The transplant happens once, at load.** `mobile.js` returns early if the
   media query does not match at startup and never listens for changes. Rotate a
   tablet, resize a window, or open in a split-screen Android view and the DOM
   stays half-migrated. Rotating a phone back to ≥761px leaves a cloned navbar
   and a duplicated ID set (`mobile-nav-link-exchange`, …).
3. **Double and triple frame.** `body{padding:12px}` + container
   `width: calc(100% - 24px)` + `padding:12px` on desktop; the ≤760px override
   makes it `6px` + `calc(100% - 12px)` + `8px` — still three nesting surfaces
   before content, i.e. ~20px of dead margin each side of a 360px screen, plus a
   border on each layer.
4. **Conflict pile in `mobile.css`.** Repeats itself (`.profile-name` centring at
   lines 63 and 196; the "hide the first `.sidebar-nav`" rule at 80 and 191; the
   marquee/footer font sizes at 304–305 duplicating `responsive.css` 8 and 18),
   and fights `terminal.css`'s own ≤600px block: `mobile.css` sets
   `.terminal { height: 84vh !important; min-height: 560px !important }` while
   the phone shell needs a `dvh` formula. The `!important` wins, which is
   exactly why **landscape phones overflow**: 560px of minimum height in a
   ~360px-tall viewport. This rule must be removed, not overridden.
5. **`vh` everywhere, `dvh` nowhere.** `.terminal` `max-height: 100vh`,
   `.retro-player` `max-height: calc(100vh - 16px)`, and `100vh` inside the
   ≤600px terminal rule. On iOS/Android the address bar changes `100vh`, so the
   keyboard and the toolbar both push the layout around instead of the layout
   adapting. Missing: `dvh`/`svh`, `interactive-widget=resizes-content`, and
   `viewport-fit=cover` (without which `env(safe-area-inset-*)` is always zero —
   and no rule in `main/` uses safe areas today).
6. **iOS zooms the page when the terminal is tapped.** `.terminal-input` is
   `font: inherit` → 13px (12px at ≤600). Safari auto-zooms any focused input
   below 16px, so the first tap on the prompt leaves the user zoomed into a
   corner of the terminal. The page also has `touch-action: manipulation` only
   on `.terminal`, not on tiles/buttons, so every tap pays the double-tap-zoom
   delay and the default grey `-webkit-tap-highlight-color` flash.
7. **Tap targets below the 44px phone convention.** Category tabs 92×28
   (`links.css`), sidebar nav `min-height: 32px`, `.music-toggle`/`.music-link`
   ~22px tall, `.rp-mini-btn` 30px wide, `.rp-btn` 30px, `.rp-small` 22px,
   `.rp-track-item` ~21px, `.rp-window-btn` 18×16, `.webpage-toolbar button`
   ~28px (all `music.css` / `terminal.css`). On a phone every one of these is a
   miss-tap generator.
8. **Features that only exist on hover do not exist on a phone.** The animated
   `.gif` swap on link tiles (`pointerenter`) is not a dependable touch
   interaction. Do not replace it with a mandatory long-press: that competes
   with scrolling, selection, and native context menus. Start with static
   previews and clear press feedback; consider an opt-in preview only after
   testing its network and accessibility cost.
9. **The dock fights the page.** `.rp-mini` is `position: fixed` and
   `touch-action: none`, draggable with a 6px tap threshold. On a phone, dragging
   a floating toy competes with scrolling, it overlaps the footer and the last
   row of tiles, and "reset position with double-click" is unreachable.
10. **The webpage pane's fullscreen toggle is desktop-only in practice.**
    `#webpage-fullscreen` toggles a CSS class *and* calls
    `container.requestFullscreen?.()` (`terminal.js` ~1462). iOS Safari does not
    expose Element Fullscreen at all; the honest-values law then requires that
    the phone either hides the control or replaces it with a real action.
11. **Nothing owns phone state.** `chrome.js` keeps writing `.rail-*` values to a
    rail that is `display:none`; `mobile.js` keeps a cloned `.active` class in
    sync by hand; `showPane()` toggles `mobile-header-collapsed` from one place,
    `mobile.js` from another, and `mobile.css` drives the actual animation
    (220ms `max-height`) — three owners for one behaviour.
12. **The marquee is measured on every device.** The inline script in
    `index.html` runs a `ResizeObserver` on the marquee copy everywhere, for a
    banner that is collapsed half of the time on a phone.

None of this is a reason to restyle the desktop. It is a reason for the phone
build to have its own shell, its own controller and its own file.

---

## 3. Design language: the pocket build

Five decisions, in order of taste:

**3.1 One column, three fixed surfaces.** The phone screen is a stack:
`header` (identity + state) → `view` (scrolls internally or locks) → `bottom stack`
(mini player + tab bar). Nothing floats over content except the player sheet.

**3.2 The shell is a device, not a window.** Keep the retro framing but pay for
it once: `.geocities-container` keeps its border and shadow but loses the
padding double-count; the page background grid stays (it is nearly invisible
already); the corner-bracket signature moves to the header and the active tab
only, so the phone has the same "one signature detail" as the desktop at 1/3 of
the weight.

**3.3 Content gets the pixels.** 44px header, 52px tab bar + `env()` insets.
**Drop the marquee entirely on phones.** The 24px marquee is cramped on 360px
screens and adds vertical tax above content; dropping it saves visual noise and
allows skipping the inline marquee ResizeObserver script.

**3.4 Press states replace hover.** Every interactive surface gets an explicit
`:active` state (border → `--signal-active`, tint, 1px inset). Use
`touch-action: manipulation` on genuine controls and preserve `:focus-visible`;
do not add a document-level touchstart hack. Link tiles use static previews by
default. Optional animated previews are deferred until a separate test proves
they do not compete with scrolling, native long-press behavior, accessibility,
or network budgets.

**Magnetic hover is desktop-only.** The Link Exchange lean/tilt, pointer sheen
and enter/move sparks are gated by `(hover: hover) and (pointer: fine)` and
reduced motion. Touch keeps the explicit press state and the short pixel flash;
there is no sticky hover movement after a tap.

**3.5 Honest values, phone edition.**

- No clock in the header — the phone's own status bar already shows one. The
  desktop rail's clock is redundant here, not charming.
- Status line shows the pane, and `♫ <track>` / `♫ --` when the player has
  something real to say.
- Fullscreen is only offered where the platform really has it (§4.6).
- Drag affordances exist only where dragging is real: ≥769px.
- Pinned station bar is always visible when audio tracks exist, matching desktop
  honesty without layout jumps.

Palette, type scale, glow budget, motion budget: **unchanged**. This build adds
no hue, no glow and no new animation vocabulary.

---

---

## 4. Layout specification

### 4.1 Wireframe (≤600px, portrait)

```
┌─────────────────────────────────────────┐
│  [av] r3d1bruh            LINKS · ♫ --  │  44px  header, sticky (+ safe-area-t)
├─────────────────────────────────────────┤
│                                         │
│  LINK EXCHANGE              14 · ALL    │  view header (in-view, scrolls away)
│                                         │
│  [SOCIAL] [DEV] [PLAY]  →               │  44px tabs, horizontal scroll, snap
│                                         │
│  ┌────┐ ┌────┐ ┌────┐                   │
│  │icon│ │icon│ │icon│                   │  3-col grid, 44px+ hit area,
│  └────┘ └────┘ └────┘                   │  static preview + press feedback
│  ┌────┐ ┌────┐ ┌────┐                   │
│                                         │
│  ── about ──                            │  visits counter + copyright, quiet
├─────────────────────────────────────────┤
│  ▸ r3d1bruh.fm   Suffocation    ❚❚      │  38px  mini player (pinned row)
├─────────────────────────────────────────┤
│   LINKS      TERMINAL      PAGES        │  52px  tab bar (+ safe-area inset)
└─────────────────────────────────────────┘
```

Terminal view: header stays, view header becomes `TERMINAL — local`, key strip
pins above virtual keyboard, mini player stays, tab bar stays. Outer page scroll is
locked (`overscroll-behavior-y: contain`), terminal scrolls internally. The soft
keyboard then has the middle band.

### 4.2 Tokens (additions only)

```css
:root {
    /* phone shell (≤600px) */
    --pt-header-h:   44px;
    --pt-tabbar-h:   52px;
    --pt-mini-h:     38px;
    --pt-view-head-h: 34px;
    --pt-keys-h:     52px;
    --pt-gutter:     12px;
    --pt-tap:        44px;   /* minimum interactive box */
    --pt-safe-t:     env(safe-area-inset-top, 0px);
    --pt-safe-b:     env(safe-area-inset-bottom, 0px);
    --pt-safe-l:     env(safe-area-inset-left, 0px);
    --pt-safe-r:     env(safe-area-inset-right, 0px);
    --pt-keyboard-offset: 0px;
    --pt-fixed-stack: calc(var(--pt-mini-h) + var(--pt-tabbar-h) + var(--pt-safe-b));
}
```

Everything else comes from the existing token layer. No new colours.

### 4.3 Shell

- Viewport meta becomes
  `width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content`.
  (`viewport-fit=cover` is what makes the `env()` insets non-zero;
  `interactive-widget` is what makes Android Chrome resize instead of overlay.)
- `.geocities-container`: `width:100%; padding: 0 0 calc(var(--pt-fixed-stack) + 8px); border: 0 !important; box-shadow: none !important;` under
  600px — the phone is the device, the frame is the screen.
- Body padding drops to `0`; the gutter token provides the 12px. Horizontal safe areas
  (`--pt-safe-l`, `--pt-safe-r`) are applied to container and header padding to prevent
  notch overlap in landscape.
- Bottom stack: `position: fixed; inset: auto 0 0 0; padding-bottom: var(--pt-safe-b)`.
  Views get `padding-bottom: calc(var(--pt-fixed-stack) + 12px)`.
- `-webkit-tap-highlight-color: rgba(192,132,252,0.14)` globally; keep
  `:focus-visible` intact for keyboards/switch access.
- `touch-action: manipulation` on tiles, tabs, chips, buttons.
- `touch-action: manipulation` on genuine controls prevents unnecessary tap
  delay without a document-level touchstart workaround.

### 4.4 Header (replaces the transplanted heading)

```
[ 28px avatar ] r3d1bruh            LINKS · ♫ Suffocation
```

- It is a plain `<header>` with the real site `<h1>`. The desktop section title
  remains a pane heading; it is not promoted to the document heading.
- The avatar is decoration (identity), not a control. The name is the only
  display-size element on the phone.
- Right side: the status line, UI voice, `--text-2xs`, `tabular-nums`, values
  only (`LINKS`/`TERMINAL`/`PAGES` · `♫ <track>` / `♫ --`). The pane value is
  sourced from the `site:panechange` event emitted by `showPane()`; track text
  may be mirrored from the rail while phone mode is active.
- Tapping the header does nothing. It is not a dropdown.

### 4.5 Tab bar (replaces the nav dropdown)

- Real markup at the end of `.geocities-container`, `display: none` above
  600px. Nothing is cloned; nothing is transplanted.
- Tabs: `LINKS`, `TERMINAL`, and `PAGES` — the third appears only when
  `#webpages-list` has children (i.e. the user has used `open <url>`), and
  disappears when the last page is removed. Short labels fit cleanly across all screens.
- Behaviour: `aria-current="true"` on the active tab, `aria-controls` on the
  views, focus moves to the view's heading on switch for keyboard users (`:focus-visible`),
  and `Escape` returns to Links.
- The active tab carries the site's one signature detail (a small corner
  bracket) and subtle active glow.

### 4.6 Views

Each view is `.content-area` scoped by a `data-view` attribute set by the
controller (`link|pc|page`), so the desktop markup survives untouched.

- **Links view.** In-view header row: title left, `data-meta` right (the desktop
  `#main-section-title::after` idea, kept, but as a real element inside the view
  so `mobile.js` no longer has to suppress it). Category tabs: 44px tall,
  horizontal scroll strip with `scroll-snap-type: x proximity`, `ALL / SOCIAL /
  DEV / PLAY`, full-bleed to the gutter. Grid:
  `repeat(3, minmax(0, 1fr))` at 360px, `repeat(4, …)` at ≥480px, 10px inner
  gap, tiles ≥96px with the icon centred and the label clamped to 2 lines.
  Static previews and immediate press feedback keep scrolling predictable.
  Long-press keeps the native title/context menu.
- **Terminal view.** `.terminal` becomes `height: calc(100dvh - var(--pt-header-h) - var(--pt-view-head-h) - var(--pt-fixed-stack) - var(--pt-keyboard-offset) - 20px)`
  with a `vh` fallback, `min-height: 0`, and `12 → 16px` input font so
  iOS stops zooming (§2.3.6): input gets `font-size: 16px` on phones while the
  output keeps 13px.
  Set `overscroll-behavior-y: contain` on `.terminal` to stop scroll chaining into the outer body.
  Add a **key strip**: a 40px row pinned above the tab bar (or above virtual keyboard
  via `--pt-keyboard-offset`), visible while the terminal input is focused, with `↑` `↓` `TAB` `^C`
  `CLS` `HELP`. Each button synthesises the exact keyboard event the terminal
  already handles (`ArrowUp`, `ArrowDown`, `Tab`, `Ctrl+C`, then
  `window.runCommand('cls' | 'help')` for the last two).
  Input gains `enterkeyhint="send"`, `autocapitalize="off"`, `autocorrect="off"`,
  `autocomplete="off"`.
  Neofetch already stacks below 1040px; keep.
- **Pages view.** A dedicated section `#phone-pages` with list `#phone-pages-list`.
  **Mirroring architecture**: rather than destructive `appendChild` node reparenting
  (which breaks desktop state during rotation), the controller mirrors items from
  `#webpages-list` via clones that delegate click events to the original buttons.
  A `MutationObserver` on `#webpages-list` keeps the mirror updated reactively.
- **Webpage view.** Toolbar becomes a 44px row: back is a labelled `✕ CLOSE`
  target, title centred and truncating, and the fullscreen button is rendered
  only when `document.fullscreenEnabled` is true (feature-detect, do not sniff
  Safari). On phones without it, replace the control with a real action —
  `OPEN IN BROWSER` (`target="_blank" rel="noopener"`). Iframe fills the space above the tab bar.

### 4.7 Music on the phone

- **Mini player**: pin `.rp-mini` as a fixed row in the bottom stack
  (`left: 0 !important; right: 0 !important; top: auto !important; bottom: calc(...) !important;`)
  at phone width. Disable `RetroDrag` in phone mode; explicit `!important`
  positioning is only a defensive layer against stale inline coordinates.
  Keep the LED, progress spine, and tap-to-open behaviour.
- **Player**: `.retro-player` becomes a bottom sheet on phones: full width,
  `left: 0 !important; right: 0 !important; top: auto !important; bottom: 0 !important;`,
  `max-height: calc(100dvh - 64px)`, rounded top corners. Drag-down-to-dismiss
  is avoided (would fight playlist scroll); dismiss with `_`/`×` (44px hit targets).
  Controls, volume slider and track rows grow to 40-44px touch targets.
- **Unlock**: unchanged. Do not add any new autoplay attempt on phones; iOS will
  refuse and the honest `PRESS PLAY` label already covers it.

### 4.8 What the phone does not show

- marquee banner (dropped on phones for vertical budget),
- custom cursor (already guarded; also skip loading the script — §6.4),
- `.panel-splitter`,
- `.status-rail`,
- footer's desktop layout: the visits counter and copyright move into a quiet
  `about` block at the end of the Links view (visits stay real, stay local),
- the desktop `.section-title` (replaced by the in-view header),
- `.sidebar` entirely — the phone build never renders it (CSS `display: none`
  ≤600px, not a JS transplant).

---

## 5. Function matrix

| Feature | Desktop (`>760`) | Phone (`≤600`) | Shared code path |
|---|---|---|---|
| Navigation | Sidebar buttons + splitter | Tab bar | Both call `showPane()` |
| Pane switch animation | 200ms fade/slide | 160ms fade (shorter travel) | `animatePane()` |
| Header collapse | n/a | View-scoped chrome | `body[data-view]` controller state |
| Link tiles | Hover swaps GIF, 1px lift | Static preview, immediate press feedback, 44px targets | `link-exchange.js`; optional preview is deferred |
| Category filter | Underline tab row | Snap scroll strip | same buttons, CSS only |
| Terminal | 450px fixed window | `dvh` view, key strip, 16px input | `terminal.js` untouched except input attributes |
| Terminal history/complete | Up/Down, Tab | Key strip buttons dispatch the same events | existing handlers |
| Webpages | Sidebar buttons | Pages view (cloned mirror rows) | `webpagesList` + `MutationObserver` in controller |
| Webpage toolbar | 28px controls, fullscreen | 44px controls, fullscreen only if `fullscreenEnabled` | `terminal.js` / `mobile.js` feature-detect |
| Music dock | Floating + draggable | Pinned row in the bottom stack (`!important` pos) | `draggable.js` disabled or overridden |
| Music player | Floating window | Bottom sheet (`!important` pos) | same element, responsive CSS |
| Visits counter | Footer | `about` block, same size, same honesty | `chrome.js` untouched |
| Status rail | Real pane/track/clock | Hidden; header status line only (no clock) | `chrome.js` writes rail, controller mirrors |
| Cursor | GIF + trail | Never loads | `custom-cursor.js` guard stays |
| Splitter | Draggable | Not rendered | `splitter.js` early-returns |

---

## 6. Files, boundaries, and the controller

### 6.1 File plan

```
main/css/responsive.css   @media (max-width:760px)  → compact/tablet shared foundation
main/mobile.css           @media (max-width:760px)  → compact-layout clean-up
main/phone.css            @media (max-width:600px)  → phone shell
main/mobile.js            → the phone controller (~200 lines, idempotent)
```

- `phone.css` is linked **after** `mobile.css` in `index.html`, with
  `media="(max-width:600px)"` so it costs nothing to fetch above phone width.
- `responsive.css` stays in the `css/` cascade group; `phone.css` and
  `mobile.css` load after that group.
- There are two deliberate boundaries: **`760px`** for compact/tablet layout and
  **`600px`** for the phone shell. `mobile.js` and the `phone.css` media
  attribute must use the same `max-width: 600px` query.
- The 601–760px range remains a coherent compact desktop/tablet layout. It
  must not receive phone-only fixed chrome, keyboard controls, or hidden panes.
- `!important` positioning on `.retro-player` and `.rp-mini` is defensive only.
  The primary protection is to disable or skip draggable initialization for
  these elements in phone mode.

### 6.2 Markup additions (desktop-invisible)

```html
<!-- bottom stack: hidden above 600px -->
<nav id="phone-tabs" class="phone-tabs" aria-label="Views">
    <button type="button" class="phone-tab" data-view="link"  aria-controls="link-exchange" aria-current="true">LINKS</button>
    <button type="button" class="phone-tab" data-view="pc"    aria-controls="pc-specs" aria-current="false">TERMINAL</button>
    <button type="button" class="phone-tab" data-view="page"  aria-controls="phone-pages" aria-current="false" hidden>PAGES</button>
</nav>

<section id="phone-pages" class="phone-pages" aria-label="Opened pages">
    <div class="phone-view-head">
        <span class="phone-view-title">PAGES</span>
        <span class="phone-view-meta" id="phone-pages-meta"></span>
    </div>
    <div class="phone-pages-list" id="phone-pages-list"></div>
    <p class="phone-pages-empty" id="phone-pages-empty">NO SAVED PAGES — OPEN ONE FROM THE TERMINAL</p>
</section>

<header id="phone-header" class="phone-header">
    <img class="phone-avatar" src="./socials/pfp.webp" alt="" width="28" height="28">
    <span class="phone-name">r3d1bruh</span>
    <span class="phone-state" id="phone-state">LINKS · ♫ --</span>
</header>
```

Notes: elements are static in `main/index.html`. Terminal, player, and panes are
the existing elements — the controller toggles `body[data-view]` and mirrors state.

### 6.3 Controller specification (`main/mobile.js`)

```js
const PHONE = matchMedia('(max-width: 600px)');
```

Rules for the controller:

1. **Idempotence**: `on()` and `off()` can run repeatedly without leaking listeners
   or duplicating markup.
2. **Mirroring over reparenting**: Never move nodes out of `#webpages-list`. Cloned
   rows delegate clicks to the originals. A `MutationObserver` ensures reactivity.
3. **Pane state contract**: Listen for `site:panechange` emitted by `showPane()`;
   do not wrap or replace `window.showPane`. The controller projects the real
   pane into `data-view` and mirrors only presentation state.
4. **Reactive status projection**: Mirror `.rail-pane` and `.rail-track` only
   while phone mode is active. Store and disconnect every observer on exit;
   never create duplicate observers during rotation.
5. **Virtual keyboard synchronization**: Read `visualViewport` offsets when terminal
   input focuses, updating `--pt-keyboard-offset`. Key strip prevents input blur via
   `event.preventDefault()`.
6. **Keyboard accessibility**: Wire `Escape` to return to `LINKS` view when viewing
   Terminal or Pages.

### 6.4 Small optimisations that come free

- Inline guard or coarse pointer check avoids initializing `custom-cursor.js` on touch devices.
- `splitter.js` early-returns below 760px; the phone-only controller remains
  inactive above 600px.
- Skip marquee measurements on mobile (marquee not rendered).

---

## 7. Implementation phases

**Phase 1 — Shell & Architecture.**
`phone.css` (≤600px) + static elements in `index.html`; rewritten `mobile.js`;
remove old DOM transplanting; `body[data-view]` architecture. Run `python verify.py`.

**Phase 2 — Content surfaces & Interaction Ergonomics.**
In-view headers; snap tab strip; 3-col link grid; immediate press feedback;
quiet `about` block. Do not add a global touchstart hack or mandatory long-press.

**Phase 3 — Terminal, Virtual Keyboard & Pages.**
`dvh` sizing, 16px terminal input font, pinned key strip, `overscroll-behavior-y: contain`,
mirrored Pages view with click delegation, fullscreen external-link fallback.

**Phase 4 — Music Dock & Player Sheet.**
Disable phone-mode dragging, then add the pinned mini player and bottom sheet;
use defensive `!important` positioning only where stale inline styles require it;
add 44px hit targets.

**Phase 5 — Audit and verification.**
Rotation tests, landscape safe area notch audit (`--pt-safe-l/r`), keyboard navigation (`Tab`/`Esc`),
no horizontal overflow across 320px–430px, `python verify.py`.

---

## 8. Acceptance tests

- 320 / 360 / 390 / 430px portrait width: no horizontal overflow anywhere.
- Phone landscape (height ≈320px): safe area padding clears camera notch on left/right;
  terminal scrolls internally without overflowing the viewport.
- Terminal scrolling: scrolling inside `.terminal` does not drag or bounce the outer page.
- Keyboard open on the terminal: prompt line stays visible, key strip sits above keyboard,
  tab bar auto-hides; closing keyboard restores layout.
- iOS Safari: focusing terminal input does **not** zoom the page (16px input font);
  link tiles show active state feedback on touch.
- Touch scroll: scrolling through link tiles does **not** trigger preview network
  requests; no mandatory long-press interaction is required.
- Keyboard navigation: `Escape` from Terminal or Pages view cleanly returns to Links.
- `open example.com` in terminal → PAGES tab dynamically appears with count; selecting
  a page delegates click to the original action.
- Music player: opening player presents a clean bottom sheet regardless of previous
  desktop drag coordinates.
- Compact/tablet 601–760px: ordinary page flow remains usable with no phone-only
  fixed chrome or terminal sizing.
- Desktop ≥761px: pixel-for-pixel identical to current desktop build.
- `python verify.py` prints `VERIFY OK`.

---

## 9. Non-goals

- No second site, no `m.` subdomain, no user-agent routing.
- No build step, no framework, no npm dependencies.
- No new palette colors or visual redesign outside the handheld ergonomics.
- No drag gestures on phones (no swipe-to-dismiss sheet, no gesture navigation).
- No haptic vibration APIs.

---

## 10. Risks and Resolved Decisions

**Key Risks & Mitigations**

1. **Inline draggable style collision**: Prevented primarily by disabling phone-mode
   drag initialization for both player surfaces. `phone.css` may retain defensive
   `!important` coordinates (`left: 0 !important; right: 0 !important; top: auto !important;`)
   to neutralize stale inline styles.
2. **Touch preview conflicts**: Resolved by using static previews and immediate
   press feedback. Optional animated previews require a separate usability and
   network-cost test; they are not part of the baseline implementation.
3. **Landscape notch encroachment**: Handled by adding `--pt-safe-l` and `--pt-safe-r`
   tokens to `.geocities-container` and `.phone-header`.
4. **Intermediate breakpoint gap**: Resolved with two explicit modes: compact
   layout at `≤760px`, phone shell at `≤600px`. The 601–760px range is not phone mode.

**Decisions on Previous Open Questions**

1. **Tab labels**: Use **`LINKS / TERMINAL / PAGES`**. Compact, recognizable, and avoids truncation.
2. **Marquee**: **Dropped on phones**. Saves 24px+ of vertical space and eliminates marquee layout script overhead.
3. **Visits counter**: **Kept in quiet `about` block** at bottom of Links view.
4. **Mini player**: **Always visible in bottom stack** when audio tracks are available.
5. **Breakpoints**: Standardized on **`≤760px`** for compact layout and
   **`≤600px`** for the phone controller and phone shell.

---

## Appendix — desktop vs phone chrome budget

| Band | Desktop | Phone (Links) | Phone (Terminal) |
|---|---|---|---|
| Marquee | 28px | – | – |
| Status rail | 26px | – | – |
| Header (identity/state) | – (sidebar) | 44px | 44px |
| Sidebar column | 220px wide | – | – |
| Bottom stack | – | 90px + safe area | 90px + safe area |
| Fixed chrome total | ~54px | ~134px | ~134px |

The phone build maximizes viewport real estate for content and terminal output.

---

## 11. Approved implementation architecture

This section is authoritative where earlier exploratory sections conflict.
Keep the visual direction, the tab-bar concept, the safe-area work, and the
touch-target standards. Do **not** implement the earlier controller verbatim.

### 11.1 Use two deliberate compact modes, not one overloaded breakpoint

There are two different problems that should not be solved with the same UI:

| Mode | Boundary | Purpose | Shell |
|---|---|---|---|
| Compact layout | `max-width: 760px` | Narrow desktop windows, foldables, and small tablets | Reflow the current layout; keep ordinary page flow and desktop controls where usable. |
| Phone shell | `max-width: 600px` | Handheld, one-thumb interaction and virtual keyboard constraints | Header, one view at a time, fixed tab bar, pinned player, terminal key strip. |

`main/css/responsive.css` and `main/mobile.css` may own compact-layout rules.
`main/phone.css` and `main/mobile.js` may own the phone shell only. The media
query in the stylesheet link and the `matchMedia` string in JavaScript must both
be `max-width: 600px`; document that exact value beside both uses.

This intentionally gives 601–760px an explicit compact/tablet experience
instead of a broken half-phone state. Do not expand the phone shell to 768px
without separate testing on actual 768px tablets and an explicit design decision.

### 11.2 Establish a small, explicit view-state contract

Do not wrap or replace `window.showPane`. Script order makes that fragile, and
other features cannot reliably discover that it happened.

Instead, after the existing pane visibility changes, `showPane()` must emit one
event:

```js
document.dispatchEvent(new CustomEvent('site:panechange', {
    detail: { pane: 'link' } // or 'pc' / 'webpage'
}));
```

The phone controller listens for that event while phone mode is active and sets
only these presentation attributes:

```text
body[data-layout="phone"]
body[data-view="link" | "pc" | "web" | "page"]
```

`showPane()` remains the only owner of which real desktop pane is open. The
phone controller is only a projection of that state. Choosing the synthetic
Pages tab may open `data-view="page"` without changing the underlying real
pane; leaving Pages restores Links through the normal `showPane('link')` path.

### 11.3 Make the phone controller genuinely lifecycle-safe

Initialize static elements and event handlers once after the DOM is ready. Keep
references to every observer and listener that is active only in phone mode.

On entry to phone mode:

1. Set `data-layout="phone"`.
2. Subscribe once to `site:panechange`, focus changes, `visualViewport`, and
   the saved-pages source list.
3. Render the Pages mirror and synchronize status text.
4. Apply the current pane state.

On exit:

1. Abort/remove those listeners and disconnect the saved-pages observer.
2. Clear `data-layout`, `data-view`, typing state, keyboard offset, and mirrored
   rows.
3. Restore no DOM nodes, because the controller must never reparent desktop
   nodes in the first place.

Use an `AbortController` for mode-scoped listeners where supported; retain a
small manual removal fallback only if browser support is needed. Never create a
new `MutationObserver` on every rotation without disconnecting the previous one.

### 11.4 Keep keyboard geometry single-counted

The keyboard offset and fixed chrome are different quantities. They must never
be combined and then subtracted twice.

```css
:root {
    --pt-fixed-stack: calc(var(--pt-mini-h) + var(--pt-tabbar-h) + var(--pt-safe-b));
    --pt-keyboard-offset: 0px;
}

body.is-typing {
    --pt-fixed-stack: var(--pt-keys-h);
}

.terminal {
    height: calc(
        100dvh - var(--pt-header-h) - var(--pt-view-head-h)
        - var(--pt-fixed-stack) - var(--pt-keyboard-offset) - 20px
    );
}

.phone-keys {
    bottom: var(--pt-keyboard-offset);
}
```

`visualViewport` writes `--pt-keyboard-offset` only while the terminal input is
focused. On browsers where `interactive-widget=resizes-content` already makes
`dvh` smaller, the measured offset should resolve to zero; on overlay-style
viewports it is subtracted exactly once.

### 11.5 Remove the competing terminal rules before adding new ones

The old mobile rule `height: 84vh !important; min-height: 560px !important`
must be deleted or reduced to non-sizing compact styles. It cannot coexist with
the phone terminal formula.

Terminal height, minimum height, overflow containment, and the 16px input font
have one owner in `main/phone.css` at phone width. The compact stylesheet may
adjust visual density, but it must not set terminal height. This prevents
landscape overflow and avoids a cascade based on escalating `!important`.

### 11.6 Treat the player as non-draggable in phone mode

Prevent drag initialization for the mini player and full player when
`data-layout="phone"` is active. CSS is a defensive second layer, not the main
solution: phone positioning coordinates may use `!important` only to neutralize
old inline drag coordinates during the transition.

The mobile player has two predictable states:

- Mini player: fixed immediately above the tab bar.
- Full player: fixed bottom sheet, opened only through a real button.

No floating coordinates, double-click reset behavior, or touch drag behavior
should survive into phone mode.

### 11.7 Prefer reliable press feedback over a global touch hack

Do not add a document-level `touchstart` listener merely to force `:active`.
Use `touch-action: manipulation` on genuine controls, visible `:active` and
`:focus-visible` styles, and buttons/links with at least 44px hit areas.

Do not make a 120ms long press a required way to reveal GIFs. It competes with
scrolling and native long-press behavior. Start with static link tiles and good
press feedback; add an opt-in, tested preview affordance later only if animated
previews materially improve discovery without downloading assets during scroll.

### 11.8 Semantic and accessibility decisions

- Add one real site `<h1>` to the document structure (visually hidden on
  desktop if necessary); the phone header is presentation, not a faux button.
- Phone tabs are real buttons with `aria-current`; after activation, move focus
  to the target view heading only for keyboard-originated navigation.
- Implement `Escape` as a normal documented key handler: Terminal or Pages
  returns to Links. Do not intercept ordinary text typing or screen-reader
  shortcuts.
- Keep the status line concise and value-based. It must never be the only way
  an important state is communicated.
- Add the real site `<h1>` before styling the phone header; the existing desktop
  section title remains a pane heading, not the document heading.

### 11.9 Revised implementation sequence

1. **Stabilize:** enforce the two boundaries, remove conflicting terminal sizing,
   add the `site:panechange` event, and add the real site heading. No visual
   redesign yet.
2. **Shell:** add the static phone-only markup, CSS tokens, `data-layout`, and
   desktop-invisible styles. Verify that 601–760px remains a coherent compact
   desktop/tablet layout.
3. **Controller:** implement one enter/exit lifecycle, page mirroring, status
   projection, and tab/focus behavior. Store and disconnect every mode-scoped
   observer and listener. Test repeated rotation and resizing.
4. **Terminal:** add the single-count keyboard geometry, 16px input, key strip,
   and internal scroll containment.
5. **Player and polish:** disable drag in phone mode, add fixed mini/sheet
   layouts, then add non-essential visual polish.

### 11.10 Additional acceptance checks

- Cross the 600px boundary repeatedly in either direction: no duplicate page
  rows, duplicate callbacks, leaked observers, or stale `data-*` state.
- At 601px and 760px, no phone-only fixed chrome, hidden content, or terminal
  overflow is present.
- With the keyboard open, inspect the terminal in both Android Chrome and iOS
  Safari where possible; the visible prompt must remain above the keyboard
  without losing half of the output area to duplicate offset subtraction.
- Drag the desktop player, then enter phone mode: it must land in the pinned
  phone position and remain there.
- Trigger a pane change from a terminal command and from a tab: the phone header,
  active tab, and visible pane must agree in both cases.
- Inspect `MutationObserver` lifecycles while crossing 600px repeatedly: there
  must be one active saved-pages observer and no stale phone listeners.

## 12. Agent execution plan and progress tracking

Implement this brief in bounded parts. Do not attempt all parts in one context
window. Before starting a part, read only the files listed for that part and
the relevant acceptance checks. After finishing a part:

1. Run the smallest verification command that covers the changes.
2. Re-read the changed section or diff.
3. Record the part as `DONE`, `BLOCKED`, or `NOT STARTED`.
4. State the next part and its prerequisites.
5. Stop at the checkpoint if the context is becoming large or the result is
   not verified. Do not continue by guessing.

The implementation agent must preserve unrelated worktree changes and must not
rewrite completed parts unless a later verification failure requires it.

### Part 0 — Baseline and task state

**Status:** `DONE`

**Scope**

- Inspect the current mobile files and git status.
- Confirm the existing verification command and script order.
- Confirm the two boundaries:
  - compact/tablet: `max-width: 760px`
  - phone shell: `max-width: 600px`
- Do not edit application code in this part.

**Done when**

- The agent has a short baseline report.
- Existing unrelated changes are identified.
- The task tracker is updated before Part 1 begins.

### Part 1 — Shell and state contract

**Depends on:** Part 0  
**Status:** `DONE`

**Scope**

- Clean conflicting compact rules without changing desktop behavior.
- Remove the old mobile terminal height/minimum-height rule.
- Add or confirm static phone markup.
- Add the real site `<h1>`.
- Add the `site:panechange` event to `showPane()`.
- Set the phone stylesheet and controller to `max-width: 600px`.
- Keep 601–760px as compact/tablet layout only.

**Done when**

- No phone-only fixed chrome appears above 600px.
- No terminal rule forces `min-height: 560px`.
- `showPane()` remains the sole owner of real pane visibility.
- The pane-change event contains `link`, `pc`, or `webpage`.

### Part 2 — Controller lifecycle

**Depends on:** Part 1  
**Status:** `DONE`

**Scope**

- Remove `showPane()` wrapping/replacement.
- Implement explicit phone `on()` and `off()` lifecycle.
- Set and clear `data-layout="phone"` and `data-view`.
- Mirror saved pages without moving source nodes.
- Store and disconnect every mode-scoped `MutationObserver`.
- Store and remove visual viewport, focus, resize, and pane listeners.
- Fix status selectors and keep status projection read-only.

**Done when**

- Crossing 600px repeatedly creates no duplicate rows, listeners, or observers.
- Exiting phone mode clears phone attributes and mirror rows.
- Pane changes from both desktop code and phone tabs stay synchronized.

### Part 3 — Terminal and keyboard

**Depends on:** Part 2  
**Status:** `DONE`

**Scope**

- Implement `dvh` terminal sizing with a `vh` fallback.
- Use separate `--pt-fixed-stack` and `--pt-keyboard-offset` variables.
- Remove any remaining competing terminal sizing rules.
- Set the terminal input to at least 16px.
- Implement the key strip and exact keyboard events.
- Keep focus behavior and contain terminal scroll chaining.
- Implement `Escape` to return from Terminal or Pages to Links.

**Done when**

- Portrait and short landscape terminal views do not overflow.
- The prompt stays visible with the keyboard open.
- Keyboard offset is subtracted exactly once.
- Key-strip actions match terminal behavior.

### Part 4 — Player, surfaces, and accessibility

**Depends on:** Part 2  
**Status:** `DONE`

**Scope**

- Disable player dragging in phone mode.
- Keep CSS coordinate overrides only as defensive protection.
- Implement pinned mini-player and bottom-sheet player behavior.
- Ensure controls have usable touch targets and focus states.
- Keep static link previews and immediate press feedback.
- Hide the marquee on phones if the final shell budget requires it.
- Preserve fullscreen feature detection and external-browser fallback.

**Done when**

- Previous desktop player coordinates cannot displace the phone player.
- The player does not compete with page scrolling.
- No mandatory long-press or global touch hack is present.
- Important states are not communicated only through visual status text.

### Part 5 — Verification and handoff

**Depends on:** Parts 3 and 4  
**Status:** `DONE`

**Scope**

- Run repository verification.
- Test 320–430px portrait widths.
- Test short landscape and safe-area behavior.
- Test repeated rotation across 600px.
- Test saved-page creation/removal and Pages navigation.
- Test keyboard open/close and Escape.
- Test player after desktop dragging.
- Check desktop at 761px and above for regressions.
- Review the final diff for unrelated changes.

**Done when**

- All relevant acceptance checks pass or have an explicit documented blocker.
- The task tracker marks completed parts as `done`.
- The final response lists changed files, verification commands, and any
  remaining limitations.

### Progress record

The agent must maintain the following compact record in its task state after
each checkpoint. Do not mark a part done based only on code inspection.

```text
Part 0 — DONE
Part 1 — DONE
Part 2 — DONE
Part 3 — DONE
Part 4 — DONE
Part 5 — DONE
Current part — complete
Last verification — `python verify.py` — VERIFY OK (15 checks, 0 errors, 0 warnings)
Next checkpoint — none
Blockers — none
```

**Completion evidence** (measured in a 390×844 same-origin iframe harness, then
re-checked at 320, 360, 430, 568×320, 601, 700, 760, 900 and 1024):

- `showPane()` emits `site:panechange` after the visibility change and remains
  the only writer of `#link-exchange` / `#pc-specs` / `#webpage-pane`.
- Entry/exit sets and clears `body[data-layout]` and `body[data-view]`;
  four `MutationObserver`s and seven listeners are created on entry and
  disconnected/aborted on exit (counted: +4 observe / +4 disconnect per cycle,
  net 0 over four rotations).
- Crossing 600px four times left one saved page as one source button and one
  mirror row, and produced no duplicate ids (`duplicateIds: []`).
- Leaving Terminal clears `is-typing` (tab bar and dock return).
- `--pt-fixed-stack` = 90px idle / 52px typing; typing raised the terminal from
  648px to 686px in a 844px viewport, and the key strip sat at 791–844 with the
  terminal bottom at 720 (no overlap).
- Landscape 568×320: header 36px, terminal 150px ending at 236, tab bar top 274.
- Desktop 761px+ and 601–760px show no phone chrome, no `data-layout`, and the
  compact tile grid stays four columns without horizontal overflow.
- A dock dragged at 900px lands in the pinned phone position (inline
  coordinates cleared, sheet 0–375px wide, bottom-anchored) and returns to its
  saved spot at 900px; drag gestures in phone mode move nothing.
- H1 count is one (`r3d1bruh`); the marquee is `display: none` at phone width
  and its measuring observer is not installed there.


Allowed status transitions are:

```text
NOT STARTED -> IN PROGRESS -> DONE
NOT STARTED -> IN PROGRESS -> BLOCKED
BLOCKED -> IN PROGRESS
```

If a part is blocked, preserve the evidence, explain the blocker, and do not
silently skip ahead to a dependent part. Independent parts may proceed only
when their listed dependency is already `DONE`.
