# TASK 007: Phase 1.6 — Service Manager (kernel/service-manager.js) & Phase 1 Exit Criteria
Tier: A (needs design judgment)
Layer: L3
Phase: 1.6
Owner folder(s): main/kernel/, tests/
Do NOT touch: main/fs/, main/profile/
Depends on: TASK 006 (syscalls), TASK 005 (process table), TASK 003 (events)

## Goal
Implement `main/kernel/service-manager.js` (`window.KernelServiceManager` / `Kernel.services`) to manage declared service dependencies, startup sequencing, and expose `window.KernelReady`:
- Declarative service registration: `registerService(name, { needs, start, stop })`.
- Dependency graph resolution (topological start order).
- Expose `window.KernelReady` Promise that resolves once core kernel services (`errors`, `clock`, `logger`, `events`, `security`, `processTable`, `syscalls`) are ready.
- Satisfies all Phase 1 Exit Criteria: every open window has a PID in `Kernel.proc.list()`, `Kernel.syscall()` works and is permission-checked, and legacy apps are unaffected.

## Inputs
- `docs/OS_FOUNDATION.md` §5.7 (Boot sequence), §6.1 (Service contract), §8 Phase 1.6 & Phase 1 Exit Criteria
- `main/kernel/syscalls.js`
- `main/kernel/process-table.js`

## Contract
`main/kernel/service-manager.js` -> `window.KernelServiceManager`:
```js
{
  version: '20261031',
  ready: Promise<void>,
  diagnostics(): object,
  register(name, def): void,
  startAll(): Promise<void>,
  start(name): Promise<void>,
  stop(name): Promise<void>,
  get(name): object | null,
  list(): object[]
}
```

Global Readiness:
`window.KernelReady`: Promise<void>

## Acceptance Tests
- Declaring services with dependencies executes startup in topological order.
- Circular dependencies are detected and reject with `OsError` (`EINVAL`).
- `window.KernelReady` resolves after all declared core services start.
- `node tests/service-manager.test.js` passes.
- All 279+ test suite tests remain green.

## Rollback
Delete `main/kernel/service-manager.js` and `tests/service-manager.test.js`. Revert script tag from `main/index.html`.
