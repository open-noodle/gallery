# Pi Agent Handle-First Planning Contract Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden provider-facing planning so Pi uses selection handles or declarative sources instead of raw asset ID arrays, while internal plans still materialize durable asset IDs for review/apply.

**Architecture:** Add a provider-boundary guard in `AgentMcpService` that rejects planning `operations[].assetIds` and `assetSource.explicitAssets` before delegation, and redact materialized `plan.operations[].assetIds` from MCP structured content. Keep `AgentOperationPlanService` internal persistence unchanged, and add `assetSource.selectionHandle` as an accepted planning source that materializes through the existing selection handle resolver.

**Tech Stack:** TypeScript/NestJS/Zod/Vitest for MCP validation, operation planning DTOs/services, MCP contracts/prompts/docs, and generated MCP artifacts.

---

## Slice Scope

Implement only Slice 5 from `docs/superpowers/specs/2026-05-27-pi-agent-handle-first-tool-contract-design.md`:

- Provider-facing MCP planning rejects raw `operations[].assetIds`.
- Provider-facing MCP planning rejects `assetSource.explicitAssets`.
- `assetSelectionHandleId` and `assetSource.selectionHandle` both materialize server-side into internal plan asset IDs.
- Internal plan creation, review, apply, audit, stale/deleted asset revalidation, operation limits, and cover-count validation remain durable and unchanged.
- Provider-visible planning results from MCP do not return materialized operation asset ID arrays.
- Contract, prompt, docs, and generated artifacts guide Pi toward handles/sources instead of copying raw asset IDs.

Out of scope:

- Do not add convenience tools such as `proposeAlbumFromSelection` or `proposeAssetBatchFromSelection`; Slice 6 owns those.
- Do not raise search limits; Slice 6 owns limit rebalance.
- Do not remove raw `assetIds` from internal DTOs, controller APIs, persisted plans, apply paths, or review internals.
- Do not remove legacy read-tool `assetIds` support; this slice is only provider-facing planning.

## Files

- Modify: `server/src/services/agent-mcp.service.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
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

## Task 1: MCP Provider Boundary And Planning Result Redaction

**Files:**

- Modify: `server/src/services/agent-mcp.service.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add failing MCP boundary tests**

In `server/src/services/agent-mcp.service.spec.ts`, add tests near the existing `ProposeAlbumOperations` validation tests:

```ts
it('rejects provider-facing raw planning assetIds before delegation', async () => {
  const rawAssetId = factory.uuid();

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
      summary: 'Add copied IDs.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add copied IDs.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          assetIds: [rawAssetId],
          payload: {},
        },
      ],
    }),
  )) as AgentMcpSuccessResponse;

  const result = response.result as AgentMcpToolCallResult;
  const structuredContent = result.structuredContent as Record<string, unknown>;

  expect(result.isError).toBe(true);
  expect(structuredContent).toMatchObject({
    status: 'error',
    error: 'Invalid tool arguments',
    toolName: AgentToolName.ProposeAlbumOperations,
    retryable: true,
  });
  expect(structuredContent.issues).toEqual([
    expect.objectContaining({
      path: 'operations.0.assetIds',
      message: expect.stringContaining('Provider-facing planning calls must use selection handles'),
    }),
  ]);
  expect(JSON.stringify(response)).not.toContain(rawAssetId);
  expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
});

it('rejects provider-facing assetSource.explicitAssets before delegation', async () => {
  const rawAssetId = factory.uuid();

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
      summary: 'Add explicit assets.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add explicit assets.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          assetSource: { kind: 'explicitAssets', assetIds: [rawAssetId] },
          payload: {},
        },
      ],
    }),
  )) as AgentMcpSuccessResponse;

  const result = response.result as AgentMcpToolCallResult;
  const structuredContent = result.structuredContent as Record<string, unknown>;

  expect(result.isError).toBe(true);
  expect(structuredContent.issues).toEqual([
    expect.objectContaining({
      path: 'operations.0.assetSource',
      message: expect.stringContaining('assetSource.explicitAssets is not available'),
    }),
  ]);
  expect(JSON.stringify(response)).not.toContain(rawAssetId);
  expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
});

it('redacts materialized planning assetIds from MCP structured content', async () => {
  const rawAssetIds = [factory.uuid(), factory.uuid()];
  const serviceResult = {
    status: 'success',
    summary:
      'Plan revision 1: 0 album create, 1 asset add, 0 detail update, 0 cover change, 0 metadata update operation(s).',
    toolCall: null,
    plan: {
      id: factory.uuid(),
      sessionId,
      revision: 1,
      status: AgentOperationPlanStatus.Proposed,
      summary: 'Add handle assets.',
      operations: [
        {
          id: factory.uuid(),
          planId: factory.uuid(),
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add handle assets.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          temporaryTargetId: null,
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
  operationPlanService.proposeAlbumOperations.mockResolvedValue(serviceResult as never);

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
      summary: 'Add handle assets.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add handle assets.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          assetSelectionHandleId: factory.uuid(),
          payload: {},
        },
      ],
    }),
  )) as AgentMcpSuccessResponse;

  const result = response.result as AgentMcpToolCallResult;
  const structuredContent = result.structuredContent as Record<string, any>;
  const [operation] = structuredContent.plan.operations;

  expect(operation).not.toHaveProperty('assetIds');
  expect(operation.assetCount).toBe(2);
  expect(JSON.stringify(response)).not.toContain('"assetIds"');
  expect(JSON.stringify(response)).not.toContain(rawAssetIds[0]);
});
```

Ensure the spec imports `AgentOperationPlanStatus` and `AgentOperationStatus` if they are not already imported.

- [ ] **Step 2: Run MCP boundary tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts -t "raw planning assetIds|explicitAssets|redacts materialized planning assetIds"
```

Expected: FAIL because raw `assetIds` still delegate, `explicitAssets` is handled by generic schema validation without handle guidance, and MCP structured content still contains materialized `plan.operations[].assetIds`.

- [ ] **Step 3: Implement provider pre-validation and redaction**

In `server/src/services/agent-mcp.service.ts`, add helper types near `AgentMcpRequest`:

```ts
type AgentMcpValidationIssue = { path: string; message: string };

type AgentMcpInvokeToolOptions<TDto> = {
  preValidate?: (args: Record<string, unknown>) => AgentMcpValidationIssue[];
  mapResult?: (result: unknown, dto: TDto) => unknown;
};
```

Update `invokeTool` to accept options:

```ts
  private async invokeTool<TDto>(
    id: AgentMcpRequestId,
    toolName: AgentToolName,
    args: unknown,
    schema: z.ZodType<TDto>,
    delegate: (dto: TDto) => Promise<unknown>,
    options: AgentMcpInvokeToolOptions<TDto> = {},
  ): Promise<AgentMcpSuccessResponse | AgentMcpErrorResponse> {
    const argumentValidation = this.validateToolArguments(args);
    if (!argumentValidation.valid) {
      return this.success(id, this.argumentErrorResult(toolName, argumentValidation.path, argumentValidation.message));
    }

    const preValidationIssues = options.preValidate?.(argumentValidation.value) ?? [];
    if (preValidationIssues.length > 0) {
      return this.success(id, this.validationIssuesResult(toolName, preValidationIssues, 'tool-arguments'));
    }

    const parseResult = schema.safeParse(argumentValidation.value);
    if (!parseResult.success) {
      return this.success(id, this.validationErrorResult(toolName, parseResult.error));
    }

    try {
      const result = await delegate(parseResult.data);
      return this.success(id, this.toolResult(options.mapResult?.(result, parseResult.data) ?? result));
    } catch (error) {
      if (isAgentMcpRecoverableToolError(error)) {
        return this.success(id, this.recoverableToolErrorResult(error.content));
      }

      return this.error(id, -32_603, 'Internal error');
    }
  }
