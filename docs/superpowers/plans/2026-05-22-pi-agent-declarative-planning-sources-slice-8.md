# Pi Agent High-Level Space Workflow Tools Slice 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class MCP tools for creating a space from a declarative search and adding search results to an existing shared space, without making Pi assemble low-level operation arrays.

**Architecture:** Add `proposeSpaceFromSearch` and `proposeAddAssetsToSpaceFromSearch` as thin wrappers over the existing source-aware operation planning service. The wrappers construct normal `space.create` and `space.addAssets` operations with `assetSource.search` or `assetSource.previousSearch`, then reuse the same validation, materialization, permission, audit, and plan-review path as low-level planning.

**Tech Stack:** NestJS services, Zod DTOs, MCP tool registry/contracts/docs, Vitest, TypeScript, `pnpm --dir server`.

---

## Scope

This is Slice 8 from `docs/superpowers/specs/2026-05-22-pi-agent-declarative-planning-sources-design.md`.

Implement only high-level shared-space workflow tools:

- `proposeSpaceFromSearch`
- `proposeAddAssetsToSpaceFromSearch`
- MCP tool schemas, registry entries, contracts, examples, generated docs, runner prompt, and service delegation
- Operation-plan service wrappers that generate existing `space.create` and `space.addAssets` operations and keep all writes behind plan review
- Existing-space target resolution by `spaceId` or exact `spaceName`, with duplicate names returning a recoverable clarification error

Do not implement:

- High-level asset batch workflow tools. That is Slice 9.
- UI clarification rendering. That is Slice 10.
- General prompt overhaul beyond adding these tools to existing generated examples. That is Slice 11.
- Activity UI polish. That is Slice 12.

## Files

- Modify: `server/src/enum.ts`
  - Add `AgentToolName.ProposeSpaceFromSearch` and `AgentToolName.ProposeAddAssetsToSpaceFromSearch`.
- Modify: `server/src/dtos/agent-operation.dto.ts`
  - Add request schemas and DTO classes for both new high-level space workflow tools.
  - Add both tools to `AgentOperationPlanToolRequestSchemas`.
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
  - Add schema coverage for valid/invalid workflow arguments and MCP planning schema membership.
- Modify: `server/src/services/agent-operation-plan.service.ts`
  - Add wrapper methods for the two space workflow tools.
  - Add exact visible space-name resolution using `SharedSpaceRepository.getAllByUserId(auth.user.id)`.
  - Audit no-match and duplicate-name clarification failures under `proposeAddAssetsToSpaceFromSearch`.
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
  - Add service tests for operation construction, target semantics, write-scope enforcement, membership consistency, and clarification audit behavior.
- Modify: `server/src/services/agent-mcp.service.ts`
  - Add both tools to the planning tool set and delegate calls to the operation plan service.
- Modify: `server/src/services/agent-mcp.service.spec.ts`
  - Add MCP delegation tests for both tools.
- Modify: `server/src/types/agent-mcp-contract.types.ts`
  - Include both workflow tools in `AgentMcpPlanningToolName`.
- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
  - Publish both tools in `tools/list`.
  - Add model-facing property descriptions for `spaceName`, `spaceId`, `assetSource`, `description`, and `color` if missing.
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  - Add tool-list/schema/example coverage for both tools.
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
  - Add planning contracts and examples marking these as the preferred space-from-search tools.
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Add executable example and common-mistake coverage.
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
  - Add generated-doc coverage for preferred space workflow examples.
- Modify: `server/src/controllers/agent-runner-mcp.controller.spec.ts`
  - Update real MCP `tools/list` expectations.
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
  - Mention space-from-search tools in the compact runner prompt without increasing the prompt over the existing `<= 3800` budget.
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
  - Assert prompt includes the new Pi-visible tool names and remains within budget.
- Modify generated docs: `docs/superpowers/generated/pi-agent-mcp-tools.md`
  - Regenerate with `pnpm --dir server exec tsx src/bin/sync-agent-mcp-docs.ts`.
- Modify generated prompt: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - Regenerate with `pnpm --dir server exec tsx src/bin/sync-agent-mcp-prompt.ts`.

## Design Decisions

- `proposeSpaceFromSearch` creates exactly two operations: `space.create` and `space.addAssets`, connected by `temporaryTargetId: "tmp-space-from-search"`.
- `proposeAddAssetsToSpaceFromSearch` creates exactly one `space.addAssets` operation for an existing space. It must use `targetId`, not `temporaryTargetId`.
- Both tools accept `assetSource` with `kind: "search"` or `kind: "previousSearch"` only. They do not accept raw `assetIds` or `assetSelectionHandleId`.
- `proposeAddAssetsToSpaceFromSearch` accepts exactly one target mechanism: `spaceId` or `spaceName`.
- `spaceName` resolution is exact after trimming and case-insensitive, using only visible spaces returned by `SharedSpaceRepository.getAllByUserId(auth.user.id)`. No fuzzy guessing.
- If `spaceName` matches zero visible spaces, return a recoverable clarification error telling Pi to call `listSpaces` or use `proposeSpaceFromSearch` to create a new space.
- If `spaceName` matches multiple visible spaces, return a recoverable clarification error with compact choices. Do not guess.
- Existing write-scope and shared-space permission checks remain centralized in `validateWriteScope`, `validateNormalAccess`, and `validateApplyAccess`.
- Existing membership semantics remain unchanged: planning may propose add operations, and apply uses `SharedSpaceService.addAssets`, which inserts only new rows via repository semantics. This slice should not add pre-dedupe logic that diverges from low-level `space.addAssets` behavior.
- Tool calls must be audited under their own tool names, including recoverable target clarification failures.

## TDD Requirements

Use TDD for every implementation step:

1. Write or update the failing test first.
2. Run the exact focused command and verify the failure is for the missing Slice 8 behavior, not a typo or fixture bug.
3. Implement the smallest code change that makes that test pass.
4. Re-run the focused test and verify green.
5. Only then continue to the next behavior.

