# Pi Agent Planning From Search Source Slice 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow existing operation planning tools to accept `assetSource.search` and create stable reviewable plans from declarative search filters without exposing asset IDs to Pi.

**Architecture:** Reuse the Slice 5 declarative filter resolver inside `AgentOperationPlanService`, then run Gallery search directly during plan preparation and materialize the matched asset IDs into normal plan operations. Store compact source audit metadata alongside the existing selection handle audit, but keep persisted plan operations source-free so apply does not depend on any later source or handle expiration.

**Tech Stack:** NestJS services, Zod DTOs, Kysely-backed search repositories, existing agent planning services, Vitest, TypeScript, `pnpm --dir server`.

---

## Scope

This is Slice 6 from `docs/superpowers/specs/2026-05-22-pi-agent-declarative-planning-sources-design.md`.

Implement only:

- `assetSource.search` accepted by operation planning DTOs for asset-bearing operations.
- Server-side declarative filter resolution using `AgentAssetSearchFilterResolverService`.
- Metadata, description, OCR, and filename search materialization for source-backed planning.
- Stable plan persistence with materialized `assetIds` and no persisted `assetSource`.
- Compact request/audit metadata that records declarative filters, resolved filters, counts, and sample IDs.
- Clear no-plan failures for empty, ambiguous, denied, unsupported, or over-broad search sources.

Do not implement:

- New high-level album/space/batch workflow tools. Those are Slices 7-9.
- Smart search source materialization. Reject `mode: 'smart'` with a clear planning error in this slice unless the implementation also extracts the full ML-backed search executor safely.
- UI clarification rendering. That is Slice 10.
- Prompt/docs changes. That is Slice 11.

## Existing Context

Completed baseline:

- Slice 1 added `AgentAssetSourceInput` and DTOs with `kind: 'search'`.
- Slice 4 added operation planning support for `assetSource.previousSearch`.
- Slice 5 added `AgentAssetSearchFilterResolverService.resolveDeclarativeFilters()` returning `success`, `needs_clarification`, or `denied`.

Current behavior to change:

- `server/src/dtos/agent-operation.dto.ts` currently accepts only `assetSource.previousSearch` for operation planning and rejects `assetSource.search`.
- `server/src/services/agent-operation-plan.service.ts` currently throws `Only assetSource.previousSearch is supported for operation planning`.
- Selection handle and previous search sources already materialize to normal `assetIds` before plan persistence.

## Files

- Modify: `server/src/dtos/agent-operation.dto.ts`
  - Accept `assetSource.search` and `assetSource.previousSearch` for asset-bearing operation planning.
  - Continue rejecting `selectionHandle` and `explicitAssets` asset sources in operation planning.
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
  - Replace the old "rejects search source" test with acceptance and validation coverage.
- Modify: `server/src/services/agent-operation-plan.service.ts`
  - Inject `SearchRepository`, `SharedSpaceRepository`, and `AgentAssetSearchFilterResolverService`.
  - Add `resolveSearchAssetSourceAssetIds()` and helper methods for search source materialization.
  - Extend planning source audit metadata for direct search sources.
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
  - Add TDD coverage for successful South Africa/Pierre/Aurelia plan creation, empty search, over-broad search, unsupported `smart`, unresolved filters, stable apply after source materialization, and audit metadata.
  - Update constructor setup for new service dependencies.
- Modify: `server/src/types/agent-tool.types.ts`
  - Extend `AgentToolOperationPlanRequestMetadata.selectionHandles[]` source audit fields to include `sourceKind: 'search'`, `resolvedFilters`, and `declarativeFilters`.
- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`
  - Update manual service construction if constructor dependencies change.

## Design Decisions

- Default materialization for `assetSource.search` is `all-matches-with-limit` because requests such as "create an album from my January South Africa photos" normally mean all matching photos.
- `all-matches-with-limit` always runs page 1 with `size = maxAssetSelectionHandleAssets + 1` so the service can detect over-broad searches before persisting a plan. If more than the configured cap matches, throw a `BadRequestException` with a narrowing message and do not create a plan.
- `AlbumSetCover` sources use the smaller `maxCoverSelectionHandleAssets` cap before any selection handle is created. A cover-source search returning 501+ assets must fail before handle creation so failed planning cannot leave orphaned handles.
- `bounded-page` uses `limit` and `page` from the source, defaults to `limit = 100`, `page = 1`, and materializes only that page. `bounded-page` may have `hasNextPage: true`; that is not an over-broad error because the user/model explicitly requested a bounded page.
- `assetSource.search` records compact audit/source metadata without creating a transient selection handle. The returned asset IDs are immediately persisted in the plan operation, so apply uses durable operation `assetIds` and failed access/persistence checks cannot leave orphaned handles.
- `mode: 'smart'` is rejected in Slice 6 with `assetSource.search smart mode is not supported for operation planning yet`. This avoids silently adding ML/config dependencies to planning while still allowing metadata/text search paths that solve the current Pi ID-copying problem. A later slice can extract the full `searchAssets` executor if smart source planning is needed.
- `assetSource.search` mirrors the safety validation of `searchAssets` for the supported planning subset: metadata mode cannot include `query`, non-smart modes only support `desc` order, and locked visibility requires a locked-scope elevated session. These checks must run before filter resolution/search so unsupported requests cannot silently broaden.

## Task 1: Operation DTO Accepts Search Sources

**Files:**

- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`

- [ ] **Step 1: Write the failing DTO acceptance test**

In `server/src/dtos/agent-operation.dto.spec.ts`, replace the current test named `rejects assetSource kinds that operation planning does not support yet` with:

```ts
it('accepts a declarative search assetSource for asset-bearing operations', () => {
  const result = parsePlan({
    summary: 'Add searched photos directly',
    operations: [
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add matching photos',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: factory.uuid(),
        assetSource: {
          kind: 'search',
          mode: 'metadata',
          filters: {
            country: 'South Africa',
            takenAfter: '2026-01-01T00:00:00.000Z',
            takenBefore: '2026-02-01T00:00:00.000Z',
            people: { match: 'any', names: ['Pierre', 'Aurelia'] },
          },
          materialization: 'all-matches-with-limit',
        },
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
        payload: {},
      },
    ],
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.operations[0]).toMatchObject({
      assetSource: {
        kind: 'search',
        mode: 'metadata',
        filters: {
          country: 'South Africa',
          people: { match: 'any', names: ['Pierre', 'Aurelia'] },
        },
      },
    });
  }
});
```

- [ ] **Step 2: Write the failing DTO rejection tests for future source kinds**

Add:

```ts
it.each([
  ['selectionHandle', { kind: 'selectionHandle', selectionHandleId: factory.uuid() }],
  ['explicitAssets', { kind: 'explicitAssets', assetIds: [factory.uuid()] }],
])('rejects %s assetSource in operation planning until that source kind is supported here', (_label, assetSource) => {
  const result = parsePlan({
    summary: 'Unsupported source kind',
    operations: [
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add selected photos',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: factory.uuid(),
        assetSource,
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
        payload: {},
      },
    ],
  });

  expect(result.success).toBe(false);
  expectIssue(result, ['operations', 0, 'assetSource', 'kind'], 'Invalid input');
});
```

- [ ] **Step 3: Run DTO tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts -t "declarative search assetSource|selectionHandle assetSource|explicitAssets assetSource"
```

Expected: FAIL because operation planning still only accepts `previousSearch`.

- [ ] **Step 4: Update operation planning asset source schema**

In `server/src/dtos/agent-operation.dto.ts`, import `AgentAssetSourceInputSchema` and replace the local `agentAssetSourceInput` definition with a schema that accepts only `search` and `previousSearch`:

```ts
import { AgentAssetSourceInputSchema } from 'src/dtos/agent-asset-source.dto';
```

Then define:

```ts
const agentOperationPlanningAssetSourceInput = AgentAssetSourceInputSchema.superRefine((value, ctx) => {
  if (value.kind !== 'search' && value.kind !== 'previousSearch') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['kind'],
      message: 'Invalid input: expected "search" or "previousSearch"',
    });
  }
}).meta({ id: 'AgentOperationPlanningAssetSourceInput' }) as z.ZodType<
  Extract<AgentAssetSourceInput, { kind: 'search' | 'previousSearch' }>
