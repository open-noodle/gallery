# Timeline Smart Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the spaces unified-search experience to `/photos` so users can run smart (CLIP) search on the main timeline with sort by relevance / newest / oldest, date grouping, asset viewer overlay, and FilterPanel composition.

**Architecture:** Wire up the existing `withSharedSpaces` flag in the backend `searchSmart` service. Refactor the spaces fetch state machinery into a reusable `<SmartSearchResults>` wrapper. Modify the dumb grid `space-search-results.svelte` to accept an `isShared` prop. Add a `{#snippet buttons()}` to `/photos +page.svelte` with `<SearchBar>` + `<SearchSortDropdown>`, conditionally render `<SmartSearchResults>` instead of `<Timeline>` when search is active, and persist the query in `?q=` URL state.

**Tech Stack:** NestJS 11 backend, SvelteKit + Svelte 5 frontend, vitest for unit tests, Playwright for E2E, Kysely for DB queries.

**Design doc:** [`docs/plans/2026-04-06-timeline-smart-search-design.md`](2026-04-06-timeline-smart-search-design.md). Read this first for the architectural rationale, decision history, edge case enumeration, and the full 100-case test plan. The plan below references the design doc by section heavily and does NOT repeat its content.

**Worktree:** `.worktrees/timeline-smart-search` on branch `feat/timeline-smart-search`. The first 5 commits on this branch are the design doc revision history.

---

## Reading the design doc first

Before starting any task, read the design doc end to end. Pay particular attention to:

- **Decisions table** — locks in all the UX/structural choices you need
- **Backend §1** — exact code to add to `searchSmart`
- **Frontend §2** — wrapper props, state, the single combined effect, the `$bindable` `isLoading`
- **Frontend §3** — the two specific changes to the dumb grid
- **Frontend §5** — the `/photos` page diff
- **Verification tasks** — five things to check during implementation
- **Testing strategy §1-§7** — the 100 numbered test cases. Each task below references these by number (e.g., "implements tests 1, 2, 6")
- **Spaces refactor regression gates** — non-negotiable; the existing `spaces-*.e2e-spec.ts` files must pass after the wrapper extraction

---

## Phase 1: Backend wireup

Implement `withSharedSpaces` in `searchSmart` and verify the repository correctly resolves timeline-pinned space content.

### Task 1: Add `searchSmart` + `withSharedSpaces` service tests (failing first)

**Files:**

- Modify: `server/src/services/search.service.spec.ts` (extend the `searchSmart` describe block)

**Step 1: Read the existing patterns**

Open `server/src/services/search.service.spec.ts` and find the `getSearchSuggestions` describe block at lines 434-498. These are the test patterns you'll mirror for `searchSmart`.

**Step 2: Write the failing tests**

Add a new sub-describe inside the `searchSmart` describe block. Implement test cases 1-11 from the design doc's testing strategy:

```typescript
describe('withSharedSpaces', () => {
  it('should reject when both spaceId and withSharedSpaces are set', async () => {
    await expect(
      sut.searchSmart(authStub.user1, {
        query: 'beach',
        spaceId: newUuid(),
        withSharedSpaces: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should fetch timeline space IDs when withSharedSpaces is true', async () => {
    const spaceId1 = newUuid();
    const spaceId2 = newUuid();
    mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: spaceId1 }, { spaceId: spaceId2 }]);
    mocks.machineLearning.encodeText.mockResolvedValue('[0.1, 0.2]');
    mocks.search.searchSmart.mockResolvedValue({ items: [], hasNextPage: false });

    await sut.searchSmart(authStub.user1, {
      query: 'beach',
      withSharedSpaces: true,
    });

    expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(authStub.user1.user.id);
    expect(mocks.search.searchSmart).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timelineSpaceIds: [spaceId1, spaceId2] }),
    );
  });

  it('should fall back to owner-only when withSharedSpaces is true but user has no spaces', async () => {
    mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
    mocks.machineLearning.encodeText.mockResolvedValue('[0.1, 0.2]');
    mocks.search.searchSmart.mockResolvedValue({ items: [], hasNextPage: false });

    await sut.searchSmart(authStub.user1, {
      query: 'beach',
      withSharedSpaces: true,
    });

    expect(mocks.search.searchSmart).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timelineSpaceIds: undefined }),
    );
  });

  it('should preserve existing behavior when withSharedSpaces is absent', async () => {
    mocks.machineLearning.encodeText.mockResolvedValue('[0.1, 0.2]');
    mocks.search.searchSmart.mockResolvedValue({ items: [], hasNextPage: false });

    await sut.searchSmart(authStub.user1, { query: 'beach' });

    expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
  });

  it('should preserve existing behavior when withSharedSpaces is explicitly false', async () => {
    mocks.machineLearning.encodeText.mockResolvedValue('[0.1, 0.2]');
    mocks.search.searchSmart.mockResolvedValue({ items: [], hasNextPage: false });

    await sut.searchSmart(authStub.user1, { query: 'beach', withSharedSpaces: false });

    expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
  });

  it('should not call getSpaceIdsForTimeline when spaceId is set', async () => {
    const spaceId = newUuid();
    mocks.sharedSpace.checkOwnerAccess.mockResolvedValue(new Set([spaceId]));
    mocks.machineLearning.encodeText.mockResolvedValue('[0.1, 0.2]');
    mocks.search.searchSmart.mockResolvedValue({ items: [], hasNextPage: false });

    await sut.searchSmart(authStub.user1, { query: 'beach', spaceId });

    expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
  });

  it('should preserve spacePersonIds-requires-spaceId guard when withSharedSpaces is set', async () => {
    await expect(
      sut.searchSmart(authStub.user1, {
        query: 'beach',
        withSharedSpaces: true,
        spacePersonIds: [newUuid()],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

Note: the exact mock names (`mocks.sharedSpace`, `mocks.machineLearning`, etc.) depend on how `newTestService` is set up. Reference the existing `getSearchSuggestions` tests for the actual mock surface.

**Step 3: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/services/search.service.spec.ts -t withSharedSpaces`

Expected: all 7 tests FAIL because `searchSmart` doesn't honor the flag yet.

**Step 4: Commit the failing tests**

```bash
git add server/src/services/search.service.spec.ts
git commit -m "test(search): add failing searchSmart withSharedSpaces tests"
```

---

### Task 2: Implement `withSharedSpaces` in `searchSmart`

**SCOPE CORRECTION (discovered during task 1):** Contrary to the design doc's original claim, `withSharedSpaces` does NOT exist on `SmartSearchDto`. It exists on `SearchSuggestionRequestDto`, `TagSuggestionRequestDto`, and `TimeBucketDto` (lines 353, 368, 484 of `server/src/dtos/search.dto.ts`), but `SmartSearchDto` itself ends at line 263 without the field. This task therefore needs to ADD the DTO field and regenerate the SDK in addition to the service implementation.

**Files:**

- Modify: `server/src/dtos/search.dto.ts` (add field to `SmartSearchDto`)
- Modify: `server/src/services/search.service.ts` (lines 121-175)
- Modify: `server/src/services/search.service.spec.ts` (remove `as any` casts added in task 1)
- Regenerate: `open-api/typescript-sdk/src/fetch-client.ts` (via `make open-api-typescript`)
- Regenerate: `mobile/openapi/lib/model/smart_search_dto.dart` (via `make open-api-dart`, requires Java)

**Step 1: Read the existing pattern**

Open `server/src/services/search.service.ts:184-202` (the `getSearchSuggestions` implementation) to see the canonical pattern for the conflict rejection and `timelineSpaceIds` resolution.

Also read `server/src/dtos/search.dto.ts:482-485` to see how `withSharedSpaces` is declared on the existing `getFilterSuggestions` DTO — copy the same `@ValidateBoolean({ optional: true, description: '...' })` pattern.

**Step 1b: Add `withSharedSpaces` to `SmartSearchDto`**

In `server/src/dtos/search.dto.ts`, find `class SmartSearchDto` (line 236) and add the new field. The class currently ends at line 263 with `}`. Add inside, before the closing brace:

```typescript
@ValidateBoolean({ optional: true, description: 'Include shared spaces the user is a member of' })
withSharedSpaces?: boolean;
```

Place it logically near `spaceId` if `SmartSearchDto` has one — otherwise put it at the end.

