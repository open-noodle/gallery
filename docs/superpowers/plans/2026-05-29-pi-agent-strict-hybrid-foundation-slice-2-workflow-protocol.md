# Pi Agent Strict/Hybrid Foundation Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the generalized `StrictWorkflow` protocol and the typed `WorkflowOutcome` union, then re-express the existing `create_recent_trip_album` logic as the first protocol implementation with identical behavior. This is the regression anchor: no user-visible change, only a structural one.

**Architecture:** Add `agent-runner/src/strict-workflows/protocol.mjs` defining outcome constructors (`planned`, `needsInput`, `approvalRequired`, `failed`, `handoffOpen`) and JSDoc typedefs for `StrictWorkflow` and `WorkflowContext`. Add `agent-runner/src/strict-workflows/workflows/create-recent-trip-album.mjs` that wraps today's matcher + executor (`matchStrictWorkflow`, `runCreateRecentTripAlbumWorkflow`, candidate-selection helpers) behind the protocol shape (`match`, `parseSlots`, `run`, `buildContinuation`, `resumeContinuation`, `resumeApproval`). The existing `strict-workflows.mjs` functions are reused, not rewritten; the workflow module is a thin protocol adapter. No runtime wiring changes yet — `pi-runtime.mjs` still calls the old functions directly until Slice 3.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, `pnpm --dir agent-runner test`.

---

## Spec Scope

Implements Slice 2 (Protocol + outcome union) from `docs/superpowers/specs/2026-05-29-pi-agent-strict-hybrid-foundation-design.md` (Pillar P2).

Covered requirements:

- `WorkflowOutcome` constructors build each arm and are discriminable by `status`.
- A `StrictWorkflow` for `create_recent_trip_album` exposes `match`, `parseSlots`, `run`, `buildContinuation`, `resumeContinuation`, `resumeApproval`.
- `run` produces outcomes identical to today's `runCreateRecentTripAlbumWorkflow` for the same fake MCP client (ported existing assertions).
- `parseSlots` reuses the existing place-hint normalization and album-name extraction.
- A `successSummary` payload is attached to `planned` outcomes (scrubbed: no raw IDs / `sourceRef`).

Not included in this slice:

- Any change to `pi-runtime.mjs` / `e2e-runtime.mjs` routing (Slice 3).
- The generic dispatcher and `pendingWorkflow` state shape (Slice 3).
- Classification (Slice 4), durable state (Slice 5), copy delegation (Slice 6).

## File Structure

- Create `agent-runner/src/strict-workflows/protocol.mjs`
  - Outcome constructors + JSDoc typedefs for `WorkflowOutcome`, `StrictWorkflow`, `WorkflowContext`, `SuccessSummary`.
- Create `agent-runner/src/strict-workflows/protocol.test.mjs`
  - Outcome constructor + discrimination tests.
- Create `agent-runner/src/strict-workflows/workflows/create-recent-trip-album.mjs`
  - Protocol adapter over the existing `strict-workflows.mjs` functions.
- Create `agent-runner/src/strict-workflows/workflows/create-recent-trip-album.test.mjs`
  - Ports the behavior assertions from `strict-workflows.test.mjs` execution suite against the protocol object.
- Modify `agent-runner/src/strict-workflows.mjs`
  - Export the building blocks the adapter needs (already mostly exported); attach `successSummary` to the planned result.

## Task 1: Outcome Union + Protocol Typedefs

**Files:**

- Create: `agent-runner/src/strict-workflows/protocol.mjs`
- Create: `agent-runner/src/strict-workflows/protocol.test.mjs`

- [ ] **Step 1: Write the failing outcome tests**

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planned, needsInput, approvalRequired, failed, handoffOpen } from './protocol.mjs';

