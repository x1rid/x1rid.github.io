/**
 * @file main/kernel/events.js
 * @layer L3 — Kernel
 * @owns  window.KernelEvents
 * @needs [ 'KernelClock', 'KernelLogger' ]
 * @emits [ 'domain:verb-noun', 'sys:log' ]
 *
 * Spec reference: OS_FOUNDATION.md §1 Rule 9, §5.4, §6.1, §6.3, §8 Phase 1.2
 *
 * Unified OS Pub/Sub Event Bus with bi-directional legacy alias bridges.
 * Guarantees standard event payload envelopes:
 *   { type, profileId, emittedAt, sequence, pid, ...data }
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031';

  // ── Mapping Table: Legacy <-> Canonical (§6.3) ──────────────────────────
  const LEGACY_TO_CANONICAL = Object.freeze({
    'node-created': 'fs:node-created',
    'node-updated': 'fs:node-updated',
    'node-renamed': 'fs:node-renamed',
    'node-moved': 'fs:node-moved',
    'node-recycled': 'fs:node-recycled',
    'node-restored': 'fs:node-restored',
    'node-deleted': 'fs:node-deleted',

    'site:applaunch': 'proc:spawned',
    'site:appopen': 'win:opened',
    'site:appclose': 'proc:exited',
    'site:appactivate': 'win:focused',

    'system:file-opened': 'fs:file-opened',
    'system:file-saved': 'fs:file-saved',
    'system:notification': 'sys:notification'
  });

  const CANONICAL_TO_LEGACY = {};
  for (const leg in LEGACY_TO_CANONICAL) {
    if (Object.prototype.hasOwnProperty.call(LEGACY_TO_CANONICAL, leg)) {
      CANONICAL_TO_LEGACY[LEGACY_TO_CANONICAL[leg]] = leg;
    }
  }
  Object.freeze(CANONICAL_TO_LEGACY);

  function getCanonical(topic) {
    return LEGACY_TO_CANONICAL[topic] || topic;
  }

  function getLegacy(topic) {
    return CANONICAL_TO_LEGACY[topic] || null;
  }

  let _sequence = 0;
  const _listeners = new Map(); // topic -> Set<{ fn, once, pid }>
  let _totalEmitted = 0;
  let _listenerErrors = 0;

  function getTime() {
    if (root.KernelClock && typeof root.KernelClock.now === 'function') {
      return root.KernelClock.now();
    }
    return Date.now();
  }

  function getActiveProfileId() {
    if (root.ProfileService && typeof root.ProfileService.getActiveId === 'function') {
      return root.ProfileService.getActiveId();
    }
    return null;
  }

  function on(rawTopic, handler, options) {
    if (typeof handler !== 'function') {
      throw new TypeError('KernelEvents.on requires a function');
    }
    const topic = String(rawTopic);
    if (!_listeners.has(topic)) {
      _listeners.set(topic, new Set());
    }

    const record = {
      fn: handler,
      once: Boolean(options && options.once),
      pid: options && typeof options.pid === 'number' ? options.pid : null
    };

    _listeners.get(topic).add(record);

    let unsubscribed = false;
    return function unsubscribe() {
      if (unsubscribed) return;
      unsubscribed = true;
      const set = _listeners.get(topic);
      if (set) {
        set.delete(record);
        if (set.size === 0) {
          _listeners.delete(topic);
        }
      }
    };
  }

  function once(topic, handler, options) {
    const opts = Object.assign({}, options, { once: true });
    return on(topic, handler, opts);
  }

  function dispatchToTopic(targetTopic, envelope) {
    const set = _listeners.get(targetTopic);
    if (!set || set.size === 0) return;

    const toCall = Array.from(set);
    for (let i = 0; i < toCall.length; i += 1) {
      const rec = toCall[i];
      if (rec.once) {
        set.delete(rec);
      }
      try {
        rec.fn(envelope);
      } catch (err) {
        _listenerErrors += 1;
        if (root.KernelLogger && typeof root.KernelLogger.error === 'function') {
          root.KernelLogger.error('events', 'Listener error on topic: ' + targetTopic, {
            message: err && err.message,
            stack: err && err.stack
          });
        }
      }
    }
    if (set.size === 0) {
      _listeners.delete(targetTopic);
    }
  }

  function emit(rawTopic, payload, meta) {
    const topic = String(rawTopic);
    const canonical = getCanonical(topic);
    const legacy = getLegacy(canonical);

    _sequence += 1;
    _totalEmitted += 1;

    const metaObj = (meta && typeof meta === 'object') ? meta : {};
    const dataObj = (payload && typeof payload === 'object') ? payload : { value: payload };

    const envelope = Object.assign(
      {},
      dataObj,
      {
        type: canonical,
        profileId: metaObj.profileId !== undefined ? metaObj.profileId : getActiveProfileId(),
        emittedAt: metaObj.emittedAt !== undefined ? metaObj.emittedAt : getTime(),
        sequence: _sequence,
        pid: metaObj.pid !== undefined ? metaObj.pid : null
      }
    );

    // 1. Dispatch to canonical subscribers
    dispatchToTopic(canonical, envelope);

    // 2. Dispatch to legacy alias subscribers if different
    if (legacy && legacy !== canonical) {
      dispatchToTopic(legacy, envelope);
    }

    // 3. Dispatch to exact raw topic if raw topic wasn't in dictionary
    if (topic !== canonical && topic !== legacy) {
      dispatchToTopic(topic, envelope);
    }

    return envelope;
  }

  function bridgeDom(target) {
    const targetEl = target || (typeof document !== 'undefined' ? document : null);
    if (!targetEl || typeof targetEl.addEventListener !== 'function') return function () {};

    const domHandler = function (e) {
      if (e && e.detail && e.detail._fromKernelBus) return;
      emit(e.type, e.detail || {});
    };

    const registeredTypes = Object.keys(LEGACY_TO_CANONICAL).concat([
      'vfs:opened', 'profile:ready', 'profile:changed', 'profile:locked', 'profile:unlocked'
    ]);

    for (let i = 0; i < registeredTypes.length; i += 1) {
      targetEl.addEventListener(registeredTypes[i], domHandler);
    }

    return function unbridgeDom() {
      for (let i = 0; i < registeredTypes.length; i += 1) {
        targetEl.removeEventListener(registeredTypes[i], domHandler);
      }
    };
  }

  function removeByPid(pid) {
    if (typeof pid !== 'number') return;
    _listeners.forEach(function (set, topic) {
      Array.from(set).forEach(function (rec) {
        if (rec.pid === pid) {
          set.delete(rec);
        }
      });
      if (set.size === 0) {
        _listeners.delete(topic);
      }
    });
  }

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  const KernelEvents = Object.freeze({
    version: VERSION,
    ready: ready,

    on: on,
    once: once,
    emit: emit,
    bridgeDom: bridgeDom,
    removeByPid: removeByPid,

    getCanonicalTopic: getCanonical,
    getLegacyTopic: getLegacy,

    diagnostics: function () {
      const topicCounts = {};
      _listeners.forEach(function (set, topic) {
        topicCounts[topic] = set.size;
      });
      return {
        version: VERSION,
        topicsRegistered: _listeners.size,
        totalEmitted: _totalEmitted,
        sequence: _sequence,
        listenerErrors: _listenerErrors,
        activeSubscriptions: topicCounts
      };
    }
  });

  // Connect KernelLogger to KernelEvents bus if available
  if (root.KernelLogger && typeof root.KernelLogger.connectBus === 'function') {
    root.KernelLogger.connectBus(function (topic, data) {
      emit(topic, data);
    });
  }

  root.KernelEvents = KernelEvents;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KernelEvents: KernelEvents };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
