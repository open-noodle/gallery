# Dissolve a person — design

Status: proposed
Date: 2026-09-06
Surface: admin face cleanup console (`/admin/face-cleanup`)

## Problem

Users report people that have become "contaminated": a person accumulates thousands of faces that are not
that person, frequently crops of non-person objects. Once a person reaches this state the user has no way
out. Every existing repair tool is blind to the faces causing it.

The goal is not to find the source bug. The goal is to give an admin a way to dissolve such a person and
have the library repair itself on the next detection/recognition run.

## Findings (verified against the code, not assumed)

The face cleanup console, the scan, manual review and "Reset all people" are **all** restricted to
machine-learning faces that have an embedding. Faces imported from file metadata satisfy neither condition.

| Mechanism                                       | Why it cannot see the contaminating faces                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| "Reset all people" (force recognition)          | `unassignFaces({ sourceType: MachineLearning })` — `person.service.ts:1076`. A comment at `:1147` concedes EXIF personIds survive. |
| Recognition fan-out                             | `getAllFaces` filters `sourceType: MachineLearning` on **both** the force and non-force arms — `person.service.ts:1113`.           |
| Cleanup scan / manual review                    | Every query in `face-repair.repository.ts` is `innerJoin('face_search')` **and** `sourceType = 'machine-learning'` (`:224-226`).   |
| Ever gaining an embedding                       | Only if ML detection later lands a box at IoU > 0.5 on the same region — `person.service.ts:967`. A region over a lamp never will. |
| `DELETE /people/:id`                            | `asset_face.personId` is `ON DELETE SET NULL`. The junk rows outlive the person as invisible orphans — strictly worse.             |

Where they come from: `applyTaggedFaces` (`metadata.service.ts:1039`) turns every `RegionInfo` region in a
file into an `asset_face` row with `sourceType: 'exif'`, auto-creating a person per distinct region name,
gated on `metadata.faces.import` (default `false`, so affected users enabled it). `orientRegionInfo`
(`:975`) rotates each box by EXIF orientation — correct names with mis-rotated boxes would produce exactly
the reported symptom. **Not in scope to fix here**, but it dictates that dissolve must be source-aware.

**Consequence for the design:** the two contamination causes need opposite treatments.

- **EXIF-sourced junk has no vector.** It can never be re-clustered. Deleting the rows *is* the repair.
- **ML mis-clustering has vectors.** Those rows must survive and be re-clustered.

A single "dissolve" button cannot serve both. Scope and outcome are separate axes.

### The repair mechanism

`streamForDetectFacesJob` skips assets on `job_status.facesRecognizedAt IS NULL` **only when `force === false`**
(`asset-job.repository.ts:458`). Clearing `facesRecognizedAt` for just the dissolved assets therefore makes
the ordinary non-forced "Detect faces (missing)" pass re-process exactly those photos and nothing else.
Detection then writes fresh ML faces with embeddings and itself queues
`FacialRecognitionQueueAll { force: false }` (`person.service.ts:1003`), so clustering follows automatically.

## Scope

Decided:

- **Admin console only.** Consistent with manual review mode being admin-only.
- **Personal people only.** Space people are a projection; dissolving the underlying personal person is what
  repairs the space view.
- **Delete + warn inline.** No tombstone table, no silently flipping the global `metadata.faces.import`
  setting from inside a person-scoped action. The console warns and links to the setting.
- **Dry-run preview, then irreversible.** No undo page, no retention window.

Non-goals, recorded so they are not rediscovered as omissions: space people; undo; blocking re-import;
an owner-facing surface; fixing the EXIF import bug; pet people (see L6).

## Design

### 1. Discovery

Contaminated people are currently unreachable in the console: `GET /admin/face-repair/owner/:ownerId/people`
is only the move-to-chosen-person **picker search**, and a scan never flags an EXIF face. Discovery is part
of the feature, not a nicety.

`GET /admin/face-repair/people` — admin, paged, `ownerId?`, `sort=exifFaces|facesWithoutEmbedding|faceCount`.
Per person: `id`, `name`, `ownerId`, `faceCount`, `bySource: { machineLearning, exif, manual }`,
`facesWithoutEmbedding`. One `GROUP BY person.id` over `asset_face` left-joined `face_search`, filtered
`deletedAt IS NULL AND isVisible`.

