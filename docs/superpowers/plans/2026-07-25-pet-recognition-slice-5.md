# Slice 5 — Server: detect → embed → cluster

- **Spec:** [`../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md`](../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md) § Slice 5
- **Depends on:** Slices 2, 3, 4
- **Scope:** `pet-detection.service.ts` + `pet-recognition.service.ts` and their specs.

## Objective

Make the feature work end to end: detected pets get embeddings, embeddings get clustered into
individual pet people, and those people propagate into shared spaces the way human faces do.

## The behavioural contract (read this before writing code)

`petRecognition.enabled` is **false by default**, and while it is false `handlePetDetection` must
behave **exactly as it does today** — species buckets via `getByOwnerAndSpecies`, no embeddings, no
recognition jobs. This is what makes the change safe to ship: upgrading users lose nothing, and the
switch to individual pets only happens when an admin turns recognition on (and triggers the purging
reprocess from Slice 6). Test 5.1 is that guard and must not be weakened.

## Part A — `handlePetDetection` (`server/src/services/pet-detection.service.ts`)

Current flow (`:49-121`): detect → per pet, find-or-create a `(owner, species)` bucket person →
`createAssetFace` → set representative face → stamp `petsDetectedAt`.

New flow when `isPetRecognitionEnabled(machineLearning)`:

1. `detectPets(previewFile, machineLearning.petDetection, { modelName: machineLearning.petRecognition.modelName })`
2. Build `facesToAdd` (box + `assetId`, **no `personId`**) and `embeddingsToAdd`
   (`{ faceId, embedding }`) — but `faceId` is DB-generated, so use the ids returned by
   `refreshPetFaces`; write the faces and embeddings in that one call.
3. Queue `{ name: JobName.PetRecognition, data: { id: faceId, deferred: false } }` per created face.
4. **Skip** all species-bucket and representative-face logic (an individual gets its representative
   face when it is created in Part B).
5. Stamp `petsDetectedAt` as today.

A pet returned without an `embedding` (older ML service) must still get its `asset_face` row, log a
warning, and **not** be queued for recognition — test 5.3.

## Part B — `handlePetRecognition` (`server/src/services/pet-recognition.service.ts`)

Mirrors `handleRecognizeFaces` (`person.service.ts:1024-1163`), minus the human-only parts
(`minBirthDate`, cross-user shared-identity search).

```
1. face = personRepository.getPetFaceForRecognition(id)      // face + asset + pet_search embedding
   - missing face                  -> JobStatus.Failed
   - no embedding                  -> JobStatus.Skipped   (recognition enabled after detection ran)
2. if (face.personId) { replaceFaceIdentity(face.personId, face.id, 'owner-person'); return Skipped }
3. matches = searchPets({ userIds: [face.asset.ownerId], embedding, maxDistance, numResults: Math.max(minFaces, 1) })
4. personId = matches.find((m) => m.personId)?.personId
5. isCore = matches.length >= minFaces
6. if (!isCore && !deferred) { requeue { id, deferred: true }; return Skipped }
7. if (!personId && isCore) { person = create({ ownerId, type: 'pet', species: label, name: '' }) }
8. if (!personId) return Skipped
9. reassignFaces({ faceIds: [id], newPersonId: personId })
   replaceFaceIdentity(personId, id, 'owner-person')        // activates shared-space pet propagation
   queue SharedSpaceFaceMatch for the asset
   set the person's representative face + queue PersonGenerateThumbnail if it has none
   return JobStatus.Success
```

Notes:

- **`species`**: `asset_face` has no species column, so the label must come from somewhere. Read it
  from the existing `person` when assigning; when creating, take it from the detected label. If the
  label is not available at recognition time, add it to the face row selection — check what
  `handlePetDetection` can persist (e.g. reuse the existing bucket-free `person.species`) and pick
  the simplest correct option; do **not** guess a species.
- `replaceFaceIdentity` is the private helper pattern in `person.service.ts:1180-1188`
  (`ensurePersonIdentity` then `replaceFaceIdentity`). Pets need `type: 'pet'` on the identity —
  check `faceIdentityRepository.ensurePersonIdentity`'s signature and pass the type through if it
  supports it; the `face_identity` table already has a `type IN ('person','pet')` CHECK.
- With the default `minFaces: 1`, step 6 never defers — but the branch must exist and be tested,
  because an admin can raise `minFaces`.

## TDD steps

### Step 1 — RED

Write the unit tests first, in this order, capturing the red output:

`server/src/services/pet-detection.service.spec.ts` — tests 5.1–5.4 (see spec table).
`server/src/services/pet-recognition.service.spec.ts` — tests 5.5–5.13.

Use `newTestService` and copy the existing mocking style from the current
`pet-detection.service.spec.ts` and `person.service.spec.ts` (the recognition tests there are the
closest analogue for mocking `searchRepository.searchFaces`).

Then the medium test `server/test/medium/specs/services/pet-recognition.service.spec.ts` —
tests 5.14–5.16, using real repositories over a real DB with hand-built embeddings of known cosine
distance.

### Step 2 — GREEN

Implement Part A then Part B. Add whatever repository accessor the service needs
(`getPetFaceForRecognition`) to `person.repository.ts`, with a `@GenerateSql` decorator matching the
neighbours.

### Step 3 — verify

```bash
cd server
pnpm test -- --run src/services/pet-detection.service.spec.ts src/services/pet-recognition.service.spec.ts
pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/pet-recognition.service.spec.ts
pnpm test -- --run     # full unit suite — person/shared-space specs must not regress
pnpm check
```

## Edge cases (all must have a test)

- recognition disabled → today's bucket behaviour, byte for byte (5.1)
- pet with no embedding → face written, no recognition queued, no throw (5.3)
- zero pets detected → no writes, no jobs, `petsDetectedAt` still stamped (5.4)
- face already assigned → no search, no reassign (5.7)
- embedding row missing at recognition time → `Skipped`, no throw (5.8)
- `!isCore && deferred` → no second requeue, no infinite loop (5.10)
- match beyond `maxDistance` is not returned → new person (5.13)
- two owners with identical embeddings never share a person (5.16)

## Done criteria

- All three spec files green; full server unit suite green; tsc clean.
- `handlePetDetection`'s disabled path provably unchanged.

## Commit

`feat(pet-recognition): detect, embed and cluster individual pets`
