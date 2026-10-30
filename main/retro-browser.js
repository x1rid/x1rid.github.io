/**
 * Retro Browser Adapter — Chrome circa 2010 / IE8-9 inspired
 * Reuses design ideas from chrome-tabs, Win10-WebSimulator chrome.js,
 * Reframe theme concepts, and Cool 95 feature organization.
 * Owns tab state; does not replace window manager or app registry.
 * License notices preserved; no Electron/React framework imported.
 */
(function (window, document) {
  'use strict';

  // --- State owned by this adapter (not by tab component) ---
  const state = {
    tabs: [],          // {id, url, title, loading, error, history:[url], active, pinned}
    activeId: null,
    theme: 'chrome-2010', // 'chrome-2010' | 'ie8-9'
    private: false,
    bookmarks: [],
    history: [],
    searchEngine: 'https://www.google.com/search?q=',
    homeUrl: 'about:blank',
    bookmarkBarVisible: true,
    zoom: 1,
    nextId: 1
  };

  // --- Persistence via existing profile service if available ---
  function loadProfile(key, fallback) {
    try {
      if (window.ProfileService && typeof window.ProfileService.getSetting === 'function') {
        return window.ProfileService.getSetting(key) !== undefined ? window.ProfileService.getSetting(key) : fallback;
      }
      if (window.localStorage) {
        const raw = window.localStorage.getItem('retro_browser_' + key);
        if (raw != null) return JSON.parse(raw);
      }
    } catch (e) { /* silent */ }
    return fallback;
  }
  function saveProfile(key, value) {
    try {
      if (window.ProfileService && typeof window.ProfileService.setSetting === 'function') {
        window.ProfileService.setSetting(key, value);
      }
      if (window.localStorage) {
        window.localStorage.setItem('retro_browser_' + key, JSON.stringify(value));
      }
    } catch (e) { /* silent */ }
  }

  // --- Helpers ---
  function uid() { return 'tab-' + (state.nextId++) + '-' + Date.now(); }
  function normalizeUrl(input) {
    if (!input) return '';
    const s = String(input).trim();
    if (s === '') return '';
    // Block unsafe schemes
    const lower = s.toLowerCase();
    if (/^(javascript|data|vbscript|file):/i.test(s)) return '';
    // If it looks like a URL with protocol
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      if (!/^https?:/i.test(s)) return '';
      return s;
    }
    // Search query
    return state.searchEngine + encodeURIComponent(s);
  }
  function safeTitle(url) {
    try {
      const a = document.createElement('a');
      a.href = url || '';
      return a.hostname || url || 'New Tab';
    } catch (e) { return url || 'New Tab'; }
  }

  // --- Tab operations ---
  function createTab(url, opts) {
    opts = opts || {};
    const id = uid();
    const tab = {
      id,
      url: url || state.homeUrl,
      title: opts.title || safeTitle(url),
      loading: false,
      error: null,
      history: url ? [url] : [],
      active: true,
      pinned: Boolean(opts.pinned)
    };
    state.tabs.forEach(t => { t.active = false; });
    state.tabs.push(tab);
    state.activeId = id;
    renderTabs();
    renderPage();
    saveProfile('tabs', state.tabs.map(t => ({id:t.id, url:t.url, title:t.title, active:t.active})));
    return id;
  }
  function closeTab(id) {
    const idx = state.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const wasActive = state.tabs[idx].active;
    state.tabs.splice(idx, 1);
    if (state.tabs.length === 0) {
      createTab(state.homeUrl);
      return;
    }
    if (wasActive) {
      const next = state.tabs[Math.min(idx, state.tabs.length - 1)];
      state.activeId = next ? next.id : state.tabs[0].id;
      state.tabs.forEach(t => t.active = (t.id === state.activeId));
    }
    renderTabs();
    renderPage();
    saveProfile('tabs', state.tabs.map(t => ({id:t.id, url:t.url, title:t.title, active:t.active})));
  }
  function activateTab(id) {
    const tab = state.tabs.find(t => t.id === id);
    if (!tab) return;
    state.tabs.forEach(t => t.active = false);
    tab.active = true;
    state.activeId = id;
    renderTabs();
    renderPage();
  }
  function reorderTabs(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const item = state.tabs.splice(fromIndex, 1)[0];
    state.tabs.splice(toIndex, 0, item);
    renderTabs();
  }

  // --- Navigation (adapter, not engine) ---
  function navigate(url) {
    const tab = state.tabs.find(t => t.active);
    if (!tab) return;
    const normalized = normalizeUrl(url);
    if (normalized === '') {
      tab.error = 'Blocked or invalid URL';
      tab.loading = false;
      renderPage();
      renderTabs();
      return;
    }
    tab.url = normalized;
    tab.title = safeTitle(normalized);
    tab.loading = true;
    tab.error = null;
    tab.history.push(normalized);
    state.activeId = tab.id;
    renderTabs();
    renderPage();
    saveProfile('tabs', state.tabs.map(t => ({id:t.id, url:t.url, title:t.title, active:t.active})));
    if (!state.private) {
      state.history.push({url: normalized, title: tab.title, time: Date.now()});
      saveProfile('history', state.history);
    }
  }
  function goBack() {
    const tab = state.tabs.find(t => t.active);
    if (!tab || tab.history.length < 2) return;
    tab.history.pop();
    const prev = tab.history[tab.history.length - 1];
    if (prev) {
      tab.url = prev;
      tab.loading = true;
      tab.error = null;
      renderTabs();
      renderPage();
    }
  }
  function goForward() {
    // Simplified: no separate forward stack implemented to avoid false state
    // Real back/forward requires full stack; we use history array as approximation
  }
  function reload() {
    const tab = state.tabs.find(t => t.active);
    if (!tab) return;
    tab.loading = true;
    tab.error = null;
    renderTabs();
    renderPage();
  }
  function stop() {
    const tab = state.tabs.find(t => t.active);
    if (!tab) return;
    tab.loading = false;
    renderTabs();
  }

  // --- Rendering ---
  function getContainer() {
    return document.getElementById('retro-browser-container') || document.body;
  }

  function renderTabs() {
    const strip = document.getElementById('retro-tab-strip');
    if (!strip) return;
    let html = '';
    state.tabs.forEach((t, i) => {
      const activeClass = t.active ? 'is-active' : 'is-inactive';
      const closeBtn = !t.pinned ? '<button class="tab-close" aria-label="Close tab" onclick="window.RetroBrowser.closeTab(\'' + t.id + '\')">×</button>' : '';
      html += '<div class="tab ' + activeClass + '" data-id="' + t.id + '" onclick="window.RetroBrowser.activateTab(\'' + t.id + '\')" draggable="true" ondragstart="window.RetroBrowser.dragStart(event,' + i + ')" ondragover="window.RetroBrowser.dragOver(event)" ondrop="window.RetroBrowser.drop(event,' + i + ')">' +
        '<span class="tab-title">' + (t.title || 'New Tab') + '</span>' + closeBtn + '</div>';
    });
    // New tab button
    html += '<button class="tab-new" onclick="window.RetroBrowser.newTab()" aria-label="New tab">+</button>';
    strip.innerHTML = html;
  }

  function renderPage() {
    const frame = document.getElementById('retro-page-frame');
    const status = document.getElementById('retro-status-text');
    const tab = state.tabs.find(t => t.active);
    if (!tab) return;
    if (status) {
      status.textContent = tab.error ? tab.error : (tab.loading ? 'Loading…' : tab.url);
    }
    if (frame) {
      if (tab.error) {
        frame.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#333;background:#fff;">' +
          '<h2>Unable to load page</h2><p>This site may prevent embedding.</p>' +
          '<p><a href="' + (tab.url || '#') + '" target="_blank" rel="noopener">Open in new window</a></p></div>';
      } else if (tab.url === 'about:blank' || tab.url === '') {
        frame.innerHTML = newTabPageHTML();
      } else {
        // Try iframe; if blocked, show explanation
        const sandbox = 'sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation"';
        // For cross-origin, we can only embed; if blocked, user sees browser block
        frame.innerHTML = '<iframe src="' + tab.url + '" style="width:100%;height:100%;border:0;" loading="lazy" ' + sandbox + ' title="Page"></iframe>';
      }
    }
  }

  function newTabPageHTML() {
    const quick = ['https://example.com', 'https://github.com', 'https://en.wikipedia.org', 'https://news.ycombinator.com'];
    let links = '';
    quick.forEach(u => {
      try { links += '<a href="#" onclick="window.RetroBrowser.navigate(\'' + u + '\');return false;" class="quick-link">' + new URL(u).hostname + '</a>'; } catch(e) { links += '<a href="#" onclick="window.RetroBrowser.navigate(\'' + u + '\');return false;" class="quick-link">' + u + '</a>'; }
    });
    return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:24px;font-family:system-ui,sans-serif;color:#333;background:linear-gradient(180deg,#f0f4fa,#e2e8f0);">' +
      '<h1 style="font-size:28px;margin-bottom:8px;color:#1a3c6e;">Welcome</h1>' +
      '<p style="color:#555;margin-bottom:16px;">Start browsing by entering a URL or search term above.</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">' + links + '</div>' +
      '<p style="margin-top:24px;font-size:12px;color:#777;">Retro Browser • Chrome 2010 / IE8-9 theme</p>' +
      '</div>';
  }

  // --- Drag and drop (native HTML5, avoids Draggabilly conflict) ---
  window.RetroBrowser = {
    activateTab: activateTab,
    closeTab: closeTab,
    newTab: function () { createTab(state.homeUrl, {title: 'New Tab'}); },
    navigate: navigate,
    reload: reload,
    stop: stop,
    goBack: goBack,
    goForward: goForward,
    createTab: createTab,
    init: init,
    isPrivate: function () { return state.private; },
    toggleTheme: function () { state.theme = state.theme === 'chrome-2010' ? 'ie8-9' : 'chrome-2010'; renderPage(); },
    dragStart: function (e, idx) { e.dataTransfer.setData('text/plain', idx); e.dataTransfer.effectAllowed = 'move'; },
    dragOver: function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
    drop: function (e, toIdx) { e.preventDefault(); const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10); if (!isNaN(fromIdx) && fromIdx !== toIdx) reorderTabs(fromIdx, toIdx); },
    renderTabs: renderTabs,
    renderPage: renderPage
  };

  // --- Init on load ---
  function init() {
    const saved = loadProfile('tabs', null);
    if (saved && Array.isArray(saved) && saved.length) {
      state.tabs = saved.map(t => ({
        id: t.id || uid(),
        url: t.url || state.homeUrl,
        title: t.title || safeTitle(t.url),
        loading: false,
        error: null,
        history: [t.url || state.homeUrl],
        active: Boolean(t.active),
        pinned: Boolean(t.pinned)
      }));
      state.activeId = state.tabs.find(t => t.active)?.id || state.tabs[0]?.id;
    } else {
      createTab(state.homeUrl, {title: 'New Tab'});
    }
    state.theme = loadProfile('theme', 'chrome-2010');
    state.bookmarks = loadProfile('bookmarks', []);
    state.history = loadProfile('history', []);
    state.private = loadProfile('private', false);
    renderTabs();
    renderPage();
    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      const cmd = (e.ctrlKey || e.metaKey);
      if (cmd && e.key === 't') { e.preventDefault(); createTab(state.homeUrl); }
      if (cmd && e.key === 'w') { e.preventDefault(); const t = state.tabs.find(x => x.active); if (t) closeTab(t.id); }
      if (cmd && e.key === 'l') { e.preventDefault(); const bar = document.getElementById('retro-address-bar'); if (bar) bar.focus(); }
      if (cmd && e.key === 'r') { e.preventDefault(); reload(); }
      if (e.key === 'Alt') { /* reserved */ }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
