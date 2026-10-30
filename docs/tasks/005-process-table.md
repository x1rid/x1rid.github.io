# TASK 005: Phase 1.4 — Kernel Process Table (kernel/process-table.js) & AppRegistry Hook
Tier: A (needs design judgment)
Layer: L3
Phase: 1.4
Owner folder(s): main/kernel/, main/app-registry.js, tests/
Do NOT touch: main/fs/, main/profile/
Depends on: TASK 003 (kernel/events.js), TASK 002 (kernel/platform/)

## Goal
Implement the central cooperative process table `main/kernel/process-table.js` (`window.KernelProcessTable` / `Kernel.proc`) following the specification in §5.1:
- Process records with monotonic `pid`, `ppid`, `appId`, `name`, `uid`, `state`, `startedAt`, `windows`, `stats`, and `exitCode`.
- Process lifecycle methods: `spawn()`, `kill()`, `get()`, `list()`, `setWindow()`, `removeWindow()`, `signal()`.
- Hook `AppRegistry.attachWindow()` and `AppRegistry.detachWindow()` so every launched app window has an associated PID in the process table without breaking legacy AppRegistry behavior.
- Emit canonical events `proc:spawned` and `proc:exited`.

## Inputs
- `docs/OS_FOUNDATION.md` §5.1 (Process model), §6.1 (service contract), §8 Phase 1.4
- `main/kernel/events.js`
- `main/app-registry.js`

## Contract
`main/kernel/process-table.js` -> `window.KernelProcessTable`:
```js
{
  version: '20261031',
  ready: Promise<void>,
  diagnostics(): object,
  spawn(spec): object,       // creates process, returns process record
  kill(pid, exitCode?): boolean,
  signal(pid, signalName): boolean,
  get(pid): object | null,
  getByWindow(windowId): object | null,
  list(filter?): object[],
  attachWindow(pid, windowId): boolean,
  detachWindow(windowId): boolean,
  updateStats(pid, statsDelta): void
}
```

Process record shape (§5.1):
```js
{
  pid: number, // monotonic, never reused
  ppid: number,
  appId: string,
  kind: 'app' | 'service' | 'daemon' | 'task',
  name: string,
  uid: string,
  state: 'starting' | 'running' | 'suspended' | 'zombie' | 'exited',
  exitCode: number | null,
  startedAt: number,
  cwd: string,
  env: object,
  windows: string[],
  caps: string[],
  stats: { cpuTicks: number, memBytes: number, syscalls: number }
}
```

## Steps
1. Create `docs/tasks/005-process-table.md`.
2. Implement `main/kernel/process-table.js`.
3. Hook `main/app-registry.js` to call `KernelProcessTable.spawn()` upon `attachWindow()` and `KernelProcessTable.kill()` on `detachWindow()`. Attach `pid` to the `AppRegistry` instance.
4. Add unit tests in `tests/process-table.test.js`.
5. Register script tag in `main/index.html` with `?v=20261031`.
6. Update `main/debug-overlay.js`.
7. Verify all tests pass with `node tests/run-tests.js`.
8. Update `docs/CHANGELOG.md` and `docs/HANDOFF.md`.

## Acceptance Tests
- `KernelProcessTable.spawn({ appId: 'terminal', name: 'Terminal' })` returns a process record with monotonic PID.
- `KernelProcessTable.list()` includes the spawned process.
- Hooking `AppRegistry.attachWindow()` creates a process record with matching `windows` list.
- Closing the window calls `detachWindow()` and transitions the process to `'exited'`.
- `node tests/run-tests.js` passes completely.

## Rollback
Delete `main/kernel/process-table.js` and `tests/process-table.test.js`. Revert `main/app-registry.js`.
