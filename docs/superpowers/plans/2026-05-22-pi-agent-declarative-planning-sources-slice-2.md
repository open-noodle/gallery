# Pi Agent Declarative Planning Sources Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make wrong-domain UUID mistakes recoverable so Pi gets a precise retry instruction instead of a generic access failure.

**Architecture:** Reuse the Slice 1 ID-domain vocabulary and the existing MCP recoverable error pathway. Add one shared wrong-domain recoverable error helper, then call it from the existing read-tool validation and selection-handle recovery paths without introducing a new persistence table or declarative planning behavior from later slices.

**Tech Stack:** NestJS services, TypeScript, Vitest, Zod DTO/type contracts, existing agent MCP recoverable errors.

---

## Scope

This is Slice 2 from `docs/superpowers/specs/2026-05-22-pi-agent-declarative-planning-sources-design.md`.

Implement only:

- `readAssetMetadata(assetIds: [personId])` detects accessible same-user/same-session person IDs and returns a recoverable `wrong_id_domain` error with `expectedDomain: "asset"` and `receivedDomain: "person"`.
- `searchAssets.filters.personIds` detects accessible asset IDs in `personIds` and returns a recoverable filter error with `expectedDomain: "person"` and `receivedDomain: "asset"`.
- `proposeAlbumOperations.assetSelectionHandleId` detects accessible asset/person IDs passed as a selection handle and returns a recoverable wrong-domain/invalid-handle error.
- Unknown UUIDs and cross-user IDs keep the existing generic inaccessible/not-found behavior and do not reveal names, ownership, or existence.

Do not implement `assetSource`, `sourceRef`, declarative filter resolution, or high-level workflow tools in this slice.

## Files

- Modify: `server/src/types/agent-tool.types.ts`
  - Add `AgentWrongIdDomainRecoveryMetadata`.
  - Extend `AgentToolOperationPlanResponseMetadata` so planning denied audits can record `wrongIdDomainRecovery`.
- Modify: `server/src/services/agent-mcp-recoverable-tool-error.ts`
  - Add `wrongIdDomainError()` helper alongside `invalidSelectionHandleError()`.
- Modify: `server/src/services/agent-tool.service.ts`
  - Import `wrongIdDomainError` and `AgentIdDomain`.
  - Add private helpers for detecting accessible wrong-domain IDs.
  - Throw `wrongIdDomainError()` from `validateAssetAccess()` and `validateSearchRequest()` only when the attempted UUID is readable in the other domain for this user/session.
- Modify: `server/src/services/agent-operation-plan.service.ts`
  - Import `wrongIdDomainError` and wrong-domain recovery metadata.
  - Add same-user accessible asset/person detection before falling back to invalid selection-handle recovery.
  - Store wrong-domain recovery metadata in denied planning audit responses.
- Test: `server/src/services/agent-tool.service.spec.ts`
  - Add wrong-domain read and search tests.
  - Add unknown/cross-user non-disclosure regression tests.
  - Import `AgentMcpRecoverableToolError` from `src/services/agent-mcp-recoverable-tool-error`.
- Test: `server/src/services/agent-operation-plan.service.spec.ts`
  - Add wrong-domain selection-handle tests.
  - Add cross-user non-disclosure regression test.
- Test: `server/src/services/agent-mcp.service.spec.ts`
  - Add a focused MCP serialization test for `wrong_id_domain` recoverable errors.

## Recovery Shape

Use this exact recovery metadata shape:

```ts
export type AgentWrongIdDomainRecoveryMetadata = {
  kind: 'wrong_id_domain';
  field: string;
  expectedDomain: AgentIdDomain;
  receivedDomain: AgentIdDomain;
  instruction: string;
};
```

Do not include the attempted UUID, object label, owner, or asset/person metadata in this recovery shape. Keeping it generic prevents cross-user or inaccessible IDs from becoming an enumeration channel.

Expected MCP structured content shape:

```json
{
  "status": "error",
  "error": "That value is a person ID, not an asset ID.",
  "toolName": "readAssetMetadata",
  "retryable": true,
  "hint": "Use asset IDs returned by searchAssets, or use assetSource.search once available.",
  "recovery": {
    "kind": "wrong_id_domain",
    "field": "assetIds",
    "expectedDomain": "asset",
    "receivedDomain": "person",
    "instruction": "Use asset IDs returned by searchAssets, or use assetSource.search once available."
  }
}
```

