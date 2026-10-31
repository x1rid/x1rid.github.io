# Task 013 — Phase 4: Session & Power Management

> **Branch:** `phase4-session-power`
> **Status:** ✅ Complete
> **Tests:** 408 passed, 1 pre-existing failure (`syscalls.test.js` — untouched)

---

## Overview

Phase 4 adds fictional-but-realistic OS session management features: UAC-style elevation, autostart/scheduling, sleep/hibernate/power, and a BIOS/boot-menu immersion layer.

---

## 4.1 — Elevation Service (`sec.elevate`)

| File | Role |
|------|------|
| `main/security/elevation.js` | `window.ElevationService` — request/revoke/check elevation |
| `main/shell/elevation-dialog.js` | `window.ElevationDialog` — UAC modal (DOM only) |
| `main/kernel/syscalls.js` | Added `sec.elevate` handler + CAP_REQUIRED entry |

**Behaviour:**
- `ElevationService.request(pid, reason)` emits `elevation:request-pending`, shows UAC dialog in browser or auto-grants/denies in Node (`ELEVATION_AUTO_GRANT=1` env var)
- On grant: records to `SecurityAudit`, emits `elevation:request-approved`, stores `pid→token` in an in-memory Set
- On deny: emits `elevation:request-denied`
- `revoke(token)` removes elevation; `isElevated(pid)` checks current state
- Token format: `elev-XXXXXXXX-XXXXXXXX` (no external deps)

**Tests:** `tests/elevation.test.js` — 6 tests ✅

---

## 4.2 — Autostart + Scheduler

| File | Role |
|------|------|
| `main/kernel/autostart.js` | `window.AutostartService` — register/unregister/list/run |
| `main/kernel/scheduler.js` | `window.KernelScheduler` — schedule/cancel/list with cron/interval/at |

**Autostart:**
- Entries persisted in `KernelDB` store `autostart_entries` (schemaVersion 1, keyPath `id`)
- Falls back to in-memory map when `KernelDB` unavailable (Node tests)
- `run()` called by `shell/boot.js` after `ProfileReady`; launches via `AppRegistry.launch()` or emits `autostart:launch-skipped`
- Supports `delay` (ms) and `once` (remove after first run)

**Scheduler:**
- Tasks persisted in `KernelDB` store `scheduled_tasks` (schemaVersion 1, keyPath `id`)
- Supports `{ interval: ms }`, `{ at: ISOdate }`, `{ cron: '*/N * * * *' }` (simple parser, no deps)
- In Node: registers task definitions but does not fire timers
- Live handles tracked in a `Map` for `cancel()`

**Tests:** `tests/autostart.test.js` — 6 tests ✅

---

## 4.3 — Power Service

| File | Role |
|------|------|
| `main/kernel/power.js` | `window.PowerService` — sleep/hibernate/restore/restart/shutdown/safeMode |
| `main/shell/power-overlay.js` | Full-screen black sleep overlay, responds to KernelEvents |

**States:** `running` → `sleeping` → `running` (wake) | `hibernating` | `shutdown`

**Hibernate snapshot** (stored in `KernelDB` store `hibernate_snapshot`, keyPath `id`):
```json
{ "id": "current", "schemaVersion": 1, "ts": "ISO", "processes": [...], "windows": {...} }
```

- `sleep()` waits for `wakeFromSleep()` (called by overlay on any key/click)
- `hibernate()` snapshots `KernelProcessTable.list()` + `ProfileWindowState.snapshotActive()`
- `restore()` calls `ProfileWindowState.importAll()`, deletes snapshot, returns `bool`
- `restart()` → `location.reload()` (no-op in Node)
- `safeMode()` → `location.assign(...?safe=1)` (no-op in Node)

**`ProfileWindowState` additions:**
- `exportAll()` — returns active bridge snapshot (for hibernate)
- `importAll(data)` — merges into `ProfileState.windows` (for restore)

**Tests:** `tests/power.test.js` — 7 tests ✅