>;
```

Use `agentOperationPlanningAssetSourceInput.optional()` in `assetSelection` and `coverAssetSelection`.

- [ ] **Step 5: Run DTO tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts -t "assetSource"
```

Expected: PASS. Existing mixed-mechanism tests must still pass.

## Task 2: Search Source Materializes Into Stable Plan Asset IDs

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`

- [ ] **Step 1: Write the failing South Africa source planning test**

In `server/src/services/agent-operation-plan.service.spec.ts`, add a test near the existing previousSearch materialization tests:

```ts
it('materializes assetSource.search server-side before storing a plan', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const albumId = newUuid();
  const pierreId = newUuid();
  const aureliaId = newUuid();
  const assetIds = [newUuid(), newUuid(), newUuid()];
  sessionRepository.getById.mockResolvedValue(session);
  assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
    status: 'success',
    filters: {
      country: 'South Africa',
      takenAfter: new Date('2026-01-01T00:00:00.000Z'),
      takenBefore: new Date('2026-02-01T00:00:00.000Z'),
      personIds: [pierreId, aureliaId],
      personMatchAny: true,
    },
    results: [],
  });
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })),
    hasNextPage: false,
  } as never);
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  const createdPlan = makePlan({
    sessionId: session.id,
    operations: [
      makeOperation({
        type: AgentOperationType.AlbumAddAssets,
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: albumId,
        temporaryTargetId: null,
        assetIds,
        payload: {},
      }),
    ],
  });
  planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

  await sut.proposeAlbumOperations(auth, session.id, {
    summary: 'Create South Africa people album',
    operations: [
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add January South Africa photos with Pierre or Aurelia',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: albumId,
        assetSource: {
          kind: 'search',
          mode: 'metadata',
          filters: {
            country: 'South Africa',
            takenAfter: '2026-01-01T00:00:00.000Z',
            takenBefore: '2026-02-01T00:00:00.000Z',
            people: { match: 'any', names: ['Pierre', 'Aurelia'] },
          },
          materialization: 'all-matches-with-limit',
        },
        payload: {},
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
      },
    ],
  });

  expect(assetSearchFilterResolverService.resolveDeclarativeFilters).toHaveBeenCalledWith(
    auth,
    session,
    expect.objectContaining({
      country: 'South Africa',
      people: { match: 'any', names: ['Pierre', 'Aurelia'] },
    }),
  );
  expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
    { page: 1, size: AgentOperationPlanService.maxAssetSelectionHandleAssets + 1 },
    expect.objectContaining({
      userIds: [auth.user.id],
      country: 'South Africa',
      personIds: [pierreId, aureliaId],
      personMatchAny: true,
    }),
  );
  expect(selectionHandleRepository.create).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      operations: [
        expect.objectContaining({
          assetIds,
          assetSource: undefined,
          assetSelectionHandleId: undefined,
        }),
      ],
    }),
  );
});
```

The worker must add `searchRepository`, `sharedSpaceRepository`, and `assetSearchFilterResolverService` mocks to the test setup before this compiles.

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "assetSource.search server-side"
```

Expected: FAIL because `assetSource.search` is not implemented in planning.

- [ ] **Step 3: Add constructor dependencies**

In `server/src/services/agent-operation-plan.service.ts`, import and inject:

```ts
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { AgentAssetSearchFilterResolverService } from 'src/services/agent-asset-search-filter-resolver.service';
import { buildAgentSearch } from 'src/services/agent-search-filter-mapper';
import { AgentDeclarativeAssetFilters } from 'src/types/agent-asset-source.types';
import { AgentSearchAssetsFilters } from 'src/types/agent-tool.types';
```

Add constructor params after `selectionHandleRepository`:

