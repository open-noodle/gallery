# Pi Agent Search Filter Parity Slice 2 UI Filter Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pi `searchAssets` execute Gallery-compatible deterministic metadata filters for dates, visibility, people, shared-space scope, and unrated assets while preserving the assistant permission plan.

**Architecture:** Replace the agent-only search query execution path with a small mapper from Pi's `searchAssets` request into Gallery metadata search repository semantics, then hydrate the returned IDs back into compact agent-safe metadata. Slice 2 keeps text modes, non-desc ordering, and later pages denied; those remain Slice 4 and Slice 6 responsibilities. Validation stays in `AgentToolService` so inaccessible filter IDs are rejected before search execution and returned assets are still rechecked against the immutable session permission plan.

**Tech Stack:** NestJS services, Kysely `SearchRepository.searchMetadata`, Zod DTOs, Vitest, MCP tool contract/docs generation.

---

## Scope

Implement only Slice 2 from `docs/superpowers/specs/2026-05-20-pi-agent-search-filter-parity-design.md`.

Included:

- Execute deterministic metadata filters already present in the Slice 1 schema:
  - `createdAfter`, `createdBefore`
  - `updatedAfter`, `updatedBefore`
  - `takenAfter`, `takenBefore`
  - `visibility`
  - `personIds`
  - `spaceId`
  - `spacePersonIds`
  - `withSharedSpaces`
  - `rating: null`
- Preserve existing executable filters:
  - location, camera fields, favorite, not-in-album, media type, rating number, tag IDs, album IDs.
- Route metadata searches through Gallery's existing metadata search semantics via `SearchRepository.searchMetadata`.
- Hydrate returned search IDs through `AssetRepository.getAgentMetadataByIds` so Pi still receives compact, redacted metadata with tags and EXIF.
- Enforce permission-plan scope for owned, shared-space, and locked assets.
- Update MCP contract guidance and generated docs to stop claiming Slice 2 filters are unavailable.

Excluded:

- Do not execute `smart`, `description`, `ocr`, or `filename` search modes. That is Slice 4.
- Do not support `page > 1`, `order: asc`, or `order: relevance`. Large-result continuation is Slice 6.
- Do not add `resolveAssetSearchFilters`. That is Slice 3.
- Do not expose original paths, checksums, filesystem paths, previews, or originals in search responses.

## Behavior Decisions

- Metadata search defaults to Gallery metadata search visibility semantics: timeline assets unless `filters.visibility` is explicit.
- `filters.visibility: archive` is executable when metadata read is allowed.
- `filters.visibility: locked` requires both `permissionPlanSnapshot.assetScope.locked === true` and `auth.session.hasElevatedPermission === true`.
- `filters.withSharedSpaces: true` includes shared-space timeline assets only when the session permission plan allows shared spaces.
- `filters.albumIds` includes shared-space timeline scope when the session permission plan allows shared spaces, matching Gallery metadata search's album-filter behavior.
- A shared-space-only permission plan treats a broad metadata search as a shared-space search, even when `withSharedSpaces` is omitted, because owned assets are outside scope.
- An owned-only permission plan rejects `withSharedSpaces`, `spaceId`, and `spacePersonIds`.
- `spaceId` and `withSharedSpaces` conflict, matching Gallery search service behavior.
- `spacePersonIds` requires `spaceId`, matching Gallery search service behavior.
- Empty array filters are allowed and omitted from the effective search options, matching Gallery metadata search no-op semantics.
- Inaccessible album, tag, person, or space filters return the generic denial `One or more search filters are not accessible` before repository execution.

## File Map

- Create: `server/src/services/agent-search-filter-mapper.ts`
  - Pure mapper from Pi `searchAssets` metadata request plus agent scope into `SearchRepository.searchMetadata` pagination/options.
- Create: `server/src/services/agent-search-filter-mapper.spec.ts`
  - TDD coverage for Gallery metadata-search option mapping and edge cases.
- Modify: `server/src/services/agent-tool.service.ts`
  - Inject `SearchRepository`, validate Slice 2 search filters, call the mapper, execute `searchMetadata`, hydrate compact metadata, and remove Slice 1 future-filter denials.
- Modify: `server/src/services/agent-tool.service.spec.ts`
  - Service TDD coverage for validation, permission gates, repository routing, hydration, and response metadata.
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
  - Update search examples, usage guidance, and correction hints for newly executable deterministic filters.
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Contract tests proving examples and corrections match Slice 2 behavior.
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
  - Prompt regression that deterministic people/space/visibility fields are not described as unavailable.
- Modify generated files after tests are green:
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`

---

### Task 1: Search Filter Mapper Contract

**Files:**

- Create: `server/src/services/agent-search-filter-mapper.ts`
- Create: `server/src/services/agent-search-filter-mapper.spec.ts`

- [ ] **Step 1: Write failing mapper tests**

Create `server/src/services/agent-search-filter-mapper.spec.ts`:

```ts
import { AssetOrder, AssetType, AssetVisibility } from 'src/enum';
import { buildAgentMetadataSearch } from 'src/services/agent-search-filter-mapper';
import { newUuid } from 'test/small.factory';

