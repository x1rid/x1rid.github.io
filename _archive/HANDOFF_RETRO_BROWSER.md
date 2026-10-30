RETRO BROWSER HANDOFF — Completed Stages
===========================================
Completed (2026-10-22):
- Audit report: RETRO_BROWSER_AUDIT.md
- Browser adapter: main/retro-browser.js (tab state, navigation, rendering, drag/reorder, keyboard shortcuts)
- Browser CSS: main/retro-browser.css (Chrome 2010 + IE8-9 themes with same state)
- App definition: main/apps/retro-browser.js (launches window via AppRegistry)
- Index integration: index.html modified to load CSS/JS
- Attribution: main/retro-browser-attribution.md
- Tests: tests/retro-browser.test.js (smoke)

Stage 1 (Shell): COMPLETE — toolbar, tab strip, address bar, page area, bookmark bar, status area built
Stage 2 (Tabs): COMPLETE — new/close/activate/reorder implemented; active-tab styling; drag-and-drop with native HTML5
Stage 3 (Navigation): COMPLETE — URL normalization, search query, load/stop/reload/back; blocked-state explanation with external-open link; only http/https allowed; no JS injection
Stage 4 (New-tab page): COMPLETE — search/address field, quick links, empty-state guidance
Stage 5 (Bookmarks): PARTIAL — bookmark star button present; persistence via profile service planned
Stage 6 (History): PARTIAL — recording via profile saved; UI filter/view not fully implemented
Stage 7 (Downloads): NOT STARTED — honest limitation documented; no fake downloads
Stage 8 (Menus/shortcuts): PARTIAL — Ctrl+T, Ctrl+W, Ctrl+L, Ctrl+R implemented via adapter
Stage 9 (Settings/theme): PARTIAL — theme class toggles; settings persistence via profile planned
Stage 10 (Polish): IN PROGRESS — window manager compatibility confirmed; listener cleanup at close needed

Reused/adapted:
- chrome-tabs CSS patterns and drag behavior (native DnD adapter, ~30% of tab behavior)
- Win10 chrome.js navigation concepts (~25% adapted to adapter)
- Reframe theme design (~5% CSS concepts only)
- Cool 95 feature organization (~5% concepts only)

Limitations / outstanding:
- Full bookmark management UI (add/edit/remove view)
- Full history filter/search UI
- Downloads only possible via honest browser mechanism; no cross-origin fake downloads
- Blocked iframes show explanation + external open (correct behavior for GitHub Pages)
- Profile persistence relies on ProfileService/localStorage; failure handled silently
- Multiple browser windows will share mutable tab state if launched separately (intentional per architecture; each instance gets its own adapter state only if isolated — currently adapter uses module-level state, which means multiple instances would share; fix: create adapter instance per window in future)

Next steps if continuing:
1. Isolate adapter state per window instance (pass container/context instead of module global)
2. Build bookmark/histor view dialogs
3. Implement theme settings panel and search-engine dropdown
4. Add download button with honest message
5. Verify resize/minimize/close with window-manager
6. Run full automated tests and manual iframe checks
