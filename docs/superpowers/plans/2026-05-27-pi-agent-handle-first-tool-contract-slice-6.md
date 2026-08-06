# Pi Agent Handle-First Workflow Tools And Limit Rebalance Slice 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selection-handle workflow tools, rebalance safe handle-only search limits to 1,000 where policy allows, and lock the USA-trip assistant flow so it completes through handles without provider-visible raw asset IDs.

**Architecture:** Extend the existing operation-planning DTO/service/MCP layers with `proposeAlbumFromSelection` and `proposeAssetBatchFromSelection`, implemented as thin wrappers around the existing `assetSource.selectionHandle` materialization path. Rebalance model guidance and deterministic runner behavior toward 1,000-result handle-first searches while preserving small metadata samples and existing preview limits. Add an end-to-end runner regression that searches to a handle, curates to a smaller handle, and proposes a plan from that handle without sending or receiving raw `assetIds`.

**Tech Stack:** TypeScript/NestJS/Zod/Vitest for Gallery server MCP tools; Node test runner for `agent-runner`; generated MCP prompt/docs artifacts.

---

## Slice Scope

Implement only Slice 6 from `docs/superpowers/specs/2026-05-27-pi-agent-handle-first-tool-contract-design.md`:

- Add model-facing workflow tools:
  - `proposeAlbumFromSelection`
  - `proposeAssetBatchFromSelection`
- Both tools accept same-session selection handles and delegate through the existing server-side selection-handle materialization path.
- Raise safe handle-first search guidance/runner candidate limits to 1,000 where the session permission plan allows it.
- Keep preview-assisted candidate limits unchanged at 250.
- Add a USA-trip regression where the provider-visible flow is:
  - `searchAssets` returns a handle/count only;
  - `curateSelection` returns a smaller handle;
  - `proposeAlbumFromSelection` creates the reviewable plan from the curated handle;
  - no provider-visible request or response fixture contains raw `assetIds`.

Out of scope:

- Do not implement image-quality scoring or `analyzeAssetQuality`.
- Do not raise preview-assisted limits.
- Do not remove internal persisted plan `assetIds`.
- Do not convert every legacy e2e helper in one pass; only update the flows required for the Slice 6 regression plus any assertions made stale by the new limits.

## Files

- Modify: `server/src/enum.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
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
- Modify: `server/src/services/agent-tool.service.spec.ts`
- Generated: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Generated: `docs/superpowers/generated/pi-agent-mcp-tools.md`
- Modify: `agent-runner/src/pi-runtime.mjs`
- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/e2e-runtime.mjs`
- Modify: `agent-runner/src/e2e-runtime.test.mjs`

---

## Task 1: Selection-Backed Workflow Tools

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add failing DTO tests**

In `server/src/dtos/agent-operation.dto.spec.ts`, add tests in `MCP planning tool request schemas` near the existing `proposeAlbumFromSearch` and `proposeAssetBatchFromSearch` tests:

```ts
it('accepts proposeAlbumFromSelection with a selection handle', () => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSelection].safeParse({
    summary: 'Create USA highlights from curated selection.',
    albumName: 'USA Highlights',
    description: 'Curated trip highlights.',
    selectionHandleId: factory.uuid(),
  });

  expect(result.success).toBe(true);
});

it('accepts proposeAssetBatchFromSelection with a selection handle', () => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSelection].safeParse({
    summary: 'Favorite curated highlights.',
    action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
    selectionHandleId: factory.uuid(),
  });

  expect(result.success).toBe(true);
});

it('keeps selection workflow DTOs handle-only', () => {
  const album = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSelection].safeParse({
    albumName: 'Manual ids',
    selectionHandleId: factory.uuid(),
    assetIds: [factory.uuid()],
  });
  const batch = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSelection].safeParse({
    action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
    selectionHandleId: factory.uuid(),
    assetSource: { kind: 'explicitAssets', assetIds: [factory.uuid()] },
  });

  expect(album.success).toBe(false);
  expect(batch.success).toBe(false);
});
```

- [ ] **Step 2: Add failing service materialization tests**

In `server/src/services/agent-operation-plan.service.spec.ts`, add tests near the existing `assetSource.selectionHandle` materialization tests:

