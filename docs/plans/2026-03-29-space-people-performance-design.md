# Space People Performance Fix

## Problem

Loading people in a shared space with 11,000 people takes ~10 seconds. The `getSpacePeople` service method executes an N+2 query loop:

1. 1 query to fetch all persons for a space
2. N queries to `getPersonFaceCount` (one per person)
3. N queries to `getPersonAssetCount` (one per person)

For 11,000 people = 22,001 sequential database queries. The face/asset counts are only used for sorting (not displayed). Additionally, the web client makes two redundant API calls to `getSpacePeople`.

## Design

### Server - Repository

New method `getPersonsBySpaceIdWithCounts(spaceId, options)`:

- Single query with `GROUP BY` + `COUNT(DISTINCT asset_face.assetId)` and `COUNT(*)` for face count
- JOINs: `shared_space_person` -> `shared_space_person_face` -> `asset_face` -> `person` (for thumbnailPath)
- All filtering pushed into SQL: `isHidden`, `type` (pets), `personalThumbnailPath IS NOT NULL`
- Optional `LIMIT` parameter for top-N queries
- Optional temporal filter (`takenAfter`/`takenBefore`) merged in
- Replaces: `getPersonsBySpaceId`, `getPersonsBySpaceIdWithTemporalFilter`
- Note: `getPersonFaceCount` and `getPersonAssetCount` are kept — still used by `getSpacePerson` and `updateSpacePerson` for single-person detail views
- Behavioral note: The INNER JOIN on `shared_space_person_face` naturally excludes persons with zero faces, which is desired (they have no photos to show)

```sql
SELECT
  sp.*,
  p.name as "personalName",
  p."thumbnailPath" as "personalThumbnailPath",
  COUNT(DISTINCT af."assetId") as "assetCount",
  COUNT(*) as "faceCount"
FROM shared_space_person sp
JOIN shared_space_person_face spf ON spf."personId" = sp.id
JOIN asset_face af ON af.id = spf."assetFaceId"
LEFT JOIN person p ON p.id = af."personId"
WHERE sp."spaceId" = $1
  AND sp."isHidden" = false
  AND p."thumbnailPath" IS NOT NULL
  AND p."thumbnailPath" != ''
GROUP BY sp.id, p.name, p."thumbnailPath"
ORDER BY "assetCount" DESC
LIMIT 10  -- optional
```

Index usage: PK on `shared_space_person_face` is `(personId, assetFaceId)` -- `personId` is leading column. `asset_face.id` is its PK. `shared_space_person.spaceId` has a dedicated index.

### Server - DTO

Add optional `top` parameter to `SpacePeopleQueryDto`:

```typescript
@IsOptional()
@Type(() => Number)
@IsInt()
@Min(1)
@Max(100)
top?: number;
```

### Server - Service

`getSpacePeople` simplified:

- Calls `getPersonsBySpaceIdWithCounts` with `{ withHidden, petsEnabled, limit: query.top, takenAfter, takenBefore }`
- Alias lookup narrowed to returned person IDs only
- No more JS-side filtering loop

### Web - Space Page

- `loadSpacePeople()` calls `getSpacePeople({ id, top: 10 })` -- returns top 10 for the people strip
- FilterPanel `people` provider calls `getSpacePeople({ id })` without `top` -- all named people with counts (still fast, single query)
- Remove `peopleCount` from the hero badge (eliminates need for a separate count query)

### Web - People Management Page

`/spaces/[spaceId]/people` continues calling without `top` -- gets all people with real counts via the same aggregated query. Single query on 11,000 people with GROUP BY is fast (~50-100ms).

## What Doesn't Change

- `getSpacePerson` (single person detail) -- 2 count queries for 1 person, acceptable
- `updateSpacePerson` -- unchanged
- All write paths (face matching, merge, deletion) -- unchanged
- No schema changes, no migrations

## Performance Impact

- Before: 22,001 queries, ~10 seconds
- After: 1 query (strip, LIMIT 10) + 1 query (FilterPanel, no LIMIT), ~100ms total
