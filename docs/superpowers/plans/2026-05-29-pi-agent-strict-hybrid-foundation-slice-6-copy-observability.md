# Pi Agent Strict/Hybrid Foundation Slice 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two things, both safe by construction. (1) Optionally let the LLM phrase user-facing success copy from a scrubbed structured summary — without ever letting it decide success/failure. (2) Make router and gate behavior observable so we can measure recall and catch regressions of the original "claimed a plan that does not exist" bug.

**Architecture:** Add `agent-runner/src/strict-workflows/copy.mjs` exporting `renderCopy({ outcome, mode, polish })`. For `planned` outcomes, `mode: 'template'` (default) returns today's deterministic string built from `successSummary`; `mode: 'llm-polish'` calls an injected, tool-free `polish(successSummary)` and falls back to the template on error. The success/failure decision and the "a plan exists" claim are chosen by deterministic code from `status === 'planned' && planId` before copy is rendered — copy only rewords. `needs_input`/`failed`/`approval_required` always use templates. Observability: the dispatcher emits structured log lines and `agent_session_activity_event` rows for `strict_router_decision`, `strict_workflow_outcome`, `strict_success_gate_block`, and `strict_continuation`. The success-gate block is emitted whenever code is about to claim success but `planId` is missing (expected count ≈ 0).

**Tech Stack:** Node.js ESM (`pnpm --dir agent-runner test`); server TypeScript + Vitest for the activity-event projection (`pnpm --dir server test`).

---

## Spec Scope

Implements Slice 6 (Copy + observability) from `docs/superpowers/specs/2026-05-29-pi-agent-strict-hybrid-foundation-design.md` (Pillar P5).

Covered requirements:

- `CopyMode=template` reproduces today's strings exactly.
- `CopyMode=llm-polish` rephrases only the scrubbed `successSummary`; success language stays gated on `planId`; LLM failure falls back to the template.
- The polish call is tool-free and never receives raw IDs.
- The dispatcher emits `strict_router_decision`, `strict_workflow_outcome`, `strict_success_gate_block`, and `strict_continuation` with the documented fields.
- These ride the existing `agent_session_activity_event` table; they are not surfaced as user chat.

Not included in this slice:

- A `routerModel` override (reserved).
- New workflows (Slice 7).
- UI changes to display metrics (logs/activity events only).

## File Structure

- Create `agent-runner/src/strict-workflows/copy.mjs`
  - `renderCopy(...)`, `templateCopy(successSummary)`; injected `polish`.
- Create `agent-runner/src/strict-workflows/copy.test.mjs`
  - Template parity, polish path, gate, fallback.
- Modify `agent-runner/src/strict-workflows/dispatcher.mjs`
  - Use `renderCopy` for `planned`; emit observability events at decision/outcome/gate/continuation points.
- Modify `agent-runner/src/pi-runtime.mjs`
  - Inject `copyMode` (default `template`) + a tool-free `polish` built from the session model; wire observability `emit` to structured logs + activity events.
- Modify `server/src/services/agent-session-activity-event.service.ts` (+ spec)
  - Accept the new activity-event kinds for projection.

## Task 1: Copy Rendering (gate-safe)

**Files:**

- Create: `agent-runner/src/strict-workflows/copy.mjs`, `copy.test.mjs`

- [ ] **Step 1: Write the failing copy tests**

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderCopy } from './copy.mjs';

const plannedSummary = {
  workflowKind: 'create_recent_trip_album',
  albumName: 'USA Trip',
  label: 'New York, USA',
  dateRange: 'May 3-12, 2026',
  assetCount: 28,
  exclusions: '3 known duplicate variants and 1 stack child',
};

