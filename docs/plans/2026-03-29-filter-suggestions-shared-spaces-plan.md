# Filter Suggestions for Shared Space Content — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Location and Camera filter panels show suggestions from shared spaces for non-admin users on the Photos and Map pages.

**Architecture:** Add `withSharedSpaces` boolean to `SearchSuggestionRequestDto`. When set, the service resolves the user's timeline space IDs and passes them to repository queries as `timelineSpaceIds`. The repository `getExifField()` ORs owner assets with space assets. Frontend passes `withSharedSpaces: true` on all suggestion calls from Photos and Map pages.

**Tech Stack:** NestJS (server), Kysely (SQL), SvelteKit (web), Vitest (tests), OpenAPI codegen

**Design doc:** `docs/plans/2026-03-29-filter-suggestions-shared-spaces-design.md`

---

### Task 1: Add `timelineSpaceIds` to `SpaceScopeOptions` and update `getExifField`

**Files:**

- Modify: `server/src/repositories/search.repository.ts`

**Step 1: Write the failing test**

There are no isolated repository-level unit tests for `getExifField` (it's private and tested through the service layer). Skip to implementation — the service tests in Task 2 will cover this.

**Step 2: Add `timelineSpaceIds` to `SpaceScopeOptions`**

In `server/src/repositories/search.repository.ts`, modify the `SpaceScopeOptions` interface (line 170):

```typescript
export interface SpaceScopeOptions {
  spaceId?: string;
  timelineSpaceIds?: string[];
  takenAfter?: Date;
  takenBefore?: Date;
}
```

**Step 3: Update `getExifField` to handle `timelineSpaceIds`**

Replace the existing `getExifField` method (lines 524-559) with three mutually exclusive branches:

```typescript
private getExifField<K extends 'city' | 'state' | 'country' | 'make' | 'model' | 'lensModel'>(
  field: K,
  userIds: string[],
  options?: SpaceScopeOptions,
) {
  return this.db
    .selectFrom('asset_exif')
    .select(field)
    .distinctOn(field)
    .innerJoin('asset', 'asset.id', 'asset_exif.assetId')
    .$if(!options?.spaceId && !options?.timelineSpaceIds, (qb) =>
      qb.where('ownerId', '=', anyUuid(userIds)),
    )
    .where('visibility', '=', AssetVisibility.Timeline)
    .where('deletedAt', 'is', null)
    .where(field, 'is not', null)
    .where(field, '!=', '' as any)
    .$if(!!options?.spaceId && !options?.timelineSpaceIds, (qb) =>
      qb.where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .whereRef('shared_space_asset.assetId', '=', 'asset.id')
              .where('shared_space_asset.spaceId', '=', asUuid(options!.spaceId!)),
          ),
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
              .where('shared_space_library.spaceId', '=', asUuid(options!.spaceId!)),
          ),
        ]),
      ),
    )
    .$if(!!options?.timelineSpaceIds, (qb) =>
      qb.where((eb) =>
        eb.or([
          eb('ownerId', '=', anyUuid(userIds)),
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .whereRef('shared_space_asset.assetId', '=', 'asset.id')
              .where('shared_space_asset.spaceId', '=', anyUuid(options!.timelineSpaceIds!)),
          ),
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
              .where('shared_space_library.spaceId', '=', anyUuid(options!.timelineSpaceIds!)),
          ),
        ]),
      ),
    )
    .$if(!!options?.takenAfter, (qb) => qb.where('asset.fileCreatedAt', '>=', options!.takenAfter!))
    .$if(!!options?.takenBefore, (qb) => qb.where('asset.fileCreatedAt', '<', options!.takenBefore!));
}
```

Key differences from old code:

- First branch: `!spaceId && !timelineSpaceIds` (was just `!spaceId`)
- Second branch: `!!spaceId && !timelineSpaceIds` (was just `!!spaceId`) — makes branches mutually exclusive
- Third branch (NEW): `!!timelineSpaceIds` — ORs owner filter with space asset/library subqueries using `anyUuid` for array matching

**Step 4: Run existing tests to verify no regressions**

Run: `cd server && pnpm test -- --run src/services/search.service.spec.ts`
Expected: All existing tests PASS (the repository change is backward-compatible — no existing caller passes `timelineSpaceIds`)

**Step 5: Commit**

```
feat: add timelineSpaceIds support to getExifField
```

---

### Task 2: Add `withSharedSpaces` to DTO and service layer

**Files:**

- Modify: `server/src/dtos/search.dto.ts`
- Modify: `server/src/services/search.service.ts`
- Modify: `server/src/services/search.service.spec.ts`

**Step 1: Add `withSharedSpaces` to `SearchSuggestionRequestDto`**

In `server/src/dtos/search.dto.ts`, add after the `spaceId` field (line 342):

```typescript
@ValidateBoolean({ optional: true, description: 'Include suggestions from shared spaces the user is a member of' })
withSharedSpaces?: boolean;
```

**Step 2: Write failing tests for the service**

In `server/src/services/search.service.spec.ts`, add these tests inside the existing `describe('getSearchSuggestions', ...)` block:

```typescript
it('should reject when both spaceId and withSharedSpaces are set', async () => {
  await expect(
    sut.getSearchSuggestions(authStub.user1, {
      type: SearchSuggestionType.COUNTRY,
      spaceId: newUuid(),
      withSharedSpaces: true,
    }),
  ).rejects.toBeInstanceOf(BadRequestException);
});

it('should fetch timeline space IDs when withSharedSpaces is true', async () => {
  const spaceId1 = newUuid();
  const spaceId2 = newUuid();
  mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: spaceId1 }, { spaceId: spaceId2 }]);
  mocks.search.getCountries.mockResolvedValue(['Germany', 'France']);

  const result = await sut.getSearchSuggestions(authStub.user1, {
    type: SearchSuggestionType.COUNTRY,
    withSharedSpaces: true,
  });

  expect(result).toEqual(['Germany', 'France']);
  expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(authStub.user1.user.id);
  expect(mocks.search.getCountries).toHaveBeenCalledWith(
    [authStub.user1.user.id],
    expect.objectContaining({ timelineSpaceIds: [spaceId1, spaceId2] }),
  );
});

it('should fall back to owner-only when withSharedSpaces is true but user has no spaces', async () => {
  mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
  mocks.search.getCountries.mockResolvedValue(['USA']);

  const result = await sut.getSearchSuggestions(authStub.user1, {
    type: SearchSuggestionType.COUNTRY,
    withSharedSpaces: true,
  });

  expect(result).toEqual(['USA']);
  expect(mocks.search.getCountries).toHaveBeenCalledWith(
    [authStub.user1.user.id],
    expect.objectContaining({ timelineSpaceIds: undefined }),
  );
});

it('should preserve existing behavior when withSharedSpaces is absent', async () => {
  mocks.search.getCountries.mockResolvedValue(['USA']);

  await sut.getSearchSuggestions(authStub.user1, {
    type: SearchSuggestionType.COUNTRY,
  });

  expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
});

it('should preserve existing behavior when withSharedSpaces is explicitly false', async () => {
  mocks.search.getCountries.mockResolvedValue(['USA']);

  await sut.getSearchSuggestions(authStub.user1, {
    type: SearchSuggestionType.COUNTRY,
    withSharedSpaces: false,
  });

  expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
});

it('should pass timelineSpaceIds through to camera make suggestions', async () => {
  const spaceId1 = newUuid();
  mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: spaceId1 }]);
  mocks.search.getCameraMakes.mockResolvedValue(['Nikon']);

  await sut.getSearchSuggestions(authStub.user1, {
    type: SearchSuggestionType.CAMERA_MAKE,
    withSharedSpaces: true,
  });

  expect(mocks.search.getCameraMakes).toHaveBeenCalledWith(
    [authStub.user1.user.id],
    expect.objectContaining({ timelineSpaceIds: [spaceId1] }),
  );
});
```

**Step 3: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/services/search.service.spec.ts`
Expected: FAIL — the new tests fail because the service doesn't handle `withSharedSpaces` yet

**Step 4: Implement the service change**

In `server/src/services/search.service.ts`, replace `getSearchSuggestions` (lines 173-184):

```typescript
async getSearchSuggestions(auth: AuthDto, dto: SearchSuggestionRequestDto) {
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

  const suggestions = await this.getSuggestions(userIds, { ...dto, timelineSpaceIds });
  if (dto.includeNull) {
    suggestions.push(null);
  }
  return suggestions;
}
```

Also update the `getSuggestions` method signature to accept `timelineSpaceIds` (lines 186-210). The DTO is spread into the repository call, so `timelineSpaceIds` flows through because all option types extend `SpaceScopeOptions`:

```typescript
private getSuggestions(
  userIds: string[],
  dto: SearchSuggestionRequestDto & { timelineSpaceIds?: string[] },
): Promise<Array<string | null>> {
  switch (dto.type) {
    case SearchSuggestionType.COUNTRY: {
      return this.searchRepository.getCountries(userIds, dto);
    }
    case SearchSuggestionType.STATE: {
      return this.searchRepository.getStates(userIds, dto);
    }
    case SearchSuggestionType.CITY: {
      return this.searchRepository.getCities(userIds, dto);
    }
    case SearchSuggestionType.CAMERA_MAKE: {
      return this.searchRepository.getCameraMakes(userIds, dto);
    }
    case SearchSuggestionType.CAMERA_MODEL: {
      return this.searchRepository.getCameraModels(userIds, dto);
    }
    case SearchSuggestionType.CAMERA_LENS_MODEL: {
      return this.searchRepository.getCameraLensModels(userIds, dto);
    }
    default: {
      return Promise.resolve([]);
    }
  }
}
```

Make sure `BadRequestException` is imported from `@nestjs/common` (check existing imports at top of file).

**Step 5: Run tests to verify they pass**

Run: `cd server && pnpm test -- --run src/services/search.service.spec.ts`
Expected: All tests PASS

**Step 6: Commit**

```
feat: add withSharedSpaces to search suggestions endpoint
```

---

### Task 3: Regenerate OpenAPI specs and SDK

This must happen before frontend tasks so `withSharedSpaces` is available in the TypeScript SDK types.

**Files:**

- Generated: `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/`, `mobile/openapi/`

**Step 1: Build server**

Run: `cd server && pnpm build`
Expected: Build succeeds

**Step 2: Regenerate OpenAPI spec**

Run: `cd server && pnpm sync:open-api`
Expected: `open-api/immich-openapi-specs.json` updated with new `withSharedSpaces` parameter on search suggestions endpoint

**Step 3: Regenerate TypeScript SDK**

Run: `make open-api-typescript`
Expected: TypeScript SDK updated — `getSearchSuggestions` function now accepts `withSharedSpaces` parameter

**Step 4: Regenerate Dart SDK**

Run: `make open-api-dart`
Expected: Dart client updated (requires Java installed)

**Step 5: Regenerate SQL query docs**

Run: `make sql`
Expected: SQL documentation updated with new query variants

**Step 6: Commit**

```
chore: regenerate OpenAPI specs and SDK for withSharedSpaces
```

---

### Task 4: Update Photos page filter providers

**Files:**

- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`

**Step 1: Add `withSharedSpaces: true` to all suggestion providers**

In `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`, update the `filterConfig` providers object (lines 85-118). Add `withSharedSpaces: true` to every `getSearchSuggestions` call:

```typescript
locations: async (context?: FilterContext) => {
  const countries = await getSearchSuggestions({
    $type: SearchSuggestionType.Country,
    withSharedSpaces: true,
    takenAfter: context?.takenAfter,
    takenBefore: context?.takenBefore,
  });
  return countries.filter(Boolean).map((c) => ({ value: c!, type: 'country' as const }));
},
cities: async (country: string, context?: FilterContext) => {
  const cities = await getSearchSuggestions({
    $type: SearchSuggestionType.City,
    country,
    withSharedSpaces: true,
    takenAfter: context?.takenAfter,
    takenBefore: context?.takenBefore,
  });
  return cities.filter(Boolean) as string[];
},
cameras: async (context?: FilterContext) => {
  const makes = await getSearchSuggestions({
    $type: SearchSuggestionType.CameraMake,
    withSharedSpaces: true,
    takenAfter: context?.takenAfter,
    takenBefore: context?.takenBefore,
  });
  return makes.filter(Boolean).map((m) => ({ value: m!, type: 'make' as const }));
},
cameraModels: async (make: string, context?: FilterContext) => {
  const models = await getSearchSuggestions({
    $type: SearchSuggestionType.CameraModel,
    make,
    withSharedSpaces: true,
    takenAfter: context?.takenAfter,
    takenBefore: context?.takenBefore,
  });
  return models.filter(Boolean) as string[];
},
```

**Step 2: Run web tests**

Run: `cd web && pnpm test -- --run`
Expected: PASS (SDK was regenerated in Task 3, so `withSharedSpaces` is a valid type)

**Step 3: Commit**

```
feat(web): pass withSharedSpaces to Photos page filter providers
```

---

### Task 5: Update Map page filter providers

**Files:**

- Modify: `web/src/lib/utils/map-filter-config.ts`
- Modify: `web/src/lib/utils/__tests__/map-filter-config.spec.ts`

**Step 1: Write a failing test**

In `web/src/lib/utils/__tests__/map-filter-config.spec.ts`, add a new test:

```typescript
it('should pass withSharedSpaces to cameras provider when no spaceId', async () => {
  vi.mocked(getSearchSuggestions).mockResolvedValue(['Nikon'] as never);

  const config = buildMapFilterConfig();
  await config.providers.cameras!();

  expect(getSearchSuggestions).toHaveBeenCalledWith(expect.objectContaining({ withSharedSpaces: true }));
});

it('should pass withSharedSpaces to cameraModels provider when no spaceId', async () => {
  vi.mocked(getSearchSuggestions).mockResolvedValue(['D850'] as never);

  const config = buildMapFilterConfig();
  await config.providers.cameraModels!('Nikon');

  expect(getSearchSuggestions).toHaveBeenCalledWith(expect.objectContaining({ withSharedSpaces: true, make: 'Nikon' }));
});
```

Note: `getSearchSuggestions` is already mocked in the test file's `vi.mock('@immich/sdk', ...)` block but not imported for assertions. Add it to the import from `@immich/sdk`:

```typescript
import { getAllPeople, getSearchSuggestions, getSpacePeople } from '@immich/sdk';
```

**Step 2: Run tests to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/utils/__tests__/map-filter-config.spec.ts`
Expected: FAIL — `withSharedSpaces` not passed yet

**Step 3: Add `withSharedSpaces: true` to non-space providers**

In `web/src/lib/utils/map-filter-config.ts`, update the non-space branch (lines 61-73):

```typescript
cameras: (context?: FilterContext) =>
  getSearchSuggestions({
    $type: SearchSuggestionType.CameraMake,
    withSharedSpaces: true,
    ...(context?.takenAfter && { takenAfter: context.takenAfter }),
    ...(context?.takenBefore && { takenBefore: context.takenBefore }),
  }).then((results) => results.map((r) => ({ value: r, type: 'make' as const }))),
cameraModels: (make: string, context?: FilterContext) =>
  getSearchSuggestions({
    $type: SearchSuggestionType.CameraModel,
    make,
    withSharedSpaces: true,
    ...(context?.takenAfter && { takenAfter: context.takenAfter }),
    ...(context?.takenBefore && { takenBefore: context.takenBefore }),
  }),
```

**Step 4: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/utils/__tests__/map-filter-config.spec.ts`
Expected: PASS

**Step 5: Commit**

```
feat(web): pass withSharedSpaces to Map page filter providers
```

---

### Task 6: Lint and type-check

Run these sequentially with long timeouts — they take ~10 min each.

**Files:** None (verification only)

**Step 1: Format server**

Run: `make format-server` (timeout: 10 minutes)
Expected: No changes or auto-fixed formatting

**Step 2: Lint server**

Run: `make lint-server` (timeout: 10 minutes)
Expected: PASS with zero warnings

**Step 3: Type-check server**

Run: `make check-server` (timeout: 10 minutes)
Expected: PASS

**Step 4: Format web**

Run: `make format-web` (timeout: 10 minutes)
Expected: No changes or auto-fixed formatting

**Step 5: Lint web**

Run: `make lint-web` (timeout: 10 minutes)
Expected: PASS with zero warnings

**Step 6: Type-check web**

Run: `make check-web` (timeout: 10 minutes)
Expected: PASS

**Step 7: Commit any formatting changes**

```
style: format and lint
```

---

### Task 7: E2E tests

**Files:**

- Modify: `e2e/src/specs/server/api/search.e2e-spec.ts`

**Step 1: Add E2E test for shared space suggestions**

In `e2e/src/specs/server/api/search.e2e-spec.ts`, find the existing `describe('GET /search/suggestions', ...)` block. Add tests that:

1. Create a non-admin user
2. Create a shared space owned by admin, add the non-admin user as a member
3. Upload an asset with known EXIF (country, camera make) to the admin's library
4. Link the admin's library to the shared space
5. As the non-admin user, call `GET /search/suggestions?type=country&withSharedSpaces=true`
6. Assert the space's country appears in the results
7. Repeat for `type=camera-make`
8. Repeat for cascading: `type=city&country=<value>&withSharedSpaces=true`

Study the existing test setup at the top of the file to understand how test users, assets, and spaces are created. Use the same patterns (e.g., `utils.createUser`, `utils.createSharedSpace`, `utils.linkLibrary`).

Also add a negative test:

9. Call with both `spaceId` and `withSharedSpaces=true` — expect 400 Bad Request

**Step 2: Run E2E tests**

Run: `cd e2e && pnpm test -- --run src/specs/server/api/search.e2e-spec.ts`
Expected: All tests PASS (requires dev stack running via `make e2e`)

**Step 3: Commit**

```
test(e2e): add tests for withSharedSpaces search suggestions
```
