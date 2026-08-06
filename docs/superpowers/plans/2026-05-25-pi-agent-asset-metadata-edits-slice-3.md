# Pi Agent Asset Metadata Edits Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `asset.updateMetadata` operations to be planned, permission-checked, access-checked, materialized from all existing asset source mechanisms, and persisted as reviewable proposed operations.

**Architecture:** Reuse the existing agent operation planning flow. `asset.updateMetadata` becomes an asset-bearing, writable-asset operation with its own `writeScope.updateAssetMetadata` check. Existing source materialization (`assetIds`, `assetSelectionHandleId`, `assetSource.previousSearch`, and `assetSource.search`) produces durable `assetIds`; existing repository persistence stores the materialized asset ids and metadata payload for later review/apply slices.

**Tech Stack:** TypeScript, NestJS services/DTOs, Zod 4, Vitest, generated OpenAPI/TypeScript SDK, generated MCP tool docs.

---

## Scope

This is Slice 3 from `docs/superpowers/specs/2026-05-25-pi-agent-asset-metadata-edits-design.md`.

Implement only:

- Treat `AgentOperationType.AssetUpdateMetadata` as an asset-bearing operation in plan creation.
- Enforce `session.permissionPlanSnapshot.writeScope.updateAssetMetadata` during planning.
- Require normal writable asset access for all materialized asset ids.
- Materialize metadata operations from:
  - explicit `assetIds`
  - `assetSelectionHandleId`
  - `assetSource.previousSearch`
  - `assetSource.search`
- Persist reviewable operations with:
  - `type: asset.updateMetadata`
  - `targetKind: asset_batch`
  - materialized `assetIds`
  - original validated metadata payload
  - `assetSource` and `assetSelectionHandleId` cleared after materialization
- Add `asset.updateMetadata` to the high-level `proposeAssetBatchFromSearch` workflow action so search-backed metadata edits do not require hand-building low-level operations.
- Keep MCP/OpenAPI/generated docs synchronized with the DTO/contract changes.

Do not implement:

- Apply-time metadata writes or calls to `assetService.updateAll` for `asset.updateMetadata`.
- UI before/after rendering or activity copy.
- Assistant prompt-flow acceptance tests.
- Capability matrix/docs updates beyond generated MCP contract docs.
- Forward geocoding, place-name resolution, or clearing location.
- Provider-facing before-value metadata. This slice persists asset ids and proposed values only; UI/server before-value rendering belongs to the UI/review slice.

## Files

- Modify: `server/src/dtos/agent-operation.dto.ts`
  - Refactor asset metadata payload validation so it can validate both nested operation payloads and flat high-level workflow actions without counting `type` as a metadata field.
  - Add `AssetUpdateMetadata` to `AgentAssetBatchWorkflowActionSchema`.
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
  - Add `proposeAssetBatchFromSearch` acceptance and rejection coverage for metadata actions.
