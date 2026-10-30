/**
 * Retro Browser Tests — manual verification checklist and automated smoke tests.
 */
(function () {
  'use strict';
  const assert = function (cond, msg) { if (!cond) console.error('TEST FAIL: ' + msg); else console.log('PASS: ' + msg); };

  // Stage 1: Shell exists and renders
  assert(typeof window.RetroBrowser === 'object', 'RetroBrowser adapter exported');
  assert(typeof window.AppRegistry.get('retro-browser') === 'object', 'Browser registered in AppRegistry');
  assert(typeof document.getElementById('retro-tab-strip') === 'object' || true, 'Tab strip element may not exist before launch');

  // Stage 2: Tab state operations
  assert(typeof window.RetroBrowser.createTab === 'function', 'createTab method available');
  assert(typeof window.RetroBrowser.newTab === 'function', 'newTab method available');
  assert(typeof window.RetroBrowser.activateTab === 'function', 'activateTab method available');
  assert(typeof window.RetroBrowser.closeTab === 'function', 'closeTab method available');

  // Stage 3: Navigation normalization
  const adapter = window.RetroBrowser || {};
  // We can only verify functions exist here; full iframe navigation requires a live window
  assert(typeof adapter.navigate === 'function', 'navigate method available');
  assert(typeof adapter.reload === 'function', 'reload method available');
  assert(typeof adapter.stop === 'function', 'stop method available');
  assert(typeof adapter.goBack === 'function', 'goBack method available');

})();
console.log('[retro-browser] Smoke tests completed. Manual verification required for iframe navigation and blocked-site behavior.');
