# Desktop Simulator Roadmap

Execution specification for the next architectural improvements to the browser-based
Windows desktop simulator hosted on GitHub Pages. Work is done one phase at a time,
verified in the running application, with the existing project preserved.

---

## 1. Project constraints

- The project is a static, browser-based Windows 98/XP-inspired desktop simulator.
- Use vanilla HTML, CSS, and JavaScript.
- Do **not** introduce npm, Vite, Webpack, a backend, or production ES modules.
- Preserve compatibility with GitHub Pages.
- Follow the existing script-loading and `window.*` global API conventions.
- Treat the current repository as the source of truth. Inspect the actual implementation before changing it.
- Do not replace working systems with simplified rewrites, create parallel implementations, or duplicate existing services.
- Keep all simulated filesystem operations inside the VirtualFS (VFS). Never access or modify the host operating system's files.
- Keep the existing retro aesthetic, UI layout, and working applications intact unless a specific change requires otherwise.
- Do not implement ARG scenarios or the vulnerability simulation engine yet.

---

## 2. Current architecture

The application already includes:

### Profile and persistence layer

```
main/profile/profile-db.js
main/profile/profile-service.js
main/profile/persistence-service.js
main/profile/boot.js
main/profile/profile-ui.js
main/profile/README.md
```

Public contracts include:

```js
ProfileService.init()
ProfileService.getProfiles()
ProfileService.getProfile(id)
ProfileService.getActiveProfile()
ProfileService.setActiveProfile(id)
ProfileService.unlock(id, password)
ProfileService.lock(id)
ProfileService.subscribe(fn)

PersistenceService.loadProfileState(id)
PersistenceService.saveProfileState(id, state)
PersistenceService.queueSave(id, partial)
PersistenceService.flush(id)
PersistenceService.resetProfileState(id)
PersistenceService.collectState()
PersistenceService.applyState()
PersistenceService.bindAutoSave()
```

Profile initialization is exposed through `ProfileReady` and `ProfileService.ready`.

### Virtual filesystem

```
main/fs/types.js
main/fs/node-store.js
main/fs/content-store.js
main/fs/path-resolver.js
main/fs/events.js
main/fs/filesystem-service.js
main/fs/migrations.js
main/fs/init.js
main/fs/explorer-adapter.js
```

The owner uses the existing `vfs-db` database. Guest uses `vfs-db-guest`. Preserve this isolation and the existing database contents.

### Existing shell and applications

- Desktop shell and window manager.
- Explorer, Terminal, Start menu, taskbar, music player, and retro applications.
- Shared VFS and event system.
- Multiple HTML entry points, including the root `index.html`, `main/index.html`, and `main/desktop-shell.html`.

Inspect the actual code and entry-point differences before deciding where to make changes. Do not assume every entry point has identical functionality.

---

## 3. Execution protocol — mandatory

Work on exactly one phase at a time.

For each phase:

1. Inspect the relevant files, dependencies, event contracts, and existing behavior.
2. Identify the smallest safe implementation plan.
3. Report the intended changes briefly.
4. Implement that phase only.
5. Run syntax checks on every changed JavaScript file.
6. Run browser-driven tests against the actual application using the available local-server and browser automation tools.
7. Test both Guest and Owner where relevant.
8. Check the browser console for new errors.
9. Verify that existing functionality has not regressed.
10. Update the relevant README or technical documentation.
11. Produce a completion report (see §6).

Stop after completing each phase and report the results. **Do not begin the next phase until explicitly approved.**
If a phase fails verification, fix it before requesting approval.

If the repository's actual architecture differs from this description, adapt to the code rather than forcing the design below onto it.

---

## 4. Phase roadmap

### Phase 0 — Architecture audit and baseline

*Do not implement new features in this phase.*

