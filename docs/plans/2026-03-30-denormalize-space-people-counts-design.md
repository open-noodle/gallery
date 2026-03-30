# Denormalize Space Person Counts + Paginate Manage People Page

## Problem

After PR #227 eliminated the N+2 query loop, the space page loads fast (top 10 with LIMIT). However, the manage people page (`/spaces/{id}/people`) still runs a `GROUP BY` + `COUNT(DISTINCT)` aggregation across all people. For a space with 11k people, this is still slow. Additionally, the FilterPanel loads all people when it only needs named ones.

## Design

### 1. Schema Changes

**Fork migration** in `server/src/schema/migrations-gallery/`:

Add two columns to `shared_space_person`:

```sql
ALTER TABLE shared_space_person ADD COLUMN "faceCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shared_space_person ADD COLUMN "assetCount" INTEGER NOT NULL DEFAULT 0;
```

Add composite index for the paginated query pattern:

```sql
CREATE INDEX shared_space_person_space_count_idx
  ON shared_space_person("spaceId", "isHidden", "assetCount" DESC);
```

**Migration only adds columns with DEFAULT 0.** Backfill is a separate manual admin job (see section 5).

**Update table schema** in `server/src/schema/tables/shared-space-person.table.ts` to include `faceCount` and `assetCount` columns.

### 2. Count Maintenance

#### `recountPersons(personIds: string[])`

New repository method. Guard clause: if `personIds` is empty, return immediately (no-op). Recalculates counts for specific persons via correlated subqueries (one per row matched by `WHERE id = ANY($1)`):

```sql
UPDATE shared_space_person SET
  "faceCount" = (
    SELECT COUNT(*)
    FROM shared_space_person_face
    WHERE "personId" = shared_space_person.id
  ),
  "assetCount" = (
    SELECT COUNT(DISTINCT af."assetId")
    FROM shared_space_person_face spf
    JOIN asset_face af ON af.id = spf."assetFaceId"
    WHERE spf."personId" = shared_space_person.id
  )
WHERE id = ANY($1)
```

This is a correlated UPDATE: PostgreSQL evaluates both subqueries for each row matched by the `WHERE id = ANY($1)` clause, so each person gets its own correct counts.

**Concurrency safety:** Because `recountPersons` does a full recalculation (not increment/decrement), concurrent recounts are safe — last write wins and still produces correct results. Two jobs adding faces to the same person simultaneously will both trigger recounts, and the final state will be correct regardless of ordering.

#### Write Path Maintenance

| Write path                                       | Strategy                                                                                                                                                                                           | Recount                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `addPersonFaces(values, options?)`               | Add `skipRecount?: boolean` option. When `skipRecount` is false (default), calls `recountPersons` for affected personIds after insert. When empty values array, skip entirely.                     | Automatic (default) or deferred via `skipRecount` |
| `removePersonFacesByAssetIds(spaceId, assetIds)` | Query affected personIds **before** deleting, then delete, then `recountPersons(affectedIds)`. If no persons are affected, skip recount.                                                           | Targeted — only affected persons                  |
| `reassignPersonFaces(fromPersonId, toPersonId)`  | No automatic recount. Deferred to caller because the merge loop calls this multiple times and the source person is immediately deleted afterward — recounting source persons would be wasted work. | Deferred to caller                                |
| `deleteOrphanedPersons(spaceId)`                 | No recount needed — rows are deleted. Keeps using current subquery approach (not denormalized column) to determine orphans.                                                                        | None                                              |
| `createPerson(values)`                           | No special handling. New person starts with `faceCount: 0, assetCount: 0`. Covered by recount at end of face matching.                                                                             | None (covered by caller)                          |

#### Service-Level Coordination

**`processSpaceFaceMatch`** (face recognition — called per asset):

1. Collects all affected `personId`s during the face processing loop (including newly created persons and pet face persons)
2. Calls `addPersonFaces` with `{ skipRecount: true }` inside the loop (avoids per-face recount)
3. Calls `recountPersons(collectedIds)` once at the end (deduplicated set of personIds)

Note: `handleSharedSpaceFaceMatchAll` queues individual `SharedSpaceFaceMatch` jobs per asset. Each job calls `processSpaceFaceMatch` independently and triggers its own recount. This is correct — each asset only affects a few persons and the recount is per-asset, not per-batch.

Note: `handleSharedSpaceLibraryFaceSync` processes assets in batches of 1000, calling `processSpaceFaceMatch` per asset within each batch. Same pattern — each asset triggers its own recount. A library sync of 10k assets triggers 10k recounts, but each recount is cheap (indexed COUNT on a few personIds).

**`mergeSpacePeople`** (person merge):

