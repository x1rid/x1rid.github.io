# Foundation Hardening Report: Baseline & Architecture Audit

> **Generated:** Phase 0 Baseline Establishment  
> **Repository:** x1rid.github.io  
> **Status:** Phase 0 Complete — Active Stabilization

---

## 1. Executive Summary

This report establishes the verified state of the x1rid.github.io desktop simulator prior to foundational hardening across filesystem, application lifecycle, profile isolation, shared services, and deployment integrity.

All prior assertions from `PHASE_0_AUDIT.md` were re-verified against the live codebase:
- **Test Baseline:** Exactly 123 tests pass (81 window manager tests + 42 lock screen tests).
- **Shell HTML Identity:** `main/index.html` and `main/desktop-shell.html` were verified byte-identical (SHA256: `0F42990E23D444EFB6388F8764B6A6C549456C890A26AE1F8B93FE576495CED0`).
- **Uncommitted User Changes:** Preserved in git status (modifications in README.md, index.html, main/profile/*, main/system-config.js).
- **Standalone `main/apps.js`:** Confirmed dead code / not referenced by `main/index.html`.
- **`main/apps/retro-browser.js`:** Confirmed not loaded by `main/index.html` (which instead uses inline registration).

---

## 2. Subsystem Ownership & Source-of-Truth

| Subsystem | Authoritative Source | Implementation Details |
|---|---|---|
| **Filesystem (VFS)** | `main/fs/filesystem-service.js` & `init.js` | In-memory `Map<string, FsNode>` synchronized with IndexedDB (`vfs-db` / `vfs-db-guest`). Exposed globally as `window.VFS`. |
| **Node / Content Stores** | `main/fs/node-store.js`, `main/fs/content-store.js` | Single IndexedDB per profile holding object stores `nodes`, `file-contents`, `recycle-bin`. |
| **Profile Metadata & Auth** | `main/profile/profile-service.js` | `ProfileService` with IndexedDB `profile-db` (v2), store `profiles`. |
| **Profile State & Persistence** | `main/profile/persistence-service.js` | `PersistenceService` with `STATE_VERSION = 4`. IndexedDB store `profile-state`. Debounced (700ms) with per-profile serialize commit queues. |
| **Window State** | `main/profile/window-state.js` | `ProfileWindowState.snapshot()` and restore routines. |
| **Window Manager** | `main/window-manager-core.js`, `main/window-manager.js` | Pure layout mathematics (`WindowManagerCore`) + desktop integration (`ShellWM`) bridge. |
| **App Registration (Display)** | `main/index.html` (inline `RetroApps`) | Programs grid & search discovery. |
| **App Lifecycle & Tracking** | `main/app-registry.js` | Singleton tracking, events, active context (`window.AppRegistry`). |
| **App Window Mounting** | `openProgram()` in `main/index.html` | Authoritative window element creation, container setup, `def.mount(body, api)` execution, and `attachWindow()`. |
| **Shared Services & Events** | `main/system-services.js` | `SystemServices.events`, clipboard, dialogs, files, notifications, settings. |
| **System Configuration** | `main/system-config.js` | Profile-scoped simulated system registry (`SystemConfig`). |

---

## 3. Confirmed Architectural Defects & Risks

### A. Lifecycle & Registry Double Cleanup / Detach Desync (Phase 2 Focus)
1. In `main/app-registry.js`, `attachWindow(appId, win)` wraps `win.onClose`:
   ```javascript
   const cleanup = typeof win.onClose === 'function' ? win.onClose : null;
   win.onClose = function() {
       ...
       if (typeof instance.cleanup === 'function') instance.cleanup();
       detachWindow(windowId, 'window-close');
   }
   ```
   However, in `main/index.html`, `openProgram()` creates a window, mounts the app (`let cleanup = def.mount(...)`), sets `win.onClose = cleanup`, and *then* calls `AppRegistry.attachWindow(def.id, win, { windowId: winId })`.
   When `closeWindow(id)` runs in `main/index.html` (line 3482):
   ```javascript
   if (typeof win.onClose === 'function') {
       win.onClose();
       win.onClose = null;
   }
   ```
   If `win.onClose` is overwritten or chained without guard, double cleanup or broken detach can occur if both paths invoke it or if `win.onClose` is set after attach.

### B. Shell HTML Drift Risk (Phase 5 Focus)
`main/index.html` and `main/desktop-shell.html` are required to be byte-identical, but there has been no automated test verifying this. An edit to one immediately violates deployment integrity unless tested.

### C. VFS Concurrency & In-Memory Desynchronization (Phase 1 Focus)
`VirtualFS` maintains `this.nodes = new Map()` in memory and writes asynchronously to `nodeStore` and `contentStore`.
1. During `createFile`, `contentStore.write()` happens first; if `nodeStore.putNode()` fails, orphan content remains.
2. In directory operations (e.g. `permanentlyDelete`), deleting nodes iterates `this.nodes.values()`. If concurrent deletes or modifications occur, partial trees can be left behind.
3. Path resolution is case-insensitive, but collision checks must remain strictly synchronized with both in-memory Map and IndexedDB store.

### D. Profile Isolation & Storage Safety (Phase 3 Focus)
1. `VFSService.open(profile)` switches `window.VFS` and assigns `fs.profileId`. If an asynchronous file operation is in-flight across profile switch, it could reference or mutate the outgoing VFS instance unless profile guards exist.
2. `PersistenceService.collectState()` inspects global DOM nodes and `localStorage`. `localStorage` keys are shared across all profiles unless namespaced, so theme/volume could bleed into guest profiles if not properly validated on load.

---

## 4. Prioritized Remediation Plan

1. **Phase 1 (Filesystem Integrity):**
   - Build automated Node/VM regression tests for `VirtualFS` checking create, read, rename, circular move, recycle bin restore, permanent delete, and error rollback.
   - Verify failure paths (e.g., node write failure after content write).

2. **Phase 2 (Lifecycle & Registry Integrity):**
   - Audit `openProgram()`, `closeWindow()`, `AppRegistry`, and `RetroApps`.
   - Prevent duplicate launcher registrations, ensure idempotent cleanup execution (cleanup called at most once), and ensure `AppRegistry.detachWindow` is always cleanly triggered on window close.

3. **Phase 3 (Profile Isolation & Persistence Safety):**
   - Ensure profile switching flushes state and prevents in-flight async contamination.
   - Verify guest vs owner storage isolation.

4. **Phase 4 (Shared Services & Event Lifecycle):**
   - Verify `SystemServices.events` listener cleanup, shortcut precedence, and config patch concurrency.

5. **Phase 5 (Shell Integrity & Deployment Checks):**
   - Add an automated test enforcing byte-identity between `main/index.html` and `main/desktop-shell.html`.
   - Validate script loading dependencies.

6. **Phase 6 (Integration Contract Readiness):**
   - Document the canonical app integration contract based on verified runtime realities.
