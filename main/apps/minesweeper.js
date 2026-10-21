/* ---------------------------------------------------------------------------
 *  Minesweeper — a purple/black reading of the 1992 classic.
 *
 *  Faithful rules: first click is always safe, chording works, flags never
 *  hide a real mine, and the clock is the real elapsed time (no fake timer).
 *  Right-click flags; touch long-press flags; F flags from the keyboard.
 * ------------------------------------------------------------------------- */
(() => {
    'use strict';

    const LEVELS = {
        beginner: { cols: 9, rows: 9, mines: 10, label: 'BEGINNER' },
        intermediate: { cols: 16, rows: 16, mines: 40, label: 'INTERMEDIATE' },
        expert: { cols: 30, rows: 16, mines: 99, label: 'EXPERT' },
    };

    const ICON = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="2" y="2" width="20" height="20" fill="#07020a" stroke="#6f3a93"></rect>
            <path d="M12 5.5v13M5.5 12h13M7.4 7.4l9.2 9.2M16.6 7.4l-9.2 9.2"
                  stroke="#c084fc" stroke-width="1.1"></path>
            <circle cx="12" cy="12" r="3.2" fill="#ff4fd8" stroke="#f2eaff" stroke-width="0.8"></circle>
            <rect x="11" y="3" width="2" height="3" fill="#f2eaff"></rect>
        </svg>`;

    function mount(root, api) {
        root.innerHTML = `
            <div class="ms">
                <div class="app-toolbar">
                    <div class="app-toolbar__group ms-levels" role="group" aria-label="Difficulty">
                        <button type="button" class="app-btn is-active" data-level="beginner" aria-pressed="true">BEGINNER</button>
                        <button type="button" class="app-btn" data-level="intermediate" aria-pressed="false">INTERMEDIATE</button>
                        <button type="button" class="app-btn" data-level="expert" aria-pressed="false">EXPERT</button>
                    </div>
                    <div class="app-toolbar__group">
                        <span class="app-toolbar__label">CLICK</span>
                        <span class="app-readout">REVEAL</span>
                        <span class="app-toolbar__label">·</span>
                        <span class="app-readout">R-CLICK FLAG</span>
                    </div>
                </div>

                <div class="ms-hud">
                    <span class="ms-readout" data-role="flags" title="Mines minus flags">010</span>
                    <button type="button" class="ms-face" data-role="face" data-face="ready" aria-label="Start a new game" title="New game">:-)</button>
                    <span class="ms-readout" data-role="time" title="Elapsed time">000</span>
                </div>

                <div class="ms-board-wrap">
                    <div class="ms-board" data-role="board" role="grid" aria-label="Minefield"></div>
                </div>

                <p class="ms-status" data-role="status" data-state="ready" role="status" aria-live="polite">READY — FIRST CLICK IS SAFE</p>
                <p class="app-hint">Arrows move, <kbd>Space</kbd> reveals, <kbd>F</kbd> flags. Clicking a number whose flags are complete clears its neighbours.</p>
            </div>`;

        const boardEl = root.querySelector('[data-role="board"]');
        const flagsEl = root.querySelector('[data-role="flags"]');
        const timeEl = root.querySelector('[data-role="time"]');
        const faceEl = root.querySelector('[data-role="face"]');
        const statusEl = root.querySelector('[data-role="status"]');
        const levelButtons = Array.from(root.querySelectorAll('[data-level]'));

        let levelKey = 'beginner';
        let cols = LEVELS.beginner.cols;
        let rows = LEVELS.beginner.rows;
        let mineCount = LEVELS.beginner.mines;
        let cells = [];
        let cellEls = [];
        let flags = 0;
        let revealed = 0;
        let startedAt = 0;
        let started = false;
        let over = false;
        let won = false;
        let timerId = 0;
        let focusRow = 0;
        let focusCol = 0;
        let suppressClick = false;
        let pressTimer = 0;
        let pressCell = null;

        function pad(value) {
            return String(Math.max(0, Math.min(999, Math.floor(value)))).padStart(3, '0');
        }

        function neighbourCoords(row, col) {
            const out = [];
            for (let dr = -1; dr <= 1; dr += 1) {
                for (let dc = -1; dc <= 1; dc += 1) {
                    if (!dr && !dc) continue;
                    const r = row + dr;
                    const c = col + dc;
                    if (r >= 0 && r < rows && c >= 0 && c < cols) out.push([r, c]);
                }
            }
            return out;
        }

        function setFace(state) {
            faceEl.dataset.face = state;
            faceEl.textContent = state === 'lost' ? 'x_x' : state === 'won' ? 'B-)' : ':-)';
            faceEl.setAttribute('aria-label', state === 'lost' ? 'Field lost. Start a new game' : state === 'won' ? 'Field cleared. Start a new game' : 'Start a new game');
        }

        function setStatus(text, state) {
            statusEl.textContent = text;
            statusEl.dataset.state = state || 'ready';
        }

        function updateHud() {
            flagsEl.textContent = pad(Math.max(-99, mineCount - flags));
            flagsEl.style.color = flags > mineCount ? 'var(--signal-hot)' : '';
        }

        function stopTimer() {
            if (timerId) {
                window.clearInterval(timerId);
                timerId = 0;
            }
        }

        function tick() {
            if (!started || over) return;
            timeEl.textContent = pad((Date.now() - startedAt) / 1000);
        }

        function startTimer() {
            if (started || over) return;
            started = true;
            startedAt = Date.now();
            timeEl.textContent = '000';
            timerId = window.setInterval(tick, 250);
            api.setMeta(`${LEVELS[levelKey].label} · ${cols}×${rows} · ACTIVE`);
        }

        function seed(firstRow, firstCol) {
            const safe = new Set([`${firstRow},${firstCol}`]);
            neighbourCoords(firstRow, firstCol).forEach(([r, c]) => safe.add(`${r},${c}`));

            const pool = [];
            for (let r = 0; r < rows; r += 1) {
                for (let c = 0; c < cols; c += 1) {
                    if (!safe.has(`${r},${c}`)) pool.push([r, c]);
                }
            }

            /* Expert boards still have plenty of safe cells. If a custom tiny
               board ever cannot exclude the whole neighbourhood, fall back to
               excluding only the clicked cell. */
            if (pool.length < mineCount) {
                pool.length = 0;
                for (let r = 0; r < rows; r += 1) {
                    for (let c = 0; c < cols; c += 1) {
                        if (r !== firstRow || c !== firstCol) pool.push([r, c]);
                    }
                }
            }

            for (let i = pool.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = pool[i];
                pool[i] = pool[j];
                pool[j] = tmp;
            }

            pool.slice(0, mineCount).forEach(([r, c]) => {
                cells[r][c].mine = true;
            });

            for (let r = 0; r < rows; r += 1) {
                for (let c = 0; c < cols; c += 1) {
                    if (cells[r][c].mine) continue;
                    cells[r][c].n = neighbourCoords(r, c).filter(([nr, nc]) => cells[nr][nc].mine).length;
                }
            }
        }

        function cellLabel(cell, row, col) {
            const position = `Row ${row + 1}, column ${col + 1}`;
            if (cell.open) {
                if (cell.mine) return `${position}: mine`;
                return cell.n ? `${position}: ${cell.n} adjacent mines` : `${position}: clear`;
            }
            return `${position}: ${cell.flag ? 'flagged' : 'covered'}`;
        }

        function paintCell(row, col) {
            const cell = cells[row][col];
            const el = cellEls[row][col];
            if (!cell || !el) return;

            el.className = 'ms-cell';
            el.textContent = '';
            el.removeAttribute('data-n');
            el.setAttribute('aria-label', cellLabel(cell, row, col));

            if (cell.open) {
                el.classList.add('is-open');
                el.tabIndex = -1;
                if (cell.mine) {
                    el.classList.add('is-mine');
                    el.textContent = '✹';
                } else if (cell.n) {
                    el.dataset.n = String(cell.n);
                    el.textContent = String(cell.n);
                }
            } else {
                el.tabIndex = row === focusRow && col === focusCol ? 0 : -1;
                if (cell.wrong) {
                    el.classList.add('is-wrong');
                    el.textContent = '⚑';
                } else if (cell.flag) {
                    el.classList.add('is-flag');
                    el.textContent = '⚑';
                }
            }
        }

        function paintAll() {
            for (let r = 0; r < rows; r += 1) {
                for (let c = 0; c < cols; c += 1) paintCell(r, c);
            }
        }

        function buildBoard() {
            boardEl.replaceChildren();
            boardEl.style.setProperty('--ms-cols', String(cols));
            const fragment = document.createDocumentFragment();
            cellEls = [];

            for (let r = 0; r < rows; r += 1) {
                const rowEls = [];
                for (let c = 0; c < cols; c += 1) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'ms-cell';
                    button.dataset.r = String(r);
                    button.dataset.c = String(c);
                    button.tabIndex = r === 0 && c === 0 ? 0 : -1;
                    button.setAttribute('role', 'gridcell');
                    button.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}: covered`);
                    rowEls.push(button);
                    fragment.appendChild(button);
                }
                cellEls.push(rowEls);
            }

            boardEl.appendChild(fragment);
            paintAll();
        }

        function reset(key) {
            stopTimer();
            levelKey = key || levelKey;
            const level = LEVELS[levelKey];
            cols = level.cols;
            rows = level.rows;
            mineCount = level.mines;

            cells = [];
            for (let r = 0; r < rows; r += 1) {
                const row = [];
                for (let c = 0; c < cols; c += 1) {
                    row.push({ mine: false, open: false, flag: false, wrong: false, n: 0 });
                }
                cells.push(row);
            }

            flags = 0;
            revealed = 0;
            started = false;
            over = false;
            won = false;
            focusRow = 0;
            focusCol = 0;
            timeEl.textContent = '000';
            setFace('ready');
            setStatus('READY — FIRST CLICK IS SAFE', 'ready');
            updateHud();
            buildBoard();
            api.setMeta(`${LEVELS[levelKey].label} · ${cols}×${rows} · ${mineCount} MINES`);

            levelButtons.forEach((button) => {
                const on = button.dataset.level === levelKey;
                button.classList.toggle('is-active', on);
                button.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
        }

        function revealCell(row, col) {
            const cell = cells[row][col];
            if (!cell || cell.open || cell.flag || over) return;

            if (!started) {
                seed(row, col);
                startTimer();
                setStatus('FIELD LIVE', 'active');
            }

            if (cell.mine) {
                lose(row, col);
                return;
            }

            const stack = [[row, col]];
            while (stack.length) {
                const [r, c] = stack.pop();
                const current = cells[r][c];
                if (current.open || current.flag || current.mine) continue;

                current.open = true;
                revealed += 1;
                paintCell(r, c);

                if (current.n === 0) {
                    neighbourCoords(r, c).forEach(([nr, nc]) => {
                        if (!cells[nr][nc].open && !cells[nr][nc].flag) stack.push([nr, nc]);
                    });
                }
            }

            if (revealed === cols * rows - mineCount) win();
        }

        function toggleFlag(row, col) {
            const cell = cells[row][col];
            if (!cell || cell.open || over) return;
            if (!started) {
                /* A flag before the first reveal does not start the clock, but
                   it does set expectations; the first reveal still seeds. */
                setStatus('FLAGGED — REVEAL WHEN READY', 'ready');
            }
            cell.flag = !cell.flag;
            flags += cell.flag ? 1 : -1;
            paintCell(row, col);
            updateHud();
        }

        function chord(row, col) {
            const cell = cells[row][col];
            if (!cell || !cell.open || !cell.n || over) return;
            const around = neighbourCoords(row, col);
            const flagged = around.filter(([r, c]) => cells[r][c].flag).length;
            if (flagged !== cell.n) return;
            around.forEach(([r, c]) => {
                if (!cells[r][c].flag && !cells[r][c].open) revealCell(r, c);
            });
        }

        function lose(hitRow, hitCol) {
            over = true;
            stopTimer();
            cells.forEach((row, r) => {
                row.forEach((cell, c) => {
                    if (cell.mine) cell.open = true;
                    if (cell.flag && !cell.mine) cell.wrong = true;
                    if (r === hitRow && c === hitCol) cell.open = true;
                });
            });
            paintAll();
            setFace('lost');
            setStatus('BOOM — FIELD LOST. PRESS THE FACE TO RESET.', 'lost');
            api.setMeta(`${LEVELS[levelKey].label} · FIELD LOST`);
        }

        function win() {
            over = true;
            won = true;
            stopTimer();
            cells.forEach((row, r) => {
                row.forEach((cell, c) => {
                    if (cell.mine && !cell.flag) {
                        cell.flag = true;
                        flags += 1;
                        paintCell(r, c);
                    }
                });
            });
            updateHud();
            setFace('won');
            const seconds = Math.floor((Date.now() - startedAt) / 1000);
            setStatus(`FIELD CLEARED IN ${seconds}s. PRESS THE FACE FOR A NEW ONE.`, 'won');
            api.setMeta(`${LEVELS[levelKey].label} · CLEARED · ${seconds}s`);
        }

        function moveFocus(nextRow, nextCol) {
            const row = Math.max(0, Math.min(rows - 1, nextRow));
            const col = Math.max(0, Math.min(cols - 1, nextCol));
            if (row === focusRow && col === focusCol) return;
            focusRow = row;
            focusCol = col;
            cellEls.forEach((rowEls, r) => {
                rowEls.forEach((el, c) => {
                    el.tabIndex = r === focusRow && c === focusCol ? 0 : -1;
                });
            });
            const target = cellEls[row][col];
            if (target) target.focus();
        }

        function cellFromEvent(event) {
            const target = event.target && event.target.closest ? event.target.closest('.ms-cell') : null;
            if (!target || !boardEl.contains(target)) return null;
            return { row: Number(target.dataset.r), col: Number(target.dataset.c) };
        }

        function cancelPress() {
            if (pressTimer) {
                window.clearTimeout(pressTimer);
                pressTimer = 0;
            }
            pressCell = null;
        }

        boardEl.addEventListener('click', (event) => {
            const pos = cellFromEvent(event);
            if (!pos) return;
            if (suppressClick) {
                suppressClick = false;
                return;
            }
            focusRow = pos.row;
            focusCol = pos.col;
            const cell = cells[pos.row][pos.col];
            if (cell.open) {
                chord(pos.row, pos.col);
            } else if (event.shiftKey) {
                toggleFlag(pos.row, pos.col);
            } else {
                revealCell(pos.row, pos.col);
            }
        });

        boardEl.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            /* A touch long-press already flagged the cell; Android then fires
               contextmenu and click, which would toggle it straight back. */
            if (suppressClick) return;
            const pos = cellFromEvent(event);
            if (pos) toggleFlag(pos.row, pos.col);
        });

        boardEl.addEventListener('pointerdown', (event) => {
            if (event.pointerType !== 'touch') return;
            const pos = cellFromEvent(event);
            if (!pos) return;
            pressCell = pos;
            suppressClick = false;
            pressTimer = window.setTimeout(() => {
                pressTimer = 0;
                if (!pressCell) return;
                toggleFlag(pressCell.row, pressCell.col);
                suppressClick = true;
                pressCell = null;
            }, 450);
        });

        boardEl.addEventListener('pointerup', cancelPress);
        boardEl.addEventListener('pointercancel', cancelPress);
        boardEl.addEventListener('pointermove', (event) => {
            if (pressCell && (event.movementX || event.movementY)) cancelPress();
        });

        boardEl.addEventListener('keydown', (event) => {
            const pos = cellFromEvent(event) || { row: focusRow, col: focusCol };
            const key = event.key;
            if (key === 'ArrowUp') { event.preventDefault(); moveFocus(pos.row - 1, pos.col); return; }
            if (key === 'ArrowDown') { event.preventDefault(); moveFocus(pos.row + 1, pos.col); return; }
            if (key === 'ArrowLeft') { event.preventDefault(); moveFocus(pos.row, pos.col - 1); return; }
            if (key === 'ArrowRight') { event.preventDefault(); moveFocus(pos.row, pos.col + 1); return; }
            if (key === 'Home') { event.preventDefault(); moveFocus(pos.row, 0); return; }
            if (key === 'End') { event.preventDefault(); moveFocus(pos.row, cols - 1); return; }

            if (key === ' ' || key === 'Enter') {
                event.preventDefault();
                const cell = cells[pos.row][pos.col];
                if (cell.open) chord(pos.row, pos.col);
                else revealCell(pos.row, pos.col);
                return;
            }
            if (key === 'f' || key === 'F') {
                event.preventDefault();
                toggleFlag(pos.row, pos.col);
            }
        });

        faceEl.addEventListener('click', () => reset(levelKey));

        levelButtons.forEach((button) => {
            button.addEventListener('click', () => reset(button.dataset.level));
        });

        reset(levelKey);

        return function cleanup() {
            stopTimer();
            cancelPress();
        };
    }

    if (window.RetroApps) {
        window.RetroApps.register({
            id: 'minesweeper',
            name: 'Minesweeper',
            tagline: 'Flag every mine, clear every other square. First click is always safe.',
            meta: 'BEGINNER · 9×9 · 10 MINES',
            icon: ICON,
            mount,
        });
    }
})();