1. Loops through source persons, calling `reassignPersonFaces(source, target)` for each
2. Deletes each source person
3. Calls `recountPersons([targetId])` once after the loop

**`removeAssets`** (asset removal from space):

1. `removePersonFacesByAssetIds` internally: captures affected personIds, deletes faces, then calls `recountPersons(affectedIds)` — the recount happens inside the repository method, not as a separate service call
2. `deleteOrphanedPersons` runs after — uses subquery to find persons with zero faces, deletes them

Ordering: delete faces + recount (inside `removePersonFacesByAssetIds`) → delete orphans. The service method `removeAssets` does not need explicit recount coordination.

### 3. Replace Aggregation Query

**Remove** `getPersonsBySpaceIdWithCounts` (the GROUP BY query from PR #227).

**Remove** `getPersonFaceCount` and `getPersonAssetCount`. Update `getSpacePerson` and `updateSpacePerson` to read counts from the person row instead of making separate queries. The `getPersonById` method uses `selectAll('shared_space_person')` which will include the new columns automatically. The `mapSpacePerson` method currently takes `faceCount` and `assetCount` as separate parameters — refactor it to read from the person object directly (e.g., `person.faceCount`, `person.assetCount`).

**Replace with** a simple SELECT method (e.g., `getPersonsBySpaceId`):

- SELECT from `shared_space_person` — `faceCount` and `assetCount` come from columns
- LEFT JOIN through `representativeFaceId` → `asset_face` → `person` for `personalName` and `personalThumbnailPath`
- Filters: `isHidden`, `type` (pets), `person.thumbnailPath IS NOT NULL AND != ''`
- Named filter: `WHERE (shared_space_person.name != '' OR (person.name IS NOT NULL AND person.name != ''))` — uses explicit OR logic, NOT coalesce (coalesce would return empty string if `shared_space_person.name` is `''`, incorrectly skipping the `person.name` check). Note: aliases are per-user and resolved after the query via the alias map — they do not affect the `named` filter.
- Temporal filter: EXISTS subquery on `shared_space_person_face` → `asset_face` → `asset.fileCreatedAt`. Filters _which persons appear_, counts stay all-time totals. **Known limitation:** when a temporal filter is active, `faceCount`/`assetCount` show all-time totals, not temporally-scoped counts. This matches the behavior from PR #227 and is acceptable since counts are only used for sorting, not displayed.
- Sort: `ORDER BY (CASE WHEN shared_space_person.name != '' OR (person.name IS NOT NULL AND person.name != '') THEN 0 ELSE 1 END), assetCount DESC` — named people first, then by count. Uses the same explicit OR logic as the named filter.
- Optional `LIMIT` and `OFFSET` for pagination

### 4. API Changes

**`SpacePeopleQueryDto`** modifications:

- Rename `top` → `limit` (remove `top`)
- Add `offset?: number` — `@IsOptional()`, `@Type(() => Number)`, `@IsInt()`, `@Min(0)`
- Add `named?: boolean` — `@ValidateBoolean({ optional: true })` — filter to only people with a name (from either space person name or personal person name). Works independently of `withHidden` — you can request named hidden people.

**No response shape change.** Infinite scroll uses "load until fewer items than page size returned" — no total count needed.

**Backfill admin endpoint:** Add a new endpoint (e.g., `POST /admin/jobs/backfill-space-person-counts`) that queues the backfill job. Pattern matches existing admin job triggers in `QueuePanel.svelte`.

### 5. Backfill Job

A manual admin trigger (button on admin jobs page) that runs a background job:

1. Queries all `shared_space_person` rows that have at least one face but `faceCount = 0` (identifies unbackfilled rows)
2. Processes in batches of 100
3. Calls `recountPersons(batchIds)` per batch
4. Idempotent — safe to run multiple times (recalculation always produces correct result)

**New installs** don't need backfill — face matching creates persons going forward with automatic recount after each asset's faces are processed.

**Upgrades** need manual trigger. Document this in release notes. Until backfill runs, the manage people page shows people sorted by `assetCount = 0` (wrong order) but nothing breaks functionally.

Can be removed in a future release once all users have migrated.

### 6. Web Changes

**Manage people page** (`/spaces/[spaceId]/people`):

- Page loader calls `getSpacePeople({ id, limit: 50 })` for initial load
- Infinite scroll: on scroll to bottom, load next 50 with `offset`
- Stop loading when fewer than 50 returned
- Remove client-side sort — server provides correct order (named first, then by assetCount DESC)

**FilterPanel people provider:**

- Calls `getSpacePeople({ id, named: true })` — relies on default `withHidden: false` to also exclude hidden people (no need to pass `withHidden` explicitly). Removes client-side `people.filter((p) => !p.isHidden && p.name)`.

**Map filter config** (`web/src/lib/utils/map-filter-config.ts`):

- Same change — calls with `named: true` instead of client-side filtering

**People strip** (space page):

- Uses `limit: 10` (renamed from `top: 10`)

**Merge picker** (`/spaces/[spaceId]/people/[personId]/+page.ts`):

- Loads all people without pagination when `action === 'merge'`. Acceptable — merge is an infrequent action and requires seeing all candidates.

**Visibility modal** (`withHidden: true`):

- Loads all — acceptable since it's an infrequent action

### 7. What Doesn't Change

- Face matching service logic (just `addPersonFaces` calls get `skipRecount: true`, recount added at end)
- Merge/delete service logic (just recount deferred to after loop)
- `deleteOrphanedPersons` — keeps current subquery approach
- No changes to mobile

## Testing Strategy (TDD)

All implementation follows TDD: write failing test first, implement minimally to pass, refactor.

### Server Unit Tests (`shared-space.service.spec.ts`)

**Count maintenance tests:**

1. `addPersonFaces` should call `recountPersons` with affected personIds when `skipRecount` is not set
2. `addPersonFaces` should NOT call `recountPersons` when `skipRecount: true`
3. `addPersonFaces` with empty values array should not call recount
4. `removePersonFacesByAssetIds` should query affected personIds before deleting and recount only those
5. `removePersonFacesByAssetIds` where no persons are affected should not call recount
6. `processSpaceFaceMatch` should collect all personIds (including newly created persons and pet faces) and call `recountPersons` once at the end
7. `processSpaceFaceMatch` should pass `skipRecount: true` to all `addPersonFaces` calls
8. `mergeSpacePeople` should call `recountPersons([targetId])` once after all sources are reassigned
9. `mergeSpacePeople` should NOT call `recountPersons` for source persons (they are deleted)
10. Merge where target already has faces — target count should reflect sum of all reassigned faces
11. `removeAssets` should recount affected persons before calling `deleteOrphanedPersons`

**`getSpacePeople` pagination tests:**

12. Should pass `limit` and `offset` to repository
13. Should return results in server order (named first, then by assetCount DESC)
14. Should pass `named: true` to repository when query param is set
15. Should read `faceCount`/`assetCount` from person object (not separate queries)
16. `offset` larger than total count should return empty array
17. `named` + `withHidden` combination should return named hidden people

**`getSpacePerson` / `updateSpacePerson` tests:**

18. Should read `faceCount`/`assetCount` from the person row (no separate count queries)

### Server Medium Tests (`shared-space.repository.spec.ts`)

**`recountPersons` tests:**

19. Should set correct `faceCount` for a person with multiple faces
20. Should set correct `assetCount` (distinct assets) when multiple faces reference the same asset
21. Should set counts to 0 for a person with no faces
22. Should update multiple persons in a single call
23. `recountPersons` with empty array should be a no-op
24. Pet faces should be counted correctly (same `shared_space_person_face` table)

### Backfill Job Tests

25. Should process persons in batches of 100
26. Should only backfill persons with `faceCount = 0` that have faces
27. Should handle spaces with 0 people (no-op)
28. Should be idempotent — running twice produces same result
29. Should handle empty database (no-op)

### End-to-End Tests

30. `GET /shared-spaces/:id/people?limit=2&offset=0` returns exactly 2 people
31. `GET /shared-spaces/:id/people?limit=2&offset=2` returns next 2 people (different from first page)
32. `GET /shared-spaces/:id/people?named=true` returns only people with names
33. `GET /shared-spaces/:id/people?offset=9999` returns empty array
34. After adding faces to a space person, `faceCount`/`assetCount` are updated in subsequent GET (use `expect.poll` since face matching is a background job)

### Web Tests

**Manage people page:**

35. Should load initial page with `limit: 50`
36. Should load next page on scroll with correct `offset`
37. Should stop loading when fewer than 50 items returned
38. Should not re-sort items client-side (preserve server order)

**FilterPanel:**

39. Should call `getSpacePeople` with `named: true`

**People strip:**

40. Should call `getSpacePeople` with `limit: 10` (not `top: 10`)

**Map filter config:**

41. Should call `getSpacePeople` with `named: true`

### Migration Tests

42. Columns exist after migration with DEFAULT 0
43. Index exists after migration
44. Migration on empty database succeeds

### Additional Edge Case Tests

45. `processSpaceFaceMatch` with zero faces on asset (both regular and pet) — should call `recountPersons` with empty array (no-op via guard)
46. `mapSpacePerson` reads `faceCount`/`assetCount` from person object directly (no separate query calls)
