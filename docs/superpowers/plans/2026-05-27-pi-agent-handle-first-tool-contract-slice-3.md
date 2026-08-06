# Pi Agent Handle-First Tool Contract Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a handle-based metadata read tool so Pi can inspect bounded search selections through `selectionHandle.id` without receiving search-derived asset UUIDs.

**Architecture:** Add a new read tool, `readSelectionMetadata`, instead of overloading legacy `readAssetMetadata(assetIds)`. The new tool resolves a same-session, unexpired selection handle server-side, returns aggregate counts plus bounded `itemRef` metadata samples, and never serializes underlying asset UUIDs in provider-visible response payloads, audit metadata, generated docs, or prompt guidance. Raw `readAssetMetadata(assetIds)` remains supported for exact small non-search sets, but MCP guidance marks it as legacy and directs search-backed inspection to `readSelectionMetadata`.

**Tech Stack:** TypeScript/NestJS/Zod/Vitest for server DTOs, read-tool orchestration, MCP contracts, generated docs, and generated prompt modules.

---

## Slice Scope

Implement only Slice 3 from `docs/superpowers/specs/2026-05-27-pi-agent-handle-first-tool-contract-design.md`:

- Add `readSelectionMetadata` as a read tool that accepts a same-session `selectionHandleId`.
- Return aggregate counts plus bounded `itemRef` metadata samples, not `assetIds`.
- Validate `fields` and `sampleSize`; default to safe metadata fields and 10 samples.
- Expired, cross-session, missing, and wrong-domain handles fail recoverably without leaking underlying asset IDs or sample asset IDs.
- Update MCP contracts, registry descriptions, prompt source, generated docs, and generated prompt module so Pi uses `readSelectionMetadata` for search-handle inspection.
- Mark raw `readAssetMetadata(assetIds)` as legacy/exact-only in model-facing guidance.

Out of scope:

- Do not add `curateSelection`.
- Do not add highlight/cover ranking strategies.
- Do not reject `readAssetMetadata(assetIds)` or planning `assetIds`.
- Do not hide or reject `assetSource.explicitAssets`.
- Do not raise search limits.
- Do not make `itemRef` usable for writes.

## Files

- Modify: `server/src/enum.ts`
  - Adds `AgentToolName.ReadSelectionMetadata`.
- Modify: `server/src/dtos/agent-tool.dto.ts`
  - Adds request/response schemas and DTO exports for `readSelectionMetadata`.
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
  - Adds DTO default, validation, and no-ID response schema tests.
- Modify: `server/src/types/agent-tool.types.ts`
  - Adds request/response metadata and sample count types used by `AgentToolService`.
- Modify: `server/src/services/agent-tool.service.ts`
  - Adds `readSelectionMetadata`, descriptor, valid-handle lookup, recoverable invalid-handle/wrong-domain recovery, sample mapping, and truncation.
- Modify: `server/src/services/agent-tool.service.spec.ts`
  - Adds service red/green coverage for success, sample bounds, no UUID leakage, approval retry, expired/cross-session handle recovery, and wrong-domain recovery.
- Modify: `server/src/services/agent-mcp.service.ts`
  - Registers and dispatches the new read tool.
- Modify: `server/src/services/agent-mcp.service.spec.ts`
  - Adds MCP dispatch, compact text, validation, and recoverable error coverage.
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
  - Adds the read-tool contract and rewords legacy `readAssetMetadata` guidance.
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Updates stable read-tool list and verifies contract examples parse and do not expose IDs.
- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
  - Adds model-facing property descriptions for `selectionHandleId` and updates legacy metadata read descriptions.
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  - Verifies the new schema, descriptions, and stable tool list.
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
  - Teaches Pi to use `readSelectionMetadata` after search handles.
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
  - Fails on old handle-to-raw-asset-ID metadata guidance and verifies new prompt guidance.
- Modify: `server/src/services/agent-mcp-docs.service.ts`
  - Updates static progressive workflow docs.
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
  - Verifies docs advertise `readSelectionMetadata` and mark raw metadata reads legacy/exact-only.
- Generated: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Generated: `docs/superpowers/generated/pi-agent-mcp-tools.md`

---

## Task 1: DTO And Tool Surface

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
- Modify: `server/src/types/agent-tool.types.ts`

- [ ] **Step 1: Add failing DTO tests**

In `server/src/dtos/agent-tool.dto.spec.ts`, add tests near the existing read-tool schema tests:

```ts
describe('AgentReadSelectionMetadataToolRequestSchema', () => {
  const selectionHandleId = '00000000-0000-4000-8000-000000000333';

  it('defaults sample size and safe fields for selection metadata reads', () => {
    expect(AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata].parse({ selectionHandleId })).toEqual({
      selectionHandleId,
      sampleSize: 10,
      fields: ['type', 'dates', 'location', 'camera', 'tags', 'rating', 'filename', 'favorite', 'visibility'],
    });
  });

  it('validates readSelectionMetadata argument modes and field/sample bounds', () => {
    expect(
      AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata].safeParse({
        selectionHandleId,
        fields: ['dates', 'dates'],
      }).success,
    ).toBe(false);
    expect(
      AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata].safeParse({
        selectionHandleId,
        sampleSize: 26,
      }).success,
    ).toBe(false);
    expect(
      AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata].safeParse({
        selectionHandleId,
        toolCallId: '00000000-0000-4000-8000-000000000111',
      }).success,
    ).toBe(false);
    expect(
      AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata].safeParse({
        toolCallId: '00000000-0000-4000-8000-000000000111',
        fields: ['dates'],
      }).success,
    ).toBe(false);
    expect(
      AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata].parse({
        selectionHandleId,
        fields: ['dates', 'camera'],
        sampleSize: 0,
      }),
    ).toEqual({ selectionHandleId, fields: ['dates', 'camera'], sampleSize: 0 });
  });

  it('encodes selection metadata responses without asset UUID fields in samples', () => {
    const encoded = AgentReadSelectionMetadataToolResponseDto.schema.safeEncode({
      status: 'success',
      toolCall: makeToolCall({ toolName: AgentToolName.ReadSelectionMetadata }),
      summary: 'Read selection metadata for 12 assets with 1 sample.',
      selectionHandle: {
        id: selectionHandleId,
        sourceRef: `asset-source:search:${selectionHandleId}`,
        assetCount: 12,
        sourceToolCallId: '00000000-0000-4000-8000-000000000444',
        expiresAt: new Date('2026-05-27T12:00:00.000Z'),
      },
      fields: ['dates', 'camera'],
      counts: { assets: 12, sampled: 1 },
      sample: {
        sampleSize: 1,
        items: [
          {
            itemRef: 'item:001',
            localDateTime: new Date('2026-05-20T10:00:00.000Z'),
            exifInfo: { make: 'Canon', model: 'R5' },
          },
        ],
      },
      resultSize: {
        returnedItems: 1,
        hasMore: false,
        nextPage: null,
        estimatedBytes: 512,
        truncated: false,
        omittedFields: [],
      },
    });

    expect(encoded.success).toBe(true);
    if (!encoded.success) {
      throw new Error('Expected selection metadata response to encode');
    }

    expect(JSON.stringify(encoded.data)).not.toContain('"assetIds"');
    expect(JSON.stringify(encoded.data)).not.toContain('"assetId"');
    expect(JSON.stringify(encoded.data)).not.toContain('"id":"00000000-0000-4000-8000-000000000001"');
  });
});
```

Update the import list at the top of `server/src/dtos/agent-tool.dto.spec.ts` to include `AgentReadSelectionMetadataToolResponseDto`.

- [ ] **Step 2: Run tests to verify the DTO/tool-surface red state**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts -t "readSelectionMetadata|selection metadata"
```

Expected: FAIL because `AgentToolName.ReadSelectionMetadata` and schemas do not exist.

- [ ] **Step 3: Add enum and DTO schemas**

In `server/src/enum.ts`, add the enum member immediately after `SearchAssets`:

```ts
ReadSelectionMetadata = 'readSelectionMetadata',
```

In `server/src/dtos/agent-tool.dto.ts`, add constants near the asset metadata field constants:

```ts
const MAX_SELECTION_METADATA_SAMPLE_SIZE = 25;
const DEFAULT_SELECTION_METADATA_SAMPLE_SIZE = 10;
const DEFAULT_SELECTION_METADATA_FIELDS = [
  'type',
  'dates',
  'location',
  'camera',
  'tags',
  'rating',
  'filename',
  'favorite',
  'visibility',
] as const satisfies readonly z.output<typeof AgentAssetMetadataFieldSchema>[];
```

Add this request schema after `AgentReadAssetMetadataToolRequestSchema`:

```ts
const AgentReadSelectionMetadataToolRequestSchema = z
  .strictObject({
    selectionHandleId: uuid.optional(),
    fields: z.array(AgentAssetMetadataFieldSchema).min(1).max(20).optional(),
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

    if ((value.fields || value.sampleSize !== undefined) && value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either selectionHandleId or toolCallId, not both',
      });
    }

    if (!value.selectionHandleId && !value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide selectionHandleId for a new tool request or toolCallId for an approved request',
      });
    }

    if (value.fields && new Set(value.fields).size !== value.fields.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'fields must be unique' });
    }
  })
  .transform((value) => {
    if (value.toolCallId) {
      return value;
    }

    return {
      ...value,
      fields: value.fields ?? [...DEFAULT_SELECTION_METADATA_FIELDS],
      sampleSize: value.sampleSize ?? DEFAULT_SELECTION_METADATA_SAMPLE_SIZE,
    };
  })
  .meta({ id: 'AgentReadSelectionMetadataToolRequestDto' });
```

Add the request schema to `AgentReadToolRequestSchemas` immediately after `SearchAssets`:

```ts
[AgentToolName.ReadSelectionMetadata]: AgentReadSelectionMetadataToolRequestSchema,
```

Add response schemas after `AgentSearchAssetsSampleSchema` so they can reuse the handle and sample schemas:

```ts
const AgentReadSelectionMetadataCountsSchema = z
  .object({
    assets: z.number().int().min(0),
    sampled: z.number().int().min(0).max(MAX_SELECTION_METADATA_SAMPLE_SIZE),
  })
  .meta({ id: 'AgentReadSelectionMetadataCounts' });

const AgentReadSelectionMetadataToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentReadSelectionMetadataToolApprovalRequiredResponse'),
    deniedResponse('AgentReadSelectionMetadataToolDeniedResponse'),
    z
      .strictObject({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        summary,
        selectionHandle: AgentSearchAssetsSelectionHandleSchema,
        fields: z.array(AgentAssetMetadataFieldSchema),
        counts: AgentReadSelectionMetadataCountsSchema,
        sample: AgentSearchAssetsSampleSchema.optional(),
        resultSize: AgentToolResultSizeSchema,
      })
      .meta({ id: 'AgentReadSelectionMetadataToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentReadSelectionMetadataToolResponseDto' });
```

Export the DTO class and response DTO near the other read DTO exports:

```ts
export class AgentReadSelectionMetadataToolRequestDto extends createZodDto(
  AgentReadSelectionMetadataToolRequestSchema,
) {}

export const AgentReadSelectionMetadataToolResponseDto = namedZodDto(
  'AgentReadSelectionMetadataToolResponseDto',
  AgentReadSelectionMetadataToolResponseSchema,
);
export type AgentReadSelectionMetadataToolResponseDto = z.output<typeof AgentReadSelectionMetadataToolResponseSchema>;
```

- [ ] **Step 4: Add shared TypeScript types**

In `server/src/types/agent-tool.types.ts`, add:

```ts
export type AgentToolReadSelectionMetadataRequestMetadata = {
  selectionHandleId: string;
  fields: AgentAssetMetadataField[];
  sampleSize: number;
};