```ts
private readonly searchRepository: SearchRepository,
private readonly sharedSpaceRepository: SharedSpaceRepository,
private readonly assetSearchFilterResolverService: AgentAssetSearchFilterResolverService,
```

Update every manual `new AgentOperationPlanService(...)` in tests and `server/src/services/agent-runner-flow.integration.spec.ts` to pass these dependencies.

- [ ] **Step 4: Add search source materialization helpers**

In `AgentOperationPlanService`, make the cap constants public for tests:

```ts
static readonly maxAssetSelectionHandleAssets = 10_000;
static readonly maxCoverSelectionHandleAssets = 500;
```

Then add helpers:

```ts
private async resolveAssetSourceAssetIds(
  auth: AuthDto,
  session: AgentSession,
  toolName: AgentToolName,
  assetSource: AgentAssetSourceInput,
  selectionAudit: PlanningSelectionAudit,
) {
  if (assetSource.kind === 'previousSearch') {
    const selectionHandleId = await this.selectionHandleIdFromSearchSourceRef(auth, session, toolName, assetSource.sourceRef);
    return this.resolveSelectionHandleAssetIds(auth, session, selectionHandleId, selectionAudit, {
      toolName,
      sourceKind: 'previousSearch',
      sourceRef: assetSource.sourceRef,
    });
  }

  if (assetSource.kind === 'search') {
    return this.resolveSearchAssetSourceAssetIds(auth, session, assetSource, operation.type, selectionAudit);
  }

  throw new BadRequestException('Only assetSource.search and assetSource.previousSearch are supported for operation planning');
}
```

Add:

```ts
private async resolveSearchAssetSourceAssetIds(
  auth: AuthDto,
  session: AgentSession,
  assetSource: Extract<AgentAssetSourceInput, { kind: 'search' }>,
  operationType: AgentOperationType,
  selectionAudit: PlanningSelectionAudit,
): Promise<string[]> {
  const mode = assetSource.mode ?? 'metadata';
  if (mode === 'smart') {
    throw new BadRequestException('assetSource.search smart mode is not supported for operation planning yet');
  }

  if (mode !== 'metadata' && !assetSource.query) {
    throw new BadRequestException(`assetSource.search ${mode} mode requires query`);
  }

  const declarativeFilters = assetSource.filters ?? {};
  const resolution = await this.assetSearchFilterResolverService.resolveDeclarativeFilters(
    auth,
    session,
    declarativeFilters,
  );

  if (resolution.status === 'denied') {
    throw new BadRequestException(resolution.reason);
  }

  if (resolution.status === 'needs_clarification') {
    throw new BadRequestException(resolution.message);
  }

  const cap = this.getSearchSourceMaterializationCap(operationType);
  const request = this.buildSearchSourceRequest(assetSource, resolution.filters, cap);
  const timelineSpaceIds = await this.getSearchTimelineSpaceIds(auth, session, resolution.filters);
  const search = buildAgentSearch({
    userId: auth.user.id,
    request,
    scope: {
      ...this.getRepositoryScope(auth, session),
      timelineSpaceIds,
    },
  });

  if (search.kind === 'smart') {
    throw new BadRequestException('assetSource.search smart mode is not supported for operation planning yet');
  }

  const result = await this.searchRepository.searchMetadata(search.pagination, search.options);
  const assetIds = result.items.map((asset) => asset.id);
  const materialization = assetSource.materialization ?? 'all-matches-with-limit';
  if (materialization === 'all-matches-with-limit' && (assetIds.length > cap || result.hasNextPage)) {
    throw new BadRequestException(
      `Search matched more than ${cap} assets. Narrow the search or use materialization "bounded-page" with a smaller limit.`,
    );
  }

  if (assetIds.length === 0) {
    throw new BadRequestException('Search source did not match any assets');
  }

  if (assetIds.length > cap) {
    throw new BadRequestException(`Search matched more than ${cap} assets. Narrow the search or use a smaller bounded page.`);
  }

  selectionAudit.push({
    assetCount: assetIds.length,
    sampleAssetIds: assetIds.slice(0, 25),
    sourceKind: 'search',
    declarativeFilters,
    resolvedFilters: resolution.filters,
  });

  return assetIds;
}
```

