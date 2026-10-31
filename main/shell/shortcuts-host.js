/* ---------------------------------------------------------------------------
 * shell/shortcuts-host.js
 *
 * Shell keyboard shortcuts (ShortcutService registrations) and window cycling.
 *
 * Loaded as a classic script. Top-level bindings are shared between shell files;
 * runtime statements live in shellInit_* functions that boot.js calls in order
 * after window.ProfileReady.
 * ------------------------------------------------------------------------- */
'use strict';

function activeTerminalSession() {
    const focused = document.activeElement;
    const node = focused && focused.closest ? focused.closest('.window') : null;
    if (node && terminalSessions.has(node.id)) return terminalSessions.get(node.id);
    if (activeWindowId && terminalSessions.has(activeWindowId)) {
        return terminalSessions.get(activeWindowId);
    }
    return null;
}

function cycleWindow(direction) {
    const ordered = Array.from(windows.values()).filter((win) => !win.closed);
    if (!ordered.length) return false;
    ordered.sort((a, b) => Number(a.node.style.zIndex || 0) - Number(b.node.style.zIndex || 0));

    let index = ordered.findIndex((win) => win.id === activeWindowId);
    if (index === -1) index = direction > 0 ? -1 : 0;
    const target = ordered[(index + direction + ordered.length) % ordered.length];
    if (!target) return false;
    if (target.minimized) restoreWindow(target.id);
    focusWindow(target.id, true);
    return true;
}

function registerShellShortcuts() {
    if (shellShortcutsRegistered || !window.ShortcutService) return;
    shellShortcutsRegistered = true;

    const shortcuts = window.ShortcutService;
    const register = (spec) => shortcuts.register(spec);

    register({
        id: 'shell.start',
        keys: 'Ctrl+Escape',
        context: 'global',
        priority: 80,
        allowInEditable: true,
        description: 'Toggle Start search',
        handler: () => {
            if (startMenu.hidden) openSearch();
            else closeSearch(true);
        }
    });

    register({
        id: 'start.previous',
        keys: 'ArrowUp',
        context: 'start',
        priority: 90,
        allowInEditable: true,
        repeat: true,
        description: 'Previous Start result',
        handler: () => {
            setActiveSearchIndex(searchActiveIndex - 1);
        }
    });

    register({
        id: 'start.next',
        keys: 'ArrowDown',
        context: 'start',
        priority: 90,
        allowInEditable: true,
        repeat: true,
        description: 'Next Start result',
        handler: () => {
            setActiveSearchIndex(searchActiveIndex + 1);
        }
    });

    register({
        id: 'start.launch',
        keys: 'Enter',
        context: 'start',
        priority: 95,
        allowInEditable: true,
        description: 'Launch active Start result',
        handler: () => {
            if (searchActiveIndex >= 0) launchSearchItem(searchItems[searchActiveIndex]);
        }
    });

    register({
        id: 'start.close',
        keys: 'Escape',
        context: 'start',
        priority: 95,
        allowInEditable: true,
        description: 'Close Start search',
        handler: () => {
            closeSearch(true);
        }
    });

    register({
        id: 'shell.show-desktop',
        keys: 'Ctrl+Alt+D',
        context: 'unlocked',
        priority: 70,
        allowInEditable: true,
        description: 'Show or restore the desktop',
        handler: () => {
            toggleShowDesktop();
        }
    });

    register({
        id: 'terminal.history-previous',
        keys: 'ArrowUp',
        context: 'terminal',
        priority: 80,
        allowInEditable: true,
        repeat: true,
        description: 'Previous terminal command',
        handler: () => {
            const session = activeTerminalSession();
            if (!session || document.activeElement !== session.input) return false;
            const term = session.term;
            if (!term.history.length) return true;
            term.historyIndex = Math.max(0, term.historyIndex - 1);
            session.input.value = term.history[term.historyIndex] || '';
            return true;
        }
    });

    register({
        id: 'terminal.history-next',
        keys: 'ArrowDown',
        context: 'terminal',
        priority: 80,
        allowInEditable: true,
        repeat: true,
        description: 'Next terminal command',
        handler: () => {
            const session = activeTerminalSession();
            if (!session || document.activeElement !== session.input) return false;
            const term = session.term;
            if (!term.history.length) return true;
            if (term.historyIndex >= term.history.length - 1) {
                term.historyIndex = term.history.length;
                session.input.value = '';
            } else {
                term.historyIndex += 1;
                session.input.value = term.history[term.historyIndex] || '';
            }
            return true;
        }
    });

    register({
        id: 'terminal.clear',
        keys: 'Ctrl+L',
        context: 'terminal',
        priority: 80,
        allowInEditable: true,
        description: 'Clear terminal output',
        handler: () => {
            const session = activeTerminalSession();
            if (!session || document.activeElement !== session.input) return false;
            session.output.textContent = '';
            return true;
        }
    });
}

/* Original inline-script statements, lines 3276-3276+ */
function shellInit_shortcuts_host_1() {
    registerShellShortcuts();
}