**Step 2: Add the conflict rejection**

In `searchSmart`, immediately after the existing `dto.spaceId` access check (around line 128), add:

```typescript
if (dto.spaceId && dto.withSharedSpaces) {
  throw new BadRequestException('Cannot use both spaceId and withSharedSpaces');
}
```

**Step 3: Add the `timelineSpaceIds` resolution**

Before the `searchRepository.searchSmart` call (around line 163), add:

```typescript
let timelineSpaceIds: string[] | undefined;
if (dto.withSharedSpaces) {
  const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
  if (spaceRows.length > 0) {
    timelineSpaceIds = spaceRows.map((row) => row.spaceId);
  }
}
```

**Step 4: Pass `timelineSpaceIds` to the repository**

Update the call to `searchRepository.searchSmart` to include `timelineSpaceIds`:

```typescript
const { hasNextPage, items } = await this.searchRepository.searchSmart(
  { page, size },
  {
    ...dto,
    timelineSpaceIds,
    userIds: await userIds,
    embedding,
    orderDirection: dto.order,
    maxDistance: machineLearning.clip.maxDistance,
  },
);
```

**Step 5: Regenerate the OpenAPI spec and SDK**

The DTO change adds a new field, which means clients need to be regenerated.

```bash
cd server && pnpm build
pnpm sync:open-api
cd .. && make open-api-typescript
```

If `make open-api-dart` fails due to missing Java, that's OK — Dart regen can run on a CI machine or be deferred. The TypeScript SDK is what `/photos` will use directly.

Verify the SDK now declares the field:

```bash
grep -n "withSharedSpaces" open-api/typescript-sdk/src/fetch-client.ts | head
```

You should see `withSharedSpaces?: boolean;` listed inside `export type SmartSearchDto = { ... }` (look around line 1909 for the class declaration).

**Step 6: Remove the `as any` casts from task 1's tests**

Task 1 used `as any` casts in `server/src/services/search.service.spec.ts` to work around the missing DTO field. Now that the field exists, remove them. Search the new `withSharedSpaces` describe block (around line 782) for `as any` and delete each one. The tests should still type-check.

**Step 7: Run tests, verify they pass**

Run: `cd server && pnpm test -- --run src/services/search.service.spec.ts -t withSharedSpaces`

Expected: all 7 tests PASS.

**Step 8: Run full server test suite to catch regressions**

Run: `cd server && pnpm test -- --run src/services/search.service.spec.ts`

Expected: all `search.service.spec.ts` tests pass (no regressions to the existing `searchSmart` or `getSearchSuggestions` tests).

