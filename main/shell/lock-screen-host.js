/* ---------------------------------------------------------------------------
 * shell/lock-screen-host.js
 *
 * Wires the lock screen (LockScreenV2 or fallback) to desktop lock/unlock.
 * Loaded as a classic script before boot.js in main/index.html.
 * ------------------------------------------------------------------------- */
(function () {
    'use strict';

    const lockScreen = document.getElementById('lock-screen');
    const lockClock = document.getElementById('lock-clock');
    const lockDate = document.getElementById('lock-date');
    const lockSignInBtn = document.getElementById('lock-signin-btn');
    const startLockBtn = document.getElementById('start-lock-btn');

    let isScreenLocked = true;
    const lockV2 = Boolean(lockScreen && lockScreen.dataset && lockScreen.dataset.lockV2 === 'true');

    function screenIsLocked() {
        if (window.ProfileUI && typeof window.ProfileUI.isLocked === 'function') {
            return window.ProfileUI.isLocked();
        }
        return isScreenLocked;
    }

    function updateLockClock() {
        if (lockV2) return; // LockScreenV2 owns the immersive clock
        if (!lockClock || !lockDate) return;
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        lockClock.textContent = hours + ':' + minutes;

        const options = { weekday: 'long', month: 'long', day: 'numeric' };
        lockDate.textContent = now.toLocaleDateString('en-US', options);
    }

    updateLockClock();
    setInterval(updateLockClock, 1000);

    function unlockScreen() {
        if (lockV2 && window.LockScreenV2) {
            window.LockScreenV2.focusSignIn();
            return;
        }
        if (!screenIsLocked()) return;
        // ProfileUI decides whether a password is required. Guest sessions
        // continue immediately; the owner profile stays gated.
        if (window.ProfileUI) {
            window.ProfileUI.unlock();
        } else if (lockScreen) {
            isScreenLocked = false;
            lockScreen.classList.add('is-unlocked');
        }
    }

    function lockSystem() {
        if (!lockScreen) return;
        // Active session: GNOME-style screen lock over the running desktop.
        if (window.SessionLock && !screenIsLocked()) {
            window.SessionLock.lock();
            return;
        }
        if (lockV2 && window.LockScreenV2) {
            window.LockScreenV2.lock();
            return;
        }
        isScreenLocked = true;
        if (window.ProfileUI) {
            window.ProfileUI.lock();
        } else {
            lockScreen.classList.remove('is-unlocked');
        }
        if (typeof window.closeDesktopSearch === 'function') {
            window.closeDesktopSearch(false);
        }
    }

    if (lockSignInBtn && !lockV2) {
        lockSignInBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            unlockScreen();
        });
    }

    if (window.ShortcutService) {
        const shortcuts = window.ShortcutService;
        shortcuts.register({
            id: 'lock.lock',
            keys: ['Meta+L', 'Ctrl+Alt+L'],
            context: 'unlocked',
            priority: 90,
            allowInEditable: true,
            description: 'Lock the desktop',
            handler: () => {
                lockSystem();
            }
        });
        if (!lockV2) {
            shortcuts.register({
                id: 'lock.unlock',
                keys: ['Enter', 'Space'],
                context: 'locked',
                priority: 100,
                allowWhenLocked: true,
                description: 'Unlock the desktop',
                when: (event) => {
                    if (!screenIsLocked()) return false;
                    if (event.target instanceof Element && event.target.closest('.profile-prompt')) {
                        return false;
                    }
                    return true;
                },
                handler: () => {
                    unlockScreen();
                }
            });
        }
    } else if (!lockV2) {
        window.addEventListener('keydown', function(e) {
            if (screenIsLocked() && (e.key === 'Enter' || e.key === ' ')) {
                unlockScreen();
            }
        });
    }

    if (startLockBtn) {
        startLockBtn.addEventListener('click', function() {
            lockSystem();
        });
    }

    window.lockDesktop = lockSystem;
    window.unlockDesktop = unlockScreen;
})();
