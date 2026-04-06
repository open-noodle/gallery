# E2E API Coverage Backlog

**Companion to:** [`2026-04-06-e2e-api-coverage-research.md`](./2026-04-06-e2e-api-coverage-research.md)

This is the working backlog for closing the e2e API test coverage gaps. Each row is one PR, scoped small enough to review in under 30 minutes. Tasks are listed roughly in dependency order; once `T02` (helpers) lands, most of the remaining tasks can be picked up in any order.

## How to use this doc

- **Pick a task off the list.** Read its blurb here and the relevant section of the research doc.
- **If the task has a design doc linked**, read that for the architectural decisions.
- **If it doesn't**, the blurb here IS the spec — the test cases are derivable from the actor matrix in §3 of the research doc plus the per-file lists in §4.
- **When you ship**, tick the checkbox and add the PR number inline: `- [x] T05 — … (#264)`.
- **If you discover decisions** that needed making (helper API change, new actor, fixture surprise), add a new design doc at `docs/plans/2026-04-06-e2e-T<NN>-<slug>-design.md` and link it from the row.

## Conventions

- **Task ID**: `T<NN>` — stable, used in commit messages and PR titles. Format: `test(e2e): T05 timeline /buckets access matrix`.
- **Size hint**: number of new tests, not lines. ~5-15 per task is the target band.
- **Actor matrix**: which subset of §3.1 the task exercises. "Std space" = `anon, regularA, spaceOwner, spaceEditor, spaceViewer, spaceNonMember`.
- **Blocked by**: hard prerequisite. Anything not listed can run in parallel.

---

## Phase 0 — Cleanup & helpers (must land before everything else)

| ID  | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Size                                                     | Blocked by | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------- | ------ |
| T01 | **Cleanup**: move stray `e2e/src/api/specs/duplicate.e2e-spec.ts` → `e2e/src/specs/server/api/`. Verify it actually runs in CI. Audit `expect.poll` vs `waitForQueueFinish` for non-admin specs (memory: `feedback_e2e_admin_only_queues`). _Audit result: zero violations — all 38 callers use `admin.accessToken`. Rule currently held everywhere; no code changes needed beyond the file move._                                                                                                                                           | small                                                    | —          | [x]    |
| T02 | **Helpers**: add `Actor`, `ActorId`, `SpaceContext` types, `buildSpaceContext`, `forEachActor` in new `e2e/src/actors.ts` (composes existing `utils.ts` helpers). Extend `utils.createSpacePerson` to add the `shared_space_person_face` junction insert, `type` param, and `{globalPersonId, spacePersonId, faceId}` return shape. Includes 4 smoke tests in `_helpers.e2e-spec.ts` (auth threading + anon split + helper extension + role assignment). **Has design doc:** [T02-helpers-design.md](./2026-04-06-e2e-T02-helpers-design.md) | 4 smoke tests, ~120 lines actors.ts + ~30 lines utils.ts | T01        | [x]    |

---

## Phase 1 — Highest-leverage gaps (P0 from research doc)

### Timeline (`timeline.controller`, fully uncovered)

| ID  | Task                                                                                                                                                                                                                                                                                                                                                                 | Size     | Blocked by                  | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------- | ------ |
| T03 | **`timeline.e2e-spec.ts` — access matrix**. `GET /timeline/buckets` and `/bucket` against the std space actor matrix. Owner sees own; non-member **400** (timeline uses `requireAccess`, not `requireMembership`); non-owner members actually see space content. **Has design doc:** [T03-timeline-access-design.md](./2026-04-06-e2e-T03-timeline-access-design.md) | 10 tests | T02                         | [ ]    |
| T04 | **Timeline `withSharedSpaces` semantics**. Toggle `showInTimeline` per space, verify the UNION includes/excludes correctly. Library-linked space assets included. Adds `partner` actor + `addPartner` helper to T02's surface.                                                                                                                                       | ~6 tests | T02 (recommended after T03) | [ ]    |
| T05 | **Timeline visibility filters**. `visibility=Timeline\|Archive\|Hidden`, trash exclusion, default behaviour.                                                                                                                                                                                                                                                         | ~5 tests | T03                         | [ ]    |
| T06 | **Timeline filter passthrough with `spaceId`**. `spacePersonId` is a distinct DTO param from `personId` — passing a global `personId` on a space query is the PR #260 bug shape (silently empty or cross-pollutes). Plus `tagIds`, `country`, `make`, `rating` cross-filtered with `spaceId`.                                                                        | ~8 tests | T03                         | [ ]    |