describe(buildAgentMetadataSearch.name, () => {
  const userId = newUuid();
  const sharedSpaceId = newUuid();

  it('maps deterministic Pi filters to Gallery metadata search options', () => {
    const tagId = newUuid();
    const albumId = newUuid();
    const personId = newUuid();

    const result = buildAgentMetadataSearch({
      userId,
      request: {
        mode: 'metadata',
        filters: {
          type: AssetType.Video,
          isFavorite: true,
          isNotInAlbum: true,
          takenAfter: new Date('2026-05-01T00:00:00.000Z'),
          takenBefore: new Date('2026-05-31T23:59:59.999Z'),
          createdAfter: new Date('2026-04-01T00:00:00.000Z'),
          createdBefore: new Date('2026-04-30T23:59:59.999Z'),
          updatedAfter: new Date('2026-05-10T00:00:00.000Z'),
          updatedBefore: new Date('2026-05-20T23:59:59.999Z'),
          city: 'Berlin',
          state: 'Berlin',
          country: 'Germany',
          make: 'Sony',
          model: 'A7',
          lensModel: 'FE 35mm',
          rating: null,
          tagIds: [tagId],
          albumIds: [albumId],
          personIds: [personId],
          visibility: AssetVisibility.Archive,
        },
        limit: 25,
        page: 1,
        order: 'desc',
      },
      scope: { owned: true, sharedSpaces: false, locked: false, timelineSpaceIds: [] },
    });

    expect(result.pagination).toEqual({ page: 1, size: 25 });
    expect(result.options).toEqual(
      expect.objectContaining({
        userIds: [userId],
        orderDirection: AssetOrder.Desc,
        type: AssetType.Video,
        isFavorite: true,
        isNotInAlbum: true,
        takenAfter: new Date('2026-05-01T00:00:00.000Z'),
        takenBefore: new Date('2026-05-31T23:59:59.999Z'),
        createdAfter: new Date('2026-04-01T00:00:00.000Z'),
        createdBefore: new Date('2026-04-30T23:59:59.999Z'),
        updatedAfter: new Date('2026-05-10T00:00:00.000Z'),
        updatedBefore: new Date('2026-05-20T23:59:59.999Z'),
        city: 'Berlin',
        state: 'Berlin',
        country: 'Germany',
        make: 'Sony',
        model: 'A7',
        lensModel: 'FE 35mm',
        rating: null,
        tagIds: [tagId],
        albumIds: [albumId],
        personIds: [personId],
        visibility: AssetVisibility.Archive,
      }),
    );
  });

  it('uses shared-space timeline IDs without owned user IDs for shared-space-only plans', () => {
    const result = buildAgentMetadataSearch({
      userId,
      request: { mode: 'metadata', filters: {}, limit: 50, page: 1, order: 'desc' },
      scope: { owned: false, sharedSpaces: true, locked: false, timelineSpaceIds: [sharedSpaceId] },
    });

    expect(result.options).toEqual(
      expect.objectContaining({
        userIds: [],
        timelineSpaceIds: [sharedSpaceId],
      }),
    );
  });

  it('sets forceEmptyResult when shared-space-only scope has no timeline spaces', () => {
    const result = buildAgentMetadataSearch({
      userId,
      request: { mode: 'metadata', filters: {}, limit: 50, page: 1, order: 'desc' },
      scope: { owned: false, sharedSpaces: true, locked: false, timelineSpaceIds: [] },
    });

    expect(result.options).toEqual(expect.objectContaining({ userIds: [], forceEmptyResult: true }));
  });

  it('maps explicit withSharedSpaces for owned plus shared sessions', () => {
    const result = buildAgentMetadataSearch({
      userId,
      request: {
        mode: 'metadata',
        filters: { withSharedSpaces: true, isFavorite: true },
        limit: 10,
        page: 1,
        order: 'desc',
      },
      scope: { owned: true, sharedSpaces: true, locked: false, timelineSpaceIds: [sharedSpaceId] },
    });

    expect(result.options).toEqual(
      expect.objectContaining({
        userIds: [userId],
        timelineSpaceIds: [sharedSpaceId],
        isFavorite: true,
      }),
    );
  });

  it('includes timeline shared spaces for album filters when the session allows shared spaces', () => {
    const albumId = newUuid();
    const result = buildAgentMetadataSearch({
      userId,
      request: { mode: 'metadata', filters: { albumIds: [albumId] }, limit: 10, page: 1, order: 'desc' },
      scope: { owned: true, sharedSpaces: true, locked: false, timelineSpaceIds: [sharedSpaceId] },
    });

    expect(result.options).toEqual(
      expect.objectContaining({
        userIds: [userId],
        timelineSpaceIds: [sharedSpaceId],
        albumIds: [albumId],
      }),
    );
  });

  it('maps explicit space scope without broad timeline shared-space inclusion', () => {
    const spacePersonId = newUuid();
    const result = buildAgentMetadataSearch({
      userId,
      request: {
        mode: 'metadata',
        filters: { spaceId: sharedSpaceId, spacePersonIds: [spacePersonId] },
        limit: 10,
        page: 1,
        order: 'desc',
      },
      scope: { owned: true, sharedSpaces: true, locked: false, timelineSpaceIds: [newUuid()] },
    });

    expect(result.options).toEqual(
      expect.objectContaining({
        spaceId: sharedSpaceId,
        spacePersonIds: [spacePersonId],
      }),
    );
    expect(result.options).not.toHaveProperty('timelineSpaceIds');
    expect(result.options).not.toHaveProperty('userIds');
  });

  it('omits empty array filters so Gallery search treats them as no-ops', () => {
    const result = buildAgentMetadataSearch({
      userId,
      request: {
        mode: 'metadata',
        filters: { personIds: [], spacePersonIds: [], tagIds: [], albumIds: [] },
        limit: 10,
        page: 1,
        order: 'desc',
      },
      scope: { owned: true, sharedSpaces: false, locked: false, timelineSpaceIds: [] },
    });

    expect(result.options).not.toHaveProperty('personIds');
    expect(result.options).not.toHaveProperty('spacePersonIds');
    expect(result.options).not.toHaveProperty('tagIds');
    expect(result.options).not.toHaveProperty('albumIds');
  });
});
```

- [ ] **Step 2: Run the mapper tests to verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-search-filter-mapper.spec.ts
```

