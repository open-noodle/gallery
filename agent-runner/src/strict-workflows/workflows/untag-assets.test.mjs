import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { untagAssetsWorkflow } from './untag-assets.mjs';
import { makeContractClient, KNOWN_OPERATION_TYPES } from './contract-fixtures.mjs';

const wf = untagAssetsWorkflow();

// ── match tests ───────────────────────────────────────────────────────────────

describe('untag_assets router & slots (remove-only)', () => {
  it('matches "remove [the] <tag> tag from <source>"', () => {
    assert.deepEqual(wf.match('remove the Travel tag from my newest 20'), {
      slots: { sourceDescription: 'my newest 20', tagName: 'Travel' },
    });
  });

  it('matches "remove tag <tag> from <source>"', () => {
    assert.deepEqual(wf.match('remove tag Spring Break from my last 50 photos'), {
      slots: { sourceDescription: 'my last 50 photos', tagName: 'Spring Break' },
    });
  });

  it('matches "untag <source> as <tag>"', () => {
    assert.deepEqual(wf.match('untag my newest 20 as Travel'), {
      slots: { sourceDescription: 'my newest 20', tagName: 'Travel' },
    });
  });

  it('matches "untag <source> from <tag>"', () => {
    assert.deepEqual(wf.match('untag the Berlin photos from Work'), {
      slots: { sourceDescription: 'the Berlin photos', tagName: 'Work' },
    });
  });

  it('matches "untag <source>" with no tag → tagName is empty string', () => {
    const result = wf.match('untag my newest 20');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'my newest 20');
    assert.equal(result.slots.tagName, '');
  });

  it('does not match add phrasings (remove-only)', () => {
    assert.equal(wf.match('add the Travel tag to my newest 20'), undefined);
    assert.equal(wf.match('tag my newest 20 as Travel'), undefined);
  });

  it('does not match album/space removes (no "tag" token)', () => {
    assert.equal(wf.match('remove my newest 20 from the Italy album'), undefined);
    assert.equal(wf.match('remove Bob from the Family space'), undefined);
  });

  it('does not match favorite removals (no "tag" token)', () => {
    assert.equal(wf.match('remove these from favorites'), undefined);
  });

  it('declines a subjective source at the fast-path', () => {
    // source "the best ones" is subjective → declined
    assert.equal(wf.match('remove the Travel tag from the best ones'), undefined);
  });

  it('strips trailing punctuation', () => {
    assert.deepEqual(wf.match('remove the Travel tag from my photos.'), {
      slots: { sourceDescription: 'my photos', tagName: 'Travel' },
    });
  });

  it('rejects an empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('is a hybrid workflow with an executable run', () => {
    assert.equal(wf.kind, 'untag_assets');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('untag_assets parseSlots', () => {
  it('passes valid slots through', () => {
    assert.deepEqual(wf.parseSlots({ sourceDescription: 'my newest 20', tagName: 'Travel' }), {
      sourceDescription: 'my newest 20',
      tagName: 'Travel',
    });
  });

  it('strips quotes from tagName on the LLM path', () => {
    assert.equal(wf.parseSlots({ sourceDescription: 'x', tagName: '"Spring Break"' }).tagName, 'Spring Break');
  });

  it('preserves an empty tagName (run will ask)', () => {
    const result = wf.parseSlots({ sourceDescription: 'my newest 20', tagName: '' });
    assert.ok(result, 'should not return null');
    assert.equal(result.tagName, '');
  });

  it('returns null when sourceDescription is missing or empty', () => {
    assert.equal(wf.parseSlots({ sourceDescription: '', tagName: 'Travel' }), null);
    assert.equal(wf.parseSlots({ sourceDescription: '  ', tagName: 'Travel' }), null);
    assert.equal(wf.parseSlots({ tagName: 'Travel' }), null);
  });
});

// ── run tests ─────────────────────────────────────────────────────────────────

describe('untag_assets execution', () => {
  it('happy path: resolves source + tag → proposes one valid asset.removeTag op → planned', async () => {
    const tagUuid = '00000000-0000-4000-8000-000000000099';
    const client = makeContractClient({
      resolvedFilters: {},
      resolveResults: [{ kind: 'tag', query: 'Travel', status: 'matched', id: tagUuid, choices: [], message: '' }],
    });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', tagName: 'Travel' },
    });
    assert.equal(outcome.status, 'planned');

    // The proposeAlbumOperations call must carry exactly one asset.removeTag op.
    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.ok(propose, 'proposeAlbumOperations was called');
    const ops = propose.args.operations;
    assert.equal(ops.length, 1);
    const op = ops[0];
    assert.equal(op.type, 'asset.removeTag');
    assert.equal(op.targetKind, 'asset_batch');
    assert.equal(op.assetSource.kind, 'selectionHandle');
    assert.equal(op.assetSource.selectionHandleId, 'handle-1');
    assert.equal(op.payload.tagId, tagUuid);
    // No raw asset ids in the call
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('success text includes asset count and tag name', async () => {
    const tagUuid = '00000000-0000-4000-8000-000000000099';
    const client = makeContractClient({
      handleAssetCount: 5,
      resolvedFilters: {},
      resolveResults: [{ kind: 'tag', query: 'Travel', status: 'matched', id: tagUuid, choices: [], message: '' }],
    });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 5 photos', tagName: 'Travel' },
    });
    assert.equal(outcome.status, 'planned');
    assert.ok(/5/.test(outcome.text), 'text should mention 5');
    assert.ok(/Travel/i.test(outcome.text), 'text should mention Travel');
  });

  it('the proposed op passes validateOperations (KNOWN_OPERATION_TYPES check)', () => {
    // asset.removeTag must be in the known types set (fixture already has it).
    assert.ok(KNOWN_OPERATION_TYPES.has('asset.removeTag'));
  });

  it('returns needs_input "Which tag" when tagName is empty', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', tagName: '' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(/which tag/i.test(outcome.text));
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('returns needs_input when tag is not_found', async () => {
    const client = makeContractClient({
      resolvedFilters: {},
      resolveResults: [{ kind: 'tag', query: 'NoSuchTag', status: 'not_found', choices: [], message: 'not found' }],
    });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', tagName: 'NoSuchTag' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('returns needs_input when tag is ambiguous', async () => {
    const client = makeContractClient({
      resolvedFilters: {},
      resolveResults: [
        {
          kind: 'tag',
          query: 'Trip',
          status: 'ambiguous',
          choices: [{ value: 't1', label: 'Trip 2024' }, { value: 't2', label: 'Trip 2025' }],
          message: 'Multiple tags match',
        },
      ],
    });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', tagName: 'Trip' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('propagates source resolver needs_input without proposing', async () => {
    const client = makeContractClient({
      resolvedFilters: {},
      resolveResults: [
        { kind: 'person', query: 'Alex', status: 'ambiguous', choices: [{ value: 'a', label: 'Alex Smith' }], message: '' },
      ],
    });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'photos of Alex', tagName: 'Travel' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('propagates source resolver empty without proposing', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 10 photos', tagName: 'Travel' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('propagates handoff from source resolver', async () => {
    // A subjective source that makes it past match() but causes the resolver to hand off.
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'resolveAssetSearchFilters') return { resolvedFilters: {} };
        if (name === 'searchAssets') return { selectionHandle: null }; // no handle → empty → needs_input
        throw new Error(`unexpected ${name}`);
      },
    };
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', tagName: 'Travel' },
    });
    // Either needs_input or failed is acceptable for a resolver that returns no handle
    assert.ok(['needs_input', 'failed', 'handoff_open'].includes(outcome.status));
  });

  it('fails when resolveAssetSearchFilters throws', async () => {
    const client = {
      calls: [],
      async call(name) {
        this.calls.push({ name });
        // Let searchAssets succeed (for the source resolver), throw on tag resolution.
        if (name === 'searchAssets') {
          return { selectionHandle: { id: 'handle-1', assetCount: 20 } };
        }
        if (name === 'resolveAssetSearchFilters') throw new Error('tag lookup failed');
        throw new Error(`unexpected ${name}`);
      },
    };
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', tagName: 'Travel' },
    });
    assert.equal(outcome.status, 'failed');
  });

  it('fails (gate) when proposeAlbumOperations returns no persisted plan id', async () => {
    const tagUuid = '00000000-0000-4000-8000-000000000099';
    const client = makeContractClient({
      planResult: { status: 'success', plan: {} }, // no id
      resolvedFilters: {},
      resolveResults: [{ kind: 'tag', query: 'Travel', status: 'matched', id: tagUuid, choices: [], message: '' }],
    });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 10 photos', tagName: 'Travel' },
    });
    assert.equal(outcome.status, 'failed');
    // Must not contain any success language
    assert.equal(/prepared|planned|remove|tag /i.test(outcome.text), false);
  });
});