## Task 1: Add Recoverable Wrong-Domain Error Contract

**Files:**

- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/services/agent-mcp-recoverable-tool-error.ts`
- Test: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Write the failing MCP serialization test**

Add this test next to `returns recoverable invalid selection handle tool errors as MCP tool results` in `server/src/services/agent-mcp.service.spec.ts`:

```ts
it('returns recoverable wrong-domain tool errors as MCP tool results', async () => {
  const recoverableError = new AgentMcpRecoverableToolError({
    status: 'error',
    error: 'That value is a person ID, not an asset ID.',
    toolName: AgentToolName.ReadAssetMetadata,
    retryable: true,
    hint: 'Use asset IDs returned by searchAssets, or use assetSource.search once available.',
    recovery: {
      kind: 'wrong_id_domain',
      field: 'assetIds',
      expectedDomain: 'asset',
      receivedDomain: 'person',
      instruction: 'Use asset IDs returned by searchAssets, or use assetSource.search once available.',
    },
  });
  toolService.readAssetMetadata.mockRejectedValue(recoverableError);

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ReadAssetMetadata, {
      assetIds: [factory.uuid()],
    }),
  )) as AgentMcpSuccessResponse;

  expect(response).not.toHaveProperty('error');
  const result = response.result as AgentMcpToolCallResult;
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    status: 'error',
    retryable: true,
    error: 'That value is a person ID, not an asset ID.',
    recovery: {
      kind: 'wrong_id_domain',
      field: 'assetIds',
      expectedDomain: 'asset',
      receivedDomain: 'person',
    },
  });
  expect(result.content[0].text).toContain(recoverableError.content.hint);
  expect(JSON.stringify(response)).not.toContain('Internal error');
});
```

- [ ] **Step 2: Run the focused test and verify it is red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts -t "wrong-domain"
```

Expected: FAIL before implementation if TypeScript cannot import/use the new helper or if the test is temporarily wired to `wrongIdDomainError()` before the helper exists. If this exact test passes because `AgentMcpRecoverableToolError` already serializes arbitrary recovery metadata, keep the result as baseline evidence and continue; the later service tests must fail red before implementation.

- [ ] **Step 3: Add the wrong-domain metadata type**

In `server/src/types/agent-tool.types.ts`, import `AgentIdDomain` from `src/types/agent-asset-source.types` if it is not already imported, then add:

```ts
export type AgentWrongIdDomainRecoveryMetadata = {
  kind: 'wrong_id_domain';
  field: string;
  expectedDomain: AgentIdDomain;
  receivedDomain: AgentIdDomain;
  instruction: string;
};
```

Extend `AgentToolOperationPlanResponseMetadata`:

```ts
export type AgentToolOperationPlanResponseMetadata =
  | {
      planId: string | null;
      operationIds: string[];
    }
  | {
      selectionHandleRecovery: AgentSelectionHandleRecoveryMetadata;
    }
  | {
      wrongIdDomainRecovery: AgentWrongIdDomainRecoveryMetadata;
    };
```

- [ ] **Step 4: Add the wrong-domain error helper**

In `server/src/services/agent-mcp-recoverable-tool-error.ts`, import `AgentIdDomain` and add a small label formatter plus the helper:

```ts
const agentIdDomainLabel = (domain: AgentIdDomain) => {
  switch (domain) {
    case 'selectionHandle':
      return 'selection handle';
    case 'sourceRef':
      return 'source reference';
    default:
      return domain;
  }
};

const articleFor = (label: string) => (/^[aeiou]/i.test(label) ? 'an' : 'a');

export const wrongIdDomainError = (input: {
  toolName: AgentToolName;
  field: string;
  expectedDomain: AgentIdDomain;
  receivedDomain: AgentIdDomain;
  instruction: string;
}) => {
  const receivedLabel = agentIdDomainLabel(input.receivedDomain);
  const expectedLabel = agentIdDomainLabel(input.expectedDomain);

  return new AgentMcpRecoverableToolError({
    status: 'error',
    error: `That value is ${articleFor(receivedLabel)} ${receivedLabel} ID, not ${articleFor(expectedLabel)} ${expectedLabel} ID.`,
    toolName: input.toolName,
    retryable: true,
    hint: input.instruction,
    recovery: {
      kind: 'wrong_id_domain',
      field: input.field,
      expectedDomain: input.expectedDomain,
      receivedDomain: input.receivedDomain,
      instruction: input.instruction,
    },
  });
};
```

