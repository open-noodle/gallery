import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAlbumFromSourceWorkflow } from './create-album-from-source.mjs';
import { makeContractClient } from './contract-fixtures.mjs';

const wf = createAlbumFromSourceWorkflow();

describe('create_album_from_source router & slots', () => {
  it('matches "make an album of <source>" (no name yet)', () => {
    assert.deepEqual(wf.match('make an album of my newest 50 photos'), {
      slots: { sourceDescription: 'my newest 50 photos' },
    });
  });

  it('captures an explicit album name', () => {
    assert.deepEqual(wf.match('create an album from my newest 50 photos called Recent'), {
      slots: { sourceDescription: 'my newest 50 photos', albumName: 'Recent' },
    });
  });

  it('strips quotes from a titled name', () => {
    assert.deepEqual(wf.match('make a new album of my newest 20 photos titled "Spring Break"'), {
      slots: { sourceDescription: 'my newest 20 photos', albumName: 'Spring Break' },
    });
  });

  it('declines trip-like sources (owned by the trip workflow)', () => {
    // These overlap the trip workflow; decline so they fall through to the LLM → trip.
    for (const prompt of [
      'make an album for my recent trip',
      'build an album out of my weekend in Lisbon',
      'make an album from my trip to Portugal',
      'assemble an album for our recent road trip',
      'gather my vacation photos from Spain into an album',
    ]) {
      assert.equal(wf.match(prompt), undefined, prompt);
    }
  });

  it('declines a subjective source', () => {
    assert.equal(wf.match('create an album of the best photos from last weekend'), undefined);
  });

  it('does not match an add-to-existing-album', () => {
    assert.equal(wf.match('add my newest 20 to Family'), undefined);
  });

  it('strips trailing punctuation and rejects an empty prompt', () => {
    assert.deepEqual(wf.match('make an album of my photos.'), { slots: { sourceDescription: 'my photos' } });
    assert.equal(wf.match(''), undefined);
  });

  it('parseSlots defaults the album name and strips quotes', () => {
    assert.deepEqual(wf.parseSlots({ sourceDescription: 'my newest 50 photos' }), {
      sourceDescription: 'my newest 50 photos',
      albumName: 'New Album',
    });
    assert.equal(wf.parseSlots({ sourceDescription: 'my newest 50 photos', albumName: '"Recent"' }).albumName, 'Recent');
  });

  it('parseSlots rejects an empty or missing source', () => {
    assert.equal(wf.parseSlots({ sourceDescription: '   ' }), null);
    assert.equal(wf.parseSlots({ albumName: 'X' }), null);
  });

  it('is a hybrid workflow with an executable run', () => {
    assert.equal(wf.kind, 'create_album_from_source');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('create_album_from_source execution', () => {
  it('plans an album from a recency selection handle (explicit name, no raw ids)', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 50 photos', albumName: 'Recent' } });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAlbumFromSelection');
    assert.deepEqual(propose.args, {
      summary: 'Create the "Recent" album.',
      albumName: 'Recent',
      selectionHandleId: 'handle-1',
    });
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('uses the default album name when none is given', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 50 photos' } });
    assert.equal(outcome.status, 'planned');
    assert.equal(client.calls.find((c) => c.name === 'proposeAlbumFromSelection').args.albumName, 'New Album');
  });

  it('plans a date source via the shared resolver', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my photos from 2024', albumName: 'X' } });
    assert.equal(outcome.status, 'planned');
    assert.deepEqual(client.calls.find((c) => c.name === 'searchAssets').args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
    });
  });

  it('hands off subjective and location sources without proposing', async () => {
    // ('my Berlin photos' now RESOLVES via city direct filter — Slice 2.)
    for (const sourceDescription of ['the good ones']) {
      const client = makeContractClient();
      const outcome = await wf.run({ client, slots: { sourceDescription, albumName: 'X' } });
      assert.equal(outcome.status, 'handoff_open', sourceDescription);
      assert.equal(
        client.calls.some((c) => c.name === 'proposeAlbumFromSelection'),
        false,
        sourceDescription,
      );
    }
  });

  it('asks for input when the source resolves to zero assets', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 10 photos', albumName: 'X' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAlbumFromSelection'),
      false,
    );
  });

  it('fails (gate) without success copy when the plan has no persisted id', async () => {
    const client = makeContractClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 10 photos', albumName: 'X' } });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared|created/i.test(outcome.text), false);
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
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 10 photos', albumName: 'X' } });
    assert.equal(outcome.status, 'failed');
  });

  it('returns needs_input for an ambiguous source entity (no proposeAlbumFromSelection)', async () => {
    const client = makeContractClient({
      resolveResults: [
        { kind: 'album', query: 'Italy', status: 'ambiguous', choices: [{ value: 'x', label: 'Italy 2023' }, { value: 'y', label: 'Italy 2024' }], message: '' },
      ],
    });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'photos in the Italy album', albumName: 'X' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumFromSelection'), false);
  });
});
