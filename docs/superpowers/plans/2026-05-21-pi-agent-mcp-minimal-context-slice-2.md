# Pi Agent MCP Minimal Context Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `searchAssets` compact by default by returning page-level asset IDs and paging metadata, while preserving opt-in summary samples and full metadata output.

**Architecture:** Extend the search request DTO with `detail`, `fields`, and `sampleSize`; extend the search response DTO with `assetIds`, `detail`, optional `sample`, optional `assets`, and `summary`. `AgentToolService.searchAssets` should search and permission-check IDs first, skip metadata hydration for default `ids` responses, hydrate only sampled IDs for `summary`, and hydrate all returned IDs only for explicit `detail: metadata`.

**Tech Stack:** NestJS service layer, Zod DTOs via `nestjs-zod`, Vitest unit tests, existing MCP registry JSON-schema generation.

---

## Scope

Slice 2 changes only `searchAssets` request/response behavior and generated tool schema coverage.

It must not implement:

- `readAssetMetadata` field presets from Slice 3;
- `resultSize`, response budgets, or telemetry from Slice 4;
- runner compaction from Slice 5;
- prompt/example rewrites from Slice 6 except minimal search-contract text needed for tests to keep parsing;
- selection handles from Slice 7.

## Decisions

- Default `searchAssets` detail is `ids`.
- Default search limit is `100`, not the old `10_000`, so an empty broad search fits the default careful permission plan and context budget.
- `detail: metadata` with no `fields` keeps the old full metadata capability.
- `detail: metadata` with `fields` returns selected per-asset rows for every returned ID.
- `detail: summary` returns compact selected rows in `sample`; default summary sample size is `10`.
- `sampleSize` is allowed from `0` to `25`; explicit `0` disables samples.
- Supported search response field groups are `type`, `dates`, `location`, `camera`, `tags`, `rating`, `filename`, `favorite`, and `visibility`.
- `dimensions` is not exposed in Slice 2 because `AgentAssetMetadata` has no width/height fields. Unknown fields should fail DTO validation.

## Files

- Modify: `server/src/types/agent-tool.types.ts`
  - Add `AgentSearchAssetsDetail`, `AgentSearchAssetsField`, and `AgentSearchAssetResult`.
  - Add `detail`, `fields`, and `sampleSize` to request metadata types.
- Modify: `server/src/dtos/agent-tool.dto.ts`
  - Add search detail/field schemas.
  - Add request DTO fields.
  - Add compact search response schemas.
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
  - Add failing request/response DTO tests for new fields and compact output.
- Modify: `server/src/services/agent-tool.service.ts`
  - Change search defaults and execution output.
  - Add compact search row mapping helpers.
- Modify: `server/src/services/agent-tool.service.spec.ts`
  - Add failing service tests for compact defaults, field selection, pagination, broad bounds, and permission boundaries.
- Modify: `server/src/services/agent-mcp.service.spec.ts`
  - Update transformed search default expectations for MCP tool calls.
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  - Add generated schema drift assertions for `detail`, `fields`, and `sampleSize`.
- Modify: `server/src/controllers/agent-runner-mcp.controller.spec.ts`
  - Update real MCP controller passthrough expectations for normalized `detail: 'ids'` and `fields: []`.
- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`
  - Update runner flow expectations for compact search request metadata and compact-ID response summaries.
- Modify only if existing examples need parsing updates: `server/src/services/agent-mcp-tool-contract.service.ts` and `server/src/services/agent-mcp-tool-contract.service.spec.ts`.

## Contract

Request:

```ts
type AgentSearchAssetsToolRequestDto = {
  mode?: 'metadata' | 'smart' | 'description' | 'ocr' | 'filename';
  query?: string;
  filters?: AgentSearchAssetsFilters;
  limit?: number;
  page?: number;
  order?: 'asc' | 'desc' | 'relevance';
  detail?: 'ids' | 'summary' | 'metadata';
  fields?: AgentSearchAssetsField[];
  sampleSize?: number;
  toolCallId?: string;
};
```

Default transformed request for `{}`:

```ts
{
  mode: 'metadata',
  filters: {},
  limit: 100,
  page: 1,
  order: 'desc',
  detail: 'ids',
  fields: [],
}
```

Success response:

```ts
{
  status: 'success',
  toolCall: AgentToolCallResponseDto,
  summary: string,
  detail: 'ids' | 'summary' | 'metadata',
  assetIds: string[],
  returnedCount: number,
  hasMore: boolean,
  nextPage: string | null,
  sample?: AgentSearchAssetResult[],
  assets?: AgentSearchAssetResult[],
  totalCount?: number,
  approximateTotal?: number,
}
```

Default `ids` responses must omit `assets` and `sample`.

## Task 1: Write Failing DTO And Schema Tests

**Files:**

- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`

