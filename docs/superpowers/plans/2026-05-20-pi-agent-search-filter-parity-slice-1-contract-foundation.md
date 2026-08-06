# Pi Agent Search Filter Parity Slice 1 Contract Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Pi `searchAssets` MCP contract with search mode, richer filter shape, page/order fields, and explicit result metadata while preventing not-yet-executable filters from being silently ignored.

**Architecture:** Slice 1 is a contract-foundation slice. It extends DTO/schema, MCP contract docs, and service response metadata, but keeps the current metadata repository execution path. Any search mode, page/order value, or filter field not yet implemented by the current repository path must be explicitly denied before execution; later slices remove those denials as they wire the fields to Gallery search.

**Tech Stack:** NestJS, Zod DTOs via `nestjs-zod`, Vitest, MCP tool registry/contract services, generated OpenAPI/TypeScript SDK, generated Pi MCP docs/prompt.

---

## Scope

Implement only Slice 1 from `docs/superpowers/specs/2026-05-20-pi-agent-search-filter-parity-design.md`.

Included:

- Add search request fields: `mode`, `query`, `order`, `page`.
- Add contract-shaped filter fields: created/updated dates, people, space scope, shared-space inclusion, visibility.
- Add response fields: `returnedCount`, `hasMore`, optional `totalCount`, optional `approximateTotal`.
- Keep default execution working for current metadata-compatible filters.
- Deny non-metadata modes and future-slice filters with clear messages before repository execution.
- Update MCP schema, examples, correction hints, generated docs, and generated SDK/OpenAPI files.

Excluded:

- Do not implement UI filter parity for new fields. That is Slice 2.
- Do not implement resolver tool. That is Slice 3.
- Do not implement smart/OCR/description/filename execution. That is Slice 4.
- Do not implement multi-page search execution. That is Slice 6.

## File Map

- Modify: `server/src/dtos/agent-tool.dto.ts`
  - Owns request/response schema for `searchAssets`.
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
  - DTO TDD coverage for new request/response contract and edge cases.
- Modify: `server/src/types/agent-tool.types.ts`
  - Shared TypeScript request metadata and filter types used by the service and repository.
- Modify: `server/src/services/agent-tool.service.ts`
  - Adds response metadata fields and execution guards for fields deferred to later slices.
- Modify: `server/src/services/agent-tool.service.spec.ts`
  - Service tests proving no silent ignored searches and new response metadata.
- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
  - Search tool base description and property descriptions for `mode`, `query`, `filters`, `page`, and `order`.
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  - Registry schema tests for new fields.
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
  - Search examples and common mistake correction hints.
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Correction hint tests.
- Modify generated files:
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - `open-api/immich-openapi-specs.json`
  - generated SDK files touched by `cd open-api && ./bin/generate-open-api.sh typescript`

## Contract Decisions For Slice 1

- `mode` defaults to `metadata`.
- `metadata` mode must not accept `query`.
- `smart`, `description`, `ocr`, and `filename` require non-empty `query`, but Slice 1 service execution denies them with an actionable message.
- `order` defaults to `desc`. Slice 1 execution allows only `desc`.
- `page` defaults to `1`. Slice 1 execution allows only `1`.
- New future-slice filters are valid schema fields, but Slice 1 execution denies them before repository access:
  - `createdAfter`
  - `createdBefore`
  - `updatedAfter`
  - `updatedBefore`
  - `personIds`
  - `spaceId`
  - `spacePersonIds`
  - `withSharedSpaces`
  - `visibility`
- Existing executable metadata filters continue to work:
  - `takenAfter`
  - `takenBefore`
  - `city`
  - `state`
  - `country`
  - `make`
  - `model`
  - `lensModel`
  - `isFavorite`
  - `isNotInAlbum`
  - `type`
  - `rating`
  - `tagIds`
  - `albumIds`

---

### Task 1: Write DTO Request Contract Tests

**Files:**

- Modify: `server/src/dtos/agent-tool.dto.spec.ts`

- [ ] **Step 1: Add failing request contract tests**

In `server/src/dtos/agent-tool.dto.spec.ts`, extend the `describe(AgentSearchAssetsToolRequestDto.name, () => { ... })` block with these tests:

