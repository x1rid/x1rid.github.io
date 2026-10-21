/* ---------------------------------------------------------------------------
 *  Paint — a 320×200 pixel sheet with the small set of tools that matter:
 *  pencil, eraser, line, rectangle, ellipse, bucket, picker, undo/redo.
 *
 *  Inspired by JS Paint's pixel-perfect Windows Paint lineage (see README),
 *  rewritten for this site: no menus, no icon files, no dependencies, and a
 *  purple/black palette instead of the Windows grey chrome.
 * ------------------------------------------------------------------------- */
(() => {
    'use strict';

    const W = 320;
    const H = 200;
    const BG = '#0b061d';
    const MAX_HISTORY = 24;

    const ICON = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="2" y="3" width="20" height="17" fill="#07020a" stroke="#6f3a93"></rect>
            <path d="M5 16l5-5 4 4-5 5z" fill="#c084fc" stroke="#f2eaff" stroke-width="0.7"></path>
            <path d="M14 15l4-6 2 1-3 6z" fill="#ff4fd8"></path>
            <circle cx="7" cy="7" r="1.8" fill="#55ff99"></circle>
            <rect x="15" y="19" width="5" height="2" fill="#c084fc"></rect>
        </svg>`;

    const PALETTE = [
        ['#f2eaff', 'Paper white'],
        ['#cda6ff', 'Lavender'],
        ['#c084fc', 'Signal purple'],
        ['#a020f0', 'Deep purple'],
        ['#6f3a93', 'Plum'],
        ['#ff4fd8', 'Hot magenta'],
        ['#ff8fe0', 'Pink'],
        ['#55ff99', 'Terminal green'],
        ['#50fa7b', 'Mint'],
        ['#8be9fd', 'Cyan'],
        ['#ffb86c', 'Amber'],
        ['#ff5555', 'Red'],
        ['#bd93f9', 'Periwinkle'],
        ['#8b72b8', 'Muted violet'],
        ['#130927', 'Panel ink'],
        ['#0b061d', 'Background'],
    ];

    const TOOLS = [
        ['pencil', '✎', 'Pencil (B)'],
        ['eraser', '⌫', 'Eraser (E)'],
        ['line', '╱', 'Line (L)'],
        ['rect', '▭', 'Rectangle (R)'],
        ['ellipse', '◯', 'Ellipse (O)'],
        ['fill', '▨', 'Fill (G)'],
        ['picker', '◉', 'Pick colour (I)'],
    ];

    function hexToRgb(hex) {
        let value = String(hex || '').replace('#', '');
        if (value.length === 3) value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2];
        if (value.length !== 6) return [0, 0, 0];
        return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
    }

    function toHex(r, g, b) {
        return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
    }

    function mount(root, api) {
        root.innerHTML = `
            <div class="paint">
                <div class="app-toolbar paint-toolbar">
                    <div class="app-toolbar__group paint-tools" role="group" aria-label="Tools"></div>
                    <div class="app-toolbar__group paint-sizes" role="group" aria-label="Brush size">
                        <span class="app-toolbar__label">SIZE</span>
                        <button type="button" class="app-btn" data-size="2" aria-pressed="false">2</button>
                        <button type="button" class="app-btn is-active" data-size="4" aria-pressed="true">4</button>
                        <button type="button" class="app-btn" data-size="8" aria-pressed="false">8</button>
                    </div>
                    <div class="app-toolbar__group">
                        <button type="button" class="app-btn" data-paint="undo" title="Undo (Ctrl+Z)">UNDO</button>
                        <button type="button" class="app-btn" data-paint="redo" title="Redo (Ctrl+Y)">REDO</button>
                        <button type="button" class="app-btn app-btn--danger" data-paint="clear">CLEAR</button>
                        <button type="button" class="app-btn" data-paint="save">SAVE PNG</button>
                    </div>
                </div>

                <div class="app-toolbar paint-palette">
                    <div class="app-toolbar__group paint-swatches" role="group" aria-label="Colours"></div>
                    <div class="app-toolbar__group">
                        <span class="app-toolbar__label">CUSTOM</span>
                        <input class="paint-color" type="color" value="#c084fc" aria-label="Custom colour">
                    </div>
                </div>

                <div class="paint-stage">
                    <canvas class="paint-canvas" width="${W}" height="${H}" tabindex="0"
                            aria-label="Paint canvas, ${W} by ${H} pixels"></canvas>
                </div>

                <div class="paint-status">
                    <span data-role="position">X 000 · Y 000</span>
                    <span data-role="tool">PENCIL · 4 PX</span>
                    <span>CTRL+Z UNDO · SAVES LOCALLY</span>
                </div>
            </div>`;

        const canvas = root.querySelector('.paint-canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('canvas 2d context unavailable');

        const toolsEl = root.querySelector('.paint-tools');
        const sizesEl = root.querySelector('.paint-sizes');
        const swatchesEl = root.querySelector('.paint-swatches');
        const colorInput = root.querySelector('.paint-color');
        const positionEl = root.querySelector('[data-role="position"]');
        const toolEl = root.querySelector('[data-role="tool"]');
        const undoBtn = root.querySelector('[data-paint="undo"]');
        const redoBtn = root.querySelector('[data-paint="redo"]');

        let tool = 'pencil';
        let color = '#c084fc';
        let size = 4;
        let drawing = false;
        let pointerId = null;
        let startX = 0;
        let startY = 0;
        let lastX = 0;
        let lastY = 0;
        let snapshot = null;
        let undoStack = [];
        let redoStack = [];

        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, W, H);

        function toolLabel() {
            const found = TOOLS.find((entry) => entry[0] === tool);
            return `${found ? found[0] : tool} · ${tool === 'eraser' ? 2 : size} PX`;
        }

        function syncToolUi() {
            toolsEl.querySelectorAll('[data-tool]').forEach((button) => {
                const on = button.dataset.tool === tool;
                button.classList.toggle('is-active', on);
                button.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            toolEl.textContent = toolLabel().toUpperCase();
            api.setMeta(`${W}×${H} · ${toolLabel().toUpperCase()}`);
        }

        function syncColors() {
            swatchesEl.querySelectorAll('[data-color]').forEach((button) => {
                button.classList.toggle('is-active', button.dataset.color.toLowerCase() === color.toLowerCase());
            });
            colorInput.value = color;
        }

        function syncHistory() {
            undoBtn.disabled = undoStack.length === 0;
            redoBtn.disabled = redoStack.length === 0;
        }

        function grab() {
            return ctx.getImageData(0, 0, W, H);
        }

        function pushUndo() {
            undoStack.push(grab());
            if (undoStack.length > MAX_HISTORY) undoStack.shift();
            redoStack.length = 0;
            syncHistory();
        }

        function restore(image) {
            if (image) ctx.putImageData(image, 0, 0);
        }

        function undo() {
            if (!undoStack.length) return;
            redoStack.push(grab());
            restore(undoStack.pop());
            syncHistory();
        }

        function redo() {
            if (!redoStack.length) return;
            undoStack.push(grab());
            restore(redoStack.pop());
            syncHistory();
        }

        function pointFromEvent(event) {
            const rect = canvas.getBoundingClientRect();
            if (!rect.width || !rect.height) return { x: 0, y: 0 };
            const x = Math.floor(((event.clientX - rect.left) / rect.width) * W);
            const y = Math.floor(((event.clientY - rect.top) / rect.height) * H);
            return {
                x: Math.max(0, Math.min(W - 1, x)),
                y: Math.max(0, Math.min(H - 1, y)),
            };
        }

        function strokeStyle() {
            ctx.lineCap = 'square';
            ctx.lineJoin = 'miter';
            ctx.lineWidth = tool === 'eraser' ? 2 : size;
            ctx.strokeStyle = tool === 'eraser' ? BG : color;
            ctx.fillStyle = tool === 'eraser' ? BG : color;
        }

        function drawDot(x, y) {
            strokeStyle();
            const half = Math.floor((tool === 'eraser' ? 2 : size) / 2);
            ctx.fillRect(x - half, y - half, tool === 'eraser' ? 2 : size, tool === 'eraser' ? 2 : size);
        }

        function drawSegment(x0, y0, x1, y1) {
            strokeStyle();
            ctx.beginPath();
            ctx.moveTo(x0 + 0.5, y0 + 0.5);
            ctx.lineTo(x1 + 0.5, y1 + 0.5);
            ctx.stroke();
        }

        function drawShape(x0, y0, x1, y1) {
            strokeStyle();
            if (tool === 'line') {
                drawSegment(x0, y0, x1, y1);
                return;
            }
            ctx.beginPath();
            if (tool === 'rect') {
                ctx.rect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
            } else {
                const cx = (x0 + x1) / 2;
                const cy = (y0 + y1) / 2;
                ctx.ellipse(cx, cy, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
            }
            ctx.stroke();
        }

        function floodFill(sx, sy) {
            const image = grab();
            const data = image.data;
            const start = (sy * W + sx) * 4;
            const target = [data[start], data[start + 1], data[start + 2], data[start + 3]];
            const fill = hexToRgb(color);
            if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2] && target[3] === 255) return;

            const stack = [sy * W + sx];
            const seen = new Uint8Array(W * H);

            while (stack.length) {
                const index = stack.pop();
                if (seen[index]) continue;
                seen[index] = 1;
                const offset = index * 4;
                if (data[offset] !== target[0] || data[offset + 1] !== target[1] ||
                    data[offset + 2] !== target[2] || data[offset + 3] !== target[3]) continue;

                data[offset] = fill[0];
                data[offset + 1] = fill[1];
                data[offset + 2] = fill[2];
                data[offset + 3] = 255;

                const x = index % W;
                const y = (index - x) / W;
                if (x > 0) stack.push(index - 1);
                if (x < W - 1) stack.push(index + 1);
                if (y > 0) stack.push(index - W);
                if (y < H - 1) stack.push(index + W);
            }

            ctx.putImageData(image, 0, 0);
        }

        function pick(x, y) {
            const pixel = ctx.getImageData(x, y, 1, 1).data;
            color = toHex(pixel[0], pixel[1], pixel[2]);
            syncColors();
            syncToolUi();
        }

        function begin(event) {
            if (event.button !== 0) return;
            event.preventDefault();
            const pos = pointFromEvent(event);
            drawing = true;
            pointerId = event.pointerId;
            startX = pos.x;
            startY = pos.y;
            lastX = pos.x;
            lastY = pos.y;

            if (tool === 'picker') {
                pick(pos.x, pos.y);
                drawing = false;
                return;
            }

            pushUndo();

            if (tool === 'fill') {
                floodFill(pos.x, pos.y);
                drawing = false;
                return;
            }

            if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
                snapshot = grab();
                return;
            }

            drawDot(pos.x, pos.y);
        }

        function move(event) {
            const pos = pointFromEvent(event);
            positionEl.textContent = `X ${String(pos.x).padStart(3, '0')} · Y ${String(pos.y).padStart(3, '0')}`;
            if (!drawing) return;
            event.preventDefault();

            if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
                restore(snapshot);
                drawShape(startX, startY, pos.x, pos.y);
                return;
            }

            if (tool === 'pencil' || tool === 'eraser') {
                drawSegment(lastX, lastY, pos.x, pos.y);
                lastX = pos.x;
                lastY = pos.y;
            }
        }

        function end(event) {
            if (!drawing) return;
            if (event && event.pointerId !== pointerId) return;
            drawing = false;
            pointerId = null;
            snapshot = null;
            if (canvas.hasPointerCapture && event && canvas.hasPointerCapture(event.pointerId)) {
                canvas.releasePointerCapture(event.pointerId);
            }
        }

        function clearCanvas() {
            pushUndo();
            ctx.fillStyle = BG;
            ctx.fillRect(0, 0, W, H);
        }

        function savePng() {
            if (!canvas.toBlob) return;
            canvas.toBlob((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                link.href = url;
                link.download = `r3d1bruh-paint-${stamp}.png`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 1500);
            }, 'image/png');
        }

        TOOLS.forEach(([id, glyph, title]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'paint-tool';
            button.dataset.tool = id;
            button.textContent = glyph;
            button.title = title;
            button.setAttribute('aria-label', title);
            button.setAttribute('aria-pressed', 'false');
            button.addEventListener('click', () => {
                tool = id;
                syncToolUi();
            });
            toolsEl.appendChild(button);
        });

        PALETTE.forEach(([value, label]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'paint-swatch';
            button.dataset.color = value;
            button.style.background = value;
            button.title = label;
            button.setAttribute('aria-label', label);
            button.addEventListener('click', () => {
                color = value;
                if (tool === 'eraser') tool = 'pencil';
                syncColors();
                syncToolUi();
            });
            swatchesEl.appendChild(button);
        });

        colorInput.addEventListener('input', () => {
            color = colorInput.value;
            if (tool === 'eraser') tool = 'pencil';
            syncColors();
            syncToolUi();
        });

        sizesEl.querySelectorAll('[data-size]').forEach((button) => {
            button.addEventListener('click', () => {
                size = Number(button.dataset.size) || 4;
                sizesEl.querySelectorAll('[data-size]').forEach((other) => {
                    const on = other === button;
                    other.classList.toggle('is-active', on);
                    other.setAttribute('aria-pressed', on ? 'true' : 'false');
                });
                syncToolUi();
            });
        });

        root.querySelector('[data-paint="undo"]').addEventListener('click', undo);
        root.querySelector('[data-paint="redo"]').addEventListener('click', redo);
        root.querySelector('[data-paint="clear"]').addEventListener('click', clearCanvas);
        root.querySelector('[data-paint="save"]').addEventListener('click', savePng);

        canvas.addEventListener('pointerdown', (event) => {
            if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
            begin(event);
        });
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('pointerleave', (event) => {
            if (drawing && event.buttons === 0) end(event);
        });
        canvas.addEventListener('contextmenu', (event) => event.preventDefault());

        root.addEventListener('keydown', (event) => {
            const target = event.target;
            if (target && target.closest && target.closest('input, textarea')) return;
            const key = event.key.toLowerCase();
            const ctrl = event.ctrlKey || event.metaKey;

            if (ctrl && key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); return; }
            if (ctrl && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); redo(); return; }
            if (key === 'b') { tool = 'pencil'; syncToolUi(); }
            else if (key === 'e') { tool = 'eraser'; syncToolUi(); }
            else if (key === 'l') { tool = 'line'; syncToolUi(); }
            else if (key === 'r') { tool = 'rect'; syncToolUi(); }
            else if (key === 'o') { tool = 'ellipse'; syncToolUi(); }
            else if (key === 'g') { tool = 'fill'; syncToolUi(); }
            else if (key === 'i') { tool = 'picker'; syncToolUi(); }
        });

        syncToolUi();
        syncColors();
        syncHistory();
        api.setMeta(`${W}×${H} · PENCIL · 4 PX`);

        return function cleanup() {
            drawing = false;
            snapshot = null;
            undoStack = [];
            redoStack = [];
        };
    }

    if (window.RetroApps) {
        window.RetroApps.register({
            id: 'paint',
            name: 'Paint',
            tagline: 'A 320×200 pixel sheet with pencil, shapes, bucket and undo.',
            meta: '320×200 · 7 TOOLS',
            icon: ICON,
            mount,
        });
    }
})();