export type AgentReadSelectionMetadataCounts = {
  assets: number;
  sampled: number;
};
```

- [ ] **Step 5: Run DTO tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts -t "readSelectionMetadata|selection metadata"
```

Expected: PASS for the new DTO tests. Contract and registry tests remain unchanged until Task 3.

- [ ] **Step 6: Commit DTO/tool-surface baseline**

Run:

```bash
git add server/src/enum.ts server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts server/src/types/agent-tool.types.ts
git commit -m "test: define selection metadata read contract"
```

---

## Task 2: Handle-Based Selection Metadata Read Service

**Files:**

- Modify: `server/src/services/agent-tool.service.ts`
- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add failing service tests**

In `server/src/services/agent-tool.service.spec.ts`, add tests near the `searchAssets` handle tests:

```ts
it('readSelectionMetadata returns aggregate counts and itemRef samples without asset ids', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid(), newUuid(), newUuid()];
  const selectionHandleId = newUuid();
  const sourceToolCallId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId,
    assetIds,
    assetCount: assetIds.length,
    sampleAssetIds: assetIds,
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    createdAt: now,
    updateId: newUuid(),
  });
  assetRepository.getAgentMetadataByIds.mockResolvedValue(
    assetIds.map((id, index) =>
      makeMetadata(id, {
        originalFileName: index === 0 ? `${id}.jpg` : `photo-${index}.jpg`,
      }),
    ) as never,
  );

  const result = await sut.readSelectionMetadata(auth, session.id, {
    selectionHandleId,
    fields: ['dates', 'camera', 'rating', 'filename'],
    sampleSize: 2,
  });

  expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    now: expect.any(Date),
  });
  expect(assetRepository.getAgentMetadataByIds).toHaveBeenCalledWith(assetIds.slice(0, 2));
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    return;
  }

  expect(result.summary).toBe('Read selection metadata for 3 assets with 2 samples');
  expect(result.selectionHandle).toMatchObject({
    id: selectionHandleId,
    sourceRef: `asset-source:search:${selectionHandleId}`,
    assetCount: 3,
    sourceToolCallId,
  });
  expect(result.counts).toEqual({ assets: 3, sampled: 2 });
  expect(result.sample?.items.map((item) => item.itemRef)).toEqual(['item:001', 'item:002']);
  expect(result.sample?.items[0]).not.toHaveProperty('id');
  expect(result.sample?.items[0]).not.toHaveProperty('assetId');
  expect(result.sample?.items[0]).not.toHaveProperty('ownerId');
  expect(JSON.stringify(result)).not.toContain(assetIds[0]);
  expect(result.resultSize).toMatchObject({ returnedItems: 2, hasMore: false, nextPage: null });
});

it('readSelectionMetadata supports aggregate-only sampleSize zero without metadata hydration', async () => {
  const auth = AuthFactory.create();
  const selectionHandleId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: null,
    assetIds: [newUuid()],
    assetCount: 1,
    sampleAssetIds: [newUuid()],
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    createdAt: now,
    updateId: newUuid(),
  });

  const result = await sut.readSelectionMetadata(auth, session.id, { selectionHandleId, sampleSize: 0 });

  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.counts).toEqual({ assets: 1, sampled: 0 });
    expect(result).not.toHaveProperty('sample');
  }
});

it('readSelectionMetadata skips missing sample metadata without leaking handle asset ids', async () => {
  const auth = AuthFactory.create();
  const missingAssetId = newUuid();
  const visibleAssetId = newUuid();
  const selectionHandleId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: null,
    assetIds: [missingAssetId, visibleAssetId],
    assetCount: 2,
    sampleAssetIds: [missingAssetId, visibleAssetId],
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    createdAt: now,
    updateId: newUuid(),
  });
  assetRepository.getAgentMetadataByIds.mockResolvedValue([
    makeMetadata(visibleAssetId, { originalFileName: 'visible.jpg' }),
  ] as never);

  const result = await sut.readSelectionMetadata(auth, session.id, { selectionHandleId, sampleSize: 2 });

  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.counts).toEqual({ assets: 2, sampled: 1 });
    expect(result.sample?.items).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(missingAssetId);
    expect(JSON.stringify(result)).not.toContain(visibleAssetId);
  }
});

it('readSelectionMetadata stores replayable request metadata for approval retry', async () => {
  const auth = AuthFactory.create();
  const selectionHandleId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.Strict });
  const pending = makeToolCall({
    sessionId: session.id,
    toolName: AgentToolName.ReadSelectionMetadata,
    requestSummary: `Read selection metadata for handle ${selectionHandleId} (2 sample(s))`,
    redactedRequestMetadata: { selectionHandleId, fields: ['dates'], sampleSize: 2 },
    assetCount: 2,
  });

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: null,
    assetIds: [newUuid(), newUuid()],
    assetCount: 2,
    sampleAssetIds: [newUuid(), newUuid()],
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    createdAt: now,
    updateId: newUuid(),
  });
  toolCallRepository.createWithSessionLimit.mockResolvedValue({ status: 'created', toolCall: pending });

  const result = await sut.readSelectionMetadata(auth, session.id, {
    selectionHandleId,
    fields: ['dates'],
    sampleSize: 2,
  });

  expect(result.status).toBe('approval-required');
  expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
    expect.objectContaining({
      redactedRequestMetadata: { selectionHandleId, fields: ['dates'], sampleSize: 2 },
      assetCount: 2,
    }),
    expect.any(Object),
    AgentToolDataClass.Metadata,
    expect.any(Number),
  );
});

it('readSelectionMetadata returns recoverable invalid-selection-handle for expired or unavailable handles', async () => {
  const auth = AuthFactory.create();
  const selectionHandleId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
  const expiredHandle = {
    id: selectionHandleId,
    assetCount: 12,
    sourceToolCallId: newUuid(),
    createdAt: new Date('2026-05-27T08:00:00.000Z'),
    expiresAt: new Date('2026-05-27T09:00:00.000Z'),
  };

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
  selectionHandleRepository.getForRecovery.mockResolvedValue(expiredHandle);
  selectionHandleRepository.listValidForRecovery.mockResolvedValue([]);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
  accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set());
  accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());
  accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

  const thrown = await sut
    .readSelectionMetadata(auth, session.id, { selectionHandleId, sampleSize: 5 })
    .catch((error: unknown) => error);

  expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
  const error = thrown as AgentMcpRecoverableToolError;
  expect(error.content).toMatchObject({
    status: 'error',
    toolName: AgentToolName.ReadSelectionMetadata,
    retryable: true,
    recovery: {
      kind: 'invalid-selection-handle',
      attemptedSelectionHandleId: selectionHandleId,
      expiredSelectionHandle: expect.objectContaining({ id: selectionHandleId, assetCount: 12 }),
    },
  });
  expect(JSON.stringify(error.content)).not.toContain('assetIds');
  expect(JSON.stringify(error.content)).not.toContain('sampleAssetIds');
});

it('readSelectionMetadata treats cross-session handles as unavailable without recovery leaks', async () => {
  const auth = AuthFactory.create();
  const foreignHandleId = newUuid();
  const availableHandle = {
    id: newUuid(),
    assetCount: 4,
    sourceToolCallId: newUuid(),
    createdAt: new Date('2026-05-27T08:00:00.000Z'),
    expiresAt: new Date('2026-05-27T10:00:00.000Z'),
  };
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
  selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);
  selectionHandleRepository.listValidForRecovery.mockResolvedValue([availableHandle]);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
  accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set());
  accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());
  accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

  const thrown = await sut
    .readSelectionMetadata(auth, session.id, { selectionHandleId: foreignHandleId })
    .catch((error: unknown) => error);

  expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
  const error = thrown as AgentMcpRecoverableToolError;
  expect(error.content.recovery).toMatchObject({
    kind: 'invalid-selection-handle',
    attemptedSelectionHandleId: foreignHandleId,
    availableSelectionHandles: [expect.objectContaining({ id: availableHandle.id, assetCount: 4 })],
  });
  expect(JSON.stringify(error.content.recovery)).not.toContain('assetIds');
  expect(JSON.stringify(error.content.recovery)).not.toContain('sampleAssetIds');
  expect(JSON.stringify(error.content.recovery)).not.toContain('foreign-owner');
});

it('readSelectionMetadata returns wrong-domain recovery for readable asset IDs', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
  accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());
  accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

  const thrown = await sut
    .readSelectionMetadata(auth, session.id, { selectionHandleId: assetId })
    .catch((error) => error);

  expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
  expect((thrown as AgentMcpRecoverableToolError).content).toMatchObject({
    error: 'That value is an asset ID, not a selection handle ID.',
    recovery: {
      kind: 'wrong_id_domain',
      field: 'selectionHandleId',
      expectedDomain: 'selectionHandle',
      receivedDomain: 'asset',
    },
  });
  expect(JSON.stringify((thrown as AgentMcpRecoverableToolError).content.recovery)).not.toContain(assetId);
});
```

