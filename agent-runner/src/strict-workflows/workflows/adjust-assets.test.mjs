import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeContractClient } from './contract-fixtures.mjs';
import { adjustAssetsWorkflow } from './adjust-assets.mjs';

const wf = adjustAssetsWorkflow();
const slotsFor = (prompt) => wf.match(prompt)?.slots;

describe('adjust_assets identity', () => {
  it('has correct kind, flow, and run stub', () => {
    assert.equal(wf.kind, 'adjust_assets');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('adjust_assets match', () => {
  it('brighten → brightness moderate_increase + source', () => {
    const s = slotsFor('brighten my last 10 photos');
    assert.deepEqual(s.params, { brightness: 'moderate_increase' });
    assert.equal(s.sourceDescription, 'my last 10 photos');
  });

  it('darken a bit → brightness slight_decrease', () => {
    assert.deepEqual(slotsFor('darken these a bit').params, { brightness: 'slight_decrease' });
  });

  it('increase contrast a lot → contrast strong_increase', () => {
    assert.deepEqual(slotsFor('increase contrast a lot on these').params, { contrast: 'strong_increase' });
  });

  it('make X pop → saturation moderate_increase, source preserving original case', () => {
    const s = slotsFor('make my Berlin photos pop');
    assert.deepEqual(s.params, { saturation: 'moderate_increase' });
    assert.ok(/berlin photos/i.test(s.sourceDescription));
  });

  it('more vivid → saturation moderate_increase', () => {
    assert.deepEqual(slotsFor('make these more vivid').params, { saturation: 'moderate_increase' });
  });

  it('desaturate → saturation moderate_decrease', () => {
    assert.deepEqual(slotsFor('desaturate these').params, { saturation: 'moderate_decrease' });
  });

  it('auto-enhance → autoEnhance true', () => {
    assert.deepEqual(slotsFor('auto-enhance my newest 5').params, { autoEnhance: true });
    assert.deepEqual(slotsFor('fix the lighting on these').params, { autoEnhance: true });
  });

  it('combined brighten and add contrast → both fields', () => {
    const s = slotsFor('brighten my photos and add a bit of contrast');
    assert.equal(s.params.brightness, 'moderate_increase');
    assert.equal(s.params.contrast, 'moderate_increase');
  });

  it('does NOT match rotate/crop/flip verbs', () => {
    assert.equal(wf.match('rotate these 90 clockwise'), undefined);
    assert.equal(wf.match('crop my newest photo to 0,0,800,600'), undefined);
    assert.equal(wf.match('flip these horizontally'), undefined);
  });

  it('conflicting brighten and darken → matches but run() returns needs_input', async () => {
    const matched = wf.match('brighten and darken these');
    assert.ok(matched);
    const res = await wf.run({ client: {}, slots: matched.slots, signal: undefined });
    assert.equal(res.status, 'needs_input');
  });

  it('subjective source → no match', () => {
    assert.equal(wf.match('brighten the good ones'), undefined);
  });

  it('empty string → undefined', () => {
    assert.equal(wf.match(''), undefined);
  });
});

describe('adjust_assets parseSlots', () => {
  it('passes through valid params and sourceDescription', () => {
    const result = wf.parseSlots({ params: { brightness: 'moderate_increase' }, sourceDescription: 'my newest 20 photos' });
    assert.deepEqual(result, { params: { brightness: 'moderate_increase' }, sourceDescription: 'my newest 20 photos' });
  });

  it('conflict slots → { conflict: true }', () => {
    const result = wf.parseSlots({ conflict: true });
    assert.deepEqual(result, { conflict: true });
  });

  it('rejects missing sourceDescription → null', () => {
    assert.equal(wf.parseSlots({ params: { brightness: 'moderate_increase' } }), null);
  });

  it('rejects blank sourceDescription → null', () => {
    assert.equal(wf.parseSlots({ params: { brightness: 'moderate_increase' }, sourceDescription: '   ' }), null);
  });
});

describe('adjust_assets execution', () => {
  it('proposes asset.adjust with brightness:moderate_increase, selectionHandleId===handle-1', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { params: { brightness: 'moderate_increase' }, sourceDescription: 'my newest 20 photos' },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.adjust', brightness: 'moderate_increase' });
    assert.equal(propose.args.selectionHandleId, 'handle-1');
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('autoEnhance proposes { type:asset.adjust, autoEnhance:true }', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { params: { autoEnhance: true }, sourceDescription: 'my newest 5 photos' },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.adjust', autoEnhance: true });
  });

  it('date source: searchAssets filters takenAfter/takenBefore for 2024', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { params: { contrast: 'moderate_increase' }, sourceDescription: 'my 2024 photos' },
    });
    assert.equal(outcome.status, 'planned');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
    });
  });

  it('subjective source → handoff_open, propose NOT called', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { params: { brightness: 'moderate_increase' }, sourceDescription: 'the best ones' },
    });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'), false);
  });

  it('handleAssetCount:0 → needs_input, propose NOT called', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({
      client,
      slots: { params: { brightness: 'moderate_increase' }, sourceDescription: 'my newest 20 photos' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'), false);
  });

  it('gate: plan without persisted id → failed', async () => {
    const client = makeContractClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({
      client,
      slots: { params: { brightness: 'moderate_increase' }, sourceDescription: 'my newest 20 photos' },
    });
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
    const outcome = await wf.run({
      client,
      slots: { params: { brightness: 'moderate_increase' }, sourceDescription: 'my newest 20 photos' },
    });
    assert.equal(outcome.status, 'failed');
  });

  it('missing params → needs_input', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos' },
      signal: undefined,
    });
    assert.equal(outcome.status, 'needs_input');
  });

  it('missing sourceDescription → needs_input', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { params: { brightness: 'moderate_increase' } },
      signal: undefined,
    });
    assert.equal(outcome.status, 'needs_input');
  });
});