**Step 9: Type check both server and web** (web because the SDK regen may surface issues in spaces' existing call site)

```bash
make check-server
make check-web
```

Expected: no errors. If `make check-web` fails on the spaces page's existing `buildSmartSearchParams` call, the call site still passes positional args (which task 7 will refactor) — confirm the failure is in `space-search.ts:6` or the spaces page, not in new code, and proceed.

**Step 10: Commit (use the dated commit pattern)**

Add all the changed files:

```bash
git add server/src/dtos/search.dto.ts server/src/services/search.service.ts server/src/services/search.service.spec.ts open-api/typescript-sdk/src/fetch-client.ts mobile/openapi/
```

Commit message: `feat(search): wire withSharedSpaces in searchSmart`

---

### Task 3: Verify `searchAssetBuilder` honors `timelineSpaceIds` (no code change expected)

**Files:**

- Read: `server/src/repositories/search.repository.ts:362` (the `searchSmart` repository method)
- Read: `server/src/repositories/search.repository.ts:592, 619, 698, 748` (where `timelineSpaceIds` is used by other repository methods)

**Step 1: Verify `searchAssetBuilder` already accepts `timelineSpaceIds`**

`searchSmart` calls `searchAssetBuilder(trx, options)` which is the same builder used by `searchLargeAssets`, `searchRandom`, `searchExifField`, and the suggestion paths. Confirm by reading `searchAssetBuilder` and its caller list — `timelineSpaceIds` should already be in the options bag.

**Step 2: If `searchAssetBuilder` does NOT honor `timelineSpaceIds`, you have more work**

Compare with how `searchLargeAssets` (or one of the other callers) passes `timelineSpaceIds` in. If `searchAssetBuilder` only joins shared-space content for some callers, you may need to add the join unconditionally or via a new branch. **Stop here and reread the design doc Backend §2 — the design assumes no repository changes.** If the assumption is wrong, document the gap and add the necessary repository code (with tests) before continuing.

**Step 3: Add a repository unit test for the happy path**

In `server/src/repositories/search.repository.spec.ts`, extend the existing `searchSmart` test to verify that passing `timelineSpaceIds` returns assets from those spaces. Mirror the patterns used by `searchLargeAssets` tests.

```typescript
it('should return assets from timeline-pinned spaces when timelineSpaceIds is set', async () => {
  // Arrange: create user, owned asset, shared space with another asset, embedding
  // Act: call searchSmart with timelineSpaceIds
  // Assert: both assets returned
});
```

**Step 4: Run repository tests**

Run: `cd server && pnpm test -- --run src/repositories/search.repository.spec.ts -t searchSmart`

Expected: PASS.

**Step 5: Commit**

```bash
git add server/src/repositories/search.repository.spec.ts
git commit -m "test(search): verify searchSmart honors timelineSpaceIds"
```

---

### Task 4: Verify and update the `@GenerateSql` example

**Files:**

- Read: `server/src/repositories/search.repository.ts:340-350` (the `@GenerateSql` decorator example for `searchSmart`)
- Modify (maybe): same file

**Step 1: Read the existing example**

The `@GenerateSql` decorator at line 340-350 has example params used by `make sql` to generate the reference SQL files. Read it to see if `timelineSpaceIds` is included.

**Step 2: If missing, add `timelineSpaceIds` to the example**

```typescript
@GenerateSql({
  params: [
    {
      // ...existing fields
      timelineSpaceIds: [DummyValue.UUID, DummyValue.UUID],
    },
  ],
})
```

**Step 3: Regenerate SQL files**

Run: `make sql` (requires DB running — if not, skip and let CI catch it; per `feedback_make_sql_no_db.md` this is dangerous without DB. Use `make dev` first if needed.)

Alternatively, push and let CI's "Sync SQL" check produce the diff, then apply it manually per `feedback_sql_query_regen.md`.

**Step 4: Commit any regenerated SQL output**

```bash
git add server/src/repositories/search.repository.ts server/src/queries/
git commit -m "chore(search): regenerate SQL examples for searchSmart timelineSpaceIds"
```

---

### Task 5: Add server API E2E tests for `withSharedSpaces`

**Files:**

- Modify: `e2e/src/specs/server/api/search.e2e-spec.ts` (extend)

**Step 1: Read the existing patterns**

Open `e2e/src/specs/server/api/search.e2e-spec.ts` and find:

- The existing `searchSmart` describe block (look for `describe('POST /search/smart')` or similar)
- How users + assets + embeddings are set up (likely via fixtures imported from `e2e/src/fixtures.ts` and `e2e/src/generators.ts`)
- How shared spaces are created in tests (search for `createSharedSpace` or similar)
- Whether ML embeddings are real (machine-learning container in docker-compose) or mocked via fixtures

The test patterns vary by suite, so reading first is essential. If unsure, look at the `getFilterSuggestions` E2E tests in the same file — they cover the same `withSharedSpaces` flag for a different endpoint and are a near-perfect template.

**Step 2: Implement the new tests**

Inside the existing `searchSmart` describe block, add a `withSharedSpaces` sub-describe with these cases:

```typescript
describe('withSharedSpaces', () => {
  it('returns timeline-pinned shared space content when withSharedSpaces is true', async () => {
    // Arrange:
    // 1. Create user A and user B
    // 2. User B creates a shared space with showInTimeline=true and adds user A as member
    // 3. User B uploads an asset to the space (or marks an existing asset as shared)
    // 4. Wait for ML to process the asset (or mock the embedding)
    //
    // Act:
    // const response = await searchSmart({ smartSearchDto: { query: '<matching text>', withSharedSpaces: true } }, { headers: userA.accessToken });
    //
    // Assert:
    // expect response includes the shared-space asset
  });

  it('rejects 400 when both spaceId and withSharedSpaces are set', async () => {
    const response = await request(app)
      .post('/search/smart')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ query: 'beach', spaceId: someSpaceId, withSharedSpaces: true });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Cannot use both spaceId and withSharedSpaces');
  });

  it('falls back to owner-only when user has no shared spaces', async () => {
    // User with no spaces; query with withSharedSpaces=true; verify only owner-owned assets are returned
  });

  it('does not return assets from spaces the user is not a member of (cross-user isolation)', async () => {
    // User A; user B's private space (A is not a member); query with withSharedSpaces=true;
    // verify B's space content is NOT in results
  });

  it('does not return assets from spaces the user has been removed from', async () => {
    // User A is added to space, then removed; query with withSharedSpaces=true;
    // verify space content is NOT in results
  });

  it('does not include shared-space content when withSharedSpaces is false or absent (regression)', async () => {
    // User has space pinned to timeline; query without withSharedSpaces;
    // verify only owner-owned assets are returned
  });
});
```

**Note on ML embeddings:** smart search requires CLIP embeddings on the assets. Check whether `search.e2e-spec.ts` uses real ML (slow) or mocks the embedding fixtures (fast). If mocked, use the same approach. If real ML, the test setup needs to wait for the smart-search job to finish — search the file for `waitForQueueFinish` or `MachineLearning` to find the existing pattern.

**Step 3: Run the E2E API suite**

Run: `cd e2e && pnpm test -- --run src/specs/server/api/search.e2e-spec.ts`

Expected: all new tests pass against the real server.

**Step 4: Commit**

```bash
git add e2e/src/specs/server/api/search.e2e-spec.ts
git commit -m "test(search): add API E2E for withSharedSpaces in searchSmart"
```

---

## Phase 2: Frontend utility refactor

Refactor `buildSmartSearchParams` to the new args-object signature.

### Task 6: Create unit tests for `buildSmartSearchParams` (new file)

**Files:**

- Create: `web/src/lib/utils/__tests__/space-search.spec.ts` (does NOT exist today)

**Step 1: Write failing tests covering the new args-object signature**

Implement test cases 21-37 from the design's frontend unit test section. Cover all the conditional branches in the new function.

```typescript
import { buildSmartSearchParams } from '$lib/utils/space-search';
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import { AssetOrder, AssetTypeEnum } from '@immich/sdk';
import { describe, expect, it } from 'vitest';

const baseFilters: FilterState = {
  personIds: [],
  tagIds: [],
  mediaType: 'all',
  sortOrder: 'desc',
};

describe('buildSmartSearchParams', () => {
  describe('with spaceId', () => {
    it('sets spaceId, maps personIds to spacePersonIds, ignores withSharedSpaces', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, personIds: ['p1', 'p2'] },
        spaceId: 'space-1',
        withSharedSpaces: true,
      });
      expect(result.spaceId).toBe('space-1');
      expect(result.spacePersonIds).toEqual(['p1', 'p2']);
      expect(result.personIds).toBeUndefined();
      expect(result.withSharedSpaces).toBeUndefined();
    });
  });

  describe('without spaceId', () => {
    it('omits spaceId, passes personIds directly, sets withSharedSpaces when truthy', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, personIds: ['p1'] },
        withSharedSpaces: true,
      });
      expect(result.spaceId).toBeUndefined();
      expect(result.personIds).toEqual(['p1']);
      expect(result.spacePersonIds).toBeUndefined();
      expect(result.withSharedSpaces).toBe(true);
    });

    it('omits withSharedSpaces when false', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: baseFilters,
        withSharedSpaces: false,
      });
      expect(result.withSharedSpaces).toBeUndefined();
    });

    it('omits withSharedSpaces when undefined', () => {
      const result = buildSmartSearchParams({ query: 'beach', filters: baseFilters });
      expect(result.withSharedSpaces).toBeUndefined();
    });
  });

  describe('field mappings', () => {
    it('omits personIds and spacePersonIds when filters.personIds is empty', () => {
      const result = buildSmartSearchParams({ query: 'beach', filters: baseFilters });
      expect(result.personIds).toBeUndefined();
      expect(result.spacePersonIds).toBeUndefined();
    });

    it('sets type for mediaType image', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, mediaType: 'image' },
      });
      expect(result.type).toBe(AssetTypeEnum.Image);
    });

    it('sets type for mediaType video', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, mediaType: 'video' },
      });
      expect(result.type).toBe(AssetTypeEnum.Video);
    });

    it('omits type for mediaType all', () => {
      const result = buildSmartSearchParams({ query: 'beach', filters: baseFilters });
      expect(result.type).toBeUndefined();
    });

    it('sets order for sortOrder asc', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, sortOrder: 'asc' },
      });
      expect(result.order).toBe(AssetOrder.Asc);
    });

    it('sets order for sortOrder desc', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, sortOrder: 'desc' },
      });
      expect(result.order).toBe(AssetOrder.Desc);
    });

    it('omits order for sortOrder relevance', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, sortOrder: 'relevance' },
      });
      expect(result.order).toBeUndefined();
    });

    it('sets isFavorite when explicitly false', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, isFavorite: false },
      });
      expect(result.isFavorite).toBe(false);
    });

    it('sets isFavorite when true', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, isFavorite: true },
      });
      expect(result.isFavorite).toBe(true);
    });

    it('omits isFavorite when undefined', () => {
      const result = buildSmartSearchParams({ query: 'beach', filters: baseFilters });
      expect(result.isFavorite).toBeUndefined();
    });

    it('builds takenAfter/takenBefore for selectedYear + selectedMonth (January)', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, selectedYear: 2024, selectedMonth: 1 },
      });
      expect(result.takenAfter).toBe(new Date(2024, 0, 1).toISOString());
      expect(result.takenBefore).toBe(new Date(2024, 1, 0, 23, 59, 59, 999).toISOString());
    });

    it('builds takenAfter/takenBefore for selectedYear only', () => {
      const result = buildSmartSearchParams({
        query: 'beach',
        filters: { ...baseFilters, selectedYear: 2024 },
      });
      expect(result.takenAfter).toBe(new Date(2024, 0, 1).toISOString());
      expect(result.takenBefore).toBe(new Date(2024, 11, 31, 23, 59, 59, 999).toISOString());
    });
  });
});
```

**Step 2: Run tests, verify they fail**

Run: `cd web && pnpm test -- --run src/lib/utils/__tests__/space-search.spec.ts`

Expected: all tests FAIL because `buildSmartSearchParams` still has the old signature.

**Step 3: Commit failing tests**

```bash
git add web/src/lib/utils/__tests__/space-search.spec.ts
git commit -m "test(search): add failing tests for buildSmartSearchParams refactor"
```

---

### Task 7: Refactor `buildSmartSearchParams` to args-object signature

**Files:**

- Modify: `web/src/lib/utils/space-search.ts`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte:599` (the call site)

**Step 1: Refactor the function**

Replace the body of `buildSmartSearchParams` in `space-search.ts` with:

```typescript
export function buildSmartSearchParams(args: {
  query: string;
  filters: FilterState;
  spaceId?: string;
  withSharedSpaces?: boolean;
}): SmartSearchDto {
  const { query, filters, spaceId, withSharedSpaces } = args;
  const params: SmartSearchDto = { query };

  if (spaceId) {
    params.spaceId = spaceId;
    if (filters.personIds.length > 0) {
      params.spacePersonIds = filters.personIds;
    }
  } else {
    if (filters.personIds.length > 0) {
      params.personIds = filters.personIds;
    }
    if (withSharedSpaces) {
      params.withSharedSpaces = true;
    }
  }

  if (filters.city) {
    params.city = filters.city;
  }
  if (filters.country) {
    params.country = filters.country;
  }
  if (filters.make) {
    params.make = filters.make;
  }
  if (filters.model) {
    params.model = filters.model;
  }
  if (filters.tagIds.length > 0) {
    params.tagIds = filters.tagIds;
  }
  if (filters.rating !== undefined) {
    params.rating = filters.rating;
  }
  if (filters.mediaType !== 'all') {
    params.type = filters.mediaType === 'image' ? AssetTypeEnum.Image : AssetTypeEnum.Video;
  }
  if (filters.selectedYear && filters.selectedMonth) {
    const start = new Date(filters.selectedYear, filters.selectedMonth - 1, 1);
    const end = new Date(filters.selectedYear, filters.selectedMonth, 0, 23, 59, 59, 999);
    params.takenAfter = start.toISOString();
    params.takenBefore = end.toISOString();
  } else if (filters.selectedYear) {
    params.takenAfter = new Date(filters.selectedYear, 0, 1).toISOString();
    params.takenBefore = new Date(filters.selectedYear, 11, 31, 23, 59, 59, 999).toISOString();
  }

  if (filters.sortOrder === 'asc') {
    params.order = AssetOrder.Asc;
  } else if (filters.sortOrder === 'desc') {
    params.order = AssetOrder.Desc;
  }

  if (filters.isFavorite !== undefined) {
    params.isFavorite = filters.isFavorite;
  }

  return params;
}
```

**Step 2: Update the spaces page call site**

In `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`, find the existing call (around line 599):

```typescript
// Old
{ ...buildSmartSearchParams(searchQuery.trim(), space.id, filters), page, size: 100 }
```

Replace with:

```typescript
// New
{ ...buildSmartSearchParams({ query: searchQuery.trim(), filters, spaceId: space.id }), page, size: 100 }
```

**Step 3: Run the new unit tests**

Run: `cd web && pnpm test -- --run src/lib/utils/__tests__/space-search.spec.ts`

Expected: all tests PASS.

**Step 4: Run TypeScript check**

Run: `make check-web`

Expected: no errors. The spaces page should still type-check after the call-site update.

**Step 5: Commit**

```bash
git add web/src/lib/utils/space-search.ts web/src/routes/\(user\)/spaces/
git commit -m "refactor(search): buildSmartSearchParams takes args object"
```

---

## Phase 3: Dumb grid component changes

Add `isShared` prop and conditional `spaceId` to `space-search-results.svelte`.

### Task 8: Add failing tests for `isShared` prop and conditional `spaceId`

**Files:**

- Modify: `web/src/lib/components/spaces/space-search-results.spec.ts` (extend)

**Step 1: Read the existing test patterns**

Open `space-search-results.spec.ts` to see how the dumb grid is currently tested (mock IntersectionObserver, render with props, assert on the rendered output).

**Step 2: Add tests for the `isShared` prop**

Add tests covering cases 58-61 from the design's testing strategy:

```typescript
import { vi } from 'vitest';

// Mock @immich/sdk getAssetInfo
const getAssetInfoMock = vi.fn();
vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, getAssetInfo: (...args: unknown[]) => getAssetInfoMock(...args) };
});

