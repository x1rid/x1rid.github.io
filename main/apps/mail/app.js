/* Mail App — main/apps/mail/app.js
 * Manifest app. Rendered into win.root by AppRegistry.
 * Capabilities: net.request, fs.write:user, sys.notify
 */
(function () {
  'use strict';

  const APP_ID = 'mail';

  function createUI(win) {
    const root = win.root;
    root.innerHTML = '';
    root.style.cssText = 'display:flex;height:100%;font-family:monospace;background:#0d0d0d;color:#e0e0e0;';

    // Sidebar
    const sidebar = document.createElement('div');
    sidebar.style.cssText = 'width:160px;border-right:1px solid #333;padding:8px;display:flex;flex-direction:column;gap:4px;';

    const composeBtn = document.createElement('button');
    composeBtn.textContent = '+ Compose';
    composeBtn.style.cssText = 'background:#6c63ff;color:#fff;border:none;padding:6px;cursor:pointer;font-family:monospace;margin-bottom:8px;';

    const inboxBtn = document.createElement('button');
    inboxBtn.textContent = '✉ Inbox';
    inboxBtn.style.cssText = 'background:none;border:none;color:#e0e0e0;text-align:left;padding:4px;cursor:pointer;font-family:monospace;';

    const sentBtn = document.createElement('button');
    sentBtn.textContent = '📤 Sent';
    sentBtn.style.cssText = 'background:none;border:none;color:#e0e0e0;text-align:left;padding:4px;cursor:pointer;font-family:monospace;';

    sidebar.appendChild(composeBtn);
    sidebar.appendChild(inboxBtn);
    sidebar.appendChild(sentBtn);

    // Main content area
    const main = document.createElement('div');
    main.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText = 'padding:8px 12px;border-bottom:1px solid #333;font-size:11px;color:#888;letter-spacing:1px;';
    header.textContent = 'INBOX';

    const list = document.createElement('div');
    list.style.cssText = 'flex:1;overflow-y:auto;';

    const pane = document.createElement('div');
    pane.style.cssText = 'border-top:1px solid #333;padding:12px;min-height:120px;font-size:12px;color:#ccc;white-space:pre-wrap;';
    pane.textContent = 'Select a message to read.';

    main.appendChild(header);
    main.appendChild(list);
    main.appendChild(pane);

    root.appendChild(sidebar);
    root.appendChild(main);

    function renderMessageList(messages, filter) {
      list.innerHTML = '';
      const filtered = filter ? messages.filter(function (m) { return m.direction === filter; }) : messages;
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:16px;color:#555;font-size:12px;';
        empty.textContent = 'No messages.';
        list.appendChild(empty);
        return;
      }
      filtered.forEach(function (msg) {
        const row = document.createElement('div');
        row.style.cssText = 'padding:8px 12px;border-bottom:1px solid #1a1a1a;cursor:pointer;' + (msg.read ? '' : 'font-weight:bold;');
        row.innerHTML = '<div style="font-size:11px;color:#888;">' + (msg.from || msg.to) + ' &bull; ' + new Date(msg.date).toLocaleString() + '</div>' +
          '<div style="font-size:12px;margin-top:2px;">' + (msg.subject || '(no subject)') + '</div>';
        row.addEventListener('click', function () {
          pane.textContent = 'From: ' + (msg.from || '') + '\nTo: ' + (msg.to || '') + '\nSubject: ' + (msg.subject || '') + '\nDate: ' + msg.date + '\n\n' + (msg.body || '');
          if (typeof window.MailService !== 'undefined' && !msg.read) {
            window.MailService.read(msg.id);
            row.style.fontWeight = 'normal';
          }
        });
        list.appendChild(row);
      });
    }

    function loadMessages(filter) {
      header.textContent = filter === 'sent' ? 'SENT' : 'INBOX';
      if (typeof window.MailService !== 'undefined') {
        window.MailService.list().then(function (msgs) {
          renderMessageList(msgs, filter);
        });
      } else {
        list.innerHTML = '<div style="padding:16px;color:#555;font-size:12px;">MailService not available.</div>';
      }
    }

    function showComposeForm() {
      header.textContent = 'COMPOSE';
      list.innerHTML = '';
      const form = document.createElement('form');
      form.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:8px;';
      form.innerHTML = '<label style="font-size:11px;color:#888;">TO<br><input name="to" style="width:100%;background:#111;border:1px solid #333;color:#e0e0e0;padding:4px;font-family:monospace;" value="nobody@r3dos.internal"></label>' +
        '<label style="font-size:11px;color:#888;">SUBJECT<br><input name="subject" style="width:100%;background:#111;border:1px solid #333;color:#e0e0e0;padding:4px;font-family:monospace;" placeholder="(no subject)"></label>' +
        '<label style="font-size:11px;color:#888;">BODY<br><textarea name="body" rows="6" style="width:100%;background:#111;border:1px solid #333;color:#e0e0e0;padding:4px;font-family:monospace;resize:vertical;"></textarea></label>' +
        '<button type="submit" style="background:#6c63ff;color:#fff;border:none;padding:6px;cursor:pointer;font-family:monospace;">Send</button>';
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        const data = new FormData(form);
        if (typeof window.MailService !== 'undefined') {
          window.MailService.send({ to: data.get('to'), subject: data.get('subject'), body: data.get('body') }).then(function () {
            loadMessages('sent');
          });
        }
      });
      list.appendChild(form);
      pane.textContent = '';
    }

    composeBtn.addEventListener('click', showComposeForm);
    inboxBtn.addEventListener('click', function () { loadMessages('received'); });
    sentBtn.addEventListener('click', function () { loadMessages('sent'); });

    loadMessages('received');
  }

  if (typeof window !== 'undefined' && window.OSApps && typeof window.OSApps.register === 'function') {
    window.OSApps.register(APP_ID, { mount: createUI });
  } else if (typeof window !== 'undefined') {
    window.addEventListener('os:apps-ready', function () {
      if (window.OSApps) window.OSApps.register(APP_ID, { mount: createUI });
    });
  }
}());
