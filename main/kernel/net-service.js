/**
 * @file main/kernel/net-service.js
 * @layer L3 — Kernel
 * @owns  window.NetService
 * @needs [ 'KernelEvents', 'KernelDB', 'FakeInternet' ]
 * @emits [ 'net:request-sent', 'net:response-received', 'net:offline' ]
 *
 * Phase 5.1 — Virtual Network Service.
 * All "network" traffic inside the OS is routed through this service.
 * Real outbound requests are blocked. All responses come from FakeInternet
 * route handlers or the built-in 503 fallback.
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p5.1';

  let _online = true;
  let _requestCount = 0;
  let _errorCount = 0;

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  function emit(event, payload) {
    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit(event, payload);
    }
  }

  /**
   * Make a virtual HTTP-like request.
   * @param {string} url  e.g. 'http://store.r3dos.internal/packages'
   * @param {object} [opts]  { method, headers, body }
   * @returns {Promise<{ status, headers, body, ok }>}
   */
  async function request(url, opts) {
    opts = opts || {};
    const method = (opts.method || 'GET').toUpperCase();
    _requestCount += 1;
    const reqId = _requestCount;

    emit('net:request-sent', { reqId: reqId, url: url, method: method });

    if (!_online) {
      _errorCount += 1;
      emit('net:offline', { reqId: reqId, url: url });
      return { status: 503, headers: {}, body: 'Network offline', ok: false };
    }

    let response;
    try {
      if (root.FakeInternet && typeof root.FakeInternet.route === 'function') {
        response = await root.FakeInternet.route(url, { method: method, headers: opts.headers || {}, body: opts.body });
      } else {
        response = { status: 404, headers: {}, body: 'FakeInternet not available', ok: false };
      }
    } catch (e) {
      _errorCount += 1;
      response = { status: 500, headers: {}, body: String(e && e.message ? e.message : e), ok: false };
    }

    if (!Object.prototype.hasOwnProperty.call(response, 'ok')) {
      response.ok = response.status >= 200 && response.status < 300;
    }

    emit('net:response-received', { reqId: reqId, url: url, status: response.status, ok: response.ok });
    return response;
  }

  function setOnline(val) {
    _online = !!val;
    emit('net:online-changed', { online: _online });
  }

  function isOnline() { return _online; }

  const NetService = Object.freeze({
    version: VERSION,
    ready: ready,
    request: request,
    setOnline: setOnline,
    isOnline: isOnline,
    diagnostics: function () {
      return {
        version: VERSION,
        online: _online,
        requestCount: _requestCount,
        errorCount: _errorCount
      };
    }
  });

  root.NetService = NetService;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NetService: NetService };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
