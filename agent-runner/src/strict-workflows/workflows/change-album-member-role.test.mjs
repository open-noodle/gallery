import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changeAlbumMemberRoleWorkflow } from './change-album-member-role.mjs';
import { makeContractClient } from './contract-fixtures.mjs';

const wf = changeAlbumMemberRoleWorkflow();

// Family album: ownerId = 'u-owner', albumUsers: Bob (viewer), Carol (editor).
// Resolvable: Alex (not a member), Alice, Bob, Carol, Pierre (owner).
const albumClient = (extra = {}) =>
  makeContractClient({
    albums: [
      {
        id: 'alb-1',
        albumName: 'Family',
        ownerId: 'u-owner',
        albumUsers: [
          { userId: 'u-bob', role: 'viewer' },
          { userId: 'u-carol', role: 'editor' },
        ],
      },
    ],
    users: [
      { userId: 'u-alex', name: 'Alex', email: 'alex@x.com' },
      { userId: 'u-alice', name: 'Alice', email: 'alice@x.com' },
      { userId: 'u-bob', name: 'Bob', email: 'bob@x.com' },
      { userId: 'u-carol', name: 'Carol', email: 'carol@x.com' },
      { userId: 'u-owner', name: 'Pierre', email: 'pierre@x.com' },
    ],
    ...extra,
  });

const albumOp = (client) => client.calls.find((c) => c.name === 'proposeAlbumOperations')?.args.operations[0];
const proposed = (client) => client.calls.some((c) => c.name === 'proposeAlbumOperations');

// ─── Router & slots ───────────────────────────────────────────────────────────

describe('change_album_member_role router & slots', () => {
  it('matches "make <user> an editor on the <album> album"', () => {
    const result = wf.match('make Alex an editor on the Family album');
    assert.ok(result, 'match must return a result');
    assert.deepEqual(result.slots.role, 'editor');
    assert.ok(/alex/i.test(result.slots.memberQuery));
    assert.ok(result.slots.albumRef);
  });

  it('matches "change Alex\'s role to viewer in the Family album"', () => {
    const result = wf.match("change Alex's role to viewer in the Family album");
    assert.ok(result);
    assert.equal(result.slots.role, 'viewer');
  });

  it('matches "make Alex a viewer on the Family album"', () => {
    const result = wf.match('make Alex a viewer on the Family album');
    assert.ok(result);
    assert.equal(result.slots.role, 'viewer');
  });

  it('DECLINES "make Alex an editor in the Family space" (space target → change_member_role owns it)', () => {
    assert.equal(wf.match('make Alex an editor in the Family space'), undefined);
  });

  it('DECLINES "make Alex an editor in Family" (no album/space noun → not this workflow)', () => {
    assert.equal(wf.match('make Alex an editor in Family'), undefined);
  });

  it('DECLINES non-role prompt "make Alex happy in the Family album"', () => {
    assert.equal(wf.match('make Alex happy in the Family album'), undefined);
  });

  it('returns undefined for an empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('normalizes role synonyms (contributor → editor)', () => {
    const result = wf.match('make Alex a contributor on the Family album');
    assert.ok(result);
    assert.equal(result.slots.role, 'editor');
  });

  it('normalizes role synonyms (reader → viewer)', () => {
    const result = wf.match('make Alex a reader on the Family album');
    assert.ok(result);
    assert.equal(result.slots.role, 'viewer');
  });

  it('strips trailing "album" from albumRef', () => {
    const result = wf.match('make Bob an editor on the Family album');
    assert.ok(result);
    // albumRef should not end with "album" after normalization
    assert.ok(!/\balbum$/i.test(result.slots.albumRef), `albumRef "${result.slots.albumRef}" should not end with "album"`);
  });

  it('is a strict workflow with an executable run', () => {
    assert.equal(wf.kind, 'change_album_member_role');
    assert.equal(wf.flow, 'strict');
    assert.equal(typeof wf.run, 'function');
  });

  it('parseSlots normalizes role + albumRef and requires all three slots', () => {
    const result = wf.parseSlots({ memberQuery: 'Alex', role: 'contributor', albumRef: 'the Family album' });
    assert.ok(result);
    assert.equal(result.role, 'editor');
    assert.equal(result.albumRef, 'Family'); // stripped
    assert.equal(result.memberQuery, 'Alex');
  });

  it('parseSlots returns null when any required slot is missing', () => {
    assert.equal(wf.parseSlots({ memberQuery: 'Alex', role: 'editor' }), null); // no albumRef
    assert.equal(wf.parseSlots({ role: 'editor', albumRef: 'Family' }), null); // no memberQuery
    assert.equal(wf.parseSlots({ memberQuery: 'Alex', role: 'bogus', albumRef: 'Family' }), null); // invalid role
  });

  it('captures owner intent ("make <user> the owner of the <album> album") without match failure', () => {
    // owner role is captured (run() will refuse it, but match must succeed)
    const result = wf.match('make Alex the owner of the Family album');
    assert.ok(result);
    assert.equal(result.slots.role, 'owner');
  });
});