Use the existing `makeMetadata(...)`, `newUuid()`, and repository mock helpers in `server/src/services/agent-tool.service.spec.ts`.

- [ ] **Step 2: Add failing MCP dispatch tests**

In `server/src/services/agent-mcp.service.spec.ts`, add `ReadSelectionMetadata` to read-tool list expectations and the dispatch table. Add a specific compact-result test:

```ts
it('delegates readSelectionMetadata and keeps MCP text compact', async () => {
  const selectionHandleId = factory.uuid();
  const serviceResult = {
    status: 'success',
    toolCall: null,
    summary: 'Read selection metadata for 3 assets with 2 samples',
    selectionHandle: {
      id: selectionHandleId,
      sourceRef: `asset-source:search:${selectionHandleId}`,
      assetCount: 3,
      sourceToolCallId: null,
      expiresAt: new Date('2026-05-27T12:00:00.000Z'),
    },
    fields: ['dates'],
    counts: { assets: 3, sampled: 2 },
    sample: { sampleSize: 2, items: [{ itemRef: 'item:001' }, { itemRef: 'item:002' }] },
    resultSize: {
      returnedItems: 2,
      hasMore: false,
      nextPage: null,
      estimatedBytes: 512,
      truncated: false,
      omittedFields: [],
    },
  };
  toolService.readSelectionMetadata.mockResolvedValue(serviceResult as never);

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ReadSelectionMetadata, { selectionHandleId, fields: ['dates'], sampleSize: 2 }),
  )) as AgentMcpSuccessResponse;

  expect(toolService.readSelectionMetadata).toHaveBeenCalledWith(auth, sessionId, {
    selectionHandleId,
    fields: ['dates'],
    sampleSize: 2,
  });
  expectToolResult(response, `${AgentToolName.ReadSelectionMetadata}-call`, serviceResult, serviceResult.summary);
});
```

