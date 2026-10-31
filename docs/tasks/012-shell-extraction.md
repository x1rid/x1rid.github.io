# Task 012 — Phase 3.4: Shell extraction + window seam

**Branch:** phase3-app-platform-v2

## What changed
- `main/index.html` no longer holds the shell. The 3,280-line inline `ProfileReady.then(...)` closure, the
  RetroApps registry, the vendored 98.js program table and the 2,500-line `<style>` block moved to
  `main/shell/`.
- Classic scripts share one global lexical scope, so the old closure's ~86 shared bindings stay shared.
  Runtime statements were wrapped in `shellInit_*` functions; `shell/boot.js` calls them in the exact
  original order after `window.ProfileReady`.
- New `shellWindowFactory` (window-host.js) + `AppRegistry.configure({ windowFactory })` (apps.js): manifest
  apps render into `win.root` of a real shell window (taskbar button, drag/resize, snap, persistence).
- `os:apps-changed` now re-renders Start results, program tiles, and calls `DesktopEnvironment.refresh()` if present.
- Start results render image icons (manifest apps use icon URLs) instead of printing the URL.

## File map
| file | contents |
|---|---|
| state.js | DOM refs, window map, state vars, helpers |
| notifications.js | toast |
| desktop.js | Clippy, wallpaper, clock, show-desktop, tray |
| window-host.js | window manager, openers, **shellWindowFactory** |
| programs.js | programs shelf, context menu, openProgram |
| music.js / terminal-host.js | music player / terminal host |
| start-menu.js | search, Start wiring, os:apps-changed |
| apps.js | AppRegistry registrations + configure |
| host-bridge.js | `window.DesktopShellHost` (shape unchanged) |
| shortcuts-host.js | shortcuts, window cycling |
| boot.js | ProfileReady boot sequence (**must load last**) |
| retro-apps.js, vendor-programs.js, shell.css | previously inline |

## Verify
`node tests/shell-split.test.js` and `node tests/run-tests.js`.
