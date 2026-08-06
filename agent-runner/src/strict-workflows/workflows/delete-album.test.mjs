import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deleteAlbumWorkflow } from './delete-album.mjs';

const wf = deleteAlbumWorkflow();

const fakeClient = ({ albums = [{ id: 'alb-1', albumName: 'Beach' }], planResult } = {}) => {
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

// ── match: accepted forms ─────────────────────────────────────────────────────

describe('delete_album router — match accepts', () => {
  it('matches "delete the Beach album"', () => {
    const result = wf.match('delete the Beach album');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Beach');
  });

  it('matches "remove the Test album"', () => {
    const result = wf.match('remove the Test album');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Test');
  });

  it('matches "get rid of the Trip album"', () => {
    const result = wf.match('get rid of the Trip album');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Trip');
  });

  it('matches "delete my Favorites album"', () => {
    const result = wf.match('delete my Favorites album');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Favorites');
  });

  it('matches "remove this Italy album"', () => {
    const result = wf.match('remove this Italy album');
    assert.ok(result, 'should match');
    assert.equal(result.slots.albumRef, 'Italy');
  });
});

// ── match: declined forms ─────────────────────────────────────────────────────

describe('delete_album router — match declines', () => {
  it('declines "delete the photos in the Beach album" (photo source + in-the frame)', () => {
    assert.equal(wf.match('delete the photos in the Beach album'), undefined);
  });

  it('declines "delete the Beach album photos" (photo source word after album noun)', () => {
    assert.equal(wf.match('delete the Beach album photos'), undefined);
  });

  it('declines "delete the Family space" (space noun → delete_space)', () => {
    assert.equal(wf.match('delete the Family space'), undefined);
  });

  it('declines "trash my 2024 screenshots" (no album noun)', () => {
    assert.equal(wf.match('trash my 2024 screenshots'), undefined);
  });

  it('declines "delete my videos from the Beach album" (photo source word)', () => {
    assert.equal(wf.match('delete my videos from the Beach album'), undefined);
  });

  it('declines "delete the pics in the Trip album" (pics = photo source)', () => {
    assert.equal(wf.match('delete the pics in the Trip album'), undefined);
  });

  it('declines "delete the images in Beach album" (images = photo source)', () => {
    assert.equal(wf.match('delete the images in Beach album'), undefined);
  });

  it('declines empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('declines whitespace-only prompt', () => {
    assert.equal(wf.match('   '), undefined);
  });

  it('declines "delete the album" with no album name (ref normalizes to empty)', () => {
    // After stripping "the" + "album" the ref is empty → decline.
    assert.equal(wf.match('delete the album'), undefined);
  });

  it('declines "delete the screenshots album" (screenshots is a photo-source word)', () => {
    assert.equal(wf.match('delete the screenshots album'), undefined);
  });
});

// ── parseSlots ────────────────────────────────────────────────────────────────

describe('delete_album parseSlots', () => {
  it('returns slots when albumRef is present', () => {
    const slots = wf.parseSlots({ albumRef: 'Beach' });
    assert.deepEqual(slots, { albumRef: 'Beach' });
  });

  it('normalizes leading article from albumRef', () => {
    const slots = wf.parseSlots({ albumRef: 'the Beach' });
    assert.deepEqual(slots, { albumRef: 'Beach' });
  });

  it('returns null when albumRef is missing', () => {
    assert.equal(wf.parseSlots({}), null);
  });

  it('returns null when rawSlots is null', () => {
    assert.equal(wf.parseSlots(null), null);
  });

  it('returns null when albumRef normalizes to empty', () => {
    assert.equal(wf.parseSlots({ albumRef: 'the' }), null);
  });
});

// ── run ───────────────────────────────────────────────────────────────────────

