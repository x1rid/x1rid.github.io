# PHASE 3 — APP PLATFORM: MASTER SPECIFICATION & INSTRUCTIONS (SHOT 2)

This document condenses all specifications, kernel architectural requirements from OS Foundations, implementation source references, import instructions, and delivery status for Phase 3 (App Platform).

---

## 1. Executive Summary & Status

Phase 3 transitions the OS from ad-hoc window spawning to a managed application platform with process lifecycles, capability-based security, standard manifests, system settings, and task administration.

### Phase Status Overview

| Phase | Milestone | Status | Notes |
|---|---|---|---|
| **3.1** | **Manifest Loader & App Registry** | **Complete** (Reference app: Notepad ready; RetroApps bridge active) | Manifest loader, async discovery, validator, `OSApps.register`, capability inheritance at spawn. |
| **3.2** | **Kernel Capabilities & Process Table** | **Complete** (16/16 tests passing) | Default-deny capability checking, audit logging, SIGTERM veto once, zombie/crash tracking, window-death reaping. |
| **3.3** | **Task Manager & Settings Apps** | **Complete** | `main/apps/task-manager` and `main/apps/settings` built as manifest apps. |
| **3.4** | **Shell Monolith Extraction** | **Pending** | Splitting inline `main/index.html` into `main/shell/` (`desktop.js`, `start-menu.js`, `notifications.js`). |
| **3.5** | **Installer & `kernel-db`** | **Pending** | `.pkg` format support, VFS package installer, IndexedDB `kernel-db` persistence. |

---

## 2. Core Architectural Rules (From OS Foundation)

All code in Phase 3 must strictly comply with the OS Foundation Golden Rules:

1. **No build step:** Plain `<script>` tags, vanilla ES6/ES2020 JavaScript, no bundlers, no npm runtime dependencies. Node `module.exports` guards are permitted only for unit test suites.
2. **Layering & Downward Calls Only:**
   - **L7 Immersion:** Boot, lock screen, widgets, themes.
   - **L6 Applications:** Notepad, Task Manager, Settings, Calculator, Terminal, Explorer.
   - **L5 Shell:** Window manager, taskbar, start menu, desktop, notifications UI.
   - **L4 Session:** Profiles, login/lock, per-user state.
   - **L3 Kernel:** Process table, scheduler, syscalls, event bus, signals.
   - **L2 Security:** Users/groups, capability validation (default-deny), audit logging.
   - **L1 Storage:** VFS, IndexedDB content/node stores, path resolver, migrations.
   - **L0 Platform:** System clock, error primitives, IndexedDB wrapper.
3. **Services Never Touch the DOM:** Only Apps (inside their allocated window root) and the Shell touch DOM elements.
4. **Structured Errors:** Always throw `OsError` / `FsError` objects with `{ code, message, detail }`. Standard codes: `CAPABILITY_DENIED`, `ENOENT`, `EACCES`, `EPERM`, `ESRCH`, `EINVAL`, `EBUSY`, `PROFILE_LOCKED`, `SCHEMA_MISMATCH`.
5. **Event Vocabulary:** Strictly follow `domain:verb-noun` (e.g. `proc:spawned`, `proc:exited`, `proc:crashed`, `win:opened`, `sys:settings-changed`, `os:apps-changed`). Payloads must include `{ type, profileId, emittedAt, sequence, ... }`.
6. **Sandboxed Simulation:** Completely sandboxed from real host filesystems and host networks. Simulated network and virtual filesystem only.
7. **Default-Deny Capabilities:** Apps request capabilities in `manifest.json`. Calling `proc.spawn` defaults to empty capabilities (`[]`). Unprivileged processes cannot escalate or grant caps they do not own.

---

## 3. Key Contracts

### 3.1 Process Record
```js
{
  pid: 10,
  ppid: 1,
  appId: "notepad",
  kind: "app", // 'app' | 'service'
  name: "Notepad",
  uid: "owner",
  state: "running", // 'running' | 'sleeping' | 'stopped' | 'zombie'
  exitCode: null,
  startedAt: 1710000000000,
  cwd: "C:\\Users\\Owner",
  env: {},
  windows: ["win-1"],
  caps: ["fs.read:user", "fs.write:user", "sys.clipboard"],
  stats: {
    cpuTicks: 0,
    memBytes: 1048576,
    syscalls: 4
  }
}
```

