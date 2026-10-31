# Phase 3 drop-in (3.1 + 3.2 + 3.3)

Folder layout mirrors your repo, so unzipping at the repo root merges everything into `main/`.

| File | Action | Phase |
|---|---|---|
| `main/app-registry.js` | **replaces** existing | 3.1 manifest loader, `OSApps.register`, RetroApps bridge, caps at spawn |
| `main/kernel/process-table.js` | **replaces** existing | 3.2 caps, SIGTERM veto-once, crash/zombie, reaper |
| `main/kernel/syscalls.js` | **replaces** existing | 3.2 capability checks + audit, 3.3 settings/clipboard/sys.info, net stubs |
| `main/apps/index.json` | new | app discovery list |
| `main/apps/notepad/*` | new | reference manifest app |
| `main/apps/task-manager/*` | new | 3.3 |
| `main/apps/settings/*` | new | 3.3 |
| `tests/phase3-kernel.test.js` | new | 16 Node tests (all green on my side) |

## Import steps

1. `git status` clean? If not, commit or stash first.
2. `git checkout -b phase3-app-platform`
3. Unzip into the repo root, allow overwrite (it overwrites exactly 3 files).
4. `git diff --stat` should show 3 modified files + new `main/apps/...` folders.
5. Run the tests: `node tests/phase3-kernel.test.js` (expect `16 tests passed`).
6. **Serve the folder, don't double-click index.html.** Manifests load with `fetch`, which browsers block on `file://`.
   `cd main && python -m http.server 8000` then open http://localhost:8000
   (file:// escape hatch: define `window.OSManifests.<id>` and `window.OSAppList` before the registry loads.)
7. Smoke test: lock screen, then Explorer + Terminal still work (legacy apps).
8. Browser console checks:
   ```js
   AppRegistry.list().map(a => a.id + (a.legacy ? ' (legacy)' : ''))   // notepad, task-manager, settings appear
   AppRegistry.launch('notepad'); AppRegistry.launch('task-manager');
   KernelSyscalls.auditLog()                                           // denials/sensitive calls
   ```
9. Commit.

## Things you need to know (read this one)

- **Window creation seam.** I couldn't see your shell's window manager. Manifest apps get windows from
  `AppRegistry.configure({ windowFactory(opts) -> win })`. `win` needs `{ id, root, closed, onClose, close() }`
  (optional: `node`, `setTitle()`, `focus()`). Without it, a basic draggable floating window is used so apps still run.
  Hook up your real shell factory and the apps render inside your normal windows.
- **Start menu / desktop icons.** Apps load async. If the start menu renders before they arrive, re-render on the
  `os:apps-changed` DOM event (fired on every register/unregister).
- **Legacy apps get caps `['*']`** so nothing breaks until each is migrated. Manifest apps get exactly what they declare.
  Manifests may not request wildcards.
- **Default-deny is real now.** Anything calling `KernelProcessTable.spawn()` without `caps` gets `[]`. Anything calling
  `Kernel.syscall()` with a pid that has no matching cap gets `CAPABILITY_DENIED`. Calls with `ctx == null` or `pid 1`
  are treated as kernel-trusted. Debug switch: `KernelSyscalls.setCapabilityMode('audit')` logs would-be denials but allows them.
- **`OsError` codes.** Add `CAPABILITY_DENIED` to your OsError code list if it isn't there yet (I couldn't see that file).
- **New L2 calls skipped.** `sys.info`, `sys.clipboard.*`, `sys.settings.*`, `net.*` are gated by caps only, since I don't
  know your `SecurityPermissions` rules and default-deny there would reject them. Add L2 rules later, then remove them
  from `CAP_ONLY_CALLS`.
- **SIGTERM veto direction.** PHASE3.md contradicts itself ("return true to allow exit" vs the contract's
  `async () => true // veto exit once`). I followed the contract and the existing code: **returning `true` vetoes, once**.
  Closing the last window always ends the process (the window is already gone); vetoes apply to explicit signals like Task Manager's End task.
- **Settings persistence** is localStorage (`os.settings.<uid>`) until `kernel-db`/`profile-db` exist (3.5).
- `fs.read:user` is not path-scoped yet. It's a cap name only, no `/c/Users/<you>` confinement.
- One window per process for now; repeat `proc.win.open()` returns the same window.

## NOT included (I didn't have the source files)

- **Calculator migration** (needs `main/apps/calculator.js`). Recipe: create `main/apps/calculator/manifest.json`
  (copy Notepad's, set id/name/caps), move the UI into `main.js` using `proc.win.open()` + `win.root`, delete the old
  inline `AppRegistry.register({id:'calculator'...})`, add `"calculator"` to `apps/index.json`. Send me the file and I'll do it.
- **3.4 `index.html` extraction** (needs `index.html`, plus PHASE3 says do it only after 3.1-3.3 are green).
- **3.5 installer / `kernel-db`.** Audit already calls `KernelDB.append('audit', entry)` when that object exists, so it plugs in later.
- **RetroApps:** the bridge only adds `register/launch/list/has` if missing and never overwrites. Check it against your real object.

## Adding a new app after this (zero core edits)

1. `main/apps/<id>/manifest.json` + `main.js` (+ optional `styles.css`)
2. Add `"<id>"` to `main/apps/index.json`
3. Reload.
