# LLM Phase 2 Bundle (2.2 — 2.5)

Created: 2026-10-31
Repo: D:\GitRepo\x1rid.github.io
Source spec: docs/OS_FOUNDATION.md

---

## Structure

```
llm-phase2/
  REF-OS_FOUNDATION.md          (full OS spec copied from docs/)
  2.2-path-dialect-mount/
    INSTRUCTION.md
    REF-OS_FOUNDATION.md
    bundle/
      main/fs/types.js
      main/fs/path-resolver.js
      main/fs/filesystem-service.js
      main/fs/init.js
      main/kernel/syscalls.js
      docs/tasks/002-kernel-platform.md
      docs/tasks/006-syscalls.md

  2.3-vfs-schema-v2/
    INSTRUCTION.md
    REF-OS_FOUNDATION.md
    bundle/
      main/fs/types.js
      main/fs/migrations.js
      main/fs/init.js
      main/fs/filesystem-service.js
      docs/tasks/008-terminal-real-vfs.md
      docs/CHANGELOG.md

  2.4-split-shells/
    INSTRUCTION.md
    REF-OS_FOUNDATION.md
    bundle/
      main/terminal.js
      main/app-registry.js
      main/index.html
      docs/tasks/008-terminal-real-vfs.md

  2.5-fs-watch-sync/
    INSTRUCTION.md
    REF-OS_FOUNDATION.md
    bundle/
      main/fs/explorer-adapter.js
      main/terminal.js
      main/fs/events.js
      main/kernel/events.js
```

---

## What is Phase 2?

From docs/OS_FOUNDATION.md:

> ### Phase 2: One truth for storage and shells
>
> - 2.1 Wire Terminal to real VFS via syscalls (kills G3). (COMPLETED 2026-10-31 — see docs/tasks/008-terminal-real-vfs.md)
> - 2.2 Path dialect adapters + mount table + `/tmp`, `/dev`, `/proc` virtual filesystems (G6).
> - 2.3 VFS schema v2: `uid/gid/mode`, timestamps. Migration + fixtures.
> - 2.4 Split shells: `cmd`, `powershell`, `bash` as separate L6 apps sharing a command-engine library.
> - 2.5 Explorer and Terminal both use `fs.watch`.
>
> **Exit:** `echo hi > a.txt` in bash makes `a.txt` appear in Explorer; `ls /proc` lists live PIDs; `dir` and `ls` agree.

---

## Important rules from OS_FOUNDATION.md (Golden Rules / Architecture)

1. No build step (plain `<script>` tags, vanilla JS).
2. Layers only call downward (L0 -> L7).
3. Services never touch the DOM.
4. Persistent state lives in IndexedDB through the owning service.
5. Every persisted shape has a `schemaVersion` and a migration.
6. Errors are structured (`FsError` / `OsError` style) — `{ code, message, detail }`.
7. Event naming: `domain:verb-noun` with `{ type, profileId, emittedAt, sequence }`.
8. Profile isolation is sacred.
9. Simulation, not reality — no host filesystem/network/clipboard access.
10. Do not rewrite what works; add adapter / wrapper / new file.

---

## Per-folder focus

- **2.2** — G6 (Windows-only path model). Introduce POSIX view, mount table, virtual `/tmp`/`/dev`/`/proc`.
- **2.3** — Schema migration and fixtures. Add `uid/gid/mode` + timestamps.
- **2.4** — Shell architecture (L6 apps + shared command-engine library). Separate from monolithic `index.html`.
- **2.5** — Unified storage events (`fs.watch`) between Explorer and Terminal (acceptance test for Phase 2).

---

## Reference files (copy of original paths in repo)

All files in `bundle/` are copied from:

- `main/fs/*` (L1 Storage layer)
- `main/kernel/*` (L3 Kernel / syscalls / events)
- `main/terminal.js` (L6 Shell / Terminal)
- `main/app-registry.js` (L3 / L5 app lifecycle)
- `docs/tasks/*.md` (task cards)
- `docs/CHANGELOG.md`, `docs/HANDOFF.md`, `docs/DECISIONS.md` (context)

Full repo root: `.` (working directory above `llm-phase2/`).
