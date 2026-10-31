// Task Manager — reads the process table through proc.list / sys.info syscalls only.
window.OSApps.register('task-manager', {
  async main(proc) {
    const win = await proc.win.open({ title: 'Task Manager' });
    const root = win.root;

    function h(tag, cls, text) {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text != null) el.textContent = text;
      return el;
    }
    function fmtMem(b) { return (b / 1048576).toFixed(1) + ' MB'; }

    const wrap = h('div', 'tm-wrap');
    const head = h('div', 'tm-head');
    const summary = h('span', '', 'Loading…');
    const showLabel = h('label');
    const showExited = h('input');
    showExited.type = 'checkbox';
    showLabel.appendChild(showExited);
    showLabel.appendChild(document.createTextNode('Show exited'));
    head.appendChild(summary);
    head.appendChild(showLabel);
    const err = h('div', 'tm-err');
    const scroll = h('div', 'tm-scroll');
    const table = h('table', 'tm-table');
    const thead = h('thead');
    const hr = h('tr');
    ['PID', 'Name', 'State', 'Memory', 'CPU ticks', 'Syscalls', 'Caps', ''].forEach(function (t) { hr.appendChild(h('th', '', t)); });
    thead.appendChild(hr);
    const tbody = h('tbody');
    table.appendChild(thead);
    table.appendChild(tbody);
    scroll.appendChild(table);
    [head, err, scroll].forEach(function (el) { wrap.appendChild(el); });
    root.textContent = '';
    root.appendChild(wrap);

    async function signal(pid, sig) {
      try { await proc.syscall('proc.signal', { pid: pid, signal: sig }); err.textContent = ''; }
      catch (e) { err.textContent = (e.code || 'ERR') + ': ' + e.message; }
      refresh();
    }

    function row(p) {
      const tr = h('tr', p.state === 'zombie' ? 'tm-zombie' : (p.state === 'exited' ? 'tm-exited' : ''));
      tr.title = 'caps: ' + (p.caps.length ? p.caps.join(', ') : '(none)');
      [p.pid, p.name, p.state, fmtMem(p.stats.memBytes), p.stats.cpuTicks, p.stats.syscalls, p.caps.length]
        .forEach(function (v) { tr.appendChild(h('td', '', String(v))); });
      const act = h('td');
      if (p.state !== 'exited' && p.pid !== proc.pid) {
        const end = h('button', '', p.state === 'zombie' ? 'Reap' : 'End task');
        end.addEventListener('click', function () { signal(p.pid, 'SIGTERM'); });
        act.appendChild(end);
        if (p.state === 'running') {
          const kill = h('button', '', 'Kill');
          kill.addEventListener('click', function () { signal(p.pid, 'SIGKILL'); });
          act.appendChild(kill);
        }
      }
      tr.appendChild(act);
      return tr;
    }

    let busy = false;
    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const results = await Promise.all([proc.syscall('proc.list', {}), proc.syscall('sys.info', {})]);
        const list = results[0].sort(function (a, b) { return a.pid - b.pid; });
        const info = results[1];
        summary.textContent = info.processCount + ' processes · ' + fmtMem(info.totalMemBytes) +
          ' · ' + info.syscalls.total + ' syscalls (' + info.syscalls.denied + ' denied)';
        tbody.textContent = '';
        list.forEach(function (p) {
          if (p.state === 'exited' && !showExited.checked) return;
          tbody.appendChild(row(p));
        });
      } catch (e) {
        err.textContent = (e.code || 'ERR') + ': ' + e.message;
      }
      busy = false;
    }

    showExited.addEventListener('change', refresh);
    const timer = setInterval(refresh, 1000);
    proc.onExit(function () { clearInterval(timer); });
    refresh();
  }
});
