# Pi Agent Handle-First Tool Contract Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add metadata-only `curateSelection` so Pi can narrow a search-backed selection into a new derived selection handle without seeing or copying asset UUIDs.

**Architecture:** Implement `curateSelection` as a read-class transform tool. It consumes a same-session `selectionHandleId`, hydrates at most the allowed metadata-only source cap server-side, applies deterministic metadata ranking/diversification, creates a new `agent_selection_handle` for the selected assets, and returns only handle metadata, criteria summaries, warnings, and bounded `itemRef` samples. It does not create write plans, reject raw planning IDs, raise search limits, inspect previews, or call image-quality analysis.

**Tech Stack:** TypeScript/NestJS/Zod/Vitest for server DTOs, `AgentToolService` read-tool execution, selection handle persistence, MCP contracts, generated docs, and generated prompt modules.

---

## Slice Scope

Implement only Slice 4 from `docs/superpowers/specs/2026-05-27-pi-agent-handle-first-tool-contract-design.md`:

- Add metadata-only `curateSelection`.
- Support `metadata-highlights`, `date-spread`, `favorites-first`, and `cover-candidate` strategies.
- Return a new derived `selectionHandle`, `criteriaSummary`, source/selected counts, warnings, and optional `itemRef` sample.
- Validate `targetCount` bounds and request modes.
- If `targetCount` is greater than eligible assets, select all eligible assets and return a warning.
- If source handle size is over the metadata-only curation cap, fail recoverably with narrowing guidance before metadata hydration.
- Missing/deleted metadata rows must not leak IDs and must still produce stable output from remaining rows.
- Provider-visible responses, audit response metadata, prompt guidance, docs, and generated artifacts must not contain selected asset ID arrays.

Out of scope:

- Do not add `analyzeAssetQuality` or preview-assisted scoring.
- Do not add `proposeAlbumFromSelection` or `proposeAssetBatchFromSelection`.
- Do not harden planning raw `assetIds`; Slice 5 owns provider-facing planning rejection.
- Do not raise search limits; Slice 6 owns limit rebalance.
- Do not make `itemRef` usable for writes.

## Deterministic Curation Rules

The service must implement this deterministic V1 behavior:

- Source cap: `min(session.permissionPlanSnapshot.limits.maxAssetsPerToolCall, 1000)`. If `handle.assetCount` exceeds that cap, throw a recoverable tool error with `recovery.kind = 'selection-too-large'`, `sourceAssetCount`, `maxSourceAssetCount`, and an instruction to rerun or page `searchAssets` with narrower filters.
- Eligible rows: hydrate `handle.assetIds` with `assetRepository.getAgentMetadataByIds(handle.assetIds)`, preserve original handle order through an ID map, and skip missing rows.
- Constraints:
  - `types` keeps only `IMAGE` and/or `VIDEO`.
  - `excludeVideos: true` removes `VIDEO` rows after `types`.
  - `includeFavorites: false` excludes favorite rows; `true` or omitted leaves favorites eligible.
  - `minRating` keeps rows with `exifInfo.rating >= minRating`.
  - `diversifyBy` accepts `date`, `location`, `people`, and `tags`; V1 applies `date`, `location`, and `tags`, and records a criteria note that `people` diversity is not available from metadata-only rows.
- Base rank, descending:
  - favorite: `+100`
  - rating: `rating * 10`, with missing/null rating as `0`
  - location present: `+3`
  - local date present: `+2`
  - tag count: `min(tagCount, 3)`
  - image type: `+1` for `cover-candidate`, `0` otherwise
  - tie-breakers: `localDateTime` newest first, original handle order ascending, then asset ID ascending internally only.
- `metadata-highlights`: rank by base rank, then apply requested diversification groups in order.
- `favorites-first`: favorite rows first by base rank, then non-favorites by base rank.
- `date-spread`: round-robin across local-date groups sorted newest first; rows inside each date group use base rank.
- `cover-candidate`: only `IMAGE` rows are eligible unless `types` explicitly omits images, then the eligible set can be empty. Rank by base rank with the image bonus.
- If `targetCount > eligibleCount`, select all eligible rows and include warning text `Requested ${targetCount} assets but only ${eligibleCount} eligible assets were available.`
- If all rows are missing or filtered out, create a derived empty handle and include warning text `No eligible metadata rows were available for this curation request.`

## Files