- Modify: `server/src/services/agent-operation-plan.service.ts`
  - Add metadata workflow summary/payload/risk handling.
  - Add `AssetUpdateMetadata` to `validateWriteScope`, `isAssetBearingOperation`, and `requiresWritableAssets`.
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
  - Add planning tests for explicit asset ids, selection handles, previous searches, declarative searches, disabled write scope, and inaccessible assets.
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
  - Document metadata search workflow use in `proposeAssetBatchFromSearch`.
  - Add a parseable metadata workflow example.
  - Update unsupported-action hints to include `asset.updateMetadata`.
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Update high-level workflow contract/example/hint expectations.
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  - Assert the high-level workflow tool schema advertises `asset.updateMetadata` action payload fields.
- Regenerate:
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`
  - `open-api/immich-openapi-specs.json`
  - `open-api/typescript-sdk/src/fetch-client.ts`

## Task 1: DTO Workflow Action Contract

**Files:**

- Modify: `server/src/dtos/agent-operation.dto.ts`
- Test: `server/src/dtos/agent-operation.dto.spec.ts`
- Test: `server/src/services/agent-mcp-tool-registry.service.spec.ts`

- [ ] **Step 1: Write failing DTO tests**

In `server/src/dtos/agent-operation.dto.spec.ts`, add metadata to the existing `accepts proposeAssetBatchFromSearch for %s` table:

```ts
[
  'metadata update',
  {
    action: {
      type: AgentOperationType.AssetUpdateMetadata,
      description: 'Berlin weekend',
      rating: 5,
      timeZone: 'Europe/Berlin',
    },
    assetSource: { kind: 'search', filters: { city: 'Berlin' } },
  },
],
```

Add metadata action rejection coverage after the rotate validation test:

```ts
it.each([
  [
    'empty metadata action',
    { type: AgentOperationType.AssetUpdateMetadata },
    ['action'],
    'Provide at least one metadata field to update',
  ],
  [
    'zero relative time as only metadata field',
    { type: AgentOperationType.AssetUpdateMetadata, dateTimeRelative: 0 },
    ['action', 'dateTimeRelative'],
    'dateTimeRelative: 0 is a no-op unless another metadata field changes',
  ],
  [
    'absolute and relative dates together',
    {
      type: AgentOperationType.AssetUpdateMetadata,
      dateTimeOriginal: '1998-06-01T12:00:00.000Z',
      dateTimeRelative: 120,
    },
    ['action'],
    'Choose dateTimeOriginal or dateTimeRelative, not both',
  ],
  [
    'latitude without longitude',
    { type: AgentOperationType.AssetUpdateMetadata, latitude: 48.8566 },
    ['action'],
    'Provide both latitude and longitude',
  ],
  [
    'place name field',
    { type: AgentOperationType.AssetUpdateMetadata, placeName: 'Paris' },
    ['action'],
    'Unrecognized key',
  ],
])('rejects proposeAssetBatchFromSearch metadata action with %s', (_label, action, path, message) => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
    action,
    assetSource: { kind: 'search', filters: {} },
  });

  expectIssue(result, path, message);
});
```

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, add a test that inspects the `proposeAssetBatchFromSearch` input schema:

```ts
it('advertises asset.updateMetadata in the high-level asset batch workflow schema', () => {
  const proposal = sut.listTools().find((tool) => tool.name === AgentToolName.ProposeAssetBatchFromSearch);
  const schemaJson = JSON.stringify(proposal?.inputSchema);

  expect(schemaJson).toContain(AgentOperationType.AssetUpdateMetadata);
  expect(schemaJson).toContain('description');
  expect(schemaJson).toContain('rating');
  expect(schemaJson).toContain('dateTimeOriginal');
  expect(schemaJson).toContain('dateTimeRelative');
  expect(schemaJson).toContain('timeZone');
  expect(schemaJson).toContain('latitude');
  expect(schemaJson).toContain('longitude');
  expect(schemaJson).toContain('place names are not accepted');
});
```

- [ ] **Step 2: Run the DTO/registry tests and confirm red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts
```

Expected: FAIL because `AgentAssetBatchWorkflowActionSchema` does not accept `asset.updateMetadata`.

- [ ] **Step 3: Refactor metadata payload validation for shared use**

In `server/src/dtos/agent-operation.dto.ts`, extract metadata field names and shape before `assetUpdateMetadataPayloadSchema`:

```ts
const assetUpdateMetadataPayloadFieldNames = [
  'description',
  'rating',
  'dateTimeOriginal',
  'dateTimeRelative',
  'timeZone',
  'latitude',
  'longitude',
] as const;

const assetUpdateMetadataPayloadShape = {
  description: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe('Asset description. Use an empty string to clear the description.'),
  rating: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.null()])
    .optional()
    .describe('Asset star rating from 1 to 5. Use null to clear the rating.'),
  dateTimeOriginal: z.iso.datetime().optional().describe('Absolute original capture date/time as an ISO datetime.'),
  dateTimeRelative: z
    .number()
    .int()
    .optional()
    .describe('Relative capture time shift as an integer minute offset. Cannot be combined with dateTimeOriginal.'),
  timeZone: ianaTimeZoneSchema.optional().describe('IANA time zone such as Europe/Berlin.'),
  latitude: latitudeSchema
    .optional()
    .describe('Explicit latitude coordinate. Provide both latitude and longitude; place names are not accepted.'),
  longitude: longitudeSchema
    .optional()
    .describe('Explicit longitude coordinate. Provide both latitude and longitude; place names are not accepted.'),
};

type AssetUpdateMetadataPayloadLike = Partial<Record<(typeof assetUpdateMetadataPayloadFieldNames)[number], unknown>>;

const validateAssetUpdateMetadataPayload = (payload: AssetUpdateMetadataPayloadLike, ctx: z.RefinementCtx) => {
  const suppliedFieldCount = assetUpdateMetadataPayloadFieldNames.filter(
    (field) => payload[field] !== undefined,
  ).length;
  if (suppliedFieldCount === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide at least one metadata field to update',
    });
  }

  if (payload.dateTimeOriginal !== undefined && payload.dateTimeRelative !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Choose dateTimeOriginal or dateTimeRelative, not both',
    });
  }

  if (payload.dateTimeRelative === 0 && suppliedFieldCount === 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dateTimeRelative'],
      message: 'dateTimeRelative: 0 is a no-op unless another metadata field changes',
    });
  }

  if (Number(payload.latitude !== undefined) + Number(payload.longitude !== undefined) === 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide both latitude and longitude',
    });
  }
};
```

Replace `assetUpdateMetadataPayloadSchema` with:

```ts
const assetUpdateMetadataPayloadSchema = z
  .strictObject(assetUpdateMetadataPayloadShape)
  .superRefine(validateAssetUpdateMetadataPayload);
```

Add the flat workflow action schema:

```ts
const assetUpdateMetadataWorkflowActionSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetUpdateMetadata),
    ...assetUpdateMetadataPayloadShape,
  })
  .superRefine(validateAssetUpdateMetadataPayload);
```

Add it to `AgentAssetBatchWorkflowActionSchema`:

```ts
    assetUpdateMetadataWorkflowActionSchema,
```

- [ ] **Step 4: Run the DTO/registry tests again**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts
```

Expected: PASS for the new workflow action contract and the existing Slice 1 operation payload tests.

## Task 2: Planning Service Permission, Access, And Materialization

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Test: `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Write failing planning service tests**

Add these tests near the existing `proposeAssetBatchFromSearch` tests in `server/src/services/agent-operation-plan.service.spec.ts`.

Test explicit asset ids:

```ts
it('creates a reviewable asset.updateMetadata plan for explicit asset ids', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
  const assetIds = [newUuid(), newUuid()];
  const payload = { description: 'Berlin weekend', rating: 5 };
  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  planRepository.createReplacementRevision.mockResolvedValue(
    makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.AssetUpdateMetadata,
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          payload,
        }),
      ],
    }),
  );

  await sut.proposeAlbumOperations(auth, session.id, {
    summary: 'Update selected photo metadata.',
    operations: [
      {
        type: AgentOperationType.AssetUpdateMetadata,
        summary: 'Set description and rating.',
        targetKind: AgentOperationTargetKind.AssetBatch,
        assetIds,
        payload,
        enabled: true,
        riskLevel: AgentOperationRiskLevel.Medium,
      },
    ],
  });

  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      operations: [
        expect.objectContaining({
          type: AgentOperationType.AssetUpdateMetadata,
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          assetSource: undefined,
          assetSelectionHandleId: undefined,
          payload,
        }),
      ],
    }),
  );
  expect(assetService.updateAll).not.toHaveBeenCalled();
});
```

Test disabled write scope before materialization:

```ts
it('denies asset.updateMetadata planning when metadata write scope is disabled before materializing search', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    permissionPlanSnapshot: {
      ...expandedPermissionPlanSnapshot,
      writeScope: { ...expandedPermissionPlanSnapshot.writeScope, updateAssetMetadata: false },
    },
  });
  sessionRepository.getById.mockResolvedValue(session);

  await expect(
    (sut as any).proposeAssetBatchFromSearch(auth, session.id, {
      action: { type: AgentOperationType.AssetUpdateMetadata, description: 'Berlin weekend' },
      assetSource: { kind: 'search', filters: {} },
    }),
  ).rejects.toThrow('This session is not allowed to update asset metadata');

  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});
```