Add helper request construction:

```ts
private buildSearchSourceRequest(
  assetSource: Extract<AgentAssetSourceInput, { kind: 'search' }>,
  filters: AgentSearchAssetsFilters,
  cap: number,
) {
  const materialization = assetSource.materialization ?? 'all-matches-with-limit';
  const limit =
    materialization === 'all-matches-with-limit'
      ? cap + 1
      : (assetSource.limit ?? 100);

  return {
    mode: assetSource.mode ?? 'metadata',
    query: assetSource.query,
    filters,
    limit,
    page: materialization === 'all-matches-with-limit' ? 1 : (assetSource.page ?? 1),
    order: assetSource.order ?? 'desc',
    detail: 'ids' as const,
    fields: [],
  };
}

private getSearchSourceMaterializationCap(operationType: AgentOperationType) {
  return operationType === AgentOperationType.AlbumSetCover
    ? AgentOperationPlanService.maxCoverSelectionHandleAssets
    : AgentOperationPlanService.maxAssetSelectionHandleAssets;
}
```

Add helpers equivalent to `AgentToolService`:

```ts
private getRepositoryScope(auth: AuthDto, session: AgentSession) {
  const plan = session.permissionPlanSnapshot;
  return {
    owned: plan.assetScope.owned,
    sharedSpaces: plan.assetScope.sharedSpaces,
    locked: plan.assetScope.locked && auth.session?.hasElevatedPermission === true,
  };
}

private async getSearchTimelineSpaceIds(auth: AuthDto, session: AgentSession, filters: AgentSearchAssetsFilters) {
  const plan = session.permissionPlanSnapshot;
  const hasAlbumFilter = (filters.albumIds?.length ?? 0) > 0;
  const shouldLoadTimelineSpaceIds =
    !filters.spaceId &&
    plan.assetScope.sharedSpaces &&
    (filters.withSharedSpaces === true || !plan.assetScope.owned || hasAlbumFilter);

  if (!shouldLoadTimelineSpaceIds) {
    return [];
  }

  const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
  return spaceRows.map((row) => row.spaceId);
}

private getSelectionHandleExpiresAt(session: AgentSession) {
  const minutes = session.permissionPlanSnapshot.limits.expiresInMinutes ?? 60;
  return new Date(Date.now() + minutes * 60_000);
}
```

- [ ] **Step 5: Run the focused test and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "assetSource.search server-side"
```

Expected: PASS.

## Task 3: Search Source Edge Cases

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`

- [ ] **Step 1: Write failing edge-case tests**

Add these tests near the successful source search test:

```ts
it('does not create a plan when assetSource.search resolves to no assets', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  sessionRepository.getById.mockResolvedValue(session);
  assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
    status: 'success',
    filters: {},
    results: [],
  });
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
  searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false } as never);

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Empty search',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add nothing',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSource: { kind: 'search', filters: { country: 'Nowhere' } },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    }),
  ).rejects.toThrow('Search source did not match any assets');

  expect(selectionHandleRepository.create).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});

it('does not create a plan when assetSource.search needs clarification', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  sessionRepository.getById.mockResolvedValue(session);
  assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
    status: 'needs_clarification',
    filters: {},
    results: [],
    message: 'Multiple visible person matches found',
  });

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Ambiguous search',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add ambiguous photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSource: { kind: 'search', filters: { people: { match: 'any', names: ['Pierre'] } } },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    }),
  ).rejects.toThrow('Multiple visible person matches found');

  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});

it('does not create a plan when assetSource.search is over the planning cap', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const assetIds = Array.from({ length: AgentOperationPlanService.maxAssetSelectionHandleAssets + 1 }, () => newUuid());
  sessionRepository.getById.mockResolvedValue(session);
  assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
    status: 'success',
    filters: {},
    results: [],
  });
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })),
    hasNextPage: false,
  } as never);

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Too broad search',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add too many photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    }),
  ).rejects.toThrow(`Search matched more than ${AgentOperationPlanService.maxAssetSelectionHandleAssets} assets`);

  expect(selectionHandleRepository.create).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});

it('forces all-matches assetSource.search materialization to the first page', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const albumId = newUuid();
  const assetIds = [newUuid(), newUuid()];
  sessionRepository.getById.mockResolvedValue(session);
  assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
    status: 'success',
    filters: {},
    results: [],
  });
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })),
    hasNextPage: false,
  } as never);
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  planRepository.createReplacementRevision.mockResolvedValue(
    makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.AlbumAddAssets,
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          temporaryTargetId: null,
          assetIds,
          payload: {},
        }),
      ],
    }),
  );

  await sut.proposeAlbumOperations(auth, session.id, {
    summary: 'All matches source',
    operations: [
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add all matches',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: albumId,
        assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit', page: 2 },
        payload: {},
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
      },
    ],
  });

  expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
    { page: 1, size: AgentOperationPlanService.maxAssetSelectionHandleAssets + 1 },
    expect.any(Object),
  );
});

it('rejects smart assetSource.search mode with a clear planning error', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  sessionRepository.getById.mockResolvedValue(session);

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Smart source',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add smart matches',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSource: { kind: 'search', mode: 'smart', query: 'beach' },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    }),
  ).rejects.toThrow('assetSource.search smart mode is not supported for operation planning yet');

  expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
});

it('rejects text assetSource.search modes without a query before broad search', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  sessionRepository.getById.mockResolvedValue(session);

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Description source without query',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add description matches',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSource: { kind: 'search', mode: 'description', filters: { country: 'South Africa' } },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    }),
  ).rejects.toThrow('assetSource.search description mode requires query');

  expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
});

it('rejects metadata assetSource.search with a query before broad search', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  sessionRepository.getById.mockResolvedValue(session);

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Metadata query source',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add query matches',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSource: { kind: 'search', mode: 'metadata', query: 'beach' },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    }),
  ).rejects.toThrow('query is only supported for smart, description, ocr, and filename search modes');

  expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
});

it('rejects unsupported assetSource.search ordering before broad search', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  sessionRepository.getById.mockResolvedValue(session);

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Unsupported order source',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add ordered matches',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSource: { kind: 'search', filters: {}, order: 'relevance' },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    }),
  ).rejects.toThrow('relevance order search is not available yet');

  expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
});

it('rejects locked visibility search sources without elevated locked access before broad search', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  sessionRepository.getById.mockResolvedValue(session);

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Locked source',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add locked photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSource: {
            kind: 'search',
            filters: { visibility: AssetVisibility.Locked },
            materialization: 'all-matches-with-limit',
          },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    }),
  ).rejects.toThrow('Locked photos require elevated permission');

  expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
});

it('allows bounded-page assetSource.search materialization even when more pages exist', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const albumId = newUuid();
  const assetIds = [newUuid(), newUuid()];
  sessionRepository.getById.mockResolvedValue(session);
  assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
    status: 'success',
    filters: {},
    results: [],
  });
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })),
    hasNextPage: true,
  } as never);
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  planRepository.createReplacementRevision.mockResolvedValue(
    makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.AlbumAddAssets,
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          temporaryTargetId: null,
          assetIds,
          payload: {},
        }),
      ],
    }),
  );

  await sut.proposeAlbumOperations(auth, session.id, {
    summary: 'Bounded source',
    operations: [
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add first page',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: albumId,
        assetSource: { kind: 'search', materialization: 'bounded-page', limit: 2, page: 3 },
        payload: {},
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
      },
    ],
  });

  expect(searchRepository.searchMetadata).toHaveBeenCalledWith({ page: 3, size: 2 }, expect.any(Object));
  expect(selectionHandleRepository.create).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({ operations: [expect.objectContaining({ assetIds })] }),
  );
});
```

