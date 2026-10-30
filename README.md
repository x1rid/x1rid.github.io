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
    shortcuts.js    → centralized context-aware keyboard shortcut service
    app-registry.js → application definitions, launch policy, and lifecycle
    system-services.js → shared clipboard, Open/Save dialogs, file
                      associations, notifications, settings, and events
    system-config.js → profile-scoped virtual users, groups, permissions,
                      startup/service metadata, audit, reset, and rollback
    lock-screen/    → immersive root lock screen: account cards, credentials,
                      settings, avatars, animation controller, widgets, ARG hook
    window-manager-core.js → pure work-area, layout, snap, resize, and WM-state logic
    window-manager.js → desktop integration: snapping, previews, groups,
                      workspaces, tiling, Snap Assist, overview, shortcuts
    window-manager.css → preview, chooser, assist, overview, divider, and motion styles
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

## Window manager

The shell keeps its original inline window lifecycle and adds an optional
Windows 11–style window manager on top. `main/window-manager-core.js` is pure
geometry/layout/state logic (loaded in Node tests); `main/window-manager.js`
binds it to the desktop through the `window.ShellWM` bridge.

- **Snapping** — drag a titlebar to a screen edge or corner for halves,
  quadrants, top/bottom, or maximize. Live translucent previews use the exact
  final bounds. Dragging a snapped or maximized window restores its floating
  rectangle under the pointer.
- **Layouts** — half, top/bottom, quadrants, three columns, main + sidebar, and
  asymmetric presets. The maximize-button chooser also offers captured custom
  layouts and an **Always on top** / **Float window** control.
- **Snap Assist** — after snapping, pick an open window for the remaining zone.
- **Linked resize & snap groups** — adjacent snapped windows share draggable
  dividers. Restore a whole group from the taskbar or with a shortcut.
- **Virtual desktops** — four named desktops by default (up to nine), with
  taskbar filtering, window moves, per-desktop layouts, and an overview.
- **Optional tiling** — automatic grid tiling for eligible windows, with
  per-app rules for floating, always-on-top, and preferred desktop.
- **Persistence** — snap bounds, group ids, desktop membership, layouts, rules,
  and shortcut overrides are saved per profile (schema v4) and restored
  defensively. Missing apps or corrupt state fall back safely.
- **Motion** — transitions respect `prefers-reduced-motion` and the overview's
  **Reduce motion** switch.

Shortcuts are registered through `main/shortcuts.js`; they are ignored while a
text field is focused. Defaults:

| Shortcut | Action |
| --- | --- |
| `Ctrl+Alt+ArrowLeft` / `Right` | Snap left / right |
| `Ctrl+Alt+ArrowUp` / `Down` | Maximize / snap bottom |
| `Ctrl+Alt+K` | Open snap-layout chooser |
| `Ctrl+Alt+M` / `Ctrl+Alt+H` | Maximize / minimize active window |
| `Ctrl+Alt+F` / `Ctrl+Alt+G` | Float / restore snap group |
| `Ctrl+Alt+O` | Workspace overview |
| `Ctrl+Alt+T` | Toggle automatic tiling |
| `Ctrl+Alt+PageDown` / `PageUp` | Next / previous desktop |
| `Ctrl+Alt+Shift+PageDown` / `PageUp` | Move window to next / previous desktop |

Run `node tests/window-manager.test.js` for the geometry, persistence, and
state-sanitization suite.

## Application registry and lifecycle

`main/app-registry.js` is the logical application layer. It owns definitions,
launch policy, and the running-instance list; the shell still owns window DOM
nodes and persistence.