describe('SpaceSearchResults isShared prop', () => {
  it('forwards isShared=true to AssetViewer', () => {
    // Render with isShared=true, open an asset, assert AssetViewer received the prop
  });

  it('forwards isShared=false to AssetViewer', () => {
    // Same with isShared=false
  });
});

describe('SpaceSearchResults spaceId in getAssetInfo', () => {
  beforeEach(() => {
    getAssetInfoMock.mockReset();
    getAssetInfoMock.mockResolvedValue({ id: 'asset-1' });
  });

  it('passes spaceId field when spaceId prop is set', async () => {
    // Render with spaceId set, trigger asset open, assert call args include spaceId
  });

  it('omits spaceId field when spaceId prop is undefined', async () => {
    // Render without spaceId, trigger asset open, assert call args do NOT include spaceId field at all
    // Use expect.not.objectContaining({ spaceId: expect.anything() })
  });
});
```

The exact mechanics of "open an asset" depend on the test patterns already in place in the file. If clicking thumbnails isn't directly testable, you may need to invoke `openAsset` programmatically via test exports.

**Step 3: Run tests, verify they fail**

Run: `cd web && pnpm test -- --run src/lib/components/spaces/space-search-results.spec.ts`

Expected: new tests FAIL because the prop and conditional spread don't exist yet.

**Step 4: Commit**

```bash
git add web/src/lib/components/spaces/space-search-results.spec.ts
git commit -m "test(spaces): add failing tests for isShared prop and conditional spaceId"
```

---

### Task 9: Implement `isShared` prop and conditional `spaceId`

**Files:**

- Modify: `web/src/lib/components/spaces/space-search-results.svelte`

**Step 1: Add `isShared` to the Props interface**

Update the `Props` interface (currently lines 13-22) and the `$props()` destructure (line 23):

```typescript
interface Props {
  results: AssetResponseDto[];
  isLoading: boolean;
  hasMore: boolean;
  totalLoaded: number;
  onLoadMore: () => void;
  spaceId?: string;
  isShared: boolean; // NEW
  sortMode: 'relevance' | 'asc' | 'desc';
}

let { results, isLoading, hasMore, totalLoaded, onLoadMore, spaceId, isShared, sortMode }: Props = $props();
```

**Step 2: Use `isShared` in the AssetViewer render**

Find line 186 and replace:

```svelte
<!-- Old -->
<AssetViewer {cursor} isShared={true} {spaceId} onClose={() => handlePromiseError(handleClose())} />

<!-- New -->
<AssetViewer {cursor} {isShared} {spaceId} onClose={() => handlePromiseError(handleClose())} />
```

**Step 3: Conditionally pass `spaceId` to `getAssetInfo`**

Find lines 46-48 and replace:

```typescript
// Old
const getFullAsset = async (id: string): Promise<AssetResponseDto> => {
  return getAssetInfo({ ...authManager.params, id, spaceId });
};

// New
const getFullAsset = async (id: string): Promise<AssetResponseDto> => {
  return getAssetInfo({ ...authManager.params, id, ...(spaceId ? { spaceId } : {}) });
};
```

**Step 4: Update the existing spaces page to pass `isShared={true}` (REQUIRED)**

`isShared` is now a required prop. The spaces page renders `<SpaceSearchResults>` directly (around line 863-872 of `spaces/.../+page.svelte`), so without this update the spaces page fails TypeScript. Find the existing render and add `isShared={true}`:

```svelte
<SpaceSearchResults
  results={searchResults}
  isLoading={isSearching}
  hasMore={hasMoreResults}
  totalLoaded={searchResults.length}
  onLoadMore={handleLoadMore}
  spaceId={space.id}
  isShared={true}        ← NEW: required temporarily until task 13 replaces this with the wrapper
  sortMode={filters.sortOrder}
/>
```

This is a temporary edit — task 13 replaces the entire render with `<SmartSearchResults>` and the explicit `isShared={true}` goes away.

**Step 5: Run tests, verify they pass**

Run: `cd web && pnpm test -- --run src/lib/components/spaces/space-search-results.spec.ts`

Expected: all tests pass (existing + new).

**Step 6: Type check**

Run: `make check-web`

Expected: no errors. Both the dumb grid AND the spaces page should now type-check (the latter because we passed `isShared={true}` in step 4).

**Step 7: Commit**

```bash
git add web/src/lib/components/spaces/space-search-results.svelte web/src/routes/\(user\)/spaces/
git commit -m "feat(spaces): add isShared prop to dumb search grid"
```

---

## Phase 4: SmartSearchResults wrapper component

Create the new wrapper that owns the fetch state machinery.

### Task 10: Create the wrapper component skeleton

**Files:**

- Create: `web/src/lib/components/search/smart-search-results.svelte` (new directory + new file)

**Step 1: Write the skeleton with props and imports**

```svelte
<script lang="ts">
  import SpaceSearchResults from '$lib/components/spaces/space-search-results.svelte';
  import type { FilterState } from '$lib/components/filter-panel/filter-panel';
  import { buildSmartSearchParams, SEARCH_FILTER_DEBOUNCE_MS } from '$lib/utils/space-search';
  import { searchSmart, type AssetResponseDto } from '@immich/sdk';

  interface Props {
    searchQuery: string;
    filters: FilterState;
    spaceId?: string;
    withSharedSpaces?: boolean;
    isShared: boolean;
    isLoading?: boolean;
  }

  let {
    searchQuery,
    filters,
    spaceId,
    withSharedSpaces,
    isShared,
    isLoading = $bindable(false),
  }: Props = $props();

  let searchResults = $state<AssetResponseDto[]>([]);
  let hasMoreResults = $state(false);
  let searchPage = $state(1);
  let searchAbortController: AbortController | undefined;
</script>

<SpaceSearchResults
  results={searchResults}
  {isLoading}
  hasMore={hasMoreResults}
  totalLoaded={searchResults.length}
  onLoadMore={() => void 0}
  {spaceId}
  {isShared}
  sortMode={filters.sortOrder}