Surfaced on the existing `/admin/face-cleanup/people` page (the #838 browse-people surface, which already
renders a face count) as extra columns plus a sort — no new route. The dashboard gains a banner:
_"Import faces from metadata is ON. 4 people have 3,180 metadata-imported faces with no matching detection."_

### 2. Preview

`POST /admin/face-repair/person/:personId/dissolve/preview`, same body as apply. Returns the affected face
count split by `sourceType` × has-embedding, affected asset count, **assets shared with other people**
(see L3), **assets that cannot be re-detected** (see L11), sample crops via the existing
`faces/:assetFaceId/thumbnail`, and `warnings[]`.

Four warnings are load-bearing honesty rather than decoration:

- On N assets the junk will be deleted but **nothing will be recovered**, because they are hidden, trashed
  or have no preview file (L11).

- Unassigning EXIF faces **strands** them — no embedding means `getAllFaces` never fans them out again.
- Unassign leaves the person with zero faces; the nightly `PersonCleanup` will delete it regardless. We do
  not trigger that ourselves (L2), but we must not imply the person survives.
- Unassigned ML faces re-cluster from scratch, which changes the outcome **only** if recognition settings
  changed. Otherwise expect a similar grouping.

### 3. Operations

`POST /admin/face-repair/person/:personId/dissolve`

```ts
{
  scope: 'all' | 'exif' | 'machine-learning' | 'without-embedding',
  outcome: 'unassign' | 'delete-faces' | 'delete-faces-and-person',
  redetect: boolean,          // forced true for delete outcomes
  expectedFaceCount: number,  // 409 if drifted since preview
}
```

`expectedFaceCount` is the concurrency guard: the preview response returns it and the client passes it back
unchanged. Because the operation is irreversible, an apply must never act on a different set than the one
previewed. `redetect` is forced to `true` for both delete outcomes; an explicit `false` alongside a delete
outcome is a 400 rather than a silent override, so a client can never believe it opted out.

- **unassign** — `personId = NULL` on matching faces, **plus** delete their `face_identity_face` rows. Skipping
  the second half is the exact bug documented at `person.repository.ts:327`: stale manual links make faces
  permanently settled, excluded from recognition and suggestions forever.
- **delete-faces** — single indexed `DELETE`; the six `ON DELETE CASCADE` FKs do the rest.
- **delete-faces-and-person** — plus the person row and a `FileDelete` for `thumbnailPath` (mirrors
  `removeAllPeople`), skipped when the path is empty (L7).

Deliberately **not** writing negative `face_person_verdict` rows on unassign. Negatives are the face-by-face
layer from the review unification work; 3,000 of them is the wrong tool. Dissolve is the bulk reset.

### 4. Execution

Synchronous, one Kysely transaction, no job and no new table. `asset_face_audit` is `scope: 'statement'`
with a transition table, so a bulk delete emits **one** `INSERT ... SELECT` rather than one per row — a
single indexed delete handles tens of thousands of rows well under a second. Chunking buys nothing.

Pass `trx` through explicitly; never `this.db` inside the transaction.

**Ordering constraint — getting this backwards silently no-ops the entire feature:** clear
`facesRecognizedAt` *before* the delete, because afterwards there is no `personId` left to find the assets by.
For the same reason, capture the affected `shared_space_person` ids (L1) before the delete too — afterwards
the `shared_space_person_face` rows that identify them are already gone.

```sql
UPDATE asset_job_status SET "facesRecognizedAt" = NULL
WHERE "assetId" IN (SELECT DISTINCT "assetId" FROM asset_face WHERE "personId" = $1 AND <scope>);

DELETE FROM asset_face WHERE "personId" = $1 AND <scope>;
```

Then queue, outside the transaction: `PersonGenerateThumbnail` for surviving people whose `faceAssetId` was
nulled, and `AssetDetectFacesQueueAll { force: false }` when `redetect`.

**No migration.** All six referencing FKs already cascade; nothing new is stored.

### 5. Web

`DissolvePersonModal.svelte` under `web/src/routes/admin/face-cleanup/[personId]/`, opened from the page
header: scope/outcome controls, debounced preview, warnings, sample crops, typed confirmation (the person's
name) before apply. Quick-select chips map the three original mental-model options onto the two axes:

| Chip                            | scope   | outcome                   | redetect |
| ------------------------------- | ------- | ------------------------- | -------- |
| Remove imported metadata faces  | `exif`  | `delete-faces`            | true     |
| Start this person over          | `all`   | `delete-faces`            | true     |
| Delete person and its faces     | `all`   | `delete-faces-and-person` | true     |

### 6. i18n

New keys under the existing `admin.face_cleanup_*` namespace (251 keys already), inserted alphabetically, in
all nine locales in the same commit — `de fr it nl pl es ru zh_Hans zh_Hant` — informal in de/it/es, formal
in fr/ru. Then `npx prettier --write i18n/*.json`.

## Blast radius

A dissolve writes to `asset_face`, six cascading tables and `asset_job_status`. Each path below is a way the
operation could reach data outside the target person. Every one has a named test in the matrix.

| #   | Leak path                                                                                                                                                                                                                             | Decision                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | `sharedSpaceRepository.deleteAllOrphanedPersons()` is **unscoped**: `DELETE FROM shared_space_person WHERE id NOT IN (SELECT "personId" FROM shared_space_person_face)` (`shared-space.repository.ts:4090`) — instance-wide.             | **Do not call.** Capture affected `shared_space_person` ids before the delete; remove only those left with zero faces.                            |
| L2  | `PersonCleanup` uses `getAllWithoutFaces()` — library-wide. Queuing it makes our dissolve delete unrelated faceless people.                                                                                                              | **Do not queue.** `delete-faces-and-person` deletes the one target person directly. The nightly job handles the rest on its own schedule.         |
| L3  | Clearing `facesRecognizedAt` on an asset that also holds **other people's** faces re-detects that asset; `handleDetectFaces` hard-deletes any ML face not re-matched at IoU > 0.5 (`faceIdsToRemove` + `unlinkFaces`, `person.service.ts:990`). | **Cannot be prevented without abandoning the repair** — junk regions usually sit on photos that do contain real people. Surface the shared-asset count in the preview; test that still-matching faces survive. |
| L4  | Deleting `face_identity_face` by `identityId` would wipe manual links for other people sharing that identity after a merge.                                                                                                              | Key the delete by **our face ids only**, never by identity.                                                                                      |
| L5  | `faceIdentityRepository.deleteUnreferencedIdentities()` is a global GC.                                                                                                                                                                 | **Do not call.** Leave to the existing maintenance job.                                                                                          |
| L6  | Pet faces use `pet_search`, not `face_search`, so `scope: 'without-embedding'` matches **every pet face** of a pet person.                                                                                                              | Exclude pets with `petFacePredicate` (`utils/database.ts:1512`) on every scope; reject `person.type = 'pet'` with 400.                            |
| L7  | `FileDelete` queued with an empty `thumbnailPath`.                                                                                                                                                                                     | Skip the job when the path is empty.                                                                                                             |
| L8  | Another user's people/faces.                                                                                                                                                                                                           | Scope by `personId` only; assert non-interference explicitly.                                                                                    |
| L9  | `face_person_verdict` drain on unassign.                                                                                                                                                                                               | Scope to the affected face ids.                                                                                                                  |
| L10 | Partial failure leaving faces deleted but the person alive (or vice versa).                                                                                                                                                            | One transaction; assert full rollback.                                                                                                           |
| L11 | `streamForDetectFacesJob` runs through `assetsWithPreviews()` (`asset-job.repository.ts:181`), requiring `visibility != Hidden`, `deletedAt IS NULL` and an existing `Preview` `asset_file`; `handleDetectFaces` gates again on `files.length === 1` and skips Hidden. On such assets the junk is deleted and **nothing is recovered**. | Cannot be repaired here. Count them in the preview and warn explicitly. Never claim repair for assets that cannot be re-detected. |
| L12 | `getForDetectFacesJob`'s faces subquery has **no `deletedAt` filter** (`asset-job.repository.ts:246`), so a soft-deleted face still matches a fresh detection at IoU > 0.5, absorbs the embedding and stays soft-deleted — swallowing the real face and creating no visible one. | Delete outcomes **hard-delete** soft-deleted faces in scope, so re-detection can create a fresh visible face. `unassign` leaves them alone. |
| L13 | A dissolve deleting faces underneath a running recognition pass races it.                                                                                                                                                              | Refuse with `ConflictException`, mirroring `face-repair.service.ts:572`.                                                                          |

