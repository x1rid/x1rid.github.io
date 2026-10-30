# TASK 001: Extract site identity config to data/site-config.json
Tier: B (clear spec)
Layer: L1
Phase: 0 (Phase 0.6 completion)
Owner folder(s): main/data/, main/fs/, main/profile/
Do NOT touch: main/window-manager*.js, tests/unit/
Depends on: none

## Goal
Extract hardcoded site-owner and desktop identity string configurations out of JavaScript into a versioned `main/data/site-config.json` with a dedicated schema version and migration handling.

## Inputs
- `docs/OS_FOUNDATION.md` (Part 1 Rules 5 & 6, Part 2 G11, Part 8 Phase 0.6)
- `main/fs/init.js`
- `main/fs/migrations.js`
- `main/profile/profile-service.js`

## Contract
`main/data/site-config.json`:
```json
{
  "schemaVersion": 1,
  "owner": {
    "displayName": "r3d1bruh",
    "legacyUsername": "r3d1"
  },
  "desktop": {
    "hostname": "desktop",
    "defaultShellPrompt": "user@desktop:~$"
  }
}
```

## Steps
1. Create `main/data/site-config.json` with `schemaVersion: 1`.
2. Add migration validation / loader in `main/fs/migrations.js` or dedicated loader.
3. Update `profile-service.js` and `init.js` to reference configuration cleanly.
4. Add unit test asserting `schemaVersion` integrity and fallback behaviour if config is missing.

## Acceptance tests
- `node tests/run-tests.js` passes.
- `site-config.json` validates against `schemaVersion: 1`.

## Rollback
Delete `main/data/site-config.json` and revert `init.js` and `profile-service.js` edits.
