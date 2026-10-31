// Settings — reads/writes through sys.settings.get / sys.settings.set (emits sys:settings-changed).
window.OSApps.register('settings', {
  async main(proc) {
    const win = await proc.win.open({ title: 'Settings' });
    const root = win.root;

    function h(tag, cls, text) {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text != null) el.textContent = text;
      return el;
    }

    const wrap = h('div', 'st-wrap');
    const msg = h('div', 'st-msg');
    function say(text, bad) { msg.textContent = text; msg.className = 'st-msg' + (bad ? ' st-err' : ''); }
    async function set(values) {
      try { await proc.syscall('sys.settings.set', { values: values }); say('Saved', false); return true; }
      catch (e) { say((e.code || 'ERR') + ': ' + e.message, true); return false; }
    }

    // Appearance
    const appearance = h('section');
    appearance.appendChild(h('h3', '', 'Appearance'));
    const themeRow = h('div', 'st-row');
    themeRow.appendChild(h('label', '', 'Theme'));
    const theme = h('select');
    ['dark', 'light'].forEach(function (t) { const o = h('option', '', t); o.value = t; theme.appendChild(o); });
    themeRow.appendChild(theme);
    const accentRow = h('div', 'st-row');
    accentRow.appendChild(h('label', '', 'Accent color'));
    const accent = h('input');
    accent.type = 'color';
    accent.value = '#4f8cff';
    accentRow.appendChild(accent);
    appearance.appendChild(themeRow);
    appearance.appendChild(accentRow);

    // Raw editor
    const raw = h('section');
    raw.appendChild(h('h3', '', 'All settings'));
    const list = h('div');
    const addRow = h('div', 'st-row');
    const newKey = h('input', 'st-key');
    newKey.placeholder = 'key (e.g. shell.clock24h)';
    const newVal = h('input', 'st-val');
    newVal.placeholder = 'value (JSON or plain text)';
    const addBtn = h('button', '', 'Add');
    [newKey, newVal, addBtn].forEach(function (el) { addRow.appendChild(el); });
    raw.appendChild(list);
    raw.appendChild(addRow);

    [appearance, raw, msg].forEach(function (el) { wrap.appendChild(el); });
    root.textContent = '';
    root.appendChild(wrap);

    function parseValue(text) {
      try { return JSON.parse(text); } catch (_) { return text; }
    }

    async function load() {
      try {
        const r = await proc.syscall('sys.settings.get', {});
        const s = r.settings || {};
        if (typeof s['appearance.theme'] === 'string') theme.value = s['appearance.theme'];
        if (typeof s['appearance.accent'] === 'string') accent.value = s['appearance.accent'];
        list.textContent = '';
        Object.keys(s).sort().forEach(function (k) {
          const row = h('div', 'st-row');
          row.appendChild(h('label', 'st-key', k));
          const input = h('input', 'st-val');
          input.value = JSON.stringify(s[k]);
          const save = h('button', '', 'Save');
          save.addEventListener('click', async function () { if (await set({ [k]: parseValue(input.value) })) load(); });
          [input, save].forEach(function (el) { row.appendChild(el); });
          list.appendChild(row);
        });
        if (!Object.keys(s).length) list.appendChild(h('div', 'st-msg', 'Nothing stored yet.'));
      } catch (e) { say((e.code || 'ERR') + ': ' + e.message, true); }
    }

    theme.addEventListener('change', async function () { if (await set({ 'appearance.theme': theme.value })) load(); });
    accent.addEventListener('change', async function () { if (await set({ 'appearance.accent': accent.value })) load(); });
    addBtn.addEventListener('click', async function () {
      const k = newKey.value.trim();
      if (!k) { say('Key is required', true); return; }
      if (await set({ [k]: parseValue(newVal.value) })) { newKey.value = ''; newVal.value = ''; load(); }
    });

    load();
  }
});