- [ ] **Step 3: Run tests to verify service/MCP red state**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts -t "readSelectionMetadata|selection metadata"
```

Expected: FAIL because `AgentToolService.readSelectionMetadata` and MCP dispatch do not exist.

- [ ] **Step 4: Implement service method and descriptor**

In `server/src/services/agent-tool.service.ts`, import:

```ts
AgentReadSelectionMetadataToolRequestDto,
AgentReadSelectionMetadataToolResponseDto,
```

from `src/dtos/agent-tool.dto`, import `invalidSelectionHandleError` from `src/services/agent-mcp-recoverable-tool-error`, and import these types from `src/types/agent-tool.types`:

```ts
AgentReadSelectionMetadataCounts,
AgentToolReadSelectionMetadataRequestMetadata,
```

Add a top-level constant near `maxAgentSpaceAssetIds`:

```ts
const selectionMetadataRecoveryLimit = 5;
const knownExampleSelectionHandleIds = new Set(['00000000-0000-4000-8000-000000000333']);
```

Add the public service method after `searchAssets`:

```ts
async readSelectionMetadata(
  auth: AuthDto,
  sessionId: string,
  dto: AgentReadSelectionMetadataToolRequestDto,
): Promise<AgentReadSelectionMetadataToolResponseDto> {
  return this.runReadTool(auth, sessionId, dto, this.readSelectionMetadataDescriptor());
}
```

Add a descriptor immediately before `readAssetMetadataDescriptor()`:

```ts
private readSelectionMetadataDescriptor(): AgentReadToolDescriptor<
  AgentReadSelectionMetadataToolRequestDto,
  {
    summary: string;
    selectionHandle: AgentSearchAssetsSelectionHandleResult;
    fields: AgentAssetMetadataField[];
    counts: AgentReadSelectionMetadataCounts;
    sample?: AgentSearchAssetsSample;
  }
> {
  return {
    toolName: AgentToolName.ReadSelectionMetadata,
    dataClass: AgentToolDataClass.Metadata,
    requestSummary: (request) =>
      `Read selection metadata for handle ${request.selectionHandleId} (${request.sampleSize ?? 10} sample(s))`,
    requestMetadata: (request) =>
      ({
        selectionHandleId: request.selectionHandleId ?? '',
        fields: request.fields ?? [],
        sampleSize: request.sampleSize ?? 10,
      }) as AgentToolReadSelectionMetadataRequestMetadata,
    requestedAssetCount: (request) => request.sampleSize ?? 10,
    requestedAlbumCount: () => 0,
    perToolLimit: (plan) => plan.limits.maxAssetsPerToolCall,
    perSessionLimit: (plan) => plan.limits.maxAssetsPerSession,
    validateAccess: async (auth, session, request) => {
      await this.getValidSelectionMetadataHandle(auth, session, request.selectionHandleId ?? '');
      return null;
    },
    execute: async (auth, session, request) => {
      const handle = await this.getValidSelectionMetadataHandle(auth, session, request.selectionHandleId ?? '');
      const sampleAssetIds = handle.sampleAssetIds.slice(0, request.sampleSize ?? 10);
      const fields = request.fields ?? [];
      const unorderedAssets = sampleAssetIds.length > 0 ? await this.assetRepository.getAgentMetadataByIds(sampleAssetIds) : [];
      const assetsById = new Map(
        unorderedAssets.map((asset) => [asset.id, this.mapAssetMetadata(asset as AgentAssetMetadata)]),
      );
      const sampleAssets = sampleAssetIds.flatMap((id) => {
        const asset = assetsById.get(id);
        return asset ? [asset] : [];
      });
      const sample = this.buildSearchSample(sampleAssets.map((asset) => this.mapSelectedAssetMetadata(asset, fields)));
      const sampled = sample?.items.length ?? 0;

      return {
        summary: this.getReadSelectionMetadataResponseSummary(handle.assetCount, sampled),
        selectionHandle: this.mapSearchSelectionHandle(handle),
        fields,
        counts: { assets: handle.assetCount, sampled },
        ...(sample ? { sample } : {}),
      };
    },
    responseSummary: (result) => result.summary,
    responseMetadata: (result) => ({
      selectionHandleIds: [result.selectionHandle.id],
      sourceRefs: [result.selectionHandle.sourceRef],
      selectionHandleAssetCount: result.selectionHandle.assetCount,
    }),
    resultAssetCount: (result) => result.counts.sampled,
    resultAlbumCount: () => 0,
    resultSize: (result) => ({
      returnedItems: result.counts.sampled,
      hasMore: false,
      nextPage: null,
    }),
    truncateForBudget: (result, budgetBytes) => this.truncateSelectionMetadataResult(result, budgetBytes),
    failedReason: 'Selection metadata read failed',
  };
}
```

Add helper methods near other selection-handle helpers:

```ts
private async getValidSelectionMetadataHandle(auth: AuthDto, session: AgentSession, id: string) {
  const handle = await this.selectionHandleRepository.getValidForPlanning({
    id,
    sessionId: session.id,
    userId: auth.user.id,
    now: new Date(),
  });

  if (!handle) {
    throw await this.createInvalidSelectionMetadataHandleError(auth, session, id);
  }

  return handle;
}

