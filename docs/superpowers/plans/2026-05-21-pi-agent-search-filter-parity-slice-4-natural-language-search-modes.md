# Pi Agent Search Filter Parity Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pi `searchAssets` execute `smart`, `ocr`, `description`, and `filename` search modes with structured filters while preserving the assistant session permission plan.

**Architecture:** Extend the existing Pi search mapper so metadata-like text modes route through Gallery metadata search fields (`ocr`, `description`, `originalFileName`) and smart mode routes through `SearchRepository.searchSmart` with a CLIP embedding. Permission validation remains in `AgentToolService`, and every returned asset is still hydrated through `getAgentMetadataByIds` and checked against the immutable assistant permission plan.

**Tech Stack:** NestJS services, Zod DTO schemas, Kysely search repositories, Machine Learning text embeddings, Vitest, generated MCP docs/prompt sync.

---

## Scope

Implement only Slice 4 from `docs/superpowers/specs/2026-05-20-pi-agent-search-filter-parity-design.md`.

Included:

- Execute `mode: "description"` as Gallery metadata search with `description: request.query`.
- Execute `mode: "filename"` as Gallery metadata search with `originalFileName: request.query`.
- Execute `mode: "ocr"` as Gallery metadata search with `ocr: request.query`; do not fall back to filename or description fields.
- Execute `mode: "smart"` as Gallery smart search with `query`, CLIP embedding, structured filters, permission-scoped `userIds` and `timelineSpaceIds`, and relevance ordering when no order is supplied.
- Preserve Slice 2 deterministic filters and Slice 3 resolver-first behavior.
- Keep `page > 1`, `order: "asc"` for non-smart modes, and broad large-result workflow changes out of this slice.
- Update MCP examples and prompt guidance so models know text modes are now available.

Excluded:

- Do not implement page continuation beyond page 1. That is Slice 6.
- Do not implement new UI plan-preview behavior.
- Do not add new mutation tools.
- Do not expose raw filesystem fields, original paths, checksums, preview paths, or storage internals.

## File Structure

- Modify `server/src/dtos/agent-tool.dto.ts`
  - Preserve default `order: "desc"` for metadata-like modes.
  - Leave `order` unset for smart searches when the model omits it so Gallery relevance ordering is used.
- Modify `server/src/services/agent-search-filter-mapper.ts`
  - Add `buildAgentSearch` or equivalent helper that returns either metadata search execution or smart search execution.
  - Map `description`, `filename`, and `ocr` queries onto distinct repository fields.
  - Map smart queries onto `SmartSearchOptions` using the same permission-scoped filters as metadata search.
- Modify `server/src/services/agent-search-filter-mapper.spec.ts`
  - Add TDD coverage for every text mode, distinct OCR/description/filename fields, smart relevance ordering, and shared-space smart scope.
- Modify `server/src/services/agent-tool.service.ts`
  - Inject `MachineLearningRepository`, `ConfigRepository`, `SystemMetadataRepository`, and `LoggingRepository`.
  - Validate smart search is enabled.
  - Encode smart queries with the configured CLIP model.
  - Dispatch metadata-like modes to `searchMetadata` and smart mode to `searchSmart`.
  - Keep returned asset permission checks and compact metadata hydration.
- Modify `server/src/services/agent-tool.service.spec.ts`
  - Replace “text mode unavailable” denial tests with executable mode tests.
  - Prove smart, OCR, description, and filename route to intended repository fields.
  - Prove search results stay permission-scoped and approved retry still works.
  - Reset the global config cache in `beforeEach` so smart-search config tests do not leak values between cases.
- Modify `server/src/services/agent-mcp-tool-contract.service.ts`
  - Add text-mode examples.
  - Update usage and correction hints to stop saying text modes are unavailable.
