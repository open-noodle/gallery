import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { trashAssetsWorkflow } from './trash-assets.mjs';
import { makeContractClient, KNOWN_OPERATION_TYPES } from './contract-fixtures.mjs';

const wf = trashAssetsWorkflow();

// ── match accepts ──────────────────────────────────────────────────────────────

describe('trash_assets router — match accepts', () => {
  it('matches "trash my newest 20 photos"', () => {
    const result = wf.match('trash my newest 20 photos');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'my newest 20 photos');
  });

  it('matches "delete my newest 50 photos"', () => {
    const result = wf.match('delete my newest 50 photos');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'my newest 50 photos');
  });

  it('matches "move my newest 20 to the trash"', () => {
    const result = wf.match('move my newest 20 to the trash');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'my newest 20');
  });

  it('matches "bin my 2024 videos"', () => {
    const result = wf.match('bin my 2024 videos');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'my 2024 videos');
  });

  it('matches "send these to the bin"', () => {
    const result = wf.match('send these to the bin');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'these');
  });

  it('matches "delete all my screenshots" (resolver may handoff later)', () => {
    const result = wf.match('delete all my screenshots');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'all my screenshots');
  });

  it('matches "put my newest 10 photos in the trash"', () => {
    const result = wf.match('put my newest 10 photos in the trash');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'my newest 10 photos');
  });

  it('matches "throw my 2022 photos into the recycle bin"', () => {
    const result = wf.match('throw my 2022 photos into the recycle bin');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'my 2022 photos');
  });

  it('strips trailing punctuation from source', () => {
    const result = wf.match('trash my newest 20 photos.');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'my newest 20 photos');
  });
});

// ── match rejects ─────────────────────────────────────────────────────────────

describe('trash_assets router — match rejects (disambiguation)', () => {
  it('rejects "delete the Family album" (container-level deletion)', () => {
    assert.equal(wf.match('delete the Family album'), undefined);
  });

  it('rejects "remove my newest 20 from the Italy album" (no trash verb → remove_photos_from_album)', () => {
    assert.equal(wf.match('remove my newest 20 from the Italy album'), undefined);
  });

  it('rejects "remove the Travel tag from my newest 20" (untag_assets)', () => {
    assert.equal(wf.match('remove the Travel tag from my newest 20'), undefined);
  });

  it('rejects "trash the best ones" (subjective source)', () => {
    assert.equal(wf.match('trash the best ones'), undefined);
  });

  it('rejects "archive my newest 20" (no trash verb)', () => {
    assert.equal(wf.match('archive my newest 20'), undefined);
  });

  it('rejects empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('rejects "remove my newest 10 from the Family space" (removal frame, no trash verb)', () => {
    assert.equal(wf.match('remove my newest 10 from the Family space'), undefined);
  });

  it('rejects "delete the recent trip album" (container-level)', () => {
    assert.equal(wf.match('delete the recent trip album'), undefined);
  });

  // Regression for slice 3.3: trash_assets must cede "delete the Beach album"
  // to delete_album (containerSourcePattern ends with \b(?:album|space)$).
  it('cedes "delete the Beach album" to delete_album (container-level)', () => {
    assert.equal(wf.match('delete the Beach album'), undefined);
  });
});

// ── parseSlots ────────────────────────────────────────────────────────────────

describe('trash_assets parseSlots', () => {
  it('round-trips a valid sourceDescription', () => {
    assert.deepEqual(wf.parseSlots({ sourceDescription: 'my newest 20 photos' }), {
      sourceDescription: 'my newest 20 photos',
    });
  });

  it('strips trailing punctuation', () => {
    assert.deepEqual(wf.parseSlots({ sourceDescription: 'my newest 20 photos.' }), {
      sourceDescription: 'my newest 20 photos',
    });
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

describe('trash_assets execution', () => {
  it('happy path: resolves source → proposes ONE valid asset.trash op → planned', async () => {
    const client = makeContractClient({ handleAssetCount: 20 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos' },
    });
    assert.equal(outcome.status, 'planned');

    // The proposeAlbumOperations call must carry exactly one asset.trash op.
    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.ok(propose, 'proposeAlbumOperations was called');
    const ops = propose.args.operations;
    assert.equal(ops.length, 1);
    const op = ops[0];
    assert.equal(op.type, 'asset.trash');
    assert.equal(op.targetKind, 'asset_batch');
    assert.equal(op.assetSource.kind, 'selectionHandle');
    assert.equal(op.assetSource.selectionHandleId, 'handle-1');
    assert.equal(op.riskLevel, 'high');
    // No payload
    assert.equal(op.payload, undefined);
    // No raw asset ids in any call
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('success text mentions "Trash" and "restored"', async () => {
    const client = makeContractClient({ handleAssetCount: 5 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 5 photos' },
    });
    assert.equal(outcome.status, 'planned');
    assert.ok(/trash/i.test(outcome.text), 'text should mention Trash');
    assert.ok(/restor/i.test(outcome.text), 'text should mention restored/restore');
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

  it('the proposed op passes validateOperations (asset.trash is in KNOWN_OPERATION_TYPES)', () => {
    assert.ok(KNOWN_OPERATION_TYPES.has('asset.trash'));
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
    // A handoff arises when resolver returns { selectionHandle: null }
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'resolveAssetSearchFilters') return { resolvedFilters: {} };
        if (name === 'searchAssets') return { selectionHandle: null }; // resolver → empty/needs_input
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
    // Must not contain any success language
    assert.equal(/prepared|planned|trash/i.test(outcome.text) && /restored/i.test(outcome.text), false);
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

  it('is a hybrid workflow with kind trash_assets and an executable run', () => {
    assert.equal(wf.kind, 'trash_assets');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});