- [ ] **Step 1: Add request DTO tests for new fields and defaults**

In `server/src/dtos/agent-tool.dto.spec.ts`, inside `describe(AgentSearchAssetsToolRequestDto.name, ...)`, add:

```ts
it('defaults searchAssets to compact id detail and a bounded limit', () => {
  const result = parseSearchAssetsRequest({});

  expect(result.success).toBe(true);
  if (!result.success) {
    return;
  }

  expect(result.data).toEqual({
    mode: 'metadata',
    filters: {},
    limit: 100,
    page: 1,
    order: 'desc',
    detail: 'ids',
    fields: [],
  });
});

it('accepts compact search detail, field selection, and sample size', () => {
  const result = parseSearchAssetsRequest({
    filters: { city: 'Berlin' },
    detail: 'summary',
    fields: ['dates', 'location', 'favorite'],
    sampleSize: 3,
    limit: 25,
  });

  expect(result.success).toBe(true);
  if (!result.success) {
    return;
  }

  expect(result.data).toEqual(
    expect.objectContaining({
      detail: 'summary',
      fields: ['dates', 'location', 'favorite'],
      sampleSize: 3,
      limit: 25,
    }),
  );
});

it('keeps metadata detail available when no fields are requested', () => {
  const result = parseSearchAssetsRequest({ detail: 'metadata', filters: {}, limit: 5 });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.detail).toBe('metadata');
    expect(result.data.fields).toEqual([]);
  }
});
```

- [ ] **Step 2: Add DTO edge-case tests for unknown fields and sample limits**

Add:

```ts
it('rejects unknown search metadata fields', () => {
  const result = parseSearchAssetsRequest({ detail: 'summary', fields: ['fullExif'] });

  expectIssue(result, ['fields', 0], 'Invalid option');
});

it('rejects sample sizes above the compact-search cap', () => {
  const result = parseSearchAssetsRequest({ detail: 'summary', sampleSize: 26 });

  expectIssue(result, ['sampleSize'], 'Too big');
});

it('rejects detail and fields when retrying an approved search tool call', () => {
  const result = parseSearchAssetsRequest({ toolCallId: factory.uuid(), detail: 'ids', fields: ['dates'] });

  expectIssue(result, [], 'Provide either search fields or toolCallId, not both');
});
```

If Zod's message text differs for enum or max failures, keep the path assertions and update the expected message to the actual stable message from the red run.

- [ ] **Step 3: Update existing default DTO expectations**

In `accepts metadata search contract fields and defaults`, change the expected default `limit` from `10_000` to `100` and assert `detail: 'ids'` and `fields: []`.

- [ ] **Step 4: Add response DTO tests for compact search output**

In `describe('expanded agent tool response DTOs', ...)`, add:

```ts
it('encodes and parses compact id search responses without metadata assets', () => {
  const assetId = factory.uuid();
  const response = {
    status: 'success' as const,
    toolCall: makeToolCall(),
    summary: 'Returned 1 asset id.',
    detail: 'ids' as const,
    assetIds: [assetId],
    returnedCount: 1,
    hasMore: false,
    nextPage: null,
  };

  const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode(response);

  expect(encoded.success).toBe(true);
  if (encoded.success && encoded.data.status === 'success') {
    expect(encoded.data.assetIds).toEqual([assetId]);
    expect(encoded.data).not.toHaveProperty('assets');
    expect(encoded.data).not.toHaveProperty('sample');
  }
});

it('encodes and parses field-selected search samples', () => {
  const assetId = factory.uuid();
  const response = {
    status: 'success' as const,
    toolCall: makeToolCall(),
    summary: 'Returned 1 asset id with 1 sample.',
    detail: 'summary' as const,
    assetIds: [assetId],
    sample: [
      {
        id: assetId,
        localDateTime: new Date('2026-05-14T12:00:00.000Z'),
        exifInfo: { city: 'Berlin', state: 'Berlin', country: 'Germany' },
      },
    ],
    returnedCount: 1,
    hasMore: false,
    nextPage: null,
  };

  const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode(response);

  expect(encoded.success).toBe(true);
  if (encoded.success && encoded.data.status === 'success') {
    expect(encoded.data.sample?.[0].localDateTime).toBe('2026-05-14T12:00:00.000Z');
    expect(encoded.data.sample?.[0]).not.toHaveProperty('originalFileName');
  }
});

it('keeps full metadata search responses valid for explicit metadata detail', () => {
  const response = {
    status: 'success' as const,
    toolCall: makeToolCall(),
    summary: 'Returned metadata for 1 asset.',
    detail: 'metadata' as const,
    assetIds: [makeAssets()[0].id],
    assets: makeAssets(),
    returnedCount: 1,
    hasMore: false,
    nextPage: null,
  };

  const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode(response);

  expect(encoded.success).toBe(true);
  if (encoded.success && encoded.data.status === 'success') {
    expect(encoded.data.assets?.[0].localDateTime).toBe('2026-05-14T12:00:00.000Z');
  }
});
```

