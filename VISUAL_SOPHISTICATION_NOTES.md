# Visual Sophistication Notes — x1rid.github.io

Companion to `VISUAL_IMPROVEMENTS_BRIEF.md`. Status: **implemented** (phases 1–3
plus the accessibility pass). The only deferral is the optional hover caption in
§6a; the resulting conventions are documented in `CODEBASE.md` → Visual system.

That brief is a solid plan; this document is a different cut of the same goal. Read both,
then implement one plan, not both. Where they disagree, I say so and why.

## Thesis

The site already has personality (terminal, music dock, GIF cursor, marquee). What it
lacks is **system** — the thing that separates "personal site with lots of stuff" from
"interface someone designed". Sophistication here is not more chrome. It is:

1. **Every glowing thing means something.** If it lights up without conveying state,
   it is decoration and it lowers the signal of the things that matter.
2. **Every displayed value is real or absent.** No fake clocks, no fake controls,
   no telemetry theater. `--` beats a lie.
3. **One detail used everywhere beats ten details used once.** A single border recipe,
   a single focus ring, a single signature corner — repeated.
4. **Quiet by default, loud on state.** The current site is already loud; the win is
   making the quiet parts quieter so the loud parts read as *deliberate*.

The areas where I disagree with the existing brief: its decorative window controls and
fake system time (violates rule 2), its link-tile redesign into description rows (loses
the icon-forward identity), and a terminal scanline overlay (fights rule 4 and the
13px monospace legibility that `REFACTORING_PROPOSAL.md` already flagged).

---

## 1. Typography: two voices and a scale

Right now sizes range from `0.64rem` (`.badge-label`) to `1.2rem` (`.section-title`,
`.profile-name`) with tracking chosen ad hoc (`0.02em`, `0.04em`, `0.06em`, `0.08em`,
`0.14em` all appear).

Define a scale in `main/css/variables.css`:

```css
/* ---- type scale ---- */
--text-2xs: 0.62rem;   /* state labels, footnotes      */
--text-xs:  0.72rem;   /* UI metadata                  */
--text-sm:  0.82rem;   /* UI controls, nav             */
--text-md:  0.95rem;   /* body copy                    */
--text-lg:  1.2rem;    /* the one display element      */
--track-ui: 0.14em;    /* tracking for ALL uppercase UI voice text */
```

Then enforce **two voices** and never blend them:

| Voice | Used for | Treatment |
|---|---|---|
| **UI voice** | nav, controls, labels, metadata, footer | uppercase, `--track-ui`, `--text-2xs`–`--text-sm`, muted ink |
| **Content voice** | terminal output, track names, tile names, descriptions | sentence case, no artificial tracking, `--text-md` |

A logo-style name like "r3d1bruh" is the only stylized element; everything else obeys
the table. This single rule is what makes 0.64rem text stop looking like an accident:
it becomes a *register* instead of "the size that happened to fit".

**Numbers that can change must never jitter.** Keep the monospace face, add
`font-variant-numeric: tabular-nums` and a `min-width` to `.hit-counter`, `.rp-time`,
`.rp-status`, and the dock track ticker.

**Extend terminal selection styling to the whole site.** Today only `.terminal ::selection`
is styled; add one global rule so selecting any text feels designed:

```css
::selection { background: #6f3a93; color: #f2eaff; }
```

**Pause the marquee on hover/focus.** It is currently a 42s loop nobody can stop:

```css
.marquee-top:hover .marquee-track,
.marquee-top:focus-within .marquee-track { animation-play-state: paused; }
```

---

## 2. Color: semantic roles and the one-accent rule

`#55ff99` currently means "hover" on the sidebar, the category tabs, the link tiles and
the music toggle — and it also means "terminal green" and "online". One color, four
meanings, zero signal.

Introduce a role layer in `variables.css` (keep the existing `--dr-*` names as aliases
so nothing breaks):