Expected: FAIL because `agent-search-filter-mapper.ts` does not exist.

- [ ] **Step 3: Implement the mapper**

Create `server/src/services/agent-search-filter-mapper.ts`:

```ts
import { type AgentSearchAssetsToolRequestDto } from 'src/dtos/agent-tool.dto';
import { type MetadataSearchDto } from 'src/dtos/search.dto';
import { AssetOrder } from 'src/enum';
import { type AssetSearchOptions, type SearchPaginationOptions } from 'src/repositories/search.repository';

type AgentSearchExecutionScope = {
  owned: boolean;
  sharedSpaces: boolean;
  locked: boolean;
  timelineSpaceIds: string[];
};

export type AgentMetadataSearchBuildInput = {
  userId: string;
  request: AgentSearchAssetsToolRequestDto;
  scope: AgentSearchExecutionScope;
};

export type AgentMetadataSearchBuildResult = {
  pagination: SearchPaginationOptions;
  options: AssetSearchOptions;
};

const nonEmpty = <T>(values: T[] | undefined): T[] | undefined => (values && values.length > 0 ? values : undefined);

const omitUndefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, property]) => property !== undefined)) as T;

export const buildAgentMetadataSearch = ({
  userId,
  request,
  scope,
}: AgentMetadataSearchBuildInput): AgentMetadataSearchBuildResult => {
  const filters = request.filters ?? {};
  const limit = request.limit ?? 10_000;
  const page = request.page ?? 1;
  const hasAlbumFilter = (filters.albumIds?.length ?? 0) > 0;
  const wantsBroadSharedScope = filters.spaceId
    ? false
    : filters.withSharedSpaces === true ||
      (!scope.owned && scope.sharedSpaces) ||
      (hasAlbumFilter && scope.sharedSpaces);
  const timelineSpaceIds = wantsBroadSharedScope ? scope.timelineSpaceIds : undefined;
  const hasTimelineSpaces = !!timelineSpaceIds && timelineSpaceIds.length > 0;

  const galleryDto = omitUndefined({
    type: filters.type,
    isFavorite: filters.isFavorite,
    isNotInAlbum: filters.isNotInAlbum,
    takenAfter: filters.takenAfter,
    takenBefore: filters.takenBefore,
    createdAfter: filters.createdAfter,
    createdBefore: filters.createdBefore,
    updatedAfter: filters.updatedAfter,
    updatedBefore: filters.updatedBefore,
    city: filters.city,
    state: filters.state,
    country: filters.country,
    make: filters.make,
    model: filters.model,
    lensModel: filters.lensModel,
    rating: filters.rating,
    tagIds: nonEmpty(filters.tagIds),
    albumIds: nonEmpty(filters.albumIds),
    personIds: nonEmpty(filters.personIds),
    spaceId: filters.spaceId,
    spacePersonIds: nonEmpty(filters.spacePersonIds),
    visibility: filters.visibility,
    order: AssetOrder.Desc,
    page,
    size: limit,
  } satisfies Partial<MetadataSearchDto>);

  const options = omitUndefined({
    ...galleryDto,
    orderDirection: AssetOrder.Desc,
    userIds: filters.spaceId ? undefined : scope.owned ? [userId] : wantsBroadSharedScope ? [] : [userId],
    timelineSpaceIds: hasTimelineSpaces ? timelineSpaceIds : undefined,
    forceEmptyResult: wantsBroadSharedScope && !hasTimelineSpaces ? true : undefined,
  } satisfies Partial<AssetSearchOptions>) as AssetSearchOptions;

  return {
    pagination: { page, size: limit },
    options,
  };
};
```

- [ ] **Step 4: Run the mapper tests to verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-search-filter-mapper.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit mapper contract**

```bash
git add server/src/services/agent-search-filter-mapper.ts server/src/services/agent-search-filter-mapper.spec.ts
git commit -m "feat: map pi metadata search filters"
```

---

### Task 2: Service Validation For Slice 2 Filters

**Files:**

- Modify: `server/src/services/agent-tool.service.ts`
- Modify: `server/src/services/agent-tool.service.spec.ts`

