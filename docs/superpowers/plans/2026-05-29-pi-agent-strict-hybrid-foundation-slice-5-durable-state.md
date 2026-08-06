# Pi Agent Strict/Hybrid Foundation Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workflow continuation and approval state durable (P4b). Today `pendingWorkflow` lives only in the runtime's in-memory `sessions` Map and is lost on restart or a second runner instance — contradicting the trip-album spec's "persist before pausing" requirement. Move the source of truth to the server.

**Architecture:** The runtime emits a new stream event `workflow-state-update` carrying the scrubbed `pendingWorkflow` blob (or `null` to clear) whenever the dispatcher's `setPending` runs. The server persists it on `agent_session` as a nullable JSONB column `workflow_state`. On the next turn (`sendMessage`) and on `resumeSession`, the server passes the rehydrated `workflow_state` into the runner request; the runtime seeds `entry.pendingWorkflow` from it. The in-memory Map becomes a write-through cache for the active turn. Continuation `expiresAt` is clamped to `min(strictWorkflowPendingTtlMs, selection-handle expiry)`; a stale handle is caught deterministically by `proposeAlbumFromSelection` validation on resume.

**Tech Stack:** Node.js ESM (`pnpm --dir agent-runner test`); server TypeScript + Vitest (`pnpm --dir server test`); Kysely schema + fork migration in `server/src/schema/migrations-gallery/`.

---

## Spec Scope

Implements Slice 5 (Durable state, P4b) from `docs/superpowers/specs/2026-05-29-pi-agent-strict-hybrid-foundation-design.md` (Pillar P4).

Covered requirements:

- A `workflow-state-update` event persists/clears `agent_session.workflow_state`.
- Rehydration on the next turn reconstructs `entry.pendingWorkflow`.
- Continuation survives a simulated runtime restart (fresh in-memory Map; state from DB).
- Continuation `expiresAt` ≤ referenced selection-handle expiry; a stale handle yields a deterministic failure, not a false success.
- The persisted blob is scrubbed (no raw asset IDs / `sourceRef`).
- Approval-pending state is durable across restart (resume after approval works without the original in-memory entry).

Not included in this slice:

- Copy delegation / observability events (Slice 6).
- New workflows (Slice 7).
- Any change to plan/handle persistence semantics (reused as-is).

## File Structure

- Create `server/src/schema/migrations-gallery/<timestamp>-agent-session-workflow-state.ts`
  - Adds nullable `workflow_state jsonb` to `agent_session`.
- Modify `server/src/schema/tables/agent-session.table.ts`
  - Add `workflowState` column mapping.
- Modify `server/src/repositories/agent-session.repository.ts`
  - Read/write `workflowState`; expose `setWorkflowState(sessionId, state | null)`.
- Modify `server/src/services/agent-runner.service.ts`
  - Handle the `workflow-state-update` event → persist; include `workflowState` in the runner request payload for `sendMessage`/`resumeAfterToolApproval`.
- Modify `server/src/types/agent-runner.types.ts`
  - Add `workflow-state-update` to `AgentRunnerStreamEvent`; add `workflowState` to the create/resume request types.
- Modify `agent-runner/src/strict-workflows/dispatcher.mjs`
  - `setPending` also emits a `workflow-state-update` event via the injected `emit`.
- Modify `agent-runner/src/pi-runtime.mjs` / `e2e-runtime.mjs`
  - Seed `entry.pendingWorkflow` from the request's `workflowState`; emit the new event when state changes.
- Tests: `server/src/services/agent-runner.service.spec.ts`, `agent-runner/src/pi-runtime.test.mjs`.

## Task 1: Schema + Repository

**Files:**

- Create migration; Modify `agent-session.table.ts`, `agent-session.repository.ts`

- [ ] **Step 1: Add the migration and column (fork migrations dir)**

Add a fork-only migration in `server/src/schema/migrations-gallery/` with a round timestamp adding `workflow_state jsonb` (nullable) to `agent_session`. Map it as `workflowState` in `agent-session.table.ts`.

