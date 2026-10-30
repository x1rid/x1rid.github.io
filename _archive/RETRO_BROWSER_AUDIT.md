RETRO BROWSER INTEGRATION AUDIT
================================
Date: 2026-10-22
Project: x1rid.github.io desktop simulator

1. EXISTING ARCHITECTURE
------------------------
- Entry point: index.html (shell + embedded apps)
- App registry: main/app-registry.js (register/launch/attachWindow/detachWindow)
- Window manager: main/window-manager.js / window-manager-core.js
- Existing browser file: main/chrome.js (page chrome/status rail, NOT a browser)
- Profile/persistence: main/profile/profile-service.js, profile-db.js, window-state.js
- Settings/services: main/system-services.js, system-config.js
- Shortcuts/events: main/shortcuts.js, main/context-menu.js
- CSS: main/css/variables.css, main/apps.css, main/window-manager.css
- Icons: main/vendor/98/images/icons/ (internet-explorer icons available)
- No existing tab-strip/browser-app registered in app registry
- Window container receives DOM node; app launches via definition.launch(context, options)

2. CURRENT BROWSER
------------------
- None implemented as an app. main/chrome.js is page-status chrome only.
- No tab management, no iframe navigation, no address bar, no bookmarks/history.
- Desktop icon for browser missing from registry.
- No browser-specific persistence layer exists; will use profile service.

3. CHROME TABS (adamschwartz/chrome-tabs)
------------------------------------------
- License: MIT (LICENSE.txt)
- Key files: css/chrome-tabs.css, js/chrome-tabs.js, demo/index.html
- Dependency: Draggabilly (drag-and-drop)
- Reusable: tab shape/overlap CSS, active/inactive styling, tab creation/close events, drag reorder logic
- NOT reusable as-is: entire demo page; dependency chain needs adaptation
- Integration: implement adapter that renders tabs from our state; emit actions to browser adapter
- Direct code reuse target: ~30-50% of tab CSS + drag behavior adapted

4. WIN10-WEBSIMULATOR (Vanshfr69/Win10-WebSimulator)
-----------------------------------------------------
- License: not explicitly stated in README; treat as reference only
- Browser file: js/apps/chrome.js (multi-tab iframe browser)
- Reusable concepts: address-bar URL parsing, search query handling, back/forward, reload/stop, new-tab page, loading indicators, per-tab iframe
- NOT reusable directly: tightly coupled to its windowManager.js/taskbar.js; uses its own app registry
- Direct reuse target: ~20-30% behavioral logic adapted to our adapter
- Critical note: its back/forward state must be tested against actual iframe navigation, not just URL updates

5. REFRAME (klotzbrocken/Reframe)
----------------------------------
- License: MIT (LICENSE)
- Key files: src/renderer/styles/base.css, src/renderer/theme/loader.ts, src/renderer/public/themes/*/theme.css
- Architecture: Electron + React + TypeScript; incompatible with GitHub Pages
- Direct reuse: ~0-10% (CSS design ideas only: toolbar proportions, IE-style bevels, status bar, bookmark bar, menus)
- No Electron/Chromium engine code can be imported
- Theme separation model (manifest.json + theme.css + CSS vars) is a design reference only

6. COOL 95 (timskap/cool95)
---------------------------
- License: MIT (package.json / README)
- Key files: app/browser.js, main.js
- Features: bookmarks, history, downloads, context menus, find-in-page, zoom, session restore
- Incompatible: Electron APIs, native download APIs, unrestricted page inspection
- Direct reuse: ~0-10% isolated concepts (bookmark management structure, history storage pattern)
- Must implement via existing profile services, not Electron APIs

7. INTEGRATION RISKS
--------------------
- Drag-and-drop dependency (Draggabilly) may conflict with our draggable.js / window-manager drag
- Tab state must be owned by browser app, not by tab component
- Iframe embedding blocked by X-Frame-Options/CSP on many sites; need honest blocked-state UI
- Profile persistence may fail silently; must handle storage quota errors
- Theme switching must not recreate tabs or lose state
- Existing window-manager resize/minimize/maximize/close must continue to work
- No duplicate global listeners; clean up on window close
- Security: never execute user text as JS; sanitize URLs; only allow http/https schemes

8. PROPOSED CHANGES
-------------------
ADD:
  - main/retro-browser.js (browser adapter, tab state, navigation)
  - main/retro-browser.css (Chrome 2010 + IE8/9 themes)
  - main/apps/retro-browser.js (app definition / launch)
  - main/retro-browser-attribution.md (reuse record + licenses)
  - Tests: tests/retro-browser.test.js (stage tests)

MODIFY:
  - index.html: add browser script references, desktop icon slot (optional)
  - main/app-registry.js: register browser definition (if not auto-registered by apps file)
  - main/apps.css: add browser-specific utilities if needed

LEAVE UNTOUCHED:
  - main/window-manager.js, window-manager-core.js
  - main/app-registry.js core logic (only add registration)
  - profile services, system services, shortcuts
  - Existing chrome.js (page chrome) — does not conflict

STAGES (sequential):
  1. Browser shell (toolbar, tab strip, address bar, page area, bookmark bar, status)
  2. Tab behavior (new/activate/close, drag reorder, active styling, new-tab page)
  3. Navigation (URL/search, back/forward, reload/stop, loading feedback, blocked iframe fallback)
  4. New-tab page (search, quick links, recently visited)
  5. Bookmarks (add/edit/remove, bookmark bar, persistence via profile)
  6. History (record, filter, open, remove, clear, private session)
  7. Downloads (honest fallback for same-origin; report limitation for cross-origin)
  8. Menus/shortcuts (browser menu, zoom if feasible, theme select, keyboard shortcuts)
  9. Settings/theme (Chrome 2010 + IE8/9, home page, search engine, bookmark bar toggle, private session)
  10. Integration/polish (window manager, resize, profile isolation, listener cleanup)

REUSE RECORD (preliminary):
- chrome-tabs CSS patterns: adapted for tab overlap/shape; drag behavior reproduced with native HTML5 DnD to avoid Draggabilly dependency conflict
- Win10 chrome.js concepts: address-bar parsing, iframe lifecycle, loading indicator reproduced against our adapter
- Reframe design: toolbar spacing, bevel styling, status-bar layout adapted to existing CSS variables
- Cool 95: bookmark/history data structures inspired by its app organization; not copied directly

All reused code will preserve original licenses and attribution.
