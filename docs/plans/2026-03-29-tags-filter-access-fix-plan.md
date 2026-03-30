# Tags Filter Access Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Tags filter show all tags present on assets the user can access, including
tags from library-linked shared space assets.

**Architecture:** New `GET /search/suggestions/tags` endpoint with a space-aware Kysely query
joining `tag` → `tag_asset` → `asset`, using the same `$if` branching pattern as `getExifField`.
Frontend updated to call this endpoint instead of `getAllTags()`, with temporal scoping support.

**Tech Stack:** NestJS, Kysely, Svelte 5, OpenAPI/oazapfts SDK generation

**Design doc:** `docs/plans/2026-03-29-tags-filter-access-fix-design.md`

---

### Task 1: Server — DTO definitions

**Files:**

- Modify: `server/src/dtos/search.dto.ts` (after `SearchSuggestionRequestDto`, around line 350)

**Step 1: Add `TagSuggestionRequestDto` and `TagSuggestionResponseDto`**

Add after the `SearchSuggestionRequestDto` class (around line 350):

```typescript
export class TagSuggestionRequestDto {
  @ValidateUUID({ optional: true, description: 'Scope suggestions to a specific shared space' })
  spaceId?: string;

  @ValidateDate({ optional: true, description: 'Filter suggestions by taken date (after)' })
  takenAfter?: Date;

  @ValidateDate({ optional: true, description: 'Filter suggestions by taken date (before)' })
  takenBefore?: Date;
}

export class TagSuggestionResponseDto {
  @ApiProperty({ description: 'Tag ID' })
  id!: string;

  @ApiProperty({ description: 'Tag value/name' })
  value!: string;
}
```

**Step 2: Run type check**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to these new DTOs.

**Step 3: Commit**

```bash
git add server/src/dtos/search.dto.ts
git commit -m "feat: add tag suggestion DTOs for accessible tags endpoint"
```

---

### Task 2: Server — Repository query

**Files:**

- Modify: `server/src/repositories/search.repository.ts` (add method after `getCameraLensModels`, around line 520)

**Step 1: Add `getAccessibleTags` method**

Add after the `getCameraLensModels` method, before the `private getExifField` method:

```typescript
@GenerateSql({ params: [[DummyValue.UUID]] })
async getAccessibleTags(
  userIds: string[],
  options?: SpaceScopeOptions,
): Promise<Array<{ id: string; value: string }>> {
  return this.db
    .selectFrom('tag')
    .select(['tag.id', 'tag.value'])
    .distinct()
    .innerJoin('tag_asset', 'tag.id', 'tag_asset.tagId')
    .innerJoin('asset', 'tag_asset.assetId', 'asset.id')
    .where('asset.visibility', '=', AssetVisibility.Timeline)
    .where('asset.deletedAt', 'is', null)
    .$if(!options?.spaceId, (qb) => qb.where('asset.ownerId', '=', anyUuid(userIds)))
    .$if(!!options?.spaceId, (qb) =>
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
    .$if(!!options?.takenAfter, (qb) => qb.where('asset.fileCreatedAt', '>=', options!.takenAfter!))
    .$if(!!options?.takenBefore, (qb) => qb.where('asset.fileCreatedAt', '<', options!.takenBefore!))
    .orderBy('tag.value')
    .execute();
}
```

Ensure `AssetVisibility` is imported (it should already be). Verify `anyUuid` and `asUuid` are
imported from `src/utils/database` (check existing imports at top of file).

