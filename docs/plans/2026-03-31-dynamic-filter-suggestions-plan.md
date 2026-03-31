# Dynamic Filter Suggestions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a filter is applied, all other filter panels dynamically update to show only values present in the current filtered result set.

**Architecture:** New unified `GET /search/filter-suggestions` endpoint returns all suggestion categories in one round trip. Uses faceted search (exclude-own-filter) so each category shows values matching all _other_ active filters. FilterPanel gets a new `suggestionsProvider` that replaces individual providers when present.

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

### Task 3: Repository — `FilterSuggestionsOptions` Interface + `getSuggestionValues`

**Files:**

- Modify: `server/src/repositories/search.repository.ts`

**Step 1: Add the options interface and `getSuggestionValues` helper**

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

Then add the `getSuggestionValues` private method after the existing `getExifField` method (line ~636). This is a new helper that extends `getExifField` with cross-domain filter joins:

```typescript
private getSuggestionValues<K extends 'city' | 'state' | 'country' | 'make' | 'model' | 'lensModel'>(
  field: K,
  userIds: string[],
  options: FilterSuggestionsOptions,
) {
  return this.getExifField(field, userIds, options)
    // Cross-domain exif filters
    .$if(options.country !== undefined, (qb) => qb.where('country', '=', options.country!))
    .$if(options.city !== undefined, (qb) => qb.where('city', '=', options.city!))
    .$if(options.make !== undefined, (qb) => qb.where('make', '=', options.make!))
    .$if(options.model !== undefined, (qb) => qb.where('model', '=', options.model!))
    .$if(options.rating !== undefined, (qb) => qb.where('rating', '=', options.rating!))
    // Cross-domain asset filters
    .$if(options.mediaType !== undefined, (qb) => qb.where('asset.type', '=', options.mediaType!))
    .$if(options.isFavorite !== undefined, (qb) => qb.where('asset.isFavorite', '=', options.isFavorite!))
    // Cross-domain join filters
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
    .$if(!!options.tagIds?.length, (qb) =>
      qb.where((eb) =>
        eb.exists(
          eb
            .selectFrom('tag_asset')
            .whereRef('tag_asset.assetId', '=', 'asset.id')
            .where('tag_asset.tagId', '=', anyUuid(options.tagIds!)),
        ),
      ),
    );
}
```

**Step 2: Verify compilation**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```
feat: add getSuggestionValues helper with cross-domain filter joins
```

---

### Task 4: Repository — `getFilteredPeople`, `getFilteredTags`, `getFilteredRatings`, `getFilteredMediaTypes`

**Files:**

- Modify: `server/src/repositories/search.repository.ts`

**Step 1: Add the four extraction helpers**

Add these methods to the `SearchRepository` class, after `getSuggestionValues`:

```typescript
private getFilteredPeople(
  userIds: string[],
  options: FilterSuggestionsOptions,
): Promise<{ people: Array<{ id: string; name: string }>; hasUnnamedPeople: boolean }> {
  // Build a base filtered-assets subquery
  const baseAssets = this.db
    .selectFrom('asset')
    .select('asset.id')
    .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
    .where('asset.visibility', '=', AssetVisibility.Timeline)
    .where('asset.deletedAt', 'is', null)
    .where('asset_face.deletedAt', 'is', null)
    .where('asset_face.personId', 'is not', null)
    // User/space scoping
    .$if(!options.spaceId && !options.timelineSpaceIds, (qb) => qb.where('asset.ownerId', '=', anyUuid(userIds)))
    .$if(!!options.spaceId && !options.timelineSpaceIds, (qb) =>
      qb.where((eb) =>
        eb.or([
          eb.exists(eb.selectFrom('shared_space_asset').whereRef('shared_space_asset.assetId', '=', 'asset.id').where('shared_space_asset.spaceId', '=', asUuid(options.spaceId!))),
          eb.exists(eb.selectFrom('shared_space_library').whereRef('shared_space_library.libraryId', '=', 'asset.libraryId').where('shared_space_library.spaceId', '=', asUuid(options.spaceId!))),
        ]),
      ),
    )
    .$if(!!options.timelineSpaceIds, (qb) =>
      qb.where((eb) =>
        eb.or([
          eb('asset.ownerId', '=', anyUuid(userIds)),
          eb.exists(eb.selectFrom('shared_space_asset').whereRef('shared_space_asset.assetId', '=', 'asset.id').where('shared_space_asset.spaceId', '=', anyUuid(options.timelineSpaceIds!))),
          eb.exists(eb.selectFrom('shared_space_library').whereRef('shared_space_library.libraryId', '=', 'asset.libraryId').where('shared_space_library.spaceId', '=', anyUuid(options.timelineSpaceIds!))),
        ]),
      ),
    )
    // Temporal
    .$if(!!options.takenAfter, (qb) => qb.where('asset.fileCreatedAt', '>=', options.takenAfter!))
    .$if(!!options.takenBefore, (qb) => qb.where('asset.fileCreatedAt', '<', options.takenBefore!))
    // Cross-domain filters (exif)
    .$if(options.country !== undefined || options.city !== undefined || options.make !== undefined || options.model !== undefined || options.rating !== undefined, (qb) =>
      qb
        .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
        .$if(options.country !== undefined, (qb) => qb.where('asset_exif.country', '=', options.country!))
        .$if(options.city !== undefined, (qb) => qb.where('asset_exif.city', '=', options.city!))
        .$if(options.make !== undefined, (qb) => qb.where('asset_exif.make', '=', options.make!))
        .$if(options.model !== undefined, (qb) => qb.where('asset_exif.model', '=', options.model!))
        .$if(options.rating !== undefined, (qb) => qb.where('asset_exif.rating', '=', options.rating!)),
    )
    // Cross-domain: tags
    .$if(!!options.tagIds?.length, (qb) =>
      qb.where((eb) =>
        eb.exists(eb.selectFrom('tag_asset').whereRef('tag_asset.assetId', '=', 'asset.id').where('tag_asset.tagId', '=', anyUuid(options.tagIds!))),
      ),
    )
    // Cross-domain: media type and favorites
    .$if(options.mediaType !== undefined, (qb) => qb.where('asset.type', '=', options.mediaType!))
    .$if(options.isFavorite !== undefined, (qb) => qb.where('asset.isFavorite', '=', options.isFavorite!));

  // Named people in filtered assets
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
          .where((eb2) => eb2.exists(baseAssets.whereRef('asset.id', '=', 'asset_face.assetId'))),
      ),
    )
    .orderBy('person.name')
    .execute();

  // Check if unnamed people exist
  const unnamedQuery = this.db
    .selectFrom('person')
    .select(sql`1`.as('exists'))
    .where((eb) =>
      eb.or([eb('person.name', '=', ''), eb('person.name', 'is', null)]),
    )
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('asset_face')
          .whereRef('asset_face.personId', '=', 'person.id')
          .where('asset_face.deletedAt', 'is', null)
          .where((eb2) => eb2.exists(baseAssets.whereRef('asset.id', '=', 'asset_face.assetId'))),
      ),
    )
    .limit(1)
    .execute();

  return Promise.all([namedPeopleQuery, unnamedQuery]).then(([people, unnamed]) => ({
    people,
    hasUnnamedPeople: unnamed.length > 0,
  }));
}
```

For `getFilteredTags`, `getFilteredRatings`, `getFilteredMediaTypes` — follow the same pattern but adapted for each domain. The key approach:

- `getFilteredTags`: query `tag` via `tag_asset` -> `asset`, apply all non-tag filters using the same space/temporal/exif/person/mediaType/favorite filter chain
- `getFilteredRatings`: `SELECT DISTINCT asset_exif.rating FROM asset_exif JOIN asset ...` with all non-rating filters, return `number[]`
- `getFilteredMediaTypes`: `SELECT DISTINCT asset.type FROM asset ...` with all non-mediaType filters, return `string[]`

Each follows the same base pattern: asset scoping (user/space/temporal) + cross-domain filters.

**Step 2: Verify compilation**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```
feat: add filtered people/tags/ratings/mediaTypes extraction queries
```

---

### Task 5: Repository — `getFilterSuggestions` Orchestrator

**Files:**

- Modify: `server/src/repositories/search.repository.ts`

**Step 1: Add the public `getFilterSuggestions` method**

Add to the `SearchRepository` class (public methods section, before the private helpers):