Test inaccessible assets:

```ts
it('rejects asset.updateMetadata when selected assets are outside writable access', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
  const assetIds = [newUuid()];
  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
  accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set());
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set());

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Update inaccessible metadata.',
      operations: [
        {
          type: AgentOperationType.AssetUpdateMetadata,
          summary: 'Set description.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          payload: { description: 'Hidden' },
          enabled: true,
          riskLevel: AgentOperationRiskLevel.Medium,
        },
      ],
    }),
  ).rejects.toThrow('One or more assets are not editable');

  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});
```

Test previous search:

```ts
it('materializes asset.updateMetadata previousSearch before storing the plan', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
  const selectionHandleId = newUuid();
  const sourceRef = `asset-source:search:${selectionHandleId}` as const;
  const assetIds = [newUuid(), newUuid()];
  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: newUuid(),
    assetIds,
    assetCount: assetIds.length,
    sampleAssetIds: assetIds,
    expiresAt: new Date('2026-05-21T12:30:00.000Z'),
    createdAt: now,
    updateId: newUuid(),
  });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  planRepository.createReplacementRevision.mockResolvedValue(makePlan({ sessionId: session.id, operations: [] }));

  await (sut as any).proposeAssetBatchFromSearch(auth, session.id, {
    action: { type: AgentOperationType.AssetUpdateMetadata, rating: null },
    assetSource: { kind: 'previousSearch', sourceRef },
  });

  expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    now: expect.any(Date),
  });
  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      operations: [
        expect.objectContaining({
          type: AgentOperationType.AssetUpdateMetadata,
          assetIds,
          assetSource: undefined,
          assetSelectionHandleId: undefined,
          payload: { rating: null },
        }),
      ],
    }),
  );
});
```

Test declarative search workflow:

```ts
it('proposeAssetBatchFromSearch creates a reviewable asset.updateMetadata plan from a search source', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
  const assetIds = [newUuid(), newUuid()];
  sessionRepository.getById.mockResolvedValue(session);
  assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
    status: 'success',
    filters: { city: 'Berlin' },
    results: [],
  });
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })),
    hasNextPage: false,
  } as never);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  planRepository.createReplacementRevision.mockResolvedValue(makePlan({ sessionId: session.id, operations: [] }));

  await (sut as any).proposeAssetBatchFromSearch(auth, session.id, {
    summary: 'Set Berlin photo metadata.',
    action: {
      type: AgentOperationType.AssetUpdateMetadata,
      description: 'Berlin weekend',
      timeZone: 'Europe/Berlin',
    },
    assetSource: { kind: 'search', filters: { city: 'Berlin' }, materialization: 'all-matches-with-limit' },
  });

  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      plan: expect.objectContaining({ summary: 'Set Berlin photo metadata.' }),
      operations: [
        expect.objectContaining({
          type: AgentOperationType.AssetUpdateMetadata,
          summary: 'Update matching photo metadata',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          payload: { description: 'Berlin weekend', timeZone: 'Europe/Berlin' },
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        }),
      ],
    }),
  );
  const auditMetadata = toolCallRepository.create.mock.calls[0]?.[0]
    .redactedRequestMetadata as AgentToolOperationPlanRequestMetadata;
  expect(auditMetadata.operationTypes).toContain(AgentOperationType.AssetUpdateMetadata);
  expect(auditMetadata.assetCount).toBe(assetIds.length);
});
```

Test selection handle:

```ts
it('materializes asset.updateMetadata selection handles before storing the plan', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
  const selectionHandleId = newUuid();
  const assetIds = [newUuid(), newUuid()];
  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: newUuid(),
    assetIds,
    assetCount: assetIds.length,
    sampleAssetIds: assetIds,
    expiresAt: new Date('2026-05-21T12:30:00.000Z'),
    createdAt: now,
    updateId: newUuid(),
  });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  planRepository.createReplacementRevision.mockResolvedValue(makePlan({ sessionId: session.id, operations: [] }));

  await sut.proposeAlbumOperations(auth, session.id, {
    summary: 'Clear selected ratings.',
    operations: [
      {
        type: AgentOperationType.AssetUpdateMetadata,
        summary: 'Clear ratings.',
        targetKind: AgentOperationTargetKind.AssetBatch,
        assetSelectionHandleId: selectionHandleId,
        payload: { rating: null },
        enabled: true,
        riskLevel: AgentOperationRiskLevel.Medium,
      },
    ],
  });

  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      operations: [
        expect.objectContaining({
          assetIds,
          assetSource: undefined,
          assetSelectionHandleId: undefined,
          payload: { rating: null },
        }),
      ],
    }),
  );
});
```