```

Add a planning-specific invoke helper:

```ts
  private invokePlanningTool<TDto>(
    auth: AuthDto,
    sessionId: string,
    id: AgentMcpRequestId,
    toolName: keyof typeof AgentOperationPlanToolRequestSchemas,
    args: unknown,
    delegate: (dto: TDto) => Promise<unknown>,
  ) {
    return this.invokeTool(id, toolName, args, AgentOperationPlanToolRequestSchemas[toolName] as z.ZodType<TDto>, delegate, {
      preValidate: (value) => this.providerFacingPlanningArgumentIssues(value),
      mapResult: (result) => this.redactProviderFacingPlanningResult(result),
    });
  }
```

Use `invokePlanningTool` in every `handlePlanningToolCall` planning case. For `ReviseProposedOperations`, preserve the `planId` split:

```ts
case AgentToolName.ReviseProposedOperations: {
  return this.invokePlanningTool(auth, sessionId, id, toolName, args, (dto) => {
    const { planId, ...body } = dto as z.output<(typeof AgentOperationPlanToolRequestSchemas)[typeof toolName]>;
    return this.operationPlanService.reviseProposedOperations(auth, sessionId, planId, body);
  });
}
```

Add provider argument guards:

```ts
  private providerFacingPlanningArgumentIssues(args: Record<string, unknown>): AgentMcpValidationIssue[] {
    const operations = Array.isArray(args.operations) ? args.operations : [];
    return operations.flatMap((operation, index) => {
      const record = this.recordValue(operation);
      if (!record) {
        return [];
      }

      const issues: AgentMcpValidationIssue[] = [];
      if (Array.isArray(record.assetIds)) {
        issues.push({
          path: `operations.${index}.assetIds`,
          message:
            'Provider-facing planning calls must use selection handles or declarative asset sources instead of raw assetIds. Use assetSelectionHandleId, assetSource.selectionHandle, assetSource.previousSearch, or assetSource.search.',
        });
      }

      const assetSource = this.recordValue(record.assetSource);
      if (assetSource?.kind === 'explicitAssets') {
        issues.push({
          path: `operations.${index}.assetSource`,
          message:
            'assetSource.explicitAssets is not available in provider-facing planning. Use assetSelectionHandleId, assetSource.selectionHandle, assetSource.previousSearch, or assetSource.search.',
        });
      }

      return issues;
    });
  }
```

Add MCP planning result redaction:

```ts
  private redactProviderFacingPlanningResult(result: unknown): unknown {
    const content = this.recordValue(result);
    const plan = this.recordValue(content?.plan);
    if (!content || !plan || !Array.isArray(plan.operations)) {
      return result;
    }

    return {
      ...content,
      plan: {
        ...plan,
        operations: plan.operations.map((operation) => this.redactProviderFacingPlanningOperation(operation)),
      },
    };
  }

  private redactProviderFacingPlanningOperation(operation: unknown): unknown {
    const record = this.recordValue(operation);
    if (!record) {
      return operation;
    }

    const { assetIds, result, ...rest } = record;
    const assetCount = Array.isArray(assetIds) ? assetIds.length : 0;
    return {
      ...rest,
      assetCount,
      result: this.redactProviderFacingPlanningOperationResult(result),
    };
  }

  private redactProviderFacingPlanningOperationResult(result: unknown): unknown {
    const record = this.recordValue(result);
    if (!record) {
      return result;
    }

    const { assetIds, assetId, ...rest } = record;
    const assetCount =
      Array.isArray(assetIds) ? assetIds.length : typeof assetId === 'string' ? 1 : undefined;

    return {
      ...rest,
      ...(assetCount === undefined ? {} : { assetCount }),
    };
  }
```

- [ ] **Step 4: Run MCP boundary tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts -t "raw planning assetIds|explicitAssets|redacts materialized planning assetIds"
```

