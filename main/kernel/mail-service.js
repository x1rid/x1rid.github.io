/**
 * @file main/kernel/mail-service.js
 * @layer L3 — Kernel
 * @owns  window.MailService
 * @needs [ 'KernelDB', 'KernelEvents', 'NetService' ]
 * @emits [ 'mail:received', 'mail:sent', 'mail:read' ]
 *
 * Phase 5.2 — In-OS Mail Service.
 * In-memory mailbox per profile, persisted to KernelDB store `mailbox`.
 * Uses NetService to route outbound mail through FakeInternet.
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p5.2';
  const STORE = 'mailbox';
  const SCHEMA_VERSION = 1;

  // In-memory mailbox fallback (used in Node test environment)
  let _memStore = [];
  let _nextId = 1;

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  function emit(event, payload) {
    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit(event, payload);
    }
  }

  function _makeId() {
    return 'msg-' + Date.now() + '-' + (_nextId++);
  }

  async function _dbAppend(msg) {
    if (root.KernelDB && typeof root.KernelDB.append === 'function') {
      try { await root.KernelDB.append(STORE, msg); return; } catch (e) { /* fallback */ }
    }
    _memStore.push(msg);
  }

  async function _dbGetAll() {
    if (root.KernelDB && typeof root.KernelDB.getAll === 'function') {
      try { return await root.KernelDB.getAll(STORE); } catch (e) { /* fallback */ }
    }
    return _memStore.slice();
  }

  async function _dbPut(msg) {
    if (root.KernelDB && typeof root.KernelDB.put === 'function') {
      try { await root.KernelDB.put(STORE, msg); return; } catch (e) { /* fallback */ }
    }
    const idx = _memStore.findIndex(function (m) { return m.id === msg.id; });
    if (idx >= 0) _memStore[idx] = msg; else _memStore.push(msg);
  }

  /**
   * Send a message to a recipient (routed through FakeInternet).
   * @param {object} opts  { to, subject, body }
   */
  async function send(opts) {
    opts = opts || {};
    const msg = {
      id: _makeId(),
      schemaVersion: SCHEMA_VERSION,
      from: 'user@r3dos.internal',
      to: opts.to || 'nobody@r3dos.internal',
      subject: opts.subject || '(no subject)',
      body: opts.body || '',
      date: new Date().toISOString(),
      read: true,
      direction: 'sent'
    };

    if (root.NetService && typeof root.NetService.request === 'function') {
      try {
        await root.NetService.request('http://mail.r3dos.internal/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ to: msg.to, subject: msg.subject, body: msg.body })
        });
      } catch (e) { /* swallow — fire-and-forget */ }
    }

    await _dbAppend(msg);
    emit('mail:sent', { id: msg.id, to: msg.to, subject: msg.subject });
    return msg;
  }

  /**
   * List all messages in mailbox.
   */
  async function list() {
    return _dbGetAll();
  }

  /**
   * Mark a message as read.
   */
  async function read(id) {
    const all = await _dbGetAll();
    const msg = all.find(function (m) { return m.id === id; });
    if (!msg) return null;
    msg.read = true;
    await _dbPut(msg);
    emit('mail:read', { id: id });
    return msg;
  }

  /**
   * Receive a fake incoming message (called internally or from FakeInternet push).
   */
  async function receive(opts) {
    opts = opts || {};
    const msg = {
      id: _makeId(),
      schemaVersion: SCHEMA_VERSION,
      from: opts.from || 'system@r3dos.internal',
      to: 'user@r3dos.internal',
      subject: opts.subject || '(no subject)',
      body: opts.body || '',
      date: new Date().toISOString(),
      read: false,
      direction: 'received'
    };
    await _dbAppend(msg);
    emit('mail:received', { id: msg.id, from: msg.from, subject: msg.subject });
    return msg;
  }

  const MailService = Object.freeze({
    version: VERSION,
    ready: ready,
    send: send,
    list: list,
    read: read,
    receive: receive,
    diagnostics: function () {
      return { version: VERSION, storeKey: STORE, schemaVersion: SCHEMA_VERSION };
    }
  });

  root.MailService = MailService;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MailService: MailService };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