Do not add production code before a failing test. Generated docs and generated runner prompt may be regenerated after source tests are green, but stale-artifact tests must fail before regeneration.

## Edge Cases Required By This Slice

Every edge case below must be covered by automated tests in this slice:

- New space plus search source creates a proposed `space.create` and dependent `space.addAssets` plan; nothing is applied automatically.
- Existing space plus search source creates only `space.addAssets`, uses `targetId`, and does not set `temporaryTargetId`.
- `assetSource.search` and `assetSource.previousSearch` both parse for the new tools; raw IDs and selection handles are rejected at DTO level.
- `assetSource.previousSearch` is covered for both wrapper tools at service level and materializes through the backing selection handle without rerunning search.
- `proposeAddAssetsToSpaceFromSearch` rejects missing target and both-target requests.
- `spaceName`, `description`, and `color` validation matches current `space.create` planning constraints: trimmed non-empty space name <= 100, description <= 500, color from `UserAvatarColor`.
- Write-scope enforcement denies `proposeSpaceFromSearch` when `createSpace` or `addAssetsToSpaces` is false.
- Write-scope enforcement denies `proposeAddAssetsToSpaceFromSearch` when `addAssetsToSpaces` is false, before `spaceName` lookup or search materialization, and still creates a denied audit row under `proposeAddAssetsToSpaceFromSearch`.
- Existing-space role enforcement is unchanged: existing `space.addAssets` target requires editor access through `accessRepository.sharedSpace.checkRoleAccess`.
- `spaceName` resolution requires `assetScope.sharedSpaces`; if shared spaces are not readable, deny before `SharedSpaceRepository.getAllByUserId`, search materialization, or plan persistence and audit the denied tool call.
- Name resolution ignores spaces not visible to the user because it only uses `getAllByUserId`.
- Duplicate visible space names return clarification choices and create a denied audit row under `proposeAddAssetsToSpaceFromSearch` without searching or persisting a plan.
- Zero matching visible space names return recoverable guidance and create a denied audit row under `proposeAddAssetsToSpaceFromSearch` without searching or persisting a plan.
- Generated MCP docs show these as preferred tools for space-from-search tasks.
- Real MCP controller `tools/list` and runner prompt include the new tools and remain stable.

## Task 1: DTO Schemas And Tool Names

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`

- [ ] **Step 1: Write failing DTO tests for the new space schemas**

Add to `server/src/dtos/agent-operation.dto.spec.ts` near the existing high-level album workflow schema tests:

```ts
it('accepts proposeSpaceFromSearch with a declarative search source', () => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
    summary: 'Create family trip space.',
    spaceName: 'Family South Africa',
    description: 'Shared January 2026 South Africa photos.',
    color: UserAvatarColor.Blue,
    assetSource: {
      kind: 'search',
      filters: {
        country: 'South Africa',
        takenAfter: '2026-01-01T00:00:00.000Z',
        takenBefore: '2026-02-01T00:00:00.000Z',
      },
      materialization: 'all-matches-with-limit',
    },
  });

  expect(result.success).toBe(true);
});

it('accepts proposeSpaceFromSearch with a previous search source', () => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
    spaceName: 'Previous search space',
    assetSource: {
      kind: 'previousSearch',
      sourceRef: `asset-source:search:${factory.uuid()}`,
    },
  });

  expect(result.success).toBe(true);
});

it('accepts proposeAddAssetsToSpaceFromSearch with exactly one existing space target', () => {
  const byId = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToSpaceFromSearch].safeParse({
    summary: 'Add January photos.',
    spaceId: factory.uuid(),
    assetSource: { kind: 'search', filters: { country: 'South Africa' } },
  });
  const byName = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToSpaceFromSearch].safeParse({
    summary: 'Add January photos.',
    spaceName: 'Family South Africa',
    assetSource: { kind: 'search', filters: { country: 'South Africa' } },
  });

  expect(byId.success).toBe(true);
  expect(byName.success).toBe(true);
});

it('accepts proposeAddAssetsToSpaceFromSearch with a previous search source', () => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToSpaceFromSearch].safeParse({
    spaceId: factory.uuid(),
    assetSource: {
      kind: 'previousSearch',
      sourceRef: `asset-source:search:${factory.uuid()}`,
    },
  });

  expect(result.success).toBe(true);
});

it.each([
  ['missing target', {}],
  ['both targets', { spaceId: factory.uuid(), spaceName: 'Family South Africa' }],
])('rejects proposeAddAssetsToSpaceFromSearch with %s', (_label, target) => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToSpaceFromSearch].safeParse({
    summary: 'Add photos.',
    ...target,
    assetSource: { kind: 'search', filters: { country: 'South Africa' } },
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual([
    expect.objectContaining({ message: 'Provide exactly one of spaceId or spaceName' }),
  ]);
});

it('rejects space workflow asset sources that require raw ids or handles', () => {
  const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
    summary: 'Create space.',
    spaceName: 'Manual ids',
    assetSource: { kind: 'explicitAssets', assetIds: [factory.uuid()] },
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual([expect.objectContaining({ path: ['assetSource', 'kind'] })]);
});

it('keeps space workflow text validation aligned with space.create planning constraints', () => {
  const emptyName = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
    spaceName: '',
    assetSource: { kind: 'search', filters: {} },
  });
  const longName = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
    spaceName: 'x'.repeat(101),
    assetSource: { kind: 'search', filters: {} },
  });
  const longDescription = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
    spaceName: 'Family',
    description: 'x'.repeat(501),
    assetSource: { kind: 'search', filters: {} },
  });
  const invalidColor = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
    spaceName: 'Family',
    color: 'teal',
    assetSource: { kind: 'search', filters: {} },
  });

  expect(emptyName.success).toBe(false);
  expect(longName.success).toBe(false);
  expect(longDescription.success).toBe(false);
  expect(invalidColor.success).toBe(false);
});
```

If `UserAvatarColor` is not imported in `server/src/dtos/agent-operation.dto.spec.ts`, add it to the existing enum import.

- [ ] **Step 2: Run DTO tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts -t "proposeSpaceFromSearch|proposeAddAssetsToSpaceFromSearch|space workflow"
```

