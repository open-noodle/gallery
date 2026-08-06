# Pi Agent Strict/Hybrid Foundation Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `create_recent_trip_album`-specific branches inlined in `pi-runtime.mjs` and `e2e-runtime.mjs` with one generic dispatcher driven by the workflow registry (Slice 1) and the `StrictWorkflow` protocol (Slice 2). Generalize the in-memory continuation state from `pendingStrictWorkflow` to a workflow-agnostic `pendingWorkflow` (this is P4a). Behavior is unchanged for the only registered workflow.

**Architecture:** Add `agent-runner/src/strict-workflows/dispatcher.mjs` exporting `createWorkflowDispatcher({ registry, buildClient })`. It owns: classify-or-resume routing, calling `workflow.run`/`resumeContinuation`/`resumeApproval`, and a single `handleOutcome` that maps each `WorkflowOutcome` arm to runner events (`assistant-message-completed`, `tool-approval-needed`), transcript appends, and `pendingWorkflow` set/clear. The dispatcher is runtime-agnostic: it takes injected `emit`, `appendTranscript`, and `getPending`/`setPending` callbacks so both `pi-runtime` and `e2e-runtime` reuse it. In this slice the router is still the regex fast-path only (`workflow.match`); the LLM classifier arrives in Slice 4. `handoff_open` returns a sentinel so the runtime falls through to provider orchestration. A registry module (`registry.mjs`) instantiates the workflow objects keyed by `kind`.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, existing Pi runtime fake SDK tests, Gallery MCP JSON-RPC `tools/call`.

---

## Spec Scope

Implements Slice 3 (Generic dispatcher) + P4a (generalized in-memory state) from `docs/superpowers/specs/2026-05-29-pi-agent-strict-hybrid-foundation-design.md` (Pillar P2).

Covered requirements:

- New-turn routing, continuation follow-up, and approval resume all flow through one dispatcher.
- `handleOutcome` maps `planned`/`needs_input`/`approval_required`/`failed`/`handoff_open` to the correct events and `pendingWorkflow` transitions.
- `handoff_open` falls through to open provider orchestration with no plan created.
- The runtime session entry holds a generic `pendingWorkflow` (`{ workflowKind, kind, slots, continuation?, toolCallId?, expiresAt }`) instead of `pendingStrictWorkflow`.
- All existing `pi-runtime.test.mjs` and `e2e-runtime` strict cases pass against the dispatcher with no behavior change.
- The registry resolves `create_recent_trip_album` to its `StrictWorkflow`.

Not included in this slice:

- LLM classification (Slice 4); the dispatcher uses regex `match` only.
- Durable server persistence of `pendingWorkflow` (Slice 5); state stays in-memory here.
- Copy delegation / observability events (Slice 6).
- New workflows (Slice 7).

## File Structure

- Create `agent-runner/src/strict-workflows/registry.mjs`
  - Instantiates workflow objects from the workflow modules; `getWorkflow(kind)`, `listWorkflows()`.
- Create `agent-runner/src/strict-workflows/dispatcher.mjs`
  - `createWorkflowDispatcher({ registry, buildClient, now })` exposing `routeTurn` (new turn + continuation follow-up) and `routeApproval` (approval resume), with an internal `handleOutcome`.
- Create `agent-runner/src/strict-workflows/dispatcher.test.mjs`
  - Unit tests with fake registry + fake MCP client + capturing `emit`/`setPending`.
- Modify `agent-runner/src/pi-runtime.mjs`
  - Replace inlined strict branches in `sendMessage`/`resumeSession` with dispatcher calls; rename `pendingStrictWorkflow` → `pendingWorkflow`.
- Modify `agent-runner/src/e2e-runtime.mjs`
  - Same replacement using the shared dispatcher.
- Modify `agent-runner/src/pi-runtime.test.mjs`
  - Keep existing strict assertions; adjust only where the state field name is referenced.

## Task 1: Registry + Dispatcher (pure, runtime-agnostic)

**Files:**