// ─── Execution + guards ───────────────────────────────────────────────────────

describe('change_album_member_role execution + guards', () => {
  it('plans a viewer→editor change and proposes album.updateUserRole with correct payload', async () => {
    const client = albumClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Bob', role: 'editor', albumRef: 'Family' } });
    assert.equal(outcome.status, 'planned');
    assert.deepEqual(albumOp(client), {
      type: 'album.updateUserRole',
      summary: 'Update an album member\'s role.',
      targetKind: 'existing_album',
      targetId: 'alb-1',
      payload: { userId: 'u-bob', role: 'editor' },
    });
    // No raw user ids in the success copy
    assert.equal(outcome.text.includes('u-bob'), false);
  });

  it('plans an editor→viewer change', async () => {
    const client = albumClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Carol', role: 'viewer', albumRef: 'Family' } });
    assert.equal(outcome.status, 'planned');
    assert.deepEqual(albumOp(client).payload, { userId: 'u-carol', role: 'viewer' });
  });

  it('refuses to promote to owner (not assignable) without touching tools', async () => {
    const client = albumClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Bob', role: 'owner', albumRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.length, 0);
  });

  it('blocks changing the album owner\'s role (needsInput, no propose)', async () => {
    const client = albumClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Pierre', role: 'editor', albumRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('treats a no-op role change as needs_input (no propose)', async () => {
    const client = albumClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Bob', role: 'viewer', albumRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('asks for input when the target is not a member of the album', async () => {
    const client = albumClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Alex', role: 'editor', albumRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('asks which user when the member query is ambiguous ("Al" matches Alex and Alice)', async () => {
    const client = albumClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Al', role: 'editor', albumRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('asks which album when the album name is unknown', async () => {
    const client = albumClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Bob', role: 'editor', albumRef: 'Nope' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('fails when listAlbums, readAlbum, or searchUsers throws', async () => {
    const throwingOn = (toolName) => ({
      calls: [],
      async call(name) {
        this.calls.push({ name });
        if (name === toolName) throw new Error('boom');
        if (name === 'listAlbums') return { albums: [{ id: 'alb-1', albumName: 'Family' }] };
        if (name === 'readAlbum')
          return {
            album: {
              id: 'alb-1',
              albumName: 'Family',
              ownerId: 'u-owner',
              assetIds: [],
              albumThumbnailAssetId: null,
              albumUsers: [{ userId: 'u-bob', role: 'viewer' }],
            },
          };
        if (name === 'searchUsers') return { users: [{ userId: 'u-bob', name: 'Bob' }] };
        throw new Error(`unexpected ${name}`);
      },
    });
    for (const tool of ['listAlbums', 'readAlbum', 'searchUsers']) {
      const outcome = await wf.run({ client: throwingOn(tool), slots: { memberQuery: 'Bob', role: 'editor', albumRef: 'Family' } });
      assert.equal(outcome.status, 'failed', `expected failed when ${tool} throws`);
    }
  });

  it('fails (gate) without success copy when the plan has no persisted id', async () => {
    const client = albumClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({ client, slots: { memberQuery: 'Bob', role: 'editor', albumRef: 'Family' } });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared/i.test(outcome.text), false);
  });
});

// ─── D3: durable disambiguation (continuation) ────────────────────────────────

const NOW = 1_000_000;

// Two albums both named "Family" (ambiguous album).
const ambiguousAlbumClient = () =>
  makeContractClient({
    albums: [
      {
        id: 'alb-a',
        albumName: 'Family',
        ownerId: 'u-owner',
        albumUsers: [{ userId: 'u-bob', role: 'viewer' }],
      },
      {
        id: 'alb-b',
        albumName: 'Family',
        ownerId: 'u-owner',
        albumUsers: [{ userId: 'u-bob', role: 'viewer' }],
      },
    ],
    users: [
      { userId: 'u-bob', name: 'Bob', email: 'bob@x.com' },
      { userId: 'u-owner', name: 'Pierre', email: 'pierre@x.com' },
    ],
  });