```typescript
async getFilterSuggestions(
  userIds: string[],
  options: FilterSuggestionsOptions,
): Promise<FilterSuggestionsResult> {
  const [countries, cameraMakes, tagsResult, peopleResult, ratingsResult, mediaTypesResult] = await Promise.all([
    this.getSuggestionValues('country', userIds, without(options, 'country', 'city')).execute().then((rows) => rows.map((r) => r.country!)),
    this.getSuggestionValues('make', userIds, without(options, 'make', 'model')).execute().then((rows) => rows.map((r) => r.make!)),
    this.getFilteredTags(userIds, without(options, 'tagIds')),
    this.getFilteredPeople(userIds, without(options, 'personIds')),
    this.getFilteredRatings(userIds, without(options, 'rating')),
    this.getFilteredMediaTypes(userIds, without(options, 'mediaType')),
  ]);

  return {
    countries,
    cameraMakes,
    tags: tagsResult,
    people: peopleResult.people,
    ratings: ratingsResult,
    mediaTypes: mediaTypesResult,
    hasUnnamedPeople: peopleResult.hasUnnamedPeople,
  };
}
```

Import `without` from `src/utils/filter-suggestions` at the top of the file.

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

In `server/src/services/search.service.ts`, add after `getTagSuggestions`:

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

Update the imports at the top to include `FilterSuggestionsRequestDto` and `FilterSuggestionsResponseDto`.

**Step 2: Add controller endpoint**

In `server/src/controllers/search.controller.ts`, add before the closing `}` of the class:

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

Update the imports at the top to include `FilterSuggestionsRequestDto` and `FilterSuggestionsResponseDto`.

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
    expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
      [auth.user.id],
      expect.objectContaining({ withSharedSpaces: true }),
    );
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
    mocks.search.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [],
      people: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });

    await sut.getFilterSuggestions(auth, { spaceId });

    expect(mocks.access.checkAccess).toHaveBeenCalled();
  });

  it('should resolve timelineSpaceIds when withSharedSpaces is set', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    mocks.partner.getAll.mockResolvedValue([]);
    mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
    mocks.search.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [],
      people: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });

    await sut.getFilterSuggestions(auth, { withSharedSpaces: true });

    expect(mocks.search.getFilterSuggestions).toHaveBeenCalledWith(
      [auth.user.id],
      expect.objectContaining({ timelineSpaceIds: [spaceId] }),
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

In `rating-filter.svelte`, add `availableRatings` prop and filter the stars:

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
    availableRatings ? [1, 2, 3, 4, 5].filter((s) => availableRatings.includes(s) || s === selectedRating) : [1, 2, 3, 4, 5],
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

In `media-type-filter.svelte`, add `availableMediaTypes` prop and filter:

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
      ? allOptions.filter((o) => o.value === 'all' || o.value === selected || availableMediaTypes.includes(o.assetType!))
      : allOptions,
  );
</script>