- [ ] **Step 5: Add generated MCP schema drift assertions**

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, update `advertises expanded search contract fields on searchAssets` so the input schema properties include:

```ts
          detail: expect.any(Object),
          fields: expect.any(Object),
          sampleSize: expect.any(Object),
```

Also assert the field enum definition exists:

```ts
const searchFieldSchema = searchTool
  ? getSchemaDefinition(searchTool.inputSchema, 'AgentSearchAssetsField')
  : undefined;
expect(searchFieldSchema).toEqual(
  expect.objectContaining({
    enum: expect.arrayContaining([
      'type',
      'dates',
      'location',
      'camera',
      'tags',
      'rating',
      'filename',
      'favorite',
      'visibility',
    ]),
  }),
);
```

- [ ] **Step 6: Run DTO/schema tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts
```

Expected red failures:

- `detail`, `fields`, and `sampleSize` are unrecognized keys.
- default limit is still `10000`.
- compact response schema still requires `assets`.
- registry schema does not advertise the new properties.

## Task 2: Implement DTO And Type Contract

**Files:**

- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/dtos/agent-tool.dto.ts`

- [ ] **Step 1: Add search contract types**

In `server/src/types/agent-tool.types.ts`, add near the existing search types:

```ts
export type AgentSearchAssetsDetail = 'ids' | 'summary' | 'metadata';

export type AgentSearchAssetsField =
  | 'type'
  | 'dates'
  | 'location'
  | 'camera'
  | 'tags'
  | 'rating'
  | 'filename'
  | 'favorite'
  | 'visibility';
```

Update `AgentToolSearchAssetsRequestMetadata`:

```ts
export type AgentToolSearchAssetsRequestMetadata = {
  mode: AgentSearchAssetsMode;
  query?: string;
  filters: AgentSearchAssetsFilters;
  limit: number;
  page: number;
  order?: AgentSearchAssetsOrder;
  detail: AgentSearchAssetsDetail;
  fields: AgentSearchAssetsField[];
  sampleSize?: number;
};
```

Add:

```ts
export type AgentSearchAssetResult = {
  id: string;
  ownerId?: string;
  type?: AssetType;
  originalFileName?: string;
  localDateTime?: Date;
  fileCreatedAt?: Date;
  fileModifiedAt?: Date;
  isFavorite?: boolean;
  visibility?: AssetVisibility;
  exifInfo?: Partial<NonNullable<AgentAssetMetadata['exifInfo']>> | null;
  tags?: AgentAssetMetadata['tags'];
};
```

- [ ] **Step 2: Update imports in `agent-tool.service.ts` later**

No code change in this task, but remember `AgentToolService` will need `AgentSearchAssetResult`, `AgentSearchAssetsDetail`, and `AgentSearchAssetsField` imports after Task 4.

- [ ] **Step 3: Add DTO constants and schemas**

In `server/src/dtos/agent-tool.dto.ts`, change:

```ts
const MAX_TOOL_LIMIT = 10_000;
```

to:

```ts
const DEFAULT_SEARCH_LIMIT = 100;
const MAX_TOOL_LIMIT = 10_000;
const MAX_SEARCH_SAMPLE_SIZE = 25;
```

Add after `AgentSearchAssetsOrderSchema`:

```ts
const AgentSearchAssetsDetailSchema = z.enum(['ids', 'summary', 'metadata']).meta({ id: 'AgentSearchAssetsDetail' });
const AgentSearchAssetsFieldSchema = z
  .enum(['type', 'dates', 'location', 'camera', 'tags', 'rating', 'filename', 'favorite', 'visibility'])
  .meta({ id: 'AgentSearchAssetsField' });
```

- [ ] **Step 4: Extend request output type and schema**

Update `AgentSearchAssetsToolRequestOutput` to include:

```ts
  detail?: z.output<typeof AgentSearchAssetsDetailSchema>;
  fields?: z.output<typeof AgentSearchAssetsFieldSchema>[];
  sampleSize?: number;
```

Add these fields to `AgentSearchAssetsToolRequestSchema`:

```ts
    detail: AgentSearchAssetsDetailSchema.optional(),
    fields: z.array(AgentSearchAssetsFieldSchema).max(20).optional(),
    sampleSize: z.number().int().min(0).max(MAX_SEARCH_SAMPLE_SIZE).optional(),
```

Include them in `hasNewSearchFields`:

```ts
value.detail !== undefined || value.fields !== undefined || value.sampleSize !== undefined;
```

Change the transform request object:

```ts
      limit: value.limit ?? DEFAULT_SEARCH_LIMIT,
      page: value.page ?? DEFAULT_SEARCH_PAGE,
      detail: value.detail ?? 'ids',
      fields: value.fields ?? [],
      ...(value.sampleSize === undefined ? {} : { sampleSize: value.sampleSize }),
```

- [ ] **Step 5: Add compact response schemas**

Below `AgentAssetMetadataSchema`, add:

```ts
const AgentSearchAssetExifSchema = z
  .object({
    dateTimeOriginal: isoDatetimeToDate.optional().nullable(),
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    make: z.string().optional().nullable(),
    model: z.string().optional().nullable(),
    lensModel: z.string().optional().nullable(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    rating: z.number().int().optional().nullable(),
  })
  .meta({ id: 'AgentSearchAssetExif' });

const AgentSearchAssetResultSchema = z
  .object({
    id: uuid,
    ownerId: uuid.optional(),
    type: AssetTypeSchema.optional(),
    originalFileName: z.string().optional(),
    localDateTime: isoDatetimeToDate.optional(),
    fileCreatedAt: isoDatetimeToDate.optional(),
    fileModifiedAt: isoDatetimeToDate.optional(),
    isFavorite: z.boolean().optional(),
    visibility: AssetVisibilitySchema.optional(),
    exifInfo: AgentSearchAssetExifSchema.optional().nullable(),
    tags: z.array(AgentAssetMetadataTagSchema).optional(),
  })
  .meta({ id: 'AgentSearchAssetResult' });
```

Update `AgentSearchAssetsToolResponseSchema` success object from required `assets` to:

```ts
        summary: z.string(),
        detail: AgentSearchAssetsDetailSchema,
        assetIds: z.array(uuid),
        sample: z.array(AgentSearchAssetResultSchema).optional(),
        assets: z.array(AgentSearchAssetResultSchema).optional(),
```

Keep `returnedCount`, `hasMore`, `nextPage`, `totalCount`, and `approximateTotal`.

- [ ] **Step 6: Run DTO/schema tests and verify green for this layer**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts
```

Expected: DTO and registry schema tests pass. Service/MCP tests can still fail until later tasks update behavior.

## Task 3: Write Failing Service And MCP Tests

**Files:**

- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add default compact search service test**

Replace or update `uses contract defaults for empty service-level search requests` so it expects compact IDs and no metadata hydration:

```ts
it('uses compact id search defaults without hydrating metadata', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid(), newUuid()];
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({
      limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 100, maxAssetsPerSession: 1000 },
    }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })) as never,
    hasNextPage: true,
  });

  const result = await sut.searchAssets(auth, session.id, {});

  expect(result).toEqual({
    status: 'success',
    toolCall: expect.objectContaining({
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Returned 2 asset ids; more results available on page 2',
    }),
    summary: 'Returned 2 asset ids; more results available on page 2',
    detail: 'ids',
    assetIds,
    returnedCount: 2,
    hasMore: true,
    nextPage: '2',
  });
  expect(result).not.toHaveProperty('assets');
  expect(result).not.toHaveProperty('sample');
  expect(searchRepository.searchMetadata).toHaveBeenCalledWith({ page: 1, size: 100 }, expect.any(Object));
  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
    expect.objectContaining({
      requestSummary: 'Search metadata assets (limit 100, ids)',
      redactedRequestMetadata: {
        mode: 'metadata',
        filters: {},
        limit: 100,
        page: 1,
        order: 'desc',
        detail: 'ids',
        fields: [],
      },
      assetCount: 100,
    }),
    expect.any(Object),
    AgentToolDataClass.Metadata,
    expect.any(Number),
  );
});
```

- [ ] **Step 2: Add field-selected summary sample service test**

Add near search service tests:

```ts
it('returns field-selected summary samples without unrequested metadata', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid(), newUuid()];
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })) as never,
    hasNextPage: false,
  });
  assetRepository.getAgentMetadataByIds.mockResolvedValue(assetIds.map((id) => makeMetadata(id)) as never);

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { city: 'Berlin' },
    limit: 2,
    page: 1,
    order: 'desc',
    detail: 'summary',
    fields: ['dates', 'location', 'favorite'],
    sampleSize: 1,
  });

  expect(result).toEqual(
    expect.objectContaining({
      status: 'success',
      toolCall: expect.objectContaining({ responseSummary: 'Returned 2 asset ids with 1 sample' }),
      summary: 'Returned 2 asset ids with 1 sample',
      detail: 'summary',
      assetIds,
      sample: [
        expect.objectContaining({
          id: assetIds[0],
          localDateTime: now,
          fileCreatedAt: now,
          fileModifiedAt: now,
          isFavorite: false,
          exifInfo: expect.objectContaining({ city: 'Berlin', state: 'Berlin', country: 'Germany' }),
        }),
      ],
    }),
  );
  expect(result).not.toHaveProperty('assets');
  expect(result.sample?.[0]).not.toHaveProperty('originalFileName');
  expect(result.sample?.[0]).not.toHaveProperty('tags');
  expect(result.sample?.[0].exifInfo).not.toHaveProperty('make');
  expect(assetRepository.getAgentMetadataByIds).toHaveBeenCalledWith([assetIds[0]]);
});
```

- [ ] **Step 3: Add explicit metadata detail compatibility test**

Add:

```ts
it('preserves full metadata output for explicit metadata detail without fields', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const metadata = makeMetadata(assetId);
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
  assetRepository.getAgentMetadataByIds.mockResolvedValue([metadata] as never);

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: {},
    limit: 1,
    page: 1,
    order: 'desc',
    detail: 'metadata',
    fields: [],
  });

  expect(result).toEqual(
    expect.objectContaining({
      status: 'success',
      toolCall: expect.objectContaining({ responseSummary: 'Returned metadata for 1 asset' }),
      summary: 'Returned metadata for 1 asset',
      detail: 'metadata',
      assetIds: [assetId],
      assets: [expect.objectContaining({ id: assetId, originalFileName: metadata.originalFileName })],
    }),
  );
});
```

- [ ] **Step 4: Add selected metadata fields test**

Add:

```ts
it('honors field selection for metadata detail and omits unrequested fields', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: {},
    limit: 1,
    detail: 'metadata',
    fields: ['filename', 'rating', 'tags'],
  });

  expect(result).toEqual(
    expect.objectContaining({
      detail: 'metadata',
      assets: [
        expect.objectContaining({
          id: assetId,
          originalFileName: `${assetId}.jpg`,
          tags: [expect.objectContaining({ value: 'travel' })],
          exifInfo: { rating: 5 },
        }),
      ],
    }),
  );
  expect(result.assets?.[0]).not.toHaveProperty('localDateTime');
  expect(result.assets?.[0]).not.toHaveProperty('visibility');
  expect(result.assets?.[0].exifInfo).not.toHaveProperty('city');
});
```

- [ ] **Step 5: Add pagination, empty, broad, and sample edge tests**

Add or update tests so these exact scenarios fail before implementation:

```ts
it('returns empty compact search pages without hydration', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false });

  const result = await sut.searchAssets(auth, session.id, {});

  expect(result).toEqual(
    expect.objectContaining({
      status: 'success',
      summary: 'Returned 0 asset ids',
      detail: 'ids',
      assetIds: [],
      returnedCount: 0,
      hasMore: false,
      nextPage: null,
    }),
  );
  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
});

