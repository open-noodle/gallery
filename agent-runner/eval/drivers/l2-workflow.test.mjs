import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALBUM_JAPAN_ID, PLAN_ID } from '../fixtures/dataset.mjs';
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
    // Pins the op to the Japan album specifically — "Japan" happens to be
    // index 0 in the seeded dataset, so a bug that always resolved albums[0]
    // would otherwise pass this test undetected.
    assert.equal(decision.planOps[0]?.targetId, ALBUM_JAPAN_ID);
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
    // No override needed: the seeded DATASET's duplicate groups ('dup-1',
    // 'dup-2') carry only an assetCount, no `assets` array, so
    // cleanup-duplicates.mjs treats every group as having zero keepable
    // assets and hands off with "nothing to trash" on its own. An override
    // repeating `{ status: 'success', groups: [] }` here would be redundant —
    // it would exercise a different handoff branch (no groups at all) but
    // assert exactly the same outward shape, so it would prove nothing this
    // default doesn't already prove.
    const driver = createL2Driver();
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
  it('detects a raw assetIds array in a handle-based plan-tool argument', () => {
    const calls = [{ name: 'proposeAssetBatchFromSelection', args: { operations: [{ assetIds: ['a', 'b'] }] } }];
    assert.match(findRawAssetIdLeak(calls) ?? '', /assetIds/);
  });

  it('detects a nested leak', () => {
    const calls = [{ name: 'proposeAlbumFromSelection', args: { deep: { nested: { assetIds: ['a'] } } } }];
    assert.notEqual(findRawAssetIdLeak(calls), null);
  });

  it('ignores an empty assetIds array', () => {
    const calls = [{ name: 'proposeAssetBatchFromSelection', args: { assetIds: [] } }];
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

  it('does NOT flag proposeAlbumOperations even when it legitimately carries assetIds', () => {
    // Real production workflows pass a materialised assetIds array as an
    // operation payload on proposeAlbumOperations: set-album-cover.mjs's
    // album.setCover and cleanup-duplicates.mjs's asset.trash. That is
    // correct by design (ids are already materialised server-side by the
    // time these workflows run) and must never be reported as a leak.
    const calls = [
      {
        name: 'proposeAlbumOperations',
        args: { operations: [{ type: 'album.setCover', assetIds: ['cover-1'] }] },
      },
    ];
    assert.equal(findRawAssetIdLeak(calls), null);
  });
});

describe('L2 driver — the invariant is wired into every plan scenario', () => {
  it('fails a decision whose plan call leaked raw asset ids', async () => {
    const driver = createL2Driver({
      overrides: {
        // Echo a leaky arg back through the recorded call by having the plan
        // tool succeed while the workflow's args are inspected. Uses
        // create_album_from_source (proposeAlbumFromSelection is a
        // handle-based tool the leak scan actually covers) rather than
        // rename_or_describe_album's proposeAlbumOperations, which is exempt.
        proposeAlbumFromSelection: (args) => {
          args.assetIds = ['leaked-1'];
          return { status: 'success', plan: { id: PLAN_ID } };
        },
      },
    });
    const decision = await driver.classify('make an album from my newest 20 photos called Test');
    assert.equal(decision.outcomeStatus, 'planned');
    assert.match(decision.rawAssetIdLeak ?? '', /assetIds/);
  });

  it('does not fail a planned rename even though proposeAlbumOperations carries assetIds internally', async () => {
    // set-album-cover / cleanup-duplicates route through proposeAlbumOperations
    // with a real assetIds payload. Simulate that shape on the rename workflow's
    // own plan call to prove the invariant does not fail a scenario just because
    // the exempted tool happens to carry an assetIds array.
    const driver = createL2Driver({
      overrides: {
        proposeAlbumOperations: (args) => {
          args.assetIds = ['materialised-server-side'];
          return { status: 'success', plan: { id: PLAN_ID } };
        },
      },
    });
    const decision = await driver.classify('rename my Japan album to Japan 2026');
    assert.equal(decision.outcomeStatus, 'planned');
    assert.equal(decision.rawAssetIdLeak, null);
  });
});

describe('L2 driver — copy helpers', () => {
  const summary = { label: 'Portugal', dateRange: 'May 3–12', albumName: 'Portugal Trip', assetCount: 84 };

  it('polishCopy renders a non-empty string from a success summary', async () => {
    const driver = createL2Driver();
    const text = await driver.polishCopy(summary);
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0, 'polishCopy must not return an empty string');
  });

  it('templateCopy renders a non-empty string from a success summary', async () => {
    const driver = createL2Driver();
    const text = await driver.templateCopy(summary);
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0, 'templateCopy must not return an empty string');
  });
});
