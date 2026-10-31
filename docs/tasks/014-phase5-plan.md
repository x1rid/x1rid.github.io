# TASK 014: Phase 5 — Immersion Pass and Advanced Features
Tier: A (design judgment required across multiple layers)
Layer: L1–L6
Phase: 5
Owner folder(s): main/kernel/, main/shell/, main/apps/, main/immersion/, main/security/, tests/
Do NOT touch: tests/syscalls.test.js (pre-existing failure), main/fs/, main/profile/ (unless adding exportAll/importAll stubs only)
Depends on: 013-phase4-plan (Phase 4 complete)

## Goal
Implement the full Phase 5 immersion pass: virtual network, fake internet, email/chat apps, process resource simulation, crash dialogs, event viewer, theming engine, sound packs, and multi-WM personalities.

**Exit criterion (from OS_FOUNDATION.md):** Virtual net active, package manager commands work, crash dialogs appear, event viewer shows audit log, theming switches OS skin, tiling WM layout available.

---

## Sub-milestones

### 5.1 — Virtual Network + Fake Internet
**Files:**
- `main/kernel/net-service.js` → `window.NetService`
  - Simulated network stack: `NetService.request(url, opts)` → fake HTTP response
  - Internal routing table: `localhost`, `r3dos.internal`, `store.r3dos.internal`
  - `net.request` syscall wired (replaces EPERM stub)
  - Events: `net:request-sent`, `net:response-received`, `net:offline`
- `main/kernel/fake-internet.js` → `window.FakeInternet`
  - JSON-driven fake sites: `data/fake-sites.json`
  - `FakeInternet.register(host, handler)` for custom routes
  - Built-in routes: `/` index, `/404`, `/ping`
  - `apt` / `winget` package endpoints: `store.r3dos.internal/packages`
- `data/fake-sites.json` — static content for built-in fake pages

### 5.2 — Email + Chat Apps
**Files:**
- `main/apps/mail/` — manifest app: compose, inbox (fake SMTP over NetService)
  - `manifest.json`, `app.js`, `app.css`
  - Capabilities: `net.request`, `fs.write:user`, `sys.notify`
- `main/apps/chat/` — manifest app: IRC-style chat rooms (fake WebSocket over NetService)
  - `manifest.json`, `app.js`, `app.css`
  - Capabilities: `net.request`, `sys.notify`
- `main/kernel/mail-service.js` → `window.MailService`
  - In-memory mailbox per profile; persists to KernelDB `mailbox` store
  - `send(to, subject, body)`, `list()`, `read(id)`
- Add `mailbox` and `chat_messages` KernelDB stores (DB_VERSION 3)
- Add entries to `main/apps/index.json`

### 5.3 — Process Resource Simulation + Crash + Event Viewer
**Files:**
- `main/kernel/resource-sim.js` → `window.ResourceSim`
  - Assigns fake CPU% and RAM to each PID on spawn (from process-table events)
  - `tick()` called by KernelScheduler every 2s: jitters values ±2%
  - Crash simulation: `ResourceSim.crash(pid, reason)` → kills process, emits `process:crashed`
  - `ResourceSim.list()` → `[{ pid, cpu, ram, crashed }]`
- `main/shell/crash-dialog.js` — DOM: shows Windows-style crash dialog on `process:crashed` event
- `main/apps/event-viewer/` — manifest app: shows `KernelDB` audit log + kernel events
  - `manifest.json`, `app.js`, `app.css`
  - Cap: `fs.read:user`, `sys.info`
- `main/apps/dmesg/` — manifest app: streams KernelEvents in real time
  - `manifest.json`, `app.js`, `app.css`
  - Cap: `sys.info`
- Add `event-viewer` and `dmesg` to `main/apps/index.json`

### 5.4 — Theming Engine + Sound Packs
**Files:**
- `main/kernel/theme-service.js` → `window.ThemeService`
  - `apply(themeId)` → swaps CSS custom properties on `:root`
  - `list()` → built-in themes: `default`, `dark`, `hacker`, `win95`, `macos`
  - Persists chosen theme to KernelDB `user_prefs` store; applies on boot
  - Events: `theme:changed`
  - `sys.theme.get` / `sys.theme.set` syscalls
- `main/themes/` — one JSON per theme defining CSS variable overrides
  - `default.json`, `dark.json`, `hacker.json`, `win95.json`, `macos.json`
- `main/kernel/sound-service.js` → `window.SoundService`
  - `play(eventName)` → maps event name to audio file (if exists, else no-op)
  - `setPack(packId)` — active sound pack
  - Events: `sound:pack-changed`
  - `sys.sound.play` syscall
- Sound packs defined in `data/sound-packs.json`
- Wire ThemeService into Settings app (add a Themes tab)

### 5.5 — Multi-WM Personalities (Floating + Tiling)
**Files:**
- `main/kernel/wm-layout.js` → `window.WMLayout`
  - `register(id, layoutFn)` — registers a layout strategy
  - `setLayout(id)` — switches active layout, emits `wm:layout-changed`
  - `list()` → layout ids
  - Built-in: `floating` (current behavior), `tiling` (columns), `stacked` (maximized, z-based)
- Tiling layout: when a window opens, auto-tile all windows in even columns
- `sys.wm.setLayout` syscall
- Wire into Settings app (add WM Layout tab)

---

## Acceptance Tests
- `node tests/net-service.test.js` → ≥5 pass
- `node tests/resource-sim.test.js` → ≥5 pass
- `node tests/theme-service.test.js` → ≥5 pass
- `node tests/run-tests.js` → total ≥ 440 pass, same 1 failure
- Smoke: lock screen → login → open Chat → send message → open Event Viewer → see audit log

## Rollback
```
git checkout main
```
All Phase 5 changes are additive (new files + new script tags). No existing file logic is removed.

---

*Created: 2026-10-31 | Phase 5 start*
