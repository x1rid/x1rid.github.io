/* ---------------------------------------------------------------------------
 *  mobile.js — the phone shell controller  (`max-width: 600px`)
 *
 *  One owner for phone state. It builds nothing and moves nothing: the header,
 *  tab bar, key strip and pages view already exist in the markup, and the
 *  panes, terminal and music player are the same elements the desktop uses.
 *
 *  The state contract (brief §11.2):
 *    - terminal.js's showPane() stays the only owner of which real pane is
 *      open. It emits `site:panechange`; this controller only projects it.
 *    - the projection is two attributes:
 *        body[data-layout="phone"]
 *        body[data-view="link" | "pc" | "web" | "page"]
 *    - "page" is synthetic (the saved-pages list) and does not change the real
 *      pane underneath; leaving it returns through showPane('link').
 *
 *  Lifecycle (brief §11.3): init() runs once, on()/off() can run any number of
 *  times. Every listener and observer created by on() is removed or
 *  disconnected by off(), so crossing 600px repeatedly leaks nothing.
 *
 *  Keyboard geometry (brief §11.4): this file writes exactly one value,
 *  `--pt-keyboard-offset`, from visualViewport, and only while the terminal
 *  input is focused. phone.css subtracts it once, next to `--pt-fixed-stack`.
 *
 *  The media query string below, the stylesheet link in index.html and the
 *  marquee script in index.html must all stay `max-width: 600px`.
 * ------------------------------------------------------------------------- */