- [ ] **Step 2: Run planning service tests and confirm red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected: FAIL because `asset.updateMetadata` is not recognized as asset-bearing, not write-scope checked, not writable-access checked, and not supported by the high-level workflow helpers.

- [ ] **Step 3: Implement planning service support**

In `server/src/services/agent-operation-plan.service.ts`, add a metadata workflow payload key list near the other constants:

```ts
const assetUpdateMetadataWorkflowPayloadKeys = [
  'description',
  'rating',
  'dateTimeOriginal',
  'dateTimeRelative',
  'timeZone',
  'latitude',
  'longitude',
] as const;
```

Add the workflow helper cases:

```ts
      case AgentOperationType.AssetUpdateMetadata: {
        return 'Update matching photo metadata';
      }
```

```ts
      case AgentOperationType.AssetUpdateMetadata: {
        return this.getAssetUpdateMetadataWorkflowPayload(dto);
      }
```

```ts
      case AgentOperationType.AssetUpdateMetadata:
      case AgentOperationType.AssetAddTag:
      case AgentOperationType.AssetRotate: {
        return AgentOperationRiskLevel.Medium;
      }
```

Add:

```ts
  private getAssetUpdateMetadataWorkflowPayload(
    dto: Extract<AgentProposeAssetBatchFromSearchToolRequestDto['action'], { type: AgentOperationType.AssetUpdateMetadata }>,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const key of assetUpdateMetadataWorkflowPayloadKeys) {
      if (dto[key] !== undefined) {
        payload[key] = dto[key];
      }
    }
    return payload;
  }
```

Add metadata to the asset-bearing and writable-asset checks:

```ts
      type === AgentOperationType.AssetUpdateMetadata ||
```

in both `isAssetBearingOperation()` and `requiresWritableAssets()`.

Add a write-scope check:

```ts
if (type === AgentOperationType.AssetUpdateMetadata && !writeScope.updateAssetMetadata) {
  throw new BadRequestException('This session is not allowed to update asset metadata');
}
```

- [ ] **Step 4: Run planning service tests again**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS for the new metadata planning tests and existing asset workflow tests.

## Task 3: MCP Contract And Generated Docs

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Test: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Regenerate: `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Write failing MCP contract tests**

Update `defines preferred high-level asset batch workflow examples that parse through the live DTO schema` so `exampleNames` includes metadata:

```ts
expect(exampleNames).toEqual([
  'favorite-search-results',
  'archive-search-results',
  'tag-search-results',
  'metadata-search-results',
  'rotate-previous-search-results',
]);
```

Add inside the same test after parsing examples:

```ts
const metadataExample = contract?.examples.find((example) => example.name === 'metadata-search-results');
const parsedMetadata = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].parse(
  metadataExample?.arguments,
);
expect(parsedMetadata.action).toMatchObject({
  type: AgentOperationType.AssetUpdateMetadata,
  description: 'Berlin weekend',
});
```

Update the unsupported-action hint expectation:

```ts
hint: expect.stringMatching(/asset\.setFavorite.*asset\.setArchive.*asset\.addTag.*asset\.updateMetadata.*asset\.rotate/i),
```

- [ ] **Step 2: Run MCP contract tests and confirm red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: FAIL because the high-level contract still says only favorite/archive/tag/rotate and lacks the metadata example.

- [ ] **Step 3: Update the MCP contract**

In `server/src/services/agent-mcp-tool-contract.service.ts`, add this example before `rotate-previous-search-results`:

```ts
  {
    name: 'metadata-search-results',
    description: 'Update metadata for all photos matching a declarative search.',
    arguments: {
      summary: 'Update matching Berlin photo metadata.',
      action: {
        type: AgentOperationType.AssetUpdateMetadata,
        description: 'Berlin weekend',
        timeZone: 'Europe/Berlin',
      },
      assetSource: {
        kind: 'search',
        filters: { city: 'Berlin', country: 'Germany' },
        materialization: 'all-matches-with-limit',
      },
    },
  },