Expected: FAIL because `AgentToolName.ProposeSpaceFromSearch`, `AgentToolName.ProposeAddAssetsToSpaceFromSearch`, and the schemas do not exist.

- [ ] **Step 3: Add enum values**

In `server/src/enum.ts`, add after the high-level album workflow names:

```ts
ProposeSpaceFromSearch = 'proposeSpaceFromSearch',
ProposeAddAssetsToSpaceFromSearch = 'proposeAddAssetsToSpaceFromSearch',
```

- [ ] **Step 4: Add DTO schemas**

In `server/src/dtos/agent-operation.dto.ts`, reuse the existing workflow asset source pattern from Slice 7 and add:

```ts
const spaceName = z.string().trim().min(1).max(100);
const spaceDescription = z.string().max(500).optional();

const AgentProposeSpaceFromSearchToolRequestSchema = z
  .strictObject({
    summary: summary.optional(),
    spaceName,
    description: spaceDescription,
    color: UserAvatarColorSchema.optional(),
    assetSource: AgentAlbumWorkflowAssetSourceInputSchema,
  })
  .meta({ id: 'AgentProposeSpaceFromSearchToolRequestDto' });

const AgentProposeAddAssetsToSpaceFromSearchToolRequestSchema = z
  .strictObject({
    summary: summary.optional(),
    spaceId: uuid.optional(),
    spaceName: spaceName.optional(),
    assetSource: AgentAlbumWorkflowAssetSourceInputSchema,
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.spaceId) === Boolean(value.spaceName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of spaceId or spaceName',
      });
    }
  })
  .meta({ id: 'AgentProposeAddAssetsToSpaceFromSearchToolRequestDto' });
```

Add both schemas to `AgentOperationPlanToolRequestSchemas`:

```ts
[AgentToolName.ProposeSpaceFromSearch]: AgentProposeSpaceFromSearchToolRequestSchema,
[AgentToolName.ProposeAddAssetsToSpaceFromSearch]: AgentProposeAddAssetsToSpaceFromSearchToolRequestSchema,
```

Export DTO classes:

```ts
export class AgentProposeSpaceFromSearchToolRequestDto extends createZodDto(
  AgentProposeSpaceFromSearchToolRequestSchema,
) {}
export class AgentProposeAddAssetsToSpaceFromSearchToolRequestDto extends createZodDto(
  AgentProposeAddAssetsToSpaceFromSearchToolRequestSchema,
) {}
```

- [ ] **Step 5: Run DTO tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts -t "proposeSpaceFromSearch|proposeAddAssetsToSpaceFromSearch|space workflow"
```

Expected: PASS.

## Task 2: Operation Plan Service Space Workflow Wrappers

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Write failing service tests for new-space and existing-space planning**

Add near the Slice 7 high-level album workflow tests in `server/src/services/agent-operation-plan.service.spec.ts`:

```ts
it('proposeSpaceFromSearch creates a reviewable create-space plus add-assets plan from a search source', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
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
        type: AgentOperationType.SpaceCreate,
        targetKind: AgentOperationTargetKind.NewSpace,
        temporaryTargetId: 'tmp-space-from-search',
        payload: { spaceName: 'Family South Africa', description: 'January trip.', color: UserAvatarColor.Blue },
      }),
      makeOperation({
        type: AgentOperationType.SpaceAddAssets,
        targetKind: AgentOperationTargetKind.NewSpace,
        temporaryTargetId: 'tmp-space-from-search',
        assetIds,
        payload: {},
      }),
    ],
  });
  planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

  await sut.proposeSpaceFromSearch(auth, session.id, {
    summary: 'Create family space.',
    spaceName: 'Family South Africa',
    description: 'January trip.',
    color: UserAvatarColor.Blue,
    assetSource: {
      kind: 'search',
      filters: { country: 'South Africa' },
      materialization: 'all-matches-with-limit',
    },
  });

  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      plan: expect.objectContaining({ summary: 'Create family space.' }),
      operations: [
        expect.objectContaining({
          type: AgentOperationType.SpaceCreate,
          targetKind: AgentOperationTargetKind.NewSpace,
          temporaryTargetId: 'tmp-space-from-search',
          payload: { spaceName: 'Family South Africa', description: 'January trip.', color: UserAvatarColor.Blue },
        }),
        expect.objectContaining({
          type: AgentOperationType.SpaceAddAssets,
          targetKind: AgentOperationTargetKind.NewSpace,
          temporaryTargetId: 'tmp-space-from-search',
          assetIds,
          assetSource: undefined,
          assetSelectionHandleId: undefined,
        }),
      ],
    }),
  );
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({ toolName: AgentToolName.ProposeSpaceFromSearch }),
  );
  expect(sharedSpaceService.create).not.toHaveBeenCalled();
  expect(sharedSpaceService.addAssets).not.toHaveBeenCalled();
});

it('proposeAddAssetsToSpaceFromSearch creates only an add-assets operation for a target space id', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
  const spaceId = newUuid();
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
  accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  planRepository.createReplacementRevision.mockResolvedValue(
    makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.SpaceAddAssets,
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          temporaryTargetId: null,
          assetIds,
          payload: {},
        }),
      ],
    }),
  );

  await sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
    summary: 'Add matching photos.',
    spaceId,
    assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
  });

  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      operations: [
        expect.objectContaining({
          type: AgentOperationType.SpaceAddAssets,
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          temporaryTargetId: undefined,
          assetIds,
        }),
      ],
    }),
  );
  expect(planRepository.createReplacementRevision.mock.calls[0]?.[1].operations).toHaveLength(1);
  expect(accessRepository.sharedSpace.checkRoleAccess).toHaveBeenCalledWith(
    auth.user.id,
    new Set([spaceId]),
    SharedSpaceRole.Editor,
  );
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({ toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch }),
  );
});

