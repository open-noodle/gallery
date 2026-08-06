# Pi Agent MCP Invalid Selection Handle Recovery Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Pi calls `proposeAlbumOperations` with an invalid `assetSelectionHandleId`, return a recoverable MCP tool error with safe same-session recovery hints instead of a generic internal error, while preserving denied audit records and never creating or auto-substituting a plan.

**Architecture:** Keep handle validation in `AgentOperationPlanService`, add repository lookups for compact same-session handle recovery metadata, and teach `AgentMcpService` to serialize explicit recoverable tool errors as `isError` tool results. Do not infer or substitute handles server-side.

**Tech Stack:** TypeScript, Nest services, Kysely repository, Vitest unit tests, existing medium repository test harness.

---

## Spec Context

Spec: `docs/superpowers/specs/2026-05-22-pi-agent-mcp-handle-filter-hardening-design.md`

Slice 3 requires:

- Detect known generated-example selection handle IDs used as `assetSelectionHandleId`.
- Return a compact, recoverable invalid-handle response.
- List only valid handles from the same session/user as recovery hints.
- Do not list cross-session handles.
- Do not suggest expired handles as usable.
- If the attempted handle is an expired same-session handle, include compact expired-handle metadata and tell Pi to rerun `searchAssets`.
- Invalid UUID values should remain ordinary schema validation errors, without recovery metadata.
- No auto-substitution occurs and no plan row is created.

## Files

- Modify: `server/src/repositories/agent-selection-handle.repository.ts`
- Test: `server/test/medium/specs/repositories/agent-selection-handle.repository.spec.ts`
- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/types/agent-mcp.types.ts`
- Add: `server/src/services/agent-mcp-recoverable-tool-error.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`
- Test: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.ts`
- Test: `server/src/services/agent-mcp.service.spec.ts`

## Baseline

- [ ] **Step 1: Confirm current Slice 2 tests are green**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts
pnpm --dir server test src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp.service.spec.ts
```

Expected: all tests pass before Slice 3 edits. Current MCP prompt/docs/contract baseline is 127 passing tests.

---

## Task 1: Add Selection Handle Recovery Repository Queries

**Files:**

- Modify: `server/src/repositories/agent-selection-handle.repository.ts`
- Test: `server/test/medium/specs/repositories/agent-selection-handle.repository.spec.ts`

- [ ] **Step 1: Write failing medium repository tests**

Add tests near the existing `getValidForPlanning` coverage:

```ts
it('lists only valid same-session handles for recovery without asset ids', async () => {
  const { ctx, credentialRepository, sessionRepository, sut } = setup();
  const { user, session } = await createSession(ctx, credentialRepository, sessionRepository);
  const other = await createSession(ctx, credentialRepository, sessionRepository);
  const now = new Date('2026-05-22T08:00:00.000Z');

  const older = await sut.create({
    sessionId: session.id,
    userId: user.id,
    sourceToolCallId: factory.uuid(),
    assetIds: [factory.uuid(), factory.uuid()],
    expiresAt: new Date('2026-05-22T09:00:00.000Z'),
  });
  const newer = await sut.create({
    sessionId: session.id,
    userId: user.id,
    sourceToolCallId: factory.uuid(),
    assetIds: [factory.uuid(), factory.uuid(), factory.uuid()],
    expiresAt: new Date('2026-05-22T10:00:00.000Z'),
  });
  await sut.create({
    sessionId: session.id,
    userId: user.id,
    sourceToolCallId: factory.uuid(),
    assetIds: [factory.uuid()],
    expiresAt: new Date('2026-05-22T07:59:59.000Z'),
  });
  await sut.create({
    sessionId: other.session.id,
    userId: user.id,
    sourceToolCallId: factory.uuid(),
    assetIds: [factory.uuid()],
    expiresAt: new Date('2026-05-22T10:00:00.000Z'),
  });

  const result = await sut.listValidForRecovery({ sessionId: session.id, userId: user.id, now, limit: 5 });

  expect(result).toEqual([
    expect.objectContaining({ id: newer.id, assetCount: 3, sourceToolCallId: newer.sourceToolCallId }),
    expect.objectContaining({ id: older.id, assetCount: 2, sourceToolCallId: older.sourceToolCallId }),
  ]);
  expect(result.map((handle) => 'assetIds' in handle)).toEqual([false, false]);
  expect(result.map((handle) => 'sampleAssetIds' in handle)).toEqual([false, false]);
});

