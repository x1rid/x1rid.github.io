# PHASE 3 — APP PLATFORM: MASTER SPECIFICATION & STATUS

This document records the completed specifications, contracts, and delivery status for Phase 3 (App Platform).

---

## 1. Executive Summary & Status

Phase 3 transitioned the OS from ad-hoc window spawning to a managed application platform with process lifecycles, capability-based security, standard manifests, system settings, package installation, and a modular shell.

### Phase Status Overview

| Phase | Milestone | Status | Details / Implemented Files |
|---|---|---|---|
| **3.1** | **Manifest Loader & App Registry** | **Complete** | `main/app-registry.js`, `main/apps/index.json`. Async discovery, validator, `OSApps.register`, capability inheritance at spawn, `RetroApps` bridge. |
| **3.2** | **Kernel Capabilities & Process Table** | **Complete** (16/16 tests passing) | `main/kernel/process-table.js`, `main/kernel/syscalls.js`. Default-deny capability checks, audit logging, SIGTERM veto once, zombie/crash tracking, window-death reaping. |
| **3.3** | **Task Manager, Settings & Calculator Apps** | **Complete** | Manifest apps built: `main/apps/notepad/`, `main/apps/task-manager/`, `main/apps/settings/`, and migrated `main/apps/calculator/`. |
| **3.4** | **Shell Monolith Extraction** | **Complete** (8/8 tests passing) | `main/index.html` reduced from 6,379 to 344 lines. Extracted into 14 modular files in `main/shell/` (`state.js`, `notifications.js`, `desktop.js`, `window-host.js`, `programs.js`, `music.js`, `terminal-host.js`, `start-menu.js`, `apps.js`, `host-bridge.js`, `shortcuts-host.js`, `boot.js`, `retro-apps.js`, `vendor-programs.js`, `shell.css`). `windowFactory` seam wired to `AppRegistry.configure`. |
| **3.5** | **Installer & `kernel-db`** | **Complete** (9/9 tests passing) | `main/kernel/kernel-db.js` (IndexedDB with memory fallback), `main/kernel/packages.js` (`pkg.install`, `pkg.remove`, `pkg.list`), validated with `samples/hello.pkg`. |

---

## 2. Test Verification

All automated tests for Phase 3 pass:
- `node tests/phase3-kernel.test.js`: **16/16 passed**
- `node tests/phase3-packages.test.js`: **9/9 passed**
- `node tests/shell-split.test.js`: **8/8 passed**
- **Total: 33/33 Phase 3 tests passed.**
