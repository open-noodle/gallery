import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { manageAlbumAccessWorkflow } from './manage-album-access.mjs';
import { makeContractClient } from './contract-fixtures.mjs';

const wf = manageAlbumAccessWorkflow();

// Family album: Pierre (owner) + Bob (viewer). Resolvable users: Alex, Alice, Bob, Pierre.
const albumClient = (extra = {}) =>
  makeContractClient({
    albums: [
      {
        id: 'alb-1',
        albumName: 'Family',
        ownerId: 'u-owner',
        assetIds: [],
        albumUsers: [{ userId: 'u-bob', role: 'viewer' }],
      },
    ],
    users: [
      { userId: 'u-alex', name: 'Alex', email: 'alex@x.com' },
      { userId: 'u-alice', name: 'Alice', email: 'alice@x.com' },
      { userId: 'u-bob', name: 'Bob', email: 'bob@x.com' },
      { userId: 'u-owner', name: 'Pierre', email: 'pierre@x.com' },
    ],
    ...extra,
  });

const albumOp = (client) => client.calls.find((c) => c.name === 'proposeAlbumOperations')?.args.operations[0];
const proposed = (client) => client.calls.some((c) => c.name === 'proposeAlbumOperations');

describe('manage_album_access router & slots', () => {
  it('matches "share <album> with <users>" — add viewer', () => {
    const result = wf.match('share Family with Alex');
    assert.ok(result, 'expected a match');
    assert.equal(result.slots.action, 'add');
    assert.deepEqual(result.slots.memberQueries, ['Alex']);
    assert.equal(result.slots.albumRef.toLowerCase(), 'family');
  });

  it('matches "give <users> edit access to <album>" — add editor', () => {
    const result = wf.match('give Alex edit access to Family album');
    assert.ok(result, 'expected a match');
    assert.equal(result.slots.action, 'add');
    assert.equal(result.slots.role, 'editor');
    assert.deepEqual(result.slots.memberQueries, ['Alex']);
  });

  it('matches "give <users> access to <album>" without edit — add viewer', () => {
    const result = wf.match('give Alex access to the Family album');
    assert.ok(result, 'expected a match');
    assert.equal(result.slots.action, 'add');
    // no role specified → undefined or viewer (parseSlots will default)
  });

  it('matches "add <users> to <album>" when album keyword present', () => {
    const result = wf.match('add Alex to the Family album');
    assert.ok(result, 'expected a match');
    assert.equal(result.slots.action, 'add');
    assert.deepEqual(result.slots.memberQueries, ['Alex']);
  });

  it('matches "remove <users> from <album>" when album keyword present', () => {
    const result = wf.match('remove Sam from the Beach album');
    assert.ok(result, 'expected a match');
    assert.equal(result.slots.action, 'remove');
    assert.deepEqual(result.slots.memberQueries, ['Sam']);
  });

  // DECLINE cases
  it('declines "share the Family album as a link" — leave for share_album', () => {
    assert.equal(wf.match('share the Family album as a link'), undefined);
  });

  it('declines "add Alex to the Family space" — leave for manage_space_members', () => {
    assert.equal(wf.match('add Alex to the Family space'), undefined);
  });

  it('declines "share my newest 20 photos as a link" — leave for share_assets', () => {
    assert.equal(wf.match('share my newest 20 photos as a link'), undefined);
  });

  it('declines "add these photos to the Family album" — photo source', () => {
    assert.equal(wf.match('add these photos to the Family album'), undefined);
  });

  it('declines a "public link" share prompt', () => {
    assert.equal(wf.match('create a public link for the Family album'), undefined);
  });

  it('declines "share link" prompts', () => {
    assert.equal(wf.match('create a share link for my photos'), undefined);
  });

  it('returns undefined for an empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('parseSlots defaults the add role to viewer', () => {
    const slots = wf.parseSlots({ action: 'add', memberQueries: ['Alex'], albumRef: 'Family' });
    assert.equal(slots.role, 'viewer');
  });

  it('parseSlots maps editor synonyms', () => {
    assert.equal(
      wf.parseSlots({ action: 'add', memberQueries: ['Alex'], albumRef: 'Family', role: 'edit' }).role,
      'editor',
    );
    assert.equal(
      wf.parseSlots({ action: 'add', memberQueries: ['Alex'], albumRef: 'Family', role: 'contributor' }).role,
      'editor',
    );
  });

  it('parseSlots returns null for missing albumRef', () => {
    assert.equal(wf.parseSlots({ action: 'add', memberQueries: ['Alex'] }), null);
  });

  it('parseSlots returns null for missing memberQueries', () => {
    assert.equal(wf.parseSlots({ action: 'add', albumRef: 'Family', memberQueries: [] }), null);
  });

  it('parseSlots infers add from prompt verb when action slot missing', () => {
    assert.equal(
      wf.parseSlots({ memberQueries: ['Alex'], albumRef: 'Family' }, 'share Family with Alex').action,
      'add',
    );
    assert.equal(
      wf.parseSlots({ memberQueries: ['Bob'], albumRef: 'Family' }, 'remove Bob from the Beach album').action,
      'remove',
    );
  });

  it('parseSlots accepts an LLM and/comma member string', () => {
    assert.deepEqual(wf.parseSlots({ action: 'add', albumRef: 'Family', memberQueries: 'Alex and Sam' }).memberQueries, [
      'Alex',
      'Sam',
    ]);
  });

  it('is a strict workflow with an executable run', () => {
    assert.equal(wf.kind, 'manage_album_access');
    assert.equal(wf.flow, 'strict');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('manage_album_access execution + safety guards', () => {
  it('plans a unique add as viewer and keeps user ids out of the copy', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Alex'], albumRef: 'Family', role: 'viewer' },
    });
    assert.equal(outcome.status, 'planned');
    assert.deepEqual(albumOp(client), {
      type: 'album.addUsers',
      summary: 'Update album shared users.',
      targetKind: 'existing_album',
      targetId: 'alb-1',
      payload: { albumUsers: [{ userId: 'u-alex', role: 'viewer' }] },
    });
    assert.equal(outcome.text.includes('u-alex'), false);
  });

  it('plans a unique add as editor', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Alex'], albumRef: 'Family', role: 'editor' },
    });
    assert.equal(outcome.status, 'planned');
    assert.deepEqual(albumOp(client).payload, { albumUsers: [{ userId: 'u-alex', role: 'editor' }] });
  });

  it('already-a-member add → needsInput, no propose', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Bob'], albumRef: 'Family', role: 'viewer' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('owner target on add → needsInput, no propose', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Pierre'], albumRef: 'Family', role: 'viewer' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('remove non-member → needsInput, no propose', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'remove', memberQueries: ['Alex'], albumRef: 'Family' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('remove owner → needsInput, no propose', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'remove', memberQueries: ['Pierre'], albumRef: 'Family' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('plans a member removal', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'remove', memberQueries: ['Bob'], albumRef: 'Family' },
    });
    assert.equal(outcome.status, 'planned');
    assert.deepEqual(albumOp(client), {
      type: 'album.removeUsers',
      summary: 'Update album shared users.',
      targetKind: 'existing_album',
      targetId: 'alb-1',
      payload: { userIds: ['u-bob'] },
    });
    assert.equal(outcome.text.includes('u-bob'), false);
  });

  it('asks for input when user is not found (no propose)', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Zzz'], albumRef: 'Family', role: 'viewer' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('asks which user when the member query is ambiguous (no propose)', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Al'], albumRef: 'Family', role: 'viewer' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('asks which album when the album name is not found (no propose)', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Alex'], albumRef: 'Nope', role: 'viewer' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('ambiguous album → needsInput with continuation, no propose', async () => {
    const client = makeContractClient({
      albums: [
        { id: 'alb-a', albumName: 'Family', ownerId: 'u-owner', assetIds: [], albumUsers: [] },
        { id: 'alb-b', albumName: 'Family', ownerId: 'u-owner', assetIds: [], albumUsers: [] },
      ],
      users: [{ userId: 'u-alex', name: 'Alex', email: 'alex@x.com' }],
    });
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Alex'], albumRef: 'Family', role: 'viewer' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(outcome.continuation, 'continuation must be present');
    assert.equal(outcome.continuation.kind, 'manage_album_access_album');
    assert.equal(proposed(client), false);
  });

  it('ambiguous user → needsInput with continuation carrying resolvedAlbumId', async () => {
    const client = makeContractClient({
      albums: [{ id: 'alb-1', albumName: 'Family', ownerId: 'u-owner', assetIds: [], albumUsers: [] }],
      users: [
        { userId: 'u-alex', name: 'Alex', email: 'alex@x.com' },
        { userId: 'u-alice', name: 'Alice', email: 'alice@x.com' },
      ],
    });
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Al'], albumRef: 'Family', role: 'viewer' },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(outcome.continuation, 'continuation must be present');
    assert.equal(outcome.continuation.kind, 'manage_album_access_user');
    assert.equal(outcome.continuation.resolvedAlbumId, 'alb-1');
    assert.equal(proposed(client), false);
  });

  it('fails (gate) without success copy when the plan has no persisted id', async () => {
    const client = albumClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Alex'], albumRef: 'Family', role: 'editor' },
    });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared/i.test(outcome.text), false);
  });
});

