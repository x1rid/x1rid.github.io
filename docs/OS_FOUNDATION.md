# OS SIMULATOR: FOUNDATION SPEC

**Audience:** every AI agent that touches this repo, now or later, smart or not.
**Status of this file:** the source of truth. If code and this file disagree, stop and ask the human. Do not silently pick one.

---

## 0. HOW TO READ THIS FILE

| If you are... | Read |
|---|---|
| A weaker / fast agent doing a small task | Part 1 (Golden Rules), Part 9 (Task Cards), Part 10 (Definition of Done). Then only the section your task names. |
| A stronger agent designing or refactoring | Everything. |
| An agent joining mid-project | Part 2 (State of the Code), Part 8 (Roadmap), Part 11 (Coordination). |

Rule zero: **if you are unsure, do less and write down the question** in `docs/OPEN_QUESTIONS.md`. A small correct change beats a big clever one. This codebase has ~80 files and many authors (human and AI); wide edits cause collisions.

---

## 1. GOLDEN RULES (memorize these)

1. **No build step.** Plain `<script>` tags, vanilla JS, no bundler, no npm runtime deps, no `import`/`export` in browser code. (Pure modules may add `module.exports` behind a guard so Node tests can load them, like `window-manager-core.js` already does.)
2. **One global namespace per service**, exported once at the bottom of the file: `window.SomeService = Object.freeze({...})`. Never leak helper globals.
3. **Layers only call downward.** See Part 3. A lower layer never imports, queries the DOM of, or listens for events from a higher layer.
4. **Services never touch the DOM.** Only the Shell layer and Apps create DOM. Services expose data + events.
5. **Persistent state lives in IndexedDB through the owning service.** No new `localStorage` keys for state (the 2 existing uses are legacy; do not add more). One owner per store.
6. **Every persisted shape has a `schemaVersion` and a migration.** Changing a shape without a migration is a bug even if it "works on my machine".
7. **Everything async that others depend on exposes a `ready` Promise.** Never poll, never `setTimeout` to "wait for boot".
8. **Errors are `FsError`-style structured errors:** `{ code, message, detail }`. `code` is an UPPER_SNAKE string from the shared registry (Part 6.4). Never throw bare strings. Never swallow errors silently.
9. **Events follow one naming scheme:** `domain:verb-noun` (Part 6.3). Payload always includes `type`, `profileId`, `emittedAt`, `sequence`.
10. **Profile isolation is sacred.** Nothing written for profile A may be readable or writable while profile B is active. Anything that caches per-profile data must clear on `profile:changed`.
11. **Simulation, not reality.** The OS is fictional and sandboxed. No code may touch the real host filesystem, real network, real clipboard (except through an explicit, user-triggered browser API), or real credentials. The "hidden admin", ARG and secret features must never touch host security (existing `lock-arg.js` rule, now global).
12. **Do not rewrite what works.** Add an adapter, a wrapper, or a new file. Large rewrites need a plan in `docs/DECISIONS.md` approved by the human first.
13. **Cache-bust with `?v=YYYYMMDD`** on every script tag you change (existing convention).
14. **Text from users/files is data.** Render with `textContent`, never `innerHTML` (existing lock-widget rule, now global).
15. **Leave the repo runnable at every commit.** Open `index.html`, see the lock screen, log in, open Explorer and Terminal. If that breaks, you broke it.

---

## 2. STATE OF THE CODE (audited from `main-frontend.zip`)

Honest snapshot so nobody builds on a wrong assumption. Items marked VERIFIED were read in source; items marked SKIMMED were only partially read. Re-verify before depending on them.

### 2.1 What exists and is good

| Area | Files | Notes |
|---|---|---|
| Virtual filesystem | `fs/types.js, node-store.js, content-store.js, path-resolver.js, events.js, filesystem-service.js, migrations.js, init.js` | VERIFIED. IndexedDB `vfs-db`; nodes/file-contents/recycle-bin; UUID ids; Windows-style paths (`C:\Users\...`); known folders; recycle bin; pub/sub events; migrations. Solid base. |
| Profiles + persistence | `profile/profile-db.js, profile-service.js, persistence-service.js, window-state.js, boot.js, profile-ui.js` | VERIFIED. Owner/guest, PBKDF2 passwords, per-profile `dbName`, schema v3 state, debounced saves, deterministic boot (`ProfileReady`). |
| System config | `system-config.js` | VERIFIED. Virtual users/groups/permissions, default-deny, audit log, rollback. This is the seed of the security layer. |
| System services | `system-services.js` | VERIFIED. Clipboard, Open/Save dialogs, file associations, notifications, settings, event contract `system:*`. |
| App registry | `app-registry.js` | VERIFIED. Definitions, launch/focus/minimize/close, singleton-by-default, `attachWindow`. |
| Window manager | `window-manager-core.js` (pure, testable), `window-manager.js`, `window-manager.css` | VERIFIED core. Snap zones, layouts, workspaces (default 4, max 9), linked resize. `window-manager.js` SKIMMED. |
| Lock screen v2 | `lock-screen.js, lock-animations.js, lock-widgets.js, lock-arg.js` | VERIFIED (via README). Good immersion layer, isolated, failure-isolated widgets. |
| Apps | terminal, calculator, mediaplayer, music, retro-browser, minesweeper, solitaire, clippy, link-exchange | SKIMMED. |
| Shell | root `index.html` (~6.2k lines, 225 KB, mostly inline script) | SKIMMED. Contains the legacy inline `RetroApps` registry, window creation, taskbar, start menu. |

