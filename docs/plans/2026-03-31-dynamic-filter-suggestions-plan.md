# Dynamic Filter Suggestions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a filter is applied, all other filter panels dynamically update to show only values present in the current filtered result set.

**Architecture:** New unified `GET /search/suggestions/filters` endpoint returns all suggestion categories in one round trip. Uses faceted search (exclude-own-filter) so each category shows values matching all _other_ active filters. A shared `buildFilteredAssetIds` helper eliminates duplication across the 6 extraction queries. FilterPanel gets a new `suggestionsProvider` that replaces individual providers when present.

**Tech Stack:** NestJS (server), Kysely (queries), Svelte 5 (web), Vitest (tests)

**Design doc:** `docs/plans/2026-03-31-dynamic-filter-suggestions-design.md`

---

### Task 1: `without()` Utility + Tests

**Files:**

- Create: `server/src/utils/filter-suggestions.ts`
- Create: `server/src/utils/filter-suggestions.spec.ts`

**Step 1: Write the failing tests**

In `server/src/utils/filter-suggestions.spec.ts`:

```typescript
import { without } from 'src/utils/filter-suggestions';

describe('without', () => {
  it('should remove a single key', () => {
    const opts = { country: 'Germany', make: 'Canon', rating: 4 };
    expect(without(opts, 'country')).toEqual({ country: undefined, make: 'Canon', rating: 4 });
  });

  it('should remove hierarchical pair (country + city)', () => {
    const opts = { country: 'Germany', city: 'Munich', make: 'Canon' };
    expect(without(opts, 'country', 'city')).toEqual({ country: undefined, city: undefined, make: 'Canon' });
  });

  it('should remove hierarchical pair (make + model)', () => {
    const opts = { make: 'Canon', model: 'EOS R5', country: 'Germany' };
    expect(without(opts, 'make', 'model')).toEqual({ make: undefined, model: undefined, country: 'Germany' });
  });

  it('should preserve keys not in the exclusion list', () => {
    const opts = { country: 'Germany', personIds: ['p1'], takenAfter: new Date('2024-01-01'), spaceId: 'sp1' };
    const result = without(opts, 'country');
    expect(result.personIds).toEqual(['p1']);
    expect(result.takenAfter).toEqual(new Date('2024-01-01'));
    expect(result.spaceId).toBe('sp1');
  });

  it('should handle keys that are already undefined', () => {
    const opts = { country: undefined, make: 'Canon' };
    expect(without(opts, 'country')).toEqual({ country: undefined, make: 'Canon' });
  });

  it('should not mutate the original object', () => {
    const opts = { country: 'Germany', make: 'Canon' };
    without(opts, 'country');
    expect(opts.country).toBe('Germany');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/utils/filter-suggestions.spec.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

In `server/src/utils/filter-suggestions.ts`:

```typescript
export function without<T extends Record<string, unknown>>(options: T, ...keys: (keyof T)[]): T {
  const result = { ...options };
  for (const key of keys) {
    result[key] = undefined as T[keyof T];
  }
  return result;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd server && pnpm test -- --run src/utils/filter-suggestions.spec.ts`
Expected: PASS (6 tests)

**Step 5: Commit**

```
feat: add without() utility for faceted filter exclusion
```

---

### Task 2: DTO + Response Types

**Files:**

- Modify: `server/src/dtos/search.dto.ts` (after `TagSuggestionResponseDto` at line 375)

**Step 1: Add `FilterSuggestionsRequestDto` and `FilterSuggestionsResponseDto`**

Add after the `TagSuggestionResponseDto` class (line 375) in `server/src/dtos/search.dto.ts`:

```typescript
export class FilterSuggestionsPersonDto {
  @ApiProperty({ description: 'Person ID' })
  id!: string;

  @ApiProperty({ description: 'Person name' })
  name!: string;
}

export class FilterSuggestionsTagDto {
  @ApiProperty({ description: 'Tag ID' })
  id!: string;

  @ApiProperty({ description: 'Tag value/name' })
  value!: string;
}

export class FilterSuggestionsResponseDto {
  @ApiProperty({ type: [String], description: 'Available countries' })
  countries!: string[];

  @ApiProperty({ type: [String], description: 'Available camera makes' })
  cameraMakes!: string[];

  @ApiProperty({ type: [FilterSuggestionsTagDto], description: 'Available tags' })
  tags!: FilterSuggestionsTagDto[];

  @ApiProperty({
    type: [FilterSuggestionsPersonDto],
    description: 'Available people (named, non-hidden, with thumbnails)',
  })
  people!: FilterSuggestionsPersonDto[];

  @ApiProperty({ type: [Number], description: 'Available ratings' })
  ratings!: number[];

  @ApiProperty({ type: [String], description: 'Available media types' })
  mediaTypes!: string[];

  @ApiProperty({ description: 'Whether unnamed people exist in the filtered set' })
  hasUnnamedPeople!: boolean;
}

export class FilterSuggestionsRequestDto {
  @ValidateUUID({ each: true, optional: true, description: 'Filter by person IDs' })
  personIds?: string[];

  @ApiPropertyOptional({ description: 'Filter by country' })
  @IsString()
  @Optional()
  country?: string;

  @ApiPropertyOptional({ description: 'Filter by city' })
  @IsString()
  @Optional()
  city?: string;

  @ApiPropertyOptional({ description: 'Filter by camera make' })
  @IsString()
  @Optional()
  make?: string;

  @ApiPropertyOptional({ description: 'Filter by camera model' })
  @IsString()
  @Optional()
  model?: string;

  @ValidateUUID({ each: true, optional: true, description: 'Filter by tag IDs' })
  tagIds?: string[];

  @Property({
    type: 'number',
    description: 'Filter by rating (1-5)',
    minimum: 1,
    maximum: 5,
  })
  @Optional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ValidateEnum({ enum: AssetType, name: 'AssetTypeEnum', optional: true, description: 'Filter by asset type' })
  mediaType?: AssetType;

  @ValidateBoolean({ optional: true, description: 'Filter by favorites' })
  isFavorite?: boolean;

  @ValidateDate({ optional: true, description: 'Filter by taken date (after)' })
  takenAfter?: Date;

  @ValidateDate({ optional: true, description: 'Filter by taken date (before)' })
  takenBefore?: Date;

  @ValidateUUID({ optional: true, description: 'Scope to a specific shared space' })
  spaceId?: string;

  @ValidateBoolean({ optional: true, description: 'Include shared spaces the user is a member of' })
  withSharedSpaces?: boolean;
}
```

**Step 2: Verify compilation**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to these new types

**Step 3: Commit**

```
feat: add FilterSuggestions DTOs for unified filter endpoint
```

---

### Task 3: Repository — `FilterSuggestionsOptions` Interface + Shared `buildFilteredAssetIds` Helper

This task creates the shared helper that all 6 extraction methods will reuse, eliminating ~100 lines of duplicated space/temporal/exif/person/tag/media/favorite filter boilerplate.

**Files:**

- Modify: `server/src/repositories/search.repository.ts`

**Step 1: Add the options interface**

After the existing `GetCameraLensModelsOptions` interface (line ~198), add:

```typescript
export interface FilterSuggestionsOptions extends SpaceScopeOptions {
  personIds?: string[];
  country?: string;
  city?: string;
  make?: string;
  model?: string;
  tagIds?: string[];
  rating?: number;
  mediaType?: AssetType;
  isFavorite?: boolean;
}

export interface FilterSuggestionsResult {
  countries: string[];
  cameraMakes: string[];
  tags: Array<{ id: string; value: string }>;
  people: Array<{ id: string; name: string }>;
  ratings: number[];
  mediaTypes: string[];
  hasUnnamedPeople: boolean;
}
```

**Step 2: Add the `buildFilteredAssetIds` private helper**

Add after the existing `getExifField` method (line ~636). This returns a subquery selecting `asset.id` from assets matching all provided filters. Every extraction method will use this as their base, calling `without()` to exclude their own category first.

```typescript
/**
 * Builds a subquery that selects asset IDs matching all provided filters.
 * Used as the shared base for all filter suggestion extraction queries.
 * Each caller passes `without(options, ...)` to exclude their own category.
 */
private buildFilteredAssetIds(userIds: string[], options: FilterSuggestionsOptions) {
  return this.db
    .selectFrom('asset')
    .select('asset.id')
    .where('asset.visibility', '=', AssetVisibility.Timeline)
    .where('asset.deletedAt', 'is', null)
    // User/space scoping (same pattern as getExifField)
    .$if(!options.spaceId && !options.timelineSpaceIds, (qb) =>
      qb.where('asset.ownerId', '=', anyUuid(userIds)),
    )
    .$if(!!options.spaceId && !options.timelineSpaceIds, (qb) =>
      qb.where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .whereRef('shared_space_asset.assetId', '=', 'asset.id')
              .where('shared_space_asset.spaceId', '=', asUuid(options.spaceId!)),
          ),
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
              .where('shared_space_library.spaceId', '=', asUuid(options.spaceId!)),
          ),
        ]),
      ),
    )
    .$if(!!options.timelineSpaceIds, (qb) =>
      qb.where((eb) =>
        eb.or([
          eb('asset.ownerId', '=', anyUuid(userIds)),
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .whereRef('shared_space_asset.assetId', '=', 'asset.id')
              .where('shared_space_asset.spaceId', '=', anyUuid(options.timelineSpaceIds!)),
          ),
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
              .where('shared_space_library.spaceId', '=', anyUuid(options.timelineSpaceIds!)),
          ),
        ]),
      ),
    )
    // Temporal
    .$if(!!options.takenAfter, (qb) => qb.where('asset.fileCreatedAt', '>=', options.takenAfter!))
    .$if(!!options.takenBefore, (qb) => qb.where('asset.fileCreatedAt', '<', options.takenBefore!))
    // Exif filters — join asset_exif only when at least one exif filter is active
    .$if(
      options.country !== undefined ||
        options.city !== undefined ||
        options.make !== undefined ||
        options.model !== undefined ||
        options.rating !== undefined,
      (qb) =>
        qb
          .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
          .$if(options.country !== undefined, (qb) => qb.where('asset_exif.country', '=', options.country!))
          .$if(options.city !== undefined, (qb) => qb.where('asset_exif.city', '=', options.city!))
          .$if(options.make !== undefined, (qb) => qb.where('asset_exif.make', '=', options.make!))
          .$if(options.model !== undefined, (qb) => qb.where('asset_exif.model', '=', options.model!))
          .$if(options.rating !== undefined, (qb) => qb.where('asset_exif.rating', '=', options.rating!)),
    )
    // Person filter via EXISTS (no join — avoids name collision with outer queries)
    .$if(!!options.personIds?.length, (qb) =>
      qb.where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.personId', '=', anyUuid(options.personIds!))
            .where('asset_face.deletedAt', 'is', null),
        ),
      ),
    )
    // Tag filter via EXISTS
    .$if(!!options.tagIds?.length, (qb) =>
      qb.where((eb) =>
        eb.exists(
          eb
            .selectFrom('tag_asset')
            .whereRef('tag_asset.assetId', '=', 'asset.id')
            .where('tag_asset.tagId', '=', anyUuid(options.tagIds!)),
        ),
      ),
    )
    // Asset-level filters
    .$if(options.mediaType !== undefined, (qb) => qb.where('asset.type', '=', options.mediaType!))
    .$if(options.isFavorite !== undefined, (qb) => qb.where('asset.isFavorite', '=', options.isFavorite!));
}
```

**Step 3: Verify compilation**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 4: Commit**

```
feat: add buildFilteredAssetIds shared helper for filter suggestions
```

---

### Task 4: Repository — Six Extraction Methods

All six methods use `buildFilteredAssetIds` via `asset.id IN (subquery)` to avoid join collisions. Each calls `without()` to exclude its own category.

**Files:**

- Modify: `server/src/repositories/search.repository.ts`

**Step 1: Add `getFilteredCountries` and `getFilteredCameraMakes`**

These extract DISTINCT exif field values from assets matching the filtered set (with their own category excluded):

```typescript
private async getFilteredCountries(userIds: string[], options: FilterSuggestionsOptions): Promise<string[]> {
  const filteredIds = this.buildFilteredAssetIds(userIds, options);
  const rows = await this.db
    .selectFrom('asset_exif')
    .select('country')
    .distinctOn('country')
    .where('country', 'is not', null)
    .where('country', '!=', '' as any)
    .where('assetId', 'in', filteredIds)
    .orderBy('country')
    .execute();
  return rows.map((r) => r.country!);
}

