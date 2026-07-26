# Slice 4 — Species persistence, id-based pairing, no-embedding ⇒ bucket (F7, F8)

Plan for [the review-fixes spec](../specs/2026-07-26-pet-recognition-review-fixes-implementation-slices.md),
Slice 4. Baseline: Slices 1–3 landed.

## Implementation

### 1. Migration + schema

`server/src/schema/migrations-gallery/1785200000000-AddSpeciesToPetSearch.ts` adds a nullable
`species text` column (mirrored `down`), and `pet-search.table.ts` declares it
`@Column({ type: 'text', nullable: true })`. `1785000000000-CreatePetSearchTable` is **not**
amended — it may already be applied on RC/test databases.

The new migration must also be listed in `scripts/revert-to-immich.sql`'s step-8
`kysely_migrations` DELETE block. `src/schema/revert-to-immich.spec.ts` enforces this and caught
the omission during this slice.

### 2. `refreshPetFaces` — id-based pairing (F7)

```ts
refreshPetFaces(
  facesToAdd: (Insertable<AssetFaceTable> & { id: string; assetId: string })[],
  embeddingsToAdd: { faceId: string; embedding: string; species: string | null }[],
): Promise<void>
```

The caller pre-generates ids with `cryptoRepository.randomUUID()` (human precedent:
`person.service.ts` `refreshFaces`). No `RETURNING`, no return value, no ordering contract. Throws
on a length mismatch or an embedding naming a face not being inserted — with change 3 every face
has exactly one embedding, so a mismatch is a broken contract, not a tolerated case. Both guards run
**before** the transaction opens, so a rejected call writes nothing.

`@GenerateSql` params updated to the new shape.

### 3. No-embedding ⇒ bucket (review §5 change)

`handlePetDetection`'s recognition-enabled routing becomes:

- recognizable species **and** has an embedding → `writeDetectedPetsForRecognition`
- everything else (non-recognizable species **or** missing embedding) → `writeDetectedPetsAsSpeciesBuckets`

This is what makes §4's predicate-coverage note true: the individual pipeline can no longer write an
unassigned face with no `pet_search` row, which would match neither arm of `petFacePredicate` and so
be invisible to the Slice 2/3 protections.

`writeDetectedPetsForRecognition` now takes `(DetectedPet & { embedding: string })[]`, so the
"pets missing an embedding are ordered last" workaround and its comment block are deleted — obsolete
on both counts.

### 4. Species fallback (F8)

`writeDetectedPetsForRecognition` passes `species: pet.label` per embedding.
`getPetFaceForRecognition` already does `selectAll('pet_search')` via `withPetSearch`, so the column
flows through with no query change. Person creation becomes
`species: label ?? face.petSearch.species ?? null`.

## Tests

| #    | Layer  | Test                                                                                     | Red evidence                                                               |
| ---- | ------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| R4.1 | unit   | caller-generated ids + `{faceId, embedding, species}` pairs; one job per pet with its id | reworked from 5.2 (old `(faces, string[]) → string[]` shape)               |
| R4.2 | unit   | recognizable dog **without** embedding → bucket writer, no recognition job               | `expected 'failed' to deeply equal 'success'`                              |
| R4.3 | unit   | `label: undefined` + `petSearch.species: 'cat'` → person `species: 'cat'`                | spy not called with `{species: 'cat'}`                                     |
| R4.4 | unit   | **pin**: explicit label still wins                                                       | passes; proven red by preferring the stored species                        |
| R4.5 | medium | species round-trips; `null` species accepted                                             | new column                                                                 |
| R4.6 | medium | `information_schema`: `species` is `text` and nullable                                   | new column                                                                 |
| R4.7 | medium | embeddings supplied in **reverse** order still land on their own face                    | written post-fix; proven red by restoring positional pairing (cross-wired) |
| R4.8 | medium | throws on length mismatch and on an unknown faceId; nothing written                      | new guard                                                                  |

**Deviation:** the spec lists R4.8 as a unit test. `refreshPetFaces` is a repository method whose
guard throws before touching the database, so a unit test would need a fabricated Kysely. It is
written at the medium layer against the real repository instead — same assertion, no fake.

## Verify

```
cd server && pnpm exec vitest --config test/vitest.config.mjs --run       # full unit
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/pet-search.repository.spec.ts …
cd server && pnpm exec tsc --noEmit -p tsconfig.json
cd server && pnpm build && (cd .. && mise run sql)                        # SQL docs need a fresh dist
```

**SQL-doc note:** `mise run sql` executes `dist/bin/sync-sql.js`, so the server must be rebuilt
first or it silently regenerates the _old_ queries. Regenerating also flips
`search.repository.sql`'s `searchPets` trailer from `commit` to `rollback` on this machine — that
happens identically against the pre-slice build, so it is a local dev-DB artifact of the
`set local vchordrq.probes` transaction, not a product of this slice. That file is left untouched.

## Commit

`feat(pet-recognition): persist species, pair embeddings by id, bucket embedding-less pets`