it('proposeSpaceFromSearch materializes a previous search source without rerunning search', async () => {
  // Create a valid same-session selection handle, call proposeSpaceFromSearch with
  // assetSource.kind "previousSearch", then assert getValidForPlanning is called,
  // search repositories are not called, and the stored space.addAssets operation
  // contains the handle assets with assetSource cleared.
});

it('proposeAddAssetsToSpaceFromSearch materializes a previous search source without rerunning search', async () => {
  // Same as above, but for an existing editable spaceId. Assert the wrapper uses
  // targetId, not temporaryTargetId, and audits the previousSearch selection handle.
});
```

- [ ] **Step 2: Run service tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "proposeSpaceFromSearch|proposeAddAssetsToSpaceFromSearch"
```

Expected: FAIL because the service methods do not exist.

- [ ] **Step 3: Add service imports and wrapper methods**

In `server/src/services/agent-operation-plan.service.ts`, import the new DTO classes from `src/dtos/agent-operation.dto`.

Add methods after the Slice 7 album workflow methods:

```ts
async proposeSpaceFromSearch(
  auth: AuthDto,
  sessionId: string,
  dto: AgentProposeSpaceFromSearchToolRequestDto,
): Promise<AgentOperationPlanToolResponseDto> {
  const temporaryTargetId = 'tmp-space-from-search';
  const summary = dto.summary ?? `Create space "${dto.spaceName}" from matching photos.`;
  const payload: Record<string, unknown> = { spaceName: dto.spaceName };
  if (dto.description !== undefined) {
    payload.description = dto.description;
  }
  if (dto.color !== undefined) {
    payload.color = dto.color;
  }

  return this.proposeOperations(auth, sessionId, AgentToolName.ProposeSpaceFromSearch, {
    summary,
    operations: [
      {
        type: AgentOperationType.SpaceCreate,
        summary: `Create space "${dto.spaceName}"`,
        targetKind: AgentOperationTargetKind.NewSpace,
        temporaryTargetId,
        payload,
        riskLevel: AgentOperationRiskLevel.Low,
        enabled: true,
      },
      {
        type: AgentOperationType.SpaceAddAssets,
        summary: `Add matching photos to "${dto.spaceName}"`,
        targetKind: AgentOperationTargetKind.NewSpace,
        temporaryTargetId,
        assetSource: dto.assetSource,
        payload: {},
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
      },
    ],
  });
}

async proposeAddAssetsToSpaceFromSearch(
  auth: AuthDto,
  sessionId: string,
  dto: AgentProposeAddAssetsToSpaceFromSearchToolRequestDto,
): Promise<AgentOperationPlanToolResponseDto> {
  const toolName = AgentToolName.ProposeAddAssetsToSpaceFromSearch;
  const session = await this.getOwnedSession(auth, sessionId, { requireActive: true });
  let spaceTarget: Awaited<ReturnType<typeof this.resolveWorkflowSpaceTarget>>;
  try {
    spaceTarget = await this.resolveWorkflowSpaceTarget(auth, session, dto);
  } catch (error) {
    await this.tryCreatePlanningPreparationDeniedAudit(session, toolName, dto, error);
    throw error;
  }
  const summary = dto.summary ?? `Add matching photos to "${spaceTarget.spaceName}".`;

  return this.proposeOperationsForSession(auth, session, toolName, {
    summary,
    operations: [
      {
        type: AgentOperationType.SpaceAddAssets,
        summary: `Add matching photos to "${spaceTarget.spaceName}"`,
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: spaceTarget.spaceId,
        assetSource: dto.assetSource,
        payload: {},
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
      },
    ],
  });
}
```

- [ ] **Step 4: Add exact visible space-name resolver**

In `server/src/services/agent-operation-plan.service.ts`, add near `resolveWorkflowAlbumTarget`:

```ts
private async resolveWorkflowSpaceTarget(
  auth: AuthDto,
  _session: AgentSession,
  dto: AgentProposeAddAssetsToSpaceFromSearchToolRequestDto,
) {
  if (dto.spaceId) {
    return { spaceId: dto.spaceId, spaceName: dto.spaceName ?? 'selected space' };
  }

  const requestedName = dto.spaceName?.trim() ?? '';
  const spaces = await this.sharedSpaceRepository.getAllByUserId(auth.user.id);
  const matches = spaces.filter((space) => space.name.trim().toLowerCase() === requestedName.toLowerCase());

  if (matches.length === 1) {
    return { spaceId: matches[0].id, spaceName: matches[0].name };
  }

  if (matches.length === 0) {
    throw new AgentMcpRecoverableToolError({
      status: 'error',
      error: `No visible space named "${requestedName}" was found.`,
      toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
      retryable: true,
      hint: 'Call listSpaces to choose an existing spaceId, or use proposeSpaceFromSearch to create a new space.',
      recovery: {
        kind: 'space_target_needs_clarification',
        spaceName: requestedName,
        choices: [],
        instruction: 'Retry with spaceId, or create a new space from the same search source.',
      },
    });
  }

  throw new AgentMcpRecoverableToolError({
    status: 'error',
    error: `Multiple visible spaces named "${requestedName}" were found.`,
    toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
    retryable: true,
    hint: 'Ask the user which space to use, then retry with that spaceId.',
    recovery: {
      kind: 'space_target_needs_clarification',
      spaceName: requestedName,
      choices: matches.slice(0, 5).map((space) => ({
        spaceId: space.id,
        spaceName: space.name,
        description: space.description,
        createdById: space.createdById,
      })),
      instruction: 'Retry proposeAddAssetsToSpaceFromSearch with spaceId from the chosen space.',
    },
  });
}
```