- [ ] **Step 2: Run edge-case tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "no assets|needs clarification|planning cap|smart assetSource|text assetSource|bounded-page"
```

Expected: FAIL until the edge checks exist.

- [ ] **Step 3: Implement missing edge checks**

Patch `resolveSearchAssetSourceAssetIds()` so it:

- checks `mode === 'smart'` before resolver calls;
- checks text modes (`description`, `ocr`, `filename`) have a non-empty `query` before resolver calls;
- checks metadata mode rejects `query` before resolver calls;
- checks non-smart ordering rejects `asc`/`relevance` before resolver calls;
- checks locked visibility rejects requests without locked scope plus elevated permission before resolver calls;
- throws resolver `denied` and `needs_clarification` messages before search;
- checks `assetIds.length === 0`;
- checks `assetIds.length > maxAssetSelectionHandleAssets || result.hasNextPage` only for `all-matches-with-limit`;
- checks the operation-specific cap before selection handle creation, including `maxCoverSelectionHandleAssets` for `AlbumSetCover`;
- allows `bounded-page` to materialize a page even when `result.hasNextPage` is true;
- creates no selection handle for direct `assetSource.search`, including when any later access or persistence check fails.

- [ ] **Step 4: Run edge-case tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "assetSource.search|no assets|needs clarification|planning cap|smart assetSource|text assetSource|bounded-page"
```

Expected: PASS.

## Task 4: Audit Metadata And Stable Apply

**Files:**

- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Write failing source audit metadata test**

Extend the successful source search test or add a focused test:

```ts
expect(toolCallRepository.create).toHaveBeenCalledWith(
  expect.objectContaining({
    assetCount: assetIds.length,
    redactedRequestMetadata: expect.objectContaining({
      assetCount: assetIds.length,
      assetIds: assetIds.slice(0, 25),
      assetIdsSample: assetIds.slice(0, 25),
      selectionHandles: [
        expect.objectContaining({
          assetCount: assetIds.length,
          sampleAssetIds: assetIds.slice(0, 25),
          sourceKind: 'search',
          declarativeFilters: expect.objectContaining({
            country: 'South Africa',
            people: { match: 'any', names: ['Pierre', 'Aurelia'] },
          }),
          resolvedFilters: expect.objectContaining({
            country: 'South Africa',
            personIds: [pierreId, aureliaId],
            personMatchAny: true,
          }),
        }),
      ],
    }),
  }),
);
```

- [ ] **Step 2: Write failing stable apply test**

Add:

```ts
it('applies a plan created from assetSource.search without reading the source handle again', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid(), newUuid()];
  const { session, albumId, operation, plan } = makeAddAssetsPlan(auth, assetIds);
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue(plan);
  planRepository.completeApply.mockImplementation((_planId, updates) =>
    Promise.resolve(applyUpdatesToPlan(plan, updates)),
  );
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  albumService.addAssets.mockResolvedValue(assetIds.map((id) => ({ id, success: true })) as never);

  await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [operation.id],
    planRevision: plan.revision,
  });

  expect(selectionHandleRepository.getValidForPlanning).not.toHaveBeenCalled();
  expect(albumService.addAssets).toHaveBeenCalledWith(auth, albumId, { ids: assetIds });
});
```

If existing apply test helpers require a different mock shape, adapt to the local patterns but keep the assertion that apply uses persisted `assetIds` and does not read the source handle.

