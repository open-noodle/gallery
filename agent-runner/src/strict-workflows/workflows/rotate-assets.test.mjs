import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeContractClient } from './contract-fixtures.mjs';
import { rotateAssetsWorkflow } from './rotate-assets.mjs';

const wf = rotateAssetsWorkflow();

describe('rotate_assets identity', () => {
  it('has correct kind, flow, and run stub', () => {
    assert.equal(wf.kind, 'rotate_assets');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('rotate_assets match', () => {
  it('canonical: rotate newest 20 photos 90 clockwise', () => {
    assert.deepEqual(wf.match('rotate my newest 20 photos 90 clockwise'), {
      slots: { angle: 90, sourceDescription: 'my newest 20 photos' },
    });
  });

  it('counterclockwise: 90 ccw → angle 270', () => {
    const result = wf.match('rotate my last 10 photos 90 counterclockwise');
    assert.deepEqual(result, { slots: { angle: 270, sourceDescription: 'my last 10 photos' } });
  });

  it('180 degrees: angle 180', () => {
    const result = wf.match('rotate my 2024 photos 180');
    assert.deepEqual(result, { slots: { angle: 180, sourceDescription: 'my 2024 photos' } });
  });

  it('flip upside down: angle 180', () => {
    const result = wf.match('flip my newest 5 photos upside down');
    assert.deepEqual(result, { slots: { angle: 180, sourceDescription: 'my newest 5 photos' } });
  });

  it('no explicit angle (clockwise only) → undefined', () => {
    assert.equal(wf.match('rotate the sideways photos clockwise'), undefined);
  });

  it('subjective source → undefined', () => {
    assert.equal(wf.match('rotate the best ones 90 clockwise'), undefined);
  });

  it('bad angle (45) → undefined', () => {
    assert.equal(wf.match('rotate my newest 20 photos 45 clockwise'), undefined);
  });

  it('270 clockwise → angle 270', () => {
    const result = wf.match('rotate my newest 20 photos 270 clockwise');
    assert.deepEqual(result, { slots: { angle: 270, sourceDescription: 'my newest 20 photos' } });
  });

  it('90 anticlockwise → angle 270', () => {
    const result = wf.match('rotate my newest 20 photos 90 anticlockwise');
    assert.deepEqual(result, { slots: { angle: 270, sourceDescription: 'my newest 20 photos' } });
  });

  it('empty string → undefined', () => {
    assert.equal(wf.match(''), undefined);
  });
});

describe('rotate_assets parseSlots', () => {
  it('passes through valid numeric angle and sourceDescription', () => {
    assert.deepEqual(wf.parseSlots({ angle: 90, sourceDescription: 'my newest 20 photos' }), {
      angle: 90,
      sourceDescription: 'my newest 20 photos',
    });
  });

  it('coerces string angle "90" to number 90', () => {
    const result = wf.parseSlots({ angle: '90', sourceDescription: 'x' });
    assert.equal(result?.angle, 90);
  });

  it('coerces "counterclockwise" string to 270', () => {
    const result = wf.parseSlots({ angle: 'counterclockwise', sourceDescription: 'x' });
    assert.equal(result?.angle, 270);
  });

  it('rejects invalid angle 45 → null', () => {
    assert.equal(wf.parseSlots({ angle: 45, sourceDescription: 'x' }), null);
  });

  it('rejects missing angle → null', () => {
    assert.equal(wf.parseSlots({ sourceDescription: 'x' }), null);
  });

  it('rejects blank sourceDescription → null', () => {
    assert.equal(wf.parseSlots({ angle: 90, sourceDescription: '   ' }), null);
  });
});

describe('rotate_assets execution', () => {
  it('recency handle: action deepEquals { type:asset.rotate, angle:90 }, selectionHandleId===handle-1, no assetIds', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { angle: 90, sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.rotate', angle: 90 });
    assert.equal(propose.args.selectionHandleId, 'handle-1');
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('angle 270 carried through to action', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { angle: 270, sourceDescription: 'my last 10 photos' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.rotate', angle: 270 });
  });

  it('date source: searchAssets filters deepEquals takenAfter/takenBefore for 2024', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { angle: 90, sourceDescription: 'my 2024 photos' } });
    assert.equal(outcome.status, 'planned');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
    });
  });

  it('subjective source → handoff_open, propose NOT called', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { angle: 90, sourceDescription: 'the best ones' } });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'), false);
  });

  it('handleAssetCount:0 → needs_input, propose NOT called', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({ client, slots: { angle: 90, sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'), false);
  });

  it('gate: plan without persisted id → failed, no success copy', async () => {
    const client = makeContractClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({ client, slots: { angle: 90, sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared|rotate/i.test(outcome.text) && outcome.status === 'planned', false);
  });

  it('searchAssets throws → failed', async () => {
    const client = {
      calls: [],
      async call(name) {
        this.calls.push({ name });
        if (name === 'searchAssets') throw new Error('network error');
        throw new Error(`unexpected ${name}`);
      },
    };
    const outcome = await wf.run({ client, slots: { angle: 90, sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'failed');
  });
});
