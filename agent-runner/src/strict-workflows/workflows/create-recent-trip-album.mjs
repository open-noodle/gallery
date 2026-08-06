import {
  createRecentTripCandidateSelectionState,
  matchStrictWorkflow,
  normalizeAlbumNameSlot,
  normalizePlaceHintSlot,
  resolveRecentTripCandidateSelection,
  runCreateRecentTripAlbumCandidateWorkflow,
  runCreateRecentTripAlbumWorkflow,
} from '../../strict-workflows.mjs';

const KIND = 'create_recent_trip_album';

const slotsToWorkflow = (slots) => {
  const workflow = { kind: KIND, albumName: slots.albumName };
  if (slots.placeHint) {
    workflow.placeHint = slots.placeHint;
  }
  return workflow;
};

export const createRecentTripAlbumWorkflow = () => ({
  kind: KIND,
  flow: 'strict',

  match(prompt) {
    const matched = matchStrictWorkflow(prompt);
    if (matched.kind !== KIND) {
      return undefined;
    }
    const slots = { albumName: matched.albumName };
    if (matched.placeHint) {
      slots.placeHint = matched.placeHint;
    }
    return { slots };
  },

  parseSlots(rawSlots) {
    const albumName = normalizeAlbumNameSlot(rawSlots?.albumName);
    const placeHint = normalizePlaceHintSlot(rawSlots?.placeHint);
    if (!albumName && !placeHint) {
      return null;
    }
    const slots = { albumName: albumName ?? (placeHint ? `${placeHint} Trip` : 'Recent Trip') };
    if (placeHint) {
      slots.placeHint = placeHint;
    }
    return slots;
  },

  // Single run entry. Per the spec, the continuation-resolved path reuses run()
  // with ctx.candidate set — there is no separate run_continuation_candidate.
  async run({ client, slots, candidate, approvedPlanResult, signal, nowMs }) {
    const workflow = slotsToWorkflow(slots);
    const result = candidate
      ? await runCreateRecentTripAlbumCandidateWorkflow({ client, workflow, candidate, approvedPlanResult, signal })
      : await runCreateRecentTripAlbumWorkflow({ client, workflow, approvedPlanResult, signal });
    return this.normalizeOutcome(result, { slots, nowMs });
  },

  // Attach a dispatcher-storable `continuation` to the outcomes that need one,
  // so the dispatcher can stay workflow-agnostic (`pendingWorkflow = outcome.continuation`).
  normalizeOutcome(result, { slots, nowMs }) {
    if (result.status === 'needs_input' && Array.isArray(result.candidates) && result.candidates.length > 0) {
      return { ...result, continuation: this.buildContinuation({ slots, candidates: result.candidates, nowMs }) };
    }
    if (result.status === 'approval_required') {
      return { ...result, continuation: { slots, candidate: result.candidate } };
    }
    return result; // planned | failed | needs_input-without-candidates pass through unchanged
  },

  buildContinuation({ slots, candidates, nowMs }) {
    return createRecentTripCandidateSelectionState({ workflow: slotsToWorkflow(slots), candidates, nowMs });
  },

  resumeContinuation({ pending, prompt, nowMs }) {
    const resolved = resolveRecentTripCandidateSelection({ pending, prompt, nowMs });
    if (resolved.status !== 'matched') {
      return resolved; // { status: 'needs_input' | 'expired' | 'missing', text }
    }
    const slots = { albumName: resolved.workflow.albumName };
    if (resolved.workflow.placeHint) {
      slots.placeHint = resolved.workflow.placeHint;
    }
    return { status: 'matched', ctx: { slots, candidate: resolved.candidate } };
  },

  // Approve-only: the dispatcher handles the denial branch generically and only
  // invokes resumeApproval on approval. pending carries { slots, candidate }.
  resumeApproval({ client, pending, approvedPlanResult, signal }) {
    return this.run({ client, slots: pending.slots, candidate: pending.candidate, approvedPlanResult, signal });
  },
});
