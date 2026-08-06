# Pi Agent Handle-First Tool Contract Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `searchAssets` always return a server-side selection handle and stop exposing search-derived asset UUID arrays in provider-visible search responses.

**Architecture:** Keep raw asset IDs inside repositories, selection handle persistence, and plan internals. Change the search tool boundary so every search creates a handle, response detail is normalized to handle/summary/metadata, and model-facing search payloads contain counts, handle IDs, source refs, and optional ID-free samples. Defer prompt/docs redaction, handle read tools, curation transforms, and planning hardening to later slices.

**Tech Stack:** NestJS service layer, Zod DTOs via `nestjs-zod`, Vitest unit tests, TypeScript.

---

## Slice Scope

Implement only Slice 1 from `docs/superpowers/specs/2026-05-27-pi-agent-handle-first-tool-contract-design.md`.

In scope:

- `searchAssets` always calls `AgentSelectionHandleRepository.create()`, including zero-result and one-result searches.
- `createSelectionHandle: false` is accepted as compatibility input but cannot disable handle creation.
- Request `detail: "ids"` remains accepted as a compatibility alias.
- Successful provider-visible search responses use `detail: "handle"` for compact searches and never contain top-level `assetIds`.
- Search response samples use handle-local `itemRef` values and metadata fields, not asset UUIDs.
- Search response metadata stored on `agent_tool_call.redactedResponseMetadata` uses handle IDs, source refs, counts, and `resultSize`; it must not include `assetIds` or `selectionHandleSampleAssetIds`.
- Budget truncation preserves the handle and never reports `assetIds` as an omitted field.

Out of scope:

- Prompt/generated MCP docs updates. Those are Slice 2.
- `readSelectionMetadata`. That is Slice 3.
- `curateSelection`. That is Slice 4.
- Planning raw-ID rejection. That is Slice 5.
- Search limit rebalance. That is Slice 6.

## Files

- Modify: `server/src/types/agent-tool.types.ts`
  - Split request and response detail types.
  - Add ID-free search sample types.
  - Remove provider-visible sample asset IDs from search response metadata.
- Modify: `server/src/dtos/agent-tool.dto.ts`
  - Keep request parsing compatible with `detail: "ids"`.
  - Encode successful search responses without top-level `assetIds`, `assets`, or selection-handle `sampleAssetIds`.
  - Add an ID-free `AgentSelectionSample` schema.
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
  - Red tests for the new response contract and `detail: "ids"` compatibility alias.
- Modify: `server/src/services/agent-tool.service.ts`
  - Always create a selection handle.
  - Build handle-only search results.
  - Map optional metadata samples to `itemRef` rows.
  - Update response summaries, metadata, result sizing, and truncation.
- Modify: `server/src/services/agent-tool.service.spec.ts`
  - Red tests for mandatory handles, false flag compatibility, zero/one/many results, summary/metadata ID-free samples, and truncation.

## Proposed Types

Use these shapes unless the surrounding code requires small naming adjustments:

```ts
export type AgentSearchAssetsRequestDetail = 'ids' | 'handle' | 'summary' | 'metadata';
export type AgentSearchAssetsDetail = 'handle' | 'summary' | 'metadata';

export type AgentSearchAssetsSelectionHandleResult = {
  id: string;
  sourceRef: AgentSearchSourceRef;
  assetCount: number;
  sourceToolCallId: string | null;
  expiresAt: Date;
};

export type AgentSearchAssetsSampleItem = {
  itemRef: string;
  type?: AssetType;
  originalFileName?: string;
  localDateTime?: Date;
  fileCreatedAt?: Date;
  fileModifiedAt?: Date;
  isFavorite?: boolean;
  visibility?: AssetVisibility;
  exifInfo?: AgentSearchAssetExif | null;
  tags?: Array<{ value: string; color: string | null }>;
};

export type AgentSearchAssetsSample = {
  sampleSize: number;
  items: AgentSearchAssetsSampleItem[];
};
```

`AgentSearchAssetsSelectionHandle` can remain the internal repository-backed shape with `sampleAssetIds`; do not expose `sampleAssetIds` in `AgentSearchAssetsToolResponseDto`.

## Task 1: DTO And Type Contract

**Files:**

- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/dtos/agent-tool.dto.ts`
- Test: `server/src/dtos/agent-tool.dto.spec.ts`

- [ ] **Step 1: Write failing DTO tests for handle-first search responses**

Add these tests inside `describe('expanded agent tool response DTOs', ...)` in `server/src/dtos/agent-tool.dto.spec.ts`:

```ts
it('encodes handle-first compact search responses without asset ids', () => {
  const handleId = factory.uuid();
  const toolCallId = factory.uuid();
  const sourceRef = `asset-source:search:${handleId}` as const;

  const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode({
    status: 'success',
    toolCall: makeToolCall({ id: toolCallId, toolName: AgentToolName.SearchAssets }),
    summary: 'Created a selection handle for 1 asset',
    detail: 'handle',
    selectionHandle: {
      id: handleId,
      sourceRef,
      assetCount: 1,
      sourceToolCallId: toolCallId,
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
    },
    returnedCount: 1,
    hasMore: false,
    nextPage: null,
    resultSize: makeResultSize({ returnedItems: 1 }),
  });

  expect(encoded.success).toBe(true);
  if (!encoded.success || encoded.data.status !== 'success') {
    return;
  }

  expect(encoded.data.detail).toBe('handle');
  expect(encoded.data).not.toHaveProperty('assetIds');
  expect(encoded.data).not.toHaveProperty('assets');
  expect(encoded.data.selectionHandle).not.toHaveProperty('sampleAssetIds');
  expect(JSON.stringify(encoded.data)).not.toContain('"assetIds"');
});

it('rejects legacy search success responses that expose assetIds', () => {
  const assetId = factory.uuid();
  const parsed = AgentSearchAssetsToolResponseDto.schema.safeParse({
    status: 'success',
    toolCall: { ...makeEncodedToolCall(), toolName: AgentToolName.SearchAssets },
    summary: 'Returned 1 asset id',
    detail: 'ids',
    assetIds: [assetId],
    returnedCount: 1,
    hasMore: false,
    nextPage: null,
    resultSize: makeResultSize({ returnedItems: 1 }),
  });

  expect(parsed.success).toBe(false);
});