private async getFilteredCameraMakes(userIds: string[], options: FilterSuggestionsOptions): Promise<string[]> {
  const filteredIds = this.buildFilteredAssetIds(userIds, options);
  const rows = await this.db
    .selectFrom('asset_exif')
    .select('make')
    .distinctOn('make')
    .where('make', 'is not', null)
    .where('make', '!=', '' as any)
    .where('assetId', 'in', filteredIds)
    .orderBy('make')
    .execute();
  return rows.map((r) => r.make!);
}
```

**Step 2: Add `getFilteredTags`**

```typescript
private async getFilteredTags(
  userIds: string[],
  options: FilterSuggestionsOptions,
): Promise<Array<{ id: string; value: string }>> {
  const filteredIds = this.buildFilteredAssetIds(userIds, options);
  return this.db
    .selectFrom('tag')
    .select(['tag.id', 'tag.value'])
    .distinct()
    .innerJoin('tag_asset', 'tag.id', 'tag_asset.tagId')
    .where('tag_asset.assetId', 'in', filteredIds)
    .orderBy('tag.value')
    .execute();
}
```

**Step 3: Add `getFilteredPeople`**

No `asset_face` join in `buildFilteredAssetIds` — the person→face→asset chain is handled here in the outer query to avoid column name collisions:

```typescript
private async getFilteredPeople(
  userIds: string[],
  options: FilterSuggestionsOptions,
): Promise<{ people: Array<{ id: string; name: string }>; hasUnnamedPeople: boolean }> {
  const filteredIds = this.buildFilteredAssetIds(userIds, options);

  // Named, visible people with thumbnails who appear in filtered assets
  const namedPeopleQuery = this.db
    .selectFrom('person')
    .select(['person.id', 'person.name'])
    .distinct()
    .where('person.name', '!=', '')
    .where('person.isHidden', '=', false)
    .where('person.thumbnailPath', '!=', '')
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('asset_face')
          .whereRef('asset_face.personId', '=', 'person.id')
          .where('asset_face.deletedAt', 'is', null)
          .where('asset_face.assetId', 'in', filteredIds),
      ),
    )
    .orderBy('person.name')
    .execute();

  // Check if any unnamed/empty-name people have faces in filtered assets
  const unnamedQuery = this.db
    .selectFrom('person')
    .select(sql`1`.as('exists'))
    .where((eb) => eb.or([eb('person.name', '=', ''), eb('person.name', 'is', null)]))
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('asset_face')
          .whereRef('asset_face.personId', '=', 'person.id')
          .where('asset_face.deletedAt', 'is', null)
          .where('asset_face.assetId', 'in', filteredIds),
      ),
    )
    .limit(1)
    .execute();

  const [people, unnamed] = await Promise.all([namedPeopleQuery, unnamedQuery]);
  return { people, hasUnnamedPeople: unnamed.length > 0 };
}
```

**Step 4: Add `getFilteredRatings`**

```typescript
private async getFilteredRatings(userIds: string[], options: FilterSuggestionsOptions): Promise<number[]> {
  const filteredIds = this.buildFilteredAssetIds(userIds, options);
  const rows = await this.db
    .selectFrom('asset_exif')
    .select('rating')
    .distinctOn('rating')
    .where('rating', 'is not', null)
    .where('rating', '>', 0)
    .where('assetId', 'in', filteredIds)
    .orderBy('rating')
    .execute();
  return rows.map((r) => r.rating!);
}
```

**Step 5: Add `getFilteredMediaTypes`**

```typescript
private async getFilteredMediaTypes(userIds: string[], options: FilterSuggestionsOptions): Promise<string[]> {
  const filteredIds = this.buildFilteredAssetIds(userIds, options);
  const rows = await this.db
    .selectFrom('asset')
    .select('type')
    .distinct()
    .where('asset.id', 'in', filteredIds)
    .orderBy('type')
    .execute();
  return rows.map((r) => r.type);
}
```

**Step 6: Verify compilation**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 7: Commit**

```
feat: add six filter suggestion extraction queries using shared base
```

---

### Task 5: Repository — `getFilterSuggestions` Orchestrator

**Files:**

- Modify: `server/src/repositories/search.repository.ts`

**Step 1: Add the public `getFilterSuggestions` method with `@GenerateSql`**

Add to the `SearchRepository` class (public methods section, before the private helpers). Import `without` from `src/utils/filter-suggestions` at the top of the file.

```typescript
@GenerateSql({ params: [[DummyValue.UUID]] })
async getFilterSuggestions(
  userIds: string[],
  options: FilterSuggestionsOptions,
): Promise<FilterSuggestionsResult> {
  const [countries, cameraMakes, tags, peopleResult, ratings, mediaTypes] = await Promise.all([
    this.getFilteredCountries(userIds, without(options, 'country', 'city')),
    this.getFilteredCameraMakes(userIds, without(options, 'make', 'model')),
    this.getFilteredTags(userIds, without(options, 'tagIds')),
    this.getFilteredPeople(userIds, without(options, 'personIds')),
    this.getFilteredRatings(userIds, without(options, 'rating')),
    this.getFilteredMediaTypes(userIds, without(options, 'mediaType')),
  ]);

  return {
    countries,
    cameraMakes,
    tags,
    people: peopleResult.people,
    ratings,
    mediaTypes,
    hasUnnamedPeople: peopleResult.hasUnnamedPeople,
  };
}
```

**Step 2: Verify compilation**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```
feat: add getFilterSuggestions orchestrator with faceted exclusion
```

---

### Task 6: Service Method + Controller Endpoint

**Files:**

- Modify: `server/src/services/search.service.ts` (add `getFilterSuggestions` method after `getTagSuggestions`, ~line 221)
- Modify: `server/src/controllers/search.controller.ts` (add endpoint after `getTagSuggestions`, ~line 159)

**Step 1: Add service method**

In `server/src/services/search.service.ts`, add after `getTagSuggestions`. Update the imports at the top to include `FilterSuggestionsRequestDto` and `FilterSuggestionsResponseDto`.

```typescript
async getFilterSuggestions(auth: AuthDto, dto: FilterSuggestionsRequestDto): Promise<FilterSuggestionsResponseDto> {
  if (dto.spaceId && dto.withSharedSpaces) {
    throw new BadRequestException('Cannot use both spaceId and withSharedSpaces');
  }

  if (dto.spaceId) {
    await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
  }

  const userIds = await this.getUserIdsToSearch(auth);

  let timelineSpaceIds: string[] | undefined;
  if (dto.withSharedSpaces) {
    const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
    if (spaceRows.length > 0) {
      timelineSpaceIds = spaceRows.map((row) => row.spaceId);
    }
  }

  return this.searchRepository.getFilterSuggestions(userIds, { ...dto, timelineSpaceIds });
}
```

**Step 2: Add controller endpoint**

In `server/src/controllers/search.controller.ts`, add before the closing `}` of the class. Update imports to include `FilterSuggestionsRequestDto` and `FilterSuggestionsResponseDto`.

```typescript
@Get('suggestions/filters')
@Authenticated({ permission: Permission.AssetRead })
@Endpoint({
  summary: 'Retrieve dynamic filter suggestions',
  description:
    'Returns available filter values scoped by all other active filters. Each category excludes its own filter (faceted search). Used by FilterPanel for dynamic cross-filtering.',
  history: new HistoryBuilder().added('v1'),
})
getFilterSuggestions(
  @Auth() auth: AuthDto,
  @Query() dto: FilterSuggestionsRequestDto,
): Promise<FilterSuggestionsResponseDto> {
  return this.service.getFilterSuggestions(auth, dto);
}
```

**Step 3: Verify compilation**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 4: Commit**

```
feat: add GET /search/suggestions/filters endpoint
```

---

### Task 7: Server Unit Tests

**Files:**

- Modify: `server/src/services/search.service.spec.ts`

**Step 1: Write tests for `getFilterSuggestions`**

Add a new `describe('getFilterSuggestions', ...)` block:

```typescript
describe('getFilterSuggestions', () => {
  const emptyResult = {
    countries: [],
    cameraMakes: [],
    tags: [],
    people: [],
    ratings: [],
    mediaTypes: [],
    hasUnnamedPeople: false,
  };

  it('should return filter suggestions', async () => {
    const auth = AuthFactory.create();
    mocks.partner.getAll.mockResolvedValue([]);
    mocks.search.getFilterSuggestions.mockResolvedValue({
      countries: ['Germany', 'France'],
      cameraMakes: ['Canon'],
      tags: [{ id: 't1', value: 'Vacation' }],
      people: [{ id: 'p1', name: 'Alice' }],
      ratings: [4, 5],
      mediaTypes: ['IMAGE', 'VIDEO'],
      hasUnnamedPeople: false,
    });

    const result = await sut.getFilterSuggestions(auth, { withSharedSpaces: true });

    expect(result.countries).toEqual(['Germany', 'France']);
    expect(result.people).toEqual([{ id: 'p1', name: 'Alice' }]);
    expect(result.hasUnnamedPeople).toBe(false);
    expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
      [auth.user.id],
      expect.objectContaining({ withSharedSpaces: true }),
    );
  });

  it('should return empty suggestions when no filters match', async () => {
    const auth = AuthFactory.create();
    mocks.partner.getAll.mockResolvedValue([]);
    mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);

    const result = await sut.getFilterSuggestions(auth, {});

    expect(result).toEqual(emptyResult);
  });

  it('should return hasUnnamedPeople true when unnamed people exist', async () => {
    const auth = AuthFactory.create();
    mocks.partner.getAll.mockResolvedValue([]);
    mocks.search.getFilterSuggestions.mockResolvedValue({
      ...emptyResult,
      hasUnnamedPeople: true,
    });

    const result = await sut.getFilterSuggestions(auth, {});

    expect(result.people).toEqual([]);
    expect(result.hasUnnamedPeople).toBe(true);
  });

  it('should throw when both spaceId and withSharedSpaces are set', async () => {
    const auth = AuthFactory.create();
    mocks.partner.getAll.mockResolvedValue([]);

    await expect(sut.getFilterSuggestions(auth, { spaceId: newUuid(), withSharedSpaces: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('should check space access when spaceId is set', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    mocks.partner.getAll.mockResolvedValue([]);
    mocks.access.checkAccess.mockResolvedValue(new Set([spaceId]));
    mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);

    await sut.getFilterSuggestions(auth, { spaceId });

    expect(mocks.access.checkAccess).toHaveBeenCalled();
  });

  it('should resolve timelineSpaceIds when withSharedSpaces is set', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    mocks.partner.getAll.mockResolvedValue([]);
    mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
    mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);

    await sut.getFilterSuggestions(auth, { withSharedSpaces: true });

    expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
      [auth.user.id],
      expect.objectContaining({ timelineSpaceIds: [spaceId] }),
    );
  });

  it('should pass filter params through to repository', async () => {
    const auth = AuthFactory.create();
    mocks.partner.getAll.mockResolvedValue([]);
    mocks.search.getFilterSuggestions.mockResolvedValue(emptyResult);

    await sut.getFilterSuggestions(auth, {
      country: 'Germany',
      personIds: ['p1'],
      rating: 5,
      mediaType: AssetType.IMAGE,
    });

    expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
      [auth.user.id],
      expect.objectContaining({
        country: 'Germany',
        personIds: ['p1'],
        rating: 5,
        mediaType: AssetType.IMAGE,
      }),
    );
  });
});
```

**Step 2: Run tests**

Run: `cd server && pnpm test -- --run src/services/search.service.spec.ts`
Expected: All tests pass

**Step 3: Commit**

```
test: add unit tests for getFilterSuggestions service method
```

---

### Task 8: Regenerate OpenAPI + SDK

**Step 1: Build server and regenerate**

Run:

```bash
cd server && pnpm build
pnpm sync:open-api
cd .. && make open-api-typescript
```

**Step 2: Verify the generated SDK has `getFilterSuggestions`**

Run: `grep -n 'getFilterSuggestions\|filterSuggestions' open-api/typescript-sdk/src/fetch-client.ts | head -10`
Expected: New function appears

**Step 3: Commit**

```
chore: regenerate OpenAPI spec and TypeScript SDK
```

---

### Task 9: Web Types — `FilterSuggestionsResponse` + Config Extension

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.ts`

