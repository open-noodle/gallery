# Pi Agent Strict Recent Trip Album Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the strict recent-trip workflow so it never emits success copy without a persisted plan id and handles detector/planning failure paths deterministically.

**Architecture:** Keep failure handling inside `runCreateRecentTripAlbumWorkflow`, returning structured states for `planned`, `needs_input`, `failed`, and `approval_required`. The e2e runtime converts those states to assistant-completed output or an approval pause. Production `pi-runtime` routing remains out of scope until Slice 5.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, existing e2e runner MCP client shape.

---

## Spec Scope

Implements Slice 4 from `docs/superpowers/specs/2026-05-28-pi-agent-strict-recent-trip-album-design.md`.

Covered requirements:

- Success message is emitted only when the planning result contains a persisted plan id, either as `planId` or `plan.id`.
- If planning returns denied/error, the final message does not contain "plan is ready", "I created", or "I proposed".
- Empty candidates ask for a concrete date/place source.
- `ask_user` creates a single clarification question with candidate labels.
- Missing candidate handle does not call planning.
- Zero-asset candidate handle does not call planning.
- `approval-required` pauses without explanatory assistant copy.
- Approval resume continues the same strict workflow with the approved tool result and does not reroute the follow-up through open provider orchestration.
- Tool errors redact gateway tokens and secrets.

Important scope note:

- Full persisted pending-state approval resume belongs to Slice 6. In this slice, "approval resume" means the executor accepts an already-approved planning tool result via an optional `approvedPlanResult` parameter and validates it through the same plan-id gate without re-running open provider orchestration.

Not included in this slice:

- Production `pi-runtime` provider bypass.
- Durable session-state storage.
- User follow-up candidate selection.
- End-to-end server/websocket plan-card assertions.

## File Structure

- Modify `agent-runner/src/strict-workflows.mjs`
  - Add status-aware tool result checks.
  - Add zero-asset guard.
  - Add plan-id success gate.
  - Add approved planning result continuation support.
- Modify `agent-runner/src/strict-workflows.test.mjs`
  - Add unit tests for all Slice 4 failure/success gates.
- Modify `agent-runner/src/e2e-runtime.mjs`
  - If strict workflow returns `approval_required`, yield `tool-approval-needed` and no assistant completion.
  - For failed/needs-input states, emit safe text only.
- Modify `agent-runner/src/e2e-runtime.test.mjs`
  - Add e2e runtime coverage for planning denied, missing plan id, zero-asset handles, approval-required pause, and redacted JSON-RPC planning errors.

## Task 1: Strict Workflow Failure Gates

**Files:**

- Modify: `agent-runner/src/strict-workflows.mjs`
- Modify: `agent-runner/src/strict-workflows.test.mjs`
- Modify: `agent-runner/src/e2e-runtime.mjs`
- Modify: `agent-runner/src/e2e-runtime.test.mjs`

- [x] **Step 1: Add failing strict-workflow unit tests**

Append these tests to `agent-runner/src/strict-workflows.test.mjs` inside the existing `describe('create_recent_trip_album workflow execution', ...)` block:

```js
it('does not emit success copy when planning succeeds without a persisted plan id', async () => {
  const { client, calls } = createWorkflowClient({
    planResult: { status: 'success', summary: 'Stored proposal but no id.' },
  });

  const result = await runCreateRecentTripAlbumWorkflow({
    client,
    workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
  });

  assert.equal(result.status, 'failed');
  assert.equal(calls.map((call) => call.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
  assert.doesNotMatch(result.text, /plan is ready|I created|I proposed|Review the plan/i);
  assert.match(result.text, /could not create a reviewable album plan/i);
});

it('does not emit success copy when planning is denied', async () => {
  const { client } = createWorkflowClient({
    planResult: { status: 'denied', reason: 'Search source did not match any assets' },
  });

  const result = await runCreateRecentTripAlbumWorkflow({
    client,
    workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
  });

  assert.equal(result.status, 'failed');
  assert.match(result.text, /Search source did not match any assets/i);
  assert.doesNotMatch(result.text, /plan is ready|I created|I proposed|Review the plan/i);
});

it('does not call planning for a zero-asset candidate handle', async () => {
  const { client, calls } = createWorkflowClient({
    candidates: [makeTripCandidate({ selectionHandle: { id: tripCandidateHandleId, assetCount: 0 } })],
  });

  const result = await runCreateRecentTripAlbumWorkflow({
    client,
    workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
  });

  assert.equal(result.status, 'needs_input');
  assert.equal(calls.map((call) => call.name).join(','), 'findTripCandidates');
  assert.match(result.text, /found no album-ready assets/i);
});

it('returns approval_required without assistant success text', async () => {
  const { client } = createWorkflowClient({
    planResult: {
      status: 'approval-required',
      toolCall: { id: '00000000-0000-4000-8000-000000000999' },
    },
  });

  const result = await runCreateRecentTripAlbumWorkflow({
    client,
    workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
  });

  assert.equal(result.status, 'approval_required');
  assert.equal(result.toolCallId, '00000000-0000-4000-8000-000000000999');
  assert.equal(result.text, '');
});

it('accepts an approved planning result through the same plan-id gate', async () => {
  const { client, calls } = createWorkflowClient();

  const result = await runCreateRecentTripAlbumWorkflow({
    client,
    workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
    approvedPlanResult: { status: 'success', planId: tripPlanId },
  });

  assert.equal(result.status, 'planned');
  assert.equal(result.planId, tripPlanId);
  assert.equal(calls.map((call) => call.name).join(','), 'findTripCandidates');
  assert.match(result.text, /Review the plan before applying it/);
});

it('returns safe failure text when planning throws a redacted tool error', async () => {
  const { client } = createWorkflowClient({
    planError: new Error('Gallery MCP JSON-RPC error -32001: token [redacted] was rejected'),
  });

  const result = await runCreateRecentTripAlbumWorkflow({
    client,
    workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
  });

  assert.equal(result.status, 'failed');
  assert.match(result.text, /\[redacted\]/);
  assert.doesNotMatch(result.text, /token abc123|secret-value|plan is ready|I created|I proposed|Review the plan/i);
});
```

