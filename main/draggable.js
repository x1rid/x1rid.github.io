/* ---------------------------------------------------------------------------
 * draggable.js — shared pointer-drag physics for the retro windows and dock.
 *
 * Deliberately a classic script (no ES modules) so every page keeps working
 * when opened directly from disk (file://). It exposes one global:
 *
 *     window.RetroDrag.makeDraggable(element, handle, options)
 *
 * options (all optional):
 *   storageKey         localStorage key for the persisted { left, top } spot
 *   threshold          px of movement before a press counts as a drag;
 *                      0 starts the drag on pointer-down (title bars)
 *   margin             px kept clear at each viewport edge (default 8)
 *   offset             px gap from the lower-right corner for the default spot
 *   fallbackSize       { width, height } used while the element is hidden
 *   cornerPinned       true when the element is pinned via right/bottom and
 *                      must switch to left/top on its first move (the dock)
 *   ignoreButtons      true to never start a drag from a <button> (chrome)
 *   dragClass          class toggled on the element while dragging
 *   dblclickReset      true to snap back to the default spot on double-click
 *   allow              () => boolean, checked on every pointer-down and by
 *                      restore/clamp/reset. When it returns false the element
 *                      stops being draggable AND any inline position is
 *                      cleared, so a stylesheet can take over the placement
 *                      (the phone pins the dock and turns the player into a
 *                      bottom sheet). Lives per breakpoint, not per load.
 *   onDragStateChange  (dragging) => void, called when a real drag starts/stops
 *
 * returns { wasDragged, isDragging, restore, save, reset, clamp, apply, default }
 *   wasDragged()  true when the last press turned into a drag — use it to
 *                 swallow the click that follows a drag
 *   restore()     apply the saved position, else the default corner
 *   clamp()       re-clamp the current position into the viewport (on resize)
 * ------------------------------------------------------------------------- */
