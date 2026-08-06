# Pi Agent High-Level Album Workflow Tools Slice 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class MCP tools for creating an album from a declarative search and adding search results to an existing album, without making Pi assemble low-level operation arrays.

**Architecture:** Add two planning tools, `proposeAlbumFromSearch` and `proposeAddAssetsToAlbumFromSearch`, as thin wrappers over the existing source-aware operation planning service. The wrappers construct normal `album.create` and `album.addAssets` operations with `assetSource.search` or `assetSource.previousSearch`, then reuse the same validation, materialization, audit, and plan-review path as `proposeAlbumOperations`.

**Tech Stack:** NestJS services, Zod DTOs, existing MCP tool registry/contracts/docs, Vitest, TypeScript, `pnpm --dir server`.

---

## Scope

This is Slice 7 from `docs/superpowers/specs/2026-05-22-pi-agent-declarative-planning-sources-design.md`.

Implement only high-level album workflow tools:

- `proposeAlbumFromSearch`
- `proposeAddAssetsToAlbumFromSearch`
- MCP tool schemas, registry entries, contracts, examples, docs, and service delegation
- Operation-plan service wrappers that generate existing low-level operations and keep all writes behind plan review
- Existing-album target resolution by `albumId` or exact `albumName`, with duplicate names returning a recoverable clarification error

Do not implement:

- High-level space workflow tools. That is Slice 8.
- Asset batch workflow tools. That is Slice 9.
- UI clarification rendering. That is Slice 10.
- Prompt overhaul. That is Slice 11.

## Files

- Modify: `server/src/enum.ts`
  - Add `AgentToolName.ProposeAlbumFromSearch` and `AgentToolName.ProposeAddAssetsToAlbumFromSearch`.
- Modify: `server/src/dtos/agent-operation.dto.ts`
  - Add request schemas and DTO classes for both new high-level album workflow tools.
  - Add both tools to `AgentOperationPlanToolRequestSchemas`.
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
  - Add TDD schema coverage for valid/invalid workflow arguments and MCP planning schemas.
- Modify: `server/src/services/agent-operation-plan.service.ts`
  - Inject `AlbumRepository`.
  - Add wrapper methods and album-name resolution.
  - Refactor existing `proposeAlbumOperations` body into a private helper that accepts `toolName`.
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
  - Add TDD service coverage for wrapper operation construction, no auto-apply behavior, name resolution, duplicate-name clarification, and validation propagation.
- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`
  - Update manual service construction for the new `AlbumRepository` dependency.
- Modify: `server/src/services/agent-mcp.service.ts`
  - Add both tools to the planning tool set and delegate calls to the operation plan service.
- Modify: `server/src/services/agent-mcp.service.spec.ts`
  - Add MCP delegation tests for both tools.
- Modify: `server/src/types/agent-mcp-contract.types.ts`
  - Include both workflow tools in `AgentMcpPlanningToolName`.
- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
  - Publish both tools in `tools/list`.
  - Add model-facing property descriptions for `assetSource`, `albumName`, `albumId`, and `description` if missing.
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  - Add tool-list/schema/example coverage for both tools.
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
  - Add planning contracts and examples marking these as the preferred album-from-search tools.
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Add executable example and common-mistake coverage.
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
  - Add generated-doc coverage for preferred album workflow examples.
- Modify generated docs: `docs/superpowers/generated/pi-agent-mcp-tools.md`
  - Regenerate with `pnpm --dir server exec tsx src/bin/sync-agent-mcp-docs.ts`.

## Design Decisions

- `proposeAlbumFromSearch` creates exactly two operations: `album.create` and `album.addAssets`, connected by a stable temporary target id.
- `proposeAddAssetsToAlbumFromSearch` creates exactly one `album.addAssets` operation for an existing album.
- Both tools accept `assetSource` with `kind: "search"` or `kind: "previousSearch"`, reusing Slice 6 source materialization. They do not accept raw `assetIds` or `assetSelectionHandleId`.
- `proposeAddAssetsToAlbumFromSearch` accepts exactly one album target mechanism:
  - `albumId` when Pi already has the id from `listAlbums` or `readAlbum`;
  - `albumName` when Pi only has the user-facing name.
- Album-name resolution is exact after trimming and case-insensitive. No fuzzy guessing in this slice.
- If `albumName` matches zero visible albums, return a recoverable error telling Pi to call `listAlbums` or ask whether to create a new album.
- If `albumName` matches more than one visible album, return a recoverable clarification error with compact choices. Do not choose one.
- Tool calls must be audited under their own tool names, not as `proposeAlbumOperations`, so MCP activity and logs tell the user which high-level workflow ran.

## Task 1: DTO Schemas And Tool Names

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`

- [ ] **Step 1: Write failing DTO tests for the new schemas**

Add to `server/src/dtos/agent-operation.dto.spec.ts` near `describe('MCP planning tool request schemas', ...)`:

```ts
it('accepts proposeAlbumFromSearch with a declarative search source', () => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSearch].safeParse({
    summary: 'Create South Africa album.',
    albumName: 'South Africa with Pierre & Aurelia',
    description: 'Photos from the January 2026 South Africa trip.',
    assetSource: {
      kind: 'search',
      filters: {
        country: 'South Africa',
        takenAfter: '2026-01-01T00:00:00.000Z',
        takenBefore: '2026-02-01T00:00:00.000Z',
        people: { match: 'any', names: ['Pierre', 'Aurelia'] },
      },
      materialization: 'all-matches-with-limit',
    },
  });

  expect(result.success).toBe(true);
});

it('accepts proposeAddAssetsToAlbumFromSearch with exactly one existing album target', () => {
  const byId = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToAlbumFromSearch].safeParse({
    summary: 'Add January photos.',
    albumId: factory.uuid(),
    assetSource: { kind: 'search', filters: { country: 'South Africa' } },
  });
  const byName = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToAlbumFromSearch].safeParse({
    summary: 'Add January photos.',
    albumName: 'South Africa',
    assetSource: { kind: 'search', filters: { country: 'South Africa' } },
  });

  expect(byId.success).toBe(true);
  expect(byName.success).toBe(true);
});

it.each([
  ['missing target', {}],
  ['both targets', { albumId: factory.uuid(), albumName: 'South Africa' }],
])('rejects proposeAddAssetsToAlbumFromSearch with %s', (_label, target) => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToAlbumFromSearch].safeParse({
    summary: 'Add photos.',
    ...target,
    assetSource: { kind: 'search', filters: { country: 'South Africa' } },
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual([
    expect.objectContaining({ message: 'Provide exactly one of albumId or albumName' }),
  ]);
});

it('rejects workflow asset sources that require raw ids or handles', () => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSearch].safeParse({
    summary: 'Create album.',
    albumName: 'Manual ids',
    assetSource: { kind: 'explicitAssets', assetIds: [factory.uuid()] },
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual([expect.objectContaining({ path: ['assetSource', 'kind'] })]);
});

it('keeps album workflow text validation aligned with album.create planning constraints', () => {
  const emptyName = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSearch].safeParse({
    albumName: '',
    assetSource: { kind: 'search', filters: {} },
  });
  const longDescription = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSearch].safeParse({
    albumName: 'South Africa',
    description: 'x'.repeat(1001),
    assetSource: { kind: 'search', filters: {} },
  });

  expect(emptyName.success).toBe(false);
  expect(longDescription.success).toBe(false);
});
```

- [ ] **Step 2: Run DTO tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts -t "proposeAlbumFromSearch|proposeAddAssetsToAlbumFromSearch|workflow asset sources"
```

Expected: FAIL at compile/runtime because the new `AgentToolName` values and schemas do not exist.

- [ ] **Step 3: Add enum values**

In `server/src/enum.ts`, add:

```ts
ProposeAlbumFromSearch = 'proposeAlbumFromSearch',
ProposeAddAssetsToAlbumFromSearch = 'proposeAddAssetsToAlbumFromSearch',
```

Place them after `ProposeAlbumOperations` so the planning tool group remains readable.

- [ ] **Step 4: Add DTO schemas**

In `server/src/dtos/agent-operation.dto.ts`, add:

```ts
const albumName = z.string().trim().min(1).max(200);
const albumDescription = z.string().trim().max(1000).optional().default('');

const AgentAlbumWorkflowAssetSourceInputSchema = agentOperationPlanningAssetSourceInput.meta({
  id: 'AgentAlbumWorkflowAssetSourceInput',
});

const AgentProposeAlbumFromSearchToolRequestSchema = z
  .strictObject({
    summary: summary.optional(),
    albumName,
    description: albumDescription,
    assetSource: AgentAlbumWorkflowAssetSourceInputSchema,
  })
  .meta({ id: 'AgentProposeAlbumFromSearchToolRequestDto' });

const AgentProposeAddAssetsToAlbumFromSearchToolRequestSchema = z
  .strictObject({
    summary: summary.optional(),
    albumId: uuid.optional(),
    albumName: albumName.optional(),
    assetSource: AgentAlbumWorkflowAssetSourceInputSchema,
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.albumId) === Boolean(value.albumName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of albumId or albumName',
      });
    }
  })
  .meta({ id: 'AgentProposeAddAssetsToAlbumFromSearchToolRequestDto' });
```

Add these schemas to `AgentOperationPlanToolRequestSchemas`:

```ts
[AgentToolName.ProposeAlbumFromSearch]: AgentProposeAlbumFromSearchToolRequestSchema,
[AgentToolName.ProposeAddAssetsToAlbumFromSearch]: AgentProposeAddAssetsToAlbumFromSearchToolRequestSchema,
```

Export DTO classes:

```ts
export class AgentProposeAlbumFromSearchToolRequestDto extends createZodDto(
  AgentProposeAlbumFromSearchToolRequestSchema,
) {}

