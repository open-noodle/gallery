# Pi Agent MCP Handle And Filter Hardening Slice 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use TDD for every behavior: write the failing test first, run it red, implement the smallest fix, then run focused and regression commands.

**Goal:** Add a deterministic runner/server regression that reproduces the production failure sequence end to end through MCP: resolve people, search with the resolved people filters, create a real selection handle, reject an example handle without creating a plan, retry with the real handle, and finish with a reviewable plan.

**Architecture:** Extend the existing in-memory harness in `server/src/services/agent-runner-flow.integration.spec.ts`. The test should instantiate real `AgentToolService`, real `AgentMcpService`, and real `AgentOperationPlanService`, backed by in-memory selection-handle and operation-plan repositories. Do not add a database-backed E2E test, do not depend on Pierre's personal instance, and do not use real photo-library data or real people names.

---

## Spec Context

Spec: `docs/superpowers/specs/2026-05-22-pi-agent-mcp-handle-filter-hardening-design.md`

Slice 7 requires:

- deterministic server flow: resolve people -> search creates selection handle -> model attempts example handle -> receives correction -> retries with real handle -> plan is created;
- first invalid handle must not create a plan;
- corrected retry must create a plan with the real handle;
- final session state must be `waiting-for-plan-review`;
- the search request must include resolved `personIds`;
- corrected retry must use the same temporary target IDs and album summary;
- denied handle attempt must not become a duplicate visible plan;
- test must not depend on the personal instance or real names.

## Files

- Modify tests first: `server/src/services/agent-runner-flow.integration.spec.ts`
- Modify implementation only if the red test exposes a production gap:
  - `server/src/services/agent-tool.service.ts`
  - `server/src/services/agent-operation-plan.service.ts`
  - `server/src/services/agent-mcp.service.ts`
  - `server/src/services/agent-runner.service.ts`
- No frontend files are in scope.

## Baseline

- [ ] **Step 1: Confirm the focused runner flow suite is green before edits**

Run:

```bash
pnpm --dir server test src/services/agent-runner-flow.integration.spec.ts
```

Expected: existing tests pass before Slice 7 edits. If this fails before changes, stop and record the pre-existing failure.

---

## Task 1: Write The Failing End-To-End MCP Regression

**Files:**

- Modify tests first: `server/src/services/agent-runner-flow.integration.spec.ts`

- [ ] **Step 1: Add imports for the regression and eventual harness**

Add imports needed by the failing test and the minimal harness implementation:

```ts
import { AgentMcpService } from 'src/services/agent-mcp.service';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
import { AgentMcpToolRegistryService } from 'src/services/agent-mcp-tool-registry.service';
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
import { AgentOperationPlanRepository } from 'src/repositories/agent-operation-plan.repository';
import { AgentSelectionHandleRepository } from 'src/repositories/agent-selection-handle.repository';
import {
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
} from 'src/enum';
import type { AgentOperationPlanWithOperations } from 'src/repositories/agent-operation-plan.repository';
import type { AgentAlbumOperationInput } from 'src/types/agent-operation.types';
import type { AgentMcpSuccessResponse, AgentMcpToolCallResult } from 'src/types/agent-mcp.types';
import type { AgentPermissionPlanSnapshot } from 'src/types/agent-session.types';
```

If some enum/type imports already exist, merge them into the existing import lists rather than duplicating imports.

- [ ] **Step 2: Add local MCP test helpers**

Add helpers near the other test helpers:

```ts
const makeMcpToolCallRequest = (toolName: AgentToolName, args: unknown) => ({
  jsonrpc: '2.0',
  id: `${toolName}-call-${newUuid()}`,
  method: 'tools/call',
  params: { name: toolName, arguments: args },
});

const getMcpToolResult = (response: unknown): AgentMcpToolCallResult => {
  expect(response).toMatchObject({ jsonrpc: '2.0', result: expect.any(Object) });
  return (response as AgentMcpSuccessResponse).result as AgentMcpToolCallResult;
};
```

Keep helpers local to this spec file; do not import test helpers from `agent-mcp.service.spec.ts`.

- [ ] **Step 3: Add the regression test before harness implementation**

Add a new test in `describe('Pi agent runner flow harness', ...)`:

```ts
it('recovers from an example selection handle and creates a plan with resolved people filters', async () => {
  // TDD test body first; expect it to fail because setup() does not yet expose real MCP planning dependencies.
});
```

Use deterministic test constants:

- people:
  - `personAlphaId = newUuid()`
  - `personBetaId = newUuid()`
  - names in user-facing input: `Person Alpha`, `Person Beta`
- assets:
  - `assetIds = [newUuid(), newUuid(), newUuid()]`
- date/country filters:
  - `country: 'South Africa'`
  - `takenAfter: '2026-01-01T00:00:00.000Z'`
  - `takenBefore: '2026-01-31T23:59:59.999Z'`
