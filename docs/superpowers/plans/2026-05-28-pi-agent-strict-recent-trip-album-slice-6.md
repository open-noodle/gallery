# Pi Agent Strict Recent Trip Album Slice 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resume strict recent-trip album workflows from runner session state for candidate-selection follow-ups and planning approval decisions without provider orchestration.

**Architecture:** Add small strict workflow state helpers that store only the workflow slots plus candidate labels/dedupe keys/selection handles needed by deterministic code. Both e2e and production runtimes check pending strict state before open provider orchestration. Production `resumeSession` handles strict `toolCallId` approval resumes directly from stored state and approved tool results, keeping the provider out of supported strict continuations.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, in-memory runner session state, existing Gallery MCP JSON-RPC client paths.

---

## Spec Scope

Implements Slice 6 from `docs/superpowers/specs/2026-05-28-pi-agent-strict-recent-trip-album-design.md`.

Covered requirements:

- `ask_user` stores candidate dedupe keys and handles in runner session state.
- A follow-up selecting a candidate resumes strict plan creation.
- A follow-up with an explicit album name can rename the pending strict plan.
- Expired pending state asks the user to rerun the recent-trip album request rather than guessing.
- `approval-required` stores strict workflow state keyed by `toolCallId`.
- An approved strict planning result resumes through deterministic strict workflow code, validates the approved plan id, and does not call the provider.
- A denied strict planning approval clears pending state and emits deterministic failure copy without calling the provider.

Not included in this slice:

- Durable database persistence across process restarts.
- Generic event-album continuation outside `create_recent_trip_album`.
- Applying operation plans.

## File Structure

- Modify `docs/superpowers/specs/2026-05-28-pi-agent-strict-recent-trip-album-design.md`
  - Keep Slice 6 bullets explicit about strict approval resume state.
- Modify `agent-runner/src/strict-workflows.mjs`
  - Export pending-state helpers for candidate selection.
  - Export a candidate-based strict executor that can propose from a stored candidate without rerunning `findTripCandidates`.
  - Include candidate context in `approval_required` workflow results.
- Modify `agent-runner/src/strict-workflows.test.mjs`
  - Unit-test pending candidate resolution, album rename, expiration, signal forwarding, and candidate-based execution.
- Modify `agent-runner/src/e2e-runtime.mjs`
  - Store pending candidate-selection state after strict `ask_user`.
  - Resolve follow-up selections before the legacy trip/highlight path.
- Modify `agent-runner/src/e2e-runtime.test.mjs`
  - Cover candidate follow-up selection, rename, and expired pending state.
- Modify `agent-runner/src/pi-runtime.mjs`
  - Store pending candidate-selection state after strict `ask_user`.
  - Store pending approval state after strict `approval_required`.
  - Resolve candidate follow-ups before provider prompting.
  - Resolve strict approval resumes before provider prompting/continuing.
- Modify `agent-runner/src/pi-runtime.test.mjs`
  - Cover production candidate follow-up, rename, expired pending state, approved strict resume, denied strict resume, and no provider calls for strict continuations.

## Task 1: Strict Workflow State Helpers And Candidate Executor

**Files:**

- Modify: `agent-runner/src/strict-workflows.mjs`
- Modify: `agent-runner/src/strict-workflows.test.mjs`

- [ ] **Step 1: Add failing unit tests**

Append these tests inside `describe('create_recent_trip_album workflow execution', ...)` in `agent-runner/src/strict-workflows.test.mjs`.

