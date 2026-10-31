# PHASE 3 — APP PLATFORM (single-page master for Web LLM)

## What Phase 3 builds

| # | What | Edit this file |
|---|---|---|
| 3.1 | App manifest loader + `OSApps.register`; adapter `RetroApps`; migrate Calculator first | `main/app-registry.js` |
| 3.2 | Capability grants at spawn; denied → `CAPABILITY_DENIED`; audit in syscalls | `main/kernel/syscalls.js`, `main/kernel/process-table.js` |
| 3.3 | **Task Manager** reads process table; **Settings** uses `sys.*` settings syscall | `main/kernel/process-table.js` |
| 3.4 | Break `index.html` monolith: extract desktop/taskbar/start-menu/notifications → `shell/` (one PR each) | `main/index.html`, create `main/shell/` |
| 3.5 | Installer: `.pkg` JSON in VFS → `kernel-db` (new DB for installed apps / audit) | `main/kernel/syscalls.js` |

**Exit:** first-party apps via manifests; `index.html` < 200 lines; new app = folder + manifest, zero core edits.

---

## Contracts (copy-paste ready)

### Process record (Task Manager needs this)
```js
{ pid, ppid:1, appId, kind:'app'|'service', name, uid:'owner', state, exitCode:null,
  startedAt, cwd, env, windows:['win-12'], caps:['vfs:read:user'],
  stats:{cpuTicks,memBytes,syscalls} }
```
Phase 3: `caps` set at `proc.spawn`; crash → `zombie` + emit `proc:crashed`; `SIGTERM` veto once.

### App manifest (`manifest.json`)
```json
{"manifestVersion":1,"id":"notepad","name":"Notepad","version":"1.0.0","kind":"app","entry":"main.js","styles":["styles.css"],"icon":"assets/icon.svg","multiple":true,"fileTypes":["txt"],"capabilities":["fs.read:user","fs.write:user","sys.clipboard"],"window":{"width":640,"height":420,"resizable":true},"personality":["windows","linux"]}
```
Entry (`main.js`):
```js
window.OSApps.register('notepad', {
  async main(proc, args) {
    const win = await proc.win.open({ title: 'Notepad' });
    // ONLY touch win.root; never document.body
    proc.onSignal('SIGTERM', async () => true); // veto exit once
  }
});
```

### Syscall (`syscalls.js`)
`const r = await Kernel.syscall(ctx, 'fs.read', {path})` — `ctx={pid,uid,caps}`; validate args → L2 permission (default-deny) → dispatch → audit → emit event → return `{ok:true,value}` or throw `OsError`.
Initial v1 groups: `fs.*` (stat,list,read,write,create,mkdir,remove,move,copy,watch,resolve,mount,umount), `proc.*` (spawn,kill,list,info,signal,wait,setEnv), `win.*`, `ipc.*`, `sys.*` (time,info,log,notify,clipboard.get/set,settings.get/set), `sec.*`.

### Events (Phase 3 emit these)
`domain:verb-noun`; payload has `{type, profileId, emittedAt, sequence, pid?, ...}`.
Mappings: `proc:spawned`, `proc:exited`, `win:opened`, `proc:crashed`, `proc:signal`, `fs:file-saved`, `sys:notification`, `sys:settings-changed`.
Legacy aliases: `site:applaunch`→`proc:spawned`, `site:appopen`→`win:opened`, `site:appclose`→`proc:exited`.

### Errors
`new OsError('CAPABILITY_DENIED', 'Capability denied', {cap,pid})` — codes: `CAPABILITY_DENIED`, `ENOENT`, `EACCES`, `EPERM`, `ESRCH`, `EINVAL`, `EBUSY`, `PROFILE_LOCKED`, `SCHEMA_MISMATCH`.

### Paths / personalities (3.4)
Canonical internal = node id + POSIX string (`/c/Users/Rid/Documents/a.txt`). Adapters translate to Windows (`C:\...`) and POSIX (`/home/rid/...`). Case-insensitive Windows, case-sensitive POSIX (`mount` flag). `..` never escapes mount root.

