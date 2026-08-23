# Space face clustering — design

## Context

Issue [#272](https://github.com/open-noodle/gallery/issues/272) reports that a shared-space person ("Paul") shows 57,577 photos while the same user's global People view shows only 20,436 — and many of the extra assignments look wrong.

Investigation confirmed the root cause is a difference in clustering algorithms between the native People pipeline and the shared-space pipeline:

- **Native** (`person.service.ts:handleRecognizeFaces`) uses density-based clustering: a face only joins a cluster if it has at least `minFaces` neighbours within `maxDistance`. Non-core faces are deferred. This prevents chain growth.
- **Shared space** (`shared-space.service.ts:processSpaceFaceMatch`) uses single-linkage clustering against existing space-person faces: any face within `maxDistance` of _any one_ existing cluster face gets attached. Over time this causes clusters to drift and absorb unrelated faces ("chaining").

Two additional contributing bugs make the discrepancy visible and hard to reason about:

- `shared_space_person.assetCount` (and the `hasAnySpacePerson` helper) do not filter by `asset.visibility`, `asset.deletedAt`, `asset_face.deletedAt`, or `asset_face.isVisible`. The native `person.repository.getStatistics` query does. Trashed, archived, hidden-view, and invisible-face assets inflate the space count even when the same asset would be excluded from the native count.
- Nothing removes space-person face mappings when an asset is trashed or has its visibility changed. Only explicit "remove from space" and hard deletes (via FK cascade) clean up.

## Goals

- Space-person clusters must contain only faces that native recognition has already density-validated.
- Space-person counts and filtered queries must match the rules used by the native People view.
- Admins must have a simple, documented recovery path to fix existing corrupted clusters.

## Non-goals

- No automatic data migration on upgrade. Users who want to clean up existing clusters run admin → Jobs → Facial Recognition → Force.
- No per-space "rebuild" button. Force recognition covers the whole instance; adding a finer-grained tool is not needed for the reported issue.
- No change to pet clustering. Pets already require a global `personId` to join a space-person; they are not affected by this bug.
- No change to the cross-pass dedup job. The existing `handleSharedSpacePersonDedup` continues to bridge cross-owner clusters after matching.

## Design

### 1. Strict algorithm for space face matching

Rewrite the inner loop of `processSpaceFaceMatch` for ML (non-pet) faces so that a face **must** have a global `personId` before it can join a space-person. The only way a face's `personId` gets set is through native recognition, which already enforces the density requirement. This guarantees every face in a space-person is part of a density-validated cluster, eliminating chaining.

New order of checks per ML face:

1. Skip if `asset_face` is already mapped to a space-person in this space (`isPersonFaceAssigned`).
2. **Skip if `face.personId` is null.** This is the new gate. A face only acquires a `personId` after native recognition has either (a) density-validated it as a core face, or (b) inherited a `personId` from a density-validated neighbour on the deferred pass (`person.service.ts:516-530`). Either path means a validated cluster is vouching for the face. Genuinely orphaned non-core faces (no neighbours, no inherited personId) are the ones we skip.
3. **Layer 1 (same personId):** call `findSpacePersonByLinkedPersonId(spaceId, face.personId)`. If a space-person already contains faces from this global person, attach the new face to that space-person. This is the common case for single-owner spaces and for subsequent uploads from the same user.
4. **Layer 2 (cross-owner bridging):** call `findClosestSpacePerson(spaceId, embedding, { numResults: 1, maxDistance })`. If a match exists, attach to that space-person. This is how Alice's "Dad" and Bob's "Dad" — two separate global `personId` records — end up in a single space-person. Chaining is bounded here because both sides of the bridge are already density-validated native clusters.
5. **Layer 3:** create a new space-person whose `representativeFaceId` is the current face, and attach the face.

Pet faces keep their current logic unchanged (they already gate on `personId`).

**Layer ordering is different from today — this is intentional.** The current code runs the embedding match first and only falls back to a `personId` lookup when creating a new space-person. Under the new order, a face is always attached to the space-person of its own `personId` (Layer 1) even if some other space-person has a numerically closer face via Layer 2. This gives stable behaviour: once a face is clustered natively, every future face from that same native cluster ends up in the same space-person, independent of who else is nearby in embedding space. It also makes the common single-owner case a single indexed lookup instead of a vector search.

**Why not also require a density check at Layer 2?** Native density already ran on each side of the bridge before we got there. A Layer 2 false positive would require an entire native cluster to be near another entire native cluster by coincidence, which is much rarer than the face-by-face chaining the current code suffers from. If we later see false positives at Layer 2, we can tighten the threshold or add centroid comparison without breaking this design.

**A residual drift mechanism remains and is accepted.** `findClosestSpacePerson` walks every face in every space-person's mapping, so once Layer 2 has bridged native clusters P1 and P2 into space-person X, a future face from a third unrelated native cluster P3 whose embedding lands within `maxDistance` of any P2 face (but not any P1 face) will also bridge into X. Over time X can grow via chained jumps P1 → P2 → P3 → P4. Each individual jump is a "native cluster to native cluster" event, so the drift is dramatically slower than today's face-by-face chaining — but it is not impossible. Centroid- or medoid-based Layer 2 matching is the follow-up that closes this.

### 2. Force recognition wipes space-person state

**No queue-drain change is needed — and adding one would deadlock.** An earlier version of this design proposed adding `QueueName.FacialRecognition` to `waitForQueueCompletion`. That would deadlock: `handleQueueRecognizeFaces` itself runs on the `FacialRecognition` queue (`person.service.ts:405`), and `waitForQueueCompletion` polls `isActive`, which uses `queue.getActiveCount()` — the count includes the running job. It would wait for itself.

The race is avoided for a different reason: `FacialRecognition` has fixed concurrency 1. It is explicitly excluded from `ConcurrentQueueName` (`types.ts:170-177`) and from `isConcurrentQueue` (`queue.service.ts:265-273`), and BullMQ's default worker concurrency is 1 when not overridden. So while Force is running it is the **only** job on that queue. Every space face-match job type (`SharedSpaceFaceMatch`, `SharedSpaceLibraryFaceSync`, `SharedSpaceFaceMatchAll`, `SharedSpacePersonDedup`) shares the same queue, so any already-queued ones sit in FIFO behind Force and read the wiped state when they finally run.

**Wipe.** When `handleQueueRecognizeFaces` runs with `force: true`, after the existing `unassignFaces` + `handlePersonCleanup` block, also:

- Delete every row from `shared_space_person_face`.
- Delete every row from `shared_space_person`.

Add two repository methods:

- `SharedSpaceRepository.deleteAllPersonFaces()`
- `SharedSpaceRepository.deleteAllPersons()`

Order matters only for FK safety; `shared_space_person_face` has `onDelete: 'CASCADE'` from both FKs, so deleting either table first works, but we delete the face mapping first for clarity.

**Re-populating the space after the wipe.** The ML-face re-clustering path works naturally: `unassignFaces({ sourceType: MachineLearning })` clears native personIds, each face is re-queued through `handleRecognizeFaces`, and line 544-551 queues `SharedSpaceFaceMatch` for every space containing the asset. But this path does **not** cover EXIF or manual-source faces: they keep their personIds across Force (because `unassignFaces` filters by sourceType), and `handleRecognizeFaces` at line 486-489 early-returns on any face that already has a personId — _before_ reaching the space-match queueing block. EXIF and manual faces would therefore vanish from every space and never come back. For users with Apple Photos / Lightroom face metadata imports this would be a large regression.

Fix: after the wipe, explicitly queue `SharedSpaceFaceMatchAll` for every space with `faceRecognitionEnabled = true`. `handleSharedSpaceFaceMatchAll` already iterates `getAssetIdsInSpace` and dispatches per-asset `SharedSpaceFaceMatch` jobs, which run the new strict algorithm against every face in every in-space asset — ML, EXIF, and manual. Add a new repo method:

- `SharedSpaceRepository.getSpaceIdsWithFaceRecognitionEnabled(): Promise<string[]>`

Force now:

1. Drain `ThumbnailGeneration` + `FaceDetection` (existing).
2. `unassignFaces` + `handlePersonCleanup` + `vacuum` (existing).
3. `deleteAllPersonFaces` + `deleteAllPersons` (new).
4. Queue one `SharedSpaceFaceMatchAll` per face-recognition-enabled space (new).
5. Iterate `getAllFaces` and queue per-face `FacialRecognition` (existing).

Steps 4 and 5 add jobs to the same `FacialRecognition` queue. Concurrency is 1 and both drain FIFO. `handleSharedSpaceFaceMatchAll` fans out `SharedSpaceFaceMatch` jobs that may interleave with per-face `FacialRecognition` jobs — both are safe: the strict gate short-circuits on `isPersonFaceAssigned` for anything the other path already handled, and on `personId = null` for ML faces whose native re-clustering has not yet run. Any missed ML faces get picked up by a subsequent `processSpaceFaceMatch` triggered from `handleRecognizeFaces` once native recognition finishes for that face.

Named space-persons, birth dates, and per-user aliases are lost. This is an explicit admin action, and native named persons are cleared by Force today too — behaviour stays consistent.

### 3. Count filters on assetCount and faceCount

Update `SharedSpaceRepository.recountPersons` so the two subqueries filter out assets and faces the user wouldn't see — matching `person.repository.getStatistics` exactly:

```ts
faceCount: eb
  .selectFrom('shared_space_person_face')
  .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
  .innerJoin('asset', 'asset.id', 'asset_face.assetId')
  .where('asset_face.deletedAt', 'is', null)
  .where('asset_face.isVisible', 'is', true)
  .where('asset.deletedAt', 'is', null)
  .where('asset.visibility', '=', AssetVisibility.Timeline)
  .select((eb2) => eb2.fn.countAll().$castTo<number>().as('count'))
  .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id'),

assetCount: /* same filters, COUNT(DISTINCT asset_face.assetId) */
```

Reference: `getStatistics` filters by `asset.visibility = 'timeline'` (archive, hidden, locked all excluded), `asset.deletedAt IS NULL`, `asset_face.deletedAt IS NULL`, `asset_face.isVisible IS TRUE`. The same four predicates are applied here.

**`recountPersons` is `@GenerateSql`-decorated.** The SQL query file under `server/src/queries/shared.space.repository.sql` must be regenerated (`make sql` or apply the CI diff manually — see `feedback_sql_query_regen.md`).

**Self-healing of stale counts is limited.** `recountPersons` is called from `addPersonFaces`, `removePersonFacesByAssetIds`, manual merge, dedup pass, and at the end of `processSpaceFaceMatch`. A space-person whose state is static (no new matches, no removes, no merges) will keep its old inflated count until the next time one of those paths runs. For a largely frozen library — which is the common case for the reporter — effectively no self-healing happens. **The realistic recovery path for stale counts is running Force.** The release notes below say so explicitly. We do not add a startup one-shot recount because the same button that fixes the clustering bug also fixes the counts.

### 4. `hasAnySpacePerson` filter parity

Update `hasAnySpacePerson` and `hasSpacePerson` in `server/src/utils/database.ts` to mirror `hasAnyPerson`: add `asset_face.deletedAt IS NULL` and `asset_face.isVisible IS TRUE` on the inner join. Asset-level filters (`visibility`, `deletedAt`) are already applied by the callers' outer query on the `asset` table, so they are not duplicated here.

This closes the gap where filtering or searching assets by a space-person could surface assets that wouldn't appear in a normal People-filtered search.

### 5. Trash and visibility cleanup — intentionally skipped

We considered a hook that removes `shared_space_person_face` rows when an asset is trashed, archived, or hidden. On reflection, this is the wrong behaviour: trash and archive are reversible, and users expect restored photos to come back with their face assignments intact. With the count and filter fixes above, stale rows for invisible assets are simply ignored — they don't inflate counts or appear in listings, and they come back automatically if the asset returns to timeline visibility. Hard deletes still clean up via FK cascade.

Explicit "remove from space" continues to call `removePersonFacesByAssetIds`, which is correct because that action is not reversible in the same way — the asset is no longer in the space at all.

### 6. Library unlink cleanup

`SharedSpaceService.unlinkLibrary` (`shared-space.service.ts:479-487`) currently calls `removeLibrary` and returns. It does not remove face mappings for the unlinked library's assets, so every face from that library stays in `shared_space_person_face` forever — even though the assets themselves disappear from the space's timeline. Same bug family as the original count issue: stale mappings inflate counts and leak into filter results.

This is not covered by the section-3 count filters because the assets are still timeline-visible and not deleted — they just no longer belong to the space.

Fix inside `unlinkLibrary`: after `removeLibrary` succeeds, call a new set-based repo method `removePersonFacesByLibrary(spaceId, libraryId)`, then `deleteOrphanedPersons(spaceId)`. This is cheaper and more localised than teaching `recountPersons` / `hasAnySpacePerson` to check current space membership, and it matches the explicit-action philosophy already used by the "remove assets from space" path.

**`removePersonFacesByLibrary` must be set-based.** Naively fetching asset IDs via `assetRepository.getByLibraryIdWithFaces` and passing them to `removePersonFacesByAssetIds(spaceId, ids)` risks hitting the Postgres 65,534-parameter limit for large libraries (see `feedback_library_sync_param_limit`) and round-trips a potentially huge ID list through Node. Instead, express the whole operation as subqueries inside the repository, mirroring the shape of `removePersonFacesByAssetIds` but swapping the `in (assetIds)` clause for `in (assetFaceSubquery)`:

```ts
async removePersonFacesByLibrary(spaceId: string, libraryId: string) {
  const assetFaceSubquery = this.db
    .selectFrom('asset_face')
    .innerJoin('asset', 'asset.id', 'asset_face.assetId')
    .select('asset_face.id')
    .where('asset.libraryId', '=', libraryId);

  const spacePersonSubquery = this.db
    .selectFrom('shared_space_person')
    .select('id')
    .where('spaceId', '=', spaceId);

  const affectedPersonIds = await this.db
    .selectFrom('shared_space_person_face')
    .select('personId')
    .distinct()
    .where('assetFaceId', 'in', assetFaceSubquery)
    .where('personId', 'in', spacePersonSubquery)
    .execute();

  await this.db
    .deleteFrom('shared_space_person_face')
    .where('assetFaceId', 'in', assetFaceSubquery)
    .where('personId', 'in', spacePersonSubquery)
    .execute();

  if (affectedPersonIds.length > 0) {
    await this.recountPersons(affectedPersonIds.map((r) => r.personId));
  }
}
```

Parameter-limit-safe regardless of library size.

### 7. Hide invisible faces from space matching

`SharedSpaceRepository.getAssetFacesForMatching` (`shared-space.repository.ts:834-843`) filters on `deletedAt IS NULL` but not on `asset_face.isVisible`. Today, a face the user explicitly hid in the global People view can still be matched into a space-person. Add `.where('asset_face.isVisible', 'is', true)` to match native recognition's implicit expectation and to keep hidden faces hidden everywhere.

### 8. Empty space-persons drop out of the list

After the count filter (section 3), a space-person whose faces all live on archived / trashed / hidden assets will have `assetCount = 0`. `getPersonsBySpaceId` (`shared-space.repository.ts:491-544`) does not filter by count, so empty space-persons still appear in the UI list with "0 photos". Native `getAllForUser` excludes unnamed persons below `minimumFaceCount`.

Mirror that behaviour: add

```ts
.where((eb) =>
  eb.or([
    eb('shared_space_person.name', '!=', ''),
    eb('shared_space_person.assetCount', '>', 0),
  ]),
)
```

Named space-persons stay visible even at zero (so users can still find and manage them); unnamed empty ones disappear from the list.

**`assetCount` is the denormalized column and can be stale.** For spaces whose counts have not been refreshed since the section-3 filter landed, an empty person may remain visible (stale count > 0) or a non-empty person may be hidden (stale count = 0 — much rarer). Force recovers both. This is a minor cosmetic imperfection and acceptable given the design philosophy of "Force is the recovery path".

## Data flow

**New face in a space asset (happy path):**

1. Face detection → `asset_face` row with `personId = null`.
2. Native `handleRecognizeFaces` runs. Density check passes, `personId` assigned, `SharedSpaceFaceMatch` queued for each space containing the asset.
3. `processSpaceFaceMatch` runs. Gate passes (personId non-null). Layer 1 finds an existing space-person linked to this personId → attach. Recount runs. Dedup pass queued.

**New face that doesn't meet native density threshold — orphan variant:**

1. Face detection → `asset_face` with `personId = null`.
2. Native first pass defers (non-core, not yet deferred). Nothing queues to the space.
3. Native deferred pass runs. Still non-core. The code at `person.service.ts:518-530` probes the vector index with `hasPerson: true` and finds no matching neighbour. `personId` remains null. `SharedSpaceFaceMatch` is still queued at line 547 (unconditional).
4. `processSpaceFaceMatch` runs. Gate rejects (`personId` null). Face is ignored. It will be picked up only if more similar faces arrive later and an admin re-runs recognition, or if Force is triggered.

**New face that doesn't meet the density threshold but inherits a personId from a neighbour:**

1. Face detection → `asset_face` with `personId = null`.
2. Native deferred pass runs. Still non-core, but the `hasPerson: true` probe at `person.service.ts:518` finds a neighbour already assigned to a person and inherits its `personId` (line 528). `reassignFaces` sets the personId. `SharedSpaceFaceMatch` is queued.
3. `processSpaceFaceMatch` runs. **Gate passes**, because the face now has a personId. Layer 1 finds the space-person linked to that personId and attaches. This is correct — the face is vouched for by a density-validated cluster it just joined.

**Cross-owner face (e.g. Alice uploads a photo of Dad; Bob already has his own "Dad" in the space):**

1. Face detection + native recognition assigns `personId = Alice_Dad`.
2. `processSpaceFaceMatch` runs. Layer 1 (`findSpacePersonByLinkedPersonId`) looks for a space-person already linked to `Alice_Dad`. None — this is Alice's first Dad upload. Layer 2 (`findClosestSpacePerson`) finds Bob's Dad space-person within maxDistance → attach. Now the space-person contains faces from both `Alice_Dad` and `Bob_Dad`.
3. Future Alice Dad photos hit Layer 1 directly (fast path, no embedding search).

## Error handling and edge cases

- **Representative face deleted.** `shared_space_person.representativeFaceId` has `onDelete: SET NULL`. A rotation to a new face is a pre-existing concern unrelated to this design; no change here.
- **Layer 1 hit where the representative face has been deleted.** `findSpacePersonByLinkedPersonId` joins `shared_space_person_face` → `asset_face`, so it finds space-persons whose current face mappings include the target personId — independent of whether `representativeFaceId` still points somewhere. Layer 1 behaves correctly even when the representative is orphaned. Regression test covers this.
- **Force runs while face-match jobs are in flight.** `FacialRecognition` has fixed concurrency 1 (see section 2), so there are no in-flight space jobs while Force is running. Queued-but-not-started jobs wait behind Force and process a wiped state. No drain, no race.
- **Face without embedding.** Already handled — `findClosestSpacePerson` joins `face_search`, and if there's no embedding the face wouldn't have been given a personId either.
- **Per-user alias survival under Force.** Aliases live in `shared_space_person_alias` keyed on `personId`. Deleting the space-person cascades the alias. This matches what Force already does to native persons and is the documented trade-off.
- **Orphaned `representativeFaceId` after re-clustering.** A space-person's `representativeFaceId` is not re-pointed after Force + re-cluster. Since Force deletes the space-person entirely, this is moot.
- **Counts self-healing.** See section 3 — for static libraries, stale counts do not self-heal without Force. This is documented in the release notes.
- **Native face reassignment does not propagate to spaces — known limitation.** If a user manually reassigns an `asset_face` from global person Paul to global person Alice via the native People view, `asset_face.personId` updates but `shared_space_person_face` is untouched. Under the new Layer 1 rule the face is "stuck" in the old space-person: the next `processSpaceFaceMatch` run sees `isPersonFaceAssigned` return true and short-circuits. Pre-existing behaviour, not introduced by this PR. Out of scope; Force recovers it along with everything else. Noted as a follow-up.
- **Library sync removing assets.** When a library sync soft-deletes assets (files gone from disk), their face mappings are not cleaned up from the space. The section-3 count filter hides them (`asset.deletedAt IS NULL`), so counts stay correct, but `shared_space_person_face` accumulates stale rows until Force. Acceptable storage leak.
- **Stale rows from the old loose algorithm.** Pre-bug mappings in `shared_space_person_face` are intentionally left in place. `processSpaceFaceMatch`'s `isPersonFaceAssigned` short-circuit ensures the new gate does not disturb them. Users who want them cleaned up run Force. A regression test in the test plan asserts this explicitly so a future cleanup pass doesn't silently delete them.
- **Force at scale.** Force on a large instance (millions of faces, many face-recognition-enabled spaces with large asset counts) now queues `SharedSpaceFaceMatchAll` per space on top of the existing per-face `FacialRecognition` jobs. With the fan-out inside `handleSharedSpaceFaceMatchAll` this can translate to millions of additional queued jobs. Concurrency is 1 so they process serially and can take hours. Existing Force already queues millions of per-face jobs, so this is a multiplier rather than a new failure mode, but admins should expect Force on a populated instance to be a long-running operation.

## Testing

- **Unit tests — `processSpaceFaceMatch`:**
  - ML face without personId is skipped (no space-person row, no face mapping).
  - ML face with personId matching an existing space-person uses Layer 1 — no embedding search, no call to `findClosestSpacePerson`.
  - ML face with personId not matching any existing space-person, but within maxDistance of one, uses Layer 2.
  - ML face with personId, no existing Layer 1 match, no close Layer 2 match, creates a new space-person.
  - ML face that was non-core but inherited a personId from a neighbour (the deferred-pass inheritance path) is accepted by the gate — regression guard for the subtlety in data-flow section.
  - Layer 1 hit where the matched space-person's `representativeFaceId` is null — still attaches correctly.
  - **Pre-bug stale row preservation.** Seed `shared_space_person_face` with a mapping that would not be created under the new gate (e.g. a face whose personId is null in the current DB), run `processSpaceFaceMatch`, assert the stale row is untouched and no new rows are added. Prevents future "cleanup passes" from silently destroying user data.
  - **Invisible face (`asset_face.isVisible = false`) is not returned by `getAssetFacesForMatching`** after the section-7 filter change.
  - Dedup end-to-end: run matching, then dedup pass, assert the expected number of space-persons and that aliases migrate correctly. Guards the interaction between the new gate and the unchanged dedup logic.
  - Pet face path is unchanged (regression coverage).
- **Unit tests — `recountPersons`:**
  - Trashed asset excluded from both counts.
  - Asset with visibility `Archive` / `Hidden` / `Locked` excluded.
  - `asset_face.deletedAt` set excluded.
  - `asset_face.isVisible = false` excluded.
- **Unit tests — `hasAnySpacePerson` / `hasSpacePerson`:**
  - Covered indirectly by existing timeline/search tests, plus one new test each for filter parity with `hasAnyPerson`.
- **Unit tests — `handleQueueRecognizeFaces`:**
  - `force: true` calls `deleteAllPersonFaces` and `deleteAllPersons`.
  - `force: true` queues `SharedSpaceFaceMatchAll` once per space returned by `getSpaceIdsWithFaceRecognitionEnabled` — guards against the EXIF-face regression.
  - `force: false` does neither of the above.
  - Does **not** call `waitForQueueCompletion(QueueName.FacialRecognition)` — regression guard against re-introducing the deadlock.
- **Unit tests — `unlinkLibrary` (section 6):**
  - After unlink, `removePersonFacesByLibrary(spaceId, libraryId)` is called.
  - `deleteOrphanedPersons(spaceId)` is called.
  - `removePersonFacesByLibrary` itself is tested at the repo level: given a library with assets whose faces are mapped to space-persons, after the call those rows are gone and `recountPersons` was called for affected persons only.
- **Unit tests — `getPersonsBySpaceId` (section 8):**
  - Unnamed space-person with `assetCount = 0` is excluded from the list.
  - Named space-person with `assetCount = 0` is still returned.
  - Unnamed space-person with `assetCount > 0` is returned.
- **Medium test (real DB):**
  - Seed a space with two faces from the same global person → single space-person after match (Layer 1).
  - Seed a space with two faces from _different_ global persons but close embeddings → single space-person after match (Layer 2 bridging).
  - Seed a space with a face that has no personId → no space-person created.
  - Trash one of the assets → `assetCount` decreases on next `recountPersons` call.
  - **Force end-to-end with ML faces.** Seed a space with stale ML-sourced rows, invoke `handleQueueRecognizeFaces({ force: true })`, drain the `FacialRecognition` queue synchronously, then assert `shared_space_person` / `shared_space_person_face` contain only rows produced by the new strict algorithm against the current DB state.
  - **Force end-to-end with EXIF faces.** Seed a space with an EXIF-sourced face whose personId is set, run Force, drain the queue, assert the face is reflected in a rebuilt space-person (this covers the regression guarded by the `SharedSpaceFaceMatchAll` re-queue).
  - **Library unlink.** Seed a space with a linked library containing assets with faces, unlink the library, assert `shared_space_person_face` no longer references any asset from that library and `assetCount` reflects the removal. Run with a library containing more than the Postgres parameter-limit threshold to exercise the set-based path.
- **No E2E test added.** The bug is not user-flow-visible in a way Playwright can assert without running facial recognition end-to-end, which is flaky in CI.

## Release notes draft

> **Shared space people accuracy fix.** Fixed an issue where a shared-space person could accumulate unrelated face matches over time, causing wildly inflated photo counts. New face matches now require native facial recognition to have assigned the face to a person first. Existing space clusters and counts are not migrated automatically — if you see incorrect groupings _or_ inflated counts, go to **Administration → Jobs → Facial Recognition → Force** to rebuild. Note that this resets all named people in both the global People view _and_ shared spaces. Also fixed: shared-space photo counts now exclude trashed, archived, and hidden photos.

## PR structure

The changes are separable and should be committed as independent, atomic commits within the same PR:

1. Clustering algorithm change in `processSpaceFaceMatch` + `getAssetFacesForMatching` `isVisible` filter (section 1, section 7).
2. `recountPersons` filter fix + regenerated SQL query file (section 3).
3. `hasAnySpacePerson` / `hasSpacePerson` filter fix (section 4).
4. Force recognition space-person wipe + new repository methods (section 2).
5. `unlinkLibrary` cleanup (section 6).
6. `getPersonsBySpaceId` empty-person filter (section 8).

This makes review easier and lets any single change be reverted without losing the others if we hit a problem in review or post-merge.

**`@GenerateSql` regeneration.** Every new `SharedSpaceRepository` method added by this PR — `deleteAllPersonFaces`, `deleteAllPersons`, `getSpaceIdsWithFaceRecognitionEnabled`, `removePersonFacesByLibrary` — should carry a `@GenerateSql` decorator consistent with the rest of the repository. Together with the `recountPersons` change in section 3, `server/src/queries/shared.space.repository.sql` must be regenerated (`make sql` or apply the CI diff manually — see `feedback_sql_query_regen.md`) in the same commit that introduces each method, otherwise CI's schema/query check will fail.

## Out of scope / follow-ups

- Centroid-based Layer 2 matching for higher precision on cross-owner bridges.
- Per-space "rebuild" admin action that doesn't affect the rest of the instance.
- Re-running native recognition on non-core faces when neighbours cross the density threshold later (pre-existing limitation).
- Rotating `representativeFaceId` when the current face becomes invisible or deleted.
- Propagating native face reassignment into `shared_space_person_face` so Layer 1 stays in sync with manual edits in the global People view.
- Cleaning up stale `shared_space_person_face` rows when a library sync soft-deletes assets (storage-only leak, no correctness impact).
- Making `getAssetIdsInSpace` filter `asset.deletedAt IS NULL` on the explicit-share branch (currently asymmetric with the library-linked branch). After Force, the rebuild will briefly cluster faces on trashed user-shared assets; counts hide them but they sit as stale rows in `shared_space_person_face` until the next Force.