```ts
it('accepts metadata search contract fields and defaults', () => {
  const tagId = factory.uuid();
  const albumId = factory.uuid();
  const result = parseSearchAssetsRequest({
    filters: {
      type: AssetType.Image,
      isFavorite: true,
      isNotInAlbum: true,
      takenAfter: '2026-05-01T00:00:00.000Z',
      takenBefore: '2026-05-31T23:59:59.999Z',
      city: 'Berlin',
      state: 'Berlin',
      country: 'Germany',
      make: 'Sony',
      model: 'A7',
      lensModel: 'FE 35mm',
      rating: null,
      tagIds: [tagId],
      albumIds: [albumId],
    },
  });

  expect(result.success).toBe(true);
  if (!result.success) {
    return;
  }

  expect(result.data).toEqual(
    expect.objectContaining({
      mode: 'metadata',
      limit: 10_000,
      page: 1,
      order: 'desc',
    }),
  );
  expect(result.data).not.toHaveProperty('query');
  expect(result.data.filters).toEqual(
    expect.objectContaining({
      type: AssetType.Image,
      isFavorite: true,
      isNotInAlbum: true,
      city: 'Berlin',
      state: 'Berlin',
      country: 'Germany',
      make: 'Sony',
      model: 'A7',
      lensModel: 'FE 35mm',
      rating: null,
      tagIds: [tagId],
      albumIds: [albumId],
      takenAfter: new Date('2026-05-01T00:00:00.000Z'),
      takenBefore: new Date('2026-05-31T23:59:59.999Z'),
    }),
  );
});

it('accepts future search filter fields in the schema contract', () => {
  const personId = factory.uuid();
  const spaceId = factory.uuid();
  const spacePersonId = factory.uuid();
  const result = parseSearchAssetsRequest({
    filters: {
      createdAfter: '2026-04-01T00:00:00.000Z',
      createdBefore: '2026-04-30T23:59:59.999Z',
      updatedAfter: '2026-05-01T00:00:00.000Z',
      updatedBefore: '2026-05-20T23:59:59.999Z',
      personIds: [personId],
      spaceId,
      spacePersonIds: [spacePersonId],
      visibility: AssetVisibility.Timeline,
    },
    limit: 25,
    page: 2,
    order: 'asc',
  });

  expect(result.success).toBe(true);
  if (!result.success) {
    return;
  }

  expect(result.data).toEqual(
    expect.objectContaining({
      mode: 'metadata',
      limit: 25,
      page: 2,
      order: 'asc',
    }),
  );
  expect(result.data.filters).toEqual(
    expect.objectContaining({
      personIds: [personId],
      spaceId,
      spacePersonIds: [spacePersonId],
      visibility: AssetVisibility.Timeline,
      createdAfter: new Date('2026-04-01T00:00:00.000Z'),
      createdBefore: new Date('2026-04-30T23:59:59.999Z'),
      updatedAfter: new Date('2026-05-01T00:00:00.000Z'),
      updatedBefore: new Date('2026-05-20T23:59:59.999Z'),
    }),
  );
});

it.each(['smart', 'description', 'ocr', 'filename'] as const)('accepts explicit %s mode with a query', (mode) => {
  const result = parseSearchAssetsRequest({ mode, query: 'beach sunset', filters: { city: 'Lisbon' }, limit: 5 });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data).toEqual(
      expect.objectContaining({
        mode,
        query: 'beach sunset',
        limit: 5,
        page: 1,
        order: 'desc',
      }),
    );
  }
});

it.each(['smart', 'description', 'ocr', 'filename'] as const)('rejects %s mode without a query', (mode) => {
  const result = parseSearchAssetsRequest({ mode, filters: {}, limit: 5 });

  expectIssue(result, ['query'], `${mode} search requires a non-empty query`);
});

it('rejects metadata mode with a query', () => {
  const result = parseSearchAssetsRequest({ mode: 'metadata', query: 'beach sunset', filters: {}, limit: 5 });

  expectIssue(result, ['query'], 'query is only supported for smart, description, ocr, and filename search modes');
});

it('rejects root-level filter fields', () => {
  const result = parseSearchAssetsRequest({ city: 'Berlin', createdAfter: '2026-05-01T00:00:00.000Z' } as never);

  expectIssue(result, [], 'Unrecognized');
});

it('rejects invalid order and page values', () => {
  const invalidOrder = parseSearchAssetsRequest({ order: 'newest-first' } as never);
  const invalidPage = parseSearchAssetsRequest({ page: 0 });

  expectIssue(invalidOrder, ['order'], 'Invalid option');
  expectIssue(invalidPage, ['page'], 'Too small');
});

it('rejects invalid date, rating, and limit values', () => {
  const invalidDate = parseSearchAssetsRequest({ filters: { takenAfter: 'yesterday' as never } });
  const invalidRating = parseSearchAssetsRequest({ filters: { rating: 6 } });
  const invalidLimit = parseSearchAssetsRequest({ limit: 10_001 });

  expectIssue(invalidDate, ['filters', 'takenAfter'], 'Invalid');
  expectIssue(invalidRating, ['filters', 'rating'], 'Too big');
  expectIssue(invalidLimit, ['limit'], 'Too big');
});

it('rejects spacePersonIds without spaceId', () => {
  const result = parseSearchAssetsRequest({ filters: { spacePersonIds: [factory.uuid()] } });

  expectIssue(result, ['filters', 'spacePersonIds'], 'spacePersonIds requires spaceId');
});

it('rejects spaceId with withSharedSpaces', () => {
  const result = parseSearchAssetsRequest({ filters: { spaceId: factory.uuid(), withSharedSpaces: true } });

  expectIssue(result, ['filters', 'withSharedSpaces'], 'Cannot use both spaceId and withSharedSpaces');
});

it('rejects requests containing any new search field and toolCallId', () => {
  for (const input of [
    { mode: 'smart', query: 'beach', toolCallId: factory.uuid() },
    { query: 'beach', toolCallId: factory.uuid() },
    { order: 'asc', toolCallId: factory.uuid() },
    { page: 2, toolCallId: factory.uuid() },
  ] as const) {
    const result = parseSearchAssetsRequest(input);

    expectIssue(result, [], 'Provide either search fields or toolCallId, not both');
  }
});
```

