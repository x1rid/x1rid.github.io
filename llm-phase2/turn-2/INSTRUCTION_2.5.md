# PHASE 2.5 INSTRUCTION — Explorer and Terminal both use fs.watch; creating a file in one shows instantly in the other

SOURCE: docs/OS_FOUNDATION.md (Phase 2: One truth for storage and shells)

---

## Exact instruction from OS_FOUNDATIONS.md

> - 2.5 Explorer and Terminal both use `fs.watch`; creating a file in one shows instantly in the other (acceptance test).

---

## Context

G3 killed by 2.1 (Terminal now uses real VFS via syscalls). G7 event vocabularies disagree (`node-created`, `profile:ready`, etc.). This phase requires unified event bus usage so Explorer and Terminal observe the same storage events.

---

## Acceptance test (exact from spec)

> `echo hi > a.txt` in bash makes `a.txt` appear in Explorer; `ls /proc` lists live PIDs; `dir` and `ls` agree.

---

## Technical requirements

- Explorer (`main/fs/explorer-adapter.js` and any Explorer UI) listens to VFS events `node-created`, `node-removed`, `node-modified` (or unified `fs:watch` event from kernel).
- Terminal (`main/terminal.js`) writes through `Kernel.syscall('fs.write', ...)`; the VFS publishes events; Explorer reacts.
- Both should use `fs.watch` mechanism rather than polling.
- Event naming should align with spec: `domain:verb-noun` (Golden Rule 9).

---

## Reference files in bundle

- `main/fs/explorer-adapter.js`
- `main/terminal.js`
- `main/fs/events.js`
- `main/kernel/events.js`
