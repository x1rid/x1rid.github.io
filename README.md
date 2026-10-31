# x1rid.github.io

A purple/black retro personal homepage and desktop simulator OS platform. Fully static — no build step, no dependencies, no framework.

**Live:** https://x1rid.github.io

## Structure

```
index.html          → root desktop entry wrapper
main/               → the retro desktop environment & OS platform
    index.html      → modular desktop shell
    kernel/         → L3 kernel subsystem (process-table, syscalls, kernel-db, packages,
                      autostart, scheduler, power, net-service, fake-internet,
                      mail-service, resource-sim, theme-service, sound-service, wm-layout)
    security/       → L2 security services (users, audit, permissions, elevation)
    profile/        → multi-profile storage & state (profile-service, profile-db,
                      persistence-service, window-state)
    fs/             → virtual filesystem VFS (types, stores, path-resolver,
                      filesystem-service, migrations)
    shell/          → extracted modular desktop shell (state, window-host, start-menu,
                      desktop, notifications, command-engine, boot, lock-screen-host)
    apps/           → first-party & manifest applications (calculator, notepad,
                      task-manager, settings, mail, chat, event-viewer, dmesg,
                      cmd, powershell, bash, minesweeper, solitaire)
    themes/         → JSON theme definitions (default, dark, hacker, win95, macos)
    immersion/      → BIOS POST screen and boot menu simulators
    lock-screen/    → LockScreenV2 components and animations
    css/            → theme & styling tokens
    data/           → links.json, site-config.json
    assets/         → sprites, icons, and custom cursors
    playlist/       → playlist audio assets and playlist.json
docs/               → architectural specifications & task cards
    OS_FOUNDATION.md → canonical architecture and layering reference
    FOUNDATION_POLISH.md → audit findings and polish checklist
    DECISIONS.md    → architectural decision log
    CHANGELOG.md    → task completion history
    HANDOFF.md      → agent handoff notes
tests/              → test suites (run via `node tests/run-tests.js`)
verify.py           → static verification script
package.json        → project metadata and test scripts
```

## Testing & Verification

Run the full automated test suite:
```bash
npm test
# or: node tests/run-tests.js
```

Run static validation (JSON, asset references, script syntax):
```bash
python verify.py
```

## Terminal & Commands

The desktop environment includes multiple terminal personalities (`r3sh`, `cmd`, `powershell`, `bash`) wired to the virtual filesystem (`VFS`) via kernel syscalls. It supports redirection (`>`, `>>`), pipeline chaining, command history, and filesystem management commands (`cat`, `touch`, `ls`, `cd`, `rm`, `neofetch`, etc.).

## Music

Tracks live in `main/playlist/`. The music player widget integrates with the desktop taskbar mini controller, offering track seeking, volume control, and crossfading.
