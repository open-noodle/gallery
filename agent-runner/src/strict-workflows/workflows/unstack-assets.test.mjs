import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { unstackAssetsWorkflow } from './unstack-assets.mjs';
import { makeContractClient } from './contract-fixtures.mjs';

const wf = unstackAssetsWorkflow();

describe('unstack_assets router & slots', () => {
  it('matches "unstack <source>"', () => {
    assert.deepEqual(wf.match('unstack my newest 10 photos'), {
      slots: { sourceDescription: 'my newest 10 photos' },
    });
  });

  it('matches "un-stack <source>"', () => {
    assert.deepEqual(wf.match('un-stack my photos from 2024'), {
      slots: { sourceDescription: 'my photos from 2024' },
    });
  });

  it('matches "ungroup <source>"', () => {
    assert.deepEqual(wf.match('ungroup my newest 5 photos'), {
      slots: { sourceDescription: 'my newest 5 photos' },
    });
  });

  it('declines a subjective source at the fast-path', () => {
    assert.equal(wf.match('unstack the best ones'), undefined);
  });

  it('does not match a non-unstack verb', () => {
    assert.equal(wf.match('stack my newest 20 photos'), undefined);
    assert.equal(wf.match('archive my newest 20 photos'), undefined);
  });

  it('strips trailing punctuation from the source', () => {
    assert.deepEqual(wf.match('unstack my photos.'), {
      slots: { sourceDescription: 'my photos' },
    });
  });

  it('returns undefined for an empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('parseSlots passes a source description through', () => {
    assert.deepEqual(wf.parseSlots({ sourceDescription: 'my newest 10 photos' }), {
      sourceDescription: 'my newest 10 photos',
    });
  });

  it('parseSlots rejects an empty or missing source', () => {
    assert.equal(wf.parseSlots({ sourceDescription: '   ' }), null);
    assert.equal(wf.parseSlots({}), null);
    assert.equal(wf.parseSlots(null), null);
  });

  it('is a hybrid workflow with an executable run', () => {
    assert.equal(wf.kind, 'unstack_assets');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('unstack_assets execution', () => {
  it('plans a batch unstack over a recency selection handle (no raw ids)', async () => {
    const client = makeContractClient({ handleAssetCount: 10 });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.unstack' });
    assert.equal(propose.args.selectionHandleId, 'handle-1');
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('does not require a minimum asset count (single asset is fine)', async () => {
    const client = makeContractClient({ handleAssetCount: 1 });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 1 photo' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.unstack' });
  });

  it('asks for input when the source resolves to zero assets', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'),
      false,
    );
  });

  it('hands off a subjective source without proposing', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { sourceDescription: 'the best ones' } });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'),
      false,
    );
  });

  it('fails (gate) without success copy when the plan has no persisted id', async () => {
    const client = makeContractClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'failed');
  });

  it('fails when the search tool throws', async () => {
    const client = {
      calls: [],
      async call(name) {
        this.calls.push({ name });
        if (name === 'searchAssets') throw new Error('boom');
        throw new Error(`unexpected ${name}`);
      },
    };
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'failed');
  });
});