- [ ] **Step 2: Run DTO tests and verify failure**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts
```

Expected: FAIL because `mode`, `query`, `page`, `order`, and future filters are not yet defined.

---

### Task 2: Implement DTO Request Contract

**Files:**

- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`

- [ ] **Step 1: Add request schema helpers**

In `server/src/dtos/agent-tool.dto.ts`, below `const MAX_USER_LOOKUP_LIMIT = 20;`, add:

```ts
const DEFAULT_SEARCH_MODE = 'metadata';
const DEFAULT_SEARCH_ORDER = 'desc';
const DEFAULT_SEARCH_PAGE = 1;
const searchTextModes = new Set(['smart', 'description', 'ocr', 'filename']);
```

Below `const AgentToolNameSchema = z.enum(AgentToolName).meta({ id: 'AgentToolName' });`, add:

```ts
const AgentSearchAssetsModeSchema = z
  .enum(['metadata', 'smart', 'description', 'ocr', 'filename'])
  .meta({ id: 'AgentSearchAssetsMode' });
const AgentSearchAssetsOrderSchema = z.enum(['asc', 'desc', 'relevance']).meta({ id: 'AgentSearchAssetsOrder' });
```

- [ ] **Step 2: Expand `AgentSearchAssetsFiltersSchema`**

Replace the current `AgentSearchAssetsFiltersSchema = z.object({ ... })` with:

```ts
const AgentSearchAssetsFiltersSchema = z
  .strictObject({
    takenAfter: isoDatetimeToDate.optional(),
    takenBefore: isoDatetimeToDate.optional(),
    createdAfter: isoDatetimeToDate.optional(),
    createdBefore: isoDatetimeToDate.optional(),
    updatedAfter: isoDatetimeToDate.optional(),
    updatedBefore: isoDatetimeToDate.optional(),
    city: z.string().trim().nullable().optional(),
    state: z.string().trim().nullable().optional(),
    country: z.string().trim().nullable().optional(),
    make: z.string().trim().nullable().optional(),
    model: z.string().trim().nullable().optional(),
    lensModel: z.string().trim().nullable().optional(),
    isFavorite: z.boolean().optional(),
    isNotInAlbum: z.boolean().optional(),
    type: AssetTypeSchema.optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    tagIds: z.array(uuid).optional(),
    albumIds: z.array(uuid).optional(),
    personIds: z.array(uuid).optional(),
    spaceId: uuid.optional(),
    spacePersonIds: z.array(uuid).optional(),
    withSharedSpaces: z.boolean().optional(),
    visibility: AssetVisibilitySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.spacePersonIds?.length && !value.spaceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['spacePersonIds'],
        message: 'spacePersonIds requires spaceId',
      });
    }

    if (value.spaceId && value.withSharedSpaces) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['withSharedSpaces'],
        message: 'Cannot use both spaceId and withSharedSpaces',
      });
    }
  })
  .meta({ id: 'AgentSearchAssetsFilters' });
```

- [ ] **Step 3: Expand `AgentSearchAssetsToolRequestSchema`**

Replace the current `AgentSearchAssetsToolRequestSchema` with:

```ts
const AgentSearchAssetsToolRequestSchema = z
  .strictObject({
    mode: AgentSearchAssetsModeSchema.optional(),
    query: z.string().trim().min(1).max(500).optional(),
    filters: AgentSearchAssetsFiltersSchema.optional(),
    limit: z.number().int().min(1).max(MAX_TOOL_LIMIT).optional(),
    page: z.number().int().min(1).optional(),
    order: AgentSearchAssetsOrderSchema.optional(),
    toolCallId: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    const mode = value.mode ?? DEFAULT_SEARCH_MODE;
    const hasNewSearchFields =
      value.filters !== undefined ||
      value.limit !== undefined ||
      value.query !== undefined ||
      value.page !== undefined ||
      value.order !== undefined ||
      value.mode !== undefined;

    if (value.toolCallId && hasNewSearchFields) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either search fields or toolCallId, not both',
      });
    }

    if (mode === 'metadata' && value.query !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['query'],
        message: 'query is only supported for smart, description, ocr, and filename search modes',
      });
    }

    if (searchTextModes.has(mode) && value.query === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['query'],
        message: `${mode} search requires a non-empty query`,
      });
    }
  })
  .transform((value) => {
    if (value.toolCallId) {
      return value;
    }

    const request = {
      mode: value.mode ?? DEFAULT_SEARCH_MODE,
      filters: value.filters ?? {},
      limit: value.limit ?? MAX_TOOL_LIMIT,
      page: value.page ?? DEFAULT_SEARCH_PAGE,
      order: value.order ?? DEFAULT_SEARCH_ORDER,
    };

    return value.query === undefined ? request : { ...request, query: value.query };
  })
  .meta({ id: 'AgentSearchAssetsToolRequestDto' });
```