it('keeps broad searches near the default page limit compact', async () => {
  const auth = AuthFactory.create();
  const assetIds = Array.from({ length: 100 }, () => newUuid());
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })) as never,
    hasNextPage: true,
  });

  const result = await sut.searchAssets(auth, session.id, {});

  expect(result).toEqual(
    expect.objectContaining({
      detail: 'ids',
      returnedCount: 100,
      hasMore: true,
      nextPage: '2',
      assetIds,
    }),
  );
  expect(JSON.stringify(result).length).toBeLessThan(6000);
  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
});

it('caps samples to the returned result count', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid(), newUuid()];
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })) as never,
    hasNextPage: false,
  });
  assetRepository.getAgentMetadataByIds.mockResolvedValue(assetIds.map((id) => makeMetadata(id)) as never);

  const result = await sut.searchAssets(auth, session.id, {
    filters: {},
    limit: 2,
    detail: 'summary',
    fields: ['type'],
    sampleSize: 25,
  });

  expect(result.sample).toHaveLength(2);
  expect(assetRepository.getAgentMetadataByIds).toHaveBeenCalledWith(assetIds);
});

it('omits summary samples when sampleSize is zero', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid(), newUuid()];
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })) as never,
    hasNextPage: false,
  });

  const result = await sut.searchAssets(auth, session.id, {
    filters: {},
    limit: 2,
    detail: 'summary',
    fields: ['type'],
    sampleSize: 0,
  });

  expect(result).toEqual(
    expect.objectContaining({
      status: 'success',
      summary: 'Returned 2 asset ids',
      detail: 'summary',
      assetIds,
    }),
  );
  expect(result).not.toHaveProperty('sample');
  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Add permission-boundary tests for compact defaults and samples**

Add tests if no equivalent assertion already exists in the file:

```ts
it('does not hydrate or sample inaccessible returned search assets', async () => {
  const auth = AuthFactory.create();
  const accessibleAssetId = newUuid();
  const inaccessibleAssetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  searchRepository.searchMetadata.mockResolvedValue({
    items: [{ id: accessibleAssetId }, { id: inaccessibleAssetId }] as never,
    hasNextPage: false,
  });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([accessibleAssetId]));

  const result = await sut.searchAssets(auth, session.id, {
    filters: {},
    limit: 2,
    detail: 'summary',
    fields: ['filename'],
    sampleSize: 2,
  });

  expect(result).toEqual({
    status: 'denied',
    reason: 'One or more assets are not accessible',
    toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
  });
  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
});
```