```js
AppRegistry.register({
  id: 'my-app',
  name: 'My App',
  tagline: 'One line for the Programs shelf',
  meta: 'UTILITY · IN-HOUSE',
  icon: '<svg>…</svg>',
  source: 'IN-HOUSE',
  kind: 'program',
  fileTypes: ['txt'],
  multiple: false, // default: singleton
  launch(context, options) {
    // context: { profile, profileId, owner, guest, vfs, username }
    return openMyAppWindow(options);
  }
});

AppRegistry.launch('my-app');
AppRegistry.focus('my-app');
AppRegistry.minimize('my-app');
AppRegistry.restore('my-app');
AppRegistry.close('my-app');
AppRegistry.running();       // logical instances, not a second window list
AppRegistry.context();       // active profile + active VFS
AppRegistry.findByFileType('txt');
```

Applications are singletons by default: launching an already-running app
focuses or restores its window instead of creating a duplicate. `Terminal`
explicitly sets `multiple: true`, so each launch creates a new instance.
Unknown IDs return `null` and log a warning, including during window restore.

Program mounts receive the existing `app`, `setMeta()`, and `close()` contract
plus `profile`, `profileId`, `vfs`, `registry`, and `instanceId`. Mounts return
their cleanup function as before; the registry wraps window close so timers,
listeners, media, and iframe sources are released before the instance is
removed. Window restoration now asks the registry to launch each saved
`appId`; it no longer contains app-specific branches. A launch may pass an
optional `node`; mounts receive it as `initialNode` and should validate it
against the active VFS before using it.

## Shared system services

`main/system-services.js` is the Phase 4 service layer between the shell, VFS,
and applications. It exposes `window.SystemServices` and is loaded after the
profile/VFS and application registry, before Explorer and program consumers.

```js
await SystemServices.ready; // profile + VFS boot has completed

SystemServices.clipboard.writeText('copied text');
SystemServices.clipboard.copyFiles([nodeId]); // or cutFiles(...)
await SystemServices.clipboard.paste(folderId);

const open = await SystemServices.dialogs.open({ extensions: ['txt'] });
const save = await SystemServices.dialogs.save({
  startId: folderId,
  suggestedName: 'notes.txt',
  extensions: ['txt']
});

SystemServices.files.register({
  id: 'my-viewer',
  label: 'My Viewer',
  extensions: ['txt'],
  open(node, context) { return openMyViewer(node, context); }
});
SystemServices.files.open(nodeId); // explicit handler, then AppRegistry lookup

SystemServices.notifications.notify('FILE SAVED');
SystemServices.notifications.error('SAVE FAILED', error);

SystemServices.settings.get('musicVolume');
await SystemServices.settings.set('musicVolume', 45);
```

Everything is profile-scoped. Clipboard entries store VFS node IDs plus the
active profile database and VFS-instance token; switching profiles or replacing
the VFS invalidates them, and stale entries are cleared instead of returning a
handle from another profile. Open/Save dialogs bind to the VFS that was active
when they opened and fail with `PROFILE_CHANGED` rather than resolving against a
different profile. Dialog cancellation resolves
`{ ok: false, cancelled: true, code: 'CANCELLED' }`; a save name conflict stays
open with an inline error and never reports success.

File associations prefer an explicit handler registered through
`SystemServices.files.register()`, then fall back to
`AppRegistry.findByFileType()`. The built-in text editor and image viewer are
registered by Explorer; media extensions resolve to the Media Player. Text
files can be edited, saved in place, saved through the shared Save dialog, and
copy/pasted through the shared clipboard. Media Player opens VFS media through
the shared Open dialog and releases its blob URLs on close.

### Standard events

Services emit namespaced events on `document` and through
`SystemServices.events.on(type, listener)`. Every detail includes `type`,
`profileId`, `emittedAt`, and a monotonically increasing `sequence`. Services
change their own state first, emit synchronously, then resolve any caller
promise.

