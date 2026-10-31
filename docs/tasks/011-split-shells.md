# TASK 011: Phase 2.4 — Split Shells (cmd, powershell, bash) & Command-Engine Library
Tier: B (clear spec)
Layer: L5/L6 (Shell & Applications)
Phase: 2.4
Owner folder(s): main/shell/, main/apps/, tests/
Do NOT touch: main/fs/ (schema stays untouched)
Depends on: Phase 2.1 (terminal syscalls), Phase 2.2 (path dialects)

## Goal
Implement Phase 2.4 per `docs/OS_FOUNDATION.md`:
1. Create `CommandEngine` library (`main/shell/command-engine.js`) providing parser, pipes, redirection, environment expansion, and job control.
2. Split shells into separate L6 apps (`main/apps/cmd.js`, `main/apps/powershell.js`, `main/apps/bash.js`).
3. Wire shells to the real VFS via `Kernel.syscall` without direct `window.VFS` access.
4. Support distinct dialects for each shell:
   - `cmd`: Windows CMD dialect (`C:\...>`, `dir`, `cd`, `type`, `cls`, `del`, `md`, `ver`, `%VAR%`).
   - `powershell`: PowerShell dialect (`PS C:\...>`, `Get-ChildItem`/`dir`/`ls`, `Get-Content`/`cat`, `Set-Location`/`cd`, `$env:VAR`).
   - `bash`: POSIX Bash dialect (`user@host:path$`, `ls`, `cd`, `cat`, `pwd`, `rm`, `export`, `$VAR`).
5. Ensure legacy terminal integrations continue to function via `terminal` alias.

## Inputs
- `docs/OS_FOUNDATION.md` §2.2 (G4, G5), §3.2 (Personalities), §8 Phase 2.4
- `llm-phase2/2.4-split-shells/INSTRUCTION.md`

## Files Created / Modified
- `main/shell/command-engine.js` (created)
- `main/apps/cmd.js` (created)
- `main/apps/powershell.js` (created)
- `main/apps/bash.js` (created)
- `main/index.html` (modified to include shell scripts and registration)
- `tests/command-engine.test.js` (created)

## Acceptance Tests
- `node tests/command-engine.test.js` passes all 47 tests.
- `node tests/run-tests.js` passes all 383 tests across 18 test suites.
- `echo hi > a.txt` redirection and piping work as specified.
- CMD, PowerShell, and Bash session runners execute commands and format prompts correctly.