## Implementation — TDD

Every slice is red first. No production line is written before a test that fails for the right reason, and
each slice states the failure it must produce before the fix. Assertions must be able to fail: no `queryBy`
that passes whether or not the element exists.

**Slice 1 — scope predicate.** Unit-test the `scope` → Kysely predicate mapping in isolation, including pet
exclusion (L6) and the soft-deleted/invisible decisions below. Red: predicate does not exist.

**Slice 2 — `clearFacesRecognizedAt` repository method.** Medium test proving that after the call,
`streamForDetectFacesJob(false)` yields exactly the affected assets. Red: method does not exist.

**Slice 3 — the ordering constraint.** Medium test that runs the dissolve and asserts affected assets are
re-detectable. Deliberately implement the delete first to watch it fail, then reorder. This is the test that
proves the feature works at all.

**Slice 4 — cascade coverage.** Medium test asserting the six cascades fire and the three `SET NULL` columns
null out.

**Slice 5 — blast radius (L1–L13).** The isolation fixture below. Red before any scoping is applied.

**Slice 6 — outcomes and follow-up jobs.** Unit tests for outcome branching, `expectedFaceCount` 409, pet
rejection, empty-thumbnail skip, the active-recognition refusal (L13), and exactly which jobs are queued
(and that L1/L2/L5 are **not**).

**Slice 7 — preview endpoint.** Its own slice because for an irreversible operation the preview *is* the
safety mechanism: counts by source × embedding, shared-asset count (L3), non-re-detectable count (L11), and
each of the four warnings. A wrong preview is as harmful as a wrong delete. Red: endpoint does not exist.

**Slice 8 — discovery endpoint.** Unit + medium for the aggregate and sort.

**Slice 9 — web modal.** Component tests for scope/outcome → preview payload, confirmation gating, and
warning rendering.

**Slice 10 — e2e.** One Playwright run dissolving an EXIF-contaminated person end to end.

Codegen and gates, per slice rather than deferred to the end:

- Touching `server/src/repositories/` means `mise sql` must be re-run — body edits drift the generated
  queries too, not just signatures.
- New endpoints mean `mise open-api` (not `make`), then the web SDK build.
- Server lint is `--max-warnings 0`, and `prettier --check` runs over `src/` **and** `test/` separately;
  eslint passing is not evidence prettier will.
- i18n changes touch all nine locales in the same commit, then `npx prettier --write i18n/*.json`.

## Test matrix

### The isolation fixture (`dissolve-blast-radius`)

One fixture, reused by every isolation test, built so that a missing `WHERE` clause cannot pass:

- **User A**, target person **P1** — 3 EXIF faces without embeddings, 2 ML faces with embeddings, 1 soft-deleted face.
- **User A**, unrelated person **P2** — 2 ML faces, one of them **on an asset it shares with P1**.
- **User A**, pet person **P3** — pet faces with `pet_search` rows and no `face_search` rows.
- **User A**, faceless person **P5** — proves no global cleanup is triggered (L2).
- **User B**, person **P4** — own assets, must be untouched (L8).
- A shared space over some of A's assets, with space persons projecting P1 **and** P2, plus a space person
  already orphaned before the run (L1).
- A `face_identity` shared by a P1 face and a P2 face, P2's carrying `source='manual'` (L4).
- Assets: one with only P1 faces; one with **P1 + P2** faces; one with only P2 faces.

### Medium (real DB) — where this feature is actually proven

Mocked repositories cannot see cascades or the re-detect gate, which are the whole design.