(function () {
    'use strict';

    var DEFAULT_MARGIN = 8;
    var DEFAULT_OFFSET = 14;

    function clampValue(value, min, max) {
        if (max < min) return min;
        return Math.min(max, Math.max(min, value));
    }

    function makeDraggable(element, handle, options) {
        if (!element || !handle) return null;

        var opts = options || {};
        var storageKey = opts.storageKey || '';
        var margin = Number.isFinite(opts.margin) ? opts.margin : DEFAULT_MARGIN;
        var offset = Number.isFinite(opts.offset) ? opts.offset : DEFAULT_OFFSET;
        var threshold = Number.isFinite(opts.threshold) ? opts.threshold : 0;
        var dragClass = opts.dragClass || 'is-dragging';
        var cornerPinned = opts.cornerPinned === true;
        var ignoreButtons = opts.ignoreButtons === true;
        var dblclickReset = opts.dblclickReset === true;
        var onDragStateChange = typeof opts.onDragStateChange === 'function' ? opts.onDragStateChange : null;
        var fallbackSize = opts.fallbackSize || { width: 0, height: 0 };
        var allow = typeof opts.allow === 'function' ? opts.allow : null;

        var drag = null;
        var dragging = false;
        var moved = false;
        var moveRaf = 0;
        var pending = null;

        /* Capability gate: re-evaluated every time it matters, so crossing a
           breakpoint changes the behaviour without recreating the controller. */
        function permitted() {
            return !allow || allow();
        }

        /* Hand the element back to its stylesheet (the phone pins it). */
        function clearPosition() {
            element.style.left = '';
            element.style.top = '';
            element.style.right = '';
            element.style.bottom = '';
        }

        function size() {
            return {
                width: element.offsetWidth || fallbackSize.width || 1,
                height: element.offsetHeight || fallbackSize.height || 1
            };
        }

        function clampPosition(left, top) {
            var dims = size();
            var maxLeft = Math.max(margin, window.innerWidth - dims.width - margin);
            var maxTop = Math.max(margin, window.innerHeight - dims.height - margin);
            return {
                left: clampValue(left, margin, maxLeft),
                top: clampValue(top, margin, maxTop)
            };
        }

        function writePosition(left, top) {
            element.style.left = Math.round(left) + 'px';
            element.style.top = Math.round(top) + 'px';
            if (cornerPinned) {
                /* A corner-pinned element is placed from its top-left once it
                   has been moved, so the corner offsets have to stand down. */
                element.style.right = 'auto';
                element.style.bottom = 'auto';
            }
        }

        function apply(left, top) {
            var position = clampPosition(left, top);
            writePosition(position.left, position.top);
            return position;
        }

        function defaultPosition() {
            var dims = size();
            return clampPosition(
                window.innerWidth - dims.width - offset,
                window.innerHeight - dims.height - offset
            );
        }

        function save() {
            if (!storageKey) return;
            var position = {
                left: Math.round(parseFloat(element.style.left) || 0),
                top: Math.round(parseFloat(element.style.top) || 0)
            };
            try {
                localStorage.setItem(storageKey, JSON.stringify(position));
            } catch (_) {
                /* ignore storage errors */
            }
        }

        function restore() {
            if (!permitted()) {
                clearPosition();
                return;
            }
            var saved = null;
            if (storageKey) {
                try {
                    var raw = localStorage.getItem(storageKey);
                    saved = raw ? JSON.parse(raw) : null;
                } catch (_) {
                    saved = null;
                }
            }
            if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
                apply(saved.left, saved.top);
            } else {
                var position = defaultPosition();
                apply(position.left, position.top);
            }
        }

        function reset() {
            if (!permitted()) {
                clearPosition();
                return;
            }
            if (storageKey) {
                try {
                    localStorage.removeItem(storageKey);
                } catch (_) {
                    /* ignore storage errors */
                }
            }
            var position = defaultPosition();
            apply(position.left, position.top);
        }

        function clampNow() {
            if (!permitted()) {
                clearPosition();
                return;
            }
            if (element.hidden) return;
            var left = parseFloat(element.style.left);
            var top = parseFloat(element.style.top);
            var fallbackPosition = defaultPosition();
            apply(
                Number.isFinite(left) ? left : fallbackPosition.left,
                Number.isFinite(top) ? top : fallbackPosition.top
            );
        }

        function flush() {
            if (!pending) return;
            writePosition(pending.left, pending.top);
        }

        function beginDrag(event) {
            dragging = true;
            moved = true;
            element.classList.add(dragClass);
            try {
                handle.setPointerCapture(event.pointerId);
            } catch (_) {
                /* capture is best-effort */
            }
            if (onDragStateChange) onDragStateChange(true);
        }

        function endDrag(event) {
            if (!drag || (event && event.pointerId !== drag.pointerId)) return;
            if (moveRaf) {
                cancelAnimationFrame(moveRaf);
                moveRaf = 0;
            }
            if (moved) {
                flush();
                save();
            }
            drag = null;
            pending = null;
            if (dragging) {
                dragging = false;
                element.classList.remove(dragClass);
                if (onDragStateChange) onDragStateChange(false);
            }
        }

        handle.addEventListener('pointerdown', function (event) {
            moved = false;
            pending = null;
            drag = null;
            if (event.button !== 0) return;
            if (!permitted()) return;
            if (ignoreButtons && event.target && event.target.closest && event.target.closest('button')) return;

            var rect = element.getBoundingClientRect();
            drag = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top
            };

            if (threshold <= 0) {
                /* Title-bar behaviour: follow the pointer straight away. */
                beginDrag(event);
                event.preventDefault();
            }
        });

        handle.addEventListener('pointermove', function (event) {
            if (!drag || event.pointerId !== drag.pointerId) return;

            if (!moved) {
                var dx = event.clientX - drag.startX;
                var dy = event.clientY - drag.startY;
                /* Anything below the threshold is still a tap, so the click
                   that follows keeps working (the dock opens the player). */
                if (Math.abs(dx) + Math.abs(dy) < threshold) return;
                beginDrag(event);
            }

            var dims = size();
            var maxLeft = Math.max(margin, window.innerWidth - dims.width - margin);
            var maxTop = Math.max(margin, window.innerHeight - dims.height - margin);
            pending = {
                left: clampValue(event.clientX - drag.offsetX, margin, maxLeft),
                top: clampValue(event.clientY - drag.offsetY, margin, maxTop)
            };

            if (!moveRaf) {
                moveRaf = requestAnimationFrame(function () {
                    moveRaf = 0;
                    flush();
                });
            }

            event.preventDefault();
        });

        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);
        handle.addEventListener('lostpointercapture', endDrag);

        if (dblclickReset) {
            element.addEventListener('dblclick', function () {
                if (dragging) return;
                reset();
            });
        }

        return {
            wasDragged: function () { return moved; },
            isDragging: function () { return dragging; },
            restore: restore,
            save: save,
            reset: reset,
            clamp: clampNow,
            apply: apply,
            default: defaultPosition
        };
    }

    window.RetroDrag = { makeDraggable: makeDraggable };
})();
