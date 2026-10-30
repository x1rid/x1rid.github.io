/**
 * Retro Browser App — registered with AppRegistry AND RetroApps
 * Follows calculator pattern: mount(root, api) fills root; manager builds window.
 */
(function () {
  'use strict';

  const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="width:16px;height:16px;"><circle cx="12" cy="12" r="10" fill="#2a5bb5"/><path d="M12 4v8l5 3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;

  function mount(root, api) {
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.height = '100%';
    root.style.overflow = 'hidden';
    root.style.background = '#dde3ea';
    root.innerHTML = `
      <div id="retro-browser-container" class="retro-browser theme-chrome-2010" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
        <div class="rb-titlebar">
          <div class="rb-icon">IE</div>
          <div class="rb-title-text">Internet Explorer</div>
          <div class="rb-window-controls">
            <button class="rb-win-btn" onclick="api.close()" title="Close">×</button>
          </div>
        </div>
        <div class="rb-tab-strip" id="retro-tab-strip"></div>
        <div class="rb-toolbar">
          <button class="rb-btn" onclick="window.RetroBrowser.goBack()" title="Back" aria-label="Back">◀</button>
          <button class="rb-btn" onclick="window.RetroBrowser.goForward()" title="Forward" aria-label="Forward">▶</button>
          <button class="rb-btn" onclick="window.RetroBrowser.reload()" title="Refresh" aria-label="Refresh">↻</button>
          <button class="rb-btn" onclick="window.RetroBrowser.stop()" title="Stop" aria-label="Stop">■</button>
          <button class="rb-btn" onclick="window.RetroBrowser.navigate('https://example.com')" title="Home" aria-label="Home">⌂</button>
          <span class="rb-sep"></span>
          <div class="rb-address-row" style="flex:1;display:flex;align-items:center;gap:6px;padding:0 8px;height:26px;background:#f0f4fa;border-bottom:1px solid #a0aab8;">
            <div class="rb-address-bar" style="flex:1;height:22px;display:flex;align-items:center;gap:6px;padding:0 8px;background:#fff;border:1px solid #a0aab8;border-radius:2px;box-shadow:inset 1px 1px 0 rgba(0,0,0,0.08);">
              <input id="retro-address-bar" type="text" value="https://example.com" onkeydown="if(event.key==='Enter'){window.RetroBrowser.navigate(this.value);event.preventDefault();}" style="flex:1;border:none;outline:none;background:transparent;font-size:12px;color:#1a2430;font-family:inherit;" />
            </div>
            <button class="rb-star-btn" onclick="alert('Bookmark star clicked (demo)')" title="Bookmark" aria-label="Bookmark">★</button>
          </div>
        </div>
        <div class="rb-bookmark-bar" id="retro-bookmark-bar"></div>
        <div class="rb-page-area" id="retro-page-area">
          <div id="retro-page-frame" style="width:100%;height:100%;overflow:hidden;"></div>
        </div>
        <div class="rb-status-bar" id="retro-status-bar">
          <span class="rb-status-cell" id="retro-status-text">Ready</span>
          <span class="rb-status-cell" style="margin-left:auto;">Internet Explorer</span>
        </div>
      </div>
    `;
    setTimeout(() => {
      if (window.RetroBrowser && typeof window.RetroBrowser.init === 'function') {
        window.RetroBrowser.init();
      }
      window.RetroBrowser.renderTabs();
      window.RetroBrowser.renderPage();
    }, 60);
    return function cleanup() {
      // Adapter keeps state; no destructive cleanup needed here
    };
  }

  // RetroApps registration (shows in desktop launcher / start search)
  if (window.RetroApps) {
    window.RetroApps.register({
      id: 'retro-browser',
      name: 'Internet Explorer',
      tagline: 'Retro web browser — Chrome 2010 / IE8-9',
      meta: 'Browser • Multi-tab • Bookmarks • History',
      icon: ICON,
      mount: mount,
    });
  }

  // AppRegistry registration (for window-manager integration and close behavior)
  if (window.AppRegistry && typeof window.AppRegistry.register === 'function') {
    window.AppRegistry.register({
      id: 'retro-browser',
      name: 'Internet Explorer',
      tagline: 'Retro web browser — Chrome 2010 / IE8-9',
      meta: 'Browser • Multi-tab • Bookmarks • History',
      icon: '🌐',
      source: 'IN-HOUSE',
      kind: 'app',
      multiple: true,
      frame: true,
      fileTypes: ['htm', 'html', 'url'],
      launch: function (context, options) {
        // Launch via RetroApps (manager creates window); also attach via registry for tracking
        if (window.RetroApps && typeof window.RetroApps.open === 'function') {
          window.RetroApps.open('retro-browser');
        }
        // Return a minimal window descriptor for registry compatibility
        const dummy = document.createElement('div');
        dummy.id = 'win-retro-browser-' + Date.now();
        dummy.style.display = 'none';
        document.body.appendChild(dummy);
        setTimeout(() => {
          if (window.AppRegistry && typeof window.AppRegistry.attachWindow === 'function') {
            window.AppRegistry.attachWindow('retro-browser', dummy, { windowId: dummy.id });
          }
        }, 10);
        return dummy;
      },
      focus: function () {},
      minimize: function () {},
      restore: function () {},
      close: function () {}
    });
  }
})();
