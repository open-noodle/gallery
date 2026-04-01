# Filter Suggestions Rollout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Roll out interdependent filtering to Map and Spaces pages, fix rating DTO bug, add 10 E2E tests.

**Architecture:** No new server endpoints. Add `@Type(() => Number)` to rating DTO. Replace `providers` with `suggestionsProvider` on two pages. New server E2E spec verifying cross-filter narrowing.

**Tech Stack:** NestJS (server DTO fix), Svelte 5 (web wiring), Vitest + supertest (E2E tests)

**Design doc:** `docs/plans/2026-04-01-filter-suggestions-rollout-design.md`

---

### Task 1: Fix `rating` query param parsing

**Files:**

- Modify: `server/src/dtos/search.dto.ts`

**Step 1: Add `@Type(() => Number)` to `rating` field in `FilterSuggestionsRequestDto`**

Find the `rating` field (around line 452-457) and add the `@Type` decorator. The `Type` import from `class-transformer` already exists at line 2.

```typescript
@Property({ type: 'number', description: 'Filter by rating (1-5)', minimum: 1, maximum: 5 })
@Optional()
@IsInt()
@Min(1)
@Max(5)
@Type(() => Number)
rating?: number;
```

**Step 2: Verify compilation**

Run: `cd server && npx tsc --noEmit --incremental false 2>&1 | head -5`
Expected: No errors

**Step 3: Commit**

```
fix: add @Type(() => Number) to rating in FilterSuggestionsRequestDto
```

---

### Task 2: Wire up Spaces page `suggestionsProvider`

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`

**Step 1: Add imports**

Add to the `@immich/sdk` import: `getFilterSuggestions`, `AssetTypeEnum`

Add to the filter-panel import: `buildFilterContext`, `type FilterState`

**Step 2: Replace the `filterConfig`**

Replace the `providers` block (lines 167-239) with `suggestionsProvider` + fallback `providers`. Follow the exact pattern from the Photos page (`web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte` lines 69-130).

Key differences from Photos:

- Use `spaceId: space.id` instead of `withSharedSpaces: true`
- Use `/people/${p.id}/thumbnail` for thumbnail URLs (global route)
- Keep `cities` and `cameraModels` providers with `spaceId: space.id` scoping
- Remove `allPeople` provider entirely
- Populate `personNames` and `tagNames` maps from response

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
      spaceId: space.id,
    });
    const mappedPeople = response.people.map((p) => ({
      id: p.id,
      name: p.name,
      thumbnailUrl: `/people/${p.id}/thumbnail`,
    }));
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
    cities: async (country, context) =>
      getSearchSuggestions({
        $type: SearchSuggestionType.City,
        spaceId: space.id,
        country,
        ...context,
      }),
    cameraModels: async (make, context) =>
      getSearchSuggestions({
        $type: SearchSuggestionType.CameraModel,
        spaceId: space.id,
        make,
        ...context,
      }),
  },
};
```

Remove unused imports: `getSpacePeople`, `getTagSuggestions`, `FilterContext` (if no longer used elsewhere in the file — check first).

**Step 3: Run type check**

Run: `cd web && npx svelte-check --threshold error 2>&1 | tail -10`
Expected: No new errors

**Step 4: Run prettier**

Run: `npx prettier --write src/routes/\(user\)/spaces/\[spaceId\]/\[\[photos=photos\]\]/\[\[assetId=id\]\]/+page.svelte`

**Step 5: Commit**

```
feat(web): wire up suggestionsProvider on Spaces page
```

---

### Task 3: Wire up Map page `suggestionsProvider`

**Files:**

- Modify: `web/src/lib/utils/map-filter-config.ts`

**Step 1: Update imports**

Replace the imports to include what's needed for `suggestionsProvider`:

```typescript
import {
  buildFilterContext,
  type FilterPanelConfig,
  type FilterState,
} from '$lib/components/filter-panel/filter-panel';
import { createUrl } from '$lib/utils';
import { AssetTypeEnum, getFilterSuggestions, getSearchSuggestions, SearchSuggestionType } from '@immich/sdk';
```

Remove unused imports: `getAllPeople`, `getSpacePeople`, `getTagSuggestions`, `FilterContext`.

**Step 2: Replace the function body**

The function signature stays the same: `buildMapFilterConfig(spaceId?: string): FilterPanelConfig`.

Both branches (with/without spaceId) now return `suggestionsProvider` + `cameraModels` provider:

```typescript
export function buildMapFilterConfig(spaceId?: string): FilterPanelConfig {
  const sections = ['timeline', 'people', 'camera', 'tags', 'rating', 'media', 'favorites'] as const;

  const suggestionsProvider = async (filters: FilterState) => {
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
      ...(spaceId ? { spaceId } : { withSharedSpaces: true }),
    });
    return {
      countries: response.countries,
      cameraMakes: response.cameraMakes,
      tags: response.tags.map((t: { id: string; value: string }) => ({ id: t.id, name: t.value })),
      people: response.people.map((p: { id: string; name: string }) => ({
        id: p.id,
        name: p.name,
        thumbnailUrl: createUrl(`/people/${p.id}/thumbnail`),
      })),
      ratings: response.ratings,
      mediaTypes: response.mediaTypes,
      hasUnnamedPeople: response.hasUnnamedPeople,
    };
  };

  return {
    sections: [...sections],
    suggestionsProvider,
    providers: {
      cameraModels: (make: string, context) =>
        getSearchSuggestions({
          $type: SearchSuggestionType.CameraModel,
          make,
          ...(spaceId ? { spaceId } : { withSharedSpaces: true }),
          ...context,
        }),
    },
  };
}
```