```ts
it('proposeAlbumFromSelection materializes a curated handle into an album create plan', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const selectionHandleId = newUuid();
  const assetIds = [newUuid(), newUuid()];
  const createdPlan = makePlan({
    sessionId: session.id,
    operations: [
      makeOperation({
        type: AgentOperationType.AlbumCreate,
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'usa-highlights',
        assetIds: [],
        payload: { albumName: 'USA Highlights', description: 'Curated trip highlights.' },
      }),
      makeOperation({
        type: AgentOperationType.AlbumAddAssets,
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'usa-highlights',
        assetIds,
        payload: {},
      }),
    ],
  });

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: newUuid(),
    assetIds,
    assetCount: assetIds.length,
    sampleAssetIds: assetIds,
    expiresAt: new Date('2026-05-27T12:30:00.000Z'),
    createdAt: now,
    updateId: newUuid(),
  });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

  const result = await sut.proposeAlbumFromSelection(auth, session.id, {
    summary: 'Create USA highlights from curated selection.',
    albumName: 'USA Highlights',
    description: 'Curated trip highlights.',
    selectionHandleId,
  });

  expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    now: expect.any(Date),
  });
  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      operations: [
        expect.objectContaining({ type: AgentOperationType.AlbumCreate, assetIds: [] }),
        expect.objectContaining({
          type: AgentOperationType.AlbumAddAssets,
          assetIds,
          assetSource: undefined,
          assetSelectionHandleId: undefined,
        }),
      ],
    }),
  );
  expect(result.plan?.operations[1].assetIds).toEqual(assetIds);
});

it('proposeAssetBatchFromSelection materializes a curated handle into an asset batch plan', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const selectionHandleId = newUuid();
  const assetIds = [newUuid(), newUuid()];
  const createdPlan = makePlan({
    sessionId: session.id,
    operations: [
      makeOperation({
        type: AgentOperationType.AssetSetFavorite,
        targetKind: AgentOperationTargetKind.AssetBatch,
        targetId: null,
        temporaryTargetId: null,
        assetIds,
        payload: { favorite: true },
      }),
    ],
  });

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: newUuid(),
    assetIds,
    assetCount: assetIds.length,
    sampleAssetIds: assetIds,
    expiresAt: new Date('2026-05-27T12:30:00.000Z'),
    createdAt: now,
    updateId: newUuid(),
  });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

  const result = await sut.proposeAssetBatchFromSelection(auth, session.id, {
    summary: 'Favorite curated highlights.',
    action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
    selectionHandleId,
  });

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
  expect(result.plan?.operations[0].assetIds).toEqual(assetIds);
});
```

- [ ] **Step 3: Add failing MCP routing/redaction tests**

In `server/src/services/agent-mcp.service.spec.ts`, add a test near existing planning delegation tests:

```ts
it('routes proposeAlbumFromSelection and redacts materialized operation ids', async () => {
  const rawAssetIds = [factory.uuid(), factory.uuid()];
  const selectionHandleId = factory.uuid();
  const serviceResult = {
    status: 'success',
    summary: 'Plan revision 1: create USA highlights.',
    toolCall: null,
    plan: {
      id: factory.uuid(),
      sessionId,
      revision: 1,
      status: AgentOperationPlanStatus.Proposed,
      summary: 'Create USA highlights.',
      operations: [
        {
          id: factory.uuid(),
          planId: factory.uuid(),
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add curated highlights.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          targetId: null,
          temporaryTargetId: 'usa-highlights',
          assetIds: rawAssetIds,
          payload: {},
          dependencyIds: [],
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
          status: AgentOperationStatus.Proposed,
          result: null,
          error: null,
          createdAt: new Date('2026-05-27T12:00:00.000Z'),
          updatedAt: new Date('2026-05-27T12:00:00.000Z'),
        },
      ],
      createdAt: new Date('2026-05-27T12:00:00.000Z'),
      updatedAt: new Date('2026-05-27T12:00:00.000Z'),
    },
  };
  operationPlanService.proposeAlbumFromSelection.mockResolvedValue(serviceResult as never);

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ProposeAlbumFromSelection, {
      summary: 'Create USA highlights from curated selection.',
      albumName: 'USA Highlights',
      selectionHandleId,
    }),
  )) as AgentMcpSuccessResponse;

  const result = response.result as AgentMcpToolCallResult;
  const structuredContent = result.structuredContent as Record<string, any>;
  const [operation] = structuredContent.plan.operations;

  expect(operationPlanService.proposeAlbumFromSelection).toHaveBeenCalledWith(
    auth,
    sessionId,
    expect.objectContaining({ selectionHandleId }),
  );
  expect(operation.assetCount).toBe(2);
  expect(operation).not.toHaveProperty('assetIds');
  expect(JSON.stringify(response)).not.toContain('"assetIds"');
  expect(JSON.stringify(response)).not.toContain(rawAssetIds[0]);
});
```

- [ ] **Step 4: Run behavior tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp.service.spec.ts -t "FromSelection|proposeAlbumFromSelection|proposeAssetBatchFromSelection"
```

Expected: FAIL because `AgentToolName.ProposeAlbumFromSelection`, schemas, service methods, and MCP routing do not exist.

- [ ] **Step 5: Implement enum, DTOs, service wrappers, and MCP routing**

In `server/src/enum.ts`, add enum values after existing `FromSearch` tools:

```ts
ProposeAlbumFromSelection = 'proposeAlbumFromSelection',
ProposeAssetBatchFromSelection = 'proposeAssetBatchFromSelection',
```

In `server/src/dtos/agent-operation.dto.ts`:

1. Add request schemas after `AgentProposeAlbumFromSearchToolRequestSchema` and `AgentProposeAssetBatchFromSearchToolRequestSchema`:

```ts
const AgentProposeAlbumFromSelectionToolRequestSchema = z
  .strictObject({
    summary: summary.optional(),
    albumName,
    description: albumDescription,
    selectionHandleId: uuid,
  })
  .meta({ id: 'AgentProposeAlbumFromSelectionToolRequestDto' });

const AgentProposeAssetBatchFromSelectionToolRequestSchema = z
  .strictObject({
    summary: summary.optional(),
    action: AgentAssetBatchWorkflowActionSchema,
    selectionHandleId: uuid,
  })
  .meta({ id: 'AgentProposeAssetBatchFromSelectionToolRequestDto' });
