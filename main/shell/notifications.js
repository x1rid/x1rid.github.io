/* ---------------------------------------------------------------------------
 * shell/notifications.js
 *
 * Toast manager. Also hands the same renderer to SystemServices.notifications.
 *
 * Loaded as a classic script. Top-level bindings are shared between shell files;
 * runtime statements live in shellInit_* functions that boot.js calls in order
 * after window.ProfileReady.
 * ------------------------------------------------------------------------- */
'use strict';

function toast(message, duration = 2200) {
    shellToast.textContent = message;
    shellToast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
        shellToast.hidden = true;
    }, duration);
}

/* Original inline-script statements, lines 111-112+ */
function shellInit_notifications_1() {
    // Keep the legacy `window.toast` hook working for persistence diagnostics
    // and hand the same renderer to the shared notification service.
    window.toast = toast;

    if (window.SystemServices) {
        window.SystemServices.notifications.configure({ renderer: toast });
    }
}
