# Pi Agent Strict Recent Trip Album Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic `create_recent_trip_album` workflow execution from a strict workflow match through `findTripCandidates` and `proposeAlbumFromSelection`.

**Architecture:** Extend `agent-runner/src/strict-workflows.mjs` with a side-effect-bounded executor that accepts an MCP-like `{ call(name, args) }` client and a `create_recent_trip_album` match. The executor owns trip candidate selection, exact handle use, plan proposal arguments, duplicate/stack copy, and no-plan fallback results. The e2e runtime should use this shared executor for generic recent-trip album requests while leaving highlights and production Pi runtime routing to later slices.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, existing e2e runner MCP client shape.

---

## Spec Scope

Implements Slice 3 from `docs/superpowers/specs/2026-05-28-pi-agent-strict-recent-trip-album-design.md`.

Covered requirements:

- `use_top_candidate` calls `findTripCandidates` then `proposeAlbumFromSelection`.
- `selectionHandleId` equals the candidate handle id.
- Candidate selection uses `recommendation.candidateDedupeKey` exactly.
- If the recommended dedupe key is missing from `candidates`, no planning call occurs.
- No call to `searchAssets` occurs.
- No provider-visible `assetIds` are sent.
- Album name defaults to `USA Trip` or `Recent Trip`.
- Explicit album name is preserved.
- Description mentions duplicate/stack exclusion only when counts are present.

Not included in this slice:

- Production `pi-runtime` provider bypass.
- Persisted session state for `ask_user` continuation.
- Approval resume.
- Strict success gating on persisted plan id beyond returning the plan id if present; Slice 4 owns failure-path copy hardening.
- Highlight trip workflows.

## File Structure

- Modify `agent-runner/src/strict-workflows.mjs`
  - Add `runCreateRecentTripAlbumWorkflow({ client, workflow })`.
  - Add local formatting helpers for trip label, date range, duplicate/stack copy, and plan id extraction.
- Modify `agent-runner/src/strict-workflows.test.mjs`
  - Add fake MCP client unit tests for Slice 3 deterministic execution.
- Modify `agent-runner/src/e2e-runtime.mjs`
  - Import `matchStrictWorkflow` and `runCreateRecentTripAlbumWorkflow`.
  - Route only generic strict `create_recent_trip_album` matches through the shared executor before the old highlight trip path.

## Task 1: Deterministic Recent Trip Album Workflow Execution

**Files:**

- Modify: `agent-runner/src/strict-workflows.mjs`
- Modify: `agent-runner/src/strict-workflows.test.mjs`
- Modify: `agent-runner/src/e2e-runtime.mjs`

- [x] **Step 1: Add failing workflow execution tests**

Append these tests to `agent-runner/src/strict-workflows.test.mjs` after the existing router tests:

```js
const tripCandidateHandleId = '00000000-0000-4000-8000-000000000921';
const tripPlanId = '00000000-0000-4000-8000-000000000923';

const makeTripCandidate = (overrides = {}) => ({
  dedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
  title: 'Recent trip to New York, USA',
  takenAfter: '2026-05-03T00:00:00.000Z',
  takenBefore: '2026-05-12T23:59:59.000Z',
  albumAssetCount: 28,
  excludedDuplicateCount: 3,
  excludedStackChildCount: 1,
  placeLabels: ['New York, USA'],
  selectionHandle: {
    id: tripCandidateHandleId,
    sourceRef: `asset-source:search:${tripCandidateHandleId}`,
    assetCount: 28,
  },
  ...overrides,
});

const createWorkflowClient = ({ candidates = [makeTripCandidate()], recommendation, planResult } = {}) => {
  const calls = [];
  const resolvedRecommendation = recommendation ?? {
    action: 'use_top_candidate',
    candidateDedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
    reason: 'The only readable trip candidate is high confidence.',
  };

  const client = {
    async call(name, args) {
      calls.push({ name, args });
      if (name === 'findTripCandidates') {
        return {
          status: 'success',
          recommendation: resolvedRecommendation,
          candidates,
        };
      }

      if (name === 'proposeAlbumFromSelection') {
        return (
          planResult ?? {
            status: 'success',
            plan: { id: tripPlanId },
          }
        );
      }

      throw new Error(`unexpected tool ${name}`);
    },
  };

  return { client, calls };
};

describe('create_recent_trip_album workflow execution', () => {
  it('plans from the recommended candidate handle without search or raw asset ids', async () => {
    const { client, calls } = createWorkflowClient();

    const result = await runCreateRecentTripAlbumWorkflow({
      client,
      workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
    });

    assert.equal(result.status, 'planned');
    assert.equal(result.planId, tripPlanId);
    assert.equal(calls.map((call) => call.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.deepEqual(calls[0].args, { placeHint: 'USA' });
    assert.equal(calls[1].args.albumName, 'USA Trip');
    assert.equal(calls[1].args.selectionHandleId, tripCandidateHandleId);
    assert.equal(JSON.stringify(calls).includes('assetIds'), false);
    assert.match(calls[1].args.summary, /28 trip assets from New York, USA/);
    assert.match(calls[1].args.description, /3 known duplicate variants and 1 stack child/i);
    assert.match(result.text, /May 3-12, 2026/);
    assert.match(result.text, /skipped 3 known duplicate variants and 1 stack child/i);
  });

  it('uses no place hint and the default Recent Trip name when the prompt has no place', async () => {
    const { client, calls } = createWorkflowClient({
      candidates: [
        makeTripCandidate({
          dedupeKey: 'trip:recent:2026-05-03:2026-05-12',
          placeLabels: ['Lisbon, Portugal'],
        }),
      ],
      recommendation: {
        action: 'use_top_candidate',
        candidateDedupeKey: 'trip:recent:2026-05-03:2026-05-12',
      },
    });

    const result = await runCreateRecentTripAlbumWorkflow({
      client,
      workflow: matchStrictWorkflow('Make an album for my recent trip'),
    });

    assert.equal(result.status, 'planned');
    assert.deepEqual(calls[0].args, {});
    assert.equal(calls[1].args.albumName, 'Recent Trip');
  });

  it('preserves explicit album names when proposing the plan', async () => {
    const { client, calls } = createWorkflowClient();

    await runCreateRecentTripAlbumWorkflow({
      client,
      workflow: matchStrictWorkflow('Create an album for my recent trip to USA called Spring Break'),
    });

    assert.equal(calls[1].args.albumName, 'Spring Break');
  });

  it('omits duplicate and stack copy when no exclusions are present', async () => {
    const { client, calls } = createWorkflowClient({
      candidates: [makeTripCandidate({ excludedDuplicateCount: 0, excludedStackChildCount: 0 })],
    });

    const result = await runCreateRecentTripAlbumWorkflow({
      client,
      workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
    });

    assert.doesNotMatch(calls[1].args.description, /duplicate|stack/i);
    assert.doesNotMatch(result.text, /skipped|duplicate|stack/i);
  });

  it('does not plan when the recommended candidate key is missing', async () => {
    const { client, calls } = createWorkflowClient({
      recommendation: { action: 'use_top_candidate', candidateDedupeKey: 'trip:missing' },
    });

    const result = await runCreateRecentTripAlbumWorkflow({
      client,
      workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
    });

    assert.equal(result.status, 'needs_input');
    assert.equal(calls.map((call) => call.name).join(','), 'findTripCandidates');
    assert.match(result.text, /could not match/i);
  });
});
```

Also update the import at the top of `agent-runner/src/strict-workflows.test.mjs`:

```js
import { matchStrictWorkflow, runCreateRecentTripAlbumWorkflow } from './strict-workflows.mjs';
```

- [x] **Step 2: Run tests and verify red**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL because `runCreateRecentTripAlbumWorkflow` is not exported. The failure should be a module import error or a missing export error.

- [x] **Step 3: Implement deterministic workflow execution**

In `agent-runner/src/strict-workflows.mjs`, add these helpers below `matchStrictWorkflow`:

```js
const assertCreateRecentTripWorkflow = (workflow) => {
  if (workflow?.kind !== 'create_recent_trip_album') {
    throw new Error('runCreateRecentTripAlbumWorkflow requires a create_recent_trip_album workflow');
  }
};

const tripCandidateDateRange = (candidate) => {
  const after = new Date(candidate.takenAfter);
  const before = new Date(candidate.takenBefore);
  const month = after.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return `${month} ${after.getUTCDate()}-${before.getUTCDate()}, ${before.getUTCFullYear()}`;
};

const tripCandidateLabel = (candidate) =>
  Array.isArray(candidate.placeLabels) && candidate.placeLabels.length > 0
    ? candidate.placeLabels.join(' and ')
    : candidate.title?.replace(/^Recent trip to\s+/i, '') || candidate.subtitle || 'that trip';

const tripDuplicateParts = (candidate) => {
  const duplicateCount = candidate.excludedDuplicateCount ?? 0;
  const stackCount = candidate.excludedStackChildCount ?? 0;
  const parts = [];
  if (duplicateCount > 0) {
    parts.push(`${duplicateCount} known duplicate variant${duplicateCount === 1 ? '' : 's'}`);
  }
  if (stackCount > 0) {
    parts.push(`${stackCount} stack child${stackCount === 1 ? '' : 'ren'}`);
  }
  return parts;
};

const duplicateExclusionText = (candidate) => {
  const parts = tripDuplicateParts(candidate);
  return parts.length > 0 ? ` I skipped ${parts.join(' and ')}.` : '';
};

const duplicateDescriptionText = (candidate) => {
  const parts = tripDuplicateParts(candidate);
  return parts.length > 0 ? ` ${parts.join(' and ')} were excluded when detected.` : '';
};

const extractPlanId = (toolResult) =>
  typeof toolResult?.planId === 'string'
    ? toolResult.planId
    : typeof toolResult?.plan?.id === 'string'
      ? toolResult.plan.id
      : undefined;

const workflowResult = (status, text, extra = {}) => ({ status, text, ...extra });
```

Then add the exported executor:

```js
export const runCreateRecentTripAlbumWorkflow = async ({ client, workflow }) => {
  assertCreateRecentTripWorkflow(workflow);

  const tripResult = await client.call(
    'findTripCandidates',
    workflow.placeHint ? { placeHint: workflow.placeHint } : {},
  );
  const candidates = Array.isArray(tripResult.candidates) ? tripResult.candidates : [];
  const recommendation = tripResult.recommendation;

  if (recommendation?.action === 'none' || candidates.length === 0) {
    return workflowResult(
      'needs_input',
      'I could not find a likely recent trip from the available date and location metadata. Which date range or place should I use for the album?',
    );
  }

  if (recommendation?.action === 'ask_user') {
    const labels = candidates.map(tripCandidateLabel).slice(0, 5).join('; ');
    return workflowResult(
      'needs_input',
      candidates.length === 1
        ? `I found one possible recent trip: ${labels}. Should I use it, or would you prefer to give me a date range or place?`
        : `I found multiple possible recent trips: ${labels}. Which one should I use?`,
      { candidates },
    );
  }

  const candidateDedupeKey = recommendation?.candidateDedupeKey;
  const candidate =
    typeof candidateDedupeKey === 'string'
      ? candidates.find((item) => item?.dedupeKey === candidateDedupeKey)
      : undefined;

  if (!candidate) {
    return workflowResult(
      'needs_input',
      'Gallery found trip candidates, but the recommended trip could not match an available candidate. Which date range or place should I use for the album?',
    );
  }

  const selectionHandleId = candidate.selectionHandle?.id;
  if (!selectionHandleId) {
    return workflowResult(
      'needs_input',
      'I found a trip candidate but could not get an album-ready selection handle. Please try again or give me a date range.',
    );
  }

  const assetCount = candidate.selectionHandle.assetCount ?? candidate.albumAssetCount ?? 0;
  const label = tripCandidateLabel(candidate);
  const planResult = await client.call('proposeAlbumFromSelection', {
    summary: `Create ${workflow.albumName} with ${assetCount} trip assets from ${label}.`,
    albumName: workflow.albumName,
    description: `Album-ready trip selection from ${label}.${duplicateDescriptionText(candidate)}`,
    selectionHandleId,
  });

  return workflowResult(
    'planned',
    `I found a likely ${label} trip from ${tripCandidateDateRange(candidate)} and proposed ${workflow.albumName} with ${assetCount} assets.${duplicateExclusionText(candidate)} Review the plan before applying it.`,
    {
      planId: extractPlanId(planResult),
      planResult,
      candidate,
      selectionHandleId,
      assetCount,
    },
  );
};
```

- [x] **Step 4: Route e2e generic recent-trip requests through the shared executor**

At the top of `agent-runner/src/e2e-runtime.mjs`, add:

```js
import { matchStrictWorkflow, runCreateRecentTripAlbumWorkflow } from './strict-workflows.mjs';
```

Inside `sendMessage`, after `const metadataPrompt = parseMetadataPrompt(prompt);` and before metadata prompt handling, add:

```js
      const strictWorkflow = matchStrictWorkflow(prompt);
      if (strictWorkflow.kind === 'create_recent_trip_album') {
        const workflowResult = await runCreateRecentTripAlbumWorkflow({ client, workflow: strictWorkflow });
        yield completedEvent({
          gallerySessionId,
          runnerSessionId,
          text: workflowResult.text,
        });
        return;
      }
```

Do not remove the old `parseRecentTripPrompt` path in this slice, because explicit highlight trip requests still use it.

- [x] **Step 5: Run tests and verify green**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS with the new strict workflow execution tests and existing e2e recent-trip tests. The generic e2e recent-trip tests should still show the same `findTripCandidates,proposeAlbumFromSelection` sequence.

- [x] **Step 6: Check for future-slice drift**

Run:

```bash
git diff -- agent-runner/src/strict-workflows.mjs agent-runner/src/strict-workflows.test.mjs agent-runner/src/e2e-runtime.mjs
```

Expected:

- No production `pi-runtime` routing changes.
- No session-state persistence.
- No approval-resume logic.
- No direct apply/write tool.
- Highlight trip requests still use the existing e2e path.

- [x] **Step 7: Commit Slice 3**

Run:

```bash
git add agent-runner/src/strict-workflows.mjs agent-runner/src/strict-workflows.test.mjs agent-runner/src/e2e-runtime.mjs docs/superpowers/plans/2026-05-28-pi-agent-strict-recent-trip-album-slice-3.md
git commit -m "feat: execute strict recent trip album workflow"
```

Expected: commit succeeds.

## Plan Self-Review

- Spec coverage: every Slice 3 requirement is represented by a test or explicit drift check.
- TDD order: failing tests are written before implementation.
- Scope: production routing, success-gating hardening, approval resume, and continuation state remain outside this slice.
- Type consistency: executor consumes the `matchStrictWorkflow` result shape from Slice 2 and an MCP-like `client.call(name, args)`.
- Placeholder scan: no TODO/TBD placeholders.