- [ ] **Step 5: Run service tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "proposeSpaceFromSearch|proposeAddAssetsToSpaceFromSearch"
```

Expected: PASS for the new-space and existing-space wrapper tests.

## Task 3: Space Name Clarification, Permission, And Membership Edge Tests

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify if needed: `server/src/services/agent-operation-plan.service.ts`

- [ ] **Step 1: Write failing tests for exact name resolution and clarification audit**

Add after the existing-space id test:

```ts
it('proposeAddAssetsToSpaceFromSearch resolves a unique visible space name before planning', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
  const spaceId = newUuid();
  const assetIds = [newUuid()];
  sessionRepository.getById.mockResolvedValue(session);
  sharedSpaceRepository.getAllByUserId.mockResolvedValue([
    {
      id: spaceId,
      name: 'Family South Africa',
      description: null,
      color: UserAvatarColor.Blue,
      createdById: auth.user.id,
    },
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
  accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  planRepository.createReplacementRevision.mockResolvedValue(makePlan({ sessionId: session.id, operations: [] }));

  await sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
    spaceName: ' family south africa ',
    assetSource: { kind: 'search', filters: {} },
  });

  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      operations: [expect.objectContaining({ targetId: spaceId, temporaryTargetId: undefined })],
    }),
  );
});

it('proposeAddAssetsToSpaceFromSearch returns clarification choices for duplicate visible space names', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
  const firstSpaceId = newUuid();
  const secondSpaceId = newUuid();
  sessionRepository.getById.mockResolvedValue(session);
  sharedSpaceRepository.getAllByUserId.mockResolvedValue([
    { id: firstSpaceId, name: 'Family', description: 'Owned', color: UserAvatarColor.Blue, createdById: auth.user.id },
    { id: secondSpaceId, name: 'family', description: 'Shared', color: UserAvatarColor.Green, createdById: newUuid() },
  ] as never);

  await expect(
    sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
      spaceName: 'Family',
      assetSource: { kind: 'search', filters: {} },
    }),
  ).rejects.toMatchObject({
    content: expect.objectContaining({
      status: 'error',
      retryable: true,
      recovery: expect.objectContaining({
        kind: 'space_target_needs_clarification',
        choices: expect.arrayContaining([
          expect.objectContaining({ spaceId: firstSpaceId, spaceName: 'Family' }),
          expect.objectContaining({ spaceId: secondSpaceId, spaceName: 'family' }),
        ]),
      }),
    }),
  });

  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      error: expect.stringContaining('Multiple visible spaces named'),
    }),
  );
});

it('proposeAddAssetsToSpaceFromSearch returns recoverable guidance when a space name has no visible match', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
  sessionRepository.getById.mockResolvedValue(session);
  sharedSpaceRepository.getAllByUserId.mockResolvedValue([]);

  await expect(
    sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
      spaceName: 'Family',
      assetSource: { kind: 'search', filters: {} },
    }),
  ).rejects.toMatchObject({
    content: expect.objectContaining({
      status: 'error',
      retryable: true,
      hint: expect.stringContaining('listSpaces'),
      recovery: expect.objectContaining({
        kind: 'space_target_needs_clarification',
        spaceName: 'Family',
        choices: [],
      }),
    }),
  });

  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      error: expect.stringContaining('No visible space named'),
    }),
  );
});

it('proposeAddAssetsToSpaceFromSearch denies space-name lookup when shared spaces are not readable', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    permissionPlanSnapshot: {
      ...expandedPermissionPlanSnapshot,
      assetScope: { ...expandedPermissionPlanSnapshot.assetScope, sharedSpaces: false },
    },
  });
  sessionRepository.getById.mockResolvedValue(session);

  await expect(
    sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
      spaceName: 'Family',
      assetSource: { kind: 'search', filters: {} },
    }),
  ).rejects.toThrow('Shared spaces are not accessible for this session');

  expect(sharedSpaceRepository.getAllByUserId).not.toHaveBeenCalled();
  expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      error: 'Shared spaces are not accessible for this session',
    }),
  );
});
```

- [ ] **Step 2: Write failing tests for write-scope and membership consistency**

Add:

```ts
it.each([
  ['createSpace', { createSpace: false }, 'Agent permission policy does not allow creating spaces'],
  ['addAssetsToSpaces', { addAssetsToSpaces: false }, 'Agent permission policy does not allow adding assets to spaces'],
])(
  'proposeSpaceFromSearch enforces %s write scope through existing planning validation',
  async (_field, writeScopeOverride, expectedError) => {
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
      sut.proposeSpaceFromSearch(auth, session.id, {
        spaceName: 'Family',
        assetSource: { kind: 'search', filters: {} },
      }),
    ).rejects.toThrow(expectedError);

    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  },
);

it('proposeAddAssetsToSpaceFromSearch enforces add-assets-to-space scope and editor access', async () => {
  const auth = AuthFactory.create();
  const spaceId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    permissionPlanSnapshot: {
      ...expandedPermissionPlanSnapshot,
      writeScope: { ...expandedPermissionPlanSnapshot.writeScope, addAssetsToSpaces: false },
    },
  });
  sessionRepository.getById.mockResolvedValue(session);

  await expect(
    sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
      spaceId,
      assetSource: { kind: 'search', filters: {} },
    }),
  ).rejects.toThrow('Agent permission policy does not allow adding assets to spaces');

  expect(accessRepository.sharedSpace.checkRoleAccess).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();

  const allowedSession = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
  sessionRepository.getById.mockResolvedValue(allowedSession);
  accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set());
  assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
    status: 'success',
    filters: {},
    results: [],
  });
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
  searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: newUuid() }], hasNextPage: false } as never);
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set());

  await expect(
    sut.proposeAddAssetsToSpaceFromSearch(auth, allowedSession.id, {
      spaceId,
      assetSource: { kind: 'search', filters: {} },
    }),
  ).rejects.toThrow('One or more target spaces are not accessible');

  expect(accessRepository.sharedSpace.checkRoleAccess).toHaveBeenCalledWith(
    auth.user.id,
    new Set([spaceId]),
    SharedSpaceRole.Editor,
  );
});