**Step 1: Add `FilterSuggestionsResponse` type and extend `FilterPanelConfig`**

After the existing `TagOption` interface (line 22), add:

```typescript
export interface FilterSuggestionsResponse {
  countries: string[];
  cameraMakes: string[];
  tags: TagOption[];
  people: PersonOption[];
  ratings: number[];
  mediaTypes: string[];
  hasUnnamedPeople: boolean;
}
```

Then modify `FilterPanelConfig` to add `suggestionsProvider` (keep `providers` as-is for backward compat):

```typescript
export interface FilterPanelConfig {
  sections: FilterSection[];
  suggestionsProvider?: (filters: FilterState) => Promise<FilterSuggestionsResponse>;
  providers?: {
    people?: (context?: FilterContext) => Promise<PersonOption[]>;
    allPeople?: () => Promise<PersonOption[]>;
    locations?: (context?: FilterContext) => Promise<LocationOption[]>;
    cities?: (country: string, context?: FilterContext) => Promise<string[]>;
    cameras?: (context?: FilterContext) => Promise<CameraOption[]>;
    cameraModels?: (make: string, context?: FilterContext) => Promise<string[]>;
    tags?: (context?: FilterContext) => Promise<TagOption[]>;
  };
}
```

Note: `providers` changes from required to optional (`providers?`) since `suggestionsProvider` replaces it for the photos page.