- [ ] **Step 4: Update the old mutual-exclusion test expectation**

In `server/src/dtos/agent-tool.dto.spec.ts`, update the existing test named `rejects requests containing both filters/limit and toolCallId` to expect:

```ts
expectIssue(result, [], 'Provide either search fields or toolCallId, not both');
```

- [ ] **Step 5: Run DTO tests and verify pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit DTO request contract**

```bash
git add server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts
git commit -m "feat: expand pi search request contract"
```

---

### Task 3: Add Search Response Metadata Contract

**Files:**

- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`

- [ ] **Step 1: Write failing response DTO tests**

In `server/src/dtos/agent-tool.dto.spec.ts`, update the existing test named `encodes and parses search responses with assets and nextPage`:

```ts
it('encodes and parses search responses with assets and page metadata', () => {
  const response = {
    status: 'success' as const,
    toolCall: makeToolCall(),
    assets: makeAssets(),
    returnedCount: 1,
    hasMore: true,
    nextPage: '2',
    totalCount: 12,
    approximateTotal: 15,
  };
  const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode(response);

  expect(encoded.success).toBe(true);
  if (!encoded.success) {
    return;
  }

  if (encoded.data.status !== 'success') {
    return;
  }

  expect(encoded.data.assets[0].localDateTime).toBe('2026-05-14T12:00:00.000Z');
  expect(encoded.data.returnedCount).toBe(1);
  expect(encoded.data.hasMore).toBe(true);
  expect(encoded.data.nextPage).toBe('2');
  expect(encoded.data.totalCount).toBe(12);
  expect(encoded.data.approximateTotal).toBe(15);

  const parsed = AgentSearchAssetsToolResponseDto.schema.safeParse(encoded.data);
  expect(parsed.success).toBe(true);
  if (parsed.success && parsed.data.status === 'success') {
    expect(parsed.data.assets[0].localDateTime).toEqual(new Date('2026-05-14T12:00:00.000Z'));
    expect(parsed.data.returnedCount).toBe(1);
    expect(parsed.data.hasMore).toBe(true);
    expect(parsed.data.nextPage).toBe('2');
    expect(parsed.data.totalCount).toBe(12);
    expect(parsed.data.approximateTotal).toBe(15);
  }
});

it('requires returnedCount and hasMore on search success responses', () => {
  const result = AgentSearchAssetsToolResponseDto.schema.safeParse({
    status: 'success',
    toolCall: makeToolCall(),
    assets: makeAssets(),
    nextPage: null,
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: ['returnedCount'] }),
      expect.objectContaining({ path: ['hasMore'] }),
    ]),
  );
});

it('encodes a final empty search page without a continuation page', () => {
  const response = {
    status: 'success' as const,
    toolCall: makeToolCall(),
    assets: [],
    returnedCount: 0,
    hasMore: false,
    nextPage: null,
  };

  const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode(response);

  expect(encoded.success).toBe(true);
  if (encoded.success && encoded.data.status === 'success') {
    expect(encoded.data.returnedCount).toBe(0);
    expect(encoded.data.hasMore).toBe(false);
    expect(encoded.data.nextPage).toBeNull();
  }
});
```

- [ ] **Step 2: Run DTO tests and verify failure**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts
```

Expected: FAIL because the response schema does not include `returnedCount`, `hasMore`, `totalCount`, or `approximateTotal`.

- [ ] **Step 3: Implement response DTO fields**

In `server/src/dtos/agent-tool.dto.ts`, update the success object inside `AgentSearchAssetsToolResponseSchema`:

```ts
      .object({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        assets: z.array(AgentAssetMetadataSchema),
        returnedCount: z.number().int().min(0),
        hasMore: z.boolean(),
        nextPage: z.string().nullable(),
        totalCount: z.number().int().min(0).optional(),
        approximateTotal: z.number().int().min(0).optional(),
      })
```

- [ ] **Step 4: Run DTO tests and verify pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit response contract**

```bash
git add server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts
git commit -m "feat: add pi search response metadata"
```

---

### Task 4: Update Shared Types And Service Execution Guards

**Files:**

- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/services/agent-tool.service.ts`
- Modify: `server/src/services/agent-tool.service.spec.ts`

- [ ] **Step 1: Write failing service tests for response metadata and guards**

In `server/src/services/agent-tool.service.spec.ts`, add these tests near the existing search tests:

```ts
it('returns search page metadata and stores expanded request metadata', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan(),
  });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.searchAgentMetadata.mockResolvedValue({ assets: [makeMetadata(assetId)], nextPage: '2' });

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { isFavorite: true },
    limit: 1,
    page: 1,
    order: 'desc',
  });

  expect(result).toEqual({
    status: 'success',
    toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
    assets: [expect.objectContaining({ id: assetId })],
    returnedCount: 1,
    hasMore: true,
    nextPage: '2',
  });
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      requestSummary: 'Search metadata assets (limit 1)',
      requestMetadata: {
        mode: 'metadata',
        filters: { isFavorite: true },
        limit: 1,
        page: 1,
        order: 'desc',
      },
    }),
  );
  expect(toolCallRepository.transition).toHaveBeenCalledWith(
    session.id,
    expect.any(String),
    AgentToolCallStatus.Executing,
    expect.objectContaining({
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Returned 1 asset(s)',
      redactedResponseMetadata: { assetIds: [assetId] },
      assetCount: 1,
    }),
  );
});

it.each([
  [
    { mode: 'smart', query: 'beach', filters: {}, limit: 5, page: 1, order: 'desc' },
    'smart search is not available yet',
  ],
  [
    { mode: 'description', query: 'birthday', filters: {}, limit: 5, page: 1, order: 'desc' },
    'description search is not available yet',
  ],
  [{ mode: 'ocr', query: 'invoice', filters: {}, limit: 5, page: 1, order: 'desc' }, 'ocr search is not available yet'],
  [
    { mode: 'filename', query: 'IMG_2026', filters: {}, limit: 5, page: 1, order: 'desc' },
    'filename search is not available yet',
  ],
  [
    {
      mode: 'metadata',
      filters: { createdAfter: new Date('2026-05-01T00:00:00.000Z') },
      limit: 5,
      page: 1,
      order: 'desc',
    },
    'createdAfter search is not available yet',
  ],
  [
    { mode: 'metadata', filters: { personIds: [newUuid()] }, limit: 5, page: 1, order: 'desc' },
    'personIds search is not available yet',
  ],
  [
    { mode: 'metadata', filters: { spaceId: newUuid() }, limit: 5, page: 1, order: 'desc' },
    'spaceId search is not available yet',
  ],
  [{ mode: 'metadata', filters: {}, limit: 5, page: 2, order: 'desc' }, 'page search is not available yet'],
  [{ mode: 'metadata', filters: {}, limit: 5, page: 1, order: 'asc' }, 'asc order search is not available yet'],
] as const)('denies future search contract fields before repository execution: %#', async (request, reason) => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan(),
  });

  sessionRepository.getById.mockResolvedValue(session);

  const result = await sut.searchAssets(auth, session.id, request);

  expect(result).toEqual({
    status: 'denied',
    reason,
    toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied, error: reason }),
  });
  expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run service tests and verify failure**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts
```

Expected: FAIL because service response metadata and future-field guards are not implemented.

- [ ] **Step 3: Update shared types**

In `server/src/types/agent-tool.types.ts`, add these types above `AgentToolSearchAssetsRequestMetadata`:

```ts
export type AgentSearchAssetsMode = 'metadata' | 'smart' | 'description' | 'ocr' | 'filename';

export type AgentSearchAssetsOrder = 'asc' | 'desc' | 'relevance';
```

Replace `AgentToolSearchAssetsRequestMetadata` with:

```ts
export type AgentToolSearchAssetsRequestMetadata = {
  mode: AgentSearchAssetsMode;
  query?: string;
  filters: AgentSearchAssetsFilters;
  limit: number;
  page: number;
  order: AgentSearchAssetsOrder;
};
```

Replace `AgentSearchAssetsFilters` with:

```ts
export type AgentSearchAssetsFilters = {
  takenAfter?: Date;
  takenBefore?: Date;
  createdAfter?: Date;
  createdBefore?: Date;
  updatedAfter?: Date;
  updatedBefore?: Date;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  make?: string | null;
  model?: string | null;
  lensModel?: string | null;
  isFavorite?: boolean;
  isNotInAlbum?: boolean;
  type?: AssetType;
  rating?: number | null;
  tagIds?: string[];
  albumIds?: string[];
  personIds?: string[];
  spaceId?: string;
  spacePersonIds?: string[];
  withSharedSpaces?: boolean;
  visibility?: AssetVisibility;
};
```

- [ ] **Step 4: Update imports**

In `server/src/services/agent-tool.service.ts`, import the new types:

```ts
  AgentSearchAssetsFilters,
  AgentSearchAssetsMode,
  AgentSearchAssetsOrder,
