# Pi Agent MCP Failed Turn Activity Cleanup Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a runner turn ends after an unrecovered Gallery MCP tool failure, stop showing stale active work. Persist the assistant response, mark the chat appendable as `interrupted`, and record a terminal failed activity event. Approval waits and plan-review waits must remain untouched.

**Architecture:** Keep the cleanup in `AgentRunnerService`, because it owns runner stream lifecycle, activity start events, assistant-message persistence, and runner-error cleanup. Add bounded tool-call inspection through `AgentToolCallRepository` using a pre-dispatch baseline of existing tool-call IDs so only tool failures created during the current runner turn are considered. Do not change MCP tool semantics, approval handling, or plan creation.

**Tech Stack:** TypeScript/Nest service tests, existing in-memory runner-flow integration harness, existing `AgentSessionActivityEventService`.

---

## Spec Context

Spec: `docs/superpowers/specs/2026-05-22-pi-agent-mcp-handle-filter-hardening-design.md`

Slice 5 requires:

- If a runner turn completes with an assistant response after an unrecovered tool failure and no pending approval/plan state remains, mark active work as failed/interrupted.
- Persist a terminal `agent_session_activity_event` with `status: failed`.
- Keep the session appendable so the user can continue in the same chat.
- Do not mark waiting-for-approval or waiting-for-plan-review states failed.
- Continue to handle runner stream throws and runner-reported errors as terminal failed activity.

## Files

