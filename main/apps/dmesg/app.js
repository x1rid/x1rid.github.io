/* dmesg App — main/apps/dmesg/app.js
 * Streams KernelEvents in real time, like Linux dmesg.
 */
(function () {
  'use strict';
  const APP_ID = 'dmesg';

  function createUI(win) {
    const root = win.root;
    root.innerHTML = '';
    root.style.cssText = 'display:flex;flex-direction:column;height:100%;font-family:monospace;background:#000;color:#33ff33;';

    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;gap:8px;padding:4px 8px;border-bottom:1px solid #1a3300;background:#050505;';
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'CLEAR';
    clearBtn.style.cssText = 'background:none;border:1px solid #33ff33;color:#33ff33;padding:2px 8px;cursor:pointer;font-family:monospace;font-size:11px;';
    const pauseBtn = document.createElement('button');
    pauseBtn.textContent = 'PAUSE';
    pauseBtn.style.cssText = 'background:none;border:1px solid #33ff33;color:#33ff33;padding:2px 8px;cursor:pointer;font-family:monospace;font-size:11px;';
    const label = document.createElement('span');
    label.style.cssText = 'font-size:11px;color:#1a8c1a;align-self:center;margin-left:auto;';
    label.textContent = 'LIVE';
    toolbar.appendChild(clearBtn);
    toolbar.appendChild(pauseBtn);
    toolbar.appendChild(label);

    const logEl = document.createElement('div');
    logEl.style.cssText = 'flex:1;overflow-y:auto;padding:6px 10px;font-size:11px;line-height:1.6;';

    root.appendChild(toolbar);
    root.appendChild(logEl);

    let paused = false;
    let lineCount = 0;

    function appendLine(text) {
      if (paused) return;
      lineCount++;
      const line = document.createElement('div');
      const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
      line.textContent = '[' + String(lineCount).padStart(5, ' ') + '] [' + ts + '] ' + text;
      logEl.appendChild(line);
      if (logEl.children.length > 1000) logEl.removeChild(logEl.firstChild);
      logEl.scrollTop = logEl.scrollHeight;
    }

    clearBtn.addEventListener('click', function () { logEl.innerHTML = ''; lineCount = 0; });
    pauseBtn.addEventListener('click', function () {
      paused = !paused;
      pauseBtn.textContent = paused ? 'RESUME' : 'PAUSE';
      label.textContent = paused ? 'PAUSED' : 'LIVE';
      label.style.color = paused ? '#aa3300' : '#1a8c1a';
    });

    // Attach to kernel event bus
    if (window.KernelEvents && typeof window.KernelEvents.on === 'function') {
      window.KernelEvents.on('*', function (event, data) {
        appendLine(event + (data ? ' ' + JSON.stringify(data).substring(0, 80) : ''));
      });
    }

    appendLine('dmesg: kernel ring buffer ready');
    appendLine('dmesg: listening for events…');
  }

  if (typeof window !== 'undefined' && window.OSApps && typeof window.OSApps.register === 'function') {
    window.OSApps.register(APP_ID, { mount: createUI });
  } else if (typeof window !== 'undefined') {
    window.addEventListener('os:apps-ready', function () {
      if (window.OSApps) window.OSApps.register(APP_ID, { mount: createUI });
    });
  }
}());
