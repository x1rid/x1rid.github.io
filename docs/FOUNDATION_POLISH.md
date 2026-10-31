# FOUNDATION POLISH

> Audit of 2026-10-31 (commit `c377da1`). Static review plus a run of the Node
> tests and `verify.py`. The app was **not** run in a live browser; see
> section 6 for the manual smoke checklist that still needs a human.

**Verdict:** the architecture is sound (layers, kernel, security, VFS, tests all
exist and mostly pass). The safety net around it is not: a red test, no deploy
gate, one 404 on the live page, and stale docs. Fix these before adding features.

Legend: `P0` do first, `P1` soon, `P2` when convenient.

---

## 1. Safety net (P0)

- [ ] **P0 — Fix `tests/syscalls.test.js`.** `node tests/run-tests.js` exits 1.
  The test context is `caps: ['fs.read:user', 'proc:all']`, but the kernel now
  enforces `proc.list` (`main/kernel/syscalls.js`, capability check in
  `syscall()`), so the first call throws `CAPABILITY_DENIED` and the rest of the
  file never runs. Either grant the needed caps in the test context or run it
  with the capability mode set to non-enforcing, then confirm all assertions
  execute.
  *Done when:* `node tests/run-tests.js; echo $?` prints `0`.
- [ ] **P0 — Gate the deploy on tests.** `.github/workflows/deploy.yml` publishes
  `./main` on every push to `main` with no checks. Add a job that runs
  `node tests/run-tests.js` and `python verify.py`, and make `deploy` depend on it
  (`needs: test`).
  *Done when:* a commit that breaks a test no longer deploys.
- [ ] **P1 — Make `verify.py` meaningful.** It reports 111 errors, 108 of them
  from the scratch folder `phase3/`. Exclude `phase3/` and `_archive/` (or delete
  them, section 4) so a failure always means something real.

## 2. Broken references (P0)

- [ ] **P0 — Missing stylesheet on the live page.** `main/index.html` links
  `./desktop-environment.css`, which does not exist (only
  `main/desktop-environment.js` does). Every load 404s. Create the file or
  remove the `<link>`.
- [ ] **P1 — Stale root `index.html`** (about 6,500 lines, 232 KB). The README
  calls it a thin wrapper; it is a legacy monolith that references
  `./main/desktop-environment.css` and `./main/apps/calculator.js`, neither of
  which exists. The deploy workflow publishes only `./main`, so this file and
  `dora/` are not part of that deployment. Decide what the root should be:
  1. a small redirect/wrapper to `./main/`, or
  2. removed, or
  3. the real entry point (then change the workflow `path`).
  Record the choice in `docs/DECISIONS.md`.
- [ ] **P1 — Confirm what is actually served.** Check Settings → Pages: if the
  source is "GitHub Actions", the workflow rules; if it is "Deploy from a
  branch", the stale root `index.html` is what visitors get.

## 3. Security hygiene (P1)

- [ ] **P1 — Audit `innerHTML` use.** 74 `innerHTML=`/`insertAdjacentHTML`/`eval`
  style calls in first-party code, against `OS_FOUNDATION.md` rule 14. Most are
  probably static templates, but check each place that can receive user or
  package data, in this order:
  `main/fs/explorer-adapter.js` (13), `main/apps/mail/app.js` (6),
  `main/apps/event-viewer/app.js` (5), `main/apps/chat/app.js` (3),
  `main/retro-browser.js` (4), `main/window-manager.js` (6).
  Replace with `textContent` / DOM construction where the value is not a
  constant. Add a grep-based test that fails when a new unsafe call appears
  outside an allowlist.
- [ ] **P2 — Consider a CSP** `<meta>` for `main/index.html`. There is none
  today. The page loads only `fonts.cdnfonts.com` externally, so a tight policy
  is realistic.
- [ ] **P2 — `submodules: recursive` in the workflow** but there is no
  `.gitmodules`. Harmless; remove for clarity.

## 4. Repo hygiene (P1)

- [ ] **P1 — Copyright risk.** `main/playlist/` holds about 12 MB of commercial
  tracks (Basshunter, Crystal Castles, The Cure, others) and `main/vendor/`
  includes Space Cadet Pinball data and a Winamp skin/MP3. On a public repo these
  invite takedown notices. Swap in tracks you have rights to (CC0 / CC-BY with
  attribution) and review the vendored game assets' licences.
- [ ] **P1 — Remove scratch from the production repo:** `phase3/` (including the
  two zips and `shot3/` chunks) and `_archive/`. Move to a separate branch or a
  private repo if the history matters.
- [ ] **P2 — Repo weight.** About 37 MB working tree, 23 MB pack. `main/vendor`
  is 21 MB; confirm each vendored program is actually reachable from the UI.
- [ ] **P2 — Encoding.** `docs/HANDOFF.md` is not valid UTF-8 (legacy-encoded
  bytes). Re-save as UTF-8.

## 5. Docs and spec drift (P1)

- [ ] **P1 — Rewrite the README structure section.** It describes
  things that are no longer true (root `index.html` as a thin wrapper, the `l/`
  link-tree folder, `main/desktop-shell.html`, which is now archived) and omits
  `kernel/`, `security/`, `shell/`, `tests/`, `docs/`.
- [ ] **P1 — Stop quoting test counts in prose.** HANDOFF/CHANGELOG say 183,
  215, 286 passing; the suite is now 426. Link to `node tests/run-tests.js`
  instead.
- [ ] **P2 — `localStorage` drift.** Rule 5 says no new keys; it is still used in
  `fs/migrations.js` (13), `terminal.js` (10), `profile/persistence-service.js`
  (6), `kernel/syscalls.js` (5) and others. Either migrate to the owning service
  or update the rule to list the permitted keys.
- [ ] **P2 — `npm test` is referenced by the Definition of Done** but there is no
  `package.json`. Add a minimal one with `"test": "node tests/run-tests.js"` (no
  dependencies, so the no-build rule still holds).
- [ ] **P2 — `main/index.html` is 368 lines**, near the "under 200 lines" Phase 3
  exit target. Track the remaining inline content.

## 6. Manual smoke checklist (not yet run, needs a browser)

Serve locally with `python serve.py` and open
`http://127.0.0.1:5500/main/index.html`, with DevTools open.

- [ ] Page loads; Network tab shows **no 404s** (expect `desktop-environment.css`
  until fixed) and Console shows no uncaught errors.
- [ ] Lock screen appears; Guest signs in without a password.
- [ ] Desktop renders; Explorer and Terminal open and close cleanly.
- [ ] In the terminal: `echo hi > a.txt`, then `a.txt` appears in Explorer.
- [ ] Switch to Owner (sets a password on first use) and confirm Guest files are
  not visible.
- [ ] Reload: window positions and settings persist.
- [ ] Phone width (<=600px): tab bar and terminal key strip appear.
- [ ] `?debug=1` overlay lists service diagnostics.

## 7. Suggested order

1. `syscalls.test.js` fix, then the CI gate (section 1).
2. Missing CSS and the root `index.html` decision (section 2).
3. `innerHTML` audit plus a grep guard (section 3).
4. Copyright and scratch cleanup (section 4).
5. README and spec refresh (section 5).
6. Run the smoke checklist (section 6) after each of the above.
