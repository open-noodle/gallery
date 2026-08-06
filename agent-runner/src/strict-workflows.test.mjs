import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createRecentTripCandidateSelectionState,
  matchStrictWorkflow,
  resolveRecentTripCandidateSelection,
  runCreateRecentTripAlbumCandidateWorkflow,
  runCreateRecentTripAlbumWorkflow,
  strictWorkflowPendingTtlMs,
} from './strict-workflows.mjs';
import { createIntentClassifier } from './strict-workflows/classifier.mjs';
import { WORKFLOW_MANIFEST } from './strict-workflows/manifest.mjs';
import { createWorkflowRegistry } from './strict-workflows/registry.mjs';
import {
  createWorkflowClient,
  makeTripCandidate,
  tripCandidateHandleId,
  tripPlanId,
} from './strict-workflows/test-helpers.mjs';

describe('strict workflow router', () => {
  it('matches a USA recent-trip album request', () => {
    assert.deepEqual(matchStrictWorkflow('Create an album for my recent trip to USA'), {
      kind: 'create_recent_trip_album',
      albumName: 'USA Trip',
      placeHint: 'USA',
    });
  });

  it('matches a recent-trip album request without a place hint', () => {
    assert.deepEqual(matchStrictWorkflow('Make an album for my recent trip'), {
      kind: 'create_recent_trip_album',
      albumName: 'Recent Trip',
    });
  });

  it('matches travel-word album paraphrases with uncommon verbs', () => {
    assert.deepEqual(matchStrictWorkflow('throw the pics from our Italy getaway into a new album'), {
      kind: 'create_recent_trip_album',
      albumName: 'Italy Trip',
      placeHint: 'Italy',
    });
  });

  it('does not extract temporal travel phrases as place hints', () => {
    assert.deepEqual(matchStrictWorkflow('throw my vacation photos from last month into a new album'), {
      kind: 'create_recent_trip_album',
      albumName: 'Recent Trip',
    });
    assert.deepEqual(matchStrictWorkflow('throw my Summer vacation into a new album'), {
      kind: 'create_recent_trip_album',
      albumName: 'Recent Trip',
    });
    assert.deepEqual(matchStrictWorkflow('throw my vacation photos from May 2024 into a new album'), {
      kind: 'create_recent_trip_album',
      albumName: 'Recent Trip',
    });
    assert.deepEqual(matchStrictWorkflow('throw my vacation photos from summer 2025 into a new album'), {
      kind: 'create_recent_trip_album',
      albumName: 'Recent Trip',
    });
  });

  it('preserves explicit album names', () => {
    assert.deepEqual(matchStrictWorkflow('Create an album for my recent trip called Spring Break'), {
      kind: 'create_recent_trip_album',
      albumName: 'Spring Break',
    });
  });

  it('preserves common punctuation in explicit album names', () => {
    assert.deepEqual(matchStrictWorkflow("Create an album for my recent trip called Bob's Vacation"), {
      kind: 'create_recent_trip_album',
      albumName: "Bob's Vacation",
    });

    assert.deepEqual(matchStrictWorkflow('Create an album for my recent trip called "Spring Break!"'), {
      kind: 'create_recent_trip_album',
      albumName: 'Spring Break!',
    });
  });

  it('allows highlight words inside explicit album names', () => {
    assert.deepEqual(matchStrictWorkflow('Create an album for my recent trip called Favorite Memories'), {
      kind: 'create_recent_trip_album',
      albumName: 'Favorite Memories',
    });

    assert.deepEqual(matchStrictWorkflow('Create an album for my recent trip called Best of Italy'), {
      kind: 'create_recent_trip_album',
      albumName: 'Best of Italy',
    });
  });

  it('splits combined place and album-name clauses', () => {
    assert.deepEqual(matchStrictWorkflow('Create an album for my recent trip to USA called Spring Break'), {
      kind: 'create_recent_trip_album',
      albumName: 'Spring Break',
      placeHint: 'USA',
    });
  });

  it('normalizes United States aliases to USA', () => {
    for (const prompt of [
      'Create an album for my recent trip to USA',
      'Create an album for my recent trip to United States',
      'Create an album for my recent trip to the United States',
      'Create an album for my recent trip to U.S.',
    ]) {
      assert.equal(matchStrictWorkflow(prompt).placeHint, 'USA', prompt);
      assert.equal(matchStrictWorkflow(prompt).albumName, 'USA Trip', prompt);
    }
  });

  it('omits uncertain place hints instead of guessing', () => {
    assert.deepEqual(matchStrictWorkflow('Create an album for my recent trip to somewhere nice'), {
      kind: 'create_recent_trip_album',
      albumName: 'Recent Trip',
    });
  });

  it('allows place names containing space', () => {
    assert.deepEqual(matchStrictWorkflow('Create an album for my recent trip to Space Needle'), {
      kind: 'create_recent_trip_album',
      albumName: 'Space Needle Trip',
      placeHint: 'Space Needle',
    });
  });

  it('rejects explicit highlight requests', () => {
    for (const prompt of [
      'Create an album of the top highlights for my recent trip to USA',
      'Create an album of the best photos from my recent trip to USA',
      'Pick highlights from my recent trip and make an album',
    ]) {
      assert.deepEqual(matchStrictWorkflow(prompt), { kind: 'unsupported' }, prompt);
    }
  });

  it('rejects non-generic album creation workflows', () => {
    for (const prompt of [
      'Add my recent trip photos to Family',
      'Create a shared space for my recent trip to USA',
      'How many photos are in my recent trip album?',
      'Set the description on my recent trip photos to Vacation',
    ]) {
      assert.deepEqual(matchStrictWorkflow(prompt), { kind: 'unsupported' }, prompt);
    }
  });

  it('still matches an explicit album name whose words trip the non-generic guard', () => {
    // "called Travel Tag" contains "tag" (a non-generic verb). The guard runs on
    // the album-name-stripped text, so this still matches at the fast-path.
    assert.deepEqual(matchStrictWorkflow('Create an album for my recent trip to USA called Travel Tag'), {
      kind: 'create_recent_trip_album',
      albumName: 'Travel Tag',
      placeHint: 'USA',
    });
  });
});