### 2.2 Known gaps and smells (the foundation work exists because of these)

| # | Problem | Why it blocks "advanced features" |
|---|---|---|
| G1 | **No process model.** Apps are windows, not processes. There is no PID, no process table, no lifecycle beyond window open/close. | Can't do Task Manager, `ps`/`kill`, background services, crash isolation, resource accounting. |
| G2 | **No syscall layer.** Apps call `VFS`, `SystemConfig`, `ProfileService` directly. Permission checks (`SystemConfig.check`) are opt-in. | Security is decorative. Linux/Windows "personalities" can't share one kernel. |
| G3 | **Terminal has its own hardcoded fake filesystem** (`const vfs = {'/': {...}}` in `terminal.js`) and does not use `window.VFS` at all. | The most immersive app lies about the disk. `touch` in terminal won't show in Explorer. |
| G4 | **Two app registries:** legacy inline `RetroApps` (in `index.html`) and the newer `AppRegistry`. | Duplicate sources of truth; new apps will pick the wrong one. |
| G5 | **Monolithic shell.** ~6k lines inline in `index.html`, plus a near-duplicate `desktop-shell.html` (221 KB) and `desktop-concept.html`. | Impossible for multiple agents to edit without merge pain. |
| G6 | **Windows-only path model.** VFS paths are `C:\...`; no POSIX view, no mounts, no `/dev`, `/proc`. | "Windows AND Linux" is a stated goal; today only the first half exists. |
| G7 | **Event vocabularies disagree:** `node-created` (VFS), `profile:ready`, `system:file-opened`, `site:appopen`. Four styles. | Hard to build a universal event log, automation, or AI-agent observability. |
| G8 | **Globals everywhere, load order by hand.** Order lives in HTML comments/READMEs. | Easy to break by inserting a script tag in the wrong place. |
| G9 | **No automated tests** (only `window-manager-core.js` is Node-loadable). | Multi-agent work without tests = silent regressions. |
| G10 | **Upload layout is lossy.** In `main-frontend.zip`, folder structure is flattened: three `README.md`, three `index.html`, two `retro-browser.js` collide, and references like `./fs/...`, `./profile/...`, `./apps/...`, `./vendor/clippy/...` point to folders that are not in the zip. | Agents given the zip alone cannot run it. Human must provide the real tree. |
| G11 | Hardcoded identities (`r3d1`, `r3d1bruh@desktop`) in VFS seed and terminal prompt. | Breaks multi-user, profile switching, and any "new user" onboarding. |
| G12 | Dev backdoor `enableHiddenAdmin` exists (gated by `{dev:true}` or `sessionStorage['desktop.devMode']`). | Fine for simulation; must stay clearly fictional and gated. |

Do not "fix" gaps outside your task card. Fix them in the order in Part 8.

---

## 3. TARGET ARCHITECTURE

Seven layers. **A layer may only depend on layers with a smaller number.** Violations are rejected in review.

```
L7  IMMERSION      boot sequence, lock screen, sounds, cursor, wallpapers, clippy, easter eggs/ARG
L6  APPLICATIONS   Explorer, Terminal, Settings, Task Manager, Browser, games, editors...
L5  SHELL          desktop, taskbar, start menu, window chrome, notifications UI, context menus, WM
L4  SESSION        profiles, login/lock, per-user settings, window-state restore, autostart
L3  KERNEL         process table, scheduler (cooperative), syscalls, IPC, event bus, timers, signals
L2  SECURITY       users/groups, permissions (default-deny), audit, capabilities
L1  STORAGE        VFS (nodes, content, mounts, devfs, procfs), persistence, migrations
L0  PLATFORM       Clock, RNG, IndexedDB wrapper, error types, logger, feature detection
```

Note the numbering: **L0 is the bottom.** Today's code maps like this:

| Today | Target layer |
|---|---|
| `fs/*` | L1 |
| `system-config.js` (users, permissions, audit) | L2 (split out of config) |
| `profile/profile-*.js, boot.js, window-state.js` | L4 |
| `app-registry.js` | L3 (process manager) + L5 (launcher). Needs splitting. |
| `system-services.js` (clipboard, dialogs, notifications) | L3 (services) with UI parts moved to L5 |
| `window-manager*.js`, `index.html` inline shell | L5 |
| `terminal.js`, `calculator.js` ... | L6 |
| `lock-screen*.js`, `sfx.js`, `custom-cursor.js`, `clippy*` | L7 |

### 3.1 The one-sentence model

> The OS is a **kernel (L3) exposing syscalls** over a **VFS (L1)** guarded by a **permission engine (L2)**; **processes** (apps and services) talk only through syscalls and events; **shells and personalities** (Windows-style GUI, bash-style terminal, PowerShell-style terminal) are *views* on that same kernel.