- [ ] **Step 2: Write the failing repository test**

In the agent-session repository medium spec (real DB; create
`agent-session.repository.spec.ts` if it does not exist, or extend the nearest
existing `*.repository.spec.ts`), assert `setWorkflowState` round-trips a JSON
blob and that `null` clears it. `workflow_state` is server-internal: it is not
exposed through any DTO/OpenAPI surface and is not projected to the websocket/UI.

- [ ] **Step 3: Implement repository access**

Add `setWorkflowState(userId, sessionId, state)` (write-through, optimistic `updateId`) and include `workflowState` in `getById` projections.

- [ ] **Step 4: Run server tests**

```bash
pnpm --dir server test -- --run src/repositories/agent-session.repository.spec.ts
```

Expected: PASS (DB via testcontainers).

## Task 2: Event Contract + Persistence Wiring

**Files:**

- Modify: `server/src/types/agent-runner.types.ts`, `server/src/services/agent-runner.service.ts`, `server/src/services/agent-runner.service.spec.ts`

- [ ] **Step 1: Add the event + request fields to the contract**

Add `workflow-state-update` (`{ type, sessionId, runnerSessionId, workflowState: object | null }`) to `AgentRunnerStreamEvent`. Add `workflowState?: object | null` to the create-session/send-message and resume-after-approval request types.

- [ ] **Step 2: Write the failing service test**

In `agent-runner.service.spec.ts`, assert:

- A `workflow-state-update` event with a blob calls `sessionRepository.setWorkflowState(..., blob)`.
- A `workflow-state-update` with `null` clears it.
- `sendMessage`/`resumeAfterToolApproval` include the persisted `workflowState` in the runner request payload.

- [ ] **Step 3: Implement the persistence handler**

In the runner event stream handler, on `workflow-state-update` persist via the repository (do not surface it to the websocket/UI). When dispatching a runner request, load `session.workflowState` and include it.

- [ ] **Step 4: Run server tests**

```bash
pnpm --dir server test -- --run src/services/agent-runner.service.spec.ts
```

Expected: PASS.

## Task 3: Runtime Emits + Rehydrates

**Files:**

- Modify: `agent-runner/src/strict-workflows/dispatcher.mjs`, `agent-runner/src/pi-runtime.mjs`, `agent-runner/src/e2e-runtime.mjs`, `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Write the failing restart test**

```js
it('rehydrates pending workflow state after a simulated runtime restart', async () => {
  const { sdk, ai } = createFakeDependencies({
    mcpToolNames: [
      /* trip tools */
    ],
  });
  const { fetchImplementation } = createStrictWorkflowFetch({
    recommendation: { action: 'ask_user' },
    candidates: [makeStrictTripCandidate({ dedupeKey: 'a' }), makeStrictTripCandidate({ dedupeKey: 'b' })],
  });

  // Turn 1 on runtime A: ask_user → emits workflow-state-update with the pending blob.
  const runtimeA = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
  await runtimeA.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));
  const turn1 = await collect(
    runtimeA.sendMessage(createMessageRequest({ content: text('Create an album for my recent trip') })),
  );
  const stateEvent = turn1.find((e) => e.type === 'workflow-state-update');
  assert.ok(stateEvent.workflowState);
  assert.doesNotMatch(JSON.stringify(stateEvent.workflowState), /sourceRef|assetIds/);

  // Turn 2 on a fresh runtime B (cold Map), seeded with the persisted state from the request.
  const runtimeB = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
  await runtimeB.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));
  const turn2 = await collect(
    runtimeB.sendMessage(
      createMessageRequest({ content: text('the first one'), workflowState: stateEvent.workflowState }),
    ),
  );
  assert.equal(turn2.at(-1).type, 'assistant-message-completed');
  assert.match(turn2.at(-1).content.blocks[0].text, /Review the plan/);
});