export class AgentProposeAddAssetsToAlbumFromSearchToolRequestDto extends createZodDto(
  AgentProposeAddAssetsToAlbumFromSearchToolRequestSchema,
) {}
```

- [ ] **Step 5: Run DTO tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts -t "proposeAlbumFromSearch|proposeAddAssetsToAlbumFromSearch|workflow asset sources"
```

Expected: PASS.

## Task 2: Operation Plan Service Wrappers

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`

- [ ] **Step 1: Write failing service tests for the new-album wrapper**

In `server/src/services/agent-operation-plan.service.spec.ts`, import `AlbumRepository` and add an `albumRepository` automock to the setup. Then add:

```ts
it('proposeAlbumFromSearch creates a reviewable create-album plus add-assets plan from a search source', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const assetIds = [newUuid(), newUuid()];
  sessionRepository.getById.mockResolvedValue(session);
  assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
    status: 'success',
    filters: { country: 'South Africa' },
    results: [],
  });
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })),
    hasNextPage: false,
  } as never);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  const createdPlan = makePlan({
    sessionId: session.id,
    operations: [
      makeOperation({
        type: AgentOperationType.AlbumCreate,
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'tmp-album-from-search',
        payload: { albumName: 'South Africa', description: 'January trip.' },
      }),
      makeOperation({
        type: AgentOperationType.AlbumAddAssets,
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'tmp-album-from-search',
        assetIds,
        payload: {},
      }),
    ],
  });
  planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

  await sut.proposeAlbumFromSearch(auth, session.id, {
    summary: 'Create South Africa album.',
    albumName: 'South Africa',
    description: 'January trip.',
    assetSource: {
      kind: 'search',
      filters: { country: 'South Africa' },
      materialization: 'all-matches-with-limit',
    },
  });

  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      plan: expect.objectContaining({ summary: 'Create South Africa album.' }),
      operations: [
        expect.objectContaining({
          type: AgentOperationType.AlbumCreate,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-album-from-search',
          payload: { albumName: 'South Africa', description: 'January trip.' },
        }),
        expect.objectContaining({
          type: AgentOperationType.AlbumAddAssets,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-album-from-search',
          assetIds,
          assetSource: undefined,
          assetSelectionHandleId: undefined,
        }),
      ],
    }),
  );
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({ toolName: AgentToolName.ProposeAlbumFromSearch }),
  );
  expect(albumService.create).not.toHaveBeenCalled();
  expect(albumService.addAssets).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing service tests for existing-album wrapper**

Add:

```ts
it('proposeAddAssetsToAlbumFromSearch creates only an add-assets operation for a target album id', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const albumId = newUuid();
  const assetIds = [newUuid()];
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
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  planRepository.createReplacementRevision.mockResolvedValue(
    makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.AlbumAddAssets,
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          temporaryTargetId: null,
          assetIds,
          payload: {},
        }),
      ],
    }),
  );

  await sut.proposeAddAssetsToAlbumFromSearch(auth, session.id, {
    summary: 'Add matching photos.',
    albumId,
    assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
  });

  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      operations: [
        expect.objectContaining({
          type: AgentOperationType.AlbumAddAssets,
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          temporaryTargetId: undefined,
          assetIds,
        }),
      ],
    }),
  );
  expect(planRepository.createReplacementRevision.mock.calls[0]?.[1].operations).toHaveLength(1);
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({ toolName: AgentToolName.ProposeAddAssetsToAlbumFromSearch }),
  );
});
```

- [ ] **Step 3: Write failing album-name resolution tests**

Add:

```ts
it('proposeAddAssetsToAlbumFromSearch resolves a unique visible album name before planning', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const albumId = newUuid();
  const assetIds = [newUuid()];
  sessionRepository.getById.mockResolvedValue(session);
  albumRepository.getAgentAlbums.mockResolvedValue([
    { id: albumId, albumName: 'South Africa', ownerId: auth.user.id },
  ] as never);
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
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  planRepository.createReplacementRevision.mockResolvedValue(makePlan({ sessionId: session.id, operations: [] }));

  await sut.proposeAddAssetsToAlbumFromSearch(auth, session.id, {
    albumName: ' south africa ',
    assetSource: { kind: 'search', filters: {} },
  });

  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      operations: [expect.objectContaining({ targetId: albumId })],
    }),
  );
});

it('proposeAddAssetsToAlbumFromSearch returns clarification choices for duplicate visible album names', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const firstAlbumId = newUuid();
  const secondAlbumId = newUuid();
  sessionRepository.getById.mockResolvedValue(session);
  albumRepository.getAgentAlbums.mockResolvedValue([
    { id: firstAlbumId, albumName: 'South Africa', ownerId: auth.user.id, assetCount: 10 },
    { id: secondAlbumId, albumName: 'south africa', ownerId: auth.user.id, assetCount: 4 },
  ] as never);

  await expect(
    sut.proposeAddAssetsToAlbumFromSearch(auth, session.id, {
      albumName: 'South Africa',
      assetSource: { kind: 'search', filters: {} },
    }),
  ).rejects.toMatchObject({
    content: expect.objectContaining({
      status: 'error',
      retryable: true,
      recovery: expect.objectContaining({
        kind: 'album_target_needs_clarification',
        choices: expect.arrayContaining([
          expect.objectContaining({ albumId: firstAlbumId, albumName: 'South Africa' }),
          expect.objectContaining({ albumId: secondAlbumId, albumName: 'south africa' }),
        ]),
      }),
    }),
  });

  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});

it('proposeAddAssetsToAlbumFromSearch returns recoverable guidance when an album name has no visible match', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  sessionRepository.getById.mockResolvedValue(session);
  albumRepository.getAgentAlbums.mockResolvedValue([]);

  await expect(
    sut.proposeAddAssetsToAlbumFromSearch(auth, session.id, {
      albumName: 'South Africa',
      assetSource: { kind: 'search', filters: {} },
    }),
  ).rejects.toMatchObject({
    content: expect.objectContaining({
      status: 'error',
      retryable: true,
      hint: expect.stringContaining('listAlbums'),
      recovery: expect.objectContaining({
        kind: 'album_target_needs_clarification',
        albumName: 'South Africa',
        choices: [],
      }),
    }),
  });

  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run service tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "proposeAlbumFromSearch|proposeAddAssetsToAlbumFromSearch"
```

Expected: FAIL because methods and dependency wiring do not exist.

- [ ] **Step 5: Add service implementation**

In `server/src/services/agent-operation-plan.service.ts`:

1. Import and inject `AlbumRepository`.
2. Import the two DTO types from `src/dtos/agent-operation.dto`.
3. Extract existing proposal logic:

```ts
async proposeAlbumOperations(
  auth: AuthDto,
  sessionId: string,
  dto: AgentProposeAlbumOperationsDto,
): Promise<AgentOperationPlanToolResponseDto> {
  return this.proposeOperations(auth, sessionId, AgentToolName.ProposeAlbumOperations, dto);
}

private async proposeOperations(
  auth: AuthDto,
  sessionId: string,
  toolName: AgentToolName,
  dto: AgentProposeAlbumOperationsDto,
): Promise<AgentOperationPlanToolResponseDto> {
  const session = await this.getOwnedSession(auth, sessionId, { requireActive: true });
  return this.proposeOperationsForSession(auth, session, toolName, dto);
}

private async proposeOperationsForSession(
  auth: AuthDto,
  session: AgentSession,
  toolName: AgentToolName,
  dto: AgentProposeAlbumOperationsDto,
): Promise<AgentOperationPlanToolResponseDto> {
  let prepared: { operations: AgentAlbumOperationInput[]; selectionAudit: PlanningSelectionAudit };
  try {
    prepared = await this.prepareOperations(auth, session, toolName, dto.operations);
  } catch (error) {
    await this.tryCreatePlanningPreparationDeniedAudit(session, toolName, dto, error);
    throw error;
  }

  const { operations, selectionAudit } = prepared;

  return this.runPlanningTool(auth, session, toolName, { ...dto, operations, selectionHandles: selectionAudit }, async () => {
    await this.validateNormalAccess(auth, session, operations);
    const plan = await this.planRepository.createReplacementRevision(session.id, {
      plan: {
        sessionId: session.id,
        status: AgentOperationPlanStatus.Proposed,
        summary: dto.summary,
      },
      operations,
    });
    if (!plan) {
      throw new BadRequestException('Agent session is not accepting plan revisions');
    }

    await this.markWaitingForPlanReview(auth, session, plan);
    return { plan, summary: this.summarize(plan) };
  });
}
```

4. Add wrappers:

```ts
async proposeAlbumFromSearch(
  auth: AuthDto,
  sessionId: string,
  dto: AgentProposeAlbumFromSearchToolRequestDto,
): Promise<AgentOperationPlanToolResponseDto> {
  const temporaryTargetId = 'tmp-album-from-search';
  const summary = dto.summary ?? `Create album "${dto.albumName}" from matching photos.`;

  return this.proposeOperations(auth, sessionId, AgentToolName.ProposeAlbumFromSearch, {
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
        summary: `Add matching photos to "${dto.albumName}"`,
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId,
        assetSource: dto.assetSource,
        payload: {},
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
      },
    ],
  });
}

async proposeAddAssetsToAlbumFromSearch(
  auth: AuthDto,
  sessionId: string,
  dto: AgentProposeAddAssetsToAlbumFromSearchToolRequestDto,
): Promise<AgentOperationPlanToolResponseDto> {
  const session = await this.getOwnedSession(auth, sessionId, { requireActive: true });
  const albumTarget = await this.resolveWorkflowAlbumTarget(auth, session, dto);
  const summary = dto.summary ?? `Add matching photos to "${albumTarget.albumName}".`;

  return this.proposeOperationsForSession(auth, session, AgentToolName.ProposeAddAssetsToAlbumFromSearch, {
    summary,
    operations: [
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: `Add matching photos to "${albumTarget.albumName}"`,
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: albumTarget.albumId,
        assetSource: dto.assetSource,
        payload: {},
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
      },
    ],
  });
}
```