Update the local `createWorkflowClient` helper to accept `planError`. Its `proposeAlbumFromSelection` branch must `throw planError` when provided before returning `planResult`.

- [x] **Step 2: Add failing e2e runtime tests**

Append these tests in `agent-runner/src/e2e-runtime.test.mjs` near the existing recent-trip tests:

```js
it('does not claim a strict recent-trip plan when planning returns no plan id', async () => {
  const { calls, fetchImplementation } = createFetch(
    tripCandidateHandlers({
      planResponse: { status: 'success', summary: 'Stored proposal without a plan id.' },
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
  assert.match(events.at(-1).content.blocks[0].text, /could not create a reviewable album plan/i);
  assert.doesNotMatch(events.at(-1).content.blocks[0].text, /plan is ready|I created|I proposed|Review the plan/i);
});

it('does not claim a strict recent-trip plan when planning is denied', async () => {
  const { calls, fetchImplementation } = createFetch(
    tripCandidateHandlers({
      planResponse: { status: 'denied', reason: 'Search source did not match any assets' },
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
  assert.match(events.at(-1).content.blocks[0].text, /Search source did not match any assets/i);
  assert.doesNotMatch(events.at(-1).content.blocks[0].text, /plan is ready|I created|I proposed|Review the plan/i);
});

it('does not plan a strict recent-trip album for a zero-asset candidate handle', async () => {
  const zeroCandidate = makeTripCandidateSummary({ selectionHandle: { id: tripCandidateHandleId, assetCount: 0 } });
  const { calls, fetchImplementation } = createFetch(tripCandidateHandlers({ candidates: [zeroCandidate] }));
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates');
  assert.match(events.at(-1).content.blocks[0].text, /found no album-ready assets/i);
});

it('pauses strict recent-trip planning when proposal approval is required', async () => {
  const { calls, fetchImplementation } = createFetch(
    tripCandidateHandlers({
      planResponse: {
        status: 'approval-required',
        toolCall: { id: '00000000-0000-4000-8000-000000000999' },
      },
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
  assert.deepEqual(events, [
    {
      type: 'tool-approval-needed',
      sessionId: gallerySessionId,
      runnerSessionId,
      toolCallId: '00000000-0000-4000-8000-000000000999',
    },
  ]);
});

it('returns safe strict recent-trip failure text when planning JSON-RPC errors', async () => {
  const { calls, fetchImplementation } = createFetch(
    tripCandidateHandlers({
      planError: {
        code: -32001,
        message: `gateway token ${token} secret-value rejected`,
      },
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');
  const text = events.at(-1).content.blocks[0].text;

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
  assert.match(text, /\[redacted\]/);
  assert.doesNotMatch(text, new RegExp(token));
  assert.doesNotMatch(text, /secret-value|plan is ready|I created|I proposed|Review the plan/i);
});
```

Update `tripCandidateHandlers` signature to accept `planResponse` and `planError`, and make the `proposeAlbumFromSelection` handler return either the explicit response or a JSON-RPC error when provided:

```js
  planResponse,
  planError,
```

and inside the handler, before the normal `body` return:

```js
if (planError) {
  return {
    status: 200,
    body: {
      jsonrpc: '2.0',
      id: request.id,
      error: planError,
    },
  };
}
```

Then keep the success body configurable:

```js
          structuredContent:
            planResponse ?? {
              status: 'success',
              summary: 'Stored proposed album from selection.',
              plan: { id: '00000000-0000-4000-8000-000000000923' },
              received: args,
            },
```

