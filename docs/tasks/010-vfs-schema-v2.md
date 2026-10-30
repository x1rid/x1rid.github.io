# Task 010 — VFS Schema v2: uid/gid/mode, timestamps, migration

**Phase:** 2.3  
**Layer:** L1 (fs/)  
**Status:** In Progress  
**Created:** 2026-10-31

---

## Objective

Extend every persisted VFS node with POSIX-style ownership and permission fields:
`uid`, `gid`, `mode`, `accessedAt`. Add a schema v2 migration in `migrations.js`
that back-fills these fields on existing v1 nodes.

---

## Allowed files

| File | Action |
|------|--------|
| `main/fs/types.js` | Add `uid`, `gid`, `mode`, `accessedAt` to `FsNode` typedef and exports |
| `main/fs/migrations.js` | Add `migrate_v1_to_v2`, bump `TARGET_VERSION` to `2` |
| `main/fs/filesystem-service.js` | Stamp new nodes with `uid`, `gid`, `mode`, `accessedAt`; update `readFile` to update `accessedAt` |
| `main/fs/init.js` | Pass `username` to `VfsPathResolver`; no other changes |
| `tests/vfs-schema-v2.test.js` | New test suite for schema v2 fields and migration |
| `docs/CHANGELOG.md` | Append P2.3 entry |
| `docs/HANDOFF.md` | Append P2.3 session entry |

---

## NOT Allowed

- Process table
- Syscall layer
- Terminal shell splitting
- Explorer / DOM code
- Persistence schema keys other than `vfs-schema-version`
- Any new localStorage key

---

## Schema v2 Node fields

```js
{
  // existing v1 fields …
  uid:        0,       // number — owner user ID (0 = root/system, 1 = owner)
  gid:        0,       // number — group ID
  mode:       0o644,   // number — POSIX permission bits (octal)
  accessedAt: 0        // number — last read epoch ms
}
```

Default modes:
- Directory: `0o755`
- File: `0o644`
- System/read-only node: `0o444`

---

## Migration logic

`migrate_v1_to_v2(nodeStore)`:
1. Scan all nodes.
2. For any node missing `uid`, `gid`, `mode`, or `accessedAt`:
   - Set `uid = 1` (owner), `gid = 1`.
   - If `attributes.system`, set `uid = 0, gid = 0, mode = 0o444`.
   - Else if `type === 'directory'`, set `mode = 0o755`.
   - Else set `mode = 0o644`.
   - Set `accessedAt = node.modifiedAt || node.createdAt || Date.now()`.
3. Write updated node back with `nodeStore.putNode(node)`.

---

## Exit criteria

- `node tests/run-tests.js` shows 0 failures (≥ 320 tests expected).
- `tests/vfs-schema-v2.test.js` runs in the main suite.
- All freshly created nodes via `VirtualFS.createFile/createDirectory` have `uid`, `gid`, `mode`, `accessedAt`.
- Migration back-fills any node that lacks these fields.
- `schemaVersion` in localStorage is `2` after migration.
