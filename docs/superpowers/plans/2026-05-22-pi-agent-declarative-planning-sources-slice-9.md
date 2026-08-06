# Pi Agent High-Level Asset Batch Workflow Tool Slice 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `proposeAssetBatchFromSearch`, a first-class MCP planning tool that lets Pi create reviewable favorite, archive, tag, and rotate plans directly from `assetSource.search` or `assetSource.previousSearch`.

**Architecture:** Implement this as a thin wrapper over the existing source-aware operation-plan service. The new tool accepts a constrained user-facing action object plus an asset source, builds exactly one existing batch operation (`asset.setFavorite`, `asset.setArchive`, `asset.addTag`, or `asset.rotate`), then reuses existing write-scope, source materialization, asset access, audit, plan persistence, and apply behavior.

**Tech Stack:** NestJS services, Zod DTOs, MCP tool registry/contracts/docs, Vitest, TypeScript, `pnpm --dir server`.

---

## Scope

This is Slice 9 from `docs/superpowers/specs/2026-05-22-pi-agent-declarative-planning-sources-design.md`.

Implement only the high-level asset-batch workflow tool:

- `proposeAssetBatchFromSearch`
- DTO schema and class for a model-facing action object
- MCP registry, routing, contracts, examples, generated docs, generated runner prompt, and controller tool-list coverage
- Operation-plan service wrapper that converts the action into one normal existing batch operation and keeps all writes behind plan review

Do not implement:

- UI clarification rendering. That is Slice 10.
- Broad prompt/example overhaul beyond adding this tool. That is Slice 11.
- Activity UI polish. That is Slice 12.
- New operation types for real visibility changes beyond the existing `asset.setArchive` timeline/archive behavior.
- Direct apply/write tools. The new tool must only create reviewable plans.

## Files

- Modify: `server/src/enum.ts`
  - Add `AgentToolName.ProposeAssetBatchFromSearch = 'proposeAssetBatchFromSearch'`.
- Modify: `server/src/dtos/agent-operation.dto.ts`
  - Add an `AgentAssetBatchWorkflowAction` schema with allowed actions:
    - `asset.setFavorite` with `favorite: boolean`
    - `asset.setArchive` with `archived: boolean`
    - `asset.addTag` with exactly one of `tagId` or `tagName`
    - `asset.rotate` with `angle: 90 | 180 | 270`
  - Add `AgentProposeAssetBatchFromSearchToolRequestDto`.
  - Add the schema to `AgentOperationPlanToolRequestSchemas`.
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
  - Add schema tests for valid actions, invalid actions, payload validation, allowed source kinds, and rejected raw IDs/selection handles.
- Modify: `server/src/services/agent-operation-plan.service.ts`
  - Add `proposeAssetBatchFromSearch()`.
  - Add helpers for action summary, target kind, payload, and risk level.
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
  - Add service tests for favorite/archive/tag/rotate plan construction, source materialization, previous-search materialization, write-scope denial, no auto-apply, empty source, and over-broad source.
- Modify: `server/src/services/agent-mcp.service.ts`
  - Add tool routing and delegation to `AgentOperationPlanService.proposeAssetBatchFromSearch`.
- Modify: `server/src/services/agent-mcp.service.spec.ts`
  - Add MCP delegation and invalid argument coverage.
- Modify: `server/src/types/agent-mcp-contract.types.ts`
  - Include `AgentToolName.ProposeAssetBatchFromSearch` in `AgentMcpPlanningToolName`.
- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
  - Publish the tool in `tools/list` with model-facing descriptions and examples.
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  - Add tool-list/schema/example coverage.
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
  - Add planning contract and examples marking this as the preferred asset-batch-from-search tool.
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Add executable example coverage and common-mistake coverage.
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
  - Add generated-doc coverage for the asset batch workflow.
- Modify: `server/src/controllers/agent-runner-mcp.controller.spec.ts`
  - Update real MCP `tools/list` expectations.
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
  - Mention batch-from-search in compact write guidance while preserving the `<= 3800` prompt budget.
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
  - Assert the prompt includes `mcp_gallery_proposeAssetBatchFromSearch` and remains within budget.
- Modify generated docs: `docs/superpowers/generated/pi-agent-mcp-tools.md`
  - Regenerate with `pnpm --dir server exec tsx src/bin/sync-agent-mcp-docs.ts`.
- Modify generated prompt: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - Regenerate with `pnpm --dir server exec tsx src/bin/sync-agent-mcp-prompt.ts`.

## Design Decisions

- The MCP tool name is `proposeAssetBatchFromSearch`.
- The request shape is:

```ts
{
  summary?: string;
  action:
    | { type: 'asset.setFavorite'; favorite: boolean }
    | { type: 'asset.setArchive'; archived: boolean }
    | { type: 'asset.addTag'; tagId?: string; tagName?: string }
    | { type: 'asset.rotate'; angle: 90 | 180 | 270 };
  assetSource: { kind: 'search'; ... } | { kind: 'previousSearch'; sourceRef: string };
}
```

- The model does not provide `targetKind`, `assetIds`, `assetSelectionHandleId`, or low-level `operations` to this tool.
- The wrapper creates exactly one operation:
  - `asset.setFavorite` -> `targetKind: asset_batch`, `payload: { favorite }`, `riskLevel: low`
  - `asset.setArchive` -> `targetKind: asset_batch`, `payload: { archived }`, `riskLevel: high`
  - `asset.addTag` -> `targetKind: asset_batch`, `payload: { tagId }` or `{ tagName }`, `riskLevel: medium`
  - `asset.rotate` -> `targetKind: image_edit_batch`, `payload: { angle }`, `riskLevel: medium`
