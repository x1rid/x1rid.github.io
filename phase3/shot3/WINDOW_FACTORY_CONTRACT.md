# SHOT 3: WINDOW FACTORY & SHELL CONTRACT SPECIFICATION

This reference document answers all questions raised by the external agent regarding the `windowFactory` contract, `DesktopShellHost`, `ShellWM`, and provides exact test citations.

---

## 1. Exact `windowFactory` Contract from `main/app-registry.js`

In `main/app-registry.js` (lines 657–675):
```javascript
function createAppWindow(manifest) {
    const factory = typeof services.windowFactory === 'function' ? services.windowFactory : defaultWindowFactory;
    const w = manifest.window || {};
    const win = factory({
        appId: manifest.id,
        title: manifest.name,
        width: w.width || 640,
        height: w.height || 420,
        resizable: w.resizable !== false,
        icon: manifest.icon || ''
    });
    if (!win || !win.root) throw new Error('windowFactory must return a window with a .root element');
    return win;
}
```

### The Window Object Contract
When `AppRegistry.configure({ windowFactory(opts) -> win })` is called, `win` must provide:
```javascript
{
  id: "win-unique-id",          // Unique window string id
  root: HTMLElement,            // DOM container where the app mounts its UI (win.root)
  node: HTMLElement,            // The outer window section element
  closed: false,                // Boolean flag
  onClose: null,                // Callback assigned by AppRegistry; invoked when window is closed
  close: function() { ... },    // Method to close and unmount window
  setTitle: function(title) {}, // (Optional) updates window title
  focus: function() {}          // (Optional) raises z-index / focuses window
}
```

---

## 2. Test Citations from Test Suites

From `tests/phase3-packages.test.js` (lines 119–120):
```javascript
const winNode = {
  id: 'w-hello',
  root: {},
  closed: false,
  onClose: null,
  setTitle() {},
  close() {
    this.closed = true;
    this.onClose && this.onClose();
  }
};
R.configure({ windowFactory: () => winNode });
```

From `tests/phase3-kernel.test.js` (lines 154–159):
```javascript
const win = { id: 'legacy-1', closed: false, onClose: null };
R.register({ id: 'calc', name: 'Calc', launch: () => win });
// closing win triggers process exit & unregisters:
win.onClose();
```

---

## 3. How to Wire `windowFactory` to Shell's `registerWindow`

In `main/index.html`, lines 4169–4201 already demonstrate how the shell dynamically builds program windows:
```javascript
// Recommended windowFactory implementation for the shell:
function shellWindowFactory(opts) {
    const winId = 'appwin-' + (++winSeq);
    const node = document.createElement('section');
    node.className = 'window program-app-window';
    node.setAttribute('aria-label', opts.title || opts.appId);
    node.innerHTML = `
        <header class="titlebar">
            <span class="program-title-icon" aria-hidden="true">${opts.icon || '▣'}</span>
            <span class="titlebar-title"></span>
            <span class="prototype-badge program-meta"></span>
        </header>
        <div class="program-app-body" tabindex="-1"></div>
        <footer class="program-statusbar">
            <span class="program-status-cell">${escapeHtml(opts.appId)}.exe</span>
            <span class="program-status-cell">LOCAL</span>
        </footer>
    `;
    node.querySelector('.titlebar-title').textContent = opts.title || opts.appId;
    desktop.appendChild(node);

    const rootEl = node.querySelector('.program-app-body');
    const titleEl = node.querySelector('.titlebar-title');

    const index = Array.from(windows.values()).filter((item) => item.appId === opts.appId).length;
    const win = registerWindow(node, {
        id: winId,
        appId: opts.appId,
        title: opts.title,
        icon: opts.icon || '▣',
        minWidth: opts.width || 340,
        minHeight: opts.height || 320,
        bounds: opts.bounds || nextProgramBounds(opts.appId, index),
        focusTarget: '.program-app-body'
    });

    // Augment with AppRegistry required properties:
    win.root = rootEl;
    win.setTitle = (t) => { titleEl.textContent = String(t); win.title = String(t); };
    const origClose = win.close || (() => closeWindow(win.id));
    win.close = function() {
        if (win.closed) return;
        origClose();
        if (typeof win.onClose === 'function') win.onClose();
    };

    return win;
}
```

Then configure AppRegistry:
```javascript
AppRegistry.configure({
    windowFactory: shellWindowFactory,
    windowManager: { ... }
});
```

---

## 4. `DesktopShellHost` Interface Reference

In `main/index.html` (lines 6040–6070):
```javascript
window.DesktopShellHost = {
    version: '20261023',
    windows,
    get activeWindowId() { return activeWindowId; },
    registry: window.AppRegistry,
    wm: window.ShellWM,
    focusWindow,
    minimizeWindow,
    restoreWindow,
    closeWindow,
    toggleMaximize,
    openExplorer,
    openTerminal,
    openMusic,
    openPrograms,
    openProgram,
    openSearch,
    closeSearch,
    toast,
    persist: persistWindowState,
    getProfile() {
        return window.ProfileService && window.ProfileService.getActiveProfile
            ? window.ProfileService.getActiveProfile()
            : null;
    },
    getSavedState() {
        return window.ProfileState || null;
    },
    saveShellState(shell) { ... }
};
```
*(Note: `desktop-environment.js` is deferred and loaded at the end of `index.html` to attach optional taskbar enhancements via `DesktopShellHost` if available).*

---

## 5. Ready-To-Download Archive
All files requested by the agent are packaged in:
📁 `phase3/shot3/shot3-requested-files.zip`
- `main/app-registry.js`
- `main/window-manager-core.js`
- `main/window-manager.js`
- `tests/phase3-kernel.test.js`
- `tests/phase3-packages.test.js`