it('returns same-session expired handle metadata for recovery but not cross-session handles', async () => {
  const { ctx, credentialRepository, sessionRepository, sut } = setup();
  const { user, session } = await createSession(ctx, credentialRepository, sessionRepository);
  const other = await createSession(ctx, credentialRepository, sessionRepository);
  const expired = await sut.create({
    sessionId: session.id,
    userId: user.id,
    sourceToolCallId: factory.uuid(),
    assetIds: [factory.uuid(), factory.uuid()],
    expiresAt: new Date('2026-05-22T07:00:00.000Z'),
  });
  const crossSession = await sut.create({
    sessionId: other.session.id,
    userId: user.id,
    sourceToolCallId: factory.uuid(),
    assetIds: [factory.uuid()],
    expiresAt: new Date('2026-05-22T07:00:00.000Z'),
  });

  await expect(sut.getForRecovery({ id: expired.id, sessionId: session.id, userId: user.id })).resolves.toEqual(
    expect.objectContaining({ id: expired.id, assetCount: 2, expiresAt: expired.expiresAt }),
  );
  await expect(
    sut.getForRecovery({ id: crossSession.id, sessionId: session.id, userId: user.id }),
  ).resolves.toBeUndefined();
});
```

Run:

```bash
pnpm --dir server test:medium test/medium/specs/repositories/agent-selection-handle.repository.spec.ts
```

Expected red failure: `listValidForRecovery` and `getForRecovery` do not exist.

- [ ] **Step 2: Add repository methods**

In `server/src/repositories/agent-selection-handle.repository.ts`, add compact recovery DTOs:

```ts
export type AgentSelectionHandleRecoveryLookup = {
  id: string;
  sessionId: string;
  userId: string;
};

export type AgentSelectionHandleRecoveryList = {
  sessionId: string;
  userId: string;
  now: Date;
  limit: number;
};
```

Add methods that select only safe compact fields:

```ts
  listValidForRecovery(dto: AgentSelectionHandleRecoveryList) {
    return this.db
      .selectFrom('agent_selection_handle')
      .select(['id', 'assetCount', 'sourceToolCallId', 'createdAt', 'expiresAt'])
      .where('sessionId', '=', asUuid(dto.sessionId))
      .where('userId', '=', asUuid(dto.userId))
      .where('expiresAt', '>', dto.now)
      .orderBy('createdAt', 'desc')
      .limit(dto.limit)
      .execute();
  }

  getForRecovery(dto: AgentSelectionHandleRecoveryLookup) {
    return this.db
      .selectFrom('agent_selection_handle')
      .select(['id', 'assetCount', 'sourceToolCallId', 'createdAt', 'expiresAt'])
      .where('id', '=', asUuid(dto.id))
      .where('sessionId', '=', asUuid(dto.sessionId))
      .where('userId', '=', asUuid(dto.userId))
      .executeTakeFirst();
  }
```

Do not return `assetIds` or `sampleAssetIds` from these recovery methods.

- [ ] **Step 3: Verify repository tests pass**

Run:

```bash
pnpm --dir server test:medium test/medium/specs/repositories/agent-selection-handle.repository.spec.ts
```

Expected green result: repository tests pass. If the local DB is unavailable, record the failure and rely on CI for this medium test, but still run all unit tests locally.

---

## Task 2: Add Recoverable Invalid-Handle Error Types

**Files:**

- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/types/agent-mcp.types.ts`
- Add: `server/src/services/agent-mcp-recoverable-tool-error.ts`

- [ ] **Step 1: Wait for compile-failing type usage in service/MCP tests**