### 3.2 App Manifest (`apps/<id>/manifest.json`)
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
  "capabilities": [
    "fs.read:user",
    "fs.write:user",
    "sys.clipboard"
  ],
  "window": {
    "width": 640,
    "height": 420,
    "resizable": true
  },
  "personality": ["windows", "linux"]
}
```

### 3.3 App Entry (`apps/<id>/main.js`)
```javascript
window.OSApps.register('notepad', {
  async main(proc, args) {
    const win = await proc.win.open({ title: 'Notepad' });
    // ONLY touch win.root; never document.body
    
    // SIGTERM veto handler (veto exit once, returning true delays exit)
    proc.onSignal('SIGTERM', async () => true);
  }
});
```

### 3.4 Syscall Invocation
```javascript
const result = await Kernel.syscall(ctx, 'fs.read', { path: 'C:\\Users\\Owner\\notes.txt' });
// ctx = { pid, uid, caps }
```

---

## 4. Import & Verification Instructions

### 4.1 Quick Import Steps
1. Verify git cleanliness:
   ```bash
   git status
   ```
2. Checkout target branch:
   ```bash
   git checkout -b phase3-app-platform
   ```
3. Extract `phase3-drop-in.zip` over repository root (replaces 3 core files):
   - `main/app-registry.js`
   - `main/kernel/process-table.js`
   - `main/kernel/syscalls.js`
   - Creates `main/apps/index.json`, `main/apps/notepad/*`, `main/apps/task-manager/*`, `main/apps/settings/*`
   - Adds `tests/phase3-kernel.test.js`
4. Verify changes:
   ```bash
   git diff --stat
   ```
5. Run automated test suite:
   ```bash
   node tests/phase3-kernel.test.js
   # Expect: 16 tests passed
   ```
6. Serve locally:
   ```bash
   cd main && python -m http.server 8000
   ```
   *Note: Open via HTTP (http://localhost:8000). Do not open via `file://` because browser CORS blocks manifest `fetch` calls.*

### 4.2 Browser Verification Steps
In the browser developer console:
```javascript
// 1. Verify app registry discovery
AppRegistry.list().map(a => a.id + (a.legacy ? ' (legacy)' : ''));
// Should include notepad, task-manager, settings, and legacy apps

// 2. Launch new manifest apps
AppRegistry.launch('notepad');
AppRegistry.launch('task-manager');
AppRegistry.launch('settings');

// 3. Inspect audit log
KernelSyscalls.auditLog();
```

---

## 5. Critical Implementation Notes & Gotchas

1. **Window Creation Seam:**
   Manifest applications obtain windows via `AppRegistry.configure({ windowFactory(opts) -> win })`.
   The window instance must implement `{ id, root, closed, onClose, close() }` (optional: `setTitle()`, `focus()`). If no shell windowFactory is bound, AppRegistry provides a basic draggable floating container.
2. **Start Menu & Desktop Synchronization:**
   App manifests load asynchronously. Re-render start menu / desktop icon lists upon receiving the DOM event `os:apps-changed`.
3. **Legacy App Compatibility:**
   Legacy apps (from `window.RetroApps` or inline registrations) automatically receive `caps: ['*']` so existing Explorer, Terminal, and games continue operating without modification.
4. **Default-Deny Execution:**
   Calls to `KernelProcessTable.spawn()` without explicit `caps` receive `[]`. Calling `Kernel.syscall()` with a pid missing the required cap throws `CAPABILITY_DENIED` and logs to the audit table. Kernel calls (`pid: 1` or `ctx: null`) are trusted.
5. **SIGTERM Veto Behavior:**
   Returning `true` in a `SIGTERM` handler vetoes exit once. The next signal or closing the last window forces termination.
6. **Settings Persistence:**
   Settings are currently stored in `localStorage` under `os.settings.<uid>` until `kernel-db` / `profile-db` (3.5) is fully integrated.

---

## 6. Guide: Migrating Legacy Apps (e.g. Calculator)

To migrate an existing legacy app (like `main/apps/calculator.js`) to the Phase 3 manifest architecture without core edits:

1. Create folder `main/apps/calculator/`.
2. Create `main/apps/calculator/manifest.json`:
   ```json
   {
     "manifestVersion": 1,
     "id": "calculator",
     "name": "Calculator",
     "version": "1.0.0",
     "kind": "app",
     "entry": "main.js",
     "styles": ["styles.css"],
     "icon": "assets/icon.svg",
     "multiple": false,
     "capabilities": [],
     "window": { "width": 320, "height": 400, "resizable": false },
     "personality": ["windows"]
   }
   ```
3. Create `main/apps/calculator/main.js`:
   Move UI construction into `window.OSApps.register('calculator', { async main(proc) { const win = await proc.win.open({ title: 'Calculator' }); /* Render into win.root */ } })`.
4. Add `"calculator"` to `main/apps/index.json`.
5. Remove the legacy registration from `main/apps/calculator.js`.