### Persistence (3.5)
DBs: `vfs-db:<profile.dbName>` (L1 files), `profile-db` (L4 session), `kernel-db` (L3 new — process logs / installed apps / audit). Every shape needs `schemaVersion`, migration, fixture test.

---

## Edit targets (exact files + lines to change)

### File 1: `main/app-registry.js` (src: `phase3/SRC-app-registry.md`)
Purpose: 3.1 manifest loader, capability adapter, `OSApps.register`
- `normalizeDefinition()` → read `manifest.json` fields (`manifestVersion`, `kind`, `capabilities`, `window`)
- `register()` → if `manifest.json` exists in `apps/<id>/`, load it instead of inline def
- `launch()` → pass `caps: definition.capabilities || []` to `KernelProcessTable.spawn()` (line 252 area)
- Add adapter keeping `RetroApps` working (`window.RetroApps` stays in `index.html`; don't break it)
- Migrate `main/apps/calculator.js` first as reference manifest + `main.js`
- Don't touch: `index.html` yet (wait for 3.4)

### File 2: `main/kernel/process-table.js` (src: `phase3/SRC-process-table.md`)
Purpose: 3.2 capability grants, 3.3 Task Manager
- `spawn(spec)` → add `caps: spec.caps || []` to record; emit audit event
- Record shape → add `caps` array, `stats` tracking
- `_signalHandlers` → register `SIGTERM`; veto once (return `true` to allow exit, else stay `running`)
- `get(pid)` / `list()` → return full record with `stats`
- `detachWindow()` / close → emit `proc:exited`; if uncaught error → `proc:crashed`, state = `zombie`
- Don't touch: `profile/` DB logic (caps are per-process, not profile state)

### File 3: `main/kernel/syscalls.js` (src: `phase3/SRC-syscalls.md`)
Purpose: 3.2 capability checks, 3.5 installer
- Every `SYSCALL_HANDLERS` call → validate `ctx.caps` against requested capability (e.g. `fs.write` needs `fs.write:user`); deny → throw `new OsError('CAPABILITY_DENIED', ...)`
- `sys.settings.get()` / `sys.settings.set()` → new handlers (3.3 Settings app)
- `sys.clipboard.get()` / `sys.clipboard.set()` → new handlers
- `proc.spawn` / `proc.kill` / `proc.info` → present; add `proc.list` filter
- `net.*` → stub group (simulated network only, never real host)
- Audit: every denied syscall writes to `kernel-db` audit table
- `sys.info` → include process count, total memory (from `KernelProcessTable` stats)
- Don't touch: `system-services.js` directly (syscalls wrap it, don't replace it)

### File 4: `main/index.html` (src: master reference only — 3.4 after 3.1–3.3 green)
Purpose: 3.4 monolith break (one PR per extraction)
- Extract desktop/taskbar inline code → `main/shell/desktop.js`
- Extract start-menu inline code → `main/shell/start-menu.js`
- Extract notifications UI code → `main/shell/notifications.js`
- Target: `index.html` < 200 lines
- Don't touch: `main/desktop-shell.html` (separate file; sync via git only, no duplicate edits)

### File 5: `main/apps/` (new folders)
Purpose: 3.1 manifest migration, 3.3 apps
Create (reference pattern from `main/apps/calculator.js`):
- `main/apps/notepad/manifest.json`
- `main/apps/notepad/main.js`
- `main/apps/task-manager/manifest.json` (3.3 — reads process table via `sys.info` / `proc.list`)
- `main/apps/settings/manifest.json` (3.3 — uses `sys.settings.get` / `.set`)
- Don't touch: `main/app-registry.js` core logic without testing `proc.spawn` first

---

## Order / dependencies

```
3.1 (manifest + adapter)  →  3.2 (caps + audit)  →  3.3 (Task Manager + Settings apps)
       ↓                                                      ↓
3.5 (installer .pkg → kernel-db)  ←  3.4 (shell extraction from index.html)
```

Always: edit file → run smoke test (`open index.html` → lock screen → Explorer + Terminal) → commit. Never break the boot sequence.