Do not add the production types before the failing tests that use them. The service tests in Task 3 and MCP tests in Task 4 should reference these shapes before implementation:

```ts
expect(error.content.recovery).toEqual(
  expect.objectContaining({
    kind: 'invalid-selection-handle',
    attemptedSelectionHandleId,
    looksLikeExamplePlaceholder: true,
  }),
);
```

Run the service or MCP test command from the relevant task and verify the compiler/test failure before adding the production type and error class.

- [ ] **Step 2: Add compact recovery metadata types**

In `server/src/types/agent-tool.types.ts`, add:

```ts
export type AgentSelectionHandleRecoveryHint = {
  id: string;
  assetCount: number;
  sourceToolCallId: string | null;
  createdAt: Date;
  expiresAt: Date;
};

export type AgentSelectionHandleRecoveryMetadata = {
  kind: 'invalid-selection-handle';
  attemptedSelectionHandleId: string;
  looksLikeExamplePlaceholder: boolean;
  availableSelectionHandles: AgentSelectionHandleRecoveryHint[];
  expiredSelectionHandle?: AgentSelectionHandleRecoveryHint;
  instruction: string;
};
```

In `AgentToolOperationPlanRequestMetadata`, do not add recovery hints because recovery is a response property, not request metadata.

Update `AgentToolOperationPlanResponseMetadata` to allow either normal plan response metadata or invalid-handle recovery metadata:

```ts
export type AgentToolOperationPlanResponseMetadata =
  | {
      planId: string | null;
      operationIds: string[];
    }
  | {
      selectionHandleRecovery: AgentSelectionHandleRecoveryMetadata;
    };
```

In `server/src/types/agent-mcp.types.ts`, add a recoverable MCP tool error content shape:

```ts
export type AgentMcpRecoverableToolErrorContent = {
  status: 'error';
  error: string;
  toolName: AgentToolName;
  retryable: true;
  hint: string;
  recovery: AgentMcpJsonObject;
};
```

Update unions only if required by the compiler. Keep existing validation error content unchanged.

- [ ] **Step 3: Add recoverable error class**

Create `server/src/services/agent-mcp-recoverable-tool-error.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { AgentToolName } from 'src/enum';
import { AgentMcpJsonObject, AgentMcpRecoverableToolErrorContent } from 'src/types/agent-mcp.types';

export class AgentMcpRecoverableToolError extends BadRequestException {
  constructor(public readonly content: AgentMcpRecoverableToolErrorContent & { recovery: AgentMcpJsonObject }) {
    super(content.error);
  }
}

export const isAgentMcpRecoverableToolError = (error: unknown): error is AgentMcpRecoverableToolError =>
  error instanceof AgentMcpRecoverableToolError;

export const invalidSelectionHandleError = (input: {
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

If lint prefers an interface or factory name change, keep behavior the same and update tests accordingly.

---

## Task 3: Build Operation-Plan Recovery Metadata

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Test: `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Write failing service tests for example handles and safe recovery hints**

Add tests near `rejects expired or cross-session selection handles before plan persistence`.

Test helper setup should use a valid schema-shaped example handle:

```ts
const exampleSelectionHandleId = '00000000-0000-4000-8000-000000000333';
const validHandle = {
  id: newUuid(),
  assetCount: 250,
  sourceToolCallId: newUuid(),
  createdAt: new Date('2026-05-22T07:00:00.000Z'),
  expiresAt: new Date('2026-05-22T08:00:00.000Z'),
};
```

Add `it('denies generated-example selection handles with recoverable metadata and no plan persistence', async () => { ... })`:

- Mock `sessionRepository.getById` to return current session.
- Mock `selectionHandleRepository.getValidForPlanning` to return `undefined`.
- Mock `selectionHandleRepository.listValidForRecovery` to return `[validHandle]`.
- Mock `selectionHandleRepository.getForRecovery` to return `undefined`.
- Call `sut.proposeAlbumOperations` with `assetSelectionHandleId: exampleSelectionHandleId`.
- Expect rejection to be `AgentMcpRecoverableToolError`.
- Expect `error.content`:
  - `status: 'error'`
  - `error: 'Selection handle is expired or not available for this session'`
  - `retryable: true`
  - `hint` contains `Retry proposeAlbumOperations with the exact handle ${validHandle.id}`
  - `recovery.kind === 'invalid-selection-handle'`
  - `recovery.attemptedSelectionHandleId === exampleSelectionHandleId`
  - `recovery.looksLikeExamplePlaceholder === true`
  - `recovery.availableSelectionHandles === [validHandle]`
  - no `assetIds` or `sampleAssetIds` in `JSON.stringify(error.content.recovery)`
- Expect `planRepository.createReplacementRevision` not called.
- Expect `toolCallRepository.create` called with:
  - `status: AgentToolCallStatus.Denied`
  - `approvalDecision: AgentToolApprovalDecision.Denied`
  - `error: 'Selection handle is expired or not available for this session'`
  - `redactedResponseMetadata.selectionHandleRecovery` matching the recovery object.

- [ ] **Step 2: Write failing service tests for multiple/no/expired handles**

Add `it('lists multiple valid same-session handles without choosing one', async () => { ... })`:

- Mock two valid recovery handles.
- Use any syntactically valid random attempted handle.
- Expect `availableSelectionHandles` contains both in repository order.
- Expect `hint` contains `Choose the intended same-session handle`.
- Expect `hint` does not contain `Retry proposeAlbumOperations with the exact handle ${first.id}`.
- Expect no plan persistence.

Add `it('instructs the model to rerun searchAssets when no valid handles are available', async () => { ... })`:

- Mock no valid recovery handles and no expired attempted handle.
- Expect `availableSelectionHandles: []`.
- Expect `hint` contains `Rerun searchAssets with createSelectionHandle true`.
- Expect no plan persistence.

Add `it('reports an attempted same-session expired handle without suggesting it as usable', async () => { ... })`:

- Mock `selectionHandleRepository.listValidForRecovery` to return `[]`.
- Mock `selectionHandleRepository.getForRecovery` to return an expired handle for the attempted ID.
- Expect `recovery.expiredSelectionHandle` equals compact metadata for the attempted handle.
- Expect `availableSelectionHandles` is empty.
- Expect `hint` contains `expired` and `Rerun searchAssets`.
- Expect `hint` does not contain `Retry proposeAlbumOperations with the exact handle ${expired.id}`.
- Expect no plan persistence.

Add `it('does not expose cross-session handles in recovery metadata', async () => { ... })`:

- Mock only the repository calls that are allowed: `listValidForRecovery({ sessionId: session.id, userId: auth.user.id, ... })` returns `[]`, and `getForRecovery({ id: attemptedId, sessionId: session.id, userId: auth.user.id })` returns `undefined`.
- Expect recovery lists no handles.
- Expect no plan persistence.
- This unit test verifies the service only asks for same-session/user handles; the repository medium test verifies cross-session rows are filtered out at the DB layer.

Run:

```bash
pnpm --dir server test src/services/agent-operation-plan.service.spec.ts
```

Expected red failure: missing recovery repository methods, recoverable error class, recovery metadata, and audit metadata.

- [ ] **Step 3: Implement recovery in `AgentOperationPlanService`**

Implementation shape:

- Add constants:

```ts
const selectionHandleRecoveryLimit = 5;
const knownExampleSelectionHandleIds = new Set(['00000000-0000-4000-8000-000000000333']);
```

- Expand the planning audit result type so `redactedResponseMetadata` can include either plan metadata or recovery metadata:

```ts
type PlanningRecoveryResponseMetadata = {
  selectionHandleRecovery: AgentSelectionHandleRecoveryMetadata;
};
```

- In `resolveSelectionHandleAssetIds`, when `getValidForPlanning` returns no handle, call a new helper:

```ts
throw await this.createInvalidSelectionHandleError(auth, session, id);
```