To avoid double-loading the session in `proposeAddAssetsToAlbumFromSearch`, make `proposeOperations()` delegate to a second helper:

```ts
private async proposeOperationsForSession(
  auth: AuthDto,
  session: AgentSession,
  toolName: AgentToolName,
  dto: AgentProposeAlbumOperationsDto,
): Promise<AgentOperationPlanToolResponseDto> {
  // Existing prepare/runPlanningTool body.
}
```

5. Add album-name resolution:

```ts
private async resolveWorkflowAlbumTarget(
  auth: AuthDto,
  session: AgentSession,
  dto: AgentProposeAddAssetsToAlbumFromSearchToolRequestDto,
) {
  if (dto.albumId) {
    return { albumId: dto.albumId, albumName: dto.albumName ?? 'selected album' };
  }

  const requestedName = dto.albumName?.trim() ?? '';
  const visibleAlbums = (await this.albumRepository.getAgentAlbums(auth.user.id)).filter((album) => {
    const isOwned = album.ownerId === auth.user.id;
    return isOwned
      ? session.permissionPlanSnapshot.assetScope.owned
      : session.permissionPlanSnapshot.assetScope.sharedSpaces;
  });
  const matches = visibleAlbums.filter((album) => album.albumName.trim().toLowerCase() === requestedName.toLowerCase());

  if (matches.length === 1) {
    return { albumId: matches[0].id, albumName: matches[0].albumName };
  }

  if (matches.length === 0) {
    throw new AgentMcpRecoverableToolError({
      status: 'error',
      error: `No visible album named "${requestedName}" was found.`,
      toolName: AgentToolName.ProposeAddAssetsToAlbumFromSearch,
      retryable: true,
      hint: 'Call listAlbums to choose an existing albumId, or use proposeAlbumFromSearch to create a new album.',
      recovery: {
        kind: 'album_target_needs_clarification',
        albumName: requestedName,
        choices: [],
        instruction: 'Retry with albumId, or create a new album from the same search source.',
      },
    });
  }

  throw new AgentMcpRecoverableToolError({
    status: 'error',
    error: `Multiple visible albums named "${requestedName}" were found.`,
    toolName: AgentToolName.ProposeAddAssetsToAlbumFromSearch,
    retryable: true,
    hint: 'Ask the user which album to use, then retry with that albumId.',
    recovery: {
      kind: 'album_target_needs_clarification',
      albumName: requestedName,
      choices: matches.slice(0, 5).map((album) => ({
        albumId: album.id,
        albumName: album.albumName,
        assetCount: album.assetCount,
      })),
      instruction: 'Retry proposeAddAssetsToAlbumFromSearch with albumId from the chosen album.',
    },
  });
}
```

- [ ] **Step 6: Update manual constructors**

Update:

- `server/src/services/agent-operation-plan.service.spec.ts`
- `server/src/services/agent-runner-flow.integration.spec.ts`

Add the `albumRepository` argument immediately after `assetSearchFilterResolverService` or in the constructor order chosen in production.

- [ ] **Step 7: Run service tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "proposeAlbumFromSearch|proposeAddAssetsToAlbumFromSearch"
```

Expected: PASS.

## Task 3: MCP Delegation And Tool Registry

**Files:**

- Modify: `server/src/services/agent-mcp.service.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Modify: `server/src/types/agent-mcp-contract.types.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`

- [ ] **Step 1: Write failing MCP service delegation tests**

In `server/src/services/agent-mcp.service.spec.ts`, extend the planning delegation table with:

```ts
{
  toolName: AgentToolName.ProposeAlbumFromSearch,
  args: {
    summary: 'Create South Africa album.',
    albumName: 'South Africa',
    assetSource: { kind: 'search', filters: { country: 'South Africa' } },
  },
  serviceMethod: 'proposeAlbumFromSearch' as const,
  expectedArguments: (authValue: AuthDto, sessionIdValue: string, args: Record<string, unknown>) => [
    authValue,
    sessionIdValue,
    args,
  ],
},
{
  toolName: AgentToolName.ProposeAddAssetsToAlbumFromSearch,
  args: {
    summary: 'Add South Africa photos.',
    albumId: factory.uuid(),
    assetSource: { kind: 'search', filters: { country: 'South Africa' } },
  },
  serviceMethod: 'proposeAddAssetsToAlbumFromSearch' as const,
  expectedArguments: (authValue: AuthDto, sessionIdValue: string, args: Record<string, unknown>) => [
    authValue,
    sessionIdValue,
    args,
  ],
},
```

