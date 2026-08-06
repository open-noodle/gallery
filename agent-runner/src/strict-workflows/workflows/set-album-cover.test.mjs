import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeContractClient } from './contract-fixtures.mjs';
import { setAlbumCoverWorkflow } from './set-album-cover.mjs';

const wf = setAlbumCoverWorkflow();

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
const D = '00000000-0000-4000-8000-000000000004';

const makeClient = (overrides = {}) =>
  makeContractClient({
    albums: [{ id: 'alb-1', albumName: 'Family', assetIds: [A, B, C, D] }],
    ...overrides,
  });

describe('set_album_cover StrictWorkflow', () => {
  // --- identity ---
  it('has kind set_album_cover and flow strict and a run function', () => {
    assert.equal(wf.kind, 'set_album_cover');
    assert.equal(wf.flow, 'strict');
    assert.equal(typeof wf.run, 'function');
  });

  // --- match ---
  it('matches "set the cover of the Family album to the first photo"', () => {
    const result = wf.match('set the cover of the Family album to the first photo');
    assert.deepEqual(result, { slots: { albumRef: 'Family', coverRef: 'the first photo' } });
  });

  it('matches "make the Family album cover the 3rd photo"', () => {
    const result = wf.match('make the Family album cover the 3rd photo');
    assert.deepEqual(result, { slots: { albumRef: 'Family', coverRef: '3rd' } });
  });

  it('does not match "pick a better cover for the Family album"', () => {
    assert.equal(wf.match('pick a better cover for the Family album'), undefined);
  });

  it('does not match "change the cover photo on my Italy album" (no "to <target>")', () => {
    assert.equal(wf.match('change the cover photo on my Italy album'), undefined);
  });

  it('does not match empty string', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('does not match "rename the Family album to X"', () => {
    assert.equal(wf.match('rename the Family album to X'), undefined);
  });

  // --- parseSlots ---
  it('parseSlots: full valid slots round-trips', () => {
    const result = wf.parseSlots({ albumRef: 'Family', coverRef: '3rd photo' });
    assert.deepEqual(result, { albumRef: 'Family', coverRef: '3rd photo' });
  });

  it('parseSlots: missing coverRef → null', () => {
    assert.equal(wf.parseSlots({ albumRef: 'Family' }), null);
  });

  it('parseSlots: missing albumRef → null', () => {
    assert.equal(wf.parseSlots({ coverRef: '3rd' }), null);
  });

  // --- run: 3rd photo ---
  it('run: "the 3rd photo" selects the 3rd asset and plans album.setCover with no payload', async () => {
    const client = makeClient();
    const slots = wf.parseSlots({ albumRef: 'Family', coverRef: 'the 3rd photo' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'planned');
    const planCall = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    const op = planCall.args.operations[0];
    assert.deepEqual(op, {
      type: 'album.setCover',
      summary: 'Set the album cover.',
      targetKind: 'existing_album',
      targetId: 'alb-1',
      assetIds: [C],
    });
    assert.equal('payload' in op, false);
    assert.equal(JSON.stringify(client.calls).includes('assetSource'), false);
  });

  it('run: "the first photo" selects the 1st asset', async () => {
    const client = makeClient();
    const slots = wf.parseSlots({ albumRef: 'Family', coverRef: 'the first photo' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'planned');
    const planCall = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.deepEqual(planCall.args.operations[0].assetIds, [A]);
  });

  it('run: "the last photo" selects the last asset', async () => {
    const client = makeClient();
    const slots = wf.parseSlots({ albumRef: 'Family', coverRef: 'the last photo' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'planned');
    const planCall = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.deepEqual(planCall.args.operations[0].assetIds, [D]);
  });

  // --- run: ambiguous album ---
  it('run: two albums with same name → needs_input, no propose', async () => {
    const client = makeContractClient({
      albums: [
        { id: 'alb-1', albumName: 'Family', assetIds: [A, B] },
        { id: 'alb-2', albumName: 'Family', assetIds: [C, D] },
      ],
    });
    const slots = wf.parseSlots({ albumRef: 'Family', coverRef: 'the first photo' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  // --- run: album not found ---
  it('run: no matching album → needs_input, no propose', async () => {
    const client = makeContractClient({ albums: [] });
    const slots = wf.parseSlots({ albumRef: 'Family', coverRef: 'the first photo' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  // --- run: index out of range ---
  it('run: "the 9th photo" with 4 assets → needs_input, no propose', async () => {
    const client = makeClient();
    const slots = wf.parseSlots({ albumRef: 'Family', coverRef: 'the 9th photo' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  // --- run: unresolvable cover ---
  it('run: "a nicer one" → handoff_open, no propose', async () => {
    const client = makeClient();
    const slots = wf.parseSlots({ albumRef: 'Family', coverRef: 'a nicer one' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  // --- run: gate failure (plan returns no plan id) ---
  it('run: gate { status:"success", plan:{} } → failed, text does not claim success', async () => {
    const client = makeContractClient({
      albums: [{ id: 'alb-1', albumName: 'Family', assetIds: [A, B, C, D] }],
      planResult: { status: 'success', plan: {} },
    });
    const slots = wf.parseSlots({ albumRef: 'Family', coverRef: 'the first photo' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared|set the cover/i.test(outcome.text), false);
  });

  // --- run: listAlbums throws ---
  it('run: listAlbums throws → failed', async () => {
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'listAlbums') throw new Error('network error');
        throw new Error(`unexpected ${name}`);
      },
    };
    const slots = wf.parseSlots({ albumRef: 'Family', coverRef: 'the first photo' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'failed');
  });

  // --- run: readAlbum throws ---
  it('run: readAlbum throws → failed', async () => {
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'listAlbums') return { albums: [{ id: 'alb-1', albumName: 'Family' }] };
        if (name === 'readAlbum') throw new Error('read error');
        throw new Error(`unexpected ${name}`);
      },
    };
    const slots = wf.parseSlots({ albumRef: 'Family', coverRef: 'the first photo' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'failed');
  });
});