| Event | Detail fields |
| --- | --- |
| `system:clipboard-changed` | `kind`, `op`, `count`, `nodeIds`, `reason` |
| `system:clipboard-pasted` | `op`, `count`, `targetId`, `completedNodeIds` |
| `system:dialog-open` | `mode`, `title`, `folderId`, `path` |
| `system:dialog-close` | `mode`, `reason`, `resultCode` |
| `system:file-opened` | `nodeId`, `path`, `extension`, plus `handlerId` or `appId` |
| `system:file-saved` | `nodeId`, `path`, `extension`, `appId` |
| `system:app-file-open` | `appId`, `nodeId`, `path`, `extension` |
| `system:notification` | `level`, `title`, `message`, `duration` |
| `system:error` | `operation`, `code`, `message` |
| `system:settings-changed` | `key`, `value`, `committed` |
| `system:services-ready` | `version`, `vfsDb`, `hasVfs` |
| `system:config-loaded` | `revision`, `restored`, `warnings` |
| `system:config-changed` | `revision`, `updatedAt`, `reason`, `warnings` |
| `system:config-reset` | `revision`, `updatedAt`, `section`, `reason` |
| `system:config-rollback` | `revision`, `updatedAt`, `reason` |
| `system:config-error` | `operation`, `code`, `message` |
| `system:audit` | `id`, `action`, `result`, `actor`, `resource`, `reason`, `detail` |

Existing `node-*` VFS events, `profile:*` events, and `site:app*` registry
events keep their previous contracts. While a shared dialog is open, the
keyboard service blocks unrelated shell shortcuts; Escape and Enter are
registered by the dialog itself.

## Virtual system configuration and permissions

`main/system-config.js` exposes `window.SystemConfig` (also reachable as
`SystemServices.config`). It is a **simulation model**, not a Windows security
implementation: it never reads or writes the real registry, services, startup
folders, host users, host files, or host ACLs. It does not contain attack
scenarios or privilege-escalation behavior.

The code-level defaults (simulated users `system`, `owner`, and `guest`;
groups; baseline rules; startup entries; service metadata) are immutable and
shared by the simulator. Every profile gets its own validated record in
`profile-db` → `system-config`. Guest and Owner therefore read and write
separate configuration records, just like their separate VFS databases. No API
accepts a different profile id while a profile is active.

```js
await SystemConfig.ready;
const config = SystemConfig.get();      // active profile + revision + sections

SystemConfig.validate(raw, { strict: true }); // { ok, value, errors, warnings }
await SystemConfig.replace(nextConfig);       // full validated replacement
await SystemConfig.patch({ startup: entries });
await SystemConfig.setSection('services', services);
await SystemConfig.reset();                   // all sections
await SystemConfig.reset({ section: 'startup' });
await SystemConfig.rollback();                // one-step undo of the last commit

SystemConfig.currentUser();                   // simulated user for this profile
SystemConfig.check({ action: 'read', resource: 'vfs:documents' });
SystemConfig.can('configure', 'config:system');
SystemConfig.audit(20);                       // newest structured audit entries
```

### Schema and validation

```js
{
  schemaVersion: 1,
  users:       [{ id, displayName, enabled, groups: [groupId] }],
  groups:      [{ id, displayName }],
  permissions: [{
    id, principalType: 'user'|'group', principalId,
    actions: ['read'|'write'|'delete'|'list'|'execute'|'configure'|'manage'|'*'],
    resource: '*' | 'vfs:*' | 'app:explorer' | 'config:system',
    effect: 'allow'|'deny'
  }],
  startup:  [{ id, label, target, enabled, scope: 'user'|'system' }],
  services: [{ id, label, startMode: 'auto'|'manual'|'disabled',
               status: 'running'|'stopped'|'disabled' }]
}
```

Ids are lowercase safe tokens. Resource tokens are `namespace:value` and may
end with `*` for a prefix match. Startup targets are metadata only; nothing is
executed. Service status is metadata only; no host service is changed.

Validation is deterministic and boundary-safe. Unknown fields and invalid
entries are discarded with warnings; `strict: true` additionally rejects the
whole value with structured errors. Missing sections fall back to the global
defaults, counts are capped, duplicate ids and unknown user/group references
are dropped, and a newer `schemaVersion` keeps only known fields. Writes
resolve only after the IndexedDB transaction commits; failures reject and
emit `system:config-error` plus `system:error`.

