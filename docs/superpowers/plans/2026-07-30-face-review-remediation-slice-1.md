# Slice 1 — Locked and non-visible assets are excluded from both engines

**Spec:** [`2026-07-30-face-review-unification-remediation-slices.md`](../specs/2026-07-30-face-review-unification-remediation-slices.md)
(Slice 1, findings F1–F3)
**Branch:** `feat/face-review-unified`
**Worktree:** `/Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase`

## Goal

No face on an asset whose `visibility` is `locked` or `hidden` is ever scanned, queued, listed,
counted or rendered by the face-suggestion engine or the face-cleanup console, and the admin
face-thumbnail route refuses to serve its crop. Facial recognition is provably unchanged.

## Corrections to the spec (fold back into the spec file in this slice's commit)

1. **`countAllFaces` must NOT get the predicate.** The spec listed it. Reading the code
   (`server/src/repositories/face-repair.repository.ts:200-211`) shows it deliberately joins no
   `asset` and counts **all** remaining faces of a person — any source type, visible or hidden — as
   the delete gate for an emptied manual-move source (invariant A2). Narrowing it would let a person
   be deleted while Locked-asset faces still point at it, and `asset_face.personId`'s
   `ON DELETE SET NULL` would orphan them. That is the exact bug the method's comment says it
   exists to prevent. **Five** feed methods change, not six.
2. **The admin thumbnail refusal moves into the repository and becomes a 404, not a 400.**
   `getFaceByIdIncludingTombstoned` (`server/src/repositories/person.repository.ts:459-467`) has
   exactly one production caller (`face-repair.service.ts:1213`), which already wraps it in
   `try { … } catch { throw new NotFoundException() }`. Adding the visibility filter to the
   repository query therefore needs **no service change**, returns 404 rather than disclosing that
   the face exists, and keeps the method's `AssetFace` return type unchanged. The spec's
   "add `asset.visibility` to the select and throw `BadRequestException` in the service" is
   replaced by this.

## Files

| File                                                        | Change                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| `server/src/utils/face-review.ts`                           | **new** — `reviewableAssetVisibility`                    |
| `server/src/repositories/search.repository.ts`              | `FaceEmbeddingSearch.visibility?`; apply in the CTE      |
| `server/src/repositories/face-repair.repository.ts`         | 5 methods gain the predicate                             |
| `server/src/repositories/face-person-verdict.repository.ts` | `isFaceReachableInSpace` gains the full sibling gate     |
| `server/src/repositories/person.repository.ts`              | `getFaceByIdIncludingTombstoned` joins `asset` + filters |
| `server/src/services/person.service.ts`                     | both suggestion scans pass `visibility`                  |
| `server/src/services/face-repair.service.ts`                | the cleanup scan's KNN pass passes `visibility`          |
| `server/src/queries/*.sql`                                  | regenerate                                               |

## Step 1 — the predicate (no test of its own; proven by its call sites)

Create `server/src/utils/face-review.ts`:

```ts
import { Expression, ExpressionBuilder, ReferenceExpression, SqlBool } from 'kysely';
import { DB } from 'src/schema';
import { spaceVisibleAssetVisibilities } from 'src/utils/shared-space-album-scope';

/**
 * A face is REVIEWABLE if a human may be shown its crop by either face-review engine.
 * Locked-folder and Hidden assets are excluded: the Locked folder is designed to require the
 * OWNER's elevated re-authentication, and neither the suggestion queue nor the admin cleanup
 * console re-authenticates. Face detection already skips `hidden`, so `locked` is the live gap —
 * both are excluded so the predicate states the whole rule.
 *
 * Deliberately NOT applied to facial recognition itself (handleRecognizeFaces /
 * handleQueueRecognizeFaces): recognition clustering Locked faces into the owner's own people is
 * upstream behaviour and out of scope here. Pinned by S1.2 and S1.14.
 */
export const reviewableAssetVisibility = (
  eb: ExpressionBuilder<DB, keyof DB>,
  column: ReferenceExpression<DB, keyof DB> = 'asset.visibility',
): Expression<SqlBool> => eb(column, 'in', spaceVisibleAssetVisibilities);
```