- Modify: `server/src/enum.ts`
- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/types/agent-mcp-contract.types.ts`
- Modify: `server/src/services/agent-mcp-recoverable-tool-error.ts`
- Modify: `server/src/services/agent-tool.service.ts`
- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `server/src/services/agent-mcp-docs.service.ts`
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Generated: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Generated: `docs/superpowers/generated/pi-agent-mcp-tools.md`

---

## Task 1: DTO And Type Surface

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
- Modify: `server/src/types/agent-tool.types.ts`

- [ ] **Step 1: Add failing DTO tests**

In `server/src/dtos/agent-tool.dto.spec.ts`, add tests near the `readSelectionMetadata` tests:

```ts
describe('AgentCurateSelectionToolRequestSchema', () => {
  const selectionHandleId = '00000000-0000-4000-8000-000000000333';

  it('defaults strategy, constraints, and sample size for selection curation', () => {
    expect(
      AgentReadToolRequestSchemas[AgentToolName.CurateSelection].parse({
        selectionHandleId,
        targetCount: 15,
      }),
    ).toEqual({
      selectionHandleId,
      targetCount: 15,
      strategy: 'metadata-highlights',
      constraints: {},
      sampleSize: 10,
    });
  });

  it('validates curation request modes and bounds', () => {
    expect(
      AgentReadToolRequestSchemas[AgentToolName.CurateSelection].safeParse({
        selectionHandleId,
        targetCount: 0,
      }).success,
    ).toBe(false);
    expect(
      AgentReadToolRequestSchemas[AgentToolName.CurateSelection].safeParse({
        selectionHandleId,
        targetCount: 1001,
      }).success,
    ).toBe(false);
    expect(
      AgentReadToolRequestSchemas[AgentToolName.CurateSelection].safeParse({
        selectionHandleId,
        targetCount: 5,
        toolCallId: '00000000-0000-4000-8000-000000000111',
      }).success,
    ).toBe(false);
    expect(
      AgentReadToolRequestSchemas[AgentToolName.CurateSelection].safeParse({
        toolCallId: '00000000-0000-4000-8000-000000000111',
        targetCount: 5,
      }).success,
    ).toBe(false);
    expect(
      AgentReadToolRequestSchemas[AgentToolName.CurateSelection].safeParse({
        selectionHandleId,
        targetCount: 5,
        constraints: { diversifyBy: ['date', 'date'] },
      }).success,
    ).toBe(false);
    expect(
      AgentReadToolRequestSchemas[AgentToolName.CurateSelection].parse({
        selectionHandleId,
        targetCount: 1,
        strategy: 'cover-candidate',
        constraints: { types: ['IMAGE'], minRating: 4, excludeVideos: true, diversifyBy: ['location'] },
        sampleSize: 0,
      }),
    ).toEqual({
      selectionHandleId,
      targetCount: 1,
      strategy: 'cover-candidate',
      constraints: { types: ['IMAGE'], minRating: 4, excludeVideos: true, diversifyBy: ['location'] },
      sampleSize: 0,
    });
  });

  it('encodes curation responses without selected asset UUID fields', () => {
    const encoded = AgentCurateSelectionToolResponseDto.schema.safeEncode({
      status: 'success',
      toolCall: makeToolCall({ toolName: AgentToolName.CurateSelection }),
      summary: 'Curated 3 metadata-only highlights from 12 source assets.',
      strategy: 'metadata-highlights',
      selectionHandle: {
        id: selectionHandleId,
        sourceRef: `asset-source:search:${selectionHandleId}`,
        assetCount: 3,
        sourceToolCallId: '00000000-0000-4000-8000-000000000444',
        expiresAt: new Date('2026-05-27T12:00:00.000Z'),
      },
      sourceAssetCount: 12,
      selectedAssetCount: 3,
      criteriaSummary: ['Metadata-only curation used favorites, ratings, dates, tags, and location.'],
      warnings: ['Requested 5 assets but only 3 eligible assets were available.'],
      sample: { sampleSize: 1, items: [{ itemRef: 'item:001', isFavorite: true }] },
      resultSize: {
        returnedItems: 3,
        hasMore: false,
        nextPage: null,
        estimatedBytes: 512,
        truncated: false,
        omittedFields: [],
      },
    });

    expect(encoded.success).toBe(true);
    if (!encoded.success) {
      throw new Error('Expected curation response to encode');
    }
    expect(JSON.stringify(encoded.data)).not.toContain('"assetIds"');
    expect(JSON.stringify(encoded.data)).not.toContain('"assetId"');
    expect(JSON.stringify(encoded.data)).not.toContain('"sampleAssetIds"');
  });
});
```

Update the top import from `src/dtos/agent-tool.dto` to include `AgentCurateSelectionToolResponseDto`.

- [ ] **Step 2: Run DTO tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts -t "CurateSelection|curation"
```

Expected: FAIL because `AgentToolName.CurateSelection`, request schema, and response DTO do not exist.

- [ ] **Step 3: Add enum, request schema, response schema, and types**

In `server/src/enum.ts`, add after `ReadSelectionMetadata`:

```ts
CurateSelection = 'curateSelection',
```

In `server/src/dtos/agent-tool.dto.ts`, add constants and schemas near the selection metadata constants:

```ts
const MAX_CURATE_SELECTION_TARGET_COUNT = 1000;
const DEFAULT_CURATE_SELECTION_SAMPLE_SIZE = 10;
const AgentCurateSelectionStrategySchema = z
  .enum(['metadata-highlights', 'date-spread', 'favorites-first', 'cover-candidate'])
  .meta({ id: 'AgentCurateSelectionStrategy' });
const AgentCurateSelectionDiversifyBySchema = z
  .enum(['date', 'location', 'people', 'tags'])
  .meta({ id: 'AgentCurateSelectionDiversifyBy' });
const AgentCurateSelectionAssetTypeSchema = z.enum(['IMAGE', 'VIDEO']).meta({ id: 'AgentCurateSelectionAssetType' });
const AgentCurateSelectionConstraintsSchema = z
  .strictObject({
    types: z.array(AgentCurateSelectionAssetTypeSchema).min(1).max(2).optional(),
    includeFavorites: z.boolean().optional(),
    minRating: z.number().int().min(1).max(5).optional(),
    excludeVideos: z.boolean().optional(),
    diversifyBy: z.array(AgentCurateSelectionDiversifyBySchema).min(1).max(4).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.types && new Set(value.types).size !== value.types.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['types'], message: 'types must be unique' });
    }
    if (value.diversifyBy && new Set(value.diversifyBy).size !== value.diversifyBy.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diversifyBy'],
        message: 'diversifyBy values must be unique',
      });
    }
  })
  .meta({ id: 'AgentCurateSelectionConstraints' });
```

Add request schema after `AgentReadSelectionMetadataToolRequestSchema`:

```ts
const AgentCurateSelectionToolRequestSchema = z
  .strictObject({
    selectionHandleId: uuid.optional(),
    targetCount: z.number().int().min(1).max(MAX_CURATE_SELECTION_TARGET_COUNT).optional(),
    strategy: AgentCurateSelectionStrategySchema.optional(),
    criteria: z.string().trim().min(1).max(500).optional(),
    constraints: AgentCurateSelectionConstraintsSchema.optional(),
    sampleSize: z.number().int().min(0).max(MAX_SELECTION_METADATA_SAMPLE_SIZE).optional(),
    toolCallId: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.selectionHandleId && value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either selectionHandleId or toolCallId, not both',
      });
    }
    if (
      (value.targetCount !== undefined ||
        value.strategy !== undefined ||
        value.criteria !== undefined ||
        value.constraints !== undefined ||
        value.sampleSize !== undefined) &&
      value.toolCallId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either selectionHandleId or toolCallId, not both',
      });
    }
    if (!value.selectionHandleId && !value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Provide selectionHandleId and targetCount for a new curation request or toolCallId for an approved request',
      });
    }
    if (value.selectionHandleId && value.targetCount === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetCount'], message: 'targetCount is required' });
    }
  })
  .transform((value) =>
    value.toolCallId
      ? value
      : {
          ...value,
          strategy: value.strategy ?? 'metadata-highlights',
          constraints: value.constraints ?? {},
          sampleSize: value.sampleSize ?? DEFAULT_CURATE_SELECTION_SAMPLE_SIZE,
        },
  )
  .meta({ id: 'AgentCurateSelectionToolRequestDto' });
```

Add the request schema to `AgentReadToolRequestSchemas` immediately after `ReadSelectionMetadata`:

```ts
[AgentToolName.CurateSelection]: AgentCurateSelectionToolRequestSchema,
```

Add response schema after `AgentReadSelectionMetadataToolResponseSchema`:

```ts
const AgentCurateSelectionToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentCurateSelectionToolApprovalRequiredResponse'),
    deniedResponse('AgentCurateSelectionToolDeniedResponse'),
    z
      .strictObject({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        summary,
        strategy: AgentCurateSelectionStrategySchema,
        selectionHandle: AgentSearchAssetsSelectionHandleSchema,
        sourceAssetCount: z.number().int().min(0),
        selectedAssetCount: z.number().int().min(0),
        criteriaSummary: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
        warnings: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
        sample: AgentSearchAssetsSampleSchema.optional(),
        resultSize: AgentToolResultSizeSchema,
      })
      .meta({ id: 'AgentCurateSelectionToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentCurateSelectionToolResponseDto' });
```

Export DTO and response DTO near the selection metadata exports:

```ts
export class AgentCurateSelectionToolRequestDto extends createZodDto(AgentCurateSelectionToolRequestSchema) {}
export const AgentCurateSelectionToolResponseDto = namedZodDto(
  'AgentCurateSelectionToolResponseDto',
  AgentCurateSelectionToolResponseSchema,
);
export type AgentCurateSelectionToolResponseDto = z.output<typeof AgentCurateSelectionToolResponseSchema>;
```

In `server/src/types/agent-tool.types.ts`, add:

```ts
export type AgentCurateSelectionStrategy =
  | 'metadata-highlights'
  | 'date-spread'
  | 'favorites-first'
  | 'cover-candidate';

export type AgentCurateSelectionDiversifyBy = 'date' | 'location' | 'people' | 'tags';

export type AgentCurateSelectionConstraints = {
  types?: Array<'IMAGE' | 'VIDEO'>;
  includeFavorites?: boolean;
  minRating?: number;
  excludeVideos?: boolean;
  diversifyBy?: AgentCurateSelectionDiversifyBy[];
};

export type AgentToolCurateSelectionRequestMetadata = {
  selectionHandleId: string;
  targetCount: number;
  strategy: AgentCurateSelectionStrategy;
  criteria?: string;
  constraints: AgentCurateSelectionConstraints;
  sampleSize: number;
};
```

Add `AgentToolCurateSelectionRequestMetadata` to `AgentToolRequestMetadata`.

- [ ] **Step 4: Run DTO tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts -t "CurateSelection|curation"
```

Expected: PASS.

- [ ] **Step 5: Commit DTO and type surface**

Run:

```bash
git add server/src/enum.ts server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts server/src/types/agent-tool.types.ts
git commit -m "test: define selection curation contract"
```

---

## Task 2: Metadata Curation Service And MCP Dispatch

**Files:**

- Modify: `server/src/services/agent-mcp-recoverable-tool-error.ts`
- Modify: `server/src/services/agent-tool.service.ts`
- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Modify: `server/src/types/agent-mcp-contract.types.ts`

- [ ] **Step 1: Add failing service tests**

In `server/src/services/agent-tool.service.spec.ts`, add this helper near `makeMetadata`:

```ts
const makeCurateHandle = (session: AgentSession, userId: string, assetIds: string[], overrides = {}) => ({
  id: newUuid(),
  sessionId: session.id,
  userId,
  sourceToolCallId: newUuid(),
  assetIds,
  assetCount: assetIds.length,
  sampleAssetIds: assetIds.slice(0, 25),
  expiresAt: new Date(now.getTime() + 60 * 60_000),
  createdAt: now,
  updateId: newUuid(),
  ...overrides,
});
```

Add tests near the `readSelectionMetadata` tests:

```ts
it('curateSelection creates a derived handle with deterministic metadata highlights and no response ids', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid(), newUuid(), newUuid(), newUuid()];
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
  const sourceHandle = makeCurateHandle(session, auth.user.id, assetIds);
  const derivedHandle = makeCurateHandle(session, auth.user.id, [assetIds[1], assetIds[2]], {
    sourceToolCallId: newUuid(),
  });

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue(sourceHandle);
  assetRepository.getAgentMetadataByIds.mockResolvedValue([
    makeMetadata(assetIds[0], { exifInfo: { ...makeMetadata(assetIds[0]).exifInfo!, rating: 2 } }),
    makeMetadata(assetIds[1], { isFavorite: true, originalFileName: 'favorite.jpg' }),
    makeMetadata(assetIds[2], { exifInfo: { ...makeMetadata(assetIds[2]).exifInfo!, rating: 5, city: 'Paris' } }),
    makeMetadata(assetIds[3], { exifInfo: { ...makeMetadata(assetIds[3]).exifInfo!, rating: null, city: null } }),
  ] as never);
  selectionHandleRepository.create.mockResolvedValue(derivedHandle);

  const result = await sut.curateSelection(auth, session.id, {
    selectionHandleId: sourceHandle.id,
    targetCount: 2,
    strategy: 'metadata-highlights',
    constraints: { diversifyBy: ['location'] },
    sampleSize: 2,
  });

  expect(selectionHandleRepository.create).toHaveBeenCalledWith({
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: expect.any(String),
    assetIds: [assetIds[1], assetIds[2]],
    expiresAt: expect.any(Date),
  });
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    return;
  }
  expect(result.selectionHandle).toMatchObject({ id: derivedHandle.id, assetCount: 2 });
  expect(result.sourceAssetCount).toBe(4);
  expect(result.selectedAssetCount).toBe(2);
  expect(result.criteriaSummary.join(' ')).toMatch(/metadata-only/i);
  expect(result.criteriaSummary.join(' ')).not.toMatch(/quality scoring|preview inspected/i);
  expect(result.sample?.items.map((item) => item.itemRef)).toEqual(['item:001', 'item:002']);
  expect(JSON.stringify(result)).not.toContain(assetIds[1]);
  expect(JSON.stringify(result)).not.toContain('"assetIds"');
  expect(JSON.stringify(result)).not.toContain('"sampleAssetIds"');
});

it('curateSelection spreads dates deterministically and warns when target exceeds eligible assets', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid(), newUuid(), newUuid()];
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
  const sourceHandle = makeCurateHandle(session, auth.user.id, assetIds);
  const derivedHandle = makeCurateHandle(session, auth.user.id, assetIds);

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue(sourceHandle);
  assetRepository.getAgentMetadataByIds.mockResolvedValue([
    makeMetadata(assetIds[0], { localDateTime: new Date('2026-05-01T10:00:00.000Z') }),
    makeMetadata(assetIds[1], { localDateTime: new Date('2026-05-02T10:00:00.000Z') }),
    makeMetadata(assetIds[2], { localDateTime: new Date('2026-05-01T11:00:00.000Z') }),
  ] as never);
  selectionHandleRepository.create.mockResolvedValue(derivedHandle);

  const result = await sut.curateSelection(auth, session.id, {
    selectionHandleId: sourceHandle.id,
    targetCount: 5,
    strategy: 'date-spread',
  });

  expect(selectionHandleRepository.create).toHaveBeenCalledWith(expect.objectContaining({ assetIds }));
  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.warnings).toContain('Requested 5 assets but only 3 eligible assets were available.');
    expect(result.criteriaSummary.join(' ')).toMatch(/date-spread/i);
  }
});

