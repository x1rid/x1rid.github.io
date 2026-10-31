# Lock Screen v2

Browser-only, build-free immersive sign-in for the root desktop shell
(`index.html`). It is a visual/auth UI layer over the existing profile,
persistence, and shell services — not a second session manager.

## Files

| File | Responsibility |
| --- | --- |
| `lock-screen.js` | Mount/lifecycle, account selection, credentials, transition state machine, per-profile settings/avatar, clock, diagnostics. |
| `lock-screen.css` | Layout, account cards, credentials form, settings panel, reveal/error/parallax styling. |
| `lock-animations.js` | `LockAnimationController`: one animation registry, one starfield/parallax frame loop, intensity, reduced motion, visibility pause. |
| `lock-widgets.js` | `LockWidgets`: local widget registry + failure-isolated `WidgetHost`. Text is rendered with `textContent`. |
| `lock-arg.js` | `LockSecretEvents`: disabled-by-default fictional ARG extension point. Never touches host commands or security. |

Load order in `index.html`: profile services → VFS → `lock-animations.js` →
`lock-widgets.js` → `lock-arg.js` → `lock-screen.js` (after `ProfileUI`) → shell
scripts. The root lock markup carries `data-lock-v2="true"`, which tells the
legacy `ProfileUI` lock UI to stand down.

## Reused services

- `window.ProfileService` — public profile list, hidden-admin lookup,
  `authenticate()`, `setOwnerPassword()`, `updateIdentity()`, `lock()`,
  `isUnlocked()`, `setActiveProfile()`.
- `window.PersistenceService` — profile-scoped `lockScreen` settings and the
  custom avatar (validated `lockScreen` schema v3).
- `window.ProfileUI` — desktop lock/inert state (`_setLocked`) and focus.
- `window.SystemServices.events` — optional event bus for settings changes.
- `window.ProfileWindowState` — flushes window geometry before locking.

No profile database, event bus, settings store, or session manager is
duplicated.

## Login states

`LockScreenV2.state.phase` is one of:

- `locked` — idle after the desktop has been revealed.
- `selecting-account` — public account cards + "use another account".
- `entering-credentials` — username/password form (guest or existing account).
- `setup` — first owner sign-in; asks for a password and confirmation.
- `authenticating` — busy; inputs disabled and status announces authentication.
- `transitioning` — reveal animation; the shell is unlocked through `ProfileUI`.
- error text is rendered inline via `#lock-error` with a generic message.

Unknown usernames always fail with the same generic credential error. Guest
succeeds without a password only when the `guest` username matches. The hidden
administrator is never listed and never auto-granted from an unknown username.

## Per-profile settings

Stored under `state.lockScreen` in `profile-state` schema v3:

```js
lockScreen: {
  clock: { enabled, showSeconds, format: '24h'|'12h', showDate },
  animation: {
    intensity: 'low'|'medium'|'high',
    parallax, particles, respectReducedMotion, pauseWhenHidden
  },
  widgets: {
    enabled,
    enabledIds: ['fun-fact', 'system-message'],
    rotation: 'on-interaction'|'interval'|'off'
  },
  audio: { enabled, ambientEnabled, effectsEnabled, volume },
  accounts: {
    showOwner, showGuest, showHiddenAccounts: false, allowAccountCreation
  },
  avatar: { kind: 'builtin'|'custom', value }
}
```

- Settings are saved with `LockScreenV2.saveLockScreen(partial)` through the
  existing debounced persistence queue.
- `accounts.showHiddenAccounts` is forced to `false`; hidden accounts cannot be
  exposed through persisted settings.
- Passwords are never written to state, settings, or `localStorage`.

### Avatars

- Built-in presets: `default-blue`, `default-purple`, `default-green`,
  `default-orange`, `default-mono`, `retro-pixel`.
- Uploads accept PNG/JPEG/WebP only, max 512 KB and 1024×1024 px. Images are
  re-encoded to a validated WebP data URL before saving; SVG/GIF are rejected.
- Stored per profile as `lockScreen.avatar` (max 600,000 data-URL chars).
- Invalid or oversized uploads fall back to the previous/default preset.

## Animation controller

`LockAnimationController.register/play/stop/stopAll` owns every named
transition. `startEnvironment()` owns the single starfield + parallax frame
loop. It:

- honours `prefers-reduced-motion` (or the persisted setting),
- pauses on `document.hidden` and resumes on visibility,
- cancels frames and timers in `stopEnvironment()` / `stopAll()`,
- lowers particle/parallax work at `low` intensity.

Nothing else may start an independent particle loop.

## Widget registry

Widgets are local-only and registered under `window.LockWidgets.registry`.
`WidgetHost.mount(root, options)` renders into `#lock-widgets`, rotates on
interaction/interval, and isolates failures: a throwing widget is replaced with
neutral fallback content and can never block login. Text is rendered with
`textContent`; widget definitions never inject HTML. `WidgetHost.unmount()`
clears timers, listeners, and DOM.

## Fictional ARG extension

`window.LockSecretEvents` is disabled by default and memory-only. Its only
registered event, `accessibility-anomaly`, emits the namespaced
`arg:accessibility-anomaly` `CustomEvent` after explicit opt-in. It does not
read credentials, change permissions, execute host commands, or interact with
`sethc.exe` or real Windows settings. It is intentionally separate from
authentication.

