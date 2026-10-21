(() => {
  const layout = document.querySelector('.layout-grid');
  const splitter = document.querySelector('.panel-splitter');
  const sidebar = document.querySelector('.sidebar');
  const content = document.querySelector('.content-area');
  const railContext = document.querySelector('.rail-context');
  const storageKey = 'retroSidebarWidth';
  const mobileQuery = window.matchMedia('(max-width: 760px)');
  const dividerWidth = 10;
  const minimumSidebar = 220;
  const minimumContent = 400;
  /* Compact on load — the sidebar starts at its minimum width. */
  const defaultSidebar = minimumSidebar;

  if (!layout || !splitter || !sidebar || !content) return;

  function getBounds() {
    const available = layout.clientWidth - dividerWidth;
    const minimum = Math.min(minimumSidebar, Math.max(0, available - minimumContent));
    const maximum = Math.max(minimum, available - minimumContent);
    return { minimum, maximum };
  }

  function clampWidth(width) {
    const bounds = getBounds();
    return Math.min(bounds.maximum, Math.max(bounds.minimum, width));
  }

  function setWidth(width, persist) {
    const value = clampWidth(width);
    layout.style.setProperty('--sidebar-width', `${value}px`);
    /* Focusable separators are window splitters: expose the value. */
    const bounds = getBounds();
    splitter.setAttribute('aria-valuenow', String(Math.round(value)));
    splitter.setAttribute('aria-valuemin', String(Math.round(bounds.minimum)));
    splitter.setAttribute('aria-valuemax', String(Math.round(bounds.maximum)));
    if (persist) {
      try {
        localStorage.setItem(storageKey, String(Math.round(value)));
      } catch (_) {}
    }
  }

  /* While the divider is held, the rail reports the live width. The
     value is written only when it actually changes. */
  function reportWidth() {
    if (!railContext) return;
    const text = `SIDEBAR: ${splitter.getAttribute('aria-valuenow')}PX`;
    if (railContext.textContent !== text) railContext.textContent = text;
  }

  function clearWidth() {
    if (railContext) railContext.textContent = '';
  }

  function restoreWidth() {
    if (mobileQuery.matches) return;
    let savedWidth = null;
    try {
      savedWidth = Number(localStorage.getItem(storageKey));
    } catch (_) {}
    const initialWidth = Number.isFinite(savedWidth) && savedWidth > 0
      ? savedWidth
      : defaultSidebar;
    setWidth(initialWidth, false);
  }

  let pointerId = null;

  splitter.addEventListener('pointerdown', (event) => {
    if (mobileQuery.matches) return;
    pointerId = event.pointerId;
    splitter.setPointerCapture(pointerId);
    document.body.classList.add('is-splitting');
    reportWidth();
    event.preventDefault();
  });

  splitter.addEventListener('pointermove', (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    const layoutRect = layout.getBoundingClientRect();
    setWidth(event.clientX - layoutRect.left, true);
    reportWidth();
  });

  function stopDragging(event) {
    if (pointerId === null || (event && event.pointerId !== pointerId)) return;
    pointerId = null;
    document.body.classList.remove('is-splitting');
    clearWidth();
  }

  splitter.addEventListener('pointerup', stopDragging);
  splitter.addEventListener('pointercancel', stopDragging);
  splitter.addEventListener('lostpointercapture', stopDragging);

  splitter.addEventListener('keydown', (event) => {
    if (mobileQuery.matches) return;
    const current = sidebar.getBoundingClientRect().width;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      setWidth(current + (event.key === 'ArrowRight' ? 16 : -16), true);
      reportWidth();
      event.preventDefault();
    }
  });

  splitter.addEventListener('blur', clearWidth);

  splitter.addEventListener('dblclick', () => {
    setWidth(defaultSidebar, true);
  });

  window.addEventListener('resize', restoreWidth);
  restoreWidth();
})();