<div class="flex gap-1.5" data-testid="media-type-filter">
  {#each options as option (option.value)}
    {@const isActive = selected === option.value}
    <button
      type="button"
      class="rounded-lg border px-2.5 py-1 text-xs {isActive
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

**Step 1: Add new state variables and the unified effect**

At the top of the `<script>` block, add new state:

```typescript
let availableRatings = $state<number[] | undefined>();
let availableMediaTypes = $state<string[] | undefined>();
```

The `hasUnnamedPeople` state already exists at line 58.

**Step 2: Add the unified `$effect` block**

Add after the existing `filterContext` effect (line 74), BEFORE the temporal re-fetch effect (line 84):

```typescript
// Unified suggestions re-fetch: replaces mount effects + temporal re-fetch when suggestionsProvider is set
let prevFilterSnapshot: string | undefined = $state();
let unifiedAbortController: AbortController | undefined = $state();

$effect(() => {
  if (!config.suggestionsProvider) {
    return;
  }

  // Track all filter fields
  const snapshot = JSON.stringify({
    personIds: filters.personIds,
    country: filters.country,
    city: filters.city,
    make: filters.make,
    model: filters.model,
    tagIds: filters.tagIds,
    rating: filters.rating,
    mediaType: filters.mediaType,
    isFavorite: filters.isFavorite,
    selectedYear: filters.selectedYear,
    selectedMonth: filters.selectedMonth,
  });

  const prevSnapshot = untrack(() => prevFilterSnapshot);

  // Skip if nothing changed
  if (snapshot === prevSnapshot) {
    return;
  }

  // Determine debounce delay
  const prev = prevSnapshot ? JSON.parse(prevSnapshot) : undefined;
  const yearChanged =
    prev && (prev.selectedYear !== filters.selectedYear || prev.selectedMonth !== filters.selectedMonth);
  const isTemporalClear = yearChanged && !filters.selectedYear;
  const isTemporalOnly = yearChanged && !prev ? false : yearChanged;
  const delay = prevSnapshot === undefined ? 0 : isTemporalClear ? 0 : isTemporalOnly ? 200 : 50;

  const provider = config.suggestionsProvider;
  const providers = config.providers;
  const currentFilters = { ...filters };

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
        availableMediaTypes = result.mediaTypes;
        hasUnnamedPeople = result.hasUnnamedPeople;

        // Cascading child re-fetch
        if (currentFilters.country && result.countries.includes(currentFilters.country) && providers?.cities) {
          void providers.cities(currentFilters.country, filterContext);
        }
        if (currentFilters.make && result.cameraMakes.includes(currentFilters.make) && providers?.cameraModels) {
          void providers.cameraModels(currentFilters.make, filterContext);
        }
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

  prevFilterSnapshot = snapshot;

  return () => {
    clearTimeout(timeout);
  };
});
```

**Step 3: Guard existing effects with `!config.suggestionsProvider`**

Wrap the temporal re-fetch effect (lines 84-201) with:

```typescript
if (!config.suggestionsProvider) { ... existing effect body ... }
```

Wrap each of the 4 mount effects (lines 278-313) with the same guard:

```typescript
if (!config.suggestionsProvider) { ... existing effect body ... }
```

**Step 4: Update `providers` references to use optional chaining**

Since `providers` is now optional on `FilterPanelConfig`, update all references in the template and script from `config.providers.X` to `config.providers?.X`.

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
feat(web): add unified suggestionsProvider effect with debounce and cascading
```

---

### Task 12: Photos Page — Wire Up `suggestionsProvider`

**Files:**

- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`

**Step 1: Replace the filterConfig**

Replace the existing `filterConfig` (lines 68-135) with the new version from the design doc. Import `getFilterSuggestions` from the generated SDK. The key change: add `suggestionsProvider` function, keep only `cities` and `cameraModels` in `providers`.

Refer to the design doc section "Photos Page Integration" for the exact code — it constructs `PersonOption[]` with `thumbnailUrl`, populates `personNames`/`tagNames` maps, and maps tag `value` to `name`.

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

This test file should cover:

1. **Initial mount fires `suggestionsProvider` with default filter state**
2. **Filter change triggers `suggestionsProvider` with updated state**
3. **Suggestions update in the DOM after response**
4. **50ms debounce for discrete changes** (use `vi.useFakeTimers`, advance by 50ms)
5. **200ms debounce for temporal changes**
6. **0ms debounce for clear-all**
7. **AbortController: rapid changes cancel stale requests**
8. **Backward compat: `providers`-only config still works** (no `suggestionsProvider`)
9. **`isRefetching` flag set during fetch**
10. **`availableRatings` hides unavailable stars**
11. **`availableMediaTypes` hides unavailable buttons**
12. **`hasUnnamedPeople` shows correct empty text**

Follow the patterns in `contextual-refetch.spec.ts` for test structure: create a mock config, render FilterPanel, interact via `fireEvent`, advance timers, assert with `waitFor`.

Example test for debounce:

```typescript
it('should debounce discrete filter changes at 50ms', async () => {
  const suggestionsProvider = vi.fn().mockResolvedValue(defaultResponse);
  const config = { sections: ['people', 'location'], suggestionsProvider };
  render(FilterPanel, { props: { config, timeBuckets } });

  await vi.advanceTimersByTimeAsync(0); // initial mount
  expect(suggestionsProvider).toHaveBeenCalledTimes(1);

  // Simulate filter change by clicking a person checkbox
  // ... click person checkbox ...

  // Should NOT have fired yet
  expect(suggestionsProvider).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(50);

  await waitFor(() => {
    expect(suggestionsProvider).toHaveBeenCalledTimes(2);
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

If any repository methods use `@GenerateSql`, the SQL query documentation needs to be regenerated.

**Step 1: Check for `@GenerateSql` on new methods**

The new `getFilterSuggestions` method is public and should have `@GenerateSql` if it follows the existing pattern. Check if the other suggestion methods (`getCountries`, etc.) have it — they do. Add `@GenerateSql` to `getFilterSuggestions`.

**Step 2: Regenerate**

Run: `make sql` (requires running DB via `make dev`)

If no local DB is available, apply the CI diff manually — CI will show the expected SQL file content.

**Step 3: Commit**

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