- Modify `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Add example-parse and correction-hint tests for text modes.
- Modify `server/src/services/agent-mcp-prompt.service.ts`
  - Include one compact OCR or smart search example only if it fits the prompt size limit.
- Modify `server/src/services/agent-mcp-prompt.service.spec.ts`
  - Update prompt expectations so text modes are advertised and “not available yet” is absent.
- Modify generated artifacts:
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`
- Modify manual instantiations if constructor dependencies change:
  - `server/src/services/agent-runner-flow.integration.spec.ts`

## Behavior Details

`searchAssets` request handling after this slice:

```ts
switch (request.mode ?? 'metadata') {
  case 'metadata':
    // existing Gallery metadata search filters only
    break;
  case 'description':
    // SearchRepository.searchMetadata(..., { ...filters, description: request.query })
    break;
  case 'filename':
    // SearchRepository.searchMetadata(..., { ...filters, originalFileName: request.query })
    break;
  case 'ocr':
    // SearchRepository.searchMetadata(..., { ...filters, ocr: request.query })
    break;
  case 'smart':
    // MachineLearningRepository.encodeText(request.query, configured CLIP model)
    // SearchRepository.searchSmart(..., { ...filters, query, embedding, maxDistance })
    break;
}
```

Smart search ordering rules:

- If `mode: "smart"` and the model omits `order`, do not pass `orderDirection`; Gallery ranks by embedding relevance.
- If `mode: "smart"` and `order: "relevance"`, do not pass `orderDirection`.
- If `mode: "smart"` and `order: "desc"`, pass `orderDirection: "desc"` to use Gallery's smart-search date ordering behavior.
- Reject `order: "asc"` until Slice 6 adds broader pagination/order coverage.

## Task 1: DTO And Mapper Contract

**Files:**

- Modify `server/src/dtos/agent-tool.dto.ts`
- Modify `server/src/dtos/agent-tool.dto.spec.ts`
- Modify `server/src/services/agent-search-filter-mapper.ts`
- Modify `server/src/services/agent-search-filter-mapper.spec.ts`

- [ ] **Step 1: Write failing DTO and mapper tests**

Add tests to `server/src/dtos/agent-tool.dto.spec.ts` near the `searchAssets` schema tests:

```ts
it('does not default smart search order when omitted so relevance ranking is used', () => {
  const result = AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse({
    mode: 'smart',
    query: 'beach sunset',
    filters: { city: 'Berlin' },
    limit: 25,
  });

  expect(result.success).toBe(true);
  expect(result.data).toEqual({
    mode: 'smart',
    query: 'beach sunset',
    filters: { city: 'Berlin' },
    limit: 25,
    page: 1,
  });
});

it('keeps metadata-like search order defaulted to desc', () => {
  const result = AgentReadToolRequestSchemas[AgentToolName.SearchAssets].parse({
    mode: 'ocr',
    query: 'invoice',
    filters: {},
    limit: 10,
  });

  expect(result.order).toBe('desc');
});
```

Add tests to `server/src/services/agent-search-filter-mapper.spec.ts`:

```ts
it('maps description mode to Gallery description metadata search only', () => {
  const result = buildAgentSearch({
    userId,
    request: {
      mode: 'description',
      query: 'summer trip',
      filters: { takenAfter: new Date('2026-05-01T00:00:00.000Z') },
      limit: 25,
      page: 1,
      order: 'desc',
    },
    scope: { owned: true, sharedSpaces: false, locked: false, timelineSpaceIds: [] },
  });

  expect(result.kind).toBe('metadata');
  expect(result.options).toEqual(expect.objectContaining({ description: 'summer trip' }));
  expect(result.options).not.toHaveProperty('ocr');
  expect(result.options).not.toHaveProperty('originalFileName');
});

it('maps OCR mode to Gallery OCR search only', () => {
  const result = buildAgentSearch({
    userId,
    request: { mode: 'ocr', query: 'invoice', filters: {}, limit: 10, page: 1, order: 'desc' },
    scope: { owned: true, sharedSpaces: false, locked: false, timelineSpaceIds: [] },
  });

  expect(result.kind).toBe('metadata');
  expect(result.options).toEqual(expect.objectContaining({ ocr: 'invoice' }));
  expect(result.options).not.toHaveProperty('description');
  expect(result.options).not.toHaveProperty('originalFileName');
});

it('maps filename mode to originalFileName metadata search only', () => {
  const result = buildAgentSearch({
    userId,
    request: { mode: 'filename', query: 'IMG_2026', filters: {}, limit: 10, page: 1, order: 'desc' },
    scope: { owned: true, sharedSpaces: false, locked: false, timelineSpaceIds: [] },
  });

  expect(result.kind).toBe('metadata');
  expect(result.options).toEqual(expect.objectContaining({ originalFileName: 'IMG_2026' }));
  expect(result.options).not.toHaveProperty('description');
  expect(result.options).not.toHaveProperty('ocr');
});

it('maps smart mode to smart search options with relevance ordering omitted', () => {
  const result = buildAgentSearch({
    userId,
    request: {
      mode: 'smart',
      query: 'beach sunset',
      filters: { city: 'Berlin', personIds: [personId], tagIds: [tagId] },
      limit: 5,
      page: 1,
    },
    scope: { owned: true, sharedSpaces: false, locked: false, timelineSpaceIds: [] },
    smartEmbedding: '[1,2,3]',
    smartMaxDistance: 0.75,
  });

  expect(result.kind).toBe('smart');
  expect(result.options).toEqual(
    expect.objectContaining({
      query: 'beach sunset',
      embedding: '[1,2,3]',
      maxDistance: 0.75,
      city: 'Berlin',
      personIds: [personId],
      tagIds: [tagId],
      userIds: [userId],
    }),
  );
  expect(result.options).not.toHaveProperty('orderDirection');
});

it('maps shared-space smart search to timeline space scope', () => {
  const result = buildAgentSearch({
    userId,
    request: {
      mode: 'smart',
      query: 'beach sunset',
      filters: { withSharedSpaces: true },
      limit: 5,
      page: 1,
    },
    scope: { owned: true, sharedSpaces: true, locked: false, timelineSpaceIds: [sharedSpaceId] },
    smartEmbedding: '[1,2,3]',
    smartMaxDistance: 0.75,
  });

  expect(result.kind).toBe('smart');
  expect(result.options).toEqual(expect.objectContaining({ userIds: [userId], timelineSpaceIds: [sharedSpaceId] }));
});
```

Run:

```bash
pnpm --dir server test src/dtos/agent-tool.dto.spec.ts src/services/agent-search-filter-mapper.spec.ts -- --runInBand
```

Expected: FAIL because smart order still defaults to `desc`, `buildAgentSearch` does not exist, and text modes are not mapped.

- [ ] **Step 2: Implement minimal DTO and mapper support**

In `server/src/dtos/agent-tool.dto.ts`, change the `AgentSearchAssetsToolRequestSchema.transform` block so smart mode omitted order remains unset:

```ts
const mode = value.mode ?? DEFAULT_SEARCH_MODE;
const order = value.order ?? (mode === 'smart' ? undefined : DEFAULT_SEARCH_ORDER);
const request = {
  mode,
  filters: value.filters ?? {},
  limit: value.limit ?? MAX_TOOL_LIMIT,
  page: value.page ?? DEFAULT_SEARCH_PAGE,
  ...(order === undefined ? {} : { order }),
};
```

In `server/src/services/agent-search-filter-mapper.ts`, keep `buildAgentMetadataSearch` exported for existing tests and add a new union builder:

```ts
export type AgentSearchBuildInput = AgentMetadataSearchBuildInput & {
  smartEmbedding?: string;
  smartMaxDistance?: number;
};

export type AgentSearchBuildResult =
  | { kind: 'metadata'; pagination: SearchPaginationOptions; options: AssetSearchOptions }
  | { kind: 'smart'; pagination: SearchPaginationOptions; options: SmartSearchOptions };

export const buildAgentSearch = (input: AgentSearchBuildInput): AgentSearchBuildResult => {
  const metadata = buildAgentMetadataSearch(input);
  const mode = input.request.mode ?? 'metadata';
  const query = input.request.query;

  if (mode === 'description') {
    return { kind: 'metadata', pagination: metadata.pagination, options: { ...metadata.options, description: query } };
  }

  if (mode === 'ocr') {
    return { kind: 'metadata', pagination: metadata.pagination, options: { ...metadata.options, ocr: query } };
  }

  if (mode === 'filename') {
    return {
      kind: 'metadata',
      pagination: metadata.pagination,
      options: { ...metadata.options, originalFileName: query },
    };
  }

  if (mode === 'smart') {
    if (!input.smartEmbedding) {
      throw new Error('smart search requires smartEmbedding');
    }

    const { originalFileName, description, ocr, orderDirection, ...baseOptions } = metadata.options;
    const smartOrder =
      input.request.order === 'asc' || input.request.order === 'desc' ? input.request.order : undefined;
    return {
      kind: 'smart',
      pagination: metadata.pagination,
      options: {
        ...baseOptions,
        query,
        embedding: input.smartEmbedding,
        maxDistance: input.smartMaxDistance,
        ...(smartOrder === undefined ? {} : { orderDirection: smartOrder }),
      },
    };
  }

  return { kind: 'metadata', pagination: metadata.pagination, options: metadata.options };
};
```

Also update `buildAgentMetadataSearch` so it does not hardcode `AssetOrder.Desc` for smart relevance behavior:

```ts
const orderDirection =
  request.mode === 'smart' && (request.order === undefined || request.order === 'relevance')
    ? undefined
    : AssetOrder.Desc;
```

Run:

```bash
pnpm --dir server test src/dtos/agent-tool.dto.spec.ts src/services/agent-search-filter-mapper.spec.ts -- --runInBand
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts server/src/services/agent-search-filter-mapper.ts server/src/services/agent-search-filter-mapper.spec.ts
git commit -m "feat: map pi text search modes"
```

## Task 2: Execute Text Search Modes In AgentToolService

**Files:**

- Modify `server/src/services/agent-tool.service.ts`
- Modify `server/src/services/agent-tool.service.spec.ts`
- Modify `server/src/services/agent-runner-flow.integration.spec.ts`

- [ ] **Step 1: Write failing service tests**

In `server/src/services/agent-tool.service.spec.ts`, replace the `denies future search contract fields` text-mode cases with executable tests:

```ts
import { clearConfigCache } from 'src/utils/config';

// Inside beforeEach:
clearConfigCache();

it.each([
  ['description', 'birthday', { description: 'birthday' }],
  ['ocr', 'invoice', { ocr: 'invoice' }],
  ['filename', 'IMG_2026', { originalFileName: 'IMG_2026' }],
] satisfies Array<[AgentSearchAssetsMode, string, Record<string, string>]>)(
  'executes %s search through the intended Gallery metadata field',
  async (mode, query, expectedOptions) => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

    const result = await sut.searchAssets(auth, session.id, {
      mode,
      query,
      filters: {},
      limit: 1,
      page: 1,
      order: 'desc',
    });

    expect(result.status).toBe('success');
    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      { page: 1, size: 1 },
      expect.objectContaining(expectedOptions),
    );
    expect(searchRepository.searchSmart).not.toHaveBeenCalled();
  },
);

it('returns an empty successful OCR result when the OCR index has no matches', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false });

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'ocr',
    query: 'invoice',
    filters: {},
    limit: 5,
    page: 1,
    order: 'desc',
  });

  expect(result).toEqual(expect.objectContaining({ status: 'success', returnedCount: 0, hasMore: false }));
  expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
    { page: 1, size: 5 },
    expect.objectContaining({ ocr: 'invoice' }),
  );
  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
});

it('executes smart search through Gallery smart search with encoded query and structured filters', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const tagId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.tag.checkOwnerAccess.mockResolvedValue(new Set([tagId]));
  machineLearningRepository.encodeText.mockResolvedValue('[1, 2, 3]');
  systemMetadataRepository.get.mockResolvedValue({
    machineLearning: { clip: { modelName: 'ViT-B-32__openai', maxDistance: 0.75 } },
  });
  searchRepository.searchSmart.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'smart',
    query: 'beach sunset',
    filters: { tagIds: [tagId] },
    limit: 1,
    page: 1,
  });

  expect(result.status).toBe('success');
  expect(machineLearningRepository.encodeText).toHaveBeenCalledWith('beach sunset', {
    modelName: 'ViT-B-32__openai',
    language: undefined,
  });
  expect(searchRepository.searchSmart).toHaveBeenCalledWith(
    { page: 1, size: 1 },
    expect.objectContaining({
      query: 'beach sunset',
      embedding: '[1, 2, 3]',
      maxDistance: 0.75,
      tagIds: [tagId],
      userIds: [auth.user.id],
    }),
  );
  expect(searchRepository.searchSmart).toHaveBeenCalledWith(
    expect.any(Object),
    expect.not.objectContaining({ orderDirection: expect.anything() }),
  );
  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
});

it('keeps shared-space smart search permission-scoped to visible timeline spaces', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const spaceId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
  machineLearningRepository.encodeText.mockResolvedValue('[1, 2, 3]');
  systemMetadataRepository.get.mockResolvedValue({
    machineLearning: { clip: { modelName: 'ViT-B-32__openai', maxDistance: 0.75 } },
  });
  searchRepository.searchSmart.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

  await sut.searchAssets(auth, session.id, {
    mode: 'smart',
    query: 'beach',
    filters: { withSharedSpaces: true },
    limit: 1,
    page: 1,
  });

  expect(searchRepository.searchSmart).toHaveBeenCalledWith(
    { page: 1, size: 1 },
    expect.objectContaining({ userIds: [auth.user.id], timelineSpaceIds: [spaceId] }),
  );
});
```

Also keep the existing denial cases for metadata query, `page: 2`, `order: "asc"`, and `order: "relevance"` on non-smart modes.

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts -- --runInBand
```

Expected: FAIL because constructor dependencies and text-mode execution are not implemented.

- [ ] **Step 2: Implement execution**

In `server/src/services/agent-tool.service.ts`:

1. Import new dependencies and helpers:

```ts
import { LoggingRepository } from 'src/repositories/logging.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { buildAgentSearch } from 'src/services/agent-search-filter-mapper';
import { getConfig } from 'src/utils/config';
import { isSmartSearchEnabled } from 'src/utils/misc';
```

2. Add constructor parameters after `searchRepository`:

```ts
private readonly loggingRepository: LoggingRepository,
private readonly configRepository: ConfigRepository,
private readonly machineLearningRepository: MachineLearningRepository,
private readonly systemMetadataRepository: SystemMetadataRepository,
```

3. Replace `getUnsupportedSearchModeReason` so text modes are allowed:

```ts
private getUnsupportedSearchModeReason(_mode: AgentSearchAssetsMode): string | null {
  return null;
}
```

4. Update `getUnsupportedSearchPagingReason`:

```ts
private getUnsupportedSearchPagingReason(
  mode: AgentSearchAssetsMode,
  page: number,
  order: AgentSearchAssetsOrder | undefined,
): string | null {
  if (page !== 1) {
    return 'page search is not available yet';
  }

  if (mode === 'smart') {
    return order === 'asc' ? 'asc order search is not available yet' : null;
  }

  if ((order ?? 'desc') !== 'desc') {
    return `${order} order search is not available yet`;
  }

  return null;
}
```

5. Add smart config helpers:

```ts
private async getSmartSearchConfig(): Promise<{ modelName: string; maxDistance: number }> {
  const { machineLearning } = await getConfig(
    {
      configRepo: this.configRepository,
      metadataRepo: this.systemMetadataRepository,
      logger: this.loggingRepository,
    },
    { withCache: true },
  );

  if (!isSmartSearchEnabled(machineLearning)) {
    throw new AgentToolDeniedError('Smart search is not enabled');
  }

  return {
    modelName: machineLearning.clip.modelName,
    maxDistance: machineLearning.clip.maxDistance,
  };
}
```

6. In `validateSearchRequest`, when mode is smart, call `await this.getSmartSearchConfig()` and convert `AgentToolDeniedError` into its message.

7. In `searchAssetsDescriptor().execute`, build and dispatch either metadata or smart search:

```ts
const smartConfig = request.mode === 'smart' ? await this.getSmartSearchConfig() : null;
const smartEmbedding =
  request.mode === 'smart'
    ? await this.machineLearningRepository.encodeText(request.query!, {
        modelName: smartConfig!.modelName,
        language: undefined,
      })
    : undefined;
