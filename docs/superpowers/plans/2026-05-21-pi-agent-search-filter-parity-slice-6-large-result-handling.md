# Pi Agent Search Filter Parity Slice 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pi `searchAssets` safe and useful for hundreds or thousands of assets by enabling bounded page continuation, surfacing `hasMore`, and locking in large-plan UI/apply regressions.

**Architecture:** Keep Gallery's existing one-based search pagination as the execution model. `searchAssets` will accept later pages for supported modes, return only the requested bounded page, expose continuation in the tool response summary, and teach MCP clients to repeat the same mode/query/filters/order/limit with `nextPage`. Large plan review stays client-side virtualized and sparse, while apply continues to validate concrete selected IDs at execution time and report partial bulk failures.

**Tech Stack:** NestJS services, Zod DTO schemas, Kysely search repositories, Svelte/Vitest UI tests, generated MCP docs/prompt sync.

---

## Scope

Implement only Slice 6 from `docs/superpowers/specs/2026-05-20-pi-agent-search-filter-parity-design.md`.

Included:

- Allow `searchAssets` page values greater than 1 for supported search modes.
- Keep `order: "desc"` as the only executable non-smart ordering.
- Keep smart search relevance ordering when `order` is omitted or `order: "relevance"` is used.
- Make result truncation visible through `hasMore`, `nextPage`, and completed tool-call `responseSummary`.
- Update MCP registry descriptions, contracts, generated docs, and generated runner prompt to describe page continuation accurately.
- Add UI regressions proving plan preview/review stays bounded for 10,000 assets.
- Add apply regressions proving sparse exclusions work for large plans and stale asset pages fail safely with clear partial/failure reporting.

Excluded:

- Do not add opaque cursor tokens.
- Do not add expensive total-count queries.
- Do not implement non-desc ordering.
- Do not apply unbounded search queries directly.
- Do not change the operation-plan data model.
- Do not implement Slice 7's broader example/correction-hint coverage beyond removing page-unavailable guidance that becomes false in this slice.

## File Structure

- Modify `server/src/services/agent-tool.service.ts`
  - Remove the page-1-only execution denial.
  - Add a search response summary helper that appends page-continuation guidance when `hasMore` and `nextPage` are present.
- Modify `server/src/services/agent-tool.service.spec.ts`
  - Add red tests for later metadata pages, terminal pages, smart page continuation, and broad "all" requests that still return a bounded page.
  - Remove the obsolete denial expectation for `page: 2`.
- Modify `server/src/services/agent-mcp-tool-registry.service.ts`
  - Update the `page` property description to say how to continue with `nextPage`.
- Modify `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  - Replace the page-1-only assertion with a continuation assertion.
- Modify `server/src/services/agent-mcp-tool-contract.service.ts`
  - Update search usage text.
  - Add a `metadata-next-page-search` example.
  - Replace the page-unavailable correction hint with a page-continuation hint.
- Modify `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Assert the contract no longer says later pages are deferred.
  - Assert page-continuation guidance and examples parse against the live schema.
- Modify generated artifacts:
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`
- Modify `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts`
  - Add sparse 10,000-asset exclusion regression for "user revises a large plan after excluding a subset".
- Modify `web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts`
  - Add component-level regression proving 10,000-asset review does not mount every thumbnail.
- Modify `server/src/services/agent-operation-plan.service.spec.ts`
  - Add large sparse apply regression with partial bulk result reporting.
  - Add stale-before-apply regression where a selected asset becomes inaccessible and no mutation runs.

## Behavior Details

Page continuation contract after this slice:

```ts
const firstPage = await searchAssets({
  mode: 'metadata',
  filters: { isFavorite: true },
  limit: 50,
  page: 1,
  order: 'desc',
});