- Create: `agent-runner/src/strict-workflows/registry.mjs`
- Create: `agent-runner/src/strict-workflows/dispatcher.mjs`
- Create: `agent-runner/src/strict-workflows/dispatcher.test.mjs`

- [ ] **Step 1: Write the failing dispatcher tests**

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createWorkflowDispatcher } from './dispatcher.mjs';

const fakeRegistry = (workflow) => ({
  classify: (prompt) =>
    workflow.match(prompt) ? { kind: workflow.kind, ...workflow.match(prompt) } : { kind: 'none' },
  getWorkflow: (kind) => (kind === workflow.kind ? workflow : undefined),
});

const capture = () => {
  const events = [];
  let pending;
  return {
    emit: (event) => events.push(event),
    appendTranscript: () => {},
    getPending: () => pending,
    setPending: (next) => {
      pending = next;
    },
    events,
    get pending() {
      return pending;
    },
  };
};

describe('workflow dispatcher', () => {
  it('routes a matched new turn to run and emits a completed event for planned', async () => {
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      match: (p) => (p.includes('recent trip') ? { slots: { albumName: 'USA Trip', placeHint: 'USA' } } : undefined),
      parseSlots: (s) => s,
      run: async () => ({ status: 'planned', text: 'Review the plan.', planId: 'plan-1', successSummary: {} }),
    };
    const sink = capture();
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });

    const result = await dispatcher.routeTurn({ prompt: 'Create an album for my recent trip to USA', ...sink });

    assert.equal(result.handled, true);
    assert.equal(sink.events.at(-1).type, 'assistant-message-completed');
    assert.match(sink.events.at(-1).content.blocks[0].text, /Review the plan/);
    assert.equal(sink.pending, undefined);
  });

  it('stores pendingWorkflow on needs_input continuation', async () => {
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      match: () => ({ slots: {} }),
      parseSlots: (s) => s,
      run: async () => ({ status: 'needs_input', text: 'Which trip?', continuation: { kind: 'sel', candidates: [] } }),
    };
    const sink = capture();
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    await dispatcher.routeTurn({ prompt: 'Make an album for my recent trip', ...sink });
    assert.equal(sink.pending.workflowKind, 'create_recent_trip_album');
    assert.equal(sink.pending.continuation.kind, 'sel');
  });

  it('emits tool-approval-needed and stores approval pending on approval_required', async () => {
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      match: () => ({ slots: {} }),
      parseSlots: (s) => s,
      run: async () => ({
        status: 'approval_required',
        toolCallId: 'tc-1',
        continuation: { candidate: {}, workflow: {} },
      }),
    };
    const sink = capture();
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    await dispatcher.routeTurn({ prompt: 'Create an album for my recent trip to USA', ...sink });
    assert.equal(sink.events.at(-1).type, 'tool-approval-needed');
    assert.equal(sink.events.at(-1).toolCallId, 'tc-1');
    assert.equal(sink.pending.toolCallId, 'tc-1');
  });

  it('reports unhandled for handoff_open and for no match (provider fallthrough)', async () => {
    const handoff = {
      kind: 'k',
      flow: 'hybrid',
      match: () => ({ slots: {} }),
      parseSlots: (s) => s,
      run: async () => ({ status: 'handoff_open', reason: 'subjective' }),
    };
    const sink = capture();
    const d1 = createWorkflowDispatcher({ registry: fakeRegistry(handoff), buildClient: () => ({}) });
    assert.equal((await d1.routeTurn({ prompt: 'do something fuzzy', ...sink })).handled, false);

    const noMatch = { kind: 'k', flow: 'strict', match: () => undefined, parseSlots: (s) => s, run: async () => ({}) };
    const d2 = createWorkflowDispatcher({ registry: fakeRegistry(noMatch), buildClient: () => ({}) });
    assert.equal((await d2.routeTurn({ prompt: 'unrelated', ...capture() })).handled, false);
  });

  it('routes a continuation follow-up by reusing run() with the resolved candidate', async () => {
    const runCalls = [];
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      match: () => undefined,
      parseSlots: (s) => s,
      resumeContinuation: () => ({
        status: 'matched',
        ctx: { slots: { albumName: 'X' }, candidate: { dedupeKey: 'x' } },
      }),
      run: async (ctx) => {
        runCalls.push(ctx);
        return { status: 'planned', text: 'ok', planId: 'p', successSummary: {} };
      },
    };
    const sink = capture();
    sink.setPending({ workflowKind: 'create_recent_trip_album', kind: 'selection', continuation: { candidates: [] } });
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    const result = await dispatcher.routeTurn({ prompt: 'the first one', ...sink });
    assert.equal(result.handled, true);
    assert.equal(runCalls[0].candidate.dedupeKey, 'x'); // run() reused with ctx.candidate, not a separate method
    assert.equal(sink.events.at(-1).type, 'assistant-message-completed');
    assert.equal(sink.pending, undefined);
  });

  it('emits text and clears pending when a continuation expires', async () => {
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      match: () => undefined,
      parseSlots: (s) => s,
      resumeContinuation: () => ({ status: 'expired', text: 'Those choices expired. Please rerun.' }),
      run: async () => ({ status: 'planned' }),
    };
    const sink = capture();
    sink.setPending({ workflowKind: 'create_recent_trip_album', kind: 'selection', continuation: {} });
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    await dispatcher.routeTurn({ prompt: 'first', ...sink });
    assert.match(sink.events.at(-1).content.blocks[0].text, /expired/i);
    assert.equal(sink.pending, undefined);
  });

  it('clears pending and emits text on a failed outcome', async () => {
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      match: () => ({ slots: {} }),
      parseSlots: (s) => s,
      run: async () => ({ status: 'failed', text: 'I could not create a reviewable album plan.' }),
    };
    const sink = capture();
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    const result = await dispatcher.routeTurn({ prompt: 'Create an album for my recent trip to USA', ...sink });
    assert.equal(result.handled, true);
    assert.equal(sink.pending, undefined);
    assert.match(sink.events.at(-1).content.blocks[0].text, /could not create/i);
  });

  it('reports unhandled when parseSlots rejects the classified slots', async () => {
    const workflow = {
      kind: 'k',
      flow: 'strict',
      match: () => ({ slots: {} }),
      parseSlots: () => null,
      run: async () => ({}),
    };
    const sink = capture();
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    assert.equal((await dispatcher.routeTurn({ prompt: 'something', ...sink })).handled, false);
  });

  it('resumes an approval by calling resumeApproval and clears pending', async () => {
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      resumeApproval: async ({ approvedPlanResult }) => ({
        status: 'planned',
        text: 'Review the plan.',
        planId: approvedPlanResult.planId,
        successSummary: {},
      }),
    };
    const sink = capture();
    sink.setPending({
      workflowKind: 'create_recent_trip_album',
      kind: 'approval',
      toolCallId: 'tc-1',
      slots: {},
      candidate: {},
    });
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    const result = await dispatcher.routeApproval({
      toolCallId: 'tc-1',
      approvalDecision: 'approved',
      toolResult: { planId: 'p-9' },
      ...sink,
    });
    assert.equal(result.handled, true);
    assert.equal(sink.events.at(-1).type, 'assistant-message-completed');
    assert.equal(sink.pending, undefined);
  });

  it('emits generic denial copy without calling the workflow on a denied approval', async () => {
    let resumed = false;
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      resumeApproval: async () => {
        resumed = true;
        return { status: 'planned' };
      },
    };
    const sink = capture();
    sink.setPending({
      workflowKind: 'create_recent_trip_album',
      kind: 'approval',
      toolCallId: 'tc-1',
      slots: {},
      candidate: {},
    });
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    await dispatcher.routeApproval({ toolCallId: 'tc-1', approvalDecision: 'denied', ...sink });
    assert.equal(resumed, false);
    assert.match(sink.events.at(-1).content.blocks[0].text, /denied/i);
    assert.equal(sink.pending, undefined);
  });
});
```

- [ ] **Step 2: Run and verify red**

```bash
pnpm --dir agent-runner test
```

Expected: FAIL — `dispatcher.mjs` missing.

- [ ] **Step 3: Implement the registry and dispatcher**

`registry.mjs` builds a `Map` of `kind → workflow` from the workflow modules (`create-recent-trip-album.mjs`) and exposes `getWorkflow`/`listWorkflows`. A `classify(prompt)` helper tries each `workflow.match` (regex fast-path) and returns `{ kind, slots }` or `{ kind: 'none' }`. (Slice 4 swaps in the LLM classifier behind the same `classify` signature.)

`createWorkflowDispatcher({ registry, buildClient, now = Date.now })` exposes
`routeTurn({ prompt, emit, appendTranscript, getPending, setPending, signal, gallerySessionId, runnerSessionId })`:

```text
routeTurn:
  nowMs = now()
  pending = getPending()
  if pending and pending.kind != 'approval':   # continuation follow-up (approval handled in routeApproval)
    wf = registry.getWorkflow(pending.workflowKind)
    resolved = wf.resumeContinuation({ pending: pending.continuation, prompt, nowMs })
    if resolved.status == 'matched':
      # spec: continuation-resolved path reuses run() with ctx.candidate set
      outcome = await wf.run({ client: buildClient(), ...resolved.ctx, signal, nowMs })
    else:  # needs_input | expired | missing
      setPending(resolved.status == 'needs_input' ? pending : undefined)
      observe(strict_continuation, { resumed: false, expired: resolved.status=='expired', missing: resolved.status=='missing' })
      emit(completed(resolved.text)); return { handled: true }
  else:
    decision = registry.classify(prompt)
    if decision.kind == 'none': return { handled: false }
    wf = registry.getWorkflow(decision.kind)
    slots = wf.parseSlots(decision.slots, prompt)
    if slots == null: return { handled: false }   # falls through to open orchestration
    outcome = await wf.run({ client: buildClient(), slots, signal, nowMs })

  return handleOutcome({ outcome, wf, emit, appendTranscript, setPending, prompt })

