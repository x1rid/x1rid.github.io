# Lock Screen v2 — Progress and Handoff

Date: 2026-10-22
Status: implemented and tested; **uncommitted**.

## Scope delivered

The root desktop shell (`index.html`) now boots into an immersive retro-futuristic
lock screen with:

- Owner and Guest account cards; no public administrator account.
- Credential entry, guest password-free sign-in, owner first-run password setup,
  generic failure messages, and a transition into the desktop.
- Hidden `admin` profile (`sysadmin`) excluded from public lists, setup only via
  an explicit development/recovery call.
- Per-profile lock-screen settings: clock, animation intensity/parallax/particles,
  reduced-motion preference, widget enable/rotation, audio preferences, account
  visibility, and avatar.
- Six built-in avatars plus validated PNG/JPEG/WebP uploads re-encoded to WebP.
- One animation controller (single starfield/parallax loop), visibility pause,
  reduced-motion handling, and cleanup.
- Widget registry/host with text-only rendering and per-widget failure isolation.
- Disabled-by-default fictional ARG extension that emits only a namespaced
  browser event and never touches host commands or security.
- Settings panel, profile identity editing, sign-out, and locked-state restoration.

No framework, bundler, dependency, or parallel service was added.

## Changed files

### Modified

| File | Change |
| --- | --- |
| `index.html` | Replaced the legacy lock markup with the v2 scene; added lock-screen CSS/script tags; kept the old lock path but made it stand down when `data-lock-v2="true"`. |
| `main/profile/profile-service.js` | Added hidden `admin` definition, public-list filtering, `listPublicProfiles()`, `authenticate()`, `enableHiddenAdmin()`, `updateIdentity()`, admin session flag handling. |
| `main/profile/persistence-service.js` | Bumped state schema 2 → 3; added validated `lockScreen` defaults/normalization (settings, accounts, avatar data URL) and one-level merging. |
| `main/profile/profile-ui.js` | Delegates root lock UI to `LockScreenV2`; added v2 ownership detection and locked/inert integration. |
| `main/system-config.js` | Added `administrator` simulated user and profile `admin` → principal `administrator` mapping. |
| `README.md` | Added lock-screen architecture, hidden-admin recovery, security caveat, structure entry, and updated legacy shortcut note. |
| `main/profile/README.md` | Documented schema v3/`lockScreen`, new auth/identity APIs, hidden admin, v2 delegation, tests, and manual checks. |

### Added

| File | Purpose |
| --- | --- |
| `main/lock-screen/lock-screen.js` | Controller, state machine, auth adapter, settings/avatar handling, clock, diagnostics. |
| `main/lock-screen/lock-screen.css` | Lock-screen layout, visuals, transitions, responsive/settings styling. |
| `main/lock-screen/lock-animations.js` | `LockAnimationController` (registry, intensity, reduced motion, visibility pause, single loop). |
| `main/lock-screen/lock-widgets.js` | `LockWidgets` registry and `WidgetHost` with failure isolation. |
| `main/lock-screen/lock-arg.js` | `LockSecretEvents`, disabled fictional ARG extension. |
| `main/lock-screen/README.md` | Module documentation, API, security limits, test commands. |
| `tests/lock-screen-logic.test.js` | 42 Node logic tests with in-memory profile/persistence fakes. |
| `LOCK_SCREEN_V2_PROGRESS.md` | This handoff report. |

## Reused APIs (no duplication)

- `ProfileService`: profile records, active profile, `authenticate()`,
  `setOwnerPassword()`, `updateIdentity()`, `lock()`, `isUnlocked()`,
  `setActiveProfile()` (flush + reload), profile events.
- `PersistenceService`: `getCachedState()`, `loadProfileState()`, `queueSave()`,
  `validateState()`, `defaults()`. Lock-screen state lives under
  `state.lockScreen`; no second settings store.
- `ProfileUI`: `_setLocked()`, `ready`, locked/inert and `aria-hidden` handling.
- `ProfileWindowState.flushActive()` before locking.
- `SystemServices.events.emit()` for optional settings telemetry.
- Existing `SystemConfig` profile-scoped simulation for the administrator
  principal.

## Persistence and migration

- `profile-state` schema is now **v3**. `lockScreen` is additive; v1/v2 records
  still load and are validated with defaults for missing fields. Existing
  profile IDs, auth records, VFS databases, and window data were not changed.
