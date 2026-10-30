# TASK 004: Phase 1.3 — Extract security/ from system-config.js (users, permissions, audit)
Tier: A (needs design judgment)
Layer: L2
Phase: 1.3
Owner folder(s): main/security/, main/system-config.js, tests/
Do NOT touch: main/fs/, main/profile/
Depends on: TASK 003 (kernel/events.js), TASK 002 (kernel/platform/)

## Goal
Extract the core security models (users & principals, default-deny permission engine, structured audit log) from `system-config.js` into dedicated L2 modules in `main/security/`:
- `security/users.js` (`window.SecurityUsers`)
- `security/permissions.js` (`window.SecurityPermissions`)
- `security/audit.js` (`window.SecurityAudit`)
Maintain `window.SystemConfig` as a fully backward-compatible facade so no existing callers break.

## Inputs
- `docs/OS_FOUNDATION.md` §3 (Layer L2), §6.1 (service contract), §8 Phase 1.3
- `main/system-config.js` (existing permission checking, default data, validation, audit buffer)
- `main/kernel/events.js` (audit events emit via `KernelEvents` / `sec:audit`)

## Contracts
`main/security/users.js` -> `window.SecurityUsers`:
- `getUser(id)`, `getGroup(id)`, `listUsers()`, `listGroups()`, `getCurrentUser(profileId)`

`main/security/permissions.js` -> `window.SecurityPermissions`:
- `check(request)`: default-deny permission evaluator matching user/group/role against actions & resources
- `can(action, resource, options)`: boolean shorthand

`main/security/audit.js` -> `window.SecurityAudit`:
- `record(entry)`: logs structured audit event and emits `sec:audit` / legacy `system:audit`
- `getEntries(limit, filter)`: query audit buffer

`main/system-config.js`:
- Bridges `check()`, `can()`, `audit()`, `currentUser()` to the L2 modules while keeping config schema persistence intact.

## Acceptance Tests
- `node tests/security.test.js` passes.
- `SystemConfig.check()` and `SecurityPermissions.check()` produce identical results.
- `SecurityPermissions.can('fs:write', 'C:\\Windows\\system32')` returns false (default-deny/protected).
- All 233+ test suite tests remain green.

## Rollback
Remove `main/security/` and revert `main/system-config.js`.