it('curateSelection supports cover-candidate constraints and sampleSize zero', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid(), newUuid(), newUuid()];
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
  const sourceHandle = makeCurateHandle(session, auth.user.id, assetIds);
  const derivedHandle = makeCurateHandle(session, auth.user.id, [assetIds[2]]);

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue(sourceHandle);
  assetRepository.getAgentMetadataByIds.mockResolvedValue([
    makeMetadata(assetIds[0], { type: AssetType.Video }),
    makeMetadata(assetIds[1], {
      type: AssetType.Image,
      exifInfo: { ...makeMetadata(assetIds[1]).exifInfo!, rating: 3 },
    }),
    makeMetadata(assetIds[2], {
      type: AssetType.Image,
      isFavorite: true,
      exifInfo: { ...makeMetadata(assetIds[2]).exifInfo!, rating: 5 },
    }),
  ] as never);
  selectionHandleRepository.create.mockResolvedValue(derivedHandle);

  const result = await sut.curateSelection(auth, session.id, {
    selectionHandleId: sourceHandle.id,
    targetCount: 1,
    strategy: 'cover-candidate',
    constraints: { excludeVideos: true },
    sampleSize: 0,
  });

  expect(selectionHandleRepository.create).toHaveBeenCalledWith(expect.objectContaining({ assetIds: [assetIds[2]] }));
  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.sample).toBeUndefined();
    expect(result.criteriaSummary.join(' ')).toMatch(/cover-candidate/i);
  }
});

it('curateSelection skips missing metadata rows and creates an empty handle when none are eligible', async () => {
  const auth = AuthFactory.create();
  const missingAssetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
  const sourceHandle = makeCurateHandle(session, auth.user.id, [missingAssetId]);
  const derivedHandle = makeCurateHandle(session, auth.user.id, []);

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue(sourceHandle);
  assetRepository.getAgentMetadataByIds.mockResolvedValue([] as never);
  selectionHandleRepository.create.mockResolvedValue(derivedHandle);

  const result = await sut.curateSelection(auth, session.id, {
    selectionHandleId: sourceHandle.id,
    targetCount: 1,
  });

  expect(selectionHandleRepository.create).toHaveBeenCalledWith(expect.objectContaining({ assetIds: [] }));
  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.selectedAssetCount).toBe(0);
    expect(result.warnings).toContain('No eligible metadata rows were available for this curation request.');
    expect(JSON.stringify(result)).not.toContain(missingAssetId);
  }
});

it('curateSelection asks for narrowing when the source handle is over the metadata curation cap', async () => {
  const auth = AuthFactory.create();
  const assetIds = Array.from({ length: 101 }, () => newUuid());
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ limits: { maxAssetsPerToolCall: 100 } }),
  });
  const sourceHandle = makeCurateHandle(session, auth.user.id, assetIds);

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue(sourceHandle);

  const thrown = await sut
    .curateSelection(auth, session.id, { selectionHandleId: sourceHandle.id, targetCount: 10 })
    .catch((error: unknown) => error);

  expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
  expect((thrown as AgentMcpRecoverableToolError).content.recovery).toMatchObject({
    kind: 'selection-too-large',
    sourceAssetCount: 101,
    maxSourceAssetCount: 100,
  });
  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  expect(JSON.stringify((thrown as AgentMcpRecoverableToolError).content)).not.toContain(assetIds[0]);
});
```

- [ ] **Step 2: Add failing MCP dispatch tests**

In `server/src/services/agent-mcp.service.spec.ts`, add `CurateSelection` to the read-tool dispatch table and add:

```ts
it('delegates curateSelection and keeps MCP text compact', async () => {
  const selectionHandleId = factory.uuid();
  const serviceResult = {
    status: 'success',
    toolCall: null,
    summary: 'Curated 2 metadata-only highlights from 4 source assets.',
    strategy: 'metadata-highlights',
    selectionHandle: {
      id: factory.uuid(),
      sourceRef: `asset-source:search:${factory.uuid()}`,
      assetCount: 2,
      sourceToolCallId: null,
      expiresAt: new Date('2026-05-27T12:00:00.000Z'),
    },
    sourceAssetCount: 4,
    selectedAssetCount: 2,
    criteriaSummary: ['Metadata-only curation used favorites and ratings.'],
    resultSize: {
      returnedItems: 2,
      hasMore: false,
      nextPage: null,
      estimatedBytes: 512,
      truncated: false,
      omittedFields: [],
    },
  };
  toolService.curateSelection.mockResolvedValue(serviceResult as never);

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.CurateSelection, {
      selectionHandleId,
      targetCount: 2,
      strategy: 'metadata-highlights',
    }),
  )) as AgentMcpSuccessResponse;

  expect(toolService.curateSelection).toHaveBeenCalledWith(auth, sessionId, {
    selectionHandleId,
    targetCount: 2,
    strategy: 'metadata-highlights',
    constraints: {},
    sampleSize: 10,
  });
  expectToolResult(response, `${AgentToolName.CurateSelection}-call`, serviceResult, serviceResult.summary);
});
```

- [ ] **Step 3: Run service/MCP tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts -t "curateSelection|curation"
```

Expected: FAIL because `AgentToolService.curateSelection`, curation scoring, recoverable narrowing, and MCP dispatch do not exist.

- [ ] **Step 4: Add recoverable selection-too-large helper**

In `server/src/services/agent-mcp-recoverable-tool-error.ts`, add:

```ts
export const selectionTooLargeError = (input: {
  toolName: AgentToolName;
  sourceAssetCount: number;
  maxSourceAssetCount: number;
  instruction: string;
}) =>
  new AgentMcpRecoverableToolError({
    status: 'error',
    error: 'Selection is too large for metadata-only curation',
    toolName: input.toolName,
    retryable: true,
    hint: input.instruction,
    recovery: {
      kind: 'selection-too-large',
      sourceAssetCount: input.sourceAssetCount,
      maxSourceAssetCount: input.maxSourceAssetCount,
      instruction: input.instruction,
    },
  });
```