### Faces (`face.controller`, fully uncovered)

| ID  | Task                                                                                                                                                                        | Size      | Blocked by | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- | ------ |
| T07 | **`face.e2e-spec.ts` — CRUD access matrix**. Create / list / reassign / delete with owner + non-owner. Cross-owner reassign rejected.                                       | ~10 tests | T02        | [ ]    |
| T08 | **Face deletion side effects**. Below-`minFaces` faces unaddressable (PR #139), space-person dedup queue triggered with jobId dedup (PR #292), person `assetCount` updates. | ~6 tests  | T02, T07   | [ ]    |

### Shared space — people sub-tree (`shared-space.e2e-spec.ts` extension)

| ID  | Task                                                                                                                                                                                                                                                                                                                                                                                    | Size     | Blocked by | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ------ |
| T09 | **`GET /shared-spaces/:id/people` — listing**. Std space access matrix. Excludes hidden by default + `withHidden=true` includes them. `named` filter. `petsEnabled` toggle. `limit`/`offset` pagination. Empty `thumbnailPath` excludes (the listing's hard requirement). **Has design doc:** [T09-space-people-listing-design.md](./2026-04-06-e2e-T09-space-people-listing-design.md) | 11 tests | T02        | [ ]    |
| T10 | **`GET /shared-spaces/:id/people/:personId` + thumbnail + assets**. Read-only sub-endpoints. Thumbnail returns binary via JOIN read-through (PR #196), 404 for non-member.                                                                                                                                                                                                              | ~9 tests | T02, T09   | [ ]    |
| T11 | **`PUT/DELETE /shared-spaces/:id/people/:personId`**. Rename, hide, delete. Verify viewer cannot, editor and owner can. Underlying global person untouched on delete.                                                                                                                                                                                                                   | ~7 tests | T02, T09   | [ ]    |
| T12 | **`POST /shared-spaces/:id/people/:personId/merge`**. Merge two space persons; assets move; non-merged person deleted; `assetCount` consistent.                                                                                                                                                                                                                                         | ~6 tests | T02, T09   | [ ]    |
| T13 | **`PUT/DELETE /shared-spaces/:id/people/:personId/alias`**. Per-space alias does not affect global person name; visible to all members.                                                                                                                                                                                                                                                 | ~5 tests | T02, T09   | [ ]    |
| T14 | **`POST /shared-spaces/:id/people/deduplicate`**. Triggers dedup job; jobId dedup (PR #292) — second call within window does not enqueue twice. Editor required.                                                                                                                                                                                                                        | ~5 tests | T02, T09   | [ ]    |

### Shared space — libraries sub-tree

| ID  | Task                                                                                                                                                                                                                                                     | Size     | Blocked by         | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------ | ------ |
| T15 | **`PUT /shared-spaces/:id/libraries`**. Link library. Admin owner of space can; admin editor can; non-admin owner cannot; non-member cannot. Idempotent or 409 on duplicate (pin behaviour in this PR).                                                  | ~7 tests | T02                | [ ]    |
| T16 | **`DELETE /shared-spaces/:id/libraries/:libraryId`**. Unlink. Editor/owner can; viewer cannot; non-existent link → 404.                                                                                                                                  | ~5 tests | T02, T15           | [ ]    |
| T17 | **Library link side effects**. After link, library assets visible to space members via `/timeline/buckets?spaceId=`, `/assets/:id/thumbnail`, `getSpacePeople`. After unlink, hidden. Cascades on `deleteLibrary`. Soft-deleted / offline assets hidden. | ~8 tests | T02, T15, T03, T05 | [ ]    |

---

## Phase 2 — Fork-only, smaller surfaces (P1 from research doc)

| ID  | Task                                                                                                                                                                         | Size      | Blocked by | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- | ------ |
| T18 | **`gallery-map.e2e-spec.ts` — access matrix + filters**. Auth, owner happy path, all filter parameters (people/tags/country/city/make/model/rating/dates/favorite/archived). | ~12 tests | T02        | [ ]    |
| T19 | **`gallery-map` — space scoping**. `spaceId` access matrix + space-linked library visibility + hidden persons exclusion (PR #202).                                           | ~6 tests  | T02, T18   | [ ]    |
| T20 | **`map.e2e-spec.ts` — space scoping extension**. Add `spaceId` matrix + space-linked library + visibility filters to existing spec.                                          | ~6 tests  | T02        | [ ]    |
| T21 | **`view.e2e-spec.ts`**. `GET /view/folder/unique-paths`, `GET /view/folder`. Owner-scoped. Verify intent: does folder browse leak space-linked library paths?                | ~8 tests  | T02        | [ ]    |
| T22 | **`workflow.e2e-spec.ts`**. CRUD access matrix, owner scoping, validation (bad trigger ID, circular refs), update propagation.                                               | ~12 tests | T02        | [ ]    |

---

## Phase 3 — Asset extensions (P2 from research doc)

These split `asset.e2e-spec.ts` into separate small specs to avoid 2k-line files.

| ID  | Task                                                                                                                                                                                               | Size      | Blocked by | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- | ------ |
| T23 | **`asset-metadata.e2e-spec.ts`** (new file). `GET/PUT /assets/:id/metadata` + `/:key`, bulk `PUT/DELETE /assets/metadata`. Cross-owner read denied; space member can read but viewer cannot write. | ~12 tests | T02        | [ ]    |
| T24 | **`asset-ocr.e2e-spec.ts`** (new file). `GET /assets/:id/ocr`. Access matrix. Returns text for processed asset, 404 for unprocessed.                                                               | ~6 tests  | T02        | [ ]    |
| T25 | **`asset-edits.e2e-spec.ts`** (new file). `GET/PUT/DELETE /assets/:id/edits` for non-trim actions (existing `video-trim.e2e-spec.ts` covers trim only). Combination rules.                         | ~8 tests  | T02        | [ ]    |
| T26 | **`asset-copy.e2e-spec.ts`** (new file). `PUT /assets/copy`. New asset created, owner quota incremented, EXIF retained, source-not-visible rejection.                                              | ~6 tests  | T02        | [ ]    |
| T27 | **Asset replace + jobs + bulk-upload-check**. Folded into `asset.e2e-spec.ts` extension. `PUT /assets/:id/original`, `POST /assets/jobs`, `POST /assets/bulk-upload-check`.                        | ~8 tests  | T02        | [ ]    |
| T28 | **`GET /assets/:id/video/playback` + `GET /assets/device/:deviceId`**. Folded into `asset.e2e-spec.ts` extension. Smaller surface, low priority.                                                   | ~5 tests  | T02        | [ ]    |

---

## Phase 4 — Config-driven features (P2 from research doc)

| ID  | Task                                                                                                                                                                                                            | Size      | Blocked by | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- | ------ |
| T29 | **`classification.e2e-spec.ts` — effects**. SystemConfig round-trip + scan → category tag appears. Disabled in config = no-op. Smart re-scan on similarity / prompts change (PR #235).                          | ~8 tests  | T02        | [ ]    |
| T30 | **`system-config.e2e-spec.ts` — full coverage**. Read defaults, partial update validation, `IMMICH_CONFIG_FILE` lock (PR #297), `machineLearning.clip.maxDistance` (PR #294), shared-space defaults round-trip. | ~10 tests | T02        | [ ]    |

---

## Phase 5 — Smaller fillers (P2/P3 from research doc)

| ID  | Task                                                                                                                                               | Size      | Blocked by | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- | ------ |
| T31 | **`notification.e2e-spec.ts`**. CRUD on `/notifications` and `/admin/notifications`. Owner-scoped + admin-only routes.                             | ~12 tests | T02        | [ ]    |
| T32 | **`plugin.e2e-spec.ts`**. Read-only listing. Auth + assert fork-bundled plugins (classification, pet-detection, etc.) appear in the list.          | ~6 tests  | T02        | [ ]    |
| T33 | **Search sort order tests**. Two-phase CTE sorting (PR #254) — no current coverage. Adds describe block to existing `search.e2e-spec.ts`.          | ~6 tests  | T02        | [ ]    |
| T34 | **Tag suggestions over space content**. `withSharedSpaces=true` on `/search/suggestions/tags` (PR #230). Adds describe block to `tag.e2e-spec.ts`. | ~5 tests  | T02        | [ ]    |
| T35 | **Person search global vs space-scoped**. `searchPerson` and `reassignFaces` for face in space asset.                                              | ~6 tests  | T02        | [ ]    |

---

## Phase 6 — Long tail (P3 from research doc)

| ID  | Task                                                                                                                      | Size      | Blocked by | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- | ------ |
| T36 | **`queue.e2e-spec.ts`**. New `/queues/*` admin controller (existing `jobs.e2e-spec.ts` covers only deprecated `/jobs/*`). | ~10 tests | T02        | [ ]    |
| T37 | **`notification-admin.e2e-spec.ts`**. Admin notification + email templates.                                               | ~6 tests  | T02        | [ ]    |
| T38 | **`sync.e2e-spec.ts`**. Full + delta + ack flow. Mobile-only consumer.                                                    | ~12 tests | T02        | [ ]    |
| T39 | **`auth.e2e-spec.ts` extension**. change-password, pin-code lifecycle, session lock/unlock.                               | ~10 tests | T02        | [ ]    |

---

## Decision log

Choices the team made (as opposed to facts observed about the code — see "Observed invariants" below).

- **2026-04-06 — Helper API shape (T02)** — chose `forEachActor(actors, run, expected)` over `it.each` per actor; `run` callback returns supertest `Response` directly. Smoke test at `_helpers.e2e-spec.ts` (underscore prefix groups it at the top of the directory listing). See [T02-helpers-design.md](./2026-04-06-e2e-T02-helpers-design.md).
- **2026-04-06 — `forEachActor` throws Error not `expect` (T02)** — failure messages must include the actor ID. The native `expect(status).toBe(exp)` doesn't surface which actor failed. Custom `Error` does. Affects every downstream spec's debugging UX.
- **2026-04-06 — Minimal `ActorId` (T02)** — ship only the 8 actors that the upfront 3 designs consume. `partner`, `libraryOwner`, `apiKey*`, `sharedLink` get added with their first consumer task. No `utils.ts` re-export.
- **2026-04-06 — Fixture lifetime (T02)** — `buildSpaceContext` returns read-only fixtures bound in `beforeAll`. Tests that need mutation create their own resources with cleanup, OR snapshot+mutate+restore in try/finally.
- **2026-04-06 — Extend `utils.createSpacePerson` rather than create a parallel helper (T02)** — the existing helper at `utils.ts:544` already does most of what we need. T02 extends it (junction insert + return shape + type param) instead of duplicating it under a new name in `actors.ts`. `buildSpaceContext` similarly composes existing `utils.userSetup`/`createSpace`/`addSpaceMember` rather than reinventing.
- **2026-04-06 — Space person ID semantics (T09)** — space `personId` ≠ global `personId`; tests must always derive the path parameter from `createSpacePerson`'s returned `spacePersonId`, never from the global `personId`.
- **2026-04-06 — Smoke test must validate role assignment (T02)** — `/server/ping` and `/users/me` are not enough to prove `buildSpaceContext` assigns roles correctly (both return 200 regardless). Smoke test 3 probes `PATCH /shared-spaces/:id` with `{thumbnailCropY: 0}` (Editor-level — name/description/color/faceRecognitionEnabled/petsEnabled would require Owner per `shared-space.service.ts:197-203`). Editor + Owner pass; Viewer is rejected.

## Observed invariants

Facts about the server code that the tests pin. Distinct from decisions because the team didn't choose them — the existing implementation did. Listed here so future PRs can verify they're still true.

- **`shared_space_person_face` is the load-bearing junction** — `getPersonsBySpaceId` reads `representativeFaceId` directly, but `getPersonAssetIds`, `reassignPersonFaces`, `isPersonFaceAssigned`, `getPersonsForDedup`, the `takenAfter`/`takenBefore` EXISTS subquery, and `faceCount`/`assetCount` denormalization all traverse the junction. T02's helper extension inserts it. Verified at `shared-space.repository.ts:599-1000`.
- **`person.thumbnailPath IS NOT NULL AND != ''` is the listing's hard requirement** — the fork's "minFaces gate" mechanism. In production the dedup job sets it after enough faces; in tests `createSpacePerson` sets it directly. Verified at `shared-space.repository.ts:512-513`. T09 test 11 protects it.
- **400 vs 403 for non-member is endpoint-family-dependent** — timeline-family endpoints route through `requireAccess` and throw `BadRequestException` (400). Shared-space-family endpoints route through `requireMembership` and throw `ForbiddenException` (403). Tests pin to whichever the endpoint actually uses. Verified at `src/utils/access.ts:37-42` and `shared-space.service.ts:1166-1180`.
- **`shared-space-person.dto.ts` query params are `limit`/`offset`/`withHidden`/`named`/`takenAfter`/`takenBefore`** — no `top`, no text-based `name` search. Verified at `shared-space-person.dto.ts:6-40`.
- **`TimeBucketDto` has no `size` parameter** — buckets are always monthly. Verified at `time-bucket.dto.ts:9-144`.
- **`TimeBucketDto` exposes `spacePersonId` and `spacePersonIds` as distinct fields from `personId`/`personIds`** — passing a global `personId` against a space query is the PR #260 bug shape. T06 probes this directly.
- **`PATCH /shared-spaces/:id` has a split role requirement** — metadata fields (`name`, `description`, `color`, `faceRecognitionEnabled`, `petsEnabled`) require Owner; thumbnail / cover-photo fields (`thumbnailAssetId`, `thumbnailCropY`) require only Editor. Verified at `shared-space.service.ts:197-204`. T11 (PUT space-person) inherits the same pattern check; tests must use the right field for the role being probed.
- **Stable space-people sort across paginated calls** — T09's test 10 pins it. T10–T12 inherit the assumption.

## Open hypotheses

Things the upfront designs claim about server behaviour but cannot verify themselves. The first task that can verify resolves them.

- **`hidden` and `pets` filters at listing level only** — `GET /shared-spaces/:id/people` excludes them, but `GET /shared-spaces/:id/people/:personId` against a hidden/pet-when-disabled person should still return 200. **Resolved by:** T10.

---

## Out of scope

- **Mobile / Flutter API tests.** Mobile uses the same controllers but exercises them through generated Dart clients. The API e2e suite covers the contract; mobile-specific behaviour is its own pyramid.
- **Component tests in `web/`.** Some of the gaps could be covered by Vitest component tests with mocked SDKs. The trade-off (memory: `feedback_e2e_mock_filterpanel`) is unreliability for FilterPanel-shaped components. Default to API e2e for access-control work; component tests stay reserved for pure rendering logic.
- **Retrofitting helpers into existing specs.** Existing specs work fine. They get the helper treatment opportunistically when touched for other reasons.
- **CI gate enforcing "every new endpoint has an e2e test".** Worth considering after the backlog drains, not before.