- plan:
  - `albumTemporaryTargetId = 'south-africa-people-album'`
  - `planSummary = 'Create South Africa people album.'`
  - `albumName = 'South Africa with Person Alpha and Person Beta (Jan 2026)'`
- example handle:
  - `00000000-0000-4000-8000-000000000333`

Set up the harness and repositories:

- create the session with `permissionPreset: AgentPermissionPreset.VisualOrganizer`, `approvalMode: AgentApprovalMode.PlanOnly`, and `initialContext: { entrypoint: 'assistant-page' }`;
- make resolver suggestions return both people:
  - `searchRepository.getFilterSuggestions.mockResolvedValue({ people: [{ id: personAlphaId, name: 'Person Alpha' }, { id: personBetaId, name: 'Person Beta' }], tags: [], countries: [], cameraMakes: [], ratings: [], mediaTypes: [], hasUnnamedPeople: false })`;
  - add any required optional suggestion methods such as `getCameraModels` / `getCameraLensModels` with empty arrays if the code path needs them;
- allow access:
  - `accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personAlphaId, personBetaId]))`;
  - `accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds))`;
  - `accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set())`;
  - `assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds))`;
- return search results:
  - `searchRepository.searchMetadata.mockResolvedValue({ items: assetIds.map((id) => ({ id })), hasNextPage: false })`.

Drive the sequence through the runner by configuring `runnerMessageHandler` to call MCP:

1. `mcpService.handle(auth, sessionId, makeMcpToolCallRequest(AgentToolName.ResolveAssetSearchFilters, { people: ['Person Alpha', 'Person Beta'] }))`
   - assert `result.isError` is not `true`;
   - assert `structuredContent.resolvedFilters.personIds` equals `[personAlphaId, personBetaId]`.
2. `mcpService.handle` for `AgentToolName.SearchAssets` with:
   - `filters` spreading resolver `resolvedFilters` and adding country/date fields;
   - `detail: 'ids'`;
   - `limit: 50`;
   - `createSelectionHandle: true`;
   - `sampleSize: 2`.
   - assert `result.isError` is not `true`;
   - assert `structuredContent.selectionHandle.id` exists;
   - assert `structuredContent.assetIds` is only the sample IDs while the handle asset count is all three assets.
3. `mcpService.handle` for `AgentToolName.ProposeAlbumOperations` with the example handle and this operation list:

```ts
[
  {
    type: AgentOperationType.AlbumCreate,
    summary: 'Create the destination album.',
    targetKind: AgentOperationTargetKind.NewAlbum,
    temporaryTargetId: albumTemporaryTargetId,
    payload: { albumName, description: 'January 2026 South Africa photos with selected people.' },
  },
  {
    type: AgentOperationType.AlbumAddAssets,
    summary: 'Add the matching photos.',
    targetKind: AgentOperationTargetKind.NewAlbum,
    temporaryTargetId: albumTemporaryTargetId,
    assetSelectionHandleId: '00000000-0000-4000-8000-000000000333',
    payload: {},
    riskLevel: AgentOperationRiskLevel.Medium,
    enabled: true,
  },
];
```

- assert MCP returns a successful JSON-RPC envelope with `result.isError === true`;
- assert `structuredContent.recovery.kind === 'invalid-selection-handle'`;
- assert `structuredContent.recovery.looksLikeExamplePlaceholder === true`;
- assert `structuredContent.recovery.availableSelectionHandles[0].id === realHandleId`;
- assert `harness.operationPlans.plans` is still empty immediately after this denied attempt.

4. Retry `AgentToolName.ProposeAlbumOperations` with the same `summary`, same `temporaryTargetId`, same album payload, and the real handle ID.
   - assert `result.isError` is absent or false;
   - assert `structuredContent.plan.id` exists;
   - assert `harness.operationPlans.plans` has one proposed plan.
5. Yield an `assistant-message-completed` event so the full runner flow finishes.

After `messageService.appendUserMessage(...)` completes, assert:

- `searchRepository.searchMetadata` was called once with options containing both `personIds`, `country: 'South Africa'`, and the January 2026 date range. Because `buildAgentSearch` may transform DTO dates, compare via `JSON.stringify` or inspect the option object with date-aware helpers.
- `harness.operationPlans.plans` has exactly one plan.
- plan status is `AgentOperationPlanStatus.Proposed`.
- plan summary is `planSummary`.
- operations preserve the same `temporaryTargetId`.
- the add-assets operation has `assetIds` equal to all three handle assets and no persisted `assetSelectionHandleId`.
- there is exactly one denied `AgentToolName.ProposeAlbumOperations` tool call and one completed `AgentToolName.ProposeAlbumOperations` tool call.
- no visible/created plan came from the denied attempt.
- reloaded session status is `AgentSessionStatus.WaitingForPlanReview`.
- websocket events include `operation-plan-ready`.
- test names and data use `Person Alpha` / `Person Beta`, not personal instance names.

