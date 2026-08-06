import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shareAlbumWorkflow } from './share-album.mjs';
import { makeContractClient, KNOWN_OPERATION_TYPES, validateShareLinkCreateAlbum } from './contract-fixtures.mjs';

const wf = shareAlbumWorkflow();

// ── match accepts ──────────────────────────────────────────────────────────────

describe('share_album router — match accepts', () => {
  it('matches "share the Family album as a link"', () => {
    const result = wf.match('share the Family album as a link');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Family');
  });

  it('matches "share the Family album as a shareable link"', () => {
    const result = wf.match('share the Family album as a shareable link');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Family');
  });

  it('matches "share the Family album as a public link"', () => {
    const result = wf.match('share the Family album as a public link');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Family');
  });

  it('matches "create a share link for the Family album"', () => {
    const result = wf.match('create a share link for the Family album');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Family');
  });

  it('matches "create a public share link for the Family album"', () => {
    const result = wf.match('create a public share link for the Family album');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Family');
  });

  it('matches "make a shareable link for the Italy album"', () => {
    const result = wf.match('make a shareable link for the Italy album');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Italy');
  });

  it('matches "generate a share link for the Trips album"', () => {
    const result = wf.match('generate a share link for the Trips album');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Trips');
  });

  it('captures expiryDays modifier', () => {
    const result = wf.match('share the Family album as a link, expires in 7 days');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Family');
    assert.equal(result.slots.expiryDays, 7);
  });

  it('captures password modifier', () => {
    const result = wf.match('share the Family album as a link with password secret123');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Family');
    assert.equal(result.slots.password, 'secret123');
  });

  it('captures hide metadata modifier', () => {
    const result = wf.match('share the Family album as a link, hide metadata');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Family');
    assert.equal(result.slots.showMetadata, false);
  });
});

// ── match rejects ─────────────────────────────────────────────────────────────

describe('share_album router — match rejects (disambiguation)', () => {
  it('rejects "share these photos as a link" (no album noun → share_assets)', () => {
    assert.equal(wf.match('share these photos as a link'), undefined);
  });

  it('rejects "share my newest 20 as a link" (no album noun → share_assets)', () => {
    assert.equal(wf.match('share my newest 20 as a link'), undefined);
  });

  it('rejects "create a share link for my newest 20 photos" (photos not album)', () => {
    assert.equal(wf.match('create a share link for my newest 20 photos'), undefined);
  });

  it('rejects empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('rejects "trash my newest 20 photos" (trash, not share)', () => {
    assert.equal(wf.match('trash my newest 20 photos'), undefined);
  });

  it('rejects "rename the Family album to Family 2026" (rename, not share)', () => {
    assert.equal(wf.match('rename the Family album to Family 2026'), undefined);
  });
});

// ── parseSlots ────────────────────────────────────────────────────────────────

describe('share_album parseSlots', () => {
  it('round-trips a valid albumRef', () => {
    const result = wf.parseSlots({ albumRef: 'Family' });
    assert.equal(result.albumRef, 'Family');
  });

  it('strips leading article from albumRef', () => {
    const result = wf.parseSlots({ albumRef: 'the Family' });
    assert.equal(result.albumRef, 'Family');
  });

  it('strips trailing "album" noun from albumRef', () => {
    const result = wf.parseSlots({ albumRef: 'Family album' });
    assert.equal(result.albumRef, 'Family');
  });

  it('passes through expiryDays', () => {
    const result = wf.parseSlots({ albumRef: 'Family', expiryDays: 7 });
    assert.equal(result.expiryDays, 7);
  });

  it('passes through password', () => {
    const result = wf.parseSlots({ albumRef: 'Family', password: 'secret' });
    assert.equal(result.password, 'secret');
  });

  it('passes through showMetadata false', () => {
    const result = wf.parseSlots({ albumRef: 'Family', showMetadata: false });
    assert.equal(result.showMetadata, false);
  });

  it('returns null when albumRef is missing', () => {
    assert.equal(wf.parseSlots({}), null);
    assert.equal(wf.parseSlots(null), null);
    assert.equal(wf.parseSlots(undefined), null);
  });

  it('returns null when albumRef is empty or whitespace', () => {
    assert.equal(wf.parseSlots({ albumRef: '' }), null);
    assert.equal(wf.parseSlots({ albumRef: '   ' }), null);
  });
});