it('encodes ID-free search samples with handle-local item refs', () => {
  const handleId = factory.uuid();
  const toolCallId = factory.uuid();
  const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode({
    status: 'success',
    toolCall: makeToolCall({ id: toolCallId, toolName: AgentToolName.SearchAssets }),
    summary: 'Created a selection handle for 2 assets with 1 sample',
    detail: 'summary',
    selectionHandle: {
      id: handleId,
      sourceRef: `asset-source:search:${handleId}`,
      assetCount: 2,
      sourceToolCallId: toolCallId,
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
    },
    sample: {
      sampleSize: 1,
      items: [
        {
          itemRef: 'item:001',
          localDateTime: new Date('2026-05-14T12:00:00.000Z'),
          exifInfo: { city: 'Berlin', state: 'Berlin', country: 'Germany' },
          tags: [{ value: 'travel', color: null }],
        },
      ],
    },
    returnedCount: 2,
    hasMore: false,
    nextPage: null,
    resultSize: makeResultSize({ returnedItems: 2, estimatedBytes: 512 }),
  });

  expect(encoded.success).toBe(true);
  if (!encoded.success || encoded.data.status !== 'success') {
    return;
  }

  expect(encoded.data.sample?.items[0]).toMatchObject({
    itemRef: 'item:001',
    localDateTime: '2026-05-14T12:00:00.000Z',
  });
  expect(encoded.data.sample?.items[0]).not.toHaveProperty('id');
  expect(JSON.stringify(encoded.data.sample)).not.toMatch(
    /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
});
```

Update the existing request parsing test currently named `accepts search selection handle creation with compact samples` so it also proves `detail: "ids"` remains accepted as input:

```ts
expect(result.success).toBe(true);
if (result.success) {
  expect(result.data).toMatchObject({
    limit: 500,
    detail: 'ids',
    createSelectionHandle: true,
    sampleSize: 5,
  });
}
```

- [ ] **Step 2: Run DTO tests and confirm they fail for the expected reasons**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts -t "handle-first compact|legacy search success|ID-free search samples|selection handle creation"
```

Expected red failures:

- `detail: "handle"` is rejected because response detail only allows `ids | summary | metadata`.
- Response without `assetIds` is rejected because `assetIds` is required.
- `selectionHandle.sampleAssetIds` is still required.
- `sample.items` is rejected because current samples are arrays of asset metadata rows with `id`.

- [ ] **Step 3: Implement the DTO/type contract**

In `server/src/types/agent-tool.types.ts`:

```ts
export type AgentSearchAssetsRequestDetail = 'ids' | 'handle' | 'summary' | 'metadata';
export type AgentSearchAssetsDetail = 'handle' | 'summary' | 'metadata';
```

Change `AgentToolSearchAssetsRequestMetadata.detail` to use `AgentSearchAssetsRequestDetail`.

Add the ID-free result types from the "Proposed Types" section. Keep `AgentSearchAssetsSelectionHandle` as the internal type with `sampleAssetIds`.

Remove these fields from provider-visible search response metadata:

```ts
selectionHandleSampleAssetIds?: string[];
```

In `server/src/dtos/agent-tool.dto.ts`, split request and response detail schemas:

```ts
const AgentSearchAssetsRequestDetailSchema = z
  .enum(['ids', 'handle', 'summary', 'metadata'])
  .meta({ id: 'AgentSearchAssetsRequestDetail' });
const AgentSearchAssetsResponseDetailSchema = z
  .enum(['handle', 'summary', 'metadata'])
  .meta({ id: 'AgentSearchAssetsDetail' });
```

Use `AgentSearchAssetsRequestDetailSchema` in `AgentSearchAssetsToolRequestSchema`.

Replace `AgentSearchAssetsSelectionHandleSchema` with the provider-visible shape:

```ts
const AgentSearchAssetsSelectionHandleSchema = z
  .object({
    id: uuid,
    sourceRef: AgentSearchSourceRefSchema,
    assetCount: z.number().int().min(0),
    sourceToolCallId: uuid.nullable(),
    expiresAt: isoDatetimeToDate,
  })
  .meta({ id: 'AgentSearchAssetsSelectionHandle' });
```

Add an ID-free sample schema:

```ts
const AgentSearchAssetsSampleItemSchema = z
  .object({
    itemRef: z.string().regex(/^item:\d{3,}$/),
    type: AssetTypeSchema.optional(),
    originalFileName: z.string().optional(),
    localDateTime: isoDatetimeToDate.optional(),
    fileCreatedAt: isoDatetimeToDate.optional(),
    fileModifiedAt: isoDatetimeToDate.optional(),
    isFavorite: z.boolean().optional(),
    visibility: AssetVisibilitySchema.optional(),
    exifInfo: AgentAssetMetadataExifSchema.partial().nullable().optional(),
    tags: z.array(AgentAssetMetadataTagSchema.omit({ id: true })).optional(),
  })
  .meta({ id: 'AgentSearchAssetsSampleItem' });

const AgentSearchAssetsSampleSchema = z
  .object({
    sampleSize: z.number().int().min(0).max(MAX_SEARCH_SAMPLE_SIZE),
    items: z.array(AgentSearchAssetsSampleItemSchema).max(MAX_SEARCH_SAMPLE_SIZE),
  })
  .meta({ id: 'AgentSearchAssetsSample' });
```

Change `AgentSearchAssetsToolResponseSchema` success responses to:

```ts
z.strictObject({
  status: z.literal('success'),
  toolCall: AgentToolCallResponseSchema,
  summary,
  detail: AgentSearchAssetsResponseDetailSchema,
  selectionHandle: AgentSearchAssetsSelectionHandleSchema,
  sample: AgentSearchAssetsSampleSchema.optional(),
  returnedCount: z.number().int().min(0),
  hasMore: z.boolean(),
  nextPage: z.string().nullable(),
  resultSize: AgentToolResultSizeSchema,
  totalCount: z.number().int().min(0).optional(),
  approximateTotal: z.number().int().min(0).optional(),
}).meta({ id: 'AgentSearchAssetsToolSuccessResponse' });
```

Use `strictObject` so legacy `assetIds` and `assets` are rejected.

- [ ] **Step 4: Run DTO tests and confirm they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts -t "handle-first compact|legacy search success|ID-free search samples|selection handle creation"
```

Expected green result: the targeted tests pass.

- [ ] **Step 5: Commit DTO contract changes**

Run:

```bash
git add server/src/types/agent-tool.types.ts server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts
git commit -m "test: define handle-first search response contract"
```

## Task 2: Mandatory Search Handles In The Service

**Files:**

- Modify: `server/src/services/agent-tool.service.ts`
- Test: `server/src/services/agent-tool.service.spec.ts`

- [ ] **Step 1: Write failing service tests for mandatory handles and ID-free compact responses**

Rename the existing test `returns compact asset ids by default without metadata hydration` to `searchAssets creates a handle by default without metadata hydration` and change its assertions to:

```ts
selectionHandleRepository.create.mockResolvedValue({
  id: newUuid(),
  sessionId: session.id,
  userId: auth.user.id,
  sourceToolCallId: newUuid(),
  assetIds,
  assetCount: assetIds.length,
  sampleAssetIds: assetIds.slice(0, 25),
  expiresAt: new Date(now.getTime() + 60 * 60_000),
  createdAt: now,
  updateId: newUuid(),
});

const result = await sut.searchAssets(auth, session.id, {});

expect(selectionHandleRepository.create).toHaveBeenCalledWith({
  sessionId: session.id,
  userId: auth.user.id,
  sourceToolCallId: expect.any(String),
  assetIds,
  expiresAt: expect.any(Date),
});
expect(result).toEqual(
  expect.objectContaining({
    status: 'success',
    summary: 'Created a selection handle for 2 assets; more results available on page 2',
    detail: 'handle',
    returnedCount: 2,
    hasMore: true,
    nextPage: '2',
    selectionHandle: expect.objectContaining({ assetCount: 2 }),
  }),
);
expect(result).not.toHaveProperty('assetIds');
expect(result).not.toHaveProperty('assets');
expect(result).not.toHaveProperty('sample');
expect(JSON.stringify(result)).not.toContain(assetIds[0]);
expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
```

Add this default mock inside `beforeEach()` after the existing `selectionHandleRepository` assignment. It keeps existing non-focused search tests from crashing once the implementation starts creating handles for every search:

```ts
selectionHandleRepository.create.mockImplementation((dto) =>
  Promise.resolve({
    id: newUuid(),
    sessionId: dto.sessionId,
    userId: dto.userId,
    sourceToolCallId: dto.sourceToolCallId,
    assetIds: dto.assetIds,
    assetCount: dto.assetIds.length,
    sampleAssetIds: dto.assetIds.slice(0, 25),
    expiresAt: dto.expiresAt,
    createdAt: now,
    updateId: newUuid(),
  }),
);
```

Add a new test:

```ts
it('searchAssets ignores createSelectionHandle false and still returns a handle', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
  const handle = {
    id: newUuid(),
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: newUuid(),
    assetIds: [assetId],
    assetCount: 1,
    sampleAssetIds: [assetId],
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    createdAt: now,
    updateId: newUuid(),
  };
  sessionRepository.getById.mockResolvedValue(session);
  searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
  selectionHandleRepository.create.mockResolvedValue(handle);

  const result = await sut.searchAssets(auth, session.id, {
    filters: {},
    limit: 1,
    detail: 'ids',
    createSelectionHandle: false,
  });

  expect(selectionHandleRepository.create).toHaveBeenCalled();
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    return;
  }

  expect(result.detail).toBe('handle');
  expect(result.selectionHandle.id).toBe(handle.id);
  expect(result).not.toHaveProperty('assetIds');
  expect(JSON.stringify(result)).not.toContain(assetId);
});
```

Add a new test:

```ts
it('searchAssets creates handles for zero-result searches', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
  const handle = {
    id: newUuid(),
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: newUuid(),
    assetIds: [],
    assetCount: 0,
    sampleAssetIds: [],
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    createdAt: now,
    updateId: newUuid(),
  };
  sessionRepository.getById.mockResolvedValue(session);
  searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false });
  selectionHandleRepository.create.mockResolvedValue(handle);

  const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 10 });

  expect(selectionHandleRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({ assetIds: [], sessionId: session.id, userId: auth.user.id }),
  );
  expect(result).toEqual(
    expect.objectContaining({
      status: 'success',
      summary: 'Created a selection handle for 0 assets',
      detail: 'handle',
      returnedCount: 0,
      selectionHandle: expect.objectContaining({ assetCount: 0 }),
    }),
  );
});
```

- [ ] **Step 2: Run service tests and confirm the expected red failures**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "creates a handle by default|createSelectionHandle false|zero-result searches"
```