## Step 2 — TDD, in this order

Each numbered item: write the test, run it, confirm it fails **for the stated reason**, implement,
re-run green. Items marked **pin** may pass first-run — but only after you mutate the pinned
behaviour, watch the test go red, and revert.

Every absence assertion below must carry a positive control **in the same test body** (spec §2).

### 2a. `searchFaces` (S1.1, S1.2, S1.3)

Tests in `server/test/medium/specs/repositories/search.repository.spec.ts`.

- **S1.1** — seed one face on a `visibility: 'locked'` asset and one on a `timeline` asset, both
  owned by the same user, both with `face_search` rows near the query embedding.
  `searchFaces({ userIds: [owner], embedding, numResults: 10, maxDistance: 1, visibility: spaceVisibleAssetVisibilities })`
  returns **only** the timeline face. _Red reason: the option does not exist / is ignored, so both
  come back._
- **S1.2 (pin)** — the same call **without** `visibility` returns **both**.
- **S1.3 (pin)** — the space branch already gates: `searchFaces({ spaceId, … })` omits a locked
  asset in the space and returns a timeline control.

Implementation — `server/src/repositories/search.repository.ts`:

- add `visibility?: AssetVisibility[]` to `FaceEmbeddingSearch`;
- destructure it in `searchFaces`;
- inside the CTE, immediately **after** `.where('asset.deletedAt', 'is', null)` and before the
  `asset_face.deletedAt` filter, add
  `.$if(!!visibility?.length, (qb) => qb.where('asset.visibility', 'in', visibility!))`.

Default `undefined` ⇒ no predicate ⇒ the recognition (`person.service.ts:1436`, `:1485`) and
space-face-match (`shared-space.service.ts:2063`) callers emit byte-identical SQL. Add a second
`@GenerateSql` named variant (`owner-visibility`) so the new shape is documented.

### 2b. Suggestion scans pass it (S1.4, S1.5)

- **S1.4** — BDD in `server/test/medium/specs/services/face-suggestion-exclusions.spec.ts`:
  **Given** an owner with a named, identity-linked person and two unassigned near-miss faces — one
  on a Locked asset, one on a Timeline asset — **When** `handlePersonSuggestionScan({ id })` runs,
  **Then** exactly one `face_person_verdict` pending row exists and it is for the Timeline face.
  Assert the Timeline row exists (positive control) **and** the Locked row does not.
- **S1.5** — the same shape for `handleSpacePersonSuggestionScan`.

Implementation — `server/src/services/person.service.ts`: both `searchFaces` calls
(`:909`, `:994`) pass `visibility: spaceVisibleAssetVisibilities`.

### 2c. Cleanup feed methods (S1.6–S1.10)

Tests in `server/test/medium/specs/repositories/face-repair.repository.spec.ts` except S1.10.

- **S1.6** — `streamEligibleFaces({ personId })` yields the Timeline face and not the Locked one.
- **S1.7** — a person with 1 Timeline + 1 Locked assigned face: `getEligibleFacePage` returns 1 row
  and `countEligibleFaces` returns 1. **`countAllFaces` returns 2** — assert that explicitly, it is
  the guard against re-introducing the A2 orphan bug (see Corrections §1).
- **S1.8** — `getClusterFacePage` omits the Locked face from both `faces` and `total`.
- **S1.9** — `getEligibleFaceIdsForPerson(personId, [lockedId, timelineId])` returns only
  `timelineId`.
- **S1.10** — BDD in `server/test/medium/specs/services/face-repair.scan.spec.ts`: a cluster
  contaminated with one Locked and one Timeline face out of the same foreign axis — only the
  Timeline face is flagged, and the Timeline face **is** flagged (control).

Implementation — add `.where((eb) => reviewableAssetVisibility(eb))` to `streamEligibleFaces`
(`:113`), `getEligibleFacePage` (`:143`), `countEligibleFaces` (`:177`), `getClusterFacePage`
(`:213`) and `getEligibleFaceIdsForPerson` (`:250`). **Do not touch `countAllFaces` (`:200`).**
`getClusterFacePage`'s comment claims it "mirrors streamEligibleFaces' filter exactly" — that must
stay true, which is why all five move together.