- [ ] **Step 5: Run the focused MCP test and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts -t "wrong-domain"
```

Expected: PASS.

## Task 2: Detect Person IDs Passed As Asset IDs

**Files:**

- Modify: `server/src/services/agent-tool.service.ts`
- Test: `server/src/services/agent-tool.service.spec.ts`

- [ ] **Step 1: Write failing tests for `readAssetMetadata` wrong-domain behavior**

Add these tests near the existing `readAssetMetadata` access-denial tests in `server/src/services/agent-tool.service.spec.ts`:

```ts
it('readAssetMetadata returns a recoverable wrong-domain error when assetIds contains a readable person id', async () => {
  const auth = AuthFactory.create();
  const personId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
  });
  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
  accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
  accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personId]));
  accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

  const thrown = await sut
    .readAssetMetadata(auth, session.id, { assetIds: [personId] })
    .catch((error: unknown) => error);

  expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
  expect(thrown).toMatchObject({
    content: {
      error: 'That value is a person ID, not an asset ID.',
      retryable: true,
      recovery: {
        kind: 'wrong_id_domain',
        field: 'assetIds',
        expectedDomain: 'asset',
        receivedDomain: 'person',
      },
    },
  });
  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
});

it('readAssetMetadata keeps unknown or cross-user ids as generic inaccessible denials', async () => {
  const auth = AuthFactory.create();
  const unknownId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
  });
  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
  accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
  accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());
  accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

  const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [unknownId] });

  expect(result).toEqual({
    status: 'denied',
    reason: 'One or more assets are not accessible',
    toolCall: expect.objectContaining({
      status: AgentToolCallStatus.Denied,
      error: 'One or more assets are not accessible',
    }),
  });
  expect(JSON.stringify(result)).not.toContain('wrong_id_domain');
  expect(JSON.stringify(result)).not.toContain('person');
  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test and verify it is red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "readAssetMetadata.*wrong-domain|cross-user ids"
```

Expected: FAIL because readable person IDs in `assetIds` currently produce the generic denial.

- [ ] **Step 3: Import recoverable error types and helper**

In `server/src/services/agent-tool.service.ts`, add:

```ts
import { wrongIdDomainError } from 'src/services/agent-mcp-recoverable-tool-error';
import { AgentIdDomain } from 'src/types/agent-asset-source.types';
```

- [ ] **Step 4: Pass the correct tool name into asset access validation**

Update the descriptor validation calls so the helper can report the actual tool that was called:

```ts
// readAssetMetadataDescriptor()
validateAccess: (auth, session, request) =>
  this.validateAssetAccess(auth, session, request.assetIds ?? [], AgentToolName.ReadAssetMetadata),

// assetReferenceDescriptor()
validateAccess: (auth, session, request) =>
  this.validateAssetAccess(auth, session, request.assetIds ?? [], options.toolName),
```

- [ ] **Step 5: Add a generic wrong-domain detector helper**

Add this helper near `validateAssetAccess()`:

```ts
private async getReadableWrongDomain(
  auth: AuthDto,
  session: AgentSession,
  ids: string[],
  expectedDomain: AgentIdDomain,
): Promise<AgentIdDomain | null> {
  if (ids.length === 0) {
    return null;
  }

  const requested = new Set(ids);

  if (expectedDomain !== 'asset') {
    const readableAssetIds = await this.getReadableAssetIds(auth, session.permissionPlanSnapshot, ids);
    if (readableAssetIds.size > 0 && readableAssetIds.size === requested.size) {
      return 'asset';
    }
  }

  if (expectedDomain !== 'person') {
    const readablePersonIds = await this.getReadablePersonIds(auth, session.permissionPlanSnapshot, requested);
    if (readablePersonIds.size > 0 && readablePersonIds.size === requested.size) {
      return 'person';
    }
  }

  return null;
}
```

This helper intentionally returns a domain only when every requested UUID is readable in that wrong domain. Mixed unknown/wrong-domain sets remain generic to avoid partial enumeration leaks.

- [ ] **Step 6: Throw recoverable error from `validateAssetAccess()`**

Change `validateAssetAccess()` to:

```ts
private async validateAssetAccess(
  auth: AuthDto,
  session: AgentSession,
  assetIds: string[],
  toolName: AgentToolName,
): Promise<string | null> {
  const readableIds = await this.getReadableAssetIds(auth, session.permissionPlanSnapshot, assetIds);
  if (readableIds.size === new Set(assetIds).size) {
    return null;
  }

  const wrongDomain = await this.getReadableWrongDomain(auth, session, assetIds, 'asset');
  if (wrongDomain) {
    throw wrongIdDomainError({
      toolName,
      field: 'assetIds',
      expectedDomain: 'asset',
      receivedDomain: wrongDomain,
      instruction: 'Use asset IDs returned by searchAssets, or use assetSource.search once available.',
    });
  }

  return 'One or more assets are not accessible';
}
```

Do not add object names or IDs to the error.

- [ ] **Step 7: Run the focused tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "readAssetMetadata.*wrong-domain|cross-user ids"
```

