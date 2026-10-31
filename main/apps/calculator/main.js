/* ---------------------------------------------------------------------------
 * Calculator — manifest app (migrated from the legacy RetroApps calculator.js).
 * Real arithmetic, no eval(), no fake tape. Keyboard: digits, . + - * /
 * Enter/=, Escape (clear), Backspace, %.
 * Needs no capabilities: it never calls a syscall.
 * ------------------------------------------------------------------------- */
(() => {
    'use strict';

    function mount(root, api) {
        root.innerHTML = `
            <div class="calc">
                <div class="calc-display" tabindex="0" aria-label="Calculator display">
                    <div class="calc-expression" data-role="expression">&nbsp;</div>
                    <div class="calc-value" data-role="value" role="status" aria-live="polite">0</div>
                </div>
                <div class="calc-grid" role="group" aria-label="Calculator keys">
                    <button type="button" class="calc-key calc-key--fn" data-key="clear" title="Clear (Escape)">C</button>
                    <button type="button" class="calc-key calc-key--fn" data-key="back" title="Backspace">⌫</button>
                    <button type="button" class="calc-key calc-key--fn" data-key="percent" title="Percent">%</button>
                    <button type="button" class="calc-key calc-key--op" data-key="/" aria-label="Divide">÷</button>

                    <button type="button" class="calc-key" data-key="7">7</button>
                    <button type="button" class="calc-key" data-key="8">8</button>
                    <button type="button" class="calc-key" data-key="9">9</button>
                    <button type="button" class="calc-key calc-key--op" data-key="*" aria-label="Multiply">×</button>

                    <button type="button" class="calc-key" data-key="4">4</button>
                    <button type="button" class="calc-key" data-key="5">5</button>
                    <button type="button" class="calc-key" data-key="6">6</button>
                    <button type="button" class="calc-key calc-key--op" data-key="-" aria-label="Subtract">−</button>

                    <button type="button" class="calc-key" data-key="1">1</button>
                    <button type="button" class="calc-key" data-key="2">2</button>
                    <button type="button" class="calc-key" data-key="3">3</button>
                    <button type="button" class="calc-key calc-key--op" data-key="+" aria-label="Add">+</button>

                    <button type="button" class="calc-key calc-key--fn" data-key="sign" title="Negate">±</button>
                    <button type="button" class="calc-key" data-key="0">0</button>
                    <button type="button" class="calc-key" data-key=".">.</button>
                    <button type="button" class="calc-key calc-key--eq" data-key="=" aria-label="Equals">=</button>
                </div>
                <p class="app-hint">Keyboard works: digits, <kbd>+ − * /</kbd>, <kbd>Enter</kbd>, <kbd>Esc</kbd> clears.</p>
            </div>`;

        const valueEl = root.querySelector('[data-role="value"]');
        const expressionEl = root.querySelector('[data-role="expression"]');
        const displayEl = root.querySelector('.calc-display');

        let current = '0';
        let stored = null;
        let pending = '';
        let expression = '';
        let waiting = false;
        let evaluated = false;
        let error = false;

        const SYMBOLS = { '+': '+', '-': '−', '*': '×', '/': '÷' };

        function format(number) {
            if (!Number.isFinite(number)) return 'ERROR';
            const rounded = Number.parseFloat(Number(number).toPrecision(12));
            if (Math.abs(rounded) >= 1e12 || (rounded !== 0 && Math.abs(rounded) < 1e-9)) {
                return rounded.toExponential(6).replace('e+', 'e');
            }
            return String(rounded);
        }

        function render() {
            valueEl.textContent = error ? 'ERROR' : current;
            expressionEl.textContent = expression || '\u00a0';
            if (api && api.setMeta) api.setMeta(error ? 'ERROR' : pending || (evaluated ? 'RESULT' : 'READY'));
        }

        function reset() {
            current = '0';
            stored = null;
            pending = '';
            expression = '';
            waiting = false;
            evaluated = false;
            error = false;
            render();
        }

        function digit(d) {
            if (error) reset();
            if (waiting || evaluated) {
                current = d;
                waiting = false;
                evaluated = false;
            } else {
                current = current === '0' ? d : current + d;
            }
            if (current.length > 16) current = current.slice(0, 16);
            render();
        }

        function decimal() {
            if (error) reset();
            if (waiting || evaluated) {
                current = '0.';
                waiting = false;
                evaluated = false;
                render();
                return;
            }
            if (!current.includes('.')) {
                current += '.';
                render();
            }
        }

        function backspace() {
            if (error || evaluated || waiting) return;
            current = current.length > 1 ? current.slice(0, -1) : '0';
            if (current === '-' || current === '-0') current = '0';
            render();
        }

        function negate() {
            if (error) return;
            const value = Number.parseFloat(current);
            if (value === 0) return;
            current = format(-value);
            render();
        }

        function percent() {
            if (error) return;
            const value = Number.parseFloat(current);
            current = format(value / 100);
            render();
        }

        function compute(a, b, op) {
            if (op === '+') return a + b;
            if (op === '-') return a - b;
            if (op === '*') return a * b;
            if (op === '/') return b === 0 ? Number.NaN : a / b;
            return b;
        }

        function chooseOperator(nextOp) {
            if (error) reset();
            const value = Number.parseFloat(current);
            if (stored === null) {
                stored = value;
            } else if (!waiting) {
                const result = compute(stored, value, pending);
                if (!Number.isFinite(result)) {
                    error = true;
                    expression = 'DIVIDE BY ZERO';
                    render();
                    return;
                }
                stored = result;
                current = format(result);
            }
            pending = nextOp;
            waiting = true;
            evaluated = false;
            expression = `${format(stored)} ${SYMBOLS[nextOp] || nextOp}`;
            render();
        }

        function equals() {
            if (error || !pending) return;
            const value = Number.parseFloat(current);
            const left = stored;
            const result = compute(left, value, pending);
            if (!Number.isFinite(result)) {
                error = true;
                expression = 'DIVIDE BY ZERO';
                render();
                return;
            }
            expression = `${format(left)} ${SYMBOLS[pending] || pending} ${format(value)} =`;
            current = format(result);
            stored = null;
            pending = '';
            waiting = false;
            evaluated = true;
            render();
        }

        function press(key) {
            if (key === 'clear') reset();
            else if (key === 'back') backspace();
            else if (key === 'percent') percent();
            else if (key === 'sign') negate();
            else if (key === '=') equals();
            else if (key === '.') decimal();
            else if (['+', '-', '*', '/'].includes(key)) chooseOperator(key);
            else if (/^[0-9]$/.test(key)) digit(key);
        }

        root.addEventListener('click', (event) => {
            const button = event.target.closest ? event.target.closest('[data-key]') : null;
            if (!button || !root.contains(button)) return;
            press(button.dataset.key);
            if (displayEl && button.dataset.key === '=') displayEl.focus({ preventScroll: true });
        });

        root.addEventListener('keydown', (event) => {
            const target = event.target;
            if (target && target.closest && target.closest('input, textarea')) return;
            const key = event.key;
            let mapped = '';
            if (/^[0-9]$/.test(key)) mapped = key;
            else if (key === '.' || key === ',') mapped = '.';
            else if (key === '+' || key === '-' || key === '*' || key === '/' || key === '%') mapped = key;
            else if (key === 'Enter' || key === '=') mapped = '=';
            else if (key === 'Backspace') mapped = 'back';
            else if (key === 'Escape' || key === 'c' || key === 'C') mapped = 'clear';
            else if (key === 'Delete') mapped = 'clear';

            if (!mapped) return;
            event.preventDefault();
            event.stopPropagation();
            press(mapped);
        });

        displayEl.addEventListener('focus', () => { displayEl.classList.add('is-focused'); });
        displayEl.addEventListener('blur', () => { displayEl.classList.remove('is-focused'); });

        render();
        return function cleanup() {
            stored = null;
            pending = '';
        };
    }

    window.OSApps.register('calculator', {
        async main(proc) {
            const win = await proc.win.open({ title: 'Calculator' });
            const cleanup = mount(win.root);
            proc.onExit(cleanup);
            const display = win.root.querySelector('.calc-display');
            if (display) display.focus({ preventScroll: true });
        }
    });
})();