### Permission model

Checks are deterministic and explicitly **deny-overrides**:

1. An invalid request, unknown or disabled principal, or missing current user
   is denied.
2. The user's own rules and its direct groups' rules are matched.
3. Any matching `deny` rule wins.
4. Otherwise any matching `allow` rule allows.
5. Otherwise the result is default-deny.

The result includes `allowed`, `effect`, `reason`, `principalId`, `groups`,
`action`, `resource`, and sorted `matchedRuleIds`. Baseline behavior: Owner is
in `administrators` and can configure the virtual system; Guest can read/list
virtual files and launch apps but cannot configure. These checks do not yet
gate VFS calls or app launches; the VFS/profile isolation from Phases 2–4
remains the actual data boundary.

### Reset and rollback

Each committed record keeps the previous validated configuration in
`profile-db`. `reset()` restores code defaults (or one section) and remains
rollback-able. `rollback()` restores that previous snapshot and keeps the
current one available as the next rollback target. Virtual files, recycle-bin
contents, app windows, and shell preferences are never touched by either
operation.

### Audit

Configuration changes and permission checks append structured entries:
`{ id, action, result, actor, resource, reason, detail }`. The in-memory log is
bounded to the newest 200 entries per tab and is exposed with
`SystemConfig.audit()`; each entry is also emitted as `system:audit`. Audit
entries are diagnostic telemetry, not tamper-proof records.

## Lock screen

The root shell (`index.html`) boots into `main/lock-screen/`, an immersive
sign-in scene with Owner and Guest account cards, an optional custom username,
per-profile avatars and preferences, an animated starfield/clock/widget host,
and a disabled-by-default fictional ARG hook. It reuses `ProfileService` for
authentication and session activation, `PersistenceService` for profile-scoped
`lockScreen` state (schema v3), `ProfileUI` for the shell's locked/inert state,
and `SystemServices.events` for telemetry. It does not create a second profile
database, event bus, or session manager.

- Guest signs in without a password. Owner signs in with a local password; the
  first owner sign-in asks to create one. Unknown usernames always fail with a
  generic error and never gain a session or administrator rights.
- Password fields are never persisted. Owner/admin passwords are stored only as
  salted PBKDF2 verifiers in `profile-db`.
- Settings (clock, animation intensity, parallax, particles, widgets, avatars,
  account visibility, audio preferences) are saved per profile and survive
  reloads. Profile switching still performs the existing flush-and-reload.
- Six built-in avatar presets plus PNG/JPEG/WebP uploads (re-encoded to WebP,
  max 512 KB and 1024×1024). SVG/GIF uploads are rejected.
- A single `LockAnimationController` owns transitions and the one particle loop;
  it honours reduced motion and pauses while the page is hidden.
- Logout locks the session and returns to the lock screen (Owner/Admin switch
  back through `setActiveProfile('guest')`).

### Hidden administrator

`ProfileService` defines a hidden `admin` profile (`sysadmin`, database
`vfs-db-admin`) that is excluded from `getProfiles()` and
`listPublicProfiles()`. It has no password and cannot authenticate until
explicit development/recovery setup:

```js
sessionStorage.setItem('desktop.devMode', '1');
await ProfileService.enableHiddenAdmin('a-local-dev-password', { dev: true });
```

`enableHiddenAdmin()` throws `DEV_MODE_REQUIRED` without the explicit flag and
`INVALID_PASSWORD` outside 4–256 characters. The `SystemConfig` simulation maps
it to the `administrator` principal in the `administrators` group; this is still
a browser-only simulation.

### Security caveat