Expected: PASS.

## Task 3: Detect Asset IDs Passed As Person Filters

**Files:**

- Modify: `server/src/services/agent-tool.service.ts`
- Test: `server/src/services/agent-tool.service.spec.ts`

- [ ] **Step 1: Write failing tests for `searchAssets.filters.personIds` wrong-domain behavior**

Add these tests near `denies inaccessible people filters before repository execution` in `server/src/services/agent-tool.service.spec.ts`:

```ts
it('searchAssets returns a recoverable wrong-domain error when personIds contains a readable asset id', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
  });
  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());
  accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));

  const thrown = await sut
    .searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { personIds: [assetId] },
      limit: 5,
      page: 1,
      order: 'desc',
    })
    .catch((error: unknown) => error);

  expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
  expect(thrown).toMatchObject({
    content: {
      retryable: true,
      recovery: {
        kind: 'wrong_id_domain',
        field: 'filters.personIds',
        expectedDomain: 'person',
        receivedDomain: 'asset',
      },
    },
  });
  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
});

it('searchAssets keeps unknown or cross-user personIds as generic inaccessible filter denials', async () => {
  const auth = AuthFactory.create();
  const unknownId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
  });
  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());
  accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
  accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());

  const result = await sut.searchAssets(auth, session.id, {
    mode: 'metadata',
    filters: { personIds: [unknownId] },
    limit: 5,
    page: 1,
    order: 'desc',
  });

  expect(result).toEqual({
    status: 'denied',
    reason: 'One or more search filters are not accessible',
    toolCall: expect.objectContaining({
      status: AgentToolCallStatus.Denied,
      error: 'One or more search filters are not accessible',
    }),
  });
  expect(JSON.stringify(result)).not.toContain('wrong_id_domain');
  expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test and verify it is red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "personIds contains a readable asset id|cross-user personIds"
```

Expected: FAIL because `personIds` currently returns the generic inaccessible filter denial.

- [ ] **Step 3: Throw recoverable error from the `personIds` branch in `validateSearchRequest()`**

Replace the current person filter denial block with:

```ts
const personIds = filters.personIds ? new Set(filters.personIds) : new Set<string>();
if (personIds.size > 0) {
  const readablePersonIds = await this.getReadablePersonIds(auth, session.permissionPlanSnapshot, personIds);
  if (readablePersonIds.size !== personIds.size) {
    const wrongDomain = await this.getReadableWrongDomain(auth, session, [...personIds], 'person');
    if (wrongDomain) {
      throw wrongIdDomainError({
        toolName: AgentToolName.SearchAssets,
        field: 'filters.personIds',
        expectedDomain: 'person',
        receivedDomain: wrongDomain,
        instruction: 'Use person IDs returned by resolveAssetSearchFilters, not asset IDs from searchAssets.',
      });
    }

    return 'One or more search filters are not accessible';
  }
}
```

Keep existing tag, album, space, and dropped-resolver validation unchanged.

- [ ] **Step 4: Run the focused tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "personIds contains a readable asset id|cross-user personIds"
```

Expected: PASS.

## Task 4: Detect Asset/Person IDs Passed As Selection Handles

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Test: `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Write failing tests for `assetSelectionHandleId` wrong-domain behavior**

Add these tests near the existing invalid selection-handle recovery tests in `server/src/services/agent-operation-plan.service.spec.ts`:

```ts
it('returns wrong-domain recovery when assetSelectionHandleId is a readable asset id', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const assetId = newUuid();
  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));

  const thrown = await sut
    .proposeAlbumOperations(auth, session.id, {
      summary: 'Add selected photos',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add selected photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSelectionHandleId: assetId,
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    })
    .catch((error: unknown) => error);

  expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
  expect(thrown).toMatchObject({
    content: {
      recovery: {
        kind: 'wrong_id_domain',
        field: 'operations[].assetSelectionHandleId',
        expectedDomain: 'selectionHandle',
        receivedDomain: 'asset',
      },
    },
  });
  expect(selectionHandleRepository.listValidForRecovery).not.toHaveBeenCalled();
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      redactedResponseMetadata: {
        wrongIdDomainRecovery: expect.objectContaining({
          kind: 'wrong_id_domain',
          receivedDomain: 'asset',
        }),
      },
    }),
  );
});

it('returns wrong-domain recovery when assetSelectionHandleId is a readable person id', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const personId = newUuid();
  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set());
  accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personId]));
  accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

  const thrown = await sut
    .proposeAlbumOperations(auth, session.id, {
      summary: 'Add selected photos',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add selected photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSelectionHandleId: personId,
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    })
    .catch((error: unknown) => error);

  expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
  expect(thrown).toMatchObject({
    content: {
      recovery: {
        kind: 'wrong_id_domain',
        field: 'operations[].assetSelectionHandleId',
        expectedDomain: 'selectionHandle',
        receivedDomain: 'person',
      },
    },
  });
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});

it('keeps cross-user assetSelectionHandleId values on the existing invalid handle recovery path', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const crossUserAssetId = newUuid();
  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
  selectionHandleRepository.listValidForRecovery.mockResolvedValue([]);
  selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set());
  accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());

  const thrown = await sut
    .proposeAlbumOperations(auth, session.id, {
      summary: 'Add selected photos',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add selected photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSelectionHandleId: crossUserAssetId,
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    })
    .catch((error: unknown) => error);

  expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
  expect(thrown).toMatchObject({
    content: {
      recovery: {
        kind: 'invalid-selection-handle',
        availableSelectionHandles: [],
      },
    },
  });
  expect(JSON.stringify(thrown)).not.toContain('wrong_id_domain');
  expect(JSON.stringify(thrown)).not.toContain('assetSelectionHandleId is an asset');
  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused tests and verify they are red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "assetSelectionHandleId"
```

Expected: FAIL because readable asset/person IDs currently fall through to invalid selection-handle recovery.

- [ ] **Step 3: Import types and helper**

In `server/src/services/agent-operation-plan.service.ts`, add imports:

```ts
import { AgentIdDomain } from 'src/types/agent-asset-source.types';
import {
  invalidSelectionHandleError,
  isAgentMcpRecoverableToolError,
  wrongIdDomainError,
} from 'src/services/agent-mcp-recoverable-tool-error';
```

Also import `AgentWrongIdDomainRecoveryMetadata` from `src/types/agent-tool.types`.

- [ ] **Step 4: Add same-user readable domain checks**

Add helpers near `createInvalidSelectionHandleError()`:

```ts
private async getWrongSelectionHandleIdDomain(
  auth: AuthDto,
  session: AgentSession,
  id: string,
): Promise<Extract<AgentIdDomain, 'asset' | 'person'> | null> {
  const requested = new Set([id]);
  const readableAssetIds = await this.getReadableAssetIds(auth, session, [id]);
  if (readableAssetIds.has(id)) {
    return 'asset';
  }

  const readablePersonIds = await this.getReadablePersonIds(auth, session, requested);
  if (readablePersonIds.has(id)) {
    return 'person';
  }

  return null;
}

private async getReadablePersonIds(auth: AuthDto, session: AgentSession, personIds: Set<string>) {
  const readableIds = new Set<string>();
  const plan = session.permissionPlanSnapshot;

  if (session.permissionPlanSnapshot.assetScope.owned) {
    const ownerPersonIds = await this.accessRepository.person.checkOwnerAccess(auth.user.id, personIds);
    for (const id of ownerPersonIds) {
      if (personIds.has(id)) {
        readableIds.add(id);
      }
    }
  }

  if (plan.assetScope.sharedSpaces) {
    const sharedPersonIds = await this.accessRepository.person.checkSharedSpaceAccess(auth.user.id, personIds);
    for (const id of sharedPersonIds) {
      if (personIds.has(id)) {
        readableIds.add(id);
      }
    }
  }

  return readableIds;
}
```

