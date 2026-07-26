# Slice 2 — Human reset & fan-out isolation (F1, F2, F3)

Plan for [the review-fixes spec](../specs/2026-07-26-pet-recognition-review-fixes-implementation-slices.md),
Slice 2. Baseline: Slice 1 landed (`deleteAllPets` also purges unassigned pet faces).

**Goal:** no human facial-recognition or face-detection **queue-level** operation can delete,
unassign, unlink, or enqueue jobs for pet faces — owner-side and shared-space pet data survive any
human reset.

## Ground truth (verified in the tree)

| Thing                                                    | Location                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `DeleteFacesOptions` / `UnassignFacesOptions` (an alias) | `person.repository.ts:73`, `:107`                                              |
| `GetAllFacesOptions`                                     | `person.repository.ts:84`                                                      |
| `unassignFaces`                                          | `person.repository.ts:241`                                                     |
| `deleteFaces`                                            | `person.repository.ts:259`                                                     |
| `getAllFaces`                                            | `person.repository.ts:290`                                                     |
| `unlinkFacesBySourceType`                                | `face-identity.repository.ts:2356`                                             |
| `deleteAllPersonFaces` / `deleteAllPersons`              | `shared-space.repository.ts:3178` / `:3183`, both `@GenerateSql({params: []})` |
| detect force call site                                   | `person.service.ts:742`                                                        |
| recognize force call sites                               | `person.service.ts:920-921`, `:928-929`                                        |
| recognize fan-out (one ternary serves force + nightly)   | `person.service.ts:942-944`                                                    |

`shared_space_person.type` is `Generated<string>` with default `'person'` and **NOT NULL**
(`shared-space-person.table.ts:59-60`), so a plain `type != 'pet'` filter is safe — no NULL arm
needed.

`src/utils/database.ts` already imports `ExpressionBuilder`, `sql` and `DB` — the predicate needs no
new imports.

Both shared-space methods keep `@GenerateSql({ params: [] })`; the new options parameter defaults to
`{}`, so the generated SQL for the zero-arg call is byte-identical and `mise //:sql` produces no
diff. (Confirmed in the Slice 9 gate.)

## Implementation

### 1. `server/src/utils/database.ts` — the canonical predicate

Exactly as locked in spec §4:

```ts
/** A pet face: has a pet embedding, or is assigned to a pet person. Pet faces share
 *  sourceType 'machine-learning' with human faces, so this predicate is the ONLY way
 *  human-pipeline queries can avoid destroying pet data (F1–F4). */
export const petFacePredicate = (eb: ExpressionBuilder<DB, 'asset_face'>) =>
  eb.or([
    eb.exists(
      eb
        .selectFrom('pet_search')
        .select(sql`1`.as('one'))
        .whereRef('pet_search.faceId', '=', 'asset_face.id'),
    ),
    eb.exists(
      eb
        .selectFrom('person')
        .select(sql`1`.as('one'))
        .whereRef('person.id', '=', 'asset_face.personId')
        .where('person.type', '=', 'pet'),
    ),
  ]);
```

### 2. `person.repository.ts`

- `DeleteFacesOptions` gains `excludePetFaces?: boolean` (covers `UnassignFacesOptions` via the alias).
- `GetAllFacesOptions` gains `excludePetFaces?: boolean`.
- `unassignFaces`, `deleteFaces`, `getAllFaces` each get
  `.$if(!!options.excludePetFaces, (qb) => qb.where((eb) => eb.not(petFacePredicate(eb))))`.

### 3. `face-identity.repository.ts`

`unlinkFacesBySourceType(sourceType, options: { excludePetFaces?: boolean } = {})` — attach the
negated predicate to the inner `asset_face` subquery, not the outer delete.

### 4. `shared-space.repository.ts`

- `deleteAllPersonFaces(options: { excludePets?: boolean } = {})` — `shared_space_person_face` has no
  `type` column of its own (`personId` + `assetFaceId` only), so the filter goes through the parent:
  exclude rows whose `personId` is in the pet-typed `shared_space_person` set.
- `deleteAllPersons(options: { excludePets?: boolean } = {})` — `type != 'pet'`.

### 5. `person.service.ts` — the five call sites

