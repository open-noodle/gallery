# T09 — `GET /shared-spaces/:id/people` Listing

**Backlog row:** [T09 in 2026-04-06-e2e-coverage-backlog.md](./2026-04-06-e2e-coverage-backlog.md)
**Type:** Design (architectural — pins the space-vs-global person ID semantics that T10–T14 inherit)
**Status:** draft
**Blocked by:** T02

## Goal

Add coverage for `GET /shared-spaces/:id/people` — the listing endpoint that drives the "People in this space" panel. This task is the first one to touch the **shared space person sub-tree**, which has its own ID space (`shared_space_person.id` ≠ `person.id`) and is the source of repeated bugs (memory: PRs #196, #200, #202, #227, #233, #260, #291, #292).

T09 exists as its own design (not just a backlog stub) because it pins decisions that T10–T14 inherit:

- Which ID is canonical in test assertions (`spacePersonId` vs `globalPersonId`)?
- How `attachSpacePerson` returns both IDs and which one the spec uses for path parameters.
- How the `top` pagination param interacts with filtering.
- Which filters (`hidden`, `pets`, `minFaces`) are validated at the listing level vs. inherited from `shared_space.showPets` / `system_config.machineLearning.facialRecognition.minFaces`.

Once this design lands, T10–T14 follow the same pattern without needing their own design docs.

## Why space-person IDs are different

In the fork's data model, a face can belong to a `person` row (global, owned by the asset's owner) AND to a `shared_space_person` row (per-space, member-visible). The two have different IDs and different names (the space alias is stored on `shared_space_person`).

When a member of space X queries `GET /shared-spaces/X/people`, the response returns **space person IDs**, not global person IDs. Subsequent calls (`/people/:personId/thumbnail`, `/people/:personId`) take the space person ID in the path.