```

2. Add them to `AgentOperationPlanToolRequestSchemas`:

```ts
[AgentToolName.ProposeAlbumFromSelection]: AgentProposeAlbumFromSelectionToolRequestSchema,
[AgentToolName.ProposeAssetBatchFromSelection]: AgentProposeAssetBatchFromSelectionToolRequestSchema,
```

3. Export DTO classes:

```ts
export class AgentProposeAlbumFromSelectionToolRequestDto extends createZodDto(
  AgentProposeAlbumFromSelectionToolRequestSchema,
) {}
export class AgentProposeAssetBatchFromSelectionToolRequestDto extends createZodDto(
  AgentProposeAssetBatchFromSelectionToolRequestSchema,
) {}
```

In `server/src/services/agent-operation-plan.service.ts`:

1. Import the new DTO classes.
2. Add methods next to the existing workflow methods:

```ts
async proposeAlbumFromSelection(
  auth: AuthDto,
  sessionId: string,
  dto: AgentProposeAlbumFromSelectionToolRequestDto,
): Promise<AgentOperationPlanToolResponseDto> {
  const temporaryTargetId = this.slugTemporaryTargetId(dto.albumName);
  const summary = dto.summary ?? `Create album "${dto.albumName}" from a curated selection.`;

  return this.proposeOperations(auth, sessionId, AgentToolName.ProposeAlbumFromSelection, {
    summary,
    operations: [
      {
        type: AgentOperationType.AlbumCreate,
        summary: `Create album "${dto.albumName}"`,
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId,
        payload: { albumName: dto.albumName, description: dto.description ?? '' },
        riskLevel: AgentOperationRiskLevel.Low,
        enabled: true,
      },
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: `Add curated selection to "${dto.albumName}"`,
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId,
        assetSource: { kind: 'selectionHandle', selectionHandleId: dto.selectionHandleId },
        payload: {},
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
      },
    ],
  });
}

async proposeAssetBatchFromSelection(
  auth: AuthDto,
  sessionId: string,
  dto: AgentProposeAssetBatchFromSelectionToolRequestDto,
): Promise<AgentOperationPlanToolResponseDto> {
  const operation = {
    type: dto.action.type,
    summary: this.getAssetBatchWorkflowActionSummary(dto.action),
    targetKind: this.getAssetBatchWorkflowTargetKind(dto.action),
    assetSource: { kind: 'selectionHandle', selectionHandleId: dto.selectionHandleId },
    payload: this.getAssetBatchWorkflowPayload(dto.action),
    riskLevel: this.getAssetBatchWorkflowRiskLevel(dto.action),
    enabled: true,
  };

  return this.proposeOperations(auth, sessionId, AgentToolName.ProposeAssetBatchFromSelection, {
    summary: dto.summary ?? operation.summary,
    operations: [operation as AgentProposeAlbumOperationsDto['operations'][number]],
  });
}
```

If `slugTemporaryTargetId()` does not exist, add a private helper close to the workflow methods:

```ts
private slugTemporaryTargetId(value: string) {
  return (
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-|-$/g, '')
      .slice(0, 48) || 'selection-album'
  );
}
```

In `server/src/services/agent-mcp.service.ts`:

1. Add the two tools to `planningToolNames`.
2. Add switch cases:

```ts
case AgentToolName.ProposeAlbumFromSelection: {
  return this.invokePlanningTool<AgentPlanningToolDto<AgentToolName.ProposeAlbumFromSelection>>(
    id,
    toolName,
    args,
    (dto) => this.operationPlanService.proposeAlbumFromSelection(auth, sessionId, dto),
  );
}
case AgentToolName.ProposeAssetBatchFromSelection: {
  return this.invokePlanningTool<AgentPlanningToolDto<AgentToolName.ProposeAssetBatchFromSelection>>(
    id,
    toolName,
    args,
    (dto) => this.operationPlanService.proposeAssetBatchFromSelection(auth, sessionId, dto),
  );
}
```

- [ ] **Step 6: Run behavior tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp.service.spec.ts -t "FromSelection|proposeAlbumFromSelection|proposeAssetBatchFromSelection"
pnpm --dir server run check
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Commit behavior**

Run:

```bash
git add server/src/enum.ts server/src/dtos/agent-operation.dto.ts server/src/dtos/agent-operation.dto.spec.ts server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts
git commit -m "feat: add selection-backed planning tools"
```

---

## Task 2: Selection Workflow Contracts, Registry, Prompt, Docs, And Generated Artifacts

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

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`:

```ts
it('documents selection-backed album and asset batch workflow tools', () => {
  const album = sut.getPlanningToolContract(AgentToolName.ProposeAlbumFromSelection);
  const batch = sut.getPlanningToolContract(AgentToolName.ProposeAssetBatchFromSelection);

  expect(album?.usage).toContain('selectionHandle.id');
  expect(batch?.usage).toContain('selectionHandle.id');
  expect(album?.examples.map((example) => example.name)).toContain('create-album-from-selection');
  expect(batch?.examples.map((example) => example.name)).toContain('favorite-selection');
  expect(JSON.stringify(album)).not.toContain('"assetIds"');
  expect(JSON.stringify(batch)).not.toContain('"assetIds"');

  for (const contract of [album, batch]) {
    for (const example of contract?.examples ?? []) {
      const result = AgentOperationPlanToolRequestSchemas[contract!.name].safeParse(example.arguments);
      expect(result.success, `${contract!.name} ${example.name}`).toBe(true);
    }
  }
});
```