If you ever feel the urge to give Terminal its own filesystem or Explorer its own clipboard, you are violating the model.

### 3.2 Personalities (Windows vs Linux)

One kernel, one VFS, multiple **path dialects** and **shell dialects**:

- **VFS stores nodes by id**, not by path string. (Already true.)
- **Path dialect adapters** translate: `C:\Users\Rid\Documents\a.txt` <-> `/home/rid/Documents/a.txt` via a mount table. Add `PathDialect.windows` and `PathDialect.posix` in L1.
- **Mount table** (new): `C:` -> `/mnt/c`, `/` (posix root) is a view with `/home`, `/etc`, `/dev`, `/proc`, `/tmp`, `/usr`, `/var`. Windows view stays the default for the GUI.
- **Shells** are L6 apps: `cmd`, `powershell`, `bash`. They differ in parsing and builtins, not in what they can reach.
- **Package of identity:** `username` comes from the active profile. No hardcoded `r3d1`.

---

## 4. REPOSITORY LAYOUT (target)

Current files are flat in the zip but referenced as folders. Canonical layout to restore and extend:

```
/
├─ index.html                 # thin shell loader only (target < 200 lines)
├─ docs/
│  ├─ OS_FOUNDATION.md        # this file
│  ├─ DECISIONS.md            # append-only decision log (Part 11)
│  ├─ OPEN_QUESTIONS.md
│  ├─ CHANGELOG.md            # one line per merged task
│  └─ ownership.md            # who owns which folder (Part 11)
├─ kernel/                    # L0-L3 (new)
│  ├─ platform/               # clock.js, rng.js, idb.js, errors.js, logger.js
│  ├─ events.js               # unified event bus
│  ├─ syscalls.js
│  ├─ process-table.js
│  ├─ scheduler.js
│  ├─ ipc.js
│  └─ service-manager.js
├─ security/                  # L2 (new, extracted from system-config.js)
│  ├─ users.js
│  ├─ permissions.js
│  └─ audit.js
├─ fs/                        # L1 (exists)
├─ profile/                   # L4 (exists)
├─ shell/                     # L5 (extracted from index.html)
│  ├─ desktop.js taskbar.js start-menu.js notifications-ui.js window-chrome.js
│  └─ window-manager-core.js window-manager.js window-manager.css
├─ apps/                      # L6, one folder per app
│  └─ <app-id>/{manifest.json, main.js, styles.css, README.md}
├─ immersion/                 # L7
│  ├─ boot/ lock/ sfx/ cursor/ clippy/
├─ vendor/                    # third-party, with LICENSE + SOURCES.md
└─ tests/
   ├─ unit/                   # Node, pure modules
   ├─ integration/            # browser (Playwright or a plain HTML runner)
   └─ fixtures/
```

**Migration rule:** move files in dedicated "move-only" commits (no behavior change) so history stays readable. Keep a compatibility shim at the old path for one release if other agents may still reference it.

---

## 5. SYSTEM MODEL (what to build in L3)

### 5.1 Process model

Everything that runs is a **process**:

```js
// Process record (kernel/process-table.js)
{
  pid: 1042,                 // monotonic integer, never reused in a session
  ppid: 1,                   // parent pid; 1 = init
  appId: 'terminal',         // from app manifest
  kind: 'app' | 'service' | 'daemon' | 'task',
  name: 'Terminal',
  uid: 'owner',              // principal from L2
  state: 'starting' | 'running' | 'suspended' | 'zombie' | 'exited',
  exitCode: null,
  startedAt: 1730000000000,
  cwd: 'C:\\Users\\Rid',     // as VFS node id + cached path
  env: { PATH: '...', USER: 'rid' },
  windows: ['win-12'],       // shell window ids (optional; services have none)
  caps: ['vfs:read:user', 'net:none'],  // granted capabilities
  stats: { cpuTicks: 0, memBytes: 0, syscalls: 0 }  // simulated + real counters
}
```

- **Launching an app = `spawn()`** syscall. `AppRegistry.launch` becomes a thin wrapper that calls `spawn` and then asks the Shell for a window.
- **Closing the last window of an `app` process** sends `SIGTERM`; the app may veto once (unsaved changes), then is killed.
- **Crash isolation:** an uncaught error in an app's `main()` marks only that process `zombie` and emits `proc:crashed`. The shell shows a fictional "has stopped responding" dialog. The OS keeps running.
- **Services** (clipboard, notifications, indexer, AI-agent hosts) are processes with `kind: 'service'`, started by the service manager at boot in dependency order.

### 5.2 Scheduling

Browsers give us one thread. We simulate:

- **Cooperative scheduler** with a tick (default 50 ms, configurable). Processes register tick handlers; the scheduler time-slices them for *simulated* CPU accounting.
- Real work (hashing, big file reads) runs in Web Workers when needed, behind a syscall, so the UI never freezes.
- Task Manager reads `stats` from the process table. Numbers may be partly simulated, but **must be internally consistent** (sum of process memory <= simulated total RAM, etc.). Immersion dies when numbers contradict.

