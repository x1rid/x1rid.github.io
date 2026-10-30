# TASK 006: Phase 1.5 — Syscall Layer (kernel/syscalls.js)
Tier: A (needs design judgment)
Layer: L3
Phase: 1.5
Owner folder(s): main/kernel/, tests/
Do NOT touch: main/fs/, main/profile/
Depends on: TASK 005 (process table), TASK 004 (security), TASK 003 (events), TASK 002 (platform)

## Goal
Implement the central syscall engine `main/kernel/syscalls.js` exposing `window.KernelSyscalls` and `window.Kernel.syscall(ctx, callName, args)`.
Every syscall validates arguments, checks capabilities/permissions via L2 `SecurityPermissions`, dispatches to underlying services, audits sensitive operations via `SecurityAudit`, and returns `{ ok: true, value }` or throws an `OsError`.

## Inputs
- `docs/OS_FOUNDATION.md` §5.3 (Syscall layer), §6.1, §6.4 (error codes), §8 Phase 1.5
- `main/kernel/process-table.js`
- `main/security/permissions.js`
- `main/security/audit.js`
- `main/kernel/platform/errors.js`

## Contract
```js
// Call invocation
const res = await Kernel.syscall(ctx, 'fs.stat', { path: 'C:\\Users\\...' });

// ctx structure
{
  pid: number,
  uid: string,
  caps: string[]
}
```

Initial syscall registry:
- `fs.*`: `stat`, `list`, `read`, `write`, `create`, `mkdir`, `remove`, `move`, `copy`
- `proc.*`: `spawn`, `kill`, `list`, `info`, `signal`
- `sys.*`: `time`, `info`, `log`, `notify`
- `sec.*`: `whoami`, `check`

Global Export:
`window.KernelSyscalls` & `window.Kernel = { syscall, proc, events, clock, errors, log, legacy }`

## Acceptance Tests
- Calling `Kernel.syscall(ctx, 'proc.list')` returns running processes.
- Calling `fs.read` without permission or on invalid path throws structured `OsError` (`ENOENT`, `EACCES`).
- Valid call returns `{ ok: true, value: ... }`.
- Audit log captures sensitive syscalls.
- `node tests/syscalls.test.js` passes.
- All 261+ suite tests pass.

## Rollback
Delete `main/kernel/syscalls.js`, `tests/syscalls.test.js`, and remove script tag from `main/index.html`.
