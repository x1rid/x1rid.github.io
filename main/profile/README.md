# Profile & Persistence Layer

Static, build-free profile services for the desktop shell. No `import`/`export`,
no bundler. Everything is a `window.*` global loaded with `<script>` tags.

## Files

| File | Responsibility |
| --- | --- |
| `profile-db.js` | IndexedDB `profile-db` (stores `profiles`, `profile-state`). Never stores file bytes. |
| `profile-service.js` | Profile definitions, active profile, owner password gate, events. |
| `persistence-service.js` | Validate / load / save / reset per-profile state, debounce, diagnostics, shell hooks. |
| `window-state.js` | Profile-scoped window snapshot bridge; restores through the shell's existing launch paths. |
| `boot.js` | Deterministic boot: profiles → active profile → VFS → state → apply → emit. |
| `profile-ui.js` | Lock-screen profile switcher and owner password prompt. |

Load order (in `<head>`, before the VFS scripts):

```html
<script src="./profile/profile-db.js"></script>
<script src="./profile/profile-service.js"></script>
<script src="./profile/persistence-service.js"></script>
<script src="./profile/window-state.js"></script>
<script src="./fs/types.js"></script>
<!-- … other fs scripts … -->
<script src="./fs/init.js"></script>
<script src="./profile/boot.js"></script>
<script src="./profile/profile-ui.js"></script>
```

The desktop shell's boot block waits on `window.ProfileReady` before it queries
the DOM or renders windows.

## Public API

### `window.ProfileService`

```js
await ProfileService.init();                  // idempotent, creates/migrates metadata
ProfileService.getProfiles();                 // [{ id, name, type, username, dbName, ... }]
ProfileService.getProfile(id);                // copy or null
ProfileService.getActiveProfile();            // copy or null
ProfileService.resolveActive();               // profile for this tab (locked owner → guest)
await ProfileService.setActiveProfile(id);    // flush outgoing state, then reload
ProfileService.hasOwnerPassword();            // boolean
await ProfileService.setOwnerPassword(pwd);   // first-time setup (salted PBKDF2)
await ProfileService.unlock('owner', pwd);    // { ok, reason?, needsSetup? }
ProfileService.isUnlocked(id);
ProfileService.lock(id);
ProfileService.subscribe(fn);                 // returns unsubscribe
ProfileService.ready;                         // Promise (same as window.ProfileReady)
```

Invalid ids/types are rejected. `setActiveProfile` rejects with
`code === 'PROFILE_LOCKED'` when the owner is not unlocked.

### `window.PersistenceService`

```js
await PersistenceService.loadProfileState(profileId);        // validated state
await PersistenceService.saveProfileState(profileId, state); // resolves after commit
PersistenceService.queueSave(profileId, partial);            // debounced (700 ms)
await PersistenceService.flush(profileId);                   // commit pending now
await PersistenceService.resetProfileState(profileId);       // settings only, never files
PersistenceService.collectState();                           // snapshot shell prefs
PersistenceService.applyState(profileId, state);
PersistenceService.bindAutoSave(profileId);
PersistenceService.getCachedState(profileId);
PersistenceService.validateState(state);                     // pure validator
```

`saveProfileState` only resolves after the IndexedDB transaction commits. A
storage failure rejects **and** emits `profile:state-error`; success is never
reported early.

### `window.ProfileWindowState`

```js
ProfileWindowState.create({ profileId, getWindows }); // bridge for one shell
ProfileWindowState.snapshot(windowsMap);              // serializable window map
ProfileWindowState.snapshotActive();                  // active bridge snapshot
await ProfileWindowState.flushActive();                // snapshot + flush now
```

The shell owns the live `windows` Map; this module only serializes restorable
fields. It refuses to queue after the active profile changes, so a late timer
cannot write one profile's geometry into another profile's state. The
authoritative snapshot replaces `state.windows` (it is not merged), which is
what makes closing the last window persist as an empty window set.

### `window.ProfileUI`

```js
await ProfileUI.ready;
ProfileUI.unlock();        // guest unlocks immediately; owner prompts
ProfileUI.lock();
ProfileUI.openSwitcher();
ProfileUI.isLocked();
```

### Readiness contract

- `window.ProfileReady` — resolves after profile metadata, VFS, and state are ready.
- `window.VirtualFSReady` — preserved; resolves to the open `window.VFS`.

## Events

Dispatched as `CustomEvent` on `document` (also delivered to
`ProfileService.subscribe` listeners):

| Event | `detail` |
| --- | --- |
| `profile:ready` | `{ profile, profileId }` |
| `profile:changed` | `{ from, to }` |
| `profile:state-loaded` | `{ profileId, state, restored }` |
| `profile:state-saved` | `{ profileId, updatedAt, revision }` |
| `profile:state-error` | `{ profileId, operation, error }` |
| `profile:locked` | `{ profileId }` |
| `vfs:opened` | `{ profileId, dbName, username }` |
| `explorer:navigate` | `{ id }` (used to persist the last Explorer folder) |

## Storage schema

`profile-db` v1:

```js
// profiles
{ id, name, type: 'guest'|'owner', username, dbName, description,
  createdAt, lastAccessAt, schemaVersion, initialized,
  auth: null | { algo, iterations, salt, hash, updatedAt } }

// profile-state
{ profileId, schemaVersion: 2, revision, updatedAt,
  data: {
    schemaVersion: 2,
    desktop: { wallpaper, wallpaperPaused, iconsVisible },
    settings: { theme, musicVolume, clippyVisible, cursorScheme, soundEnabled },
    apps: {
      lastExplorerFolder,
      windowsInitialized // false = fresh profile; true = restore exact set
    },
    windows: {
      "explorer": {
        appId: "explorer",
        left: 18, top: 12, width: 754, height: 462,
        maximized: false, minimized: false
      },
      "terminal-1": {
        appId: "terminal",
        left: 403, top: 237, width: 363, height: 239,
        maximized: false, minimized: true
      }
    }
  } }
```

