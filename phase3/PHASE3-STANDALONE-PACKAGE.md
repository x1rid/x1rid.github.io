# PHASE 3 — CONTEXT & HANDOFF FOR EXTERNAL / WEB LLM (SHOT 2)

> **Notice to AI Agent:** You have isolated context and cannot browse the entire repository. This single master package contains:
> 1. Exact system architecture and Golden Rules from `OS_FOUNDATION.md`.
> 2. Complete Phase 3 specifications and milestone contracts.
> 3. Full source code of the Phase 3.1–3.3 implementations (`app-registry.js`, `kernel/process-table.js`, `kernel/syscalls.js`).
> 4. Reference manifest app implementations (`notepad`, `task-manager`, `settings`).
> 5. The legacy `calculator.js` source and its exact CSS definitions for migration.
> 6. Step-by-step instructions for Phase 3.4 (`index.html` shell extraction) and Phase 3.5 (`kernel-db` & `.pkg` installer).

---

# PART 1: OS FOUNDATION SPEC & GOLDEN RULES

### 1.1 The Seven Layers
Layers may **only call downward**. Lower layers never import, query the DOM of, or listen to events from higher layers:
```
L7  IMMERSION      boot sequence, lock screen, sounds, cursor, wallpapers, clippy, easter eggs/ARG
L6  APPLICATIONS   Explorer, Terminal, Settings, Task Manager, Notepad, Calculator, Browser, games
L5  SHELL          desktop, taskbar, start menu, window chrome, notifications UI, context menus, WM
L4  SESSION        profiles, login/lock, per-user settings, window-state restore, autostart
L3  KERNEL         process table, scheduler (cooperative), syscalls, IPC, event bus, timers, signals
L2  SECURITY       users/groups, permissions (default-deny), audit, capabilities
L1  STORAGE        VFS (nodes, content, mounts, devfs, procfs), persistence, migrations
L0  PLATFORM       Clock, RNG, IndexedDB wrapper, error types, logger, feature detection
```

### 1.2 Non-Negotiable Golden Rules
1. **No build step:** Plain `<script>` tags, vanilla ES6/ES2020 JavaScript, no bundlers, no npm runtime dependencies. Node `module.exports` guards are permitted only for test suites (`if (typeof module !== 'undefined' && module.exports) ...`).
2. **One global namespace per service:** Exported once at the bottom of the file (e.g. `window.KernelProcessTable = Object.freeze({...})`). Never leak helper globals.
3. **Services never touch the DOM:** Only the Shell layer (L5) and Apps (L6, strictly within their assigned `win.root`) create or manipulate DOM elements.
4. **Structured Errors:** Always throw `OsError` / `FsError` objects with `{ code, message, detail }`. Standard codes: `CAPABILITY_DENIED`, `ENOENT`, `EACCES`, `EPERM`, `ESRCH`, `EINVAL`, `EBUSY`, `PROFILE_LOCKED`, `SCHEMA_MISMATCH`. Never throw bare strings.
5. **Event Vocabulary:** Strictly follow `domain:verb-noun` (e.g., `proc:spawned`, `proc:exited`, `proc:crashed`, `win:opened`, `sys:settings-changed`, `os:apps-changed`). Payloads must include `{ type, profileId, emittedAt, sequence, ... }`.
6. **Sandboxed Simulation:** Completely isolated from host filesystems, host networks, and real credentials. All networking is simulated.
7. **Profile Isolation:** Nothing written for profile A may be readable or writable while profile B is active. Clear per-profile caches on `profile:changed`.
8. **Render Text as Data:** Always render text from users or files using `textContent`, never `innerHTML` (XSS prevention).

---

# PART 2: CONTRACTS & DATA SHAPES

