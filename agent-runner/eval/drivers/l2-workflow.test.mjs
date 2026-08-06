import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PLAN_ID } from '../fixtures/dataset.mjs';
import { createL2Driver, findRawAssetIdLeak } from './l2-workflow.mjs';

// Forces a specific routing decision without a model. The regex classifier
// handles most prompts; this is for the cases it would decline.
const stubClassifier = (kind, slots = {}) => ({
  calls: 0,
  classify(prompt) {
    this.calls += 1;
    return { kind, slots, via: 'stub', confidence: 'high' };
  },
});

describe('L2 driver — planned arm', () => {
  it('routes, calls the real tools in order, and reports the plan', async () => {
    const driver = createL2Driver();
    const decision = await driver.classify('rename my Japan album to Japan 2026');

    assert.equal(decision.kind, 'rename_or_describe_album');
    assert.deepEqual(decision.toolSequence, ['listAlbums', 'proposeAlbumOperations']);
    assert.equal(decision.outcomeStatus, 'planned');
    assert.equal(decision.planProposed, true);
    assert.equal(decision.planId, PLAN_ID);
    assert.deepEqual(
      decision.planOps.map((op) => op.type),
      ['album.updateDetails'],
    );
    assert.equal(decision.handled, true);
    assert.match(decision.text, /Review the plan/);
  });
});

describe('L2 driver — needs_input arm', () => {
  it('asks instead of guessing when two albums share a name', async () => {
    const driver = createL2Driver();
    const decision = await driver.classify('rename my Summer album to Summer 2026');

    assert.equal(decision.outcomeStatus, 'needs_input');
    assert.equal(decision.planProposed, false);
    assert.equal(decision.planId, null);
    assert.deepEqual(decision.toolSequence, ['listAlbums']);
    assert.match(decision.text, /Multiple albums/);
  });

  it('asks when no album matches', async () => {
    const driver = createL2Driver();
    const decision = await driver.classify('rename my Atlantis album to Atlantis 2026');

    assert.equal(decision.outcomeStatus, 'needs_input');
    assert.equal(decision.planProposed, false);
  });
});

describe('L2 driver — failed arm', () => {
  it('reports failure with no success language when the plan tool throws', async () => {
    const driver = createL2Driver({ overrides: { proposeAlbumOperations: new Error('planning exploded') } });
    const decision = await driver.classify('rename my Japan album to Japan 2026');

    assert.equal(decision.outcomeStatus, 'failed');
    assert.equal(decision.planProposed, false);
    assert.doesNotMatch(decision.text, /I prepared a plan/);
  });

  it('treats a plan result with no plan id as failed, not planned', async () => {
    const driver = createL2Driver({ overrides: { proposeAlbumOperations: { status: 'success' } } });
    const decision = await driver.classify('rename my Japan album to Japan 2026');

    assert.equal(decision.outcomeStatus, 'failed');
    assert.equal(decision.planId, null);
  });
});

describe('L2 driver — handoff_open arm', () => {
  it('declines and proposes nothing when there is nothing to clean up', async () => {
    const driver = createL2Driver({ overrides: { listDuplicateGroups: { status: 'success', groups: [] } } });
    const decision = await driver.classify('clean up duplicates');

    assert.equal(decision.outcomeStatus, 'handoff_open');
    assert.equal(decision.planProposed, false);
    assert.equal(decision.handled, false);
  });
});

describe('L2 driver — negatives', () => {
  it('routes a greeting via the chatter short-circuit WITHOUT calling the classifier', async () => {
    const classifier = stubClassifier('rename_or_describe_album');
    const driver = createL2Driver({ classifier });
    const decision = await driver.classify('thanks!');

    assert.equal(decision.kind, 'none');
    assert.equal(decision.via, 'chatter');
    assert.deepEqual(decision.toolSequence, []);
    assert.equal(classifier.calls, 0, 'chatter must bypass the classifier entirely');
  });

  it('returns kind none and calls no tools for an unsupported request', async () => {
    const driver = createL2Driver();
    const decision = await driver.classify('what is the weather like today?');

    assert.equal(decision.kind, 'none');
    assert.deepEqual(decision.toolSequence, []);
    assert.equal(decision.planProposed, false);
  });

  it('falls through when the classifier proposes a kind but parseSlots rejects it', async () => {
    // rename_or_describe_album's parseSlots returns null with neither a new name
    // nor a description, so the router must decline rather than execute.
    const driver = createL2Driver({ classifier: stubClassifier('rename_or_describe_album', { albumRef: 'Japan' }) });
    const decision = await driver.classify('do something with Japan');

    assert.equal(decision.handled, false);
    assert.equal(decision.planProposed, false);
    assert.deepEqual(decision.toolSequence, []);
  });
});

describe('L2 driver — isolation', () => {
  it('does not leak recorded calls between classify() invocations', async () => {
    const driver = createL2Driver();
    await driver.classify('rename my Japan album to Japan 2026');
    const second = await driver.classify('rename my Japan album to Japan 2026');
    assert.deepEqual(second.toolSequence, ['listAlbums', 'proposeAlbumOperations']);
  });
});

describe('findRawAssetIdLeak — the invariant must be able to fail', () => {
  it('detects a raw assetIds array in a plan-tool argument', () => {
    const calls = [{ name: 'proposeAlbumOperations', args: { operations: [{ assetIds: ['a', 'b'] }] } }];
    assert.match(findRawAssetIdLeak(calls) ?? '', /assetIds/);
  });

  it('detects a nested leak', () => {
    const calls = [{ name: 'proposeAlbumFromSelection', args: { deep: { nested: { assetIds: ['a'] } } } }];
    assert.notEqual(findRawAssetIdLeak(calls), null);
  });

  it('ignores an empty assetIds array', () => {
    const calls = [{ name: 'proposeAlbumOperations', args: { assetIds: [] } }];
    assert.equal(findRawAssetIdLeak(calls), null);
  });

  it('ignores assetIds passed to a READ tool', () => {
    const calls = [{ name: 'readAssetMetadata', args: { assetIds: ['a'] } }];
    assert.equal(findRawAssetIdLeak(calls), null);
  });

  it('passes a compliant selection-handle plan call', () => {
    const calls = [{ name: 'proposeAlbumFromSelection', args: { albumName: 'X', selectionHandleId: 'h-1' } }];
    assert.equal(findRawAssetIdLeak(calls), null);
  });
});

describe('L2 driver — the invariant is wired into every plan scenario', () => {
  it('fails a decision whose plan call leaked raw asset ids', async () => {
    const driver = createL2Driver({
      overrides: {
        // Echo a leaky arg back through the recorded call by having the plan
        // tool succeed while the workflow's args are inspected.
        proposeAlbumOperations: (args) => {
          args.assetIds = ['leaked-1'];
          return { status: 'success', plan: { id: PLAN_ID } };
        },
      },
    });
    const decision = await driver.classify('rename my Japan album to Japan 2026');
    assert.match(decision.rawAssetIdLeak ?? '', /assetIds/);
  });
});