- The wrapper uses `assetSource` directly on the operation and lets `prepareOperations()` materialize it before plan persistence.
- Existing write-scope checks remain centralized in `validateWriteScope`:
  - favorite requires `favoriteAssets`
  - archive/unarchive requires `archiveAssets`
  - tag requires `tagAssets`
  - rotate requires `editAssets`
- Existing asset edit/access semantics remain unchanged:
  - planning checks writable asset access through the existing `validateNormalAccess` path;
  - apply uses existing `assetService.updateAll`, `tagService.addAssets`, and rotate edit behavior.
- Empty and over-broad sources must fail before `planRepository.createReplacementRevision`.
- Tool calls must be audited under `proposeAssetBatchFromSearch`, including preparation denials from source resolution, write-scope failure, empty search, and over-broad search.

## TDD Requirements

Use TDD for every implementation step:

1. Write or update the failing test first.
2. Run the exact focused command and verify the failure is for the missing Slice 9 behavior, not a typo or fixture bug.
3. Implement the smallest code change that makes that test pass.
4. Re-run the focused test and verify green.
5. Only then continue to the next behavior.

Do not add production code before a failing test. Generated docs and generated runner prompt may be regenerated after source tests are green, but stale-artifact tests must fail before regeneration.

## Edge Cases Required By This Slice

Every edge case below must be covered by automated tests in this slice:

- Favorite plans can be created from `assetSource.search`.
- Archive/unarchive plans can be created from `assetSource.search`.
- Tag-by-name and tag-by-id plans can be created from `assetSource.search`.
- Rotate plans can be created from `assetSource.search`.
- `assetSource.previousSearch` materializes through the backing selection handle without rerunning search.
- Unsupported batch operation types, including `asset.removeTag`, album operations, and space operations, are rejected before plan persistence.
- Rotate angles share the extracted low-level `asset.rotate` payload schema and reject any value other than `90`, `180`, or `270`.
- Tag payloads share the extracted low-level `asset.addTag` payload schema and require exactly one of `tagId` or `tagName`.
- The wrapper uses `targetKind: asset_batch` for favorite/archive/tag and `targetKind: image_edit_batch` for rotate.
- Destructive or higher-risk operations keep correct risk levels and review copy: archive is `high`, tag and rotate are `medium`, favorite is `low`.
- Write-scope failures deny before source materialization and before plan persistence.
- Empty search sources do not create plans.
- Over-broad all-match sources do not create plans.
- The wrapper creates only a proposed plan; it does not call `assetService`, `tagService`, or rotate/edit apply paths.
- Generated MCP docs show this as the preferred tool for asset batch actions from search.
- Real MCP controller `tools/list` and runner prompt include the new tool and remain stable.

## Task 1: DTO Schema And Tool Name

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`

- [ ] **Step 1: Write failing DTO tests for valid asset batch workflow requests**

Add tests near the existing high-level workflow DTO tests in `server/src/dtos/agent-operation.dto.spec.ts`:

```ts
it.each([
  [
    'favorite',
    {
      action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
      assetSource: { kind: 'search', filters: { isFavorite: false } },
    },
  ],
  [
    'archive',
    {
      action: { type: AgentOperationType.AssetSetArchive, archived: true },
      assetSource: { kind: 'search', filters: { rating: 1 } },
    },
  ],
  [
    'unarchive',
    {
      action: { type: AgentOperationType.AssetSetArchive, archived: false },
      assetSource: { kind: 'search', filters: { visibility: 'archive' } },
    },
  ],
  [
    'tag by name',
    {
      action: { type: AgentOperationType.AssetAddTag, tagName: 'Receipts' },
      assetSource: { kind: 'search', mode: 'ocr', query: 'receipt' },
    },
  ],
  [
    'tag by id',
    {
      action: { type: AgentOperationType.AssetAddTag, tagId: factory.uuid() },
      assetSource: { kind: 'search', filters: { city: 'Berlin' } },
    },
  ],
  [
    'rotate',
    {
      action: { type: AgentOperationType.AssetRotate, angle: 90 },
      assetSource: { kind: 'search', filters: { type: AssetType.Image } },
    },
  ],
  [
    'previous search',
    {
      action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
      assetSource: { kind: 'previousSearch', sourceRef: `asset-source:search:${factory.uuid()}` },
    },
  ],
])('accepts proposeAssetBatchFromSearch for %s', (_label, request) => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
    summary: 'Update matching photos.',
    ...request,
  });

  expect(result.success).toBe(true);
});
```

If `AssetType` is not already imported in `server/src/dtos/agent-operation.dto.spec.ts`, add it to the enum import.

- [ ] **Step 2: Write failing DTO tests for invalid asset batch workflow requests**

Add:

```ts
it.each([
  ['remove tag', { type: AgentOperationType.AssetRemoveTag, tagId: factory.uuid() }],
  ['album operation', { type: AgentOperationType.AlbumAddAssets }],
  ['space operation', { type: AgentOperationType.SpaceAddAssets }],
])('rejects unsupported proposeAssetBatchFromSearch action %s', (_label, action) => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
    action,
    assetSource: { kind: 'search', filters: {} },
  });

  expect(result.success).toBe(false);
});

it.each([
  ['missing tag target', { type: AgentOperationType.AssetAddTag }],
  ['both tag targets', { type: AgentOperationType.AssetAddTag, tagId: factory.uuid(), tagName: 'Receipts' }],
])('rejects proposeAssetBatchFromSearch tag action with %s', (_label, action) => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
    action,
    assetSource: { kind: 'search', filters: {} },
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual([
    expect.objectContaining({ message: 'Provide exactly one of tagId or tagName' }),
  ]);
});

