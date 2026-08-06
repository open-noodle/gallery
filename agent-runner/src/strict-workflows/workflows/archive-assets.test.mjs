import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { archiveAssetsWorkflow } from './archive-assets.mjs';
import { makeContractClient } from './contract-fixtures.mjs';

const wf = archiveAssetsWorkflow();

describe('archive_assets router & slots', () => {
  it('matches "archive <source>" with archived:true', () => {
    assert.deepEqual(wf.match('archive my newest 50 photos'), {
      slots: { archived: true, sourceDescription: 'my newest 50 photos' },
    });
  });

  it('matches "unarchive <source>" and "un-archive <source>" with archived:false', () => {
    assert.deepEqual(wf.match('unarchive my last 10 photos'), {
      slots: { archived: false, sourceDescription: 'my last 10 photos' },
    });
    assert.deepEqual(wf.match('un-archive my newest 5'), {
      slots: { archived: false, sourceDescription: 'my newest 5' },
    });
  });

  it('matches "move/take <source> out of [the] archive" with archived:false', () => {
    assert.deepEqual(wf.match('move my newest 20 photos out of archive'), {
      slots: { archived: false, sourceDescription: 'my newest 20 photos' },
    });
    assert.deepEqual(wf.match('take my 2024 photos out of the archive'), {
      slots: { archived: false, sourceDescription: 'my 2024 photos' },
    });
  });

  it('declines a subjective source at the fast-path', () => {
    assert.equal(wf.match('archive the best ones'), undefined);
  });

  it('does not match a non-archive verb (add to album)', () => {
    assert.equal(wf.match('add my newest 20 photos to Family'), undefined);
  });

  it('strips trailing punctuation from the source', () => {
    assert.deepEqual(wf.match('archive my photos.'), {
      slots: { archived: true, sourceDescription: 'my photos' },
    });
  });

  it('returns undefined for an empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('parseSlots passes a boolean polarity through from match', () => {
    assert.deepEqual(wf.parseSlots({ archived: true, sourceDescription: 'my newest 50 photos' }), {
      archived: true,
      sourceDescription: 'my newest 50 photos',
    });
  });

  it('parseSlots coerces LLM string polarity', () => {
    assert.equal(wf.parseSlots({ archived: 'unarchive', sourceDescription: 'my newest 5' }).archived, false);
    assert.equal(wf.parseSlots({ archived: 'false', sourceDescription: 'x' }).archived, false);
    assert.equal(wf.parseSlots({ archived: 'archive', sourceDescription: 'x' }).archived, true);
  });

  it('parseSlots defaults to archive when polarity is omitted', () => {
    assert.equal(wf.parseSlots({ sourceDescription: 'my newest 5' }).archived, true);
  });

  it('parseSlots rejects an empty or missing source', () => {
    assert.equal(wf.parseSlots({ archived: true, sourceDescription: '   ' }), null);
    assert.equal(wf.parseSlots({ archived: true }), null);
  });

  it('is a hybrid workflow with an executable run', () => {
    assert.equal(wf.kind, 'archive_assets');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('archive_assets execution', () => {
  it('plans a batch setArchive over a recency selection handle (no raw ids)', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { archived: true, sourceDescription: 'my newest 50 photos' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.setArchive', archived: true });
    assert.equal(propose.args.selectionHandleId, 'handle-1');
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('carries unarchive polarity into the op payload', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { archived: false, sourceDescription: 'my newest 5 photos' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.setArchive', archived: false });
  });

  it('plans a date source via the shared resolver (date filters)', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { archived: true, sourceDescription: 'my photos from 2024' } });
    assert.equal(outcome.status, 'planned');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
    });
  });

  it('hands off a subjective source without proposing', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { archived: true, sourceDescription: 'the best ones' } });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'),
      false,
    );
  });

  it('asks for input when the source resolves to zero assets instead of planning an empty archive', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({ client, slots: { archived: true, sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'),
      false,
    );
  });

  it('fails (gate) without success copy when the plan has no persisted id', async () => {
    const client = makeContractClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({ client, slots: { archived: true, sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared|archive /i.test(outcome.text), false);
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
    const outcome = await wf.run({ client, slots: { archived: true, sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'failed');
  });

  // Slice 3: upload source — "archive everything I uploaded today" must resolve
  // (not handoff) and the searchAssets call must carry createdAfter, not takenAfter.
  it('plans a batch archive for an upload-date source (createdAfter, not takenAfter)', async () => {
    const NOW = new Date('2026-05-15T12:00:00.000Z');
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { archived: true, sourceDescription: 'everything I uploaded today' },
      now: NOW,
    });
    assert.equal(outcome.status, 'planned');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.ok(search, 'searchAssets must be called');
    assert.ok('createdAfter' in (search.args.filters ?? {}), 'filters must contain createdAfter');
    assert.equal('takenAfter' in (search.args.filters ?? {}), false);
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.setArchive', archived: true });
  });
});
