# Phase 3 drop-in v2 (3.1 – 3.3 + calculator migration + 3.5)

Paths mirror your repo. Unzip at the repo root and allow overwrite.

| File | Action |
|---|---|
| `main/app-registry.js` | **replaces** (v1 → v2: adds installed-package loading) |
| `main/kernel/syscalls.js` | **replaces** (v2: `register(..., opts)`, `holds()`) |
| `main/kernel/process-table.js` | **replaces** (same as v1) |
| `main/kernel/kernel-db.js` | **new** (3.5: IndexedDB `kernel-db`: `audit`, `installed_apps`) |
| `main/kernel/packages.js` | **new** (3.5: `.pkg` installer, `pkg.install/remove/list`) |
| `main/apps/calculator/*` | **new** (migrated from your legacy source) |
| `main/apps/{notepad,task-manager,settings}/*`, `main/apps/index.json` | new (index.json now lists calculator) |
| `samples/hello.pkg` | sample package to test the installer |
| `tests/*.test.js` | 16 + 9 Node tests |

## Import steps

1. Commit/stash, then `git checkout -b phase3-app-platform-v2`.
2. Unzip into the repo root (overwrites exactly 3 files).
3. **Script tags in `index.html`** (kernel before registry, one new line each; this is a 2-line edit, not the 3.4 extraction):
   ```html
   <script src="kernel/process-table.js"></script>
   <script src="kernel/kernel-db.js"></script>      <!-- NEW -->
   <script src="kernel/syscalls.js"></script>
   <script src="kernel/packages.js"></script>       <!-- NEW: must come after syscalls.js -->
   <script src="app-registry.js"></script>
   ```
   Keep your existing cache-buster style (`?v=YYYYMMDD`) and whatever order/paths you already use.
4. **Retire the legacy calculator:** remove its `<script src="apps/calculator.js...">` tag and delete `main/apps/calculator.js`.
   Otherwise both versions register id `calculator` and the registry ignores the new one with a "Duplicate application id" warning.
   Move the `.calc*` CSS out of wherever it currently lives (it's now in `apps/calculator/styles.css`; the `.app-hint` rule is scoped to `.calc`).
5. `node tests/phase3-kernel.test.js` (16) and `node tests/phase3-packages.test.js` (9).
6. Serve the folder (`cd main && python -m http.server 8000`), not `file://`. Manifests use `fetch`.
7. Smoke test: lock screen, Explorer, Terminal, then Calculator/Notepad/Task Manager/Settings from the start menu.
8. Installer test in the browser console (put `samples/hello.pkg` in your VFS first, e.g. via Notepad save or Explorer):
   ```js
   // ctx = null is the trusted kernel/shell path, so no caps needed from the console
   await Kernel.syscall(null, 'pkg.install', { path: 'C:\\Users\\owner\\Desktop\\hello.pkg', grant: 'all' })
   AppRegistry.launch('hello')
   await Kernel.syscall(null, 'pkg.list', {})
   await Kernel.syscall(null, 'pkg.remove', { id: 'hello' })
   await KernelDB.list('audit', { newestFirst: true, limit: 10 })
   ```
   Reload the page and `hello` should come back by itself (restored from `kernel-db`).

## How the installer behaves

- `.pkg` = JSON `{ pkgVersion:1, manifest, files:{path:text} }`; only `.js .css .svg .json .txt`, ≤64 files, ≤2 MB, no `..`/absolute/URL paths.
- `grant` is **mandatory** (`'all'` or a list). Granted ⊆ requested ⊆ what the installer itself holds. Registered caps = granted only.
- A package can never replace a built-in app id (registry guard → `EBUSY`). Re-installing a package upgrades it in place.
- Audit rows (denials + sensitive successes, incl. pkg.install/remove) now go to `kernel-db` `audit` (capped at 5000, oldest trimmed). Falls back to an in-memory store if IndexedDB is unavailable (`KernelDB.diagnostics()` tells you).
- Layering: `packages.js` (L3) never calls the registry; the registry subscribes via `addGuard/onInstalled/onRemoved`.

## Read this

- **Installed packages are NOT sandboxed.** Their JS runs in the same page realm, so caps only constrain the syscall layer; a malicious package could still touch `window`/DOM. Fine for your own simulated-world packages, not for untrusted code. (Real isolation = sandboxed iframes + postMessage; that's a bigger redesign.)
- **Not browser-tested.** Node tests cover kernel, installer logic, and the registry's loader with stubbed DOM/Blob. Real IndexedDB, real script loading and the apps' UIs haven't been run in a browser.
- Window seam, start-menu refresh on `os:apps-changed`, `CAPABILITY_DENIED` in OsError, SIGTERM-veto direction, and the legacy `['*']` caps: same notes as v1 (still apply).
- No Terminal command yet (I can't see the Terminal source). `Kernel.syscall(ctx,'pkg.install',...)` is the hook; a one-line `pkg install <path>` command can call it.

## NOT done: 3.4 (`index.html` extraction)

I only have the description, not the 6,377-line file, and it can't be done blind without breaking boot. Upload `main/index.html`
(or paste it in chunks, ideally with `desktop-shell.html` for reference) and I'll extract `shell/desktop.js`, `shell/start-menu.js`,
`shell/notifications.js` one at a time, plus wire `AppRegistry.configure({ windowFactory })` to your real window manager.