it.each([0, 45, 91, 360])('rejects proposeAssetBatchFromSearch rotate angle %s', (angle) => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
    action: { type: AgentOperationType.AssetRotate, angle },
    assetSource: { kind: 'search', filters: {} },
  });

  expect(result.success).toBe(false);
});

it('rejects proposeAssetBatchFromSearch raw id and selection-handle sources', () => {
  const rawIds = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
    action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
    assetSource: { kind: 'explicitAssets', assetIds: [factory.uuid()] },
  });
  const handle = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
    action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
    assetSource: { kind: 'selectionHandle', selectionHandleId: factory.uuid() },
  });

  expect(rawIds.success).toBe(false);
  expect(handle.success).toBe(false);
});

it('keeps asset batch action payload validation aligned with low-level asset operations', () => {
  const invalidRotateAction = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse(
    {
      action: { type: AgentOperationType.AssetRotate, angle: 45 },
      assetSource: { kind: 'search', filters: {} },
    },
  );
  const invalidRotateOperation = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
    summary: 'Rotate.',
    operations: [
      {
        type: AgentOperationType.AssetRotate,
        summary: 'Rotate.',
        targetKind: AgentOperationTargetKind.ImageEditBatch,
        assetIds: [factory.uuid()],
        payload: { angle: 45 },
      },
    ],
  });
  const invalidTagAction = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
    action: { type: AgentOperationType.AssetAddTag, tagId: factory.uuid(), tagName: 'Receipts' },
    assetSource: { kind: 'search', filters: {} },
  });
  const invalidTagOperation = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
    summary: 'Tag.',
    operations: [
      {
        type: AgentOperationType.AssetAddTag,
        summary: 'Tag.',
        targetKind: AgentOperationTargetKind.AssetBatch,
        assetIds: [factory.uuid()],
        payload: { tagId: factory.uuid(), tagName: 'Receipts' },
      },
    ],
  });

  expect(invalidRotateAction.success).toBe(false);
  expect(invalidRotateOperation.success).toBe(false);
  expect(invalidTagAction.success).toBe(false);
  expect(invalidTagOperation.success).toBe(false);
});
```

- [ ] **Step 3: Run DTO tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts -t "proposeAssetBatchFromSearch"
```

Expected: FAIL because `AgentToolName.ProposeAssetBatchFromSearch` and its schema do not exist.

- [ ] **Step 4: Add enum value**

In `server/src/enum.ts`, add after the existing high-level search workflow names:

```ts
ProposeAssetBatchFromSearch = 'proposeAssetBatchFromSearch',
```

- [ ] **Step 5: Add DTO schemas**

In `server/src/dtos/agent-operation.dto.ts`, first extract the existing low-level asset payload schemas so the workflow action and low-level operation schemas use the same validators. Replace the inline payload schemas in `rotateOperationSchema`, `setFavoriteOperationSchema`, `setArchiveOperationSchema`, and `addTagOperationSchema` with these shared constants:

```ts
const assetRotatePayloadSchema = z.strictObject({
  angle: z
    .number()
    .int()
    .refine((angle): angle is 90 | 180 | 270 => angle === 90 || angle === 180 || angle === 270, {
      message: 'angle must be 90, 180, or 270',
    }),
});

const assetSetFavoritePayloadSchema = z.strictObject({ favorite: z.boolean() });

const assetSetArchivePayloadSchema = z.strictObject({ archived: z.boolean() });

const assetAddTagPayloadSchema = z
  .strictObject({
    tagId: uuid.optional(),
    tagName: z.string().trim().min(1).max(200).optional(),
  })
  .refine((payload) => Number(payload.tagId !== undefined) + Number(payload.tagName !== undefined) === 1, {
    message: 'Provide exactly one of tagId or tagName',
  });
```

Then add the workflow action and request schemas after the space workflow schemas:

```ts
const AgentAssetBatchWorkflowActionSchema = z
  .discriminatedUnion('type', [
    assetSetFavoritePayloadSchema.extend({
      type: z.literal(AgentOperationType.AssetSetFavorite),
    }),
    assetSetArchivePayloadSchema.extend({
      type: z.literal(AgentOperationType.AssetSetArchive),
    }),
    assetAddTagPayloadSchema.extend({
      type: z.literal(AgentOperationType.AssetAddTag),
    }),
    assetRotatePayloadSchema.extend({
      type: z.literal(AgentOperationType.AssetRotate),
    }),
  ])
  .meta({ id: 'AgentAssetBatchWorkflowAction' });

const AgentProposeAssetBatchFromSearchToolRequestSchema = z
  .strictObject({
    summary: summary.optional(),
    action: AgentAssetBatchWorkflowActionSchema,
    assetSource: AgentAlbumWorkflowAssetSourceInputSchema,
  })
  .meta({ id: 'AgentProposeAssetBatchFromSearchToolRequestDto' });
```

Add the schema to `AgentOperationPlanToolRequestSchemas`:

```ts
[AgentToolName.ProposeAssetBatchFromSearch]: AgentProposeAssetBatchFromSearchToolRequestSchema,
```

Add the DTO class near the other high-level workflow DTO classes:

```ts
export class AgentProposeAssetBatchFromSearchToolRequestDto extends createZodDto(
  AgentProposeAssetBatchFromSearchToolRequestSchema,
) {}
```

- [ ] **Step 6: Run DTO tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts -t "proposeAssetBatchFromSearch"
```

Expected: PASS.

## Task 2: Operation Plan Service Wrapper

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`

**TDD ordering note:** Task 2 and Task 3 service tests are one pre-implementation red batch. Add Task 2 Step 1 and Task 3 Steps 1-3 before adding `proposeAssetBatchFromSearch()` or any service helper methods. Then run the combined red command in Task 3 Step 4 and verify the failure is the missing service wrapper. Task 2 Step 2 is only a narrow construction red check; it is not permission to implement before Task 3 tests exist.

