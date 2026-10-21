/* ---------------------------------------------------------------------------
 *  Calculator — the four-function desktop calculator, in the site's palette.
 *
 *  Real arithmetic, no eval(), no fake tape. Keyboard: digits, . + - * /
 *  Enter/=, Escape (clear), Backspace, %.
 * ------------------------------------------------------------------------- */
(() => {
    'use strict';

    const ICON = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="4" y="2" width="16" height="20" fill="#07020a" stroke="#6f3a93"></rect>
            <rect x="6" y="4" width="12" height="4" fill="#130927" stroke="#c084fc"></rect>
            <path d="M7 6h10" stroke="#55ff99" stroke-width="1"></path>
            <g fill="#c084fc">
                <rect x="6" y="10" width="3" height="3"></rect>
                <rect x="10.5" y="10" width="3" height="3"></rect>
                <rect x="15" y="10" width="3" height="3"></rect>
                <rect x="6" y="14.5" width="3" height="3"></rect>
                <rect x="10.5" y="14.5" width="3" height="3"></rect>
                <rect x="15" y="14.5" width="3" height="3"></rect>
            </g>
            <rect x="6" y="19" width="7.5" height="2" fill="#8b72b8"></rect>
            <rect x="15" y="19" width="3" height="2" fill="#ff4fd8"></rect>
        </svg>`;

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
            api.setMeta(error ? 'ERROR' : pending || (evaluated ? 'RESULT' : 'READY'));
        }

        function reset(keepDrawCount) {
            current = '0';
            stored = null;
            pending = '';
            expression = '';
            waiting = false;
            evaluated = false;
            error = false;
            render();
        }

        function compute(left, right, operator) {
            if (operator === '+') return left + right;
            if (operator === '-') return left - right;
            if (operator === '*') return left * right;
            if (operator === '/') return right === 0 ? NaN : left / right;
            return right;
        }

        function digit(value) {
            if (error) reset();
            if (evaluated && !pending) {
                current = '0';
                expression = '';
                evaluated = false;
            }
            if (waiting) {
                current = value;
                waiting = false;
            } else {
                const digits = current.replace(/[-.]/g, '').length;
                if (digits >= 12) return;
                current = current === '0' ? value : current + value;
            }
            render();
        }

        function decimal() {
            if (error) reset();
            if (evaluated && !pending) {
                current = '0';
                expression = '';
                evaluated = false;
            }
            if (waiting) {
                current = '0.';
                waiting = false;
            } else if (!current.includes('.')) {
                current += '.';
            }
            render();
        }

        function negate() {
            if (error || current === '0') return;
            current = current.startsWith('-') ? current.slice(1) : `-${current}`;
            render();
        }

        function percent() {
            if (error) return;
            const value = Number.parseFloat(current);
            if (!Number.isFinite(value)) return;
            current = format(value / 100);
            render();
        }

        function backspace() {
            if (error) {
                reset();
                return;
            }
            if (evaluated) {
                evaluated = false;
                expression = '';
            }
            if (waiting) return;
            current = current.length > 1 ? current.slice(0, -1) : '0';
            if (current === '-') current = '0';
            render();
        }

        function chooseOperator(operator) {
            if (error) reset();
            const value = Number.parseFloat(current);
            if (!Number.isFinite(value)) return;

            if (pending && !waiting) {
                const result = compute(stored, value, pending);
                if (!Number.isFinite(result)) {
                    error = true;
                    expression = 'DIVIDE BY ZERO';
                    render();
                    return;
                }
                stored = result;
                current = format(result);
            } else {
                stored = value;
            }

            pending = operator;
            expression = `${format(stored)} ${SYMBOLS[operator] || operator}`;
            waiting = true;
            evaluated = false;
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
            /* Escape belongs to the calculator while the app is focused; the
               Programs window manager would otherwise close the whole app. */
            event.stopPropagation();
            press(mapped);
        });

        displayEl.addEventListener('focus', () => {
            displayEl.classList.add('is-focused');
        });
        displayEl.addEventListener('blur', () => {
            displayEl.classList.remove('is-focused');
        });

        render();
        return function cleanup() {
            stored = null;
            pending = '';
        };
    }

    if (window.RetroApps) {
        window.RetroApps.register({
            id: 'calculator',
            name: 'Calculator',
            tagline: 'Four functions, keyboard input, and division-by-zero honesty.',
            meta: 'DESKTOP · 12 DIGITS',
            icon: ICON,
            mount,
        });
    }
})();