private async createInvalidSelectionMetadataHandleError(auth: AuthDto, session: AgentSession, id: string) {
  const [readableAssetIds, readablePersonIds] = await Promise.all([
    this.getReadableAssetIds(auth, session.permissionPlanSnapshot, [id]),
    this.getReadablePersonIds(auth, session, [id]),
  ]);
  const receivedDomain = readableAssetIds.has(id) ? 'asset' : readablePersonIds.has(id) ? 'person' : null;
  if (receivedDomain) {
    return wrongIdDomainError({
      toolName: AgentToolName.ReadSelectionMetadata,
      field: 'selectionHandleId',
      expectedDomain: 'selectionHandle',
      receivedDomain,
      instruction: 'Use the selectionHandle.id returned by searchAssets, not an asset or person ID.',
    });
  }

  const now = new Date();
  const [availableSelectionHandles, attemptedHandle] = await Promise.all([
    this.selectionHandleRepository.listValidForRecovery({
      sessionId: session.id,
      userId: auth.user.id,
      now,
      limit: selectionMetadataRecoveryLimit,
    }),
    this.selectionHandleRepository.getForRecovery({ id, sessionId: session.id, userId: auth.user.id }),
  ]);
  const expiredSelectionHandle =
    attemptedHandle && attemptedHandle.expiresAt <= now
      ? this.toSelectionMetadataHandleRecoveryHint(attemptedHandle)
      : undefined;
  const available = availableSelectionHandles.map((handle) => this.toSelectionMetadataHandleRecoveryHint(handle));
  const recovery = {
    kind: 'invalid-selection-handle',
    attemptedSelectionHandleId: id,
    looksLikeExamplePlaceholder: knownExampleSelectionHandleIds.has(id),
    availableSelectionHandles: available,
    ...(expiredSelectionHandle ? { expiredSelectionHandle } : {}),
    instruction: 'Retry readSelectionMetadata with a valid same-session selectionHandle.id, or rerun searchAssets.',
  };

  return invalidSelectionHandleError({
    toolName: AgentToolName.ReadSelectionMetadata,
    error: 'Selection handle is expired or not available for this session',
    hint: expiredSelectionHandle
      ? 'The attempted selection handle is expired. Rerun searchAssets, then retry readSelectionMetadata with the returned selectionHandle.id.'
      : available.length === 1
        ? `Retry readSelectionMetadata with the exact handle ${available[0].id} if that is the intended search selection.`
        : available.length > 1
          ? 'Choose the intended same-session handle from availableSelectionHandles and retry readSelectionMetadata with that exact id.'
          : 'Rerun searchAssets, then retry readSelectionMetadata with the returned selectionHandle.id.',
    recovery,
  });
}

private toSelectionMetadataHandleRecoveryHint(handle: {
  id: string;
  assetCount: number;
  sourceToolCallId: string | null;
  createdAt: Date;
  expiresAt: Date;
}) {
  return {
    id: handle.id,
    assetCount: handle.assetCount,
    sourceToolCallId: handle.sourceToolCallId,
    createdAt: handle.createdAt.toISOString(),
    expiresAt: handle.expiresAt.toISOString(),
  };
}

private getReadSelectionMetadataResponseSummary(assetCount: number, sampleCount: number, truncated = false) {
  const summary = `Read selection metadata for ${assetCount} ${assetCount === 1 ? 'asset' : 'assets'} with ${sampleCount} ${
    sampleCount === 1 ? 'sample' : 'samples'
  }`;
  return truncated ? this.appendTruncatedResponseSummary(summary) : summary;
}
```

Add a truncation helper near `truncateSearchAssetsResult`:

```ts
private truncateSelectionMetadataResult<
  TResult extends {
    summary: string;
    selectionHandle: AgentSearchAssetsSelectionHandleResult;
    counts: AgentReadSelectionMetadataCounts;
    sample?: AgentSearchAssetsSample;
  },
>(result: TResult, budgetBytes: number): { result: TResult; omittedFields: string[] } {
  const omittedFields = new Set<string>();
  let nextResult = {
    ...result,
    sample: result.sample ? { ...result.sample, items: [...result.sample.items] } : undefined,
  };

  while (
    nextResult.sample &&
    nextResult.sample.items.length > 0 &&
    (this.estimateJsonBytes(nextResult) ?? 0) > budgetBytes
  ) {
    nextResult = {
      ...nextResult,
      sample: {
        sampleSize: nextResult.sample.items.length - 1,
        items: nextResult.sample.items.slice(0, -1),
      },
      counts: { ...nextResult.counts, sampled: nextResult.sample.items.length - 1 },
    };
    omittedFields.add('sample');
  }

  if (nextResult.sample?.items.length === 0) {
    const { sample: _sample, ...withoutSample } = nextResult;
    nextResult = { ...withoutSample, counts: { ...withoutSample.counts, sampled: 0 } } as typeof nextResult;
  }

  return {
    result: {
      ...nextResult,
      summary: this.getReadSelectionMetadataResponseSummary(
        nextResult.selectionHandle.assetCount,
        nextResult.counts.sampled,
        omittedFields.size > 0,
      ),
    },
    omittedFields: [...omittedFields],
  };
}
```

- [ ] **Step 5: Implement MCP dispatch**

In `server/src/services/agent-mcp.service.ts`:

- Import `AgentReadSelectionMetadataToolRequestDto`.
- Add `AgentToolName.ReadSelectionMetadata` to `readToolNames` immediately after `SearchAssets`.
- Add the tool to `executeApprovedToolCall`.
- Add a `case AgentToolName.ReadSelectionMetadata` branch in `callReadTool`:

```ts
case AgentToolName.ReadSelectionMetadata: {
  return this.toolService.readSelectionMetadata(
    auth,
    sessionId,
    dto as AgentReadSelectionMetadataToolRequestDto,
  );
}
```

- [ ] **Step 6: Run service/MCP tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts -t "readSelectionMetadata|selection metadata"
```

Expected: PASS.

- [ ] **Step 7: Run focused read-tool regression suite**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit service behavior**

Run:

```bash
git add server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts
git commit -m "feat: read metadata from selection handles"
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

- [ ] **Step 1: Add failing contract/prompt/docs tests**

In `server/src/services/agent-mcp-prompt.service.spec.ts`, update prompt tests to expect:

```ts
expect(prompt).toContain('mcp_gallery_readSelectionMetadata');
expect(prompt).toContain('search handle');
expect(prompt).toContain('readSelectionMetadata');
expect(prompt).toContain('itemRef');
expect(prompt).toMatch(/readAssetMetadata.*legacy|legacy.*readAssetMetadata/i);
expect(prompt).not.toContain('search handle->metadata->preview');
expect(prompt).not.toContain('search handle/sourceRef, then readAssetMetadata');
```

In `server/src/services/agent-mcp-docs.service.spec.ts`, add:

```ts
it('documents handle-based selection metadata reads as the search inspection path', () => {
  const markdown = sut.generateMarkdown();

  expect(markdown).toContain('`readSelectionMetadata`');
  expect(markdown).toContain('selectionHandleId');
  expect(markdown).toContain('itemRef');
  expect(markdown).toMatch(/readAssetMetadata.*legacy|legacy.*readAssetMetadata/is);
  expect(markdown).not.toContain('Search IDs first');
  expect(markdown).not.toContain(
    'readAssetMetadata with exact `fields` such as `camera`, `dates`, and `filename` for exact non-search asset IDs',
  );
});
```

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, update `expectedReadToolNames` to include `AgentToolName.ReadSelectionMetadata` immediately after `AgentToolName.SearchAssets`, and add:

```ts
it('documents handle-based selection metadata reads without asset ids', () => {
  const contract = sut.getReadToolContract(AgentToolName.ReadSelectionMetadata);
  const example = contract?.examples.find((candidate) => candidate.name === 'read-selection-metadata-sample');

  expect(contract?.usage).toContain('selectionHandleId');
  expect(contract?.usage).toContain('itemRef');
  expect(contract?.usage).not.toContain('assetIds from search');
  expect(example?.arguments).toEqual({
    selectionHandleId: '00000000-0000-4000-8000-000000000333',
    fields: ['dates', 'camera', 'rating'],
    sampleSize: 5,
  });
  expect(AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata].safeParse(example?.arguments).success).toBe(
    true,
  );
});

it('marks raw asset metadata reads as legacy exact-id usage', () => {
  expect(sut.getReadToolContract(AgentToolName.ReadAssetMetadata)?.usage).toMatch(/legacy|exact non-search/i);
});
```

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, add the new read tool to stable tool-list expectations and assert the input schema has `selectionHandleId`, `fields`, `sampleSize`, and `toolCallId` descriptions.

- [ ] **Step 2: Run contract/prompt/docs red tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts -t "readSelectionMetadata|selection metadata|legacy"
```

Expected: FAIL until the contract, registry, prompt, and docs are updated.

- [ ] **Step 3: Add readSelectionMetadata MCP contract**

In `server/src/services/agent-mcp-tool-contract.service.ts`, define examples near the search examples:

```ts
const readSelectionMetadataExample: AgentMcpToolExample = {
  name: 'read-selection-metadata-sample',
  description: 'Inspect a bounded search handle with itemRef samples and no asset ids.',
  arguments: {
    selectionHandleId: exampleSelectionHandleId,
    fields: ['dates', 'camera', 'rating'],
    sampleSize: 5,
  },
};
```

Add a contract before `readAssetMetadataContract`:

```ts
const readSelectionMetadataContract: AgentMcpToolContract<AgentToolName.ReadSelectionMetadata> = {
  name: AgentToolName.ReadSelectionMetadata,
  title: 'Read selection metadata',
  description: 'Read aggregate metadata and bounded itemRef samples for a same-session selection handle.',
  usage:
    'Use after searchAssets returns selectionHandle.id. This is the default search-inspection path: it returns counts and itemRef samples without asset IDs. Use fields to request type, dates, location, camera, tags, rating, filename, favorite, or visibility. Use sampleSize 0 for aggregate counts only. itemRef values are local to this response and cannot be used for writes; use selectionHandle.id or sourceRef for planning.',
  argumentModes: [
    {
      name: 'selection-metadata',
      description: 'Read metadata samples from a same-session selection handle.',
      requiredFields: ['selectionHandleId'],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use when searchAssets returned a selectionHandle.id and metadata samples are needed before planning.',
    },
    {
      name: 'approved-retry',
      description: 'Retry a Gallery-approved selection metadata read.',
      requiredFields: ['toolCallId'],
      forbiddenFields: ['selectionHandleId', 'fields', 'sampleSize'],
      whenToUse: 'Use only after Gallery resumes the assistant from an approved selection metadata read request.',
    },
  ],
  examples: [readSelectionMetadataExample, approvedRetryExample],
  commonMistakes: [
    {
      id: 'selection-metadata-missing-handle',
      match: { messageIncludes: 'Provide selectionHandleId' },
      hint: 'Call searchAssets first, then pass the returned selectionHandle.id as selectionHandleId.',
      exampleName: 'read-selection-metadata-sample',
    },
    {
      id: 'selection-metadata-asset-id',
      match: { issuePath: 'selectionHandleId' },
      hint: 'selectionHandleId must be the handle id returned by searchAssets, not an asset id.',
      exampleName: 'read-selection-metadata-sample',
    },
    toolCallArgumentsMissingMistake,
    toolCallArgumentsObjectMistake,
  ],
  approvalRetry,
  safety,
};
```

Update `readAssetMetadataContract.usage` to include:

```ts
'Legacy exact-ID read. Use only for exact small non-search asset IDs that Gallery already exposed through an exact context. For search results, call readSelectionMetadata with selectionHandleId instead.';
```

Add `readSelectionMetadataContract` to `readToolContracts` immediately after `searchAssetsContract`.

- [ ] **Step 4: Update registry descriptions**

In `server/src/services/agent-mcp-tool-registry.service.ts`, add property descriptions:

```ts
selectionHandleId:
  'Same-session selection handle id returned by searchAssets. Use this for readSelectionMetadata and handle-backed planning; do not use asset ids here.',
sampleSize: 'Maximum itemRef metadata samples to return from a selection handle, from 0 to 25.',
```

Update `assetIds` description to start with:

```ts
'Legacy exact non-search asset IDs for small inspected reads or plans.';
```

Add a `defineTool` entry for `AgentToolName.ReadSelectionMetadata` immediately after `SearchAssets` with schema `AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata]`.