**Step 3: Run type check**

Run: `cd web && npx svelte-check --threshold error 2>&1 | tail -10`
Expected: No new errors

**Step 4: Run prettier**

Run: `npx prettier --write src/lib/utils/map-filter-config.ts`

**Step 5: Commit**

```
feat(web): wire up suggestionsProvider in map filter config
```

---

### Task 4: E2E tests — setup and unfiltered baseline

**Files:**

- Create: `e2e/src/specs/server/api/filter-suggestions.e2e-spec.ts`

**Step 1: Create the E2E test file with data setup**

Follow the pattern from `search.e2e-spec.ts`: upload real test-asset files, set coordinates via `updateAsset`, wait for websocket `assetUpdate` events, create tags, apply tags and ratings.

```typescript
import { AssetMediaResponseDto, LoginResponseDto, updateAsset } from '@immich/sdk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Socket } from 'socket.io-client';
import { app, asBearerAuth, testAssetDir, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('/search/suggestions/filters', () => {
  let admin: LoginResponseDto;
  let websocket: Socket;
  let assets: AssetMediaResponseDto[];
  let tagNatureId: string;
  let tagTravelId: string;

  // Discovered values from unfiltered response
  let unfilteredCountries: string[];
  let unfilteredCameraMakes: string[];
  let unfilteredTags: Array<{ id: string; value: string }>;
  let unfilteredRatings: number[];

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    websocket = await utils.connectWebsocket(admin.accessToken);

    // Upload 4 test photos with real EXIF (different cameras)
    const files = [
      { filename: '/albums/nature/prairie_falcon.jpg' },    // Canon EOS R5
      { filename: '/formats/webp/denali.webp' },             // Canon EOS 7D
      { filename: '/formats/raw/Nikon/D80/glarus.nef' },     // Nikon D80
      { filename: '/formats/jpg/el_torcal_rocks.jpg' },      // HP scanner
    ];

    assets = [];
    for (const { filename } of files) {
      const bytes = await readFile(join(testAssetDir, filename));
      assets.push(
        await utils.createAsset(admin.accessToken, {
          deviceAssetId: `filter-test-${filename}`,
          assetData: { bytes, filename },
        }),
      );
    }

    for (const asset of assets) {
      await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });
    }

    // Set distinct coordinates for different countries
    const coordinates = [
      { latitude: 48.853_41, longitude: 2.3488 },       // Paris, France
      { latitude: 35.6895, longitude: 139.691_71 },      // Tokyo, Japan
      { latitude: 52.524_37, longitude: 13.410_53 },     // Berlin, Germany
      { latitude: 35.6895, longitude: 139.691_71 },      // Tokyo, Japan (same as B)
    ];

    for (const [i, dto] of coordinates.entries()) {
      await updateAsset(
        { id: assets[i].id, updateAssetDto: dto },
        { headers: asBearerAuth(admin.accessToken) },
      );
    }

    for (const asset of assets) {
      await utils.waitForWebsocketEvent({ event: 'assetUpdate', id: asset.id });
    }

    // Set ratings: A=5, B=4, C=5, D=3
    const ratings = [5, 4, 5, 3];
    for (const [i, rating] of ratings.entries()) {
      await updateAsset(
        { id: assets[i].id, updateAssetDto: { rating } },
        { headers: asBearerAuth(admin.accessToken) },
      );
    }

    // Create and apply tags using utils helpers
    const tags = await utils.upsertTags(admin.accessToken, ['nature', 'travel']);
    tagNatureId = tags[0].id;
    tagTravelId = tags[1].id;

    // A+C get "nature", B+D get "travel"
    await utils.tagAssets(admin.accessToken, tagNatureId, [assets[0].id, assets[2].id]);
    await utils.tagAssets(admin.accessToken, tagTravelId, [assets[1].id, assets[3].id]);

    // Discover unfiltered values
    const { body } = await request(app)
      .get('/search/suggestions/filters?withSharedSpaces=true')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    unfilteredCountries = body.countries;
    unfilteredCameraMakes = body.cameraMakes;
    unfilteredTags = body.tags;
    unfilteredRatings = body.ratings;
  }, 60_000);

  afterAll(() => {
    utils.disconnectWebsocket(websocket);
  });
```

**Step 2: Write the 10 test cases**