Memory entry `feedback_space_people_vs_global` captures this. Memory entry `project_space_filter_cross_filtering` (PR #260) was a one-line fix where the filter code matched a space person ID against a global person ID. The whole sub-tree is structured around this distinction, and tests must enforce it.

## What `attachSpacePerson` returns

From the T02 design:

```ts
attachSpacePerson(db, { spaceId, assetId, ownerUserId, name }):
  Promise<{ globalPersonId: string; spacePersonId: string; faceId: string }>
```

Both IDs are returned so tests can:

- Use `spacePersonId` for path parameters (`/shared-spaces/:id/people/:spacePersonId`).
- Use `globalPersonId` to assert that the global person row exists and is independent.
- Use `faceId` to delete the underlying face and assert cascade behaviour in T11.

## Endpoint under test

| Method | Path                        | Permission                   | Service check                  |
| ------ | --------------------------- | ---------------------------- | ------------------------------ |
| `GET`  | `/shared-spaces/:id/people` | `Permission.SharedSpaceRead` | `requireMembership` (any role) |

Query params (from `server/src/dtos/shared-space-person.dto.ts:6-40`):

- `limit` (1–100) — page size
- `offset` (≥0) — pagination offset
- `withHidden` (boolean) — when true, includes hidden persons (default: excluded)
- `named` (boolean) — when true, returns only persons with a non-empty name on either `shared_space_person.name` or the underlying `person.name`
- `takenAfter`, `takenBefore` (date) — restricts persons to those who appear in assets within the date window

There is no text-search filter on the name. `petsEnabled` is not a query param — the service reads it from `shared_space.petsEnabled` per call. Tests that toggle the pets filter mutate the column directly.

The listing query at `shared-space.repository.ts:512-513` filters with `where('person.thumbnailPath', 'is not', null).where('person.thumbnailPath', '!=', '')`. A space person whose underlying global `person` has a null/empty `thumbnailPath` is invisible to the listing — the fork's "minFaces gate" mechanism. `attachSpacePerson` sets a fixture `thumbnailPath` value so test data is visible to the listing.

## Test cases

### Setup (`beforeAll`)

```ts
ctx = await buildSpaceContext();

// Create four space-people on assets the spaceOwner owns.
// attachSpacePerson sets person.thumbnailPath = 'fixture/thumb.jpg' so the listing returns them.
namedPerson = await attachSpacePerson(db, {
  spaceId: ctx.spaceId,
  assetId: ctx.spaceAssetId,
  ownerUserId: ctx.spaceOwner.userId,
  name: 'Alice',
});

unnamedPerson = await attachSpacePerson(db, {
  spaceId: ctx.spaceId,
  assetId: ctx.spaceAssetId,
  ownerUserId: ctx.spaceOwner.userId,
  name: '', // empty name on both space-person row AND underlying person
});

hiddenPerson = await attachSpacePerson(db, {
  spaceId: ctx.spaceId,
  assetId: ctx.spaceAssetId,
  ownerUserId: ctx.spaceOwner.userId,
  name: 'Hidden Hannah',
});
// Mark hiddenPerson as hidden via direct DB update.
// (T11 covers PUT for the same operation; T09 keeps direct DB to avoid the dependency.)

// Pet — type field on shared_space_person
petPerson = await attachSpacePerson(db, {
  spaceId: ctx.spaceId,
  assetId: ctx.spaceAssetId,
  ownerUserId: ctx.spaceOwner.userId,
  name: 'Rex',
  type: 'pet',
});
```

### `describe('GET /shared-spaces/:id/people')`

1. **Access matrix**.

   ```ts
   forEachActor(
     [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anonActor],
     req(`/shared-spaces/${ctx.spaceId}/people`),
     { spaceOwner: 200, spaceEditor: 200, spaceViewer: 200, spaceNonMember: 403, anon: 401 },
   );
   ```

   Note: shared-space endpoints throw `ForbiddenException` (403) via `requireMembership`, not the 400 that timeline endpoints return. See T03 for the distinction.

2. **Returns space person IDs, not global person IDs.** The response includes `namedPerson.spacePersonId` but **not** `namedPerson.globalPersonId`. This is the canonical assertion for the whole sub-tree — every later test takes the IDs from this listing and uses them as path parameters.

3. **Hidden persons excluded by default (`withHidden=false`).** `hiddenPerson.spacePersonId` is NOT in the default response. Probes the PR #200 bug shape.

4. **`?withHidden=true` includes them.** Call with `?withHidden=true`, assert `hiddenPerson.spacePersonId` IS in the response.

5. **Unnamed persons included by default.** `unnamedPerson.spacePersonId` IS in the response when `named` is not specified.

6. **`?named=true` returns only named.** Call with `?named=true`, assert `namedPerson` IS present and `unnamedPerson` is NOT. Probes the named-vs-unnamed semantics from PR #233.

7. **Pets excluded when `space.petsEnabled = false`.**
   - Update `shared_space.petsEnabled = false` directly via DB.
   - Re-fetch the listing.
   - `petPerson.spacePersonId` is NOT in the response.
   - Restore `petsEnabled = true` in `try/finally` (per the fixture lifetime contract from T02).
   - Re-fetch, `petPerson.spacePersonId` IS in the response.
   - Probes memory `project_space_pet_toggle`.

### `describe('GET /shared-spaces/:id/people — pagination', () => { ... })`

Tests 8–10 live in a **nested describe** with their own `beforeAll`/`afterAll`. The nested block creates 15 extra named persons and deletes them in `afterAll`. Without this isolation, the 15 inserts would leak into tests 5/6 and any future test added between them — violating the fixture lifetime contract from T02.

```ts
describe('GET /shared-spaces/:id/people — pagination', () => {
  const extraPersonIds: string[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 15; i++) {
      const { spacePersonId } = await createSpacePerson(
        ctx.spaceId,
        `Extra ${i}`,
        ctx.spaceOwner.userId,
        ctx.spaceAssetId,
      );
      extraPersonIds.push(spacePersonId);
    }
  });

  afterAll(async () => {
    await db.deleteFrom('shared_space_person').where('id', 'in', extraPersonIds).execute();
  });

  // tests 8, 9, 10 below
});
```

8. **`?limit` pagination cap.** Call with `?limit=10`, assert response length ≤ 10. Call with default (no `limit`), assert response length ≥ 15.

9. **`?offset` pagination.** Call with `?limit=5&offset=0`, capture IDs. Call with `?limit=5&offset=5`, assert no overlap with the first page.

10. **Stable sort across calls.** Call with `?limit=5` twice, assert identical order both times. Pairs with test 9.

### Back in the parent `describe` block

11. **Empty global `thumbnailPath` excludes the space person.** Use `unnamedPerson.globalPersonId` (returned by the extended `createSpacePerson` helper) to update `person.thumbnailPath = ''` directly via DB. Re-fetch listing, assert `unnamedPerson.spacePersonId` is NOT in the response. Restore in try/finally. Probes the listing's hard requirement that `person.thumbnailPath IS NOT NULL AND != ''` (`shared-space.repository.ts:512-513`) — this is the fork's "minFaces gate" mechanism, and it's the test that protects T10–T14 from a future query refactor breaking the JOIN.

### Total

11 tests in this PR (7 in the parent describe + 3 in the nested pagination describe + 1 final). ~400-450 lines (including fixture setup).

## What is NOT in this PR

- Single-person retrieval, thumbnail, and assets list — **T10**.
- Update / hide / delete (PUT / DELETE) — **T11**.
- Merge — **T12**.
- Alias — **T13**.
- Deduplicate — **T14**.

T10–T14 share the `beforeAll` shape and the actor matrix. Each is small (5–9 tests).

## Decision log entries this PR generates

To be appended to the [backlog doc decision log](./2026-04-06-e2e-coverage-backlog.md#decision-log) when this design ships:

1. **Space person ID is canonical** (decision) — every test in T09–T14 derives the path parameter from the listing endpoint or from `attachSpacePerson`'s `spacePersonId` field. Never use the global `personId`.
2. **Sort order is stable across calls** (decision) — T09's pagination test pins it. T10–T12 inherit the assumption.
3. **Listing requires `person.thumbnailPath` non-null and non-empty** (decision) — `attachSpacePerson` MUST set this; the "minFaces gate" mechanism means a person without thumbnailPath is invisible to the listing. Test 11 protects this.
4. **Listing query params are `limit`/`offset`/`withHidden`/`named`/`takenAfter`/`takenBefore`** (decision) — there is no `top` parameter and no text-based `name` search. Pinned against `shared-space-person.dto.ts`.

To be appended to the **Open hypotheses** list (separate from the decision log) and resolved when T10 lands:

- **Hypothesis**: `hidden` and `pets` filters happen at the listing level only — `GET /shared-spaces/:id/people/:personId` against a hidden or pet-when-disabled person still returns 200. T09 cannot verify this; T10 must.

## Risks

| Risk                                                                                                                            | Mitigation                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attachSpacePerson` schema doesn't match the actual `asset_face` / `shared_space_person` tables (e.g. missing required column). | T02 (helpers) lands first and gets a schema-validated implementation. T09 surfaces issues quickly because it's the first real consumer of `attachSpacePerson`. |
| Test 8 (pagination loop) makes the test slow because it inserts 15 extra rows.                                                  | 15 rows is fine — direct DB inserts are fast. If it becomes a problem, drop to 10 and adjust assertions.                                                       |
| Test 11 depends on the listing's `thumbnailPath` requirement still being in place.                                              | If a future change drops the requirement, this test fails fast and forces a re-think. That's the test's job.                                                   |
| Direct DB updates (tests 7, 11) couple the test to the schema in ways API-only tests don't.                                     | Acceptable for this sub-tree. The whole point of `attachSpacePerson` is to bypass ML and direct DB inserts. The same pattern applies to setup-only mutations.  |
| Tests 7 and 11 mutate shared fixtures.                                                                                          | Both tests must restore the field in `try/finally` per the fixture lifetime contract in T02. Pin this in the spec template via a comment.                      |

## Definition of done

- [ ] `e2e/src/specs/server/api/shared-space.e2e-spec.ts` extended with a new `describe('GET /shared-spaces/:id/people')` block.
- [ ] All tests pass locally and in CI.
- [ ] Decision log entries added to the backlog doc.
- [ ] PR description links to this design doc and to the research doc §4 shared-space section.
- [ ] Backlog row T09 ticked with the PR number.
- [ ] If `attachSpacePerson` needed schema fixes, those land in this PR (not retroactively in T02).