- [ ] **Step 3: Run audit/apply tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "sourceKind: 'search'|applies a plan created from assetSource.search"
```

Expected: FAIL until audit types and source audit metadata are extended.

- [ ] **Step 4: Extend audit metadata types**

In `server/src/types/agent-tool.types.ts`, update `AgentToolOperationPlanRequestMetadata.selectionHandles[]`:

```ts
selectionHandles?: Array<{
  id?: string;
  assetCount: number;
  sampleAssetIds: string[];
  sourceKind?: 'selectionHandle' | 'previousSearch' | 'search';
  sourceRef?: AgentSearchSourceRef;
  declarativeFilters?: AgentDeclarativeAssetFilters;
  resolvedFilters?: AgentSearchAssetsFilters;
}>;
```

Import `AgentDeclarativeAssetFilters` as a type from `src/types/agent-asset-source.types`.

- [ ] **Step 5: Ensure source audit metadata is included**

The `selectionAudit.push()` in `resolveSearchAssetSourceAssetIds()` must include:

```ts
{
  assetCount: assetIds.length,
  sampleAssetIds: assetIds.slice(0, 25),
  sourceKind: 'search',
  declarativeFilters,
  resolvedFilters: resolution.filters,
}
```

Do not include all asset IDs in this audit object.

- [ ] **Step 6: Write the no-orphan-handle regression**

Add a focused test:

```ts
it('does not create a search-source audit handle when later access validation denies the plan', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const albumId = newUuid();
  const assetIds = [newUuid(), newUuid()];
  sessionRepository.getById.mockResolvedValue(session);
  assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
    status: 'success',
    filters: {},
    results: [],
  });
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })),
    hasNextPage: false,
  } as never);
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set());

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Denied source-backed plan',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add searched photos to inaccessible album',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    }),
  ).rejects.toThrow('One or more target albums are not accessible');

  expect(searchRepository.searchMetadata).toHaveBeenCalled();
  expect(selectionHandleRepository.create).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});
```

Expected red failure before the implementation change: direct source search creates a transient handle before later access validation rejects the plan.

- [ ] **Step 7: Run audit/apply tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "assetSource.search|applies a plan created from assetSource.search"
```

Expected: PASS.

## Task 5: Full Verification And Commit

**Files:**

- Verify all modified files.

- [ ] **Step 1: Run focused Slice 6 tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run adjacent regression suites**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-asset-search-filter-resolver.service.spec.ts src/services/agent-search-filter-mapper.spec.ts src/repositories/search.repository.spec.ts src/services/agent-runner-flow.integration.spec.ts
```

Expected: PASS. This proves Slice 5 resolver behavior and runner construction still hold.

- [ ] **Step 3: Run static checks**

Run:

```bash
pnpm --dir server exec tsc --noEmit --pretty false
pnpm --dir server run lint
git diff --check
```

Expected: PASS.

- [ ] **Step 4: Commit and push**

Run:

```bash
git status --short
git add docs/superpowers/plans/2026-05-22-pi-agent-declarative-planning-sources-slice-6.md \
  server/src/dtos/agent-operation.dto.ts \
  server/src/dtos/agent-operation.dto.spec.ts \
  server/src/services/agent-operation-plan.service.ts \
  server/src/services/agent-operation-plan.service.spec.ts \
  server/src/services/agent-runner-flow.integration.spec.ts \
  server/src/types/agent-tool.types.ts
git commit -m "feat(server): plan Pi operations from search sources"
git push
```

## Edge Case Checklist

- `assetSource.search` is accepted for asset-bearing operations.
- `assetSource.search` is still rejected for non-asset operations through existing source mechanism validation.
- `assetSource.search` mixed with `assetIds` or `assetSelectionHandleId` is rejected.
- `assetSource.selectionHandle` and `assetSource.explicitAssets` remain rejected in operation planning.
- Declarative people OR filters resolve to OR-compatible search filters.
- Ambiguous or missing declarative filters return a no-plan error before search.
- Permission-denied declarative filters return a no-plan error before search.
- Empty search results create no plan.
- Over-broad all-match searches create no plan and ask for narrowing or bounded-page.
- `bounded-page` materializes only the requested page.
- Persisted operations contain materialized `assetIds`, not `assetSource`.
- Apply does not depend on source refs or selection handles after plan creation.
- Planning audit contains counts, sample IDs, declarative filters, and resolved filters without dumping every ID.

## Plan Review Notes

- TDD order is explicit for DTO acceptance, search materialization, edge cases, audit metadata, stable apply, and final verification.
- The plan implements only Slice 6. High-level album/space/batch tools remain in later slices.
- The plan intentionally rejects smart search source planning in Slice 6 and names that behavior in tests, avoiding hidden ML dependencies.
- Existing `previousSearch` and `assetSelectionHandleId` behavior remains covered by existing tests and by the focused regression suite.
