import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strictWorkflowPendingTtlMs } from '../../strict-workflows.mjs';
import {
  createWorkflowClient,
  makeTripCandidate,
  tripCandidateHandleId,
  tripPlanId,
} from '../test-helpers.mjs';
import { createRecentTripAlbumWorkflow } from './create-recent-trip-album.mjs';

const wf = createRecentTripAlbumWorkflow();

describe('create_recent_trip_album StrictWorkflow', () => {
  it('declares its kind and strict flow', () => {
    assert.equal(wf.kind, 'create_recent_trip_album');
    assert.equal(wf.flow, 'strict');
  });

  it('matches and parses slots like the legacy matcher', () => {
    const matched = wf.match('Create an album for my recent trip to USA');
    assert.deepEqual(matched.slots, { albumName: 'USA Trip', placeHint: 'USA' });
    assert.deepEqual(wf.parseSlots({ albumName: 'USA Trip', placeHint: 'U.S.' }, 'irrelevant'), {
      albumName: 'USA Trip',
      placeHint: 'USA',
    });
  });

  it('matches without a place hint and omits placeHint from the slots', () => {
    const matched = wf.match('Make an album for my recent trip');
    assert.deepEqual(matched.slots, { albumName: 'Recent Trip' });
  });

  it('returns undefined from match for unsupported prompts', () => {
    assert.equal(wf.match('How many photos are in my recent trip album?'), undefined);
    assert.equal(wf.match('Add my recent trip photos to Family'), undefined);
  });

  it('derives a default album name from a bare place hint in parseSlots', () => {
    assert.deepEqual(wf.parseSlots({ placeHint: 'United States' }, 'irrelevant'), {
      albumName: 'USA Trip',
      placeHint: 'USA',
    });
  });

  it('rejects empty slots from parseSlots so the router falls through to open orchestration', () => {
    assert.equal(wf.parseSlots({}, 'unrelated chatter'), null);
    assert.equal(wf.parseSlots({ albumName: '   ', placeHint: 'somewhere nice' }, 'irrelevant'), null);
  });

  it('runs the high-confidence path to a planned outcome with a success summary', async () => {
    const { client, calls } = createWorkflowClient();
    const outcome = await wf.run({ client, slots: { albumName: 'USA Trip', placeHint: 'USA' } });
    assert.equal(outcome.status, 'planned');
    assert.equal(outcome.planId, tripPlanId);
    assert.equal(calls.map((c) => c.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.equal(outcome.successSummary.workflowKind, 'create_recent_trip_album');
    assert.equal(outcome.successSummary.albumName, 'USA Trip');
    assert.equal(outcome.successSummary.assetCount, 28);
    assert.equal(outcome.successSummary.label, 'New York, USA');
    assert.equal(outcome.successSummary.dateRange, 'May 3-12, 2026');
    assert.equal(outcome.successSummary.exclusions, '3 known duplicate variants and 1 stack child');
  });

  it('forwards the abort signal to strict MCP calls', async () => {
    const { client, calls } = createWorkflowClient();
    const controller = new AbortController();
    const outcome = await wf.run({
      client,
      slots: { albumName: 'USA Trip', placeHint: 'USA' },
      signal: controller.signal,
    });
    assert.equal(outcome.status, 'planned');
    assert.deepEqual(
      calls.map((c) => [c.name, c.options?.signal]),
      [
        ['findTripCandidates', controller.signal],
        ['proposeAlbumFromSelection', controller.signal],
      ],
    );
  });

  it('runs the continuation-resolved path via run({ candidate }) without re-running discovery', async () => {
    const { client, calls } = createWorkflowClient();
    const candidate = makeTripCandidate({
      dedupeKey: 'trip:ca',
      placeLabels: ['California, USA'],
      selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
    });
    const outcome = await wf.run({ client, slots: { albumName: 'West Coast' }, candidate });
    assert.equal(outcome.status, 'planned');
    assert.equal(calls.map((c) => c.name).join(','), 'proposeAlbumFromSelection');
    assert.equal(calls[0].args.albumName, 'West Coast');
    assert.equal(calls[0].args.selectionHandleId, '00000000-0000-4000-8000-000000000930');
    assert.equal(outcome.successSummary.label, 'California, USA');
  });

  it('attaches a built continuation on ask_user so the dispatcher can persist it', async () => {
    const { client } = createWorkflowClient({
      recommendation: { action: 'ask_user' },
      candidates: [
        makeTripCandidate({ dedupeKey: 'a', placeLabels: ['New York, USA'] }),
        makeTripCandidate({ dedupeKey: 'b', placeLabels: ['California, USA'] }),
      ],
    });
    const outcome = await wf.run({ client, slots: { albumName: 'Recent Trip' }, nowMs: 1000 });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(outcome.continuation.kind, 'create_recent_trip_album_candidate_selection');
    assert.equal(outcome.continuation.createdAtMs, 1000);
    assert.equal(outcome.continuation.candidates.length, 2);
    assert.deepEqual(outcome.continuation.workflow, { kind: 'create_recent_trip_album', albumName: 'Recent Trip' });
    const serialized = JSON.stringify(outcome.continuation);
    assert.doesNotMatch(serialized, /sourceRef/);
  });

  it('does not attach a continuation when ask_user has no usable candidates', async () => {
    const { client } = createWorkflowClient({
      recommendation: { action: 'none' },
      candidates: [],
    });
    const outcome = await wf.run({ client, slots: { albumName: 'Recent Trip' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal('continuation' in outcome, false);
  });

  it('attaches { slots, candidate } continuation on approval_required', async () => {
    const { client } = createWorkflowClient({
      planResult: {
        status: 'approval-required',
        toolCall: { id: '00000000-0000-4000-8000-000000000999' },
      },
    });
    const outcome = await wf.run({ client, slots: { albumName: 'USA Trip', placeHint: 'USA' } });
    assert.equal(outcome.status, 'approval_required');
    assert.equal(outcome.toolCallId, '00000000-0000-4000-8000-000000000999');
    assert.deepEqual(outcome.continuation.slots, { albumName: 'USA Trip', placeHint: 'USA' });
    assert.equal(outcome.continuation.candidate.dedupeKey, 'trip:usa:new-york:2026-05-03:2026-05-12');
  });

  it('builds a continuation via buildContinuation', () => {
    const continuation = wf.buildContinuation({
      slots: { albumName: 'USA Trip', placeHint: 'USA' },
      candidates: [makeTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] })],
      nowMs: 1000,
    });
    assert.equal(continuation.kind, 'create_recent_trip_album_candidate_selection');
    assert.deepEqual(continuation.workflow, { kind: 'create_recent_trip_album', albumName: 'USA Trip', placeHint: 'USA' });
    assert.equal(continuation.candidates[0].label, 'New York, USA');
  });

  it('resolves a continuation follow-up into a run ctx with candidate and slots', () => {
    const pending = wf.buildContinuation({
      slots: { albumName: 'USA Trip', placeHint: 'USA' },
      candidates: [
        makeTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] }),
        makeTripCandidate({ dedupeKey: 'trip:ca', placeLabels: ['California, USA'] }),
      ],
      nowMs: 1000,
    });
    const resolved = wf.resumeContinuation({ pending, prompt: 'Use California called West Coast', nowMs: 2000 });
    assert.equal(resolved.status, 'matched');
    assert.deepEqual(resolved.ctx.slots, { albumName: 'West Coast', placeHint: 'USA' });
    assert.equal(resolved.ctx.candidate.dedupeKey, 'trip:ca');
  });

  it('passes non-matched continuation results through unchanged', () => {
    const pending = wf.buildContinuation({
      slots: { albumName: 'USA Trip', placeHint: 'USA' },
      candidates: [
        makeTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] }),
        makeTripCandidate({ dedupeKey: 'trip:ca', placeLabels: ['California, USA'] }),
      ],
      nowMs: 1000,
    });
    const ambiguous = wf.resumeContinuation({ pending, prompt: 'that one', nowMs: 2000 });
    assert.equal(ambiguous.status, 'needs_input');
    assert.match(ambiguous.text, /New York, USA/i);

    const expired = wf.resumeContinuation({
      pending,
      prompt: 'first one',
      nowMs: 1000 + strictWorkflowPendingTtlMs + 1,
    });
    assert.equal(expired.status, 'expired');
  });

  it('reuses the approved plan result on resumeApproval without re-calling the plan tool', async () => {
    const { client, calls } = createWorkflowClient();
    const candidate = makeTripCandidate();
    const outcome = await wf.resumeApproval({
      client,
      pending: { slots: { albumName: 'USA Trip', placeHint: 'USA' }, candidate },
      approvedPlanResult: { status: 'success', planId: tripPlanId },
    });
    assert.equal(outcome.status, 'planned');
    assert.equal(outcome.planId, tripPlanId);
    assert.equal(calls.length, 0); // approvedPlanResult short-circuits the plan call
  });

  // Ported legacy execution edge cases, now driven through the protocol object.

  it('returns needs_input when no candidates are found', async () => {
    const { client, calls } = createWorkflowClient({ recommendation: { action: 'none' }, candidates: [] });
    const outcome = await wf.run({ client, slots: { albumName: 'USA Trip', placeHint: 'USA' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(calls.map((c) => c.name).join(','), 'findTripCandidates');
    assert.match(outcome.text, /could not find a likely recent trip/i);
  });

  it('does not plan when the recommended candidate key is missing', async () => {
    const { client, calls } = createWorkflowClient({
      recommendation: { action: 'use_top_candidate', candidateDedupeKey: 'trip:missing' },
    });
    const outcome = await wf.run({ client, slots: { albumName: 'USA Trip', placeHint: 'USA' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(calls.map((c) => c.name).join(','), 'findTripCandidates');
    assert.match(outcome.text, /could not match/i);
  });

  it('does not call planning for a zero-asset candidate handle', async () => {
    const { client, calls } = createWorkflowClient({
      candidates: [makeTripCandidate({ selectionHandle: { id: tripCandidateHandleId, assetCount: 0 } })],
    });
    const outcome = await wf.run({ client, slots: { albumName: 'USA Trip', placeHint: 'USA' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(calls.map((c) => c.name).join(','), 'findTripCandidates');
    assert.match(outcome.text, /found no album-ready assets/i);
  });

  it('does not emit success copy when planning succeeds without a persisted plan id', async () => {
    const { client } = createWorkflowClient({
      planResult: { status: 'success', summary: 'Stored proposal but no id.' },
    });
    const outcome = await wf.run({ client, slots: { albumName: 'USA Trip', placeHint: 'USA' } });
    assert.equal(outcome.status, 'failed');
    assert.doesNotMatch(outcome.text, /Review the plan/i);
    assert.match(outcome.text, /could not create a reviewable album plan/i);
  });

  it('redacts credential-shaped planning errors before user-facing output', async () => {
    const { client } = createWorkflowClient({
      planResult: { status: 'denied', reason: 'Bearer other-secret api_key=raw-key raw denied detail' },
    });
    const outcome = await wf.run({ client, slots: { albumName: 'USA Trip', placeHint: 'USA' } });
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.text, /planning tool returned status "denied" for proposeAlbumFromSelection/i);
    assert.doesNotMatch(outcome.text, /other-secret|raw-key|raw denied detail/i);
  });

  it('returns safe failure text when planning throws', async () => {
    const { client } = createWorkflowClient({
      planError: new Error('Gallery MCP JSON-RPC error -32001: token [redacted] was rejected'),
    });
    const outcome = await wf.run({ client, slots: { albumName: 'USA Trip', placeHint: 'USA' } });
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.text, /\[redacted\]/);
    assert.doesNotMatch(outcome.text, /Review the plan/i);
  });
});