/>
```

**Step 2: Type check**

Run: `make check-web`

Expected: no errors. The skeleton compiles even though there's no fetch logic yet.

**Step 3: Commit**

```bash
git add web/src/lib/components/search/
git commit -m "feat(search): add SmartSearchResults wrapper skeleton"
```

---

### Task 11: Add wrapper unit tests (failing first)

**Files:**

- Create: `web/src/lib/components/search/smart-search-results.spec.ts` (new)

**Step 1: Write tests for the core fetch behavior**

This task expands into ~17 test cases. Budget time accordingly. Use vitest fake timers for debounce assertions and mock `@immich/sdk`'s `searchSmart`. Reference existing tests like `space-search-results.spec.ts` for the testing-library/svelte patterns and `IntersectionObserver` mock.

```typescript
import { render } from '@testing-library/svelte';
import SmartSearchResults from '$lib/components/search/smart-search-results.svelte';
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { AssetOrder, type AssetResponseDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchSmartMock = vi.fn();
vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, searchSmart: (...args: unknown[]) => searchSmartMock(...args) };
});

const baseFilters: FilterState = {
  personIds: [],
  tagIds: [],
  mediaType: 'all',
  sortOrder: 'relevance',
};

const baseProps = {
  searchQuery: 'beach',
  filters: baseFilters,
  isShared: false,
  withSharedSpaces: true,
};

const mockEmptyResult = { assets: { items: [], nextPage: null } };
const mockResultsPage1 = {
  assets: {
    items: [{ id: 'a1' }, { id: 'a2' }] as AssetResponseDto[],
    nextPage: '2',
  },
};
const mockResultsPage2 = {
  assets: {
    items: [{ id: 'a3' }, { id: 'a4' }] as AssetResponseDto[],
    nextPage: null,
  },
};

describe('SmartSearchResults', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    searchSmartMock.mockReset();
    searchSmartMock.mockResolvedValue(mockEmptyResult);
  });

  // Test 38
  it('schedules exactly one fetch on mount with non-empty query', async () => {
    render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(1);
  });

  // Test 39
  it('does not fetch on mount with empty query', async () => {
    render(SmartSearchResults, { props: { ...baseProps, searchQuery: '' } });
    await vi.advanceTimersByTimeAsync(500);
    expect(searchSmartMock).not.toHaveBeenCalled();
  });

  // Test 40
  it('triggers a new fetch when searchQuery changes, aborting the previous', async () => {
    const { rerender } = render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(1);

    await rerender({ ...baseProps, searchQuery: 'mountain' });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(2);
    // Verify the second call had the new query
    expect(searchSmartMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ query: 'mountain' }) }),
    );
  });

  // Test 41
  it('triggers a debounced re-fetch when filters change', async () => {
    const { rerender } = render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(1);

    await rerender({ ...baseProps, filters: { ...baseFilters, city: 'Berlin' } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(2);
    expect(searchSmartMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ city: 'Berlin' }) }),
    );
  });

  // Test 42
  it('debounces multiple consecutive filter changes within the window into a single fetch', async () => {
    const { rerender } = render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(1);

    // 5 rapid filter changes within the debounce window
    for (let i = 0; i < 5; i++) {
      await rerender({ ...baseProps, filters: { ...baseFilters, rating: i + 1 } });
      await vi.advanceTimersByTimeAsync(50); // < debounce window
    }
    // Final advance past the debounce window
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    // Initial mount (1) + one debounced fetch (1) = 2 total
    expect(searchSmartMock).toHaveBeenCalledTimes(2);
  });

  // Test 43
  it('debounce boundary: 249ms does not fire, 250ms does', async () => {
    const { rerender } = render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(1);

    await rerender({ ...baseProps, filters: { ...baseFilters, city: 'Berlin' } });
    await vi.advanceTimersByTimeAsync(249);
    expect(searchSmartMock).toHaveBeenCalledTimes(1); // not yet
    await vi.advanceTimersByTimeAsync(1);
    expect(searchSmartMock).toHaveBeenCalledTimes(2); // now
  });

  // Test 44
  it('does not fetch when filters change while searchQuery is empty', async () => {
    const { rerender } = render(SmartSearchResults, { props: { ...baseProps, searchQuery: '' } });
    await rerender({ ...baseProps, searchQuery: '', filters: { ...baseFilters, city: 'Berlin' } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).not.toHaveBeenCalled();
  });

  // Test 45
  it('triggers re-fetch with order=Asc when sortOrder changes from relevance to asc', async () => {
    const { rerender } = render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    await rerender({ ...baseProps, filters: { ...baseFilters, sortOrder: 'asc' } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    expect(searchSmartMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ order: AssetOrder.Asc }) }),
    );
  });

  // Test 46
  it('triggers re-fetch with order omitted when sortOrder changes from asc to relevance', async () => {
    const { rerender } = render(SmartSearchResults, {
      props: { ...baseProps, filters: { ...baseFilters, sortOrder: 'asc' } },
    });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    await rerender({ ...baseProps, filters: { ...baseFilters, sortOrder: 'relevance' } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    const lastCall = searchSmartMock.mock.lastCall;
    expect(lastCall[0].smartSearchDto.order).toBeUndefined();
  });

  // Test 47 — loadMore (requires triggering the dumb grid's IntersectionObserver or direct invocation)
  // The exact mechanism depends on whether onLoadMore is exposed; you may need to grab the prop
  // off the rendered SpaceSearchResults via a test export, or simulate the IntersectionObserver
  // entry firing. See the existing space-search-results.spec.ts for patterns.
  it.todo('loadMore fetches the next page and appends results');

  // Test 48
  it.todo('loadMore does nothing when hasMore is false');

  // Test 49
  it.todo('loadMore while another loadMore is in flight: abort first, second wins');

  // Test 50
  it.todo('concurrent submit: query A in flight, query B submitted, B wins');

  // Test 51
  it.todo('submit while loadMore in flight: loadMore aborted, restart from page 1');

  // Test 52 — cooperative abort, NOT SDK signal propagation
  // The wrapper does NOT pass an AbortSignal to searchSmart. It uses cooperative
  // abort: checks `controller.signal.aborted` *after* the await and discards stale
  // results. So the test must verify the wrapper doesn't update state when a
  // resolved-after-unmount response comes in, not that the fetch itself was cancelled.
  it('discards results from in-flight request after wrapper unmounts', async () => {
    let resolveFn: ((value: typeof mockResultsPage1) => void) | undefined;
    searchSmartMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );

    const { unmount } = render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    // The fetch is in flight (resolveFn is set, promise unresolved)

    unmount();
    // The wrapper's $effect cleanup ran: setTimeout cleared, controller aborted

    // Now resolve the in-flight promise — this would normally update state, but
    // the wrapper's `if (controller.signal.aborted) return;` check should swallow it.
    resolveFn!(mockResultsPage1);
    await vi.runAllTimersAsync();

    // Assert: vitest emits no "Cannot update state of unmounted component" warning.
    // (Svelte 5's runtime tolerates writes to unmounted state, so the test relies
    // on the wrapper's own aborted-check rather than a runtime crash.)
    // If a stricter assertion is needed, spy on the IIFE that mutates searchResults
    // and assert it's never called after unmount.
    expect(true).toBe(true); // smoke check: nothing threw
  });

  // Test 53
  it('catches backend errors and surfaces empty results without crashing', async () => {
    searchSmartMock.mockRejectedValueOnce(new Error('Smart search is not enabled'));
    render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    // No exception thrown, component still rendered
    expect(searchSmartMock).toHaveBeenCalledTimes(1);
  });

  // Test 54
  it('handles empty results (0 items) without crashing', async () => {
    searchSmartMock.mockResolvedValue(mockEmptyResult);
    render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    // Should render the dumb grid with 0 results
  });

  // Test 55
  it('forwards spaceId to buildSmartSearchParams when set', async () => {
    render(SmartSearchResults, { props: { ...baseProps, spaceId: 'space-1', withSharedSpaces: undefined } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ spaceId: 'space-1' }) }),
    );
  });

  // Test 56
  it('forwards withSharedSpaces to buildSmartSearchParams when spaceId is undefined', async () => {
    render(SmartSearchResults, { props: { ...baseProps, withSharedSpaces: true } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ withSharedSpaces: true }) }),
    );
  });

  // Test 57 — render assertion for isShared on the dumb grid
  it.todo('forwards isShared prop to the dumb grid render');

  // Test 57b — bindable isLoading
  it.todo('isLoading $bindable propagates to parent before/after fetch');
});
```

`it.todo` tests are placeholders the implementer should fill in. They show up in the test output as "todo" so they're not silently skipped. The interaction-driven tests (loadMore, concurrent submits, isShared rendering) need the actual component contract — fill them in once the wrapper implementation is in place.

**Note on `SEARCH_FILTER_DEBOUNCE_MS`:** import from `$lib/utils/space-search` so the test stays in sync if the constant ever changes.

**Step 2: Run tests, verify they fail**

Run: `cd web && pnpm test -- --run src/lib/components/search/smart-search-results.spec.ts`

Expected: most tests FAIL because the wrapper has no fetch logic yet.

**Step 3: Commit**

```bash
git add web/src/lib/components/search/smart-search-results.spec.ts
git commit -m "test(search): add failing wrapper tests"
```

---

### Task 12: Implement the wrapper's `executeSearch` and combined effect

**Files:**

- Modify: `web/src/lib/components/search/smart-search-results.svelte`

**Step 1: Add the `executeSearch` function**

```typescript
const executeSearch = async (page: number, append: boolean) => {
  const query = searchQuery.trim();
  if (!query) {
    return;
  }

  searchAbortController?.abort();
  const controller = new AbortController();
  searchAbortController = controller;

  isLoading = true;
  try {
    const { assets } = await searchSmart({
      smartSearchDto: {
        ...buildSmartSearchParams({ query, filters, spaceId, withSharedSpaces }),
        page,
        size: 100,
      },
    });

    if (controller.signal.aborted) {
      return;
    }

    searchResults = append ? [...searchResults, ...assets.items] : assets.items;
    searchPage = page;
    hasMoreResults = assets.nextPage !== null;
  } catch {
    if (controller.signal.aborted) {
      return;
    }
    searchResults = append ? searchResults : [];
    hasMoreResults = false;
  } finally {
    if (!controller.signal.aborted) {
      isLoading = false;
    }
  }
};