const search = buildAgentSearch({
  userId: auth.user.id,
  request,
  scope: {
    ...this.getRepositoryScope(auth, session.permissionPlanSnapshot),
    timelineSpaceIds,
  },
  smartEmbedding,
  smartMaxDistance: smartConfig?.maxDistance,
});
const result =
  search.kind === 'smart'
    ? await this.searchRepository.searchSmart(search.pagination, search.options)
    : await this.searchRepository.searchMetadata(search.pagination, search.options);
```

8. Update manual test constructors with mocks for the new repository dependencies.

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts src/services/agent-runner-flow.integration.spec.ts -- --runInBand
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/services/agent-runner-flow.integration.spec.ts
git commit -m "feat: execute pi text search modes"
```

## Task 3: MCP Examples, Correction Hints, And Generated Docs

**Files:**

- Modify `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify `server/src/services/agent-mcp-prompt.service.ts`
- Modify `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify generated:
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Write failing contract and prompt tests**

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, update the text-search expectations:

```ts
it('documents executable text search modes with valid examples', () => {
  const search = sut.listReadToolContracts().find((contract) => contract.name === AgentToolName.SearchAssets);
  const exampleNames = search?.examples.map((example) => example.name);

  expect(search?.usage).toContain('Use mode smart, description, ocr, or filename with query for text search');
  expect(search?.usage).not.toContain('Text modes, later pages, and non-desc order are not available yet');
  expect(exampleNames).toEqual(
    expect.arrayContaining(['smart-text-search', 'ocr-text-search', 'description-text-search', 'filename-text-search']),
  );

  for (const example of search?.examples ?? []) {
    AgentReadToolRequestSchemas[AgentToolName.SearchAssets].parse(example.arguments);
  }
});

it('gives a targeted hint when metadata mode includes query', () => {
  const correction = sut.getValidationCorrection({
    toolName: AgentToolName.SearchAssets,
    issues: [
      { path: 'query', message: 'query is only supported for smart, description, ocr, and filename search modes' },
    ],
  });

  expect(correction?.mistakeId).toBe('search-query-with-metadata-mode');
  expect(correction?.hint).toContain('Use mode smart, description, ocr, or filename with query');
  expect(correction?.hint).not.toContain('not available yet');
});
```

In `server/src/services/agent-mcp-prompt.service.spec.ts`, update the search prompt test:

```ts
it('teaches Pi that text search modes are executable', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toContain('Text search: smart/ocr/description/filename require query');
  expect(prompt).not.toContain('Text modes, later pages, and non-desc order are not available yet');
  expect(prompt).toContain('Only page 1');
});
```