describe('workflow outcome union', () => {
  it('builds a planned outcome carrying plan id and success summary', () => {
    const summary = { workflowKind: 'create_recent_trip_album', albumName: 'USA Trip', assetCount: 28 };
    const outcome = planned({ text: 'Review the plan before applying it.', planId: 'plan-1', successSummary: summary });
    assert.equal(outcome.status, 'planned');
    assert.equal(outcome.planId, 'plan-1');
    assert.deepEqual(outcome.successSummary, summary);
  });

  it('builds the remaining arms with discriminable status', () => {
    assert.equal(needsInput({ text: 'Which trip?' }).status, 'needs_input');
    assert.equal(approvalRequired({ toolCallId: 'tc-1', continuation: {} }).status, 'approval_required');
    assert.equal(failed({ text: 'No plan.' }).status, 'failed');
    assert.equal(handoffOpen({ reason: 'subjective source' }).status, 'handoff_open');
  });

  it('carries optional continuation on needs_input', () => {
    const outcome = needsInput({ text: 'pick', continuation: { kind: 'x' } });
    assert.deepEqual(outcome.continuation, { kind: 'x' });
  });
});
```

- [ ] **Step 2: Run and verify red**

```bash
pnpm --dir agent-runner test
```

Expected: FAIL — `protocol.mjs` does not exist.

- [ ] **Step 3: Implement the protocol module**

```js
/**
 * @typedef {Object} SuccessSummary
 * @property {string} workflowKind
 * @property {string} [albumName]
 * @property {string} [label]      // human place/source label, e.g. "New York, USA"
 * @property {string} [dateRange]
 * @property {number} [assetCount]
 * @property {string} [exclusions]
 * @property {string} [target]
 */

/**
 * @typedef {Object} WorkflowContext
 * @property {object} client                 // strict MCP client (signal-aware)
 * @property {Record<string,string>} slots
 * @property {AbortSignal} [signal]
 * @property {*} [candidate]                  // present on a continuation-resolved run; run() skips discovery
 * @property {*} [approvedPlanResult]         // present on approval resume; reused instead of re-planning
 * @property {number} [nowMs]                 // injected clock for building continuation TTLs
 */

export const planned = ({ text, planId, successSummary, extra = {} }) => ({
  status: 'planned',
  text,
  planId,
  successSummary,
  ...extra,
});

export const needsInput = ({ text, continuation }) => ({
  status: 'needs_input',
  text,
  ...(continuation ? { continuation } : {}),
});

export const approvalRequired = ({ toolCallId, continuation }) => ({
  status: 'approval_required',
  toolCallId,
  continuation,
});

export const failed = ({ text }) => ({ status: 'failed', text });

export const handoffOpen = ({ reason }) => ({ status: 'handoff_open', reason });

/**
 * @typedef {Object} StrictWorkflow
 * @property {string} kind
 * @property {'strict'|'hybrid'} flow
 * @property {(prompt: string) => ({ slots: Record<string,string> } | undefined)} match
 * @property {(rawSlots: Record<string,string>, prompt: string) => (Record<string,string> | null)} parseSlots
 * @property {(ctx: WorkflowContext) => Promise<WorkflowOutcome>} run
 * @property {Function} [buildContinuation]
 * @property {Function} [resumeContinuation]
 * @property {Function} [resumeApproval]
 */