### 2.1 Process Table Record (`KernelProcessTable`)
```javascript
{
  pid: 10,
  ppid: 1,
  appId: "notepad",
  kind: "app", // 'app' | 'service'
  name: "Notepad",
  uid: "owner",
  state: "running", // 'running' | 'sleeping' | 'stopped' | 'zombie'
  exitCode: null,
  startedAt: 1710000000000,
  cwd: "C:\\Users\\Owner",
  env: {},
  windows: ["win-1"],
  caps: ["fs.read:user", "fs.write:user", "sys.clipboard"],
  stats: {
    cpuTicks: 0,
    memBytes: 1048576,
    syscalls: 4
  }
}
```

### 2.2 App Manifest (`apps/<id>/manifest.json`)
```json
{
  "manifestVersion": 1,
  "id": "notepad",
  "name": "Notepad",
  "version": "1.0.0",
  "kind": "app",
  "entry": "main.js",
  "styles": ["styles.css"],
  "icon": "assets/icon.svg",
  "multiple": true,
  "fileTypes": ["txt"],
  "capabilities": ["fs.read:user", "fs.write:user", "sys.clipboard"],
  "window": {
    "width": 640,
    "height": 420,
    "resizable": true
  },
  "personality": ["windows", "linux"]
}
```

### 2.3 App Entry (`apps/<id>/main.js`)
```javascript
window.OSApps.register('notepad', {
  async main(proc, args) {
    const win = await proc.win.open({ title: 'Notepad' });
    // ONLY touch win.root; never document.body
    
    // SIGTERM veto handler (veto exit once, returning true delays exit)
    proc.onSignal('SIGTERM', async () => true);
  }
});
```

### 2.4 Syscall Invocation (`KernelSyscalls`)
```javascript
const result = await Kernel.syscall(ctx, 'fs.read', { path: 'C:\\Users\\Owner\\notes.txt' });
// ctx = { pid, uid, caps }
```

---

# PART 3: PHASE 3 STATUS & ROADMAP

| Phase | Description | Status |
|---|---|---|
| **3.1** | Manifest loader + `OSApps.register` + `RetroApps` bridge | **Complete** (Notepad reference app live) |
| **3.2** | Kernel capability checks (default-deny), audit log, SIGTERM veto once, zombie/crash reaper | **Complete** (16/16 tests passing) |
| **3.3** | Task Manager (`proc.list` + signals) & Settings (`sys.settings.*`) apps | **Complete** |
| **3.4** | Extract monolithic `main/index.html` (6,377 lines) into `main/shell/` (`desktop.js`, `start-menu.js`, `notifications.js`) | **To Be Done** |
| **3.5** | Package installer (`.pkg` VFS extraction) + IndexedDB `kernel-db` | **To Be Done** |

---

# PART 4: REFERENCE IMPLEMENTATIONS (PHASE 3.1–3.3)

### 4.1 Notepad Reference Manifest & Entry
**`main/apps/notepad/manifest.json`**:
```json
{"manifestVersion":1,"id":"notepad","name":"Notepad","version":"1.0.0","kind":"app","entry":"main.js","styles":["styles.css"],"icon":"assets/icon.svg","multiple":true,"fileTypes":["txt"],"capabilities":["fs.read:user","fs.write:user","sys.clipboard"],"window":{"width":640,"height":420,"resizable":true},"personality":["windows","linux"]}
```