- [ ] **Step 5: Implement service method, descriptor, and deterministic scorer**

In `server/src/services/agent-tool.service.ts`, import:

```ts
AgentCurateSelectionToolRequestDto,
AgentCurateSelectionToolResponseDto,
```

from `src/dtos/agent-tool.dto`; import `selectionTooLargeError`; and import these types:

```ts
AgentCurateSelectionConstraints,
AgentCurateSelectionStrategy,
AgentToolCurateSelectionRequestMetadata,
```

Add:

```ts
const maxMetadataCurationSourceAssets = 1000;

type PreparedCurateSelectionRequest = AgentCurateSelectionToolRequestDto & {
  resolvedSourceAssetCount?: number;
};

type CurateCandidate = {
  asset: AgentAssetMetadata;
  order: number;
  score: number;
};
```

Add public method after `readSelectionMetadata`:

```ts
async curateSelection(
  auth: AuthDto,
  sessionId: string,
  dto: AgentCurateSelectionToolRequestDto,
): Promise<AgentCurateSelectionToolResponseDto> {
  return this.runReadTool(auth, sessionId, dto, this.curateSelectionDescriptor());
}
```

Add `executeApprovedToolCall` case next to `ReadSelectionMetadata`.

Add `curateSelectionDescriptor()` immediately before `readSelectionMetadataDescriptor()`:

```ts
private curateSelectionDescriptor(): AgentReadToolDescriptor<
  AgentCurateSelectionToolRequestDto,
  {
    summary: string;
    strategy: AgentCurateSelectionStrategy;
    selectionHandle: AgentSearchAssetsSelectionHandleResult;
    sourceAssetCount: number;
    selectedAssetCount: number;
    criteriaSummary: string[];
    warnings?: string[];
    sample?: AgentSearchAssetsSample;
  }
> {
  return {
    toolName: AgentToolName.CurateSelection,
    dataClass: AgentToolDataClass.Metadata,
    prepareRequest: async (auth, session, request) => {
      const handle = await this.getValidSelectionMetadataHandle(auth, session, request.selectionHandleId ?? '');
      return { ...request, resolvedSourceAssetCount: handle.assetCount };
    },
    requestSummary: (request) =>
      `Curate ${request.targetCount ?? 0} ${request.strategy ?? 'metadata-highlights'} asset(s) from handle ${request.selectionHandleId}`,
    requestMetadata: (request) =>
      ({
        selectionHandleId: request.selectionHandleId ?? '',
        targetCount: request.targetCount ?? 0,
        strategy: request.strategy ?? 'metadata-highlights',
        ...(request.criteria ? { criteria: request.criteria } : {}),
        constraints: request.constraints ?? {},
        sampleSize: request.sampleSize ?? 10,
      }) as AgentToolCurateSelectionRequestMetadata,
    requestedAssetCount: (request) =>
      (request as PreparedCurateSelectionRequest).resolvedSourceAssetCount ?? request.targetCount ?? 0,
    requestedAlbumCount: () => 0,
    perToolLimit: (plan) => Math.min(plan.limits.maxAssetsPerToolCall, maxMetadataCurationSourceAssets),
    perToolLimitDenialReason: (request, limit) =>
      `Selection has ${(request as PreparedCurateSelectionRequest).resolvedSourceAssetCount ?? 0} assets, but metadata-only curation allows ${limit}. Narrow the search before curation.`,
    perSessionLimit: (plan) => plan.limits.maxAssetsPerSession,
    validateAccess: async (auth, session, request) => {
      const handle = await this.getValidSelectionMetadataHandle(auth, session, request.selectionHandleId ?? '');
      const sourceLimit = Math.min(session.permissionPlanSnapshot.limits.maxAssetsPerToolCall, maxMetadataCurationSourceAssets);
      if (handle.assetCount > sourceLimit) {
        throw selectionTooLargeError({
          toolName: AgentToolName.CurateSelection,
          sourceAssetCount: handle.assetCount,
          maxSourceAssetCount: sourceLimit,
          instruction: 'Rerun searchAssets with narrower filters or page the result, then retry curateSelection with a smaller same-session selectionHandle.id.',
        });
      }
      return null;
    },
    execute: async (auth, session, request, toolCallId) => {
      const handle = await this.getValidSelectionMetadataHandle(auth, session, request.selectionHandleId ?? '');
      const sourceLimit = Math.min(session.permissionPlanSnapshot.limits.maxAssetsPerToolCall, maxMetadataCurationSourceAssets);
      if (handle.assetCount > sourceLimit) {
        throw selectionTooLargeError({
          toolName: AgentToolName.CurateSelection,
          sourceAssetCount: handle.assetCount,
          maxSourceAssetCount: sourceLimit,
          instruction: 'Rerun searchAssets with narrower filters or page the result, then retry curateSelection with a smaller same-session selectionHandle.id.',
        });
      }

      const unorderedAssets = handle.assetIds.length > 0 ? await this.assetRepository.getAgentMetadataByIds(handle.assetIds) : [];
      const assetsById = new Map(unorderedAssets.map((asset) => [asset.id, asset as AgentAssetMetadata]));
      const orderedAssets = handle.assetIds.flatMap((id) => {
        const asset = assetsById.get(id);
        return asset ? [asset] : [];
      });
      const { selectedAssets, criteriaSummary, warnings } = this.curateMetadataSelection({
        assets: orderedAssets,
        targetCount: request.targetCount ?? 0,
        strategy: request.strategy ?? 'metadata-highlights',
        constraints: request.constraints ?? {},
        criteria: request.criteria,
      });
      const selectedIds = selectedAssets.map((asset) => asset.id);
      const derived = await this.selectionHandleRepository.create({
        sessionId: session.id,
        userId: auth.user.id,
        sourceToolCallId: toolCallId,
        assetIds: selectedIds,
        expiresAt: this.getSelectionHandleExpiresAt(session),
      });
      const sampleSize = request.sampleSize ?? 10;
      const sampleAssets = sampleSize > 0 ? selectedAssets.slice(0, sampleSize) : [];
      const sample = this.buildSearchSample(
        sampleAssets.map((asset) =>
          this.mapSelectedAssetMetadata(this.mapAssetMetadata(asset), [
            'type',
            'dates',
            'location',
            'tags',
            'rating',
            'filename',
            'favorite',
          ]),
        ),
      );

      return {
        summary: `Curated ${selectedIds.length} metadata-only ${request.strategy ?? 'metadata-highlights'} asset${selectedIds.length === 1 ? '' : 's'} from ${handle.assetCount} source asset${handle.assetCount === 1 ? '' : 's'}.`,
        strategy: request.strategy ?? 'metadata-highlights',
        selectionHandle: this.mapSearchSelectionHandle(derived),
        sourceAssetCount: handle.assetCount,
        selectedAssetCount: selectedIds.length,
        criteriaSummary,
        ...(warnings.length ? { warnings } : {}),
        ...(sample ? { sample } : {}),
      };
    },
    responseSummary: (result) => result.summary,
    responseMetadata: (result) => ({
      selectionHandleIds: [result.selectionHandle.id],
      sourceRefs: [result.selectionHandle.sourceRef],
      selectionHandleAssetCount: result.selectionHandle.assetCount,
    }),
    resultAssetCount: (result) => result.sourceAssetCount,
    resultAlbumCount: () => 0,
    resultSize: (result) => ({ returnedItems: result.selectedAssetCount, hasMore: false, nextPage: null }),
    truncateForBudget: (result, budgetBytes) => this.truncateSelectionMetadataResult(result, budgetBytes),
    failedReason: 'Selection curation failed',
  };
}
```