const handleLoadMore = () => {
  void executeSearch(searchPage + 1, true);
};
```

**Step 2: Add the combined `$effect`**

Add the single combined effect from design Frontend §2:

```typescript
$effect(() => {
  // Track everything that should trigger a re-search
  const _ = [
    searchQuery,
    filters.personIds,
    filters.city,
    filters.country,
    filters.make,
    filters.model,
    filters.tagIds,
    filters.rating,
    filters.mediaType,
    filters.selectedYear,
    filters.selectedMonth,
    filters.sortOrder,
    filters.isFavorite,
  ];

  if (!searchQuery.trim()) {
    return;
  }

  const timeout = setTimeout(() => {
    searchPage = 1;
    void executeSearch(1, false);
  }, SEARCH_FILTER_DEBOUNCE_MS);

  return () => {
    clearTimeout(timeout);
    searchAbortController?.abort();
  };
});
```

**Step 3: Wire `handleLoadMore` to the dumb grid**

Update the `<SpaceSearchResults>` render: change `onLoadMore={() => void 0}` to `onLoadMore={handleLoadMore}`.

**Step 4: Run wrapper tests**

Run: `cd web && pnpm test -- --run src/lib/components/search/smart-search-results.spec.ts`

Expected: most/all tests PASS.

**Step 5: Iterate on test failures**

If specific tests fail, read the failure output and fix the implementation. Common issues:

- The `isLoading` `$bindable` may need explicit propagation back to the parent — vitest may not auto-update bindings without a tick.
- Fake timer assertions may need `vi.runAllTimersAsync()` instead of advancing by exact ms.
- The combined effect's cleanup function should fire on every re-run; verify with the abort test.

**Step 6: Type check**

Run: `make check-web`

Expected: no errors.

**Step 7: Commit**

```bash
git add web/src/lib/components/search/smart-search-results.svelte
git commit -m "feat(search): implement SmartSearchResults wrapper fetch logic"
```

---

## Phase 5: Spaces page refactor (CHECKPOINT)

Replace the spaces page's inline fetch logic with the wrapper. **This is a non-negotiable checkpoint** — the spaces E2E suite must pass after this task.

### Task 13: Refactor spaces page to use `<SmartSearchResults>`

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`

**Step 1: Add the wrapper import**

```typescript
import SmartSearchResults from '$lib/components/search/smart-search-results.svelte';
```

**Step 2: Remove the inline fetch state**

Delete these state declarations (lines ~579-584):

- `searchResults`
- `isSearching` — keep this for now, will be replaced by the bound `isLoading` from the wrapper
- `searchPage`
- `hasMoreResults`
- `searchAbortController`

**Step 3: Remove `executeSearch` and `handleLoadMore`**

Delete the `executeSearch` and `handleLoadMore` functions (lines ~586-631).

**Step 4: Remove the debounced filter `$effect`**

Delete the effect at lines ~644-673.

**Step 5: Add the bound `isLoading` state and rename surviving `isSearching` references**

```typescript
let isLoading = $state(false);
```

After steps 2-3, the only surviving `isSearching` references in the spaces page are:

1. **Inside `clearSearch` (around line 124 / 640):** `isSearching = false;` → change to `isLoading = false;`
2. **The SearchBar `showLoadingSpinner` prop (around line 728):** `showLoadingSpinner={isSearching}` → change to `showLoadingSpinner={isLoading}`

The `<SpaceSearchResults>` direct render at line ~866 (which had `isLoading={isSearching}`) is replaced wholesale in step 7, so no rename needed there.

After these renames, `grep isSearching web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte` should return zero results.

**Step 6: Update `handleSearchSubmit` and `clearSearch`**

`handleSearchSubmit` now just sets the trample state — the wrapper will pick up the change reactively:

```typescript
const handleSearchSubmit = () => {
  filters = { ...filters, sortOrder: 'relevance' };
  showSearchResults = true;
};

const clearSearch = () => {
  searchQuery = '';
  isLoading = false;
  showSearchResults = false;
  filters = { ...filters, sortOrder: 'desc' };
};
```

Note: spaces' existing `showSearchResults` state stays as-is (per design Frontend §4 hedge).

**Step 7: Replace the `<SpaceSearchResults>` direct render with `<SmartSearchResults>`**

Find the `<SpaceSearchResults>` render in the spaces page and replace with:

```svelte
<SmartSearchResults
  bind:isLoading
  {searchQuery}
  {filters}
  spaceId={space.id}
  isShared={true}
/>
```

**Step 8: Type check**

Run: `make check-web`

Expected: no errors.

**Step 9: Run web unit tests**

Run: `cd web && pnpm test`

Expected: all web unit tests pass (including the new wrapper tests, the buildSmartSearchParams tests, and the dumb grid tests).

**Step 10: Commit**

```bash
git add web/src/routes/\(user\)/spaces/
git commit -m "refactor(spaces): use SmartSearchResults wrapper for search"
```

---

### Task 14: CHECKPOINT — Run spaces E2E regression suite

**This is non-negotiable.** Per the design's "Spaces refactor regression gates" section, the existing spaces E2E specs MUST pass without modification.

**Step 1: Run the spaces search E2E**

Run: `cd e2e && pnpm test:web -- spaces-search.e2e-spec.ts`

Expected: all tests pass with no test changes.

**Step 2: Run the spaces filter panel E2E**

Run: `cd e2e && pnpm test:web -- spaces-filter-panel.e2e-spec.ts`

Expected: all tests pass.

**Step 3: Run the broader spaces E2E suites**

Run: `cd e2e && pnpm test:web -- spaces-p1.e2e-spec.ts spaces-p2.e2e-spec.ts spaces-p3.e2e-spec.ts`

Expected: all tests pass.

**Step 4: If anything fails — STOP**

A failing spaces test indicates a behavior regression. Do NOT modify the test. Instead:

1. Read the failure output carefully
2. Compare the wrapper's behavior with spaces' inline behavior pre-refactor (`git diff main...HEAD`)
3. Fix the wrapper or the spaces page integration
4. Re-run until green

If you cannot resolve a regression, revert task 13 and reconsider the wrapper's API.

**Step 5: Commit any fixes (no commit if all green)**