```

If those names are already partially imported, add only the missing names.

- [ ] **Step 5: Add guard helpers**

In `server/src/services/agent-tool.service.ts`, add these helpers near `validateSearchFilters`:

```ts
  private getUnsupportedSearchModeReason(mode: AgentSearchAssetsMode): string | null {
    return mode === 'metadata' ? null : `${mode} search is not available yet`;
  }

  private getUnsupportedSearchPagingReason(page: number, order: AgentSearchAssetsOrder): string | null {
    if (page !== 1) {
      return 'page search is not available yet';
    }

    if (order !== 'desc') {
      return `${order} order search is not available yet`;
    }

    return null;
  }

  private getUnsupportedSearchFilterReason(filters: AgentSearchAssetsFilters): string | null {
    const futureFields = [
      'createdAfter',
      'createdBefore',
      'updatedAfter',
      'updatedBefore',
      'personIds',
      'spaceId',
      'spacePersonIds',
      'withSharedSpaces',
      'visibility',
    ] as const;

    for (const field of futureFields) {
      const value = filters[field];
      if (Array.isArray(value) ? value.length > 0 : value !== undefined) {
        return `${field} search is not available yet`;
      }
    }

    return null;
  }
```

- [ ] **Step 6: Replace `validateSearchFilters` with `validateSearchRequest`**

Replace:

```ts
      validateAccess: (auth, session, request) => this.validateSearchFilters(auth, session, request.filters ?? {}),
```

with:

```ts
      validateAccess: (auth, session, request) => this.validateSearchRequest(auth, session, request),
```

Then replace the `validateSearchFilters(...)` method with:

```ts
  private async validateSearchRequest(
    auth: AuthDto,
    session: AgentSession,
    request: AgentSearchAssetsToolRequestDto,
  ): Promise<string | null> {
    const mode = request.mode ?? 'metadata';
    const page = request.page ?? 1;
    const order = request.order ?? 'desc';

    const modeReason = this.getUnsupportedSearchModeReason(mode);
    if (modeReason) {
      return modeReason;
    }

    const pagingReason = this.getUnsupportedSearchPagingReason(page, order);
    if (pagingReason) {
      return pagingReason;
    }

    const filterReason = this.getUnsupportedSearchFilterReason(request.filters ?? {});
    if (filterReason) {
      return filterReason;
    }

    const filters = request.filters ?? {};
    const albumIds = filters.albumIds ? new Set(filters.albumIds) : new Set<string>();
    if (albumIds.size > 0) {
      const readableAlbumIds = await this.getReadableAlbumIds(auth, session.permissionPlanSnapshot, albumIds);
      if (readableAlbumIds.size !== albumIds.size) {
        return 'One or more search filters are not accessible';
      }
    }

    const tagIds = filters.tagIds ? new Set(filters.tagIds) : new Set<string>();
    if (tagIds.size > 0) {
      const readableTagIds = await this.accessRepository.tag.checkOwnerAccess(auth.user.id, tagIds);
      if (readableTagIds.size !== tagIds.size) {
        return 'One or more search filters are not accessible';
      }
    }

    return null;
  }
```

- [ ] **Step 7: Update `searchAssetsDescriptor` response shape**

In `searchAssetsDescriptor`, change the generic result type from:

```ts
    { assets: AgentAssetMetadata[]; nextPage: string | null }
```

to:

```ts
    {
      assets: AgentAssetMetadata[];
      returnedCount: number;
      hasMore: boolean;
      nextPage: string | null;
      totalCount?: number;
      approximateTotal?: number;
    }
```

Update `requestSummary`:

```ts
      requestSummary: (request) => `Search ${request.mode ?? 'metadata'} assets (limit ${request.limit ?? 0})`,
```

Update `requestMetadata`:

```ts
      requestMetadata: (request) =>
        ({
          mode: request.mode ?? 'metadata',
          filters: request.filters ?? {},
          limit: request.limit ?? 0,
          page: request.page ?? 1,
          order: request.order ?? 'desc',
          ...(request.query === undefined ? {} : { query: request.query }),
        }) as AgentToolSearchAssetsRequestMetadata,
```

Update the `execute` return:

```ts
return {
  assets: result.assets.map((asset) => this.mapAssetMetadata(asset)),
  returnedCount: result.assets.length,
  hasMore: result.nextPage !== null,
  nextPage: result.nextPage,
};
```

- [ ] **Step 8: Run service tests and verify pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit service guards and response metadata**

```bash
git add server/src/types/agent-tool.types.ts server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts
git commit -m "feat: guard expanded pi search contract"
```

---

### Task 5: Update MCP Registry And Contract Guidance

**Files:**

- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`

- [ ] **Step 1: Write failing registry schema test updates**

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, replace the test named `advertises trip-album metadata filters on searchAssets` with:

```ts
it('advertises expanded search contract fields on searchAssets', () => {
  const searchTool = sut.listTools().find((tool) => tool.name === AgentToolName.SearchAssets);
  const searchFiltersSchema = searchTool
    ? getSchemaDefinition(searchTool.inputSchema, 'AgentSearchAssetsFilters')
    : undefined;

  expect(searchTool).toBeDefined();
  expect(searchTool?.description).toContain('metadata');
  expect(searchTool?.description).toContain('mode');
  expect(searchTool?.description).toContain('page');
  expect(searchTool?.inputSchema).toEqual(
    expect.objectContaining({
      properties: expect.objectContaining({
        mode: expect.any(Object),
        query: expect.any(Object),
        filters: expect.objectContaining({ $ref: '#/$defs/AgentSearchAssetsFilters' }),
        limit: expect.any(Object),
        page: expect.any(Object),
        order: expect.any(Object),
      }),
    }),
  );
  expect(searchFiltersSchema).toEqual(
    expect.objectContaining({
      properties: expect.objectContaining({
        takenAfter: expect.any(Object),
        takenBefore: expect.any(Object),
        createdAfter: expect.any(Object),
        updatedAfter: expect.any(Object),
        city: expect.any(Object),
        state: expect.any(Object),
        country: expect.any(Object),
        personIds: expect.any(Object),
        spaceId: expect.any(Object),
        spacePersonIds: expect.any(Object),
        withSharedSpaces: expect.any(Object),
        visibility: expect.any(Object),
        isNotInAlbum: expect.any(Object),
      }),
    }),
  );
});
```

- [ ] **Step 2: Write failing contract correction tests**

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, extend the `returns the search filter placement correction for supported filters at the argument root` test by adding `createdAfter` and `personIds` cases:

```ts
      const createdAfterCorrection = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
        requestShape: 'tool-arguments',
        issues: [{ path: '', message: 'Unrecognized key: "createdAfter"' }],
      });
      const personIdsCorrection = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
        requestShape: 'tool-arguments',
        issues: [{ path: '', message: 'Unrecognized key: "personIds"' }],
      });

      for (const correction of [countryCorrection, ratingCorrection, createdAfterCorrection, personIdsCorrection]) {
```

Then add new tests:

```ts
it('returns a metadata query correction when a model sends query with metadata mode', () => {
  const correction = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
    requestShape: 'tool-arguments',
    issues: [
      { path: 'query', message: 'query is only supported for smart, description, ocr, and filename search modes' },
    ],
  });

  expect(correction?.mistakeId).toBe('search-query-with-metadata-mode');
  expect(correction?.hint).toContain('Use mode smart, description, ocr, or filename when passing query');
});

it('returns a space person scope correction', () => {
  const correction = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
    requestShape: 'tool-arguments',
    issues: [{ path: 'filters.spacePersonIds', message: 'spacePersonIds requires spaceId' }],
  });

  expect(correction?.mistakeId).toBe('search-space-person-without-space');
  expect(correction?.hint).toContain('spacePersonIds requires filters.spaceId');
});
```

- [ ] **Step 3: Run contract tests and verify failure**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: FAIL because descriptions/common mistakes/examples are not updated.

- [ ] **Step 4: Update search tool contract**

In `server/src/services/agent-mcp-tool-contract.service.ts`, update `searchAssetsContract`:

```ts
  description: 'Find assets using Gallery search modes, metadata filters, and a bounded result page.',
  usage:
    'Put all search filters under filters. Use mode metadata for structured filters. Use only toolCallId when retrying a Gallery-approved search.',
```

In `argumentModes`, update the filtered search mode:

```ts
      description: 'Search visible assets with metadata filters.',
      requiredFields: ['filters'],
      forbiddenFields: ['toolCallId', 'query'],
      whenToUse:
        'Use when the user provides date, place, favorite, rating, album, tag, camera, media, people, or space filters.',
```

Add a text mode argument mode before `approvedRetryMode`:

```ts
    {
      name: 'text-search',
      description: 'Search visible assets with an explicit text-search mode and query.',
      requiredFields: ['mode', 'query'],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use only when the user asks for smart, OCR, description, or filename search.',
    },
```

Add examples:

```ts
    {
      name: 'metadata-page-search',
      description: 'Search a bounded metadata result page.',
      arguments: {
        mode: 'metadata',
        filters: {
          takenAfter: '2026-05-01T00:00:00.000Z',
          takenBefore: '2026-05-18T23:59:59.999Z',
          city: 'Berlin',
          country: 'Germany',
        },
        limit: 50,
        page: 1,
        order: 'desc',
      },
    },
    {
      name: 'future-smart-search-contract',
      description: 'Contract shape for smart search; execution is enabled in a later slice.',
      arguments: {
        mode: 'smart',
        query: 'beach sunset',
        filters: {
          country: 'Portugal',
        },
        limit: 25,
        page: 1,
        order: 'relevance',
      },
    },
```

Update `commonMistakes[search-filters-outside-filters].match.unexpectedFields` to include:

```ts
          'createdAfter',
          'createdBefore',
          'updatedAfter',
          'updatedBefore',
          'personIds',
          'spaceId',
          'spacePersonIds',
          'withSharedSpaces',
          'visibility',
```

Update its hint:

```ts
      hint:
        'Place date, location, favorite, rating, album, tag, camera, people, space, visibility, and media filters inside the filters object.',
      exampleName: 'metadata-page-search',
```

Add common mistakes:

```ts
    {
      id: 'search-query-with-metadata-mode',
      match: { issuePath: 'query', messageIncludes: 'query is only supported' },
      hint: 'Use mode smart, description, ocr, or filename when passing query. Omit query for metadata-only searches.',
      exampleName: 'future-smart-search-contract',
    },
    {
      id: 'search-space-person-without-space',
      match: { issuePath: 'filters.spacePersonIds', messageIncludes: 'spacePersonIds requires spaceId' },
      hint: 'spacePersonIds requires filters.spaceId. Use global personIds outside a specific shared space.',
      exampleName: 'metadata-page-search',
    },
```

- [ ] **Step 5: Update registry descriptions**

In `server/src/services/agent-mcp-tool-registry.service.ts`, update `propertyDescriptions` so generated MCP schemas explain the expanded fields:

```ts
  mode: 'Search mode. Use metadata for structured filters, or smart, description, ocr, or filename with query.',
  query: 'Query text. For searchAssets use this with smart, description, ocr, or filename modes; for searchUsers use a name or email.',
  filters: 'Put structured search filters here for date, place, people, space, camera, favorite, rating, album, tag, visibility, and media searches.',
  limit: 'Maximum number of results to return. Use a positive integer up to 10000.',
  page: 'One-based result page for continuing a previous search with the same mode, query, filters, order, and limit.',
  order: 'Result order for the selected search mode.',
```

Then update the `SearchAssets` base tool description in `buildTools`:

```ts
      description: `Search the photo library by mode, metadata filters, text query, page, order, and result limit.${approvedRequestInstruction}`,
```

- [ ] **Step 6: Run contract tests and verify pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit MCP contract guidance**

```bash
git add server/src/services/agent-mcp-tool-registry.service.ts \
  server/src/services/agent-mcp-tool-registry.service.spec.ts \
  server/src/services/agent-mcp-tool-contract.service.ts \
  server/src/services/agent-mcp-tool-contract.service.spec.ts
git commit -m "docs: expand pi search mcp contract"
```

---

### Task 6: Regenerate OpenAPI, SDK, And MCP Docs

**Files:**

- Modify generated files from OpenAPI generation.
- Modify generated Pi MCP docs and prompt files.

- [ ] **Step 1: Run generated API update**

Run:

```bash
cd open-api && ./bin/generate-open-api.sh typescript
```

Expected: PASS. Review generated changes in `open-api/immich-openapi-specs.json` and `open-api/typescript-sdk`.

- [ ] **Step 2: Build server for MCP generation scripts**

Run:

```bash
pnpm --dir server build
```

Expected: PASS.

- [ ] **Step 3: Regenerate Pi MCP docs and prompt**

Run:

```bash
pnpm --dir server sync:agent-mcp-docs
pnpm --dir server sync:agent-mcp-prompt
```

Expected: PASS. Generated files should include the expanded `searchAssets` schema, examples, and correction guidance.

- [ ] **Step 4: Format docs**

Run:

```bash
pnpm --dir docs format
```

Expected: PASS.

- [ ] **Step 5: Review generated diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only generated OpenAPI/SDK/docs files plus files intentionally changed by this slice.

- [ ] **Step 6: Commit generated artifacts**

```bash
git add open-api/immich-openapi-specs.json \
  open-api/typescript-sdk \
  docs/superpowers/generated/pi-agent-mcp-tools.md \
  agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
git commit -m "chore: regenerate pi search contract artifacts"
```

---

### Task 7: Final Verification

**Files:**

- No new files expected.

- [ ] **Step 1: Run focused server tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs \
  src/dtos/agent-tool.dto.spec.ts \
  src/services/agent-tool.service.spec.ts \
  src/services/agent-mcp-tool-registry.service.spec.ts \
  src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run server lint, format, and typecheck**

Run:

```bash
pnpm --dir server lint
pnpm --dir server format
pnpm --dir server check
```

Expected: PASS for all three commands.

- [ ] **Step 3: Verify docs formatting**

Run:

```bash
pnpm --dir docs format
```

Expected: PASS.

- [ ] **Step 4: Verify no silent future-filter execution remains**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "future search contract fields"
```

Expected: PASS. The focused test must assert `assetRepository.searchAgentMetadata` is not called for future-slice search modes/filters.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: worktree is clean after the commits above, or only intentional uncommitted files remain if a commit was skipped due to no generated diff.

---

## Self-Review

- Spec coverage: This plan implements Slice 1 only. It covers schema expansion, mode-specific validation, root-level filter rejection, `toolCallId` mutual exclusion, result metadata, MCP docs/correction hints, and generated artifacts.
- TDD coverage: Tasks 1, 3, 4, and 5 require failing tests before implementation. Final verification repeats focused and broad checks.
- Edge cases covered: empty metadata defaults, text mode without query, metadata mode with query, `rating: null`, limit above max, invalid page/order, page with no further result metadata, root-level filters, `spacePersonIds` without `spaceId`, `spaceId` with `withSharedSpaces`, and future-slice filters being denied before repository execution.
- Consistency with design: Page-based continuation, cheap count semantics, explicit modes, and metadata default match the Decisions section of the spec.