if (firstPage.hasMore && firstPage.nextPage) {
  const secondPage = await searchAssets({
    mode: 'metadata',
    filters: { isFavorite: true },
    limit: 50,
    page: Number(firstPage.nextPage),
    order: 'desc',
  });
}
```

Completed search tool-call summary behavior:

```ts
private getSearchResponseSummary(result: {
  assets: AgentAssetMetadata[];
  hasMore: boolean;
  nextPage: string | null;
}): string {
  const summary = this.getReturnedMetadataSummary(result.assets.length);
  return result.hasMore && result.nextPage
    ? `${summary}; more results available on page ${result.nextPage}`
    : summary;
}
```

## Task 1: Search Pagination Execution

**Files:**

- Modify `server/src/services/agent-tool.service.ts`
- Modify `server/src/services/agent-tool.service.spec.ts`

- [ ] **Step 1: Write failing tests for later metadata pages and visible continuation**

Add these tests near `returns search page metadata and stores defaulted request metadata without absent query` in `server/src/services/agent-tool.service.spec.ts`:

Add `AssetOrder` to the `src/enum` import list at the top of the file:

```ts
import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  AssetOrder,
  AssetType,
  AssetVisibility,
} from 'src/enum';
```

```ts
it('executes later metadata search pages and makes continuation visible', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid(), newUuid()];
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({
      limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 10_000, maxAssetsPerSession: 10_000 },
    }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })) as never,
    hasNextPage: true,
  });
  assetRepository.getAgentMetadataByIds.mockResolvedValue(assetIds.map((id) => makeMetadata(id)) as never);

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { isFavorite: true },
    limit: 2,
    page: 2,
    order: 'desc',
  });

  expect(result).toEqual({
    status: 'success',
    toolCall: expect.objectContaining({
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Returned metadata for 2 assets; more results available on page 3',
    }),
    assets: [expect.objectContaining({ id: assetIds[0] }), expect.objectContaining({ id: assetIds[1] })],
    returnedCount: 2,
    hasMore: true,
    nextPage: '3',
  });
  expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
    { page: 2, size: 2 },
    expect.objectContaining({ isFavorite: true, orderDirection: AssetOrder.Desc, userIds: [auth.user.id] }),
  );
  expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
    expect.objectContaining({
      redactedRequestMetadata: {
        mode: 'metadata',
        filters: { isFavorite: true },
        limit: 2,
        page: 2,
        order: 'desc',
      },
    }),
    expect.any(Object),
    AgentToolDataClass.Metadata,
    expect.any(Number),
  );
});

