# PHASE 2.2 INSTRUCTION — Path dialect adapters + mount table + /tmp, /dev, /proc virtual filesystems

SOURCE: docs/OS_FOUNDATION.md (Phase 2: One truth for storage and shells)

---

## Exact instruction from OS_FOUNDATIONS.md

> - 2.2 Path dialect adapters + mount table + `/tmp`, `/dev`, `/proc` virtual filesystems (G6).

---

## Context / gap

G6 — **Windows-only path model.** VFS paths are `C:\...`; no POSIX view, no mounts, no `/dev`, `/proc`. Today only the first half exists.

Target: one kernel, one VFS; path dialect adapters translate `C:\Users\Rid\Documents\a.txt` <-> `/home/rid/Documents/a.txt` via a mount table.

---

## Exit criteria (Phase 2 overall exit from OS_FOUNDATION.md)

> `echo hi > a.txt` in bash makes `a.txt` appear in Explorer; `ls /proc` lists live PIDs; `dir` and `ls` agree.

---

## Prerequisites already done (2.1)

- Terminal wired to real VFS via Kernel.syscall (task 008, completed 2026-10-31).
- Hardcoded inline fake `vfs` object removed from `terminal.js`.

---

## What this folder contains

- INSTRUCTION.md (this file)
- REF-OS_FOUNDATION.md (full spec for cross-reference)
- bundle/ — copied core interface / design files needed to implement dialect adapters and mount table.

---

## Design notes from spec

- VFS stores nodes by id, not path string (already true).
- Add `PathDialect.windows` and `PathDialect.posix` in L1.
- Mount table (new): `C:` -> `/mnt/c`; `/` (posix root) is a view with `/home`, `/etc`, `/dev`, `/proc`, `/tmp`, `/usr`, `/var`. Windows view stays default for GUI.
- `/dev`, `/proc`, `/tmp` are virtual filesystems (live / simulated).

---

## Do NOT edit outside your task card

Fix only G6-related work. Do not change process table (G1) or split shells (2.4) here.
