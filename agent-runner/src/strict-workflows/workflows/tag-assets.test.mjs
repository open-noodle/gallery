import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tagAssetsWorkflow } from './tag-assets.mjs';
import { makeContractClient } from './contract-fixtures.mjs';

const wf = tagAssetsWorkflow();

describe('tag_assets router & slots (add-only)', () => {
  it('matches "tag <source> as <tag>"', () => {
    assert.deepEqual(wf.match('tag my newest 20 photos as Travel'), {
      slots: { sourceDescription: 'my newest 20 photos', tagName: 'Travel' },
    });
  });

  it('extracts a quoted multi-word tag', () => {
    assert.deepEqual(wf.match('tag my newest 20 as "Spring Break"'), {
      slots: { sourceDescription: 'my newest 20', tagName: 'Spring Break' },
    });
  });

  it('matches both "add the tag <tag> to <source>" and "add the <tag> tag to <source>"', () => {
    assert.deepEqual(wf.match('add the tag Travel to my newest 20 photos'), {
      slots: { sourceDescription: 'my newest 20 photos', tagName: 'Travel' },
    });
    assert.deepEqual(wf.match('add the Travel tag to my newest 20'), {
      slots: { sourceDescription: 'my newest 20', tagName: 'Travel' },
    });
  });

  it('does not match removal / untag phrasings (add-only)', () => {
    assert.equal(wf.match('remove the Travel tag from my newest 20'), undefined);
    assert.equal(wf.match('untag my newest 20 photos'), undefined);
  });

  it('declines a subjective source at the fast-path', () => {
    assert.equal(wf.match('tag the best ones as Travel'), undefined);
  });

  it('strips trailing punctuation and rejects empty prompt', () => {
    assert.deepEqual(wf.match('tag my photos as Travel.'), {
      slots: { sourceDescription: 'my photos', tagName: 'Travel' },
    });
    assert.equal(wf.match(''), undefined);
  });

  it('parseSlots passes valid slots through and strips quotes on the LLM path', () => {
    assert.deepEqual(wf.parseSlots({ sourceDescription: 'my newest 20', tagName: 'Travel' }), {
      sourceDescription: 'my newest 20',
      tagName: 'Travel',
    });
    assert.equal(wf.parseSlots({ sourceDescription: 'x', tagName: '"Spring Break"' }).tagName, 'Spring Break');
  });

  it('parseSlots rejects an empty tag or empty/missing source', () => {
    assert.equal(wf.parseSlots({ sourceDescription: 'x', tagName: '   ' }), null);
    assert.equal(wf.parseSlots({ sourceDescription: '  ', tagName: 'Travel' }), null);
    assert.equal(wf.parseSlots({ sourceDescription: 'x' }), null);
  });

  it('is a hybrid workflow with an executable run', () => {
    assert.equal(wf.kind, 'tag_assets');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('tag_assets execution', () => {
  it('plans a batch addTag over a recency handle with exactly one tag field (no raw ids)', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 20 photos', tagName: 'Travel' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.addTag', tagName: 'Travel' });
    assert.equal(propose.args.selectionHandleId, 'handle-1');
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('honors a multi-word tag', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 20', tagName: 'Spring Break' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.addTag', tagName: 'Spring Break' });
  });

  it('hands off a subjective source without proposing', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { sourceDescription: 'the best ones', tagName: 'Travel' } });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'),
      false,
    );
  });

  it('asks for input when the source resolves to zero assets', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 10 photos', tagName: 'Travel' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'),
      false,
    );
  });

  it('fails (gate) without success copy when the plan has no persisted id', async () => {
    const client = makeContractClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 10 photos', tagName: 'Travel' } });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared|tag /i.test(outcome.text), false);
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
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 10 photos', tagName: 'Travel' } });
    assert.equal(outcome.status, 'failed');
  });

  it('returns needs_input for an ambiguous source entity (no proposeAssetBatchFromSelection)', async () => {
    const client = makeContractClient({
      resolveResults: [
        { kind: 'person', query: 'Alex', status: 'ambiguous', choices: [{ value: 'a', label: 'Alex Smith' }, { value: 'b', label: 'Alex Jones' }], message: '' },
      ],
    });
    const outcome = await wf.run({ client, slots: { tagName: 'Family', sourceDescription: 'photos of Alex' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'), false);
  });
});
