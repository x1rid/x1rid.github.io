# PHASE 2.4 INSTRUCTION — Split shells: cmd, powershell, bash as separate L6 apps sharing a command-engine library

SOURCE: docs/OS_FOUNDATION.md (Phase 2: One truth for storage and shells)

---

## Exact instruction from OS_FOUNDATIONS.md

> - 2.4 Split shells: `cmd`, `powershell`, `bash` as separate L6 apps sharing a command-engine library (parser, pipes, redirection, env expansion, job control).

---

## Context / gaps

G4 — Two app registries (legacy `RetroApps` vs `AppRegistry`).
G5 — Monolithic shell (`index.html`).
G3 — Terminal had its own fake VFS (killed by 2.1).

This phase removes duplicate truth by making shells separate apps (L6) sharing one library, not inline scripts in index.html.

---

## Design from spec (Part 3 / L6 / L3)

- One kernel (L3) exposes syscalls.
- Shells (`cmd`, `powershell`, `bash`) are L6 apps that share a command-engine library: parser, pipes, redirection, env expansion, job control.
- They talk to the real VFS through `Kernel.syscall`, not direct `window.VFS` (Golden Rule 3 / Layer rules).
- Shell dialect differences are parsing / builtins only; underlying capabilities are identical.

---

## What must be delivered

- `shell/command-engine/` library with parser, pipes, redirection, env expansion, job control.
- Separate app folders / modules: `cmd/`, `powershell/`, `bash/` (or at least separate entry points / manifests).
- Each shell uses command-engine, not inline fake VFS.
- Keep UX: `echo hi > a.txt`, `ls`, `dir` work.

---

## Reference files in bundle

- `main/terminal.js` (current terminal after 2.1; reference UX)
- `main/app-registry.js` (process registry patterns for spawning apps)
- `main/index.html` (monolith to split)
- `docs/tasks/008-terminal-real-vfs.md` (2.1 completed task card)
