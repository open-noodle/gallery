# Slice 3 — Per-asset face-detection isolation (F4)

Plan for [the review-fixes spec](../specs/2026-07-26-pet-recognition-review-fixes-implementation-slices.md),
Slice 3. Baseline: Slices 1–2 landed (`petFacePredicate` exists in `src/utils/database.ts`).

**Goal:** re-running human face detection on an asset never deletes its pet faces and never
IoU-matches a pet face.

## The two failure modes (established by writing the red tests)

Pet faces are written by `pet-detection.service.ts` via `createAssetFace` with **no explicit
sourceType**, so they take the column default — the same `machine-learning` value human faces get.
That means every pet face on an asset lands in `handleDetectFaces`'s `mlFaceIds` set, and:

1. **Stale sweep.** If no detected box matches the pet face, it stays in `mlFaceIds` and is
   hard-deleted as a "face below detection threshold", taking its `pet_search` row with it.
2. **Cross-match embedding write.** If a detected box _does_ overlap it, the first detection
   consumes it out of `mlFaceIds` (`match && !mlFaceIds.delete(match.id)` → false, nothing written,
   face silently spared) — but a **second** overlapping detection then finds `delete` returning
   false and executes `embeddings.push({ faceId: match.id, … })`, writing a human `face_search`
   embedding straight onto the pet face.

Mode 2 needs two overlapping detections to trigger; R3.2 is written that way. (A single-detection
test would go red on the wrong assertion — it exercises the silent-spare path, not the write.)

## Implementation

### 1. `asset-job.repository.ts` — `getForDetectFacesJob` selects `isPet`

`withFaces(eb, true, true)` is replaced, **at this call site only**, by a local `jsonArrayFrom` that
selects `asset_face.*` plus `petFacePredicate(inner).as('isPet')`. `withFaces` itself is untouched —
the review verified its other callers are read-only selects. With `withHidden` and `withDeletedFace`
both true the original applied no extra filters, so the local variant needs none either.

The computed column types as `SqlBool`; `pnpm exec tsc --noEmit` is clean.

### 2. `person.service.ts` — `handleDetectFaces`

- `mlFaceIds` only collects `face.sourceType === MachineLearning && !face.isPet`.
- The IoU candidate scan returns `false` immediately for `face.isPet`, so no detected human box can
  resolve to a pet face — closing both failure modes above.

### 3. `test/mappers.ts`

`getForDetectedFaces` now emits `isPet: false` per face so every existing caller keeps typechecking;
the pet tests override it per face.

## Tests

| #    | Layer  | Test                                                                                                                                 | Observed red                                                    |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| R3.1 | unit   | 1 pet face + zero detections → pet id never appears in `faceIdsToRemove`; `unlinkFaces` untouched                                    | spy WAS called with `arrayContaining([petFace.id])`             |
| R3.2 | unit   | 2 detections both IoU 1.0 with the pet face → two **new** faces created, pet gets no embedding                                       | `facesToAdd` was `[]` (the pet face absorbed both detections)   |
| R3.3 | unit   | **pin**: a stale human ML face is still removed                                                                                      | passes; mutate-red-revert per §2                                |
| R3.4 | medium | BDD: asset with an assigned pet face + a stale human face, 0 detections → pet (face, `pet_search`, person) survives, human face gone | written post-fix; proven red by mutating the `isPet` guard away |

R3.4 lives in `pet-human-isolation.service.spec.ts` (Slice 2's file) and mocks
`MachineLearningRepository.detectFaces` to return zero faces against the real DB.

## Verify

```
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/person.service.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/pet-human-isolation.service.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.mjs --run   # full unit
cd server && pnpm exec tsc --noEmit -p tsconfig.json
```

## Commit

`fix(pet-recognition): keep per-asset face detection away from pet faces`
