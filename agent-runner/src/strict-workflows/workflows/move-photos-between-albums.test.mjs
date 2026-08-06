import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeContractClient } from './contract-fixtures.mjs';
import { movePhotosBetweenAlbumsWorkflow } from './move-photos-between-albums.mjs';

const AB_ALBUMS = [
  { id: 'alb-A', albumName: 'Drafts' },
  { id: 'alb-B', albumName: 'Keepers' },
];

const wf = movePhotosBetweenAlbumsWorkflow();

describe('move_photos_between_albums workflow — identity', () => {
  it('has the right kind, flow, and run function', () => {
    assert.equal(wf.kind, 'move_photos_between_albums');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('move_photos_between_albums workflow — match()', () => {
  it('matches "move my newest 20 photos from Drafts to Keepers"', () => {
    assert.deepEqual(wf.match('move my newest 20 photos from Drafts to Keepers'), {
      slots: { sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' },
    });
  });

  it('matches multi-from source — binds the FINAL "from <album> to <album>"', () => {
    assert.deepEqual(wf.match('move my photos from 2024 from the Trips album to the Italy album'), {
      slots: { sourceDescription: 'my photos from 2024', fromAlbumRef: 'Trips', toAlbumRef: 'Italy' },
    });
  });

  it('returns undefined for "move my newest 20 to Keepers" (no from)', () => {
    assert.equal(wf.match('move my newest 20 to Keepers'), undefined);
  });

  it('returns undefined for "move the best ones from Drafts to Keepers" (subjective source)', () => {
    assert.equal(wf.match('move the best ones from Drafts to Keepers'), undefined);
  });

  it('returns undefined for "move my recent trip photos from Drafts to Keepers" (recent-trip source)', () => {
    assert.equal(wf.match('move my recent trip photos from Drafts to Keepers'), undefined);
  });

  it('returns undefined for "add my newest 20 photos to Keepers" (no move verb)', () => {
    assert.equal(wf.match('add my newest 20 photos to Keepers'), undefined);
  });

  it('returns undefined for empty string', () => {
    assert.equal(wf.match(''), undefined);
  });
});

describe('move_photos_between_albums workflow — parseSlots()', () => {
  it('normalizes album refs (strips article + trailing "album" noun)', () => {
    assert.deepEqual(
      wf.parseSlots({
        sourceDescription: 'my newest 20 photos',
        fromAlbumRef: 'the Drafts album',
        toAlbumRef: 'the Keepers album',
      }),
      { sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' },
    );
  });

  it('returns null when fromAlbumRef is missing', () => {
    assert.equal(wf.parseSlots({ sourceDescription: 'my newest 20 photos', toAlbumRef: 'Keepers' }), null);
  });

  it('returns null when toAlbumRef is missing', () => {
    assert.equal(wf.parseSlots({ sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts' }), null);
  });

  it('returns null when sourceDescription is empty', () => {
    assert.equal(wf.parseSlots({ sourceDescription: '', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' }), null);
  });

  it('strips trailing punctuation from sourceDescription', () => {
    assert.deepEqual(
      wf.parseSlots({ sourceDescription: 'my newest 20 photos.', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' }),
      { sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' },
    );
  });
});

describe('move_photos_between_albums execution', () => {
  it('planned happy path: removeAssets+addAssets ops via selectionHandle, no raw assetIds, no resolveAssetSearchFilters', async () => {
    const client = makeContractClient({ albums: AB_ALBUMS });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' },
    });
    assert.equal(outcome.status, 'planned');

    // searchAssets: metadata mode, newest-first, capped to 20, no free-text query
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.ok(search, 'expected a searchAssets call');
    assert.equal(search.args.mode, 'metadata');
    assert.equal(search.args.limit, 20);
    assert.equal(search.args.query, undefined);

    // resolveAssetSearchFilters must NOT be called for a recency source
    assert.equal(client.calls.some((c) => c.name === 'resolveAssetSearchFilters'), false);

    // proposeAlbumOperations: two ops in order — removeAssets from Drafts, addAssets to Keepers
    const ops = client.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations;
    assert.deepEqual(ops, [
      {
        type: 'album.removeAssets',
        targetKind: 'existing_album',
        targetId: 'alb-A',
        assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-1' },
      },
      {
        type: 'album.addAssets',
        targetKind: 'existing_album',
        targetId: 'alb-B',
        assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-1' },
      },
    ]);

    // no raw asset ids reach the model
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('A==B decline: same album (after normalize) → needs_input before any tool call; text matches /same album/i', async () => {
    const client = makeContractClient({ albums: AB_ALBUMS });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'the Drafts album' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.match(outcome.text, /same album/i);
    assert.equal(client.calls.some((c) => c.name === 'listAlbums'), false);
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('empty source: handleAssetCount:0 → needs_input; proposeAlbumOperations NOT called', async () => {
    const client = makeContractClient({ albums: AB_ALBUMS, handleAssetCount: 0 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('from-album not found → needs_input; no searchAssets or propose', async () => {
    const client = makeContractClient({ albums: [{ id: 'alb-B', albumName: 'Keepers' }] });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('to-album not found → needs_input; no searchAssets or propose', async () => {
    const client = makeContractClient({ albums: [{ id: 'alb-A', albumName: 'Drafts' }] });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('ambiguous from-album (two Drafts) → needs_input; no propose', async () => {
    const client = makeContractClient({
      albums: [
        { id: 'alb-A1', albumName: 'Drafts' },
        { id: 'alb-A2', albumName: 'Drafts' },
        { id: 'alb-B', albumName: 'Keepers' },
      ],
    });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('subjective source "the good ones" → handoff_open; no searchAssets or propose', async () => {
    const client = makeContractClient({ albums: AB_ALBUMS });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'the good ones', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' },
    });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('searchAssets throws → failed', async () => {
    const baseClient = makeContractClient({ albums: AB_ALBUMS });
    const client = {
      ...baseClient,
      async call(name, args) {
        if (name === 'searchAssets') throw new Error('search unavailable');
        return baseClient.call(name, args);
      },
    };
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 5 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' },
    });
    assert.equal(outcome.status, 'failed');
  });

  it('proposeAlbumOperations returns error → failed; text does not match /prepared|moved \\d/i', async () => {
    const client = makeContractClient({ albums: AB_ALBUMS, planResult: { status: 'error' } });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 5 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' },
    });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared|moved \d/i.test(outcome.text), false);
  });

  it('success copy: text matches /move/i, includes "20", "Drafts", "Keepers"; successSummary correct', async () => {
    const client = makeContractClient({ albums: AB_ALBUMS });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' },
    });
    assert.equal(outcome.status, 'planned');
    assert.match(outcome.text, /move/i);
    assert.ok(outcome.text.includes('20'), 'text should include 20');
    assert.ok(outcome.text.includes('Drafts'), 'text should include Drafts');
    assert.ok(outcome.text.includes('Keepers'), 'text should include Keepers');
    assert.deepEqual(outcome.successSummary, {
      workflowKind: 'move_photos_between_albums',
      fromAlbumName: 'Drafts',
      toAlbumName: 'Keepers',
      assetCount: 20,
    });
  });

  it('singular copy: handleAssetCount:1 → outcome.text contains "1 matching photo" not "1 photos"', async () => {
    const client = makeContractClient({ albums: AB_ALBUMS, handleAssetCount: 1 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 1 photo', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' },
    });
    assert.equal(outcome.status, 'planned');
    assert.match(outcome.text, /\b1 matching photo\b/);
    assert.equal(outcome.text.includes('1 photos'), false);
  });
});
