# Visual Improvements Brief — x1rid.github.io

## Purpose

Make the existing static personal site feel like a more deliberate, memorable retro desktop experience while preserving its current dark-purple identity and lightweight, dependency-free architecture. This is a design-and-implementation brief for the next agent.

**Do not replace the site with a modern SaaS dashboard.** The useful direction is "personal late-90s/early-2000s web terminal," made more readable and intentional.

## Existing Design System to Preserve

- Keep the core palette: deep purple/near-black surfaces, `#470d69` purple, `#130927` dark purple, `#c084fc` lavender, `#ff4fd8` magenta, and `#55ff99` terminal green.
- Keep the present static, dependency-free approach. Do not add a framework, icon library, web font dependency, bundler, or CDN dependency.
- Preserve the working terminal, music player, splitter, link exchange, custom cursor, and mobile behavior. Visual work must not break their JavaScript hooks or data loading.
- Reuse the modular CSS structure under `main/css/`. Avoid a new large inline stylesheet or a blanket rewrite of existing markup.

## Visual Direction

The site should read as a small, hand-built personal computer interface—not as an app clone. Aim for **tactile panels, restrained glow, compact typography, and a little controlled weirdness**.

Use a hierarchy of layers:

1. Almost-black page background with a barely visible purple grid/noise texture.
2. A framed "desktop/window" surface for the main experience.
3. Distinct but related panels: sidebar, terminal/content, link cards, and music controls.
4. Small bright signals only where interaction or state needs attention: active navigation, terminal cursor, progress, notification/status dots.

Avoid applying glows, gradients, or animation to everything at once. The contrast between quiet surfaces and a few luminous details is what makes the retro treatment feel convincing.

## Recommended Changes

### 1. Establish a stronger page frame (highest value)

- Add a subtle outer desktop frame around the main layout: 1px purple border, inset shadow, and a compact top chrome strip.
- The chrome strip can contain a small site label, a fake system time/status, and three decorative window controls. Decorative controls must not pretend to be functional unless they are wired up.
- Give the page background a **static**, low-contrast texture using CSS gradients (thin grid, sparse scanlines, or faint phosphor dots). It should be nearly invisible at normal viewing distance.
- Use a narrow inner highlight plus a darker outer shadow to make panels feel like physical UI pieces instead of flat rectangles.

### 2. Make the sidebar feel like a navigation device

- Group navigation into clearly labelled clusters, such as `SYSTEM`, `PLACES`, and `NOW PLAYING`, only if the present content maps naturally to them.
- Give active and hovered items a left-edge indicator, slightly offset text, and a controlled lavender/magenta glow. Keyboard focus must be at least as clear as hover.
- Treat the sidebar as a stable control rail: keep its width and existing splitter behavior intact; avoid a dense wall of equal-looking links.
- Add tiny CSS-drawn markers (square LEDs, arrows, bracket glyphs) rather than importing icon assets.

### 3. Turn the content panes into distinct "programs"

The link exchange, specs/webpage pane, and terminal should look like related windows running on the same fictional desktop, but not identical cards.

- Give every pane a compact title bar with an icon-like glyph, title, and muted metadata/state.
- Differentiate pane types through minor accents rather than new palettes:
  - Terminal: green cursor/status and monospace density.
  - Link exchange: lavender/magenta markers and more open card spacing.
  - Music: equalizer/progress motif and the warmest purple highlight.
- Use corner notches, double-line borders, small bevels, or a 1–2px offset shadow sparingly to add period character.
- Keep body copy comfortable to scan. Retro does not mean tiny, low-contrast text.

### 4. Improve the link exchange as a visual destination

- Replace any undifferentiated list feeling with compact “site chips” or mini-card rows: favicon/avatar space, name, one-line description, and a small external-link glyph.
- Alternate very subtle surface tones or use category markers so cards are easier to scan without becoming a rainbow.
- Add a tasteful empty/loading/error presentation if the current data-driven loading can expose those states.
- On hover, move a card by 1–2px and brighten its edge; respect `prefers-reduced-motion`.

### 5. Add terminal authenticity without harming usability