// ─── D2: durable disambiguation (continuation) ────────────────────────────────

const NOW = 1_000_000;

describe('manage_album_access durable disambiguation (D2)', () => {
  it('non-ambiguous path: plans directly, no continuation', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Alex'], albumRef: 'Family', role: 'viewer' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'planned');
    assert.equal(outcome.continuation, undefined);
  });

  it('not-found album stays bare needs_input without a continuation', async () => {
    const client = albumClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Alex'], albumRef: 'Nope', role: 'viewer' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(outcome.continuation, undefined);
  });

  it('ambiguous album yields needs_input with continuation (kind + candidates)', async () => {
    const client = makeContractClient({
      albums: [
        { id: 'alb-a', albumName: 'Family', ownerId: 'u-owner', assetIds: [], albumUsers: [] },
        { id: 'alb-b', albumName: 'Family', ownerId: 'u-owner', assetIds: [], albumUsers: [] },
      ],
      users: [{ userId: 'u-alex', name: 'Alex', email: 'alex@x.com' }],
    });
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Alex'], albumRef: 'Family', role: 'viewer' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(outcome.continuation, 'continuation must be present');
    assert.equal(outcome.continuation.kind, 'manage_album_access_album');
    assert.equal(Array.isArray(outcome.continuation.candidates), true);
    assert.equal(outcome.continuation.candidates.length, 2);
    for (const c of outcome.continuation.candidates) {
      assert.deepEqual(Object.keys(c).sort(), ['id', 'index', 'name']);
    }
    assert.ok(outcome.continuation.slots, 'slots must be carried');
  });

  it('resume "the first one" resolves album, then plans when user is unambiguous', async () => {
    const client = makeContractClient({
      albums: [
        { id: 'alb-a', albumName: 'Family', ownerId: 'u-owner', assetIds: [], albumUsers: [] },
        { id: 'alb-b', albumName: 'Family', ownerId: 'u-owner', assetIds: [], albumUsers: [] },
      ],
      users: [{ userId: 'u-alex', name: 'Alex', email: 'alex@x.com' }],
    });
    // Turn 1: get continuation
    const outcome1 = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Alex'], albumRef: 'Family', role: 'viewer' },
      nowMs: NOW,
    });
    assert.equal(outcome1.status, 'needs_input');
    const pending = outcome1.continuation;

    // Resume with "the first one"
    const resumed = wf.resumeContinuation({ pending, prompt: 'the first one', nowMs: NOW + 1000 });
    assert.equal(resumed.status, 'matched');
    assert.equal(resumed.ctx.resolvedAlbumId, 'alb-a');
    assert.ok(resumed.ctx.slots, 'slots must be in ctx');

    // Turn 2 run with resolvedAlbumId
    const client2 = makeContractClient({
      albums: [
        { id: 'alb-a', albumName: 'Family', ownerId: 'u-owner', assetIds: [], albumUsers: [] },
        { id: 'alb-b', albumName: 'Family', ownerId: 'u-owner', assetIds: [], albumUsers: [] },
      ],
      users: [{ userId: 'u-alex', name: 'Alex', email: 'alex@x.com' }],
    });
    const outcome2 = await wf.run({
      client: client2,
      slots: resumed.ctx.slots,
      resolvedAlbumId: resumed.ctx.resolvedAlbumId,
      nowMs: NOW + 1000,
    });
    assert.equal(outcome2.status, 'planned');
  });

  it('two-stage: album resolved, user ambiguous → continuation with resolvedAlbumId', async () => {
    const client = makeContractClient({
      albums: [{ id: 'alb-1', albumName: 'Family', ownerId: 'u-owner', assetIds: [], albumUsers: [] }],
      users: [
        { userId: 'u-alex', name: 'Alex', email: 'alex@x.com' },
        { userId: 'u-alice', name: 'Alice', email: 'alice@x.com' },
      ],
    });
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Al'], albumRef: 'Family', role: 'viewer' },
      resolvedAlbumId: 'alb-1',
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(outcome.continuation, 'continuation must be present');
    assert.equal(outcome.continuation.kind, 'manage_album_access_user');
    assert.equal(outcome.continuation.candidates.length, 2);
    assert.equal(outcome.continuation.resolvedAlbumId, 'alb-1');
    assert.ok(outcome.continuation.slots, 'slots must be carried');
  });

  it('resume "2" picks the 2nd user; run with resolvedAlbumId+resolvedUserId proposes', async () => {
    const pending = {
      kind: 'manage_album_access_user',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'u-alex', name: 'Alex' },
        { index: 2, id: 'u-alice', name: 'Alice' },
      ],
      resolvedAlbumId: 'alb-1',
      slots: { action: 'add', memberQueries: ['Al'], albumRef: 'Family', role: 'viewer' },
    };
    const resumed = wf.resumeContinuation({ pending, prompt: '2', nowMs: NOW + 500 });
    assert.equal(resumed.status, 'matched');
    assert.equal(resumed.ctx.resolvedUserId, 'u-alice');
    assert.equal(resumed.ctx.resolvedAlbumId, 'alb-1');

    const client2 = makeContractClient({
      albums: [{ id: 'alb-1', albumName: 'Family', ownerId: 'u-owner', assetIds: [], albumUsers: [] }],
      users: [
        { userId: 'u-alex', name: 'Alex', email: 'alex@x.com' },
        { userId: 'u-alice', name: 'Alice', email: 'alice@x.com' },
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
  });

  it('out-of-range ordinal in resume → needs_input', () => {
    const pending = {
      kind: 'manage_album_access_album',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'alb-a', name: 'Family' },
        { index: 2, id: 'alb-b', name: 'Family' },
      ],
      slots: { action: 'add', memberQueries: ['Alex'], albumRef: 'Family', role: 'viewer' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '5', nowMs: NOW + 1000 });
    assert.equal(result.status, 'needs_input');
  });

  it('expired continuation → expired message', () => {
    const pending = {
      kind: 'manage_album_access_album',
      createdAtMs: NOW,
      candidates: [{ index: 1, id: 'alb-a', name: 'Family' }],
      slots: { action: 'add', memberQueries: ['Alex'], albumRef: 'Family', role: 'viewer' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: NOW + 15 * 60 * 1000 });
    assert.equal(result.status, 'expired');
    assert.match(result.text, /expired/i);
  });

  it('workflow exposes resumeContinuation', () => {
    assert.equal(typeof wf.resumeContinuation, 'function');
  });
});