it('proposeAddAssetsToSpaceFromSearch keeps existing membership semantics by preserving the full materialized asset set', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
  const spaceId = newUuid();
  const existingAssetId = newUuid();
  const newAssetId = newUuid();
  sessionRepository.getById.mockResolvedValue(session);
  assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
    status: 'success',
    filters: {},
    results: [],
  });
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
  searchRepository.searchMetadata.mockResolvedValue({
    items: [existingAssetId, newAssetId].map((id) => ({ id })),
    hasNextPage: false,
  } as never);
  accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([existingAssetId, newAssetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([existingAssetId, newAssetId]));
  planRepository.createReplacementRevision.mockResolvedValue(makePlan({ sessionId: session.id, operations: [] }));

  await sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
    spaceId,
    assetSource: { kind: 'search', filters: {} },
  });

  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      operations: [expect.objectContaining({ assetIds: [existingAssetId, newAssetId] })],
    }),
  );
});
```

- [ ] **Step 3: Run tests and verify expected failures before the service patch**

Run before implementation if not already implemented:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "proposeSpaceFromSearch|proposeAddAssetsToSpaceFromSearch"
```

Expected before implementation: FAIL on missing methods/behavior. After Task 2 implementation, the clarification and permission tests may still fail until resolver and audit details are complete.

- [ ] **Step 4: Patch service logic if tests fail**

If the clarification tests fail because recovery metadata is not audited, make sure `proposeAddAssetsToSpaceFromSearch` mirrors the Slice 7 `tryCreatePlanningPreparationDeniedAudit` pattern.

If the write-scope tests fail because source materialization runs before write-scope validation, check `prepareOperations()` still calls `validateWriteScope()` before `resolveOperationAssetIds()`. Do not move source materialization earlier.

- [ ] **Step 5: Run focused service tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "proposeSpaceFromSearch|proposeAddAssetsToSpaceFromSearch"
```

Expected: PASS.

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

- [ ] **Step 1: Write failing MCP routing tests**

In `server/src/services/agent-mcp.service.spec.ts`, add cases to the existing planning delegation tables:

```ts
{
  toolName: AgentToolName.ProposeSpaceFromSearch,
  args: {
    summary: 'Create family space.',
    spaceName: 'Family South Africa',
    assetSource: { kind: 'search', filters: { country: 'South Africa' } },
  },
  serviceMethod: 'proposeSpaceFromSearch' as const,
  expectedArguments: (authValue: AuthDto, sessionIdValue: string, args: Record<string, unknown>) => [
    authValue,
    sessionIdValue,
    args,
  ],
},
{
  toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
  args: {
    summary: 'Add South Africa photos.',
    spaceId: factory.uuid(),
    assetSource: { kind: 'search', filters: { country: 'South Africa' } },
  },
  serviceMethod: 'proposeAddAssetsToSpaceFromSearch' as const,
  expectedArguments: (authValue: AuthDto, sessionIdValue: string, args: Record<string, unknown>) => [
    authValue,
    sessionIdValue,
    args,
  ],
},
```

Add equivalent cases in any approval/streaming planning tables that currently include Slice 7 tools.

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts -t "ProposeSpaceFromSearch|ProposeAddAssetsToSpaceFromSearch|planning"
```

Expected: FAIL because the tools are not in `planningToolNames` / switch routing.

- [ ] **Step 2: Implement MCP service routing**

In `server/src/services/agent-mcp.service.ts`:

- Add both names to `planningToolNames`.
- Add switch cases in `handlePlanningToolCall`:

```ts
case AgentToolName.ProposeSpaceFromSearch: {
  return this.invokeTool(id, toolName, args, AgentOperationPlanToolRequestSchemas[toolName], (dto) =>
    this.operationPlanService.proposeSpaceFromSearch(auth, sessionId, dto),
  );
}
case AgentToolName.ProposeAddAssetsToSpaceFromSearch: {
  return this.invokeTool(id, toolName, args, AgentOperationPlanToolRequestSchemas[toolName], (dto) =>
    this.operationPlanService.proposeAddAssetsToSpaceFromSearch(auth, sessionId, dto),
  );
}
```

Run the focused MCP service test again. Expected: PASS.

- [ ] **Step 3: Write failing registry/contract/docs/controller/prompt tests**