Expected: PASS.

- [ ] **Step 5: Commit MCP boundary**

Run:

```bash
git add server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts
git commit -m "feat: reject raw planning ids at MCP boundary"
```

---

## Task 2: `assetSource.selectionHandle` Planning Materialization

**Files:**

- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Add failing DTO and service tests**

In `server/src/dtos/agent-operation.dto.spec.ts`, add a test near the existing planning source DTO tests:

```ts
it('accepts provider planning assetSource.selectionHandle', () => {
  const selectionHandleId = '00000000-0000-4000-8000-000000000333';

  expect(
    AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
      summary: 'Create an album from a selection handle.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add handle assets.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000111',
          assetSource: { kind: 'selectionHandle', selectionHandleId },
          payload: {},
        },
      ],
    }).success,
  ).toBe(true);
});
```

In `server/src/services/agent-operation-plan.service.spec.ts`, add these tests near the existing selection handle materialization tests:

```ts
it('materializes assetSource.selectionHandle server-side before storing a plan', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const selectionHandleId = newUuid();
  const albumId = newUuid();
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
    expiresAt: new Date('2026-05-27T12:30:00.000Z'),
    createdAt: now,
    updateId: newUuid(),
  });
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  const createdPlan = makePlan({
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
  });
  planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

  const result = await sut.proposeAlbumOperations(auth, session.id, {
    summary: 'Add handle assets.',
    operations: [
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add handle assets.',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: albumId,
        assetSource: { kind: 'selectionHandle', selectionHandleId },
        payload: {},
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
      },
    ],
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
      operations: [expect.objectContaining({ assetIds, assetSource: undefined, assetSelectionHandleId: undefined })],
    }),
  );
  expect(result.plan?.operations[0].assetIds).toEqual(assetIds);
});

it('re-checks assetSource.selectionHandle assets against current permissions and deleted assets', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const selectionHandleId = newUuid();
  const allowedAssetId = newUuid();
  const deletedOrDeniedAssetId = newUuid();
  const albumId = newUuid();

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: newUuid(),
    assetIds: [allowedAssetId, deletedOrDeniedAssetId],
    assetCount: 2,
    sampleAssetIds: [allowedAssetId, deletedOrDeniedAssetId],
    expiresAt: new Date('2026-05-27T12:30:00.000Z'),
    createdAt: now,
    updateId: newUuid(),
  });
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([allowedAssetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([allowedAssetId]));

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Add stale handle assets.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add stale handle assets.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetSource: { kind: 'selectionHandle', selectionHandleId },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    }),
  ).rejects.toThrow('One or more assets are not accessible');

  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});

it('enforces set-cover limits for assetSource.selectionHandle', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const selectionHandleId = newUuid();
  const assetIds = Array.from({ length: AgentOperationPlanService.maxCoverSelectionHandleAssets + 1 }, () => newUuid());

  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: newUuid(),
    assetIds,
    assetCount: assetIds.length,
    sampleAssetIds: assetIds.slice(0, 25),
    expiresAt: new Date('2026-05-27T12:30:00.000Z'),
    createdAt: now,
    updateId: newUuid(),
  });

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Set cover from too many handle assets.',
      operations: [
        {
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSource: { kind: 'selectionHandle', selectionHandleId },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
      ],
    }),
  ).rejects.toThrow('Selection handle contains too many cover candidates');

  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run DTO/service tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts -t "assetSource.selectionHandle"
```

Expected: FAIL because planning DTOs currently reject `assetSource.selectionHandle`, and the service resolver does not materialize it.

- [ ] **Step 3: Allow `assetSource.selectionHandle` in planning DTOs**

In `server/src/dtos/agent-operation.dto.ts`, change the planning asset source schema refinement and cast:

