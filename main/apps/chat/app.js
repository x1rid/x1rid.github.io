/* Chat App — main/apps/chat/app.js
 * Manifest app. IRC-style rooms over FakeInternet.
 */
(function () {
  'use strict';

  const APP_ID = 'chat';
  const ROOMS = ['#general', '#dev', '#random'];

  function createUI(win) {
    const root = win.root;
    root.innerHTML = '';
    root.style.cssText = 'display:flex;height:100%;font-family:monospace;background:#0d0d0d;color:#e0e0e0;';

    const sidebar = document.createElement('div');
    sidebar.style.cssText = 'width:140px;border-right:1px solid #333;padding:8px;';
    const roomsLabel = document.createElement('div');
    roomsLabel.style.cssText = 'font-size:11px;color:#888;letter-spacing:1px;margin-bottom:6px;';
    roomsLabel.textContent = 'CHANNELS';
    sidebar.appendChild(roomsLabel);

    const main = document.createElement('div');
    main.style.cssText = 'flex:1;display:flex;flex-direction:column;';
    const header = document.createElement('div');
    header.style.cssText = 'padding:6px 12px;border-bottom:1px solid #333;font-size:11px;color:#888;letter-spacing:1px;';
    header.textContent = '#general';
    const log = document.createElement('div');
    log.style.cssText = 'flex:1;overflow-y:auto;padding:8px;font-size:12px;';
    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;border-top:1px solid #333;';
    const input = document.createElement('input');
    input.style.cssText = 'flex:1;background:#111;border:none;color:#e0e0e0;padding:6px;font-family:monospace;outline:none;';
    input.placeholder = 'Type a message…';
    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send';
    sendBtn.style.cssText = 'background:#6c63ff;color:#fff;border:none;padding:6px 12px;cursor:pointer;font-family:monospace;';
    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);
    main.appendChild(header);
    main.appendChild(log);
    main.appendChild(inputRow);

    let activeRoom = '#general';
    const roomMessages = {};
    ROOMS.forEach(function (r) { roomMessages[r] = []; });

    // Seed welcome message
    ROOMS.forEach(function (r) {
      roomMessages[r].push({ user: 'system', text: 'Welcome to ' + r + '!', ts: Date.now() });
    });

    function appendMsg(room, msg) {
      roomMessages[room].push(msg);
      if (room === activeRoom) renderRoom(room);
    }

    function renderRoom(room) {
      header.textContent = room;
      log.innerHTML = '';
      (roomMessages[room] || []).forEach(function (msg) {
        const line = document.createElement('div');
        line.style.cssText = 'margin-bottom:2px;';
        line.innerHTML = '<span style="color:#6c63ff;">' + msg.user + '</span>: ' + msg.text;
        log.appendChild(line);
      });
      log.scrollTop = log.scrollHeight;
    }

    function switchRoom(room) {
      activeRoom = room;
      renderRoom(room);
    }

    ROOMS.forEach(function (room) {
      const btn = document.createElement('button');
      btn.textContent = room;
      btn.style.cssText = 'display:block;width:100%;background:none;border:none;color:#e0e0e0;text-align:left;padding:4px;cursor:pointer;font-family:monospace;font-size:12px;';
      btn.addEventListener('click', function () { switchRoom(room); });
      sidebar.appendChild(btn);
    });

    function doSend() {
      const text = input.value.trim();
      if (!text) return;
      appendMsg(activeRoom, { user: 'you', text: text, ts: Date.now() });
      input.value = '';
      // Simulate a bot reply after a short delay
      setTimeout(function () {
        appendMsg(activeRoom, { user: 'r3dos-bot', text: 'Got it: "' + text.substring(0, 30) + '"', ts: Date.now() });
      }, 600);
    }

    sendBtn.addEventListener('click', doSend);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSend(); });

    root.appendChild(sidebar);
    root.appendChild(main);
    renderRoom(activeRoom);
  }

  if (typeof window !== 'undefined' && window.OSApps && typeof window.OSApps.register === 'function') {
    window.OSApps.register(APP_ID, { mount: createUI });
  } else if (typeof window !== 'undefined') {
    window.addEventListener('os:apps-ready', function () {
      if (window.OSApps) window.OSApps.register(APP_ID, { mount: createUI });
    });
  }
}());