- Strengthen terminal chrome: command prompt label, small connection/status indicator, and a clear separation between output history and input.
- Make system output (for example, the existing neofetch-style content) read as a composed layout with muted labels and high-contrast values.
- Use an unobtrusive static scanline overlay inside the terminal only, not over all readable content.
- Keep the command input obvious on narrow screens and avoid overlays that make selection/copying difficult.

### 6. Make the music area feel intentional

- Present the music player as a compact dock/module rather than an unrelated control cluster.
- Use CSS-only meter bars or a waveform-like motif that changes only when actual playback state is available; otherwise keep it static.
- Improve album/track hierarchy: track name first, supporting state second, controls third.
- Do not auto-play audio or introduce continuously moving decorative equalizers.

### 7. Give feedback and empty space a role

- Add a small shared status vocabulary: success/online in green, active in lavender, caution in magenta, muted/inactive in desaturated violet.
- Use short labels such as `ONLINE`, `IDLE`, `LOADING`, and `LOCAL` only where they convey real state.
- Increase vertical breathing room between major windows before adding more decoration. The current interface should feel curated, not crowded.

## Architecture Guidance for Future Features

Design additions so a future agent can add a new pane, widget, or data-backed section without copying styles.

- Centralize visual tokens in `main/css/variables.css`: surface levels, borders, glow strengths, spacing, type sizes, z-index layers, and motion durations.
- Use reusable structural classes such as `.retro-window`, `.retro-window__titlebar`, `.retro-window__body`, `.status-pill`, `.nav-group`, and `.data-card`. Adapt names to existing conventions rather than introducing a competing naming system.
- Keep feature-specific styling in the relevant stylesheet (terminal, music, links) and shared chrome/components in `components.css`.
- Prefer semantic HTML and `data-*` attributes for cosmetic variants. Do not couple styling to JavaScript-generated text or child-position selectors when a class is possible.
- Keep content/data in `main/data/` and rendering behavior in the current feature scripts. A new visual component must degrade gracefully if its data is missing or slow to load.
- For any new interactive control, define all four states: default, hover, keyboard focus-visible, and disabled/unavailable.

## Implementation Order

### P0 — foundation

1. Audit and consolidate existing colors, spacing, borders, and shadows into tokens without changing behavior.
2. Build one reusable window/panel treatment and apply it carefully to the existing primary regions.
3. Improve contrast, focus rings, and the small-screen layout before adding decorative texture.

### P1 — personality

1. Add background texture and restrained CRT/window-chrome details.
2. Upgrade sidebar states, link cards, terminal chrome, and music dock using the common components.
3. Add clear loading/empty/error affordances for data-backed areas where absent.

### P2 — optional polish

1. Introduce CSS-only micro-interactions (1–2px lift, border brightening, caret blink).
2. Add an optional theme-density switch only if it fits the existing site controls and is persisted accessibly.
3. Consider a small “boot/status” detail, but never block content behind an intro animation.

## Accessibility and Performance Requirements

- Maintain readable text contrast against every purple surface; do not rely on color alone for state.
- Preserve visible `:focus-visible` styles for links, buttons, terminal input, and player controls.
- Support `prefers-reduced-motion`; disable blinking, transitions, and any simulated CRT motion there.
- Use CSS gradients/pseudo-elements for texture. Do not add large images, canvas effects, or continuously running animation.
- Keep touch targets practical on mobile and ensure panels do not force horizontal scrolling.
- Do not reduce the user’s ability to select/copy terminal text.

## Verification Checklist

- Check the homepage at desktop width, a split-pane/narrow desktop width, and mobile width.
- Confirm sidebar splitter, terminal commands, music controls, link-exchange loading, and custom cursor still work.
- Run `node --check` on every changed JavaScript file, if any JavaScript is touched.
- Verify tab order and keyboard focus with no mouse.
- Inspect with reduced motion enabled and with music unavailable/paused.
- Update `README.md` and `CODEBASE.md` only if the implementation changes the documented component structure or user-facing behavior.

## Explicit Non-Goals

- No dependency or framework migration.
- No generic glassmorphism, bright white dashboard, or unrelated cyberpunk rainbow treatment.
- No autoplay, full-page loading screen, artificial loading delay, or animation that runs constantly.
- No removal or redesign of existing working features merely to make the layout easier.

