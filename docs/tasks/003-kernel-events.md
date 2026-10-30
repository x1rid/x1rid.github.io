# TASK 003: Phase 1.2 — Unified Event Bus (kernel/events.js) with Alias Bridges
Tier: A (needs design judgment)
Layer: L3
Phase: 1.2
Owner folder(s): main/kernel/, tests/
Do NOT touch: main/fs/, main/profile/, main/system-*.js
Depends on: TASK 002 (kernel/platform/ errors, clock, logger)

## Goal
Implement `main/kernel/events.js` exporting `window.KernelEvents`. It serves as the single unified pub/sub event bus across the OS, enforcing canonical event payloads (`type`, `profileId`, `emittedAt`, `sequence`, `pid`), listener error-containment, `unsubscribe()` handles, and bi-directional alias bridging with legacy events (`fs:node-*`, `proc:*`, `win:*`, `sys:*`, `site:*`).

## Inputs
- `docs/OS_FOUNDATION.md` §1 Rule 9, §5.4, §6.1, §6.3, §8 Phase 1.2
- `main/kernel/platform/clock.js`
- `main/kernel/platform/logger.js`
- `main/fs/events.js` (legacy VfsEvents pattern)

## Contract
`window.KernelEvents`:
```js
{
  version: '20261031',
  ready: Promise<void>,
  diagnostics(): object,
  on(topic, handler, options?): () => void, // returns unsubscribe
  once(topic, handler, options?): () => void,
  emit(topic, payload, meta?): object, // returns normalized event payload
  bridgeDom(targetElement?): () => void, // bridges CustomEvent <-> KernelEvents
  bridgeVfs(vfsEventsInstance?): () => void,
  getCanonicalTopic(topic): string,
  getLegacyAliases(topic): string[]
}
```

Standard payload format (§6.3):
```js
{
  type: 'domain:verb-noun',
  profileId: string | null,
  emittedAt: number,
  sequence: number,
  pid: number | null,
  ...data
}
```

Alias bridge mapping (§6.3):
- `node-created/updated/renamed/moved/recycled/restored/deleted` <-> `fs:node-created/...`
- `site:applaunch` <-> `proc:spawned`
- `site:appopen` <-> `win:opened`
- `site:appclose` <-> `proc:exited`
- `site:appactivate` <-> `win:focused`
- `system:file-opened` <-> `fs:file-opened`
- `system:file-saved` <-> `fs:file-saved`
- `system:notification` <-> `sys:notification`

## Steps
1. Create `docs/tasks/003-kernel-events.md`.
2. Implement `main/kernel/events.js` following service contract (§6.1). Connect KernelLogger via `KernelLogger.connectBus`.
3. Create unit tests `tests/kernel-events.test.js`.
4. Include `kernel/events.js` script tag in `main/index.html` with `?v=20261031`.
5. Update `main/debug-overlay.js` to inspect `KernelEvents`.
6. Run `node tests/run-tests.js`.
7. Update `docs/CHANGELOG.md` and `docs/HANDOFF.md`.

## Acceptance Tests
- Calling `KernelEvents.on('fs:node-created', fn)` triggers when emitting legacy `'node-created'` and vice versa.
- Listeners throwing errors do not break subsequent listeners or throw out of `emit()`.
- Standard payload properties (`type`, `emittedAt`, `sequence`) are populated automatically.
- `unsubscribe()` safely removes listener.
- `KernelLogger` events propagate to `sys:log` subscribers.
- `node tests/run-tests.js` passes without failure.

## Rollback
Remove `main/kernel/events.js`, `tests/kernel-events.test.js`, and remove script tag from `main/index.html`.