Run:

```bash
pnpm --dir server test src/services/agent-runner-flow.integration.spec.ts -t "recovers from an example selection handle"
```

Expected red failure:

- `mcpService` / `operationPlans` / selection-handle planning methods do not exist on the harness; or
- TypeScript compilation fails because the test references harness fields not yet implemented.

This red failure is required TDD evidence. Record the failing assertion in the worker's final report.

---

## Task 2: Add In-Memory Harness Dependencies For MCP Planning

**Files:**

- Modify only the test harness in `server/src/services/agent-runner-flow.integration.spec.ts` unless the red test proves a production gap.

- [ ] **Step 1: Add an in-memory selection-handle repository fake**

Add `InMemoryAgentSelectionHandleRepository` near the other in-memory repositories.

Required methods and behavior:

- `create(dto)`:
  - dedupe `assetIds` preserving first-seen order;
  - create a deterministic row with `id: newUuid()`, `sessionId`, `userId`, `sourceToolCallId`, `assetIds`, `assetCount`, `sampleAssetIds: assetIds.slice(0, 25)`, `expiresAt`, `createdAt: now()`, `updateId: newUuid()`;
  - store the row and return it.
- `getValidForPlanning({ id, sessionId, userId, now })`:
  - return only same-id, same-session, same-user rows where `expiresAt > now`.
- `listValidForRecovery({ sessionId, userId, now, limit })`:
  - return same-session, same-user, non-expired rows ordered by `createdAt desc`, then `id desc`, capped by `limit`;
  - return only compact fields: `id`, `assetCount`, `sourceToolCallId`, `createdAt`, `expiresAt`.
- `getForRecovery({ id, sessionId, userId })`:
  - return the same compact fields for a same-id/session/user row, regardless of expiry.

Do not expose `assetIds` or `sampleAssetIds` from recovery-list methods.

- [ ] **Step 2: Add an in-memory operation-plan repository fake**

Add `InMemoryAgentOperationPlanRepository` near the other in-memory repositories.

Required methods and behavior:

- `plans: AgentOperationPlanWithOperations[] = []`.
- `createReplacementRevision(sessionId, { plan, operations })`:
  - read the current session from the in-memory session repository;
  - return `undefined` if session status is `applying`, `completed`, `cancelled`, `interrupted`, or `failed`, mirroring `AgentOperationPlanRepository.createReplacementRevision`;
  - mark any existing proposed plans for the same session as `superseded`;
  - create a new `AgentOperationPlanWithOperations` with `status: AgentOperationPlanStatus.Proposed`, `revision` equal to next revision for the session, `summary: plan.summary`, timestamps, and mapped operations;
  - map each input operation to a row with `id`, `planId`, `position`, `type`, `summary`, `targetKind`, nullable `targetId`, nullable `temporaryTargetId`, materialized `assetIds`, `payload`, `dependencyIds`, `riskLevel`, `enabled`, `status: AgentOperationStatus.Proposed`, `result: null`, `error: null`, timestamps;
  - push and return the created plan.
- `getCurrentBySessionId(sessionId)` returns the latest proposed plan.
- `getAppliedBySessionId(sessionId)` returns applied plans for that session sorted in stable creation/revision order.

The fake must preserve the exact `summary`, `temporaryTargetId`, and materialized `assetIds` passed by `AgentOperationPlanService`.

- [ ] **Step 3: Wire real planning/MCP services into `setup()`**

In `setup()`:

- construct `selectionHandles = new InMemoryAgentSelectionHandleRepository()`;
- pass `selectionHandles as unknown as AgentSelectionHandleRepository` into `AgentToolService` instead of `{ create: vi.fn() } as never`;
- add `getFilterSuggestions`, `getCameraModels`, and `getCameraLensModels` fakes to the existing `searchRepository` object so resolver tests can configure them;
- construct `operationPlans = new InMemoryAgentOperationPlanRepository(sessions)`;
- construct an `AgentOperationPlanService` using the constructor order in `server/src/services/agent-operation-plan.service.ts`:
  - existing `accessRepository`;
  - existing `assetRepository`;
  - inert `albumService`;
  - existing `sessions`;
  - `selectionHandles`;
  - `operationPlans`;
  - existing `toolCalls`;
  - existing `websocketRepository`;
  - inert `sharedSpaceService`;
  - inert `assetService`;
  - inert `tagService`;
  - existing `activityService`.