it('returns terminal search pages without continuation text', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

  const result = await sut.searchAssets(auth, session.id, {
    filters: { isNotInAlbum: true },
    limit: 50,
    page: 3,
    order: 'desc',
  });

  expect(result).toEqual(
    expect.objectContaining({
      status: 'success',
      returnedCount: 1,
      hasMore: false,
      nextPage: null,
      toolCall: expect.objectContaining({ responseSummary: 'Returned metadata for 1 asset' }),
    }),
  );
  expect(searchRepository.searchMetadata).toHaveBeenCalledWith({ page: 3, size: 50 }, expect.any(Object));
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts -- --runInBand
```

Expected:

- `executes later metadata search pages and makes continuation visible` fails with the current page-2 denial.
- `returns terminal search pages without continuation text` fails with the current page-3 denial.

- [ ] **Step 3: Implement metadata page continuation and response summary**

In `server/src/services/agent-tool.service.ts`, replace the search response summary line:

```ts
responseSummary: (result) => this.getReturnedMetadataSummary(result.assets.length),
```

with:

```ts
responseSummary: (result) => this.getSearchResponseSummary(result),
```

Add the helper near `getReturnedMetadataSummary`:

```ts
private getSearchResponseSummary(result: {
  assets: AgentAssetMetadata[];
  hasMore: boolean;
  nextPage: string | null;
}): string {
  const summary = this.getReturnedMetadataSummary(result.assets.length);
  return result.hasMore && result.nextPage
    ? `${summary}; more results available on page ${result.nextPage}`
    : summary;
}
```

Remove the page denial from `getUnsupportedSearchPagingReason`:

```ts
private getUnsupportedSearchPagingReason(
  _page: number,
  order: AgentSearchAssetsOrder,
  mode: AgentSearchAssetsMode,
): string | null {
  if (mode === 'smart') {
    return order === 'asc' ? 'asc order search is not available yet' : null;
  }

  if (order !== 'desc') {
    return `${order} order search is not available yet`;
  }

  return null;
}
```

In `server/src/services/agent-tool.service.spec.ts`, remove this obsolete denial case from the future-field denial `it.each`:

```ts
[{ mode: 'metadata', filters: {}, limit: 5, page: 2, order: 'desc' }, 'page search is not available yet'],
```

- [ ] **Step 4: Verify Task 1 is green**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts -- --runInBand
```

Expected: PASS for `agent-tool.service.spec.ts`.

- [ ] **Step 5: Commit Task 1**

```bash
git add server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts
git commit -m "feat: continue pi search pages"
```

## Task 2: Smart Page Continuation And Broad Result Bounds

**Files:**

- Modify `server/src/services/agent-tool.service.spec.ts`

- [ ] **Step 1: Write failing tests for smart page continuation and broad bounded searches**

Add these tests near the smart search tests in `server/src/services/agent-tool.service.spec.ts`:

```ts
it('executes later smart search pages while preserving relevance ordering', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  systemMetadataRepository.get.mockResolvedValue({
    machineLearning: { clip: { modelName: 'ViT-Test', maxDistance: 0.42 } },
  } as never);
  machineLearningRepository.encodeText.mockResolvedValue('[1, 2, 3]');
  searchRepository.searchSmart.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: true });
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'smart',
    query: 'beach sunset',
    filters: { isFavorite: true },
    limit: 25,
    page: 2,
  });

  expect(result).toEqual(
    expect.objectContaining({
      status: 'success',
      returnedCount: 1,
      hasMore: true,
      nextPage: '3',
      toolCall: expect.objectContaining({
        responseSummary: 'Returned metadata for 1 asset; more results available on page 3',
      }),
    }),
  );
  expect(searchRepository.searchSmart).toHaveBeenCalledWith(
    { page: 2, size: 25 },
    expect.objectContaining({
      query: 'beach sunset',
      embedding: '[1, 2, 3]',
      isFavorite: true,
      userIds: [auth.user.id],
    }),
  );
  expect(searchRepository.searchSmart).toHaveBeenCalledWith(
    expect.any(Object),
    expect.not.objectContaining({ orderDirection: expect.anything() }),
  );
});

it('keeps broad all-assets requests bounded and exposes hasMore guidance', async () => {
  const auth = AuthFactory.create();
  const assetIds = Array.from({ length: 3 }, () => newUuid());
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({
      limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 10_000, maxAssetsPerSession: 10_000 },
    }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })) as never,
    hasNextPage: true,
  });
  assetRepository.getAgentMetadataByIds.mockResolvedValue(assetIds.map((id) => makeMetadata(id)) as never);

  const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 3 });

  expect(result).toEqual(
    expect.objectContaining({
      returnedCount: 3,
      hasMore: true,
      nextPage: '2',
      toolCall: expect.objectContaining({
        responseSummary: 'Returned metadata for 3 assets; more results available on page 2',
      }),
    }),
  );
  expect(searchRepository.searchMetadata).toHaveBeenCalledWith({ page: 1, size: 3 }, expect.any(Object));
});
```

- [ ] **Step 2: Run tests and verify the expected failure**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts -- --runInBand
```

Expected:

- Before Task 1 implementation these tests fail on page denial.
- After Task 1 they should pass without more production changes. If they fail, fix only the pagination/summary behavior, not unrelated search semantics.

- [ ] **Step 3: Commit Task 2**

If Task 2 only added tests and they pass, commit the tests:

```bash
git add server/src/services/agent-tool.service.spec.ts
git commit -m "test: cover pi large search pagination"
```

## Task 3: MCP Page Continuation Guidance

**Files:**

- Modify `server/src/services/agent-mcp-tool-registry.service.ts`
- Modify `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Modify `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify generated artifacts:
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Write failing MCP guidance tests**

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, replace the stale page-property assertion with:

```ts
page: expect.objectContaining({
  description: expect.stringContaining('Use the returned nextPage value as page'),
}),
```

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, add:

```ts
it('documents executable search page continuation', () => {
  const search = sut.getReadToolContract(AgentToolName.SearchAssets);

  expect(search?.description).toContain('bounded result pages');
  expect(search?.usage).toContain(
    'repeat the same mode, query, filters, order, and limit using the returned nextPage value as page',
  );
  expect(search?.usage).not.toContain('Only page 1');
  expect(search?.usage).not.toContain('later pages and non-desc order are not available yet');
  expect(search?.examples.map((example) => example.name)).toContain('metadata-next-page-search');
});

it('parses the search next-page example against the live schema', () => {
  const search = sut.getReadToolContract(AgentToolName.SearchAssets);
  const example = search?.examples.find((candidate) => candidate.name === 'metadata-next-page-search');

  expect(example).toBeDefined();
  expect(AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse(example?.arguments).success).toBe(true);
});

it('uses page correction hints to explain nextPage instead of denying later pages', () => {
  const search = sut.getReadToolContract(AgentToolName.SearchAssets);
  const hint = search?.commonMistakes.find((mistake) => mistake.id === 'search-page-continuation');

  expect(hint?.hint).toContain('Use the returned nextPage value');
  expect(hint?.hint).not.toContain('Only page 1');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts -- --runInBand
```

Expected:

- Registry test fails because the page description still says only the first page is executable.
- Contract tests fail because usage still says later pages are unavailable and the new example/hint does not exist.

- [ ] **Step 3: Update MCP registry and contract text**

In `server/src/services/agent-mcp-tool-registry.service.ts`, update `propertyDescriptions.page`:

```ts
page: 'One-based result page. Use the returned nextPage value as page to continue the same search with the same mode, query, filters, order, and limit.',
```

In `server/src/services/agent-mcp-tool-contract.service.ts`, update `searchAssetsContract.description`:

```ts
description:
  'Find assets using Gallery text search or metadata filters for people, spaces, visibility, dates, albums, tags, camera fields, ratings, media types, and bounded result pages.',
```

Update `searchAssetsContract.usage`:

```ts
usage:
  'Put deterministic metadata search filters under filters. Known ID filters: people, spaces, visibility, dates, albums, tags, camera fields, ratings, and media types. Use returned personIds or spaceId plus spacePersonIds, then propose operation plans with the returned asset IDs. Use mode smart, description, ocr, or filename with query for text search. Search responses are bounded; when hasMore is true, repeat the same mode, query, filters, order, and limit using the returned nextPage value as page.',
```

Add this example after `metadata-page-search`:

```ts
{
  name: 'metadata-next-page-search',
  description: 'Continue a previous metadata search using the returned nextPage value.',
  arguments: {
    mode: 'metadata',
    filters: {
      takenAfter: '2026-05-01T00:00:00.000Z',
      takenBefore: '2026-05-18T23:59:59.999Z',
      city: 'Berlin',
      country: 'Germany',
    },
    limit: 50,
    page: 2,
    order: 'desc',
  },
},
```

Replace the old page-unavailable mistake with:

```ts
{
  id: 'search-page-continuation',
  match: { issuePath: 'page' },
  hint:
    'Use the returned nextPage value as page, and keep the same mode, query, filters, order, and limit from the previous bounded search.',
  exampleName: 'metadata-next-page-search',
},
```

- [ ] **Step 4: Regenerate MCP docs and prompt**

Run:

```bash
pnpm --dir server build
pnpm --dir server sync:agent-mcp-docs
pnpm --dir server sync:agent-mcp-prompt
```

Expected:

- `docs/superpowers/generated/pi-agent-mcp-tools.md` updates page guidance and includes `metadata-next-page-search`.
- `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs` updates search guidance.

- [ ] **Step 5: Verify Task 3**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts -- --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add \
  server/src/services/agent-mcp-tool-registry.service.ts \
  server/src/services/agent-mcp-tool-registry.service.spec.ts \
  server/src/services/agent-mcp-tool-contract.service.ts \
  server/src/services/agent-mcp-tool-contract.service.spec.ts \
  agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs \
  docs/superpowers/generated/pi-agent-mcp-tools.md
git commit -m "docs: teach pi search page continuation"
```

## Task 4: Large Plan Preview Regressions

**Files:**

- Modify `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts`
- Modify `web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts`

- [ ] **Step 1: Write failing or guardrail tests for sparse revision and virtualized render**

In `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts`, add:

```ts
it('keeps 10,000 asset exclusions sparse when a user revises a large plan', () => {
  const ids = assetIds(10_000);
  const excludedIds = ['asset-0001', 'asset-0999', 'asset-4999', 'asset-7000', 'asset-9999'];
  const state = applyAgentPlanBulkItemSelection({
    state: {},
    operationId: 'operation-1',
    allAssetIds: ids,
    targetAssetIds: excludedIds,
    selected: false,
  });

  expect(state['operation-1']).toEqual({
    itemKind: 'asset',
    mode: 'allExcept',
    itemIds: excludedIds,
  });
  expect(getAgentPlanSparseSelectedCount(ids.length, state['operation-1'])).toBe(9995);
});
```

In `web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts`, add:

```ts
it('does not mount every thumbnail for a 10,000-photo plan review', () => {
  render(AgentPlanItemReview, {
    props: defaultProps({
      item: item(Array.from({ length: 10_000 }, (_, index) => `asset-${index.toString().padStart(4, '0')}`)),
      viewportHeight: 360,
      itemSize: 96,
      columnCount: 6,
      overscanRows: 1,
    }),
  });

  expect(screen.getByText('10,000 of 10,000 selected')).toBeInTheDocument();
  expect(screen.getAllByTestId('agent-plan-item-thumbnail')).toHaveLength(30);
  expect(screen.queryByRole('checkbox', { name: 'Include photo 10000' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run UI tests and verify behavior**

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts' 'src/routes/(user)/assistant/agent-plan-item-review.spec.ts'
```

Expected:

- These may already pass because earlier visual-plan slices added virtualization and sparse state. If they pass on the first run, record that they are guardrail regressions for Slice 6 rather than new failing behavior.
- If a test fails, fix only the bounded rendering or sparse-selection helper behavior.

- [ ] **Step 3: Commit Task 4**

```bash
git add \
  'web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts' \
  'web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts'
git commit -m "test: guard pi large plan review scaling"
```

## Task 5: Large Apply And Stale Page Safety

**Files:**

- Modify `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Write failing or guardrail apply tests**

Add these tests near the existing sparse `allExcept` apply tests in `server/src/services/agent-operation-plan.service.spec.ts`:

```ts
it('applies a large add-assets plan with sparse exclusions and records bulk partial failures', async () => {
  const auth = AuthFactory.create();
  const albumId = newUuid();
  const assetIds = Array.from({ length: 1000 }, () => newUuid());
  const excludedAssetId = assetIds[999];
  const selectedAssetIds = assetIds.slice(0, 999);
  const failedAssetId = selectedAssetIds[998];
  const successfulAssetIds = selectedAssetIds.slice(0, 998);
  const { session, albumId, operation, plan } = makeAddAssetsPlan(auth, assetIds);

  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockImplementation(async (_planId, updates) => ({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      {
        ...operation,
        ...updates[0],
      },
    ],
  }));
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(selectedAssetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(selectedAssetIds));
  albumService.addAssets.mockResolvedValue([
    ...successfulAssetIds.map((id) => ({ id, success: true })),
    { id: failedAssetId, success: false, error: BulkIdErrorReason.DUPLICATE },
  ]);

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [operation.id],
    itemSelections: {
      [operation.id]: { itemKind: 'asset', mode: 'allExcept', itemIds: [excludedAssetId] },
    },
    planRevision: plan.revision,
  });

  expect(result.status).toBe(AgentOperationApplyStatus.Failed);
  expect(result.failedOperationIds).toEqual([operation.id]);
  expect(albumService.addAssets).toHaveBeenCalledWith(auth, albumId, { ids: selectedAssetIds });
  expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
    expect.objectContaining({
      id: operation.id,
      status: AgentOperationStatus.Failed,
      result: expect.objectContaining({
        albumId,
        assetIds: successfulAssetIds,
        assetResults: expect.arrayContaining([
          { id: successfulAssetIds[0], success: true },
          { id: failedAssetId, success: false, error: BulkIdErrorReason.DUPLICATE },
        ]),
      }),
      error: 'Failed to add 1 asset(s)',
    }),
  ]);
});

