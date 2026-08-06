# Pi Agent Runner Flow Slice 1 Server Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TDD coverage and any needed server fixes proving that approving or denying a pending Pi tool call records the decision and resumes the runner exactly once.

**Architecture:** This slice stays in the Gallery server service layer. `AgentToolService` remains responsible for validating and recording approval decisions, executing approved read tools, and delegating continuation to `AgentRunnerService`; `AgentRunnerService` remains responsible for streaming runner continuation events into persisted messages and websocket events.

**Tech Stack:** NestJS services, Vitest, existing repository/service automocks, async generator fakes for runner SSE streams.

---

## Scope

Implement Slice 1 from `docs/superpowers/specs/2026-05-17-pi-agent-runner-flow-testing-design.md`.

This slice covers:

- approving a pending tool call persists the approval and resumes the runner once;
- denying a pending tool call persists the denial reason and resumes the runner once;
- already-handled tool calls do not resume the runner;
- a runner-less session records the decision but does not attempt continuation;
- continuation deltas are forwarded to websocket;
- continuation completion persists one assistant message;
- runner continuation failures are surfaced through existing `AgentRunnerService` failure handling;
- approved tool execution failures still produce a runner continuation with an error-shaped `toolResult` so Pi is not left waiting forever.

This slice does not cover:

- browser approval card rendering;
- agent-runner HTTP route validation;
- Pi SDK runtime pause/resume behavior;
- full end-to-end harness with real repositories.

## File Structure

- Modify `server/src/services/agent-tool.service.spec.ts`
  - Add/strengthen approval-decision tests for runner continuation behavior.
  - Add a regression test for approved tool execution failure still resuming Pi.
  - Add a denied-decision continuation test.
  - Add duplicate/already-handled guard assertions.
- Modify `server/src/services/agent-tool.service.ts`
  - Only if tests expose a gap.
  - Expected likely change: wrap approved tool execution errors into a safe `toolResult` and still call `AgentRunnerService.resumeAfterToolApproval`.
- Modify `server/src/services/agent-runner.service.spec.ts`
  - Add/strengthen continuation stream tests for denied context, active dispatch guard, runner-error handling, and completion persistence.
- Modify `server/src/services/agent-runner.service.ts`
  - Only if tests expose a gap.
  - Expected likely change: none, unless the new tests expose missing runner-error coverage for resume streams.

---

### Task 1: Prove Denied Tool Calls Resume The Runner

**Files:**

- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-tool.service.ts` only if the test fails for a product-relevant reason

- [ ] **Step 1: Write the failing test**

In `server/src/services/agent-tool.service.spec.ts`, add this test near the existing `approveToolCall` tests, after `records $decision approval decision and restores session running`:

```ts
it('resumes a runner-backed session after a denied approval decision', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForToolApproval,
    runnerSessionId: 'runner-session-1',
  });
  const pending = makeToolCall({ sessionId: session.id });
  const denied = makeToolCall({
    ...pending,
    status: AgentToolCallStatus.Denied,
    approvalDecision: AgentToolApprovalDecision.Denied,
    responseSummary: null,
    error: 'Use fewer photos',
    completedAt,
  });

  sessionRepository.getById.mockResolvedValue(session);
  toolCallRepository.getByIdForSession.mockResolvedValue(pending);
  toolCallRepository.transition.mockResolvedValue(denied);

  const result = await sut.approveToolCall(auth, session.id, pending.id, {
    decision: AgentToolApprovalDecision.Denied,
    reason: 'Use fewer photos',
  });
  await flushAsync();

  expect(result).toEqual(
    expect.objectContaining({
      id: pending.id,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      error: 'Use fewer photos',
    }),
  );
  expect(agentRunnerService.resumeAfterToolApproval).toHaveBeenCalledTimes(1);
  expect(agentRunnerService.resumeAfterToolApproval).toHaveBeenCalledWith({
    userId: auth.user.id,
    sessionId: session.id,
    runnerSessionId: 'runner-session-1',
    toolCallId: pending.id,
    approvalDecision: AgentToolApprovalDecision.Denied,
    toolResult: undefined,
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED or existing GREEN**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts -t "resumes a runner-backed session after a denied approval decision"
```

Expected:

- Preferred RED if denied decisions currently do not resume Pi.
- Accept existing GREEN if the behavior is already implemented. If it is GREEN, keep the test because it locks the contract.

- [ ] **Step 3: Implement the minimal code if RED**

If the test fails because `approvalDecision` is not passed to `resumeAfterToolApproval`, update `server/src/services/agent-tool.service.ts` so `resumeRunnerAfterApprovalDecision()` always passes the decision:

```ts
await this.agentRunnerService.resumeAfterToolApproval({
  userId: auth.user.id,
  sessionId: session.id,
  runnerSessionId: session.runnerSessionId!,
  toolCallId: toolCall.id,
  approvalDecision,
  toolResult,
});
```

Do not execute a denied tool. Keep this existing shape:

```ts
const toolResult =
  approvalDecision === AgentToolApprovalDecision.Approved
    ? await this.executeApprovedToolCall(auth, session, toolCall)
    : undefined;
```

- [ ] **Step 4: Re-run the focused test and verify GREEN**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts -t "resumes a runner-backed session after a denied approval decision"
```

Expected: PASS.

- [ ] **Step 5: Commit this task**

```bash
git add server/src/services/agent-tool.service.spec.ts server/src/services/agent-tool.service.ts
git commit -m "test: cover denied pi tool approval continuation"
```

---

### Task 2: Prove Approved Tool Execution Failure Still Resumes Pi

**Files:**

- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-tool.service.ts`

- [ ] **Step 1: Write the failing test**

In `server/src/services/agent-tool.service.spec.ts`, add this test after `executes an approved read tool before resuming a runner-backed session`:

```ts
it('resumes the runner with an error tool result when an approved read tool fails', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForToolApproval,
    runnerSessionId: 'runner-session-1',
  });
  const pending = makeToolCall({
    sessionId: session.id,
    toolName: AgentToolName.ReadAssetMetadata,
    redactedRequestMetadata: { assetIds: [newUuid()] },
    assetCount: 1,
  });
  const approved = makeToolCall({
    ...pending,
    status: AgentToolCallStatus.Approved,
    approvalDecision: AgentToolApprovalDecision.Approved,
    responseSummary: 'Tool call approved by user',
  });

  sessionRepository.getById.mockResolvedValue(session);
  toolCallRepository.getByIdForSession.mockResolvedValueOnce(pending).mockResolvedValueOnce(approved);
  toolCallRepository.transition.mockResolvedValueOnce(approved).mockRejectedValueOnce(new Error('asset read failed'));

  await sut.approveToolCall(auth, session.id, pending.id, { decision: AgentToolApprovalDecision.Approved });
  await flushAsync();
  await flushAsync();

  expect(agentRunnerService.resumeAfterToolApproval).toHaveBeenCalledTimes(1);
  expect(agentRunnerService.resumeAfterToolApproval).toHaveBeenCalledWith({
    userId: auth.user.id,
    sessionId: session.id,
    runnerSessionId: 'runner-session-1',
    toolCallId: pending.id,
    approvalDecision: AgentToolApprovalDecision.Approved,
    toolResult: {
      status: 'error',
      message: 'Approved tool call failed before returning a result.',
    },
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts -t "resumes the runner with an error tool result when an approved read tool fails"
```

Expected: FAIL because the current background continuation can swallow the approved tool execution failure before calling `AgentRunnerService.resumeAfterToolApproval`.

- [ ] **Step 3: Add a safe error result helper**

In `server/src/services/agent-tool.service.ts`, add this helper near the other private helpers:

```ts
private async executeApprovedToolCallForRunner(
  auth: AuthDto,
  session: AgentSession,
  toolCall: AgentToolCall,
): Promise<unknown> {
  try {
    return await this.executeApprovedToolCall(auth, session, toolCall);
  } catch {
    return {
      status: 'error',
      message: 'Approved tool call failed before returning a result.',
    };
  }
}
```

- [ ] **Step 4: Use the helper in runner continuation**

In `resumeRunnerAfterApprovalDecision()` in `server/src/services/agent-tool.service.ts`, replace the approved branch:

```ts
const toolResult =
  approvalDecision === AgentToolApprovalDecision.Approved
    ? await this.executeApprovedToolCall(auth, session, toolCall)
    : undefined;
```

with:

```ts
const toolResult =
  approvalDecision === AgentToolApprovalDecision.Approved
    ? await this.executeApprovedToolCallForRunner(auth, session, toolCall)
    : undefined;
```

- [ ] **Step 5: Re-run the focused test and verify GREEN**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts -t "resumes the runner with an error tool result when an approved read tool fails"
```

Expected: PASS.

- [ ] **Step 6: Run the existing approved success test**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts -t "executes an approved read tool before resuming a runner-backed session"
```

Expected: PASS, proving the happy path still passes the real tool result.

- [ ] **Step 7: Commit this task**

```bash
git add server/src/services/agent-tool.service.spec.ts server/src/services/agent-tool.service.ts
git commit -m "fix: resume pi after approved tool execution failure"
```

---

### Task 3: Prove Already-Handled Tool Calls Never Resume Pi

**Files:**

- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-tool.service.ts` only if the test fails

- [ ] **Step 1: Write the failing test**

In `server/src/services/agent-tool.service.spec.ts`, replace or extend the existing `rejects non-pending approval without transition` test so it also proves no session update and no runner continuation:

```ts
it('rejects non-pending approval without transition, session update, or runner continuation', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    runnerSessionId: 'runner-session-1',
  });
  const toolCall = makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Completed, completedAt });

  sessionRepository.getById.mockResolvedValue(session);
  toolCallRepository.getByIdForSession.mockResolvedValue(toolCall);

  await expect(
    sut.approveToolCall(auth, session.id, toolCall.id, { decision: AgentToolApprovalDecision.Approved }),
  ).rejects.toThrow('Agent tool call is not pending approval');

  expect(toolCallRepository.transition).not.toHaveBeenCalled();
  expect(sessionRepository.update).not.toHaveBeenCalled();
  expect(agentRunnerService.resumeAfterToolApproval).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts -t "rejects non-pending approval without transition"
```

Expected: PASS if the existing guard is already correct; otherwise FAIL until fixed.

- [ ] **Step 3: Implement minimal fix if RED**

If the test fails because update/resume happens before the pending-status guard, keep the guard before any transition, session update, or continuation:

```ts
if (toolCall.status !== AgentToolCallStatus.PendingApproval) {
  throw new BadRequestException('Agent tool call is not pending approval');
}
```

This guard must stay before:

```ts
await this.toolCallRepository.transition(...);
await this.sessionRepository.update(...);
void this.resumeRunnerAfterApprovalDecision(...);
```

- [ ] **Step 4: Commit this task**

```bash
git add server/src/services/agent-tool.service.spec.ts server/src/services/agent-tool.service.ts
git commit -m "test: guard handled pi tool approvals"
```

---

### Task 4: Prove Runner Continuation Sends Denial Context

**Files:**

- Modify: `server/src/services/agent-runner.service.spec.ts`
- Modify: `server/src/services/agent-runner.service.ts` only if the test fails

- [ ] **Step 1: Write the failing test**

In `server/src/services/agent-runner.service.spec.ts`, add this test after `resumes a runner session after tool approval and streams the continued assistant message`:

```ts
it('resumes a runner session with denied approval context and no tool result', async () => {
  const sessionId = '00000000-0000-4000-8000-000000000100';
  const runnerSessionId = 'runner-session-1';
  const assistantContent: AgentMessageContent = { blocks: [{ type: 'text', text: 'I will avoid that action.' }] };
  const assistantMessage = makeAssistantMessage({
    sessionId,
    content: assistantContent,
    providerMessageId: 'provider-message-denied',
  });

  configRepository.getEnv.mockReturnValue({
    agent: {
      runnerUrl: 'http://agent-runner:4477',
      runnerHealthTimeoutMs: 3000,
      runnerMessageStreamTimeoutMs: 120_000,
    },
  } as never);
  agentRunnerRepository.streamResume.mockReturnValue(
    streamEvents([
      {
        type: 'assistant-message-delta',
        sessionId,
        runnerSessionId,
        delta: 'I will avoid',
        sequence: 1,
      },
      {
        type: 'assistant-message-completed',
        sessionId,
        runnerSessionId,
        providerMessageId: 'provider-message-denied',
        content: assistantContent,
      },
    ]),
  );
  messageRepository.create.mockResolvedValue(assistantMessage);
  sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

  await sut.resumeAfterToolApproval({
    userId,
    sessionId,
    runnerSessionId,
    toolCallId: '00000000-0000-4000-8000-000000000333',
    approvalDecision: 'denied',
  });

  expect(agentRunnerRepository.streamResume).toHaveBeenCalledWith({
    url: 'http://agent-runner:4477',
    runnerSessionId,
    timeoutMs: 120_000,
    body: {
      gallerySessionId: sessionId,
      toolCallId: '00000000-0000-4000-8000-000000000333',
      approvalDecision: 'denied',
    },
  });
  expect(websocketRepository.clientSend).toHaveBeenNthCalledWith(1, 'on_agent_session_event', userId, {
    type: 'assistant-message-delta',
    sessionId,
    delta: 'I will avoid',
    sequence: 1,
    createdAt: '2026-05-14T10:00:00.000Z',
  });
  expect(messageRepository.create).toHaveBeenCalledWith({
    sessionId,
    role: AgentMessageRole.Assistant,
    content: assistantContent,
    providerMessageId: 'provider-message-denied',
    toolCallId: null,
  });
});
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
pnpm --dir server test src/services/agent-runner.service.spec.ts -t "resumes a runner session with denied approval context"
```

Expected: PASS if the existing resume body builder is already correct; otherwise FAIL.

- [ ] **Step 3: Implement minimal fix if RED**

If the body incorrectly includes `toolResult: undefined`, keep the spread conditional in `resumeRunnerSession()`:

```ts
const body = {
  gallerySessionId: sessionId,
  ...(toolCallId ? { toolCallId } : {}),
  ...(approvalDecision ? { approvalDecision } : {}),
  ...(toolResult !== undefined ? { toolResult } : {}),
};
```

- [ ] **Step 4: Commit this task**

```bash
git add server/src/services/agent-runner.service.spec.ts server/src/services/agent-runner.service.ts
git commit -m "test: cover denied pi runner resume context"
```

---

### Task 5: Prove Runner Resume Failures Emit Safe Errors

**Files:**

- Modify: `server/src/services/agent-runner.service.spec.ts`
- Modify: `server/src/services/agent-runner.service.ts` only if the test fails

- [ ] **Step 1: Write the failing test for runtime errors**

In `server/src/services/agent-runner.service.spec.ts`, add this test near the existing runner failure tests:

```ts
it('marks the session interrupted and emits an error when runner resume streaming fails', async () => {
  const sessionId = '00000000-0000-4000-8000-000000000100';
  const runnerSessionId = 'runner-session-1';
  const error = new Error('resume connection failed with sk-secret');

  configRepository.getEnv.mockReturnValue({
    agent: {
      runnerUrl: 'http://agent-runner:4477',
      runnerHealthTimeoutMs: 3000,
      runnerMessageStreamTimeoutMs: 120_000,
    },
  } as never);
  agentRunnerRepository.streamResume.mockReturnValue(failingStream(error));
  sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

  await expect(
    sut.resumeAfterToolApproval({
      userId,
      sessionId,
      runnerSessionId,
      toolCallId: '00000000-0000-4000-8000-000000000333',
      approvalDecision: 'approved',
      toolResult: { status: 'success' },
    }),
  ).rejects.toBe(error);

  expect(sessionRepository.markInterruptedFromActive).toHaveBeenCalledWith(userId, sessionId);
  expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
    type: 'runner-error',
    sessionId,
    message: 'The assistant runner stopped while processing the message.',
    createdAt: '2026-05-14T10:00:00.000Z',
  });
});
```

- [ ] **Step 2: Write the failing test for runner-reported errors**

Add this second test:

```ts
it('marks the session interrupted with a runner-reported resume failure', async () => {
  const sessionId = '00000000-0000-4000-8000-000000000100';
  const runnerSessionId = 'runner-session-1';

  configRepository.getEnv.mockReturnValue({
    agent: {
      runnerUrl: 'http://agent-runner:4477',
      runnerHealthTimeoutMs: 3000,
      runnerMessageStreamTimeoutMs: 120_000,
    },
  } as never);
  agentRunnerRepository.streamResume.mockReturnValue(
    streamEvents([
      {
        type: 'runner-error',
        sessionId,
        runnerSessionId,
        message: 'Provider rejected the approval continuation',
      },
    ]),
  );
  sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

  await expect(
    sut.resumeAfterToolApproval({
      userId,
      sessionId,
      runnerSessionId,
      toolCallId: '00000000-0000-4000-8000-000000000333',
      approvalDecision: 'approved',
      toolResult: { status: 'success' },
    }),
  ).rejects.toThrow('Provider rejected the approval continuation');

  expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
    type: 'runner-error',
    sessionId,
    message: 'Provider rejected the approval continuation',
    createdAt: '2026-05-14T10:00:00.000Z',
  });
});
```

- [ ] **Step 3: Run the focused tests**

Run:

```bash
pnpm --dir server test src/services/agent-runner.service.spec.ts -t "runner resume"
```

Expected: PASS if resume already shares the same failure path as message streaming; otherwise FAIL.

- [ ] **Step 4: Implement minimal fix if RED**

If resume failures do not call `emitRunnerFailure()`, ensure `resumeRunnerSession()` wraps `processRunnerStream()` in the same catch pattern as `sendMessageToRunner()`:

```ts
try {
  // existing runnerUrl/body/processRunnerStream code
} catch (error) {
  await this.emitRunnerFailure(userId, sessionId, error);
  throw error;
}
```

- [ ] **Step 5: Commit this task**

```bash
git add server/src/services/agent-runner.service.spec.ts server/src/services/agent-runner.service.ts
git commit -m "test: cover pi runner resume failures"
```

---

### Task 6: Prove Concurrent Dispatch Blocks Duplicate Continuation

**Files:**

- Modify: `server/src/services/agent-runner.service.spec.ts`
- Modify: `server/src/services/agent-runner.service.ts` only if the test fails

- [ ] **Step 1: Write the failing test**

In `server/src/services/agent-runner.service.spec.ts`, add this test near the existing active-dispatch tests:

```ts
it('rejects runner resume while another dispatch is active for the same session', async () => {
  const sessionId = '00000000-0000-4000-8000-000000000100';
  const runnerSessionId = 'runner-session-1';
  let releaseMessageStream: (() => void) | undefined;

  configRepository.getEnv.mockReturnValue({
    agent: {
      runnerUrl: 'http://agent-runner:4477',
      runnerHealthTimeoutMs: 3000,
      runnerMessageStreamTimeoutMs: 120_000,
    },
  } as never);
  agentRunnerRepository.streamMessage.mockReturnValue(
    (async function* () {
      await new Promise<void>((resolve) => {
        releaseMessageStream = resolve;
      });
      yield {
        type: 'assistant-message-completed',
        sessionId,
        runnerSessionId,
        providerMessageId: 'provider-message-1',
        content: { blocks: [{ type: 'text', text: 'Done.' }] },
      };
    })(),
  );
  messageRepository.create.mockResolvedValue(makeAssistantMessage({ sessionId }));
  sessionRepository.getById.mockResolvedValue({ status: AgentSessionStatus.Running } as never);

  const activeSend = sut.sendMessage({
    userId,
    sessionId,
    runnerSessionId,
    messageId: '00000000-0000-4000-8000-000000000200',
    content: { blocks: [{ type: 'text', text: 'Start.' }] },
  });

  await Promise.resolve();

  await expect(
    sut.resumeAfterToolApproval({
      userId,
      sessionId,
      runnerSessionId,
      toolCallId: '00000000-0000-4000-8000-000000000333',
      approvalDecision: 'approved',
      toolResult: { status: 'success' },
    }),
  ).rejects.toThrow('Agent session already has a message in progress');

  expect(agentRunnerRepository.streamResume).not.toHaveBeenCalled();

  releaseMessageStream?.();
  await activeSend;
});
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
pnpm --dir server test src/services/agent-runner.service.spec.ts -t "rejects runner resume while another dispatch is active"
```

Expected: PASS if `sessionDispatches` already guards resume; otherwise FAIL.

- [ ] **Step 3: Implement minimal fix if RED**

If resume does not check active dispatches, keep this guard at the start of `resumeAfterToolApproval()`:

```ts
const activeDispatch = this.sessionDispatches.get(sessionId);
if (activeDispatch) {
  throw new BadRequestException('Agent session already has a message in progress');
}
```

- [ ] **Step 4: Commit this task**

```bash
git add server/src/services/agent-runner.service.spec.ts server/src/services/agent-runner.service.ts
git commit -m "test: block duplicate pi runner continuations"
```

---

### Task 7: Run Slice Verification

**Files:**

- Verify: `server/src/services/agent-tool.service.spec.ts`
- Verify: `server/src/services/agent-runner.service.spec.ts`
- Verify: `server/src/services/agent-tool.service.ts`
- Verify: `server/src/services/agent-runner.service.ts`

- [ ] **Step 1: Run the two focused service suites**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts src/services/agent-runner.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run server typecheck or lint target used by this repo**

Run:

```bash
pnpm --dir server check:typescript
```

Expected: PASS. If `server` has no `check:typescript` script in this branch, run:

```bash
pnpm --dir server exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Review the diff for accidental unrelated files**

Run:

```bash
git diff --stat
git diff -- server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/services/agent-runner.service.ts server/src/services/agent-runner.service.spec.ts
```

Expected: only Slice 1 server continuation tests and minimal service changes are present in these files. Do not stage `agent-runner/.pi-runtime/`.

- [ ] **Step 4: Commit final verification cleanup if needed**

If Tasks 1-6 already committed every change, skip this step. If there are uncommitted formatting or small cleanup changes in the Slice 1 files, run:

```bash
git add server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/services/agent-runner.service.ts server/src/services/agent-runner.service.spec.ts
git commit -m "test: harden pi approval continuation flow"
```

---

## Self-Review Checklist

- Spec coverage:
  - Approve persistence and continuation: Tasks 1-3.
  - Deny persistence and continuation: Tasks 1 and 4.
  - Already-handled guard: Task 3.
  - Continuation deltas and completion persistence: existing test plus Task 4.
  - Runner continuation failure: Task 5.
  - Duplicate continuation guard: Task 6.
- TDD:
  - Every behavior task starts by adding or tightening tests before implementation changes.
  - Implementation steps are conditional and minimal.
- Edge cases:
  - Runner-less session is covered by existing `does not try to resume a runner when approving a session without a runner session id`.
  - Approved tool execution failure is covered by Task 2.
  - Active dispatch duplicate protection is covered by Task 6.
- Scope:
  - No browser, runner HTTP, or Pi SDK runtime tests are added in this slice.
  - No production changes are planned unless a failing test exposes a continuation gap.