Update `expectedPlanningToolNames` in contract and registry specs to include:

```ts
AgentToolName.ProposeAlbumFromSelection,
AgentToolName.ProposeAssetBatchFromSelection,
```

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, add:

```ts
it('publishes selection workflow schemas without raw asset ids', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));

  for (const toolName of [AgentToolName.ProposeAlbumFromSelection, AgentToolName.ProposeAssetBatchFromSelection]) {
    const schemaJson = JSON.stringify(toolsByName.get(toolName)?.inputSchema);

    expect(schemaJson).toContain('selectionHandleId');
    expect(schemaJson).not.toContain('"assetIds"');
    expect(schemaJson).not.toContain('explicitAssets');
  }
});
```

In `server/src/services/agent-mcp-prompt.service.spec.ts`, extend the default write/path test:

```ts
expect(prompt).toContain('mcp_gallery_proposeAlbumFromSelection');
expect(prompt).toContain('mcp_gallery_proposeAssetBatchFromSelection');
expect(prompt).toContain('curateSelection');
expect(prompt).toContain('proposeAlbumFromSelection');
expect(prompt).not.toContain('choose selected assetIds');
```

In `server/src/services/agent-mcp-docs.service.spec.ts`, add:

```ts
it('documents selection-backed workflow tools', () => {
  const markdown = sut.generateMarkdown();
  const documentedNames = sut.listDocumentedToolArgumentExamples().map((example) => example.exampleName);

  expect(markdown).toContain('proposeAlbumFromSelection');
  expect(markdown).toContain('proposeAssetBatchFromSelection');
  expect(markdown).toContain('create-album-from-selection');
  expect(markdown).toContain('favorite-selection');
  expect(documentedNames).toEqual(expect.arrayContaining(['create-album-from-selection', 'favorite-selection']));
  expect(markdown).not.toContain('choose selected assetIds');
});
```

- [ ] **Step 2: Run selection guidance tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts -t "selection-backed|selection workflow|default write|selection"
```

Expected: FAIL because the new tools are not in contracts, registry, prompt, docs, or generated artifacts yet.

- [ ] **Step 3: Implement contracts and registry entries**

In `server/src/services/agent-mcp-tool-contract.service.ts`:

1. Add examples:

```ts
const proposeAlbumFromSelectionExamples: AgentMcpToolExample[] = [
  {
    name: 'create-album-from-selection',
    description: 'Create a new album from an existing search or curated selection handle.',
    arguments: {
      summary: 'Create USA highlights from curated selection.',
      albumName: 'USA Highlights',
      description: 'Curated trip highlights.',
      selectionHandleId: exampleSelectionHandleId,
    },
  },
];

const proposeAssetBatchFromSelectionExamples: AgentMcpToolExample[] = [
  {
    name: 'favorite-selection',
    description: 'Favorite all assets in an existing search or curated selection handle.',
    arguments: {
      summary: 'Favorite curated highlights.',
      action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
      selectionHandleId: exampleSelectionHandleId,
    },
  },
];
```

2. Add contracts:

```ts
const proposeAlbumFromSelectionContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeAlbumFromSelection,
  title: 'Propose album from selection',
  description: 'preferred tool for creating a new album from a search or curated selection handle.',
  usage:
    'Use after searchAssets or curateSelection when the selected asset set is already represented by selectionHandle.id. Gallery materializes IDs server-side and creates a reviewable plan only.',
  argumentModes: [
    {
      name: 'new-album-from-selection',
      description: 'Create a new album and add assets from a same-session selection handle.',
      requiredFields: ['albumName', 'selectionHandleId'],
      forbiddenFields: ['operations', 'assetIds', 'assetSource', 'assetSelectionHandleId'],
      whenToUse: 'Use after curation when the next step is a new album from that curated handle.',
    },
  ],
  examples: proposeAlbumFromSelectionExamples,
  commonMistakes: [
    {
      id: 'album-selection-workflow-raw-asset-ids',
      match: { unexpectedField: 'assetIds', requestShape: 'tool-arguments' },
      hint: 'Use selectionHandleId from searchAssets or curateSelection; provider planning rejects raw assetIds.',
      exampleName: 'create-album-from-selection',
    },
  ],
  safety,
};

const proposeAssetBatchFromSelectionContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeAssetBatchFromSelection,
  title: 'Propose asset batch from selection',
  description:
    'preferred tool for proposing favorite, archive, tag, metadata, or rotate actions from a selection handle.',
  usage:
    'Use after searchAssets or curateSelection when the selected asset set is already represented by selectionHandle.id. Gallery materializes IDs server-side and creates a reviewable plan only.',
  argumentModes: [
    {
      name: 'asset-batch-from-selection',
      description: 'Propose one supported asset batch action for a same-session selection handle.',
      requiredFields: ['action', 'selectionHandleId'],
      forbiddenFields: ['operations', 'assetIds', 'assetSource', 'assetSelectionHandleId', 'targetKind'],
      whenToUse: 'Use after curation when the next step is a metadata/favorite/archive/tag/rotate operation.',
    },
  ],
  examples: proposeAssetBatchFromSelectionExamples,
  commonMistakes: [
    {
      id: 'asset-batch-selection-workflow-raw-asset-ids',
      match: { unexpectedField: 'assetIds', requestShape: 'tool-arguments' },
      hint: 'Use selectionHandleId from searchAssets or curateSelection; provider planning rejects raw assetIds.',
      exampleName: 'favorite-selection',
    },
  ],
  safety,
};
```

3. Add them to `planningContracts` in stable order before low-level `proposeAlbumOperations`.

In `server/src/services/agent-mcp-tool-registry.service.ts`, add `defineTool()` entries for both schemas in the same stable order as the contracts.

- [ ] **Step 4: Update prompt/docs source guidance**

In `server/src/services/agent-mcp-prompt.service.ts`:

- Add both new tool names to `Default write:`.
- Add a line that explicitly says:

```ts
'After curateSelection: use proposeAlbumFromSelection or proposeAssetBatchFromSelection with selectionHandle.id; do not copy asset IDs.',
```

In `server/src/services/agent-mcp-docs.service.ts`:

- Add the new tools to source-backed workflow defaults:

```ts
'Use `proposeAlbumFromSelection` and `proposeAssetBatchFromSelection` after `curateSelection` returns a final `selectionHandle.id`.',
```

- Ensure the generated examples section includes `create-album-from-selection` and `favorite-selection`.

- [ ] **Step 5: Run source tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
```

Expected: generated sync tests may fail only because generated artifacts are stale. All non-generated behavior should pass.

- [ ] **Step 6: Commit source guidance**

Run:

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-docs.service.spec.ts
git commit -m "docs: advertise selection-backed planning tools"
```

- [ ] **Step 7: Regenerate and verify generated artifacts**

Run:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-prompt
pnpm --dir server run sync:agent-mcp-docs
rg -n 'choose selected assetIds|choose .* assetIds|"kind": ?"explicitAssets"|kind: '\''explicitAssets'\''|assetSource: \{ kind: '\''explicitAssets'\''|createSelectionHandle|"detail":"ids"|"detail": "ids"' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
rg -n 'proposeAlbumFromSelection|proposeAssetBatchFromSelection|create-album-from-selection|favorite-selection|selectionHandleId' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
```

Expected: first `rg` has no matches; second has matches in both generated files; sync tests pass.

- [ ] **Step 8: Commit generated artifacts**

Run:

```bash
git add agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
git commit -m "chore: regenerate selection workflow guidance"
```

---

## Task 3: Handle-Only Search Limit Rebalance

**Files:**

- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `server/src/services/agent-mcp-docs.service.ts`
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify: `agent-runner/src/pi-runtime.mjs`
- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/e2e-runtime.mjs`
- Modify: `agent-runner/src/e2e-runtime.test.mjs`
- Generated: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Generated: `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Add failing 1,000-result search-handle service tests**

In `server/src/services/agent-tool.service.spec.ts`, add near existing search handle tests:

```ts
it('searchAssets supports 1000-result handle-only pages without prompt-sized payloads', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const auth = AuthFactory.create();
  const assetIds = Array.from({ length: 1000 }, () => newUuid());
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({
      limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1000, maxAssetsPerSession: 1000 },
    }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  toolCallRepository.getCountedAssetCountBySession.mockResolvedValue(0);
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })) as never,
    hasNextPage: false,
  });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
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

  const result = await sut.searchAssets(auth, session.id, { filters: { country: 'USA' }, limit: 1000 });

  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error('Expected searchAssets to succeed');
  }
  expect(searchRepository.searchMetadata).toHaveBeenCalledWith({ page: 1, size: 1000 }, expect.any(Object));
  expect(result.detail).toBe('handle');
  expect(result.selectionHandle.assetCount).toBe(1000);
  expect(result).not.toHaveProperty('assetIds');
  expect(result).not.toHaveProperty('assets');
  expect(result).not.toHaveProperty('sample');
  expect(JSON.stringify(result)).not.toContain(assetIds[0]);
  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  vi.useRealTimers();
});

it('searchAssets still rejects handle pages above the session per-tool limit', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({
      limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1000, maxAssetsPerSession: 2000 },
    }),
  });

  sessionRepository.getById.mockResolvedValue(session);

  const result = await sut.searchAssets(auth, session.id, { filters: { country: 'USA' }, limit: 1001 });

  expect(result).toEqual({
    status: 'denied',
    reason: 'Requested asset count exceeds per-tool limit',
    toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
  });
  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Add failing prompt/docs and runner limit tests**

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, update the search usage/correction tests:

```ts
expect(search?.usage).toContain('limit up to 1000');
expect(search?.usage).not.toContain('Do not use limit 1000');
```

Change the validation correction test for large limits so it still discourages broad unbounded searches, but no longer forbids bounded 1,000-result handle searches:

```ts
expect(broadLimitPolicy?.hint).toContain('Use limit up to 1000 only for bounded handle-first searches');
expect(broadLimitPolicy?.hint).not.toContain('Do not use limit 1000');
```

In `server/src/services/agent-mcp-prompt.service.spec.ts`:

```ts
expect(prompt).toContain('limit up to 1000');
expect(prompt).not.toContain('No 1k');
expect(prompt).not.toContain('Do not use limit 1000');
```

In `server/src/services/agent-mcp-docs.service.spec.ts`:

```ts
expect(markdown).toContain('limit up to 1000');
expect(markdown).not.toContain('Do not use limit 1000');
```

In `agent-runner/src/pi-runtime.test.mjs`, update the current system-prompt assertion:

```js
assert.equal(calls.loaders[0].systemPrompt.includes('limit up to 1000'), true);
assert.equal(calls.loaders[0].systemPrompt.includes('Do not use limit 1000'), false);
```

In `agent-runner/src/e2e-runtime.test.mjs`, update metadata-only highlight limit tests to expect 1,000 instead of 500:

```js
assert.equal(calls[0].body.params.arguments.limit, 1000);
assert.match(events.at(-1).content.blocks[0].text, /1000 or fewer/i);
```

- [ ] **Step 3: Run limit tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts -t "1000|limit"
pnpm --dir agent-runner test -- --test-name-pattern "limit|highlights|prompt"
```