- [ ] **Step 1: Write failing service tests for favorite/archive/tag/rotate plan construction**

Add near the Slice 7 and Slice 8 wrapper tests in `server/src/services/agent-operation-plan.service.spec.ts`:

```ts
it.each([
  {
    label: 'favorite',
    action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
    expectedType: AgentOperationType.AssetSetFavorite,
    expectedTargetKind: AgentOperationTargetKind.AssetBatch,
    expectedPayload: { favorite: true },
    expectedRiskLevel: AgentOperationRiskLevel.Low,
    expectedSummary: 'Mark matching photos as favorites',
  },
  {
    label: 'archive',
    action: { type: AgentOperationType.AssetSetArchive, archived: true },
    expectedType: AgentOperationType.AssetSetArchive,
    expectedTargetKind: AgentOperationTargetKind.AssetBatch,
    expectedPayload: { archived: true },
    expectedRiskLevel: AgentOperationRiskLevel.High,
    expectedSummary: 'Archive matching photos',
  },
  {
    label: 'unarchive',
    action: { type: AgentOperationType.AssetSetArchive, archived: false },
    expectedType: AgentOperationType.AssetSetArchive,
    expectedTargetKind: AgentOperationTargetKind.AssetBatch,
    expectedPayload: { archived: false },
    expectedRiskLevel: AgentOperationRiskLevel.High,
    expectedSummary: 'Move matching photos back to timeline',
  },
  {
    label: 'tag by name',
    action: { type: AgentOperationType.AssetAddTag, tagName: 'Receipts' },
    expectedType: AgentOperationType.AssetAddTag,
    expectedTargetKind: AgentOperationTargetKind.AssetBatch,
    expectedPayload: { tagName: 'Receipts' },
    expectedRiskLevel: AgentOperationRiskLevel.Medium,
    expectedSummary: 'Add tag "Receipts" to matching photos',
  },
  (() => {
    const tagId = newUuid();
    return {
      label: 'tag by id',
      action: { type: AgentOperationType.AssetAddTag, tagId },
      expectedType: AgentOperationType.AssetAddTag,
      expectedTargetKind: AgentOperationTargetKind.AssetBatch,
      expectedPayload: { tagId },
      expectedRiskLevel: AgentOperationRiskLevel.Medium,
      expectedSummary: 'Add selected tag to matching photos',
    };
  })(),
  {
    label: 'rotate',
    action: { type: AgentOperationType.AssetRotate, angle: 90 },
    expectedType: AgentOperationType.AssetRotate,
    expectedTargetKind: AgentOperationTargetKind.ImageEditBatch,
    expectedPayload: { angle: 90 },
    expectedRiskLevel: AgentOperationRiskLevel.Medium,
    expectedSummary: 'Rotate matching photos 90 degrees',
  },
])(
  'proposeAssetBatchFromSearch creates a reviewable $label plan from a search source',
  async ({ action, expectedType, expectedTargetKind, expectedPayload, expectedRiskLevel, expectedSummary }) => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
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
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        sessionId: session.id,
        operations: [
          makeOperation({
            type: expectedType,
            targetKind: expectedTargetKind,
            targetId: null,
            temporaryTargetId: null,
            assetIds,
            payload: expectedPayload,
            riskLevel: expectedRiskLevel,
          }),
        ],
      }),
    );

    await sut.proposeAssetBatchFromSearch(auth, session.id, {
      action,
      assetSource: { kind: 'search', filters: { rating: 5 }, materialization: 'all-matches-with-limit' },
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        plan: expect.objectContaining({ summary: expectedSummary }),
        operations: [
          expect.objectContaining({
            type: expectedType,
            summary: expectedSummary,
            targetKind: expectedTargetKind,
            targetId: undefined,
            temporaryTargetId: undefined,
            assetIds,
            assetSource: undefined,
            assetSelectionHandleId: undefined,
            payload: expectedPayload,
            riskLevel: expectedRiskLevel,
            enabled: true,
          }),
        ],
      }),
    );
    expect(planRepository.createReplacementRevision.mock.calls[0]?.[1].operations).toHaveLength(1);
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ProposeAssetBatchFromSearch,
        assetCount: assetIds.length,
      }),
    );
    expect(assetService.updateAll).not.toHaveBeenCalled();
    expect(tagService.addAssets).not.toHaveBeenCalled();
    expect(assetService.editAsset).not.toHaveBeenCalled();
  },
);
```

- [ ] **Step 2: Run service tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "proposeAssetBatchFromSearch creates a reviewable"
```

Expected: FAIL because `sut.proposeAssetBatchFromSearch` does not exist.

- [ ] **Step 3: Add service method and helper methods only after Task 3 Step 4 has failed for the missing wrapper**

In `server/src/services/agent-operation-plan.service.ts`, import `AgentProposeAssetBatchFromSearchToolRequestDto` from `src/dtos/agent-operation.dto`.

Add after the Slice 8 wrapper methods:

```ts
async proposeAssetBatchFromSearch(
  auth: AuthDto,
  sessionId: string,
  dto: AgentProposeAssetBatchFromSearchToolRequestDto,
): Promise<AgentOperationPlanToolResponseDto> {
  const operation = this.buildAssetBatchWorkflowOperation(dto);

  return this.proposeOperations(auth, sessionId, AgentToolName.ProposeAssetBatchFromSearch, {
    summary: dto.summary ?? operation.summary,
    operations: [operation],
  });
}