```css
/* ---- surfaces (elevation ladder) ---- */
--surface-0: #0b061d;   /* page                     */
--surface-1: #130927;   /* sidebar, content area     */
--surface-2: #100721;   /* tiles, footer panel       */
--surface-3: #07020a;   /* terminal + player screen  */
--line:      #4d286b;
--line-hi:   #6f3a93;

/* ---- ink ---- */
--ink-90: #f2eaff;  --ink-70: #cda6ff;  --ink-50: #8b72b8;  --ink-30: #5d4783;

/* ---- signals (the only allowed glow colors) ---- */
--signal-ok:     #55ff99;  /* terminal + online/local */
--signal-active: #c084fc;  /* navigation + selection  */
--signal-hot:    #ff4fd8;  /* now playing + attention */
```

**One accent per context.** Proposed mapping:

| Context | Accent |
|---|---|
| Terminal pane, splitter grip, online state | `--signal-ok` |
| Nav, category tabs, tiles, focus rings, links | `--signal-active` |
| Music, now-playing, close/destructive | `--signal-hot` |

Concretely: sidebar hover/active, `.link-exchange-category`, and `.social-tile` hover
stop turning green and turn lavender; green is reserved for the terminal, the hit
counter, and true "on" states. This is the biggest taste decision in this document —
but it is the difference between "the site uses green sometimes" and "green means
something".

**Glow budget (write this into `CODEBASE.md`).** At rest, at most two elements may
glow: the active nav indicator and the music LED. Everything else may glow only in
`:hover` / `:focus-visible` / `.is-playing`. Future agents must justify new glows
against this rule.

Also unify the four hardcoded scrollbar colors (`#6f3a93` in `base.css`, `terminal.css`,
`music.css`) into `--line-hi` / `--surface-3`.

---

## 3. Focus: one ring to rule them all

Focus is currently component-by-component: `layout.css` uses green dotted outlines,
`links.css` repeats them, `terminal.css` has `outline: none` on the input, and
`.rp-btn`, `.rp-small`, `.rp-window-btn`, `.rp-track-item` all set `outline: none` on
focus. Keyboard users get inconsistent (or missing) feedback.

**Focus law** — one global rule, components may only *add* to it, never remove it:

```css
:where(a, button, input, [tabindex]):focus-visible {
    outline: 2px solid var(--signal-active);
    outline-offset: 2px;
}
```

Delete every `outline: none` on focus states. Special cases:

- `.terminal-input`: keep no outline *on the input itself*; instead brighten the whole
  input line (`#terminal-input:focus ~ …` or `:focus-within` on `.terminal-line`) and
  keep the magenta caret. A terminal shouldn't draw a browser ring inside the prompt,
  but it must still be visibly focused.
- `.panel-splitter`: it has `tabindex="0"` and no visible focus style today — give it
  the same ring. It is also the only keyboard-only control with no hint; add a
  `title`/`aria-keyshortcuts` note and render the grip brighter on focus.

Acceptance: tab through the entire page, no mouse. Every stop is visible.

---

## 4. Windows without fake chrome

Skip the decorative minimize/close buttons and fake system time from the other brief.
Instead, two ideas that use data you actually have:

### 4a. Focused-window state ("which window is active")

The most OS-like feeling available for ~15 lines of JS: the pane you last interacted
with gets a brighter border; the others go quiet.

```css
.pane { border: 1px solid transparent; transition: border-color 140ms, background-color 140ms; }
.pane.is-active { border-color: var(--line-hi); background: var(--surface-1); }
.pane.is-idle   { border-color: transparent; background: color-mix(in srgb, var(--surface-1) 86%, var(--surface-0)); }
```

Wire with a single `focusin` + `click` listener that sets `data-focus` on
`.geocities-container`. Default before any interaction: everything full brightness, so
touch users and no-JS users see no change.

**Do not use `filter` or `transform` to dim panes.** `#webpage-pane` contains
`.webpage-fullscreen` (`position: fixed`); an ancestor with `filter`, `backdrop-filter`
or `transform` becomes its containing block and breaks fullscreen. Border and background
tints only. (Same reason the page texture below uses `position: fixed` on a pseudo-element
and never `filter` on real containers.)

### 4b. A status rail that only tells the truth

The marquee is already the site's top strip. Add a slim rail (or extend the marquee's
ends) with real values only, each from a source that exists:

```
r3d1bruh://link-exchange   ·   ♫ Suffocation   ·   14:03   ·   LOCAL
   (current pane)              (music.js state)  (real clock)   (always)
```