**`main/apps/notepad/main.js`**:
```javascript
window.OSApps.register('notepad', {
  async main(proc, args) {
    const win = await proc.win.open({ title: 'Notepad' });
    const root = win.root;

    function h(tag, cls, text) {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text != null) el.textContent = text;
      return el;
    }

    const wrap = h('div', 'np-wrap');
    const bar = h('div', 'np-bar');
    const pathInput = h('input');
    pathInput.placeholder = 'File path (e.g. C:\\Users\\owner\\Desktop\\note.txt)';
    const openBtn = h('button', '', 'Open');
    const saveBtn = h('button', '', 'Save');
    const copyBtn = h('button', '', 'Copy all');
    const pasteBtn = h('button', '', 'Paste');
    [pathInput, openBtn, saveBtn, copyBtn, pasteBtn].forEach(el => bar.appendChild(el));
    const text = h('textarea', 'np-text');
    text.spellcheck = false;
    const status = h('div', 'np-status', 'Ready');
    [bar, text, status].forEach(el => wrap.appendChild(el));
    root.textContent = '';
    root.appendChild(wrap);

    let dirty = false;
    function setStatus(msg) { status.textContent = msg; }
    function markDirty(v) {
      dirty = v;
      win.setTitle('Notepad' + (pathInput.value ? ' — ' + pathInput.value : '') + (dirty ? ' *' : ''));
    }
    function fail(err) { setStatus((err && err.code ? err.code + ': ' : '') + (err && err.message || err)); }

    async function openFile(path) {
      try {
        const r = await proc.syscall('fs.read', { path });
        text.value = typeof r.content === 'string' ? r.content : String(r.content == null ? '' : r.content);
        pathInput.value = path;
        markDirty(false);
        setStatus('Opened ' + path);
      } catch (e) { fail(e); }
    }

    async function save() {
      const path = pathInput.value.trim();
      if (!path) { setStatus('Type a file path first'); return; }
      try {
        await proc.syscall('fs.write', { path, content: text.value });
        markDirty(false);
        setStatus('Saved ' + path);
      } catch (e) { fail(e); }
    }

    openBtn.addEventListener('click', () => { if (pathInput.value.trim()) openFile(pathInput.value.trim()); });
    saveBtn.addEventListener('click', save);
    copyBtn.addEventListener('click', async () => {
      try { await proc.syscall('sys.clipboard.set', { text: text.value }); setStatus('Copied to OS clipboard'); } catch (e) { fail(e); }
    });
    pasteBtn.addEventListener('click', async () => {
      try {
        const c = await proc.syscall('sys.clipboard.get', {});
        const s = text.selectionStart;
        text.setRangeText(c.text, s, text.selectionEnd, 'end');
        markDirty(true);
      } catch (e) { fail(e); }
    });
    text.addEventListener('input', () => { markDirty(true); });
    text.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); save(); }
    });

    proc.onSignal('SIGTERM', () => {
      if (dirty) { setStatus('Unsaved changes — end the task again to discard them'); return true; }
      return false;
    });
  }
});
```

---

# PART 5: LEGACY CALCULATOR SOURCE & CSS (FOR MIGRATION)

Below is the complete legacy `calculator.js` and its exact CSS rules so you can convert it to `main/apps/calculator/` without needing repo access:

### 5.1 Legacy `main/apps/calculator.js`
```javascript
/* ---------------------------------------------------------------------------
 * Calculator — the four-function desktop calculator, in the site's palette.
 * Real arithmetic, no eval(), no fake tape. Keyboard: digits, . + - * /
 * Enter/=, Escape (clear), Backspace, %.
 * ------------------------------------------------------------------------- */
(() => {
    'use strict';

    const ICON = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="4" y="2" width="16" height="20" fill="#07020a" stroke="#6f3a93"></rect>
            <rect x="6" y="4" width="12" height="4" fill="#130927" stroke="#c084fc"></rect>
            <path d="M7 6h10" stroke="#55ff99" stroke-width="1"></path>
            <g fill="#c084fc">
                <rect x="6" y="10" width="3" height="3"></rect>
                <rect x="10.5" y="10" width="3" height="3"></rect>
                <rect x="15" y="10" width="3" height="3"></rect>
                <rect x="6" y="14.5" width="3" height="3"></rect>
                <rect x="10.5" y="14.5" width="3" height="3"></rect>
                <rect x="15" y="14.5" width="3" height="3"></rect>
            </g>
            <rect x="6" y="19" width="7.5" height="2" fill="#8b72b8"></rect>
            <rect x="15" y="19" width="3" height="2" fill="#ff4fd8"></rect>
        </svg>`;

    function mount(root, api) {
        root.innerHTML = `
            <div class="calc">
                <div class="calc-display" tabindex="0" aria-label="Calculator display">
                    <div class="calc-expression" data-role="expression">&nbsp;</div>
                    <div class="calc-value" data-role="value" role="status" aria-live="polite">0</div>
                </div>
                <div class="calc-grid" role="group" aria-label="Calculator keys">
                    <button type="button" class="calc-key calc-key--fn" data-key="clear" title="Clear (Escape)">C</button>
                    <button type="button" class="calc-key calc-key--fn" data-key="back" title="Backspace">⌫</button>
                    <button type="button" class="calc-key calc-key--fn" data-key="percent" title="Percent">%</button>
                    <button type="button" class="calc-key calc-key--op" data-key="/" aria-label="Divide">÷</button>

                    <button type="button" class="calc-key" data-key="7">7</button>
                    <button type="button" class="calc-key" data-key="8">8</button>
                    <button type="button" class="calc-key" data-key="9">9</button>
                    <button type="button" class="calc-key calc-key--op" data-key="*" aria-label="Multiply">×</button>

                    <button type="button" class="calc-key" data-key="4">4</button>
                    <button type="button" class="calc-key" data-key="5">5</button>
                    <button type="button" class="calc-key" data-key="6">6</button>
                    <button type="button" class="calc-key calc-key--op" data-key="-" aria-label="Subtract">−</button>

                    <button type="button" class="calc-key" data-key="1">1</button>
                    <button type="button" class="calc-key" data-key="2">2</button>
                    <button type="button" class="calc-key" data-key="3">3</button>
                    <button type="button" class="calc-key calc-key--op" data-key="+" aria-label="Add">+</button>

                    <button type="button" class="calc-key calc-key--fn" data-key="sign" title="Negate">±</button>
                    <button type="button" class="calc-key" data-key="0">0</button>
                    <button type="button" class="calc-key" data-key=".">.</button>
                    <button type="button" class="calc-key calc-key--eq" data-key="=" aria-label="Equals">=</button>
                </div>
                <p class="app-hint">Keyboard works: digits, <kbd>+ − * /</kbd>, <kbd>Enter</kbd>, <kbd>Esc</kbd> clears.</p>
            </div>`;

        const valueEl = root.querySelector('[data-role="value"]');
        const expressionEl = root.querySelector('[data-role="expression"]');
        const displayEl = root.querySelector('.calc-display');

        let current = '0';
        let stored = null;
        let pending = '';
        let expression = '';
        let waiting = false;
        let evaluated = false;
        let error = false;

        const SYMBOLS = { '+': '+', '-': '−', '*': '×', '/': '÷' };

        function format(number) {
            if (!Number.isFinite(number)) return 'ERROR';
            const rounded = Number.parseFloat(Number(number).toPrecision(12));
            if (Math.abs(rounded) >= 1e12 || (rounded !== 0 && Math.abs(rounded) < 1e-9)) {
                return rounded.toExponential(6).replace('e+', 'e');
            }
            return String(rounded);
        }

        function render() {
            valueEl.textContent = error ? 'ERROR' : current;
            expressionEl.textContent = expression || '\u00a0';
            if (api && api.setMeta) api.setMeta(error ? 'ERROR' : pending || (evaluated ? 'RESULT' : 'READY'));
        }

        function reset() {
            current = '0';
            stored = null;
            pending = '';
            expression = '';
            waiting = false;
            evaluated = false;
            error = false;
            render();
        }

        function digit(d) {
            if (error) reset();
            if (waiting || evaluated) {
                current = d;
                waiting = false;
                evaluated = false;
            } else {
                current = current === '0' ? d : current + d;
            }
            if (current.length > 16) current = current.slice(0, 16);
            render();
        }

        function decimal() {
            if (error) reset();
            if (waiting || evaluated) {
                current = '0.';
                waiting = false;
                evaluated = false;
                render();
                return;
            }
            if (!current.includes('.')) {
                current += '.';
                render();
            }
        }

        function backspace() {
            if (error || evaluated || waiting) return;
            current = current.length > 1 ? current.slice(0, -1) : '0';
            if (current === '-' || current === '-0') current = '0';
            render();
        }

        function negate() {
            if (error) return;
            const value = Number.parseFloat(current);
            if (value === 0) return;
            current = format(-value);
            render();
        }

        function percent() {
            if (error) return;
            const value = Number.parseFloat(current);
            current = format(value / 100);
            render();
        }

        function compute(a, b, op) {
            if (op === '+') return a + b;
            if (op === '-') return a - b;
            if (op === '*') return a * b;
            if (op === '/') return b === 0 ? Number.NaN : a / b;
            return b;
        }

        function chooseOperator(nextOp) {
            if (error) reset();
            const value = Number.parseFloat(current);
            if (stored === null) {
                stored = value;
            } else if (!waiting) {
                const result = compute(stored, value, pending);
                if (!Number.isFinite(result)) {
                    error = true;
                    expression = 'DIVIDE BY ZERO';
                    render();
                    return;
                }
                stored = result;
                current = format(result);
            }
            pending = nextOp;
            waiting = true;
            evaluated = false;
            expression = `${format(stored)} ${SYMBOLS[nextOp] || nextOp}`;
            render();
        }

        function equals() {
            if (error || !pending) return;
            const value = Number.parseFloat(current);
            const left = stored;
            const result = compute(left, value, pending);
            if (!Number.isFinite(result)) {
                error = true;
                expression = 'DIVIDE BY ZERO';
                render();
                return;
            }
            expression = `${format(left)} ${SYMBOLS[pending] || pending} ${format(value)} =`;
            current = format(result);
            stored = null;
            pending = '';
            waiting = false;
            evaluated = true;
            render();
        }

        function press(key) {
            if (key === 'clear') reset();
            else if (key === 'back') backspace();
            else if (key === 'percent') percent();
            else if (key === 'sign') negate();
            else if (key === '=') equals();
            else if (key === '.') decimal();
            else if (['+', '-', '*', '/'].includes(key)) chooseOperator(key);
            else if (/^[0-9]$/.test(key)) digit(key);
        }

        root.addEventListener('click', (event) => {
            const button = event.target.closest ? event.target.closest('[data-key]') : null;
            if (!button || !root.contains(button)) return;
            press(button.dataset.key);
            if (displayEl && button.dataset.key === '=') displayEl.focus({ preventScroll: true });
        });

        root.addEventListener('keydown', (event) => {
            const target = event.target;
            if (target && target.closest && target.closest('input, textarea')) return;
            const key = event.key;
            let mapped = '';
            if (/^[0-9]$/.test(key)) mapped = key;
            else if (key === '.' || key === ',') mapped = '.';
            else if (key === '+' || key === '-' || key === '*' || key === '/' || key === '%') mapped = key;
            else if (key === 'Enter' || key === '=') mapped = '=';
            else if (key === 'Backspace') mapped = 'back';
            else if (key === 'Escape' || key === 'c' || key === 'C') mapped = 'clear';
            else if (key === 'Delete') mapped = 'clear';

            if (!mapped) return;
            event.preventDefault();
            event.stopPropagation();
            press(mapped);
        });

        displayEl.addEventListener('focus', () => { displayEl.classList.add('is-focused'); });
        displayEl.addEventListener('blur', () => { displayEl.classList.remove('is-focused'); });

        render();
        return function cleanup() {
            stored = null;
            pending = '';
        };
    }

    if (window.RetroApps) {
        window.RetroApps.register({
            id: 'calculator',
            name: 'Calculator',
            tagline: 'Four functions, keyboard input, and division-by-zero honesty.',
            meta: 'DESKTOP · 12 DIGITS',
            icon: ICON,
            mount,
        });
    }
})();
```

### 5.2 Calculator CSS Styles
```css
.calc {
    width: min(330px, 100%);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px;
    box-sizing: border-box;
}