| Test                     | Asserts                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `redetect-gate`          | After dissolve, `streamForDetectFacesJob(false)` yields **exactly** the dissolved assets — no more, no fewer.                                     |
| `cascades`               | Matching `face_search`, `face_identity_face`, `face_person_verdict`, `face_repair_decline`, `pet_search`, `shared_space_person_face` rows removed. |
| `set-null`               | `person.faceAssetId`, `face_identity.representativeFaceId`, `shared_space_person.representativeFaceId` null out.                                  |
| `sync-tombstones`        | `asset_face_audit` receives one row per deleted face, so mobile clients see the deletion.                                                          |
| `isolation-P2`           | Every P2 face, its `face_identity_face` (incl. `source='manual'`), and its verdicts survive — **including on the shared asset**.                   |
| `isolation-P3-pets`      | No pet face touched under any scope, `without-embedding` included (L6).                                                                            |
| `isolation-P4-otheruser` | User B's faces, people and job status untouched (L8).                                                                                              |
| `isolation-P5-cleanup`   | The unrelated faceless person still exists — no global cleanup ran (L2).                                                                           |
| `isolation-space-orphan` | The pre-existing orphaned space person still exists; only space persons orphaned **by this dissolve** are removed (L1).                            |
| `identity-not-gc`        | `face_identity` rows referenced elsewhere survive; no global identity GC ran (L5).                                                                 |
| `shared-asset-redetect`  | After re-detection of a shared asset, P2 faces that still match at IoU > 0.5 keep their identity and gain a refreshed embedding (L3).              |
| `rollback`               | A forced failure after the face delete leaves **every** row intact (L10).                                                                          |
| `not-redetectable`       | A hidden asset, a trashed asset and one with no `Preview` file are counted by the preview and **excluded** from any repair claim (L11).            |
| `soft-deleted-hard-gone` | A soft-deleted face in scope is hard-deleted by delete outcomes, so re-detection yields a fresh **visible** face rather than reviving a tombstone (L12). |

### Edge cases

| Case                                          | Expected                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| Person has zero faces                         | 200, no-op, preview says nothing to do                                       |
| `expectedFaceCount` drifted                   | 409, **nothing** modified (assert row counts unchanged)                       |
| Person not found / wrong id                   | 404                                                                          |
| Person is a pet (`type='pet'`)                | 400 — pet re-detection is a separate pipeline; `facesRecognizedAt` would not repair it |
| Empty `thumbnailPath` on person delete        | No `FileDelete` queued (L7)                                                   |
| Soft-deleted faces (`deletedAt` not null)     | **Hard-deleted** by delete outcomes — required, not tidiness (L12); left alone by `unassign`; excluded from displayed counts |
| `isVisible = false` faces                     | Same as soft-deleted                                                          |
| Facial recognition queue active               | 409 `ConflictException`, mirroring `face-repair.service.ts:572` (L13)          |
| Every affected asset hidden / trashed / no preview | 200, but the preview states nothing will be recovered (L11)              |
| `scope: 'without-embedding'` where all faces have embeddings | 200, zero affected                                             |
| Admin dissolving another user's person        | Allowed (the console is cross-user by design); only that person's faces change |
| `scope: 'exif'` on a person with only ML faces | 200, zero affected, preview says so                                          |
| `redetect: false` with a delete outcome       | 400 — never a silent override                                                |
| Non-admin caller                              | 403                                                                          |
| Concurrent dissolve of the same person        | Second gets 409 via `expectedFaceCount`                                       |

### Unit / web / e2e

Unit: scope→predicate, outcome branching, the 409 guard, pet rejection, and exactly which jobs are and are
not queued. Web: modal scope/outcome → preview payload, confirmation gating, warning rendering. E2E: one
Playwright run dissolving an EXIF-contaminated person.

## Risks

1. **The feature rests on `.$if(force === false, …)`.** The `facesRecognizedAt` filter applies only when
   `force` is explicitly `false`; `undefined` skips it and re-detects the whole library. Pin the exact caller
   the console triggers and cover it in `redetect-gate`.
2. **L3 is a real, accepted data-loss path.** Re-detecting a shared asset can remove another person's ML face
   if the detector no longer finds it. Accepted because the alternative is skipping repair on exactly the
   photos that need it; mitigated by surfacing the shared-asset count.
3. **`redetect` on an ML-scope dissolve discards good embeddings** to re-derive them. Correct but expensive.
4. **The discovery aggregate is library-wide.** The people page has been bitten by PG JIT before; measure on
   the personal clone rather than assume.

## Rollout

Ship behind the existing admin gate; no feature flag. Validate on a personal clone against a real library
before release, since the reported symptom only exists at scale.