Also add an explicit metadata-policy edge case:

```ts
it('denies field-selected metadata searches when metadata reads are disabled', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ read: { metadata: false } }),
  });

  sessionRepository.getById.mockResolvedValue(session);

  const result = await sut.searchAssets(auth, session.id, {
    filters: {},
    limit: 1,
    detail: 'metadata',
    fields: ['filename'],
  });

  expect(result).toEqual({
    status: 'denied',
    reason: 'Agent permission policy does not allow metadata reads',
    toolCall: expect.objectContaining({
      status: AgentToolCallStatus.Denied,
      error: 'Agent permission policy does not allow metadata reads',
    }),
  });
  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
});
```

Keep the existing tests for shared spaces, locked visibility, people, albums, and tags, but update expected success response shapes from `assets` to `assetIds` where the request does not explicitly use `detail: metadata`.

- [ ] **Step 7: Update MCP transformed default expectation**

In `server/src/services/agent-mcp.service.spec.ts`, update `delegates DTO-transformed search defaults instead of raw search arguments` so the service is called with:

```ts
{
  mode: 'metadata',
  filters: {},
  limit: 100,
  page: 1,
  order: 'desc',
  detail: 'ids',
  fields: [],
}
```

Also update other MCP search delegation expectations where the parsed DTO now includes `detail: 'ids'` and `fields: []`.

In `server/src/controllers/agent-runner-mcp.controller.spec.ts`, update the real MCP controller expectation for `SearchAssets` so the service call includes:

```ts
{
  mode: 'metadata',
  filters: { tagIds: [assetId] },
  limit: 10,
  page: 1,
  order: 'desc',
  detail: 'ids',
  fields: [],
}
```

In `server/src/services/agent-runner-flow.integration.spec.ts`, update every default search acceptance case:

- `expectedRequestSummary` changes from `Search <mode> assets (limit 50)` to `Search <mode> assets (limit 50, ids)`.
- `expectedRequestMetadata` includes `detail: 'ids'` and `fields: []`.
- completed default search tool-call summaries change from `Returned metadata for 1 asset` to `Returned 1 asset id`.

- [ ] **Step 8: Run service/MCP tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/services/agent-runner-flow.integration.spec.ts
```

Expected red failures:

- default service search still returns `assets`;
- metadata hydration still happens for default `ids`;
- summary/sample fields are missing;
- MCP default DTO transform still uses `limit: 10000` and lacks `detail`/`fields`.

## Task 4: Implement Compact Search Service Behavior

**Files:**

- Modify: `server/src/services/agent-tool.service.ts`

- [ ] **Step 1: Import new types**

Extend the existing import from `src/types/agent-tool.types`:

```ts
  AgentSearchAssetResult,
  AgentSearchAssetsDetail,
  AgentSearchAssetsField,
```

- [ ] **Step 2: Update search descriptor result type**

Change the `searchAssetsDescriptor()` result type to:

```ts
    {
      summary: string;
      detail: AgentSearchAssetsDetail;
      assetIds: string[];
      sample?: AgentSearchAssetResult[];
      assets?: AgentSearchAssetResult[];
      returnedCount: number;
      hasMore: boolean;
      nextPage: string | null;
      totalCount?: number;
      approximateTotal?: number;
    }
```

- [ ] **Step 3: Update request summary and metadata**

Change `requestSummary`:

```ts
      requestSummary: (request) =>
        `Search ${request.mode ?? 'metadata'} assets (limit ${this.getSearchLimit(request)}, ${request.detail ?? 'ids'})`,
```

Add `detail`, `fields`, and optional `sampleSize` to `requestMetadata`:

```ts
          detail: request.detail ?? 'ids',
          fields: request.fields ?? [],
          ...(request.sampleSize === undefined ? {} : { sampleSize: request.sampleSize }),
```

- [ ] **Step 4: Update execution to hydrate only when necessary**

Inside the `execute` function, replace:

```ts
const assets = await this.getOrderedAgentMetadata(assetIds);
return {
  assets,
  returnedCount: assets.length,
  hasMore: result.hasNextPage,
  nextPage: result.hasNextPage ? String((request.page ?? 1) + 1) : null,
};
```

with:

```ts
const detail = request.detail ?? 'ids';
const fields = request.fields ?? [];
const nextPage = result.hasNextPage ? String((request.page ?? 1) + 1) : null;
const hydratedAssets = await this.getSearchHydratedAssets(assetIds, detail, request.sampleSize);
const searchResult = this.buildSearchAssetsResult({
  assetIds,
  detail,
  fields,
  sampleSize: request.sampleSize,
  hydratedAssets,
  hasMore: result.hasNextPage,
  nextPage,
});