- [ ] **Step 3: Run tests and verify red**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL. Current behavior emits `planned` text without plan id, calls planning for zero-asset handles, and does not return `approval_required`.

- [ ] **Step 4: Implement status-aware strict workflow results**

In `agent-runner/src/strict-workflows.mjs`, add:

```js
const failureReason = (toolResult) =>
  toolResult?.reason ?? toolResult?.error ?? toolResult?.summary ?? 'Gallery could not create a reviewable album plan.';

const failedPlanText = (toolResult) =>
  `Gallery could not create a reviewable album plan for that trip: ${failureReason(toolResult)}`;
```

Then update `runCreateRecentTripAlbumWorkflow`:

- Before planning, after `assetCount` is computed:

```js
if (assetCount <= 0) {
  return workflowResult(
    'needs_input',
    'I found a likely recent trip, but it had no album-ready assets after duplicate and stack exclusions. Which date range or place should I use instead?',
  );
}
```

Use an approved result if provided; otherwise wrap only the planning call in a `try/catch` so JSON-RPC/tool failures return `failed` instead of escaping through the runtime:

```js
let planResult = approvedPlanResult;
if (!planResult) {
  try {
    planResult = await client.call('proposeAlbumFromSelection', {
      summary: `Create ${workflow.albumName} with ${assetCount} trip assets from ${label}.`,
      albumName: workflow.albumName,
      description: `Album-ready trip selection from ${label}.${duplicateDescriptionText(candidate)}`,
      selectionHandleId,
    });
  } catch (error) {
    return workflowResult('failed', failedPlanText({ error: error?.message ?? String(error) }), {
      candidate,
      selectionHandleId,
      assetCount,
    });
  }
}
```

Important: preserve already-redacted messages from `createE2eMcpClient`; do not log or reintroduce raw tokens/secrets into returned assistant text.

- Add `approvedPlanResult` to the function signature:

```js
export const runCreateRecentTripAlbumWorkflow = async ({ client, workflow, approvedPlanResult }) => {
```

- Immediately after `planResult`:

```js
if (planResult?.status === 'approval-required') {
  return workflowResult('approval_required', '', {
    toolCallId: planResult.toolCall?.id,
    planResult,
    candidate,
    selectionHandleId,
    assetCount,
  });
}

if (planResult?.status && planResult.status !== 'success') {
  return workflowResult('failed', failedPlanText(planResult), {
    planResult,
    candidate,
    selectionHandleId,
    assetCount,
  });
}

const planId = extractPlanId(planResult);
if (!planId) {
  return workflowResult('failed', failedPlanText(planResult), {
    planResult,
    candidate,
    selectionHandleId,
    assetCount,
  });
}
```

- In the final `planned` result, use the precomputed `planId`.

- [ ] **Step 5: Update e2e runtime approval pause handling**

In `agent-runner/src/e2e-runtime.mjs`, replace the strict workflow event block with:

```js
        if (workflowResult.status === 'approval_required') {
          yield {
            type: 'tool-approval-needed',
            sessionId: gallerySessionId,
            runnerSessionId,
            toolCallId: workflowResult.toolCallId,
          };
          return;
        }

        yield completedEvent({
          gallerySessionId,
          runnerSessionId,
          text: workflowResult.text,
        });
        return;
```

- [ ] **Step 6: Run tests and verify green**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS. The new strict workflow unit tests and e2e runtime tests pass with no regression in existing trip/highlight behavior.

- [ ] **Step 7: Check for future-slice drift**

Run:

```bash
git diff -- agent-runner/src/strict-workflows.mjs agent-runner/src/strict-workflows.test.mjs agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs
```

Expected:

- No production `pi-runtime` routing changes.
- No durable session-state persistence.
- No user follow-up candidate selection implementation.
- No direct apply/write tool.
- Failure text does not contain `plan is ready`, `I created`, `I proposed`, or `Review the plan`.

- [ ] **Step 8: Commit Slice 4**

Run:

```bash
git add agent-runner/src/strict-workflows.mjs agent-runner/src/strict-workflows.test.mjs agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs docs/superpowers/plans/2026-05-28-pi-agent-strict-recent-trip-album-slice-4.md
git commit -m "fix: harden strict recent trip workflow failures"
```

Expected: commit succeeds.

## Plan Self-Review

- Spec coverage: each Slice 4 behavior is listed in tests or the explicit scope note for approval resume.
- TDD order: unit and e2e failing tests come before implementation.
- Scope: production routing, durable pending state, candidate-selection follow-up, and server/websocket e2e stay outside this slice.
- Type consistency: statuses are `planned`, `needs_input`, `failed`, and `approval_required`.
- Placeholder scan: no TODO/TBD placeholders.