Also extend the is-error planning delegation table with both new tools.

- [ ] **Step 2: Write failing registry tests**

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, add:

```ts
it('lists the high-level album workflow tools with valid examples', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));

  for (const toolName of [
    AgentToolName.ProposeAlbumFromSearch,
    AgentToolName.ProposeAddAssetsToAlbumFromSearch,
  ] as const) {
    const tool = toolsByName.get(toolName);
    const contract = contractService.getPlanningToolContract(toolName);

    expect(tool?.title).toBe(contract.title);
    expect(tool?.description).toContain('preferred');
    expect(tool?.description).toContain('review');
    expect(tool?.inputSchema).toMatchObject({ type: 'object' });
    expect(tool?.inputSchema.examples).toEqual(contract.examples.map((example) => example.arguments));

    for (const exampleArguments of tool?.inputSchema.examples as Record<string, unknown>[]) {
      const result = AgentOperationPlanToolRequestSchemas[toolName].safeParse(exampleArguments);
      expect(result.success, `${toolName} example should parse`).toBe(true);
    }
  }
});
```

- [ ] **Step 3: Run MCP/registry tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts -t "ProposeAlbumFromSearch|ProposeAddAssetsToAlbumFromSearch|high-level album workflow"
```

Expected: FAIL because the tools are not registered or delegated.

- [ ] **Step 4: Update MCP planning tool plumbing**

In `server/src/types/agent-mcp-contract.types.ts`, extend `AgentMcpPlanningToolName`:

```ts
| AgentToolName.ProposeAlbumFromSearch
| AgentToolName.ProposeAddAssetsToAlbumFromSearch
```

In `server/src/services/agent-mcp.service.ts`:

- Add both names to `planningToolNames`.
- Add switch cases:

```ts
case AgentToolName.ProposeAlbumFromSearch: {
  return this.invokeTool(id, toolName, args, AgentOperationPlanToolRequestSchemas[toolName], (dto) =>
    this.operationPlanService.proposeAlbumFromSearch(auth, sessionId, dto),
  );
}
case AgentToolName.ProposeAddAssetsToAlbumFromSearch: {
  return this.invokeTool(id, toolName, args, AgentOperationPlanToolRequestSchemas[toolName], (dto) =>
    this.operationPlanService.proposeAddAssetsToAlbumFromSearch(auth, sessionId, dto),
  );
}
```

In `server/src/services/agent-mcp-tool-registry.service.ts`, add two planning `defineTool` entries before `proposeAlbumOperations`:

```ts
defineTool({
  name: AgentToolName.ProposeAlbumFromSearch,
  title: 'Propose album from search',
  description: 'Preferred album-from-search workflow that creates a reviewable plan.',
  schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSearch],
  annotations: planningToolAnnotations,
}),
defineTool({
  name: AgentToolName.ProposeAddAssetsToAlbumFromSearch,
  title: 'Propose add assets to album from search',
  description: 'Preferred workflow for adding search matches to an existing album as a reviewable plan.',
  schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToAlbumFromSearch],
  annotations: planningToolAnnotations,
}),
```

Add property descriptions:

```ts
albumName: 'Album name to create or exact visible album name to resolve.',
albumId: 'Existing album id returned by listAlbums/readAlbum.',
assetSource: 'Preferred source object for search-backed planning. Use kind search for declarative filters or previousSearch for a sourceRef returned by searchAssets.',
description: 'Optional album description.',
```

- [ ] **Step 5: Run MCP/registry tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts -t "ProposeAlbumFromSearch|ProposeAddAssetsToAlbumFromSearch|high-level album workflow"
```

Expected: PASS.

