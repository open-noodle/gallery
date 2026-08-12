# Face Verdict Remediation — Slice 10: Suite hardening, hygiene, regeneration, final gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development for the test/hygiene tasks; the regen + CI-dispatch + babysit steps are controller-run.

**Goal:** Close **D15** (suite gaps that let D1–D4 ship green) + **D16** (hygiene), correct the parent doc, regenerate all derived artifacts, and drive the whole branch to CI-green.

> **Note:** Slices 1–9 already delivered the behaviour; Slice 10's test reworks are **regression locks** — many go green immediately against the fixed code, so they are not red-first cycles. Treat the steps below as a checklist, not one red→green pass.

## Global Constraints

- `src/` alias; server eslint `--max-warnings 0`; web svelte-check/lint → CI (R6). No `Co-Authored-By` trailers.
- `mise sql` needs a CLEAN `dist` (`rm -rf dist && pnpm build`) + a MIGRATED throwaway Postgres (`DB_URL=... pnpm migrations:run` first) — NEVER run it without a DB (it deletes query files). Use `DB_URL`, not `DB_PORT`.
- Feature-branch pushes trigger NO CI — the full CI set is DISPATCHED manually (`gh workflow run <wf> --ref feat/face-review-unified`, account `Deeds67`); read JOB-level results (run-level "success" can hide a failed job).
- i18n is shared web+mobile — grep BOTH `web/src` AND `mobile/lib` before deleting a key; new keys need only `en.json`.
- Commit per change-class; final commit `test: close the verdict-layer coverage gaps found in review`.

---

## Task 1: Suite hardening (D15) — implementer subagent

- [ ] **1.1** `face-review-cross-flow.spec.ts:186-189` — remove the `.catch(() => {})`; the confirm path must pass green against the real DB (Slices 3/9 made confirm robust). Run the spec, confirm green without the swallow.
- [ ] **1.2** Band boundaries — in `face-person-verdict.repository.spec.ts`, add `getPendingForPerson` cases at exactly `distance == maxDistance` (excluded, `>` semantics) and `distance == suggestionMaxDistance` (included, `<=` semantics), pinning the band predicate.
- [ ] **1.3** Keep-here identity — extend the `declineRowsFor`/row-read helper to SELECT `identityId`/`actorId`, and assert a cleanup keep-here row stores both (not null).
- [ ] **1.4** Resolutions fixtures — the medium (`face-repair.resolutions.spec.ts`) + web (`resolutions/page.spec.ts`) resolutions fixtures gain (a) a **space-person** verdict row (`spacePersonId` set) rendered "with its space named", and (b) a **SET-NULL-target** row (identityId null after a GC/degrade) rendered as a valid row, never broken. Assert both render.
- [ ] **1.5** FK test — fix the mislabeled `face-person-verdict.repository.spec.ts:638-661` (title/comment say CASCADE) to assert **SET NULL** explicitly: delete the identity, assert the verdict row SURVIVES with `identityId = null` (post-Slice-1 semantics: orphan-and-degrade, not delete). This is the vacuous-pass test the review flagged.
- [ ] **1.6** e2e `.serial` decoupling — in `e2e/src/specs/web/face-cleanup.e2e-spec.ts`, scope the keep-here `toHaveCount(0)` assertion to the row IT created (filter by the person name) so test order stops mattering; keep `.serial` (shared DB) but remove the order-coupling.

---

## Task 2: Hygiene (D16) — implementer subagent

- [ ] **2.1** Fix the two stale test titles `face-repair.resolve.spec.ts:1264` ("face_repair_lock") and `:1036` ("face_repair_decline") — retitle to what they actually assert (`face_identity_face` manual link / `face_person_verdict`).
- [ ] **2.2** Controller summary `face-repair-admin.controller.ts:132` — "List face-repair resolutions (declines + locks)" → "…negative verdicts from both engines".
- [ ] **2.3** The four `mark*` methods' `@GenerateSql` param objects (verdict repo) — fix the malformed param objects so the generated SQL docs are correct.
- [ ] **2.4** Delete the **19 orphaned `admin.face_cleanup_*` keys** from `i18n/de.json` + `i18n/fr.json` (absent from `en.json`, unreferenced). **Grep `web/src` AND `mobile/lib` FIRST** to confirm each is truly unreferenced (an earlier check found `face_cleanup_review_move` was a substring false-positive of `review_moves_*`). Do NOT delete any key still referenced.
- [ ] **2.5** Delete the dead private `findOrCreateSpacePersonForFace` in `shared-space.service.ts` (pre-existing, unused — flagged in Slices 2/3 reviews; only forwards to `findOrCreateCompatibleSpacePersonForIdentity`). Confirm zero callers first.
- [ ] **2.6** (optional) Add a non-admin-403 controller assertion for the new admin thumbnail route (else it's only e2e-covered).

---

## Task 3: Parent-doc corrections — controller

- [ ] Append a "## 2026-07-23 corrections" note to `docs/superpowers/specs/2026-07-22-face-review-unification-design.md`: (a) §4.2's `face_repair_cluster_mute` rename is UNSHIPPED (`face_repair_decline` kept its name); (b) §4.4's migration list OMITS `1784...FixFaceRepairScanInFlightIndexOverride` — the "ten → five" reduction should yield SIX; (c) coverage-matrix rows 34/35/37 claim tests for the two DEFERRED follow-ups (un-confirm-skipped-section, undo-my-reject) that were never written — mark deferred-not-covered; (d) the merge-safety claim (§3.2 "survives merges for free" + the `person.repository.ts` comment) was FALSE (identityId was CASCADE) — corrected by this remediation's Slice 1.

---

## Task 4: Regenerate derived artifacts — controller (needs DB + Java)

- [ ] **4.1** `cd server && pnpm build` — build first (the regen reads `dist`).
- [ ] **4.2** `mise open-api` (from repo root; `mise //:open-api` elsewhere) — regenerates the OpenAPI spec + TS SDK (`@immich/sdk`) + Dart client (`mobile/openapi`) in one task; picks up the new `GET /admin/face-repair/faces/:assetFaceId/thumbnail` route (Slice 7) + any DTO changes. This is the EXACT command CI's `generated-api-up-to-date` job runs (`test.yml:672`). NOTE: `make open-api` and `pnpm sync:open-api` are REMOVED (they error out). `mise <task>` rewrites `mise.lock` in place — capture its shasum before and `git checkout HEAD -- mise.lock` after if it churned (don't commit lock noise). Java 21 is present for the Dart generator.
- [ ] **4.3** `mise sql` (with `DB_URL` to a MIGRATED throwaway DB, clean `dist`) — regenerate SQL query docs for the new `@GenerateSql` methods (`isFaceReachableInSpace` from Slice 2, `getFaceByIdIncludingTombstoned` from Slice 7, the fixed `mark*` params from 2.3). NEVER without a DB.
- [ ] **4.4** `cd docs && pnpm format` — prettier the docs (specs/plans).
- [ ] Commit the regenerated artifacts separately (`chore: regenerate openapi clients + sql docs for the verdict-layer changes`).