```js
it('builds pending candidate-selection state with labels and handles', () => {
  const candidates = [
    makeTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] }),
    makeTripCandidate({
      dedupeKey: 'trip:ca',
      placeLabels: ['California, USA'],
      selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
    }),
  ];

  const pending = createRecentTripCandidateSelectionState({
    workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
    candidates,
    nowMs: 1000,
  });

  assert.equal(pending.kind, 'create_recent_trip_album_candidate_selection');
  assert.equal(pending.createdAtMs, 1000);
  assert.deepEqual(
    pending.candidates.map((candidate) => candidate.label),
    ['New York, USA', 'California, USA'],
  );
  assert.deepEqual(
    pending.candidates.map((candidate) => candidate.dedupeKey),
    ['trip:ny', 'trip:ca'],
  );
  assert.equal(pending.candidates[1].candidate.selectionHandle.id, '00000000-0000-4000-8000-000000000930');
});

it('resolves a pending candidate follow-up by label and album rename', () => {
  const pending = createRecentTripCandidateSelectionState({
    workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
    candidates: [
      makeTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] }),
      makeTripCandidate({
        dedupeKey: 'trip:ca',
        placeLabels: ['California, USA'],
        selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
      }),
    ],
    nowMs: 1000,
  });

  const resolved = resolveRecentTripCandidateSelection({
    pending,
    prompt: 'Use California called West Coast',
    nowMs: 2000,
  });

  assert.equal(resolved.status, 'matched');
  assert.equal(resolved.workflow.albumName, 'West Coast');
  assert.equal(resolved.candidate.dedupeKey, 'trip:ca');
});

it('resolves ordinal and yes follow-ups without exposing ids', () => {
  const single = createRecentTripCandidateSelectionState({
    workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
    candidates: [makeTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] })],
    nowMs: 1000,
  });
  const multiple = createRecentTripCandidateSelectionState({
    workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
    candidates: [
      makeTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] }),
      makeTripCandidate({ dedupeKey: 'trip:ca', placeLabels: ['California, USA'] }),
    ],
    nowMs: 1000,
  });

  assert.equal(
    resolveRecentTripCandidateSelection({ pending: single, prompt: 'yes', nowMs: 2000 }).candidate.dedupeKey,
    'trip:ny',
  );
  assert.equal(
    resolveRecentTripCandidateSelection({ pending: multiple, prompt: 'second one', nowMs: 2000 }).candidate.dedupeKey,
    'trip:ca',
  );
});

it('expires pending candidate-selection state instead of guessing', () => {
  const pending = createRecentTripCandidateSelectionState({
    workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
    candidates: [makeTripCandidate()],
    nowMs: 1000,
  });

  const resolved = resolveRecentTripCandidateSelection({
    pending,
    prompt: 'first one',
    nowMs: 1000 + strictWorkflowPendingTtlMs + 1,
  });

  assert.equal(resolved.status, 'expired');
  assert.match(resolved.text, /rerun the recent trip album request/i);
});

it('asks again when a pending candidate follow-up is ambiguous', () => {
  const pending = createRecentTripCandidateSelectionState({
    workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
    candidates: [
      makeTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] }),
      makeTripCandidate({ dedupeKey: 'trip:ca', placeLabels: ['California, USA'] }),
    ],
    nowMs: 1000,
  });

  const resolved = resolveRecentTripCandidateSelection({ pending, prompt: 'that one', nowMs: 2000 });

  assert.equal(resolved.status, 'needs_input');
  assert.match(resolved.text, /New York, USA/i);
  assert.match(resolved.text, /California, USA/i);
  assert.doesNotMatch(resolved.text, /00000000-0000-4000/i);
});

it('plans from a stored pending candidate without rerunning trip detection', async () => {
  const { client, calls } = createWorkflowClient();
  const candidate = makeTripCandidate({
    dedupeKey: 'trip:ca',
    placeLabels: ['California, USA'],
    selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
  });

  const result = await runCreateRecentTripAlbumCandidateWorkflow({
    client,
    workflow: { kind: 'create_recent_trip_album', albumName: 'West Coast', placeHint: 'USA' },
    candidate,
  });

  assert.equal(result.status, 'planned');
  assert.equal(calls.map((call) => call.name).join(','), 'proposeAlbumFromSelection');
  assert.equal(calls[0].args.albumName, 'West Coast');
  assert.equal(calls[0].args.selectionHandleId, '00000000-0000-4000-8000-000000000930');
});

it('returns candidate context when strict planning needs approval', async () => {
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
  assert.equal(result.candidate.dedupeKey, 'trip:usa:new-york:2026-05-03:2026-05-12');
  assert.equal(result.selectionHandleId, tripCandidateHandleId);
  assert.equal(result.assetCount, 28);
});
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL. The new exports do not exist, pending state cannot resolve, candidate-based execution is missing, and approval-required results omit candidate context.

- [ ] **Step 3: Implement strict workflow helpers**

In `agent-runner/src/strict-workflows.mjs`, export a 10 minute TTL:

```js
export const strictWorkflowPendingTtlMs = 10 * 60 * 1000;
```

Add helper functions near `tripCandidateLabel`:

```js
const candidateChoiceLabel = (candidate, index) => ({
  index: index + 1,
  dedupeKey: candidate.dedupeKey,
  label: tripCandidateLabel(candidate),
  candidate,
});