- [ ] **Step 1: Write failing validation tests**

In `server/src/services/agent-tool.service.spec.ts`, keep the existing unsupported text-mode and page/order tests, but remove Slice 2 fields from the old "future search contract fields" denial table. Add these tests near the current search tests:

```ts
it('denies spacePersonIds without spaceId before executing search', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
  });
  sessionRepository.getById.mockResolvedValue(session);

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { spacePersonIds: [newUuid()] },
    limit: 5,
    page: 1,
    order: 'desc',
  });

  expect(result).toEqual(expect.objectContaining({ status: 'denied', reason: 'spacePersonIds requires spaceId' }));
  expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
});

it('denies conflicting spaceId and withSharedSpaces before executing search', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
  });
  sessionRepository.getById.mockResolvedValue(session);

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { spaceId: newUuid(), withSharedSpaces: true },
    limit: 5,
    page: 1,
    order: 'desc',
  });

  expect(result).toEqual(
    expect.objectContaining({ status: 'denied', reason: 'Cannot use both spaceId and withSharedSpaces' }),
  );
  expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
});

it('denies shared-space filters when the permission plan is owned-only', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
  });
  sessionRepository.getById.mockResolvedValue(session);

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { withSharedSpaces: true },
    limit: 5,
    page: 1,
    order: 'desc',
  });

  expect(result).toEqual(
    expect.objectContaining({ status: 'denied', reason: 'Shared spaces are not accessible for this session' }),
  );
  expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
});

it('denies stale or inaccessible space filters without leaking details', async () => {
  const auth = AuthFactory.create();
  const spaceId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
  });
  sessionRepository.getById.mockResolvedValue(session);
  sharedSpaceRepository.getMember.mockResolvedValue(undefined);

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { spaceId },
    limit: 5,
    page: 1,
    order: 'desc',
  });

  expect(sharedSpaceRepository.getMember).toHaveBeenCalledWith(spaceId, auth.user.id);
  expect(result).toEqual(
    expect.objectContaining({ status: 'denied', reason: 'One or more search filters are not accessible' }),
  );
});

it.each([
  [
    'permission plan does not allow locked assets',
    makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    AuthFactory.create(),
  ],
  [
    'auth session is not elevated',
    makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: true } }),
    AuthFactory.from().session({ hasElevatedPermission: false }).build(),
  ],
] as const)('denies locked visibility when %s', async (_name, plan, auth) => {
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: plan,
  });
  sessionRepository.getById.mockResolvedValue(session);

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { visibility: AssetVisibility.Locked },
    limit: 5,
    page: 1,
    order: 'desc',
  });

  expect(result).toEqual(
    expect.objectContaining({ status: 'denied', reason: 'Locked photos require elevated permission' }),
  );
});

it('denies inaccessible people filters before executing search', async () => {
  const auth = AuthFactory.create();
  const accessiblePersonId = newUuid();
  const inaccessiblePersonId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([accessiblePersonId]));

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { personIds: [accessiblePersonId, inaccessiblePersonId] },
    limit: 5,
    page: 1,
    order: 'desc',
  });

  expect(accessRepository.person.checkOwnerAccess).toHaveBeenCalledWith(
    auth.user.id,
    new Set([accessiblePersonId, inaccessiblePersonId]),
  );
  expect(result).toEqual(
    expect.objectContaining({ status: 'denied', reason: 'One or more search filters are not accessible' }),
  );
});
```

- [ ] **Step 2: Run service tests to verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "spacePersonIds|withSharedSpaces|locked visibility|people filters"
```

Expected: FAIL because Slice 1 still denies these filters as unavailable or does not validate the new cases.

- [ ] **Step 3: Implement validation changes**

In `server/src/services/agent-tool.service.ts`:

1. Remove Slice 2 fields from `getUnsupportedSearchFilterReason`. After this slice, this helper should return `null` for all metadata filters because the remaining unsupported search fields are handled by mode and paging/order guards.

```ts
private getUnsupportedSearchFilterReason(_filters: AgentSearchAssetsFilters): string | null {
  return null;
}
```

2. Add these validation checks inside `validateSearchRequest` after `filterReason` and before album/tag validation:

```ts
const sharedFilterRequested =
  filters.withSharedSpaces === true || filters.spaceId !== undefined || (filters.spacePersonIds?.length ?? 0) > 0;

if ((filters.spacePersonIds?.length ?? 0) > 0 && !filters.spaceId) {
  return 'spacePersonIds requires spaceId';
}

if (filters.spaceId && filters.withSharedSpaces) {
  return 'Cannot use both spaceId and withSharedSpaces';
}

if (sharedFilterRequested && !session.permissionPlanSnapshot.assetScope.sharedSpaces) {
  return 'Shared spaces are not accessible for this session';
}

if (
  filters.visibility === AssetVisibility.Locked &&
  (!session.permissionPlanSnapshot.assetScope.locked || auth.session?.hasElevatedPermission !== true)
) {
  return 'Locked photos require elevated permission';
}