```

- [ ] **Step 4: Run and verify green**

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

## Task 2: create_recent_trip_album Protocol Adapter

**Files:**

- Modify: `agent-runner/src/strict-workflows.mjs`
- Create: `agent-runner/src/strict-workflows/workflows/create-recent-trip-album.mjs`
- Create: `agent-runner/src/strict-workflows/workflows/create-recent-trip-album.test.mjs`

- [ ] **Step 1: Attach `successSummary` to the planned result in `strict-workflows.mjs`**

In `plannedResult`, add a scrubbed `successSummary` alongside the existing fields so the adapter and later copy modes can consume structured data instead of re-parsing text:

```js
return workflowResult('planned', `I found a likely ${label} trip ...`, {
  planId,
  planResult,
  candidate,
  selectionHandleId,
  assetCount,
  successSummary: {
    workflowKind: 'create_recent_trip_album',
    albumName: workflow.albumName,
    label, // the trip place label already in scope; copy needs it to reproduce today's string
    dateRange: tripCandidateDateRange(candidate),
    assetCount,
    exclusions: tripDuplicateParts(candidate).join(' and ') || undefined,
  },
});
```

This is additive; existing assertions on `text`/`planId` are unaffected.

- [ ] **Step 2: Write the failing adapter tests**

Port the execution assertions from `strict-workflows.test.mjs` (`describe('create_recent_trip_album workflow execution')`) to drive the protocol object instead of the bare functions. Example:

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecentTripAlbumWorkflow } from './create-recent-trip-album.mjs';

const wf = createRecentTripAlbumWorkflow();

describe('create_recent_trip_album StrictWorkflow', () => {
  it('matches and parses slots like the legacy matcher', () => {
    const matched = wf.match('Create an album for my recent trip to USA');
    assert.deepEqual(matched.slots, { albumName: 'USA Trip', placeHint: 'USA' });
    assert.deepEqual(wf.parseSlots({ albumName: 'USA Trip', placeHint: 'U.S.' }, 'irrelevant'), {
      albumName: 'USA Trip',
      placeHint: 'USA',
    });
  });

  it('rejects empty slots from parseSlots so the router falls through to open orchestration', () => {
    assert.equal(wf.parseSlots({}, 'unrelated chatter'), null);
  });

  it('runs the high-confidence path to a planned outcome with a success summary', async () => {
    const { client, calls } = createWorkflowClient(); // shared fake-client helper (see note)
    const outcome = await wf.run({ client, slots: { albumName: 'USA Trip', placeHint: 'USA' } });
    assert.equal(outcome.status, 'planned');
    assert.equal(calls.map((c) => c.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.equal(outcome.successSummary.assetCount, 28);
    assert.equal(outcome.successSummary.label, 'New York, USA');
  });

  it('runs the continuation-resolved path via run({ candidate }) without re-running discovery', async () => {
    const { client, calls } = createWorkflowClient();
    const candidate = makeTripCandidate({ dedupeKey: 'trip:ca', placeLabels: ['California, USA'] });
    const outcome = await wf.run({ client, slots: { albumName: 'West Coast' }, candidate });
    assert.equal(outcome.status, 'planned');
    assert.equal(calls.map((c) => c.name).join(','), 'proposeAlbumFromSelection'); // no findTripCandidates
    assert.equal(calls[0].args.albumName, 'West Coast');
  });

  it('attaches a built continuation on ask_user so the dispatcher can persist it', async () => {
    const { client } = createWorkflowClient({
      recommendation: { action: 'ask_user' },
      candidates: [makeTripCandidate({ dedupeKey: 'a' }), makeTripCandidate({ dedupeKey: 'b' })],
    });
    const outcome = await wf.run({ client, slots: { albumName: 'Recent Trip' }, nowMs: 1000 });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(outcome.continuation.kind, 'create_recent_trip_album_candidate_selection');
    assert.equal(outcome.continuation.candidates.length, 2);
  });

  it('reuses the approved plan result on resumeApproval without re-calling the plan tool', async () => {
    const { client, calls } = createWorkflowClient();
    const candidate = makeTripCandidate();
    const outcome = await wf.resumeApproval({
      client,
      pending: { slots: { albumName: 'USA Trip', placeHint: 'USA' }, candidate },
      approvedPlanResult: { status: 'success', planId: '00000000-0000-4000-8000-000000000923' },
    });
    assert.equal(outcome.status, 'planned');
    assert.equal(calls.length, 0); // approvedPlanResult short-circuits the plan call
  });
});
```

Also port the remaining legacy execution assertions through the protocol object:
`needs_input` on `none`/empty candidates, recommendation key-mismatch, missing
selection handle, zero-asset handle, planning denied/error redaction, missing
plan id (no success copy), and abort-signal forwarding.

Test-helper note: extract the existing `createWorkflowClient` factory and
`makeTripCandidate` builder from `strict-workflows.test.mjs` into a shared
`agent-runner/src/strict-workflows/test-helpers.mjs` and import them from both
test files, so the fake MCP client is defined once rather than duplicated.

- [ ] **Step 3: Run and verify red**

```bash
pnpm --dir agent-runner test
```

Expected: FAIL — adapter module missing.

- [ ] **Step 4: Implement the adapter**