return searchResult;
```

- [ ] **Step 5: Update summary/metadata/count callbacks**

Change:

```ts
      responseSummary: (result) => this.getSearchAssetsResponseSummary(result),
      responseMetadata: (result) => ({ assetIds: result.assets.map((asset) => asset.id) }),
      resultAssetCount: (result) => result.assets.length,
```

to:

```ts
      responseSummary: (result) => result.summary,
      responseMetadata: (result) => ({ assetIds: result.assetIds }),
      resultAssetCount: (result) => result.assetIds.length,
```

- [ ] **Step 6: Change default search limit**

Change:

```ts
  private getSearchLimit(request: AgentSearchAssetsToolRequestDto): number {
    return request.limit ?? 10_000;
  }
```

to:

```ts
  private getSearchLimit(request: AgentSearchAssetsToolRequestDto): number {
    return request.limit ?? 100;
  }
```

- [ ] **Step 7: Replace old response summary helper**

Replace `getSearchAssetsResponseSummary(...)` with:

```ts
  private getSearchAssetsResponseSummary(result: {
    detail: AgentSearchAssetsDetail;
    returnedCount: number;
    sampleCount: number;
    hasMore: boolean;
    nextPage: string | null;
  }) {
    const itemLabel =
      result.detail === 'metadata'
        ? `metadata for ${result.returnedCount} ${result.returnedCount === 1 ? 'asset' : 'assets'}`
        : `${result.returnedCount} asset ${result.returnedCount === 1 ? 'id' : 'ids'}`;
    const sampleSuffix = result.sampleCount > 0 ? ` with ${result.sampleCount} sample${result.sampleCount === 1 ? '' : 's'}` : '';
    const summary = `Returned ${itemLabel}${sampleSuffix}`;
    return result.hasMore && result.nextPage ? `${summary}; more results available on page ${result.nextPage}` : summary;
  }
```

- [ ] **Step 8: Add search hydration and result helpers below the summary helper**

Add:

```ts
  private async getSearchHydratedAssets(
    assetIds: string[],
    detail: AgentSearchAssetsDetail,
    sampleSize: number | undefined,
  ): Promise<AgentAssetMetadata[]> {
    const hydrateCount = this.getSearchHydrationCount(assetIds.length, detail, sampleSize);
    if (hydrateCount === 0) {
      return [];
    }

    return this.getOrderedAgentMetadata(assetIds.slice(0, hydrateCount));
  }

  private getSearchHydrationCount(
    returnedCount: number,
    detail: AgentSearchAssetsDetail,
    sampleSize: number | undefined,
  ): number {
    if (returnedCount === 0) {
      return 0;
    }

    if (detail === 'metadata') {
      return returnedCount;
    }

    if (detail === 'summary') {
      return Math.min(returnedCount, sampleSize ?? 10);
    }

    return Math.min(returnedCount, sampleSize ?? 0);
  }

  private buildSearchAssetsResult(options: {
    assetIds: string[];
    detail: AgentSearchAssetsDetail;
    fields: AgentSearchAssetsField[];
    sampleSize: number | undefined;
    hydratedAssets: AgentAssetMetadata[];
    hasMore: boolean;
    nextPage: string | null;
  }) {
    const returnedCount = options.assetIds.length;
    const sample = options.detail === 'metadata' ? [] : options.hydratedAssets.map((asset) => this.mapSearchAssetResult(asset, options.fields));
    const assets =
      options.detail === 'metadata'
        ? options.hydratedAssets.map((asset) =>
            options.fields.length === 0 ? this.mapAssetMetadata(asset) : this.mapSearchAssetResult(asset, options.fields),
          )
        : undefined;
    const summary = this.getSearchAssetsResponseSummary({
      detail: options.detail,
      returnedCount,
      sampleCount: options.detail === 'metadata' ? 0 : sample.length,
      hasMore: options.hasMore,
      nextPage: options.nextPage,
    });

    return {
      summary,
      detail: options.detail,
      assetIds: options.assetIds,
      ...(sample.length === 0 ? {} : { sample }),
      ...(assets === undefined ? {} : { assets }),
      returnedCount,
      hasMore: options.hasMore,
      nextPage: options.nextPage,
    };
  }

  private mapSearchAssetResult(asset: AgentAssetMetadata, fields: AgentSearchAssetsField[]): AgentSearchAssetResult {
    const result: AgentSearchAssetResult = { id: asset.id };
    const exifInfo: NonNullable<AgentSearchAssetResult['exifInfo']> = {};

    if (fields.includes('type')) {
      result.type = asset.type;
    }
    if (fields.includes('filename')) {
      result.originalFileName = asset.originalFileName;
    }
    if (fields.includes('dates')) {
      result.localDateTime = asset.localDateTime;
      result.fileCreatedAt = asset.fileCreatedAt;
      result.fileModifiedAt = asset.fileModifiedAt;
      if (asset.exifInfo) {
        exifInfo.dateTimeOriginal = asset.exifInfo.dateTimeOriginal;
      }
    }
    if (fields.includes('favorite')) {
      result.isFavorite = asset.isFavorite;
    }
    if (fields.includes('visibility')) {
      result.visibility = asset.visibility;
    }
    if (fields.includes('location') && asset.exifInfo) {
      exifInfo.city = asset.exifInfo.city;
      exifInfo.state = asset.exifInfo.state;
      exifInfo.country = asset.exifInfo.country;
      exifInfo.latitude = asset.exifInfo.latitude;
      exifInfo.longitude = asset.exifInfo.longitude;
    }
    if (fields.includes('camera') && asset.exifInfo) {
      exifInfo.make = asset.exifInfo.make;
      exifInfo.model = asset.exifInfo.model;
      exifInfo.lensModel = asset.exifInfo.lensModel;
    }
    if (fields.includes('rating') && asset.exifInfo) {
      exifInfo.rating = asset.exifInfo.rating;
    }
    if (Object.keys(exifInfo).length > 0) {
      result.exifInfo = exifInfo;
    }
    if (fields.includes('tags')) {
      result.tags = asset.tags.map((tag) => ({ id: tag.id, value: tag.value, color: tag.color }));
    }

    return result;
  }
