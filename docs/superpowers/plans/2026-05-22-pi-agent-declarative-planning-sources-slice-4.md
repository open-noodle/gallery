# Pi Agent Declarative Planning Sources Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow existing planning tools to accept `assetSource.previousSearch`, resolve it to the backing selection handle, and persist ordinary materialized operation plans.

**Architecture:** Treat `assetSource.previousSearch.sourceRef` as a typed wrapper around the existing selection-handle ID produced by Slice 3. The operation-plan service strips the `asset-source:search:` prefix, validates the backing handle with the existing same-session/user/expiration repository lookup, materializes asset IDs before persistence, and stores compact source audit metadata. No live re-query and no plan apply changes are introduced in this slice.

**Tech Stack:** NestJS services, TypeScript, Zod DTO schemas, Vitest, existing `AgentSelectionHandleRepository` and operation-plan persistence.

---

## Scope

This is Slice 4 from `docs/superpowers/specs/2026-05-22-pi-agent-declarative-planning-sources-design.md`.

Implement only:

- Add optional `assetSource` to asset-bearing planning operation inputs.
- Accept and resolve `assetSource: { kind: "previousSearch", sourceRef }`.
- Materialize the backing selection handle into the same persisted `assetIds` model already used by explicit assets and `assetSelectionHandleId`.
- Reject multiple source mechanisms (`assetSource` plus `assetIds` or `assetSelectionHandleId`) before plan persistence.
- Reject asset-bearing operations with no source mechanism before plan persistence.
- Reject expired, cross-session, and cross-user source refs safely.
- Include compact source audit metadata in planning tool-call request metadata.

Do not implement:

- `assetSource.search` resolution.
- `assetSource.selectionHandle` or `assetSource.explicitAssets` runtime resolution.
- Declarative filter resolution.
- High-level workflow tools.
- Durable plan-backed selection handles beyond the existing persisted `assetIds` operation model.

## Files

- Modify: `server/src/types/agent-operation.types.ts`
  - Add `assetSource?: AgentAssetSourceInput` to `AgentAlbumOperationInput`.
- Modify: `server/src/types/agent-tool.types.ts`
  - Extend `AgentToolOperationPlanRequestMetadata.selectionHandles` entries with optional `sourceKind?: 'selectionHandle' | 'previousSearch'` and `sourceRef?: AgentSearchSourceRef`.
  - Add `AgentSourceRefRecoveryMetadata` and `sourceRefRecovery` response metadata for denied planning audits.
- Modify: `server/src/dtos/agent-operation.dto.ts`
  - Add a planning-specific `assetSource` schema that only accepts `assetSource.previousSearch`.
  - Add `assetSource` to asset-bearing operation schemas.
  - Replace two-field asset selection validation with exact-one validation across `assetSource`, `assetIds`, and `assetSelectionHandleId`.
- Modify: `server/src/services/agent-mcp-recoverable-tool-error.ts`
  - Add `invalidSourceRefError()` helper.
- Modify: `server/src/services/agent-operation-plan.service.ts`
  - Resolve `assetSource.previousSearch.sourceRef`.
  - Reject unsupported asset source kinds with a clear `BadRequestException`.
  - Preserve existing `assetIds` and `assetSelectionHandleId` behavior.
  - Store source audit metadata and source-ref recovery metadata.
- Test: `server/src/dtos/agent-operation.dto.spec.ts`
  - Add DTO acceptance/rejection tests for `assetSource.previousSearch`, unsupported planning source kinds, and exact-one mechanism validation.
- Test: `server/src/services/agent-operation-plan.service.spec.ts`
  - Add service tests for successful materialization, expired source refs, cross-session/cross-user source refs, existing behavior regressions, conflict rejection, runtime non-asset source rejection, source-ref recovery sanitization, and compact audit metadata.
- Test: `server/src/services/agent-mcp.service.spec.ts`
  - Add MCP serialization test for source-ref recoverable errors.

## Source Ref Mapping

`assetSource.previousSearch.sourceRef` values must be parsed by stripping this exact prefix:

```ts
const searchSourceRefPrefix = 'asset-source:search:';
```

`asset-source:search:<handleId>` maps to selection handle ID `<handleId>`. The DTO schema already validates the source ref shape. The service must still treat invalid or unavailable backing handles as recoverable source-ref errors rather than assuming the handle exists.

## Task 1: DTO Contract For `assetSource.previousSearch`

**Files:**

- Modify: `server/src/types/agent-operation.types.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`
- Test: `server/src/dtos/agent-operation.dto.spec.ts`

- [ ] **Step 1: Write failing DTO tests**

Add these tests inside `describe('assetSelectionHandleId planning input', ...)` or rename the describe to `asset source planning input` in `server/src/dtos/agent-operation.dto.spec.ts`:

```ts
it('accepts previousSearch assetSource instead of explicit asset ids for asset-bearing operations', () => {
  const sourceRef = `asset-source:search:${factory.uuid()}`;
  const result = parsePlan({
    summary: 'Add prior search photos',
    operations: [
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add selected photos',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: factory.uuid(),
        assetSource: { kind: 'previousSearch', sourceRef },
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
        payload: {},
      },
    ],
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.operations[0]).toMatchObject({
      assetSource: { kind: 'previousSearch', sourceRef },
    });
    expect(result.data.operations[0]).not.toHaveProperty('assetIds');
    expect(result.data.operations[0]).not.toHaveProperty('assetSelectionHandleId');
  }
});

it('rejects asset-bearing operations that provide assetSource and assetIds', () => {
  const result = parsePlan({
    summary: 'Invalid mixed selection',
    operations: [
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add selected photos',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: factory.uuid(),
        assetSource: { kind: 'previousSearch', sourceRef: `asset-source:search:${factory.uuid()}` },
        assetIds: [factory.uuid()],
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
        payload: {},
      },
    ],
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues.map((issue) => issue.message)).toContain(
    'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
  );
});

it('rejects asset-bearing operations that provide assetSource and assetSelectionHandleId', () => {
  const result = parsePlan({
    summary: 'Invalid mixed selection',
    operations: [
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add selected photos',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: factory.uuid(),
        assetSource: { kind: 'previousSearch', sourceRef: `asset-source:search:${factory.uuid()}` },
        assetSelectionHandleId: factory.uuid(),
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
        payload: {},
      },
    ],
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues.map((issue) => issue.message)).toContain(
    'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
  );
});
```

Also add a DTO regression for unsupported source kinds:

```ts
it('rejects assetSource kinds that operation planning does not support yet', () => {
  const result = parsePlan({
    summary: 'Add searched photos directly',
    operations: [
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add selected photos',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: factory.uuid(),
        assetSource: { kind: 'search', query: 'beach', limit: 10 },
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
        payload: {},
      },
    ],
  });

  expect(result.success).toBe(false);
  expectIssue(result, ['operations', 0, 'assetSource', 'kind'], 'expected "previousSearch"');
});
```

Update the existing tests that assert old messages:

```ts
expect(result.error?.issues.map((issue) => issue.message)).toContain(
  'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
);
```

This applies to:

- operations with both `assetIds` and `assetSelectionHandleId`;
- asset-bearing operations with neither source mechanism.

