# ownership.md
> Maps each folder to one owner (agent role or the human).
> Only the owner merges changes in that folder; others submit patches.

| Folder | Owner role | Notes |
|---|---|---|
| `docs/` | Anyone; Tier C friendly | Append-only logs are safe for any agent |
| `kernel/`, `security/` | Architect agent (Tier A) | Does not exist yet; to be created in Phase 1 |
| `fs/`, `profile/` | Storage agent (Tier A/B) | Existing; do not modify until Phase 1 exit |
| `shell/` | Shell agent (Tier B) | Does not exist yet; extracted from index.html in Phase 3 |
| `apps/<id>/` | App agent per app (Tier B/C) | Existing flat files; manifest-per-folder in Phase 3 |
| `immersion/` | Polish agent (Tier C/B) | Does not exist yet; extracted from lock-screen/ in Phase 3 |
| `tests/`, `docs/` | Anyone; Tier C friendly | |
| `main/index.html` | Human + Shell agent | Hot file; touch only to add/bump script tags |
| `vendor/` | Anyone read-only | Third-party; do not modify |
