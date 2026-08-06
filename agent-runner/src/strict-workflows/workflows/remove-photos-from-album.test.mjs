import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeContractClient } from './contract-fixtures.mjs';
import { removePhotosFromAlbumWorkflow } from './remove-photos-from-album.mjs';

const wf = removePhotosFromAlbumWorkflow();

describe('remove_photos_from_album workflow — identity', () => {
  it('has the right kind and flow', () => {
    assert.equal(wf.kind, 'remove_photos_from_album');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('remove_photos_from_album workflow — match()', () => {
  it('matches "remove my newest 20 photos from Family"', () => {
    assert.deepEqual(wf.match('remove my newest 20 photos from Family'), {
      slots: { albumRef: 'Family', sourceDescription: 'my newest 20 photos' },
    });
  });

  it('matches "take my newest 20 photos out of the Family album"', () => {
    assert.deepEqual(wf.match('take my newest 20 photos out of the Family album'), {
      slots: { albumRef: 'Family', sourceDescription: 'my newest 20 photos' },
    });
  });

  it('matches multi-from source — binds the FINAL "from <album>"', () => {
    assert.deepEqual(wf.match('remove my photos from 2024 from the Trips album'), {
      slots: { albumRef: 'Trips', sourceDescription: 'my photos from 2024' },
    });
  });

  it('returns undefined for "remove Bob from the Family space" (space keyword)', () => {
    assert.equal(wf.match('remove Bob from the Family space'), undefined);
  });

  it('returns undefined for "remove my newest 20 from my favorites" (favorites tail)', () => {
    assert.equal(wf.match('remove my newest 20 from my favorites'), undefined);
  });

  it('returns undefined for "remove the Travel tag from my newest 20" (tag phrasing)', () => {
    assert.equal(wf.match('remove the Travel tag from my newest 20'), undefined);
  });

  it('returns undefined for "remove the best ones from Family" (subjective source)', () => {
    assert.equal(wf.match('remove the best ones from Family'), undefined);
  });

  it('returns undefined for "remove my recent trip photos from Family" (recent-trip source)', () => {
    assert.equal(wf.match('remove my recent trip photos from Family'), undefined);
  });

  it('returns undefined for "how many photos are in Family?" (no remove/take verb)', () => {
    assert.equal(wf.match('how many photos are in Family?'), undefined);
  });

  it('returns undefined for empty string', () => {
    assert.equal(wf.match(''), undefined);
  });
});

describe('remove_photos_from_album workflow — parseSlots()', () => {
  it('normalizes album ref (strips article + trailing "album" noun)', () => {
    assert.deepEqual(wf.parseSlots({ albumRef: 'the Family album', sourceDescription: 'my newest 20 photos' }), {
      albumRef: 'Family',
      sourceDescription: 'my newest 20 photos',
    });
  });

  it('returns null when albumRef is empty', () => {
    assert.equal(wf.parseSlots({ albumRef: '', sourceDescription: 'newest 10' }), null);
  });

  it('returns null when sourceDescription is empty', () => {
    assert.equal(wf.parseSlots({ albumRef: 'Family', sourceDescription: '' }), null);
  });

  it('strips trailing punctuation from sourceDescription', () => {
    assert.deepEqual(wf.parseSlots({ albumRef: 'Family', sourceDescription: 'my newest 20 photos.' }), {
      albumRef: 'Family',
      sourceDescription: 'my newest 20 photos',
    });
  });
});

describe('remove_photos_from_album execution', () => {
  it('planned: recency source → album.removeAssets op via selectionHandle, no raw assetIds, no resolveAssetSearchFilters', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'planned');

    // searchAssets: metadata mode, newest-first, capped to 20, no free-text query
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.ok(search, 'expected a searchAssets call');
    assert.equal(search.args.mode, 'metadata');
    assert.equal(search.args.order, 'desc');
    assert.equal(search.args.limit, 20);
    assert.equal(search.args.query, undefined);

    // resolveAssetSearchFilters must NOT be called for a recency source
    assert.equal(client.calls.some((c) => c.name === 'resolveAssetSearchFilters'), false);

    // proposeAlbumOperations op shape — no per-op summary, no payload, no temporaryTargetId
    const ops = client.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations;
    assert.deepEqual(ops[0], {
      type: 'album.removeAssets',
      targetKind: 'existing_album',
      targetId: 'alb-1',
      assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-1' },
    });

    // no raw asset ids reach the model
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('date source "my photos from 2024" → planned; searchAssets.filters has date range; op type album.removeAssets', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'my photos from 2024' } });
    assert.equal(outcome.status, 'planned');

    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
    });

    const ops = client.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations;
    assert.equal(ops[0].type, 'album.removeAssets');
  });

  it('media-type "my videos from 2024" → planned; searchAssets.filters includes type:VIDEO', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'my videos from 2024' } });
    assert.equal(outcome.status, 'planned');

    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
      type: 'VIDEO',
    });
  });

  it('EMPTY-REMOVAL SAFETY: handleAssetCount:0 → needs_input; proposeAlbumOperations NOT called', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'newest 10 photos' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('album not found → needs_input; no searchAssets or propose', async () => {
    const client = makeContractClient({ albums: [] });
    const outcome = await wf.run({ client, slots: { albumRef: 'Nope', sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('ambiguous album → needs_input; no propose', async () => {
    const client = makeContractClient({
      albums: [
        { id: 'a1', albumName: 'Family' },
        { id: 'a2', albumName: 'Family' },
      ],
    });
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'my newest 10 photos' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('unbounded source "newest pics" → handoff_open; neither searchAssets nor proposeAlbumOperations called', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'newest pics' } });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('subjective source "the good ones" → handoff_open; proposeAlbumOperations NOT called', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'the good ones' } });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('searchAssets throws → failed', async () => {
    const client = {
      ...makeContractClient(),
      async call(name, args) {
        if (name === 'searchAssets') throw new Error('search unavailable');
        return makeContractClient().call(name, args);
      },
    };
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'my newest 5 photos' } });
    assert.equal(outcome.status, 'failed');
  });

  it('proposeAlbumOperations returns error → failed; text does not match /prepared|remove \\d/i', async () => {
    const client = makeContractClient({ planResult: { status: 'error' } });
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'my newest 5 photos' } });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared|remove \d/i.test(outcome.text), false);
  });

  it('success copy/summary: text mentions "remove", includes "20" and "Family", no /\\badd\\b/i; successSummary correct', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'planned');
    assert.match(outcome.text, /remove/i);
    assert.ok(outcome.text.includes('20'), 'text should include 20');
    assert.ok(outcome.text.includes('Family'), 'text should include Family');
    assert.equal(/\badd\b/i.test(outcome.text), false);
    assert.deepEqual(outcome.successSummary, {
      workflowKind: 'remove_photos_from_album',
      albumName: 'Family',
      assetCount: 20,
    });
  });

  it('singular copy: handleAssetCount:1 → outcome.text contains "1 matching photo" not "1 photos"', async () => {
    const client = makeContractClient({ handleAssetCount: 1 });
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'my newest 1 photo' } });
    assert.equal(outcome.status, 'planned');
    assert.match(outcome.text, /\b1 matching photo\b/);
    assert.equal(outcome.text.includes('1 photos'), false);
  });

  it('FIXTURE wrong-shape: new_album targetKind → rejects /existing_album/i', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          summary: 'x',
          operations: [
            {
              type: 'album.removeAssets',
              targetKind: 'new_album',
              targetId: 'a',
              assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' },
            },
          ],
        }),
      /existing_album/i,
    );
  });

  it('FIXTURE wrong-shape: removeAssets missing targetId → rejects /targetId/i', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          summary: 'x',
          operations: [
            {
              type: 'album.removeAssets',
              targetKind: 'existing_album',
              assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' },
            },
          ],
        }),
      /targetId/i,
    );
  });

  it('FIXTURE wrong-shape: removeAssets with temporaryTargetId → rejects /temporaryTargetId/i', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          summary: 'x',
          operations: [
            {
              type: 'album.removeAssets',
              targetKind: 'existing_album',
              targetId: 'a',
              temporaryTargetId: 't',
              assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' },
            },
          ],
        }),
      /temporaryTargetId/i,
    );
  });
});
