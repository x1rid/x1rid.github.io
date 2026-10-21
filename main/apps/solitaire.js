/* ---------------------------------------------------------------------------
 *  Solitaire — Klondike, click to select and click to place.
 *
 *  Rules: descending alternating-colour builds on the tableau, Ace-to-King
 *  by suit on the foundations, King only into an empty column, stock draws
 *  one or three, waste recycles. Double-click sends a card to its foundation.
 *
 *  The card faces are dark purple rather than paper white so the game belongs
 *  to this desktop instead of looking like a pasted-in Windows screenshot.
 * ------------------------------------------------------------------------- */
(() => {
    'use strict';

    const SUITS = [
        { id: 'S', glyph: '♠', name: 'spades', red: false },
        { id: 'H', glyph: '♥', name: 'hearts', red: true },
        { id: 'D', glyph: '♦', name: 'diamonds', red: true },
        { id: 'C', glyph: '♣', name: 'clubs', red: false },
    ];
    const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const MAX_HISTORY = 40;

    const ICON = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="2" y="4" width="11" height="16" fill="#1b0d31" stroke="#6f3a93"></rect>
            <rect x="10" y="2" width="12" height="17" fill="#241238" stroke="#c084fc"></rect>
            <path d="M16 5.5l2.1 3.1h-4.2z" fill="#ff4fd8"></path>
            <path d="M16 13.5l2.1-3.1h-4.2z" fill="#ff4fd8"></path>
            <rect x="15.4" y="10" width="1.2" height="3" fill="#f2eaff"></rect>
            <rect x="4" y="11" width="7" height="1.1" fill="#c084fc"></rect>
            <rect x="4" y="14" width="5" height="1.1" fill="#8b72b8"></rect>
        </svg>`;

    function mount(root, api) {
        root.innerHTML = `
            <div class="sol">
                <div class="app-toolbar sol-bar">
                    <div class="app-toolbar__group">
                        <button type="button" class="app-btn" data-sol="new">NEW GAME</button>
                        <button type="button" class="app-btn" data-sol="undo">UNDO</button>
                        <button type="button" class="app-btn" data-sol="draw" title="Switch between drawing one or three cards">DRAW 1</button>
                    </div>
                    <div class="app-toolbar__group">
                        <span class="app-readout">MOVES <b data-role="moves">0</b></span>
                        <span class="app-readout">STOCK <b data-role="stock">24</b></span>
                    </div>
                    <span class="sol-status" data-role="status" role="status" aria-live="polite" data-state="ready">SELECT A CARD</span>
                </div>

                <div class="sol-top">
                    <div class="sol-stock" data-role="stock-zone"></div>
                    <div class="sol-waste" data-role="waste"></div>
                    <div class="sol-foundations" data-role="foundations" role="group" aria-label="Foundations"></div>
                </div>

                <div class="sol-columns" data-role="columns" role="group" aria-label="Tableau"></div>
                <p class="app-hint">Click a card, then its destination. Double-click sends a card to its foundation. <kbd>N</kbd> deals, <kbd>U</kbd> undoes.</p>
            </div>`;

        const stockZone = root.querySelector('[data-role="stock-zone"]');
        const wasteEl = root.querySelector('[data-role="waste"]');
        const foundationsEl = root.querySelector('[data-role="foundations"]');
        const columnsEl = root.querySelector('[data-role="columns"]');
        const movesEl = root.querySelector('[data-role="moves"]');
        const stockCountEl = root.querySelector('[data-role="stock"]');
        const statusEl = root.querySelector('[data-role="status"]');
        const drawButton = root.querySelector('[data-sol="draw"]');

        let state = null;
        let selection = null;
        let history = [];
        let won = false;

        function freshState(drawCount) {
            const deck = [];
            SUITS.forEach((suit) => {
                for (let rank = 1; rank <= 13; rank += 1) {
                    deck.push({ suit: suit.id, rank, faceUp: false });
                }
            });

            for (let i = deck.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = deck[i];
                deck[i] = deck[j];
                deck[j] = tmp;
            }

            const tableau = [];
            for (let col = 0; col < 7; col += 1) {
                const pile = deck.splice(0, col + 1);
                pile[pile.length - 1].faceUp = true;
                tableau.push(pile);
            }

            return {
                stock: deck,
                waste: [],
                foundations: { S: [], H: [], D: [], C: [] },
                tableau,
                moves: 0,
                drawCount,
            };
        }

        function cloneState() {
            return JSON.parse(JSON.stringify({
                stock: state.stock,
                waste: state.waste,
                foundations: state.foundations,
                tableau: state.tableau,
                moves: state.moves,
                drawCount: state.drawCount,
            }));
        }

        function pushHistory() {
            history.push(cloneState());
            if (history.length > MAX_HISTORY) history.shift();
        }

        function suitOf(id) {
            return SUITS.find((suit) => suit.id === id) || SUITS[0];
        }

        function cardName(card) {
            return `${RANKS[card.rank - 1]} of ${suitOf(card.suit).name}`;
        }

        function focusKey() {
            const active = document.activeElement;
            if (!active || !root.contains(active) || !active.dataset) return '';
            return active.dataset.focusKey || '';
        }

        function restoreFocus(key) {
            if (!key) return;
            const next = root.querySelector(`[data-focus-key="${key}"]`);
            if (next && typeof next.focus === 'function') next.focus({ preventScroll: true });
        }

        function cardFace(card) {
            const suit = suitOf(card.suit);
            return `
                <span class="sol-corner">${RANKS[card.rank - 1]}<i>${suit.glyph}</i></span>
                <span class="sol-pip">${suit.glyph}</span>
                <span class="sol-corner sol-corner--br">${RANKS[card.rank - 1]}<i>${suit.glyph}</i></span>`;
        }

        function cardButton(card, key, attrs) {
            const suit = suitOf(card.suit);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `sol-card ${suit.red ? 'is-red' : 'is-black'}`;
            button.dataset.focusKey = key;
            button.innerHTML = cardFace(card);
            button.setAttribute('aria-label', cardName(card));
            Object.keys(attrs || {}).forEach((name) => {
                button.dataset[name] = String(attrs[name]);
            });
            return button;
        }

        function cardBack(key, attrs, label) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'sol-card is-back';
            button.dataset.focusKey = key;
            button.setAttribute('aria-label', label || 'Face-down card');
            Object.keys(attrs || {}).forEach((name) => {
                button.dataset[name] = String(attrs[name]);
            });
            return button;
        }

        function backDiv() {
            const div = document.createElement('div');
            div.className = 'sol-card is-back is-static';
            div.setAttribute('role', 'img');
            div.setAttribute('aria-label', 'Face-down card');
            return div;
        }

        function emptySlot(label, key, attrs, live) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `sol-slot${live ? ' is-live' : ''}`;
            button.dataset.focusKey = key;
            button.setAttribute('aria-label', label);
            button.textContent = attrs && attrs.glyph ? attrs.glyph : '';
            Object.keys(attrs || {}).forEach((name) => {
                if (name !== 'glyph') button.dataset[name] = String(attrs[name]);
            });
            if (!live) button.tabIndex = -1;
            return button;
        }

        function selectionCards() {
            if (!selection) return null;
            if (selection.src === 'tableau') {
                const pile = state.tableau[selection.col];
                if (!pile || selection.index < 0 || selection.index >= pile.length) return null;
                return pile.slice(selection.index);
            }
            if (selection.src === 'waste') {
                if (!state.waste.length) return null;
                return [state.waste[state.waste.length - 1]];
            }
            if (selection.src === 'foundation') {
                const pile = state.foundations[selection.suit];
                if (!pile || !pile.length) return null;
                return [pile[pile.length - 1]];
            }
            return null;
        }

        function validSequence(cards) {
            if (!cards || !cards.length) return false;
            for (let i = 0; i < cards.length; i += 1) {
                if (!cards[i].faceUp) return false;
                if (i > 0) {
                    const prev = cards[i - 1];
                    const card = cards[i];
                    if (card.rank !== prev.rank - 1) return false;
                    if (suitOf(card.suit).red === suitOf(prev.suit).red) return false;
                }
            }
            return true;
        }

        function canPlaceOnTableau(card, col) {
            const pile = state.tableau[col];
            if (!pile.length) return card.rank === 13;
            const top = pile[pile.length - 1];
            if (!top.faceUp) return false;
            return top.rank === card.rank + 1 && suitOf(top.suit).red !== suitOf(card.suit).red;
        }

        function canPlaceOnFoundation(card, suit) {
            if (card.suit !== suit) return false;
            const pile = state.foundations[suit];
            if (!pile.length) return card.rank === 1;
            return pile[pile.length - 1].rank === card.rank - 1;
        }

        function isWon() {
            return SUITS.every((suit) => state.foundations[suit.id].length === 13);
        }

        function validTargets() {
            const cards = selectionCards();
            if (!cards || !cards.length) return { columns: [], foundation: '' };
            const card = cards[0];
            const columns = state.tableau.map((pile, index) => {
                if (selection.src === 'tableau' && selection.col === index) return false;
                return canPlaceOnTableau(card, index);
            });
            const foundation = cards.length === 1 && canPlaceOnFoundation(card, card.suit) ? card.suit : '';
            return { columns, foundation };
        }

        function render() {
            const key = focusKey();
            const targets = validTargets();
            const cards = selectionCards();
            const selectedSet = new Set();

            if (cards && selection) {
                if (selection.src === 'tableau') {
                    cards.forEach((card, offset) => selectedSet.add(`t${selection.col}-${selection.index + offset}`));
                } else if (selection.src === 'waste') {
                    selectedSet.add(`w${state.waste.length - 1}`);
                } else if (selection.src === 'foundation') {
                    selectedSet.add(`f${selection.suit}`);
                }
            }

            /* ---- stock ---- */
            stockZone.replaceChildren();
            if (state.stock.length) {
                stockZone.appendChild(cardBack('stock', { action: 'stock' }, `Draw from stock, ${state.stock.length} cards left`));
            } else {
                stockZone.appendChild(emptySlot(
                    state.waste.length ? 'Recycle the waste pile' : 'Stock and waste are empty',
                    'stock',
                    { action: 'stock', glyph: state.waste.length ? '↻' : '·' },
                    state.waste.length > 0
                ));
            }

            /* ---- waste ---- */
            wasteEl.replaceChildren();
            if (!state.waste.length) {
                wasteEl.appendChild(emptySlot('Empty waste pile', 'waste', { glyph: '' }, false));
            } else {
                const start = Math.max(0, state.waste.length - 3);
                for (let i = start; i < state.waste.length; i += 1) {
                    const card = state.waste[i];
                    const isTop = i === state.waste.length - 1;
                    const offset = i - start;
                    if (isTop) {
                        const button = cardButton(card, `w${i}`, { action: 'card', src: 'waste', index: i });
                        button.style.left = `${offset * 14}px`;
                        button.style.zIndex = String(i + 1);
                        if (selectedSet.has(`w${i}`)) button.classList.add('is-selected');
                        wasteEl.appendChild(button);
                    } else {
                        const div = document.createElement('div');
                        div.className = `sol-card is-static ${suitOf(card.suit).red ? 'is-red' : 'is-black'}`;
                        div.innerHTML = cardFace(card);
                        div.style.left = `${offset * 14}px`;
                        div.style.zIndex = String(i + 1);
                        wasteEl.appendChild(div);
                    }
                }
            }

            /* ---- foundations ---- */
            foundationsEl.replaceChildren();
            SUITS.forEach((suit) => {
                const pile = state.foundations[suit.id];
                if (!pile.length) {
                    const live = targets.foundation === suit.id;
                    foundationsEl.appendChild(emptySlot(
                        `Empty ${suit.name} foundation${live ? ', valid target' : ''}`,
                        `ef${suit.id}`,
                        { action: 'foundation', suit: suit.id, glyph: '' },
                        live
                    ));
                    return;
                }
                const card = pile[pile.length - 1];
                const button = cardButton(card, `f${suit.id}`, { action: 'card', src: 'foundation', suit: suit.id });
                if (selectedSet.has(`f${suit.id}`)) button.classList.add('is-selected');
                foundationsEl.appendChild(button);
            });

            /* ---- tableau ---- */
            columnsEl.replaceChildren();
            state.tableau.forEach((pile, col) => {
                const column = document.createElement('div');
                column.className = 'sol-col';
                column.dataset.col = String(col);
                if (targets.columns[col]) column.classList.add('is-valid');

                column.appendChild(emptySlot(
                    `Empty column ${col + 1}${targets.columns[col] ? ', valid target' : ''}`,
                    `c${col}`,
                    { action: 'column', col, glyph: 'K' },
                    targets.columns[col] || Boolean(selection)
                ));

                let previous = null;
                pile.forEach((card, index) => {
                    if (!card.faceUp) {
                        const back = backDiv();
                        back.style.zIndex = String(index + 1);
                        if (index > 0) {
                            back.style.marginTop = 'calc(9px - var(--card-h))';
                        }
                        column.appendChild(back);
                    } else {
                        const button = cardButton(card, `t${col}-${index}`, {
                            action: 'card',
                            src: 'tableau',
                            col,
                            index,
                        });
                        button.style.zIndex = String(index + 1);
                        if (index > 0) {
                            button.style.marginTop = previous && previous.faceUp
                                ? 'calc(22px - var(--card-h))'
                                : 'calc(9px - var(--card-h))';
                        }
                        if (selectedSet.has(`t${col}-${index}`)) button.classList.add('is-selected');
                        column.appendChild(button);
                    }
                    previous = card;
                });

                columnsEl.appendChild(column);
            });

            movesEl.textContent = String(state.moves);
            stockCountEl.textContent = String(state.stock.length);
            drawButton.textContent = `DRAW ${state.drawCount}`;
            drawButton.setAttribute('aria-label', `Drawing ${state.drawCount} card${state.drawCount > 1 ? 's' : ''}. Switch to ${state.drawCount === 1 ? 3 : 1}.`);

            if (won) {
                statusEl.textContent = 'CLEARED — PRESS NEW GAME';
                statusEl.dataset.state = 'won';
            } else if (selection) {
                statusEl.textContent = targets.foundation || targets.columns.some(Boolean)
                    ? 'CARD SELECTED — CHOOSE A LIT TARGET'
                    : 'CARD SELECTED — NO LEGAL MOVE';
                statusEl.dataset.state = 'ready';
            } else {
                statusEl.textContent = history.length ? 'SELECT A CARD' : 'DEAL — SELECT A CARD';
                statusEl.dataset.state = 'ready';
            }

            api.setMeta(`KLONDIKE · DRAW ${state.drawCount} · ${won ? 'CLEARED' : 'PLAYING'}`);
            restoreFocus(key);
        }

        function removeSelectionCards() {
            if (!selection) return null;
            const cards = selectionCards();
            if (!cards) return null;

            if (selection.src === 'tableau') {
                const pile = state.tableau[selection.col];
                const removed = pile.splice(selection.index);
                if (pile.length && !pile[pile.length - 1].faceUp) pile[pile.length - 1].faceUp = true;
                return removed;
            }
            if (selection.src === 'waste') {
                return [state.waste.pop()];
            }
            if (selection.src === 'foundation') {
                return [state.foundations[selection.suit].pop()];
            }
            return null;
        }

        function finishMove() {
            selection = null;
            state.moves += 1;
            won = isWon();
            render();
        }

        function moveToTableau(col) {
            const cards = selectionCards();
            if (!cards || !validSequence(cards)) return false;
            if (selection.src === 'tableau' && selection.col === col) return false;
            if (!canPlaceOnTableau(cards[0], col)) return false;

            pushHistory();
            const moving = removeSelectionCards();
            state.tableau[col].push(...moving);
            finishMove();
            return true;
        }

        function moveToFoundation(suit) {
            const cards = selectionCards();
            if (!cards || cards.length !== 1) return false;
            if (!canPlaceOnFoundation(cards[0], suit)) return false;

            pushHistory();
            const moving = removeSelectionCards();
            state.foundations[suit].push(moving[0]);
            finishMove();
            return true;
        }

        function draw() {
            pushHistory();
            selection = null;

            if (state.stock.length) {
                const count = Math.min(state.drawCount, state.stock.length);
                for (let i = 0; i < count; i += 1) {
                    const card = state.stock.pop();
                    card.faceUp = true;
                    state.waste.push(card);
                }
            } else if (state.waste.length) {
                while (state.waste.length) {
                    const card = state.waste.pop();
                    card.faceUp = false;
                    state.stock.push(card);
                }
            } else {
                history.pop();
                return;
            }

            state.moves += 1;
            won = isWon();
            render();
        }

        function selectCard(src, col, index, suit) {
            if (src === 'tableau') {
                const pile = state.tableau[col];
                const card = pile && pile[index];
                if (!card || !card.faceUp) return;
                if (!validSequence(pile.slice(index))) return;
                selection = { src, col, index };
                render();
                return;
            }
            if (src === 'waste') {
                if (!state.waste.length) return;
                selection = { src };
                render();
                return;
            }
            if (src === 'foundation') {
                if (!state.foundations[suit] || !state.foundations[suit].length) return;
                selection = { src, suit };
                render();
            }
        }

        function sameSelection(src, col, index, suit) {
            if (!selection || selection.src !== src) return false;
            if (src === 'tableau') return selection.col === col && selection.index === index;
            if (src === 'foundation') return selection.suit === suit;
            return true;
        }

        function autoToFoundation(src, col, index, suit) {
            if (src === 'tableau') {
                const pile = state.tableau[col];
                if (!pile || index !== pile.length - 1) return;
            }
            if (src === 'waste' && !state.waste.length) return;
            if (src === 'foundation') return;

            selection = src === 'tableau' ? { src, col, index } : { src };
            const cards = selectionCards();
            if (!cards || cards.length !== 1) return;
            const card = cards[0];
            if (!canPlaceOnFoundation(card, card.suit)) {
                selection = null;
                render();
                return;
            }
            moveToFoundation(card.suit);
        }

        function onCardClick(src, col, index, suit) {
            if (won) return;

            if (selection) {
                if (sameSelection(src, col, index, suit)) {
                    selection = null;
                    render();
                    return;
                }

                if (src === 'tableau' && selection.src !== 'tableau') {
                    if (moveToTableau(col)) return;
                } else if (src === 'tableau' && selection.src === 'tableau' && selection.col !== col) {
                    if (moveToTableau(col)) return;
                } else if (src === 'foundation' && selection.src !== 'foundation') {
                    if (moveToFoundation(suit)) return;
                }
            }

            selectCard(src, col, index, suit);
        }

        function deal() {
            const drawCount = state ? state.drawCount : 1;
            state = freshState(drawCount);
            selection = null;
            history = [];
            won = false;
            render();
        }

        function undo() {
            const previous = history.pop();
            if (!previous) return;
            state = previous;
            selection = null;
            won = isWon();
            render();
        }

        function toggleDraw() {
            state.drawCount = state.drawCount === 1 ? 3 : 1;
            render();
        }

        function findCardTarget(element) {
            if (!element) return null;
            const card = element.closest ? element.closest('[data-action="card"]') : null;
            if (!card) return null;
            return {
                src: card.dataset.src,
                col: Number(card.dataset.col),
                index: Number(card.dataset.index),
                suit: card.dataset.suit,
            };
        }

        root.addEventListener('click', (event) => {
            const control = event.target.closest ? event.target.closest('[data-sol], [data-action]') : null;
            if (!control || !root.contains(control)) return;

            if (control.dataset.sol) {
                const action = control.dataset.sol;
                if (action === 'new') deal();
                else if (action === 'undo') undo();
                else if (action === 'draw') toggleDraw();
                return;
            }

            const action = control.dataset.action;
            if (action === 'stock') {
                draw();
                return;
            }
            if (action === 'column') {
                if (selection && moveToTableau(Number(control.dataset.col))) return;
                selection = null;
                render();
                return;
            }
            if (action === 'foundation') {
                if (selection && moveToFoundation(control.dataset.suit)) return;
                if (selection) {
                    selection = null;
                    render();
                }
                return;
            }
            if (action === 'card') {
                const target = findCardTarget(control);
                if (target) onCardClick(target.src, target.col, target.index, target.suit);
            }
        });

        root.addEventListener('dblclick', (event) => {
            const target = findCardTarget(event.target);
            if (!target || won) return;
            event.preventDefault();
            autoToFoundation(target.src, target.col, target.index, target.suit);
        });

        root.addEventListener('keydown', (event) => {
            const target = event.target;
            if (target && target.closest && target.closest('input, textarea')) return;
            const key = event.key.toLowerCase();
            if (key === 'n') {
                event.preventDefault();
                deal();
            } else if (key === 'u') {
                event.preventDefault();
                undo();
            } else if (key === 'escape' && selection) {
                event.preventDefault();
                event.stopPropagation();
                selection = null;
                render();
            }
        });

        deal();

        return function cleanup() {
            state = null;
            selection = null;
            history = [];
        };
    }

    if (window.RetroApps) {
        window.RetroApps.register({
            id: 'solitaire',
            name: 'Solitaire',
            tagline: 'Klondike with click-to-move, draw one or three, and real undo.',
            meta: 'KLONDIKE · DRAW 1 · 52 CARDS',
            icon: ICON,
            mount,
        });
    }
})();
