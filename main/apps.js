/* ---------------------------------------------------------------------------
 *  apps.js — Programs launcher + app window manager
 *
 *  A tiny, dependency-free registry. Each app file calls
 *  `RetroApps.register({ id, name, tagline, meta, icon, mount })` and gets a
 *  fresh element to own. The manager handles the launcher, the title bar,
 *  cleanup, Escape, and the terminal's `apps` command.
 *
 *  Contract:
 *    mount(root, api)  -> optional cleanup function
 *    api.setMeta(text) -> live title-bar metadata (real values only)
 *    api.close()       -> return to the launcher
 *
 *  Apps must not touch global state on load. Everything is created on mount
 *  and released on unmount, so opening/closing repeatedly leaks nothing.
 * ------------------------------------------------------------------------- */
(() => {
    'use strict';

    const registry = [];
    let pane = null;
    let launcher = null;
    let grid = null;
    let windowEl = null;
    let bodyEl = null;
    let nameEl = null;
    let metaEl = null;
    let iconEl = null;
    let sectionTitle = null;
    let countEl = null;
    let current = null;
    let cleanups = [];
    let lastTile = null;

    function ready(fn) {
        /* Deferred app scripts run while readyState is "interactive", before
           this file's own DOMContentLoaded. Waiting for that event is what
           guarantees every app has registered before the launcher renders. */
        if (document.readyState !== 'complete') {
            document.addEventListener('DOMContentLoaded', fn, { once: true });
        } else {
            fn();
        }
    }

    function byId(id) {
        const key = String(id || '').toLowerCase();
        for (let i = 0; i < registry.length; i += 1) {
            if (registry[i].id === key) return registry[i];
        }
        return null;
    }

    function paneVisible() {
        return Boolean(pane && pane.style.display !== 'none');
    }

    function syncSectionMeta() {
        if (!sectionTitle) return;
        sectionTitle.dataset.meta = current
            ? `${current.name} · running`
            : `${registry.length} installed`;
    }

    /* ------------------------------------------------------------------
     * Launcher
     * ------------------------------------------------------------------ */
    function buildTile(app, index) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'app-tile';
        tile.dataset.app = app.id;
        tile.style.setProperty('--tile-index', String(index));

        const icon = document.createElement('span');
        icon.className = 'app-tile-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = app.icon;

        const text = document.createElement('span');
        text.className = 'app-tile-text';

        const name = document.createElement('span');
        name.className = 'app-tile-name';
        name.textContent = app.name;

        const desc = document.createElement('span');
        desc.className = 'app-tile-desc';
        desc.textContent = app.tagline;

        const foot = document.createElement('span');
        foot.className = 'app-tile-foot';

        const meta = document.createElement('span');
        meta.textContent = app.meta;

        const open = document.createElement('span');
        open.className = 'app-tile-open';
        open.setAttribute('aria-hidden', 'true');
        open.textContent = 'OPEN ›';

        foot.appendChild(meta);
        foot.appendChild(open);
        text.appendChild(name);
        text.appendChild(desc);
        text.appendChild(foot);
        tile.appendChild(icon);
        tile.appendChild(text);

        tile.addEventListener('click', () => {
            lastTile = tile;
            open(app.id);
        });

        return tile;
    }

    function renderLauncher() {
        if (!grid) return;
        grid.replaceChildren();
        registry.forEach((app, index) => {
            grid.appendChild(buildTile(app, index));
        });
    }

    /* ------------------------------------------------------------------
     * Window
     * ------------------------------------------------------------------ */
    function runCleanups() {
        const pending = cleanups;
        cleanups = [];
        pending.forEach((fn) => {
            try {
                fn();
            } catch (error) {
                console.warn('app cleanup failed:', error);
            }
        });
    }

    function open(id) {
        const app = byId(id);
        if (!app) return false;

        if (window.showPane && paneVisible() === false) {
            window.showPane('apps');
        }

        if (current) {
            runCleanups();
            current = null;
        }

        current = app;
        bodyEl.replaceChildren();
        bodyEl.className = `app-body app-body--${app.id}`;
        nameEl.textContent = app.name;
        metaEl.textContent = app.meta;
        iconEl.innerHTML = app.icon;
        if (pane) pane.dataset.app = app.id;

        launcher.hidden = true;
        windowEl.hidden = false;

        const api = {
            app,
            setMeta(text) {
                if (current !== app) return;
                const value = String(text == null ? '' : text).trim();
                metaEl.textContent = value || app.meta;
            },
            close() {
                close();
            },
        };

        let mounted;
        try {
            mounted = app.mount(bodyEl, api);
        } catch (error) {
            console.error(`${app.name} failed to start:`, error);
            bodyEl.replaceChildren();
            const note = document.createElement('p');
            note.className = 'app-error';
            note.textContent = `${app.name} could not start in this browser. Try reloading, or use a current browser with canvas support.`;
            bodyEl.appendChild(note);
        }

        if (typeof mounted === 'function') cleanups.push(mounted);

        syncSectionMeta();
        document.dispatchEvent(new CustomEvent('site:appchange', {
            detail: { id: app.id, name: app.name, open: true },
        }));

        const focusTarget = windowEl.querySelector('.app-body button, .app-body canvas, .app-body [tabindex]');
        if (focusTarget && typeof focusTarget.focus === 'function') {
            /* Pointer users keep their eye on the board; keyboard users get a
               real starting point inside the new window. */
            if (document.documentElement.matches(':focus-visible')) focusTarget.focus();
        }

        return true;
    }

    function close() {
        if (!current) return;
        const closing = current;
        current = null;
        runCleanups();
        bodyEl.replaceChildren();
        windowEl.hidden = true;
        launcher.hidden = false;
        if (pane) delete pane.dataset.app;
        syncSectionMeta();

        document.dispatchEvent(new CustomEvent('site:appchange', {
            detail: { id: closing.id, name: closing.name, open: false },
        }));

        if (lastTile && document.contains(lastTile)) lastTile.focus();
    }

    function register(def) {
        if (!def || !def.id || typeof def.mount !== 'function') return;
        const id = String(def.id).toLowerCase();
        if (byId(id)) return;
        registry.push({
            id,
            name: def.name || id,
            tagline: def.tagline || '',
            meta: def.meta || '',
            icon: def.icon || '',
            mount: def.mount,
        });
    }

    /* ------------------------------------------------------------------
     * Wire-up
     * ------------------------------------------------------------------ */
    ready(() => {
        pane = document.getElementById('programs');
        launcher = document.getElementById('apps-launcher');
        grid = document.getElementById('apps-grid');
        windowEl = document.getElementById('app-window');
        bodyEl = document.getElementById('app-body');
        nameEl = document.getElementById('app-name');
        metaEl = document.getElementById('app-meta');
        iconEl = document.getElementById('app-icon');
        sectionTitle = document.getElementById('main-section-title');
        countEl = document.getElementById('apps-count');

        if (!pane || !launcher || !windowEl) return;

        renderLauncher();
        if (countEl) countEl.textContent = `${registry.length} INSTALLED`;
        syncSectionMeta();

        windowEl.querySelectorAll('[data-app-action]').forEach((button) => {
            button.addEventListener('click', () => {
                const action = button.dataset.appAction;
                if (action === 'close' || action === 'launcher') close();
            });
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (!current || !paneVisible() || windowEl.hidden) return;
            if (event.target && event.target.closest && event.target.closest('input, textarea')) return;
            /* The phone shell owns Escape (back to Links) at that width. */
            if (window.matchMedia && window.matchMedia('(max-width: 600px)').matches) return;
            event.preventDefault();
            close();
        });

        document.addEventListener('site:panechange', (event) => {
            const opened = event && event.detail ? event.detail.pane === 'apps' : false;
            if (!opened && current) {
                /* Keep the game state, but let the section heading match the
                   pane the visitor actually returned to. */
                syncSectionMeta();
            }
        });
    });

    window.RetroApps = {
        register,
        open,
        close,
        list() {
            return registry.map((app) => ({ id: app.id, name: app.name, meta: app.meta }));
        },
        get openId() {
            return current ? current.id : null;
        },
    };
})();
