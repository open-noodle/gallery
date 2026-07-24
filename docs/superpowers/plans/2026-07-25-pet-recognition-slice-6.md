# Slice 6 — Reprocess, model switch, nightly

- **Spec:** [`../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md`](../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md) § Slice 6
- **Depends on:** Slice 5
- **Scope:** `pet-recognition.service.ts`, `queue.service.ts` nightly, one repository method, config flag.

## Objective

Make enabling recognition (or switching model) rebuild cleanly, and let the nightly job pick up pets
that were detected before recognition was on.

## Implementation

### `handleQueuePetRecognition({ force, nightly })`

Fill in the Slice 3 stub, mirroring `handleQueueRecognizeFaces` (`person.service.ts:886-988`) but
smaller:

- **`force: true`** — purge, then rebuild:
  1. `personRepository.deleteAllPets()` and `sharedSpaceRepository.deleteAllPets()` (both already
     exist and are already used by `handleQueuePetDetection`)
  2. **truncate `pet_search`** via a new `personRepository.deleteAllPetSearch()` (or equivalent);
     `deleteAllPets()` deletes the `asset_face` rows so CASCADE removes most rows, but a truncate is
     the explicit, order-independent guarantee the design asks for on a model switch
  3. queue `JobName.PetDetectionQueueAll { force: true }` so assets are re-detected and re-embedded
     with the **current** model
- **`nightly: true`** — skip when `SystemMetadataKey.PetRecognitionState.lastRun` is newer than the
  newest pet face (mirror the `getLatestFaceDate()` comparison; add a pet equivalent if one does not
  exist, or reuse the newest `asset_face` for pet people)
- **otherwise** — queue `JobName.PetRecognition { id, deferred: false }` for every pet face that has
  a `pet_search` row and no `personId`, paged like the face equivalent
- **always** record `{ lastRun: new Date().toISOString(), modelName }` in
  `SystemMetadataKey.PetRecognitionState`. Recording the model name is what lets a future change
  detect a model switch.

### Nightly flag

`config.ts` `nightlyTasks.clusterNewPets: boolean` (default **true**), its Zod field in
`SystemConfigNightlyTasksSchema`, and in `queue.service.ts` `handleNightlyJobs`:

```ts
if (config.nightlyTasks.clusterNewPets) {
  jobs.push({ name: JobName.PetRecognitionQueueAll, data: { force: false, nightly: true } });
}
```

## TDD steps

Write these tests first and capture red (spec tests 6.1–6.7):

| #   | Test                                                                                                                   | File                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 6.1 | `force: true` deletes pet people + space copies, truncates `pet_search`, queues `PetDetectionQueueAll { force: true }` | `pet-recognition.service.spec.ts`                            |
| 6.2 | `force: false` queues `PetRecognition` only for embedded, unassigned pet faces                                         | same                                                         |
| 6.3 | `nightly: true` with `lastRun` newer than the newest pet face → `Skipped`, nothing queued                              | same                                                         |
| 6.4 | `nightly: true` with older `lastRun` → queues work                                                                     | same                                                         |
| 6.5 | the run writes `lastRun` **and** `modelName` to system metadata                                                        | same                                                         |
| 6.6 | nightly job list includes `PetRecognitionQueueAll` iff `clusterNewPets` is on                                          | `queue.service.spec.ts`                                      |
| 6.7 | medium: after a force purge `pet_search` is empty and `face_search` is untouched                                       | `test/medium/specs/services/pet-recognition.service.spec.ts` |

Test 6.7 is the important one: it proves the purge is scoped to pets and cannot destroy human face
embeddings.

## Also in this slice: wire `VectorIndex.Pet` into vector maintenance

Slice 2 registered `VectorIndex.Pet` in `VECTOR_INDEX_TABLES` and `probes` but deliberately left the
maintenance call sites alone, because they live in service code that was out of that slice's scope.
They hardcode Clip/Face and must now learn about Pet, or `pet_index` silently rots:

- `server/src/repositories/database.repository.ts` — the `dropIndex` list in `updateVectorExtension`
  (otherwise switching vector extension leaves a stale pet index of the wrong type)
- `server/src/services/database.service.ts` — the `reindexVectors(VectorIndex.Clip, VectorIndex.Face)`
  call sites (otherwise the pet index is never rebuilt or repaired)

Add a test asserting the pet index is included wherever the face index is, so a future index cannot
be added without maintenance coverage.

## Verify

```bash
cd server
pnpm test -- --run src/services/pet-recognition.service.spec.ts src/services/queue.service.spec.ts src/services/system-config.service.spec.ts
pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/pet-recognition.service.spec.ts
pnpm test -- --run
pnpm check
```

`system-config.service.spec.ts` is in the list because the new `nightlyTasks.clusterNewPets` default
must appear in its hardcoded defaults fixture.

## Edge cases

- Purge must not touch `face_search` or human people (6.7).
- Nightly must be a no-op when recognition is disabled (already handled by the enabled gate, but
  assert it).
- `deleteAllPetSearch` on an empty table is a no-op, not an error.

## Commit

`feat(pet-recognition): reprocess, model switch and nightly clustering`