if (filters.spaceId) {
  const member = await this.sharedSpaceRepository.getMember(filters.spaceId, auth.user.id);
  if (!member) {
    return 'One or more search filters are not accessible';
  }
}
```

3. Add person filter access checks after the existing tag checks:

```ts
const personIds = filters.personIds ? new Set(filters.personIds) : new Set<string>();
if (personIds.size > 0) {
  const readablePersonIds = new Set<string>();
  if (session.permissionPlanSnapshot.assetScope.owned) {
    const ownerPersonIds = await this.accessRepository.person.checkOwnerAccess(auth.user.id, personIds);
    for (const id of ownerPersonIds) {
      readablePersonIds.add(id);
    }
  }
  if (session.permissionPlanSnapshot.assetScope.sharedSpaces) {
    const sharedPersonIds = await this.accessRepository.person.checkSharedSpaceAccess(auth.user.id, personIds);
    for (const id of sharedPersonIds) {
      readablePersonIds.add(id);
    }
  }
  if (readablePersonIds.size !== personIds.size) {
    return 'One or more search filters are not accessible';
  }
}
```

- [ ] **Step 4: Run service validation tests to verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "spacePersonIds|withSharedSpaces|locked visibility|people filters"
```

Expected: PASS.

- [ ] **Step 5: Commit validation changes**

```bash
git add server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts
git commit -m "feat: validate pi metadata search filters"
```

---

### Task 3: Execute Search Through Gallery Metadata Search

**Files:**

- Modify: `server/src/services/agent-tool.service.ts`
- Modify: `server/src/services/agent-tool.service.spec.ts`

- [ ] **Step 1: Write failing execution tests**

In `server/src/services/agent-tool.service.spec.ts`, add `SearchRepository` to imports and setup:

```ts
import { SearchRepository } from 'src/repositories/search.repository';
```

Add a mock variable:

```ts
let searchRepository: ReturnType<typeof automock<SearchRepository>>;
```

Initialize it in `beforeEach`:

```ts
searchRepository = automock(SearchRepository, { args: [{} as never] });
searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false });
```

Pass it to the `AgentToolService` constructor after `assetRepository`.

Then add these tests near the search execution tests:

```ts
it('executes metadata search through Gallery search semantics and hydrates compact metadata in search order', async () => {
  const auth = AuthFactory.create();
  const firstId = newUuid();
  const secondId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({
      limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 10_000, maxAssetsPerSession: 10_000 },
    }),
  });
  sessionRepository.getById.mockResolvedValue(session);
  searchRepository.searchMetadata.mockResolvedValue({
    items: [{ id: firstId }, { id: secondId }] as never,
    hasNextPage: true,
  });
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(secondId), makeMetadata(firstId)]);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([firstId, secondId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([firstId, secondId]));

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: {
      createdAfter: new Date('2026-04-01T00:00:00.000Z'),
      updatedBefore: new Date('2026-05-20T23:59:59.999Z'),
      rating: null,
    },
    limit: 2,
    page: 1,
    order: 'desc',
  });

  expect(result).toEqual(
    expect.objectContaining({
      status: 'success',
      returnedCount: 2,
      hasMore: true,
      nextPage: '2',
      assets: [expect.objectContaining({ id: firstId }), expect.objectContaining({ id: secondId })],
    }),
  );
  expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
    { page: 1, size: 2 },
    expect.objectContaining({
      userIds: [auth.user.id],
      createdAfter: new Date('2026-04-01T00:00:00.000Z'),
      updatedBefore: new Date('2026-05-20T23:59:59.999Z'),
      rating: null,
      orderDirection: 'desc',
    }),
  );
  expect(assetRepository.getAgentMetadataByIds).toHaveBeenCalledWith([firstId, secondId]);
  expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
});

it('executes shared-space-only search with timeline space IDs and no owned assets', async () => {
  const auth = AuthFactory.create();
  const spaceId = newUuid();
  const assetId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
  });
  sessionRepository.getById.mockResolvedValue(session);
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
  searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId, { ownerId: newUuid() })]);
  accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: {},
    limit: 5,
    page: 1,
    order: 'desc',
  });

  expect(result).toEqual(expect.objectContaining({ status: 'success', returnedCount: 1 }));
  expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
    { page: 1, size: 5 },
    expect.objectContaining({ userIds: [], timelineSpaceIds: [spaceId] }),
  );
});

it('executes favorites with shared-space inclusion when permission plan allows shared spaces', async () => {
  const auth = AuthFactory.create();
  const spaceId = newUuid();
  const assetId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
  });
  sessionRepository.getById.mockResolvedValue(session);
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
  searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)]);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));

  await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { isFavorite: true, withSharedSpaces: true },
    limit: 5,
    page: 1,
    order: 'desc',
  });

  expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
    { page: 1, size: 5 },
    expect.objectContaining({ userIds: [auth.user.id], timelineSpaceIds: [spaceId], isFavorite: true }),
  );
});

it('executes accessible people filters through Gallery search', async () => {
  const auth = AuthFactory.create();
  const personId = newUuid();
  const assetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personId]));
  searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)]);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { personIds: [personId] },
    limit: 5,
    page: 1,
    order: 'desc',
  });

  expect(result).toEqual(expect.objectContaining({ status: 'success', returnedCount: 1 }));
  expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
    { page: 1, size: 5 },
    expect.objectContaining({ userIds: [auth.user.id], personIds: [personId] }),
  );
});

it('executes accessible space person filters with explicit space scope', async () => {
  const auth = AuthFactory.create();
  const spaceId = newUuid();
  const spacePersonId = newUuid();
  const assetId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
  });
  sessionRepository.getById.mockResolvedValue(session);
  sharedSpaceRepository.getMember.mockResolvedValue(makeSpaceMember({ spaceId, userId: auth.user.id }));
  searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)]);
  accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { spaceId, spacePersonIds: [spacePersonId] },
    limit: 5,
    page: 1,
    order: 'desc',
  });

  expect(result).toEqual(expect.objectContaining({ status: 'success', returnedCount: 1 }));
  expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
    { page: 1, size: 5 },
    expect.objectContaining({ spaceId, spacePersonIds: [spacePersonId] }),
  );
});

it('includes timeline shared spaces for album filters when the permission plan allows shared spaces', async () => {
  const auth = AuthFactory.create();
  const albumId = newUuid();
  const spaceId = newUuid();
  const assetId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
  });
  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
  searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)]);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));

  await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { albumIds: [albumId] },
    limit: 5,
    page: 1,
    order: 'desc',
  });

  expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
    { page: 1, size: 5 },
    expect.objectContaining({ userIds: [auth.user.id], timelineSpaceIds: [spaceId], albumIds: [albumId] }),
  );
});

it('executes locked visibility search only when the plan and elevated auth allow it', async () => {
  const auth = AuthFactory.from().session({ hasElevatedPermission: true }).build();
  const assetId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: true } }),
  });
  sessionRepository.getById.mockResolvedValue(session);
  searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
  assetRepository.getAgentMetadataByIds.mockResolvedValue([
    makeMetadata(assetId, { visibility: AssetVisibility.Locked }),
  ]);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { visibility: AssetVisibility.Locked },
    limit: 5,
    page: 1,
    order: 'desc',
  });

  expect(result).toEqual(expect.objectContaining({ status: 'success', returnedCount: 1 }));
  expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
    { page: 1, size: 5 },
    expect.objectContaining({ visibility: AssetVisibility.Locked }),
  );
  expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([assetId]), true);
});
```