**Step 2: Run type check**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add server/src/repositories/search.repository.ts
git commit -m "feat: add getAccessibleTags query with space/library access"
```

---

### Task 3: Server — Service method

**Files:**

- Modify: `server/src/services/search.service.ts` (add method after `getSearchSuggestions`)

**Step 1: Write the failing test**

Add to `server/src/services/search.service.spec.ts`, inside the main `describe` block:

```typescript
describe('getTagSuggestions', () => {
  it('should return accessible tags for personal timeline', async () => {
    const tags = [
      { id: 'tag-1', value: 'Vacation' },
      { id: 'tag-2', value: 'Family' },
    ];
    mocks.search.getAccessibleTags.mockResolvedValue(tags);

    const result = await sut.getTagSuggestions(authStub.user1, {});
    expect(result).toEqual(tags);
    expect(mocks.search.getAccessibleTags).toHaveBeenCalledWith([authStub.user1.user.id], {});
  });

  it('should include partner IDs in user search', async () => {
    mocks.partner.getAll.mockResolvedValue([{ sharedById: 'partner-1', sharedBy: { id: 'partner-1' } } as any]);
    mocks.search.getAccessibleTags.mockResolvedValue([]);

    await sut.getTagSuggestions(authStub.user1, {});
    expect(mocks.search.getAccessibleTags).toHaveBeenCalledWith(
      expect.arrayContaining([authStub.user1.user.id, 'partner-1']),
      {},
    );
  });

  it('should check space access when spaceId is provided', async () => {
    const spaceId = newUuid();
    mocks.access.sharedSpace.checkOwnerAccess.mockResolvedValue(new Set([spaceId]));
    mocks.search.getAccessibleTags.mockResolvedValue([]);

    await sut.getTagSuggestions(authStub.user1, { spaceId });
    expect(mocks.search.getAccessibleTags).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ spaceId }),
    );
  });

  it('should pass temporal options through', async () => {
    const takenAfter = new Date('2024-01-01');
    const takenBefore = new Date('2025-01-01');
    mocks.search.getAccessibleTags.mockResolvedValue([]);

    await sut.getTagSuggestions(authStub.user1, { takenAfter, takenBefore });
    expect(mocks.search.getAccessibleTags).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ takenAfter, takenBefore }),
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/search.service.spec.ts 2>&1 | tail -20`
Expected: FAIL — `sut.getTagSuggestions is not a function`

**Step 3: Implement the service method**

Add to `server/src/services/search.service.ts`, after the `getSearchSuggestions` method:

```typescript
async getTagSuggestions(auth: AuthDto, dto: TagSuggestionRequestDto): Promise<TagSuggestionResponseDto[]> {
  if (dto.spaceId) {
    await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
  }

  const userIds = await this.getUserIdsToSearch(auth);
  return this.searchRepository.getAccessibleTags(userIds, dto);
}
```

Add `TagSuggestionRequestDto` and `TagSuggestionResponseDto` to the imports from `src/dtos/search.dto`.

**Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/services/search.service.spec.ts 2>&1 | tail -20`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/services/search.service.ts server/src/services/search.service.spec.ts
git commit -m "feat: add getTagSuggestions service with space access check"
```

---

### Task 4: Server — Controller endpoint

**Files:**

- Modify: `server/src/controllers/search.controller.ts`

**Step 1: Add the endpoint**

Add after the existing `getSearchSuggestions` method (line ~146), before the closing brace of
the class:

```typescript
@Get('suggestions/tags')
@Authenticated({ permission: Permission.AssetRead })
@Endpoint({
  summary: 'Retrieve tag suggestions',
  description: 'Retrieve tags present on assets accessible to the user, with optional space and temporal scoping.',
  history: new HistoryBuilder().added('v1'),
})
getTagSuggestions(@Auth() auth: AuthDto, @Query() dto: TagSuggestionRequestDto): Promise<TagSuggestionResponseDto[]> {
  return this.service.getTagSuggestions(auth, dto);
}
```

Add `TagSuggestionRequestDto` and `TagSuggestionResponseDto` to the imports from `src/dtos/search.dto`.

**Step 2: Run type check**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add server/src/controllers/search.controller.ts
git commit -m "feat: add GET /search/suggestions/tags endpoint"
```

---

### Task 5: SDK regeneration

**Step 1: Build server and regenerate OpenAPI spec + TypeScript SDK**

Run from repo root:

```bash
cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api-typescript
```

**Step 2: Verify the new SDK function exists**

Run: `grep -n 'getTagSuggestions\|TagSuggestionResponseDto' open-api/typescript-sdk/src/fetch-client.ts | head -10`
Expected: Should show the generated `getTagSuggestions` function and `TagSuggestionResponseDto` type.

**Step 3: Regenerate SQL query docs**

Run from repo root (requires running DB):

```bash
make sql
```

If the DB is not running, skip this step — CI will catch it.

**Step 4: Commit**

```bash
git add open-api/ server/src/queries/
git commit -m "chore: regenerate OpenAPI SDK and SQL query docs"
```

---

### Task 6: Frontend — Update FilterPanelConfig type and re-fetch logic

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.ts` (line 32)
- Modify: `web/src/lib/components/filter-panel/filter-panel.svelte` (lines 128-171 and 286-292)

**Step 1: Update the type signature**

In `filter-panel.ts`, change line 32:

```typescript
// Before
tags?: () => Promise<TagOption[]>;