The lock screen is a UI gate, not a security boundary. Anyone with DevTools,
IndexedDB access, the browser profile, or the ability to change the served
JavaScript can read or bypass everything. The hidden account and ARG hook are
deliberately inert by default and never touch real Windows users, commands,
`sethc.exe`, or security settings.

See `main/lock-screen/README.md` for the module API, state machine, schema, and
test commands.

## Keyboard shortcuts

`main/shortcuts.js` is the single keyboard router for the desktop shell. It
installs one capture-phase `keydown` listener and exposes
`window.ShortcutService`; Explorer, the inline terminal, Start, the window
manager, and the lock screen register their shell shortcuts through it instead
of adding competing document listeners.

### Shell and windows

| Shortcut | Action |
| --- | --- |
| `Ctrl+Escape` | Open or close Start search |
| `Ctrl+Alt+D` | Show the desktop / restore windows |
| `Alt+PageDown` / `Alt+PageUp` | Focus the next / previous simulator window |
| `Alt+W` | Close the active simulator window |
| `Ctrl+Alt+O` | Open the workspace overview (window manager) |
| `Ctrl+Alt+T` | Toggle automatic tiling (window manager) |
| `Ctrl+Alt+L` | Lock the desktop (root shell) |

### Start search

| Shortcut | Action |
| --- | --- |
| `ArrowDown` / `ArrowUp` | Move through results |
| `Enter` | Launch the active result |
| `Escape` | Close search |

### Explorer

| Shortcut | Action |
| --- | --- |
| `F2` | Rename the selected item |
| `Delete` / `Shift+Delete` | Recycle / permanently delete the selected item |
| `Ctrl+C`, `Ctrl+X`, `Ctrl+V` | Copy, cut, paste |
| `Alt+Left` / `Alt+Right` | Back / forward |
| `Backspace` | Up one folder |
| `Alt+Enter` | Selected item properties |
| `Enter` | Open the selected item |
| `Ctrl+Alt+N` | New folder in the current folder |

### Terminal and lock screen

| Shortcut | Action |
| --- | --- |
| `ArrowUp` / `ArrowDown` | Previous / next terminal command |
| `Ctrl+L` | Clear terminal output |
| `Enter` / `Space` | Unlock the guest desktop (legacy lock UI only; Lock Screen v2 uses the account cards and form) |

`Ctrl+Escape`, `Ctrl+Alt+D`, `Ctrl+Alt+L`, and OS-level combinations may be
captured by the host operating system or browser on some platforms; the
simulator cannot guarantee delivery. It deliberately does not register global
`Ctrl+W`, `Ctrl+T`, `Ctrl+L`, `Ctrl+R`, `F5`, `Alt+Tab`, or `Alt+F4`. Explorer's
`Alt+Left`/`Alt+Right` and `Backspace` are scoped to Explorer and Terminal's
`Ctrl+L` is scoped to the terminal input. Explorer shortcuts are ignored while a
text field is focused, and the lock-screen Enter/Space shortcut is disabled on
the v2 lock screen.

### Service API

```js
const remove = ShortcutService.register({
  id: 'my-app.action',
  keys: ['Ctrl+Alt+Y'],
  context: ['app'],
  priority: 50,
  allowInEditable: false,
  handler: (event, contexts) => { /* ... */ }
});

ShortcutService.setContext('app', true);
ShortcutService.diagnostics(); // registrations, active contexts, conflicts
remove();
```

Contexts in use are `global`, `unlocked`, `locked`, `start`, `explorer`,
`terminal`, `window`, `app`, and `editable`. A registration matches when any of
its contexts is active. Higher `priority` wins; duplicate key/context
registrations are reported through `diagnostics()` and a console warning.
Return `false` from a handler to leave the browser default alone.

## Development

```
python serve.py [port]   # default 5500
python verify.py         # static checks: JSON, asset refs, JS syntax
```

Then open http://127.0.0.1:5500/main/index.html

Committing is plain `git`; GitHub Pages serves the repository root.

## License

MIT — see [LICENSE](LICENSE).