describe('strict router classifier path for declined fast-path matches', () => {
  const workflows = createWorkflowRegistry().listWorkflows();

  const buildClassifier = (classifyIntent, mode = 'hybrid') =>
    createIntentClassifier({ classifyIntent, manifest: WORKFLOW_MANIFEST, workflows, mode });

  it('does not run the trip workflow when the classifier returns a competing intent', async () => {
    // A declined fast-path match (competing prompt) now flows to the LLM. An
    // unknown/competing intent the manifest does not list must NOT be coerced
    // into the trip workflow (`unknown_kind_xyz` is not an implemented strict kind).
    const classifier = buildClassifier(async () => ({
      workflow: 'unknown_kind_xyz',
      slots: {},
      confidence: 'high',
    }));
    const decision = await classifier.classify('Delete the photos from my recent trip and start over');
    assert.equal(decision.kind, 'none');
  });

  it('does not run the trip workflow when the classifier returns none', async () => {
    const classifier = buildClassifier(async () => ({ workflow: 'none', slots: {}, confidence: 'low' }));
    const decision = await classifier.classify('Set the description on my recent trip photos to Vacation');
    assert.equal(decision.kind, 'none');
  });
});

describe('create_recent_trip_album workflow execution', () => {
  it('builds pending candidate-selection state with labels and handles', () => {
    const candidates = [
      makeTripCandidate({
        dedupeKey: 'trip:ny',
        placeLabels: ['New York, USA'],
        rawAssetIds: ['00000000-0000-4000-8000-000000000111'],
        internalToolDetail: 'must-not-be-stored',
      }),
      makeTripCandidate({
        dedupeKey: 'trip:ca',
        placeLabels: ['California, USA'],
        selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
        assets: [{ id: '00000000-0000-4000-8000-000000000222' }],
      }),
    ];

    const pending = createRecentTripCandidateSelectionState({
      workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
      candidates,
      nowMs: 1000,
    });

    assert.equal(pending.kind, 'create_recent_trip_album_candidate_selection');
    assert.equal(pending.createdAtMs, 1000);
    assert.deepEqual(pending.candidates.map((candidate) => candidate.label), ['New York, USA', 'California, USA']);
    assert.deepEqual(pending.candidates.map((candidate) => candidate.dedupeKey), ['trip:ny', 'trip:ca']);
    assert.deepEqual(pending.candidates[1].candidate.selectionHandle, {
      id: '00000000-0000-4000-8000-000000000930',
      assetCount: 14,
    });
    const serialized = JSON.stringify(pending);
    assert.doesNotMatch(serialized, /must-not-be-stored/);
    assert.doesNotMatch(serialized, /rawAssetIds|assets|sourceRef/);
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

    assert.equal(resolveRecentTripCandidateSelection({ pending: single, prompt: 'yes', nowMs: 2000 }).candidate.dedupeKey, 'trip:ny');
    assert.equal(resolveRecentTripCandidateSelection({ pending: multiple, prompt: 'second one', nowMs: 2000 }).candidate.dedupeKey, 'trip:ca');
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

  it('asks again for empty or punctuation-only pending candidate follow-ups', () => {
    const pending = createRecentTripCandidateSelectionState({
      workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
      candidates: [makeTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] })],
      nowMs: 1000,
    });

    for (const prompt of ['', '   ', '???']) {
      const resolved = resolveRecentTripCandidateSelection({ pending, prompt, nowMs: 2000 });

      assert.equal(resolved.status, 'needs_input', prompt);
      assert.match(resolved.text, /New York, USA/i);
    }
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

  it('forwards the abort signal to strict MCP calls', async () => {
    const { client, calls } = createWorkflowClient();
    const controller = new AbortController();

    const result = await runCreateRecentTripAlbumWorkflow({
      client,
      workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
      signal: controller.signal,
    });

    assert.equal(result.status, 'planned');
    assert.deepEqual(
      calls.map((call) => [call.name, call.options?.signal]),
      [
        ['findTripCandidates', controller.signal],
        ['proposeAlbumFromSelection', controller.signal],
      ],
    );
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
      planResult: { status: 'denied', reason: 'Bearer other-secret api_key=raw-key raw denied detail' },
    });

    const result = await runCreateRecentTripAlbumWorkflow({
      client,
      workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
    });

    assert.equal(result.status, 'failed');
    assert.match(result.text, /planning tool returned status "denied" for proposeAlbumFromSelection/i);
    assert.doesNotMatch(result.text, /other-secret|raw-key|raw denied detail/i);
    assert.doesNotMatch(result.text, /Bearer \[redacted\]|\[redacted\]/i);
    assert.doesNotMatch(result.text, /plan is ready|I created|I proposed|Review the plan/i);
  });

  it('does not emit raw structured planning error text', async () => {
    const { client } = createWorkflowClient({
      planResult: { status: 'error', message: 'Bearer other-secret api_key=raw-key raw tool detail' },
    });

    const result = await runCreateRecentTripAlbumWorkflow({
      client,
      workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
    });

    assert.equal(result.status, 'failed');
    assert.match(result.text, /planning tool returned status "error" for proposeAlbumFromSelection/i);
    assert.doesNotMatch(result.text, /other-secret|raw-key|raw tool detail/i);
    assert.doesNotMatch(result.text, /Bearer \[redacted\]|\[redacted\]/i);
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

  it('fails safely when approval_required has no usable tool call id', async () => {
    const { client } = createWorkflowClient({
      planResult: {
        status: 'approval-required',
        toolCall: { id: '' },
      },
    });

    const result = await runCreateRecentTripAlbumWorkflow({
      client,
      workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
    });

    assert.equal(result.status, 'failed');
    assert.doesNotMatch(result.text, /plan is ready|I created|I proposed|Review the plan/i);
    assert.match(result.text, /could not create a reviewable album plan/i);
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

  it('redacts credential-shaped planning exception details before user-facing output', async () => {
    const rawValues = [
      'auth-token-123',
      'bearer-token-456',
      'query-api-key-789',
      'header-api-key-abc',
      'spaced-api-key-def',
      'password-value-123',
      'password-value-456',
      'secret-equals-123',
      'secret-colon-456',
      'secret-word-789',
      'token-word-abc',
      'secret-value-extra',
    ];
    const { client } = createWorkflowClient({
      planError: new Error(
        [
          'Authorization: Bearer auth-token-123',
          'Bearer bearer-token-456',
          'api_key=query-api-key-789',
          'apiKey: header-api-key-abc',
          'api-key spaced-api-key-def',
          'password=password-value-123',
          'password: password-value-456',
          'secret=secret-equals-123',
          'secret: secret-colon-456',
          'secret value secret-word-789',
          'token token-word-abc',
          'secret-value-extra',
        ].join(' '),
      ),
    });

    const result = await runCreateRecentTripAlbumWorkflow({
      client,
      workflow: matchStrictWorkflow('Create an album for my recent trip to USA'),
    });

    assert.equal(result.status, 'failed');
    assert.match(result.text, /\[redacted\]/);
    for (const rawValue of rawValues) {
      assert.equal(result.text.includes(rawValue), false, rawValue);
    }
    assert.doesNotMatch(result.text, /plan is ready|I created|I proposed|Review the plan/i);
  });
});