```ts
const agentOperationPlanningAssetSourceInput = AgentAssetSourceInputSchema.superRefine((value, ctx) => {
  if (value.kind !== 'search' && value.kind !== 'previousSearch' && value.kind !== 'selectionHandle') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['kind'],
      message: 'Invalid input: expected "search", "previousSearch", or "selectionHandle"',
    });
  }
}).meta({ id: 'AgentOperationPlanningAssetSourceInput' }) as z.ZodType<
  Extract<AgentAssetSourceInput, { kind: 'search' | 'previousSearch' | 'selectionHandle' }>
>;
```

This keeps `assetSource.explicitAssets` invalid in direct DTO parsing while allowing handle sources.

- [ ] **Step 4: Materialize `assetSource.selectionHandle`**

In `server/src/services/agent-operation-plan.service.ts`, update `resolveAssetSourceAssetIds()`:

```ts
if (assetSource.kind === 'selectionHandle') {
  return this.resolveSelectionHandleAssetIds(auth, session, assetSource.selectionHandleId, selectionAudit);
}
```

Then update the fallback error:

```ts
throw new BadRequestException(
  'Only assetSource.search, assetSource.previousSearch, and assetSource.selectionHandle are supported for operation planning',
);
```

No apply-path changes are needed: the service already stores materialized `assetIds` internally and apply uses the stored plan.

- [ ] **Step 5: Run DTO/service tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts -t "assetSource.selectionHandle"
```

Expected: PASS.

- [ ] **Step 6: Commit selection-handle asset source support**

Run:

```bash
git add server/src/dtos/agent-operation.dto.ts server/src/dtos/agent-operation.dto.spec.ts server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts
git commit -m "feat: materialize planning selection handle sources"
```

---

## Task 3: Provider Planning Contract, Prompt, Docs, And Generated Artifacts

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

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, add tests near planning contract tests:

```ts
it('documents provider planning handles instead of raw asset ids', () => {
  const contract = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);
  const serialized = JSON.stringify(contract);

  expect(contract?.usage).toContain('assetSelectionHandleId');
  expect(contract?.usage).toContain('assetSource.selectionHandle');
  expect(contract?.usage).toContain('provider-facing planning rejects raw assetIds');
  expect(serialized).toContain('create-album-from-selection-handle');
  expect(serialized).not.toContain('"assetIds":[\"00000000-0000-4000-8000-000000000001\"');
  expect(serialized).not.toContain('"kind":"explicitAssets"');
});

it('returns handle guidance for provider raw planning ids', () => {
  const correction = sut.getPlanningToolValidationCorrection(AgentToolName.ProposeAlbumOperations, {
    requestShape: 'tool-arguments',
    issues: [
      {
        path: 'operations.0.assetIds',
        message:
          'Provider-facing planning calls must use selection handles or declarative asset sources instead of raw assetIds.',
      },
    ],
  });

  expect(correction?.hint).toContain('selectionHandle.id');
  expect(correction?.hint).toContain('assetSource.selectionHandle');
  expect(correction?.exampleName).toBe('create-album-from-selection-handle');
});

it('returns handle guidance for provider explicit asset sources', () => {
  const correction = sut.getPlanningToolValidationCorrection(AgentToolName.ProposeAlbumOperations, {
    requestShape: 'tool-arguments',
    issues: [
      {
        path: 'operations.0.assetSource',
        message: 'assetSource.explicitAssets is not available in provider-facing planning.',
      },
    ],
  });

  expect(correction?.hint).toContain('assetSource.selectionHandle');
  expect(correction?.hint).toContain('internal-only');
});
```

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, assert planning tool input schemas/descriptions mention `assetSelectionHandleId` and `assetSource.selectionHandle`, and do not describe provider-facing raw `assetIds` as the preferred selection mechanism.

In `server/src/services/agent-mcp-prompt.service.spec.ts`, add:

```ts
expect(prompt).toContain('assetSource.selectionHandle');
expect(prompt).toContain('provider planning rejects raw assetIds');
expect(prompt).toContain('assetSelectionHandleId');
expect(prompt).not.toContain('choose selected assetIds');
expect(prompt).not.toContain('"kind":"explicitAssets"');
```

In `server/src/services/agent-mcp-docs.service.spec.ts`, add:

```ts
expect(markdown).toContain('assetSource.selectionHandle');
expect(markdown).toContain('provider-facing planning rejects raw assetIds');
expect(markdown).toContain('assetSelectionHandleId');
expect(markdown).toContain('assetSource.explicitAssets');
expect(markdown).not.toContain('choose selected assetIds');
expect(markdown).not.toContain('"kind":"explicitAssets"');
```

- [ ] **Step 2: Run contract/prompt/docs tests red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts -t "provider planning|raw assetIds|selectionHandle"
```