- Inspect the repository structure and all relevant entry points.
- Trace boot order: profile initialization, VFS initialization, state restoration, desktop rendering, and window-manager initialization.
- Locate every existing use of `localStorage`, `sessionStorage`, IndexedDB, and global `window` state.
- Identify how applications are registered, launched, closed, and restored.
- Trace profile switching and locking behavior.
- Check how Explorer, Terminal, desktop icons, Recycle Bin, and file associations obtain the active VFS.
- Run baseline syntax and browser tests.
- Identify pre-existing failures separately from new issues.

**Deliverable:** an architecture map, a prioritized risk list, and the proposed implementation plan. Stop and await approval.

### Phase 1 — Profile-aware window persistence

**Goal:** Make the window manager's persistent state profile-specific.

- Inspect the existing window manager and its storage keys.
- Replace global persistent window-state storage with the existing `PersistenceService` or a carefully designed profile-scoped extension.
- Persist only stable, serializable state, such as:
  - Open application IDs.
  - Window positions and dimensions.
  - Maximized state.
  - Minimized state where appropriate.
  - Any necessary application restoration metadata.
- Keep focus order, active DOM elements, drag operations, context menus, and transient interaction state **out of** persistence.
- Restore windows only after the correct profile, VFS, and application registry are ready.
- On profile switch or lock, ensure old-profile windows and content cannot remain visible.
- Prevent stale asynchronous saves from one profile from writing into another profile's state.
- Validate restored geometry and discard invalid or obsolete state safely.
- Preserve existing window-management behavior.

**Acceptance tests:**

- Open and arrange multiple windows; reload; verify restoration.
- Switch profiles; verify each profile restores only its own windows.
- Lock Owner; verify Owner windows and content disappear.
- Switch back to Owner; verify expected state is restored.
- Corrupt persisted window state; verify safe defaults and no crash.
- Confirm Guest cannot display Owner file content through a previously open window.
- Confirm existing drag, resize, minimize, maximize, focus, and close operations still work.

Do not proceed until this phase passes.

### Phase 2 — Centralized Shortcut Manager

**Goal:** Route simulator keyboard shortcuts through one context-aware service.

- Inspect all current keyboard listeners before implementing anything.
- Avoid duplicate handlers and conflicting shortcuts.
- Add a central shortcut service following existing project conventions.
- Support registration, unregistration, context, priority, focus awareness, and conflict diagnostics.
- Integrate the window manager, Explorer, Terminal, Start menu, and lock screen.
- Support practical shortcuts where browser behavior permits:
  - Start menu.
  - Explorer.
  - Run dialog, if present.
  - Window switching.
  - Simulator-window close.
  - Show desktop.
  - Lock screen.
  - Explorer copy, cut, paste, rename, delete, properties, and new folder.
  - Terminal history and clear screen.
- Do not promise browser-reserved shortcuts will work. Never interfere unnecessarily with address-bar, tab, or browser navigation shortcuts.
- Respect editable fields and application-specific shortcuts.

**Acceptance tests:**

- Each shortcut works in the intended context.
- Shortcuts do not trigger through unrelated input fields.
- No duplicate action occurs.
- Registration and unregistration work.
- Existing browser shortcuts remain usable where required.

### Phase 3 — Application Registry and lifecycle

**Goal:** Establish a consistent application contract.

- Audit how current apps are launched and closed.
- Reuse existing mechanisms where possible.
- Define a central registry for app IDs, metadata, launch handlers, supported file types, and lifecycle behavior.
- Provide consistent launch, focus, minimize, restore, and close semantics.
- Track running applications separately from window DOM elements.
- Define how apps obtain the active profile and VFS.
- Ensure closing an app cleans up listeners, subscriptions, timers, and resources.
- Make window restoration use the registry rather than hardcoded app-specific branches.
- Preserve all existing `RetroApps` and bundled vendor applications.

**Acceptance tests:**

- Every existing app launches and closes correctly.
- Unknown application IDs fail gracefully.
- Duplicate launches follow an explicitly defined policy.
- Closed apps do not leave active listeners or stale windows.
- Restored apps launch in the correct profile context.
- File associations still work.

### Phase 4 — Shared system services

**Goal:** Eliminate duplicated implementations of common desktop behavior.