Add helper methods near `getReadSelectionMetadataResponseSummary()`:

```ts
private curateMetadataSelection(input: {
  assets: AgentAssetMetadata[];
  targetCount: number;
  strategy: AgentCurateSelectionStrategy;
  constraints: AgentCurateSelectionConstraints;
  criteria?: string;
}) {
  const warnings: string[] = [];
  const eligible = this.applyCurateSelectionConstraints(input.assets, input.constraints, input.strategy);
  const candidates = eligible.map((asset, order) => ({
    asset,
    order,
    score: this.getCurateCandidateScore(asset, input.strategy),
  }));
  const ranked = this.rankCurateCandidates(candidates, input.strategy, input.constraints);
  const selected = ranked.slice(0, Math.min(input.targetCount, ranked.length)).map((candidate) => candidate.asset);
  if (input.targetCount > ranked.length) {
    warnings.push(`Requested ${input.targetCount} assets but only ${ranked.length} eligible assets were available.`);
  }
  if (ranked.length === 0) {
    warnings.push('No eligible metadata rows were available for this curation request.');
  }

  const criteriaSummary = [
    `Metadata-only ${input.strategy} curation used favorites, ratings, dates, tags, and location; no previews or objective image-quality scoring were used.`,
    `Selected ${selected.length} of ${input.assets.length} hydrated metadata rows from the source selection.`,
  ];
  if (input.criteria) {
    criteriaSummary.push(`User criteria: ${input.criteria}`);
  }
  if (input.constraints.diversifyBy?.includes('people')) {
    criteriaSummary.push('People diversity was requested but is not available from metadata-only rows in this version.');
  }

  return { selectedAssets: selected, criteriaSummary, warnings };
}
```

Add these helper methods after `curateMetadataSelection()`:

```ts
private applyCurateSelectionConstraints(
  assets: AgentAssetMetadata[],
  constraints: AgentCurateSelectionConstraints,
  strategy: AgentCurateSelectionStrategy,
): AgentAssetMetadata[] {
  const requestedTypes = constraints.types ?? (strategy === 'cover-candidate' ? ['IMAGE'] : ['IMAGE', 'VIDEO']);
  let eligible = assets.filter((asset) => requestedTypes.includes(asset.type as AgentCurateSelectionAssetType));

  if (strategy === 'cover-candidate') {
    eligible = eligible.filter((asset) => asset.type === AssetType.Image);
  }
  if (constraints.excludeVideos) {
    eligible = eligible.filter((asset) => asset.type !== AssetType.Video);
  }
  if (constraints.includeFavorites === false) {
    eligible = eligible.filter((asset) => !asset.isFavorite);
  }
  if (constraints.minRating !== undefined) {
    eligible = eligible.filter((asset) => (asset.exifInfo?.rating ?? 0) >= constraints.minRating!);
  }

  return eligible;
}

private getCurateCandidateScore(asset: AgentAssetMetadata, strategy: AgentCurateSelectionStrategy): number {
  return (
    (asset.isFavorite ? 100 : 0) +
    (asset.exifInfo?.rating ?? 0) * 10 +
    (this.hasCurateLocation(asset) ? 3 : 0) +
    (asset.localDateTime ? 2 : 0) +
    Math.min(asset.tags.length, 3) +
    (strategy === 'cover-candidate' && asset.type === AssetType.Image ? 1 : 0)
  );
}

private rankCurateCandidates(
  candidates: CurateCandidate[],
  strategy: AgentCurateSelectionStrategy,
  constraints: AgentCurateSelectionConstraints,
): CurateCandidate[] {
  const sorted = this.sortCurateCandidates(candidates);

  if (strategy === 'favorites-first') {
    return [...sorted].sort((left, right) => {
      const favoriteDelta = Number(right.asset.isFavorite) - Number(left.asset.isFavorite);
      return favoriteDelta || this.compareCurateCandidates(left, right);
    });
  }

  if (strategy === 'date-spread') {
    return this.roundRobinCurateGroups(sorted, 'date');
  }

  const supportedDiversifiers = constraints.diversifyBy?.filter((value) => value !== 'people') ?? [];
  return supportedDiversifiers.reduce(
    (ranked, diversifyBy) => this.roundRobinCurateGroups(ranked, diversifyBy),
    sorted,
  );
}

private sortCurateCandidates(candidates: CurateCandidate[]): CurateCandidate[] {
  return [...candidates].sort((left, right) => this.compareCurateCandidates(left, right));
}

private compareCurateCandidates(left: CurateCandidate, right: CurateCandidate): number {
  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const dateDelta = right.asset.localDateTime.getTime() - left.asset.localDateTime.getTime();
  if (dateDelta !== 0) {
    return dateDelta;
  }

  return left.order - right.order || left.asset.id.localeCompare(right.asset.id);
}

private roundRobinCurateGroups(
  candidates: CurateCandidate[],
  diversifyBy: AgentCurateSelectionDiversifyBy,
): CurateCandidate[] {
  const groups = new Map<string, CurateCandidate[]>();
  for (const candidate of candidates) {
    const key = this.getCurateGroupKey(candidate.asset, diversifyBy);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  const groupQueues = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => this.sortCurateCandidates(group));
  const ranked: CurateCandidate[] = [];

  while (groupQueues.some((group) => group.length > 0)) {
    for (const group of groupQueues) {
      const next = group.shift();
      if (next) {
        ranked.push(next);
      }
    }
  }

  return ranked;
}

private getCurateGroupKey(asset: AgentAssetMetadata, diversifyBy: AgentCurateSelectionDiversifyBy): string {
  switch (diversifyBy) {
    case 'date':
      return asset.localDateTime.toISOString().slice(0, 10);
    case 'location': {
      const location = [asset.exifInfo?.city, asset.exifInfo?.state, asset.exifInfo?.country]
        .filter(Boolean)
        .join('|');
      return location || 'location:missing';
    }
    case 'tags':
      return asset.tags
        .map((tag) => tag.value)
        .sort((left, right) => left.localeCompare(right))
        .join('|') || 'tags:missing';
    case 'people':
      return 'people:unavailable';
  }
}

private hasCurateLocation(asset: AgentAssetMetadata): boolean {
  return Boolean(asset.exifInfo?.city || asset.exifInfo?.state || asset.exifInfo?.country);
}
```