Expected: FAIL because prompt/docs still discourage 1,000, runner limit constants are still 500, and the new 1,000 service tests do not exist/pass yet.

- [ ] **Step 4: Implement limit guidance and runner constant changes**

In `server/src/services/agent-mcp-tool-contract.service.ts`:

- Replace search usage text that says `Do not use limit 1000` with:

```ts
'For bounded handle-first searches, use limit up to 1000 when the session policy allows it; samples stay small. For broad or ambiguous requests, ask one narrowing question or page with nextPage.';
```

- Replace the `search-large-limit` hint with:

```ts
hint:
  'Use limit up to 1000 only for bounded handle-first searches where the user supplied a clear album, space, date, person, tag, rating, or media-type scope; otherwise page with nextPage or ask a narrowing question.',
```

In `server/src/services/agent-mcp-prompt.service.ts`, replace `No 1k; if truncated/hasMore, page/ask.` with:

```ts
'Progressive: resolve names -> search handle {"detail":"handle"}; bounded handle-first searches may use limit up to 1000; samples stay small; if truncated/hasMore, page/ask.',
```

In `server/src/services/agent-mcp-docs.service.ts`, replace the broad search line with:

```ts
'- Broad search: use `searchAssets` with handle detail or omit `detail`. For bounded handle-first searches, use `limit` up to 1000 when policy allows it; samples remain 10-25 items. If `hasMore` or `resultSize.truncated` is true, page with `nextPage` or ask a narrowing question; when hasMore is true, keep the same mode, query, filters, order, and limit.',
```

In `agent-runner/src/pi-runtime.mjs`, replace the fallback guidance string with:

```js
return 'Progressive: resolve names -> searchAssets returns selection handles and source refs; use readAssetMetadata only for specific non-search asset details when required. Bounded handle-first searches may use limit up to 1000; if truncated/hasMore, page or ask one narrowing question.';
```

In `agent-runner/src/e2e-runtime.mjs`, change:

```js
const metadataHighlightCandidateLimit = 1000;
```

Keep:

```js
const previewHighlightCandidateLimit = 250;
```

- [ ] **Step 5: Run source tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts -t "1000|limit"
pnpm --dir agent-runner test -- --test-name-pattern "limit|highlights|prompt"
pnpm --dir server run check
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit source limit rebalance**

Run:

```bash
git add server/src/services/agent-tool.service.spec.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-docs.service.spec.ts agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs
git commit -m "feat: rebalance handle-first search limits"
```

- [ ] **Step 7: Regenerate guidance artifacts**

Run:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-prompt
pnpm --dir server run sync:agent-mcp-docs
rg -n 'Do not use limit 1000|No 1k|choose selected assetIds|choose .* assetIds|"detail":"ids"|"detail": "ids"' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-tool-contract.service.ts agent-runner/src/pi-runtime.mjs
rg -n 'limit up to 1000|bounded handle-first searches' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md agent-runner/src/pi-runtime.mjs
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
```

Expected: first scan has no matches; second scan has matches in generated files and runner runtime; sync tests pass.

- [ ] **Step 8: Commit regenerated limit guidance**

Run:

```bash
git add agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
git commit -m "chore: regenerate handle limit guidance"
```

---

## Task 4: USA-Trip Handle-First Assistant Regression

**Files:**

- Modify: `agent-runner/src/e2e-runtime.mjs`
- Modify: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Add failing USA-trip regression**

In `agent-runner/src/e2e-runtime.test.mjs`, add helpers near `metadataHighlightHandlers`:

```js
const usaTripSearchHandleId = '00000000-0000-4000-8000-000000000901';
const usaTripCuratedHandleId = '00000000-0000-4000-8000-000000000902';