describe('strict workflow copy', () => {
  it('template mode reproduces the current deterministic success string verbatim', async () => {
    const text = await renderCopy({
      outcome: { status: 'planned', planId: 'p1', successSummary: plannedSummary },
      mode: 'template',
    });
    // Byte-for-byte parity with today's strict-workflows.mjs success copy.
    assert.equal(
      text,
      'I found a likely New York, USA trip from May 3-12, 2026 and proposed USA Trip with 28 assets.' +
        ' I skipped 3 known duplicate variants and 1 stack child. Review the plan before applying it.',
    );
  });

  it('llm-polish rephrases the summary but still gates on planId', async () => {
    const polish = async (summary) => `Done! Your ${summary.albumName} album is ready to review.`;
    const text = await renderCopy({
      outcome: { status: 'planned', planId: 'p1', successSummary: plannedSummary },
      mode: 'llm-polish',
      polish,
    });
    assert.match(text, /USA Trip album is ready to review/);
  });

  it('never claims success without a planId, even in polish mode', async () => {
    const polish = async () => 'I created the album!';
    const text = await renderCopy({
      outcome: { status: 'planned', planId: undefined, successSummary: plannedSummary },
      mode: 'llm-polish',
      polish,
    });
    assert.doesNotMatch(text, /created|ready|proposed/i);
  });

  it('falls back to template when polish throws', async () => {
    const polish = async () => {
      throw new Error('provider down');
    };
    const text = await renderCopy({
      outcome: { status: 'planned', planId: 'p1', successSummary: plannedSummary },
      mode: 'llm-polish',
      polish,
    });
    assert.match(text, /Review the plan before applying it/);
  });

  it('uses templates for non-planned outcomes regardless of mode', async () => {
    const text = await renderCopy({
      outcome: { status: 'failed', text: 'No plan.' },
      mode: 'llm-polish',
      polish: async () => 'x',
    });
    assert.equal(text, 'No plan.');
  });
});
```

- [ ] **Step 2: Run red**

```bash
pnpm --dir agent-runner test
```

Expected: FAIL — `copy.mjs` missing.

- [ ] **Step 3: Implement `renderCopy`**

- If `outcome.status !== 'planned'` → return `outcome.text` (templates already built by the workflow).
- If `status === 'planned'` but no `planId` → return a deterministic non-success message and signal the caller to emit `strict_success_gate_block` (return a flag or throw a typed marker the dispatcher catches). Never call `polish`.
- If `planId` present and `mode === 'template'` → `templateCopy(successSummary)`, which reconstructs today's string verbatim: `` `I found a likely ${label} trip from ${dateRange} and proposed ${albumName} with ${assetCount} assets.${exclusions ? ` I skipped ${exclusions}.` : ''} Review the plan before applying it.` ``. (This is why `successSummary` carries `label` and the bare `exclusions` phrase — see Slice 2.)
- If `planId` present and `mode === 'llm-polish'` → `await polish(scrub(successSummary))`, falling back to `templateCopy` on any error; validate the result is non-empty text.
- `scrub` asserts no `id`/`handle`/`sourceRef` keys leak into `polish` input (the summary already excludes them; enforce defensively).

- [ ] **Step 4: Run green**

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

## Task 2: Observability Events

**Files:**

- Modify: `agent-runner/src/strict-workflows/dispatcher.mjs`, `agent-runner/src/strict-workflows/dispatcher.test.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`
- Modify: `server/src/services/agent-session-activity-event.service.ts` (+ spec)

- [ ] **Step 1: Write failing dispatcher observability tests**

Assert the dispatcher calls an injected `observe(event)` with:

- `strict_router_decision` `{ matched, workflowKind|null, via, confidence, latencyMs }` on every routed turn.
- `strict_workflow_outcome` `{ kind, status, planId|null, toolCalls, fellBackToOpen }`.
- `strict_success_gate_block` exactly when a `planned` outcome lacks a `planId`.
- `strict_continuation` `{ resumed, expired, missing }` on continuation turns.

```js
it('emits a router decision and outcome for a matched planned turn', async () => {
  const observed = [];
  const dispatcher = createWorkflowDispatcher({
    registry: fakeRegistry(plannedWorkflow),
    buildClient: () => ({}),
    observe: (e) => observed.push(e),
  });
  await dispatcher.routeTurn({ prompt: 'Create an album for my recent trip to USA', ...capture() });
  assert.deepEqual(
    observed.map((e) => e.kind),
    ['strict_router_decision', 'strict_workflow_outcome'],
  );
  assert.equal(observed[0].matched, true);
  assert.equal(observed[1].status, 'planned');
});

it('emits a success-gate block when planId is missing', async () => {
  const observed = [];
  const wf = { ...plannedWorkflow, run: async () => ({ status: 'planned', planId: undefined, successSummary: {} }) };
  const dispatcher = createWorkflowDispatcher({
    registry: fakeRegistry(wf),
    buildClient: () => ({}),
    observe: (e) => observed.push(e),
  });
  await dispatcher.routeTurn({ prompt: 'Create an album for my recent trip to USA', ...capture() });
  assert.ok(observed.some((e) => e.kind === 'strict_success_gate_block'));
});
```

- [ ] **Step 2: Implement `observe` calls in the dispatcher**

Emit `strict_router_decision` after `classify`, `strict_continuation` on continuation turns, `strict_workflow_outcome` in `handleOutcome`, and `strict_success_gate_block` from the gate path in Task 1. Compute `latencyMs` from the dispatcher's injected `now` clock (added in Slice 3) so it is deterministic under test. `observe` defaults to a no-op so Slice 3 tests are unaffected.

- [ ] **Step 3: Wire runtime → structured logs + activity events**

In `pi-runtime.mjs`, pass `observe` that (a) writes a structured JSON log line and (b) emits an `agent_session_activity_event`-shaped runner event the server projects. Inject `copyMode` (default `template`, opt-in `llm-polish` via config) and a tool-free `polish` built from the session model handle.

- [ ] **Step 4: Server projection**

Extend `agent-session-activity-event.service.ts` to accept the new kinds and persist them (debug/audit visibility, not user chat). Add a spec asserting they round-trip and are excluded from the user-facing transcript.

- [ ] **Step 5: Run suites and verify green**

```bash
pnpm --dir agent-runner test
pnpm --dir server test -- --run src/services/agent-session-activity-event.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Drift check + commit**

```bash
git diff -- agent-runner/src server/src
```

Expected: copy default is `template`; polish is opt-in and tool-free; no new workflows; observability is logs + activity events only.

```bash
git add agent-runner/src server/src docs/superpowers/plans/2026-05-29-pi-agent-strict-hybrid-foundation-slice-6-copy-observability.md
git commit -m "feat: add gate-safe copy delegation and strict-workflow observability"
```

## Plan Self-Review

- Spec coverage: template parity, polish, gate, fallback, and all four observability events tested.
- TDD order: copy and observability tests run red first.
- Safety: success language is decided before copy rendering; polish is tool-free, scrubbed, and falls back on error; gate-block event makes the original-bug class measurable.
- Scope: no new workflows; default behavior matches today (template copy, no extra LLM call).
- Placeholder scan: no TODO/TBD placeholders.