## Hidden administrator (development/recovery)

The `admin` profile is defined in `ProfileService`, excluded from
`getProfiles()` / `listPublicProfiles()`, and uses `vfs-db-admin`. It has no
password and cannot sign in until configured deliberately:

```js
// Console, root page. Development mode must be explicit.
sessionStorage.setItem('desktop.devMode', '1');
await ProfileService.enableHiddenAdmin('a-local-dev-password', { dev: true });
// Then sign in with username `sysadmin` and that password.
```

`enableHiddenAdmin()` throws `DEV_MODE_REQUIRED` without `{ dev: true }` or the
session flag, and `INVALID_PASSWORD` outside 4–256 characters. Clearing the
`admin` profile record removes the credential. This is a simulated account, not
an OS administrator.

## Lifecycle and logout

- Mount is idempotent and waits for `ProfileUI.ready`.
- `cleanup()` removes listeners, stops clock/environment/widgets, and unmounts
  the host; a later mount restores exactly one instance.
- Guest logout locks the current session immediately.
- Owner/admin logout flushes window state, locks the session, and switches to
  the guest profile through `ProfileService.setActiveProfile('guest')`,
  which reloads back into the lock screen.
- Profile selection during sign-in uses the existing `setActiveProfile()`
  reload. A one-time `sessionStorage['desktop.lock.autoEnter']='1'` reveals the
  desktop after that reload.

## Active-session lock (Super+L)

`session-lock.js` + `session-lock.css` implement an Ubuntu GNOME-style screen
lock over the **running** desktop. It is separate from the LockScreenV2 sign-in
screen above: no account list, no username field, no reload.

- `Super+L` (and the legacy `Ctrl+Alt+L`) are registered once, through
  `ShortcutService` in `shell/lock-screen-host.js` (`lock.lock`, context
  `unlocked`). `window.lockDesktop()` (and `#start-lock-btn`, if present) route to
  `SessionLock.lock()` whenever a session is active.
- Lock state: `SessionLock.LOCK_STATES` (`unlocked → locking → locked →
  authenticating → auth_failed | unlocking → unlocked`) and a separate
  `PRESENTATION_STATES` (`clock` / `authentication`). Invalid transitions are
  rejected; unlock is only reachable after `ProfileService.unlockSession()`
  succeeds.
- Authentication: `ProfileService.unlockSession(password)` calls the existing
  `ProfileService.authenticate()` with the active profile's username. Guest
  sessions unlock with an Unlock button; no second credential store exists.
- Session preservation: `ProfileWindowState.flushActive()` runs before
  locking; windows, workspaces, apps, VFS and the active profile are untouched.
  `ProfileUI.setSessionLocked()` marks every other top-level body child `inert`
  (including ones appended while locked) and flips the ShortcutService
  `locked` context, while keeping the desktop painted under the shield.
- Refresh: `ProfileService.lockSession()` writes only the profile id to
  sessionStorage `desktop.sessionLock` (the same per-tab store that holds
  `desktop.activeProfile`). On boot `ProfileUI._init()` sees the marker for the
  resolved profile and restores the session lock before the desktop is
  reachable; LockScreenV2 skips its glance/sign-in flow. A marker for another
  profile is discarded and the normal sign-in screen is shown.
- Presentation: blurred/dimmed snapshot of the live `#wallpaper` canvas layered
  over `#desktop`'s computed background (refreshed on lock, resize and tab
  re-show), large thin clock + date from `KernelClock` and the existing
  `lockScreen.clock` preferences (12h/24h, seconds, date), one aligned timer
  that stops while the tab is hidden. Click, touch, wheel or any key reveals
  authentication; the first printable key is forwarded into the password
  field. Escape (or 30 s idle with an empty field) returns to the clock.
- Keyboard events are swallowed in a window capture listener while locked, so
  apps behind the shield never see them (`session-lock.js` loads before
  `shortcuts.js`). Browser reload (F5 / Ctrl+R) is allowed; the lock survives it.
- Motion: the shield drops in on lock, the clock lifts/shrinks for
  authentication, and the whole shield slides up on unlock (CSS transforms).
  `prefers-reduced-motion` collapses these to near-instant changes / a fade.

## Security limitations

This is a static, client-side simulator. The password/Hidden-admin gate is a UI
convenience, not confidentiality: anyone with DevTools, IndexedDB access, the
browser profile, or control of the served JavaScript can read or bypass the
state. Passwords are stored only as salted PBKDF2 verifiers (iterated FNV
fallback on insecure contexts), never in plaintext and never in the lock-screen
schema.

## Tests

- `tests/session-lock.test.js` covers the session-lock state machine, clock
  formatting, `lockSession` / `unlockSession`, and the Super+L wiring.


```bash
node tests/lock-screen-logic.test.js
node --check main/lock-screen/lock-screen.js
node --check main/lock-screen/lock-animations.js
node --check main/lock-screen/lock-widgets.js
node --check main/lock-screen/lock-arg.js
```

The Node suite covers public account projection, hidden-admin exclusion and
explicit setup, generic authentication failures, owner setup/rename, settings
validation/persistence, password non-persistence, and avatar validation.
Browser checks cover rendering, guest login, owner first-run setup, settings
reload, avatar re-encoding, widget failure isolation, reduced motion, logout,
and listener cleanup.