```js
import {
  matchStrictWorkflow,
  runCreateRecentTripAlbumWorkflow,
  runCreateRecentTripAlbumCandidateWorkflow,
  createRecentTripCandidateSelectionState,
  resolveRecentTripCandidateSelection,
} from '../../strict-workflows.mjs';
import { normalizePlaceHintSlot, normalizeAlbumNameSlot } from '../../strict-workflows.mjs'; // exported helpers

export const createRecentTripAlbumWorkflow = () => ({
  kind: 'create_recent_trip_album',
  flow: 'strict',

  match(prompt) {
    const matched = matchStrictWorkflow(prompt);
    if (matched.kind !== 'create_recent_trip_album') return undefined;
    const slots = { albumName: matched.albumName };
    if (matched.placeHint) slots.placeHint = matched.placeHint;
    return { slots };
  },

  parseSlots(rawSlots) {
    const albumName = normalizeAlbumNameSlot(rawSlots.albumName);
    const placeHint = normalizePlaceHintSlot(rawSlots.placeHint);
    if (!albumName && !placeHint) return null;
    const slots = { albumName: albumName ?? (placeHint ? `${placeHint} Trip` : 'Recent Trip') };
    if (placeHint) slots.placeHint = placeHint;
    return slots;
  },

  // Single run entry. Per the spec, the continuation-resolved path reuses run()
  // with ctx.candidate set — there is no separate run_continuation_candidate.
  async run({ client, slots, candidate, approvedPlanResult, signal, nowMs }) {
    const workflow = { kind: this.kind, ...slots };
    const result = candidate
      ? await runCreateRecentTripAlbumCandidateWorkflow({ client, workflow, candidate, approvedPlanResult, signal })
      : await runCreateRecentTripAlbumWorkflow({ client, workflow, signal });
    return this.normalizeOutcome(result, { slots, workflow, nowMs });
  },

  // Attach a dispatcher-storable `continuation` to the outcomes that need one,
  // so the dispatcher can stay workflow-agnostic (`pendingWorkflow = outcome.continuation`).
  normalizeOutcome(result, { slots, workflow, nowMs }) {
    if (result.status === 'needs_input' && Array.isArray(result.candidates) && result.candidates.length > 0) {
      return { ...result, continuation: this.buildContinuation({ slots, candidates: result.candidates, nowMs }) };
    }
    if (result.status === 'approval_required') {
      return { ...result, continuation: { slots, candidate: result.candidate } };
    }
    return result; // planned | failed | needs_input-without-candidates pass through unchanged
  },

  buildContinuation({ slots, candidates, nowMs }) {
    return createRecentTripCandidateSelectionState({ workflow: { kind: this.kind, ...slots }, candidates, nowMs });
  },

  resumeContinuation({ pending, prompt, nowMs }) {
    const resolved = resolveRecentTripCandidateSelection({ pending, prompt, nowMs });
    if (resolved.status !== 'matched') {
      return resolved; // { status: 'needs_input' | 'expired' | 'missing', text }
    }
    const slots = { albumName: resolved.workflow.albumName };
    if (resolved.workflow.placeHint) slots.placeHint = resolved.workflow.placeHint;
    return { status: 'matched', ctx: { slots, candidate: resolved.candidate } };
  },

  // Approve-only: the dispatcher handles the denial branch generically and only
  // invokes resumeApproval on approval. pending carries { slots, candidate }.
  resumeApproval({ client, pending, approvedPlanResult, signal }) {
    return this.run({ client, slots: pending.slots, candidate: pending.candidate, approvedPlanResult, signal });
  },
});
```

If `normalizePlaceHintSlot`/`normalizeAlbumNameSlot` are not yet exported from `strict-workflows.mjs`, export thin wrappers over the existing `normalizePlaceHint`/`cleanAlbumName` so slot normalization is shared, not duplicated.

- [ ] **Step 5: Run and verify green**

```bash
pnpm --dir agent-runner test
```

Expected: PASS. The legacy `strict-workflows.test.mjs` suite still passes unchanged; the adapter suite proves behavior parity through the protocol.

- [ ] **Step 6: Drift check + commit**

```bash
git diff -- agent-runner/src/strict-workflows
```

Expected: no runtime routing edits; `pi-runtime.mjs`/`e2e-runtime.mjs` untouched.

```bash
git add agent-runner/src/strict-workflows
git commit -m "feat: add StrictWorkflow protocol and recent-trip adapter"
```

## Plan Self-Review

- Spec coverage: outcome union + protocol shape + behavior-parity adapter all tested.
- Protocol fidelity: the continuation-resolved path reuses `run({ candidate })` (no `run_continuation_candidate`), matching the spec; `resumeApproval` is approve-only with denial owned by the dispatcher.
- Edge coverage: `parseSlots` reject, candidate-path skip-discovery, `ask_user` continuation attachment, and `resumeApproval` plan-result reuse each have a test, plus ported legacy cases (key-mismatch, zero-asset, redaction, missing plan id).
- TDD order: protocol and adapter tests run red before implementation.
- Scope: pure modules; no runtime routing changes; legacy functions reused, not rewritten; fake client extracted to a shared test helper.
- Regression anchor: legacy execution suite stays green; adapter suite mirrors it through the protocol.
- Placeholder scan: no TODO/TBD placeholders.