const usaTripHandleFirstHandlers = () => [
  {
    name: 'searchAssets',
    handle: (args, request) => {
      assert.deepEqual(args.filters, {
        country: 'USA',
        takenAfter: '2026-01-01T00:00:00.000Z',
        takenBefore: '2026-02-01T00:00:00.000Z',
      });
      assert.equal(args.detail, 'handle');
      assert.equal(args.limit, 1000);

      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'success',
              summary: 'Created a selection handle for 80 USA trip candidates.',
              detail: 'handle',
              selectionHandle: {
                id: usaTripSearchHandleId,
                sourceRef: `asset-source:search:${usaTripSearchHandleId}`,
                assetCount: 80,
                sourceToolCallId: '00000000-0000-4000-8000-000000000903',
                expiresAt: '2026-05-27T12:30:00.000Z',
              },
              returnedCount: 80,
              hasMore: false,
              nextPage: null,
              resultSize: { returnedItems: 80, truncated: false, omittedFields: [], hasMore: false, nextPage: null },
            },
          },
        },
      };
    },
  },
  {
    name: 'curateSelection',
    handle: (args, request) => {
      assert.deepEqual(args, {
        selectionHandleId: usaTripSearchHandleId,
        targetCount: 15,
        strategy: 'metadata-highlights',
        criteria: 'top highlights from January 2026 USA trip',
        sampleSize: 10,
      });

      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'success',
              summary: 'Curated 15 metadata-only highlights.',
              strategy: 'metadata-highlights',
              selectionHandle: {
                id: usaTripCuratedHandleId,
                sourceRef: `asset-source:search:${usaTripCuratedHandleId}`,
                assetCount: 15,
                sourceToolCallId: '00000000-0000-4000-8000-000000000904',
                expiresAt: '2026-05-27T12:30:00.000Z',
              },
              sourceAssetCount: 80,
              selectedAssetCount: 15,
              criteriaSummary: ['metadata-only highlights from January 2026 USA trip'],
              resultSize: { returnedItems: 1, truncated: false, omittedFields: [], hasMore: false, nextPage: null },
            },
          },
        },
      };
    },
  },
  {
    name: 'proposeAlbumFromSelection',
    handle: (args, request) => {
      assert.deepEqual(args, {
        summary: 'Create USA Highlights with 15 metadata-only curated highlights.',
        albumName: 'USA Highlights',
        description: 'Suggested highlights selected from metadata signals. No previews were inspected.',
        selectionHandleId: usaTripCuratedHandleId,
      });

      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'success',
              summary: 'Stored USA Highlights plan.',
              plan: { id: '00000000-0000-4000-8000-000000000905', operations: [{ assetCount: 15 }] },
              toolCall: null,
            },
          },
        },
      };
    },
  },
];
```

Then add the regression:

```js
it('creates USA trip highlights through search handle, curation handle, and selection plan without raw ids', async () => {
  const { calls, fetchImplementation } = createFetch(usaTripHandleFirstHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(
    runtime,
    'Create an album of the top 15 highlights from my January 2026 USA trip called USA Highlights.',
  );

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'searchAssets,curateSelection,proposeAlbumFromSelection',
  );
  assert.equal(JSON.stringify(calls).includes('assetIds'), false);
  assert.equal(JSON.stringify(calls).includes('00000000-0000-4000-8000-000000000401'), false);
  assert.match(events.at(-1).content.blocks[0].text, /metadata-only/i);
  assert.match(events.at(-1).content.blocks[0].text, /15 suggested highlights/i);
  assert.match(events.at(-1).content.blocks[0].text, /Review/i);
});
```

- [ ] **Step 2: Run USA regression red**

Run:

```bash
pnpm --dir agent-runner test -- --test-name-pattern "USA trip highlights"
```

Expected: FAIL because the deterministic runner does not parse the USA trip source, does not call `curateSelection`, and does not call `proposeAlbumFromSelection`.

- [ ] **Step 3: Implement handle-first USA trip flow**

In `agent-runner/src/e2e-runtime.mjs`:

1. Extend `parseHighlightPrompt()` to recognize the regression prompt:

```js
const usaTripDateFilters = (prompt) => {
  if (!/\b(?:USA|United States)\b/i.test(prompt)) {
    return null;
  }

  if (/\bJanuary\s+2026\b/i.test(prompt)) {
    return {
      country: 'USA',
      takenAfter: '2026-01-01T00:00:00.000Z',
      takenBefore: '2026-02-01T00:00:00.000Z',
    };
  }

  return { country: 'USA' };
};
```

Use it in `parseHighlightPrompt()` before last-weekend filters:

```js
const usaFilters = usaTripDateFilters(prompt);
const filters = usaFilters ?? (/\b(last weekend|weekend)\b/i.test(prompt) ? lastWeekendFilters : null);
const bounded =
  !unbounded &&
  (Boolean(usaFilters) || /\b(this album|album|space|last weekend|weekend|from|selected|selection)\b/i.test(prompt));
```

2. Add handle-first helpers:

```js
const readHighlightSelection = async (client, highlightPrompt, limit) => {
  const result = await client.call('searchAssets', {
    filters: highlightPrompt.filters,
    detail: 'handle',
    limit,
  });
  assertMcpResultSuccess(result, 'Asset search');

  if (!result.selectionHandle?.id) {
    throw new Error('Asset search did not return a selection handle');
  }

  return {
    selectionHandle: result.selectionHandle,
    candidateCount: highlightCandidateCount(result, [], limit),
  };
};

const curateMetadataHighlights = async (client, selectionHandleId, targetCount, criteria) => {
  const result = await client.call('curateSelection', {
    selectionHandleId,
    targetCount,
    strategy: 'metadata-highlights',
    criteria,
    sampleSize: 10,
  });
  assertMcpResultSuccess(result, 'Selection curation');

  if (!result.selectionHandle?.id) {
    throw new Error('Selection curation did not return a selection handle');
  }

  return result;
};