**Step 2: Verify type check**

Run: `cd web && npx svelte-check --threshold error 2>&1 | tail -20`
Expected: Errors from FilterPanel.svelte because it references `config.providers` without optional chaining — we'll fix that in Task 11.

**Step 3: Commit**

```
feat(web): add FilterSuggestionsResponse type and suggestionsProvider config
```

---

### Task 10: RatingFilter + MediaTypeFilter — Dynamic Availability Props

**Files:**

- Modify: `web/src/lib/components/filter-panel/rating-filter.svelte`
- Modify: `web/src/lib/components/filter-panel/media-type-filter.svelte`

**Step 1: Update RatingFilter**

In `rating-filter.svelte`, add `availableRatings` prop. Selected ratings not in the available list are shown as orphaned (dimmed):

```svelte
<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiStar } from '@mdi/js';

  interface Props {
    selectedRating?: number;
    availableRatings?: number[];
    onRatingChange: (rating?: number) => void;
  }

  let { selectedRating, availableRatings, onRatingChange }: Props = $props();

  function handleStarClick(star: number) {
    if (selectedRating === star) {
      onRatingChange(undefined);
    } else {
      onRatingChange(star);
    }
  }

  let visibleStars = $derived(
    availableRatings
      ? [1, 2, 3, 4, 5].filter((s) => availableRatings.includes(s) || s === selectedRating)
      : [1, 2, 3, 4, 5],
  );
</script>

<div class="flex gap-1" data-testid="rating-filter">
  {#each visibleStars as star (star)}
    {@const filled = selectedRating !== undefined && star <= selectedRating}
    {@const isOrphaned = availableRatings !== undefined && !availableRatings.includes(star)}
    <button
      type="button"
      class="flex items-center justify-center p-0.5 {isOrphaned ? 'opacity-50' : ''}"
      onclick={() => handleStarClick(star)}
      data-testid="rating-star-{star}"
    >
      <Icon icon={mdiStar} size="20" class={filled ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'} />
    </button>
  {/each}
</div>
```

