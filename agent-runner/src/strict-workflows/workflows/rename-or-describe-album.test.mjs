import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renameOrDescribeAlbumWorkflow } from './rename-or-describe-album.mjs';

const wf = renameOrDescribeAlbumWorkflow();

const fakeClient = ({ albums = [{ id: 'alb-1', albumName: 'Family' }], planResult } = {}) => {
  const calls = [];
  return {
    calls,
    async call(name, args) {
      calls.push({ name, args });
      if (name === 'listAlbums') return { albums };
      if (name === 'proposeAlbumOperations') return planResult ?? { status: 'success', plan: { id: 'plan-1' } };
      throw new Error(`unexpected ${name}`);
    },
  };
};

describe('rename_or_describe_album StrictWorkflow', () => {
  it('matches and resolves the album, proposing an updateDetails plan that preserves unspecified fields', async () => {
    const client = fakeClient();
    const slots = wf.parseSlots(
      { albumRef: 'Family', newName: 'Family 2026' },
      'Rename the Family album to Family 2026',
    );
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'planned');
    const planCall = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    const op = planCall.args.operations[0];
    assert.equal(op.type, 'album.updateDetails');
    assert.equal(op.payload.albumName, 'Family 2026');
    assert.equal('description' in op.payload, false); // unspecified field not clobbered
  });

  it('asks for clarification on an ambiguous album reference', async () => {
    const client = fakeClient({
      albums: [
        { id: 'a', albumName: 'Trip' },
        { id: 'b', albumName: 'Trip' },
      ],
    });
    const outcome = await wf.run({
      client,
      slots: wf.parseSlots({ albumRef: 'Trip', newName: 'Trip 2026' }, 'rename Trip'),
    });
    assert.equal(outcome.status, 'needs_input');
  });

  it('supports a description-only change without renaming the album', async () => {
    const client = fakeClient();
    const slots = wf.parseSlots({ albumRef: 'Family', description: 'Our 2026 memories' }, 'describe the Family album');
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'planned');
    const op = client.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations[0];
    assert.equal(op.payload.description, 'Our 2026 memories');
    assert.equal('albumName' in op.payload, false); // rename not implied; name preserved
  });

  it('updates both name and description when both slots are present', async () => {
    const client = fakeClient();
    const slots = wf.parseSlots(
      { albumRef: 'Family', newName: 'Family 2026', description: 'Our 2026 memories' },
      'rename the Family album to Family 2026 and add a description',
    );
    const op =
      (await wf.run({ client, slots }),
      client.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations[0]);
    assert.equal(op.payload.albumName, 'Family 2026');
    assert.equal(op.payload.description, 'Our 2026 memories');
  });

  it('rejects slots with neither a new name nor a description', () => {
    assert.equal(wf.parseSlots({ albumRef: 'Family' }, 'do something to Family'), null);
  });

  it('extracts the description value from a "set the description on X to Y" prompt', () => {
    // Regression: the eval harness caught this phrasing matching the kind but
    // dropping the value, so parseSlots rejected it and the turn fell through.
    const matched = wf.match('set the description on my Italy album to Summer 2026 memories');
    assert.deepEqual(matched.slots, { albumRef: 'Italy', description: 'Summer 2026 memories' });
    assert.deepEqual(wf.parseSlots(matched.slots, 'irrelevant'), { albumRef: 'Italy', description: 'Summer 2026 memories' });
  });

  it('still declines a value-less describe request so it can ask for the text', () => {
    const matched = wf.match('change the description on my Italy album');
    assert.deepEqual(matched.slots, { albumRef: 'Italy' });
    assert.equal(wf.parseSlots(matched.slots, 'irrelevant'), null);
  });

  it('fails without claiming success when planning returns no plan id', async () => {
    const client = fakeClient({ planResult: { status: 'success' } });
    const outcome = await wf.run({
      client,
      slots: wf.parseSlots({ albumRef: 'Family', newName: 'X' }, 'rename Family'),
    });
    assert.equal(outcome.status, 'failed');
    assert.doesNotMatch(outcome.text, /created|proposed|ready/i);
  });
});