Expected red failures:

- `selectionHandleRepository.create` is not called unless `createSelectionHandle` is true.
- The response still has `detail: "ids"` and `assetIds`.
- Zero-result search does not create a handle.

- [ ] **Step 3: Implement mandatory handle creation and compact handle responses**

In `server/src/services/agent-tool.service.ts`, update the `searchAssetsDescriptor()` result type to remove `assetIds` and use the provider-visible handle/sample types:

```ts
{
  summary: string;
  detail: AgentSearchAssetsDetail;
  selectionHandle: AgentSearchAssetsSelectionHandleResult;
  sample?: AgentSearchAssetsSample;
  returnedCount: number;
  hasMore: boolean;
  nextPage: string | null;
  totalCount?: number;
  approximateTotal?: number;
}
```

Inside `execute`, always create the handle:

```ts
const selectionHandle = await this.selectionHandleRepository.create({
  sessionId: session.id,
  userId: auth.user.id,
  sourceToolCallId: toolCallId,
  assetIds,
  expiresAt: this.getSelectionHandleExpiresAt(session),
});
const responseHandle = this.mapSearchSelectionHandle(selectionHandle);
const responseDetail = this.normalizeSearchResponseDetail(normalizedRequest.detail);
const pageResult = {
  detail: responseDetail,
  selectionHandle: responseHandle,
  returnedCount: selectionHandle.assetCount,
  hasMore: result.hasNextPage,
  nextPage: result.hasNextPage ? String(normalizedRequest.page + 1) : null,
};
```