| Site                                       | Change                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `handleQueueDetectFaces` force             | `deleteFaces({ sourceType: ML, excludePetFaces: true })`                                 |
| `handleQueueRecognizeFaces` force          | `unassignFaces({ sourceType: ML, excludePetFaces: true })`                               |
| `handleQueueRecognizeFaces` force          | `unlinkFacesBySourceType(ML, { excludePetFaces: true })`                                 |
| `handleQueueRecognizeFaces` force (spaces) | `deleteAllPersonFaces({ excludePets: true })`, `deleteAllPersons({ excludePets: true })` |
| `handleQueueRecognizeFaces` fan-out        | `excludePetFaces: true` on **both** ternary arms (one `getAllFaces` call)                |

### 6. Deliberately unchanged

`handlePersonCleanup` / `getAllWithoutFaces` stay **generic** (no `type` filter). After 1–5 pet
persons keep their faces through a human reset, so cleanup no longer reaches them — and a pet person
with genuinely zero faces _should_ still be collected (R2.6 pins that).

Pet-side paths (`getUnassignedPetFaces`, `deleteAllPets`, `refreshPetFaces`) are pet-scoped by
construction. `face-repair` uses the person-scoped `unassignFacesFromPerson`, whose eligibility
stream inner-joins `face_search`, so pet faces can never be selected — no change.

## Tests (write first)

New medium spec `server/test/medium/specs/services/pet-human-isolation.service.spec.ts`, modelled on
`person.service.spec.ts`'s existing `setupFaceRecognition` / `setupFaceDetection` helpers (same real
repo list, same `JobRepository` mock defaults incl. `getJobCounts`, same `SystemMetadataRepository`
`mockImplementation((key) => …)` shape). Seed pet fixtures inline per §3.

**Medium mechanics note:** `handleQueueRecognizeFaces` _queues_ fan-out jobs (captured by the mocked
`JobRepository`) — it does not execute them. R2.1/R2.2 assert DB state after the handler returns plus
the captured job list. Do **not** replay the captured `FacialRecognition` jobs.

| #    | Layer  | Assertion                                                                                                                                                                      | Expected red                          |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| R2.1 | medium | F1: named pet person + faces + `pet_search` + `face_identity(type='pet')`; after `handleQueueRecognizeFaces({force:true})` pet keeps name/faces/embeddings/links, humans reset | pet person deleted / faces unassigned |
| R2.2 | medium | F3: after `handleQueueDetectFaces({force:true})` pet faces + `pet_search` survive; human ML faces deleted                                                                      | pet faces hard-deleted                |
| R2.3 | medium | F2: 1 unassigned pet face (+`pet_search`) + 1 unassigned human face, non-force fan-out → exactly one `FacialRecognition` job, for the human                                    | two jobs queued                       |
| R2.4 | medium | force fan-out also excludes assigned pet faces                                                                                                                                 | pet face queued                       |
| R2.5 | medium | `handlePersonCleanup` after a human force reset deletes zero-face human persons but no pet person                                                                              | pet person deleted                    |
| R2.6 | medium | a pet person whose faces were genuinely all removed **is** deleted by `handlePersonCleanup` (cleanup stays generic)                                                            | passes — pin, mutate-red-revert       |
| R2.7 | unit   | the five call sites pass `excludePetFaces: true` / `excludePets: true` (one assertion per site)                                                                                | options absent                        |
| R2.8 | medium | pin: with **no** pet data, R2.1's human-reset outcome is unchanged                                                                                                             | passes — pin, mutate-red-revert       |
| R2.9 | medium | F1/spaces: space pet copy + face links survive a force recognize; human copy wiped                                                                                             | space pet copy deleted                |

R2.7 lives in `server/src/services/person.service.spec.ts`. Existing unit tests there assert the
exact old call shapes (e.g. `deleteFaces` called with `{ sourceType: MachineLearning }`) and will go
red on the new options object — update them as part of this slice; that churn is expected, not a
regression.

Pin protocol (§2) for R2.6 and R2.8: mutate the pinned behaviour (give `getAllWithoutFaces` a
`type = 'person'` filter for R2.6; drop an exclusion for R2.8), confirm red, revert.

## Verify

```
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/pet-human-isolation.service.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/person.service.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.mjs --run    # full unit, collateral
```

## Commit

`fix(pet-recognition): isolate pet faces from human reset and fan-out paths`