- `accounts.showHiddenAccounts` is forced to `false` by the validator.
- Password fields and plaintext credentials are absent from the schema and were
  tested against smuggling attempts.
- Custom avatars are stored only after client-side WebP re-encoding, with input
  limits (512 KB, 1024×1024) and a 600,000-character data-URL cap.

## Tests run

### Node (executed)

```text
node tests/lock-screen-logic.test.js
42 passed, 0 failed
```

Coverage: public list excludes admin; explicit admin lookup; unknown/incorrect
credentials fail generically; guest password-free success; owner setup,
password verification, custom username/display name, uniqueness, rename
invalidation; hidden-admin setup gating and authentication; clock/animation/
widget/account defaults and persistence; unknown/duplicate widget filtering;
hidden accounts cannot be enabled; built-in and custom avatar persistence;
SVG rejection and safe fallback; password non-persistence and top-level
smuggling rejection.

### Syntax (executed)

`node --check` passed for all lock-screen modules and modified profile/system
scripts:
`lock-screen.js`, `lock-animations.js`, `lock-widgets.js`, `lock-arg.js`,
`profile-service.js`, `persistence-service.js`, `profile-ui.js`,
`system-config.js`.

### Browser (executed on `http://127.0.0.1:5500/index.html`)

- Fresh boot shows Guest and Owner cards; no administrator card.
- Guest signs in; desktop becomes visible/unlocked; sign-out returns to
  `selecting-account` and locked state.
- Unknown username and wrong password show the same generic error and do not
  activate a session.
- Owner without a password shows first-run setup (password + confirmation).
- Settings persist across reload: clock seconds, animation intensity, widget
  rotation, built-in avatar. Guest state was restored to defaults after testing.
- Custom PNG upload was re-encoded to WebP and persisted; invalid SVG and invalid
  preset were rejected with safe fallback.
- Hidden-admin trigger gating passed in the Node suite.
- Widget failure fallback did not block login.
- Reduced-motion preference was honoured.
- Cleanup removed 5 listeners, widget host, and environment; a remount restored
  exactly one instance.
- Guest VFS remained `vfs-db-guest`; SystemConfig guest could read VFS but not
  configure.
- No lock-screen runtime errors. Remaining console 404s are pre-existing missing
  `assets/cursor-*.png` and `playlist/playlist.json` requests.

### Not directly exercised in browser

Owner/admin **successful session activation** (reload path) was not run against
the real persisted owner because no owner password exists and the test avoided
changing stored credentials. Owner authentication success, custom identity, and
admin authentication are covered by the Node suite; owner first-run setup UI was
verified in the browser.

### Known baseline failure

`python verify.py` reports 54 pre-existing errors under `imported_repos/**`.
They are unrelated to this work; all new/changed JS passes `node --check`.

## Limitations

- **Browser-only security.** The login gate is not confidentiality. DevTools,
  IndexedDB access, or modified JavaScript can bypass it. The hidden admin is
  absent from lists, not protected from inspection.
- The hidden administrator is unconfigured by default. Recovery requires
  `sessionStorage.desktop.devMode = '1'` plus `enableHiddenAdmin(...)`.
- Session/profile switching intentionally reloads via `ProfileService`, so the
  transition includes a page reload; `desktop.lock.autoEnter` provides the
  one-time reveal.
- No account creation beyond Owner/Guest/admin; `allowAccountCreation` remains
  false.
- Lock-screen settings are per profile, so changing them as Guest does not affect
  Owner (and vice versa).
- Visual screenshot capture was blocked by the browser tool's visible-tab
  requirement; visual review was done through DOM/computed state and manual
  browser interaction.

## Next steps

1. Perform an owner/admin success-path browser test in a disposable browser
   profile (or after setting a temporary owner password) to confirm the
   `setActiveProfile` reload + `desktop.lock.autoEnter` reveal end-to-end.
2. Optionally expose `accounts.showOwner` / `accounts.showGuest` toggles in the
   settings panel (schema support already exists).
3. Do a final visual pass on small screens and at `low` animation intensity.
4. Commit and deploy to GitHub Pages; no build step or server changes needed.

## Quick verification

```bash
python serve.py 5500
# open http://127.0.0.1:5500/index.html
node tests/lock-screen-logic.test.js
```

In the browser console:

```js
LockScreenV2.diagnostics();
LockAnimationController.diagnostics();
LockWidgets.WidgetHost.diagnostics();
LockSecretEvents.diagnostics(); // disabled unless explicitly enabled
```