// ── run tests ─────────────────────────────────────────────────────────────────

describe('share_album execution', () => {
  it('happy path: resolves album → proposes ONE valid shareLink.createAlbum op → planned', async () => {
    const client = makeContractClient({ albums: [{ id: 'alb-1', albumName: 'Family' }] });
    const outcome = await wf.run({
      client,
      slots: { albumRef: 'Family' },
    });
    assert.equal(outcome.status, 'planned');

    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.ok(propose, 'proposeAlbumOperations was called');
    const ops = propose.args.operations;
    assert.equal(ops.length, 1);
    const op = ops[0];
    assert.equal(op.type, 'shareLink.createAlbum');
    assert.equal(op.targetKind, 'existing_album');
    assert.equal(op.targetId, 'alb-1');
    assert.equal(op.riskLevel, 'high');
  });

  it('success text mentions album name and "outward-facing"', async () => {
    const client = makeContractClient({ albums: [{ id: 'alb-1', albumName: 'Family' }] });
    const outcome = await wf.run({
      client,
      slots: { albumRef: 'Family' },
    });
    assert.equal(outcome.status, 'planned');
    assert.ok(/Family/i.test(outcome.text), 'text should mention album name');
    assert.ok(/outward-facing/i.test(outcome.text), 'text should mention outward-facing');
  });

  it('successSummary contains workflowKind and albumName', async () => {
    const client = makeContractClient({ albums: [{ id: 'alb-1', albumName: 'Family' }] });
    const outcome = await wf.run({
      client,
      slots: { albumRef: 'Family' },
    });
    assert.equal(outcome.status, 'planned');
    assert.equal(outcome.successSummary?.workflowKind, 'share_album');
    assert.ok(/Family/i.test(outcome.successSummary?.albumName ?? ''));
  });

  it('payload includes expiresAt when expiryDays is set', async () => {
    const client = makeContractClient({ albums: [{ id: 'alb-1', albumName: 'Family' }] });
    const nowMs = Date.now();
    const outcome = await wf.run({
      client,
      slots: { albumRef: 'Family', expiryDays: 7 },
      nowMs,
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    const op = propose.args.operations[0];
    assert.ok(op.payload?.expiresAt, 'expiresAt should be present');
    const expires = new Date(op.payload.expiresAt).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(expires - nowMs - sevenDaysMs) < 10_000, 'expiresAt should be ~7 days from now');
  });

  it('payload includes password when password slot is set', async () => {
    const client = makeContractClient({ albums: [{ id: 'alb-1', albumName: 'Family' }] });
    const outcome = await wf.run({
      client,
      slots: { albumRef: 'Family', password: 'hunter2' },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    const op = propose.args.operations[0];
    assert.equal(op.payload?.password, 'hunter2');
  });

  it('payload includes showMetadata: false when showMetadata slot is false', async () => {
    const client = makeContractClient({ albums: [{ id: 'alb-1', albumName: 'Family' }] });
    const outcome = await wf.run({
      client,
      slots: { albumRef: 'Family', showMetadata: false },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    const op = propose.args.operations[0];
    assert.equal(op.payload?.showMetadata, false);
  });

  it('no payload when no optional slots given', async () => {
    const client = makeContractClient({ albums: [{ id: 'alb-1', albumName: 'Family' }] });
    const outcome = await wf.run({
      client,
      slots: { albumRef: 'Family' },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    const op = propose.args.operations[0];
    // payload may be undefined or absent
    if (op.payload !== undefined) {
      assert.equal(Object.keys(op.payload).length, 0);
    }
  });

  it('returns needs_input when album ref is missing', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: {} });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('returns needs_input when album not found', async () => {
    const client = makeContractClient({ albums: [{ id: 'alb-1', albumName: 'Italy' }] });
    const outcome = await wf.run({ client, slots: { albumRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(/could not find/i.test(outcome.text));
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('returns needs_input when album is ambiguous (multiple matches)', async () => {
    const client = makeContractClient({
      albums: [
        { id: 'alb-1', albumName: 'Family' },
        { id: 'alb-2', albumName: 'Family' },
      ],
    });
    const outcome = await wf.run({ client, slots: { albumRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(/multiple/i.test(outcome.text));
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('returns failed when listAlbums throws', async () => {
    const client = {
      calls: [],
      async call(name) {
        this.calls.push({ name });
        throw new Error('network error');
      },
    };
    const outcome = await wf.run({ client, slots: { albumRef: 'Family' } });
    assert.equal(outcome.status, 'failed');
  });

  it('returns failed when proposeAlbumOperations throws', async () => {
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'listAlbums') return { albums: [{ id: 'alb-1', albumName: 'Family' }] };
        if (name === 'proposeAlbumOperations') throw new Error('planning failed');
        throw new Error(`unexpected ${name}`);
      },
    };
    const outcome = await wf.run({ client, slots: { albumRef: 'Family' } });
    assert.equal(outcome.status, 'failed');
  });

  it('returns failed (gate) when proposeAlbumOperations returns no persisted plan id', async () => {
    const client = makeContractClient({
      albums: [{ id: 'alb-1', albumName: 'Family' }],
      planResult: { status: 'success', plan: {} }, // no id
    });
    const outcome = await wf.run({ client, slots: { albumRef: 'Family' } });
    assert.equal(outcome.status, 'failed');
  });

  it('is a hybrid workflow with kind share_album', () => {
    assert.equal(wf.kind, 'share_album');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });

  it('the proposed op type is in KNOWN_OPERATION_TYPES', () => {
    assert.ok(KNOWN_OPERATION_TYPES.has('shareLink.createAlbum'));
  });
});

// ── contract-fixtures: validateShareLinkCreateAlbum ──────────────────────────

describe('contract-fixtures: validateShareLinkCreateAlbum', () => {
  it('accepts a well-formed shareLink.createAlbum op (no payload)', () => {
    assert.doesNotThrow(() =>
      validateShareLinkCreateAlbum({
        type: 'shareLink.createAlbum',
        targetKind: 'existing_album',
        targetId: 'alb-1',
        riskLevel: 'high',
      }),
    );
  });

  it('accepts a shareLink.createAlbum op with full optional payload', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    assert.doesNotThrow(() =>
      validateShareLinkCreateAlbum({
        type: 'shareLink.createAlbum',
        targetKind: 'existing_album',
        targetId: 'alb-1',
        riskLevel: 'high',
        payload: { password: 'secret', expiresAt: future, showMetadata: false, allowDownload: true },
      }),
    );
  });

  it('rejects shareLink.createAlbum with wrong targetKind', () => {
    assert.throws(() =>
      validateShareLinkCreateAlbum({
        type: 'shareLink.createAlbum',
        targetKind: 'asset_batch',
        targetId: 'alb-1',
        riskLevel: 'high',
      }),
    );
  });

  it('rejects shareLink.createAlbum with no targetId', () => {
    assert.throws(() =>
      validateShareLinkCreateAlbum({
        type: 'shareLink.createAlbum',
        targetKind: 'existing_album',
        riskLevel: 'high',
      }),
    );
  });

  it('rejects shareLink.createAlbum with assetSource set', () => {
    assert.throws(() =>
      validateShareLinkCreateAlbum({
        type: 'shareLink.createAlbum',
        targetKind: 'existing_album',
        targetId: 'alb-1',
        assetSource: { kind: 'selectionHandle', selectionHandleId: 'h1' },
      }),
    );
  });

  it('rejects shareLink.createAlbum with assetIds set', () => {
    assert.throws(() =>
      validateShareLinkCreateAlbum({
        type: 'shareLink.createAlbum',
        targetKind: 'existing_album',
        targetId: 'alb-1',
        assetIds: ['id-1'],
      }),
    );
  });
});
