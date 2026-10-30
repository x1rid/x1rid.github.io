# TASK 008: Phase 2.1 — Wire Terminal to Real VFS via Syscalls
Tier: B (clear spec)
Layer: L6 (App) / L3 (Kernel)
Phase: 2.1
Owner folder(s): main/terminal.js, main/kernel/syscalls.js, tests/
Do NOT touch: main/fs/ (schema stays untouched until 2.3)
Depends on: Phase 1 complete (Kernel.syscall), Task 001

## Goal
Eliminate Gap G3 ("Terminal has its own hardcoded fake filesystem and does not use window.VFS at all"):
1. Replace fake `const vfs = {'/': {...}}` in `main/terminal.js` with syscall-driven operations through `Kernel.syscall` (with fallback to `window.VFS` if kernel booting).
2. Wire terminal file commands (`ls`, `dir`, `cd`, `echo > file`, `rm`, `cat/type`) to real VFS paths.
3. Keep the terminal's retro command UX, history, completion, and styles intact.
4. Support POSIX/Windows path translation for the terminal's `cwd` so user sees paths like `C:\Users\user` or `/home/user`.

## Inputs
- `docs/OS_FOUNDATION.md` §2.2 (G3), §5.3 (Syscall layer), §8 Phase 2.1
- `main/kernel/syscalls.js`
- `main/terminal.js`

## Contract
Terminal creates an execution context:
```js
const termCtx = {
  pid: terminalPid,
  uid: activeUser,
  caps: ['fs.read:user', 'fs.write:user']
};
```

Terminal uses syscalls for storage:
- `Kernel.syscall(termCtx, 'fs.list', { path: cwd })`
- `Kernel.syscall(termCtx, 'fs.stat', { path: targetPath })`
- `Kernel.syscall(termCtx, 'fs.read', { path: targetPath })`
- `Kernel.syscall(termCtx, 'fs.write', { path: targetPath, content: str })`

## Steps
1. Add `fs.list` syscall handler to `main/kernel/syscalls.js` (delegating to `vfs.list(path)`).
2. Refactor `main/terminal.js`:
   - Remove fake inline `const vfs = {...}` and `data/vfs.json` fetch fallback.
   - Set default `cwd` to `C:\Users\user\Desktop` (or user home) from active profile.
   - Update `ls` / `dir` to call `Kernel.syscall(termCtx, 'fs.list', ...)`.
   - Update `cd` to validate target directory with `Kernel.syscall(termCtx, 'fs.stat', ...)`.
   - Update `rm` / `del` to remove real files via `Kernel.syscall(termCtx, 'fs.remove', ...)`.
   - Update editor save/load to store into real VFS rather than `localStorage`.
3. Add unit/integration tests in `tests/terminal-vfs.test.js`.
4. Run `node tests/run-tests.js` to ensure zero regressions across test suites.
5. Update `docs/CHANGELOG.md` and `docs/HANDOFF.md`.

## Acceptance Tests
- Creating a file via terminal or VFS makes it visible in both places.
- Terminal `dir` and `ls` list real nodes from `IndexedDB` / `VFS`.
- Fake `const vfs` object is completely removed from `main/terminal.js`.
- `node tests/run-tests.js` passes.

## Rollback
Revert `main/terminal.js` and `main/kernel/syscalls.js`. Delete `tests/terminal-vfs.test.js`.