- [ ] **Step 2: Run focused DTO tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts -t "asset.*planning input"
```

Expected: FAIL because `assetSource` is not yet accepted and old validation messages still mention only two fields.

- [ ] **Step 3: Add operation type support**

In `server/src/types/agent-operation.types.ts`, import `AgentAssetSourceInput`:

```ts
import { AgentAssetSourceInput } from 'src/types/agent-asset-source.types';
```

Update `AgentAlbumOperationInput`:

```ts
assetSource?: AgentAssetSourceInput;
assetIds?: string[];
assetSelectionHandleId?: string;
```

- [ ] **Step 4: Add schema support and exact-one validation**

In `server/src/dtos/agent-operation.dto.ts`, import:

```ts
import { AgentSearchSourceRefSchema } from 'src/dtos/agent-asset-source.dto';
import { validateAgentAssetSourceMechanismCount } from 'src/types/agent-asset-source.types';
```

Add a planning-specific schema instead of reusing the broader source schema. Slice 4 must not advertise `assetSource.search`, `assetSource.selectionHandle`, or `assetSource.explicitAssets` as valid operation-planning inputs because only `previousSearch` is implemented here:

```ts
const agentAssetSourceInput = z
  .strictObject({
    kind: z.literal('previousSearch'),
    sourceRef: AgentSearchSourceRefSchema,
  })
  .meta({ id: 'AgentOperationPlanningAssetSourceInput' }) as z.ZodType<
  Extract<AgentAssetSourceInput, { kind: 'previousSearch' }>
>;
```

Update selection field groups:

```ts
const assetSelection = {
  assetSource: agentAssetSourceInput.optional(),
  assetIds: uniqueAssetIds.optional(),
  assetSelectionHandleId: assetSelectionHandleId.optional(),
};
const coverAssetSelection = {
  assetSource: agentAssetSourceInput.optional(),
  assetIds: uniqueCoverAssetIds.optional(),
  assetSelectionHandleId: assetSelectionHandleId.optional(),
};
```

Replace `validateAssetSelection()` with:

```ts
const validateAssetSelection = (
  operation: { assetSource?: unknown; assetIds?: string[]; assetSelectionHandleId?: string },
  ctx: z.RefinementCtx,
) => {
  const validation = validateAgentAssetSourceMechanismCount(operation);
  if (!validation.valid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: validation.message,
    });
  }
};
```

- [ ] **Step 5: Run focused DTO tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts -t "asset.*planning input"
```

Expected: PASS.

## Task 2: Resolve `previousSearch` In Operation Plans

**Files:**

- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/services/agent-mcp-recoverable-tool-error.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`
- Test: `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Write failing success-path service test**

Add this test near `materializes assetSelectionHandleId server-side before storing and reviewing a plan`:

```ts
it('materializes previousSearch source refs before storing and reviewing a plan', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const selectionHandleId = newUuid();
  const sourceRef = `asset-source:search:${selectionHandleId}` as const;
  const assetIds = Array.from({ length: 12 }, () => newUuid());
  const albumId = newUuid();
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
    summary: 'Add prior search photos',
    operations: [
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add prior search photos',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: albumId,
        assetSource: { kind: 'previousSearch', sourceRef },
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
      operations: [
        expect.objectContaining({
          assetIds,
          assetSource: undefined,
          assetSelectionHandleId: undefined,
        }),
      ],
    }),
  );
  expect(result.plan?.operations[0].assetIds).toHaveLength(12);
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      assetCount: 12,
      redactedRequestMetadata: expect.objectContaining({
        assetCount: 12,
        assetIds: assetIds.slice(0, 25),
        selectionHandles: [
          expect.objectContaining({
            id: selectionHandleId,
            sourceKind: 'previousSearch',
            sourceRef,
            assetCount: 12,
            sampleAssetIds: assetIds.slice(0, 25),
          }),
        ],
      }),
    }),
  );
});
```

- [ ] **Step 2: Run focused success-path test and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "previousSearch source refs"
```

Expected: FAIL because `assetSource` is not materialized.

- [ ] **Step 3: Add source-ref audit and recovery types**

In `server/src/types/agent-tool.types.ts`, import `AgentSearchSourceRef` from `src/types/agent-asset-source.types` and extend selection audit metadata:

```ts
selectionHandles?: Array<{
  id: string;
  sourceKind?: 'selectionHandle' | 'previousSearch';
  sourceRef?: AgentSearchSourceRef;
  assetCount: number;
  sampleAssetIds: string[];
}>;
```

Add:

```ts
export type AgentSourceRefRecoveryMetadata = {
  kind: 'invalid-source-ref';
  attemptedSourceRef: string;
  expectedSourceKind: 'search';
  instruction: string;
  expiredSourceRef?: string;
};
```

Extend `AgentToolOperationPlanResponseMetadata`:

```ts
| {
    sourceRefRecovery: AgentSourceRefRecoveryMetadata;
  };