// After
tags?: (context?: FilterContext) => Promise<TagOption[]>;
```

**Step 2: Update the mount `$effect` to pass context**

In `filter-panel.svelte`, change the tags mount effect (lines 286-292):

```typescript
// Before
$effect(() => {
  if (config.providers.tags && config.sections.includes('tags')) {
    void config.providers.tags().then((result) => {
      tags = result;
    });
  }
});

// After — pass undefined context on initial load (same as other providers)
$effect(() => {
  if (config.providers.tags && config.sections.includes('tags')) {
    void config.providers.tags().then((result) => {
      tags = result;
    });
  }
});
```

No actual change needed here — calling with no args when the signature is `(context?: ...)` is
fine. The initial load stays as-is.

**Step 3: Add tags to the debounced re-fetch block**

In `filter-panel.svelte`, inside the `setTimeout` callback (around line 128-171), add a tags
re-fetch block after the cameras block:

```typescript
if (providers.tags && sections.includes('tags')) {
  promises.push(
    providers
      .tags(currentContext)
      .then((result) => {
        if (!controller.signal.aborted) {
          tags = result;
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to re-fetch tags:', error);
      }),
  );
}
```

Add this after the cameras block (ending ~line 171), before the `Promise.allSettled` call.

**Step 4: Run type check**

Run: `cd web && npx svelte-check 2>&1 | tail -20`
Expected: No errors.

**Step 5: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-panel.ts web/src/lib/components/filter-panel/filter-panel.svelte
git commit -m "feat: add temporal re-fetch support for tags filter"
```

---

### Task 7: Frontend — Update filter configs to use new endpoint

**Files:**

- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte` (lines 119-126)
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte` (lines 224-231)
- Modify: `web/src/lib/utils/map-filter-config.ts` (lines 43, 74)

**Step 1: Update photos page**

In `photos/+page.svelte`, replace the tags provider (lines ~119-126):

```typescript
// Before
tags: async () => {
  const tags = await getAllTags();
  for (const t of tags) {
    tagNames.set(t.id, t.value);
  }
  return tags.map((t) => ({ id: t.id, name: t.value }));
},

// After
tags: async (context?: FilterContext) => {
  const tags = await getTagSuggestions({
    takenAfter: context?.takenAfter,
    takenBefore: context?.takenBefore,
  });
  for (const t of tags) {
    tagNames.set(t.id, t.value);
  }
  return tags.map((t) => ({ id: t.id, name: t.value }));
},
```

Update the import: replace `getAllTags` with `getTagSuggestions` in the SDK import line. Also
import `FilterContext` from the filter-panel types if not already imported.

**Step 2: Update spaces page**

In `spaces/[spaceId]/.../+page.svelte`, replace the tags provider (lines ~224-231):

```typescript
// Before
tags: async () => {
  const tags = await getAllTags();
  for (const t of tags) {
    tagNames.set(t.id, t.value);
  }
  return tags.map((t) => ({ id: t.id, name: t.value }));
},

// After
tags: async (context?: FilterContext) => {
  const tags = await getTagSuggestions({
    spaceId: space.id,
    takenAfter: context?.takenAfter,
    takenBefore: context?.takenBefore,
  });
  for (const t of tags) {
    tagNames.set(t.id, t.value);
  }
  return tags.map((t) => ({ id: t.id, name: t.value }));
},
```

Update the import: replace `getAllTags` with `getTagSuggestions`.

**Step 3: Update map filter config**

In `map-filter-config.ts`, update both tags providers (lines 43 and 74):

```typescript
// Space-scoped (line 43):
// Before
tags: () => getAllTags().then((tags) => tags.map((t) => ({ id: t.id, name: t.value }))),

// After
tags: (context?: FilterContext) =>
  getTagSuggestions({
    spaceId,
    ...(context?.takenAfter && { takenAfter: context.takenAfter }),
    ...(context?.takenBefore && { takenBefore: context.takenBefore }),
  }).then((tags) => tags.map((t) => ({ id: t.id, name: t.value }))),

// Non-scoped (line 74):
// Before
tags: () => getAllTags().then((tags) => tags.map((t) => ({ id: t.id, name: t.value }))),

// After
tags: (context?: FilterContext) =>
  getTagSuggestions({
    ...(context?.takenAfter && { takenAfter: context.takenAfter }),
    ...(context?.takenBefore && { takenBefore: context.takenBefore }),
  }).then((tags) => tags.map((t) => ({ id: t.id, name: t.value }))),
```

Update the import: replace `getAllTags` with `getTagSuggestions`. Add `FilterContext` import.

**Step 4: Verify no remaining references to `getAllTags` in filter configs**

Run: `grep -rn 'getAllTags' web/src/routes web/src/lib/utils/map-filter-config.ts`
Expected: No matches (the CRUD tag pages may still use it, that's fine — just not in filter configs).

**Step 5: Run type check**

Run: `cd web && npx svelte-check 2>&1 | tail -20`
Expected: No errors.

**Step 6: Commit**

```bash
git add web/src/routes/ web/src/lib/utils/map-filter-config.ts
git commit -m "feat: use accessible tags endpoint in all filter configs"
```

---

### Task 8: Frontend — Test tags re-fetch on temporal change

**Files:**

- Modify: `web/src/lib/components/filter-panel/__tests__/contextual-refetch.spec.ts`

**Step 1: Add tags to the existing test config**

Update the `createConfig` helper to include tags:

```typescript
function createConfig(overrides: Partial<FilterPanelConfig['providers']> = {}): FilterPanelConfig {
  return {
    sections: ['timeline', 'people', 'location', 'camera', 'tags'],
    providers: {
      people: vi.fn().mockResolvedValue([
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
      ]),
      locations: vi.fn().mockResolvedValue([
        { value: 'Germany', type: 'country' as const },
        { value: 'France', type: 'country' as const },
      ]),
      cameras: vi.fn().mockResolvedValue([
        { value: 'Canon', type: 'make' as const },
        { value: 'Sony', type: 'make' as const },
      ]),
      tags: vi.fn().mockResolvedValue([
        { id: 't1', name: 'Vacation' },
        { id: 't2', name: 'Family' },
      ]),
      ...overrides,
    },
  };
}
```

**Step 2: Add test for tags re-fetch**

Add a new test case in the `describe('Contextual re-fetch on temporal change')` block:

```typescript
it('should re-fetch tags with temporal context when a year is selected', async () => {
  const config = createConfig();
  render(FilterPanel, {
    props: { config, timeBuckets },
  });

  await vi.advanceTimersByTimeAsync(0);

  expect(config.providers.tags).toHaveBeenCalledTimes(1);

  // Click year to select 2023
  await fireEvent.click(screen.getByTestId('year-btn-2023'));

  // Advance past debounce
  await vi.advanceTimersByTimeAsync(250);

  const expectedContext: FilterContext = {
    takenAfter: '2023-01-01T00:00:00.000Z',
    takenBefore: '2024-01-01T00:00:00.000Z',
  };

  await waitFor(() => {
    expect(config.providers.tags).toHaveBeenCalledTimes(2);
    expect(config.providers.tags).toHaveBeenLastCalledWith(expectedContext);
  });
});
```

**Step 3: Update existing test assertions to include tags**

In the first test (`should re-fetch providers with temporal context when a year is selected`),
add assertions for tags alongside the existing people/locations/cameras assertions:

```typescript
expect(config.providers.tags).toHaveBeenCalledTimes(2);
expect(config.providers.tags).toHaveBeenLastCalledWith(expectedContext);
```

**Step 4: Run tests**

Run: `cd web && npx vitest run src/lib/components/filter-panel/__tests__/contextual-refetch.spec.ts 2>&1 | tail -20`
Expected: PASS

**Step 5: Commit**

```bash
git add web/src/lib/components/filter-panel/__tests__/contextual-refetch.spec.ts
git commit -m "test: verify tags re-fetch on temporal filter change"
```

---

### Task 9: Final checks — lint, format, type check

**Step 1: Format and lint server**

Run sequentially (each can take several minutes):

```bash
cd /path/to/worktree && make format-server
cd /path/to/worktree && make lint-server
cd /path/to/worktree && make check-server
```

**Step 2: Format and lint web**

```bash
cd /path/to/worktree && make format-web
cd /path/to/worktree && make lint-web
cd /path/to/worktree && make check-web
```

**Step 3: Run server unit tests**

```bash
cd server && pnpm test -- --run
```

**Step 4: Run web unit tests**

```bash
cd web && pnpm test -- --run
```

**Step 5: Fix any issues and commit**

```bash
git add -A
git commit -m "chore: fix lint and formatting issues"
```
