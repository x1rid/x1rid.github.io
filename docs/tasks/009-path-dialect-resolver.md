# TASK 009: Phase 2.2 — Path Dialect Layer (POSIX/Windows Adapters, Mount Table, Virtual Overlays)
Tier: B (clear spec)
Layer: L1 (VFS Services)
Phase: 2.2 / G6
Owner folder(s): main/fs/path-resolver.js, tests/
Do NOT touch: main/kernel/process-table.js, main/kernel/syscalls.js, main/terminal.js, main/apps/explorer/
Depends on: Phase 2.1 complete

## Goal
Implement compliant Phase 2.2 path dialect layer per OS_FOUNDATION.md G6 / Part 5.2 / Part 8:
1. Windows path dialect remains default GUI dialect.
2. POSIX path dialect translated through a mount table (`/mnt/c`, `/home/<user>`, `/dev`, `/proc`, `/tmp`, etc.).
3. In-memory virtual overlays for `/dev`, `/proc`, `/tmp` (non-persisted synthetic nodes).
4. No extra globals created beyond `VfsPathResolver`.
5. Diagnostics method returning plain JSON.

## Allowed Files
- `main/fs/path-resolver.js`
- `main/fs/init.js`
- `tests/unit/path-resolver.test.js`
- `docs/CHANGELOG.md`
- `docs/HANDOFF.md`
- `main/index.html` (cache-bust version bump if needed)