The implementation must use only internal asset IDs for ordering and handle creation. Never include selected IDs in returned result objects, recoverable errors, or response metadata.

- [ ] **Step 6: Implement MCP dispatch**

In `server/src/types/agent-mcp-contract.types.ts`, add `AgentToolName.CurateSelection` to `AgentMcpReadToolName` after `ReadSelectionMetadata`.

In `server/src/services/agent-mcp.service.ts`:

- Import `AgentCurateSelectionToolRequestDto`.
- Add `AgentToolName.CurateSelection` to `readToolNames` immediately after `ReadSelectionMetadata`.
- Add a `case AgentToolName.CurateSelection` in `callReadTool`:

```ts
case AgentToolName.CurateSelection: {
  return this.toolService.curateSelection(auth, sessionId, dto as AgentCurateSelectionToolRequestDto);
}
```

- [ ] **Step 7: Run service/MCP tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts -t "curateSelection|curation"
```

Expected: PASS.

- [ ] **Step 8: Run focused regression suite**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts
pnpm --dir server run check
```

Expected: PASS.

- [ ] **Step 9: Commit service behavior**

Run:

```bash
git add server/src/services/agent-mcp-recoverable-tool-error.ts server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts server/src/types/agent-mcp-contract.types.ts
git commit -m "feat: curate metadata selections into handles"
```

---

## Task 3: MCP Contract, Prompt, Docs, And Generated Artifacts

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `server/src/services/agent-mcp-docs.service.ts`
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Generated: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Generated: `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Add failing contract/registry/prompt/docs tests**

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, update `expectedReadToolNames` to include `AgentToolName.CurateSelection` immediately after `AgentToolName.ReadSelectionMetadata`, and add:

```ts
it('documents metadata-only selection curation without selected asset ids', () => {
  const contract = sut.getReadToolContract(AgentToolName.CurateSelection);
  const example = contract?.examples.find((candidate) => candidate.name === 'curate-metadata-highlights');

  expect(contract?.usage).toContain('metadata-only');
  expect(contract?.usage).toContain('new selectionHandle');
  expect(contract?.usage).toContain('not objective image-quality scoring');
  expect(contract?.usage).not.toContain('selected assetIds');
  expect(example?.arguments).toEqual({
    selectionHandleId: '00000000-0000-4000-8000-000000000333',
    targetCount: 15,
    strategy: 'metadata-highlights',
    constraints: { diversifyBy: ['date', 'location'] },
    sampleSize: 5,
  });
  expect(AgentReadToolRequestSchemas[AgentToolName.CurateSelection].safeParse(example?.arguments).success).toBe(true);
});
```

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, add curation to stable tool lists and assert `selectionHandleId`, `targetCount`, `strategy`, `constraints`, and `sampleSize` descriptions exist.

In `server/src/services/agent-mcp-prompt.service.spec.ts`, update prompt tests to require:

```ts
expect(prompt).toContain('mcp_gallery_curateSelection');
expect(prompt).toContain('metadata-only');
expect(prompt).toContain('not objective quality scoring');
expect(prompt).toContain('curateSelection');
expect(prompt).not.toContain('choose 15 assetIds');
```

In `server/src/services/agent-mcp-docs.service.spec.ts`, add:

```ts
it('documents metadata-only curation into derived selection handles', () => {
  const markdown = sut.generateMarkdown();

  expect(markdown).toContain('`curateSelection`');
  expect(markdown).toContain('targetCount');
  expect(markdown).toContain('metadata-only');
  expect(markdown).toContain('not objective image-quality scoring');
  expect(markdown).toContain('new selectionHandle');
  expect(markdown).not.toContain('choose selected assetIds');
});
```

- [ ] **Step 2: Run contract/prompt/docs tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts -t "curateSelection|curation|metadata-only"
```

Expected: FAIL until the contract, registry, prompt, and docs source mention curation.

- [ ] **Step 3: Add curation MCP contract**

In `server/src/services/agent-mcp-tool-contract.service.ts`, add a contract before `readAssetMetadataContract`:

```ts
const curateSelectionContract: AgentMcpToolContract<AgentToolName.CurateSelection> = {
  name: AgentToolName.CurateSelection,
  title: 'Curate selection',
  description: 'Create a derived selection handle from metadata-only ranking and diversification.',
  usage:
    'Use after searchAssets returns selectionHandle.id and before planning highlight, cover-candidate, favorite-first, or date-spread workflows. This tool returns a new selectionHandle plus criteriaSummary and itemRef samples without selected asset IDs. It is metadata-only and not objective image-quality scoring; no previews are inspected.',
  argumentModes: [
    {
      name: 'selection-curation',
      description: 'Curate a same-session selection handle into a smaller derived handle.',
      requiredFields: ['selectionHandleId', 'targetCount'],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use when a broad search handle needs deterministic metadata-only narrowing before planning.',
    },
    {
      ...approvedRetryMode,
      forbiddenFields: ['selectionHandleId', 'targetCount', 'strategy', 'criteria', 'constraints', 'sampleSize'],
    },
  ],
  examples: [
    {
      name: 'curate-metadata-highlights',
      description: 'Select metadata-only highlights with date and location variety.',
      arguments: {
        selectionHandleId: exampleSelectionHandleId,
        targetCount: 15,
        strategy: 'metadata-highlights',
        constraints: { diversifyBy: ['date', 'location'] },
        sampleSize: 5,
      },
    },
    {
      name: 'curate-cover-candidate',
      description: 'Select one image cover candidate from a search handle.',
      arguments: {
        selectionHandleId: exampleSelectionHandleId,
        targetCount: 1,
        strategy: 'cover-candidate',
        constraints: { types: ['IMAGE'], excludeVideos: true },
        sampleSize: 1,
      },
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'curation-missing-handle-or-target-count',
      match: { messageIncludes: 'Provide selectionHandleId and targetCount' },
      hint: 'Call searchAssets first, then pass selectionHandle.id and a targetCount to curateSelection.',
      exampleName: 'curate-metadata-highlights',
    },
    {
      id: 'curation-target-count-out-of-range',
      match: { issuePath: 'targetCount' },
      hint: 'Use targetCount from 1 to 1000. If the source selection is huge, narrow searchAssets first.',
      exampleName: 'curate-metadata-highlights',
    },
    toolCallArgumentsMissingMistake,
    toolCallArgumentsObjectMistake,
  ],
  approvalRetry,
  safety,
};
```

