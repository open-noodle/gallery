import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { restoreAssetsWorkflow } from './restore-assets.mjs';
import { makeContractClient, KNOWN_OPERATION_TYPES } from './contract-fixtures.mjs';

const wf = restoreAssetsWorkflow();

// ── match accepts ──────────────────────────────────────────────────────────────

describe('restore_assets router — match accepts', () => {
  it('matches "restore my newest 20 from trash"', () => {
    const result = wf.match('restore my newest 20 from trash');
    assert.ok(result, 'should match');
    assert.ok(result.slots.sourceDescription, 'should capture sourceDescription');
  });

  it('matches "recover the photos I just trashed"', () => {
    const result = wf.match('recover the photos I just trashed');
    assert.ok(result, 'should match');
    assert.ok(result.slots.sourceDescription, 'should capture sourceDescription');
  });

  it('matches "get my photos back from the trash"', () => {
    const result = wf.match('get my photos back from the trash');
    assert.ok(result, 'should match');
  });

  it('matches "untrash these photos"', () => {
    const result = wf.match('untrash these photos');
    assert.ok(result, 'should match');
  });

  it('matches "untrash my newest 20"', () => {
    const result = wf.match('untrash my newest 20');
    assert.ok(result, 'should match');
  });

  it('matches "restore the photos from last week"', () => {
    const result = wf.match('restore the photos from last week');
    assert.ok(result, 'should match');
  });

  it('matches "recover my deleted photos"', () => {
    const result = wf.match('recover my deleted photos');
    assert.ok(result, 'should match');
  });

  it('matches "bring back my newest 10 photos from trash"', () => {
    const result = wf.match('bring back my newest 10 photos from trash');
    assert.ok(result, 'should match');
  });

  it('strips trailing punctuation from source', () => {
    const result = wf.match('restore my newest 20 from trash.');
    assert.ok(result, 'should match');
  });
});

// ── match rejects ─────────────────────────────────────────────────────────────

describe('restore_assets router — match rejects (disambiguation)', () => {
  it('rejects "trash my newest 20" (trash verb, not restore)', () => {
    assert.equal(wf.match('trash my newest 20'), undefined);
  });

  it('rejects "remove the Travel tag from my newest 20" (untag_assets, not restore)', () => {
    assert.equal(wf.match('remove the Travel tag from my newest 20'), undefined);
  });

  it('rejects "archive my newest 20" (no restore verb)', () => {
    assert.equal(wf.match('archive my newest 20'), undefined);
  });

  it('rejects "delete my newest 20 photos" (trash verb, not restore)', () => {
    assert.equal(wf.match('delete my newest 20 photos'), undefined);
  });

  it('rejects empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('rejects "move my newest 20 to the trash" (trash verb, not restore)', () => {
    assert.equal(wf.match('move my newest 20 to the trash'), undefined);
  });
});

// ── parseSlots ────────────────────────────────────────────────────────────────

describe('restore_assets parseSlots', () => {
  it('round-trips a valid sourceDescription', () => {
    const result = wf.parseSlots({ sourceDescription: 'my newest 20 photos' });
    assert.deepEqual(result, { sourceDescription: 'my newest 20 photos' });
  });

  it('strips trailing punctuation', () => {
    const result = wf.parseSlots({ sourceDescription: 'my newest 20 photos.' });
    assert.deepEqual(result, { sourceDescription: 'my newest 20 photos' });
  });

  it('returns null when sourceDescription is missing', () => {
    assert.equal(wf.parseSlots({}), null);
    assert.equal(wf.parseSlots(null), null);
    assert.equal(wf.parseSlots(undefined), null);
  });

  it('returns null when sourceDescription is empty or whitespace', () => {
    assert.equal(wf.parseSlots({ sourceDescription: '' }), null);
    assert.equal(wf.parseSlots({ sourceDescription: '   ' }), null);
  });
});

// ── run tests ─────────────────────────────────────────────────────────────────