handleOutcome:
  planned:           appendTranscript(prompt, text); setPending(undefined); emit(completed(text)); { handled: true }
  needs_input:       if outcome.continuation: setPending({ workflowKind: wf.kind, kind: 'selection', continuation: outcome.continuation })
                     else: setPending(undefined)
                     appendTranscript(prompt, text); emit(completed(text)); { handled: true }
  approval_required: setPending({ workflowKind: wf.kind, kind: 'approval', toolCallId: outcome.toolCallId, ...outcome.continuation }); emit(approval(outcome.toolCallId)); { handled: true }
  failed:            setPending(undefined); appendTranscript(prompt, text); emit(completed(text)); { handled: true }
  handoff_open:      setPending(undefined); { handled: false }
```

`routeApproval({ toolCallId, approvalDecision, toolResult, emit, appendTranscript, getPending, setPending, signal })`
(used by `resumeSession`):

```text
routeApproval:
  pending = getPending()
  if not pending or pending.kind != 'approval' or pending.toolCallId != toolCallId:
    return { handled: false }                     # fall through to provider continue path
  setPending(undefined)
  if approvalDecision != 'approved':
    emit(completed(genericApprovalDeniedText)); return { handled: true }   # generic, workflow-agnostic
  wf = registry.getWorkflow(pending.workflowKind)
  outcome = await wf.resumeApproval({ client: buildClient(), pending, approvedPlanResult: toolResult, signal })
  return handleOutcome({ outcome, wf, emit, appendTranscript, setPending, prompt: '' })