- [ ] **Step 2: Run execution tests to verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "Gallery search semantics|shared-space-only search|favorites with shared-space|accessible people filters|space person filters|album filters|locked visibility search"
```

Expected: FAIL because `AgentToolService` still calls `AssetRepository.searchAgentMetadata`.

- [ ] **Step 3: Implement repository routing and hydration**

In `server/src/services/agent-tool.service.ts`:

1. Add imports:

```ts
import { SearchRepository } from 'src/repositories/search.repository';
import { buildAgentMetadataSearch } from 'src/services/agent-search-filter-mapper';
```

2. Inject `SearchRepository` after `AssetRepository`:

```ts
private readonly searchRepository: SearchRepository,
```

3. Replace `execute` inside `searchAssetsDescriptor` with:

```ts
execute: async (auth, session, request) => {
  const timelineSpaceIds = await this.getSearchTimelineSpaceIds(auth, session, request.filters ?? {});
  const search = buildAgentMetadataSearch({
    userId: auth.user.id,
    request,
    scope: {
      owned: session.permissionPlanSnapshot.assetScope.owned,
      sharedSpaces: session.permissionPlanSnapshot.assetScope.sharedSpaces,
      locked: session.permissionPlanSnapshot.assetScope.locked && auth.session?.hasElevatedPermission === true,
      timelineSpaceIds,
    },
  });
  const result = await this.searchRepository.searchMetadata(search.pagination, search.options);
  const assetIds = result.items.map((asset) => asset.id);
  await this.assertReturnedAssetsAreAccessible(auth, session, assetIds);
  const assets = await this.getOrderedAgentMetadata(assetIds);

  return {
    assets,
    returnedCount: assets.length,
    hasMore: result.hasNextPage,
    nextPage: result.hasNextPage ? String((request.page ?? 1) + 1) : null,
  };
},
```

4. Add helper methods near `getRepositoryScope`:

```ts
private async getSearchTimelineSpaceIds(
  auth: AuthDto,
  session: AgentSession,
  filters: AgentSearchAssetsFilters,
): Promise<string[]> {
  const hasAlbumFilter = (filters.albumIds?.length ?? 0) > 0;
  const needsSharedTimeline =
    !filters.spaceId &&
    session.permissionPlanSnapshot.assetScope.sharedSpaces &&
    (filters.withSharedSpaces === true || !session.permissionPlanSnapshot.assetScope.owned || hasAlbumFilter);

  if (!needsSharedTimeline) {
    return [];
  }

  const rows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
  return rows.map((row) => row.spaceId);
}