```

- [ ] **Step 4: Add recoverable source-ref error helper**

In `server/src/services/agent-mcp-recoverable-tool-error.ts`, add:

```ts
export const invalidSourceRefError = (input: {
  toolName: AgentToolName;
  error: string;
  hint: string;
  recovery: AgentMcpJsonObject;
}) =>
  new AgentMcpRecoverableToolError({
    status: 'error',
    error: input.error,
    toolName: input.toolName,
    retryable: true,
    hint: input.hint,
    recovery: input.recovery,
  });
```

- [ ] **Step 5: Implement source-ref resolution**

In `server/src/services/agent-operation-plan.service.ts`:

Import needed types:

```ts
import { AgentAssetSourceInput, AgentSearchSourceRef } from 'src/types/agent-asset-source.types';
import { invalidSourceRefError } from 'src/services/agent-mcp-recoverable-tool-error';
import z from 'zod';
```

Extend `PlanningSelectionAudit`:

```ts
type PlanningSelectionAudit = Array<{
  id: string;
  sourceKind?: 'selectionHandle' | 'previousSearch';
  sourceRef?: AgentSearchSourceRef;
  assetCount: number;
  sampleAssetIds: string[];
}>;
```

Add helper methods near `resolveSelectionHandleAssetIds()`:

```ts
private async resolveAssetSourceAssetIds(
  auth: AuthDto,
  session: AgentSession,
  assetSource: AgentAssetSourceInput,
  selectionAudit: PlanningSelectionAudit,
) {
  if (assetSource.kind !== 'previousSearch') {
    throw new BadRequestException(`${assetSource.kind} assetSource is not supported for planning yet`);
  }

  return this.resolvePreviousSearchSourceRefAssetIds(auth, session, assetSource.sourceRef, selectionAudit);
}

private async resolvePreviousSearchSourceRefAssetIds(
  auth: AuthDto,
  session: AgentSession,
  sourceRef: AgentSearchSourceRef,
  selectionAudit: PlanningSelectionAudit,
) {
  const selectionHandleId = this.selectionHandleIdFromSearchSourceRef(sourceRef);
  const handle = await this.selectionHandleRepository.getValidForPlanning({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    now: new Date(),
  });

  if (!handle) {
    throw await this.createInvalidSourceRefError(auth, session, sourceRef, selectionHandleId);
  }

  selectionAudit.push({
    id: handle.id,
    sourceKind: 'previousSearch',
    sourceRef,
    assetCount: handle.assetCount,
    sampleAssetIds: handle.sampleAssetIds,
  });

  return handle.assetIds;
}

private selectionHandleIdFromSearchSourceRef(sourceRef: AgentSearchSourceRef) {
  return sourceRef.slice('asset-source:search:'.length);
}
```

Change materialization:

```ts
const materializedAssetIds = operation.assetSource
  ? await this.resolveAssetSourceAssetIds(auth, session, operation.assetSource, selectionAudit)
  : operation.assetSelectionHandleId
    ? await this.resolveSelectionHandleAssetIds(auth, session, operation.assetSelectionHandleId, selectionAudit)
    : (operation.assetIds ?? []);