### 5.3 Syscall layer (the only door)

```js
const r = await Kernel.syscall(ctx, 'fs.read', { path: 'C:\\Users\\Rid\\a.txt' });
```

- `ctx` = `{ pid, uid, caps }`, supplied by the process handle given to the app at spawn. Apps do **not** get raw `window.VFS`.
- Every syscall: (1) validate args, (2) permission check via L2 (`allow`/`deny`, default-deny), (3) run, (4) audit if sensitive, (5) emit event, (6) return `{ ok: true, value }` or throw structured error.
- **Initial syscall set (v1)**, deliberately small:

| Group | Calls |
|---|---|
| `fs.*` | `stat, list, read, write, create, mkdir, remove, move, copy, watch, resolve, mount, umount` |
| `proc.*` | `spawn, kill, list, info, signal, wait, setEnv` |
| `win.*` | `open, close, focus, setTitle, resize, setIcon` (forwards to Shell; no DOM handed out) |
| `ipc.*` | `send, subscribe, request, reply` |
| `sys.*` | `time, info, log, notify, clipboard.get/set, settings.get/set` |
| `sec.*` | `whoami, check, elevate` (elevate is fictional UAC/sudo) |
| `net.*` | `fetch` (to simulated network only, see 5.6) |

**Migration path:** do not break existing code. Provide `Kernel.legacy.vfs = window.VFS` for old callers and migrate apps one at a time (Part 8, Phase 2). Lint rule (a simple grep test): new files under `apps/` must not reference `window.VFS`, `window.SystemConfig`, or `ProfileService` directly.

### 5.4 IPC and events

- **Event bus** (`kernel/events.js`) is the single pub/sub. Existing emitters (`VfsEvents`, `ProfileService.subscribe`, DOM `CustomEvent`s on `document`) get **bridged** into it; do not delete them yet.
- **Topics** (Part 6.3). Subscribers get `unsubscribe()`. No subscription may outlive its process (kernel auto-cleans on process exit).
- **Request/reply IPC** is a thin layer on top: `ipc.request(pidOrService, topic, payload, {timeoutMs})`.

### 5.5 Storage model additions (L1)

- **Mount table:** `{ mountPoint, fsType, nodeId|handler, readOnly }`.
- **Virtual filesystems:**
  - `procfs` (`/proc/<pid>/status`, `/proc/cpuinfo`, `/proc/meminfo`), generated live from the process table.
  - `devfs` (`/dev/null`, `/dev/zero`, `/dev/random`, `/dev/tty0`, `/dev/clipboard`), handlers, not stored nodes.
  - `tmpfs` (`/tmp`), in-memory, cleared on boot.
- **Node metadata additions** (needs migration to schema v2): `uid, gid, mode` (rwx bits for owner/group/other, plus Windows-style ACL list optional), `ctime`, `atime`. Keep existing `attributes` (`hidden, readOnly, system`).
- **File watching:** `fs.watch(path, cb)` backed by `VfsEvents`.
- **Quota:** per-profile storage budget so a runaway app can't fill IndexedDB. Surface as "disk full" errors (`ENOSPC`).

### 5.6 Network (simulated)

Immersion needs a network that feels real but is fake and safe:

- `net.*` talks to a **virtual network** (`kernel/net/`): fictional hostnames, a DNS table, fake sites served from VFS or JSON, latency and packet-loss simulation.
- Real internet access, if ever offered, goes through one audited gateway app (the existing retro-browser iframe policy in `iframe-policy.js` is the model), is **off by default**, and is never available to untrusted/AI-generated apps.

### 5.7 Boot sequence (target order)

```
 0. platform init           (clock, idb, errors, logger)
 1. profile metadata        (ProfileService.init)
 2. security + users        (load principals for active profile)
 3. VFS open                (vfs-db for active profile) + mounts + procfs/devfs/tmpfs
 4. kernel up               (event bus, process table, syscalls, scheduler)
 5. service manager         (start services in dependency order, each with a ready promise)
 6. session restore         (settings, windows snapshot, autostart list)
 7. shell render            (desktop, taskbar, restore windows via spawn)
 8. immersion               (boot animation can run *during* 1-6, never block them)
```

Existing `ProfileReady` and `VirtualFSReady` stay as aliases. New global: `window.KernelReady`. A visible boot log (fictional but derived from real step names) feeds the boot animation, so what you see is what is happening.

---

## 6. CONTRACTS (copy these exactly)

### 6.1 Service contract

Every service file starts with a header like `system-services.js` and exports one frozen global.

```js
/**
 * @file kernel/example-service.js
 * @layer L3
 * @owns  <stores / state this file is the only writer of>
 * @needs [ 'VFS', 'Kernel.events' ]        // allowed dependencies, lower layers only
 * @emits [ 'example:changed' ]
 */
(function (window) {
  'use strict';
  const VERSION = '20261101';
  let readyResolve; const ready = new Promise(r => (readyResolve = r));

  async function init() { /* ... */ readyResolve(); }

  window.ExampleService = Object.freeze({
    version: VERSION,
    ready,
    diagnostics() { return { /* plain JSON, safe to print */ }; },
    // public API...
  });
  init().catch(err => window.Kernel?.log?.('error', 'ExampleService init failed', err));
})(window);
```