const proposeMetadataHighlightAlbumFromSelection = async (client, intent, selectionHandleId, selectedCount) => {
  await client.call('proposeAlbumFromSelection', {
    summary: `Create ${intent.albumName} with ${selectedCount} metadata-only curated highlights.`,
    albumName: intent.albumName,
    description: highlightAlbumDescription('metadata-only'),
    selectionHandleId,
  });
};
```

3. In the `planIntent?.kind === 'create-album'` branch, for metadata-only curation (`!usePreviewAssistedCuration`) and non-current-album source, use the handle-first path before reading exact metadata:

```js
if (planIntent?.kind === 'create-album' && !usePreviewAssistedCuration && !sourceAlbumAssetIds) {
  const { selectionHandle, candidateCount } = await readHighlightSelection(
    client,
    highlightPrompt,
    metadataHighlightCandidateLimit,
  );
  if (candidateCount === 0) {
    yield completedEvent({ gallerySessionId, runnerSessionId, text: 'I found no matching candidates in that bounded source, so I did not create a plan.' });
    return;
  }
  if (candidateCount > metadataHighlightCandidateLimit) {
    yield completedEvent({ gallerySessionId, runnerSessionId, text: 'That source has too many candidate assets for this metadata-only highlight pass. Please narrow the album, space, date range, search/filter, or selected photos.' });
    return;
  }

  const curated = await curateMetadataHighlights(
    client,
    selectionHandle.id,
    highlightPrompt.effectiveCount,
    highlightPrompt.filters?.country === 'USA'
      ? 'top highlights from January 2026 USA trip'
      : 'top metadata-only highlights from the bounded source',
  );
  await proposeMetadataHighlightAlbumFromSelection(
    client,
    planIntent,
    curated.selectionHandle.id,
    curated.selectedAssetCount ?? highlightPrompt.effectiveCount,
  );
  yield completedEvent({
    gallerySessionId,
    runnerSessionId,
    text: `I proposed ${curated.selectedAssetCount ?? highlightPrompt.effectiveCount} suggested highlights using metadata-only criteria. Review the plan before applying it.`,
  });
  return;
}
```

Preserve the existing exact-asset path for preview-assisted planning, current-album planning, and cover selection.

- [ ] **Step 4: Run runner tests green**

Run:

```bash
pnpm --dir agent-runner test -- --test-name-pattern "USA trip highlights|metadata-only highlight album planning|preview-assisted highlight album planning|favorite"
```

Expected: PASS. Metadata-only new-album flow should now use handles; preview-assisted flow should still use previews and remain bounded at 250.

- [ ] **Step 5: Commit runner regression**

Run:

```bash
git add agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs
git commit -m "test: cover USA trip handle-first assistant flow"
```

---

## Task 5: Slice 6 Verification And Push

**Files:**

- All Slice 6 changed files.

- [ ] **Step 1: Run focused server tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-tool.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run runner tests**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck, build, and hygiene**

Run:

```bash
pnpm --dir server run check
pnpm --dir server run build
git diff --check
git status --short --branch
```

Expected: `check`, `build`, and `diff --check` exit 0; worktree is clean except committed branch-ahead state.

- [ ] **Step 4: Run provider-visible raw-ID scans**

Run:

```bash
rg -n 'choose selected assetIds|choose .* assetIds|"kind": ?"explicitAssets"|kind: '\''explicitAssets'\''|assetSource: \{ kind: '\''explicitAssets'\''|createSelectionHandle|"detail":"ids"|"detail": "ids"|Do not use limit 1000|No 1k' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-tool-contract.service.ts agent-runner/src/pi-runtime.mjs
rg -n 'proposeAlbumFromSelection|proposeAssetBatchFromSelection|limit up to 1000|bounded handle-first searches|curateSelection' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-tool-contract.service.ts agent-runner/src/pi-runtime.mjs
rg -n 'assetIds' agent-runner/src/e2e-runtime.test.mjs agent-runner/src/e2e-runtime.mjs
```

Expected:

- First scan has no matches.
- Second scan has matches in generated files, source prompt/docs/contracts, and runner runtime.
- Third scan may match legacy preview/current-album fixtures and internal helper names, but the USA-trip regression must assert `JSON.stringify(calls).includes('assetIds') === false`.

- [ ] **Step 5: Push Slice 6**

Run:

```bash
git push
```

Expected: branch `explore/pi-agent-brainstorm` pushes to origin.

## Plan Self-Review

- TDD order is explicit for new workflow tools, provider guidance, limit rebalance, and the USA-trip regression.
- Every Slice 6 requirement is covered:
  - `proposeAlbumFromSelection` and `proposeAssetBatchFromSelection` DTOs, service methods, MCP routing, contracts, registry schemas, prompt/docs, and generated artifacts;
  - selection tools delegate through existing `assetSource.selectionHandle` materialization and persist internal durable `assetIds`;
  - handle-only search reaches 1,000 results with small provider-visible payloads and no asset IDs;
  - search above session per-tool limit still rejects before repository work;
  - preview-assisted limit remains 250;
  - generated prompt/docs no longer forbid `limit 1000`;
  - USA-trip assistant flow uses search handle -> curation handle -> selection-backed planning and asserts no raw IDs in provider-visible call arguments.
- Future work remains out of scope:
  - objective image quality scoring;
  - preview-assisted curation redesign;
  - removing raw IDs from internal persistence or authenticated Gallery review/apply APIs.