Unknown value → `--`, never a plausible-looking fake. One line of formatting, updated
on the events that already exist (`music.js` track change, pane switch, a 30s clock
tick). On mobile the rail hides with the existing `body.mobile-header-collapsed`
behavior — do not give phones a permanent new strip.

The rail replaces the brief's "fake system time + decorative controls" with the same
visual idea and zero lies.

### 4c. Section titles as directory listings

Today: centered `LINK EXCHANGE` with a magenta glow. More sophisticated and more
useful:

```
[ LINK EXCHANGE ]                              10 ENTRIES · FILTER: ALL
```

Left-aligned title, right-aligned live metadata in UI voice. `link-exchange.js`
already knows the count and the active category — set
`titleEl.dataset.meta = `${n} entries · filter: ${label}`` and render with
`content: attr(data-meta)`. Same for Neofetch (`TTY · 80×24`) if it fits naturally.

---

## 5. Material: one panel recipe, one texture, one signature

### 5a. The panel recipe

Replace the mix of one-off inset glows with a single recipe, applied to `.sidebar`,
`.content-area`, `.social-tile`, `.music-panel`:

```css
.retro-panel {
    background: var(--surface-1);
    border: 1px solid var(--line);
    box-shadow:
        inset 0 1px 0 rgb(255 255 255 / 0.04),
        0 1px 0 rgb(0 0 0 / 0.45);
}
```

Raised things (tiles) use `--surface-2`; screens (terminal, player) use `--surface-3`.
Keep the existing `!important`s until the inline styles they fight are gone — do not
"fix" them as part of this work.

### 5b. Page texture: a static 24px grid, nothing else

```css
body::before {
    content: '';
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background-image:
        linear-gradient(rgb(160 32 240 / 0.05) 1px, transparent 1px),
        linear-gradient(90deg, rgb(160 32 240 / 0.05) 1px, transparent 1px);
    background-size: 24px 24px;
    -webkit-mask-image: radial-gradient(ellipse at 50% 0%, #000 35%, transparent 90%);
    mask-image: radial-gradient(ellipse at 50% 0%, #000 35%, transparent 90%);
}
.geocities-container { position: relative; z-index: 1; }
```

No scanlines over text, no noise images, no animation. Fades toward the bottom so long
pages stay calm.

### 5c. Choose exactly one signature detail

Pick one and repeat it on every window (not on tiles):

- **Corner brackets** — 6px `::before/::after` L-shapes on the two opposite corners; or
- **Revision screws** — four 2px dots, like hardware; or
- **Titlebar rule** — a 1px double line under each pane title.

Any is fine. All three is a costume. Decide once, document it in `CODEBASE.md`.

### 5d. Splitter as a grip, not a grenade

The 8×34px green box (`layout.css`) is the loudest element in the quiet column. Make it
lavender (`--signal-active`), 6px wide, with three 1px horizontal dashes — a grip that
reads as "drag me" and stops competing with the terminal for green.

---

## 6. Content surfaces, refined in place

### 6a. Link tiles — keep the identity, add metadata

The icon-forward 5-column grid with hover GIF swaps **is** this pane. Do not convert it
to description rows. Instead, in `link-exchange.js`, add the domain to the tooltip and
the accessible name (one helper, zero layout shift):

```js
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
tile.title = host(url) ? `${name} — ${host(url)}` : name;
tile.setAttribute('aria-label', `Open ${name}${host(url) ? ' (' + host(url) + ')' : ''}`);
```

Optional, if you want it visible: a caption bar that slides over the bottom of the
`.icon-frame` on hover/focus only (absolute, no reflow, no animation under
`prefers-reduced-motion`). The hover GIF and caption compete for attention though —
prefer the tooltip-only version unless you try the visual one and like it.

### 6b. Empty states as dead channels

Add a tiny state vocabulary to the grid: `data-state="ready|empty|error"`. Style
`empty`/`error` as a static boxed panel — dim border, `--ink-50`, message like
`NO SIGNAL — NO LINKS IN THIS CATEGORY`, no shimmer, no spinner. Honest note: with the
current fallback array, `error` should never appear for links; this matters for future
data-backed panes, and it costs ~10 lines to have the vocabulary in place.

### 6c. Music — fix the actual weak spot

