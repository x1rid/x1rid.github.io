/* ---------------------------------------------------------------------------
 * desktop-selection.js
 * Right-drag selection for desktop icons. A short right-click still reaches
 * the shell context menu; only a real drag suppresses that menu.
 * ------------------------------------------------------------------------- */
(function (window, document) {
  'use strict';

  const desktop = document.getElementById('desktop');
  if (!desktop) return;

  const rectangle = document.createElement('div');
  rectangle.className = 'desktop-selection-rectangle';
  rectangle.setAttribute('aria-hidden', 'true');
  desktop.appendChild(rectangle);

  let gesture = null;
  let suppressContextMenu = false;
  const THRESHOLD = 4;

  function clearSelection() {
    desktop.querySelectorAll('.desktop-icon.is-desktop-selected').forEach((icon) => {
      icon.classList.remove('is-desktop-selected');
      icon.removeAttribute('aria-selected');
    });
  }

  function intersects(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function update(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const x1 = Math.min(gesture.startX, event.clientX);
    const y1 = Math.min(gesture.startY, event.clientY);
    const x2 = Math.max(gesture.startX, event.clientX);
    const y2 = Math.max(gesture.startY, event.clientY);
    if (!gesture.active && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < THRESHOLD) return;
    gesture.active = true;
    rectangle.hidden = false;
    rectangle.style.left = (x1 - gesture.bounds.left) + 'px';
    rectangle.style.top = (y1 - gesture.bounds.top) + 'px';
    rectangle.style.width = (x2 - x1) + 'px';
    rectangle.style.height = (y2 - y1) + 'px';
    const area = { left: x1, top: y1, right: x2, bottom: y2 };
    desktop.querySelectorAll('.desktop-icon').forEach((icon) => {
      const selected = intersects(area, icon.getBoundingClientRect());
      icon.classList.toggle('is-desktop-selected', selected);
      if (selected) icon.setAttribute('aria-selected', 'true');
      else icon.removeAttribute('aria-selected');
    });
  }

  function finish(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    suppressContextMenu = gesture.active;
    rectangle.hidden = true;
    rectangle.style.removeProperty('width');
    rectangle.style.removeProperty('height');
    try { desktop.releasePointerCapture(gesture.pointerId); } catch (_) { /* not captured */ }
    gesture = null;
  }

  desktop.addEventListener('pointerdown', (event) => {
    if (event.button !== 2 || event.pointerType === 'touch') return;
    if (event.target.closest('.desktop-icon, .window, .context-menu')) return;
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      bounds: desktop.getBoundingClientRect(),
      active: false
    };
    clearSelection();
    try { desktop.setPointerCapture(event.pointerId); } catch (_) { /* optional */ }
  });
  desktop.addEventListener('pointermove', update);
  desktop.addEventListener('pointerup', finish);
  desktop.addEventListener('pointercancel', finish);
  desktop.addEventListener('contextmenu', (event) => {
    if (!suppressContextMenu) return;
    suppressContextMenu = false;
    event.preventDefault();
    event.stopPropagation();
  });

  window.DesktopSelection = { clear: clearSelection };
})(window, document);
