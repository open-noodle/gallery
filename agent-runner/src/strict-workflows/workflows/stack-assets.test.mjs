import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stackAssetsWorkflow } from './stack-assets.mjs';
import { makeContractClient } from './contract-fixtures.mjs';

const wf = stackAssetsWorkflow();

describe('stack_assets router & slots', () => {
  it('matches "stack <source>"', () => {
    assert.deepEqual(wf.match('stack my newest 10 photos'), {
      slots: { sourceDescription: 'my newest 10 photos' },
    });
  });

  it('matches "stack <source> into a stack"', () => {
    assert.deepEqual(wf.match('stack my photos from 2024 into a stack'), {
      slots: { sourceDescription: 'my photos from 2024' },
    });
  });

  it('matches "group <source> into a stack"', () => {
    assert.deepEqual(wf.match('group my newest 5 photos into a stack'), {
      slots: { sourceDescription: 'my newest 5 photos' },
    });
  });

  it('declines a subjective source at the fast-path', () => {
    assert.equal(wf.match('stack the best ones'), undefined);
  });

  it('does not match a non-stack verb', () => {
    assert.equal(wf.match('archive my newest 20 photos'), undefined);
  });

  it('does not match "group" without "into a stack"', () => {
    assert.equal(wf.match('group my photos by date'), undefined);
  });

  it('strips trailing punctuation from the source', () => {
    assert.deepEqual(wf.match('stack my photos.'), {
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
    assert.equal(wf.kind, 'stack_assets');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('stack_assets execution', () => {
  it('plans a batch stack over a recency selection handle (no raw ids)', async () => {
    const client = makeContractClient({ handleAssetCount: 20 });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.stack' });
    assert.equal(propose.args.selectionHandleId, 'handle-1');
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('asks for input when assetCount is less than 2', async () => {
    const client = makeContractClient({ handleAssetCount: 1 });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 1 photo' } });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(/at least two/i.test(outcome.text), `expected "at least two" in: ${outcome.text}`);
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'),
      false,
    );
  });

  it('asks for input when assetCount is zero', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 10 photos' } });
    // empty result path (not a <2 gate)
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
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 20 photos' } });
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

  it('success text discloses the cover-selection rule', async () => {
    const client = makeContractClient({ handleAssetCount: 5 });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 5 photos' } });
    assert.equal(outcome.status, 'planned');
    assert.ok(
      /favorite|highest.rated|stack cover/i.test(outcome.text),
      `expected cover rule mention in: ${outcome.text}`,
    );
  });
});
