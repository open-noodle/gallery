import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addPhotosToAlbumWorkflow } from './add-photos-to-album.mjs';
import { makeContractClient } from './contract-fixtures.mjs';

const wf = addPhotosToAlbumWorkflow();

// Drive run() against the shared contract-faithful fake MCP client, which enforces
// the real server tool DTO shapes (so a call the live server would reject also
// throws here — the lesson from the recency bug this workflow shipped with).
const fakeClient = makeContractClient;

describe('add_photos_to_album HybridWorkflow', () => {
  it('resolves a recency source via a metadata search and proposes a duplicate-safe add', async () => {
    const client = fakeClient();
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'planned');

    // Never sends a free-text query to the named-entity resolver (the live bug).
    assert.equal(
      client.calls.some((c) => c.name === 'resolveAssetSearchFilters'),
      false,
    );
    // Resolves recency through a bounded metadata search: newest-first, capped to N, no query.
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.ok(search, 'expected a searchAssets call');
    assert.equal(search.args.mode, 'metadata');
    assert.equal(search.args.order, 'desc');
    assert.equal(search.args.limit, 20);
    assert.equal(search.args.query, undefined);

    const ops = client.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations;
    assert.equal(ops[0].type, 'album.addAssets');
    assert.equal(ops[0].assetSource.kind, 'selectionHandle');
    assert.equal(ops[0].assetSource.selectionHandleId, 'handle-1');
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false); // no raw ids to the model
  });

  it('caps the recency limit and parses varied phrasings', async () => {
    // Sources are the *extracted* source (verb already stripped by the matcher).
    for (const [sourceDescription, expected] of [
      ['my 50 most recent photos', 50],
      ['the last 10 pics', 10],
      ['latest 5 shots', 5],
      ['newest 5000 photos', 1000], // clamped to MAX_RECENCY_LIMIT
    ]) {
      const client = fakeClient();
      const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription } });
      assert.equal(outcome.status, 'planned', sourceDescription);
      assert.equal(client.calls.find((c) => c.name === 'searchAssets').args.limit, expected, sourceDescription);
    }
  });

  it('plans a date source via the shared resolver (date filters)', async () => {
    const client = fakeClient();
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'my photos from 2024' } });
    assert.equal(outcome.status, 'planned');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
    });
  });

  it('plans a media-type source via the shared resolver (type + date filters)', async () => {
    const client = fakeClient();
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'my videos from 2024' } });
    assert.equal(outcome.status, 'planned');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
      type: 'VIDEO',
    });
    const ops = client.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations;
    assert.equal(ops[0].type, 'album.addAssets');
    assert.equal(ops[0].assetSource.selectionHandleId, 'handle-1');
  });

  it('hands off a qualified/unbounded source to open orchestration', async () => {
    // Recency keyword with no count (unbounded) — must NOT fabricate a metadata search.
    // ('my Berlin photos from last weekend' now RESOLVES via city+date filters — Slice 2.)
    for (const sourceDescription of ['newest pics']) {
      const client = fakeClient();
      const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription } });
      assert.equal(outcome.status, 'handoff_open', sourceDescription);
      assert.equal(
        client.calls.some((c) => c.name === 'searchAssets' || c.name === 'proposeAlbumOperations'),
        false,
        sourceDescription,
      );
    }
  });

  it('hands off a subjective source', async () => {
    const client = fakeClient();
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'the good ones' } });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAlbumOperations'),
      false,
    );
  });

  it('asks for input when the album cannot be resolved', async () => {
    const outcome = await wf.run({
      client: fakeClient({ albums: [] }),
      slots: { albumRef: 'Nope', sourceDescription: 'newest 10' },
    });
    assert.equal(outcome.status, 'needs_input');
  });

  it('asks for input when the recency source resolves to zero assets instead of planning an empty add', async () => {
    const client = fakeClient({ handleAssetCount: 0 });
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'newest 10 photos' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAlbumOperations'),
      false,
    );
  });

  it('returns needs_input for a not-found source entity (no proposeAlbumOperations)', async () => {
    const client = fakeClient({
      resolveResults: [
        { kind: 'person', query: 'Alex', status: 'not_found', choices: [], message: '' },
      ],
    });
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'photos of Alex' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });
});
