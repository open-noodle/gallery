# Face Review Unification — Review Remediation: Implementation Slices

- **Status:** Ready to implement (via `/impl-loop`).
- **Date:** 2026-07-30
- **Fixes findings from:** the PR #834 full review (2026-07-30, five-dimension review of
  `feat/face-review-unified` @ `2ea099dea67`, every finding re-verified inline against the code)
- **Base spec:**
  [`2026-07-22-face-review-unification-design.md`](2026-07-22-face-review-unification-design.md)
  and [`2026-07-23-face-verdict-layer-remediation-design.md`](2026-07-23-face-verdict-layer-remediation-design.md)
- **Branch:** `feat/face-review-unified` (these slices land on the PR branch before merge)

## 1. Context — what the review found

The unification design is sound: the `pending` / `rejected` / `ignored` model, the identity-first
cross-scope read, the `ON CONFLICT … WHERE status='pending'` never-resurrect guarantee,
`preserveManualSource`, and the merge re-key ordering all hold up under tracing. The defects are in
the seams:

- **two paths silently destroy a human decision** (a space confirm, and a negative verdict crossing
  a person merge);
- **the two scopes are gated asymmetrically** — every gate the space path added (reachability,
  feature toggle) is missing on the personal path, and every gate the personal path applies on read
  is missing on the write path;
- **Locked-folder assets flow into both engines** — neither the cleanup scan feed nor the
  owner-scoped `searchFaces` branch filters `asset.visibility`;
- **the tests that name the headline guarantees cannot fail.**

### Finding → slice traceability

| #   | Finding (severity)                                                                                              | Slice |
| --- | --------------------------------------------------------------------------------------------------------------- | ----- |
| F1  | Locked-folder faces reach the cleanup console and its crops are served by the admin thumbnail route (high)      | 1     |
| F2  | Owner branch of `searchFaces` has no visibility gate → pending rows written for Locked/Hidden assets (medium)   | 1     |
| F3  | `isFaceReachableInSpace` applies no visibility / trash / face-state gate (medium)                               | 1     |
| F4  | Seven `is admin-only` controller tests, and six other specs, cannot fail (high — undermines every slice)        | 2     |
| F5  | `claimPending` is a bare delete: confirm applies none of the read path's gates (medium)                         | 3     |
| F6  | `hasPendingForSpacePerson` omits the manual-link and negative-verdict anti-joins its read twin applies (medium) | 3     |
| F7  | `confirmFaceSuggestion` has no feature-toggle check; the space twin has one (low)                               | 3     |
| F8  | Personal `reject`/`ignore`/`dismiss` perform no authorization on `assetFaceId` (high)                           | 4     |
| F9  | A space suggestion confirm is reverted by the next facial-recognition pass (critical)                           | 5     |
| F10 | The space confirm is four autocommit writes; a torn write settles a face onto nobody, unrepairably (high)       | 5     |
| F11 | A person merge deletes a `rejected` verdict in favour of the survivor's `pending` row (critical)                | 6     |
| F12 | `stay` bucket's negative write + drain is not transactional; the comment claims it is (medium)                  | 7     |
| F13 | Duplicate ids in the `lock` bucket raise Postgres `21000` after earlier buckets committed (medium)              | 7     |
| F14 | `findOverlappingIds` cannot see a face routed to two `moveToPerson` destinations (low)                          | 7     |
| F15 | A negative verdict is never cleared when a human later places that face on that target (medium)                 | 8     |
| F16 | No GC; "reset all people" leaves every verdict orphaned and unreachable forever (medium)                        | 8     |
| F17 | Suggestion fan-out queues a scan for every named person of an owner with one unassigned face (high)             | 9     |
| F18 | Per-person suggestion scan jobs have no `jobId` → no dedup (medium)                                             | 9     |
| F19 | Forced recognition blocks on `PeopleBackfill` with no timeout (medium)                                          | 9     |
| F20 | Four UUID arrays have no size cap, each landing in an unchunked `IN` (high)                                     | 10    |
| F21 | Advertised `x-immich-permission` ≠ enforced permission on two suggestion endpoints (medium)                     | 10    |
| F22 | Stacked `@GenerateSql` decorators emit an invalid SQL doc and drop another method's coverage (medium)           | 10    |
| F23 | `listNegativeVerdicts` is an unpaginated whole-table read, fully rendered client-side (medium)                  | 10    |
| F24 | The review modal treats every 400 as "already resolved" and swallows real failures (high)                       | 11    |
| F25 | "Move entire cluster" confirm can understate its blast radius by orders of magnitude (high)                     | 11    |
| F26 | Bulk "Approve N clusters": no confirmation, partial success reported as total failure (medium)                  | 11    |
| F27 | Scan page keeps polling after `onDestroy`; people grid wiped by a load-more failure (low)                       | 11    |
| F28 | Suggestion banner is not `isEditor`-gated though the gate exists in the same file (medium, latent)              | 12    |
| F29 | The two confirm overlays are hand-rolled `fixed inset-0` divs with no dialog semantics (medium)                 | 12    |
| F30 | Resolutions: empty state lies under a filter; a deleted target is indistinguishable from an unnamed one (low)   | 12    |
| F31 | i18n: 9 orphaned keys incl. an unwired success toast; 17 count keys with no ICU plural; stale de/fr keys (low)  | 12    |
| F32 | Snooze is keyed on a different id per route; ML settings effect silently rewrites the admin's value (low)       | 12    |
| F33 | Migration `1787` was edited in place after RC deployment: RC DBs keep `ON DELETE CASCADE` (high, ops)           | 13    |
| F34 | `revert-to-immich.sql` abort guards do not cover the face-repair tables or the renamed migration names (low)    | 13    |
| F35 | The `suggestions.maxDistance > maxDistance` invariant is not enforced on the config-file path (medium)          | 13    |

**Deliberately not fixed** (recorded as locked decisions in §4, each gets a pin test):

- Facial recognition ignores negative verdicts (documented product behaviour in
  `docs/docs/features/facial-recognition.md`).
- `ignored` and `rejected` have identical downstream effect.
- Admin surfaces intentionally cross owner boundaries.

## 2. Method

Every slice is **TDD**: write the failing test first, run it and confirm it fails **for the stated
reason**, write the minimum code to pass, re-run to green, then refactor. A test that passes on its
first run is a red flag — the test is wrong, not the code.

**Exception protocol for pin tests** (tests that deliberately pin existing behaviour — marked
"pin" below): they are allowed to pass first-run, but only after you mutate the pinned behaviour,
watch the test go red, and revert. A pin that cannot go red pins nothing.