- Modify: `server/src/services/agent-runner.service.ts`
- Test: `server/src/services/agent-runner.service.spec.ts`
- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`
- Optional small test additions: `server/src/services/agent-message.service.spec.ts` only if appendability for `interrupted` needs a new regression assertion beyond existing coverage.

## Baseline

- [ ] **Step 1: Confirm Slice 4 baseline is green**

Run:

```bash
pnpm --dir server test src/services/agent-runner.service.spec.ts src/services/agent-runner-flow.integration.spec.ts src/services/agent-message.service.spec.ts
```

Expected: all tests pass before Slice 5 edits.

---

## Task 1: Add Failed Activity For Runner Errors And Stream Throws

**Files:**

- Modify: `server/src/services/agent-runner.service.spec.ts`
- Modify: `server/src/services/agent-runner.service.ts`

- [ ] **Step 1: Write failing service tests**

Extend existing runner-error tests near:

- `marks the session interrupted and emits an error when runner message streaming fails`
- `marks the session interrupted with the runner-reported provider failure`
- `marks the session interrupted and emits an error when the runner stream ends empty`

Add assertions that `activityService.createSystemEvent` receives a terminal failed event after the start event:

```ts
expect(activityService.createSystemEvent).toHaveBeenCalledWith(userId, sessionId, {
  kind: 'start-processing',
  status: 'failed',
  summary: 'The assistant stopped while processing the message.',
});
```

For resume failures, assert `kind: 'runner-recovery'`, `status: 'failed'`, and summary `The assistant stopped while resuming after approval.`.

Run:

```bash
pnpm --dir server test src/services/agent-runner.service.spec.ts
```

Expected red failure: runner errors emit websocket errors and mark the session interrupted, but do not create terminal failed activity.

- [ ] **Step 2: Implement terminal failed activity in error cleanup**

In `AgentRunnerService`:

- Add a small helper:

```ts
private createFailedActivityEvent(userId: string, sessionId: string, kind: AgentSessionActivityEventKind, summary: string) {
  this.createActivityEvent(userId, sessionId, {
    kind,
    status: AgentSessionActivityEventStatus.Failed,
    summary,
  });
}
```

- Convert current string activity kinds to enum imports:
  - `AgentSessionActivityEventKind.StartProcessing`
  - `AgentSessionActivityEventKind.RunnerRecovery`
  - `AgentSessionActivityEventStatus.Running`
  - `AgentSessionActivityEventStatus.Failed`
- Thread the active activity kind/summary into `emitRunnerFailure`, for example:
  - message send: start-processing, `The assistant stopped while processing the message.`
  - approval resume: runner-recovery, `The assistant stopped while resuming after approval.`

Do not await activity creation beyond the existing fire-and-forget behavior. Activity persistence must not block runner error handling.

- [ ] **Step 3: Verify service tests are green**

Run:

```bash
pnpm --dir server test src/services/agent-runner.service.spec.ts
```

Expected green result for runner-error and stream-throw activity assertions.

---

## Task 2: Detect Completed Assistant Responses After Same-Turn Tool Failures

**Files:**

- Modify: `server/src/services/agent-runner.service.spec.ts`
- Modify: `server/src/services/agent-runner.service.ts`

- [ ] **Step 1: Write failing service tests for assistant-completion cleanup**

Add an `AgentToolCallRepository` mock to the `AgentRunnerService` test setup and constructor.

Also add the required imports and helper in `agent-runner.service.spec.ts`:

```ts
import { AgentToolCall } from 'src/database';
import { AgentToolApprovalDecision, AgentToolCallStatus, AgentToolDataClass, AgentToolName } from 'src/enum';
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';
```

```ts
const makeToolCall = (overrides: Partial<AgentToolCall> = {}): AgentToolCall => ({
  id: '00000000-0000-4000-8000-000000000333',
  sessionId: '00000000-0000-4000-8000-000000000100',
  toolName: AgentToolName.ProposeAlbumOperations,
  status: AgentToolCallStatus.Completed,
  approvalDecision: AgentToolApprovalDecision.Approved,
  requestSummary: 'Tool call',
  responseSummary: null,
  redactedRequestMetadata: {},
  redactedResponseMetadata: null,
  dataClass: AgentToolDataClass.Metadata,
  assetCount: 0,
  albumCount: 0,
  providerSnapshot: {},
  startedAt: new Date('2026-05-14T10:00:00.000Z'),
  completedAt: new Date('2026-05-14T10:00:01.000Z'),
  error: null,
  ...overrides,
});
```

Add tests:

1. `marks a completed assistant turn interrupted when a same-turn planning tool was denied`

```ts
toolCallRepository.getBySessionId.mockResolvedValueOnce([]).mockResolvedValueOnce([
  makeToolCall({
    sessionId,
    toolName: AgentToolName.ProposeAlbumOperations,
    status: AgentToolCallStatus.Denied,
    error: 'Selection handle is expired or not available for this session',
  }),
]);
sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);
```

Expected:

- assistant message is still persisted and websocketed;
- `sessionRepository.markInterruptedFromActive(userId, sessionId)` is called;
- failed activity event is created with `kind: start-processing`, `status: failed`, and a plain summary such as `The assistant stopped after a Gallery tool error.`;
- no `runner-error` websocket is emitted because the assistant did produce a user-facing response.

2. `ignores historical failed tool calls that existed before this runner turn`

Baseline and final `getBySessionId` both include the same denied/failed tool-call ID. Expected: no interrupted mark and no failed cleanup activity.

3. `does not mark normal assistant completions failed when no same-turn tool failure exists`

Final tool calls are empty or only `completed`. Expected: no interrupted mark and no failed cleanup activity.

4. `does not mark a completed turn failed when the pre-dispatch tool-call baseline cannot be read`

Have the first `toolCallRepository.getBySessionId` reject and the stream complete normally. Expected: assistant completion is persisted, no interrupted mark is attempted, no failed cleanup activity is created, and the dispatch does not throw. This avoids treating old failed/denied tool calls as new when the baseline is unavailable.

Run:

```bash
pnpm --dir server test src/services/agent-runner.service.spec.ts
```

Expected red failure: no same-turn tool failure inspection exists.

- [ ] **Step 2: Implement bounded same-turn tool failure detection**

In `AgentRunnerService`:

- Inject `AgentToolCallRepository`.
- Before `processRunnerStream`, capture a baseline set of existing tool-call IDs for the session:

```ts
const baselineToolCallIds = await this.listToolCallIds(sessionId);
```

If the baseline repository read fails, record an unavailable baseline (`undefined`) and skip same-turn tool-failure cleanup for that dispatch. Do not use an empty set after a baseline read failure because that can misclassify historical failures as new same-turn failures.

- Pass the baseline into `processRunnerStream`.
- After an `assistant-message-completed` event is persisted and websocketed, if the session remains `running`, inspect current tool calls and find new same-turn calls whose status is `denied` or `failed`.
- Treat only new IDs not present in the baseline as same-turn failures.
- If a new failed/denied call exists:
  - call `sessionRepository.markInterruptedFromActive(userId, sessionId)`;
  - create failed activity `{ kind: activeKind, status: failed, summary: 'The assistant stopped after a Gallery tool error.' }`;
  - do not throw and do not emit `runner-error`.

Keep the check no-op when:

- the session is `waiting_for_tool_approval`;
- the session is `waiting_for_plan_review`;
- the session is `cancelled`, `completed`, `failed`, or already `interrupted`;
- there are no new failed/denied tool calls.
- the pre-dispatch tool-call baseline was unavailable.

- [ ] **Step 3: Verify service tests are green**

Run:

```bash
pnpm --dir server test src/services/agent-runner.service.spec.ts
```

Expected green result for same-turn failure cleanup and historical failure guard.

---

## Task 3: Preserve Approval And Plan-Review Wait States

**Files:**

- Modify: `server/src/services/agent-runner.service.spec.ts`

- [ ] **Step 1: Strengthen approval wait coverage**

In `finishes the active dispatch without runner error when a tool pauses for approval`, assert:

```ts
expect(activityService.createSystemEvent).not.toHaveBeenCalledWith(
  userId,
  sessionId,
  expect.objectContaining({ status: 'failed' }),
);
```

- [ ] **Step 2: Add plan-review wait coverage**

Add a test where:

- the runner stream returns `assistant-message-completed`;
- `sessionRepository.getById` returns `AgentSessionStatus.WaitingForPlanReview`;
- `toolCallRepository.getBySessionId` returns a new denied/failed tool call.

Expected:

- assistant message behavior remains whatever existing completion handling allows for plan-review state;
- `markInterruptedFromActive` is not called;
- failed activity is not created.

Run:

```bash
pnpm --dir server test src/services/agent-runner.service.spec.ts
```

Expected green result: approval and plan review states are not converted to failed/interrupted.

---

## Task 4: Integration Regression For Production Shape

**Files:**

- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`

