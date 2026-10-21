/* -----------------------------------------------------------------------
 * Link context menu + copy confirmation
 *
 *  - Desktop/fine-pointer only; touch long-press keeps the native menu.
 *  - Only http(s) links are intercepted. Text, inputs, images, mailto
 *    links, terminal output and empty space keep the browser menu.
 *  - Shift + right-click always opens the native menu.
 *  - "Open in page pane" dispatches site:openpage, handled by terminal.js.
 * ----------------------------------------------------------------------- */
(() => {
    'use strict';

    const COPY_TOAST_TIME = 2400;
    const TOAST_LEAVE_TIME = 150;
    const MENU_LEAVE_TIME = 90;
    const COPY_FLASH_TIME = 480;

    const finePointer = window.matchMedia
        ? window.matchMedia('(hover: hover) and (pointer: fine)')
        : null;
    const phoneWidth = window.matchMedia
        ? window.matchMedia('(max-width: 600px)')
        : null;

    let menu = null;
    let menuUrl = null;
    let toast = null;
    let toastMark = null;
    let toastTitle = null;
    let toastUrl = null;
    let menuTimer = 0;
    let toastTimer = 0;
    let toastLeaveTimer = 0;
    let copyFlashTimer = 0;
    let current = null;

    function isDesktopContext() {
        if (finePointer && !finePointer.matches) return false;
        if (phoneWidth && phoneWidth.matches) return false;
        return true;
    }

    function isEditable(target) {
        return !!(target && typeof target.closest === 'function' &&
            target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
    }

    function resolveLink(anchor) {
        if (!anchor || anchor.classList.contains('is-pending')) return null;

        const raw = anchor.getAttribute('href');
        if (!raw || raw === '#' || /^javascript:/i.test(raw)) return null;

        let url;
        try {
            url = new URL(raw, window.location.href);
        } catch (_) {
            return null;
        }

        return /^https?:$/.test(url.protocol) ? url.href : null;
    }

    function displayUrl(url) {
        try {
            const value = new URL(url);
            const path = value.pathname === '/' ? '' : value.pathname;
            return `${value.hostname.replace(/^www\./, '')}${path}${value.search || ''}`;
        } catch (_) {
            return url;
        }
    }

    function labelFor(anchor, url) {
        const tileLabel = anchor.querySelector('.badge-label');
        const text = String(
            tileLabel && tileLabel.textContent ||
            anchor.getAttribute('aria-label') ||
            anchor.title ||
            anchor.textContent ||
            ''
        ).trim();
        return text || displayUrl(url);
    }

    function ensureMenu() {
        if (menu) return menu;

        menu = document.createElement('div');
        menu.className = 'link-context-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Link actions');

        const head = document.createElement('div');
        head.className = 'lcm-head';

        const headLabel = document.createElement('span');
        headLabel.className = 'lcm-head-label';
        headLabel.textContent = 'LINK';

        menuUrl = document.createElement('span');
        menuUrl.className = 'lcm-url';

        head.append(headLabel, menuUrl);

        const actions = [
            ['copy', '⧉', 'COPY LINK'],
            ['newtab', '↗', 'OPEN IN NEW TAB'],
            ['pane', '▤', 'OPEN IN PAGE PANE']
        ];

        menu.appendChild(head);

        actions.forEach(([action, glyph, label]) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'lcm-item';
            item.dataset.action = action;
            item.setAttribute('role', 'menuitem');
            item.tabIndex = -1;

            const key = document.createElement('span');
            key.className = 'lcm-key';
            key.setAttribute('aria-hidden', 'true');
            key.textContent = glyph;

            const text = document.createElement('span');
            text.textContent = label;

            item.append(key, text);
            menu.appendChild(item);
        });

        const hint = document.createElement('div');
        hint.className = 'lcm-hint';
        hint.textContent = 'SHIFT+RMB · NATIVE MENU';
        menu.appendChild(hint);

        menu.addEventListener('click', onMenuClick);
        menu.addEventListener('keydown', onMenuKeyDown);
        document.body.appendChild(menu);
        return menu;
    }

    function ensureToast() {
        if (toast) return toast;

        toast = document.createElement('div');
        toast.className = 'link-toast';
        toast.hidden = true;
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.setAttribute('aria-atomic', 'true');

        toastMark = document.createElement('span');
        toastMark.className = 'link-toast__mark';
        toastMark.setAttribute('aria-hidden', 'true');

        const body = document.createElement('span');
        body.className = 'link-toast__body';

        toastTitle = document.createElement('span');
        toastTitle.className = 'link-toast__title';

        toastUrl = document.createElement('span');
        toastUrl.className = 'link-toast__url';

        body.append(toastTitle, toastUrl);
        toast.append(toastMark, body);
        document.body.appendChild(toast);
        return toast;
    }

    function showToast(ok, detail) {
        ensureToast();

        window.clearTimeout(toastTimer);
        window.clearTimeout(toastLeaveTimer);

        toast.dataset.tone = ok ? 'ok' : 'error';
        toastMark.textContent = ok ? '✓' : '!';
        toastTitle.textContent = ok ? 'LINK COPIED' : 'COPY FAILED';
        toastUrl.textContent = ok ? displayUrl(detail) : (detail || 'CLIPBOARD UNAVAILABLE');

        toast.hidden = false;
        toast.classList.remove('is-leaving', 'is-showing');
        void toast.offsetWidth;
        toast.classList.add('is-showing');

        toastTimer = window.setTimeout(hideToast, COPY_TOAST_TIME);
    }

    function hideToast() {
        if (!toast || toast.hidden) return;

        window.clearTimeout(toastTimer);
        toast.classList.remove('is-showing');
        toast.classList.add('is-leaving');

        toastLeaveTimer = window.setTimeout(() => {
            toast.hidden = true;
            toast.classList.remove('is-leaving');
        }, TOAST_LEAVE_TIME);
    }

    function addMenuListeners() {
        document.addEventListener('pointerdown', onDocumentPointerDown, true);
        document.addEventListener('keydown', onDocumentKeyDown, true);
        window.addEventListener('scroll', onWindowScroll, true);
        window.addEventListener('resize', dismissMenu, true);
    }

    function removeMenuListeners() {
        document.removeEventListener('pointerdown', onDocumentPointerDown, true);
        document.removeEventListener('keydown', onDocumentKeyDown, true);
        window.removeEventListener('scroll', onWindowScroll, true);
        window.removeEventListener('resize', dismissMenu, true);
    }

    function openMenu(event, anchor, url) {
        window.clearTimeout(menuTimer);
        removeMenuListeners();
        ensureMenu();

        const keyboard = event.clientX === 0 && event.clientY === 0;
        const anchorRect = anchor.getBoundingClientRect();
        const paneAllowed = !window.SiteIframes || window.SiteIframes.canEmbed(url);

        current = {
            anchor,
            url,
            paneAllowed,
            label: labelFor(anchor, url)
        };

        /* A page pane action would only show the browser's refusal screen for
           sites that send X-Frame-Options / frame-ancestors. Remove the option
           entirely instead of leaving a dead control in the menu. */
        const paneItem = menu.querySelector('.lcm-item[data-action="pane"]');
        if (paneItem) paneItem.hidden = !paneAllowed;

        menuUrl.textContent = displayUrl(url);
        menuUrl.title = url;

        menu.hidden = false;
        menu.classList.remove('is-open', 'is-closing');
        menu.style.visibility = 'hidden';
        menu.style.left = '0px';
        menu.style.top = '0px';

        const menuRect = menu.getBoundingClientRect();
        const margin = 8;
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
        let left = keyboard ? anchorRect.left + 8 : event.clientX;
        let top = keyboard ? anchorRect.bottom + 4 : event.clientY;

        left = Math.min(Math.max(margin, left), Math.max(margin, viewportWidth - menuRect.width - margin));
        top = Math.min(Math.max(margin, top), Math.max(margin, viewportHeight - menuRect.height - margin));

        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        menu.style.visibility = '';
        menu.classList.add('is-open');

        addMenuListeners();

        const firstItem = menu.querySelector('.lcm-item');
        if (firstItem) {
            firstItem.focus({ preventScroll: true });
        }
    }

    function closeMenu(restoreFocus, immediate) {
        window.clearTimeout(menuTimer);
        removeMenuListeners();

        if (!menu || menu.hidden) {
            current = null;
            return;
        }

        const anchor = current && current.anchor;
        menu.classList.remove('is-open');

        if (restoreFocus && anchor && anchor.isConnected) {
            anchor.focus({ preventScroll: true });
        }

        current = null;

        if (immediate) {
            menu.hidden = true;
            menu.classList.remove('is-closing');
            return;
        }

        menu.classList.add('is-closing');
        menuTimer = window.setTimeout(() => {
            menu.hidden = true;
            menu.classList.remove('is-closing');
        }, MENU_LEAVE_TIME);
    }

    function dismissMenu() {
        closeMenu(false);
    }

    function onWindowScroll(event) {
        if (event && event.target === menu) return;
        closeMenu(false);
    }

    function onDocumentPointerDown(event) {
        if (!menu || menu.hidden) return;
        if (menu.contains(event.target)) return;
        closeMenu(false);
    }

    function onDocumentKeyDown(event) {
        if (!menu || menu.hidden) return;
        if (event.key !== 'Escape') return;
        event.preventDefault();
        closeMenu(true);
    }

    function onMenuKeyDown(event) {
        if (!menu || menu.hidden) return;

        const items = Array.from(menu.querySelectorAll('.lcm-item:not([hidden])'));
        if (!items.length) return;

        const activeIndex = items.indexOf(document.activeElement);
        let nextIndex = -1;

        if (event.key === 'ArrowDown') {
            nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
        } else if (event.key === 'ArrowUp') {
            nextIndex = activeIndex < 0 ? items.length - 1 : (activeIndex - 1 + items.length) % items.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = items.length - 1;
        } else if (event.key === 'Tab') {
            closeMenu(false);
            return;
        }

        if (nextIndex < 0) return;
        event.preventDefault();
        items[nextIndex].focus({ preventScroll: true });
    }

    function onMenuClick(event) {
        const item = event.target.closest('.lcm-item');
        if (!item || !current) return;

        const action = item.dataset.action;
        const data = current;

        if (action === 'copy') {
            closeMenu(false);
            copyLink(data.url, data.anchor);
            return;
        }

        if (action === 'newtab') {
            closeMenu(false);
            openNewTab(data.url);
            return;
        }

        if (action === 'pane') {
            closeMenu(false);
            if (!data.paneAllowed) return;
            document.dispatchEvent(new CustomEvent('site:openpage', {
                detail: { url: data.url, title: data.label }
            }));
        }
    }

    async function copyLink(url, anchor) {
        const copied = await copyText(url);

        window.clearTimeout(copyFlashTimer);
        if (copied && anchor && anchor.isConnected) {
            anchor.classList.remove('is-copied');
            void anchor.offsetWidth;
            anchor.classList.add('is-copied');
            copyFlashTimer = window.setTimeout(() => {
                anchor.classList.remove('is-copied');
            }, COPY_FLASH_TIME);
        }

        showToast(copied, copied ? url : 'CLIPBOARD UNAVAILABLE');
    }

    async function copyText(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (_) {
                /* fall through to the selection-based fallback */
            }
        }

        let field = null;
        try {
            field = document.createElement('textarea');
            field.value = text;
            field.setAttribute('readonly', '');
            field.style.position = 'fixed';
            field.style.left = '-9999px';
            field.style.top = '0';
            field.style.opacity = '0';
            document.body.appendChild(field);
            field.select();
            field.setSelectionRange(0, field.value.length);
            return document.execCommand('copy');
        } catch (_) {
            return false;
        } finally {
            if (field) field.remove();
        }
    }

    function openNewTab(url) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    function onContextMenu(event) {
        if (!isDesktopContext() || event.defaultPrevented) return;
        if (event.shiftKey && (event.button === 2 || event.buttons === 2)) {
            if (menu && !menu.hidden) closeMenu(false, true);
            return;
        }
        if (isEditable(event.target)) return;

        const selection = window.getSelection ? window.getSelection() : null;
        if (selection && !selection.isCollapsed && String(selection).trim()) return;

        if (!event.target || typeof event.target.closest !== 'function') return;

        const anchor = event.target.closest('a[href]');
        if (!anchor) return;

        const url = resolveLink(anchor);
        if (!url) return;

        event.preventDefault();
        openMenu(event, anchor, url);
    }

    function init() {
        ensureMenu();
        ensureToast();
        document.addEventListener('contextmenu', onContextMenu);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
