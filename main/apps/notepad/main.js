// Notepad — reference manifest app. Only touches win.root, talks to the OS via proc.syscall.
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
    [pathInput, openBtn, saveBtn, copyBtn, pasteBtn].forEach(function (el) { bar.appendChild(el); });
    const text = h('textarea', 'np-text');
    text.spellcheck = false;
    const status = h('div', 'np-status', 'Ready');
    [bar, text, status].forEach(function (el) { wrap.appendChild(el); });
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
        const r = await proc.syscall('fs.read', { path: path });
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
        await proc.syscall('fs.write', { path: path, content: text.value });
        markDirty(false);
        setStatus('Saved ' + path);
      } catch (e) { fail(e); }
    }

    openBtn.addEventListener('click', function () { if (pathInput.value.trim()) openFile(pathInput.value.trim()); });
    saveBtn.addEventListener('click', save);
    copyBtn.addEventListener('click', async function () {
      try { await proc.syscall('sys.clipboard.set', { text: text.value }); setStatus('Copied to OS clipboard'); } catch (e) { fail(e); }
    });
    pasteBtn.addEventListener('click', async function () {
      try {
        const c = await proc.syscall('sys.clipboard.get', {});
        const s = text.selectionStart;
        text.setRangeText(c.text, s, text.selectionEnd, 'end');
        markDirty(true);
      } catch (e) { fail(e); }
    });
    text.addEventListener('input', function () { markDirty(true); });
    text.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); save(); }
    });

    // Unsaved changes: veto the first SIGTERM (End task), the second one goes through.
    proc.onSignal('SIGTERM', function () {
      if (dirty) { setStatus('Unsaved changes — end the task again to discard them'); return true; }
      return false;
    });

    const a = proc.args;
    if (a && typeof a.path === 'string' && a.path) openFile(a.path);
  }
});