## Task 4: MCP Contracts And Generated Docs

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify generated docs: `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Write failing contract tests**

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, add:

```ts
it('defines preferred high-level album workflow contracts and examples', () => {
  const create = sut.getPlanningToolContract(AgentToolName.ProposeAlbumFromSearch);
  const add = sut.getPlanningToolContract(AgentToolName.ProposeAddAssetsToAlbumFromSearch);

  expect(create?.description).toMatch(/preferred/i);
  expect(add?.description).toMatch(/preferred/i);
  expect(create?.examples.map((example) => example.name)).toEqual(
    expect.arrayContaining(['create-album-from-declarative-search', 'create-album-from-previous-search']),
  );
  expect(add?.examples.map((example) => example.name)).toEqual(
    expect.arrayContaining(['add-search-results-to-album-by-id', 'add-search-results-to-album-by-name']),
  );

  for (const contract of [create, add]) {
    expect(contract?.safety).toEqual({
      allowsDirectMutation: false,
      exposesSecrets: false,
      requiresGalleryApplyForWrites: true,
    });
    for (const example of contract?.examples ?? []) {
      const result = AgentOperationPlanToolRequestSchemas[contract!.name].safeParse(example.arguments);
      expect(result.success, `${contract!.name} ${example.name}`).toBe(true);
    }
  }
});
```

- [ ] **Step 2: Write failing docs tests**

In `server/src/services/agent-mcp-docs.service.spec.ts`, add:

```ts
it('documents the high-level album workflow tools as preferred for album-from-search tasks', () => {
  const markdown = sut.generateMarkdown();
  const documentedNames = sut.listDocumentedToolArgumentExamples().map((example) => example.exampleName);

  for (const name of [
    'create-album-from-declarative-search',
    'create-album-from-previous-search',
    'add-search-results-to-album-by-id',
    'add-search-results-to-album-by-name',
  ]) {
    expect(markdown).toContain(name);
    expect(documentedNames).toContain(name);
  }
  expect(markdown).toContain('proposeAlbumFromSearch');
  expect(markdown).toContain('proposeAddAssetsToAlbumFromSearch');
  expect(markdown).toMatch(/preferred/i);
});
```

- [ ] **Step 3: Run contract/docs tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-docs.service.spec.ts -t "high-level album workflow|preferred for album-from-search"
```

Expected: FAIL because contracts and docs examples do not exist.

- [ ] **Step 4: Add contracts**

In `server/src/services/agent-mcp-tool-contract.service.ts`, add examples:

```ts
const proposeAlbumFromSearchExamples: AgentMcpToolExample[] = [
  {
    name: 'create-album-from-declarative-search',
    description: 'Create a new album directly from user-facing search filters.',
    arguments: {
      summary: 'Create South Africa with Pierre & Aurelia album.',
      albumName: 'South Africa with Pierre & Aurelia',
      description: 'January 2026 South Africa photos featuring Pierre or Aurelia.',
      assetSource: {
        kind: 'search',
        filters: {
          country: 'South Africa',
          takenAfter: '2026-01-01T00:00:00.000Z',
          takenBefore: '2026-02-01T00:00:00.000Z',
          people: { match: 'any', names: ['Pierre', 'Aurelia'] },
        },
        materialization: 'all-matches-with-limit',
      },
    },
  },
  {
    name: 'create-album-from-previous-search',
    description: 'Create a new album from a previous search source reference.',
    arguments: {
      summary: 'Create album from the previous search.',
      albumName: 'Recent favorites',
      assetSource: {
        kind: 'previousSearch',
        sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000333',
      },
    },
  },
];

const proposeAddAssetsToAlbumFromSearchExamples: AgentMcpToolExample[] = [
  {
    name: 'add-search-results-to-album-by-id',
    description: 'Add matching photos to an existing album id.',
    arguments: {
      summary: 'Add matching South Africa photos to the trip album.',
      albumId: exampleAlbumId,
      assetSource: {
        kind: 'search',
        filters: { country: 'South Africa' },
        materialization: 'all-matches-with-limit',
      },
    },
  },
  {
    name: 'add-search-results-to-album-by-name',
    description: 'Add matching photos to a uniquely named visible album.',
    arguments: {
      summary: 'Add unalbumed Berlin photos.',
      albumName: 'Berlin',
      assetSource: {
        kind: 'search',
        filters: {
          city: 'Berlin',
          country: 'Germany',
          isNotInAlbum: true,
        },
        materialization: 'all-matches-with-limit',
      },
    },
  },
];
```

Add contracts:

```ts
const proposeAlbumFromSearchContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeAlbumFromSearch,
  title: 'Propose album from search',
  description: 'Preferred tool for creating a new album from a declarative or previous search source.',
  usage:
    'Use this before low-level proposeAlbumOperations when the user asks to create an album from matching photos. Gallery resolves names, materializes the source, and creates a reviewable plan; nothing is applied until the user approves.',
  argumentModes: [
    {
      name: 'new-album-from-search',
      description: 'Create a new album and add matching search results.',
      requiredFields: ['albumName', 'assetSource'],
      forbiddenFields: ['operations', 'assetIds', 'assetSelectionHandleId'],
      whenToUse:
        'Use for requests like create an album from photos matching date, place, people, tags, or a previous search.',
    },
  ],
  examples: proposeAlbumFromSearchExamples,
  commonMistakes: [
    {
      id: 'album-workflow-raw-asset-ids',
      match: { unexpectedField: 'assetIds', requestShape: 'tool-arguments' },
      hint: 'Use assetSource.search or assetSource.previousSearch with this workflow tool; do not paste raw asset ids.',
      exampleName: 'create-album-from-declarative-search',
    },
  ],
  safety,
};

const proposeAddAssetsToAlbumFromSearchContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeAddAssetsToAlbumFromSearch,
  title: 'Propose add assets to album from search',
  description:
    'Preferred tool for adding matching photos to an existing album from a declarative or previous search source.',
  usage:
    'Use this before low-level proposeAlbumOperations when the user asks to add matching photos to an existing album. Provide albumId when known, or a uniquely visible albumName. Gallery creates a reviewable plan only.',
  argumentModes: [
    {
      name: 'existing-album-from-search',
      description: 'Add matching search results to one existing album.',
      requiredFields: ['assetSource'],
      forbiddenFields: ['operations', 'assetIds', 'assetSelectionHandleId'],
      whenToUse: 'Use for requests like add my matching trip photos to this existing album.',
    },
  ],
  examples: proposeAddAssetsToAlbumFromSearchExamples,
  commonMistakes: [
    {
      id: 'album-workflow-missing-target',
      match: { messageIncludes: 'Provide exactly one of albumId or albumName' },
      hint: 'Provide albumId from listAlbums/readAlbum, or provide one exact visible albumName.',
      exampleName: 'add-search-results-to-album-by-id',
    },
  ],
  safety,
};
```