private buildAssetBatchWorkflowOperation(
  dto: AgentProposeAssetBatchFromSearchToolRequestDto,
): AgentAlbumOperationInput {
  const action = dto.action;
  return {
    type: action.type,
    summary: this.assetBatchWorkflowSummary(action),
    targetKind: this.assetBatchWorkflowTargetKind(action.type),
    assetSource: dto.assetSource,
    payload: this.assetBatchWorkflowPayload(action),
    riskLevel: this.assetBatchWorkflowRiskLevel(action),
    enabled: true,
  };
}

private assetBatchWorkflowTargetKind(type: AgentOperationType) {
  return type === AgentOperationType.AssetRotate
    ? AgentOperationTargetKind.ImageEditBatch
    : AgentOperationTargetKind.AssetBatch;
}

private assetBatchWorkflowPayload(action: AgentProposeAssetBatchFromSearchToolRequestDto['action']) {
  switch (action.type) {
    case AgentOperationType.AssetSetFavorite:
      return { favorite: action.favorite };
    case AgentOperationType.AssetSetArchive:
      return { archived: action.archived };
    case AgentOperationType.AssetAddTag:
      return action.tagId !== undefined ? { tagId: action.tagId } : { tagName: action.tagName };
    case AgentOperationType.AssetRotate:
      return { angle: action.angle };
  }
}

private assetBatchWorkflowRiskLevel(action: AgentProposeAssetBatchFromSearchToolRequestDto['action']) {
  if (action.type === AgentOperationType.AssetSetFavorite) {
    return AgentOperationRiskLevel.Low;
  }

  if (action.type === AgentOperationType.AssetSetArchive) {
    return AgentOperationRiskLevel.High;
  }

  return AgentOperationRiskLevel.Medium;
}

private assetBatchWorkflowSummary(action: AgentProposeAssetBatchFromSearchToolRequestDto['action']) {
  switch (action.type) {
    case AgentOperationType.AssetSetFavorite:
      return action.favorite ? 'Mark matching photos as favorites' : 'Remove matching photos from favorites';
    case AgentOperationType.AssetSetArchive:
      return action.archived ? 'Archive matching photos' : 'Move matching photos back to timeline';
    case AgentOperationType.AssetAddTag:
      return action.tagName ? `Add tag "${action.tagName}" to matching photos` : 'Add selected tag to matching photos';
    case AgentOperationType.AssetRotate:
      return `Rotate matching photos ${action.angle} degrees`;
  }
}
```

- [ ] **Step 4: Run service construction tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "proposeAssetBatchFromSearch creates a reviewable"
```

Expected: PASS.

## Task 3: Source, Permission, And Failure Edge Tests

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`

- [ ] **Step 1: Write failing previous-search materialization test**

Add:

```ts
it('proposeAssetBatchFromSearch materializes a previous search source without rerunning search', async () => {
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
    sampleAssetIds: assetIds.slice(0, 25),
    expiresAt: new Date('2026-05-21T12:30:00.000Z'),
    createdAt: now,
    updateId: newUuid(),
  });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  planRepository.createReplacementRevision.mockResolvedValue(
    makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.AssetSetFavorite,
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          payload: { favorite: true },
        }),
      ],
    }),
  );

  await sut.proposeAssetBatchFromSearch(auth, session.id, {
    action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
    assetSource: { kind: 'previousSearch', sourceRef },
  });

  expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    now: expect.any(Date),
  });
  expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      operations: [
        expect.objectContaining({
          type: AgentOperationType.AssetSetFavorite,
          assetIds,
          assetSource: undefined,
          assetSelectionHandleId: undefined,
        }),
      ],
    }),
  );
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      toolName: AgentToolName.ProposeAssetBatchFromSearch,
      assetCount: assetIds.length,
      redactedRequestMetadata: expect.objectContaining({
        selectionHandles: [
          expect.objectContaining({
            id: selectionHandleId,
            sourceKind: 'previousSearch',
            sourceRef,
          }),
        ],
      }),
    }),
  );
});
```

- [ ] **Step 2: Write failing write-scope tests**

Add:

```ts
it.each([
  {
    label: 'favorite',
    writeScopeOverride: { favoriteAssets: false },
    action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
    error: 'Agent permission policy does not allow changing asset favorites',
  },
  {
    label: 'archive',
    writeScopeOverride: { archiveAssets: false },
    action: { type: AgentOperationType.AssetSetArchive, archived: true },
    error: 'Agent permission policy does not allow archiving assets',
  },
  {
    label: 'tag',
    writeScopeOverride: { tagAssets: false },
    action: { type: AgentOperationType.AssetAddTag, tagName: 'Receipts' },
    error: 'Agent permission policy does not allow tagging assets',
  },
  {
    label: 'rotate',
    writeScopeOverride: { editAssets: false },
    action: { type: AgentOperationType.AssetRotate, angle: 90 },
    error: 'Agent permission policy does not allow editing assets',
  },
])(
  'proposeAssetBatchFromSearch denies $label before materializing source when write scope is disabled',
  async ({ writeScopeOverride, action, error }) => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, ...writeScopeOverride },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAssetBatchFromSearch(auth, session.id, {
        action,
        assetSource: { kind: 'search', filters: { rating: 5 } },
      }),
    ).rejects.toThrow(error);

    expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ProposeAssetBatchFromSearch,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error,
      }),
    );
  },
);
```

- [ ] **Step 3: Write failing empty and over-broad source tests**

Add:

```ts
it('proposeAssetBatchFromSearch does not create a plan for an empty search source', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
  sessionRepository.getById.mockResolvedValue(session);
  assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
    status: 'success',
    filters: {},
    results: [],
  });
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
  searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false } as never);

  await expect(
    sut.proposeAssetBatchFromSearch(auth, session.id, {
      action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
      assetSource: { kind: 'search', filters: {} },
    }),
  ).rejects.toThrow('Search source did not match any assets');

  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      toolName: AgentToolName.ProposeAssetBatchFromSearch,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      error: 'Search source did not match any assets',
    }),
  );
});

