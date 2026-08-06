import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changeMemberRoleWorkflow } from './change-member-role.mjs';
import { makeContractClient } from './contract-fixtures.mjs';

const wf = changeMemberRoleWorkflow();

// Family: Pierre (owner), Bob (viewer), Carol (editor). Resolvable: Alex, Alice, Bob, Carol, Pierre.
const spaceClient = (extra = {}) =>
  makeContractClient({
    spaces: [
      {
        id: 'spc-1',
        name: 'Family',
        members: [
          { userId: 'u-owner', name: 'Pierre', role: 'owner' },
          { userId: 'u-bob', name: 'Bob', role: 'viewer' },
          { userId: 'u-carol', name: 'Carol', role: 'editor' },
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

const spaceOp = (client) => client.calls.find((c) => c.name === 'proposeAlbumOperations')?.args.operations[0];
const proposed = (client) => client.calls.some((c) => c.name === 'proposeAlbumOperations');

describe('change_member_role router & slots', () => {
  it('matches "make <user> an editor in <space>"', () => {
    assert.deepEqual(wf.match('make Alex an editor in Family'), {
      slots: { memberQuery: 'Alex', role: 'editor', spaceRef: 'Family' },
    });
  });

  it('matches "make <user> a viewer in the <space> space"', () => {
    assert.deepEqual(wf.match('make Alex a viewer in the Family space'), {
      slots: { memberQuery: 'Alex', role: 'viewer', spaceRef: 'Family' },
    });
  });

  it('matches "change <user>\'s role to <role> in <space>"', () => {
    assert.deepEqual(wf.match("change Alex's role to editor in Family"), {
      slots: { memberQuery: 'Alex', role: 'editor', spaceRef: 'Family' },
    });
  });

  it('captures owner intent ("make <user> the owner of <space>")', () => {
    assert.deepEqual(wf.match('make Alex the owner of Family'), {
      slots: { memberQuery: 'Alex', role: 'owner', spaceRef: 'Family' },
    });
  });

  it('handles a possessive in a "space" target', () => {
    assert.deepEqual(wf.match("change Bob's role to viewer in the Trips space"), {
      slots: { memberQuery: 'Bob', role: 'viewer', spaceRef: 'Trips' },
    });
  });

  it('normalizes role synonyms', () => {
    assert.deepEqual(wf.match('make Alex a contributor in Family'), {
      slots: { memberQuery: 'Alex', role: 'editor', spaceRef: 'Family' },
    });
  });

  it('does not match without a valid role word', () => {
    assert.equal(wf.match('make Alex happy in Family'), undefined);
  });

  it('does not match a space rename', () => {
    assert.equal(wf.match('rename the Family space to Family 2026'), undefined);
  });

  it('returns undefined for an empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  // ── Album-target hand-off regression (Step B) ──────────────────────────────
  // change_member_role must DECLINE when the target mentions "album" so that
  // change_album_member_role can own those prompts.
  it('DECLINES "make Alex an editor on the Family album" (album target → hand-off)', () => {
    assert.equal(wf.match('make Alex an editor on the Family album'), undefined);
  });

  it('DECLINES "change Alex\'s role to viewer in the Family album"', () => {
    assert.equal(wf.match("change Alex's role to viewer in the Family album"), undefined);
  });

  it('DECLINES "make Bob a contributor in the Beach album"', () => {
    assert.equal(wf.match('make Bob a contributor in the Beach album'), undefined);
  });

  it('parseSlots normalizes role + space and requires all three slots', () => {
    assert.deepEqual(wf.parseSlots({ memberQuery: 'Alex', role: 'admin', spaceRef: 'the Family space' }), {
      memberQuery: 'Alex',
      role: 'owner',
      spaceRef: 'Family',
    });
    assert.equal(wf.parseSlots({ memberQuery: 'Alex', role: 'editor' }), null);
    assert.equal(wf.parseSlots({ role: 'editor', spaceRef: 'Family' }), null);
    assert.equal(wf.parseSlots({ memberQuery: 'Alex', role: 'bogus', spaceRef: 'Family' }), null);
  });

  it('is a strict workflow with an executable run', () => {
    assert.equal(wf.kind, 'change_member_role');
    assert.equal(wf.flow, 'strict');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('change_member_role execution + guards', () => {
  it('plans a viewer→editor change and keeps user ids out of the copy', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Bob', role: 'editor', spaceRef: 'Family' } });
    assert.equal(outcome.status, 'planned');
    assert.deepEqual(spaceOp(client), {
      type: 'space.updateMemberRole',
      summary: 'Update a space member role.',
      targetKind: 'existing_space',
      targetId: 'spc-1',
      payload: { userIds: ['u-bob'], role: 'editor' },
    });
    assert.equal(outcome.text.includes('u-bob'), false);
  });

  it('plans an editor→viewer change', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Carol', role: 'viewer', spaceRef: 'Family' } });
    assert.equal(outcome.status, 'planned');
    assert.deepEqual(spaceOp(client).payload, { userIds: ['u-carol'], role: 'viewer' });
  });

  it('treats a no-op role change as needs_input (no propose)', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Bob', role: 'viewer', spaceRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('blocks demoting the owner (self / last-owner) → needs_input', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Pierre', role: 'editor', spaceRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('refuses to promote to owner (not assignable) without touching tools', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Bob', role: 'owner', spaceRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.length, 0);
  });

  it('asks for input when the target is not a member', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Alex', role: 'editor', spaceRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('asks which user when the member query is ambiguous', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Al', role: 'editor', spaceRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('asks which space when the space is unknown', async () => {
    const client = spaceClient();
    const outcome = await wf.run({ client, slots: { memberQuery: 'Bob', role: 'editor', spaceRef: 'Nope' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(proposed(client), false);
  });

  it('fails when listSpaces, readSpace, or searchUsers throws', async () => {
    const throwingOn = (toolName) => ({
      calls: [],
      async call(name) {
        this.calls.push({ name });
        if (name === toolName) throw new Error('boom');
        if (name === 'listSpaces') return { spaces: [{ id: 'spc-1', name: 'Family' }] };
        if (name === 'readSpace')
          return { space: { id: 'spc-1', name: 'Family', members: [{ userId: 'u-bob', name: 'Bob', role: 'viewer' }] } };
        if (name === 'searchUsers') return { users: [{ userId: 'u-bob', name: 'Bob' }] };
        throw new Error(`unexpected ${name}`);
      },
    });
    for (const tool of ['listSpaces', 'readSpace', 'searchUsers']) {
      const outcome = await wf.run({ client: throwingOn(tool), slots: { memberQuery: 'Bob', role: 'editor', spaceRef: 'Family' } });
      assert.equal(outcome.status, 'failed', `expected failed when ${tool} throws`);
    }
  });

  it('fails (gate) without success copy when the plan has no persisted id', async () => {
    const client = spaceClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({ client, slots: { memberQuery: 'Bob', role: 'editor', spaceRef: 'Family' } });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared/i.test(outcome.text), false);
  });
});

// ─── D3: durable disambiguation (continuation) ────────────────────────────────

const NOW = 1_000_000;

// A client with two spaces both named "Family" (ambiguous space).
const ambiguousSpaceClient = () =>
  makeContractClient({
    spaces: [
      { id: 'spc-a', name: 'Family', members: [{ userId: 'u-bob', name: 'Bob', role: 'viewer' }] },
      { id: 'spc-b', name: 'Family', members: [{ userId: 'u-bob', name: 'Bob', role: 'viewer' }] },
    ],
    users: [
      { userId: 'u-bob', name: 'Bob', email: 'bob@x.com' },
      { userId: 'u-owner', name: 'Pierre', email: 'pierre@x.com' },
    ],
  });

// A client with one space but two users matching "Al" (ambiguous user).
const ambiguousUserClient = () =>
  makeContractClient({
    spaces: [
      {
        id: 'spc-1',
        name: 'Family',
        members: [
          { userId: 'u-alex', name: 'Alex', role: 'viewer' },
          { userId: 'u-alice', name: 'Alice', role: 'editor' },
          { userId: 'u-owner', name: 'Pierre', role: 'owner' },
        ],
      },
    ],
    users: [
      { userId: 'u-alex', name: 'Alex', email: 'alex@x.com' },
      { userId: 'u-alice', name: 'Alice', email: 'alice@x.com' },
    ],
  });

describe('change_member_role durable disambiguation (D3)', () => {
  // ── non-ambiguous path unchanged (regression) ────────────────────────────────
  it('non-ambiguous path: plans directly, no continuation', async () => {
    const client = spaceClient();
    const outcome = await wf.run({
      client,
      slots: { memberQuery: 'Bob', role: 'editor', spaceRef: 'Family' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'planned');
    assert.equal(outcome.continuation, undefined);
  });

  // ── "not found" space keeps bare needs_input (no empty candidate list) ────────
  it('not-found space stays bare needs_input without a continuation', async () => {
    const client = spaceClient();
    const outcome = await wf.run({
      client,
      slots: { memberQuery: 'Bob', role: 'editor', spaceRef: 'Nope' },
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
      slots: { memberQuery: 'Bob', role: 'editor', spaceRef: 'Family' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(outcome.continuation, 'continuation must be present');
    assert.equal(outcome.continuation.kind, 'change_member_role_space');
    assert.equal(Array.isArray(outcome.continuation.candidates), true);
    assert.equal(outcome.continuation.candidates.length, 2);
    // Candidates must be {index,id,name} only
    for (const c of outcome.continuation.candidates) {
      assert.deepEqual(Object.keys(c).sort(), ['id', 'index', 'name']);
    }
    // slots are carried for the next stage
    assert.ok(outcome.continuation.slots, 'slots must be carried');
    // members array must not leak into candidates
    for (const c of outcome.continuation.candidates) {
      assert.equal('members' in c, false, 'candidate must not carry a members array');
    }
  });

  // ── resume space: "the first one" picks spc-a → proceeds to resolve user ──────
  it('resume "the first one" resolves space, then plans when user is unambiguous', async () => {
    const client = ambiguousSpaceClient();
    // Turn 1: get the continuation
    const outcome1 = await wf.run({
      client,
      slots: { memberQuery: 'Bob', role: 'editor', spaceRef: 'Family' },
      nowMs: NOW,
    });
    assert.equal(outcome1.status, 'needs_input');
    const pending = outcome1.continuation;

    // Turn 2: resume "the first one"
    const resumed = wf.resumeContinuation({ pending, prompt: 'the first one', nowMs: NOW + 1000 });
    assert.equal(resumed.status, 'matched');
    assert.equal(resumed.ctx.resolvedSpaceId, 'spc-a');
    assert.ok(resumed.ctx.slots, 'slots must be in ctx');

    // Turn 2 run: with resolvedSpaceId, proceed to plan Bob's role change
    const client2 = makeContractClient({
      spaces: [
        {
          id: 'spc-a',
          name: 'Family',
          members: [
            { userId: 'u-owner', name: 'Pierre', role: 'owner' },
            { userId: 'u-bob', name: 'Bob', role: 'viewer' },
          ],
        },
        { id: 'spc-b', name: 'Family', members: [] },
      ],
      users: [
        { userId: 'u-bob', name: 'Bob', email: 'bob@x.com' },
        { userId: 'u-owner', name: 'Pierre', email: 'pierre@x.com' },
      ],
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
      slots: { memberQuery: 'Al', role: 'editor', spaceRef: 'Family' },
      resolvedSpaceId: 'spc-1',
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(outcome.continuation, 'continuation must be present');
    assert.equal(outcome.continuation.kind, 'change_member_role_user');
    assert.equal(outcome.continuation.candidates.length, 2);
    // resolvedSpaceId must be carried so the next run skips space lookup
    assert.equal(outcome.continuation.resolvedSpaceId, 'spc-1');
    assert.ok(outcome.continuation.slots, 'slots must be carried');
  });

  // ── resume user: "2" picks the 2nd user → run() with resolvedSpaceId+resolvedUserId proposes ──
  it('resume "2" picks the 2nd user; run with resolvedSpaceId+resolvedUserId proposes', async () => {
    const pending = {
      kind: 'change_member_role_user',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'u-alex', name: 'Alex' },
        { index: 2, id: 'u-alice', name: 'Alice' },
      ],
      resolvedSpaceId: 'spc-1',
      slots: { memberQuery: 'Al', role: 'editor', spaceRef: 'Family' },
    };
    const resumed = wf.resumeContinuation({ pending, prompt: '2', nowMs: NOW + 500 });
    assert.equal(resumed.status, 'matched');
    assert.equal(resumed.ctx.resolvedUserId, 'u-alice');
    assert.equal(resumed.ctx.resolvedSpaceId, 'spc-1');

    // Run with both resolved ids
    const client2 = makeContractClient({
      spaces: [
        {
          id: 'spc-1',
          name: 'Family',
          members: [
            { userId: 'u-owner', name: 'Pierre', role: 'owner' },
            { userId: 'u-alice', name: 'Alice', role: 'viewer' },
          ],
        },
      ],
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

  // ── edge: out-of-range ordinal → needs_input ──────────────────────────────────
  it('out-of-range ordinal in resume → needs_input', () => {
    const pending = {
      kind: 'change_member_role_space',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'spc-a', name: 'Family' },
        { index: 2, id: 'spc-b', name: 'Family' },
      ],
      slots: { memberQuery: 'Bob', role: 'editor', spaceRef: 'Family' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '5', nowMs: NOW + 1000 });
    assert.equal(result.status, 'needs_input');
  });

  // ── edge: name not in list → needs_input ──────────────────────────────────────
  it('name not in list → needs_input', () => {
    const pending = {
      kind: 'change_member_role_space',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'spc-a', name: 'Family' },
        { index: 2, id: 'spc-b', name: 'Family 2' },
      ],
      slots: { memberQuery: 'Bob', role: 'editor', spaceRef: 'Family' },
    };
    const result = wf.resumeContinuation({ pending, prompt: 'Trips', nowMs: NOW + 1000 });
    assert.equal(result.status, 'needs_input');
  });

  // ── edge: expired continuation → expired message ──────────────────────────────
  it('expired continuation → expired message', () => {
    const pending = {
      kind: 'change_member_role_space',
      createdAtMs: NOW,
      candidates: [{ index: 1, id: 'spc-a', name: 'Family' }],
      slots: { memberQuery: 'Bob', role: 'editor', spaceRef: 'Family' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: NOW + 15 * 60 * 1000 });
    assert.equal(result.status, 'expired');
    assert.match(result.text, /expired/i);
  });

  // ── zero matches keeps bare needs_input (no empty candidate list) ──────────────
  it('zero user matches stays bare needs_input without continuation', async () => {
    const client = spaceClient();
    const outcome = await wf.run({
      client,
      slots: { memberQuery: 'Zzz', role: 'editor', spaceRef: 'Family' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(outcome.continuation, undefined);
  });

  // ── workflow exposes resumeContinuation ───────────────────────────────────────
  it('workflow exposes resumeContinuation', () => {
    assert.equal(typeof wf.resumeContinuation, 'function');
  });
});