Run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts -- --runInBand
```

Expected: FAIL because contract and prompt still say text modes are unavailable.

- [ ] **Step 2: Update contract and prompt**

In `server/src/services/agent-mcp-tool-contract.service.ts`:

- Change `searchAssetsContract.usage` to:

```ts
'Put deterministic metadata filters under filters. Use searchAssets with structured filters for people, spaces, visibility, dates, albums, tags, camera fields, ratings, and media types when IDs are already known. Use mode smart, description, ocr, or filename with query for text search. Only page 1 is executable; non-desc order is only supported for smart relevance. Use only toolCallId when retrying a Gallery-approved search.';
```

- Add an argument mode:

```ts
{
  name: 'text-search',
  description: 'Search visible assets with a text query plus optional structured filters.',
  requiredFields: ['mode', 'query'],
  forbiddenFields: ['toolCallId'],
  whenToUse: 'Use for smart, OCR, description, or filename search when the user asks for text inside photos, descriptions, filenames, or visual concepts.',
}
```

- Add four examples:

```ts
{
  name: 'smart-text-search',
  description: 'Search by visual meaning with optional filters.',
  arguments: { mode: 'smart', query: 'beach sunset', filters: { withSharedSpaces: true }, limit: 25 },
},
{
  name: 'ocr-text-search',
  description: 'Search OCR text from screenshots or documents.',
  arguments: { mode: 'ocr', query: 'invoice', filters: { takenAfter: '2024-01-01T00:00:00.000Z' }, limit: 25 },
},
{
  name: 'description-text-search',
  description: 'Search asset descriptions.',
  arguments: { mode: 'description', query: 'birthday', filters: {}, limit: 25 },
},
{
  name: 'filename-text-search',
  description: 'Search original filenames.',
  arguments: { mode: 'filename', query: 'IMG_2026', filters: {}, limit: 25 },
}
```

- Change `search-query-with-metadata-mode.hint` to:

```ts
'Use mode smart, description, ocr, or filename with query. Keep deterministic date, location, person, tag, album, camera, rating, media, space, and visibility filters under filters.';
```

In `server/src/services/agent-mcp-prompt.service.ts`, keep the prompt compact by changing the read line to include:

```ts
Text search: smart/ocr/description/filename require query.
```

Run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts -- --runInBand
```

Expected: PASS and prompt length remains <= 2850.

- [ ] **Step 3: Regenerate MCP docs and prompt**

Run:

```bash
pnpm --dir server build
pnpm --dir server sync:agent-mcp-prompt
pnpm --dir server sync:agent-mcp-docs
```

Then run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts -- --runInBand
```

Expected: PASS and committed generated files match renderer output.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
git commit -m "docs: teach pi text search modes"
```

## Task 4: Slice Verification And Formatting

**Files:**

- No new production files expected beyond Tasks 1-3.

- [ ] **Step 1: Run focused slice tests**

```bash
pnpm --dir server test src/dtos/agent-tool.dto.spec.ts src/services/agent-search-filter-mapper.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-runner-flow.integration.spec.ts -- --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run CI lint/type gates used for this branch**

```bash
pnpm --dir server check
pnpm --dir server lint
pnpm --dir server format
pnpm --dir docs format
git diff --check
```

Expected: PASS. If `format` fails only because files need formatting, run `pnpm --dir server format:fix` and/or `pnpm --dir docs format:fix`, then rerun the check command.

- [ ] **Step 3: Commit formatting if needed**

```bash
git status --short
git add server/src docs/superpowers agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
git commit -m "style: format pi text search slice"
```

Expected: Commit only if formatting changed tracked files.

---

## Plan Review Checklist

- TDD order is explicit for every behavior: DTO/mapper tests, service tests, contract/prompt tests, then implementation.
- Every Slice 4 spec requirement is covered:
  - Smart search routes to `searchSmart` with query and filters.
  - OCR does not fall back to filename search.
  - Description and filename modes remain distinct.
  - Empty query stays rejected by the existing DTO schema.
  - Results stay permission-scoped through agent scope mapping and returned-asset checks.
  - Shared-space smart search is covered.
- Edge cases are covered:
  - Smart omitted order uses relevance by omitting `orderDirection`.
  - OCR no-match behavior is represented by repository returning empty results from the existing search response path.
  - Filename partial queries map to `originalFileName`.
  - Text query plus date/person/tag filters map through the same filter mapper.
  - Shared-space smart search includes `timelineSpaceIds`.
- Future slices are not implemented here:
  - No page 2 support.
  - No large result UI changes.
  - No capability matrix updates beyond docs required for text-mode behavior.