**Step 2: Update MediaTypeFilter**

In `media-type-filter.svelte`, add `availableMediaTypes` prop. Selected types not in the available list are shown as orphaned (dimmed) — consistent with RatingFilter's orphaned styling:

```svelte
<script lang="ts">
  interface Props {
    selected: 'all' | 'image' | 'video';
    availableMediaTypes?: string[];
    onTypeChange: (type: 'all' | 'image' | 'video') => void;
  }

  let { selected, availableMediaTypes, onTypeChange }: Props = $props();

  const allOptions: Array<{ value: 'all' | 'image' | 'video'; label: string; assetType?: string }> = [
    { value: 'all', label: 'All' },
    { value: 'image', label: 'Photos', assetType: 'IMAGE' },
    { value: 'video', label: 'Videos', assetType: 'VIDEO' },
  ];

  let options = $derived(
    availableMediaTypes
      ? allOptions.filter(
          (o) => o.value === 'all' || o.value === selected || availableMediaTypes.includes(o.assetType!),
        )
      : allOptions,
  );
</script>

<div class="flex gap-1.5" data-testid="media-type-filter">
  {#each options as option (option.value)}
    {@const isActive = selected === option.value}
    {@const isOrphaned =
      availableMediaTypes !== undefined && option.assetType !== undefined && !availableMediaTypes.includes(option.assetType)}
    <button
      type="button"
      class="rounded-lg border px-2.5 py-1 text-xs {isOrphaned ? 'opacity-50' : ''}
        {isActive
        ? 'border-immich-primary bg-immich-primary/10 text-immich-primary dark:border-immich-dark-primary dark:bg-immich-dark-primary/20 dark:text-immich-dark-primary'
        : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'}"
      onclick={() => onTypeChange(option.value)}
      data-testid="media-type-{option.value}"
    >
      {option.label}
    </button>
  {/each}
</div>
```

**Step 3: Commit**

```
feat(web): add dynamic availability props to RatingFilter and MediaTypeFilter
```

---

### Task 11: FilterPanel — Unified `suggestionsProvider` Effect

This is the core web change. The FilterPanel gets a new `$effect` that, when `suggestionsProvider` is set, replaces the 4 mount effects and the temporal re-fetch effect.

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.svelte`

**Step 1: Add new state variables**

At the top of the `<script>` block, alongside existing state (line ~57):

```typescript
let availableRatings = $state<number[] | undefined>();
let availableMediaTypes = $state<string[] | undefined>();
```

The `hasUnnamedPeople` state already exists at line 58.

**Step 2: Add the unified `$effect` block**

Add after the existing `filterContext` effect (line 74), BEFORE the temporal re-fetch effect (line 84). Use explicit field comparison (not JSON.stringify) to avoid serialization pitfalls with undefined and Date values:

```typescript
// Unified suggestions re-fetch: replaces mount effects + temporal re-fetch when suggestionsProvider is set
let prevFilters: FilterState | undefined = $state();
let unifiedAbortController: AbortController | undefined = $state();

