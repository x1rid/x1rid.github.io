# PHASE 2.1 INSTRUCTION FOR AI AGENT (First-time)
# Source: OS_FOUNDATION.md G3 / Part 1.1 / Roadmap Phase 2.1
# Goal: Eliminate hardcoded fake VFS in terminal.js; wire to real VFS

## FILES PROVIDED IN THIS FOLDER
- terminal.js (target to edit)
- syscalls.js (syscall adapter reference)
- errors.js (structured error classes — must use these)
- site-config.json (identity context — do not hardcode)

## WHAT YOU MUST DO (Step by step)
1. Read terminal.js. Find `const vfs = {...}` (around lines 280-300).
2. Replace it with calls to the REAL filesystem service (see vfs-reference.js).
3. Use `OsError`/`FsError` from errors.js — NEVER throw bare strings.
4. Ensure commands `touch`/`ls`/`cat` reflect Explorer state — not fake data.

## ERROR RULES FROM OS_FOUNDATION.md
- All errors must be structured: { code, message, detail }
- Error codes must be UPPER_SNAKE (ENOENT, EACCES, etc.)
- See errors.js for registry

## OUTPUT REQUIRED
- Updated terminal.js content (full file or edited section)
- Optionally: tests/terminal-vfs.test.js content (if you can create it)

## DO NOT
- Leave hardcoded VFS definitions in terminal.js
- Throw bare strings
- Modify site-config.json unless required by task