```

Notes:

- The denial branch is generic (`genericApprovalDeniedText` = "The approval was
  denied, so no plan was created. Rerun the request to try again."), so no
  workflow re-implements denial copy. `resumeApproval` is invoked only on
  approval, matching the spec.
- `pending` for an approval carries `{ slots, candidate }` (attached by the
  workflow's `normalizeOutcome`), so `resumeApproval` has everything it needs.
- `observe` defaults to a no-op here; Slice 6 supplies the real implementation.
  Event builders reuse the existing `strictCompletedEvent`/`strictApprovalEvent`
  shapes (move them into the dispatcher or pass them in).

- [ ] **Step 4: Run and verify green**

```bash
pnpm --dir agent-runner test
```

Expected: PASS for the dispatcher suite.

## Task 2: Wire the Dispatcher Into pi-runtime + e2e-runtime

**Files:**

- Modify: `agent-runner/src/pi-runtime.mjs`
- Modify: `agent-runner/src/e2e-runtime.mjs`
- Modify: `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Rename the state field and inject the dispatcher**

Rename `pendingStrictWorkflow` → `pendingWorkflow` in the session entry. Construct one dispatcher per runtime with `buildClient: () => createGalleryMcpClient({ gateway: entry.mcpGateway, fetch: fetchImplementation })` (bound per turn to the active entry).

