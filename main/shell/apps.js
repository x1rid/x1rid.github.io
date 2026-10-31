/* ---------------------------------------------------------------------------
 * shell/apps.js
 *
 * Registers the built-in system applications and RetroApps programs with AppRegistry and configures it
 * (windowManager + windowFactory).
 *
 * Loaded as a classic script. Top-level bindings are shared between shell files;
 * runtime statements live in shellInit_* functions that boot.js calls in order
 * after window.ProfileReady.
 * ------------------------------------------------------------------------- */
'use strict';

/* ── Application registry ───────────────────────────────── */
function registerApplications() {
    const registry = window.AppRegistry;
    if (!registry) {
        console.warn('[Shell] Application registry unavailable.');
        return;
    }

    registry.configure({
        windowFactory: shellWindowFactory,
        windowManager: {
            focus(windowId, focusTarget) {
                focusWindow(windowId, focusTarget !== false);
                return true;
            },
            minimize(windowId) {
                minimizeWindow(windowId);
                return true;
            },
            restore(windowId) {
                restoreWindow(windowId);
                return true;
            },
            close(windowId) {
                closeWindow(windowId);
                return true;
            },
            exists(windowId) {
                const win = windows.get(windowId);
                return Boolean(win && !win.closed);
            }
        }
    });

    registry.register({
        id: 'explorer',
        name: 'Explorer',
        tagline: 'Browse the active profile virtual filesystem.',
        meta: 'FILES \u00B7 VFS',
        icon: '\u25A3',
        source: 'IN-HOUSE',
        kind: 'system',
        launch(context, options) {
            return openExplorer(options);
        }
    });

    registry.register({
        id: 'programs',
        name: 'Programs',
        tagline: 'The installed application shelf.',
        meta: 'LAUNCHER \u00B7 IN-HOUSE',
        icon: '\u25A6',
        source: 'IN-HOUSE',
        kind: 'system',
        hidden: true,
        launch(context, options) {
            return openPrograms(options);
        }
    });

    registry.register({
        id: 'music',
        name: 'Music',
        tagline: 'Play the local playlist.',
        meta: 'AUDIO \u00B7 LOCAL',
        icon: '\u266A',
        source: 'IN-HOUSE',
        kind: 'system',
        launch(context, options) {
            return openMusic(options);
        }
    });

    registry.register({
        id: 'terminal',
        name: 'Terminal',
        tagline: 'Open a new r3sh terminal window.',
        meta: 'TTY \u00B7 R3SH',
        icon: '>_',
        source: 'IN-HOUSE',
        kind: 'system',
        multiple: true,
        launch(context, options) {
            return openTerminal(options);
        }
    });

    registry.register({
        id: 'cmd',
        name: 'Command Prompt',
        tagline: 'Windows Command Interpreter (cmd.exe)',
        meta: 'CLI \u00B7 MS-DOS / WIN32',
        icon: '>_',
        source: 'IN-HOUSE',
        kind: 'system',
        multiple: true,
        launch(context, options) {
            return openTerminal(Object.assign({ dialect: 'cmd', title: 'Command Prompt' }, options));
        }
    });

    registry.register({
        id: 'powershell',
        name: 'PowerShell',
        tagline: 'Windows PowerShell Command Automation',
        meta: 'CLI \u00B7 OBJECT PIPELINES',
        icon: '>_',
        source: 'IN-HOUSE',
        kind: 'system',
        multiple: true,
        launch(context, options) {
            return openTerminal(Object.assign({ dialect: 'powershell', title: 'Windows PowerShell' }, options));
        }
    });

    registry.register({
        id: 'bash',
        name: 'Bash',
        tagline: 'POSIX Bourne-Again SHell',
        meta: 'CLI \u00B7 POSIX PIPES & REDIRECTION',
        icon: '>_',
        source: 'IN-HOUSE',
        kind: 'system',
        multiple: true,
        launch(context, options) {
            return openTerminal(Object.assign({ dialect: 'bash', title: 'Bash' }, options));
        }
    });

    const programs = window.RetroApps ? window.RetroApps.list() : [];
    programs.forEach((program) => {
        const definition = window.RetroApps.get(program.id);
        if (!definition) return;
        registry.register({
            id: definition.id,
            name: definition.name,
            tagline: definition.tagline,
            meta: definition.meta,
            icon: definition.icon,
            source: definition.source || 'IN-HOUSE',
            frame: Boolean(definition.frame),
            kind: 'program',
            fileTypes: PROGRAM_FILE_TYPES[definition.id] || [],
            launch(context, options) {
                return openProgram(definition.id, options);
            }
        });
    });
}

/* Original inline-script statements, lines 2910-2910+ */
function shellInit_apps_1() {
    registerApplications();
}