**Positive-control protocol** (this codebase's specific failure mode — see Slice 2). Any test whose
assertion is an **absence** (`expect(x).toBe(false)`, `not.toContain`, `toHaveLength(0)`) MUST, in
the same test body, first assert the **presence** of the thing under a control condition. An
absence assertion with no control passes vacuously the moment a fixture drifts. This applies to
every new test in every slice.

Where behaviour is user-visible (a reviewer confirming a face, an admin resolving a cluster, a
viewer opening a shared person), tests are expressed as **BDD scenarios** (Given / When / Then) and
implemented at the highest layer that can observe them — medium tests with a real DB for server
behaviour, component specs for web, e2e for the cross-engine and RBAC boundaries.

Each slice ends with: its own tests green, the previously-green suite still green, a commit, and a
push. Each slice leaves the server bootable and both features working.

## 3. Global invariants (apply to every slice)

- **Server imports use the `src/` alias** — no relative imports (eslint enforces).
- **Migrations:** fork migrations live in `server/src/schema/migrations-gallery/` with a round
  timestamp. **Never amend `1787000000000-AddFacePersonVerdict.ts` again** — it has already been
  edited in place once and that is the subject of Slice 13. Every schema change in these slices goes
  in a **new** migration file.
- **Never run `make sql` / `mise //:sql` without a running database** — it deletes all query files.
  After changing a `@GenerateSql`-decorated repository method, regenerate the SQL docs (`mise //:sql`
  with the dev DB up) so `server/src/queries/*.sql` stays in sync; CI checks it.
- **`pnpm test -- --run <path>` silently drops the path filter.** Run unit tests as
  `pnpm exec vitest --config test/vitest.config.mjs --run <path>` and medium tests as
  `pnpm exec vitest --config test/vitest.config.medium.mjs --run <path>`, both from `server/`.
- **Kysely:** never run a `this.db` query inside a `this.db.transaction()` callback — thread the
  `trx` through the repository method's `db` parameter (pool deadlock, issue #595).
- **New repository:** registering one requires **three** sites — `src/repositories/index.ts`, the
  `BaseService` constructor's positional list, and `test/medium.factory.ts`. A miss surfaces as
  "Unable to create repository instance" only in medium tests.
- **eslint green ≠ prettier green** — separate CI gates. One full lint/format pass happens in
  Slice 14; do not run slow full-package eslint per slice.
- **`web` gate**, run from `web/`: `pnpm check:typescript`, `pnpm check:svelte`, `pnpm lint`. Note
  `check:svelte` has been observed scanning zero files locally while working in CI — treat it as a
  push-only gate and do not conclude "green" from a local zero-file run.
- **i18n:** only `i18n/en.json` gets new keys. `i18n/` is shared with the Flutter app — grep both
  `web/` and `mobile/` before renaming or removing a key.
- **This document and everything under `docs/` must be prettier-formatted** before commit — CI Docs
  Build is strict and reaches `docs/superpowers/`.
- Do not add `Co-Authored-By` or "Generated with" trailers to commits.
- Commit and PR prose stays mechanical: describe the behaviour change, not severity framing.

## 4. Decisions (locked)

| Decision                                | Choice                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Locked / Hidden asset policy            | **Neither face-review engine ever surfaces a face on an asset whose `visibility` is not `archive` or `timeline`.** Reuses the existing `spaceVisibleAssetVisibilities` constant so there is one definition instance-wide. This covers the suggestion scan, the suggestion read, the cleanup scan, the cleanup console's cluster/rest lists, the reachability gate, and the admin thumbnail route |
| Locked policy scope                     | **Scoped to the two review engines only.** Facial recognition itself (`handleRecognizeFaces`, `handleQueueRecognizeFaces`) keeps clustering Locked-folder faces exactly as today — changing that is an upstream-behaviour change well outside this PR. Enforced by pin tests in Slice 1                                                                                                          |
| `searchFaces` mechanism                 | New optional `visibility?: AssetVisibility[]` option, **defaulting to no filter** (today's behaviour). Only the two suggestion scans and the cleanup scan pass it. This keeps the recognition and space-face-match callers byte-identical                                                                                                                                                        |
| Space-confirm durability mechanism      | **Recognition never claims a face a human has already placed.** The non-forced recognition feed excludes faces carrying a `face_identity_face` row with `source='manual'`. Chosen over writing `asset_face.personId` from a space confirm (which would be a cross-owner write into the asset owner's personal people)                                                                            |
| Merge verdict precedence                | **Strength wins, not side.** `rejected`/`ignored` outrank `pending`. When the survivor holds `pending` and the source holds a negative, the survivor row is **promoted** to the source's status/source/actor and the source row is then dropped. Negative-vs-negative keeps the survivor (today's behaviour)                                                                                     |
| Reject/ignore face authorization        | `Permission.PersonCreate` on the `assetFaceId` — the identical gate `confirmFaceSuggestion` already applies. Consequence (accepted): rejecting a suggestion whose asset has since been trashed now 400s instead of writing a row nothing can read                                                                                                                                                |
| Verdict clearing                        | A human placing face F on target T **deletes** any `rejected`/`ignored` row for `(T, F)` — the two facts are contradictory and the newer one wins. Verdicts against **other** targets are untouched                                                                                                                                                                                              |
| Verdict GC                              | A row with `personId`, `spacePersonId` **and** `identityId` all NULL is unreachable by every read predicate; it is collected by the existing `PersonCleanup` job. Rows retaining any target are kept                                                                                                                                                                                             |
| Recognition vs negative verdicts        | **Unchanged, by design.** A dismissed suggestion never blocks normal recognition (`docs/docs/features/facial-recognition.md`). Pinned by a test so the decision is explicit rather than accidental                                                                                                                                                                                               |
| `ignored` vs `rejected`                 | **Unchanged.** Both are durable negatives with identical downstream effect. Slice 12 fixes the UI copy so the label stops implying a weaker action; the data model stays as-is                                                                                                                                                                                                                   |
| RC databases                            | The documented remedy stays "reset, do not upgrade in place". Slice 13 adds an **idempotent reconciliation migration** for the one silent-data-loss case (the `identityId` FK) so an instance that was upgraded anyway is repaired rather than quietly broken                                                                                                                                    |
| `getFaceRepairScanDefaults` return type | Out of scope. The `Promise<T \| null>` return that defeats the OpenAPI extractor is pre-existing on this branch and its fix is a spec/SDK regeneration with no behaviour change — track separately                                                                                                                                                                                               |

The canonical predicate, defined once and reused everywhere in Slice 1:

```ts
// server/src/utils/face-review.ts
import { Expression, ExpressionBuilder, ReferenceExpression, SqlBool } from 'kysely';
import { DB } from 'src/schema';
import { spaceVisibleAssetVisibilities } from 'src/utils/shared-space-album-scope';

/**
 * A face is REVIEWABLE if a human may be shown its crop by either face-review engine.
 * Locked-folder and Hidden assets are excluded: the Locked folder is designed to require the
 * OWNER's elevated re-authentication, and neither the suggestion queue nor the admin cleanup
 * console re-authenticates. Face detection already skips `hidden`, so `locked` is the live gap —
 * but both are excluded so the predicate states the whole rule.
 *
 * Deliberately NOT applied to facial recognition itself: recognition clustering Locked faces into
 * the owner's own people is upstream behaviour and is out of scope here (see spec §4).
 */
export const reviewableAssetVisibility = (
  eb: ExpressionBuilder<DB, keyof DB>,
  column: ReferenceExpression<DB, keyof DB> = 'asset.visibility',
): Expression<SqlBool> => eb(column, 'in', spaceVisibleAssetVisibilities);
```

---

# Slice 1 — Locked and non-visible assets are excluded from both engines (F1, F2, F3)

**Goal:** no face on an asset whose `visibility` is `locked` or `hidden` is ever scanned, queued,
listed, counted, or rendered by the face-suggestion engine or the face-cleanup console — and the
admin face-thumbnail route refuses to serve its crop. Facial recognition is provably unchanged.

**Files**

- `server/src/utils/face-review.ts` (new — the canonical predicate above)
- `server/src/repositories/search.repository.ts` (`searchFaces` — new `visibility` option)
- `server/src/repositories/face-repair.repository.ts` (`streamEligibleFaces`,
  `getEligibleFacePage`, `countEligibleFaces`, `getClusterFacePage`, `getEligibleFaceIdsForPerson`
  — **not** `countAllFaces`, which deliberately stays unfiltered, see Implementation step 5)
- `server/src/repositories/face-person-verdict.repository.ts` (`isFaceReachableInSpace`)
- `server/src/repositories/person.repository.ts` (`getFaceByIdIncludingTombstoned` — see below)
- `server/src/services/person.service.ts` (both suggestion scans pass `visibility`)
- `server/src/services/face-repair.service.ts` (cleanup KNN pass; `getAdminFaceThumbnail`)
- `server/src/queries/search.repository.sql`, `face.repair.repository.sql`,
  `face.person.verdict.repository.sql` (regenerate)
- Tests: `server/test/medium/specs/repositories/search.repository.spec.ts`,
  `face-repair.repository.spec.ts`, `face-person-verdict.repository.spec.ts`,
  `server/test/medium/specs/services/face-repair.scan.spec.ts`,
  `server/test/medium/specs/services/face-suggestion-exclusions.spec.ts`,
  `server/src/services/face-repair.service.spec.ts`

**Implementation**

1. Add `server/src/utils/face-review.ts` with `reviewableAssetVisibility`.
2. `searchFaces` gains `visibility?: AssetVisibility[]` on `FaceEmbeddingSearch`. Apply as
   `.$if(!!visibility?.length, (qb) => qb.where('asset.visibility', 'in', visibility!))` inside the
   CTE, **after** the existing `asset.deletedAt` filter. Default undefined ⇒ no predicate ⇒ the
   recognition and space-face-match callers emit byte-identical SQL.
3. `handlePersonSuggestionScan` (`person.service.ts:909`) and `handleSpacePersonSuggestionScan`
   (`:994`) pass `visibility: spaceVisibleAssetVisibilities`. The space branch already applies
   `spaceVisibilityGate`; passing the option there is redundant but harmless and keeps the two call
   sites symmetric — pass it in both.
4. `face-repair.service.ts:378` (the cleanup scan's KNN pass) passes the same.
5. **Five** `face-repair.repository.ts` feed methods gain `.where((eb) => reviewableAssetVisibility(eb))`:
   `streamEligibleFaces`, `getEligibleFacePage`, `countEligibleFaces`, `getClusterFacePage`, and
   `getEligibleFaceIdsForPerson`. `countEligibleFaces` must change too or the console's totals
   disagree with its lists. **`countAllFaces` must NOT get the predicate** — it deliberately joins
   no `asset` and counts **all** remaining faces of a person, any source type, visible or hidden, as
   the delete gate for an emptied manual-move source (invariant A2). Narrowing it would let a person
   be deleted while Locked-asset faces still point at it, and `asset_face.personId`'s
   `ON DELETE SET NULL` would orphan them — the exact bug the method's comment says it exists to
   prevent.
6. `isFaceReachableInSpace` gains the full sibling gate — `spaceVisibilityGate`,
   `asset.deletedAt is null`, `asset.isOffline = false`, `asset_face.deletedAt is null`,
   `asset_face.isVisible = true` — matching `getPendingForSpacePerson`.
7. `getAdminFaceThumbnail` (`face-repair.service.ts:1210`) needs **no service-level change**. Its
   sole production caller already wraps it in `try { … } catch { throw new NotFoundException() }`.
   The refusal moves into the repository query instead: `getFaceByIdIncludingTombstoned`
   (`person.repository.ts:459-467`) gains an inner join on `asset` and
   `.where((eb) => reviewableAssetVisibility(eb))`, keeping the select list and `AssetFace` return
   type unchanged. `executeTakeFirstOrThrow` then throws for a non-reviewable face, and the
   service's existing catch turns that into a 404 — not a service-level `BadRequestException`. This
   also avoids disclosing that the face exists. Keep the tombstone (`asset_face.deletedAt`)
   inclusion — that is deliberate and tested.

**Tests (write first)**

| #     | Layer                                | Test                                                                                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1.1  | medium                               | `searchFaces({ userIds, visibility: [archive, timeline] })` omits a face on a `locked` asset and **returns a control face on a `timeline` asset in the same call** (positive control)                                                                                                                                                                        |
| S1.2  | medium                               | `searchFaces({ userIds })` **without** the option still returns the `locked` face — pin: recognition is unchanged                                                                                                                                                                                                                                            |
| S1.3  | medium                               | `searchFaces({ spaceId, visibility })` omits a `locked` asset (the space branch already gated it — pin)                                                                                                                                                                                                                                                      |
| S1.4  | medium                               | BDD: **Given** an owner with a named person and one unassigned near-miss face on a **Locked** asset and one on a Timeline asset, **When** `handlePersonSuggestionScan` runs, **Then** exactly one pending row exists, for the Timeline face                                                                                                                  |
| S1.5  | medium                               | Same BDD for `handleSpacePersonSuggestionScan`                                                                                                                                                                                                                                                                                                               |
| S1.6  | medium                               | `streamEligibleFaces` skips a Locked-asset face and yields a control Timeline face                                                                                                                                                                                                                                                                           |
| S1.7  | medium                               | `getEligibleFacePage` and `countEligibleFaces` agree: a person with 1 Timeline + 1 Locked face reports `1` from both. `countAllFaces` reports `2` — asserted explicitly, the guard against re-introducing the A2 orphan bug                                                                                                                                  |
| S1.8  | medium                               | `getClusterFacePage` omits the Locked face from the "rest of cluster" list and from its `total`                                                                                                                                                                                                                                                              |
| S1.9  | medium                               | `getEligibleFaceIdsForPerson` omits a Locked face id — so a `lock` bucket naming it is refused rather than silently manual-linking a Locked crop                                                                                                                                                                                                             |
| S1.10 | medium                               | BDD: **Given** a cluster contaminated with one Locked-asset face and one Timeline face, **When** the cleanup scan runs, **Then** only the Timeline face is flagged (control asserts the Timeline face **is** flagged)                                                                                                                                        |
| S1.11 | medium                               | `isFaceReachableInSpace` returns `false` for a Locked asset, a trashed asset, an offline asset, a soft-deleted face and an invisible face — and `true` for a reachable control face in the same test                                                                                                                                                         |
| S1.12 | medium (repository) + unit (service) | `getFaceByIdIncludingTombstoned` throws for a face on a Locked asset (the query itself, at the repository); the service's existing catch converts that into a `NotFoundException` — not a service-level `BadRequestException`; returns the file for a Timeline asset; **and still returns it for a tombstoned (`deletedAt`) face on a Timeline asset** (pin) |
| S1.13 | medium                               | pin: `getPendingForPerson` and `getPendingForSpacePerson` already exclude Locked — assert both, with a Timeline control row present in the same call                                                                                                                                                                                                         |
| S1.14 | medium                               | pin: `handleRecognizeFaces` still assigns a Locked-asset face to a person (recognition explicitly unchanged, spec §4)                                                                                                                                                                                                                                        |

**Verify**

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/search.repository.spec.ts \
  test/medium/specs/repositories/face-repair.repository.spec.ts \
  test/medium/specs/repositories/face-person-verdict.repository.spec.ts \
  test/medium/specs/services/face-repair.scan.spec.ts \
  test/medium/specs/services/face-suggestion-exclusions.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/face-repair.service.spec.ts
```

Then, with the dev DB up: `mise //:sql` and commit the regenerated `server/src/queries/*.sql`.

**Commit:** `fix(face-review): exclude locked and hidden assets from both face-review engines`

---

# Slice 2 — Make the existing suite able to fail (F4)

**Goal:** every test that names a guarantee actually fails when that guarantee breaks. This slice
lands **before** the behavioural slices so their regressions are genuinely caught.

This is the one slice whose "red" step is inverted: for each item, first **mutate the production
code** the test claims to cover, confirm the test still passes (proving it is vacuous), then repair
the test, confirm it now fails, then revert the mutation and confirm green.

**Files**

- `server/src/controllers/face-repair-admin.controller.spec.ts`
- `server/test/medium/specs/services/face-review-cross-flow.spec.ts`
- `server/test/medium/specs/repositories/face-verdict-safety.spec.ts`
- `server/test/medium/specs/services/face-verdict.merge-durability.spec.ts`
- `web/src/routes/admin/face-cleanup/resolutions/page.spec.ts`
- `web/src/lib/modals/PersonSuggestionReviewModal.svelte` + `.spec.ts`
- `e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts`

**Implementation**

| Item | Current defect                                                                                                                                                                                      | Repair                                                                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | 7× `it('is admin-only')` do `ctx.authenticate.mockRejectedValue(new ForbiddenException(…))` then assert 403. The mock always rejects, so removing `admin: true` from all 17 routes keeps them green | Replace with the pattern `person.controller.spec.ts:290` already uses: assert `ctx.authenticate` was called with `expect.objectContaining({ metadata: expect.objectContaining({ admin: true }) })`. Apply to **all 17** routes, not just the 7 |
| B    | `face-review-cross-flow.spec.ts:296-306` calls `reassignFacesById` first, so `confirmFaceSuggestion` short-circuits at `claimed === 0` and writes nothing                                           | Drive the real path: seed a **pending** row (via the scan or `upsertPending`), assert it exists, call `confirmFaceSuggestion` only, then assert the manual link, the drained row, and the absent flag                                          |
| C    | `face-review-cross-flow.spec.ts:451,458,542,548` — the cross-scope "defect 5" assertions are absence-only; `JobStatus.Success` is returned with zero candidates                                     | Add a positive control face in each test that IS proposed by the same scan call, asserted present, alongside the rejected face asserted absent                                                                                                 |
| D    | `face-verdict.merge-durability.spec.ts:211` is named "regardless of which side is pending vs rejected" but only covers source=pending / survivor=rejected                                           | Split into two tests, one per order. The source=rejected / survivor=pending test is the **red test for Slice 6** — it is expected to fail here and is marked `.fails()` is NOT acceptable; leave it red and land it in Slice 6                 |
| E    | `resolutions/page.spec.ts` mocks `svelte-i18n` as `run((key) => key)`, discarding `values`, so every attribution assertion is a constant string                                                     | Render against real `en.json` (the pattern `PersonPicker.spec.ts` and both `*ActionsHelpModal.spec.ts` already use), or add a `translations` sink like `ReviewFirstLane.spec.ts:225`. Assert the actual person, space and actor names          |
| F    | `PersonSuggestionReviewModal.svelte:308` and `:313` both emit `data-testid="suggestion-highlight"`; happy-dom never fires `img.onload`, so the spec always matches the hidden `{:else}` div         | Give the placeholder a distinct testid (`suggestion-highlight-placeholder`). Add a test that dispatches `load` on the `suggestion-full-photo` img and then asserts the real overlay's computed geometry                                        |
| G    | `face-verdict-safety.spec.ts:117-120` asserts `resolves.toBeUndefined()` on a `Promise<void>` — and globally unassigns every ML face in the shared medium DB                                        | Seed a face of a **different** `sourceType`, call `unassignFaces({ sourceType: ML })`, assert that face is untouched and the ML face is unassigned. Scope the fixture so it cannot affect sibling specs                                        |
| H    | `person-face-suggestions.e2e-spec.ts:272-285` asserts confirm only by HTTP 200; `:170-181`, `:199-203` loop over a possibly-empty body; `:242-250` has no retained-item control                     | Assert post-conditions: the face left the queue, and a subsequent GET still contains the two control faces. Add `expect(body.items.length).toBeGreaterThan(0)` before every loop                                                               |

Item D deliberately leaves one test red at the end of this slice. Record it in the commit message
and in the Slice 6 plan; do **not** skip or delete it.

**Tests**

The deliverable _is_ tests. Evidence required per item: the mutation applied, the pre-repair run
showing green (vacuous), the post-repair run showing red, and the post-revert run showing green.

**Verify**

```bash
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/controllers/face-repair-admin.controller.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-review-cross-flow.spec.ts test/medium/specs/repositories/face-verdict-safety.spec.ts
cd web && pnpm exec vitest --run src/routes/admin/face-cleanup/resolutions/page.spec.ts src/lib/modals/PersonSuggestionReviewModal.spec.ts
```

**Commit:** `test(face-review): replace assertions that cannot fail with discriminating ones`

---

# Slice 3 — Confirm applies the same gates as the read (F5, F6, F7)

**Goal:** a face that the queue will not show cannot be confirmed through it. The write path and the
read path share one definition of "eligible".

**Files**

- `server/src/repositories/face-person-verdict.repository.ts` (`claimPending`,
  `claimPendingForSpacePerson`, `hasPendingForSpacePerson`)
- `server/src/services/person.service.ts` (`confirmFaceSuggestion` feature gate)
- `server/src/queries/face.person.verdict.repository.sql`
- Tests: `server/test/medium/specs/repositories/face-person-verdict.repository.spec.ts`,
  `server/src/services/person.service.spec.ts`,
  `server/test/medium/specs/services/shared-space-face-suggestions.service.spec.ts`

**Implementation**

1. Extract the shared eligibility predicate from `getPendingForPerson` into a private helper on the
   repository (`#applyPendingEligibility(qb)`): the band, `af.personId is null`, `af.deletedAt`,
   `af.isVisible`, `asset.deletedAt`, `asset.isOffline`, `reviewableAssetVisibility`, the
   manual-link anti-join and the negative-verdict anti-join. Use it in `getPendingForPerson`,
   `getPendingForSpacePerson`, **and** `hasPendingForSpacePerson`.
2. `claimPending` / `claimPendingForSpacePerson` become `DELETE … WHERE id IN (SELECT … )` with the
   same eligibility subquery plus the band, so a claim on an ineligible row returns 0 and the
   caller's existing `claimed === 0` idempotent path handles it.
   Both must keep their `db` parameter so the personal path can thread its `trx` — do not introduce
   a `this.db` read inside the transaction.
3. `confirmFaceSuggestion` gains the `isFaceSuggestionEnabled` short-circuit the space twin already
   has (`shared-space.service.ts:1317-1319`), placed before the access checks so it is a cheap
   no-op.

**Tests (write first)**

| #     | Layer  | Test                                                                                                                                                                                                 |
| ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3.1  | medium | `claimPending` returns 0 and leaves the row intact for a pending row whose asset became `locked` after the row was written; returns 1 for an eligible control row in the same test                   |
| S3.2  | medium | Same for: trashed asset, offline asset, `visibility='hidden'`, `af.deletedAt` set, `af.isVisible=false`, `af.personId` already set                                                                   |
| S3.3  | medium | `claimPending` returns 0 when the face has acquired a `source='manual'` link for another identity (the read's D3 self-heal is now enforced on write)                                                 |
| S3.4  | medium | `claimPending` returns 0 when a negative verdict for the same target exists (identity-keyed **and** personId-keyed, two tests)                                                                       |
| S3.5  | medium | `claimPending` returns 0 when the row's distance falls outside the current band                                                                                                                      |
| S3.6  | medium | `claimPendingForSpacePerson` mirrors S3.1–S3.5                                                                                                                                                       |
| S3.7  | medium | `hasPendingForSpacePerson` returns `false` for a face carrying a manual link, and for one carrying a negative verdict for that space person's identity; `true` for the control                       |
| S3.8  | medium | BDD: **Given** a pending suggestion, **When** the owner moves the asset to the Locked folder and then confirms, **Then** the confirm is a no-op — no reassignment, no manual link, row still pending |
| S3.9  | unit   | `confirmFaceSuggestion` returns without calling `requireAccess` or any repository when `suggestions.enabled` is false                                                                                |
| S3.10 | medium | pin: the happy path still works end to end — an eligible pending row confirms, reassigns, drains and manual-links                                                                                    |
| S3.11 | medium | `claimPending` inside a transaction uses the passed `trx` — assert by rolling the transaction back and observing the row still present                                                               |

**Verify**

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/face-person-verdict.repository.spec.ts \
  test/medium/specs/services/shared-space-face-suggestions.service.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/person.service.spec.ts
```

**Commit:** `fix(face-suggestions): gate confirm on the same eligibility the queue read applies`

---

# Slice 4 — Face-level authorization on personal reject / ignore / dismiss (F8)

**Goal:** a user cannot write a verdict row about a face they have no rights over. The personal path
gets the gate the space path already has and the confirm path already applies.

**Background the implementer needs:** `face_identity.id` is a **cross-owner** key —
`identity-merge-propagation.service.ts:360-370` assigns one identity to personal people belonging to
different owners. `verdictOpts` (`person.service.ts:480`) stamps that identity onto every reject.
`getPendingForPerson`'s anti-join (`face-person-verdict.repository.ts:455-470`) matches on
`identityId` with no ownership filter. Valid `assetFaceId`s of other owners' assets are enumerable
by any space **viewer** via `GET /shared-spaces/:id/people/:personId/faces`.

**Files**

- `server/src/services/person.service.ts` (`rejectFaceSuggestion`, `ignoreFaceSuggestion`)
- `server/src/services/person.service.spec.ts`
- `server/test/medium/specs/services/face-suggestion-exclusions.spec.ts`
- `e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts`

**Implementation**

Add `await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [assetFaceId] })`
to both methods, immediately after the existing `PersonUpdate` check on the person — the identical
pair `confirmFaceSuggestion` uses at `:428-430`. `dismissFaceSuggestion` inherits it via its
delegation to `rejectFaceSuggestion`.

Replace the stale justification comment at `:489-494`. It currently argues the check is unnecessary
because "reject never touches the face"; state instead that the verdict is identity-keyed and
cross-scope, so the face must be one the caller owns.

**Tests (write first)**

| #    | Layer  | Test                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S4.1 | unit   | `rejectFaceSuggestion` throws `BadRequestException` when `checkFaceOwnerAccess` returns empty, and `markRejected` is never called                                                                                                                                                                                                                                                                                                    |
| S4.2 | unit   | Same for `ignoreFaceSuggestion` and `dismissFaceSuggestion`                                                                                                                                                                                                                                                                                                                                                                          |
| S4.3 | unit   | pin: the owner path still passes both checks and calls `markRejected` with `{ identityId, source: 'suggestion', actorId }`                                                                                                                                                                                                                                                                                                           |
| S4.4 | medium | **BDD, the cross-owner scenario:** **Given** users A and B whose personal people "Anna" share one identity `I` (created by a cross-owner merge), and an unassigned near-miss face F in **B's** library with a pending suggestion for B's Anna, **When** A calls `rejectFaceSuggestion(authA, annaA.id, F)`, **Then** the call is refused and B's pending suggestion for F is still returned by `getFaceSuggestions(authB, annaB.id)` |
| S4.5 | medium | The same scenario **before** the fix is the red proof: assert B's suggestion is suppressed. Convert to the S4.4 form once green — do not leave both                                                                                                                                                                                                                                                                                  |
| S4.6 | medium | A rejects a face in **A's own** library that is also visible to B through a space: still allowed (the gate is ownership, not exclusivity)                                                                                                                                                                                                                                                                                            |
| S4.7 | medium | Rejecting a face whose asset is in the trash now 400s (the accepted consequence in §4) and writes no row                                                                                                                                                                                                                                                                                                                             |
| S4.8 | e2e    | `POST /people/{personId}/face-suggestions/{foreignFaceId}/reject` as a second user → 400, and a follow-up `GET` by the face's owner still lists it                                                                                                                                                                                                                                                                                   |
| S4.9 | e2e    | `reject` and `ignore` happy paths — **these endpoints currently have zero e2e coverage in any scope**. Assert the row leaves the queue and does not come back on a re-read                                                                                                                                                                                                                                                           |

**Verify**

```bash
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/person.service.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-suggestion-exclusions.spec.ts
cd e2e && pnpm exec vitest --run src/specs/server/api/person-face-suggestions.e2e-spec.ts
```

**Commit:** `fix(face-suggestions): require face ownership to reject or ignore a suggestion`

---

# Slice 5 — A human placement survives the next recognition pass (F9, F10)

**Goal:** confirming a suggestion on a shared-space person is durable. A later facial-recognition
run cannot re-home the face, and a crash mid-confirm cannot settle a face onto nobody.

**Background the implementer needs — the full revert chain, traced:**

1. `confirmSpacePersonFaceSuggestion` (`shared-space.service.ts:1336-1346`) writes
   `face_identity_face(source='manual')` and a `shared_space_person_face` row, but **never** sets
   `asset_face.personId` — space people are a projection.
2. Non-forced recognition selects `{ personId: null, sourceType: ML }` (`person.service.ts:1312`),
   so the face is re-queued.
3. The face was surfaced as a suggestion precisely because it is outside `maxDistance`, so
   recognition clusters it to a different personal person or creates a new one (`:1500-1505`).
4. `replaceFaceIdentity(…, 'owner-person')` keeps `source='manual'` via `preserveManualSource` but
   **repoints `identityId`**.
5. `processSpaceFaceMatch` then finds `selectedSpaceAssignments.length > 0` (the row the confirm
   wrote), `isExactSelectedSpaceAssignment` is false, and
   `removePersonFaceAssignmentsForSpaceFace` (`shared-space.service.ts:2815`) **deletes the
   confirmed row**.

**Files**

- `server/src/repositories/person.repository.ts` (`getAllFaces` — new option)
- `server/src/services/person.service.ts` (`handleQueueRecognizeFaces`)
- `server/src/services/shared-space.service.ts` (`confirmSpacePersonFaceSuggestion`)
- `server/src/repositories/shared-space.repository.ts` (`addPersonFaces` must accept a `db`)
- `server/src/queries/person.repository.sql`, `shared.space.repository.sql`
- Tests: `server/test/medium/specs/services/face-review-cross-flow.spec.ts`,
  `shared-space-face-suggestions.service.spec.ts`, `server/src/services/person.service.spec.ts`,
  `e2e/src/specs/web/space-person-face-suggestions.e2e-spec.ts`

**Implementation**

1. `getAllFaces` gains `excludeManuallyPlaced?: boolean`. When set, add
   `NOT EXISTS (SELECT 1 FROM face_identity_face fif WHERE fif.assetFaceId = asset_face.id AND fif.source = 'manual')`.
2. `handleQueueRecognizeFaces` passes `excludeManuallyPlaced: true` on the **non-forced** branch
   only (`person.service.ts:1312-1313`). The forced branch already wipes every
   `face_identity_face` row via `unassignFaces` before this point, so there is nothing to preserve
   and the option must not be passed there.
3. Wrap the four writes of `confirmSpacePersonFaceSuggestion` in
   `this.databaseRepository.transaction(async (trx) => …)`, threading `trx` into
   `ensureSpacePersonIdentity`, `claimPendingForSpacePerson`, `replaceFaceIdentity`,
   `resolveAssignedFace` and `addPersonFaces`. `claimPendingForSpacePerson` and `addPersonFaces`
   currently take no `db` parameter — add one, defaulting to `this.db`, exactly as the sibling
   methods do. Reads (`requireRole`, `requireSpacePersonInSpace`, `hasPendingForSpacePerson`,
   the config read) stay **outside** the transaction. Do not call any `this.db` method inside the
   callback (issue #595).

**Tests (write first)**

| #     | Layer  | Test                                                                                                                                                                                                                                                                                                                         |
| ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S5.1  | medium | `getAllFaces({ personId: null, sourceType: ML, excludeManuallyPlaced: true })` omits a face with a `manual` link and yields an unassigned control face with no link                                                                                                                                                          |
| S5.2  | medium | The same query **without** the option still yields the manual-linked face (pin)                                                                                                                                                                                                                                              |
| S5.3  | medium | `getAllFaces({ sourceType: ML })` (the force branch shape) is unchanged (pin)                                                                                                                                                                                                                                                |
| S5.4  | medium | **BDD, the revert chain:** **Given** an editor has confirmed face F on space person S, **When** a non-forced `handleQueueRecognizeFaces` runs and every queued `handleRecognizeFaces` job is executed, **Then** F is not queued, `shared_space_person_face` still holds `(S, F)`, and `fif.identityId` is still S's identity |
| S5.5  | medium | Red proof of S5.4 before the fix: assert the `(S, F)` row is gone. Replace with S5.4 once green                                                                                                                                                                                                                              |
| S5.6  | medium | A face with an `ml`/`owner-person`/`backfill` link is still queued by non-forced recognition (control — only `manual` is excluded)                                                                                                                                                                                           |
| S5.7  | medium | Personal confirm is unaffected: it sets `asset_face.personId`, so it was already excluded by the `personId: null` filter (pin)                                                                                                                                                                                               |
| S5.8  | medium | Fault injection: make `addPersonFaces` throw inside the space-confirm transaction. Assert **all four** writes rolled back — the pending row is still `pending`, no `manual` link exists, and no `sspf` row exists                                                                                                            |
| S5.9  | medium | Fault injection at `replaceFaceIdentity`: same all-or-nothing assertion                                                                                                                                                                                                                                                      |
| S5.10 | medium | Double-submit under the transaction still resolves exactly once (pin `claimed === 0`)                                                                                                                                                                                                                                        |
| S5.11 | e2e    | Space editor confirms a suggestion; the pending total drops by exactly one; a re-read does not re-offer the face                                                                                                                                                                                                             |

**Verify**

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/services/face-review-cross-flow.spec.ts \
  test/medium/specs/services/shared-space-face-suggestions.service.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/person.service.spec.ts
```

**Commit:** `fix(face-review): keep human face placements out of automatic recognition`

---

# Slice 6 — A merge keeps the stronger verdict (F11)

**Goal:** merging two people never discards a durable human "not this person" in favour of a machine
suggestion.

**Background:** `utils/face-verdict-merge.ts:35-44` deletes source rows that collide with a survivor
row **without inspecting `status`**. Source `rejected` + survivor `pending` ⇒ the rejection is
deleted, the suggestion survives, and `rekeyVerdictIdentity` then has nothing to re-key. The test at
`face-verdict.merge-durability.spec.ts:211` names this case but only exercises the safe order —
Slice 2 item D leaves the failing half of it red for this slice to close.

**Files**

- `server/src/utils/face-verdict-merge.ts`
- `server/test/medium/specs/services/face-verdict.merge-durability.spec.ts`
- `server/test/medium/specs/services/face-repair.merge-consistency.spec.ts`

**Implementation**

In `retargetVerdictPersonId`, before the collision delete, promote the survivor where the source is
stronger:

```ts
// Strength wins, not side. A durable human negative outranks a machine suggestion: if the survivor
// only holds a `pending` row for this face and the source holds a `rejected`/`ignored` one, the
// merge must keep the human's answer. Without this, merging two profiles of the same human
// re-proposes a face the user already rejected (the collision delete below is status-blind).
await db
  .updateTable('face_person_verdict as survivor')
  .set({
    status: sql`src."status"`,
    source: sql`src."source"`,
    actorId: sql`src."actorId"`,
    identityId: sql`coalesce(survivor."identityId", src."identityId")`,
    distance: null,
    updatedAt: sql`now()`,
  })
  .from('face_person_verdict as src')
  .whereRef('src.assetFaceId', '=', 'survivor.assetFaceId')
  .where('survivor.personId', '=', targetPersonId)
  .where('survivor.status', '=', 'pending')
  .where('src.personId', '=', sourcePersonId)
  .where('src.status', 'in', ['rejected', 'ignored'])
  .execute();
```

Then the existing collision delete and the existing update run unchanged. Apply the identical shape
to `retargetVerdictSpacePersonId` on `spacePersonId`.

**Tests (write first)**

| #     | Layer  | Test                                                                                                                                                                                                                                                                         |
| ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S6.1  | medium | **BDD:** **Given** the user rejected F for Bob and a later scan proposed F for Robert, **When** Bob is merged into Robert, **Then** `GET /people/{Robert}/face-suggestions` does not offer F, and exactly one verdict row exists with `status='rejected'`, `personId=Robert` |
| S6.2  | medium | The promoted row carries the source's `source` and `actorId`, and its `distance` is nulled                                                                                                                                                                                   |
| S6.3  | medium | pin: source `pending` + survivor `rejected` still keeps the survivor's rejected row (today's behaviour, the half already covered)                                                                                                                                            |
| S6.4  | medium | source `ignored` + survivor `pending` promotes to `ignored`, not `rejected`                                                                                                                                                                                                  |
| S6.5  | medium | source `rejected` + survivor `ignored` keeps the survivor (negative-vs-negative is unchanged)                                                                                                                                                                                |
| S6.6  | medium | Survivor has no row at all → the plain re-target moves the source row (pin, unchanged path)                                                                                                                                                                                  |
| S6.7  | medium | Source's `identityId` is NULL and the survivor's is set → the coalesce keeps the survivor's identity                                                                                                                                                                         |
| S6.8  | medium | Survivor's `identityId` is NULL and the source's is set → the promoted row adopts the source's identity                                                                                                                                                                      |
| S6.9  | medium | Three-way merge (two sources, one holding `rejected`, one holding `ignored`, survivor `pending`) → exactly one row, negative, and no unique-index violation                                                                                                                  |
| S6.10 | medium | Both partial unique indexes are still satisfied after every case above — assert row counts, not just contents                                                                                                                                                                |
| S6.11 | medium | The space twin: S6.1, S6.3 and S6.9 repeated on `spacePersonId` through `mergeSpacePeople`                                                                                                                                                                                   |
| S6.12 | medium | pin: `rekeyVerdictIdentity` still runs after the re-target and leaves the promoted row keyed to the surviving identity                                                                                                                                                       |

**Verify**

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/services/face-verdict.merge-durability.spec.ts \
  test/medium/specs/services/face-repair.merge-consistency.spec.ts
```

**Commit:** `fix(face-review): keep the stronger verdict when a merge collides two rows`

---

# Slice 7 — Cleanup resolve: atomicity and duplicate-id safety (F12, F13, F14)

**Goal:** every bucket of a resolve is all-or-nothing, and a malformed-but-plausible request is
refused with a 400 before any bucket commits rather than 500-ing halfway through.

**Files**

- `server/src/services/face-repair.service.ts` (`resolveFaces` — the `stay` block at `:972-1006`,
  the bucket-overlap validation at `:807`)
- `server/src/utils/face-repair.ts` (`findOverlappingIds`)
- `server/src/repositories/face-person-verdict.repository.ts` (`markRejectedMany` gains a `db`)
- `server/src/repositories/face-identity.repository.ts` (`replaceFaceIdentities` de-duplicates)
- Tests: `server/test/medium/specs/services/face-repair.resolve.spec.ts`,
  `server/src/utils/face-repair.spec.ts`, `server/src/dtos/face-repair.dto.spec.ts`

**Implementation**

1. Wrap the `stay` block's `markRejectedMany` + `drainPendingForFaces(stay)` in one
   `databaseRepository.transaction`, threading `trx` into both. `markRejectedMany` needs a `db`
   parameter (default `this.db`) added; its internal chunking then runs inside the caller's
   transaction, which is the point — a partial "keep here" is not a valid state.
2. Correct the comment at `face-repair.service.ts:1158-1164`, which currently asserts the `stay`
   drain is already transactional.
3. `findOverlappingIds` keeps its within-bucket `new Set()` de-duplication but the caller must stop
   flattening `moveToPerson` into one bucket: pass **one bucket per move group** so a face routed to
   two destinations is detected and 400s, as the comment at `:807` promises.
4. `replaceFaceIdentities` de-duplicates `assetFaceIds` before chunking, the same guard
   `markRejectedMany` already applies at `face-person-verdict.repository.ts:214`. This closes the
   `ON CONFLICT DO UPDATE cannot affect row a second time` (Postgres `21000`) path that today fires
   after the `moveToPerson` and `stay` buckets have already committed.

**Tests (write first)**

| #    | Layer  | Test                                                                                                                                                                                                      |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S7.1 | medium | Fault injection: `drainPendingForFaces` throws inside the `stay` block → **no** negative verdict rows were written (the whole bucket rolled back), and the pending rows are intact                        |
| S7.2 | medium | Fault injection mid-chunk: a 2 100-face `stay` bucket where the third chunk throws → zero verdict rows, not 2 000                                                                                         |
| S7.3 | medium | pin: the happy path still writes one negative per face against its own stored suspected owner and drains every pending row for those faces                                                                |
| S7.4 | unit   | `findOverlappingIds` reports a face present in two different move groups                                                                                                                                  |
| S7.5 | medium | `resolveFaces` with the same face in two `moveToPerson` groups → 400, and **nothing** committed: no move, no verdict, no drain                                                                            |
| S7.6 | medium | `resolveFaces` with a duplicated id inside one `lock` bucket → succeeds (the client repeating a face is legitimate and was absorbed before), writes exactly one `manual` link, and does not raise `21000` |
| S7.7 | medium | A request combining `moveToPerson`, `stay` and a duplicated `lock` id → all three buckets apply; assert the move and the stay both committed and the lock is single                                       |
| S7.8 | unit   | `replaceFaceIdentities` called with `['a','a','b']` issues one row per distinct id                                                                                                                        |
| S7.9 | medium | pin: `lock` and `detach` remain transactional (mutate each to throw mid-way and assert full rollback)                                                                                                     |

**Verify**

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-repair.resolve.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/utils/face-repair.spec.ts src/dtos/face-repair.dto.spec.ts
```

**Commit:** `fix(face-cleanup): make the stay bucket atomic and reject cross-group duplicate faces`

---

# Slice 8 — Verdict lifecycle: clearing and collection (F15, F16)

**Goal:** the verdict table never states a fact the rest of the system contradicts, and it does not
grow without bound.

**Background:** every drain filters `status='pending'`, so nothing removes a `rejected` row when a
human later places that face on that same target. Today the admin resolutions page can therefore
show "F is not Q" while F sits on Q — and after a reset, F can never be suggested for Q again. There
is no reaper for `face_person_verdict` anywhere in `server/src`; "reset all people" nulls
`asset_face.personId`, wipes `face_identity_face`, deletes faceless people (`personId` → NULL via
`ON DELETE SET NULL`) and GCs identities (`identityId` → NULL), leaving rows no read predicate can
ever match.

**Files**

- `server/src/repositories/face-person-verdict.repository.ts` (`clearNegativeForTarget`,
  `deleteOrphanedVerdicts`)
- `server/src/services/person.service.ts` (`reassignFaces`, `reassignFacesById`,
  `confirmFaceSuggestion`, `handlePersonCleanup`)
- `server/src/services/shared-space.service.ts` (`confirmSpacePersonFaceSuggestion`)
- `server/src/services/face-repair.service.ts` (`executeRepair`'s move path)
- `server/src/queries/face.person.verdict.repository.sql`
- Tests: `server/test/medium/specs/repositories/face-person-verdict.repository.spec.ts`,
  `server/test/medium/specs/services/face-review-cross-flow.spec.ts`,
  `server/test/medium/specs/repositories/face-verdict-safety.spec.ts`

**Implementation**

1. `clearNegativeForTarget(target, assetFaceIds, db?)` deletes rows with
   `status IN ('rejected','ignored')` matching the target — by `personId`, `spacePersonId`, **or**
   `identityId` when the target carries one. Only the target being placed onto; verdicts against
   other targets are untouched.
2. Call it from every human-placement path, inside the existing transaction where one exists:
   `reassignFaces` / `reassignFacesById` (`person.service.ts:265`, `:285`),
   `confirmFaceSuggestion`'s transaction, `confirmSpacePersonFaceSuggestion`'s new transaction
   (Slice 5), and `executeRepair`'s move (`face-repair.service.ts:286`) plus the `lock` bucket.
3. `deleteOrphanedVerdicts()` deletes rows where `personId`, `spacePersonId` and `identityId` are
   all NULL. Call it from `handlePersonCleanup`, after `deleteUnreferencedIdentities()` so it
   observes the post-GC state.

**Tests (write first)**

| #     | Layer  | Test                                                                                                                                                                                                                                                     |
| ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S8.1  | medium | **BDD:** **Given** an admin kept F away from Q, **When** the owner later drags F onto Q, **Then** `GET /admin/face-repair/resolutions` no longer lists "F is not Q"                                                                                      |
| S8.2  | medium | The same placement leaves a `rejected` row for a **different** person R intact (scoping control)                                                                                                                                                         |
| S8.3  | medium | Identity-keyed clearing: a verdict written against identity `I` with a NULL `personId` is cleared when a face is placed on a person carrying `I`                                                                                                         |
| S8.4  | medium | Space confirm clears a negative recorded against that space person, and against its identity                                                                                                                                                             |
| S8.5  | medium | A cleanup move to Q clears any negative for `(Q, F)`; the `lock` bucket clears any negative for the reviewed person                                                                                                                                      |
| S8.6  | medium | **BDD, the follow-on defect:** **Given** the sequence in S8.1, **When** Q is later deleted and re-created and a suggestion scan runs, **Then** F is offered again (it was permanently suppressed before this slice)                                      |
| S8.7  | medium | `deleteOrphanedVerdicts` deletes a row with all three keys NULL and **keeps** rows retaining any one of `personId` / `spacePersonId` / `identityId` — four assertions in one test                                                                        |
| S8.8  | medium | **BDD, reset:** **Given** verdicts of every shape, **When** a forced facial-recognition run completes (`unassignFaces` → `handlePersonCleanup` → `deleteUnreferencedIdentities`), **Then** no fully-orphaned row survives and rows with a live target do |
| S8.9  | medium | `handlePersonCleanup` calls the reaper **after** `deleteUnreferencedIdentities` — assert by seeding a row whose only key is an identity that the GC removes in the same run                                                                              |
| S8.10 | medium | The reaper is chunked / bounded — assert it completes over 5 000 orphaned rows without a bind-parameter error                                                                                                                                            |

**Verify**

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/face-person-verdict.repository.spec.ts \
  test/medium/specs/repositories/face-verdict-safety.spec.ts \
  test/medium/specs/services/face-review-cross-flow.spec.ts
```

**Commit:** `fix(face-review): clear contradicted verdicts and collect orphaned ones`

---

# Slice 9 — Suggestion scan fan-out and queue safety (F17, F18, F19)

**Goal:** enabling face suggestions on a large library queues work proportional to the people that
actually have candidates, deduplicates re-entrant sweeps, and never wedges a forced recognition run.

**Background:** `getScannablePeopleWithUnassignedFaces` (`person.repository.ts:978`) correlates its
`EXISTS` on `asset.ownerId = person.ownerId` — it asks whether the _owner_ has any unassigned face,
not whether _this person_ has candidates. One unassigned face queues a scan for every named visible
person of that owner, each performing up to 20 ANN searches at `numResults: 100`, on the
concurrency-1 `PeopleBackfill` queue. Neither per-person job has a `jobId`, and
`FaceIdentityBackfill` re-queues both `…QueueAll` jobs on every drain.

**Files**

- `server/src/repositories/person.repository.ts` (`getScannablePeopleWithUnassignedFaces`)
- `server/src/repositories/shared-space.repository.ts`
  (`getScannableSpacePeopleWithUnassignedFaces` — verify and align)
- `server/src/repositories/job.repository.ts` (`getJobOptions`)
- `server/src/services/person.service.ts` (`handleQueueRecognizeFaces`'s
  `waitForQueueCompletion` call)
- `server/src/queries/person.repository.sql`, `shared.space.repository.sql`
- Tests: `server/test/medium/specs/repositories/person.repository.spec.ts`,
  `server/src/repositories/job.repository.spec.ts`, `server/src/services/person.service.spec.ts`

**Implementation**

1. Narrow the `EXISTS` to candidates for **this person**: the face must be unassigned, ML-sourced,
   live, visible, on a reviewable asset (Slice 1's predicate), **and** in the same owner's library
   as the person. Keeping it a cheap `EXISTS` rather than a per-person KNN is deliberate — the scan
   job itself still does the distance work; this only stops queueing people with nothing to scan.
   Document that a person with candidates that all fall outside the band still gets a job that
   returns early; the fan-out reduction targets the pathological case, not perfection.
2. Add `getJobOptions` cases for `JobName.PersonSuggestionScan` and
   `JobName.SpacePersonSuggestionScan` returning `{ jobId: <name>-<id>, removeOnComplete: true }`,
   so a re-entrant sweep coalesces onto the in-flight job for the same person.
3. Bound `waitForQueueCompletion` for `PeopleBackfill` with a timeout, logging and returning rather
   than parking a forced recognition job indefinitely.

**Tests (write first)**

| #     | Layer  | Test                                                                                                                                                                                                                  |
| ----- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S9.1  | medium | **BDD:** **Given** an owner with three named people, only one of which has an unassigned ML face in its own library, **When** `getScannablePeopleWithUnassignedFaces` streams, **Then** exactly one person is yielded |
| S9.2  | medium | Red proof: assert three before the fix. Replace with S9.1 once green                                                                                                                                                  |
| S9.3  | medium | A person whose only candidate face is on a Locked asset is not yielded (Slice 1 composition)                                                                                                                          |
| S9.4  | medium | A person whose only candidate is soft-deleted / invisible / non-ML is not yielded                                                                                                                                     |
| S9.5  | medium | Hidden, unnamed and `type='pet'` people are still excluded (pin)                                                                                                                                                      |
| S9.6  | medium | Two owners: owner A's unassigned face does not make owner B's people scannable                                                                                                                                        |
| S9.7  | medium | The space twin: `getScannableSpacePeopleWithUnassignedFaces` yields only space people with candidates reachable in that space                                                                                         |
| S9.8  | unit   | `getJobOptions(PersonSuggestionScan, { id })` returns a `jobId` containing the person id; two queues of the same id coalesce; two different ids do not                                                                |
| S9.9  | unit   | `handleQueueRecognizeFaces({ force: true })` returns after the bounded wait when `PeopleBackfill` never drains, and logs                                                                                              |
| S9.10 | unit   | pin: the non-forced path does not wait on `PeopleBackfill` at all                                                                                                                                                     |

**Verify**

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/person.repository.spec.ts \
  test/medium/specs/repositories/shared-space.repository.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.mjs --run \
  src/repositories/job.repository.spec.ts src/services/person.service.spec.ts
```

**Commit:** `perf(face-suggestions): queue suggestion scans only for people with candidates`

---

# Slice 10 — API contract, request bounds and SQL docs (F20, F21, F22, F23)

**Goal:** every request array is bounded below the Postgres bind-parameter ceiling, the published
permission is the enforced one, and the generated SQL documentation is correct.

**Files**

- `server/src/dtos/face-repair.dto.ts`
- `server/src/controllers/person.controller.ts`
- `server/src/repositories/face-identity.repository.ts` (the stacked decorator at `:2290-2297`)
- `server/src/repositories/face-person-verdict.repository.ts` (`listNegativeVerdicts` pagination)
- `server/src/repositories/face-repair-decline.repository.ts` (chunking)
- `server/src/services/face-repair.service.ts` (`listResolutions` passes the page)
- `web/src/routes/admin/face-cleanup/resolutions/+page.svelte` + `+page.ts`
- `open-api/immich-openapi-specs.json`, `packages/sdk/src/fetch-client.ts`, `mobile/openapi/`
- `server/src/queries/*.sql`

**Implementation**

1. Cap the four uncapped arrays at `MAX_RESOLVE_FACES` (25 000), matching the sibling that is
   already capped: `assetFaceIds` (`face-repair.dto.ts:263`), `verdictIds` (`:252`),
   `clusterMuteIds` (`:253`), `excludeFaceIds` (`:275` — currently has no cap at all and is
   reachable from the shipped UI). Then chunk each downstream `IN`:
   `demoteManualFaceLinks`, `removeVerdicts`, `face-repair-decline.repository.ts:125`, and
   `face-repair.repository.ts:226`. Correct the DTO comment at `:140-142`, which currently asserts
   both facts that this slice is making true.
2. Fix the advertised permissions: `GET /people/{id}/face-suggestions` publishes
   `Permission.PersonRead` but enforces `PersonUpdate`; confirm publishes `PersonReassign` but
   enforces `PersonUpdate` + `PersonCreate`. Change the decorators to publish what is enforced —
   **not** the service to enforce what is published: the owner-only read is deliberate (`PersonRead`
   admits shared-space members) and must not be relaxed.
3. Remove the stray `@GenerateSql` at `face-identity.repository.ts:2290` (a leftover from
   `replaceFaceIdentity`; method decorators apply bottom-up and `SetMetadata` overwrites, so it wins
   and emits `"assetFaceId" in $1` — a scalar bind — while `replaceFaceIdentity` loses its coverage
   entirely). Re-add a correct decorator to `replaceFaceIdentity`.
4. `listNegativeVerdicts` takes `{ page, size }` with the size capped at 200, returns
   `{ total, items }`, and the resolutions page paginates. Add the index the new `ORDER BY … LIMIT`
   needs in a **new** migration if the query plan requires it.

**Tests (write first)**

| #     | Layer  | Test                                                                                                                                                                          |
| ----- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S10.1 | unit   | Each of the four schemas rejects `25_001` ids with a 400 and accepts `25_000`                                                                                                 |
| S10.2 | unit   | `excludeFaceIds` rejects over-cap input (it has no cap today, so this is the red test)                                                                                        |
| S10.3 | medium | `demoteManualFaceLinks`, `removeVerdicts`, the decline removal and `getClusterFacePage` each complete with 25 000 ids without a bind-parameter error                          |
| S10.4 | unit   | `person.controller.spec.ts` asserts the GET publishes `PersonUpdate` and the confirm publishes `PersonUpdate`; the service-level checks are unchanged (pin)                   |
| S10.5 | —      | `server/src/queries/face.identity.repository.sql` contains `"assetFaceId" in ($1)` for `getManualLinkedFaceIds` and a block for `replaceFaceIdentity`; assert by regenerating |
| S10.6 | medium | `listNegativeVerdicts({ page: 1, size: 2 })` over 5 rows returns 2 items and `total: 5`; page 3 returns 1 item; ordering is stable `createdAt desc, id desc`                  |
| S10.7 | web    | The resolutions page renders page 1, loads page 2 on demand, and its total reflects the server total                                                                          |
| S10.8 | e2e    | A `suggestion`-source verdict and a `cleanup`-source verdict both appear, and each source filter shows only its own — the page currently has no e2e coverage for `suggestion` |

**Verify**

```bash
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/dtos/face-repair.dto.spec.ts src/controllers/person.controller.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/face-person-verdict.repository.spec.ts
cd web && pnpm exec vitest --run src/routes/admin/face-cleanup/resolutions/page.spec.ts
```

Then rebuild the server, `pnpm sync:open-api`, `mise open-api`, and `mise //:sql` with the dev DB up.

**Commit:** `fix(face-review): bound request arrays, publish the enforced permissions, repair SQL docs`

---

# Slice 11 — Web: honest action feedback (F24, F25, F26, F27)

**Goal:** the UI never reports success for something that did not happen, and never states a count
it did not verify.

**Files**

- `web/src/lib/modals/PersonSuggestionReviewModal.svelte` + `.spec.ts`
- `web/src/routes/admin/face-cleanup/[personId]/+page.svelte` + `page.spec.ts`
- `web/src/routes/admin/face-cleanup/scan/+page.svelte` + `page.spec.ts`
- `web/src/routes/admin/face-cleanup/scan/ConfidentLane.svelte` + `.spec.ts`
- `web/src/routes/admin/face-cleanup/people/+page.svelte` + `page.spec.ts`
- `i18n/en.json`

**Implementation**

1. **The modal's 400 handling is wrong at its root.** `requireAccess` throws
   `BadRequestException` (`server/src/utils/access.ts:40`), so on the personal path **every**
   authorization failure is a 400 — the comment at `PersonSuggestionReviewModal.svelte:171-175`
   claiming RBAC surfaces as 403 is false. Replace the duck-typed `.status === 400` check with an
   explicit server signal: the action endpoints return `204 No Content` when there was nothing to
   do (already resolved) and `200` when they acted. Any 4xx becomes a `handleError` toast and the
   modal stays on the current face. Update the server controllers' `@HttpCode` accordingly and the
   generated SDK.
2. `clusterTotal` (`[personId]/+page.svelte:93`) must not silently read 0. `loadRestPage`'s
   `catch { }` (`:292-294`) sets a `restLoadFailed` flag; while set, the "Move entire cluster"
   action is **disabled** with an explanatory message, matching how the manual page hard-fails to a
   Retry banner. The confirm copy states that the server enumerates the cluster itself.
3. `ConfidentLane` bulk approve gains a confirm dialog (the single-row dismiss beside it already has
   one) and switches from `Promise.all` to `Promise.allSettled`, reporting "N applied, M failed"
   and listing the failures.
4. `scan/+page.svelte`'s poll: guard `scheduleNextPoll` on a `destroyed` flag set in `onDestroy`, so
   an in-flight `fetchLatestScan` cannot re-arm the timer after teardown.
5. `people/+page.svelte`: a failed _load-more_ keeps the loaded grid and shows an inline retry for
   the failed page only; only a failed **first** page renders the full-page error state.

**Tests (write first)**

| #      | Layer | Test                                                                                                                                                                           |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S11.1  | web   | Confirm rejected with `{ status: 400 }` → `handleError` called, the face is **not** added to `actedFaceIds`, the modal does not advance, and the progress counter is unchanged |
| S11.2  | web   | Confirm resolving `204` → no toast, the face is marked acted, the modal advances, and `confirmed` does **not** increment                                                       |
| S11.3  | web   | Confirm resolving `200` → `confirmed` increments by one                                                                                                                        |
| S11.4  | web   | The same three cases for `dismiss` and `ignore`                                                                                                                                |
| S11.5  | web   | pin: a `500` still surfaces and leaves the current face selected and retryable                                                                                                 |
| S11.6  | web   | When `getFaceRepairClusterFaces` rejects, the "Move entire cluster" button is disabled and an explanation is rendered; the flagged grid still renders                          |
| S11.7  | web   | pin: with a successful rest load, the confirm copy shows `restTotal + flagged.length`                                                                                          |
| S11.8  | web   | Bulk approve shows a confirm dialog naming the cluster count; cancelling issues zero `resolveFaces` calls                                                                      |
| S11.9  | web   | Bulk approve where 1 of 3 rejects → the other two still applied, and the message reports 2 applied / 1 failed                                                                  |
| S11.10 | web   | The scan page issues no further `getLatestScan` after `onDestroy`, including when a fetch was already in flight                                                                |
| S11.11 | web   | Page 3 of the people grid failing keeps pages 1–2 rendered and offers a retry for page 3 only                                                                                  |
| S11.12 | web   | pin: page 1 failing still renders the full-page error state with a retry                                                                                                       |

**Verify**

```bash
cd web && pnpm exec vitest --run src/lib/modals/PersonSuggestionReviewModal.spec.ts \
  'src/routes/admin/face-cleanup/**/*.spec.ts'
cd web && pnpm check:typescript && pnpm lint
```

**Commit:** `fix(web): report face-review action outcomes honestly`

---

# Slice 12 — Web: gating, dialog semantics and i18n (F28, F29, F30, F31, F32)

**Goal:** the client never offers an action the server will refuse, destructive confirmations are
real dialogs, and every user-visible string is translatable and correctly pluralised.

**Files**

- `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- `web/src/routes/admin/face-cleanup/[personId]/+page.svelte`
- `web/src/routes/admin/face-cleanup/people/[personId]/+page.svelte`
- `web/src/routes/admin/face-cleanup/resolutions/+page.svelte`
- `web/src/lib/utils/face-suggestion-snooze.ts` + `.spec.ts`
- `web/src/routes/admin/system-settings/MachineLearningSettings.svelte` + `.spec.ts`
- `i18n/en.json`, `i18n/de.json`, `i18n/fr.json`

**Implementation**

1. Gate `<PersonSuggestionBanner>` on `isEditor` (defined at `:121` of the space page and applied at
   eight other sites in the same file) and on `canEditSpacePerson` on the global people page. The
   server already returns `{ total: 0 }` for viewers, so this is defence in depth — state that in
   the comment so a future relaxation of the read gate does not silently expose the actions.
2. Replace the two hand-rolled `fixed inset-0 z-50` overlays — the only two in `web/src` — with
   `modalManager.show(ConfirmModal, …)` from `@immich/ui`, the pattern asset deletion already uses
   (`web/src/lib/managers/selection-command-handlers.ts:144`). That gets `role="dialog"`,
   `aria-modal`, focus trap, Escape and backdrop dismissal for free.
3. Resolutions page: branch the empty state on whether the **unfiltered** list is empty ("no
   decisions recorded yet") or the filter excluded everything ("no decisions match this filter"),
   and render a deleted target distinctly from a genuinely unnamed one — both FKs are
   `ON DELETE SET NULL`, so `personName` and `spacePersonName` can both be null with the ids
   present. Make the three filter labels reactive (`$derived`, not evaluated once at init).
4. i18n: remove the nine orphaned keys from `en.json` and all translated locales **except**
   `face_suggestion_confirmed_toast` and `face_suggestion_all_done`, which describe a specified but
   unwired success toast and all-done state — wire those up instead. Add ICU plurals to the 17
   count-bearing admin keys. Remove the 39 stale `admin.face_cleanup_*` keys from `de.json` and 27
   from `fr.json` that have no `en.json` counterpart. Grep `mobile/` before removing any key.
5. Snooze: key on the same identifier the API calls use — the profile id — on both routes, so "Not
   now" on one surface snoozes the other. Prune entries older than the 30-day expiry on write.
6. `MachineLearningSettings`: drop `!machineLearning.enabled` from the suggestions toggle's
   `disabled` (the server deliberately supports suggestions with the ML master switch off —
   `server/src/utils/misc.ts:114-122`, pinned by `person.service.spec.ts:7083`), and stop the
   auto-fill effect from overwriting a value the admin set deliberately.

**Tests (write first)**

| #      | Layer | Test                                                                                                                                                                                                                                  |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S12.1  | web   | A space **viewer** with a non-zero suggestion total renders **no** banner; an editor with the same data renders it (the viewer case must not be able to pass on `total: 0` alone — this is exactly the vacuous shape Slice 2 removed) |
| S12.2  | web   | The global people page applies the same gate for a space-scoped person                                                                                                                                                                |
| S12.3  | web   | pin: a personal (non-space) person always renders the banner for its owner                                                                                                                                                            |
| S12.4  | web   | The detach confirmation is a `ConfirmModal`: Escape cancels, the confirm button receives focus, and cancelling issues no `resolveFaces` call                                                                                          |
| S12.5  | web   | The move-entire confirmation likewise                                                                                                                                                                                                 |
| S12.6  | web   | Resolutions with rows present but none matching the active filter shows the filtered-empty message, not the never-recorded one                                                                                                        |
| S12.7  | web   | A row whose `personId` is set but `personName` is null renders the deleted-target treatment; a row with a null id and null name renders the unnamed treatment                                                                         |
| S12.8  | web   | Switching locale updates the three filter chip labels                                                                                                                                                                                 |
| S12.9  | web   | Rendering against real `en.json`, a count of 1 reads "1 cluster" and 2 reads "2 clusters" for each of the 17 keys (table-driven)                                                                                                      |
| S12.10 | —     | A repo-wide check that every `$t('…')` key in the changed files exists in `en.json`, and that no `en.json` key added by this PR is unreferenced in `web/` or `mobile/`                                                                |
| S12.11 | web   | Snooze set on the space route suppresses the banner on the global route for the same profile, and vice versa                                                                                                                          |
| S12.12 | web   | Snooze entries past their expiry are removed from storage on the next write                                                                                                                                                           |
| S12.13 | web   | With `machineLearning.enabled = false`, the suggestions toggle is **enabled** and saving persists                                                                                                                                     |
| S12.14 | web   | Setting `suggestions.maxDistance` manually and then toggling suggestions off and on preserves the admin's value                                                                                                                       |
| S12.15 | web   | Confirming a suggestion shows the success toast (`face_suggestion_confirmed_toast`), and emptying the queue shows the all-done state                                                                                                  |

**Verify**

```bash
cd web && pnpm exec vitest --run 'src/routes/**/*.spec.ts' 'src/lib/**/*.spec.ts'
cd web && pnpm check:typescript && pnpm lint
```

**Commit:** `fix(web): gate face-suggestion actions by role and use real confirm dialogs`

---

# Slice 13 — Migration reconciliation and operational safety (F33, F34, F35)

**Goal:** an instance that ran an earlier RC of this branch is repaired rather than silently wrong,
switching back to upstream Immich is verified as well as attempted, and an inverted suggestion band
in a config file is reported instead of silently disabling the feature.

**Background:** `1787000000000-AddFacePersonVerdict.ts` was edited in place **after** RC deployment
— `7ed4e8c4bc6` flipped the `identityId` FK from `ON DELETE CASCADE` to `ON DELETE SET NULL`, and
`4a64b158139` rewrote the four index-override payloads. Kysely records migrations by name with no
checksum, so `1787000000000` never re-runs and those instances keep `CASCADE`: deleting a
`face_identity` row — which every people merge does — CASCADE-deletes the verdicts keyed to it, the
exact loss the commit was written to prevent. The schema-drift check is warn-only
(`database.service.ts:119-127`) and the drift gate only ever sees a freshly-migrated DB. Four
migration names recorded by RC DBs were also deleted or renamed; the documented remedy for those
stays "reset the instance", but it currently lives only in the PR description.

**Files**

- `server/src/schema/migrations-gallery/1788000000000-ReconcileFacePersonVerdictConstraints.ts`
  (new)
- `scripts/revert-to-immich.sql`
- `server/src/utils/config.ts` (`SystemConfigSchema` cross-field refinement)
- `server/src/services/person.service.ts` (`onConfigValidate` — keep, but no longer the only site)
- `docs/docs/administration/face-cleanup.md` (the RC reset note)
- `docs/docs/install/config-file.md` (the missing `suggestions` block)
- Tests: `server/test/medium/specs/migrations/face-person-verdict.migration.spec.ts`,
  `server/src/utils/config.spec.ts`, `server/test/medium/specs/schema-drift.spec.ts`

**Implementation**

1. New migration `1788000000000`, idempotent and safe on a fresh install:
   - drop and re-add `face_person_verdict_identityId_fkey` with `ON DELETE SET NULL` only when
     `information_schema` reports it as `CASCADE`;
   - re-`INSERT … ON CONFLICT DO UPDATE` the four index-override rows with the parenthesized
     payloads, so an RC DB stops logging drift on every boot.
     On a fresh install both steps are no-ops. Include a correct `down()`.
2. `revert-to-immich.sql`: add `face_repair_scan`, `face_repair_decline`,
   `face_repair_scan_flagged_face` and `face_repair_lock` to the `fork_tables_left` guard, and add
   `%AddFaceRepairScan%`, `%AddFaceRepairDecline%`, `%AddFaceRepairLock%`,
   `%AddFaceRepairScanFlaggedFace%`, `%AddFaceRepairScanInFlightIndex%` to the `fork_rows_left`
   guard. Add the pre-rename migration names to the exact-name DELETE list so an RC DB is cleaned
   too.
3. Move the invariant `suggestions.maxDistance > facialRecognition.maxDistance` into a
   `.superRefine` on `SystemConfigSchema` so it is enforced on the **config-file** path
   (`utils/config.ts:115-157`) as well as the API path. Keep the `ConfigValidate` hook — it produces
   the better message for the settings page. A config file that violates it must fail loudly at
   boot rather than leave the feature silently inert with a read-only settings page.
4. Document the RC reset requirement in `docs/docs/administration/face-cleanup.md`, and add the
   `suggestions` block to the reference config in `docs/docs/install/config-file.md`.

**Tests (write first)**

| #      | Layer  | Test                                                                                                                                                                                                                 |
| ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S13.1  | medium | Given a DB where the FK is manually set back to `CASCADE`, running `1788000000000` leaves it `SET NULL`; running it twice is a no-op                                                                                 |
| S13.2  | medium | On a freshly-migrated DB the migration changes nothing — assert the constraint and all four override rows are byte-identical before and after                                                                        |
| S13.3  | medium | Given override rows with the unparenthesized payloads, the migration repairs them and `getSchemaDrift()` reports empty                                                                                               |
| S13.4  | medium | `down()` restores the prior state                                                                                                                                                                                    |
| S13.5  | medium | **BDD, the data-loss case:** **Given** a DB with the CASCADE FK and a verdict keyed to identity `I`, **When** `1788000000000` runs and `I` is then deleted, **Then** the verdict row survives with `identityId` NULL |
| S13.6  | medium | `schema-drift.spec.ts` still reports zero drift for the whole schema after the new migration                                                                                                                         |
| S13.7  | unit   | `SystemConfigSchema` rejects `suggestions: { enabled: true, maxDistance: 0.4 }` with `facialRecognition.maxDistance: 0.5`                                                                                            |
| S13.8  | unit   | It accepts the same config when `suggestions.enabled` is false (the invariant only binds when the feature is on)                                                                                                     |
| S13.9  | unit   | The legacy `suggestionMaxDistance` fold still runs before the refinement, so a legacy config is not rejected on a value the fold would have corrected (pin)                                                          |
| S13.10 | unit   | pin: `onConfigValidate` still produces its message on the API path                                                                                                                                                   |
| S13.11 | —      | `revert-to-immich.sql` run against a DB carrying all five face tables and the four pre-rename migration rows completes with no abort and leaves no `face_%` table or fork migration row                              |

**Verify**

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/migrations/face-person-verdict.migration.spec.ts \
  test/medium/specs/schema-drift.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/utils/config.spec.ts
npx prettier --check 'docs/**/*.md'
```

**Commit:** `fix(server): reconcile face_person_verdict constraints and enforce the suggestion band everywhere`

---

# Slice 14 — Cross-engine e2e, lint, format and final gate

**Goal:** the unification's headline claim is proven at the e2e layer, and the branch is CI-clean.

**Background:** `e2e/src/specs/web/face-cleanup.e2e-spec.ts` contains zero references to
`face-suggestions`, and the three suggestion specs contain zero references to `face-repair`. The
cross-engine guarantee lives entirely at the medium layer today.

**Files**

- `e2e/src/specs/web/face-review-cross-engine.e2e-spec.ts` (new)
- `e2e/src/specs/web/face-cleanup.e2e-spec.ts` (positive controls)
- Every package's lint/format

**Tests (write first)**

| #     | Layer | Test                                                                                                                                                                                                                                                     |
| ----- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S14.1 | e2e   | **BDD:** **Given** a cluster the cleanup scan flags a face out of, **When** the owner confirms that face as the person via the suggestion API, **Then** a re-scan no longer flags it — with a control face in the same cluster that **is** still flagged |
| S14.2 | e2e   | **Given** the owner rejected a face for person P, **When** the admin runs a scan, **Then** the face is not flagged toward P but **is** still flagged toward a different suspected owner                                                                  |
| S14.3 | e2e   | **Given** an admin kept a face on its cluster, **When** the face is later unassigned and a suggestion scan runs, **Then** it is not offered for the suspected owner, but a control face is offered                                                       |
| S14.4 | e2e   | A space **viewer** receives 403 on confirm, reject, ignore and dismiss for a space person; an editor receives success on the same calls                                                                                                                  |
| S14.5 | e2e   | A face on a **Locked** asset appears in neither the admin cleanup console nor any suggestion queue, and its admin thumbnail URL is refused                                                                                                               |
| S14.6 | e2e   | Add the missing positive controls to the five `not re-flagged` assertions in `face-cleanup.e2e-spec.ts` (`:587,692,772,1041,1048`), and scope the `resolution-row` locator at `:840` by person                                                           |

**Verify**

```bash
make lint-all && make format-all && make check-all
cd e2e && pnpm test && pnpm test:web
```

**Commit:** `test(face-review): prove the cross-engine guarantees end to end`

---

## 5. Slice dependency graph

```
1 (locked)  ──┬─► 3 (confirm gates) ──► 5 (placement durability) ──► 8 (lifecycle)
              ├─► 9 (fan-out)
              └─► 14 (e2e)
2 (test integrity) ──► every later slice
4 (reject auth) ──────► 14
6 (merge)  ── depends on 2's item D (the red half of the merge test)
7 (resolve atomicity) ── independent
10 (contract) ── independent
11 (web feedback) ── depends on 3 and 4 (the 204/400 contract change)
12 (web gating) ── independent
13 (ops) ── independent
```

Slices 7, 10, 12 and 13 are independent and may be reordered if a slice blocks. Slices 1, 2, 3, 5, 6
and 8 form the critical path and must run in order.

## 6. Out of scope (tracked separately)

- `GET /admin/face-repair/scan/latest`'s `Promise<T | null>` return defeating the OpenAPI schema
  extractor — pre-existing, spec/SDK-only, no behaviour change.
- The four dead admin endpoints whose comment claims the web still uses them
  (`face-repair-admin.controller.ts:146-148`) — removal is a separate deprecation.
- `withLiveFlaggedCounts` re-deriving verdicts over an unchunked whole-scan id list on a 2 s poll —
  a real scaling limit, but it needs a design decision (persist the filtered counts vs. chunk the
  reads) rather than a mechanical fix.
- `face_repair_decline`'s `(assetFaceId, suspectedOwnerId)` unique index being inert for
  person-scoped rows (both columns NULL, NULLS DISTINCT) — a design question about whether
  duplicate cluster mutes matter.
- Adding `QueueName.BackgroundTask` to `ADMIN_VISIBLE_QUEUES` so a wedged `FaceRepairScan` is
  observable and cancellable from the Queues page.