(() => {
    'use strict';

    if (!window.matchMedia || !document.body) return;

    const PHONE = window.matchMedia('(max-width: 600px)');

    const VIEW_TAB = { link: 'link', pc: 'pc', web: 'page', page: 'page' };
    const VIEW_PATH = { link: 'links', pc: 'terminal', web: 'web', page: 'pages' };

    /* Static elements — looked up once, after the DOM is ready. */
    let tabsBar = null;
    let tabs = [];
    let pagesTab = null;
    let viewPath = null;
    let viewMeta = null;
    let pagesList = null;
    let pagesEmpty = null;
    let keysStrip = null;
    let webpagesList = null;
    let sectionTitle = null;

    /* Mode-scoped bookkeeping. */
    let active = false;
    let currentView = 'link';
    let abort = null;
    const listeners = [];
    const observers = [];
    let pagesQueued = false;

    /* ------------------------------------------------------------------
     * Small helpers
     * ------------------------------------------------------------------ */
    const paneView = (pane) => (pane === 'pc' ? 'pc' : pane === 'webpage' ? 'web' : 'link');

    function paneViewFromDom() {
        const webpage = document.getElementById('webpage-pane');
        const pc = document.getElementById('pc-specs');
        if (webpage && webpage.style.display !== 'none') return 'web';
        if (pc && pc.style.display !== 'none') return 'pc';
        return 'link';
    }

    /* ----- mode-scoped listener / observer registration --------------- */
    function listen(target, type, handler, options) {
        if (!target || !target.addEventListener) return;
        const capture = typeof options === 'boolean' ? options : Boolean(options && options.capture);

        if (abort) {
            const extra = options && typeof options === 'object' ? options : {};
            target.addEventListener(type, handler, Object.assign({}, extra, { capture, signal: abort.signal }));
            return;
        }

        target.addEventListener(type, handler, options);
        listeners.push({ target, type, handler, options: capture });
    }

    function watch(target, handler, config) {
        if (!target || !('MutationObserver' in window)) return;
        const observer = new MutationObserver(handler);
        observer.observe(target, config);
        observers.push(observer);
    }

    function release() {
        if (abort) {
            abort.abort();
            abort = null;
        }
        listeners.splice(0).forEach(({ target, type, handler, options }) => {
            target.removeEventListener(type, handler, options);
        });
        observers.splice(0).forEach((observer) => observer.disconnect());
    }

    /* ------------------------------------------------------------------
     * View projection
     * ------------------------------------------------------------------ */
    function setView(view) {
        currentView = view;

        /* The keyboard geometry belongs to the terminal view: leaving it must
           never leave the shell sized for a keyboard that is no longer there. */
        if (view !== 'pc') setTyping(false);

        if (PHONE.matches) document.body.dataset.view = view;
        else document.body.removeAttribute('data-view');

        const wanted = VIEW_TAB[view] || 'link';
        tabs.forEach((tab) => {
            tab.setAttribute('aria-current', tab.dataset.view === wanted ? 'true' : 'false');
        });

        syncHeader();
    }

    function applyView(view) {
        if (view === 'page') {
            /* Synthetic view: the real pane is intentionally left alone. */
            setView('page');
            return;
        }

        const showPane = window.showPane;
        if (typeof showPane !== 'function') {
            setView(paneViewFromDom());
            return;
        }

        showPane(view === 'pc' ? 'pc' : 'link'); /* emits site:panechange */
        if (view === 'pc' && typeof window.runNeofetchIfNeeded === 'function') {
            window.runNeofetchIfNeeded();
        }
    }

    function onPaneChange(event) {
        const pane = event && event.detail ? event.detail.pane : '';
        setView(paneView(pane));
    }

    /* ------------------------------------------------------------------
     * Header — the site path plus the current view's read-only meta.
     * The path is the view context; the bottom tab repeats it as the
     * control. The meta mirrors the desktop title (or the saved-pages
     * count) and is never a new source of truth.
     * ------------------------------------------------------------------ */
    function syncHeader() {
        if (viewPath) viewPath.textContent = '://' + (VIEW_PATH[currentView] || 'links');
        syncMeta();
    }

    function syncMeta() {
        if (!viewMeta) return;

        if (currentView === 'pc') {
            viewMeta.textContent = 'local';
            return;
        }

        if (currentView === 'page') {
            const pages = webpagesList ? webpagesList.querySelectorAll('.webpage-tab').length : 0;
            viewMeta.textContent = pages ? `${pages} saved` : '';
            return;
        }

        if (currentView === 'web') {
            viewMeta.textContent = '';
            return;
        }

        /* Keep the phone meta short: "20 links · filter: All" becomes
           "20 · All" so it fits beside the path. */
        const meta = sectionTitle ? sectionTitle.dataset.meta || '' : '';
        const compact = meta.match(/^(\d+)\s+(?:entries?|links?)\s*·\s*filter:\s*(.+)$/i);
        viewMeta.textContent = compact ? `${compact[1]} · ${compact[2]}` : meta;
    }

    /* ------------------------------------------------------------------
     * Saved pages — mirrors, never moved.
     * terminal.js owns #webpages-list and serialises its children straight
     * to localStorage, so the phone list is a clone whose click delegates
     * back to the original button (listeners and storage stay untouched).
     * ------------------------------------------------------------------ */
    function syncPages() {
        const count = webpagesList ? webpagesList.querySelectorAll('.webpage-tab').length : 0;

        if (pagesTab) pagesTab.hidden = count === 0;
        if (pagesEmpty) pagesEmpty.hidden = count > 0;

        if (!count && currentView === 'page') {
            applyView('link');
            return;
        }

        syncMeta();
    }

    function renderPages() {
        if (!pagesList || !webpagesList) return;
        pagesList.replaceChildren();

        Array.from(webpagesList.querySelectorAll('.webpage-tab')).forEach((source) => {
            const row = source.cloneNode(true);
            row.removeAttribute('id');
            const rowButton = row.querySelector('.webpage-btn');
            if (rowButton) rowButton.removeAttribute('id');

            /* The clone is only a projection: both controls click the source
               tab, whose listeners and storage write stay in terminal.js. */
            const close = row.querySelector('.webpage-tab-close');
            if (close) {
                close.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const sourceClose = source.querySelector('.webpage-tab-close');
                    if (sourceClose) sourceClose.click();
                });
            }

            row.addEventListener('click', (event) => {
                if (event.target.closest('.webpage-tab-close')) return;
                const button = source.querySelector('.webpage-btn');
                if (button) button.click();
            });

            pagesList.appendChild(row);
        });

        syncPages();
    }

    function queuePages() {
        if (pagesQueued) return;
        pagesQueued = true;
        window.requestAnimationFrame(() => {
            pagesQueued = false;
            renderPages();
        });
    }

    /* ------------------------------------------------------------------
     * Key strip — soft keyboards have no Tab, arrows or Ctrl.
     * The buttons dispatch the exact keydown events terminal.js already
     * handles, and preventDefault on pointerdown keeps the input focused.
     * ------------------------------------------------------------------ */
    function fireKey(name) {
        const input = document.getElementById('terminal-input');
        if (!input || !name) return;

        const init = { key: name, code: name, bubbles: true, cancelable: true };
        if (name === 'ctrl+c') {
            init.key = 'c';
            init.code = 'KeyC';
            init.ctrlKey = true;
        }
        input.dispatchEvent(new KeyboardEvent('keydown', init));
    }

    function onKeysPointerDown(event) {
        const button = event.target && event.target.closest ? event.target.closest('button') : null;
        if (!button) return;

        /* The whole strip exists to feed the terminal input: never steal focus. */
        event.preventDefault();

        if (button.dataset.command) {
            if (typeof window.runCommand === 'function') window.runCommand(button.dataset.command);
            return;
        }
        fireKey(button.dataset.key);
    }

    /* ------------------------------------------------------------------
     * Virtual keyboard. dvh already shrinks on Android
     * (interactive-widget=resizes-content); on overlay-style viewports the
     * measured inset is subtracted exactly once by phone.css.
     * ------------------------------------------------------------------ */
    function syncKeyboardOffset() {
        let offset = 0;
        if (document.body.classList.contains('is-typing') && window.visualViewport) {
            const viewport = window.visualViewport;
            offset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
        }
        document.documentElement.style.setProperty('--pt-keyboard-offset', `${offset}px`);
    }

    function setTyping(typing) {
        const on = Boolean(typing) && PHONE.matches;
        document.body.classList.toggle('is-typing', on);

        if (on) {
            /* The keyboard animates in; measure it once it has settled. */
            window.setTimeout(syncKeyboardOffset, 260);
            window.setTimeout(syncKeyboardOffset, 640);
        } else {
            syncKeyboardOffset();
        }
    }

    function onFocusChange(event) {
        const input = document.getElementById('terminal-input');
        if (!input || event.target !== input) return;
        setTyping(event.type === 'focusin');
    }

    function onKeyDown(event) {
        if (event.key !== 'Escape' || currentView === 'link') return;

        /* If the player sheet is open, its own Escape handler owns the key. */
        const player = document.getElementById('retro-music-window');
        if (player && !player.hidden) return;

        applyView('link');
    }

    /* ------------------------------------------------------------------
     * Fullscreen honesty — iOS has no Element Fullscreen at all (brief §4.6).
     * ------------------------------------------------------------------ */
    function addFullscreenFallback() {
        const fullscreenBtn = document.getElementById('webpage-fullscreen');
        if (!fullscreenBtn || document.fullscreenEnabled) return;
        if (document.getElementById('phone-webpage-external')) return;

        fullscreenBtn.hidden = true;

        const external = document.createElement('button');
        external.type = 'button';
        external.id = 'phone-webpage-external';
        external.className = 'phone-webpage-external';
        external.textContent = 'OPEN ↗';
        external.title = 'Open this page in your browser';
        external.addEventListener('click', () => {
            const frame = document.getElementById('webpage-iframe');
            const src = frame ? frame.getAttribute('src') : '';
            if (src && src !== 'about:blank') window.open(src, '_blank', 'noopener');
        });

        const host = fullscreenBtn.parentElement || fullscreenBtn.closest('.webpage-toolbar');
        if (host) host.appendChild(external);
    }

    function removeFullscreenFallback() {
        const external = document.getElementById('phone-webpage-external');
        if (external && external.parentElement) external.parentElement.removeChild(external);

        const fullscreenBtn = document.getElementById('webpage-fullscreen');
        if (fullscreenBtn) fullscreenBtn.hidden = false;
    }

    /* ------------------------------------------------------------------
     * Enter / leave phone mode
     * ------------------------------------------------------------------ */
    function on() {
        if (active) return;
        active = true;

        document.body.dataset.layout = 'phone';
        abort = typeof AbortController === 'function' ? new AbortController() : null;

        listen(document, 'site:panechange', onPaneChange);
        listen(document, 'focusin', onFocusChange, true);
        listen(document, 'focusout', onFocusChange, true);
        listen(document, 'keydown', onKeyDown);
        listen(window, 'resize', syncKeyboardOffset, { passive: true });

        if (window.visualViewport) {
            listen(window.visualViewport, 'resize', syncKeyboardOffset, { passive: true });
            listen(window.visualViewport, 'scroll', syncKeyboardOffset, { passive: true });
        }

        watch(webpagesList, queuePages, { childList: true, subtree: true, characterData: true });
        watch(sectionTitle, syncMeta, { attributes: true, attributeFilter: ['data-meta'] });

        addFullscreenFallback();
        renderPages();
        syncKeyboardOffset();
        setView(paneViewFromDom());
    }

    function off() {
        if (!active) return;
        active = false;

        release();

        setTyping(false);
        removeFullscreenFallback();
        document.body.removeAttribute('data-layout');
        document.body.removeAttribute('data-view');
        document.documentElement.style.removeProperty('--pt-keyboard-offset');

        if (pagesList) pagesList.replaceChildren();
        syncPages();

        /* The real pane is left exactly as showPane() last set it. */
        currentView = paneViewFromDom();
    }

    /* ------------------------------------------------------------------
     * Init — static wiring happens once, regardless of viewport.
     * ------------------------------------------------------------------ */
    function init() {
        tabsBar = document.getElementById('phone-tabs');
        tabs = tabsBar ? Array.from(tabsBar.querySelectorAll('.phone-tab')) : [];
        pagesTab = tabsBar ? tabsBar.querySelector('.phone-tab[data-view="page"]') : null;
        viewPath = document.getElementById('phone-view-path');
        viewMeta = document.getElementById('phone-view-meta');
        pagesList = document.getElementById('phone-pages-list');
        pagesEmpty = document.getElementById('phone-pages-empty');
        keysStrip = document.getElementById('phone-keys');
        webpagesList = document.getElementById('webpages-list');
        sectionTitle = document.getElementById('main-section-title');

        /* Static controls: inert above 600px (phone.css hides them), so they
           are wired once and never re-registered. */
        tabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                applyView(tab.dataset.view);
            });
        });

        if (keysStrip) keysStrip.addEventListener('pointerdown', onKeysPointerDown);

        syncHeader();
        syncPages();

        if (PHONE.matches) on();
    }

    const onPhoneChange = (event) => {
        if (event.matches) on();
        else off();
    };

    if (typeof PHONE.addEventListener === 'function') PHONE.addEventListener('change', onPhoneChange);
    else if (typeof PHONE.addListener === 'function') PHONE.addListener(onPhoneChange);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