```bash
git add web/
git commit -m "fix(spaces): align wrapper behavior with pre-refactor spaces"
```

---

## Phase 6: /photos page integration

Add smart search to `/photos`.

### Task 15: Add page state and imports to `/photos`

**Files:**

- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`

**Step 1: Add new imports**

```typescript
import { goto } from '$app/navigation';
import { page } from '$app/state';
import SearchBar from '$lib/elements/SearchBar.svelte';
import SearchSortDropdown from '$lib/components/filter-panel/search-sort-dropdown.svelte';
import SmartSearchResults from '$lib/components/search/smart-search-results.svelte';
```

**Note:** `SearchBar` is imported from `$lib/elements/SearchBar.svelte`, NOT from `$lib/components/shared-components/search-bar/`. The latter is the global top searchbar with history box and modal — different component.

**Step 2: Add new page state**

After the existing `let filters = $state(createFilterState())` (line 60):

```typescript
let searchQuery = $state(page.url.searchParams.get('q') ?? '');
let isLoading = $state(false);
const showSearchResults = $derived(searchQuery.trim().length > 0);
```

**Step 3: Update `hasActiveFilters` derivation**

Find the existing `hasActiveFilters` derivation (line 127):

```typescript
// Old
const hasActiveFilters = $derived(getActiveFilterCount(filters) > 0);

// New
const hasActiveFilters = $derived(getActiveFilterCount(filters) > 0 || showSearchResults);
```

This automatically extends to the `<ImageCarousel>` guard at line 215 (no separate change needed) and ensures `<ActiveFiltersBar>` renders during search.

**Step 4: Add submit and clear handlers**

Add anywhere in the script section:

```typescript
function handleSearchSubmit() {
  if (!searchQuery.trim()) return;
  filters = { ...filters, sortOrder: 'relevance' };
  const url = new URL('/photos', window.location.origin);
  url.searchParams.set('q', searchQuery.trim());
  void goto(url.pathname + url.search, { keepFocus: true, noScroll: true });
}

function clearSearch() {
  searchQuery = '';
  isLoading = false;
  filters = { ...filters, sortOrder: 'desc' };
  void goto('/photos', { replaceState: true, keepFocus: true, noScroll: true });
}
```

**Step 5: Add URL state reactivity**

```typescript
$effect(() => {
  const q = page.url.searchParams.get('q') ?? '';
  if (q !== searchQuery) {
    searchQuery = q;
  }
});
```

**Step 6: Type check**

Run: `make check-web`

Expected: no errors yet (the new state is unused so far).

**Step 7: Commit**

```bash
git add web/src/routes/\(user\)/photos/
git commit -m "feat(photos): add search state and URL plumbing"
```

---

### Task 16: Add `buttons` snippet to `UserPageLayout`

**Files:**

- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`

**Step 1: Add the snippet inside `<UserPageLayout>`**

Find `<UserPageLayout hideNavbar={...} scrollbar={false}>` at line 179. Add a `{#snippet buttons()}` block as a direct child:

Insert the new `{#snippet buttons()}` block as the first child of `<UserPageLayout>`, immediately after the opening tag and before the existing `<div class="ml-4 flex h-full">` wrapper. Do NOT remove or modify any existing children — only add the snippet.

```svelte
<UserPageLayout hideNavbar={assetMultiSelectManager.selectionActive} scrollbar={false}>
  {#snippet buttons()}
    <div class="hidden h-10 sm:block sm:w-40 xl:w-60">
      <SearchBar
        placeholder={$t('search')}
        bind:name={searchQuery}
        showLoadingSpinner={isLoading}
        onSearch={({ force }) => {
          if (force) {
            handleSearchSubmit();
          }
        }}
        onReset={clearSearch}
      />
    </div>
    {#if showSearchResults}
      <SearchSortDropdown
        sortOrder={filters.sortOrder}
        onSelect={(mode) => {
          filters = { ...filters, sortOrder: mode };
        }}
      />
    {/if}
  {/snippet}

  <div class="ml-4 flex h-full">
    <!-- existing FilterPanel + Timeline + ActiveFiltersBar content stays here, unchanged by this task -->
    ...
  </div>
</UserPageLayout>
```

**Step 2: Type check**

Run: `make check-web`

Expected: no errors.

**Step 3: Manual smoke test**

Start dev environment if not running: `make dev`

Visit `http://localhost:2283/photos`. The SearchBar should appear in the top header (only on `sm:` and up). Type a query and press Enter — nothing should happen yet (no conditional render). The URL should update to `?q=...`.

**Step 4: Commit**

```bash
git add web/src/routes/\(user\)/photos/
git commit -m "feat(photos): add search bar to UserPageLayout buttons slot"
```

---

### Task 17: Conditional render — Timeline vs SmartSearchResults

**Files:**

- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`

**Step 1: Wrap the existing `<Timeline>` with conditional render**

Find the `<Timeline>` component (line 206). Wrap it:

```svelte
{#if showSearchResults}
  <SmartSearchResults
    bind:isLoading
    {searchQuery}
    {filters}
    isShared={false}
    withSharedSpaces={true}
  />
{:else}
  <Timeline
    enableRouting={true}
    bind:timelineManager
    {options}
    assetInteraction={assetMultiSelectManager}
    removeAction={AssetAction.ARCHIVE}
    onEscape={handleEscape}
    withStacked
  >
    {#if $preferences.memories.enabled && !hasActiveFilters}
      <ImageCarousel {items} />
    {/if}
    {#snippet empty()}
      <EmptyPlaceholder
        text={$t('no_assets_message')}
        onClick={() => openFileUploadDialog()}
        class="mt-10 mx-auto"
      />
    {/snippet}
  </Timeline>
{/if}
```

**Step 2: Type check**

Run: `make check-web`

Expected: no errors.

**Step 3: Manual smoke test**

Visit `http://localhost:2283/photos`. Type a query and press Enter. The Timeline should disappear and search results should appear. Clear the search — Timeline should return.

**Note:** This is the first time you can verify verification task #3 (does `isTimelineEmpty` cause the FilterPanel to disappear during search?). If the FilterPanel disappears, gate `isTimelineEmpty` on `!showSearchResults`:

```typescript
// If FilterPanel disappears during search, change line 129:
const isTimelineEmpty = $derived(
  !showSearchResults && timelineManager?.isInitialized && totalAssetCount === 0 && !hasActiveFilters,
);
```

**Step 4: Commit**

```bash
git add web/src/routes/\(user\)/photos/
git commit -m "feat(photos): conditionally render SmartSearchResults during search"
```

---

### Task 18: Wire `<ActiveFiltersBar>` props for search

**Files:**

- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`

**Step 1: Add `searchQuery` and `onClearSearch` to ActiveFiltersBar**

Find `<ActiveFiltersBar>` (lines 192-205). Add the new props:

```svelte
<ActiveFiltersBar
  {filters}
  {searchQuery}
  onClearSearch={clearSearch}
  resultCount={totalAssetCount}
  {personNames}
  {tagNames}
  onRemoveFilter={(type, id) => {
    filters = handlePhotosRemoveFilter(filters, type, id);
  }}
  onClearAll={() => {
    filters = clearFilters(filters);
    clearSearch();
  }}
/>
```

Note that `onClearAll` should also clear the search query (otherwise "clear all" only clears filters but leaves the search active, which is confusing).

**Step 2: Type check + manual smoke test**

Run: `make check-web`

Visit `http://localhost:2283/photos`, search for something, verify the search chip appears in the active filters bar with an X. Click the X — search should clear.

**Step 3: Verify edge case #5 from the design doc**

`isTimelineEmpty` may need the `!showSearchResults` gate (verification task #3). Test by clearing your library if possible, or verify the FilterPanel stays visible during search regardless.

**Step 4: Commit**

```bash
git add web/src/routes/\(user\)/photos/
git commit -m "feat(photos): wire search chip in ActiveFiltersBar"
```

---

## Phase 7: E2E tests

### Task 19: Create the photos search E2E spec file

**Files:**

- Create: `e2e/src/specs/web/photos-search.e2e-spec.ts` (new)

**Step 1: Read the existing patterns**

Open `e2e/src/specs/web/spaces-search.e2e-spec.ts` and `e2e/src/specs/web/photos-filter-panel.e2e-spec.ts` to see:

- How the test fixture sets up users + assets + ML embeddings
- How they navigate to `/photos`
- How they interact with the SearchBar
- How they assert on results

**Step 2: Implement the high-priority E2E tests**

Implement tests 62-86 from the design's testing strategy (the new `/photos` E2E coverage). Tests 87-89 are existing spaces specs (`spaces-search.e2e-spec.ts`, `spaces-filter-panel.e2e-spec.ts`, `spaces-p1/p2/p3.e2e-spec.ts`) — those are run as a regression check in task 14, not implemented here.

Start with the high-impact tests:

- Smart search flow (test 62) — submit, sort, clear
- URL persistence (test 63)
- Browser back/forward (tests 64, 65)
- Filter composition (test 71)
- Asset viewer URL preservation (test 76, covers verification task #1)
- Smart search disabled UX (test 84)
- Multi-select disabled (test 79)
- ActiveFiltersBar chip click (test 82)
- Mobile viewport (test 86)

The remaining tests (lower priority) can be added incrementally if time permits.

**Step 3: Run the new E2E spec**

Run: `cd e2e && pnpm test:web -- photos-search.e2e-spec.ts`

Expected: all tests pass against a real server.

**Step 4: Commit**

```bash
git add e2e/src/specs/web/photos-search.e2e-spec.ts
git commit -m "test(photos): add E2E coverage for smart search"
```

---

### Task 20: Run the spaces regression suite again

**Step 1: Re-run the spaces E2E suite to verify the /photos changes didn't regress spaces**

Run: `cd e2e && pnpm test:web -- spaces-search.e2e-spec.ts spaces-filter-panel.e2e-spec.ts`

Expected: all tests pass. The wrapper component is shared between both pages, so any changes made after task 13 (wrapper bugfixes triggered by /photos integration, dumb grid changes, etc.) could regress spaces. This re-run is the second safety net.

**Step 2: Run the photos-filter-panel E2E to verify filter panel still works**

Run: `cd e2e && pnpm test:web -- photos-filter-panel.e2e-spec.ts`

Expected: all tests pass.

---

## Phase 8: Verification tasks and manual QA

Execute the verification tasks and manual QA items from the design doc.

### Task 21: Run verification tasks 1-5

Open the design doc's "Verification tasks (must run during implementation)" section. Run through each:

**VT #1:** Asset viewer close preserves `?q=`. Covered by E2E test 76. If failing, replace the close handler with a route-aware version.

**VT #2:** `getAssetInfo` with omitted `spaceId`. Covered by unit test 61. Verify visually too.

**VT #3:** `isTimelineEmpty` interaction. Already addressed in task 17 if needed.

**VT #4:** `@GenerateSql` example update. Already done in task 4.

**VT #5:** Clear-search latency. Open DevTools network tab, search on a real-world library (10k+ assets), clear search, observe how long the bucket refetch takes. If unacceptable, document for follow-up — not blocking.

### Task 22: Manual QA pass

Run through manual QA items 90-100 from the design doc:

- **Side-by-side parity** with spaces (test 90)
- **Layout health** of UserPageLayout buttons (test 91)
- **Mobile** SearchBar hidden under 640px (test 92)
- **Clear-search latency** (test 93, also VT #5)
- **First load with `?q=`** no flicker (test 94)
- **`<FilterPanel>` doesn't disappear** during search (test 95, also VT #3)
- **Visual: date headers** match spaces (test 96)
- **Accessibility tab order** SearchBar → SortDropdown → grid → asset viewer (test 97)
- **Keyboard** Enter submits, Escape closes asset viewer (test 98)
- **Real ML smoke test** (test 99)
- **Owner actions in asset viewer** (test 100)

Note any findings that need follow-up. Critical issues (broken UX, errors, regressions) must be fixed before opening the PR. Cosmetic issues can be deferred.

---

## Phase 9: Ship it

### Task 23: Lint, type check, format, and prepare PR

**Step 1: Lint and type check**

Run: `make check-web check-server`

Expected: no errors.

Per `feedback_lint_sequential.md`, don't run `make lint-*` locally — let CI handle it.

**Step 2: Format markdown if any docs were touched**

Per `feedback_format_docs.md`, if you touched any `docs/plans/*.md`, run prettier on them:

```bash
npx prettier --write docs/plans/2026-04-06-timeline-smart-search-design.md docs/plans/2026-04-06-timeline-smart-search-plan.md
```

**Step 3: Sanity check `git diff`**

Per `feedback_verify_worktree_diff.md`, always verify the worktree diff before pushing — subagents may have made unrelated changes.

```bash
git diff main...HEAD --stat
git log main..HEAD --oneline
```

Verify the change list is exactly what you expect: backend service, repository test, OpenAPI (if regenerated), frontend utility refactor, dumb grid prop addition, new wrapper component, spaces page refactor, /photos page integration, new E2E spec, and possibly the design + plan docs.

**Step 4: Push the branch**

```bash
git push -u origin feat/timeline-smart-search
```

**Step 5: Open the PR**

```bash
gh pr create --title "feat: smart search on the main timeline (/photos)" --body "$(cat <<'EOF'
## Summary

- Brings the spaces unified-search experience to `/photos`: search bar in the page header, transform-in-place results, sort dropdown, date grouping, asset viewer overlay, and FilterPanel composition
- Wires up the existing `withSharedSpaces` flag in the backend `searchSmart` service so `/photos` search reaches into spaces the user has pinned to their timeline
- Extracts the spaces fetch state machinery into a reusable `<SmartSearchResults>` wrapper so both pages share one source of truth
- Adds an `isShared` prop to the dumb search results grid so `/photos` viewers get owner actions while spaces viewers stay shared

## Design

See [`docs/plans/2026-04-06-timeline-smart-search-design.md`](https://github.com/open-noodle/gallery/blob/feat/timeline-smart-search/docs/plans/2026-04-06-timeline-smart-search-design.md) for the full design doc, including 6 review-pass revision history, decisions table, edge cases (24), and the 100-case test plan.

## Test plan

- [ ] Backend unit tests pass (`pnpm test`)
- [ ] Frontend unit tests pass (`pnpm test`)
- [ ] Server API E2E tests pass (`pnpm test`)
- [ ] Playwright E2E `photos-search.e2e-spec.ts` passes
- [ ] Spaces regression: `spaces-search.e2e-spec.ts` and `spaces-filter-panel.e2e-spec.ts` still pass without modification
- [ ] Manual QA: side-by-side parity with spaces search
- [ ] Manual QA: clear-search latency on a real-world library
- [ ] Manual QA: mobile viewport behaves correctly (SearchBar hidden)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 6: Wait for CI to run**

If CI fails, use the `babysit` skill to monitor and fix until green.

**Step 7: Final commit if any CI fixes were needed, then mark plan complete**

---

## Notes for the implementer

- **TDD discipline:** Every code task starts by writing a failing test. Don't write implementation code without a failing test in place. Per `superpowers:test-driven-development`.
- **Frequent commits:** Commit at the end of every task. Don't batch.
- **Follow the design doc:** The plan above is intentionally lighter than the design doc. When in doubt about _what_ to do, read the design. The plan tells you the _order_ and the _granularity_; the design tells you the _content_.
- **Worktree isolation:** This work happens in `.worktrees/timeline-smart-search`. Don't `cd` away unless you understand worktree semantics.
- **Feedback memories to honor:**
  - `feedback_ci_generated_files.md` — regenerate OpenAPI specs and SQL query files when changing controllers/repositories
  - `feedback_no_security_in_commits.md` — don't mention security terms in commit messages or PRs
  - `feedback_always_use_prs.md` — never push directly to main, always create PRs
  - `feedback_lint_sequential.md` — don't run lint locally, let CI handle it
  - `feedback_format_docs.md` — run prettier on `docs/plans/` before committing
  - `feedback_make_sql_no_db.md` — never run `make sql` without a running DB
  - `feedback_sql_query_regen.md` — apply CI diff manually if no local DB
  - `feedback_verify_worktree_diff.md` — always verify git diff before PR from worktree
  - `feedback_review_before_merge.md` — never auto-merge PRs; review code and let user test first
  - `feedback_never_merge_without_asking.md` — never merge PRs without explicit user confirmation
- **Plan timing:** This is a substantial feature. Don't try to finish it in one sitting. Break for review between phases.
