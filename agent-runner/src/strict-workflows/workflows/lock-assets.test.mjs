import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lockAssetsWorkflow } from './lock-assets.mjs';
import { makeContractClient } from './contract-fixtures.mjs';

const wf = lockAssetsWorkflow();

describe('lock_assets router & slots', () => {
  it('matches "lock <source>" (LOCK_PATTERN)', () => {
    assert.deepEqual(wf.match('lock my passport scans'), {
      slots: { sourceDescription: 'my passport scans' },
    });
  });

  it('matches "lock <source>" without "my"', () => {
    assert.deepEqual(wf.match('lock the 2024 receipts'), {
      slots: { sourceDescription: 'the 2024 receipts' },
    });
  });

  it('matches "move <source> to the locked folder" (MOVE_TO_LOCKED)', () => {
    assert.deepEqual(wf.match('move my 2024 receipts to the locked folder'), {
      slots: { sourceDescription: 'my 2024 receipts' },
    });
  });

  it('matches "put <source> in my private folder" (MOVE_TO_LOCKED)', () => {
    assert.deepEqual(wf.match('put these in my private folder'), {
      slots: { sourceDescription: 'these' },
    });
  });

  it('matches "add <source> into the locked folder" (MOVE_TO_LOCKED)', () => {
    assert.deepEqual(wf.match('add my newest 5 photos into the locked folder'), {
      slots: { sourceDescription: 'my newest 5 photos' },
    });
  });

  it('matches "hide <source> in the locked folder" (HIDE_IN_LOCKED)', () => {
    assert.deepEqual(wf.match('hide these in the locked folder'), {
      slots: { sourceDescription: 'these' },
    });
  });

  it('matches "hide <source> in my private folder" (HIDE_IN_LOCKED)', () => {
    assert.deepEqual(wf.match('hide my passport photos in my private folder'), {
      slots: { sourceDescription: 'my passport photos' },
    });
  });

  it('DECLINES "archive these photos" — must not steal archive_assets', () => {
    assert.equal(wf.match('archive these photos'), undefined);
  });

  it('DECLINES "hide Alex" — no folder cue, must not steal hide_person', () => {
    assert.equal(wf.match('hide Alex'), undefined);
  });

  it('DECLINES "hide my friend Sam" — no folder cue', () => {
    assert.equal(wf.match('hide my friend Sam'), undefined);
  });

  it('DECLINES "lock the best ones" — subjective source', () => {
    assert.equal(wf.match('lock the best ones'), undefined);
  });

  it('DECLINES empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('strips trailing punctuation from the source', () => {
    assert.deepEqual(wf.match('lock my passport scans.'), {
      slots: { sourceDescription: 'my passport scans' },
    });
  });

  it('parseSlots passes sourceDescription through', () => {
    assert.deepEqual(wf.parseSlots({ sourceDescription: 'my passport scans' }), {
      sourceDescription: 'my passport scans',
    });
  });

  it('parseSlots rejects an empty or missing source', () => {
    assert.equal(wf.parseSlots({ sourceDescription: '   ' }), null);
    assert.equal(wf.parseSlots({}), null);
    assert.equal(wf.parseSlots(null), null);
  });

  it('is a hybrid workflow with an executable run', () => {
    assert.equal(wf.kind, 'lock_assets');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('lock_assets execution', () => {
  it('plans a batch setVisibility:locked over a recency selection handle (no raw ids)', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 50 photos' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.ok(propose, 'proposeAssetBatchFromSelection must be called');
    assert.deepEqual(propose.args.action, { type: 'asset.setVisibility', visibility: 'locked' });
    assert.equal(propose.args.selectionHandleId, 'handle-1');
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('plans a date source via the shared resolver (date filters)', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my photos from 2024' } });
    assert.equal(outcome.status, 'planned');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
    });
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

  it('asks for input when the source resolves to zero assets instead of planning an empty lock', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'),
      false,
    );
  });

  it('fails (gate) without success copy when the plan has no persisted id', async () => {
    const client = makeContractClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared|locked folder/i.test(outcome.text), false);
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

  it('fails when the propose tool throws', async () => {
    let searchDone = false;
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'searchAssets') {
          searchDone = true;
          return { selectionHandle: { id: 'handle-1', assetCount: 10 } };
        }
        if (name === 'resolveAssetSearchFilters') return { resolvedFilters: {} };
        if (name === 'proposeAssetBatchFromSelection') throw new Error('tool exploded');
        throw new Error(`unexpected ${name}`);
      },
    };
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'failed');
    assert.ok(searchDone, 'search should have been attempted');
  });

  it('plans an upload-date source (createdAfter, not takenAfter)', async () => {
    const NOW = new Date('2026-05-15T12:00:00.000Z');
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'everything I uploaded today' },
      now: NOW,
    });
    assert.equal(outcome.status, 'planned');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.ok(search, 'searchAssets must be called');
    assert.ok('createdAfter' in (search.args.filters ?? {}), 'filters must contain createdAfter');
    assert.equal('takenAfter' in (search.args.filters ?? {}), false);
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.setVisibility', visibility: 'locked' });
  });
});