Include both contracts in `planningToolContracts`.

- [ ] **Step 5: Run contract/docs tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-docs.service.spec.ts -t "high-level album workflow|preferred for album-from-search"
```

Expected: PASS.

- [ ] **Step 6: Regenerate docs and verify docs tests**

Run:

```bash
pnpm --dir server exec tsx src/bin/sync-agent-mcp-docs.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts
```

Expected: generated docs file updates and docs tests pass.

## Task 5: Full Verification And Commit

**Files:**

- All modified files from Tasks 1-4.

- [ ] **Step 1: Run focused Slice 7 tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs \
  src/dtos/agent-operation.dto.spec.ts \
  src/services/agent-operation-plan.service.spec.ts \
  src/services/agent-mcp.service.spec.ts \
  src/services/agent-mcp-tool-registry.service.spec.ts \
  src/services/agent-mcp-tool-contract.service.spec.ts \
  src/services/agent-mcp-docs.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run affected integration tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-runner-flow.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run static checks**

Run:

```bash
pnpm --dir server exec tsc --noEmit --pretty false
pnpm --dir server run lint
git diff --check
```

Expected: all PASS.

- [ ] **Step 4: Review gates**

Dispatch two reviewers:

- Spec-compliance reviewer: verify Slice 7 only, TDD coverage, all edge cases, no future Slice 8-12 drift.
- Code-quality reviewer: verify wrapper implementation, MCP plumbing, name resolution, no direct apply path, no broad source handling, no unsafe docs/examples.

Fix every valid finding and rerun the relevant tests before continuing.

- [ ] **Step 5: Commit and push**

Run:

```bash
git add \
  docs/superpowers/plans/2026-05-22-pi-agent-declarative-planning-sources-slice-7.md \
  docs/superpowers/generated/pi-agent-mcp-tools.md \
  server/src/enum.ts \
  server/src/dtos/agent-operation.dto.ts \
  server/src/dtos/agent-operation.dto.spec.ts \
  server/src/services/agent-operation-plan.service.ts \
  server/src/services/agent-operation-plan.service.spec.ts \
  server/src/services/agent-runner-flow.integration.spec.ts \
  server/src/services/agent-mcp.service.ts \
  server/src/services/agent-mcp.service.spec.ts \
  server/src/types/agent-mcp-contract.types.ts \
  server/src/services/agent-mcp-tool-registry.service.ts \
  server/src/services/agent-mcp-tool-registry.service.spec.ts \
  server/src/services/agent-mcp-tool-contract.service.ts \
  server/src/services/agent-mcp-tool-contract.service.spec.ts \
  server/src/services/agent-mcp-docs.service.spec.ts
git commit -m "feat(server): add Pi album search workflow tools"
git push
```

Expected: branch `explore/pi-agent-brainstorm` is pushed.

## Edge Case Checklist

- New album workflow creates exactly two operations with matching `temporaryTargetId`.
- Existing album workflow creates exactly one `album.addAssets` operation.
- Existing album workflow with `albumId` does not call `AlbumRepository.getAgentAlbums`.
- Existing album workflow with unique `albumName` resolves exact case-insensitive visible albums only.
- Duplicate visible album names return recoverable clarification choices and do not run search or create a plan.
- Missing visible album name returns recoverable guidance and does not create a plan.
- Album name and description limits match existing `album.create` constraints.
- `assetSource.selectionHandle` and `assetSource.explicitAssets` are rejected for workflow tools.
- Search source failures from Slice 6 propagate without creating a plan.
- Tool calls are audited as the high-level tool names.
- No album or asset mutations happen before plan approval.
- MCP `tools/list` exposes both tools with examples and review-focused descriptions.
- Generated docs show these as preferred album-from-search tools and examples do not encourage raw UUID copying.