- construct `contractService = new AgentMcpToolContractService()`;
- construct `mcpService = new AgentMcpService(new AgentMcpToolRegistryService(contractService), contractService, toolService, operationPlanService)`;
- return `mcpService`, `selectionHandles`, `operationPlans`, and `operationPlanService` from the harness.

Run:

```bash
pnpm --dir server test src/services/agent-runner-flow.integration.spec.ts -t "recovers from an example selection handle"
```

Expected: the new regression compiles and reaches real MCP/service behavior. If it fails, it should fail on behavioral assertions rather than missing harness fields.

---

## Task 3: Implement Minimal Production Fixes Only If Needed

**Files:**

- Prefer test-harness-only implementation in `server/src/services/agent-runner-flow.integration.spec.ts`.
- Modify production files only if the Slice 7 red test reveals a real gap not already covered by Slices 1-6.

- [ ] **Step 1: Fix any real production behavior gaps with TDD**

Valid production fixes are limited to behavior that contradicts the spec:

- `AgentToolService.searchAssets` creates a handle but the returned result omits the handle in an MCP-safe shape.
- `AgentOperationPlanService` does not mark the session `waiting-for-plan-review` after a corrected retry.
- `AgentMcpService` turns recoverable invalid handle errors into JSON-RPC internal errors instead of tool-result errors.
- resolved `personIds` cannot be passed through `searchAssets` filters.

Invalid changes:

- auto-substituting the real handle server-side;
- removing the denied tool-call audit;
- weakening handle validation;
- changing permission semantics;
- expanding UI scope.

After each production change, rerun:

```bash
pnpm --dir server test src/services/agent-runner-flow.integration.spec.ts -t "recovers from an example selection handle"
```

Expected green result.

- [ ] **Step 2: Keep or add edge assertions for every Slice 7 edge case**

The green test must assert:

- first invalid handle does not create a plan;
- corrected retry creates exactly one plan;
- corrected retry uses the same `temporaryTargetId` and `summary`;
- denied tool call is persisted as denied but does not become a visible plan;
- search includes both resolved `personIds` in one request, proving OR semantics via one `personIds` array, not two intersecting searches;
- final session state is `waiting-for-plan-review`;
- test data is deterministic and does not depend on the personal instance or real names.

Run:

```bash
pnpm --dir server test src/services/agent-runner-flow.integration.spec.ts -t "recovers from an example selection handle"
```

Expected green result.

---

## Task 4: Focused Regression And Final Verification

- [ ] **Step 1: Run focused server regression suites**

Run:

```bash
pnpm --dir server test src/services/agent-runner-flow.integration.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-tool.service.spec.ts
```

Expected: all tests pass. These suites cover the new E2E regression plus the lower-level handle recovery, MCP wrapper, and search/filter behavior.

- [ ] **Step 2: Run server quality gates**

Run:

```bash
pnpm --dir server format
pnpm --dir server lint
pnpm --dir server check
git diff --check
```

Expected: all commands pass.

- [ ] **Step 3: Commit and push Slice 7**

Commit message:

```bash
git add server/src/services/agent-runner-flow.integration.spec.ts
git commit -m "test: cover Pi MCP handle recovery flow"
git push
```

If production files changed, include them in the same commit and update the commit message to:

```bash
git commit -m "fix: harden Pi MCP handle recovery flow"
```

Do not force-push. If push is rejected, fetch/rebase onto `origin/explore/pi-agent-brainstorm`, rerun focused tests, then push.

## Edge Case Coverage Checklist

- [ ] Known example UUID `00000000-0000-4000-8000-000000000333` is rejected with `looksLikeExamplePlaceholder: true`.
- [ ] A real same-session selection handle created by `searchAssets` appears in recovery hints.
- [ ] First invalid handle attempt creates no plan.
- [ ] Corrected retry creates exactly one proposed plan.
- [ ] Corrected retry materializes all handle `assetIds` server-side.
- [ ] Corrected retry does not persist `assetSelectionHandleId` as the operation's only asset selection.
- [ ] Corrected retry preserves the same temporary target ID.
- [ ] Corrected retry preserves the same plan summary.
- [ ] Denied planning tool call remains an audit row and does not duplicate a visible plan.
- [ ] Final session status is `waiting-for-plan-review`.
- [ ] Search request includes both resolved people IDs in one `personIds` array.
- [ ] Search request includes the January 2026 South Africa filters.
- [ ] Test is deterministic and uses `Person Alpha` / `Person Beta`, not personal-instance data or real names.

## Out Of Scope

- Additional prompt/docs changes; Slices 1, 2, and 4 already own that.
- Additional invalid-handle unit cases; Slice 3 already owns cross-session, expired, nonexistent, and invalid UUID cases.
- Activity UI behavior; Slices 5 and 6 already own cleanup and activity preview stability.
- Personal deployment/manual verification; that happens after the branch is pushed and CI is babysat.
