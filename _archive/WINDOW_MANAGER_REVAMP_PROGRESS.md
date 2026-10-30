# Window manager revamp — progress notes

Last updated: 2026-10-22

## Goal

Add Windows 11–style snapping and Linux-inspired tiling, workspaces, overview,
layout presets, Snap Assist, linked resizing, snap groups, per-app rules, and
customizable shortcuts without replacing the shell's existing window lifecycle,
taskbar, or per-profile persistence.

## Architecture

The original inline window manager in `index.html` / `main/index.html` still
owns window DOM, focus, z-order, taskbar buttons, open/close, and persistence.
The revamp is layered on top through a small bridge:

- `main/window-manager-core.js` — pure functions: work area, layout presets,
  snap-intent detection, clamping, resize/linked-resize, auto-grid, captured
  layouts, shortcut defaults, and sanitization of persisted WM state. Runs in
  Node.
- `main/window-manager.js` — DOM integration exposed as `window.ShellWM`:
  previews, drag/resize delegation, snap/maximize, Snap Assist, layout chooser,
  linked dividers, workspaces, overview, tiling, app rules, shortcuts, reduced
  motion, diagnostics, and restore.
- `main/window-manager.css` — preview, assist, chooser, overview, divider,
  workspace, and reduced-motion styles.
- `main/profile/window-state.js` / `main/profile/persistence-service.js` —
  window records now carry `workspace`, `alwaysOnTop`, `tiling`,
  `userOverride`, and `snap` (`layout`, `zone`, `groupId`, `bounds`,
  `floating`) plus top-level `windowManager` state. Schema version is 4.

Snapped windows use a reduced minimum of 160×120 so three-column and quadrant
layouts can tile narrow windows; free resize still uses each app's real
minimum. The inline `setBounds()` accepts optional per-call limits so the bridge
can pass those snap constraints without mutating the app's minimum.

## Changed files

New:

- `main/window-manager-core.js`
- `main/window-manager.js`
- `main/window-manager.css`
- `tests/window-manager.test.js`
- `WINDOW_MANAGER_REVAMP_PROGRESS.md`

Modified:

- `index.html` (primary shell: tags, work area, `setBounds` limits, drag/resize
  delegation, restore hook, taskbar workspace filtering, desktop-resize hook,
  `ShellWM.init`, WM snapshot persistence)
- `main/index.html` (same shell edits)
- `main/desktop-shell.html` (synced byte-for-byte from `main/index.html`)
- `main/profile/persistence-service.js` (schema v4 + WM validation)
- `main/profile/window-state.js` (WM fields + `getWMState`)
- `README.md` (window manager overview and defaults)

Unrelated existing working-tree changes (lock-screen v2) were preserved and are
not part of this revamp.

## Fixed during acceptance

- Sequential left/right snaps now adopt an existing adjacent snap group, so
  linked dividers appear.
- Snap bounds no longer get re-clamped to the app's floating minimum by the
  inline `setBounds()`; this previously shifted the right half to `x=380` with
  `width=420` on an 800px desktop.
- Persisted snapped groups restore with the same group id and exact shared edge.
- Moving a snapped window into a zone already occupied by its group now starts
  a new group instead of creating two members in one zone.
- `Ctrl+Alt+L` for the layout chooser collided with the shell lock shortcut.
  The default is now `Ctrl+Alt+K`; persisted old values migrate automatically.
- Tiling eligibility no longer rejects every window just because its
  `tiling` flag starts `false`.
- Auto-grid tiling works: `applySnap()` accepts the generated descriptor
  instead of trying to look up an unregistered `auto-grid` id.
- Per-app rules now key Programs by window id (`program-calculator`) instead of
  the shared `program` app id.
- Restoring a minimized window re-applies tiling when tiling is enabled.
- Double-clicking a snapped titlebar (or pressing maximize) maximizes the tile;
  restoring returns to the same snap zone/group in the current session.
- Overview's reduce-motion switch, rules, layout chooser, always-on-top, and
  custom-layout capture were exercised in the browser.

## Verification

- `node tests/window-manager.test.js` — **81 passed, 0 failed**
- `node tests/lock-screen-logic.test.js` — **42 passed, 0 failed**
- Inline root scripts pass `node --check`.
- Browser smoke test (`http://127.0.0.1:5500/`):
  - `ShellWM.ready`, 18 `wm.*` shortcuts, no shortcut conflicts.
  - Half snap previews match final bounds; divider appears; drag-to-snap and
    drag-away-from-snap work.
  - Linked divider drag resized both windows and kept a shared edge.
  - Snap Assist listed remaining zones/windows and placed a candidate into the
    same group.
  - Persistence reload restored group id, shared edge, workspaces, tiling,
    rules, reduce-motion, and shortcuts.
  - Workspace switching hides other desktops' windows and taskbar buttons;
    moving a window between desktops updates visibility.
  - Overview opens/closes, lists windows, renames desktops, and exposes layout,
    rules, shortcut, and reduce-motion controls.
  - Layout chooser applied a thirds zone; always-on-top changed z-index.
  - Free resize respected the app minimum (300×440 for Calculator).
  - Closing a snapped window removed it and kept the remaining divider valid.
  - `/main/index.html` and `/main/desktop-shell.html` both load the stylesheet
    and module with 18 shortcuts and no conflicts.

## Remaining work / caveats

- Desktop-resize acceptance was not run with a real viewport resize (the
  browser harness has no resize tool); `Core` work-area tests and
  `ShellWM.onDesktopResize()` logic cover the recompute path.
- Browser interaction was exercised with synthetic pointer/keyboard events, not
  physical mouse/trackpad input.
- Per-app rule application to a **newly opened** Programs window was checked by
  code path and state, not by launching a fresh Calculator after the rule fix.
- Snap groups use any unoccupied zone in the same layout as an adjacency
  heuristic; non-touching zones in one layout can share a group, though
  dividers only render where bounds actually touch.
- Existing persisted window state from development sessions may contain old
  group ids or old shortcut defaults; sanitization tolerates both. No migration
  rewrites old snap-group membership.
- A snapped window that is maximized and then reloaded restores to its floating
  rectangle because the saved window record has no snap while maximized; the
  in-session restore path does return to the snap zone.
- Nothing has been committed or pushed.