Add these helpers:

```ts
private normalizeSearchResponseDetail(detail: AgentSearchAssetsRequestDetail): AgentSearchAssetsDetail {
  return detail === 'ids' ? 'handle' : detail;
}

private mapSearchSelectionHandle(handle: AgentSearchAssetsSelectionHandle): AgentSearchAssetsSelectionHandleResult {
  return {
    id: handle.id,
    sourceRef: this.buildSearchSourceRef(handle.id),
    assetCount: handle.assetCount,
    sourceToolCallId: handle.sourceToolCallId,
    expiresAt: handle.expiresAt,
  };
}
```

Change response metadata to omit search IDs:

```ts
responseMetadata: (result) => ({
  selectionHandleIds: [result.selectionHandle.id],
  sourceRefs: [result.selectionHandle.sourceRef],
  selectionHandleAssetCount: result.selectionHandle.assetCount,
}),
resultAssetCount: (result) => result.selectionHandle.assetCount,
resultSize: (result) => ({
  returnedItems: result.selectionHandle.assetCount,
  hasMore: result.hasMore,
  nextPage: result.nextPage,
}),
```

Change compact response summaries to counts only:

```ts
private getSearchAssetsResponseSummary(result: {
  detail: AgentSearchAssetsDetail;
  selectionHandle: AgentSearchAssetsSelectionHandleResult;
  hasMore: boolean;
  nextPage: string | null;
  sampleCount?: number;
}) {
  const assetCount = result.selectionHandle.assetCount;
  const summary =
    result.detail === 'summary' && (result.sampleCount ?? 0) > 0
      ? `Created a selection handle for ${assetCount} ${assetCount === 1 ? 'asset' : 'assets'} with ${
          result.sampleCount ?? 0
        } ${(result.sampleCount ?? 0) === 1 ? 'sample' : 'samples'}`
      : `Created a selection handle for ${assetCount} ${assetCount === 1 ? 'asset' : 'assets'}`;
  return result.hasMore && result.nextPage ? `${summary}; more results available on page ${result.nextPage}` : summary;
}
```

