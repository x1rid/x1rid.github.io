THIRD-PARTY ATTRIBUTION — Retro Browser
===========================================
Source repositories inspected (not fully merged):

1. chrome-tabs (https://github.com/adamschwartz/chrome-tabs) — MIT
   Original files: css/chrome-tabs.css, js/chrome-tabs.js
   Reused: tab shape/active styling concepts; drag-to-reorder behavior reproduced with native HTML5 DnD
   Modified: independent adapter; no Draggabilly dependency imported
   License text preserved in attribution; MIT applies to original

2. Win10-WebSimulator (https://github.com/Vanshfr69/Win10-WebSimulator) — reference only
   Original file: js/apps/chrome.js
   Reused: address-bar parsing, iframe lifecycle, loading indicator patterns adapted
   Modified: extracted behavior into retro-browser adapter; no window-manager/taskbar code imported

3. Reframe (https://github.com/klotzbrocken/Reframe) — MIT
   Original files: src/renderer/styles/base.css, theme loader, theme CSS
   Reused: design ideas for toolbar proportions, IE-style bevels, status-bar, bookmark bar, theme separation
   Modified: CSS reconstructed using project variables; no Electron/React/TypeScript imported
   Note: Electron/Chromium engine not compatible with GitHub Pages

4. Cool 95 (https://github.com/timskap/cool95) — MIT
   Original files: app/browser.js, main.js
   Reused: bookmark/history organization concepts; context-menu patterns referenced
   Modified: implemented via existing profile/storage services; no Electron download APIs

No large files copied unmodified. All reused code is isolated in adapter or design reference.
No framework or build system added solely for reuse.