describe('restore_assets execution', () => {
  it('happy path: resolves source → proposes ONE valid asset.restore op → planned', async () => {
    const client = makeContractClient({ handleAssetCount: 20 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos' },
    });
    assert.equal(outcome.status, 'planned');

    // The proposeAlbumOperations call must carry exactly one asset.restore op.
    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.ok(propose, 'proposeAlbumOperations was called');
    const ops = propose.args.operations;
    assert.equal(ops.length, 1);
    const op = ops[0];
    assert.equal(op.type, 'asset.restore');
    assert.equal(op.targetKind, 'asset_batch');
    assert.equal(op.assetSource.kind, 'selectionHandle');
    assert.equal(op.assetSource.selectionHandleId, 'handle-1');
    assert.equal(op.riskLevel, 'low');
    // No payload
    assert.equal(op.payload, undefined);
  });

  it('searchAssets call carries isTrashed:true filter', async () => {
    const client = makeContractClient({ handleAssetCount: 5 });
    await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos' },
    });

    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.ok(search, 'searchAssets was called');
    assert.equal(search.args.filters?.isTrashed, true, 'isTrashed:true must be in the search filters');
  });

  it('success text mentions "trash" or "restored" and count', async () => {
    const client = makeContractClient({ handleAssetCount: 5 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 5 photos' },
    });
    assert.equal(outcome.status, 'planned');
    assert.ok(/restor|recover|trash/i.test(outcome.text), 'text should mention restore/recover/trash');
    assert.ok(/5/.test(outcome.text), 'text should mention count 5');
  });

  it('success text uses singular "photo" for count 1', async () => {
    const client = makeContractClient({ handleAssetCount: 1 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 1 photo' },
    });
    assert.equal(outcome.status, 'planned');
    assert.ok(/1 matching photo[^s]/i.test(outcome.text) || /1 matching photo\b/i.test(outcome.text), 'text should use singular photo');
  });

  it('asset.restore is in KNOWN_OPERATION_TYPES', () => {
    assert.ok(KNOWN_OPERATION_TYPES.has('asset.restore'));
  });

  it('returns needs_input when source resolves empty (no plan proposed)', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('propagates resolver handoff without proposing', async () => {
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'resolveAssetSearchFilters') return { resolvedFilters: {} };
        if (name === 'searchAssets') return { selectionHandle: null };
        throw new Error(`unexpected ${name}`);
      },
    };
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos' },
    });
    assert.ok(['needs_input', 'failed', 'handoff_open'].includes(outcome.status));
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('propagates resolver needs_input without proposing', async () => {
    const client = makeContractClient({
      resolvedFilters: {},
      resolveResults: [
        { kind: 'person', query: 'Alex', status: 'ambiguous', choices: [{ value: 'a', label: 'Alex Smith' }], message: '' },
      ],
    });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'photos of Alex' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('returns failed when resolveAssetSearchFilters throws', async () => {
    const client = {
      calls: [],
      async call(name) {
        this.calls.push({ name });
        if (name === 'resolveAssetSearchFilters') throw new Error('network error');
        throw new Error(`unexpected ${name}`);
      },
    };
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos' },
    });
    assert.equal(outcome.status, 'failed');
  });

  it('returns failed (gate) when proposeAlbumOperations returns no persisted plan id', async () => {
    const client = makeContractClient({
      planResult: { status: 'success', plan: {} }, // no id
      handleAssetCount: 20,
    });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos' },
    });
    assert.equal(outcome.status, 'failed');
  });

  it('returns failed when proposeAlbumOperations throws', async () => {
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'resolveAssetSearchFilters') return { resolvedFilters: {} };
        if (name === 'searchAssets') return { selectionHandle: { id: 'handle-1', assetCount: 20 } };
        if (name === 'proposeAlbumOperations') throw new Error('planning failed');
        throw new Error(`unexpected ${name}`);
      },
    };
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos' },
    });
    assert.equal(outcome.status, 'failed');
  });

  it('is a hybrid workflow with kind restore_assets and an executable run', () => {
    assert.equal(wf.kind, 'restore_assets');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

// ── contract-fixtures validator test ─────────────────────────────────────────

describe('contract-fixtures: validateAssetRestore', () => {
  it('KNOWN_OPERATION_TYPES includes asset.restore', () => {
    assert.ok(KNOWN_OPERATION_TYPES.has('asset.restore'));
  });

  it('proposeAlbumOperations with valid asset.restore op succeeds', async () => {
    const client = makeContractClient({ handleAssetCount: 5 });
    // Simulate a direct call to proposeAlbumOperations with a well-formed op
    const result = await client.call('proposeAlbumOperations', {
      summary: 'Restore 5 photos from Trash.',
      operations: [
        {
          type: 'asset.restore',
          summary: 'Restore photos from Trash.',
          targetKind: 'asset_batch',
          assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-1' },
          riskLevel: 'low',
        },
      ],
    });
    assert.ok(result?.plan?.id ?? result?.status, 'should return a plan result');
  });

  it('proposeAlbumOperations rejects unknown operation type', async () => {
    const client = makeContractClient({ handleAssetCount: 5 });
    await assert.rejects(
      () => client.call('proposeAlbumOperations', {
        summary: 'Bad op.',
        operations: [{ type: 'asset.unknown', targetKind: 'asset_batch' }],
      }),
      /unknown operation type/i,
    );
  });
});
