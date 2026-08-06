import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { favoriteAssetsWorkflow } from './favorite-assets.mjs';
import { makeContractClient } from './contract-fixtures.mjs';

const wf = favoriteAssetsWorkflow();

describe('favorite_assets router & slots', () => {
  it('matches "favorite <source>" (and British spelling) with favorite:true', () => {
    assert.deepEqual(wf.match('favorite my last 10 photos'), {
      slots: { favorite: true, sourceDescription: 'my last 10 photos' },
    });
    assert.deepEqual(wf.match('favourite my newest 20 photos'), {
      slots: { favorite: true, sourceDescription: 'my newest 20 photos' },
    });
  });

  it('matches unfavorite / remove-favorite phrasings with favorite:false', () => {
    assert.deepEqual(wf.match('unfavorite my newest 5 photos'), {
      slots: { favorite: false, sourceDescription: 'my newest 5 photos' },
    });
    assert.deepEqual(wf.match('remove favorite from my newest 5'), {
      slots: { favorite: false, sourceDescription: 'my newest 5' },
    });
  });

  it('matches like / unlike polarity', () => {
    assert.deepEqual(wf.match('like my newest 10 photos'), {
      slots: { favorite: true, sourceDescription: 'my newest 10 photos' },
    });
    assert.deepEqual(wf.match('unlike my newest 10 photos'), {
      slots: { favorite: false, sourceDescription: 'my newest 10 photos' },
    });
  });

  it('declines a subjective source at the fast-path', () => {
    assert.equal(wf.match('favorite the best 3'), undefined);
  });

  it('does not match a mid-sentence "like"', () => {
    assert.equal(wf.match('I really like my photos'), undefined);
  });

  it('owns "add <source> to [my] favorites" (favorite, not an album add)', () => {
    assert.deepEqual(wf.match('add my newest 20 photos to my favorites'), {
      slots: { favorite: true, sourceDescription: 'my newest 20 photos' },
    });
    assert.deepEqual(wf.match('add my newest 20 photos to favorites'), {
      slots: { favorite: true, sourceDescription: 'my newest 20 photos' },
    });
  });

  it('does not steal "add <source> to my Favorites album" (that is an album add)', () => {
    assert.equal(wf.match('add my newest 20 to my Favorites album'), undefined);
  });

  it('strips trailing punctuation and rejects empty prompt', () => {
    assert.deepEqual(wf.match('favorite my photos.'), {
      slots: { favorite: true, sourceDescription: 'my photos' },
    });
    assert.equal(wf.match(''), undefined);
  });

  it('parseSlots passes a boolean polarity through and coerces LLM strings', () => {
    assert.deepEqual(wf.parseSlots({ favorite: true, sourceDescription: 'my newest 5' }), {
      favorite: true,
      sourceDescription: 'my newest 5',
    });
    assert.equal(wf.parseSlots({ favorite: 'unfavorite', sourceDescription: 'x' }).favorite, false);
    assert.equal(wf.parseSlots({ favorite: 'false', sourceDescription: 'x' }).favorite, false);
  });

  it('parseSlots defaults to favorite when polarity is omitted', () => {
    assert.equal(wf.parseSlots({ sourceDescription: 'my newest 5' }).favorite, true);
  });

  it('parseSlots rejects an empty or missing source', () => {
    assert.equal(wf.parseSlots({ favorite: true, sourceDescription: '  ' }), null);
    assert.equal(wf.parseSlots({ favorite: true }), null);
  });

  it('is a hybrid workflow with an executable run', () => {
    assert.equal(wf.kind, 'favorite_assets');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('favorite_assets execution', () => {
  it('plans a batch setFavorite over a recency selection handle (no raw ids)', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { favorite: true, sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.setFavorite', favorite: true });
    assert.equal(propose.args.selectionHandleId, 'handle-1');
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('carries unfavorite polarity into the op payload', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { favorite: false, sourceDescription: 'my newest 5' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.setFavorite', favorite: false });
  });

  it('hands off a subjective source without proposing', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { favorite: true, sourceDescription: 'the best ones' } });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'),
      false,
    );
  });

  it('asks for input when the source resolves to zero assets', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({ client, slots: { favorite: true, sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'),
      false,
    );
  });

  it('fails (gate) without success copy when the plan has no persisted id', async () => {
    const client = makeContractClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({ client, slots: { favorite: true, sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared|favorite /i.test(outcome.text), false);
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
    const outcome = await wf.run({ client, slots: { favorite: true, sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'failed');
  });
});