- [ ] **Step 5: Update prompt source**

In `server/src/services/agent-mcp-prompt.service.ts`:

- Add `{ toolName: AgentToolName.ReadSelectionMetadata, exampleName: 'read-selection-metadata-sample' }` to `promptExampleSelections` near search examples.
- Update guidance lines:

```ts
'Progressive: resolve names -> search handle {"detail":"handle"} -> readSelectionMetadata {"selectionHandleId":"<selectionHandle.id from searchAssets>","fields":["dates","location"],"sampleSize":5}; itemRefs are samples only. No 1k; if truncated/hasMore, page/ask.',
'Best/highlights require bounded album/space/date/search/selection; suggested, not objective quality scoring; search handle->readSelectionMetadata->preview only for exact small non-search ids if allowed.',
'Technical metadata: search handle/sourceRef, then readSelectionMetadata fields camera/dates/filename; readAssetMetadata is legacy exact-id only.',
```

Keep the prompt under the existing `maxPromptLength` of 4300. If the prompt exceeds 4300, shorten only prose that is unrelated to `readSelectionMetadata`; keep the tool name, `selectionHandleId`, `fields`, `sampleSize`, `itemRef`, and legacy exact-id guidance.

- [ ] **Step 6: Update docs source**

In `server/src/services/agent-mcp-docs.service.ts`, update the progressive workflow section:

```ts
'Use the smallest useful payload first. Resolve names before search. Search for a handle/sourceRef first. Inspect search selections with readSelectionMetadata, which returns aggregate counts and itemRef samples without asset IDs.',
'',
'- Broad search: use `searchAssets` with handle detail or omit `detail`, plus a bounded `limit` such as 25 or 50. If `hasMore` or `resultSize.truncated` is true, page with `nextPage` or ask a narrowing question; when hasMore is true, keep the same mode, query, filters, order, and limit.',
'- Selection metadata: use `readSelectionMetadata` with `selectionHandleId`, `fields`, and `sampleSize`. `itemRef` values are local samples for explanation only and cannot be used for writes.',
'- Visual curation: start with a bounded handle and `readSelectionMetadata` samples. Call preview reads only for exact small non-search `assetIds` when visual inspection is needed.',
'- Technical metadata: use `readSelectionMetadata` field groups such as `camera`, `dates`, and `filename` for search-backed handles. `readAssetMetadata(assetIds)` is legacy exact-ID only.',
'- Large album: page bounded handle results and propose operations from `selectionHandle.id` or `sourceRef`. Do not request full metadata for every candidate.',
```

- [ ] **Step 7: Run source contract/prompt/docs tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
```

Expected: generated sync tests may fail only because generated artifacts are stale. All other tests should pass.

- [ ] **Step 8: Commit source guidance**

Run:

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-docs.service.spec.ts
git commit -m "docs: advertise selection metadata reads"
```

- [ ] **Step 9: Regenerate artifacts**

Run:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-prompt
pnpm --dir server run sync:agent-mcp-docs
```

Expected output includes writes to:

```text
agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
docs/superpowers/generated/pi-agent-mcp-tools.md
```

- [ ] **Step 10: Scan generated artifacts**

Run:

```bash
rg -n 'search handle->metadata|search handle/sourceRef, then readAssetMetadata|readAssetMetadata fields.*search|<asset-id-from-searchAssets>|selected assetIds only|createSelectionHandle|\"detail\":\"ids\"|\"detail\": \"ids\"' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
rg -n 'readSelectionMetadata|selectionHandleId|itemRef|legacy exact' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
```

Expected: first command has no matches. Second command has matches in both generated files.

- [ ] **Step 11: Run generated sync tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
```

Expected: PASS.

- [ ] **Step 12: Commit generated artifacts**

Run:

```bash
git add agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
git commit -m "chore: regenerate selection metadata MCP guidance"
```

---

## Task 4: Slice 3 Verification

**Files:**

- All files changed in Tasks 1-3.

- [ ] **Step 1: Run focused Slice 3 tests**

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

- [ ] **Step 3: Run provider-facing no-ID scan**

Run:

```bash
rg -n 'search handle->metadata|search handle/sourceRef, then readAssetMetadata|readAssetMetadata fields.*search|<asset-id-from-searchAssets>|selected assetIds only|createSelectionHandle|\"detail\":\"ids\"|\"detail\": \"ids\"' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-tool-contract.service.ts
rg -n '\"assetIds\"|\"assetId\"|sampleAssetIds' server/src/services/agent-tool.service.spec.ts server/src/services/agent-mcp.service.spec.ts
```

Expected: first command has no matches. Second command may match negative assertions and legacy exact-ID tests, but every `readSelectionMetadata` success assertion must prove no `assetIds`, no `assetId`, and no `sampleAssetIds` in provider-visible results/recovery metadata.

- [ ] **Step 4: Push Slice 3**

Run:

```bash
git push
```

Expected: branch `explore/pi-agent-brainstorm` pushes to origin.

---

## Review Checklist

- [ ] TDD red steps exist before implementation for DTO/schema, service behavior, MCP dispatch, contracts, prompt/docs, generated artifacts, and final scans.
- [ ] `readSelectionMetadata` is present in enum, DTO schemas, MCP read-tool dispatch, contracts, registry, docs, and prompt.
- [ ] Valid handle reads return counts and bounded `itemRef` samples without asset UUIDs.
- [ ] `sampleSize: 0` returns aggregate counts without metadata hydration.
- [ ] Expired, cross-session, missing, and wrong-domain handles fail recoverably without leaking `assetIds` or `sampleAssetIds`.
- [ ] Raw `readAssetMetadata(assetIds)` remains supported and is only marked legacy/exact-only in model-facing guidance.
- [ ] No Slice 4-6 behavior is implemented.
- [ ] Generated artifacts are regenerated and pass sync tests.