- [ ] **Step 1: Add in-memory activity event storage to the harness**

Add a tiny in-memory activity event service or wire the real `AgentSessionActivityEventService` to an in-memory repository:

- store events by session in creation order;
- websocket created activity events just like production;
- expose `getActivityHistory(sessionId)` from the harness.

Pass this service to `AgentRunnerService` in the harness constructor.

- [ ] **Step 2: Write failing production-shape integration test**

Add a test:

```ts
it('cleans up active work after an unrecovered planning tool failure assistant response', async () => {
  const harness = setup();
  harness.configureRunnerMessage(async function* ({ body }) {
    await harness.toolCalls.create({
      sessionId: body.gallerySessionId,
      toolName: AgentToolName.ProposeAlbumOperations,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      requestSummary: 'Propose album plan',
      responseSummary: null,
      redactedRequestMetadata: {},
      redactedResponseMetadata: { selectionHandleRecovery: { kind: 'invalid-selection-handle' } },
      dataClass: 'metadata',
      providerSnapshot: {},
      error: 'Selection handle is expired or not available for this session',
      completedAt: new Date(),
    });
    yield {
      type: 'assistant-message-completed',
      sessionId: body.gallerySessionId,
      runnerSessionId: 'runner-session-1',
      providerMessageId: 'provider-message-failure',
      content: { blocks: [{ type: 'text', text: 'I could not create the plan because the selection expired.' }] },
    };
  });

  // create session and append user message...
});
```

Expected assertions:

- messages include user + assistant failure response;
- session status is `interrupted`;
- another user message can be appended to the same session;
- activity history includes `start-processing/running` followed by `start-processing/failed`;
- websocket activity stream contains the failed activity event;
- no operation plan row is required/created in this harness.

Run:

```bash
pnpm --dir server test src/services/agent-runner-flow.integration.spec.ts
```

Expected red failure: session remains `running` and activity history lacks failed terminal activity.

- [ ] **Step 3: Add edge-case integration coverage**

Add or extend tests for:

- waiting-for-approval state is not marked failed;
- waiting-for-plan-review state is not marked failed;
- user can append another message after interrupted cleanup.

If the service-level tests already cover one edge thoroughly, the integration test may assert only the production-shape flow plus appendability. Do not duplicate large setup unnecessarily.

- [ ] **Step 4: Verify integration test is green**

Run:

```bash
pnpm --dir server test src/services/agent-runner-flow.integration.spec.ts
```

Expected green result.

---

## Task 5: Broader Verification And Commit

- [ ] **Step 1: Run relevant suites**

Run:

```bash
pnpm --dir server test src/services/agent-runner.service.spec.ts src/services/agent-runner-flow.integration.spec.ts src/services/agent-message.service.spec.ts src/services/agent-session-activity-event.service.spec.ts
pnpm --dir server format
pnpm --dir server lint
pnpm --dir server check
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Review before commit**

Review:

- Assistant failure responses after same-turn tool failures are persisted.
- Session becomes `interrupted`, not `failed`, for recoverable same-turn tool failures.
- `interrupted` sessions remain appendable.
- Waiting-for-tool-approval and waiting-for-plan-review states are not marked failed.
- Runner stream throws and runner-reported errors create terminal failed activity.
- Historical failed/denied tool calls do not poison later successful turns.
- Activity failures are fire-and-forget and cannot block the runner stream.

- [ ] **Step 3: Commit and push**

Commit:

```bash
git add server/src/services/agent-runner.service.ts server/src/services/agent-runner.service.spec.ts server/src/services/agent-runner-flow.integration.spec.ts server/src/services/agent-message.service.spec.ts docs/superpowers/plans/2026-05-22-pi-agent-mcp-handle-filter-hardening-slice-5.md
git commit -m "fix: clean up failed Pi runner turns"
git push
```

Expected: branch `explore/pi-agent-brainstorm` is pushed after Slice 5.