Add `curateSelectionContract` to `readToolContracts` immediately after `readSelectionMetadataContract`.

- [ ] **Step 4: Update registry descriptions and tool definition**

In `server/src/services/agent-mcp-tool-registry.service.ts`, add descriptions:

```ts
targetCount: 'Number of assets to select into a derived selection handle. Use 1 to 1000.',
strategy:
  'Curation strategy: metadata-highlights, date-spread, favorites-first, or cover-candidate. Metadata-only and not objective image-quality scoring.',
criteria: 'Optional user-facing criteria text to record in criteriaSummary for selection curation.',
constraints:
  'Optional metadata-only curation constraints for media types, favorites, minimum rating, video exclusion, and date/location/tag diversification.',
```

Update `selectionHandleId` description to mention `curateSelection`:

```ts
'The selectionHandle.id returned by searchAssets or curateSelection. Use this for readSelectionMetadata, curateSelection, and handle-backed planning instead of copying search asset IDs.';
```

Add a `defineTool` entry for `AgentToolName.CurateSelection` after `ReadSelectionMetadata`.

- [ ] **Step 5: Update prompt and docs source**

In `server/src/services/agent-mcp-prompt.service.ts`:

- Add `{ toolName: AgentToolName.CurateSelection, exampleName: 'curate-metadata-highlights' }` to `promptExampleSelections` after `ReadSelectionMetadata`.
- Ensure the `Tool:` line includes `mcp_gallery_curateSelection`.
- Replace highlight guidance with:

```ts
'Best/highlights require bounded album/space/date/search/selection; use curateSelection for metadata-only narrowing; not objective quality scoring; derived handle -> planning.',
```

- Add progressive line text:

```ts
'Curation: search handle -> readSelectionMetadata if needed -> curateSelection targetCount strategy -> use derived selectionHandle.id/sourceRef for later planning.',
```

If prompt length exceeds 4300, shorten unrelated prose while preserving `curateSelection`, `targetCount`, `metadata-only`, `not objective quality scoring`, `derived selectionHandle`, and existing Slice 3 handle-read guidance.

In `server/src/services/agent-mcp-docs.service.ts`, add to the progressive workflow section:

```ts
'- Curation: use `curateSelection` with `selectionHandleId`, `targetCount`, and a metadata-only strategy. It returns a derived `selectionHandle` plus `criteriaSummary`; it does not return selected asset IDs and is not objective image-quality scoring.',
```

- [ ] **Step 6: Run source tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
```

Expected: generated sync tests may fail only because generated artifacts are stale. All other tests should pass.

- [ ] **Step 7: Commit source guidance**

Run:

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-docs.service.spec.ts
git commit -m "docs: advertise metadata-only curation"
```

- [ ] **Step 8: Regenerate artifacts and scan**

Run:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-prompt
pnpm --dir server run sync:agent-mcp-docs
rg -n 'choose selected assetIds|choose .* assetIds|objective image-quality scoring|analyzeAssetQuality|preview-assisted|createSelectionHandle|"detail":"ids"|"detail": "ids"' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
rg -n 'curateSelection|targetCount|metadata-only|derived selectionHandle|not objective quality scoring' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
```

Expected: first scan has no matches except the allowed negative phrase `not objective image-quality scoring`; if the first scan matches that allowed phrase, rerun this stricter scan and require no matches:

```bash
rg -n 'choose selected assetIds|choose .* assetIds|analyzeAssetQuality|preview-assisted|createSelectionHandle|"detail":"ids"|"detail": "ids"' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
```

Second scan has matches in both generated files.

- [ ] **Step 9: Run generated sync tests and commit**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
git add agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
git commit -m "chore: regenerate curation MCP guidance"
```

---

## Task 4: Slice 4 Verification

**Files:**

- All files changed in Tasks 1-3.

- [ ] **Step 1: Run focused Slice 4 tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck and hygiene**

Run:

```bash
pnpm --dir server run check
git diff --check
git status --short --branch
```

Expected: `pnpm check` exits 0, `git diff --check` exits 0, and the branch is ahead of origin with no uncommitted changes.

- [ ] **Step 3: Run provider-facing curation scans**

Run:

```bash
rg -n 'choose selected assetIds|choose .* assetIds|analyzeAssetQuality|preview-assisted|createSelectionHandle|"detail":"ids"|"detail": "ids"' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-tool-contract.service.ts
rg -n '"assetIds"|"assetId"|sampleAssetIds' server/src/services/agent-tool.service.spec.ts server/src/services/agent-mcp.service.spec.ts
```

Expected: first command has no matches. Second command may match internal setup fixtures and negative assertions, but every `curateSelection` success/recovery assertion must prove no selected asset IDs, no `assetIds`, no `assetId`, and no `sampleAssetIds` in provider-visible results and recoverable errors.

- [ ] **Step 4: Push Slice 4**

Run:

```bash
git push
```

Expected: branch `explore/pi-agent-brainstorm` pushes to origin.

---

## Plan Self-Review

- TDD order is explicit for DTO, service/MCP, contract/docs, generated artifacts, and final verification.
- Every Slice 4 required edge case is covered:
  - deterministic curation;
  - target-count validation;
  - targetCount greater than eligible assets returns available assets with warning;
  - oversized source handles ask for narrowing before metadata hydration;
  - missing metadata produces stable output without ID leaks;
  - output is a new handle, not IDs;
  - cover-candidate and highlight strategies are covered;
  - generated guidance says metadata-only and not objective image-quality scoring.
- Future slices remain out of scope:
  - no planning raw-ID rejection;
  - no workflow selection-planning convenience tools;
  - no search limit increase;
  - no `analyzeAssetQuality` or preview-assisted ranking.