const normalizeChoiceText = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const explicitAlbumNameFromPrompt = (prompt) => {
  const explicit = String(prompt ?? '').match(explicitAlbumNamePattern);
  return explicit ? cleanAlbumName(explicit[1] ?? explicit[2] ?? explicit[3]) : undefined;
};

const ordinalChoice = (prompt) => {
  const text = normalizeChoiceText(prompt);
  if (/\b(?:1|first)\b/.test(text)) return 1;
  if (/\b(?:2|second)\b/.test(text)) return 2;
  if (/\b(?:3|third)\b/.test(text)) return 3;
  if (/\b(?:4|fourth)\b/.test(text)) return 4;
  if (/\b(?:5|fifth)\b/.test(text)) return 5;
  return undefined;
};

const yesChoicePattern = /^(?:yes|yeah|yep|use it|use that|that one|ok|okay)$/i;

const choiceTextForCandidate = (choice) =>
  [choice.label, choice.candidate.title, choice.candidate.subtitle, ...(choice.candidate.placeLabels ?? [])]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .flatMap((value) => [value, ...value.split(',')])
    .map(normalizeChoiceText)
    .filter((value) => value.length > 0);

const normalizedSelectionPrompt = (prompt) =>
  normalizeChoiceText(stripExplicitAlbumNameClause(String(prompt ?? ''))).replace(/^(?:use|choose|select|pick)\s+/, '');
```

Add exports:

```js
export const createRecentTripCandidateSelectionState = ({ workflow, candidates, nowMs = Date.now() }) => ({
  kind: 'create_recent_trip_album_candidate_selection',
  workflow,
  createdAtMs: nowMs,
  candidates: candidates.map(candidateChoiceLabel).slice(0, 5),
});