$effect(() => {
  if (!config.suggestionsProvider) {
    return;
  }

  // Track all filter fields — reading them registers as dependencies
  const current: FilterState = {
    personIds: filters.personIds,
    city: filters.city,
    country: filters.country,
    make: filters.make,
    model: filters.model,
    tagIds: filters.tagIds,
    rating: filters.rating,
    mediaType: filters.mediaType,
    isFavorite: filters.isFavorite,
    sortOrder: filters.sortOrder,
    selectedYear: filters.selectedYear,
    selectedMonth: filters.selectedMonth,
  };

  const prev = untrack(() => prevFilters);

  // Determine what changed for debounce timing
  const isInitialMount = prev === undefined;
  const temporalChanged =
    !isInitialMount && (prev.selectedYear !== current.selectedYear || prev.selectedMonth !== current.selectedMonth);
  const isTemporalClear = temporalChanged && current.selectedYear === undefined;

  // Debounce: 0ms initial mount + clear, 200ms temporal, 50ms discrete
  const delay = isInitialMount || isTemporalClear ? 0 : temporalChanged ? 200 : 50;

  const provider = config.suggestionsProvider;
  const currentFilters = { ...current };

  const timeout = setTimeout(() => {
    unifiedAbortController?.abort();
    const controller = new AbortController();
    unifiedAbortController = controller;
    isRefetching = true;

    void provider(currentFilters)
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }
        people = result.people;
        countries = result.countries;
        cameraMakes = result.cameraMakes;
        tags = result.tags;
        availableRatings = result.ratings;
        availableRatings = result.ratings;
        availableMediaTypes = result.mediaTypes;
        hasUnnamedPeople = result.hasUnnamedPeople;

        // Note: child values (cities, camera models) are NOT re-fetched here.
        // LocationFilter and CameraFilter manage their own child state internally
        // and re-fetch when their parent selection or filterContext changes.
        // Cross-filter scoping for children is out of scope for this PR.
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error('Failed to fetch filter suggestions:', error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          isRefetching = false;
        }
      });
  }, delay);

  prevFilters = current;

  return () => {
    clearTimeout(timeout);
  };
});
```

**Step 3: Guard existing effects with `!config.suggestionsProvider`**

Wrap the temporal re-fetch effect (lines 84-201) body with:

```typescript
if (!config.suggestionsProvider) { ... existing effect body ... }
```

Wrap each of the 4 mount effects (lines 278-313) body with the same guard:

```typescript
if (!config.suggestionsProvider) { ... existing effect body ... }
```

**Step 4: Handle `providers` being optional**

Since `providers` is now optional on `FilterPanelConfig`, add a normalized variable at the top of the `<script>` block (after the `$props()` destructuring):

```typescript
// Normalize providers to avoid optional chaining everywhere
const providers = config.providers ?? {};
```

Then replace ALL references to `config.providers` with just `providers` throughout the file. This affects ~16 locations:

- Line 117: `const providers = config.providers` → remove (already declared above)
- Lines 129, 143, 158, 173: `providers.people`, `providers.locations`, `providers.cameras`, `providers.tags` (already use local `providers` variable inside temporal effect — but the initialization `const providers = config.providers` at line 117 is inside the effect, not at module level. Replace that with the module-level const.)
- Lines 279-309: `config.providers.people`, `config.providers.allPeople`, `config.providers.locations`, `config.providers.cameras`, `config.providers.tags` → `providers.people`, `providers.allPeople`, etc.
- Lines 500-501: `config.providers.cities` → `providers.cities`
- Lines 514-515: `config.providers.cameraModels` → `providers.cameraModels`

**Step 5: Pass new props to RatingFilter and MediaTypeFilter**

In the template, update the rating and media sections:

```svelte
{:else if section === 'rating'}
  <RatingFilter selectedRating={filters.rating} {availableRatings} onRatingChange={handleRatingChange} />
{:else if section === 'media'}
  <MediaTypeFilter selected={filters.mediaType} {availableMediaTypes} onTypeChange={handleMediaTypeChange} />
```

**Step 6: Verify type check**

Run: `cd web && npx svelte-check --threshold error 2>&1 | tail -20`
Expected: No errors

**Step 7: Commit**

```
feat(web): add unified suggestionsProvider effect with debounce
```

---

### Task 12: Photos Page — Wire Up `suggestionsProvider`

**Files:**

- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`

**Step 1: Replace the filterConfig**

Replace the existing `filterConfig` (lines 68-135) with the new version. Import `getFilterSuggestions` from the generated SDK (check the exact function name in `open-api/typescript-sdk/src/fetch-client.ts` after Task 8).

```typescript
const filterConfig: FilterPanelConfig = {
  sections: ['timeline', 'people', 'location', 'camera', 'tags', 'rating', 'media'],
  suggestionsProvider: async (filters: FilterState) => {
    const context = buildFilterContext(filters);
    const response = await getFilterSuggestions({
      personIds: filters.personIds.length > 0 ? filters.personIds : undefined,
      country: filters.country,
      city: filters.city,
      make: filters.make,
      model: filters.model,
      tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
      rating: filters.rating,
      mediaType:
        filters.mediaType === 'all'
          ? undefined
          : filters.mediaType === 'image'
            ? AssetTypeEnum.Image
            : AssetTypeEnum.Video,
      isFavorite: filters.isFavorite,
      takenAfter: context?.takenAfter,
      takenBefore: context?.takenBefore,
      withSharedSpaces: true,
    });
    // Map server response to FilterSuggestionsResponse
    const mappedPeople = response.people.map((p) => ({
      id: p.id,
      name: p.name,
      thumbnailUrl: `/people/${p.id}/thumbnail`,
    }));
    // Populate name maps for ActiveFiltersBar
    for (const p of response.people) {
      personNames.set(p.id, p.name);
    }
    for (const t of response.tags) {
      tagNames.set(t.id, t.value);
    }
    return {
      countries: response.countries,
      cameraMakes: response.cameraMakes,
      tags: response.tags.map((t) => ({ id: t.id, name: t.value })),
      people: mappedPeople,
      ratings: response.ratings,
      mediaTypes: response.mediaTypes,
      hasUnnamedPeople: response.hasUnnamedPeople,
    };
  },
  providers: {
    // Hierarchical children still fetched on-demand via LocationFilter/CameraFilter
    cities: async (country, context) =>
      getSearchSuggestions({
        $type: SearchSuggestionType.City,
        country,
        withSharedSpaces: true,
        ...context,
      }),
    cameraModels: async (make, context) =>
      getSearchSuggestions({
        $type: SearchSuggestionType.CameraModel,
        make,
        withSharedSpaces: true,
        ...context,
      }),
  },
};
```