private async getOrderedAgentMetadata(assetIds: string[]): Promise<AgentAssetMetadata[]> {
  if (assetIds.length === 0) {
    return [];
  }

  const rows = await this.assetRepository.getAgentMetadataByIds(assetIds);
  const byId = new Map(rows.map((asset) => [asset.id, this.mapAssetMetadata(asset as AgentAssetMetadata)]));
  return assetIds.flatMap((id) => {
    const asset = byId.get(id);
    return asset ? [asset] : [];
  });
}
```

5. Keep `assertReturnedAssetsAreAccessible` after search IDs and before hydration so inaccessible repository results fail safely.

- [ ] **Step 4: Run execution tests to verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "Gallery search semantics|shared-space-only search|favorites with shared-space|accessible people filters|space person filters|album filters|locked visibility search"
```

Expected: PASS.

- [ ] **Step 5: Run complete service and mapper suites**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-search-filter-mapper.spec.ts src/services/agent-tool.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit execution changes**

```bash
git add server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts
git commit -m "feat: execute pi search via gallery metadata search"
```

---

### Task 4: MCP Contract Guidance For Executable Slice 2 Filters

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`

- [ ] **Step 1: Write failing contract and prompt tests**

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, update the Slice 1 assertions that currently say people, space, shared-space, and visibility fields are unavailable. Add:

```ts
it('advertises deterministic people, space, shared-space, visibility, and created/updated search filters as executable', () => {
  const search = sut.getReadToolContract(AgentToolName.SearchAssets);
  const filtered = search.examples.find((example) => example.name === 'filtered-search');
  const spaceExample = search.examples.find((example) => example.name === 'space-filter-search');

  expect(search.description).toContain(
    'people, shared-space, visibility, created, updated, taken, album, tag, camera, rating, and media filters',
  );
  expect(filtered?.whenToUse).toContain('people, space, visibility');
  expect(spaceExample?.arguments).toEqual({
    filters: { spaceId: expect.any(String), spacePersonIds: [expect.any(String)] },
    limit: 25,
  });
});

it('keeps correction hints for spacePersonIds without spaceId and root filters', () => {
  const spaceCorrection = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
    requestShape: 'tool-arguments',
    issues: [{ path: 'filters.spacePersonIds', message: 'spacePersonIds requires spaceId' }],
  });
  const rootCorrection = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
    requestShape: 'tool-arguments',
    issues: [{ path: '', message: 'Unrecognized key: "createdAfter"' }],
  });

  expect(spaceCorrection?.hint).toContain('spacePersonIds requires filters.spaceId');
  expect(rootCorrection?.hint).toContain('Place supported search filters inside filters');
});
```

In `server/src/services/agent-mcp-prompt.service.spec.ts`, add:

```ts
it('does not tell Pi that deterministic people or shared-space filters are unavailable', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toContain(
    'Use searchAssets with structured filters for people, spaces, visibility, dates, albums, tags, camera fields, ratings, and media types when IDs are already known.',
  );
  expect(prompt).not.toContain('People, space, and visibility fields are contract fields but are not available yet.');
});
```

- [ ] **Step 2: Run contract tests to verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts -t "deterministic people|spacePersonIds|does not tell Pi"
```

Expected: FAIL because current docs still describe Slice 2 fields as unavailable.

- [ ] **Step 3: Update MCP contract guidance**

In `server/src/services/agent-mcp-tool-contract.service.ts`:

1. Update the `searchAssetsContract.description` and `usage` to mention executable deterministic filters:

```ts
description:
  'Find assets using Gallery metadata search. Metadata mode supports people, shared-space, visibility, created, updated, taken, album, tag, camera, rating, location, favorite, not-in-album, and media filters. Text search modes are later-slice fields.',
usage:
  'Use searchAssets with structured filters for people, spaces, visibility, dates, albums, tags, camera fields, ratings, and media types when IDs are already known. Put filters under filters. Use mode metadata. Only page 1 and order desc are executable. Text search modes, later pages, and non-desc order are later-slice fields. Use only toolCallId when retrying a Gallery-approved search.',
```

2. Update the `filtered-search` example `whenToUse` so it no longer says people/space/visibility are unavailable.

3. Add a new example:

```ts
{
  name: 'space-filter-search',
  whenToUse: 'Use when Pi already knows an accessible shared space ID and optional space person IDs.',
  arguments: {
    filters: {
      spaceId: '00000000-0000-4000-8000-000000000001',
      spacePersonIds: ['00000000-0000-4000-8000-000000000002'],
    },
    limit: 25,
  },
}
```

4. Update the root-filter common mistake hint:

```ts
hint:
  'Place supported search filters inside filters. Metadata mode supports date, location, favorite, rating, album, tag, camera, media, people, space, shared-space, and visibility filters.',
```

5. Update space-person common mistake guidance:

```ts
{
  id: 'search-space-person-without-space',
  match: { issuePath: 'filters.spacePersonIds', messageIncludes: 'spacePersonIds requires spaceId' },
  hint: 'spacePersonIds requires filters.spaceId. Resolve or choose the space first, then call searchAssets with both fields under filters.',
  exampleName: 'space-filter-search',
}
```

6. Keep hints for:

- root-level filters
- query with metadata mode
- combining `toolCallId` with new search fields
- limit out of range
- page unavailable
- order unavailable

- [ ] **Step 4: Run contract tests to verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit contract guidance**

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-prompt.service.spec.ts
git commit -m "docs: update pi search filter guidance"
```

---

### Task 5: Regenerate MCP Docs And Verify Artifacts

**Files:**

- Modify generated:
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`

