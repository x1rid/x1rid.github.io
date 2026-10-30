# TASK 002: Phase 1.1 — kernel/platform/ foundation (errors, clock, logger)
Tier: A (needs design judgment)
Layer: L0
Phase: 1.1
Owner folder(s): main/kernel/platform/, tests/
Do NOT touch: main/fs/, main/profile/, main/index.html (except adding script tags), main/system-*.js
Depends on: none (L0 has no dependencies)

## Goal
Create the three L0 platform files that every other kernel layer depends on:
`errors.js` (OsError + FsError subclass + code registry),
`clock.js` (virtualizable clock, deterministic in test mode),
`logger.js` (structured logger backed by the kernel's event bus, safe before bus exists).
All three are Node-loadable for unit tests.

## Inputs (read before coding)
- `docs/OS_FOUNDATION.md` Part 1 (Golden Rules), Part 3 (layer model), Part 6.1 (service contract), Part 6.4 (error codes), Part 8 Phase 1.1, Part 13 (testing)
- `main/fs/types.js` — existing `FsError` class that must become a subclass of `OsError`
- `main/fs/migrations.js` — see migration pattern to follow

## Design Notes (Tier A — logged here as mini-DECISIONS)

### D-003 OsError shape
`OsError(code, message, detail?)` extends `Error`.  
`code` is an UPPER_SNAKE string from the registry (see 6.4).  
`detail` is a plain object — never a nested Error (to keep it JSON-serializable for diagnostics).  
`FsError` in `fs/types.js` is kept as-is but its class body gains `extends OsError` via adapter shim.
We do NOT edit `types.js` yet (that's Phase 2 work) — instead `errors.js` exports `OsError` and the
shared code registry. `FsError` in `types.js` will be migrated in a later task card.

### D-004 Clock design
`KernelClock` is a **thin wrapper** around `Date.now()` with three modes:
- `realtime` (default): returns `Date.now()`.
- `fixed(ts)`: always returns `ts` (for deterministic tests — activated by `?test=1`).
- `offset(delta)`: shifts real time by `delta` ms (for fast-forward / simulated timezone).
No scheduling inside clock.js — that stays in the scheduler (Phase 1.6).

### D-005 Logger design
`KernelLogger` buffers entries before the event bus exists. Once `Kernel.events` is ready the buffer
drains into the bus on topic `sys:log`. The logger is safe to call at time-zero (before any service
loads). Log levels: `debug | info | warn | error`. In production, `debug` entries are not stored
(configurable at init). The global is `window.KernelLogger`.

## Contract

### errors.js
```js
window.OsError              // class OsError extends Error: .code, .message, .detail
window.OsErrors             // frozen registry: { ENOENT, EEXIST, EACCES, ... } (full list below)
window.KernelErrors         // Object.freeze({ OsError, codes: OsErrors, version, diagnostics() })
```

Error code registry (copy exactly from spec Part 6.4 plus mappings from existing fs/types.js ErrorCode):
ENOENT, EEXIST, EACCES, EPERM, ENOTDIR, EISDIR, ENOTEMPTY, EINVAL, ENOSPC, EBUSY,
ETIMEDOUT, ESRCH, ECHILD,
PROFILE_LOCKED, PROFILE_SCOPE, DEV_MODE_REQUIRED, SCHEMA_MISMATCH, CAPABILITY_DENIED,
// Legacy fs/types.js aliases (same string value, for backward compat during migration):
NOT_FOUND, NOT_A_DIRECTORY, NAME_CONFLICT, INVALID_NAME, INVALID_PATH,
ACCESS_DENIED, CIRCULAR_MOVE, BROKEN_SHORTCUT, STORAGE_FULL, OPERATION_CANCELLED

### clock.js
```js
window.KernelClock = Object.freeze({
  version, ready, diagnostics(),
  now(),              // → number (ms since epoch)
  isoNow(),          // → string ISO-8601
  mode(),            // → 'realtime' | 'fixed' | 'offset'
  setFixed(ts),      // pin time (test mode); ts=null reverts to realtime
  setOffset(delta),  // shift realtime by delta ms
  reset(),           // back to realtime, zero offset
})
```

### logger.js
```js
window.KernelLogger = Object.freeze({
  version, ready, diagnostics(),
  debug(tag, msg, data?),
  info(tag, msg, data?),
  warn(tag, msg, data?),
  error(tag, msg, data?),
  getEntries(level?, limit?),   // → array of log entries (for diagnostics overlay)
  setLevel(level),              // 'debug'|'info'|'warn'|'error' — filters stored entries
  connectBus(emitFn),           // called by kernel/events.js once bus is up; drains buffer
})
```

## Steps
1. Create directory `main/kernel/platform/`.
2. Write `main/kernel/platform/errors.js` — OsError class + registry + service contract.
3. Write `main/kernel/platform/clock.js` — KernelClock service contract.
4. Write `main/kernel/platform/logger.js` — KernelLogger service contract.
5. Write unit tests in `tests/kernel-platform.test.js` covering all three modules.
6. Add script tags to `main/index.html` (before `profile/profile-db.js`), bump `?v=20261031`.
7. Update `docs/CHANGELOG.md`, `docs/DECISIONS.md`, `docs/HANDOFF.md`.
8. Run `node tests/run-tests.js` — must pass.

## Acceptance tests
- `new OsError('ENOENT', 'No such file', { path: 'C:\\x' })` → `.code === 'ENOENT'`, `.detail.path === 'C:\\x'`
- `OsErrors.ENOENT === 'ENOENT'` (code strings equal themselves)
- `KernelClock.now()` returns a number ≥ Date.now() - 100
- `KernelClock.setFixed(12345); KernelClock.now() === 12345`
- `KernelClock.reset(); KernelClock.mode() === 'realtime'`
- `KernelLogger.info('boot', 'hello'); KernelLogger.getEntries().length >= 1`
- `node tests/run-tests.js` exits 0

## Rollback
Delete `main/kernel/` and `tests/kernel-platform.test.js`. Remove the three script tags from `index.html`.
