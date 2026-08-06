import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { approvalRequired, failed, handoffOpen, needsInput, planned } from './protocol.mjs';

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

  it('omits continuation on needs_input when none is provided', () => {
    const outcome = needsInput({ text: 'pick' });
    assert.equal('continuation' in outcome, false);
  });

  it('passes through extra fields on planned outcomes', () => {
    const outcome = planned({
      text: 'ok',
      planId: 'plan-1',
      successSummary: { workflowKind: 'create_recent_trip_album' },
      extra: { candidate: { dedupeKey: 'a' }, assetCount: 28 },
    });
    assert.deepEqual(outcome.candidate, { dedupeKey: 'a' });
    assert.equal(outcome.assetCount, 28);
  });

  it('carries the tool call id and continuation on approval_required', () => {
    const outcome = approvalRequired({ toolCallId: 'tc-9', continuation: { slots: { albumName: 'X' } } });
    assert.equal(outcome.toolCallId, 'tc-9');
    assert.deepEqual(outcome.continuation, { slots: { albumName: 'X' } });
  });

  it('carries the reason on handoff_open', () => {
    const outcome = handoffOpen({ reason: 'subjective source' });
    assert.equal(outcome.reason, 'subjective source');
  });
});