```

When pushing prepared operations, clear all transient source inputs:

```ts
assetIds: materializedAssetIds,
assetSource: undefined,
assetSelectionHandleId: undefined,
```

Update `validateMaterializedAssetSelection()`:

```ts
if (!operation.assetSelectionHandleId && !operation.assetSource) {
  return;
}
```

Update `resolveSelectionHandleAssetIds()` audit push to preserve existing behavior with optional source kind:

```ts
selectionAudit.push({
  id: handle.id,
  sourceKind: 'selectionHandle',
  assetCount: handle.assetCount,
  sampleAssetIds: handle.sampleAssetIds,
});
```

- [ ] **Step 6: Add invalid source-ref recovery**

Add recoverable source-ref creation. Expired same-session handles may set `expiredSourceRef` to the attempted source ref string; do not include asset counts, sample IDs, source tool call IDs, owner details, or other handle metadata in this recovery object:

```ts
private async createInvalidSourceRefError(
  auth: AuthDto,
  session: AgentSession,
  toolName: AgentToolName,
  sourceRef: string,
) {
  const instruction =
    'Rerun searchAssets with createSelectionHandle true, then retry with the returned selectionHandle.sourceRef.';
  const recovery: AgentSourceRefRecoveryMetadata = {
    kind: 'invalid-source-ref',
    attemptedSourceRef: sourceRef,
    expectedSourceKind: 'search',
    instruction,
  };
  // If the backing handle is a same-session expired handle, set recovery.expiredSourceRef = sourceRef.

  return invalidSourceRefError({
    toolName,
    error: 'Source ref is expired or not available for this session',
    hint: recovery.expiredSourceRef ? `The attempted source ref is expired. ${instruction}` : instruction,
    recovery,
  });
}
```

In `recoverablePlanningResponseMetadata()`, sanitize source-ref recovery metadata with an allowlist. Do not persist the original recovery object, because a thrown recoverable error could carry extra fields like `assetIds`, `sampleAssetIds`, or owner metadata:

```ts
const sourceRefRecovery = this.sanitizeInvalidSourceRefRecoveryMetadata(recovery);
if (sourceRefRecovery) {
  return { sourceRefRecovery };
}
```

The sanitizer must return a newly constructed `AgentSourceRefRecoveryMetadata` object with only `kind`, `attemptedSourceRef`, `expectedSourceKind`, `instruction`, and optional string `expiredSourceRef`. Cross-session/cross-user refs have no `expiredSourceRef`.

- [ ] **Step 7: Run focused success-path test and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "previousSearch source refs"
```

Expected: PASS for the success-path test.

## Task 3: Source Ref Failure And Conflict Coverage

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify implementation only if tests fail.

- [ ] **Step 1: Write failing failure-mode tests**

Add tests near existing invalid selection-handle tests:

```ts
it('rejects expired previousSearch source refs with recoverable rerun-search guidance', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const selectionHandleId = newUuid();
  const sourceRef = `asset-source:search:${selectionHandleId}` as const;
  const expiredHandle = {
    id: selectionHandleId,
    assetCount: 8,
    sourceToolCallId: newUuid(),
    createdAt: new Date('2026-05-21T06:00:00.000Z'),
    expiresAt: new Date('2026-05-21T07:00:00.000Z'),
  };
  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
  selectionHandleRepository.getForRecovery.mockResolvedValue(expiredHandle);

  const thrown = await sut
    .proposeAlbumOperations(auth, session.id, {
      summary: 'Add prior search photos',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add prior search photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSource: { kind: 'previousSearch', sourceRef },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    })
    .catch((error: unknown) => error);

  expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
  const error = thrown as AgentMcpRecoverableToolError;
  expect(error.content).toMatchObject({
    status: 'error',
    error: 'Source ref is expired or not available for this session',
    retryable: true,
    recovery: {
      kind: 'invalid-source-ref',
      attemptedSourceRef: sourceRef,
      expectedSourceKind: 'search',
      expiredSourceRef: sourceRef,
    },
  });
  expect(error.content.hint).toContain('Rerun searchAssets');
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      redactedResponseMetadata: {
        sourceRefRecovery: error.content.recovery,
      },
    }),
  );
});

it('rejects cross-session or cross-user previousSearch source refs without exposing handle metadata', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const selectionHandleId = newUuid();
  const sourceRef = `asset-source:search:${selectionHandleId}` as const;
  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
  selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);

  const thrown = await sut
    .proposeAlbumOperations(auth, session.id, {
      summary: 'Add prior search photos',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add prior search photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSource: { kind: 'previousSearch', sourceRef },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    })
    .catch((error: unknown) => error);

  expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
  const error = thrown as AgentMcpRecoverableToolError;
  expect(error.content.recovery).toMatchObject({
    kind: 'invalid-source-ref',
    attemptedSourceRef: sourceRef,
    expectedSourceKind: 'search',
  });
  expect(error.content.recovery).not.toHaveProperty('expiredSourceRef');
  expect(JSON.stringify(error.content.recovery)).not.toContain('assetIds');
  expect(JSON.stringify(error.content.recovery)).not.toContain('sampleAssetIds');
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});
```