The player window and dock are already deliberate. The unrelated cluster is the footer
`.music-panel` (label + toggle + link + now-playing = four competing elements). Collapse
it to: a state LED, the track ticker (clickable → opens player), and the sound toggle.
Three things, one voice, same behavior.

Optional flourish with real data: a 2px progress spine on the dock's leading edge,
driven by `audio.timeupdate` → `--rp-progress`:

```css
.rp-mini::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
    background: linear-gradient(var(--rp-hot), var(--rp-accent));
    transform: scaleY(var(--rp-progress, 0)); transform-origin: top;
}
```

### 6d. Terminal — authenticity without scanlines

- A **session stamp** on load, one line, no delay, no animation:
  `[session 2026-10-20 14:03] local · type help`
- The prompt already tracks the cwd (`getPromptText()`); keep it, and consider
  `user@host:cwd$` if not already doing so — path-aware prompts are half the terminal
  illusion.
- `document.title = 'r3d1bruh — ♫ ' + track` while playing (restore on pause). Two
  lines in `music.js`, and the browser tab becomes part of the site's voice.

---

## 7. Resilience is sophistication

- **No-JS baseline.** Today, with JS off, the Link Exchange pane is empty and the music
  controls are dead buttons. Add a `<noscript>` block inside the pane with plain links
  to the key profiles, and a `<noscript><style>` that hides JS-only controls
  (`.music-toggle`, `.music-link`, category tabs). The site then degrades to a readable
  1998 page instead of a broken 2026 one — the most on-brand possible fallback.
- **Honest hit counter.** Wire `VISITS FROM THIS MACHINE` to a `localStorage` counter
  incremented once per session, zero-padded to 6 digits. Same visual, real meaning.
  Keep the `001337` styling for first visits if you like the joke.
- **Docs.** Add two short conventions to `CODEBASE.md`: the glow budget (§2) and the
  motion budget (§8). Future agents are the main audience.

---

## 8. Motion budget

Allowed motions after this work — the complete list:

1. marquee (content, pause-on-hover, off under reduced motion),
2. pane switch (200ms, exists),
3. tile hover lift 1–2px + border brighten (exists),
4. terminal caret blink, music LED pulse *only* while playing,
5. custom cursor trail (opt-in by capability, exists).

Nothing else. No pulsing panels, no neon breathing, no hover wobble. Audit
`responsive.css`'s reduced-motion block against this list and add the two new rules
(focus transition, dock spine) to it.

---

## What I would not add

The other brief's decorative window buttons and fake system clock (violates honesty),
its link-row redesign (loses identity), terminal scanlines (legibility), and in general:
glassmorphism, `backdrop-filter`, gradient text, more than one display-size element per
screen, new hues, CSS `filter` on containers (breaks fixed-position children), skeleton
shimmers, or any animation that runs when nothing changed.

---

## Implementation order

**Phase 1 — coherence (no visible redesign).** Tokens + aliases in `variables.css`,
global focus law, type scale, global `::selection`, scrollbar unification, no-JS
baseline. If you do only this phase, the site still looks the same and is measurably
better. Run `python verify.py`.

**Phase 2 — voice.** One-accent rule applied (green → lavender where appropriate),
status rail, section-title metadata, terminal session stamp, footer music consolidation,
`document.title` now-playing, tile tooltips.

**Phase 3 — material.** Panel recipe, page grid texture, one signature detail, splitter
grip, dock progress spine.

**Phase 4 — polish and proof.** Empty-state vocabulary, focused-window state,
reduced-motion audit, mobile pass (collapse behavior intact), docs updated.

## Acceptance tests

- Desktop 1180px, mid ~900px, mobile 380px: nothing overflows, texture nearly invisible.
- Keyboard-only tab pass: every stop has a visible ring; terminal input is visibly focused.
- `prefers-reduced-motion: on`: only the allowed list behaves as specified.
- JS disabled: page lists links, hides dead controls, no console errors matter.
- Terminal select/copy works; webpage fullscreen toggle still fills the viewport
  (watch for accidental containing blocks).
- Music paused / unavailable: rail and footer show `--` or `PAUSED`, never `PLAYING`.
- `python verify.py` prints `VERIFY OK`.