This deliberately reuses the service's existing `getReadableAssetIds()` so owner/shared/locked/agent-readable filtering stays identical to normal plan validation.

- [ ] **Step 5: Return wrong-domain recoverable error before invalid handle recovery**

At the beginning of `createInvalidSelectionHandleError()`, before loading available selection handles, add:

```ts
const wrongDomain = await this.getWrongSelectionHandleIdDomain(auth, session, id);
if (wrongDomain) {
  return wrongIdDomainError({
    toolName: AgentToolName.ProposeAlbumOperations,
    field: 'operations[].assetSelectionHandleId',
    expectedDomain: 'selectionHandle',
    receivedDomain: wrongDomain,
    instruction:
      'Use a same-session selection handle returned by searchAssets with createSelectionHandle true, or use assetSource.search once available.',
  });
}
```

- [ ] **Step 6: Store wrong-domain recovery metadata in planning denied audits**

Update the helper that currently recognizes invalid selection-handle recovery metadata:

```ts
const redactedResponseMetadata =
  isAgentMcpRecoverableToolError(error) && this.isInvalidSelectionHandleRecoveryMetadata(error.content.recovery)
    ? { selectionHandleRecovery: error.content.recovery }
    : isAgentMcpRecoverableToolError(error) && this.isWrongIdDomainRecoveryMetadata(error.content.recovery)
      ? { wrongIdDomainRecovery: error.content.recovery }
      : null;
```

Add:

```ts
private isWrongIdDomainRecoveryMetadata(
  recovery: Record<string, unknown>,
): recovery is AgentWrongIdDomainRecoveryMetadata {
  return recovery.kind === 'wrong_id_domain';
}
```

- [ ] **Step 7: Run the focused tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts -t "assetSelectionHandleId"
```

Expected: PASS.

## Task 5: Full Slice Verification And Commit

**Files:**

- Verify all files modified in this slice.

- [ ] **Step 1: Run focused service suites**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run existing adjacent DTO/type regression suites**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-asset-source.dto.spec.ts src/types/agent-asset-source.types.spec.ts src/dtos/agent-operation.dto.spec.ts src/dtos/agent-tool.dto.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run static checks**

Run:

```bash
pnpm --dir server run lint
pnpm --dir server exec tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 4: Confirm security edge cases**

Inspect the test output and changed assertions to verify:

- Unknown UUIDs still return generic inaccessible/not-found responses.
- Cross-user IDs do not produce `wrong_id_domain`.
- Recoverable wrong-domain metadata does not include attempted UUIDs, object names, owners, asset metadata, person metadata, or sample IDs.
- Existing invalid selection-handle recovery still works for expired handles, generated example handles, and valid same-session recovery suggestions.

- [ ] **Step 5: Commit and push**

Run:

```bash
git status --short
git add server/src/types/agent-tool.types.ts \
  server/src/services/agent-mcp-recoverable-tool-error.ts \
  server/src/services/agent-tool.service.ts \
  server/src/services/agent-operation-plan.service.ts \
  server/src/services/agent-tool.service.spec.ts \
  server/src/services/agent-operation-plan.service.spec.ts \
  server/src/services/agent-mcp.service.spec.ts \
  docs/superpowers/plans/2026-05-22-pi-agent-declarative-planning-sources-slice-2.md
git commit -m "fix(server): recover wrong-domain Pi tool ids"
git push
```

Expected: commit succeeds and branch `explore/pi-agent-brainstorm` is pushed.

## Plan Self-Review

- TDD order is explicit for every behavior: each task starts with failing tests, focused red command, implementation, focused green command.
- Slice 2 spec coverage is complete:
  - `readAssetMetadata(assetIds: [personId])` covered.
  - `searchAssets.filters.personIds` with asset ID covered.
  - `proposeAlbumOperations.assetSelectionHandleId` with asset/person ID covered.
  - Unknown UUIDs covered.
  - Cross-user non-disclosure covered by no readable access mocks and assertions that `wrong_id_domain` is absent.
- The plan intentionally avoids future slices: no `assetSource`, no source refs, no declarative filters, no workflow tools.
- Security-sensitive metadata is constrained to domain names, field path, and retry instruction only.
