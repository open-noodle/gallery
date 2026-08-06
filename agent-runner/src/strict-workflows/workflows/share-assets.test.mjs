import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shareAssetsWorkflow } from './share-assets.mjs';
import { makeContractClient, KNOWN_OPERATION_TYPES } from './contract-fixtures.mjs';

const wf = shareAssetsWorkflow();

// ── match accepts ──────────────────────────────────────────────────────────────

describe('share_assets router — match accepts', () => {
  it('matches "share these photos as a link"', () => {
    const result = wf.match('share these photos as a link');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'these photos');
  });

  it('matches "create a share link for my newest 20"', () => {
    const result = wf.match('create a share link for my newest 20');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'my newest 20');
  });

  it('matches "make a shareable link for these, expires in 7 days"', () => {
    const result = wf.match('make a shareable link for these, expires in 7 days');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'these');
    assert.equal(result.slots.expiryDays, 7);
  });

  it('matches "share my newest 10 with password hunter2"', () => {
    const result = wf.match('share my newest 10 with password hunter2');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'my newest 10');
    assert.equal(result.slots.password, 'hunter2');
  });

  it('matches "create a shareable link for my Berlin photos"', () => {
    const result = wf.match('create a shareable link for my Berlin photos');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'my Berlin photos');
  });

  it('matches "generate a share link for my newest 20 photos"', () => {
    const result = wf.match('generate a share link for my newest 20 photos');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'my newest 20 photos');
  });

  it('matches "share my 2024 photos as a link, hide metadata"', () => {
    const result = wf.match('share my 2024 photos as a link, hide metadata');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'my 2024 photos');
    assert.equal(result.slots.showMetadata, false);
  });

  it('matches "share my newest 5 as a link expiring in 30 days"', () => {
    const result = wf.match('share my newest 5 as a link expiring in 30 days');
    assert.ok(result, 'should match');
    assert.equal(result.slots.expiryDays, 30);
  });

  it('strips trailing punctuation from source', () => {
    const result = wf.match('share these photos as a link.');
    assert.ok(result, 'should match');
    assert.equal(result.slots.sourceDescription, 'these photos');
  });
});

// ── match rejects ─────────────────────────────────────────────────────────────

describe('share_assets router — match rejects (disambiguation)', () => {
  it('rejects "trash my newest 20 photos" (trash, not share)', () => {
    assert.equal(wf.match('trash my newest 20 photos'), undefined);
  });

  it('rejects "archive my newest 50 photos" (archive, not share)', () => {
    assert.equal(wf.match('archive my newest 50 photos'), undefined);
  });

  it('rejects "rotate my newest 20 photos 90 clockwise" (rotate, not share)', () => {
    assert.equal(wf.match('rotate my newest 20 photos 90 clockwise'), undefined);
  });

  it('rejects "share the album" (album-level share, not asset share)', () => {
    assert.equal(wf.match('share the album'), undefined);
  });

  it('rejects "add my newest 20 photos to Family" (album add, not share)', () => {
    assert.equal(wf.match('add my newest 20 photos to Family'), undefined);
  });

  it('rejects empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('rejects "how many photos do I have?" (chatter)', () => {
    assert.equal(wf.match('how many photos do I have?'), undefined);
  });

  it('rejects "share the best ones" (subjective source)', () => {
    assert.equal(wf.match('share the best ones'), undefined);
  });
});

// ── parseSlots ────────────────────────────────────────────────────────────────