```

- [ ] **Step 9: Run service tests and update old expected shapes carefully**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts
```

Expected: Remaining failures should be old tests expecting default `assets` for searches that now use compact IDs. Update only those tests:

- If the request is default or lacks `detail: metadata`, expect `assetIds` and no `assets`.
- If the test's purpose is full metadata hydration/order, add `detail: 'metadata'` and `fields: []` to the request.
- If the test asserts filter permission boundaries, keep compact output and assert no metadata leakage.

Do not update readAssetMetadata tests or unrelated tool tests.

## Task 5: Final Verification And Commit

**Files:**

- Modified files from Tasks 1-4.

- [ ] **Step 1: Run all related tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/controllers/agent-tool.controller.spec.ts
```

Then run the broader integration/controller drift check:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/controllers/agent-runner-mcp.controller.spec.ts src/services/agent-runner-flow.integration.spec.ts
```

Expected: all listed specs pass.

- [ ] **Step 2: Inspect future-slice drift**

Run:

```bash
git diff -- server/src/types/agent-tool.types.ts server/src/dtos/agent-tool.dto.ts server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/dtos/agent-tool.dto.spec.ts server/src/services/agent-mcp.service.spec.ts server/src/services/agent-mcp-tool-registry.service.spec.ts
```

Expected:

- `searchAssets` default returns compact IDs.
- Explicit `detail: metadata` remains available.
- `readAssetMetadata` is not changed.
- No `resultSize`, response budgets, runner compaction, prompt overhaul, or selection handles are introduced.

- [ ] **Step 3: Commit**

Run:

```bash
git add server/src/types/agent-tool.types.ts server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/services/agent-mcp.service.spec.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/controllers/agent-tool.controller.spec.ts server/src/controllers/agent-runner-mcp.controller.spec.ts server/src/services/agent-runner-flow.integration.spec.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts docs/superpowers/plans/2026-05-21-pi-agent-mcp-minimal-context-slice-2.md
git commit -m "feat: compact searchAssets defaults"
```

If `agent-mcp-tool-contract.service.ts` or its spec were not changed, `git add` will ignore those pathspecs only if they exist; keep the command as written because both files exist.

- [ ] **Step 4: Push**

Run:

```bash
git push
```

Expected: branch `explore/pi-agent-brainstorm` pushes to `origin/explore/pi-agent-brainstorm`.

## Plan Review Checklist

- TDD order is explicit: DTO/schema tests red first, service/MCP tests red before service implementation.
- Every Slice 2 TDD requirement is covered:
  - DTO tests for `detail`, `fields`, `sampleSize`;
  - default search omits full metadata;
  - requested fields included and unrequested fields omitted;
  - pagination, `hasMore`, and `nextPage`;
  - broad searches near the per-tool/default page limit;
  - permission boundaries for shared spaces, locked visibility, people, albums, tags, and inaccessible returned assets;
  - generated schema drift checks through MCP registry JSON schema.
- Every Slice 2 edge case is covered:
  - no filters/no query;
  - empty results;
  - `detail: metadata` with no fields;
  - unknown fields;
  - limit above max remains covered by existing DTO validation;
  - sample size greater than returned count;
  - sample contains inaccessible asset after search;
  - fields not allowed by permission plan are rejected as unknown or denied by metadata policy.
- Future slices are excluded.