.calc-display {
    padding: 10px 12px;
    border: 1px solid var(--line-hi, #3a2254);
    background: var(--surface-3, #150a24);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6);
    font-family: 'Courier New', monospace;
    font-variant-numeric: tabular-nums;
    transition: border-color 0.15s ease;
}

.calc-display.is-focused {
    border-color: var(--signal-active, #c084fc);
}

.calc-expression {
    min-height: 1.2em;
    overflow: hidden;
    color: var(--ink-50, #a08bb8);
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    text-align: right;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.calc-value {
    overflow: hidden;
    color: var(--ink-90, #f1e8fc);
    font-size: 1.85rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-align: right;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.calc-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 5px;
}

.calc-key {
    min-height: 44px;
    padding: 4px;
    border: 1px solid var(--line-hi, #3a2254);
    border-radius: 0;
    background: var(--surface-2, #1c0e30);
    color: var(--ink-90, #f1e8fc);
    font: 700 1rem 'Courier New', monospace;
    line-height: 1;
    cursor: pointer;
}

.calc-key:hover,
.calc-key:focus-visible {
    border-color: var(--signal-active, #c084fc);
    background: rgba(192, 132, 252, 0.09);
}

.calc-key:active {
    transform: translateY(1px);
}

.calc-key--fn {
    background: var(--surface-3, #150a24);
    color: var(--ink-70, #cfbde6);
    font-size: 0.85rem;
}

.calc-key--op {
    color: var(--signal-active, #c084fc);
}

.calc-key--eq {
    border-color: var(--signal-active, #c084fc);
    background: var(--signal-active, #c084fc);
    color: #180a2b;
    font-weight: 800;
}

.calc-key--eq:hover,
.calc-key--eq:focus-visible {
    background: #d5a9ff;
    color: #180a2b;
}

.app-hint {
    font-size: 0.75rem;
    color: var(--ink-50, #a08bb8);
    margin: 4px 0 0;
    text-align: center;
}
```

---

# PART 6: HOW TO EXECUTE REMAINING PHASE 3 TASK WORK

### 6.1 Calculator Migration (Zero Core Edits)
1. Create `main/apps/calculator/manifest.json`:
   ```json
   {
     "manifestVersion": 1,
     "id": "calculator",
     "name": "Calculator",
     "version": "1.0.0",
     "kind": "app",
     "entry": "main.js",
     "styles": ["styles.css"],
     "icon": "assets/icon.svg",
     "multiple": false,
     "capabilities": [],
     "window": { "width": 360, "height": 520, "resizable": false },
     "personality": ["windows"]
   }
   ```
2. Create `main/apps/calculator/assets/icon.svg` containing the SVG in Section 5.1.
3. Create `main/apps/calculator/styles.css` with Section 5.2.
4. Create `main/apps/calculator/main.js` using `window.OSApps.register('calculator', { async main(proc) { const win = await proc.win.open({ title: 'Calculator' }); mount(win.root); } })`.
5. Add `"calculator"` to `main/apps/index.json`.

### 6.2 Phase 3.4 (`index.html` Extraction)
- Extract inline `<script>` tags from `main/index.html` into modular files:
  - `main/shell/desktop.js` (Desktop icons, wallpaper rendering, click selection)
  - `main/shell/start-menu.js` (Start button, app search, menu DOM tree)
  - `main/shell/notifications.js` (Toast manager, notification flyout)
- Goal: Reduce `main/index.html` from 6,377 lines to < 200 lines of pure HTML skeleton.
- Maintain load sequence via `<script src="...">` tags with cache busters (`?v=YYYYMMDD`).

### 6.3 Phase 3.5 (`kernel-db` & Package Installer)
- Add IndexedDB store `kernel-db` with tables:
  - `audit`: For denied and sensitive syscall telemetry.
  - `installed_apps`: For packages installed from VFS.
- Provide installer syscall or CLI command: reads `.pkg` (JSON manifest + assets bundled) from VFS, writes to `installed_apps`, and registers into `AppRegistry`.