it('fails safely without mutating when a large search page becomes stale before apply', async () => {
  const auth = AuthFactory.create();
  const albumId = newUuid();
  const assetIds = Array.from({ length: 1000 }, () => newUuid());
  const staleAssetId = assetIds[500];
  const readableAssetIds = new Set(assetIds.filter((id) => id !== staleAssetId));
  const { session, albumId, operation, plan } = makeAddAssetsPlan(auth, assetIds);

  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockImplementation(async (_planId, updates) => ({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [{ ...operation, ...updates[0] }],
  }));
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(readableAssetIds);
  assetRepository.getAgentReadableIds.mockResolvedValue(readableAssetIds);

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [operation.id],
    planRevision: plan.revision,
  });

  expect(result.status).toBe(AgentOperationApplyStatus.Failed);
  expect(result.failedOperationIds).toEqual([operation.id]);
  expect(albumService.addAssets).not.toHaveBeenCalled();
  expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
    expect.objectContaining({
      id: operation.id,
      status: AgentOperationStatus.Failed,
      error: 'One or more assets are not accessible',
    }),
  ]);
});
```

- [ ] **Step 2: Run the apply tests and verify behavior**

Run:

```bash
pnpm --dir server test src/services/agent-operation-plan.service.spec.ts -- --runInBand
```

Expected:

- These may already pass because apply already validates selected concrete IDs and preserves bulk-id results. If they pass on the first run, keep them as Slice 6 guardrails.
- If they fail, fix only sparse selection resolution, access validation, or bulk-result mapping needed for these cases.

- [ ] **Step 3: Commit Task 5**

```bash
git add server/src/services/agent-operation-plan.service.spec.ts
git commit -m "test: cover pi large plan apply safety"
```

## Task 6: Slice Verification

**Files:**

- No production files beyond Tasks 1-5.

- [ ] **Step 1: Run focused server tests**

```bash
pnpm --dir server test \
  src/services/agent-tool.service.spec.ts \
  src/services/agent-operation-plan.service.spec.ts \
  src/services/agent-mcp-tool-registry.service.spec.ts \
  src/services/agent-mcp-tool-contract.service.spec.ts \
  src/services/agent-mcp-prompt.service.spec.ts \
  src/services/agent-mcp-docs.service.spec.ts \
  -- --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run focused web tests**