- [ ] **Step 1: Regenerate generated MCP docs/prompt artifacts**

Run both generated-artifact sync commands:

```bash
pnpm --dir server exec tsx src/bin/sync-agent-mcp-docs.ts
pnpm --dir server exec tsx src/bin/sync-agent-mcp-prompt.ts
```

Expected: generated MCP markdown and runner prompt cheat sheet update.

- [ ] **Step 2: Verify generated docs mention Slice 2 executable filters**

Run:

```bash
rg -n "people, spaces, visibility|space-filter-search|not available yet" docs/superpowers/generated/pi-agent-mcp-tools.md agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

Expected:

- `space-filter-search` appears in generated MCP docs.
- The prompt says structured people/space/visibility filters are usable when IDs are known.
- Any remaining `not available yet` text refers only to text modes, page, or non-desc order.

- [ ] **Step 3: Run generated-doc tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit generated artifacts**

```bash
git add docs/superpowers/generated/pi-agent-mcp-tools.md agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
git commit -m "chore: regenerate pi search filter docs"
```

---

### Task 6: Final Regression And Review

**Files:**

- Verify all files touched in Tasks 1-5.

- [ ] **Step 1: Run focused Slice 2 test suite**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs \
  src/services/agent-search-filter-mapper.spec.ts \
  src/services/agent-tool.service.spec.ts \
  src/services/agent-mcp-tool-contract.service.spec.ts \
  src/services/agent-mcp-docs.service.spec.ts \
  src/services/agent-mcp-prompt.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck, lint, and format checks**

Run:

```bash
pnpm --dir server check
pnpm --dir server lint
pnpm --dir server format
pnpm --dir docs format
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 3: Review edge-case coverage before final review**

Confirm the tests include these exact cases:

- created/updated/taken ranges map to Gallery metadata search options.
- `rating: null` remains `null` and is not dropped.
- `spacePersonIds` without `spaceId` is denied before repository execution.
- `spaceId` plus `withSharedSpaces` is denied before repository execution.
- owned-only plans deny shared-space filters.
- shared-space-only plans search timeline shared spaces without owned user IDs.
- favorites with shared-space inclusion pass both `isFavorite` and timeline space IDs.
- album filters include timeline shared spaces when the permission plan allows shared spaces, matching Gallery metadata search semantics.
- empty people arrays are accepted and omitted as no-op filters.
- accessible people filters reach Gallery metadata search with `personIds`.
- accessible explicit space filters reach Gallery metadata search with `spaceId` and `spacePersonIds`.
- inaccessible/stale space IDs return a generic inaccessible-filter denial.
- inaccessible people filters return a generic inaccessible-filter denial.
- locked visibility requires both permission-plan locked scope and elevated auth.
- returned assets are rechecked through `assertReturnedAssetsAreAccessible`.
- generated MCP docs no longer say deterministic people/space/visibility filters are unavailable.

- [ ] **Step 4: Request code review**

Use a fresh reviewer subagent with this prompt:

```text
Review the Slice 2 search/filter parity implementation against docs/superpowers/specs/2026-05-20-pi-agent-search-filter-parity-design.md and docs/superpowers/plans/2026-05-20-pi-agent-search-filter-parity-slice-2-ui-filter-parity.md.

Focus on correctness, permission safety, search semantics, and test coverage. Check especially:
- metadata filters route through Gallery search semantics rather than the old agent-only search path
- owned/shared/locked permission scopes cannot leak assets
- people, space, shared-space, visibility, date, and unrated filters behave as planned
- text modes, page > 1, and non-desc order remain deferred
- MCP docs/examples match implemented behavior

Return APPROVED or CHANGES_REQUESTED with concrete file/line findings.
```

- [ ] **Step 5: Patch review findings if needed**

If the reviewer returns `CHANGES_REQUESTED`, write failing tests for each finding first, run them to see the expected failure, patch implementation, rerun the focused tests, and commit the fixes with:

```bash
git add <changed files>
git commit -m "fix: harden pi search filter parity"
```

- [ ] **Step 6: Final status**

Run:

```bash
git status --short
git log --oneline -8
```

Expected:

- Working tree is clean.
- Latest commits include the Slice 2 mapper, validation, execution, docs guidance, and generated artifact commits.

## Self-Review

- Spec coverage: This plan covers Slice 2's deterministic filters, Gallery metadata-search mapping, shared/owned scope, conflict handling, inaccessible filters, locked visibility, and edge cases. It intentionally leaves resolver, text modes, large-result pagination, and final capability matrix updates to later slices.
- TDD coverage: Every production change has a failing-test step, an implementation step, and a pass-verification step before commit.
- Edge cases: The plan explicitly tests shared-space-only, owned-only, favorite plus shared inclusion, album filters with shared-space scope, empty people arrays, stale spaces, accessible and inaccessible people, explicit space-person filters, unrated assets, and locked visibility.
- Type consistency: `buildAgentMetadataSearch` accepts `AgentSearchAssetsToolRequestDto`, returns `SearchPaginationOptions` plus `AssetSearchOptions`, and `AgentToolService` consumes those exact types.
