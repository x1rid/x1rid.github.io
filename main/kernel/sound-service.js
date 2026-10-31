/**
 * @file main/kernel/sound-service.js
 * @layer L3 — Kernel
 * @owns  window.SoundService
 * @needs [ 'KernelDB', 'KernelEvents' ]
 * @emits [ 'sound:pack-changed', 'sound:played' ]
 *
 * Phase 5.4 — Sound Pack System.
 * Maps event names to audio files. Audio is optional — missing files are silently skipped.
 * Sound packs defined in data/sound-packs.json or registered at runtime.
 *
 * Node-loadable for unit testing.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031.p5.4';

  let _activePack = 'silent';
  let _packs = {
    silent: { id: 'silent', name: 'Silent', sounds: {} }
  };

  let readyResolve;
  const ready = new Promise(function (r) { readyResolve = r; });

  function emit(event, payload) {
    if (root.KernelEvents && typeof root.KernelEvents.emit === 'function') {
      root.KernelEvents.emit(event, payload);
    }
  }

  /**
   * Register a sound pack definition.
   * @param {object} pack  { id, name, sounds: { eventName: audioUrl } }
   */
  function registerPack(pack) {
    if (!pack || !pack.id) return;
    _packs[pack.id] = pack;
  }

  /**
   * Switch active sound pack.
   * @param {string} packId
   */
  function setPack(packId) {
    if (!_packs[packId]) return;
    _activePack = packId;
    emit('sound:pack-changed', { packId: packId });
  }

  /**
   * Play a named sound event (no-op if audio unavailable or pack is silent).
   * @param {string} eventName
   */
  function play(eventName) {
    const pack = _packs[_activePack];
    if (!pack || !pack.sounds) return;
    const url = pack.sounds[eventName];
    if (!url) return;
    if (typeof Audio !== 'undefined') {
      try {
        const audio = new Audio(url);
        audio.volume = 0.5;
        audio.play().catch(function () { /* user gesture required — ignore */ });
        emit('sound:played', { pack: _activePack, event: eventName });
      } catch (e) { /* ok */ }
    }
  }

  /**
   * List registered packs.
   */
  function list() {
    return Object.keys(_packs).map(function (id) {
      return { id: id, name: _packs[id].name || id };
    });
  }

  function getActivePack() { return _activePack; }

  const SoundService = Object.freeze({
    version: VERSION,
    ready: ready,
    registerPack: registerPack,
    setPack: setPack,
    play: play,
    list: list,
    getActivePack: getActivePack,
    diagnostics: function () {
      return { version: VERSION, activePack: _activePack, packCount: Object.keys(_packs).length };
    }
  });

  root.SoundService = SoundService;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SoundService: SoundService };
  }
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