Mandatory members: `ready`, `version`, `diagnostics()`. Diagnostics must return plain JSON so any agent (or the in-OS Task Manager / a debug page) can inspect state.

### 6.2 App manifest (`apps/<id>/manifest.json`)

```json
{
  "manifestVersion": 1,
  "id": "notepad",
  "name": "Notepad",
  "version": "1.0.0",
  "kind": "app",
  "entry": "main.js",
  "styles": ["styles.css"],
  "icon": "assets/icon.svg",
  "multiple": true,
  "fileTypes": ["txt", "md", "log"],
  "capabilities": ["fs.read:user", "fs.write:user", "sys.clipboard"],
  "window": { "width": 640, "height": 420, "minWidth": 320, "minHeight": 180, "resizable": true },
  "personality": ["windows", "linux"],
  "startMenu": { "category": "Accessories" }
}
```

Entry point contract:

```js
// apps/notepad/main.js
window.OSApps.register('notepad', {
  async main(proc, args) {
    const win = await proc.win.open({ title: 'Notepad' });   // win.root is the ONLY DOM node you may touch
    // build UI inside win.root
    proc.onSignal('SIGTERM', async () => { /* save prompt; return true to allow exit */ return true; });
  }
});
```

- Apps only touch `win.root`. No `document.body` edits, no global CSS (scope styles with `.app-notepad` prefix).
- Apps declare capabilities up front; the kernel grants or denies at spawn time.
- Legacy `RetroApps.register({id,name,tagline,meta,icon,mount})` apps keep working through an adapter until migrated.

### 6.3 Event naming and payload

Format: `domain:verb-noun` (lowercase, hyphens). Domains: `fs`, `proc`, `win`, `sec`, `sys`, `profile`, `shell`, `net`, `ui`.

Every payload:

```js
{ type: 'fs:file-saved', profileId, emittedAt: Date.now(), sequence: 1234, pid: 42 /* source, if any */, ...data }
```

Existing names stay valid via **alias bridge**. Do not rename in place. Mapping table (maintain it in `kernel/events.js`):

| Legacy | Canonical |
|---|---|
| `node-created/updated/renamed/moved/recycled/restored/deleted` | `fs:node-*` |
| `site:applaunch / appopen / appclose / appactivate` | `proc:spawned / win:opened / proc:exited / win:focused` |
| `system:file-opened / file-saved` | `fs:file-opened / fs:file-saved` |
| `system:notification` | `sys:notification` |
| `profile:*` | unchanged (already canonical) |

Rules: emit synchronously after state changes; never throw from a listener (catch and log); a listener must not mutate the event.

### 6.4 Error codes (shared registry in `kernel/platform/errors.js`)

Use POSIX-flavored codes plus domain ones. Examples: `ENOENT, EEXIST, EACCES, EPERM, ENOTDIR, EISDIR, ENOTEMPTY, EINVAL, ENOSPC, EBUSY, ETIMEDOUT, ESRCH` (no such process), `ECHILD`, `PROFILE_LOCKED, PROFILE_SCOPE, DEV_MODE_REQUIRED, SCHEMA_MISMATCH, CAPABILITY_DENIED`.

```js
throw new OsError('ENOENT', 'No such file', { path });   // extends Error; has .code .detail
```

Existing `FsError` becomes a subclass of `OsError`. Terminals and dialogs map codes to dialect messages ("No such file or directory" vs "The system cannot find the file specified.").

### 6.5 Persistence contract

- One IndexedDB database per concern; names: `vfs-db:<profile.dbName>`, `profile-db`, `kernel-db` (new, for logs/installed apps).
- Every record that can change shape has `schemaVersion`. Migrations are pure, ordered, idempotent, and tested with fixtures from every previous version.
- Writes resolve **after** the transaction commits (existing rule; keep it). Failures reject and emit `profile:state-error` / `sys:error`.
- Never store derived data you can recompute. Never store file bytes outside `file-contents`.

### 6.6 Path rules

- Internal canonical form is **node id** plus a **posix-style canonical path string** (`/c/Users/Rid/Documents/a.txt`) used only for display/logging. Dialect adapters convert to and from Windows/POSIX user-visible forms.
- Case-insensitive lookup on the Windows view, case-sensitive on the POSIX view (mount flag).
- `..` can never escape a mount root (existing rule; keep it).
- Windows filename restrictions apply only in the Windows dialect; POSIX allows everything except `/` and NUL.

---

## 7. IMMERSION RULES (what "very immersive" means technically)

Immersion is a **consistency** problem more than an effects problem. Concrete rules:

1. **One source of truth for everything the user can observe.** If Task Manager says Terminal uses 18 MB, the terminal's `neofetch`, `/proc/<pid>/status`, and the memory graph must agree. Single numbers come from the process table.
2. **Nothing teleports.** Apps appear with launch animation, taskbar entry, and a process; closing removes all three. If the shell and process table disagree, treat as a bug.
3. **Time is `Kernel.clock`.** Never call `Date.now()` for user-visible time. The clock allows timezone, fast-forward (for boot/updates), and deterministic tests.
4. **Latency is a feature.** Simulated disk, network, and app launch have small randomized delays (tens of ms), configurable, and **off in test mode**.
5. **Failure is a feature.** BSOD / kernel panic screens are *fictional and triggered only by deliberate OS-level fault paths* (never by a real JS bug the user must recover from). Real JS errors show a toast/"app crashed" dialog and keep the OS alive.
6. **Audio, cursor, and animation respect settings**: reduced motion, mute, intensity. Existing `LockAnimationController` pattern (visibility pause, reduced-motion) is the model.
7. **Accessibility is not optional**: keyboard-reachable window controls, focus management, ARIA on shell controls, readable contrast.
8. **Mobile layout** exists (`mobile.js/css`, `phone.css`). Don't regress it; new shell features declare desktop-only or mobile support.
9. **Content is data-driven** (JSON in VFS or `/immersion/content/`): wallpapers, sounds, fake websites, installed-program lists. Adding flavor must not require editing core code.
10. **Easter eggs/ARG** go through `LockSecretEvents`-style extension points: disabled by default, fictional, never touching real security.

---

## 8. ROADMAP (strict order; each phase has exit criteria)

Do not start phase N+1 work until phase N exit criteria are met, **except** items tagged `[parallel-safe]`.

### Phase 0: Stabilize and make it agent-ready
Goal: repo any agent can open, run, and test.
- 0.1 Get the **real folder tree** from the human (zip is flattened; see G10). Commit it as-is.
- 0.2 Add `docs/` files listed in Part 4. `[parallel-safe]`
- 0.3 Add `tests/` runner: Node tests for pure modules (`window-manager-core`, `path-resolver`, `events`, validators) + a browser smoke page that boots the shell and asserts `ProfileReady`/`VirtualFSReady`. `[parallel-safe]`
- 0.4 Add `?debug=1` overlay printing every service's `diagnostics()`. `[parallel-safe]`
- 0.5 Remove or archive `desktop-concept.html`, `_preview.html`, and decide fate of `desktop-shell.html` vs `index.html` (human decides; log in DECISIONS.md).
- 0.6 Replace hardcoded `r3d1` identities with profile-derived values (G11).
**Exit:** fresh clone opens, smoke test green, one command runs all unit tests, no hardcoded user.

### Phase 1: Kernel-lite (non-breaking)
- 1.1 `kernel/platform/` (clock, errors, logger, idb helper). `OsError` + code registry.
- 1.2 `kernel/events.js` with alias bridges from VFS/profile/system/site events.
- 1.3 Extract `security/` from `system-config.js` (users, permissions, audit) keeping `SystemConfig` API as a facade.
- 1.4 `kernel/process-table.js` + `proc.*` syscalls. Hook `AppRegistry.launch/close` so every window gets a PID (no behavior change).
- 1.5 `kernel/syscalls.js` with `fs.*`, `proc.*`, `sys.*` wrapping existing services.
- 1.6 `kernel/service-manager.js`: replace hand-ordered script load with declared dependencies for new services.
**Exit:** every open window has a PID visible via `Kernel.proc.list()`; `Kernel.syscall(ctx,'fs.read',...)` works and is permission-checked; legacy apps unchanged.

### Phase 2: One truth for storage and shells
- 2.1 **Wire Terminal to the real VFS via syscalls** (kills G3). Keep its command UX; swap its data source. Remove the fake `vfs` object.
- 2.2 Path dialect adapters + mount table + `/tmp`, `/dev`, `/proc` virtual filesystems (G6).
- 2.3 VFS schema v2: `uid/gid/mode`, timestamps. Migration + fixtures.
- 2.4 Split shells: `cmd`, `powershell`, `bash` as separate L6 apps sharing a command-engine library (parser, pipes, redirection, env expansion, job control).
- 2.5 Explorer and Terminal both use `fs.watch`; creating a file in one shows instantly in the other (acceptance test).
**Exit:** `echo hi > a.txt` in bash makes `a.txt` appear in Explorer; `ls /proc` lists live PIDs; `dir` and `ls` agree.

### Phase 3: App platform
- 3.1 App manifests + `OSApps.register` + loader; adapter for legacy `RetroApps` (G4). Migrate Calculator first as the reference app.
- 3.2 Capability grants at spawn; denied capability -> `CAPABILITY_DENIED`, visible in audit log.
- 3.3 Task Manager app (reads process table). Settings app (reads/writes via `sys.settings`).
- 3.4 Break the monolith: extract desktop/taskbar/start-menu/notifications from `index.html` into `shell/` modules one at a time; each extraction is a single reviewable PR (G5).
- 3.5 "Installer" flow (fictional): install app packages from VFS `.pkg` JSON into `kernel-db`.
**Exit:** all first-party apps launch through manifests; `index.html` < 200 lines; new app = one folder + zero core edits.

