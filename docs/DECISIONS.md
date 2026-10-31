# DECISIONS.md
> Append-only decision log. Add entries at the bottom with date and task id.
> Format: `## YYYY-MM-DD | D-NNN | Short title`

---

## 2026-10-31 | D-001 | docs/ scaffold and OS_FOUNDATION.md placement
Context: OS_FOUNDATION.md was located in `main/` (the served root). The spec (Part 4) requires it to live in `docs/OS_FOUNDATION.md`.
Options:
  A) Move (git mv) — cleanest history but breaks any hardcoded link to `main/OS_FOUNDATION.md`.
  B) Copy to `docs/` and keep the original as a pointer file — safe for agents mid-flight.
Decision: B — copied to `docs/OS_FOUNDATION.md`; original left at `main/OS_FOUNDATION.md` with a redirect notice to avoid breaking any agent that still references the old path. Will remove the original in Phase 0 exit commit once all agents are updated.
Consequences: Two copies briefly exist. The `docs/` copy is canonical. Do not edit the `main/` copy.
Owner: Antigravity (AI)

## 2026-10-31 | D-002 | Resolution of Phase 0 Open Questions (OQ-001 - OQ-004)
Context: User clarified answers to OQ-001 through OQ-004 to complete Phase 0.
Decisions:
1. `desktop-shell.html` was an older duplicate/prototype shell; moved to `_archive/desktop-shell.html`.
2. `_preview.html` and `desktop-concept.html` moved to `_archive/`.
3. Browser integration testing will start with a plain, zero-dependency `tests/run.html` runner per Golden Rule 1; Playwright will only be evaluated if `run.html` proves insufficient.
4. Extracting hardcoded identities (`r3d1bruh`) to `data/site-config.json` approved with explicit `schemaVersion` and migration/loader steps, scheduled as a discrete Task Card (`docs/tasks/001-extract-site-config.md`).
Owner: Human & Antigravity

## 2026-10-31 | D-003 | Phase 2.4 Split Shells & CommandEngine Architecture
Context: OS_FOUNDATION.md Phase 2.4 requires splitting shells (`cmd`, `powershell`, `bash`) as separate L6 apps sharing a command-engine library.
Options:
  A) Bundle parsing and builtins individually inside each shell script.
  B) Provide a shared `CommandEngine` library in `main/shell/command-engine.js` implementing tokenizer, AST parsing, environment expansion, pipeline chaining, redirection, and job control, while allowing each shell app (`main/apps/cmd.js`, `main/apps/powershell.js`, `main/apps/bash.js`) to provide its own dialect, prompts, and builtins.
Decision: B — `CommandEngine` acts as the shared foundation for all L6 shells, communicating with VFS purely through `Kernel.syscall` and exposing job control and diagnostics.
Consequences: Shells share robust pipeline and redirection logic without duplicate code; dialect differences remain strictly confined to presentation, parsing rules, and builtins.
Owner: Jules



## 2026-10-31 | D-004 | Served Root & Repository Structure Alignment
Context: Section 2 of `docs/FOUNDATION_POLISH.md` observed that GitHub Pages is configured to publish `./main` (`.github/workflows/deploy.yml`), whereas the root of the repository previously contained a legacy duplicate `index.html`.
Options:
  A) Change Pages deploy workflow to publish from repo root.
  B) Keep `./main` as the authoritative, modular static distribution target (which contains all extracted shell scripts, manifest apps, and assets), and keep root `index.html` synchronized for local / root-level testing while tracking `./main/index.html` as the deployment entry point.
Decision: B — `./main` remains the deployment target for GitHub Pages. `main/desktop-environment.css` is added to prevent 404s, stale script tags in the root `index.html` are cleaned up, and verify.py checks both locations.
Owner: Human & Antigravity

## 2026-11-01 | D-005 | Active-session lock is a shield, not a sign-in
Context: Super+L must lock the running desktop like Ubuntu GNOME and restore the exact session, while LockScreenV2 remains the boot/sign-in screen.
Options:
  A) Re-skin LockScreenV2 and reuse its `lock()` (calls `ProfileService.lock()`, which clears `desktop.ownerUnlocked`, so a refresh would boot Guest).
  B) Add a presentation-only `SessionLock` over the live desktop; keep the owner session established and gate it with a sessionStorage marker (`desktop.sessionLock`) checked by `ProfileUI` before the desktop is reachable. Unlock re-verifies through `ProfileService.authenticate()`.
Decision: B. No new database, credential store or session manager; LockScreenV2 is unchanged for sign-in and profile switching.
Consequences: Lock/unlock never reloads or touches windows/VFS. The marker is client-side state like the rest of the simulator's auth and is not a security boundary.
Owner: Devin