- [ ] **Step 4: Run service tests and confirm mandatory handle cases pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "creates a handle by default|createSelectionHandle false|zero-result searches"
```

Expected green result: the targeted tests pass.

- [ ] **Step 5: Commit mandatory handle service behavior**

Run:

```bash
git add server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts
git commit -m "feat: make search assets return handles by default"
```

## Task 3: ID-Free Summary And Metadata Samples

**Files:**

- Modify: `server/src/services/agent-tool.service.ts`
- Test: `server/src/services/agent-tool.service.spec.ts`

- [ ] **Step 1: Write failing tests for ID-free samples**

Update `returns field-selected summary samples and caps sampleSize to returned ids` so it expects the new sample shape:

```ts
expect(result).toEqual(
  expect.objectContaining({
    status: 'success',
    summary: 'Created a selection handle for 2 assets with 2 samples',
    detail: 'summary',
    returnedCount: 2,
    sample: {
      sampleSize: 2,
      items: [
        expect.objectContaining({
          itemRef: 'item:001',
          localDateTime: now,
          exifInfo: expect.objectContaining({ city: 'Berlin', state: 'Berlin', country: 'Germany' }),
        }),
        expect.objectContaining({ itemRef: 'item:002' }),
      ],
    },
  }),
);
expect(result.status === 'success' ? result.sample?.items[0] : undefined).not.toHaveProperty('id');
expect(JSON.stringify(result)).not.toContain(assetIds[0]);
```

Update `omits summary samples when sampleSize is zero` so the summary is handle-first and no IDs are present:

```ts
expect(result).toEqual(
  expect.objectContaining({
    status: 'success',
    summary: 'Created a selection handle for 2 assets',
    detail: 'summary',
    returnedCount: 2,
  }),
);
expect(result).not.toHaveProperty('sample');
expect(JSON.stringify(result)).not.toContain(assetIds[0]);
```

Update `keeps summary samples id-only when no fields are requested` into a handle-local itemRef test:

```ts
expect(result).toEqual(
  expect.objectContaining({
    status: 'success',
    summary: 'Created a selection handle for 1 asset with 1 sample',
    detail: 'summary',
    sample: { sampleSize: 1, items: [{ itemRef: 'item:001' }] },
  }),
);
expect(JSON.stringify(result)).not.toContain(assetIds[0]);
```

Update `returns full metadata rows only when metadata detail is requested without fields` so metadata detail returns a bounded ID-free sample instead of `assets`. In that test, create metadata with a non-UUID filename so the no-raw-ID assertion is meaningful:

```ts
const metadata = makeMetadata(assetId, { originalFileName: 'berlin.jpg' });
```

```ts
expect(result).toEqual(
  expect.objectContaining({
    status: 'success',
    summary: 'Created a selection handle for 1 asset with 1 sample',
    detail: 'metadata',
    sample: {
      sampleSize: 1,
      items: [expect.objectContaining({ itemRef: 'item:001', originalFileName: 'berlin.jpg' })],
    },
  }),
);
expect(result).not.toHaveProperty('assets');
expect(JSON.stringify(result)).not.toContain(assetId);
```

Update `returns field-selected metadata rows and omits unrequested fields` similarly. Use `makeMetadata(assetId, { originalFileName: 'berlin.jpg' })` in the repository mock:

```ts
expect(result).toEqual(
  expect.objectContaining({
    status: 'success',
    detail: 'metadata',
    sample: {
      sampleSize: 1,
      items: [{ itemRef: 'item:001', originalFileName: 'berlin.jpg', isFavorite: false }],
    },
  }),
);
expect(result.status === 'success' ? result.sample?.items[0] : undefined).not.toHaveProperty('id');
expect(result.status === 'success' ? result.sample?.items[0] : undefined).not.toHaveProperty('exifInfo');
expect(result.status === 'success' ? result.sample?.items[0] : undefined).not.toHaveProperty('tags');
```

- [ ] **Step 2: Run sample tests and confirm red failures**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "field-selected summary samples|sampleSize is zero|handle-local itemRef|full metadata rows|field-selected metadata rows"
```

Expected red failures:

- Existing samples still include `id`.
- Metadata detail still returns `assets`.
- Existing summaries say `Returned asset ids`.

- [ ] **Step 3: Implement ID-free sample mapping**

In `server/src/services/agent-tool.service.ts`, add:

```ts
private buildSearchSample(assets: AgentSearchAssetResult[]): AgentSearchAssetsSample | undefined {
  const items = assets.map((asset, index) => this.mapSearchSampleItem(asset, index));
  return items.length === 0 ? undefined : { sampleSize: items.length, items };
}

private mapSearchSampleItem(asset: AgentSearchAssetResult, index: number): AgentSearchAssetsSampleItem {
  const { id: _id, ownerId: _ownerId, tags, ...rest } = asset;
  return {
    itemRef: `item:${String(index + 1).padStart(3, '0')}`,
    ...rest,
    ...(tags ? { tags: tags.map(({ value, color }) => ({ value, color })) } : {}),
  };
}
```

Use that helper for `summary` and `metadata` detail:

```ts
if (responseDetail === 'summary') {
  const sampleSize = request.sampleSize ?? 10;
  const sampleAssetIds = assetIds.slice(0, sampleSize);
  const sampleAssets = await this.getOrderedAgentMetadata(sampleAssetIds);
  const sample = this.buildSearchSample(sampleAssets.map((asset) => this.mapSelectedAssetMetadata(asset, fields)));
  const summary = this.getSearchAssetsResponseSummary({ ...pageResult, sampleCount: sample?.items.length ?? 0 });
  return { ...pageResult, summary, ...(sample ? { sample } : {}) };
}

if (responseDetail === 'metadata') {
  const sampleSize = request.sampleSize ?? 10;
  const metadataAssetIds = assetIds.slice(0, sampleSize);
  const assets = await this.getOrderedAgentMetadata(metadataAssetIds);
  const sample = this.buildSearchSample(
    fields.length === 0 ? assets : assets.map((asset) => this.mapSelectedAssetMetadata(asset, fields)),
  );
  const summary = this.getSearchAssetsResponseSummary({ ...pageResult, sampleCount: sample?.items.length ?? 0 });
  return { ...pageResult, summary, ...(sample ? { sample } : {}) };
}
```

Keep compact `handle` detail from hydrating metadata at all.

- [ ] **Step 4: Run sample tests and confirm they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "field-selected summary samples|sampleSize is zero|handle-local itemRef|full metadata rows|field-selected metadata rows"
```

Expected green result: all targeted sample tests pass.

- [ ] **Step 5: Commit sample mapping**

Run:

```bash
git add server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts
git commit -m "feat: return ID-free search samples"
```

## Task 4: Truncation, Audit Metadata, And Regression Sweep

**Files:**

- Modify: `server/src/services/agent-tool.service.ts`
- Test: `server/src/services/agent-tool.service.spec.ts`
- Test: `server/src/dtos/agent-tool.dto.spec.ts`

- [ ] **Step 1: Write failing tests for truncation and audit metadata**

Update `searchAssets creates handles from budget-truncated search output without truncating handle counts`:

```ts
expect(result.status).toBe('success');
if (result.status === 'success') {
  expect(result.selectionHandle.assetCount).toBe(500);
  expect(result.resultSize.truncated).toBe(false);
  expect(result.resultSize.omittedFields).toEqual([]);
  expect(result).not.toHaveProperty('assetIds');
  expect(JSON.stringify(result)).not.toContain(assetIds[0]);
}
```

In `searchAssets creates a handle by default without metadata hydration`, assert completed audit metadata is ID-free:

```ts
expect(toolCallRepository.transition).toHaveBeenCalledWith(
  session.id,
  expect.any(String),
  AgentToolCallStatus.Executing,
  expect.objectContaining({
    redactedResponseMetadata: expect.objectContaining({
      selectionHandleIds: [expect.any(String)],
      sourceRefs: [expect.stringMatching(/^asset-source:search:/)],
      selectionHandleAssetCount: 2,
      resultSize: expect.any(Object),
    }),
  }),
);
const completedMetadata = toolCallRepository.transition.mock.calls.find(
  ([, , fromStatus]) => fromStatus === AgentToolCallStatus.Executing,
)?.[3]?.redactedResponseMetadata;
expect(completedMetadata).not.toHaveProperty('assetIds');
expect(completedMetadata).not.toHaveProperty('selectionHandleSampleAssetIds');
expect(JSON.stringify(completedMetadata)).not.toContain(assetIds[0]);
```

- [ ] **Step 2: Run truncation/audit tests and confirm red failures**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "budget-truncated search output|handle by default"
```

Expected red failures:

- Current truncation still tracks `assetIds`.
- Current audit metadata contains `selectionHandleSampleAssetIds`.

- [ ] **Step 3: Remove search ID truncation and audit leakage**

In `server/src/services/agent-tool.service.ts`, change `truncateSearchAssetsResult()` so it only trims `sample.items`:

```ts
private truncateSearchAssetsResult<
  TResult extends {
    summary: string;
    detail: AgentSearchAssetsDetail;
    selectionHandle: AgentSearchAssetsSelectionHandleResult;
    sample?: AgentSearchAssetsSample;
    returnedCount: number;
    hasMore: boolean;
    nextPage: string | null;
  },
>(result: TResult, budgetBytes: number): { result: TResult; omittedFields: string[] } {
  const omittedFields = new Set<string>();
  let nextResult = { ...result, sample: result.sample ? { ...result.sample, items: [...result.sample.items] } : undefined };

  while (nextResult.sample && nextResult.sample.items.length > 0 && (this.estimateJsonBytes(nextResult) ?? 0) > budgetBytes) {
    nextResult = {
      ...nextResult,
      sample: {
        sampleSize: nextResult.sample.items.length - 1,
        items: nextResult.sample.items.slice(0, -1),
      },
    };
    omittedFields.add('sample');
  }

  if (nextResult.sample?.items.length === 0) {
    const { sample: _sample, ...withoutSample } = nextResult;
    nextResult = withoutSample as TResult;
  }

  const summary = this.getSearchAssetsResponseSummary({
    ...nextResult,
    sampleCount: nextResult.sample?.items.length,
  });

  return {
    result: {
      ...nextResult,
      summary: omittedFields.size > 0 ? this.appendTruncatedResponseSummary(summary) : summary,
    },
    omittedFields: [...omittedFields],
  };
}
```

Do not include `selectionHandleSampleAssetIds` in `responseMetadata`.

- [ ] **Step 4: Run focused and full relevant verification**

Before running the full commands, sweep existing search expectations in `server/src/dtos/agent-tool.dto.spec.ts` and `server/src/services/agent-tool.service.spec.ts`:

- Replace successful search response fixtures that use `detail: 'ids'` with `detail: 'handle'`.
- Remove top-level `assetIds` and `assets` from successful search response fixtures.
- Replace `selectionHandle.sampleAssetIds` expectations in provider-visible responses with absence checks; keep repository-handle mocks using `sampleAssetIds`.
- Replace expected summaries of the form `Returned N asset id(s)` with `Created a selection handle for N asset(s)`.
- Replace metadata-detail `assets` expectations with ID-free `sample.items` expectations.
- Replace truncation expectations that mention `omittedFields: ['assetIds']` with either `omittedFields: []` for handle-only responses or `omittedFields: ['sample']` when a metadata sample is actually trimmed.

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts -t "search responses|search response|search samples|selection handle"
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "searchAssets|search asset|selection handle|budget-truncated"
pnpm --dir server run check
```

Expected green result:

- DTO search response tests pass.
- Agent tool service search tests pass.
- TypeScript check passes.

- [ ] **Step 5: Commit final Slice 1 regression fixes**

Run:

```bash
git add server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/dtos/agent-tool.dto.spec.ts
git commit -m "test: cover handle-first search regressions"
```

## Task 5: Slice 1 Final Validation And Push

**Files:**

- No new source files.
- May modify this plan file only to check off completed steps.

- [ ] **Step 1: Run final Slice 1 verification**

Run:

```bash
pnpm --dir docs exec prettier --check superpowers/specs/2026-05-27-pi-agent-handle-first-tool-contract-design.md superpowers/plans/2026-05-27-pi-agent-handle-first-tool-contract-slice-1.md
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts
pnpm --dir server run check
git diff --check
```

Expected green result:

- Prettier check passes for the spec and plan.
- Full DTO and agent tool service unit specs pass.
- TypeScript check passes.
- `git diff --check` reports no whitespace errors.

- [ ] **Step 2: Ensure the spec commit and Slice 1 commits are on the branch**

Run:

```bash
git log --oneline origin/explore-pi-agent-brainstorm..HEAD
```

Expected: includes `docs: design handle-first agent tool contract` plus the Slice 1 commits.

- [ ] **Step 3: Push the branch**

Run:

```bash
git push
```

Expected: branch `explore/pi-agent-brainstorm` pushes to origin without force.

## Plan Review Checklist

- TDD order is explicit: every behavior starts with failing tests, red verification, implementation, green verification, then commit.
- Slice 1 covers mandatory handles for zero/one/many searches, `createSelectionHandle: false`, `detail: "ids"` request compatibility, provider-visible removal of `assetIds`, ID-free samples, audit metadata without search ID arrays, and truncation that preserves handles.
- Later-slice work is excluded: prompt/docs redaction, `readSelectionMetadata`, `curateSelection`, planning raw-ID rejection, and search limit rebalance.
- File paths and APIs match the current codebase: `server/src/dtos/agent-tool.dto.ts`, `server/src/types/agent-tool.types.ts`, `server/src/services/agent-tool.service.ts`, and their existing specs.
- Edge cases named in the spec for Slice 1 are represented by exact tests.