it('rehydrates approval-pending state so resume works on a cold runtime', async () => {
  const { sdk, ai } = createFakeDependencies({
    mcpToolNames: [
      /* trip tools */
    ],
  });
  const approvalFetch = createStrictWorkflowFetch({
    planResponse: { status: 'approval-required', toolCall: { id: '00000000-0000-4000-8000-000000000999' } },
  });

  // Turn 1 on runtime A: approval-required → emits tool-approval-needed + workflow-state-update (approval blob).
  const runtimeA = createPiRuntime({ sdk, ai, fetch: approvalFetch.fetchImplementation });
  await runtimeA.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));
  const turn1 = await collect(
    runtimeA.sendMessage(createMessageRequest({ content: text('Create an album for my recent trip to USA') })),
  );
  assert.ok(turn1.some((e) => e.type === 'tool-approval-needed'));
  const stateEvent = turn1.find((e) => e.type === 'workflow-state-update');
  assert.equal(stateEvent.workflowState.kind, 'approval');
  assert.doesNotMatch(JSON.stringify(stateEvent.workflowState), /sourceRef|assetIds/);

  // Approval resumes on a fresh runtime B, seeded only from the persisted blob (the approved plan result is supplied).
  const resumeFetch = createStrictWorkflowFetch();
  const runtimeB = createPiRuntime({ sdk, ai, fetch: resumeFetch.fetchImplementation });
  await runtimeB.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));
  const resumed = await collect(
    runtimeB.resumeSession({
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      toolCallId: '00000000-0000-4000-8000-000000000999',
      approvalDecision: 'approved',
      toolResult: { status: 'success', plan: { id: strictTripPlanId } },
      workflowState: stateEvent.workflowState,
    }),
  );
  assert.equal(resumed.at(-1).type, 'assistant-message-completed');
  assert.match(resumed.at(-1).content.blocks[0].text, /Review the plan/);
});
```

- [ ] **Step 2: Run and verify red**

```bash
pnpm --dir agent-runner test
```

Expected: FAIL — runtime ignores `workflowState`; no `workflow-state-update` emitted.

- [ ] **Step 3: Emit on state change + seed on entry**

- In the dispatcher, wrap `setPending` so every set/clear also emits `{ type: 'workflow-state-update', workflowState: next ?? null }` through `emit`.
- In `createSession`/`sendMessage`/`resumeSession`, read `body.workflowState` and seed `entry.pendingWorkflow` before routing (request value wins over a stale Map value).
- Clamp `expiresAt` to `min(now + strictWorkflowPendingTtlMs, handleExpiry)` when building continuation; on resume, if expired, return the existing deterministic expired/missing copy.

- [ ] **Step 4: Add a stale-handle resume test**

Assert that resuming a continuation whose selection handle no longer validates produces deterministic failure copy (planning returns non-success) and no success language — reusing the existing redaction/gate behavior.

- [ ] **Step 5: Run full suites and verify green**

```bash
pnpm --dir agent-runner test
pnpm --dir server test -- --run src/services/agent-runner.service.spec.ts src/repositories/agent-session.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Drift check + commit**

```bash
git diff -- agent-runner/src server/src
```

Expected: no copy delegation / observability (Slice 6); no new workflows (Slice 7); UI/websocket does not surface `workflow_state`.

```bash
git add agent-runner/src server/src docs/superpowers/plans/2026-05-29-pi-agent-strict-hybrid-foundation-slice-5-durable-state.md
git commit -m "feat: persist strict/hybrid workflow continuation state server-side"
```

## Plan Self-Review

- Spec coverage: emit/persist/clear, rehydration, restart survival, scrubbing, TTL clamp, and stale-handle safety each have a test.
- TDD order: red restart + repository tests precede implementation.
- Scope: durability only; no copy/observability or new workflows.
- Safety: persisted blob is scrubbed; stale handles fail deterministically through the existing plan-validation gate; UI never sees raw state.
- Fork hygiene: migration lives in `migrations-gallery/` with a round timestamp.
- Placeholder scan: no TODO/TBD placeholders.
