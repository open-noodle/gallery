import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { manageSpaceMembersWorkflow } from './manage-space-members.mjs';
import { makeContractClient } from './contract-fixtures.mjs';

const wf = manageSpaceMembersWorkflow();

// Family space: Pierre (owner) + Bob (viewer). Resolvable users: Alex, Alice, Bob, Pierre.
const spaceClient = (extra = {}) =>
  makeContractClient({
    spaces: [
      {
        id: 'spc-1',
        name: 'Family',
        members: [
          { userId: 'u-owner', name: 'Pierre', role: 'owner' },
          { userId: 'u-bob', name: 'Bob', role: 'viewer' },
        ],
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

const spaceOp = (client) => client.calls.find((c) => c.name === 'proposeAlbumOperations')?.args.operations[0];
const proposed = (client) => client.calls.some((c) => c.name === 'proposeAlbumOperations');

describe('manage_space_members router & slots', () => {
  it('matches "add <user> to the <space> space as <role>"', () => {
    assert.deepEqual(wf.match('add Alex to the Family space as editor'), {
      slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'editor' },
    });
  });

  it('matches an add without a role (gated by the space keyword)', () => {
    assert.deepEqual(wf.match('add Sam to the Trips space'), {
      slots: { action: 'add', memberQueries: ['Sam'], spaceRef: 'Trips' },
    });
  });

  it('splits multiple members', () => {
    assert.deepEqual(wf.match('add Alex and Sam to the Family space'), {
      slots: { action: 'add', memberQueries: ['Alex', 'Sam'], spaceRef: 'Family' },
    });
  });

  it('accepts a role gate without the "space" word', () => {
    assert.deepEqual(wf.match('add Alex to Family as a viewer'), {
      slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'viewer' },
    });
  });

  it('matches a remove with the space keyword', () => {
    assert.deepEqual(wf.match('remove Alex from the Family space'), {
      slots: { action: 'remove', memberQueries: ['Alex'], spaceRef: 'Family' },
    });
  });

  it('declines a remove with no space keyword', () => {
    assert.equal(wf.match('remove Alex from Family'), undefined);
  });

  it('does not steal a photo add or a tag add', () => {
    assert.equal(wf.match('add my newest 20 photos to Family'), undefined);
    assert.equal(wf.match('add the tag Spring Break to my newest 50 photos'), undefined);
  });

  it('declines a photo-source member capture even when a space is named', () => {
    // "add <photos> to the X space" must not be read as adding members.
    assert.equal(wf.match('add my newest 20 photos to the Family space'), undefined);
    assert.equal(wf.match('remove my screenshots from the Family space'), undefined);
    // A real member add still matches.
    assert.deepEqual(wf.match('add Alex to the Family space'), {
      slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Family' },
    });
  });

  it('returns undefined for an empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('parseSlots defaults the add role to viewer', () => {
    assert.equal(wf.parseSlots({ action: 'add', memberQueries: ['Alex'], spaceRef: 'Family' }).role, 'viewer');
  });

  it('parseSlots normalizes role synonyms', () => {
    assert.equal(
      wf.parseSlots({ action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'contributor' }).role,
      'editor',
    );
    assert.equal(
      wf.parseSlots({ action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'admin' }).role,
      'owner',
    );
  });

  it('parseSlots infers the action from the prompt verb when the slot is missing', () => {
    // The LLM routed "invite Alex to the Family space" but omitted action.
    assert.equal(
      wf.parseSlots({ memberQueries: ['Alex'], spaceRef: 'Family' }, 'invite Alex to the Family space').action,
      'add',
    );
    assert.equal(
      wf.parseSlots({ memberQueries: ['Bob'], spaceRef: 'Family' }, 'kick Bob from the Family space').action,
      'remove',
    );
    // No add/remove signal anywhere → still null.
    assert.equal(wf.parseSlots({ memberQueries: ['Alex'], spaceRef: 'Family' }, 'the Family space'), null);
  });

  it('parseSlots accepts an LLM and/comma member string', () => {
    assert.deepEqual(wf.parseSlots({ action: 'add', spaceRef: 'Family', memberQueries: 'Alex and Sam' }).memberQueries, [
      'Alex',
      'Sam',
    ]);
  });

  it('parseSlots drops role on remove', () => {
    const slots = wf.parseSlots({ action: 'remove', memberQueries: ['Alex'], spaceRef: 'Family', role: 'editor' });
    assert.equal('role' in slots, false);
  });

  it('parseSlots rejects empty members, empty space, or a bad action', () => {
    assert.equal(wf.parseSlots({ action: 'add', spaceRef: 'Family', memberQueries: [] }), null);
    assert.equal(wf.parseSlots({ action: 'add', memberQueries: ['Alex'] }), null);
    assert.equal(wf.parseSlots({ action: 'frobnicate', spaceRef: 'Family', memberQueries: ['Alex'] }), null);
  });

  it('is a strict workflow with an executable run', () => {
    assert.equal(wf.kind, 'manage_space_members');
    assert.equal(wf.flow, 'strict');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('manage_space_members execution + safety guards', () => {
  it('plans a unique add with a role and keeps user ids out of the copy', async () => {
    const client = spaceClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'editor' },
    });
    assert.equal(outcome.status, 'planned');
    assert.deepEqual(spaceOp(client), {
      type: 'space.addMembers',
      summary: 'Update space members.',
      targetKind: 'existing_space',
      targetId: 'spc-1',
      payload: { members: [{ userId: 'u-alex', role: 'editor' }] },
    });
    assert.equal(outcome.text.includes('u-alex'), false);
  });

  it('asks which user when the member query is ambiguous (no propose)', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { action: 'add', memberQueries: ['Al'], spaceRef: 'Family', role: 'viewer' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('asks for input when a member is not found (no propose)', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { action: 'add', memberQueries: ['Zzz'], spaceRef: 'Family', role: 'viewer' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('does not re-add an existing member (already-member → needs_input)', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { action: 'add', memberQueries: ['Bob'], spaceRef: 'Family', role: 'editor' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('skips an already-present member and plans only the new ones', async () => {
    const client = spaceClient();
    // Bob is already a viewer member; Alex is new. Plan adds only Alex.
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Bob', 'Alex'], spaceRef: 'Family', role: 'viewer' },
    });
    assert.equal(outcome.status, 'planned');
    assert.deepEqual(spaceOp(client).payload, { members: [{ userId: 'u-alex', role: 'viewer' }] });
  });

  it('plans a member removal (no user ids in the copy)', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { action: 'remove', memberQueries: ['Bob'], spaceRef: 'Family' } });
    assert.equal(outcome.status, 'planned');
    assert.deepEqual(spaceOp(client), {
      type: 'space.removeMembers',
      summary: 'Update space members.',
      targetKind: 'existing_space',
      targetId: 'spc-1',
      payload: { userIds: ['u-bob'] },
    });
    assert.equal(outcome.text.includes('u-bob'), false);
  });

  it('asks for input when removing a non-member (no propose)', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { action: 'remove', memberQueries: ['Alex'], spaceRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('blocks removing the space owner (covers self + last-owner) → needs_input', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { action: 'remove', memberQueries: ['Pierre'], spaceRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('refuses to add a member as owner (owner is not assignable) → needs_input', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'owner' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('asks which space when the space is unknown or ambiguous', async () => {
    const unknown = spaceClient();
    assert.equal(
      (await wf.run({ unknown, client: unknown, slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Nope', role: 'viewer' } })).status,
      'needs_input',
    );
    const ambiguous = makeContractClient({
      spaces: [
        { id: 'a', name: 'Family', members: [] },
        { id: 'b', name: 'Family', members: [] },
      ],
      users: [{ userId: 'u-alex', name: 'Alex', email: 'alex@x.com' }],
    });
    const outcome = await wf.run({ client: ambiguous, slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'viewer' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(ambiguous), false);
  });

  it('fails when listSpaces, readSpace, or searchUsers throws', async () => {
    const throwingOn = (toolName) => ({
      calls: [],
      async call(name) {
        this.calls.push({ name });
        if (name === toolName) throw new Error('boom');
        if (name === 'listSpaces') return { spaces: [{ id: 'spc-1', name: 'Family' }] };
        if (name === 'readSpace') return { space: { id: 'spc-1', name: 'Family', members: [] } };
        if (name === 'searchUsers') return { users: [{ userId: 'u-alex', name: 'Alex' }] };
        throw new Error(`unexpected ${name}`);
      },
    });
    for (const tool of ['listSpaces', 'readSpace', 'searchUsers']) {
      const outcome = await wf.run({
        client: throwingOn(tool),
        slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'viewer' },
      });
      assert.equal(outcome.status, 'failed', `expected failed when ${tool} throws`);
    }
  });

  it('fails (gate) without success copy when the plan has no persisted id', async () => {
    const client = spaceClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({ client, slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'editor' } });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared/i.test(outcome.text), false);
  });
});

// ─── D2: durable disambiguation (continuation) ────────────────────────────────

const NOW = 1_000_000;

// A client with two spaces both named "Family" (ambiguous space).
const ambiguousSpaceClient = () =>
  makeContractClient({
    spaces: [
      { id: 'spc-a', name: 'Family', members: [] },
      { id: 'spc-b', name: 'Family', members: [] },
    ],
    users: [{ userId: 'u-alex', name: 'Alex', email: 'alex@x.com' }],
  });

// A client with one space but two users matching "Al" (ambiguous user).
const ambiguousUserClient = () =>
  makeContractClient({
    spaces: [{ id: 'spc-1', name: 'Family', members: [{ userId: 'u-owner', name: 'Pierre', role: 'owner' }] }],
    users: [
      { userId: 'u-alex', name: 'Alex', email: 'alex@x.com' },
      { userId: 'u-alice', name: 'Alice', email: 'alice@x.com' },
    ],
  });

describe('manage_space_members durable disambiguation (D2)', () => {
  // ── non-ambiguous path unchanged (regression) ────────────────────────────────
  it('non-ambiguous path: plans directly, no continuation', async () => {
    const client = spaceClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'viewer' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'planned');
    assert.equal(outcome.continuation, undefined);
  });

  // ── "not found" keeps bare needs_input (no empty candidate list) ─────────────
  it('not-found space stays bare needs_input without a continuation', async () => {
    const client = spaceClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Nope', role: 'viewer' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(outcome.continuation, undefined);
  });

  // ── ambiguous SPACE: produces continuation with kind + candidates ─────────────
  it('ambiguous space yields needs_input with continuation (kind + candidates, no raw ids leaked)', async () => {
    const client = ambiguousSpaceClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'viewer' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(outcome.continuation, 'continuation must be present');
    assert.equal(outcome.continuation.kind, 'manage_space_members_space');
    assert.equal(Array.isArray(outcome.continuation.candidates), true);
    assert.equal(outcome.continuation.candidates.length, 2);
    // Candidates must be {index,id,name} only — no raw extra fields from the space.
    for (const c of outcome.continuation.candidates) {
      assert.deepEqual(Object.keys(c).sort(), ['id', 'index', 'name']);
    }
    // slots are carried for the next stage
    assert.ok(outcome.continuation.slots, 'slots must be carried');
    // no raw space members arrays leaked into the continuation
    // (the kind string contains 'members' so we check the candidates array directly)
    for (const c of outcome.continuation.candidates) {
      assert.equal('members' in c, false, 'candidate must not carry a members array');
    }
  });

  // ── resume space: "the first one" picks spc-a → proceeds to plan (user unambiguous) ──
  it('resume "the first one" resolves space, then plans when user is unambiguous', async () => {
    const client = ambiguousSpaceClient();
    // Turn 1: get the continuation
    const outcome1 = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'viewer' },
      nowMs: NOW,
    });
    assert.equal(outcome1.status, 'needs_input');
    const pending = outcome1.continuation;

    // Turn 2: resume "the first one"
    const resumed = wf.resumeContinuation({ pending, prompt: 'the first one', nowMs: NOW + 1000 });
    assert.equal(resumed.status, 'matched');
    assert.equal(resumed.ctx.resolvedSpaceId, 'spc-a');
    assert.ok(resumed.ctx.slots, 'slots must be in ctx');

    // Turn 2 run: with resolvedSpaceId, the client with spc-a must have member data
    const client2 = makeContractClient({
      spaces: [
        { id: 'spc-a', name: 'Family', members: [{ userId: 'u-owner', name: 'Pierre', role: 'owner' }] },
        { id: 'spc-b', name: 'Family', members: [] },
      ],
      users: [{ userId: 'u-alex', name: 'Alex', email: 'alex@x.com' }],
    });
    const outcome2 = await wf.run({
      client: client2,
      slots: resumed.ctx.slots,
      resolvedSpaceId: resumed.ctx.resolvedSpaceId,
      nowMs: NOW + 1000,
    });
    assert.equal(outcome2.status, 'planned');
  });

  // ── two-stage: space resolved, user ambiguous → continuation with resolvedSpaceId ──
  it('two-stage: space resolved but ambiguous user yields continuation with resolvedSpaceId', async () => {
    const client = ambiguousUserClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', memberQueries: ['Al'], spaceRef: 'Family', role: 'viewer' },
      resolvedSpaceId: 'spc-1',
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(outcome.continuation, 'continuation must be present');
    assert.equal(outcome.continuation.kind, 'manage_space_members_user');
    assert.equal(outcome.continuation.candidates.length, 2);
    // resolvedSpaceId must be carried so the next run skips space lookup
    assert.equal(outcome.continuation.resolvedSpaceId, 'spc-1');
    assert.ok(outcome.continuation.slots, 'slots must be carried');
  });

  // ── resume user: "2" picks the 2nd user → run() with resolvedSpaceId+resolvedUserId proposes ──
  it('resume "2" picks the 2nd user; run with resolvedSpaceId+resolvedUserId proposes', async () => {
    const client = ambiguousUserClient();
    // Simulate the continuation already stored after stage-1 resolved
    const pending = {
      kind: 'manage_space_members_user',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'u-alex', name: 'Alex' },
        { index: 2, id: 'u-alice', name: 'Alice' },
      ],
      resolvedSpaceId: 'spc-1',
      slots: { action: 'add', memberQueries: ['Al'], spaceRef: 'Family', role: 'viewer' },
    };
    const resumed = wf.resumeContinuation({ pending, prompt: '2', nowMs: NOW + 500 });
    assert.equal(resumed.status, 'matched');
    assert.equal(resumed.ctx.resolvedUserId, 'u-alice');
    assert.equal(resumed.ctx.resolvedSpaceId, 'spc-1');

    // Run with both resolved ids
    const client2 = makeContractClient({
      spaces: [{ id: 'spc-1', name: 'Family', members: [{ userId: 'u-owner', name: 'Pierre', role: 'owner' }] }],
      users: [
        { userId: 'u-alex', name: 'Alex', email: 'alex@x.com' },
        { userId: 'u-alice', name: 'Alice', email: 'alice@x.com' },
      ],
    });
    const outcome = await wf.run({
      client: client2,
      slots: resumed.ctx.slots,
      resolvedSpaceId: resumed.ctx.resolvedSpaceId,
      resolvedUserId: resumed.ctx.resolvedUserId,
      nowMs: NOW + 500,
    });
    assert.equal(outcome.status, 'planned');
  });

  // ── edge: out-of-range ordinal → needs_input (keeps pending) ─────────────────
  it('out-of-range ordinal in resume → needs_input', () => {
    const pending = {
      kind: 'manage_space_members_space',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'spc-a', name: 'Family' },
        { index: 2, id: 'spc-b', name: 'Family' },
      ],
      slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'viewer' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '5', nowMs: NOW + 1000 });
    assert.equal(result.status, 'needs_input');
  });

  // ── edge: name not in list → needs_input ─────────────────────────────────────
  it('name not in list → needs_input', () => {
    const pending = {
      kind: 'manage_space_members_space',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'spc-a', name: 'Family' },
        { index: 2, id: 'spc-b', name: 'Family 2' },
      ],
      slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'viewer' },
    };
    const result = wf.resumeContinuation({ pending, prompt: 'Trips', nowMs: NOW + 1000 });
    assert.equal(result.status, 'needs_input');
  });

  // ── edge: expired continuation → expired message ──────────────────────────────
  it('expired continuation → expired message', () => {
    const pending = {
      kind: 'manage_space_members_space',
      createdAtMs: NOW,
      candidates: [{ index: 1, id: 'spc-a', name: 'Family' }],
      slots: { action: 'add', memberQueries: ['Alex'], spaceRef: 'Family', role: 'viewer' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: NOW + 15 * 60 * 1000 });
    assert.equal(result.status, 'expired');
    assert.match(result.text, /expired/i);
  });

  // ── resumeContinuation is exposed on the workflow object ─────────────────────
  it('workflow exposes resumeContinuation', () => {
    assert.equal(typeof wf.resumeContinuation, 'function');
  });
});