Audit first, then integrate only missing or inconsistent services:

- Clipboard service.
- Open/Save dialog service.
- File-association service.
- Notifications and error reporting.
- Shared settings access.
- Standardized system events.

**Requirements:**

- Clipboard file operations must reference VFS nodes, not unrelated mock data.
- Open/Save dialogs must use the active profile's VFS.
- Apps must not bypass VFS isolation.
- Events must have documented payloads and predictable ordering.
- Services must be initialized before dependent apps.
- Existing application behavior must remain compatible.

**Acceptance tests:**

- Copy and paste text and virtual files.
- Open and save files through multiple applications.
- Verify associations and cancellation behavior.
- Switch profiles and verify no stale file handles or clipboard references expose private virtual file content.
- Verify errors do not silently report success.

### Phase 5 — Virtual system configuration and permissions

**Goal:** Establish the foundation for future in-browser security scenarios without implementing attacks yet.

Create a minimal, documented virtual configuration model only after inspecting existing requirements.

Potential components:

- A namespaced virtual configuration store.
- Simulated users and groups.
- Virtual access-control rules.
- Startup-entry and service metadata.
- Structured virtual audit events.
- A reset or rollback mechanism.

**Requirements:**

- All data must remain within the simulator's storage and virtual environment.
- Configuration must be serializable, validated, versioned, and profile-scoped where appropriate.
- Define which settings are global simulation defaults and which belong to individual profiles.
- Define deterministic permission checks and error results.
- Do not claim to reproduce actual Windows security semantics.
- Do not modify real Windows registry keys, executables, services, startup folders, or permissions.
- Do not implement vulnerability scenarios, privilege-escalation demonstrations, or attack chains in this phase.

**Acceptance tests:**

- Configuration persists and reloads.
- Invalid or unknown fields are rejected or safely ignored.
- Guest and Owner configurations follow the documented isolation model.
- Permission checks produce deterministic results.
- Reset and rollback restore expected virtual state.
- No real host-system modifications occur.

### Phase 6 — Final integration and readiness audit

*Only after Phases 1–5 are individually approved.*

- Test all entry points.
- Test fresh and returning profiles.
- Test reloads, profile switching, locking, malformed persisted data, and storage failures.
- Test existing applications and VFS operations.
- Verify event ordering and initialization dependencies.
- Check for stale asynchronous writes and duplicated event listeners.
- Review accessibility and keyboard navigation.
- Document APIs, schemas, initialization order, and recovery procedures.
- Provide a final architecture map and identify remaining limitations.

Do not begin the vulnerability simulation engine automatically. Present the readiness findings and wait for separate approval.

---

## 5. Engineering requirements

- Prefer small, reversible changes over broad rewrites.
- Reuse existing APIs and services where suitable.
- Avoid duplicate sources of truth.
- Validate untrusted persisted data at the boundary.
- Handle IndexedDB errors and unavailable storage explicitly.
- Make asynchronous lifecycle operations safe against profile changes and stale callbacks.
- Clean up event listeners and subscriptions.
- Preserve database names and schema compatibility unless a migration is necessary.
  - If a migration is required, document it and provide a safe failure path.
- Do not delete user data or clear IndexedDB to make tests pass.
- Use disposable browser profiles or uniquely named test fixtures for destructive tests.
- Keep the owner password out of source code, logs, and reports.
- Never treat the client-side password gate as genuine data confidentiality.
- Do not add dependencies without a demonstrated need.
- Do not refactor unrelated code just because it can be improved.

---

## 6. Final reporting format

At the end of every phase, return:

### Phase: Name and number

### Implementation

- Files created or modified.
- Design decisions.
- Public APIs or events added or changed.

### Verification

- Commands executed.
- Browser tests performed.
- Expected versus observed results.
- Console errors and pre-existing failures.

### Regression assessment

- Existing features tested.
- Untested areas.
- Remaining risks.

### Next step

State the next phase and why it depends on this phase.
Do not start it until approved.