---

## Task 5: Full local gate + deferred e2e — controller

- [ ] **5.1** Server: `cd server && pnpm test` (unit) + `pnpm test:medium` (full — with the e2e test-assets present, or accept the known environmental exif/ffprobe failures and rely on CI for those; the face-verdict specs must be green). `pnpm check` + `pnpm lint`.
- [ ] **5.2** Web: `cd web && pnpm test` + `pnpm check:typescript` + `pnpm check:svelte` (CI-authoritative) + `pnpm lint`.
- [ ] **5.3** Deferred e2e — bring up the **:2285 e2e stack** (machine-wide singleton — check it's free) and RUN the deferred Slice 6 (`person-face-suggestions` member-403) + Slice 7 (`face-cleanup` second-user image-load, incl. the `waitForQueueFinish` added in review) e2e specs. If the stack can't be brought up locally, note them for the CI e2e jobs.

---

## Task 6: Dispatch full CI + babysit — controller

- [ ] **6.1** Push all Slice-10 commits.
- [ ] **6.2** Dispatch the full gating CI set per the `ci-full-set-dispatch` memory: `gh workflow run <wf> --ref feat/face-review-unified` (account `Deeds67`) for each gating workflow (test.yml incl. `generated-api-up-to-date` / "OpenAPI Clients", server/web/e2e, docs build, Revert-to-Immich Validation). Feature-branch pushes trigger NO CI, so this manual dispatch is required.
- [ ] **6.3** Babysit to green (invoke the `babysit` skill / `babysit-codex`): read JOB-level results (run-level "success" can hide a failed job). Known flakes: `mise install` GitHub 403 (re-dispatch), Revert-to-Immich Docker Hub `toomanyrequests` (re-run). Fix any real failures at root cause; do not accept "retry if flaky" for non-documented flakes.

---

## Task 7: PR #834 description update — controller

- [ ] Update the PR #834 description with a "## Review remediation (2026-07-23)" section: the D1–D17 → slice mapping, the R1 product decision (people-merges preserve prior source, signed off), the migration-1787-edited-in-place / RC-DBs-reset deploy note, and correct the parent's "leaks 1–5 proven" claim to point at the new cross-flow scenarios (Slice 3) + the merge-durability/manual-durability/exclusion suites.

---

## Coverage map (D15/D16 → step)

| Finding                                                                       | Step    |
| ----------------------------------------------------------------------------- | ------- |
| cross-flow `.catch` removed                                                   | 1.1     |
| band boundaries                                                               | 1.2     |
| keep-here identity asserted                                                   | 1.3     |
| resolutions space-person + SET-NULL fixtures                                  | 1.4     |
| FK label test → SET NULL                                                      | 1.5     |
| serial coupling                                                               | 1.6     |
| stale titles / controller summary / @GenerateSql / i18n orphans / dead method | 2.1–2.5 |
| parent-doc corrections                                                        | 3       |
| regen (openapi/dart/sql/docs)                                                 | 4       |
| full gate + deferred e2e + CI + babysit                                       | 5, 6    |

## Self-review (author)

- **Coverage:** every D15 sub-item (1.1–1.6) + every D16 sub-item (2.1–2.5) + the parent-doc corrections + the regen the earlier slices deferred + the deferred e2e runs + the CI dispatch/babysit + the PR update each have a step. ✅
- **Placeholder scan:** steps name exact files/lines and the exact commands; the regen commands carry the DB/Java prerequisites and the `mise sql` no-DB warning. ✅
- **Scope:** no behaviour changes beyond deleting genuinely-dead code (2.5) and fixing tests/docs/generated artifacts. ✅
- **Ops caution:** `mise sql` no-DB footgun, feature-branch-no-CI dispatch, i18n-shared grep, job-level CI reading — all flagged.