State is validated on every read and write. Unknown keys, wrong types,
out-of-range numbers, functions, DOM nodes, and circular objects are dropped.
A newer `schemaVersion` only reads known fields; malformed data falls back to
defaults without throwing. Version 1 records still load; legacy geometry-only
window entries are discarded because they have no app identity. The shell then
boots its default layout and writes a version 2 record on the next save.

### Persisted today

- Virtual files & recycle bin (existing VFS, per profile).
- Wallpaper pause state, desktop icon visibility.
- Music volume, Clippy visibility, cursor scheme, sound toggle.
- Theme id (stored; the shell currently only ships the plum theme).
- Last Explorer folder.
- Open windows per profile: app identity, restore bounds, maximized/minimized
  flags, and whether the profile has initialized its window set.
- Profile metadata, timestamps, and owner auth verifier.

Explicitly **not** persisted (transient by design): window focus, z-order,
in-progress drag/resize, hover, open context menus, toasts, selected icon, and
per-app scratch state. Window geometry is persisted; focus order is not.

## Profile isolation

VFS nodes had no profile field. Rather than rewriting node identity (which every
component relies on: `'root'`, `'c-drive'`, …), each profile gets its own
IndexedDB namespace using the **same VFS schema and code**:

| Profile | Database | Username | Existing data |
| --- | --- | --- | --- |
| `owner` | `vfs-db` (legacy) | `r3d1` | preserved unchanged |
| `guest` | `vfs-db-guest` | `guest` | created lazily, seeded independently |

`VFSService.open(profile)` constructs the canonical `VirtualFS` against that
namespace. A Guest `VirtualFS` instance only ever loads Guest nodes, so normal
simulator APIs cannot read, change, or delete owner files. There is no second
filesystem implementation and no duplicated content storage.

Migrations are per-namespace (`vfs-schema-version:<profileId>`) and only run
cycle/orphan repair. Existing owner data is not rewritten during this work.

## Security limitations

- **The owner password is a UI gate, not confidentiality.** The app is static
  and client-side. Anyone with the browser profile, IndexedDB access, or the
  ability to edit served JavaScript can read or bypass everything.
- The password is never hardcoded and never stored in plaintext: a random salt
  and a PBKDF2-SHA256 verifier (120 000 iterations) live in `profile-db`.
  Non-secure contexts fall back to an iterated FNV hash (weaker).
- Session unlock (`sessionStorage`) survives reload in the same tab and is
  cleared when the tab closes. This is convenience, not security.
- Multi-tab: each tab has its own `sessionStorage` profile selection. Two tabs
  on the same profile share state (last write wins, serialized per tab). Two
  tabs on different profiles are isolated by database.

## Boot sequence

1. `ProfileService.init()` — create/migrate `guest` and `owner` metadata.
2. Resolve this tab's profile (`sessionStorage`, locked owner → Guest).
3. `VFSService.open(active)` — open the matching VFS namespace.
4. `PersistenceService.loadProfileState(active)` — validate saved state.
5. Write localStorage/sessionStorage preference keys *before* the shell boots.
6. After DOM ready: apply DOM preferences (slider, theme, icons, cursor).
7. `bindAutoSave(active)` — VFS events + shell controls → debounced saves.
8. Emit `profile:ready` / `profile:state-loaded`; unlock the shell.

Profile switching flushes the outgoing profile, records the new active profile,
and reloads. The reload guarantees no window/selection/application state leaks
between profiles and that the incoming profile's state is applied before render.

## Reset

`resetProfileState(profileId)` writes defaults back to that profile's state
record. It never touches VFS nodes, file contents, or the recycle bin. Full
profile deletion is intentionally not implemented.

## Manual test checklist

Run from the repo root with `python -m http.server 8899`, then open
`http://localhost:8899/index.html`.

1. Fresh browser state → Guest profile boots; desktop and Explorer render.
2. Create `guest-test.txt` on the desktop → reload → file is still there.
3. Change volume / pause wallpaper → reload → both restored.
4. Owner chip → set a password → shell reloads into `r3d1bruh` with separate files.
5. Create an owner file → switch to Guest → owner file is not visible.
6. Switch back to Owner → password prompt → correct password → owner state restored.
7. Reload with a locked owner session → Guest boots; owner data is not exposed.
8. Corrupt `profile-state` in DevTools → reload → defaults, no crash.
9. Reload repeatedly → profiles, files, and icons are not duplicated.
10. Reset settings → virtual files and recycle bin remain intact.
11. Simulate a failed write (see below) → `profile:state-error` fires and save rejects.
12. Open `main/desktop-shell.html` → profile layer works without the lock screen.

Simulated failure:

```js
const db = ProfileService._db;
const original = db.putState.bind(db);
db.putState = async () => { throw new Error('quota'); };
await PersistenceService.saveProfileState('guest', { settings: { musicVolume: 10 } })
  .catch(e => console.log('rejected as expected', e.message));
db.putState = original;
```

## Remaining work

- The window manager still uses its own localStorage keys for a few window
  positions; wire them into `state.windows` if geometry persistence is wanted.
- Control Panel theme buttons are cosmetic; `state.settings.theme` is stored but
  only one theme ships.
- Multi-tab writes are last-write-wins per profile (documented above).
- `main/index.html` and `main/desktop-shell.html` are legacy duplicates of the
  root shell. They load the same shared services, but only the root page has the
  lock screen.
