# PHASE 3 — SHOT 3 MISSION & CONTEXT (FOR WEB LLM)

## Current Status (Post-Drop-in v2)
- **Phase 3.1, 3.2, 3.3, 3.5 are COMPLETE and verified:**
  - Automated test suites: `node tests/phase3-kernel.test.js` (16 passed) & `node tests/phase3-packages.test.js` (9 passed) — **all 25 tests pass**.
  - Reference apps: `notepad`, `task-manager`, `settings`, `calculator` (migrated to manifest in `main/apps/calculator/`).
  - Kernel subsystems: `process-table.js`, `syscalls.js`, `kernel-db.js`, `packages.js`, `app-registry.js`.
  - Installed `.pkg` package installer is fully operational and validated via `samples/hello.pkg`.
  - Script tags in `main/index.html` were updated and the legacy `calculator.js` was cleanly removed.

---

## The Remaining Mission: Phase 3.4 (Shell Extraction) & Window Seam

### 1. Goal
Break the 6,379-line monolith in [`main/index.html`](file:///d:/GitRepo/x1rid.github.io/main/index.html) down to an clean, readable skeleton (< 200 lines) by extracting the inline scripts into `main/shell/`:
- `main/shell/desktop.js` (desktop grid, canvas, icon management, wallpaper)
- `main/shell/start-menu.js` (start menu, programs menu, search logic)
- `main/shell/notifications.js` (toast manager & system flyouts)
- `main/shell/window-host.js` (real window manager adapter wiring `AppRegistry.configure({ windowFactory })` to `registerWindow`)

### 2. Available Files in `phase3/shot3/`
For your convenience (in case total file size or token limits require chunking):
- `phase3/shot3/index.html` (the complete file)
- `phase3/shot3/index-html.zip` (compressed zip of index.html, ~43 KB)
- **Chunked sections:**
  - `index-chunk1-head.html` (lines 1–2581: styles and header `<script>` tags)
  - `index-chunk2-body-dom.html` (lines 2582–3093: body DOM markup + vendored scripts)
  - `index-chunk3-shell-core.js` (lines 3094–4200: main shell startup, clippy, window manager core, window creation logic)
  - `index-chunk4-shell-apps.js` (lines 4201–5300: program apps, dialogs, media player, Explorer & Terminal bindings)
  - `index-chunk5-shell-tail.js` (lines 5301–6378: taskbar, start menu, shortcuts, app registry configuration, boot finish)

### 3. Architecture Rules to Maintain
1. Do not break boot order or the `window.ProfileReady` lifecycle.
2. Apps must render into their window's `win.root` via `windowFactory`.
3. Dispatch `os:apps-changed` to automatically trigger start-menu and desktop re-renders when manifest apps arrive.