In `server/src/types/agent-mcp-contract.types.ts`, include both new names in `AgentMcpPlanningToolName` after the Slice 7 album workflow names.

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`:

- Add both tools to `expectedToolNames` and `expectedPlanningToolNames`.
- Add a test mirroring the Slice 7 registry test:

```ts
it('lists the high-level space workflow tools with valid examples', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));

  for (const toolName of [
    AgentToolName.ProposeSpaceFromSearch,
    AgentToolName.ProposeAddAssetsToSpaceFromSearch,
  ] as const) {
    const tool = toolsByName.get(toolName);
    const contract = contractService.getPlanningToolContract(toolName);

    expect(contract).toBeDefined();
    if (!contract) {
      throw new Error(`Missing planning contract for ${toolName}`);
    }
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

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`:

- Add both names to `expectedPlanningToolNames`.
- Add a contract test:

```ts
it('defines preferred high-level space workflow contracts and examples', () => {
  const create = sut.getPlanningToolContract(AgentToolName.ProposeSpaceFromSearch);
  const add = sut.getPlanningToolContract(AgentToolName.ProposeAddAssetsToSpaceFromSearch);

  expect(create?.description).toMatch(/preferred/i);
  expect(add?.description).toMatch(/preferred/i);
  expect(create?.examples.map((example) => example.name)).toEqual(
    expect.arrayContaining(['create-space-from-declarative-search', 'create-space-from-previous-search']),
  );
  expect(add?.examples.map((example) => example.name)).toEqual(
    expect.arrayContaining(['add-search-results-to-space-by-id', 'add-search-results-to-space-by-name']),
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

In `server/src/services/agent-mcp-docs.service.spec.ts`, extend the preferred workflow docs test or add:

```ts
it('documents the high-level space workflow tools as preferred for space-from-search tasks', () => {
  const markdown = sut.generateMarkdown();
  const documentedNames = sut.listDocumentedToolArgumentExamples().map((example) => example.exampleName);

  for (const name of [
    'create-space-from-declarative-search',
    'create-space-from-previous-search',
    'add-search-results-to-space-by-id',
    'add-search-results-to-space-by-name',
  ]) {
    expect(markdown).toContain(name);
    expect(documentedNames).toContain(name);
  }
  expect(markdown).toContain('proposeSpaceFromSearch');
  expect(markdown).toContain('proposeAddAssetsToSpaceFromSearch');
  expect(markdown).toMatch(/preferred/i);
});
```

In `server/src/controllers/agent-runner-mcp.controller.spec.ts`, add both names to the real MCP `tools/list` expected order after the Slice 7 album workflow tools.

In `server/src/services/agent-mcp-prompt.service.spec.ts`, add expectations to the compact runner prompt test:

```ts
expect(prompt).toContain('mcp_gallery_proposeSpaceFromSearch');
expect(prompt).toContain('mcp_gallery_proposeAddAssetsToSpaceFromSearch');
expect(prompt.length).toBeLessThanOrEqual(3800);
```

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/services/agent-mcp-prompt.service.spec.ts
```

Expected: FAIL because registry/contract/docs/prompt artifacts are not implemented.

- [ ] **Step 4: Implement registry property descriptions and tool entries**

In `server/src/services/agent-mcp-tool-registry.service.ts`:

- Add or update property descriptions:

```ts
spaceId: 'Existing shared space id returned by listSpaces/readSpace.',
spaceName: 'Shared space name to create or exact visible shared space name to resolve.',
description: 'Optional album or shared space description.',
color: 'Optional shared space color.',
```

- Add `defineTool` entries before low-level `proposeAlbumOperations`:

```ts
defineTool({
  name: AgentToolName.ProposeSpaceFromSearch,
  title: 'Propose space from search',
  description: 'Preferred space-from-search workflow that creates a reviewable plan.',
  schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch],
  annotations: planningToolAnnotations,
}),
defineTool({
  name: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
  title: 'Propose add assets to space from search',
  description: 'Preferred workflow for adding search matches to an existing shared space as a reviewable plan.',
  schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToSpaceFromSearch],
  annotations: planningToolAnnotations,
}),
```

- [ ] **Step 5: Implement contracts and examples**

In `server/src/services/agent-mcp-tool-contract.service.ts`, add example arrays after Slice 7 album workflow examples:

```ts
const proposeSpaceFromSearchExamples: AgentMcpToolExample[] = [
  {
    name: 'create-space-from-declarative-search',
    description: 'Create a new shared space directly from user-facing search filters.',
    arguments: {
      summary: 'Create family South Africa space.',
      spaceName: 'Family South Africa',
      description: 'Shared January 2026 South Africa photos.',
      color: UserAvatarColor.Blue,
      assetSource: {
        kind: 'search',
        filters: {
          country: 'South Africa',
          takenAfter: '2026-01-01T00:00:00.000Z',
          takenBefore: '2026-02-01T00:00:00.000Z',
        },
        materialization: 'all-matches-with-limit',
      },
    },
  },
  {
    name: 'create-space-from-previous-search',
    description: 'Create a new shared space from a previous search source reference.',
    arguments: {
      summary: 'Create shared space from previous search.',
      spaceName: 'Recent family favorites',
      assetSource: {
        kind: 'previousSearch',
        sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000333',
      },
    },
  },
];

const proposeAddAssetsToSpaceFromSearchExamples: AgentMcpToolExample[] = [
  {
    name: 'add-search-results-to-space-by-id',
    description: 'Add matching photos to an existing shared space id.',
    arguments: {
      summary: 'Add matching South Africa photos to the family space.',
      spaceId: exampleSpaceId,
      assetSource: {
        kind: 'search',
        filters: { country: 'South Africa' },
        materialization: 'all-matches-with-limit',
      },
    },
  },
  {
    name: 'add-search-results-to-space-by-name',
    description: 'Add matching photos to a uniquely named visible shared space.',
    arguments: {
      summary: 'Add unalbumed Berlin photos to Family.',
      spaceName: 'Family',
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
const proposeSpaceFromSearchContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeSpaceFromSearch,
  title: 'Propose space from search',
  description: 'preferred tool for creating a new shared space from a declarative or previous search source.',
  usage:
    'Use this before low-level proposeAlbumOperations when the user asks to create a shared space from matching photos. Gallery resolves names, materializes the source, and creates a reviewable plan; nothing is applied until the user approves.',
  argumentModes: [
    {
      name: 'new-space-from-search',
      description: 'Create a new shared space and add matching search results.',
      requiredFields: ['spaceName', 'assetSource'],
      forbiddenFields: ['operations', 'assetIds', 'assetSelectionHandleId'],
      whenToUse:
        'Use for requests like create a shared space from photos matching date, place, people, tags, or a previous search.',
    },
  ],
  examples: proposeSpaceFromSearchExamples,
  commonMistakes: [
    {
      id: 'space-workflow-raw-asset-ids',
      match: { unexpectedField: 'assetIds', requestShape: 'tool-arguments' },
      hint: 'Use assetSource.search or assetSource.previousSearch with this workflow tool; do not paste raw asset ids.',
      exampleName: 'create-space-from-declarative-search',
    },
  ],
  safety,
};

const proposeAddAssetsToSpaceFromSearchContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
  title: 'Propose add assets to space from search',
  description:
    'preferred tool for adding matching photos to an existing shared space from a declarative or previous search source.',
  usage:
    'Use this before low-level proposeAlbumOperations when the user asks to add matching photos to an existing shared space. Provide spaceId when known, or a uniquely visible spaceName. Gallery creates a reviewable plan only.',
  argumentModes: [
    {
      name: 'existing-space-from-search',
      description: 'Add matching search results to one existing shared space.',
      requiredFields: ['assetSource'],
      forbiddenFields: ['operations', 'assetIds', 'assetSelectionHandleId'],
      whenToUse: 'Use for requests like add my matching trip photos to this existing shared space.',
    },
  ],
  examples: proposeAddAssetsToSpaceFromSearchExamples,
  commonMistakes: [
    {
      id: 'space-workflow-missing-target',
      match: { messageIncludes: 'Provide exactly one of spaceId or spaceName' },
      hint: 'Provide spaceId from listSpaces/readSpace, or provide one exact visible spaceName.',
      exampleName: 'add-search-results-to-space-by-id',
    },
  ],
  safety,
};
```

Add both to `planningToolContracts` before `proposeAlbumOperationsContract`, after the Slice 7 album workflow contracts.

- [ ] **Step 6: Compactly update runner prompt**

In `server/src/services/agent-mcp-prompt.service.ts`, keep the prompt under `<= 3800` by changing the write guidance line to something short that includes all four high-level workflow tool names via the existing `Tool:` line and a concise instruction, for example:

```ts
`Write: album/space search use high-level fromSearch tools first; other plans use ${this.toPiToolName(planContract.name)}.`;
```

If this exceeds the prompt budget after the new tool names enlarge the `Tool:` line, trim nearby prose without removing tested semantics. Preferred trim targets:

- Shorten `Large: createSelectionHandle true -> assetSelectionHandleId. Do not paste hundreds of assetIds.` to `Large: handle -> assetSelectionHandleId. Do not paste hundreds of assetIds.`
- Shorten `No direct apply/write tool is available. Gallery applies final changes only after plan review.` to `No direct apply/write tool exists. Gallery applies only after plan review.`
- Keep all existing tested phrases or patch tests only when wording remains semantically equivalent.

- [ ] **Step 7: Regenerate generated artifacts**

Run:

```bash
pnpm --dir server exec tsx src/bin/sync-agent-mcp-docs.ts
pnpm --dir server exec tsx src/bin/sync-agent-mcp-prompt.ts
```

Expected: `docs/superpowers/generated/pi-agent-mcp-tools.md` and `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs` update.

- [ ] **Step 8: Run MCP/docs/prompt tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/services/agent-mcp-prompt.service.spec.ts
```

Expected: PASS.

## Task 5: Final Slice Verification, Review, Commit, And Push

**Files:** all touched files.

- [ ] **Step 1: Run complete Slice 8 verification**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-runner-flow.integration.spec.ts
pnpm --dir server exec tsc --noEmit --pretty false
pnpm --dir server run lint
git diff --check
```

Expected:

- Vitest: all listed files pass.
- TypeScript: exits 0.
- Lint: exits 0.
- `git diff --check`: exits 0.

- [ ] **Step 2: Spec-compliance review gate**

Dispatch a low-reasoning reviewer with this prompt:

```text
Spec-compliance review for Slice 8. Review the uncommitted changes in /home/pierre/dev/gallery/.worktrees/pi-agent-brainstorm against docs/superpowers/specs/2026-05-22-pi-agent-declarative-planning-sources-design.md Slice 8 and docs/superpowers/plans/2026-05-22-pi-agent-declarative-planning-sources-slice-8.md. Focus on whether proposeSpaceFromSearch and proposeAddAssetsToSpaceFromSearch satisfy all Slice 8 tests and edge cases, preserve existing shared-space permission/membership semantics, audit clarification failures under their own tool names, update generated docs/prompt/controller tool list, and avoid Slice 9+ scope. Do not edit files. Return APPROVED or CHANGES_REQUESTED with file/line findings and verification commands.
```

Fix any valid findings with TDD before continuing.

- [ ] **Step 3: Code-quality review gate**

Dispatch a low-reasoning reviewer with this prompt:

```text
Code-quality review for Slice 8. Review the uncommitted changes in /home/pierre/dev/gallery/.worktrees/pi-agent-brainstorm for bugs, runtime issues, broken DI, bad Zod validation, stale generated artifacts, permission/audit leaks, prompt budget regressions, and brittle tests. Focus on high-level space workflow tools, name resolution, existing-space role checks, MCP registry/contracts/docs/prompt, and generated artifacts. Do not edit files. Return APPROVED or CHANGES_REQUESTED with concrete file/line findings and commands/results.
```

Fix any valid findings with TDD before continuing.

- [ ] **Step 4: Commit and push**

After verification and both review gates approve:

```bash
git status --short
git add agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md docs/superpowers/plans/2026-05-22-pi-agent-declarative-planning-sources-slice-8.md server/src/controllers/agent-runner-mcp.controller.spec.ts server/src/dtos/agent-operation.dto.spec.ts server/src/dtos/agent-operation.dto.ts server/src/enum.ts server/src/services/agent-mcp-docs.service.spec.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp.service.spec.ts server/src/services/agent-mcp.service.ts server/src/services/agent-operation-plan.service.spec.ts server/src/services/agent-operation-plan.service.ts server/src/types/agent-mcp-contract.types.ts
git commit -m "feat(server): add Pi space search workflow tools"
git push
```

Expected: commit succeeds and push updates `origin/explore/pi-agent-brainstorm`.

## Self-Review Checklist

- Slice 8 TDD is explicit: every behavior starts with a failing test and an expected red command.
- All Slice 8 spec edge cases are covered: new space, existing space, `targetId` semantics, permission presets/write scope, editor role access, membership consistency, duplicate/no-match clarification, docs, controller, prompt.
- The plan does not implement Slice 9 asset batch tools, Slice 10 UI, Slice 11 broad prompt work, or Slice 12 activity polish.
- File paths and APIs match the current codebase after Slice 7.
- No placeholder language remains; all edge cases have concrete tests and commands.
