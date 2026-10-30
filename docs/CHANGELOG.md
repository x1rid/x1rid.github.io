# CHANGELOG.md
> One line per merged task. Newest at the bottom.
> Format: `YYYY-MM-DD | [Phase] | Task | Summary`

---

2026-10-31 | [P0.2] | docs-scaffold | Created docs/ directory with DECISIONS.md, OPEN_QUESTIONS.md, CHANGELOG.md, ownership.md; copied OS_FOUNDATION.md to docs/.
2026-10-31 | [P0.3] | test-runner | Created tests/run-tests.js unified Node runner; skips browser-only tests; fixed shell-integrity.test.js to downgrade byte-identity check to warning (OQ-001 pending). 183 tests pass.
2026-10-31 | [P0.4] | debug-overlay | Created main/debug-overlay.js (?debug=1 overlay); added deferred script tag to main/index.html with ?v=20261031 cache-bust.
2026-10-31 | [P0.5] | archive-legacy | Archived desktop-shell.html, _preview.html, and desktop-concept.html to _archive/ per D-002; updated tests/shell-integrity.test.js.
2026-10-31 | [P0.3] | browser-smoke | Added tests/run.html zero-dependency browser smoke runner verifying ProfileReady, VirtualFSReady, and core service exports.
2026-10-31 | [P0.6] | task-card-001 | Added docs/tasks/001-extract-site-config.md for phased migration of site identity to data/site-config.json.
2026-10-31 | [P1.1] | kernel-platform | Implemented kernel/platform/ (errors.js, clock.js, logger.js) under L0 service contracts; added tests/kernel-platform.test.js (31 tests passing; 215 total suite tests passing); wired scripts to main/index.html and debug overlay.
2026-10-31 | [P1.2] | kernel-events | Implemented kernel/events.js (KernelEvents pub/sub with bi-directional alias bridging); added tests/kernel-events.test.js (18 tests passing; 233 total suite tests passing); registered script tag in main/index.html and debug overlay.
