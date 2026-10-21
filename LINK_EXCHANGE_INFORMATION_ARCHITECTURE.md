# Link Exchange Information Architecture Proposal

## Purpose

This is a planning brief for the agent working on the site. It proposes a
clearer way to organize profile links without turning the Link Exchange into a
large directory. Review the proposal, identify conflicts with the current code
or layout, and recommend improvements **before** implementing it.

## Decision

Use four top-level filters only, after the link data has been cleaned up:

```text
ALL · SOCIAL · DEV · PLAY
```

This is intentionally limited. More top-level groups make a small personal site
harder to explore; fewer groups would make developer links and gaming links too
mixed together. The number of visible filters must be reassessed once only real
personal destinations remain; do not preserve a thin category for appearances.

## First Principle: Link Quality Before Taxonomy

Do not reorganize placeholder or generic platform links. A tile should exist
only when it leads to:

1. A real personal profile or handle.
2. A direct, intentionally public contact method.
3. A personal project, public résumé, or published work.

Until a real destination is supplied, hide the entry from all rendered sources.
This applies to the JSON data, the JavaScript fallback data, and the no-JavaScript
HTML list. Do not leave one of those copies showing a generic homepage.

## Category Definitions

### ALL

The default overview and reset filter. It must preserve an intentional,
developer-first order rather than mixing every service randomly:

```text
DEV → SOCIAL → PLAY
```

GitHub should remain the first visible tile. Do not bury it below public-social
links on a developer-first site.

Do not add divider labels in the first implementation. With a small honest
dataset, full-width dividers waste grid space and make the mobile layout sparse.
The deliberate order above provides the necessary wayfinding without new data
fields, rendering logic, or accessibility complexity.

### SOCIAL

For public/social presence and direct community contact. The list can contain
public and messaging services together for now.

```text
Instagram, TikTok, X, Reddit, Facebook, Bluesky (if used), Discord,
Telegram, WhatsApp, Signal, and Matrix (only if each is publicly usable)
```

Messaging remains part of Social, not a fifth top-level category. Revisit an
inline `// MESSAGING` divider only if Social grows beyond roughly eight real
links and mobile testing shows it remains space-efficient.

### DEV

This is a developer-first site, so DEV should contain work and technical
identity that currently feels misplaced under Social or the very narrow
`AI / TECH` filter. `DEV` is shorter and clearer in a compact retro UI than
`BUILD`.

```text
GitHub, Hugging Face, GitLab, LinkedIn, Stack Overflow, Dev.to,
project demos, résumé/CV
```

from Social into Build. Keep Hugging Face in Build.
Rename the current `AI / TECH` category to `DEV`. Move GitHub and LinkedIn
from Social into DEV. Keep Hugging Face only if it has a real profile URL.
from Social into Build. Keep Hugging Face in Build.

### PLAY

For gaming identity and game/community profiles.

```text
Steam, Xbox, PlayStation, itch.io, Battle.net, and other actual game profiles
```

Storefront or publisher links should not be shown unless they lead to a real
personal profile, a published game, or another meaningful personal destination.

## Visual and Interaction Guidance

- Keep the filter row to four buttons: `ALL`, `SOCIAL`, `DEV`, and `PLAY`.
- The All view uses deliberate JSON ordering; do not add headings or dividers in
  the first implementation.
- A category with no usable links should be hidden or reviewed, never populated
  with placeholders merely to keep the filter visible.
- Preserve the existing retro visual system: compact uppercase labels, muted
  lavender accents, and no extra top-level navigation.
- Keep every data copy synchronized: `main/data/links.json`, `FALLBACK_LINKS`
  in `main/link-exchange.js`, and the no-JavaScript list in `main/index.html`.

## Suggested Data Shape

Keep the schema small for the first implementation:

```json
{
  "name": "Discord",
  "category": "social",
  "url": "https://example.com/real-invite-or-profile",
  "icon": "./socials/icons/discord.svg"
}
```

Suggested values:

```text
category: social | dev | play
```

Use a deliberate, documented JSON order for the All view: `dev → social → play`.
Do not add an optional group field, group configuration, or divider renderer
until the real Social dataset is large enough to need it.

## Proposed Migration

1. Remove, hide, or replace every placeholder/generic homepage with a real
   profile or direct destination in all three data/rendering copies.
2. Keep the existing filters unchanged during that data-only cleanup so the
   diff is easy to verify.
3. Rename `gaming` to `play` and `ai-tech` to `dev` in the labels, markup,
   fallback data, JSON data, documentation, and any preview markup.
4. Move GitHub and LinkedIn to DEV; keep Hugging Face only with a personal URL.
5. Order the All data developer-first: DEV, then Social, then Play.
6. Verify filtering, keyboard access, mobile layout, the preview, and the
   offline/no-JavaScript fallback.

## Questions for the Implementing Agent

Please respond to these before coding:

1. Which existing generic or placeholder URLs should be hidden until their real
   profile URLs are supplied?
2. Are all three content copies—including the no-JavaScript list and preview,
   if present—kept in sync after the cleanup?
3. Does the existing tab implementation need accessibility fixes (for example,
   `aria-controls`, arrow-key behavior, or a simpler filter pattern) while the
   category labels are changed?
4. After pruning, does each proposed filter contain enough real links to justify
   four filters, or should a category be temporarily omitted?
5. If Social later grows, can inline, non-focusable group labels be introduced
   without creating sparse mobile grid rows or misleading screen-reader groups?

## Non-Goals

- Do not add more top-level categories.
- Do not invent profiles, handles, invite links, or contact details.
- Do not add a framework, build step, or external dependency.
- Do not change the site's retro visual language merely to support the grouping.
- Do not add Public/Messaging divider rendering in this pass.
