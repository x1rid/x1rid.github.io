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

    // Lock Screen Settings
    const lockScreenSec = h('section');
    lockScreenSec.appendChild(h('h3', '', 'Lock Screen'));

    const clockFmtRow = h('div', 'st-row');
    clockFmtRow.appendChild(h('label', '', 'Clock format'));
    const clockFmt = h('select');
    [['24h', '24-hour'], ['12h', '12-hour']].forEach(function (pair) {
      const o = h('option', '', pair[1]); o.value = pair[0]; clockFmt.appendChild(o);
    });
    clockFmtRow.appendChild(clockFmt);
    lockScreenSec.appendChild(clockFmtRow);

    const animIntRow = h('div', 'st-row');
    animIntRow.appendChild(h('label', '', 'Animation intensity'));
    const animIntensity = h('select');
    ['high', 'medium', 'low'].forEach(function (val) {
      const o = h('option', '', val.charAt(0).toUpperCase() + val.slice(1)); o.value = val; animIntensity.appendChild(o);
    });
    animIntRow.appendChild(animIntensity);
    lockScreenSec.appendChild(animIntRow);

    const secRow = h('div', 'st-row');
    secRow.appendChild(h('label', '', 'Show seconds'));
    const showSec = h('input');
    showSec.type = 'checkbox';
    secRow.appendChild(showSec);
    lockScreenSec.appendChild(secRow);

    const partRow = h('div', 'st-row');
    partRow.appendChild(h('label', '', 'Star particles'));
    const showPart = h('input');
    showPart.type = 'checkbox';
    showPart.checked = true;
    partRow.appendChild(showPart);
    lockScreenSec.appendChild(partRow);

    const widgRow = h('div', 'st-row');
    widgRow.appendChild(h('label', '', 'Bulletin widgets'));
    const showWidg = h('input');
    showWidg.type = 'checkbox';
    showWidg.checked = true;
    widgRow.appendChild(showWidg);
    lockScreenSec.appendChild(widgRow);

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

    [appearance, lockScreenSec, raw, msg].forEach(function (el) { wrap.appendChild(el); });
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

        // Lock screen settings
        if (typeof s['lockScreen.clock.format'] === 'string') clockFmt.value = s['lockScreen.clock.format'];
        if (typeof s['lockScreen.animation.intensity'] === 'string') animIntensity.value = s['lockScreen.animation.intensity'];
        if (typeof s['lockScreen.clock.showSeconds'] === 'boolean') showSec.checked = s['lockScreen.clock.showSeconds'];
        if (typeof s['lockScreen.animation.particles'] === 'boolean') showPart.checked = s['lockScreen.animation.particles'];
        if (typeof s['lockScreen.widgets.enabled'] === 'boolean') showWidg.checked = s['lockScreen.widgets.enabled'];

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

    clockFmt.addEventListener('change', async function () {
      if (await set({ 'lockScreen.clock.format': clockFmt.value })) {
        if (window.LockScreenV2 && typeof window.LockScreenV2.saveLockScreen === 'function') {
          window.LockScreenV2.saveLockScreen({ clock: { format: clockFmt.value } });
        }
        load();
      }
    });

    animIntensity.addEventListener('change', async function () {
      if (await set({ 'lockScreen.animation.intensity': animIntensity.value })) {
        if (window.LockScreenV2 && typeof window.LockScreenV2.saveLockScreen === 'function') {
          window.LockScreenV2.saveLockScreen({ animation: { intensity: animIntensity.value } });
        }
        load();
      }
    });

    showSec.addEventListener('change', async function () {
      if (await set({ 'lockScreen.clock.showSeconds': showSec.checked })) {
        if (window.LockScreenV2 && typeof window.LockScreenV2.saveLockScreen === 'function') {
          window.LockScreenV2.saveLockScreen({ clock: { showSeconds: showSec.checked } });
        }
        load();
      }
    });

    showPart.addEventListener('change', async function () {
      if (await set({ 'lockScreen.animation.particles': showPart.checked })) {
        if (window.LockScreenV2 && typeof window.LockScreenV2.saveLockScreen === 'function') {
          window.LockScreenV2.saveLockScreen({ animation: { particles: showPart.checked } });
        }
        load();
      }
    });

    showWidg.addEventListener('change', async function () {
      if (await set({ 'lockScreen.widgets.enabled': showWidg.checked })) {
        if (window.LockScreenV2 && typeof window.LockScreenV2.saveLockScreen === 'function') {
          window.LockScreenV2.saveLockScreen({ widgets: { enabled: showWidg.checked } });
        }
        load();
      }
    });

    addBtn.addEventListener('click', async function () {
      const k = newKey.value.trim();
      if (!k) { say('Key is required', true); return; }
      if (await set({ [k]: parseValue(newVal.value) })) { newKey.value = ''; newVal.value = ''; load(); }
    });

    load();
  }
});
