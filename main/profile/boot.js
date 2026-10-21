/**
 * @file main/profile/boot.js
 * @description Deterministic boot sequence:
 *   1. initialize profile metadata (idempotent, versioned)
 *   2. resolve the active profile for this tab
 *   3. open the profile-scoped VFS (same VFS code, isolated IndexedDB namespace)
 *   4. load + validate that profile's persisted state
 *   5. apply preferences before the desktop shell boots
 *   6. emit profile:ready / profile:state-loaded
 *
 * `window.ProfileReady` resolves only after all of the above. The shell's boot
 * block waits on it, so the desktop never renders the wrong profile's state.
 * It never rejects: storage failures degrade to defaults and are reported.
 */

(function (window, document) {
  'use strict';

  const FALLBACK_PROFILE = {
    id: 'guest',
    name: 'Guest',
    type: 'guest',
    username: 'guest',
    dbName: 'vfs-db-guest'
  };

  // Applied before the body is parsed so no un-themed / wrong-profile frame
  // flashes on screen.
  try {
    const style = document.createElement('style');
    style.id = 'profile-boot-style';
    style.textContent =
      'html.profile-booting body{visibility:hidden}' +
      'html.profile-hide-icons .desktop-icon{display:none!important}';
    (document.head || document.documentElement).appendChild(style);
  } catch (err) {
    console.warn('[ProfileBoot] Could not inject boot styles', err);
  }

  if (document.documentElement) {
    document.documentElement.classList.add('profile-booting');
  }

  function domReady() {
    return new Promise(function (resolve) {
      if (document.readyState !== 'loading') {
        resolve();
        return;
      }
      document.addEventListener('DOMContentLoaded', function () { resolve(); }, { once: true });
    });
  }

  function emit(type, detail) {
    try {
      document.dispatchEvent(new CustomEvent(type, { detail: detail || {} }));
    } catch (err) {
      console.warn('[ProfileBoot] Could not dispatch ' + type, err);
    }
  }

  async function boot() {
    let profile = FALLBACK_PROFILE;
    let state = null;

    try {
      await window.ProfileService.init();
      profile = window.ProfileService.resolveActive() || window.ProfileService.getProfile('guest');
      if (!profile) throw new Error('No usable profile resolved');
      window.ProfileService._rememberActive(profile);

      // Open the VFS for exactly this profile before anything reads window.VFS.
      const vfs = await window.VFSService.open(profile);
      if (!vfs) throw new Error('VFS did not initialize');

      state = await window.PersistenceService.loadProfileState(profile.id);

      // localStorage/sessionStorage keys must be in place before the shell's
      // modules read them on boot.
      window.PersistenceService.applyStoredPreferences(profile.id, state);

      await domReady();

      // Re-apply DOM-dependent preferences now that the shell markup exists.
      state = window.PersistenceService.applyDomState(profile.id, state);
      window.PersistenceService.bindAutoSave(profile.id);

      emit('profile:ready', { profile: profile, profileId: profile.id });
      emit('profile:state-loaded', {
        profileId: profile.id,
        state: state,
        restored: true
      });

      return profile;
    } catch (error) {
      console.error('[ProfileBoot] Boot failed; continuing with defaults.', error);
      emit('profile:state-error', {
        profileId: profile ? profile.id : null,
        operation: 'boot',
        error: error && error.message ? error.message : String(error)
      });
      // Degrade gracefully: keep whatever VFS we managed to open, if any.
      return profile;
    } finally {
      if (document.documentElement) {
        document.documentElement.classList.remove('profile-booting');
      }
    }
  }

  window.ProfileReady = boot();
  window.ProfileService.ready = window.ProfileReady;

  // Preserve the existing readiness contract: resolves to the open VFS.
  window.VirtualFSReady = window.ProfileReady.then(function () {
    return window.VFS || null;
  });

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : {});