export const resolveRecentTripCandidateSelection = ({
  pending,
  prompt,
  nowMs = Date.now(),
  ttlMs = strictWorkflowPendingTtlMs,
}) => {
  if (pending?.kind !== 'create_recent_trip_album_candidate_selection') {
    return {
      status: 'missing',
      text: 'I no longer have pending recent trip choices. Please rerun the recent trip album request.',
    };
  }

  if (nowMs - pending.createdAtMs > ttlMs) {
    return {
      status: 'expired',
      text: 'Those pending trip choices expired. Please rerun the recent trip album request.',
    };
  }

  const requestedAlbumName = explicitAlbumNameFromPrompt(prompt);
  const normalizedPrompt = normalizedSelectionPrompt(prompt);
  let choice;
  const ordinal = ordinalChoice(prompt);
  if (ordinal !== undefined) {
    choice = pending.candidates.find((candidate) => candidate.index === ordinal);
  } else if (pending.candidates.length === 1 && yesChoicePattern.test(String(prompt ?? '').trim())) {
    choice = pending.candidates[0];
  } else {
    const matches = pending.candidates.filter((candidate) =>
      choiceTextForCandidate(candidate).some(
        (label) => normalizedPrompt.includes(label) || label.includes(normalizedPrompt),
      ),
    );
    if (matches.length === 1) {
      choice = matches[0];
    }
  }

  if (!choice) {
    const labels = pending.candidates.map((candidate) => candidate.label).join('; ');
    return { status: 'needs_input', text: `Which recent trip should I use: ${labels}?` };
  }

  return {
    status: 'matched',
    workflow: requestedAlbumName ? { ...pending.workflow, albumName: requestedAlbumName } : pending.workflow,
    candidate: choice.candidate,
  };
};
```

Refactor candidate planning out of `runCreateRecentTripAlbumWorkflow`:

```js
export const runCreateRecentTripAlbumCandidateWorkflow = async ({
  client,
  workflow,
  candidate,
  approvedPlanResult,
  signal,
}) => {
  assertCreateRecentTripWorkflow(workflow);

  const selectionHandleId = candidate?.selectionHandle?.id;
  if (!selectionHandleId) {
    return workflowResult(
      'needs_input',
      'I found a trip candidate but could not get an album-ready selection handle. Please try again or give me a date range.',
    );
  }

  const assetCount = candidate.selectionHandle.assetCount ?? candidate.albumAssetCount ?? 0;
  if (assetCount <= 0) {
    return workflowResult(
      'needs_input',
      'I found the recommended trip, but it found no album-ready assets. Which date range or place should I use instead?',
      { candidate },
    );
  }

  const label = tripCandidateLabel(candidate);
  let planResult = approvedPlanResult;
  if (!planResult) {
    try {
      planResult = await client.call(
        'proposeAlbumFromSelection',
        {
          summary: `Create ${workflow.albumName} with ${assetCount} trip assets from ${label}.`,
          albumName: workflow.albumName,
          description: `Album-ready trip selection from ${label}.${duplicateDescriptionText(candidate)}`,
          selectionHandleId,
        },
        { signal },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return workflowResult('failed', safeFailureText(message), { candidate, selectionHandleId, assetCount });
    }
  }

  return plannedResult({ planResult, candidate, workflow, label, assetCount, selectionHandleId });
};
```

Then make `runCreateRecentTripAlbumWorkflow` call the candidate executor after selecting `candidate`.

Update `plannedResult` approval-required branch to preserve context:

```js
return workflowResult('approval_required', '', { toolCallId, planResult, candidate, selectionHandleId, assetCount });
```

- [ ] **Step 4: Run tests and verify green for strict workflow units**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS after runtime tests are still unchanged only if no missing imports exist; otherwise continue with Task 2 and finish the full green run there.

## Task 2: E2E Runtime Candidate Follow-Up Continuation

**Files:**

- Modify: `agent-runner/src/e2e-runtime.mjs`
- Modify: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Add failing e2e tests**

In `agent-runner/src/e2e-runtime.test.mjs`, update the import if needed by implementation only; tests use runtime behavior.

Append these tests near the existing strict recent-trip e2e tests:

```js
it('resumes a strict recent-trip album after the user selects a candidate label', async () => {
  const candidates = [
    makeTripCandidateSummary({ title: 'Recent trip to New York, USA', dedupeKey: 'trip:ny', score: 90 }),
    makeTripCandidateSummary({
      title: 'Recent trip to California, USA',
      dedupeKey: 'trip:ca',
      placeLabels: ['California, USA'],
      selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
      score: 88,
    }),
  ];
  const { calls, fetchImplementation } = createFetch(
    tripCandidateHandlers({
      candidates,
      recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  await collectEvents(runtime, 'Create an album for my recent trip to USA');
  const followUp = await collectEvents(runtime, 'Use California');

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
  assert.equal(calls[1].body.params.arguments.selectionHandleId, '00000000-0000-4000-8000-000000000930');
  assert.equal(calls[1].body.params.arguments.albumName, 'USA Trip');
  assert.match(followUp.at(-1).content.blocks[0].text, /Review the plan before applying it/);
});

it('renames a pending strict recent-trip album from the follow-up', async () => {
  const candidates = [
    makeTripCandidateSummary({ title: 'Recent trip to New York, USA', dedupeKey: 'trip:ny' }),
    makeTripCandidateSummary({
      title: 'Recent trip to California, USA',
      dedupeKey: 'trip:ca',
      placeLabels: ['California, USA'],
      selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
    }),
  ];
  const { calls, fetchImplementation } = createFetch(
    tripCandidateHandlers({
      candidates,
      recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
      expectedAlbumName: 'West Coast',
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  await collectEvents(runtime, 'Create an album for my recent trip to USA');
  await collectEvents(runtime, 'Use California called West Coast');

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
  assert.equal(calls[1].body.params.arguments.albumName, 'West Coast');
});

it('asks the user to rerun after pending strict trip choices expire', async () => {
  let nowMs = 1000;
  const { calls, fetchImplementation } = createFetch(
    tripCandidateHandlers({
      candidates: [
        makeTripCandidateSummary({ title: 'Recent trip to New York, USA', dedupeKey: 'trip:ny' }),
        makeTripCandidateSummary({
          title: 'Recent trip to California, USA',
          dedupeKey: 'trip:ca',
          placeLabels: ['California, USA'],
        }),
      ],
      recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation, now: () => nowMs });
  await runtime.createSession(createSessionBody());

  await collectEvents(runtime, 'Create an album for my recent trip to USA');
  nowMs += 10 * 60 * 1000 + 1;
  const followUp = await collectEvents(runtime, 'first one');

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates');
  assert.match(followUp.at(-1).content.blocks[0].text, /expired/i);
  assert.match(followUp.at(-1).content.blocks[0].text, /rerun the recent trip album request/i);
});
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL. E2E runtime does not accept `now`, does not store pending state, and follow-ups fall through.

- [ ] **Step 3: Implement e2e pending state**

In `agent-runner/src/e2e-runtime.mjs`, import the new helpers:

```js
import {
  createRecentTripCandidateSelectionState,
  matchStrictWorkflow,
  resolveRecentTripCandidateSelection,
  runCreateRecentTripAlbumCandidateWorkflow,
  runCreateRecentTripAlbumWorkflow,
} from './strict-workflows.mjs';
```

Change the factory signature:

```js
export const createE2eRuntime = ({ fetch: fetchImplementation = fetch, now = () => Date.now() } = {}) => {
```

Add `pendingStrictWorkflow: undefined` to session entries.

At the start of `sendMessage`, after `prompt` and before `metadataPrompt`, resolve pending candidate state when the prompt does not start a new strict workflow:

```js
      const strictWorkflow = matchStrictWorkflow(prompt);
      if (strictWorkflow.kind !== 'create_recent_trip_album' && entry.pendingStrictWorkflow?.kind === 'create_recent_trip_album_candidate_selection') {
        const resolved = resolveRecentTripCandidateSelection({ pending: entry.pendingStrictWorkflow, prompt, nowMs: now() });
        if (resolved.status === 'expired') {
          entry.pendingStrictWorkflow = undefined;
          yield completedEvent({ gallerySessionId, runnerSessionId, text: resolved.text });
          return;
        }
        if (resolved.status === 'needs_input') {
          yield completedEvent({ gallerySessionId, runnerSessionId, text: resolved.text });
          return;
        }
        if (resolved.status === 'matched') {
          entry.pendingStrictWorkflow = undefined;
          const workflowResult = await runCreateRecentTripAlbumCandidateWorkflow({
            client,
            workflow: resolved.workflow,
            candidate: resolved.candidate,
          });
          yield completedEvent({ gallerySessionId, runnerSessionId, text: workflowResult.text });
          return;
        }
      }
```

In the existing strict workflow block, after `runCreateRecentTripAlbumWorkflow`, store pending candidate state:

```js
if (workflowResult.status === 'needs_input' && Array.isArray(workflowResult.candidates)) {
  entry.pendingStrictWorkflow = createRecentTripCandidateSelectionState({
    workflow: strictWorkflow,
    candidates: workflowResult.candidates,
    nowMs: now(),
  });
} else if (workflowResult.status !== 'approval_required') {
  entry.pendingStrictWorkflow = undefined;
}
```

Keep the existing approval pause behavior unchanged for e2e.

- [ ] **Step 4: Run e2e tests and verify green**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS for e2e and no regression in existing highlight paths.

## Task 3: Production Pi Runtime Candidate And Approval Continuation

**Files:**

- Modify: `agent-runner/src/pi-runtime.mjs`
- Modify: `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Add failing production tests**

Before appending the tests, update the existing `createStrictWorkflowFetch` helper in `agent-runner/src/pi-runtime.test.mjs` so follow-up tests can assert the selected candidate handle and renamed album:

```js
  expectedAlbumName = 'USA Trip',
  expectedSelectionHandleId = strictTripCandidateHandleId,
```

and in the `proposeAlbumFromSelection` branch replace the fixed assertions with:

```js
assert.equal(args.albumName, expectedAlbumName);
assert.equal(args.selectionHandleId, expectedSelectionHandleId);
```

Append these tests near the strict production tests in `agent-runner/src/pi-runtime.test.mjs`:

```js
it('resumes a production strict recent-trip album after candidate selection without provider prompting', async () => {
  const { sdk, ai, calls } = createFakeDependencies({
    mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
  });
  const candidates = [
    makeStrictTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] }),
    makeStrictTripCandidate({
      dedupeKey: 'trip:ca',
      placeLabels: ['California, USA'],
      selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
    }),
  ];
  const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch({
    candidates,
    recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
    expectedSelectionHandleId: '00000000-0000-4000-8000-000000000930',
  });
  const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

  await collect(
    runtime.sendMessage(
      createMessageRequest({
        content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
      }),
    ),
  );
  const followUp = await collect(
    runtime.sendMessage(
      createMessageRequest({
        messageId: '00000000-0000-4000-8000-000000000201',
        content: { blocks: [{ type: 'text', text: 'Use California' }] },
      }),
    ),
  );

  assert.deepEqual(calls.prompts, []);
  assert.equal(mcpCalls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
  assert.equal(mcpCalls[1].body.params.arguments.selectionHandleId, '00000000-0000-4000-8000-000000000930');
  assert.match(followUp.at(-1).content.blocks[0].text, /Review the plan before applying it/);
});

it('renames a production pending strict recent-trip album from the follow-up', async () => {
  const { sdk, ai, calls } = createFakeDependencies({
    mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
  });
  const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch({
    candidates: [
      makeStrictTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] }),
      makeStrictTripCandidate({
        dedupeKey: 'trip:ca',
        placeLabels: ['California, USA'],
        selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
      }),
    ],
    recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
    expectedAlbumName: 'West Coast',
    expectedSelectionHandleId: '00000000-0000-4000-8000-000000000930',
  });
  const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

  await collect(
    runtime.sendMessage(
      createMessageRequest({
        content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
      }),
    ),
  );
  await collect(
    runtime.sendMessage(
      createMessageRequest({
        messageId: '00000000-0000-4000-8000-000000000201',
        content: { blocks: [{ type: 'text', text: 'Use California called West Coast' }] },
      }),
    ),
  );

  assert.deepEqual(calls.prompts, []);
  assert.equal(mcpCalls[1].body.params.arguments.albumName, 'West Coast');
});

it('asks to rerun when a production pending strict trip selection expires', async () => {
  let nowMs = 1000;
  const { sdk, ai, calls } = createFakeDependencies({
    mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
  });
  const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch({
    candidates: [
      makeStrictTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] }),
      makeStrictTripCandidate({ dedupeKey: 'trip:ca', placeLabels: ['California, USA'] }),
    ],
    recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
  });
  const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation, now: () => nowMs });
  await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

  await collect(
    runtime.sendMessage(
      createMessageRequest({
        content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
      }),
    ),
  );
  nowMs += 10 * 60 * 1000 + 1;
  const followUp = await collect(
    runtime.sendMessage(
      createMessageRequest({
        messageId: '00000000-0000-4000-8000-000000000201',
        content: { blocks: [{ type: 'text', text: 'first one' }] },
      }),
    ),
  );

  assert.deepEqual(calls.prompts, []);
  assert.equal(mcpCalls.map((call) => call.body.params.name).join(','), 'findTripCandidates');
  assert.match(followUp.at(-1).content.blocks[0].text, /expired/i);
  assert.match(followUp.at(-1).content.blocks[0].text, /rerun the recent trip album request/i);
});

