import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { visualCleanupWorkflow } from './visual-cleanup.mjs';
import { makeContractClient } from './contract-fixtures.mjs';

const wf = visualCleanupWorkflow();

describe('visual_cleanup router', () => {
  it('matches blurry trash prompts and strips the quality adjective from the source', () => {
    const result = wf.match('trash my blurry photos');
    assert.ok(result);
    assert.deepEqual(result.slots, { qualityMetric: 'sharpness', sourceDescription: 'my photos' });
  });

  it('matches dark cleanup prompts with date scope', () => {
    const result = wf.match('delete dark photos from last month');
    assert.ok(result);
    assert.deepEqual(result.slots, { qualityMetric: 'brightness', sourceDescription: 'photos from last month' });
  });

  it('matches low-quality prompts with upload scope', () => {
    const result = wf.match('clean up low-quality photos from recent uploads');
    assert.ok(result);
    assert.deepEqual(result.slots, { qualityMetric: 'quality', sourceDescription: 'photos from recent uploads' });
  });

  it('matches remove prompts with a quality adjective and bounded source', () => {
    const result = wf.match('remove blurry photos from my last 100 uploaded photos');
    assert.ok(result);
    assert.deepEqual(result.slots, {
      qualityMetric: 'sharpness',
      sourceDescription: 'photos from my last 100 uploaded photos',
    });
  });

  it('does not steal plain trash prompts', () => {
    assert.equal(wf.match('trash my newest 20 photos'), undefined);
  });

  it('does not steal duplicate cleanup prompts', () => {
    assert.equal(wf.match('trash duplicate photos'), undefined);
    assert.equal(wf.match('clean up my duplicate photos'), undefined);
  });

  it('rejects purely subjective cleanup', () => {
    assert.equal(wf.match('delete the ugly ones'), undefined);
  });
});

describe('visual_cleanup parseSlots', () => {
  it('round-trips valid slots', () => {
    assert.deepEqual(wf.parseSlots({ qualityMetric: 'sharpness', sourceDescription: 'my newest 20 photos.' }), {
      qualityMetric: 'sharpness',
      sourceDescription: 'my newest 20 photos',
    });
  });

  it('returns null for missing or unsupported slots', () => {
    assert.equal(wf.parseSlots({ sourceDescription: 'my newest 20 photos' }), null);
    assert.equal(wf.parseSlots({ qualityMetric: 'pretty', sourceDescription: 'my newest 20 photos' }), null);
    assert.equal(wf.parseSlots({ qualityMetric: 'sharpness', sourceDescription: '' }), null);
  });
});

describe('visual_cleanup execution', () => {
  it('proposes asset.trash over a quality-filtered derivative of the bounded source handle', async () => {
    const client = makeContractClient({ handleAssetCounts: [20, 4] });
    const outcome = await wf.run({
      client,
      slots: { qualityMetric: 'sharpness', sourceDescription: 'my newest 20 photos' },
    });

    assert.equal(outcome.status, 'planned');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.equal(search.args.filters?.maxSharpness, undefined);
    assert.equal(search.args.limit, 20);

    const curate = client.calls.find((c) => c.name === 'curateSelection');
    assert.deepEqual(curate.args, {
      selectionHandleId: 'handle-1',
      targetCount: 20,
      strategy: 'metadata-highlights',
      constraints: { types: ['IMAGE'], maxSharpness: 20 },
      sampleSize: 0,
    });

    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.ok(propose);
    assert.equal(propose.args.operations.length, 1);
    assert.deepEqual(propose.args.operations[0], {
      type: 'asset.trash',
      summary: 'Move low-quality matching photos to Trash (recoverable).',
      targetKind: 'asset_batch',
      assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-2' },
      riskLevel: 'high',
    });
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('uses brightness threshold for dark prompts', async () => {
    const NOW = new Date('2026-05-15T12:00:00.000Z');
    const client = makeContractClient({ handleAssetCount: 3 });
    const outcome = await wf.run({
      client,
      slots: { qualityMetric: 'brightness', sourceDescription: 'photos from last month' },
      now: NOW,
    });

    assert.equal(outcome.status, 'planned');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.equal(search.args.filters.maxBrightness, undefined);
    assert.equal(search.args.filters.takenAfter, '2026-04-01T00:00:00.000Z');
    const curate = client.calls.find((c) => c.name === 'curateSelection');
    assert.equal(curate.args.constraints.maxBrightness, 30);
  });

  it('uses quality threshold for low-quality prompts', async () => {
    const client = makeContractClient({ handleAssetCount: 2 });
    const outcome = await wf.run({
      client,
      slots: { qualityMetric: 'quality', sourceDescription: 'photos from recent uploads' },
    });

    assert.equal(outcome.status, 'planned');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.equal(search.args.filters.maxQuality, undefined);
    assert.ok(search.args.filters.createdAfter);
    const curate = client.calls.find((c) => c.name === 'curateSelection');
    assert.equal(curate.args.constraints.maxQuality, 40);
  });

  it('asks for scope when the quality source is unbounded', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { qualityMetric: 'sharpness', sourceDescription: 'my photos' },
    });

    assert.equal(outcome.status, 'needs_input');
    assert.match(outcome.text, /scope|count|date/i);
    assert.deepEqual(outcome.continuation, { qualityMetric: 'sharpness' });
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('resumes a pending blurry cleanup with a user-provided upload scope', async () => {
    const resolved = wf.resumeContinuation({
      pending: { qualityMetric: 'sharpness' },
      prompt: 'uploaded in the last 6 months',
      nowMs: new Date('2026-05-15T12:00:00.000Z').getTime(),
    });

    assert.deepEqual(resolved, {
      status: 'matched',
      ctx: {
        slots: { qualityMetric: 'sharpness', sourceDescription: 'uploaded in the last 6 months' },
        now: new Date('2026-05-15T12:00:00.000Z'),
      },
    });
  });

  it('asks for scope instead of handing all-library cleanup to open orchestration', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { qualityMetric: 'sharpness', sourceDescription: 'all photos from my library' },
    });

    assert.equal(outcome.status, 'needs_input');
    assert.match(outcome.text, /scope|count|date|album|tag/i);
    assert.deepEqual(outcome.continuation, { qualityMetric: 'sharpness' });
    assert.equal(client.calls.length, 0);
  });

  it('returns needs_input when no low-quality matches are found', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({
      client,
      slots: { qualityMetric: 'sharpness', sourceDescription: 'my newest 20 photos' },
    });

    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('returns actionable needs_input when the session cannot trash assets', async () => {
    const client = makeContractClient({ handleAssetCount: 4 });
    client.call = async (name, args) => {
      client.calls.push({ name, args });
      if (name === 'proposeAlbumOperations') {
        throw new Error('Agent permission policy does not allow moving assets to trash');
      }
      return { selectionHandle: { id: 'handle-1', assetCount: 4 }, assets: [] };
    };

    const outcome = await wf.run({
      client,
      slots: { qualityMetric: 'sharpness', sourceDescription: 'my newest 20 photos' },
    });

    assert.equal(outcome.status, 'needs_input');
    assert.match(outcome.text, /Visual organizer|trash permission/i);
  });
});
