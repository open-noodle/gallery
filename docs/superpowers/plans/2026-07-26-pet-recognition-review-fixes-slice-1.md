# Slice 1 — Purge completeness (F5)

Plan for [the review-fixes spec](../specs/2026-07-26-pet-recognition-review-fixes-implementation-slices.md),
Slice 1. Scope: `deleteAllPets()` must also remove **unassigned** pet faces — the ones only a
`pet_search` row identifies.

## Current behaviour (verified)

`server/src/repositories/person.repository.ts:263-276`:

```ts
async deleteAllPets(): Promise<void> {
  await this.db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom('asset_face')
      .where('asset_face.personId', 'in', (eb) =>
        eb.selectFrom('person').select('person.id').where('person.type', '=', 'pet'),
      )
      .execute();

    await trx.deleteFrom('person').where('person.type', '=', 'pet').execute();
  });
}
```

Only **person-scoped**. A recognition-written face that was never clustered has `personId: null`, so
it survives — and `handleQueuePetRecognition`'s force path then calls `deleteAllPetSearch()`
(truncate), destroying the only thing that identified it. Result: a permanent orphan `asset_face`
row with no person and no embedding.

## Change

Insert one statement **before** the two existing deletes, inside the same transaction:

```ts
// Unassigned pet faces (recognition-written, not yet clustered) are invisible to the
// person-scoped delete below — the pet_search join is the only thing that identifies
// them. Delete them first, while their pet_search rows still exist (F5: the old order
// truncated pet_search first via deleteAllPetSearch, orphaning these rows forever).
await trx
  .deleteFrom('asset_face')
  .where('asset_face.id', 'in', (eb) => eb.selectFrom('pet_search').select('pet_search.faceId'))
  .execute();
```

Ordering matters and is what R1.1 proves by outcome. No signature change, no callers to update —
both force paths (recognition force, detection force) get the fix for free.

## Tests (write first, in `server/test/medium/specs/services/pet-recognition.service.spec.ts`)

New `describe('PersonRepository.deleteAllPets (medium)')` block using `ctx.get(PersonRepository)`
and the inline-fixture pattern already in the file (`ctx.newUser` / `newAsset` / `newAssetFace` +
raw `pet_search` insert).

| #    | Test                                                                                                                                      | Expected red                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| R1.1 | unassigned face + `pet_search` row → gone after `deleteAllPets()`                                                                         | FAILS: face row still present (`toHaveLength(0)` gets 1) |
| R1.2 | **pin**: assigned pet face + pet person + `pet_search` row → all three gone                                                               | passes; mutate-red-revert per §2                         |
| R1.3 | **pin**: human person + face + `face_search` row untouched                                                                                | passes; mutate-red-revert per §2                         |
| R1.4 | BDD force reset: 1 assigned + 1 unassigned pet face + 2 human faces, `handleQueuePetRecognition({force: true})` → only human faces remain | FAILS: unassigned pet face survives                      |

R1.4 lives in the existing `handleQueuePetRecognition (medium)` describe block.

Pin protocol (§2) for R1.2/R1.3: after they pass, temporarily delete the person-scoped face delete
(R1.2) / add a blanket `asset_face` delete (R1.3), confirm red, revert.

## Verify

```
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/pet-recognition.service.spec.ts
```

Plus the server unit suite as a collateral check (no production callers changed, so this is a
formality).

No `@GenerateSql` decorator on `deleteAllPets` → no SQL-doc regeneration needed for this slice.

## Commit

`fix(pet-recognition): purge unassigned pet faces in deleteAllPets`