### Phase 4: Session, multi-user, power states
- 4.1 `su`/`sudo`/UAC elevation as fictional, audited prompts.
- 4.2 Autostart, scheduled tasks (`cron`/Task Scheduler), background services.
- 4.3 Sleep/hibernate (snapshot process table + windows), restart, shutdown, safe mode.
- 4.4 Boot menu, BIOS/UEFI fiction screen driven by real boot log.
**Exit:** restart really tears down and re-runs boot; hibernate restores exact windows and process state.

### Phase 5: Immersion pass and advanced features
- Virtual network, fake internet, email/chat clients; package manager (`apt`/`winget`) over the virtual net.
- Process memory/CPU simulation tuned; crash dialogs, event viewer, `dmesg`.
- In-OS AI agents as **sandboxed processes** (Part 12).
- Theming engine, window effects, sound packs, wallpaper engine.
- Multi-window-manager personalities (floating, tiling) via `WindowManagerCore` layouts.

---

## 9. TASK CARDS (how to hand work to any agent)

Every task given to an agent uses this template. Write one file per task in `docs/tasks/NNN-title.md`.

```md
# TASK NNN: <imperative title>
Tier: A (needs design judgment) | B (clear spec) | C (mechanical)
Layer: L1..L7
Phase: 0..5
Owner folder(s): <exact paths you may edit>
Do NOT touch: <exact paths>
Depends on: <task ids or "none">

## Goal (1-3 sentences)
## Inputs (files to read first)
## Contract (exact function signatures / events / data shapes)
## Steps (numbered, small)
## Acceptance tests (copy-pasteable checks; each must be pass/fail)
## Rollback (how to undo)
```

### 9.1 Tier guide

| Tier | Examples | Who | Guardrails |
|---|---|---|---|
| **A** | Syscall layer design, process table, VFS schema v2, boot sequencing, security model, event bridge | Strongest agents only | Must write a short design note in `DECISIONS.md` *before* coding; must add tests; must not modify more than one layer without human sign-off. |
| **B** | Wire Terminal to syscalls, Task Manager app, mount table, manifest loader, Settings app | Mid-tier | Follow contract exactly; tests required; may only edit listed folders. |
| **C** | Rename files, add docs, add unit tests for pure functions, write wallpapers/content JSON, CSS polish, fix typos, add diagnostics() | Any agent | No logic changes in core folders. If a fix needs logic, stop and open an OPEN_QUESTION. |

### 9.2 Instructions for weaker agents (read twice)

- Only edit files named in your task card. If you believe another file must change, **stop and ask**.
- Do not "clean up" code you were not asked to touch. Do not reformat files. Do not rename things.
- Never invent an API. If you need a function that does not exist, check `diagnostics()` and the README of the folder; if still missing, ask.
- Never delete a file. Move it to `/_archive/` and note it in CHANGELOG.
- Never remove a `?v=` cache-bust or reorder `<script>` tags.
- Copy contracts verbatim. Do not "improve" signatures.
- Add or update a test for any logic you change. If you can't write a test, say so in the PR note.
- When done, fill the **Definition of Done** checklist (Part 10) in your final message. Unchecked items = not done.

### 9.3 Instructions for strong agents

- You may split or restructure within your layer, but publish the plan first (DECISIONS.md) and keep backward-compatible shims for at least one phase.
- Prefer adapters over edits: wrap `window.VFS` rather than modifying `filesystem-service.js`, until Phase 2 says otherwise.
- Be skeptical of this document. If you find a wrong claim, fix the doc in the same PR and note it in CHANGELOG.
- You are responsible for making weaker agents' lives easy: leave behind READMEs, typed JSDoc, and small examples.

---

## 10. DEFINITION OF DONE (paste this checklist in every final message)

```
[ ] Only edited files allowed by the task card
[ ] No new globals except the one service export
[ ] No DOM access from L0-L4 code
[ ] No new localStorage keys; persistence via owning service
[ ] Any persisted shape change has schemaVersion bump + migration + fixture test
[ ] Errors use OsError/FsError with a registry code
[ ] Events follow domain:verb-noun and include the standard payload
[ ] diagnostics() added/updated and returns plain JSON
[ ] Unit tests added/updated; `npm test` (or tests/run.html) is green
[ ] Smoke test passes: lock screen -> login -> Explorer + Terminal open
[ ] Profile switch test: no data from profile A visible in profile B
[ ] ?v= cache-bust bumped on changed script tags
[ ] README of the touched folder updated
[ ] CHANGELOG.md line added; DECISIONS.md updated if a design choice was made
[ ] Mobile layout not regressed (or explicitly marked desktop-only)
```

---

## 11. MULTI-AGENT COORDINATION

### 11.1 Ownership

`docs/ownership.md` maps each folder to one **owner** (an agent role or the human). Only the owner merges changes in that folder; others submit patches. Suggested starting map:

| Folder | Owner role |
|---|---|
| `kernel/`, `security/` | Architect agent (Tier A) |
| `fs/`, `profile/` | Storage agent (Tier A/B) |
| `shell/` | Shell agent (Tier B) |
| `apps/<id>/` | App agent per app (Tier B/C) |
| `immersion/` | Polish agent (Tier C/B) |
| `tests/`, `docs/` | Anyone; Tier C friendly |