Add conflict/runtime guard tests:

```ts
it('rejects assetSource plus assetSelectionHandleId before plan persistence', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  sessionRepository.getById.mockResolvedValue(session);

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Invalid mixed source',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Invalid mixed source',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSource: { kind: 'previousSearch', sourceRef: `asset-source:search:${newUuid()}` },
          assetSelectionHandleId: newUuid(),
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        } as never,
      ],
    }),
  ).rejects.toThrow('Provide exactly one of assetSource, assetIds, or assetSelectionHandleId');

  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});
```

Add a DTO-bypass runtime guard for non-asset operations:

```ts
it('rejects source mechanisms on non-asset operations before plan persistence', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  sessionRepository.getById.mockResolvedValue(session);
  const dtoWithBypassedValidation = {
    summary: 'Create album with invalid source metadata',
    operations: [
      {
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal.',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'tmp-portugal',
        assetSource: { kind: 'previousSearch', sourceRef: `asset-source:search:${newUuid()}` },
        payload: { albumName: 'Portugal', description: '' },
        riskLevel: AgentOperationRiskLevel.Low,
        enabled: true,
      },
    ],
  } as unknown as AgentProposeAlbumOperationsDto;

  await expect(sut.proposeAlbumOperations(auth, session.id, dtoWithBypassedValidation)).rejects.toThrow(
    'Omit assetSource, assetIds, and assetSelectionHandleId for operations that do not operate on assets',
  );

  expect(selectionHandleRepository.getValidForPlanning).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});
```

Add a malformed-token regression so the service never hands a non-UUID token to the repository:

```ts
it('rejects previousSearch source refs with non-uuid backing tokens as recoverable source ref errors', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const sourceRef = 'asset-source:search:abc12345' as const;
  sessionRepository.getById.mockResolvedValue(session);

  const thrown = await sut
    .proposeAlbumOperations(auth, session.id, {
      summary: 'Add prior search photos',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add prior search photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSource: { kind: 'previousSearch', sourceRef },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    })
    .catch((error: unknown) => error);

  expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
  expect((thrown as AgentMcpRecoverableToolError).content.recovery).toMatchObject({
    kind: 'invalid-source-ref',
    attemptedSourceRef: sourceRef,
    expectedSourceKind: 'search',
  });
  expect(selectionHandleRepository.getValidForPlanning).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});
```

Add explicit existing-behavior regression:

```ts
it('keeps explicit assetIds and assetSelectionHandleId planning behavior unchanged', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const explicitAssetId = newUuid();
  const handleAssetId = newUuid();
  const albumId = newUuid();
  const selectionHandleId = newUuid();
  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: newUuid(),
    assetIds: [handleAssetId],
    assetCount: 1,
    sampleAssetIds: [handleAssetId],
    expiresAt: new Date('2026-05-21T12:30:00.000Z'),
    createdAt: now,
    updateId: newUuid(),
  });
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([explicitAssetId, handleAssetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([explicitAssetId, handleAssetId]));
  planRepository.createReplacementRevision.mockResolvedValue(
    makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({ type: AgentOperationType.AlbumAddAssets, targetId: albumId, assetIds: [explicitAssetId] }),
        makeOperation({ type: AgentOperationType.AlbumAddAssets, targetId: albumId, assetIds: [handleAssetId] }),
      ],
    }),
  );

  await sut.proposeAlbumOperations(auth, session.id, {
    summary: 'Add existing source photos',
    operations: [
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add explicit photo',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: albumId,
        assetIds: [explicitAssetId],
        payload: {},
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
      },
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add handle photo',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: albumId,
        assetSelectionHandleId: selectionHandleId,
        payload: {},
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
      },
    ],
  });

  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      operations: [
        expect.objectContaining({ assetIds: [explicitAssetId], assetSource: undefined }),
        expect.objectContaining({ assetIds: [handleAssetId], assetSource: undefined }),
      ],
    }),
  );
});
```

