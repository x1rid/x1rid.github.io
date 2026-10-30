# PHASE 2.3 INSTRUCTION — VFS schema v2: uid/gid/mode, timestamps. Migration + fixtures

SOURCE: docs/OS_FOUNDATION.md (Phase 2: One truth for storage and shells)

---

## Exact instruction from OS_FOUNDATIONS.md

> - 2.3 VFS schema v2: `uid/gid/mode`, timestamps. Migration + fixtures.

---

## Context

Phase 2 is about "one truth for storage and shells". After path dialects (2.2) come storage schema updates needed for permission checks (L2 Security) and multi-user isolation (G11 / G1).

Every persisted shape must have `schemaVersion` and a migration (Golden Rule 6).

---

## Required outputs

- `fs/types.js` (or new schema definition) updated with `uid`, `gid`, `mode`, `createdAt`, `modifiedAt`, `accessedAt`.
- Migration file (e.g., `fs/migrations.js`) with `v2` that transforms existing v1 nodes.
- Fixture / seed data updated with schema v2 fields so boot is deterministic.
- `filesytem-service.js` / `node-store.js` handles new fields on read/write.

---

## Exit criteria (Phase 2 overall)

> `ls /proc` lists live PIDs; `dir` and `ls` agree.

(Implies VFS must expose `uid/gid/mode` correctly to shells.)

---

## Reference files in bundle

- `main/fs/types.js`, `main/fs/migrations.js`, `main/fs/init.js`, `main/fs/filesystem-service.js`
- `docs/CHANGELOG.md` for P2.1 format