### 11.2 Handoff protocol

When an agent stops (end of session, limit hit, or blocked), it must leave:
1. `docs/HANDOFF.md` entry: what was done, what is half-done, exact next step, files touched, how to run the check.
2. Repo in a runnable state (Rule 15). Half-finished work goes behind a flag (`Kernel.flags.<name>`), default off.
3. Any unanswered question in `OPEN_QUESTIONS.md` with the file/line that prompted it.

### 11.3 Conflict avoidance

- Small commits, one task per commit, message format: `[L3][P1.4] process table: add spawn/kill`.
- Never edit the same file as another active task. Check `HANDOFF.md` "in progress" list first.
- `index.html` is a hot file until Phase 3 finishes. Only touch it to add/bump script tags or to extract code (move-only commits).
- Append-only logs (`CHANGELOG.md`, `DECISIONS.md`): add at the bottom with date and task id.

### 11.4 DECISIONS.md entry format

```md
## 2026-11-03 | D-014 | Syscall context object
Context: ...
Options: A) ... B) ...
Decision: ...
Consequences: ...
Owner: <agent/human>
```

---

## 12. AI AGENTS *INSIDE* THE OS (future, designed for now)

Since agents will also live in the simulated world, reserve the shape now so we don't retrofit it:

- An in-OS agent is a **process** (`kind: 'service'`), spawned with explicit capabilities, subject to the same syscalls, permissions, and audit as any app. No back doors.
- Agents see the OS only through syscalls and events. Their window is a normal app window.
- All agent actions are written to the audit log with `actor: 'agent:<id>'`.
- **Model-calling is a host capability**, off by default, routed through one gateway service with rate limits and a visible indicator. Agent output is untrusted data: render as text, never as HTML/JS.
- Agents may *propose* actions (e.g. "delete these files") that go through a confirmation dialog for destructive syscalls.
- Observability: because everything flows through the event bus and audit log, an external "dev agent" can read `Kernel.diagnostics()` and the event log to debug the OS. Keep both stable and well-documented.

---

## 13. TESTING STRATEGY

| Level | What | Tool | Notes |
|---|---|---|---|
| Unit (Node) | Pure logic: path resolver, validators, `WindowManagerCore`, event bridge, command parser, permission engine | plain Node `assert` / `node --test` (no deps) | Each pure file ends with the guarded `module.exports`. |
| Integration (browser) | VFS + profiles + syscalls on real IndexedDB | A `tests/run.html` page, or Playwright if the human agrees to a dev dependency | Reset IndexedDB per test. Test mode disables simulated latency. |
| Smoke | Boot to desktop, open apps, create/rename/delete file, switch profile | One scripted run | Must stay under 30 s. Required before any merge. |
| Golden diagnostics | `diagnostics()` snapshots for known states | JSON fixtures | Detects accidental shape changes. |
| Migration fixtures | A saved DB/state from every historical schema version | JSON in `tests/fixtures/` | Every migration replays all fixtures. |

Test mode switch: `?test=1` sets `Kernel.clock` deterministic, disables latency/animations, and seeds a known profile.

---

## 14. THINGS THAT ARE EXPLICITLY OUT OF SCOPE (for now)

- Real hardware emulation (x86 emulator, real Linux boot). Possibly a future *app* (v86), never the kernel.
- Server-side backend. The project stays static-hostable.
- Real internet access by default.
- Multiplayer/shared worlds. Only revisit after Phase 5; the event bus and per-profile isolation make it possible later.

---

## 15. GLOSSARY

- **Principal:** a user or group identity used for permission checks (`owner`, `guest`, later `root`).
- **Capability:** a named permission an app requests in its manifest (e.g. `fs.write:user`).
- **Personality:** a Windows-like or Linux-like presentation (paths, shells, messages) over the same kernel.
- **Syscall:** the only sanctioned way for L6 code to reach L1-L3.
- **Shim / adapter:** thin wrapper keeping old API names working while implementation moves.
- **Move-only commit:** a commit that relocates files with zero behavior change.
- **Alias bridge:** code that re-emits a legacy event under its canonical name (and vice versa) so old listeners keep working.

---

## 16. FIRST 10 ACTIONS FOR WHOEVER READS THIS NEXT

1. Ask the human for the **unflattened repo tree** (G10).
2. Create `docs/` files from Part 4 and move this file to `docs/OS_FOUNDATION.md`.
3. Add the unit-test runner and the smoke page (Phase 0.3).
4. Add `?debug=1` diagnostics overlay (Phase 0.4).
5. Remove hardcoded `r3d1` (Phase 0.6).
6. Write `kernel/platform/errors.js` and the code registry (Phase 1.1).
7. Write `kernel/events.js` with alias bridges (Phase 1.2).
8. Prototype `process-table.js` and hook `AppRegistry` (Phase 1.4).
9. Write a design note for the syscall context object (Tier A, DECISIONS.md).
10. Wire Terminal to the real VFS (Phase 2.1). This single task proves the whole architecture.

---

*End of foundation spec. Version 1. Update this file when reality changes; a stale spec is worse than none.*