- [ ] **Step 2: Replace the inlined strict branches in `sendMessage`**

The strict fast-path block becomes:

```js
const dispatch = await dispatcher.routeTurn({
  prompt: promptText,
  signal: controller.signal,
  gallerySessionId,
  runnerSessionId,
  emit: (event) => queue.push(event),
  appendTranscript: (p, a) => appendStrictWorkflowTranscript(entry.session, p, a, { model: entry.model }),
  getPending: () => entry.pendingWorkflow,
  setPending: (next) => {
    entry.pendingWorkflow = next;
  },
});
if (dispatch.handled) {
  yield * drainQueue(queue);
  return;
}
// else: fall through to existing provider subscription + prompt
```

- [ ] **Step 3: Replace the resume branch in `resumeSession`**

Route approvals through `dispatcher.routeApproval(...)` instead of the inlined `create_recent_trip_album_approval` check; on `handled === false`, keep the existing provider continue path.

- [ ] **Step 4: Mirror the wiring in `e2e-runtime.mjs`**

Use the same dispatcher with the e2e event builders. Delete the duplicated inline strict branches.

- [ ] **Step 5: Run the full agent-runner suite and verify green**

```bash
pnpm --dir agent-runner test
```

Expected: PASS. Existing strict routing, unsupported fallthrough, candidate-selection follow-up, approval pause/resume, and abort/redaction tests pass unchanged except for the `pendingWorkflow` field rename.

- [ ] **Step 6: Drift check + commit**

```bash
git diff -- agent-runner/src/pi-runtime.mjs agent-runner/src/e2e-runtime.mjs
```

Expected:

- No `create_recent_trip_album`-specific `kind` string branches remain in the runtimes.
- No LLM classifier call (Slice 4).
- No server persistence of `pendingWorkflow` (Slice 5).
- Unsupported/`handoff_open` turns still reach `entry.session.prompt(...)`.

```bash
git add agent-runner/src/strict-workflows agent-runner/src/pi-runtime.mjs agent-runner/src/e2e-runtime.mjs agent-runner/src/pi-runtime.test.mjs docs/superpowers/plans/2026-05-29-pi-agent-strict-hybrid-foundation-slice-3-generic-dispatcher.md
git commit -m "feat: route strict/hybrid workflows through a generic dispatcher"
```

## Plan Self-Review

- Spec coverage: every `WorkflowOutcome` arm, the continuation follow-up, the expired/failed/parseSlots-reject branches, and approve/deny approval resume each map to a dispatcher test; runtime parity covered by the existing suites.
- Protocol fidelity: the continuation-resolved path reuses `run({ ...ctx, candidate })` (asserted), matching the spec — no `run_continuation_candidate`; denial copy is generic and `resumeApproval` runs only on approval.
- TDD order: dispatcher tests run red before wiring.
- Determinism: a `now` clock is injected so continuation TTLs are testable; tests force `now` where timing matters.
- Scope: regex `match` only; no LLM classifier, no durable persistence, no copy delegation (`observe` is a no-op until Slice 6).
- Generalization: state field and runtime branches are now workflow-agnostic; adding a workflow means a registry entry, not a runtime edit.
- Placeholder scan: no TODO/TBD placeholders.