describe('delete_album run — unique album', () => {
  it('proposes album.delete with the correct targetId and success text', async () => {
    const client = fakeClient({ albums: [{ id: 'alb-1', albumName: 'Beach' }] });
    const slots = wf.parseSlots({ albumRef: 'Beach' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'planned');
    const planCall = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.ok(planCall, 'proposeAlbumOperations must be called');
    const op = planCall.args.operations[0];
    assert.equal(op.type, 'album.delete');
    assert.equal(op.targetKind, 'existing_album');
    assert.equal(op.targetId, 'alb-1');
    assert.match(op.summary, /Beach/);
  });

  it('success text contains the photos-preserved disclosure', async () => {
    const client = fakeClient({ albums: [{ id: 'alb-1', albumName: 'Beach' }] });
    const slots = wf.parseSlots({ albumRef: 'Beach' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'planned');
    assert.match(outcome.text, /photos stay in your library|only the album is removed/i);
  });

  it('success text mentions the album name', async () => {
    const client = fakeClient({ albums: [{ id: 'alb-1', albumName: 'Beach' }] });
    const slots = wf.parseSlots({ albumRef: 'Beach' });
    const outcome = await wf.run({ client, slots });
    assert.match(outcome.text, /Beach/);
  });
});

describe('delete_album run — not found', () => {
  it('returns needs_input when no album matches', async () => {
    const client = fakeClient({ albums: [] });
    const slots = wf.parseSlots({ albumRef: 'Nonexistent' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'needs_input');
    assert.match(outcome.text, /Nonexistent/);
  });
});

describe('delete_album run — ambiguous album', () => {
  it('returns needs_input with a continuation when multiple albums share the name', async () => {
    const client = fakeClient({
      albums: [
        { id: 'a', albumName: 'Beach' },
        { id: 'b', albumName: 'Beach' },
      ],
    });
    const slots = wf.parseSlots({ albumRef: 'Beach' });
    const outcome = await wf.run({ client, slots, nowMs: 1000 });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(outcome.continuation, 'must include a continuation');
    assert.equal(outcome.continuation.kind, 'delete_album_album');
  });
});

describe('delete_album run — listAlbums throws', () => {
  it('returns failed when listAlbums throws', async () => {
    const client = {
      calls: [],
      async call(name) {
        if (name === 'listAlbums') throw new Error('network error');
        throw new Error(`unexpected ${name}`);
      },
    };
    const slots = wf.parseSlots({ albumRef: 'Beach' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'failed');
    assert.doesNotMatch(outcome.text, /created|proposed|ready/i);
  });
});

describe('delete_album run — proposeAlbumOperations throws', () => {
  it('returns failed when the planning tool throws', async () => {
    const client = {
      calls: [],
      async call(name) {
        if (name === 'listAlbums') return { albums: [{ id: 'alb-1', albumName: 'Beach' }] };
        if (name === 'proposeAlbumOperations') throw new Error('planner down');
        throw new Error(`unexpected ${name}`);
      },
    };
    const slots = wf.parseSlots({ albumRef: 'Beach' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'failed');
    assert.doesNotMatch(outcome.text, /created|proposed|ready/i);
  });
});

describe('delete_album run — no plan id', () => {
  it('fails without success language when planning returns no plan id', async () => {
    const client = fakeClient({ planResult: { status: 'success' } });
    const slots = wf.parseSlots({ albumRef: 'Beach' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'failed');
    assert.doesNotMatch(outcome.text, /created|proposed|ready/i);
  });
});

// ── resumeContinuation ────────────────────────────────────────────────────────

describe('delete_album resumeContinuation', () => {
  it('resolves a candidate pick to resolvedAlbumId in ctx', () => {
    const pending = {
      kind: 'delete_album_album',
      createdAtMs: 1000,
      candidates: [
        { index: 1, id: 'a', name: 'Beach' },
        { index: 2, id: 'b', name: 'Beach' },
      ],
      slots: { albumRef: 'Beach' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: 2000 });
    assert.equal(result.status, 'matched');
    assert.equal(result.ctx.resolvedAlbumId, 'a');
    assert.deepEqual(result.ctx.slots, { albumRef: 'Beach' });
  });

  it('returns needs_input for an unknown continuation kind', () => {
    const pending = { kind: 'other_kind', createdAtMs: 1000, candidates: [] };
    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: 2000 });
    assert.equal(result.status, 'needs_input');
  });

  it('resolves with second candidate when user picks 2', () => {
    const pending = {
      kind: 'delete_album_album',
      createdAtMs: 1000,
      candidates: [
        { index: 1, id: 'a', name: 'Beach' },
        { index: 2, id: 'b', name: 'Beach' },
      ],
      slots: { albumRef: 'Beach' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '2', nowMs: 2000 });
    assert.equal(result.status, 'matched');
    assert.equal(result.ctx.resolvedAlbumId, 'b');
  });
});

// ── run with resolvedAlbumId (continuation path) ──────────────────────────────

describe('delete_album run — continuation path (resolvedAlbumId)', () => {
  it('proposes album.delete for the resolved album without re-listing', async () => {
    const client = fakeClient({ albums: [{ id: 'alb-1', albumName: 'Beach' }] });
    const slots = wf.parseSlots({ albumRef: 'Beach' });
    const outcome = await wf.run({ client, slots, resolvedAlbumId: 'alb-1' });
    assert.equal(outcome.status, 'planned');
    const planCall = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.ok(planCall);
    const op = planCall.args.operations[0];
    assert.equal(op.targetId, 'alb-1');
    // listAlbums should NOT be called (resolvedAlbumId skips lookup)
    const listCall = client.calls.find((c) => c.name === 'listAlbums');
    assert.equal(listCall, undefined, 'listAlbums should be skipped on continuation path');
  });
});