---

## 4.4 — BIOS + Boot Menu Fiction

| File | Role |
|------|------|
| `main/immersion/bios.js` | `window.BiosScreen` — POST screen with 80ms typewriter effect |
| `main/immersion/boot-menu.js` | `window.BootMenuScreen` — arrow-key boot entry selector |

**Trigger:** URL contains `?bios=1` or `?restoring=hibernate` → `BiosScreen.show()` called before `ProfileReady` resolves (top of `boot.js`)

**BIOS keys:** F2 (fictional no-op), F8 → `BootMenuScreen`, any other key → continue boot

**Boot entries:** `Windows (default)`, `Linux personality`, `Safe mode`
- `Safe mode` → `PowerService.safeMode()` → `?safe=1`

---

## KernelDB Changes

`DB_VERSION` bumped from 1 → 2. Migration 2 adds three new stores:

| Store | keyPath | Purpose |
|-------|---------|---------|
| `autostart_entries` | `id` | Autostart app registrations |
| `scheduled_tasks` | `id` | Scheduler task definitions |
| `hibernate_snapshot` | `id` | Single hibernate state snapshot |

---

## Syscall Additions

| Call | Cap | Handler |
|------|-----|---------|
| `sec.elevate` | `null` (open) | Calls `ElevationService.request()` |
| `power.sleep` | `null` | Calls `PowerService.sleep()` |
| `power.hibernate` | `null` | Calls `PowerService.hibernate()` |
| `power.restart` | `null` | Calls `PowerService.restart()` |
| `power.shutdown` | `null` | Calls `PowerService.shutdown()` |
| `power.state` | `null` | Returns `{ state }` |

All new calls are added to `CAP_ONLY_CALLS` (skip L2 SecurityPermissions check).

---

## Event Inventory

| Event | Emitter |
|-------|---------|
| `elevation:request-pending` | `ElevationService` |
| `elevation:request-approved` | `ElevationService` |
| `elevation:request-denied` | `ElevationService` |
| `elevation:revoked` | `ElevationService` |
| `autostart:entry-registered` | `AutostartService` |
| `autostart:entry-removed` | `AutostartService` |
| `autostart:run-started` | `AutostartService` |
| `autostart:app-launched` | `AutostartService` |
| `autostart:launch-skipped` | `AutostartService` |
| `scheduler:task-registered` | `KernelScheduler` |
| `scheduler:task-fired` | `KernelScheduler` |
| `scheduler:task-cancelled` | `KernelScheduler` |
| `power:sleep-started` | `PowerService` |
| `power:sleep-ended` | `PowerService` |
| `power:hibernate-started` | `PowerService` |
| `power:hibernate-restored` | `PowerService` |
| `power:restart-initiated` | `PowerService` |
| `power:shutdown` | `PowerService` |

---

## Files Changed / Created

```
main/security/elevation.js          NEW — ElevationService
main/shell/elevation-dialog.js      NEW — UAC dialog DOM
main/kernel/autostart.js            NEW — AutostartService
main/kernel/scheduler.js            NEW — KernelScheduler
main/kernel/power.js                NEW — PowerService
main/shell/power-overlay.js         NEW — Sleep overlay DOM
main/immersion/bios.js              NEW — BiosScreen (new dir)
main/immersion/boot-menu.js         NEW — BootMenuScreen
main/kernel/kernel-db.js            EDIT — DB v2, 3 new stores
main/kernel/syscalls.js             EDIT — sec.elevate + power.* handlers + CAP_ONLY_CALLS
main/shell/boot.js                  EDIT — BiosScreen, PowerService.restore(), AutostartService.run()
main/profile/window-state.js        EDIT — exportAll() + importAll()
main/index.html                     EDIT — 7 new <script> tags
tests/elevation.test.js             NEW — 6 tests
tests/autostart.test.js             NEW — 6 tests
tests/power.test.js                 NEW — 7 tests
docs/tasks/013-phase4-plan.md       NEW — this document
```