- [ ] **Step 2: Run failure-mode focused tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "previousSearch|mixed source|materializes assetSelectionHandleId"
```

Expected: FAIL before implementation of failure handling and conflict guard.

- [ ] **Step 3: Add runtime exact-one validation**

Add a private method to `AgentOperationPlanService`:

```ts
private validateAssetSourceMechanism(operation: AgentAlbumOperationInput) {
  const validation = validateAgentAssetSourceMechanismCount(operation);
  if (!validation.valid) {
    throw new BadRequestException(validation.message);
  }
}
```

Import `validateAgentAssetSourceMechanismCount` and `validateNoAgentAssetSourceMechanisms`.

Call it before materialization only for asset-bearing operations. A practical helper:

```ts
private isAssetBearingOperation(type: AgentOperationType) {
  return [
    AgentOperationType.AlbumAddAssets,
    AgentOperationType.AlbumRemoveAssets,
    AgentOperationType.AlbumSetCover,
    AgentOperationType.SpaceAddAssets,
    AgentOperationType.SpaceRemoveAssets,
    AgentOperationType.AssetRotate,
    AgentOperationType.AssetSetFavorite,
    AgentOperationType.AssetSetArchive,
    AgentOperationType.AssetAddTag,
    AgentOperationType.AssetRemoveTag,
  ].includes(type);
}
```

In `prepareOperations()`:

```ts
if (this.isAssetBearingOperation(operation.type)) {
  this.validateAssetSourceMechanism(operation);
}
```

Do not require source mechanisms for create/update/member operations.
If a create/update/member operation includes any source mechanism anyway, reject it before repository lookup or plan persistence:

```ts
if (!this.isAssetBearingOperation(operation.type)) {
  const validation = validateNoAgentAssetSourceMechanisms(operation);
  if (!validation.valid) {
    throw new BadRequestException(validation.message);
  }
  return operation.assetIds ?? [];
}
```

In `selectionHandleIdFromSearchSourceRef()`, validate the stripped token before repository calls:

```ts
private selectionHandleIdFromSearchSourceRef(sourceRef: AgentSearchSourceRef) {
  const selectionHandleId = sourceRef.slice('asset-source:search:'.length);
  if (!z.uuidv4().safeParse(selectionHandleId).success) {
    return null;
  }

  return selectionHandleId;
}
```

Update `resolvePreviousSearchSourceRefAssetIds()` accordingly:

```ts
const selectionHandleId = this.selectionHandleIdFromSearchSourceRef(sourceRef);
if (!selectionHandleId) {
  throw this.createInvalidSourceRefErrorFromRecovery(sourceRef);
}
```

Extract the shared recoverable error construction so both malformed-token and unavailable-handle paths return the same `invalid-source-ref` recovery shape.

- [ ] **Step 4: Run focused failure tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "previousSearch|mixed source|materializes assetSelectionHandleId"
```

Expected: PASS.

## Task 4: MCP Source-Ref Recoverable Serialization

**Files:**

- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Write the MCP serialization test**

Add a test near existing recoverable MCP tool result tests:

```ts
it('returns recoverable invalid source ref tool errors as MCP tool results', async () => {
  const sourceRef = `asset-source:search:${factory.uuid()}`;
  const recoverableError = new AgentMcpRecoverableToolError({
    status: 'error',
    error: 'Source ref is expired or not available for this session',
    toolName: AgentToolName.ProposeAlbumOperations,
    retryable: true,
    hint: 'Rerun searchAssets with createSelectionHandle true, then retry with the returned selectionHandle.sourceRef.',
    recovery: {
      kind: 'invalid-source-ref',
      attemptedSourceRef: sourceRef,
      expectedSourceKind: 'search',
      instruction:
        'Rerun searchAssets with createSelectionHandle true, then retry with the returned selectionHandle.sourceRef.',
    },
  });
  operationPlanService.proposeAlbumOperations.mockRejectedValue(recoverableError);

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
      summary: 'Add prior search photos.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add prior search photos.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          assetSource: { kind: 'previousSearch', sourceRef },
          payload: {},
        },
      ],
    }),
  )) as AgentMcpSuccessResponse;

  expect(response).not.toHaveProperty('error');
  const result = response.result as AgentMcpToolCallResult;
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    status: 'error',
    retryable: true,
    recovery: {
      kind: 'invalid-source-ref',
      attemptedSourceRef: sourceRef,
      expectedSourceKind: 'search',
    },
  });
  expect(result.content[0].text).toContain(recoverableError.content.hint);
});
```

- [ ] **Step 2: Run the focused MCP test**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts -t "invalid source ref"
```

Expected: PASS or baseline pass because MCP recoverable serialization is generic. Keep the test as regression coverage for the new recovery shape.

## Task 5: Full Slice Verification And Commit

**Files:**

- Verify all modified files.

- [ ] **Step 1: Run focused affected suites**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run source-contract regression suites**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-asset-source.dto.spec.ts src/types/agent-asset-source.types.spec.ts src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run static checks**

Run:

```bash
pnpm --dir server run lint
pnpm --dir server exec tsc --noEmit --pretty false
git diff --check
```

Expected: PASS.

- [ ] **Step 4: Confirm Slice 4 edge cases**

Inspect tests and diff to verify:

- A plan created from `previousSearch.sourceRef` persists materialized `assetIds`.
- Expired source refs return recoverable rerun-search guidance.
- Cross-session/cross-user source refs do not expose handle metadata or asset IDs.
- Existing explicit `assetIds` and `assetSelectionHandleId` behavior remains unchanged.
- Operations with `assetSource` plus another source mechanism are rejected.
- Asset-bearing operations with no source mechanism are rejected.
- Unsupported source kinds are rejected by DTO validation rather than advertised as schema-valid.
- DTO-bypassed source mechanisms on non-asset operations are rejected at runtime.
- Source-ref recovery metadata is allowlisted before audit persistence.
- Planning audit metadata contains compact source information and no full asset ID dump for source-backed plans.

- [ ] **Step 5: Commit and push**

Run:

```bash
git status --short
git add server/src/types/agent-operation.types.ts \
  server/src/types/agent-tool.types.ts \
  server/src/dtos/agent-operation.dto.ts \
  server/src/services/agent-mcp-recoverable-tool-error.ts \
  server/src/services/agent-operation-plan.service.ts \
  server/src/dtos/agent-operation.dto.spec.ts \
  server/src/services/agent-operation-plan.service.spec.ts \
  server/src/services/agent-mcp.service.spec.ts \
  docs/superpowers/plans/2026-05-22-pi-agent-declarative-planning-sources-slice-4.md
git commit -m "feat(server): plan from previous Pi search source"
git push
```

Expected: commit succeeds and branch `explore/pi-agent-brainstorm` is pushed.

## Plan Self-Review

- TDD order is explicit for DTO, service success path, and service failure paths.
- Slice 4 spec coverage is complete:
  - previous search source refs materialize into persisted plans;
  - expired/cross-session/cross-user source refs are rejected safely;
  - existing `assetIds` and `assetSelectionHandleId` behavior remains covered;
  - multiple or missing source mechanisms are rejected;
  - unsupported source kinds are rejected at the planning DTO boundary;
  - DTO-bypassed source mechanisms on non-asset operations are rejected at runtime;
  - source-ref recovery metadata is sanitized before audit persistence;
  - request audit metadata records compact source details without full source-backed asset dumps.
- The plan does not implement future slices: no `assetSource.search`, no declarative filter resolver, and no high-level workflow tools.