```bash
pnpm --dir web test --run \
  'src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts' \
  'src/routes/(user)/assistant/agent-plan-item-review.spec.ts'
```

Expected: PASS.

- [ ] **Step 3: Run quality gates**

```bash
pnpm --dir server check
pnpm --dir server lint
pnpm --dir web check
pnpm --dir web lint
pnpm --dir server format
pnpm --dir web format
pnpm --dir docs format
git diff --check
```

Expected: all commands pass.

- [ ] **Step 4: Commit formatting changes if needed**

If formatting commands changed files:

```bash
git add .
git commit -m "style: format pi large search slice"
```

- [ ] **Step 5: Push the completed slice**

```bash
git push
```

Expected: branch `explore/pi-agent-brainstorm` is updated on `origin`.

## Self-Review Checklist

- TDD order is explicit for server pagination, MCP guidance, UI guardrails, and apply guardrails.
- Edge case "search returns exactly one page" is covered by terminal-page search.
- Edge case "search returns more than one page" is covered by metadata/smart `hasMore` and `nextPage`.
- Edge case "user asks for all with thousands of results" is covered by broad bounded search and the max-10,000 contract.
- Edge case "search page becomes stale before plan apply" is covered by the stale asset apply test.
- Edge case "user revises a large plan after excluding a subset" is covered by sparse 10,000-asset selection and apply tests.
- Plan preview eager-render risk is covered by component-level virtualized render tests.
- MCP docs do not keep false page-1-only guidance after implementation.
