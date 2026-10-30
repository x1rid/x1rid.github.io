/**
 * @file main/kernel/platform/logger.js
 * @layer L0 — Platform
 * @owns  window.KernelLogger
 * @needs [] — safe before event bus exists
 * @emits [ 'sys:log' ] (via connected bus)
 *
 * Spec reference: OS_FOUNDATION.md §6.1, §6.3, §12
 *
 * Safe time-zero logger. Buffers logs prior to event bus initialization.
 * When Kernel.events or a bus adapter connects via connectBus(emitFn),
 * the buffer drains into the bus on topic 'sys:log'.
 *
 * Node-loadable for unit testing via standard guard.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031';
  const MAX_BUFFER = 200;

  const LogLevel = Object.freeze({
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  });

  const LEVEL_NAMES = ['debug', 'info', 'warn', 'error'];

  let _currentLevel = LogLevel.INFO;
  const _buffer = [];
  let _busEmit = null;
  let _totalLogged = 0;

  function getTime() {
    if (root.KernelClock && typeof root.KernelClock.now === 'function') {
      return root.KernelClock.now();
    }
    return Date.now();
  }

  function log(levelStr, tag, message, data) {
    const levelVal = LogLevel[levelStr.toUpperCase()] !== undefined ? LogLevel[levelStr.toUpperCase()] : LogLevel.INFO;
    _totalLogged += 1;

    const entry = {
      timestamp: getTime(),
      level: levelStr.toLowerCase(),
      tag: String(tag || 'system'),
      message: String(message || ''),
      data: (data !== undefined && data !== null) ? data : null
    };

    if (levelVal >= _currentLevel) {
      _buffer.push(entry);
      if (_buffer.length > MAX_BUFFER) {
        _buffer.shift();
      }
    }

    if (_busEmit && typeof _busEmit === 'function') {
      try {
        _busEmit('sys:log', entry);
      } catch (err) {
        // Prevent recursive logger failure
      }
    }

    return entry;
  }

  function setLevel(lvl) {
    const key = String(lvl).toUpperCase();
    if (LogLevel[key] !== undefined) {
      _currentLevel = LogLevel[key];
    }
  }

  function connectBus(emitFn) {
    _busEmit = emitFn;
    if (_busEmit && typeof _busEmit === 'function' && _buffer.length > 0) {
      // Drain existing buffered entries
      const toDrain = _buffer.slice();
      for (let i = 0; i < toDrain.length; i += 1) {
        try {
          _busEmit('sys:log', toDrain[i]);
        } catch (_) {}
      }
    }
  }

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  const KernelLogger = Object.freeze({
    version: VERSION,
    ready: ready,

    debug: function (tag, msg, data) { return log('debug', tag, msg, data); },
    info: function (tag, msg, data) { return log('info', tag, msg, data); },
    warn: function (tag, msg, data) { return log('warn', tag, msg, data); },
    error: function (tag, msg, data) { return log('error', tag, msg, data); },

    setLevel: setLevel,
    connectBus: connectBus,

    getEntries: function (level, limit) {
      let res = _buffer;
      if (level) {
        const lvlStr = String(level).toLowerCase();
        res = res.filter(function (e) { return e.level === lvlStr; });
      }
      if (typeof limit === 'number' && limit > 0) {
        res = res.slice(-limit);
      }
      return res.slice(); // Return shallow copy
    },

    diagnostics: function () {
      return {
        version: VERSION,
        level: LEVEL_NAMES[_currentLevel] || 'unknown',
        bufferCount: _buffer.length,
        totalLogged: _totalLogged,
        busConnected: Boolean(_busEmit)
      };
    }
  });

  root.KernelLogger = KernelLogger;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KernelLogger: KernelLogger, LogLevel: LogLevel };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