**Step 2: Verify type check**

Run: `cd web && npx svelte-check --threshold error 2>&1 | tail -20`
Expected: No errors

**Step 3: Commit**

```
feat(web): wire up dynamic filter suggestions on photos page
```

---

### Task 13: Web Component Tests — Unified Provider

**Files:**

- Create: `web/src/lib/components/filter-panel/__tests__/unified-suggestions.spec.ts`

**Step 1: Write comprehensive tests**

Follow the patterns in `contextual-refetch.spec.ts` for test structure. Create a mock config with `suggestionsProvider`, render FilterPanel, interact via `fireEvent`, advance timers, assert with `waitFor`.

```typescript
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { FilterPanelConfig, FilterSuggestionsResponse } from '../filter-panel';
import FilterPanel from '../filter-panel.svelte';

const defaultResponse: FilterSuggestionsResponse = {
  countries: ['Germany', 'France'],
  cameraMakes: ['Canon', 'Sony'],
  tags: [
    { id: 't1', name: 'Vacation' },
    { id: 't2', name: 'Family' },
  ],
  people: [
    { id: 'p1', name: 'Alice', thumbnailUrl: '/people/p1/thumbnail' },
    { id: 'p2', name: 'Bob', thumbnailUrl: '/people/p2/thumbnail' },
  ],
  ratings: [3, 4, 5],
  mediaTypes: ['IMAGE', 'VIDEO'],
  hasUnnamedPeople: false,
};

const emptyResponse: FilterSuggestionsResponse = {
  countries: [],
  cameraMakes: [],
  tags: [],
  people: [],
  ratings: [],
  mediaTypes: [],
  hasUnnamedPeople: false,
};

const timeBuckets = [
  { timeBucket: '2023-06-01', count: 100 },
  { timeBucket: '2024-03-01', count: 50 },
];

function createUnifiedConfig(overrides: Partial<FilterPanelConfig> = {}): FilterPanelConfig {
  return {
    sections: ['timeline', 'people', 'location', 'camera', 'tags', 'rating', 'media'],
    suggestionsProvider: vi.fn().mockResolvedValue(defaultResponse),
    ...overrides,
  };
}

describe('Unified suggestionsProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem('gallery-filter-visible-sections');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should fire suggestionsProvider on initial mount with default state', async () => {
    const config = createUnifiedConfig();
    render(FilterPanel, { props: { config, timeBuckets } });

    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => {
      expect(config.suggestionsProvider).toHaveBeenCalledTimes(1);
      expect(config.suggestionsProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          personIds: [],
          tagIds: [],
          mediaType: 'all',
          sortOrder: 'desc',
        }),
      );
    });
  });

  it('should update suggestions in DOM after response', async () => {
    const config = createUnifiedConfig();
    render(FilterPanel, { props: { config, timeBuckets } });

    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeTruthy();
      expect(screen.getByText('Germany')).toBeTruthy();
    });
  });

  it('should debounce discrete filter changes at 50ms', async () => {
    const config = createUnifiedConfig();
    render(FilterPanel, { props: { config, timeBuckets } });

    await vi.advanceTimersByTimeAsync(0); // initial mount
    expect(config.suggestionsProvider).toHaveBeenCalledTimes(1);

    // Click a person checkbox to trigger a filter change
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    await fireEvent.click(screen.getByText('Alice'));

    // Should NOT have fired yet (50ms debounce)
    expect(config.suggestionsProvider).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(50);

    await waitFor(() => {
      expect(config.suggestionsProvider).toHaveBeenCalledTimes(2);
    });
  });

  it('should debounce temporal changes at 200ms', async () => {
    const config = createUnifiedConfig();
    render(FilterPanel, { props: { config, timeBuckets } });

    await vi.advanceTimersByTimeAsync(0); // initial mount

    // Click a year
    await fireEvent.click(screen.getByTestId('year-btn-2023'));

    // Should not have fired at 50ms
    await vi.advanceTimersByTimeAsync(50);
    expect(config.suggestionsProvider).toHaveBeenCalledTimes(1);

    // Should fire after 200ms
    await vi.advanceTimersByTimeAsync(150);

    await waitFor(() => {
      expect(config.suggestionsProvider).toHaveBeenCalledTimes(2);
    });
  });

  it('should cancel stale requests via AbortController on rapid changes', async () => {
    let resolveFirst: (v: FilterSuggestionsResponse) => void;
    const firstCall = new Promise<FilterSuggestionsResponse>((r) => {
      resolveFirst = r;
    });

    const provider = vi
      .fn()
      .mockReturnValueOnce(Promise.resolve(defaultResponse)) // initial mount
      .mockReturnValueOnce(firstCall) // first discrete change (will be superseded)
      .mockResolvedValueOnce({
        ...defaultResponse,
        countries: ['Japan'],
      }); // second discrete change

    const config = createUnifiedConfig({ suggestionsProvider: provider });
    render(FilterPanel, { props: { config, timeBuckets } });

    await vi.advanceTimersByTimeAsync(0); // initial mount

    // First change
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    await fireEvent.click(screen.getByText('Alice'));
    await vi.advanceTimersByTimeAsync(50);

    // Second change before first resolves — should abort first
    await fireEvent.click(screen.getByText('Alice')); // toggle off
    await vi.advanceTimersByTimeAsync(50);

    // Resolve the first (aborted) call
    resolveFirst!(defaultResponse);
    await vi.advanceTimersByTimeAsync(0);

    // Should show results from the third call, not the aborted first
    await waitFor(() => {
      expect(screen.getByText('Japan')).toBeTruthy();
    });
  });

  it('should set isRefetching during unified fetch', async () => {
    let resolveProvider: (v: FilterSuggestionsResponse) => void;
    const pendingPromise = new Promise<FilterSuggestionsResponse>((r) => {
      resolveProvider = r;
    });

    const config = createUnifiedConfig({
      suggestionsProvider: vi.fn().mockReturnValue(pendingPromise),
    });
    render(FilterPanel, { props: { config, timeBuckets } });

    await vi.advanceTimersByTimeAsync(0);

    // While request is in-flight, sections should show refetching state
    const section = screen.getByTestId('filter-section-people');
    expect(section.className).toContain('refetching');

    resolveProvider!(defaultResponse);
    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => {
      expect(section.className).not.toContain('refetching');
    });
  });

  it('should show hasUnnamedPeople empty text when people list is empty', async () => {
    const config = createUnifiedConfig({
      suggestionsProvider: vi.fn().mockResolvedValue({
        ...emptyResponse,
        hasUnnamedPeople: true,
      }),
    });
    render(FilterPanel, { props: { config, timeBuckets } });

    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => {
      expect(screen.getByText('Name people to use this filter')).toBeTruthy();
    });
  });

  it('should hide unavailable ratings', async () => {
    const config = createUnifiedConfig({
      suggestionsProvider: vi.fn().mockResolvedValue({
        ...defaultResponse,
        ratings: [4, 5], // only 4 and 5 available
      }),
    });
    render(FilterPanel, { props: { config, timeBuckets } });

    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => {
      expect(screen.getByTestId('rating-star-4')).toBeTruthy();
      expect(screen.getByTestId('rating-star-5')).toBeTruthy();
      expect(screen.queryByTestId('rating-star-1')).toBeNull();
      expect(screen.queryByTestId('rating-star-2')).toBeNull();
      expect(screen.queryByTestId('rating-star-3')).toBeNull();
    });
  });

  it('should show all ratings when availableRatings is undefined (backward compat)', async () => {
    // providers-only config — no suggestionsProvider
    const config: FilterPanelConfig = {
      sections: ['rating'],
      providers: {},
    };
    render(FilterPanel, { props: { config, timeBuckets } });

    await vi.advanceTimersByTimeAsync(0);

    for (const star of [1, 2, 3, 4, 5]) {
      expect(screen.getByTestId(`rating-star-${star}`)).toBeTruthy();
    }
  });

  it('should hide unavailable media types', async () => {
    const config = createUnifiedConfig({
      suggestionsProvider: vi.fn().mockResolvedValue({
        ...defaultResponse,
        mediaTypes: ['IMAGE'], // only photos
      }),
    });
    render(FilterPanel, { props: { config, timeBuckets } });

    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => {
      expect(screen.getByTestId('media-type-all')).toBeTruthy();
      expect(screen.getByTestId('media-type-image')).toBeTruthy();
      expect(screen.queryByTestId('media-type-video')).toBeNull();
    });
  });

  it('should show orphaned media type button dimmed when selected but unavailable', async () => {
    // First response has both, second has only IMAGE
    const config = createUnifiedConfig({
      suggestionsProvider: vi
        .fn()
        .mockResolvedValueOnce(defaultResponse) // has both IMAGE + VIDEO
        .mockResolvedValueOnce({
          ...defaultResponse,
          mediaTypes: ['IMAGE'], // only IMAGE after filter change
        }),
    });
    render(FilterPanel, { props: { config, timeBuckets } });

    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => expect(screen.getByTestId('media-type-video')).toBeTruthy());

    // Select Videos
    await fireEvent.click(screen.getByTestId('media-type-video'));

    // Trigger a re-fetch that removes VIDEO from available
    await fireEvent.click(screen.getByText('Alice'));
    await vi.advanceTimersByTimeAsync(50);

    await waitFor(() => {
      // Video button should still be visible (selected) but dimmed
      const videoBtn = screen.getByTestId('media-type-video');
      expect(videoBtn).toBeTruthy();
      expect(videoBtn.className).toContain('opacity-50');
    });
  });

  it('should fall back to providers-based behavior when suggestionsProvider is not set', async () => {
    const peopleProvider = vi.fn().mockResolvedValue([{ id: 'p1', name: 'Alice' }]);
    const config: FilterPanelConfig = {
      sections: ['people'],
      providers: {
        people: peopleProvider,
      },
    };
    render(FilterPanel, { props: { config, timeBuckets } });

    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => {
      expect(peopleProvider).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Alice')).toBeTruthy();
    });
  });

  it('should work with suggestionsProvider and no providers', async () => {
    const config: FilterPanelConfig = {
      sections: ['people', 'location'],
      suggestionsProvider: vi.fn().mockResolvedValue(defaultResponse),
      // No providers — should work without error
    };
    render(FilterPanel, { props: { config, timeBuckets } });

    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => {
      expect(screen.getByText('Germany')).toBeTruthy();
    });
  });
});
```

**Step 2: Run tests**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/unified-suggestions.spec.ts`
Expected: All tests pass

**Step 3: Commit**

```
test(web): add component tests for unified suggestionsProvider
```

---

### Task 14: Regenerate SQL Query Files

**Step 1: Regenerate**

Since `@GenerateSql` was added to `getFilterSuggestions` in Task 5, the SQL query documentation needs regenerating.

Run: `make sql` (requires running DB via `make dev`)

If no local DB is available, apply the CI diff manually — CI will show the expected SQL file content.

**Step 2: Commit**

```
chore: regenerate SQL query documentation
```

---

### Task 15: Final Verification

**Step 1: Run all server tests**

Run: `cd server && pnpm test`
Expected: All pass

**Step 2: Run all web tests**

Run: `cd web && pnpm test`
Expected: All pass

**Step 3: Run type checks**

Run: `cd server && npx tsc --noEmit && cd ../web && npx svelte-check --threshold error`
Expected: No errors

**Step 4: Commit any remaining fixes, then create PR**

Use `/commit` and then create a PR targeting `main`.