Expected: FAIL because planning contracts/prompts/docs still include provider-facing raw `assetIds` examples and do not document `assetSource.selectionHandle`.

- [ ] **Step 3: Update planning contracts**

In `server/src/services/agent-mcp-tool-contract.service.ts`:

1. Change `planningUsage`:

```ts
const planningUsage =
  'Create a reviewable Gallery operation plan. Put all writes in operations and let Gallery apply the plan after user review. Provider-facing planning rejects raw assetIds; use assetSelectionHandleId, assetSource.selectionHandle, assetSource.previousSearch, or assetSource.search so Gallery materializes asset IDs server-side.';
```

2. Replace provider-facing `assetIds` examples in `planningProposalExamples` with either `assetSelectionHandleId: exampleSelectionHandleId` or `assetSource: { kind: 'selectionHandle', selectionHandleId: exampleSelectionHandleId }`. Keep `createEmptyAlbumExample` unchanged. For one example, use `assetSource.selectionHandle` explicitly:

```ts
assetSource: { kind: 'selectionHandle', selectionHandleId: exampleSelectionHandleId },
```

3. Add planning common mistakes:

```ts
  {
    id: 'planning-provider-raw-asset-ids',
    match: {
      issuePath: 'operations.0.assetIds',
      messageIncludes: 'Provider-facing planning calls must use selection handles',
      requestShape: 'tool-arguments',
    },
    hint:
      'Use selectionHandle.id from searchAssets or curateSelection as assetSelectionHandleId, or use assetSource.selectionHandle/search/previousSearch; do not paste raw asset IDs into provider-facing planning.',
    exampleName: 'create-album-from-selection-handle',
  },
  {
    id: 'planning-provider-explicit-assets-source',
    match: {
      issuePath: 'operations.0.assetSource',
      messageIncludes: 'assetSource.explicitAssets is not available',
      requestShape: 'tool-arguments',
    },
    hint:
      'Use assetSource.selectionHandle with a same-session selectionHandle.id, or use assetSource.search/previousSearch; assetSource.explicitAssets is internal-only.',
    exampleName: 'create-album-from-selection-handle',
  },
```

4. Update the large pasted IDs mistake hint to match the new policy:

```ts
hint:
  'Provider-facing planning rejects raw assetIds. Use searchAssets or curateSelection and pass the returned selectionHandle.id as assetSelectionHandleId.',
```

5. Ensure `revisePlanningExamples` inherits the handle-based examples.

- [ ] **Step 4: Update registry, prompt, and docs source**

In `server/src/services/agent-mcp-tool-registry.service.ts`, update descriptions for `assetIds`, `assetSelectionHandleId`, and `assetSource`:

```ts
assetIds:
  'Internal materialized asset IDs stored in review plans. Provider-facing planning calls should not send this field; use assetSelectionHandleId or assetSource.selectionHandle/search/previousSearch.',
assetSelectionHandleId:
  'Same-session selectionHandle.id returned by searchAssets or curateSelection. Preferred provider-facing way to target selected assets in operation planning.',
assetSource:
  'Declarative or handle-backed source for assets. Provider-facing planning supports assetSource.search, assetSource.previousSearch, and assetSource.selectionHandle; assetSource.explicitAssets is internal-only.',
```