```typescript
  it('should return non-empty unfiltered baseline', () => {
    expect(unfilteredCountries.length).toBeGreaterThanOrEqual(2);
    expect(unfilteredTags.length).toBe(2);
    expect(unfilteredRatings.length).toBeGreaterThanOrEqual(2);
  });

  it('should narrow tags when filtering by country', async () => {
    const country = unfilteredCountries[0];
    const { body } = await request(app)
      .get(`/search/suggestions/filters?country=${encodeURIComponent(country)}&withSharedSpaces=true`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(body.tags.length).toBeLessThan(unfilteredTags.length);
  });

  it('should narrow countries when filtering by tag', async () => {
    const { body } = await request(app)
      .get(`/search/suggestions/filters?tagIds=${tagNatureId}&withSharedSpaces=true`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    // "nature" is on A (France) and C (Germany), not B or D (Japan)
    expect(body.countries.length).toBeLessThan(unfilteredCountries.length);
  });

  it('should narrow countries when filtering by rating', async () => {
    // Rating 3 is only on asset D (Tokyo)
    const { body } = await request(app)
      .get('/search/suggestions/filters?rating=3&withSharedSpaces=true')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(body.countries.length).toBeLessThan(unfilteredCountries.length);
  });

  it('should narrow countries when filtering by camera make', async () => {
    if (unfilteredCameraMakes.length < 2) {
      return; // skip if test assets don't have diverse cameras
    }
    const make = unfilteredCameraMakes[0];
    const { body } = await request(app)
      .get(`/search/suggestions/filters?make=${encodeURIComponent(make)}&withSharedSpaces=true`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(body.countries.length).toBeLessThanOrEqual(unfilteredCountries.length);
  });

  it('should narrow further with combined filters', async () => {
    const country = unfilteredCountries[0];

    // Get results with just country
    const { body: countryOnly } = await request(app)
      .get(`/search/suggestions/filters?country=${encodeURIComponent(country)}&withSharedSpaces=true`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    // Get results with country + tag
    const { body: combined } = await request(app)
      .get(
        `/search/suggestions/filters?country=${encodeURIComponent(country)}&tagIds=${tagNatureId}&withSharedSpaces=true`,
      )
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    // Combined should be equal or narrower than country alone
    expect(combined.ratings.length).toBeLessThanOrEqual(countryOnly.ratings.length);
  });

  it('should parse rating as number from query string', async () => {
    const { body } = await request(app)
      .get('/search/suggestions/filters?rating=5&withSharedSpaces=true')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(body.countries).toBeDefined();
    expect(Array.isArray(body.countries)).toBe(true);
  });

  it('should accept single tagId without array duplication', async () => {
    const { body } = await request(app)
      .get(`/search/suggestions/filters?tagIds=${tagNatureId}&withSharedSpaces=true`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(body.countries.length).toBeLessThan(unfilteredCountries.length);
  });

  it('should return empty arrays for non-overlapping filters', async () => {
    // Pick a country that has "nature" and filter by "travel" — should produce empty or narrowed results
    // Use the first country + opposite tag to create a non-overlapping combination
    const country = unfilteredCountries[0];
    const oppositeTagId = unfilteredTags[0].id === tagNatureId ? tagTravelId : tagNatureId;

    const { body } = await request(app)
      .get(
        `/search/suggestions/filters?country=${encodeURIComponent(country)}&tagIds=${oppositeTagId}&withSharedSpaces=true`,
      )
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    // Should have fewer results or be empty — at minimum, valid response shape
    expect(Array.isArray(body.countries)).toBe(true);
    expect(Array.isArray(body.tags)).toBe(true);
    expect(typeof body.hasUnnamedPeople).toBe('boolean');
  });

  it('should scope suggestions to a space', async () => {
    // Create a space with only assets A and B
    const space = await utils.createSpace(admin.accessToken, { name: 'Filter Test Space' });
    await utils.addSpaceAssets(admin.accessToken, space.id, [assets[0].id, assets[1].id]);

    const { body } = await request(app)
      .get(`/search/suggestions/filters?spaceId=${space.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    // Space has only 2 assets, so fewer suggestions than global
    expect(body.tags.length).toBeLessThanOrEqual(unfilteredTags.length);
    expect(body.ratings.length).toBeLessThanOrEqual(unfilteredRatings.length);
  });
});
```

**Step 3: Run the E2E tests**

Run: `cd e2e && pnpm test -- --run src/specs/server/api/filter-suggestions.e2e-spec.ts`
Expected: All 10 tests pass (requires `make e2e` stack running)

**Step 4: Commit**

```
test(e2e): add 10 E2E tests for cross-filter narrowing
```

---

### Task 5: Final verification

**Step 1: Run server type check**

Run: `cd server && npx tsc --noEmit --incremental false`
Expected: No errors

**Step 2: Run web type check**

Run: `cd web && npx svelte-check --threshold error`
Expected: No new errors

**Step 3: Run server unit tests**

Run: `cd server && pnpm test`
Expected: All pass

**Step 4: Run web unit tests**

Run: `cd web && pnpm test`
Expected: All pass

**Step 5: Run prettier on changed files**

Run: `npx prettier --write server/src/dtos/search.dto.ts web/src/lib/utils/map-filter-config.ts`
And format the spaces page svelte file.

**Step 6: Commit any fixes, create PR**