it('proposeAssetBatchFromSearch does not create a plan for an over-broad all-match search source', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
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
    sut.proposeAssetBatchFromSearch(auth, session.id, {
      action: { type: AgentOperationType.AssetSetArchive, archived: true },
      assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
    }),
  ).rejects.toThrow(`Search matched more than ${AgentOperationPlanService.maxAssetSelectionHandleAssets} assets`);

  expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
    { page: 1, size: AgentOperationPlanService.maxAssetSelectionHandleAssets + 1 },
    expect.any(Object),
  );
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run the combined service tests and verify red before any service implementation**

Run this before Task 2 Step 3. All service tests for construction, previous search, write scope, empty search, and over-broad search must already be present:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "proposeAssetBatchFromSearch"
```

Expected: FAIL because `sut.proposeAssetBatchFromSearch` does not exist. If it fails for fixture setup, typo, or mock configuration instead, fix the test and rerun until the missing wrapper is the failure.

- [ ] **Step 5: Run the combined service tests after Task 2 Step 3 and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "proposeAssetBatchFromSearch"
```

Expected: PASS because the wrapper reuses existing `prepareOperations()` ordering, write-scope checks, audit handling, and source materialization.

- [ ] **Step 6: Patch service only if edge tests fail**

If write-scope tests show source materialization before denial, do not special-case search. Keep the existing central rule by ensuring `proposeAssetBatchFromSearch()` calls `proposeOperations()` and the operation has the correct `type` before `prepareOperations()` calls `resolveOperationAssetIds()`.

If audit assertions fail, keep the `proposeOperations()` path so `proposeOperationsForSession()` catches preparation errors and calls `tryCreatePlanningPreparationDeniedAudit()` under `AgentToolName.ProposeAssetBatchFromSearch`.

## Task 4: MCP Routing, Registry, Contracts, Docs, And Prompt

**Files:**

- Modify: `server/src/services/agent-mcp.service.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Modify: `server/src/types/agent-mcp-contract.types.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify: `server/src/controllers/agent-runner-mcp.controller.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Regenerate: `docs/superpowers/generated/pi-agent-mcp-tools.md`
- Regenerate: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`

- [ ] **Step 1: Write failing MCP service delegation test**

In `server/src/services/agent-mcp.service.spec.ts`, add `AgentToolName.ProposeAssetBatchFromSearch` to both planning tool delegation `it.each` tables:

```ts
{
  toolName: AgentToolName.ProposeAssetBatchFromSearch,
  args: {
    summary: 'Favorite matching photos.',
    action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
    assetSource: { kind: 'search', filters: { rating: 5 } },
  },
  serviceMethod: 'proposeAssetBatchFromSearch' as const,
  expectedArguments: (authValue: AuthDto, sessionIdValue: string, args: Record<string, unknown>) => [
    authValue,
    sessionIdValue,
    args,
  ],
},
```

In the second table, use the same `toolName`, `args`, and `serviceMethod`.

Also add an MCP validation test proving unsupported actions are rejected before service delegation:

```ts
it('does not delegate unsupported proposeAssetBatchFromSearch actions', async () => {
  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ProposeAssetBatchFromSearch, {
      action: { type: AgentOperationType.AssetRemoveTag, tagId: factory.uuid() },
      assetSource: { kind: 'search', filters: {} },
    }),
  )) as AgentMcpSuccessResponse;

  expectEnrichedToolValidationError(response, {
    toolName: AgentToolName.ProposeAssetBatchFromSearch,
    path: 'action.type',
    expectedIncludes: 'asset.setFavorite',
  });
  expect(operationPlanService.proposeAssetBatchFromSearch).not.toHaveBeenCalled();
  expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
  expect(operationPlanService.reviseProposedOperations).not.toHaveBeenCalled();
  expect(operationPlanService.summarizePlan).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing registry, contract, docs, controller, and prompt tests**

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`:

- Add `AgentToolName.ProposeAssetBatchFromSearch` to `expectedToolNames` after the space workflow tools.
- Add it to `expectedPlanningToolNames`.
- Add:

```ts
it('lists the high-level asset batch workflow tool with valid examples', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));
  const tool = toolsByName.get(AgentToolName.ProposeAssetBatchFromSearch);
  const contract = contractService.getPlanningToolContract(AgentToolName.ProposeAssetBatchFromSearch);

  expect(contract).toBeDefined();
  if (!contract) {
    throw new Error('Missing planning contract for proposeAssetBatchFromSearch');
  }
  expect(tool?.title).toBe(contract.title);
  expect(tool?.description).toContain('preferred');
  expect(tool?.description).toContain('review');
  expect(tool?.inputSchema).toMatchObject({ type: 'object' });
  expect(tool?.inputSchema.examples).toEqual(contract.examples.map((example) => example.arguments));

  for (const exampleArguments of tool?.inputSchema.examples as Record<string, unknown>[]) {
    const result =
      AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse(exampleArguments);
    expect(result.success, `${AgentToolName.ProposeAssetBatchFromSearch} example should parse`).toBe(true);
  }
});
```

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`:

- Add `AgentToolName.ProposeAssetBatchFromSearch` to `expectedPlanningToolNames`.
- Add:

```ts
it('defines preferred high-level asset batch workflow contract and examples', () => {
  const contract = sut.getPlanningToolContract(AgentToolName.ProposeAssetBatchFromSearch);

  expect(contract?.description).toMatch(/preferred/i);
  expect(contract?.examples.map((example) => example.name)).toEqual(
    expect.arrayContaining([
      'favorite-search-results',
      'archive-search-results',
      'tag-search-results',
      'rotate-previous-search-results',
    ]),
  );
  expect(contract?.commonMistakes.map((mistake) => mistake.id)).toEqual(
    expect.arrayContaining(['asset-batch-workflow-raw-asset-ids', 'asset-batch-workflow-unsupported-action']),
  );
  expect(contract?.safety).toEqual({
    allowsDirectMutation: false,
    exposesSecrets: false,
    requiresGalleryApplyForWrites: true,
  });

  for (const example of contract?.examples ?? []) {
    const result = AgentOperationPlanToolRequestSchemas[contract!.name].safeParse(example.arguments);
    expect(result.success, `${contract!.name} ${example.name}`).toBe(true);
  }
});
```

In `server/src/services/agent-mcp-docs.service.spec.ts`, add an expectation to the generated docs test:

```ts
expect(markdown).toContain('proposeAssetBatchFromSearch');
expect(markdown).toContain('favorite-search-results');
expect(markdown).toContain('rotate-previous-search-results');
```

In `server/src/controllers/agent-runner-mcp.controller.spec.ts`, add `AgentToolName.ProposeAssetBatchFromSearch` to the real `tools/list` expected order after `ProposeAddAssetsToSpaceFromSearch`.

In `server/src/services/agent-mcp-prompt.service.spec.ts`, add to the compact prompt test:

```ts
expect(prompt).toContain('mcp_gallery_proposeAssetBatchFromSearch');
expect(prompt.length).toBeLessThanOrEqual(3800);
```

- [ ] **Step 3: Run MCP/docs/prompt tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/services/agent-mcp-prompt.service.spec.ts -t "proposeAssetBatchFromSearch|planning-tool contracts|tools/list|generated docs|runner prompt|asset batch workflow"
```

Expected: FAIL because MCP routing, registry, contracts, docs, prompt, and generated artifacts do not yet include the new tool.

- [ ] **Step 4: Add MCP service routing**

In `server/src/services/agent-mcp.service.ts`:

- Add `AgentToolName.ProposeAssetBatchFromSearch` to `planningToolNames`.
- Add a `case` in `handlePlanningToolCall`:

```ts
case AgentToolName.ProposeAssetBatchFromSearch: {
  return this.invokeTool(id, toolName, args, AgentOperationPlanToolRequestSchemas[toolName], (dto) =>
    this.operationPlanService.proposeAssetBatchFromSearch(auth, sessionId, dto),
  );
}
```

- [ ] **Step 5: Add planning tool type and registry entry**

In `server/src/types/agent-mcp-contract.types.ts`, add:

```ts
| AgentToolName.ProposeAssetBatchFromSearch
```

In `server/src/services/agent-mcp-tool-registry.service.ts`, add after the space workflow tools:

```ts
defineTool({
  name: AgentToolName.ProposeAssetBatchFromSearch,
  title: 'Propose asset batch from search',
  description: 'Preferred workflow for favoriting, archiving, tagging, or rotating matching photos as a reviewable plan.',
  schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch],
  annotations: planningToolAnnotations,
}),
```

- [ ] **Step 6: Add MCP contract and examples**

In `server/src/services/agent-mcp-tool-contract.service.ts`, add examples near the other high-level workflow examples:

```ts
const proposeAssetBatchFromSearchExamples: AgentMcpToolExample[] = [
  {
    name: 'favorite-search-results',
    description: 'Mark matching photos as favorites.',
    arguments: {
      summary: 'Favorite five-star South Africa photos.',
      action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
      assetSource: {
        kind: 'search',
        filters: { country: 'South Africa', rating: 5 },
        materialization: 'all-matches-with-limit',
      },
    },
  },
  {
    name: 'archive-search-results',
    description: 'Archive matching photos through plan review.',
    arguments: {
      summary: 'Archive blurry screenshots.',
      action: { type: AgentOperationType.AssetSetArchive, archived: true },
      assetSource: {
        kind: 'search',
        filters: { tags: { match: 'any', names: ['blurry screenshots'] } },
        materialization: 'all-matches-with-limit',
      },
    },
  },
  {
    name: 'tag-search-results',
    description: 'Add a tag to matching photos.',
    arguments: {
      summary: 'Tag matching receipt photos.',
      action: { type: AgentOperationType.AssetAddTag, tagName: 'Receipts' },
      assetSource: {
        kind: 'search',
        mode: 'ocr',
        query: 'receipt',
        filters: { type: 'IMAGE' },
        materialization: 'bounded-page',
        limit: 50,
      },
    },
  },
  {
    name: 'rotate-previous-search-results',
    description: 'Rotate photos from a previous search source reference.',
    arguments: {
      summary: 'Rotate the previously found sideways photos.',
      action: { type: AgentOperationType.AssetRotate, angle: 90 },
      assetSource: {
        kind: 'previousSearch',
        sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000444',
      },
    },
  },
];
```

Add the contract:

```ts
const proposeAssetBatchFromSearchContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeAssetBatchFromSearch,
  title: 'Propose asset batch from search',
  description:
    'preferred tool for favoriting, archiving, tagging, or rotating matching photos from a declarative or previous search source.',
  usage:
    'Use this before low-level proposeAlbumOperations when the user asks to favorite, archive, unarchive, tag, or rotate photos matching a search. Gallery resolves names, materializes the source, and creates a reviewable plan; nothing is applied until the user approves.',
  argumentModes: [
    {
      name: 'asset-batch-from-search',
      description: 'Create one reviewable asset batch operation from matching search results.',
      requiredFields: ['action', 'assetSource'],
      forbiddenFields: ['operations', 'assetIds', 'assetSelectionHandleId', 'targetKind'],
      whenToUse:
        'Use for requests like favorite matching photos, archive these search results, tag receipt photos, or rotate previously found sideways images.',
    },
  ],
  examples: proposeAssetBatchFromSearchExamples,
  commonMistakes: [
    {
      id: 'asset-batch-workflow-raw-asset-ids',
      match: { unexpectedField: 'assetIds', requestShape: 'tool-arguments' },
      hint: 'Use assetSource.search or assetSource.previousSearch with this workflow tool; do not paste raw asset ids.',
      exampleName: 'favorite-search-results',
    },
    {
      id: 'asset-batch-workflow-unsupported-action',
      match: { messageIncludes: 'Invalid input' },
      hint: 'Use one supported action type: asset.setFavorite, asset.setArchive, asset.addTag, or asset.rotate.',
      exampleName: 'tag-search-results',
    },
  ],
  safety,
};
```

