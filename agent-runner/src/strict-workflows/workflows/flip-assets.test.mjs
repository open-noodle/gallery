import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeContractClient } from './contract-fixtures.mjs';
import { flipAssetsWorkflow } from './flip-assets.mjs';

const wf = flipAssetsWorkflow();
const slotsFor = (p) => wf.match(p)?.slots;

describe('flip_assets identity', () => {
  it('has correct kind, flow, and run stub', () => {
    assert.equal(wf.kind, 'flip_assets');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('flip_assets match', () => {
  it('flip horizontally → axis horizontal', () => {
    assert.equal(slotsFor('flip this horizontally').axis, 'horizontal');
  });

  it('mirror → axis horizontal (default)', () => {
    assert.equal(slotsFor('mirror these').axis, 'horizontal');
  });

  it('flip vertically → axis vertical', () => {
    assert.equal(slotsFor('flip these vertically').axis, 'vertical');
  });

  it('flip (no axis) → horizontal default', () => {
    assert.equal(slotsFor('flip my newest 5 photos').axis, 'horizontal');
  });

  it('does NOT steal "upside down" (rotate owns it)', () => {
    assert.equal(wf.match('flip my photos upside down'), undefined);
  });

  it('does NOT match rotate/crop', () => {
    assert.equal(wf.match('rotate this 90'), undefined);
    assert.equal(wf.match('crop this to 0,0,10,10'), undefined);
  });

  it('subjective source → no match', () => {
    assert.equal(wf.match('flip the good ones'), undefined);
  });

  it('empty string → undefined', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('extracts source correctly', () => {
    const s = slotsFor('flip my newest 20 photos horizontally');
    assert.equal(s.axis, 'horizontal');
    assert.equal(s.sourceDescription, 'my newest 20 photos');
  });

  it('top-to-bottom → axis vertical', () => {
    assert.equal(slotsFor('flip these top-to-bottom').axis, 'vertical');
  });
});

describe('flip_assets parseSlots', () => {
  it('passes through valid axis and sourceDescription', () => {
    const result = wf.parseSlots({ axis: 'vertical', sourceDescription: 'my newest 20 photos' });
    assert.deepEqual(result, { axis: 'vertical', sourceDescription: 'my newest 20 photos' });
  });

  it('defaults axis to horizontal when missing', () => {
    const result = wf.parseSlots({ sourceDescription: 'my newest 20 photos' });
    assert.equal(result?.axis, 'horizontal');
  });

  it('rejects missing sourceDescription → null', () => {
    assert.equal(wf.parseSlots({ axis: 'horizontal' }), null);
  });

  it('rejects blank sourceDescription → null', () => {
    assert.equal(wf.parseSlots({ axis: 'horizontal', sourceDescription: '   ' }), null);
  });
});

describe('flip_assets execution', () => {
  it('proposes asset.flip with axis:horizontal, selectionHandleId===handle-1', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { axis: 'horizontal', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.flip', axis: 'horizontal' });
    assert.equal(propose.args.selectionHandleId, 'handle-1');
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('axis vertical carried through to action', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { axis: 'vertical', sourceDescription: 'my last 10 photos' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.flip', axis: 'vertical' });
  });

  it('subjective source → handoff_open, propose NOT called', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { axis: 'horizontal', sourceDescription: 'the best ones' } });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'), false);
  });

  it('handleAssetCount:0 → needs_input, propose NOT called', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({ client, slots: { axis: 'horizontal', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'), false);
  });

  it('gate: plan without persisted id → failed', async () => {
    const client = makeContractClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({ client, slots: { axis: 'horizontal', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'failed');
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
    const outcome = await wf.run({ client, slots: { axis: 'horizontal', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'failed');
  });

  it('missing sourceDescription → needs_input', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { axis: 'horizontal' }, signal: undefined });
    assert.equal(outcome.status, 'needs_input');
  });
});