it('resumes approved strict planning without provider prompting', async () => {
  const { sdk, ai, calls } = createFakeDependencies({
    mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
  });
  const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch({
    planResponse: {
      status: 'approval-required',
      toolCall: { id: '00000000-0000-4000-8000-000000000999' },
    },
  });
  const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

  await collect(
    runtime.sendMessage(
      createMessageRequest({
        content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
      }),
    ),
  );
  const resumed = await collect(
    runtime.resumeSession({
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      toolCallId: '00000000-0000-4000-8000-000000000999',
      approvalDecision: 'approved',
      toolResult: { status: 'success', plan: { id: strictTripPlanId } },
    }),
  );

  assert.deepEqual(calls.prompts, []);
  assert.equal(calls.continues, 0);
  assert.equal(mcpCalls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
  assert.equal(resumed.at(-1).type, 'assistant-message-completed');
  assert.match(resumed.at(-1).content.blocks[0].text, /Review the plan before applying it/);
});

it('resumes denied strict planning approval without provider prompting', async () => {
  const { sdk, ai, calls } = createFakeDependencies({
    mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
  });
  const { fetchImplementation } = createStrictWorkflowFetch({
    planResponse: {
      status: 'approval-required',
      toolCall: { id: '00000000-0000-4000-8000-000000000999' },
    },
  });
  const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

  await collect(
    runtime.sendMessage(
      createMessageRequest({
        content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
      }),
    ),
  );
  const resumed = await collect(
    runtime.resumeSession({
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      toolCallId: '00000000-0000-4000-8000-000000000999',
      approvalDecision: 'denied',
    }),
  );

  assert.deepEqual(calls.prompts, []);
  assert.equal(calls.continues, 0);
  assert.equal(resumed.at(-1).type, 'assistant-message-completed');
  assert.match(resumed.at(-1).content.blocks[0].text, /approval was denied/i);
  assert.doesNotMatch(resumed.at(-1).content.blocks[0].text, /Review the plan/i);
});
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL. Production runtime does not accept `now`, does not store pending candidate or approval state, and `resumeSession` still routes strict approvals through provider prompt/continue.

- [ ] **Step 3: Implement production pending state**

In `agent-runner/src/pi-runtime.mjs`, import the new helpers:

```js
import {
  createRecentTripCandidateSelectionState,
  matchStrictWorkflow,
  resolveRecentTripCandidateSelection,
  runCreateRecentTripAlbumCandidateWorkflow,
  runCreateRecentTripAlbumWorkflow,
} from './strict-workflows.mjs';
```

Change factory signature:

```js
export const createPiRuntime = ({
  sdk = defaultDependencies.sdk,
  ai = defaultDependencies.ai,
  fetch: fetchImplementation = fetch,
  now = () => Date.now(),
} = {}) => {
```

Add helper functions near strict event helpers:

```js
const strictApprovalDeniedText =
  'Gallery did not create the recent trip album plan because the approval was denied. Please rerun the recent trip album request if you want to try again.';

const createRecentTripApprovalState = ({ workflow, workflowResult, nowMs }) => ({
  kind: 'create_recent_trip_album_approval',
  toolCallId: workflowResult.toolCallId,
  workflow,
  candidate: workflowResult.candidate,
  createdAtMs: nowMs,
});
```

Also update `appendStrictWorkflowTranscript` so approval resumes can append only assistant output without creating an empty user message:

```js
const appendStrictWorkflowTranscript = (session, prompt, assistantText) => {
  if (!Array.isArray(session.messages)) {
    return;
  }

  if (prompt) {
    session.messages.push({ role: 'user', content: [{ type: 'text', text: prompt }] });
  }
  if (assistantText) {
    session.messages.push({ role: 'assistant', content: [{ type: 'text', text: assistantText }] });
  }
};
```

Add `pendingStrictWorkflow: undefined` to session entries.

Add a small local helper inside `createPiRuntime` before `return { ... }`:

```js
const strictMcpClient = (entry) => createGalleryMcpClient({ gateway: entry.mcpGateway, fetch: fetchImplementation });
```

In `sendMessage`, before the normal strict prompt branch, resolve candidate-selection state when the prompt does not match a new strict request. Use a strict `AbortController` and `entry.abortActiveStream` just like the strict new-request path:

```js
      if (strictWorkflow.kind !== 'create_recent_trip_album' && entry.pendingStrictWorkflow?.kind === 'create_recent_trip_album_candidate_selection') {
        let abortStrictStream;
        try {
          const resolved = resolveRecentTripCandidateSelection({ pending: entry.pendingStrictWorkflow, prompt: promptText, nowMs: now() });
          if (resolved.status === 'expired') {
            entry.pendingStrictWorkflow = undefined;
            yield strictCompletedEvent({ gallerySessionId, runnerSessionId, text: resolved.text });
            return;
          }
          if (resolved.status === 'needs_input') {
            yield strictCompletedEvent({ gallerySessionId, runnerSessionId, text: resolved.text });
            return;
          }
          if (resolved.status === 'matched' && entry.mcpGateway) {
            const strictAbortController = new AbortController();
            abortStrictStream = () => {
              strictAbortController.abort();
            };
            entry.abortActiveStream = abortStrictStream;
            entry.pendingStrictWorkflow = undefined;
            const workflowResult = await runCreateRecentTripAlbumCandidateWorkflow({
              client: strictMcpClient(entry),
              workflow: resolved.workflow,
              candidate: resolved.candidate,
              signal: strictAbortController.signal,
            });
            if (workflowResult.status === 'approval_required') {
              entry.pendingStrictWorkflow = createRecentTripApprovalState({
                workflow: resolved.workflow,
                workflowResult,
                nowMs: now(),
              });
              yield strictApprovalEvent({ gallerySessionId, runnerSessionId, toolCallId: workflowResult.toolCallId });
              return;
            }
            yield strictCompletedEvent({ gallerySessionId, runnerSessionId, text: workflowResult.text });
            return;
          }
        } catch (error) {
          yield { type: 'runner-error', sessionId: gallerySessionId, runnerSessionId, message: sanitizeSessionError(error, entry) };
          return;
        } finally {
          if (abortStrictStream && entry.abortActiveStream === abortStrictStream) {
            entry.abortActiveStream = undefined;
          }
          entry.inFlight = false;
        }
      }
```

When a new strict request returns `needs_input` with candidates, set:

```js
entry.pendingStrictWorkflow = createRecentTripCandidateSelectionState({
  workflow: strictWorkflow,
  candidates: workflowResult.candidates,
  nowMs: now(),
});
```

When a strict request or follow-up returns `approval_required`, set:

```js
entry.pendingStrictWorkflow = createRecentTripApprovalState({
  workflow: strictWorkflowOrResolvedWorkflow,
  workflowResult,
  nowMs: now(),
});
```

Clear `entry.pendingStrictWorkflow` for planned/failed no-candidate terminal states.

At the beginning of `resumeSession`, after validating the entry and `entry.inFlight`, check matching strict approval state before provider subscription:

```js
      if (
        entry.pendingStrictWorkflow?.kind === 'create_recent_trip_album_approval' &&
        entry.pendingStrictWorkflow.toolCallId === toolCallId
      ) {
        entry.inFlight = true;
        try {
          const pending = entry.pendingStrictWorkflow;
          entry.pendingStrictWorkflow = undefined;
          if (approvalDecision !== 'approved') {
            const text = strictApprovalDeniedText;
            appendStrictWorkflowTranscript(entry.session, '', text);
            yield strictCompletedEvent({ gallerySessionId, runnerSessionId, text });
            return;
          }

          const workflowResult = await runCreateRecentTripAlbumCandidateWorkflow({
            client: strictMcpClient(entry),
            workflow: pending.workflow,
            candidate: pending.candidate,
            approvedPlanResult: toolResult,
          });
          const text = workflowResult.text;
          appendStrictWorkflowTranscript(entry.session, '', text);
          yield strictCompletedEvent({ gallerySessionId, runnerSessionId, text });
          return;
        } catch (error) {
          yield { type: 'runner-error', sessionId: gallerySessionId, runnerSessionId, message: sanitizeSessionError(error, entry) };
          return;
        } finally {
          entry.inFlight = false;
        }
      }
```

Do not handle non-matching `toolCallId` here; it should continue through the existing provider resume path.

- [ ] **Step 4: Run tests and verify green**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS. Production strict continuations bypass provider prompting, existing provider resume tests still pass, and e2e follow-ups pass.

## Task 4: Final Scope And Drift Checks

**Files:**

- Modify: `docs/superpowers/specs/2026-05-28-pi-agent-strict-recent-trip-album-design.md`
- Modify: `docs/superpowers/plans/2026-05-28-pi-agent-strict-recent-trip-album-slice-6.md`

- [ ] **Step 1: Verify no unsupported workflow drift**

Run:

```bash
git diff -- agent-runner/src/strict-workflows.mjs agent-runner/src/e2e-runtime.mjs agent-runner/src/pi-runtime.mjs
```

Expected:

- Pending state is only for `create_recent_trip_album`.
- No direct apply/write tool.
- No raw asset ids are stored or sent to provider.
- Unsupported prompts still reach open provider orchestration.
- Strict approval resume only handles matching stored strict `toolCallId`.

- [ ] **Step 2: Run full agent-runner verification**

Run:

```bash
pnpm --dir agent-runner test
git diff --check
```

Expected: PASS and no whitespace errors.

- [ ] **Step 3: Commit Slice 6**

Run:

```bash
git add docs/superpowers/specs/2026-05-28-pi-agent-strict-recent-trip-album-design.md \
  docs/superpowers/plans/2026-05-28-pi-agent-strict-recent-trip-album-slice-6.md \
  agent-runner/src/strict-workflows.mjs agent-runner/src/strict-workflows.test.mjs \
  agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs \
  agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs
git commit -m "feat: resume strict recent trip workflow state"
```

Expected: commit succeeds.

## Plan Self-Review

- Spec coverage: every Slice 6 requirement, including the approval-resume follow-up clarified in the spec, has explicit tests.
- TDD order: each behavior starts with failing unit/runtime tests before implementation.
- Scope: no database persistence, generic event workflows, direct apply/write, or objective highlight scoring.
- Type consistency: pending state kinds are `create_recent_trip_album_candidate_selection` and `create_recent_trip_album_approval`; workflow statuses remain `planned`, `needs_input`, `failed`, and `approval_required`.
- Placeholder scan: no TODO/TBD placeholders.