Add `proposeAssetBatchFromSearchContract` to the planning contract list immediately after the space workflow contracts and before `proposeAlbumOperationsContract`.

- [ ] **Step 7: Compactly update runner prompt**

In `server/src/services/agent-mcp-prompt.service.ts`, change the write guidance line from:

```ts
`Write: album/space search use fromSearch tools first; other plans use ${this.toPiToolName(planContract.name)}.`,
```

to:

```ts
`Write: use fromSearch tools for album/space/batch search actions; low-level fallback ${this.toPiToolName(planContract.name)}.`,
```

If the prompt budget exceeds 3800 after the new tool name enlarges the `Tool:` line, trim nearby prose without removing tested semantics. Preferred trim targets:

- "Progressive: resolve names -> search detail ids -> readAssetMetadata fields for selected ids. Do not use limit 1000; if truncated/hasMore, page or ask one narrowing question."
- "Technical metadata: search ids first, then readAssetMetadata fields camera/dates/filename."

- [ ] **Step 8: Regenerate docs and runner prompt**

Run:

```bash
pnpm --dir server exec tsx src/bin/sync-agent-mcp-docs.ts
pnpm --dir server exec tsx src/bin/sync-agent-mcp-prompt.ts
```

Expected: `docs/superpowers/generated/pi-agent-mcp-tools.md` and `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs` update.

- [ ] **Step 9: Run MCP/docs/prompt tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/services/agent-mcp-prompt.service.spec.ts
```

Expected: PASS.

## Task 5: Slice Verification, Review, Commit, And Push

**Files:**

- All files modified by Tasks 1-4
- Modify: `docs/superpowers/plans/2026-05-22-pi-agent-declarative-planning-sources-slice-9.md`

- [ ] **Step 1: Run full Slice 9 verification**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-runner-flow.integration.spec.ts
pnpm --dir server exec tsc --noEmit --pretty false
pnpm --dir server run lint
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 2: Run spec-compliance review**

Dispatch a low-reasoning reviewer with this prompt:

```text
Spec-compliance review for Slice 9. Review the uncommitted changes in /home/pierre/dev/gallery/.worktrees/pi-agent-brainstorm against docs/superpowers/specs/2026-05-22-pi-agent-declarative-planning-sources-design.md Slice 9 and docs/superpowers/plans/2026-05-22-pi-agent-declarative-planning-sources-slice-9.md. Focus on whether proposeAssetBatchFromSearch satisfies all Slice 9 tests and edge cases, creates only reviewable plans, reuses existing source materialization and write-scope checks, rejects unsupported action types, handles empty/over-broad searches, updates generated docs/prompt/controller tool list, and avoids Slice 10+ scope. Do not edit files. Return APPROVED or CHANGES_REQUESTED with file/line findings and verification commands.
```

Fix any valid findings with TDD before continuing.

- [ ] **Step 3: Run code-quality review**

Dispatch a low-reasoning reviewer with this prompt:

```text
Code-quality review for Slice 9. Review the uncommitted changes in /home/pierre/dev/gallery/.worktrees/pi-agent-brainstorm for bugs, runtime issues, broken DI, bad Zod validation, stale generated artifacts, permission/audit leaks, prompt budget regressions, and brittle tests. Focus on proposeAssetBatchFromSearch, action-to-operation conversion, risk levels, write-scope denial ordering, source materialization, MCP registry/contracts/docs/prompt, and generated artifacts. Do not edit files. Return APPROVED or CHANGES_REQUESTED with concrete file/line findings and commands/results.
```

Fix any valid findings with TDD before continuing.

- [ ] **Step 4: Commit Slice 9**

Run:

```bash
git status --short
git add agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md docs/superpowers/plans/2026-05-22-pi-agent-declarative-planning-sources-slice-9.md server/src/controllers/agent-runner-mcp.controller.spec.ts server/src/dtos/agent-operation.dto.spec.ts server/src/dtos/agent-operation.dto.ts server/src/enum.ts server/src/services/agent-mcp-docs.service.spec.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp.service.spec.ts server/src/services/agent-mcp.service.ts server/src/services/agent-operation-plan.service.spec.ts server/src/services/agent-operation-plan.service.ts server/src/types/agent-mcp-contract.types.ts
git commit -m "feat(server): add Pi asset batch search workflow tool"
```

- [ ] **Step 5: Push Slice 9**

Run:

```bash
git push
```

Expected: branch `explore/pi-agent-brainstorm` pushes successfully.

## Self-Review

- Slice 9 TDD is explicit: every behavior starts with a failing test and an expected red command.
- All Slice 9 spec edge cases are covered: favorite/archive/tag/rotate, unsupported actions, tag and rotate validation, risk levels, review-only behavior, previousSearch, write-scope denial, empty/over-broad search, docs, controller, and prompt.
- The plan does not implement Slice 10 clarification UI, Slice 11 broad prompt overhaul, or Slice 12 activity polish.
- No placeholder language remains; all edge cases have concrete tests and commands.
