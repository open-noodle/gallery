# Slice 4 — Server: ML client, pet-embedding writes, NN search

- **Spec:** [`../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md`](../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md) § Slice 4
- **Depends on:** Slice 2 (`pet_search` exists), Slice 3 (`petRecognition` config exists)
- **Scope:** repositories only. No service/pipeline change (that is Slice 5).

## Objective

Give the server the three primitives the pipeline needs: ask the ML service for pet embeddings,
write them, and search them.

## Files

| File                                                                  | Change                                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `server/src/repositories/machine-learning.repository.ts`              | `DetectedPet.embedding?`, `PetDetectionRequest` gains optional `RECOGNITION`, `detectPets` takes an optional recognition arg |
| `server/src/repositories/person.repository.ts`                        | `refreshPetFaces(facesToAdd, embeddingsToAdd)`                                                                               |
| `server/src/repositories/search.repository.ts`                        | `searchPets(...)`                                                                                                            |
| `server/src/repositories/machine-learning.repository.spec.ts`         | tests 4.1–4.3                                                                                                                |
| `server/test/medium/specs/repositories/pet-search.repository.spec.ts` | extend with 4.4–4.8                                                                                                          |

## Design detail

### `detectPets`

```ts
async detectPets(
  imagePath: string,
  { modelName, minScore }: { modelName: string; minScore: number },
  recognition?: { modelName: string },
) {
  const request: PetDetectionRequest = {
    [ModelTask.PET_DETECTION]: {
      [ModelType.DETECTION]: { modelName, options: { minScore } },
      ...(recognition ? { [ModelType.RECOGNITION]: { modelName: recognition.modelName } } : {}),
    },
  };
  ...
}
```

When `recognition` is omitted the request must be **byte-identical to today's** — test 4.1 is the
regression guard for the recognition-disabled path.

Because the Python side writes both models' output under the same `pet-detection` response key and
the recognizer runs second, the parsed `pets` array carries `embedding` when recognition was
requested and omits it otherwise. Hence `embedding?: string` (optional), not required.

### `refreshPetFaces`

Model it on `refreshFaces` (`person.repository.ts:830-852`) but simpler — pets have no
"remove stale faces" step here:

```ts
@GenerateSql({ params: [[{ assetId: DummyValue.UUID }], [{ faceId: DummyValue.UUID, embedding: DummyValue.VECTOR }]] })
async refreshPetFaces(
  facesToAdd: (Insertable<AssetFaceTable> & { assetId: string })[],
  embeddingsToAdd: Insertable<PetSearchTable>[],
): Promise<void>
```

Use a CTE like `refreshFaces` so both inserts happen in one statement. The caller needs the new face
ids to queue recognition jobs — either return them from the CTE (`returning('id')`) or have the
caller generate the ids up-front. **Prefer generating ids caller-side is NOT possible** (`asset_face.id`
is DB-generated), so return the inserted ids and have the test assert them.

### `searchPets`

A copy of `searchFaces` (`search.repository.ts:904-949`) scoped to `pet_search`:

- `set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Pet])}`
- join `pet_search` instead of `face_search`
- keep `userIds`, `numResults`, `maxDistance`, `hasPerson`
- **drop** `minBirthDate` (meaningless for pets)
- decorate with `@GenerateSql` exactly like `searchFaces` so the generated SQL docs stay in sync
  (note: do **not** run `make sql` without a database — it deletes query files)

## TDD steps

### Step 1 — RED

Unit (`machine-learning.repository.spec.ts`), copy the existing `detectFaces`/`detectPets` test
shape:

- 4.1 `detectPets` without recognition → the posted `entries` JSON has exactly one key under
  `pet-detection` (`detection`). This passes today — keep it as the regression guard and say so in
  the test name.
- 4.2 `detectPets` with recognition → `entries` has both `detection` (with `options.minScore`) and
  `recognition` (with the recognition model name). Expected red: only `detection` present.
- 4.3 response parsing maps `embedding` onto each pet. Expected red: type error / undefined.

Medium (extend the Slice 2 spec file):

- 4.4 `refreshPetFaces` inserts an `asset_face` and a `pet_search` row and returns the face id
- 4.5 `searchPets` orders by cosine distance and honours `maxDistance` — build embeddings with
  **known** distances (see `face-identity.repository.spec.ts:244-267` `axisEmbedding`/`blendedEmbedding`
  helpers; reuse that technique rather than random vectors)
- 4.6 owner scoping: a second user's pet face is never returned
- 4.7 `hasPerson: true` excludes faces with `personId = null`
- 4.8 isolation: insert a human face + `face_search` row; assert `searchPets` does not return it

Expected red for all medium tests: `refreshPetFaces`/`searchPets` is not a function.

### Step 2 — GREEN

Implement the three methods. Keep `searchPets` in `search.repository.ts` next to `searchFaces`, not
in `person.repository.ts` (that is where the face equivalent lives).

### Step 3 — verify

```bash
cd server
pnpm test -- --run src/repositories/machine-learning.repository.spec.ts
pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/pet-search.repository.spec.ts
pnpm test -- --run          # full unit suite
pnpm check
```

## Edge cases

- `refreshPetFaces` with an empty array must be a no-op, not a malformed SQL statement (test it).
- `searchPets` must validate `numResults >= 1` the same way `searchFaces` does — a `numResults` of 0
  throws in the existing implementation; keep that behaviour.
- Embeddings arrive from the ML service as a serialized string; pass them through unchanged (do not
  re-serialize with `asVector`, which is for raw `number[]`).

## Done criteria

- All unit + medium tests green, full server unit suite green, tsc clean.
- No service file touched.

## Commit

`feat(pet-recognition): embed request, pet_search writes and NN search`
