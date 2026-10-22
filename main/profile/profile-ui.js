/**
 * @file main/profile/profile-ui.js
 * @description Lock-screen / profile-switcher integration.
 *
 * Uses the shell's existing `#lock-screen` element when present (root
 * index.html) and augments it with profile choices. On pages without a lock
 * screen the service still works; Guest simply boots automatically.
 *
 * PUBLIC API (window.ProfileUI)
 *   await ready                 → resolves after the lock UI is wired
 *   unlock()                    → attempts to unlock the active profile
 *   lock()                      → re-locks the active profile
 *   openSwitcher()              → shows the lock screen for profile switching
 *   isLocked()                  → boolean
 */

(function (window, document) {
  'use strict';

  const STYLE_ID = 'profile-ui-style';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.profile-switcher{display:flex;gap:8px;justify-content:center;margin-top:18px;flex-wrap:wrap}',
      '.profile-chip{display:flex;align-items:center;gap:8px;padding:7px 12px;border:1px solid var(--line-hi,#6f3a93);',
      'background:rgba(7,2,10,.62);color:var(--ink-90,#f2eaff);font:700 11px/1 "Cascadia Mono","Courier New",monospace;',
      'letter-spacing:.12em;text-transform:uppercase;cursor:pointer;border-radius:2px}',
      '.profile-chip:hover,.profile-chip.is-active{border-color:var(--signal-active,#c084fc);color:var(--signal-active,#c084fc)}',
      '.profile-chip .profile-chip-dot{width:7px;height:7px;border-radius:50%;background:var(--signal-ok,#55ff99)}',
      '.profile-chip.is-locked .profile-chip-dot{background:var(--signal-hot,#ff4fd8)}',
      '.profile-prompt{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:100001;',
      'width:min(340px,86vw);padding:18px;border:1px solid var(--line-hi,#6f3a93);background:#0b061d;',
      'box-shadow:0 18px 60px rgba(0,0,0,.7);font:12px/1.5 "Cascadia Mono","Courier New",monospace;color:#f2eaff}',
      '.profile-prompt h2{margin:0 0 4px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#c084fc}',
      '.profile-prompt p{margin:0 0 12px;color:#8b72b8;font-size:11px}',
      '.profile-prompt input{width:100%;box-sizing:border-box;margin-bottom:8px;padding:7px 8px;border:1px solid #4d286b;',
      'background:#07020a;color:#f2eaff;font:inherit;outline:none}',
      '.profile-prompt input:focus{border-color:#c084fc}',
      '.profile-prompt .profile-error{min-height:14px;color:#ff4fd8;font-size:10px;margin-bottom:6px}',
      '.profile-prompt .profile-actions{display:flex;gap:8px;justify-content:flex-end}',
      '.profile-prompt button{padding:5px 12px;border:1px solid #6f3a93;background:#130927;color:#f2eaff;font:inherit;',
      'font-size:10px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}',
      '.profile-prompt button[type="submit"]{border-color:#c084fc;color:#c084fc}',
      '.profile-prompt button:hover{background:#1c0e36}',
      '.profile-prompt-backdrop{position:fixed;inset:0;z-index:100000;background:rgba(3,1,7,.72)}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function el(tag, attrs, text) {
    const node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    if (text != null) node.textContent = text;
    return node;
  }

  const ProfileUI = {
    _profile: null,
    _prompt: null,
    _backdrop: null,
    _locked: true,
    ready: null,

    async _init() {
      injectStyles();
      await (window.ProfileService && window.ProfileService.ready
        ? window.ProfileService.ready
        : Promise.resolve());
      this._profile = window.ProfileService ? window.ProfileService.getActiveProfile() : null;
      this._augmentLockScreen();
      this._wireTray();
      this._renderSwitcher();

      // Guests are password-free: continue straight into the session. The
      // owner profile always requires the password gate (unless already
      // unlocked for this tab).
      if (this._profile && this._profile.type === 'guest') {
        this._setLocked(false);
      } else if (this._profile && window.ProfileService.isUnlocked(this._profile.id)) {
        this._setLocked(false);
      } else {
        this._setLocked(true);
      }
    },

    _lockScreen() {
      return document.getElementById('lock-screen');
    },

    _augmentLockScreen() {
      const lockScreen = this._lockScreen();
      if (!lockScreen) return;
      const user = lockScreen.querySelector('.lock-user');
      if (user && this._profile) user.textContent = this._profile.name;
      const hint = lockScreen.querySelector('.lock-hint');
      if (hint) {
        hint.textContent = this._profile && this._profile.type === 'owner'
          ? 'Owner profile — password required'
          : 'Press any key or click Sign In to continue as Guest';
      }
    },

    _renderSwitcher() {
      const lockScreen = this._lockScreen();
      if (!lockScreen) return;
      let holder = lockScreen.querySelector('.profile-switcher');
      if (!holder) {
        holder = el('div', { class: 'profile-switcher' });
        const middle = lockScreen.querySelector('.lock-middle') || lockScreen;
        middle.appendChild(holder);
      }
      holder.replaceChildren();

      const self = this;
      (window.ProfileService ? window.ProfileService.getProfiles() : []).forEach(function (profile) {
        const active = self._profile && self._profile.id === profile.id;
        const locked = profile.type === 'owner' && !window.ProfileService.isUnlocked('owner');
        const button = el('button', {
          type: 'button',
          class: 'profile-chip' + (active ? ' is-active' : '') + (locked ? ' is-locked' : ''),
          'data-profile-id': profile.id,
          title: profile.description || profile.name
        });
        button.appendChild(el('span', { class: 'profile-chip-dot', 'aria-hidden': 'true' }));
        button.appendChild(el('span', null, profile.name));
        button.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          self.selectProfile(profile.id);
        });
        holder.appendChild(button);
      });
    },

    async selectProfile(profileId) {
      const profile = window.ProfileService.getProfile(profileId);
      if (!profile) return;
      if (window.ProfileWindowState && typeof window.ProfileWindowState.flushActive === 'function') {
        try {
          await window.ProfileWindowState.flushActive();
        } catch (_error) {
          // PersistenceService reports its own failures; switching still proceeds.
        }
      }
      const active = this._profile;

      if (profile.type === 'guest') {
        if (active && active.id === 'guest') {
          this._setLocked(false);
          return;
        }
        await window.ProfileService.setActiveProfile('guest');
        return;
      }

      // Owner: already active → unlock in place. Otherwise authenticate and
      // then switch (switch flushes the outgoing profile and reloads).
      if (active && active.id === 'owner') {
        if (window.ProfileService.isUnlocked('owner')) {
          this._setLocked(false);
        } else {
          this._promptPassword({ mode: 'unlock' });
        }
        return;
      }
      this._promptPassword({ mode: window.ProfileService.hasOwnerPassword() ? 'unlock' : 'setup' });
    },

    _promptPassword(options) {
      this._closePrompt();
      const mode = options && options.mode === 'setup' ? 'setup' : 'unlock';
      const self = this;

      const backdrop = el('div', { class: 'profile-prompt-backdrop' });
      const panel = el('form', { class: 'profile-prompt', role: 'dialog', 'aria-modal': 'true' });
      const title = el('h2', null, mode === 'setup' ? 'Protect the owner profile' : 'Owner sign-in');
      const copy = el('p', null, mode === 'setup'
        ? 'Choose a local password for r3d1bruh. It is stored as a salted hash and is a UI gate only.'
        : 'Enter the owner password to continue.');

      const password = el('input', {
        type: 'password',
        id: 'profile-password',
        placeholder: 'Password',
        autocomplete: mode === 'setup' ? 'new-password' : 'current-password',
        required: 'required'
      });
      const confirm = el('input', {
        type: 'password',
        id: 'profile-password-confirm',
        placeholder: 'Confirm password',
        autocomplete: 'new-password'
      });
      const error = el('div', { class: 'profile-error', role: 'alert' });
      const actions = el('div', { class: 'profile-actions' });
      const cancel = el('button', { type: 'button' }, 'Cancel');
      const submit = el('button', { type: 'submit' }, mode === 'setup' ? 'Set password' : 'Unlock');

      actions.appendChild(cancel);
      actions.appendChild(submit);
      panel.appendChild(title);
      panel.appendChild(copy);
      panel.appendChild(password);
      if (mode === 'setup') {
        panel.appendChild(confirm);
      }
      panel.appendChild(error);
      panel.appendChild(actions);
      backdrop.appendChild(panel);
      document.body.appendChild(backdrop);
      this._prompt = panel;
      this._backdrop = backdrop;

      setTimeout(function () { password.focus(); }, 0);

      cancel.addEventListener('click', function (event) {
        event.preventDefault();
        self._closePrompt();
      });

      panel.addEventListener('submit', async function (event) {
        event.preventDefault();
        error.textContent = '';
        const value = password.value;
        if (!value) {
          error.textContent = 'Password required.';
          return;
        }
        if (mode === 'setup' && value !== confirm.value) {
          error.textContent = 'Passwords do not match.';
          return;
        }
        submit.disabled = true;
        try {
          if (mode === 'setup') {
            if (window.ProfileService.hasOwnerPassword()) {
              throw new Error('An owner password already exists.');
            }
            await window.ProfileService.setOwnerPassword(value);
          } else {
            const result = await window.ProfileService.unlock('owner', value);
            if (!result.ok) {
              error.textContent = result.needsSetup
                ? 'No owner password is configured yet.'
                : 'Incorrect password.';
              submit.disabled = false;
              password.select();
              return;
            }
          }

          const active = self._profile;
          if (active && active.id === 'owner') {
            self._setLocked(false);
            self._closePrompt();
            self._renderSwitcher();
            self._augmentLockScreen();
          } else {
            // Reload into the owner profile after the outgoing state flushes.
            self._closePrompt();
            await window.ProfileService.setActiveProfile('owner');
          }
        } catch (err) {
          error.textContent = err && err.message ? err.message : 'Authentication failed.';
          submit.disabled = false;
        }
      });
    },

    _closePrompt() {
      if (this._backdrop && this._backdrop.parentNode) {
        this._backdrop.parentNode.removeChild(this._backdrop);
      }
      this._backdrop = null;
      this._prompt = null;
    },

    _wireTray() {
      // Add a compact profile indicator next to the Start-menu lock button if
      // the shell provides one. Purely additive; never required.
      const lockButton = document.getElementById('start-lock-btn');
      if (!lockButton || document.getElementById('profile-tray-btn')) return;
      const self = this;
      const button = el('button', {
        id: 'profile-tray-btn',
        type: 'button',
        class: 'start-lock-btn',
        title: 'Switch profile',
        style: 'background:transparent;border:1px solid rgba(192,132,252,.3);color:#d8b4fe;' +
          'padding:4px 10px;font-family:inherit;font-size:11px;cursor:pointer;border-radius:3px;' +
          'display:flex;align-items:center;gap:6px;'
      }, 'PROFILE: ' + (this._profile ? this._profile.name.toUpperCase() : 'GUEST'));
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        self.openSwitcher();
      });
      lockButton.parentNode.insertBefore(button, lockButton.nextSibling);
    },

    _setLocked(locked) {
      this._locked = Boolean(locked);
      const lockScreen = this._lockScreen();
      if (lockScreen) {
        lockScreen.classList.toggle('is-unlocked', !this._locked);
        if (this._locked) lockScreen.removeAttribute('aria-hidden');
        else lockScreen.setAttribute('aria-hidden', 'true');
      }

      const root = document.documentElement;
      if (root) root.classList.toggle('profile-locked', this._locked);

      [document.getElementById('desktop'), document.getElementById('taskbar')].forEach((node) => {
        if (!node) return;
        if (this._locked) {
          node.setAttribute('inert', '');
          node.setAttribute('aria-hidden', 'true');
        } else {
          node.removeAttribute('inert');
          node.removeAttribute('aria-hidden');
        }
      });

      if (lockScreen && this._locked) {
        const active = document.activeElement;
        if (active && typeof active.closest === 'function' &&
            active.closest('#desktop, #taskbar') && typeof active.blur === 'function') {
          active.blur();
        }
        const signIn = lockScreen.querySelector('#lock-signin-btn');
        if (signIn && typeof signIn.focus === 'function') {
          window.setTimeout(function () {
            signIn.focus({ preventScroll: true });
          }, 0);
        }
      } else if (lockScreen && document.activeElement &&
                 lockScreen.contains(document.activeElement) &&
                 typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
    },

    isLocked() {
      return this._locked;
    },

    unlock() {
      if (!this._profile) {
        this._setLocked(false);
        return;
      }
      if (this._profile.type === 'guest' || window.ProfileService.isUnlocked(this._profile.id)) {
        this._setLocked(false);
        return;
      }
      this._promptPassword({ mode: window.ProfileService.hasOwnerPassword() ? 'unlock' : 'setup' });
    },

    lock() {
      if (!this._profile) return;
      if (window.ProfileWindowState && typeof window.ProfileWindowState.flushActive === 'function') {
        window.ProfileWindowState.flushActive();
      }
      window.ProfileService.lock(this._profile.id);
      this._setLocked(true);
    },

    openSwitcher() {
      const lockScreen = this._lockScreen();
      if (!lockScreen) {
        // No lock UI on this page: fall back to Guest if the owner is locked.
        if (this._profile && this._profile.type === 'owner' &&
            !window.ProfileService.isUnlocked('owner')) {
          window.ProfileService.setActiveProfile('guest');
        }
        return;
      }
      if (window.ProfileWindowState && typeof window.ProfileWindowState.flushActive === 'function') {
        window.ProfileWindowState.flushActive();
      }
      this._setLocked(true);
      this._renderSwitcher();
      this._augmentLockScreen();
    }
  };

  window.ProfileUI = ProfileUI;
  ProfileUI.ready = ProfileUI._init().catch(function (err) {
    console.error('[ProfileUI] Failed to initialize lock UI', err);
  });

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : {});