- `createInvalidSelectionHandleError` should:
  - call `listValidForRecovery({ sessionId: session.id, userId: auth.user.id, now, limit: selectionHandleRecoveryLimit })`;
  - call `getForRecovery({ id, sessionId: session.id, userId: auth.user.id })`;
  - include `expiredSelectionHandle` only when `getForRecovery` returns a handle whose `expiresAt <= now`;
  - never include expired handles in `availableSelectionHandles`;
  - never include `assetIds` or `sampleAssetIds`;
  - set `looksLikeExamplePlaceholder` from `knownExampleSelectionHandleIds`;
  - produce hints:
    - one valid handle: `Retry proposeAlbumOperations with the exact handle <id> if that is the intended search selection.`
    - multiple valid handles: `Choose the intended same-session handle from availableSelectionHandles and retry proposeAlbumOperations with that exact id.`
    - no valid handles: `Rerun searchAssets with createSelectionHandle true, then retry proposeAlbumOperations with the returned selectionHandle.id.`
    - expired attempted handle: mention expiration and rerun `searchAssets`; do not suggest the expired handle as usable.
  - return `invalidSelectionHandleError({ toolName: AgentToolName.ProposeAlbumOperations, error, hint, recovery })`.

- Update `tryCreatePlanningPreparationDeniedAudit` so when `isAgentMcpRecoverableToolError(error)` and `error.content.recovery.kind === 'invalid-selection-handle'`, it stores:

```ts
redactedResponseMetadata: {
  selectionHandleRecovery: error.content.recovery,
},
```

Keep status `Denied` and approval decision `Denied`.

- [ ] **Step 4: Verify service tests pass**

Run:

```bash
pnpm --dir server test src/services/agent-operation-plan.service.spec.ts
```

Expected green result: all operation-plan service tests pass, and all new invalid-handle recovery tests confirm no plan row is created.

---

## Task 4: Serialize Recoverable Errors Through MCP Instead Of Internal Error

**Files:**

- Modify: `server/src/services/agent-mcp.service.ts`
- Test: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Write failing MCP adapter tests**

Add `it('returns recoverable invalid selection handle tool errors as MCP tool results', async () => { ... })` near planning tool call tests:

- Build an `AgentMcpRecoverableToolError` with:
  - `status: 'error'`
  - `error: 'Selection handle is expired or not available for this session'`
  - `toolName: AgentToolName.ProposeAlbumOperations`
  - `retryable: true`
  - `hint: 'Retry proposeAlbumOperations with the exact handle <valid-handle-id> if that is the intended search selection.'`
  - `recovery.kind: 'invalid-selection-handle'`
  - `recovery.looksLikeExamplePlaceholder: true`
  - `recovery.availableSelectionHandles: [...]`
- Mock `operationPlanService.proposeAlbumOperations` to reject with it.
- Call MCP `tools/call` for `proposeAlbumOperations`.
- Expect JSON-RPC success response, not JSON-RPC error:
  - `result.isError === true`
  - `result.structuredContent.status === 'error'`
  - `result.structuredContent.retryable === true`
  - `result.structuredContent.recovery.kind === 'invalid-selection-handle'`
  - `result.content[0].text` contains the retry hint
  - response does not contain `Internal error`.

Add `it('keeps invalid UUID selection handles as ordinary schema validation errors', async () => { ... })`:

- Call MCP `tools/call` with `assetSelectionHandleId: 'not-a-uuid'`.
- Expect `result.isError === true`.
- Expect `structuredContent.error === 'Invalid tool arguments'`.
- Expect no `structuredContent.recovery`.
- Expect `operationPlanService.proposeAlbumOperations` not called.

Run:

```bash
pnpm --dir server test src/services/agent-mcp.service.spec.ts
```

Expected red failure: service exceptions still become JSON-RPC `Internal error`, and invalid UUID behavior may already pass except for explicit no-recovery assertion.

- [ ] **Step 2: Implement MCP recoverable error serialization**

In `server/src/services/agent-mcp.service.ts`:

- Import `isAgentMcpRecoverableToolError`.
- In `invokeTool`, before the generic catch fallback:

```ts
    } catch (error) {
      if (isAgentMcpRecoverableToolError(error)) {
        return this.success(id, this.recoverableToolErrorResult(error.content));
      }

      return this.error(id, -32_603, 'Internal error');
    }
```

- Add helper:

```ts
private recoverableToolErrorResult(content: AgentMcpRecoverableToolErrorContent): AgentMcpToolCallResult {
  return {
    ...this.toolResult(content),
    isError: true,
  };
}
```

- Update `toolResultText` for `content.status === 'error'` to prefer `hint` when no validation issue exists:

```ts
const hint = this.nonEmptyString(content.hint);
return this.compactToolText(firstIssue ? `${error}: ${firstIssue}` : hint ? `${error}: ${hint}` : error);
```

Do not change behavior for unrecoverable provider/runtime errors; they should still return JSON-RPC `Internal error`.

- [ ] **Step 3: Verify MCP adapter tests pass**

Run:

```bash
pnpm --dir server test src/services/agent-mcp.service.spec.ts
```

Expected green result: recoverable invalid-handle failures return tool-result errors with structured recovery, and invalid UUID remains schema validation.

---

## Task 5: Run Slice 3 Regression Suite And Commit

- [ ] **Step 1: Run unit tests**

Run:

```bash
pnpm --dir server test src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp.service.spec.ts
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected green result: all tests pass.

- [ ] **Step 2: Run medium repository test**

Run:

```bash
pnpm --dir server test:medium test/medium/specs/repositories/agent-selection-handle.repository.spec.ts
```

Expected green result if local DB is available. If local DB is unavailable, document the DB failure and make sure the pushed branch relies on CI for this medium test.

- [ ] **Step 3: Run build and static checks**

Run:

```bash
pnpm --dir server build
pnpm --dir server format
pnpm --dir server lint
pnpm --dir server check
git diff --check
```

Expected green result: all commands exit 0.

- [ ] **Step 4: Inspect recovery response strings**

Run:

```bash
rg -n "invalid-selection-handle|looksLikeExamplePlaceholder|availableSelectionHandles|expiredSelectionHandle|Rerun searchAssets|Retry proposeAlbumOperations with the exact handle" server/src/services server/src/types server/test/medium/specs/repositories
```

Expected: recovery metadata and tests are present only in the Slice 3 service/MCP/repository paths.

- [ ] **Step 5: Commit Slice 3**

Run:

```bash
git status --short
git add server/src/repositories/agent-selection-handle.repository.ts \
  server/test/medium/specs/repositories/agent-selection-handle.repository.spec.ts \
  server/src/types/agent-tool.types.ts \
  server/src/types/agent-mcp.types.ts \
  server/src/services/agent-mcp-recoverable-tool-error.ts \
  server/src/services/agent-operation-plan.service.ts \
  server/src/services/agent-operation-plan.service.spec.ts \
  server/src/services/agent-mcp.service.ts \
  server/src/services/agent-mcp.service.spec.ts
git commit -m "fix: return recovery hints for invalid selection handles"
```

Expected: one implementation commit containing only Slice 3 files.

---

## Plan Self-Review

- TDD order is explicit for repository, operation-plan service, and MCP adapter behavior.
- Every Slice 3 spec test is covered:
  - Example placeholder handle sets `looksLikeExamplePlaceholder: true`.
  - Same-session valid handles are listed with safe compact metadata.
  - Cross-session handles are filtered by repository and not requested outside the current session/user.
  - Expired attempted same-session handle is reported as expired but not suggested as usable.
  - No auto-substitution occurs and no plan row is created.
- Every Slice 3 edge case is covered:
  - Multiple valid handles list all compactly and do not choose one.
  - No valid handles instructs Pi to rerun `searchAssets`.
  - Same-session expired attempted handle includes `expiredSelectionHandle`.
  - Invalid UUID stays schema validation with no recovery metadata.
- Runtime behavior remains explicit: Gallery returns recovery guidance, but Pi must retry with corrected arguments.