describe('share_assets parseSlots', () => {
  it('round-trips a valid sourceDescription', () => {
    const result = wf.parseSlots({ sourceDescription: 'my newest 20 photos' });
    assert.equal(result.sourceDescription, 'my newest 20 photos');
  });

  it('strips trailing punctuation', () => {
    const result = wf.parseSlots({ sourceDescription: 'my newest 20 photos.' });
    assert.equal(result.sourceDescription, 'my newest 20 photos');
  });

  it('passes through expiryDays', () => {
    const result = wf.parseSlots({ sourceDescription: 'my newest 20', expiryDays: 7 });
    assert.equal(result.expiryDays, 7);
  });

  it('passes through password', () => {
    const result = wf.parseSlots({ sourceDescription: 'my newest 20', password: 'secret' });
    assert.equal(result.password, 'secret');
  });

  it('passes through showMetadata false', () => {
    const result = wf.parseSlots({ sourceDescription: 'my newest 20', showMetadata: false });
    assert.equal(result.showMetadata, false);
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

describe('share_assets execution', () => {
  it('happy path: resolves source → proposes ONE valid shareLink.create op → planned', async () => {
    const client = makeContractClient({ handleAssetCount: 20 });
    const nowMs = Date.now();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos' },
      nowMs,
    });
    assert.equal(outcome.status, 'planned');

    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.ok(propose, 'proposeAlbumOperations was called');
    const ops = propose.args.operations;
    assert.equal(ops.length, 1);
    const op = ops[0];
    assert.equal(op.type, 'shareLink.create');
    assert.equal(op.targetKind, 'asset_batch');
    assert.equal(op.assetSource.kind, 'selectionHandle');
    assert.equal(op.assetSource.selectionHandleId, 'handle-1');
    assert.equal(op.riskLevel, 'high');
    // No raw asset ids in any call
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('success text mentions "share link" and count', async () => {
    const client = makeContractClient({ handleAssetCount: 5 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 5 photos' },
    });
    assert.equal(outcome.status, 'planned');
    assert.ok(/share link/i.test(outcome.text), 'text should mention share link');
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

  it('payload includes expiresAt ~ now+7d when expiryDays=7', async () => {
    const client = makeContractClient({ handleAssetCount: 10 });
    const nowMs = Date.now();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 10', expiryDays: 7 },
      nowMs,
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    const op = propose.args.operations[0];
    assert.ok(op.payload, 'payload should be present');
    assert.ok(typeof op.payload.expiresAt === 'string', 'expiresAt should be a string');
    // Must be a future ISO date
    const expires = new Date(op.payload.expiresAt).getTime();
    assert.ok(expires > nowMs, 'expiresAt should be in the future');
    // Should be approximately 7 days out (within a few seconds)
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(expires - nowMs - sevenDaysMs) < 10_000, 'expiresAt should be ~7 days from now');
  });

  it('payload includes password when password slot is set', async () => {
    const client = makeContractClient({ handleAssetCount: 10 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 10', password: 'hunter2' },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    const op = propose.args.operations[0];
    assert.ok(op.payload, 'payload should be present');
    assert.equal(op.payload.password, 'hunter2');
  });

  it('payload includes showMetadata: false when showMetadata slot is false', async () => {
    const client = makeContractClient({ handleAssetCount: 10 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 10', showMetadata: false },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    const op = propose.args.operations[0];
    assert.ok(op.payload, 'payload should be present');
    assert.equal(op.payload.showMetadata, false);
  });

  it('no payload (or empty payload) when no optional slots given', async () => {
    const client = makeContractClient({ handleAssetCount: 10 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 10' },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    const op = propose.args.operations[0];
    // payload may be undefined or empty object — both are valid
    if (op.payload !== undefined) {
      assert.equal(Object.keys(op.payload).length, 0);
    }
  });

  it('the proposed op type is in KNOWN_OPERATION_TYPES', () => {
    assert.ok(KNOWN_OPERATION_TYPES.has('shareLink.create'));
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

  it('is a hybrid workflow with kind share_assets and an executable run', () => {
    assert.equal(wf.kind, 'share_assets');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

// ── contract-fixtures: validateShareLinkCreate ────────────────────────────────

describe('contract-fixtures: validateShareLinkCreate', () => {
  // Import after the implementation adds the export
  it('accepts a well-formed shareLink.create op (no payload)', async () => {
    const { validateShareLinkCreate } = await import('./contract-fixtures.mjs');
    assert.doesNotThrow(() =>
      validateShareLinkCreate({
        type: 'shareLink.create',
        targetKind: 'asset_batch',
        assetSource: { kind: 'selectionHandle', selectionHandleId: 'h1' },
        riskLevel: 'high',
      }),
    );
  });

  it('accepts a shareLink.create op with full optional payload', async () => {
    const { validateShareLinkCreate } = await import('./contract-fixtures.mjs');
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    assert.doesNotThrow(() =>
      validateShareLinkCreate({
        type: 'shareLink.create',
        targetKind: 'asset_batch',
        assetSource: { kind: 'selectionHandle', selectionHandleId: 'h1' },
        riskLevel: 'high',
        payload: { password: 'secret', expiresAt: future, showMetadata: false, allowDownload: true },
      }),
    );
  });

  it('rejects shareLink.create with wrong targetKind', async () => {
    const { validateShareLinkCreate } = await import('./contract-fixtures.mjs');
    assert.throws(() =>
      validateShareLinkCreate({
        type: 'shareLink.create',
        targetKind: 'existing_album',
        assetSource: { kind: 'selectionHandle', selectionHandleId: 'h1' },
        riskLevel: 'high',
      }),
    );
  });

  it('rejects shareLink.create with no assetSource', async () => {
    const { validateShareLinkCreate } = await import('./contract-fixtures.mjs');
    assert.throws(() =>
      validateShareLinkCreate({
        type: 'shareLink.create',
        targetKind: 'asset_batch',
        riskLevel: 'high',
      }),
    );
  });
});