In `server/src/services/agent-mcp-prompt.service.ts`, update planning guidance to include:

```ts
'Planning: provider planning rejects raw assetIds; use assetSelectionHandleId or assetSource.selectionHandle/search/previousSearch; Gallery materializes IDs server-side.',
```

Preserve existing lines for `selectionHandle.id -> assetSelectionHandleId`, metadata-only curation, and explicit latitude/longitude for metadata edits.

In `server/src/services/agent-mcp-docs.service.ts`, add a planning workflow line:

```ts
'- Planning: provider-facing planning rejects raw `assetIds` and `assetSource.explicitAssets`; use `assetSelectionHandleId`, `assetSource.selectionHandle`, `assetSource.previousSearch`, or `assetSource.search` so Gallery materializes IDs server-side.',
```

- [ ] **Step 5: Run source tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
```

Expected: generated sync tests may fail only because generated artifacts are stale. All other tests should pass.

- [ ] **Step 6: Commit source guidance**

Run:

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-docs.service.spec.ts
git commit -m "docs: require handle-backed planning inputs"
```

- [ ] **Step 7: Regenerate artifacts and scan**

Run:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-prompt
pnpm --dir server run sync:agent-mcp-docs
rg -n 'choose selected assetIds|choose .* assetIds|"kind": ?"explicitAssets"|kind: '\''explicitAssets'\''|assetSource: \\{ kind: '\''explicitAssets'\''|createSelectionHandle|"detail":"ids"|"detail": "ids"' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
rg -n 'provider planning rejects raw assetIds|assetSource\\.selectionHandle|assetSelectionHandleId|assetSource\\.explicitAssets|Gallery materializes IDs server-side' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
```

Expected: first scan has no matches. Second scan has matches in both generated files.

- [ ] **Step 8: Run generated sync tests and commit**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
git add agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
git commit -m "chore: regenerate handle-backed planning guidance"
```

---

## Task 4: Slice 5 Verification

**Files:**

- All files changed in Tasks 1-3.

- [ ] **Step 1: Run focused Slice 5 tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
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

- [ ] **Step 3: Run provider-facing planning scans**

Run:

```bash
rg -n 'choose selected assetIds|choose .* assetIds|"kind": ?"explicitAssets"|kind: '\''explicitAssets'\''|assetSource: \\{ kind: '\''explicitAssets'\''|createSelectionHandle|"detail":"ids"|"detail": "ids"' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-tool-contract.service.ts
rg -n '"assetIds"|assetSource\\.explicitAssets' server/src/services/agent-mcp.service.spec.ts
```

Expected: first command has no matches. Second command may match internal service-result fixtures, but every provider-facing raw planning test must assert the response does not contain raw asset IDs and the operation plan service was not called; every MCP planning redaction test must assert `plan.operations[].assetIds` is absent.

- [ ] **Step 4: Push Slice 5**

Run:

```bash
git push
```

Expected: branch `explore/pi-agent-brainstorm` pushes to origin.

## Plan Self-Review

- TDD order is explicit for MCP boundary, DTO/service materialization, contract/docs/generated guidance, and final verification.
- Every Slice 5 required edge case is covered:
  - raw `operations[].assetIds` fail before delegation;
  - `assetSource.explicitAssets` fails before delegation;
  - `assetSelectionHandleId` remains supported through existing tests;
  - `assetSource.selectionHandle` succeeds and materializes internally;
  - stale/deleted handle assets are revalidated during materialization;
  - cover-count and operation-specific limits still apply to handle sources;
  - MCP planning structured content redacts materialized `assetIds`;
  - docs/prompt/generated guidance is handle-backed and does not tell Pi to choose/copy IDs.
- Internal plan DTOs, persisted operations, apply logic, and review internals keep materialized `assetIds` for compatibility.
- Future slices remain out of scope:
  - no workflow convenience tools from selection handles;
  - no search limit increase;
  - no USA-trip assistant regression.