Also pass `visibility: spaceVisibleAssetVisibilities` at `face-repair.service.ts:378`.

### 2d. `isFaceReachableInSpace` (S1.11)

- **S1.11** — in `server/test/medium/specs/repositories/face-person-verdict.repository.spec.ts`:
  one table-driven test asserting `false` for each of a Locked asset, a trashed asset
  (`asset.deletedAt`), an offline asset (`asset.isOffline`), a soft-deleted face
  (`asset_face.deletedAt`) and an invisible face (`asset_face.isVisible = false`), and `true` for a
  reachable control face — all in the same space, in the same test body.

Implementation — `isFaceReachableInSpace` (`face-person-verdict.repository.ts:675-692`) gains, to
match `getPendingForSpacePerson` (`:536-541`):

```ts
.where('asset_face.deletedAt', 'is', null)
.where('asset_face.isVisible', 'is', true)
.where('asset.deletedAt', 'is', null)
.where('asset.isOffline', 'is', false)
.where((eb) => spaceVisibilityGate(eb))
```

Its doc comment currently says "pure RBAC reachability … decoupled from the display-state gates" —
rewrite it: display state and reachability are not separable here, because a face whose asset the
caller can no longer see must not be a valid verdict target either.

### 2e. Admin face thumbnail (S1.12)

- **S1.12** — in `server/src/services/face-repair.service.spec.ts` (unit) plus one medium test in
  `face-repair.repository.spec.ts` for the query itself:
  - a face on a Locked asset ⇒ `getAdminFaceThumbnail` throws `NotFoundException`;
  - a face on a Timeline asset ⇒ returns the media response (control);
  - **pin** — a **tombstoned** face (`asset_face.deletedAt` set) on a Timeline asset still returns
    the media response. This is deliberate and already tested; it must not regress.

Implementation — `person.repository.ts:459-467`, `getFaceByIdIncludingTombstoned`: add
`.innerJoin('asset', 'asset.id', 'asset_face.assetId')` and
`.where((eb) => reviewableAssetVisibility(eb))`, keeping the select list and return type exactly as
they are (select `asset_face` columns only, plus the existing `withPerson`). `executeTakeFirstOrThrow`
then throws for a non-reviewable face and the service's existing `catch` turns it into a 404. **No
service change.** Update the method's comment to say what it now excludes.

### 2f. Read-path and recognition pins (S1.13, S1.14)

- **S1.13 (pin)** — `getPendingForPerson` and `getPendingForSpacePerson` already exclude Locked;
  assert both with a Timeline control row returned in the same call.
- **S1.14 (pin)** — in `server/test/medium/specs/services/person.service.spec.ts`:
  `handleRecognizeFaces` still assigns a face on a Locked asset to a person. This is the guard on
  the §4 scoping decision — if a future change applies the predicate to recognition, this fails.

## Verification

```bash
cd server
pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/search.repository.spec.ts \
  test/medium/specs/repositories/face-repair.repository.spec.ts \
  test/medium/specs/repositories/face-person-verdict.repository.spec.ts \
  test/medium/specs/services/face-repair.scan.spec.ts \
  test/medium/specs/services/face-suggestion-exclusions.spec.ts \
  test/medium/specs/services/person.service.spec.ts
pnpm exec vitest --config test/vitest.config.mjs --run src/services/face-repair.service.spec.ts
```

Then, with the dev DB up, `mise //:sql` and commit the regenerated `server/src/queries/*.sql`.

**Do not** run `make sql` / `mise //:sql` without a running database — it deletes every query file.

## Constraints

- Server imports use the `src/` alias; no relative imports.
- No `this.db` query inside a `this.db.transaction()` callback.
- `pnpm test -- --run <path>` silently drops the path filter — use the `pnpm exec vitest --config …`
  forms above.
- Do not add `Co-Authored-By` or "Generated with" trailers.

## Commit

Amend the spec file with the two corrections above in the same commit.

```
fix(face-review): exclude locked and hidden assets from both face-review engines
```