// One album but two users matching "Al" (ambiguous user).
const ambiguousUserAlbumClient = () =>
  makeContractClient({
    albums: [
      {
        id: 'alb-1',
        albumName: 'Family',
        ownerId: 'u-owner',
        albumUsers: [
          { userId: 'u-alex', role: 'viewer' },
          { userId: 'u-alice', role: 'editor' },
        ],
      },
    ],
    users: [
      { userId: 'u-alex', name: 'Alex', email: 'alex@x.com' },
      { userId: 'u-alice', name: 'Alice', email: 'alice@x.com' },
      { userId: 'u-owner', name: 'Pierre', email: 'pierre@x.com' },
    ],
  });

describe('change_album_member_role durable disambiguation (D3)', () => {
  it('non-ambiguous path: plans directly, no continuation', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { memberQuery: 'Bob', role: 'editor', albumRef: 'Family' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'planned');
    assert.equal(outcome.continuation, undefined);
  });

  it('not-found album stays bare needs_input without a continuation', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { memberQuery: 'Bob', role: 'editor', albumRef: 'Nope' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(outcome.continuation, undefined);
  });

  it('ambiguous album yields needs_input with continuation (kind + candidates)', async () => {
    const client = ambiguousAlbumClient();
    const outcome = await wf.run({
      client,
      slots: { memberQuery: 'Bob', role: 'editor', albumRef: 'Family' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(outcome.continuation, 'continuation must be present');
    assert.equal(outcome.continuation.kind, 'change_album_member_role_album');
    assert.equal(Array.isArray(outcome.continuation.candidates), true);
    assert.equal(outcome.continuation.candidates.length, 2);
    for (const c of outcome.continuation.candidates) {
      assert.deepEqual(Object.keys(c).sort(), ['id', 'index', 'name']);
    }
    assert.ok(outcome.continuation.slots, 'slots must be carried');
    // albumUsers must not leak into candidates
    for (const c of outcome.continuation.candidates) {
      assert.equal('albumUsers' in c, false, 'candidate must not carry albumUsers');
    }
  });

  it('resume "the first one" resolves album, then plans when user is unambiguous', async () => {
    const client = ambiguousAlbumClient();
    // Turn 1: get the continuation
    const outcome1 = await wf.run({
      client,
      slots: { memberQuery: 'Bob', role: 'editor', albumRef: 'Family' },
      nowMs: NOW,
    });
    assert.equal(outcome1.status, 'needs_input');
    const pending = outcome1.continuation;

    // Turn 2: resume "the first one"
    const resumed = wf.resumeContinuation({ pending, prompt: 'the first one', nowMs: NOW + 1000 });
    assert.equal(resumed.status, 'matched');
    assert.equal(resumed.ctx.resolvedAlbumId, 'alb-a');
    assert.ok(resumed.ctx.slots, 'slots must be in ctx');

    // Turn 2 run: with resolvedAlbumId, proceed to plan Bob's role change
    const client2 = makeContractClient({
      albums: [
        {
          id: 'alb-a',
          albumName: 'Family',
          ownerId: 'u-owner',
          albumUsers: [{ userId: 'u-bob', role: 'viewer' }],
        },
        {
          id: 'alb-b',
          albumName: 'Family',
          ownerId: 'u-owner',
          albumUsers: [],
        },
      ],
      users: [
        { userId: 'u-bob', name: 'Bob', email: 'bob@x.com' },
        { userId: 'u-owner', name: 'Pierre', email: 'pierre@x.com' },
      ],
    });
    const outcome2 = await wf.run({
      client: client2,
      slots: resumed.ctx.slots,
      resolvedAlbumId: resumed.ctx.resolvedAlbumId,
      nowMs: NOW + 1000,
    });
    assert.equal(outcome2.status, 'planned');
  });

  it('two-stage: album resolved but ambiguous user yields continuation with resolvedAlbumId', async () => {
    const client = ambiguousUserAlbumClient();
    const outcome = await wf.run({
      client,
      slots: { memberQuery: 'Al', role: 'editor', albumRef: 'Family' },
      resolvedAlbumId: 'alb-1',
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(outcome.continuation, 'continuation must be present');
    assert.equal(outcome.continuation.kind, 'change_album_member_role_user');
    assert.equal(outcome.continuation.candidates.length, 2);
    // resolvedAlbumId must be carried so the next run skips album lookup
    assert.equal(outcome.continuation.resolvedAlbumId, 'alb-1');
    assert.ok(outcome.continuation.slots, 'slots must be carried');
  });

  it('resume "2" picks the 2nd user; run with resolvedAlbumId+resolvedUserId proposes', async () => {
    const pending = {
      kind: 'change_album_member_role_user',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'u-alex', name: 'Alex' },
        { index: 2, id: 'u-alice', name: 'Alice' },
      ],
      resolvedAlbumId: 'alb-1',
      slots: { memberQuery: 'Al', role: 'editor', albumRef: 'Family' },
    };
    const resumed = wf.resumeContinuation({ pending, prompt: '2', nowMs: NOW + 500 });
    assert.equal(resumed.status, 'matched');
    assert.equal(resumed.ctx.resolvedUserId, 'u-alice');
    assert.equal(resumed.ctx.resolvedAlbumId, 'alb-1');

    // Run with both resolved ids
    const client2 = makeContractClient({
      albums: [
        {
          id: 'alb-1',
          albumName: 'Family',
          ownerId: 'u-owner',
          albumUsers: [
            { userId: 'u-alice', role: 'viewer' },
          ],
        },
      ],
      users: [
        { userId: 'u-alex', name: 'Alex', email: 'alex@x.com' },
        { userId: 'u-alice', name: 'Alice', email: 'alice@x.com' },
        { userId: 'u-owner', name: 'Pierre', email: 'pierre@x.com' },
      ],
    });
    const outcome = await wf.run({
      client: client2,
      slots: resumed.ctx.slots,
      resolvedAlbumId: resumed.ctx.resolvedAlbumId,
      resolvedUserId: resumed.ctx.resolvedUserId,
      nowMs: NOW + 500,
    });
    assert.equal(outcome.status, 'planned');
    assert.deepEqual(albumOp(client2).payload, { userId: 'u-alice', role: 'editor' });
  });

  it('out-of-range ordinal in resume → needs_input', () => {
    const pending = {
      kind: 'change_album_member_role_album',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'alb-a', name: 'Family' },
        { index: 2, id: 'alb-b', name: 'Family' },
      ],
      slots: { memberQuery: 'Bob', role: 'editor', albumRef: 'Family' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '5', nowMs: NOW + 1000 });
    assert.equal(result.status, 'needs_input');
  });

  it('name not in list → needs_input', () => {
    const pending = {
      kind: 'change_album_member_role_album',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'alb-a', name: 'Family' },
        { index: 2, id: 'alb-b', name: 'Family 2' },
      ],
      slots: { memberQuery: 'Bob', role: 'editor', albumRef: 'Family' },
    };
    const result = wf.resumeContinuation({ pending, prompt: 'Trips', nowMs: NOW + 1000 });
    assert.equal(result.status, 'needs_input');
  });

  it('expired continuation → expired message', () => {
    const pending = {
      kind: 'change_album_member_role_album',
      createdAtMs: NOW,
      candidates: [{ index: 1, id: 'alb-a', name: 'Family' }],
      slots: { memberQuery: 'Bob', role: 'editor', albumRef: 'Family' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: NOW + 15 * 60 * 1000 });
    assert.equal(result.status, 'expired');
    assert.match(result.text, /expired/i);
  });

  it('zero user matches stays bare needs_input without continuation', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { memberQuery: 'Zzz', role: 'editor', albumRef: 'Family' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(outcome.continuation, undefined);
  });

  it('wrong continuation kind → needs_input (cannot resume unrelated pending)', () => {
    const pending = {
      kind: 'manage_album_access_album', // wrong kind for this workflow
      createdAtMs: NOW,
      candidates: [{ index: 1, id: 'alb-a', name: 'Family' }],
      slots: { memberQuery: 'Bob', role: 'editor', albumRef: 'Family' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: NOW + 1000 });
    assert.equal(result.status, 'needs_input');
  });

  it('workflow exposes resumeContinuation', () => {
    assert.equal(typeof wf.resumeContinuation, 'function');
  });
});