```

Update the `proposeAssetBatchFromSearchContract` text:

```ts
description:
  'preferred tool for proposing favorite, archive, tag, metadata, or rotate actions from a declarative or previous search source.',
usage:
  'Use this before low-level proposeAlbumOperations when the user asks to favorite, archive, unarchive, tag, update metadata, or rotate matching photos. Gallery materializes the source and creates a reviewable plan only.',
```

Update the argument mode `whenToUse`:

```ts
whenToUse: 'Use for favorite, archive, unarchive, add tag, metadata update, or rotate requests over search results.',
```

Update the unsupported-action hint:

```ts
hint: 'Use only asset.setFavorite, asset.setArchive, asset.addTag, asset.updateMetadata, or asset.rotate with this workflow tool.',
```

- [ ] **Step 4: Run MCP contract tests again**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Regenerate MCP docs**

Run:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-docs
```

Expected: `docs/superpowers/generated/pi-agent-mcp-tools.md` updates the high-level asset batch workflow description, examples, and mistake hint.

## Task 4: OpenAPI/SDK Generation

**Files:**

- Regenerate: `open-api/immich-openapi-specs.json`
- Regenerate: `open-api/typescript-sdk/src/fetch-client.ts`

- [ ] **Step 1: Run OpenAPI/SDK generation**

Run:

```bash
cd open-api && ./bin/generate-open-api.sh typescript
```

Expected: PASS. Generated OpenAPI/SDK now include `asset.updateMetadata` in `AgentAssetBatchWorkflowAction`.

- [ ] **Step 2: Verify generated DTO contracts**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts
pnpm --dir open-api/typescript-sdk run build
```

Expected: PASS.

## Task 5: Slice Verification And Commit

**Files:**

- All files modified by Tasks 1-4.

- [ ] **Step 1: Run targeted server tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run builds and generated stability checks**

Run:

```bash
pnpm --dir server run build
pnpm --dir open-api/typescript-sdk run build
pnpm --dir server run sync:agent-mcp-docs
cd open-api && ./bin/generate-open-api.sh typescript
cd ..
git diff --exit-code -- docs/superpowers/generated/pi-agent-mcp-tools.md open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts
git diff --check
```

Expected: PASS with no generated-file drift after regeneration.

- [ ] **Step 3: Commit Slice 3**

Run:

```bash
git status --short
git add docs/superpowers/plans/2026-05-25-pi-agent-asset-metadata-edits-slice-3.md server/src/dtos/agent-operation.dto.ts server/src/dtos/agent-operation.dto.spec.ts server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-tool-registry.service.spec.ts docs/superpowers/generated/pi-agent-mcp-tools.md open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts
git commit -m "feat: plan pi agent metadata updates"
git status --short --branch
```

Expected: commit succeeds and the worktree is clean.

## Plan Review

- Spec coverage: This plan covers Slice 3 requirements for metadata plan creation, write-scope validation, normal asset update access, explicit IDs, selection handles, previous searches, declarative search sources, and durable operation persistence.
- Edge cases covered: disabled metadata write scope before search materialization, inaccessible assets, empty search sources through existing materialization tests plus metadata workflow coverage, expired/invalid handles through existing shared source-resolution tests once metadata is asset-bearing, no apply-time mutation, and no provider-facing before-values.
- Placeholder scan: The plan names exact files, test cases, expected red failures, implementation changes, commands, and commit message.
- Type consistency: The operation type stays `AgentOperationType.AssetUpdateMetadata`, target kind stays `AgentOperationTargetKind.AssetBatch`, the high-level workflow action is flat like existing asset workflow actions, and the persisted operation payload remains the nested metadata payload.
