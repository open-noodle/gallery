import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renameOrDescribeSpaceWorkflow } from './rename-or-describe-space.mjs';
import { makeContractClient } from './contract-fixtures.mjs';

const wf = renameOrDescribeSpaceWorkflow();

describe('rename_or_describe_space router & slots', () => {
  it('matches "rename the <space> space to <name>"', () => {
    assert.deepEqual(wf.match('rename the Family space to Family 2026'), {
      slots: { spaceRef: 'Family', newName: 'Family 2026' },
    });
  });

  it('matches "set the description on the <space> space to <text>"', () => {
    assert.deepEqual(wf.match('set the description on the Family space to Our shared memories'), {
      slots: { spaceRef: 'Family', description: 'Our shared memories' },
    });
  });

  it('handles the "shared space <name>" wrapper', () => {
    assert.deepEqual(wf.match('rename the shared space Trips to Trips 2026'), {
      slots: { spaceRef: 'Trips', newName: 'Trips 2026' },
    });
  });

  it('matches a "this space" deixis describe', () => {
    const m = wf.match('set the description on this space to Welcome');
    assert.ok(m, 'expected a match');
    assert.equal(m.slots.description, 'Welcome');
    assert.ok(m.slots.spaceRef);
  });

  it('does not match album phrasings (no space keyword)', () => {
    assert.equal(wf.match('rename the Family album to Family 2026'), undefined);
  });

  it('does not match a generic ref with no space keyword (defaults to album)', () => {
    assert.equal(wf.match('rename Family to Family 2026'), undefined);
  });

  it('returns undefined for an empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('parseSlots normalizes the ref and accepts a single field', () => {
    assert.deepEqual(wf.parseSlots({ spaceRef: 'the Family space', newName: 'Family 2026' }), {
      spaceRef: 'Family',
      newName: 'Family 2026',
    });
  });

  it('parseSlots accepts both name and description', () => {
    assert.deepEqual(wf.parseSlots({ spaceRef: 'Family', newName: 'Family 2026', description: 'Welcome' }), {
      spaceRef: 'Family',
      newName: 'Family 2026',
      description: 'Welcome',
    });
  });

  it('parseSlots rejects when neither name nor description is present', () => {
    assert.equal(wf.parseSlots({ spaceRef: 'Family' }), null);
  });

  it('parseSlots rejects a missing space ref', () => {
    assert.equal(wf.parseSlots({ newName: 'X' }), null);
  });

  it('is a strict workflow with an executable run', () => {
    assert.equal(wf.kind, 'rename_or_describe_space');
    assert.equal(wf.flow, 'strict');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('rename_or_describe_space execution', () => {
  const familyClient = () => makeContractClient({ spaces: [{ id: 'spc-1', name: 'Family', members: [] }] });

  it('renames a space and preserves its description (spaceName-only payload)', async () => {
    const client = familyClient();
    const outcome = await wf.run({ client, slots: { spaceRef: 'Family', newName: 'Family 2026' } });
    assert.equal(outcome.status, 'planned');
    const ops = client.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations;
    assert.deepEqual(ops[0], {
      type: 'space.updateDetails',
      summary: 'Update space details.',
      targetKind: 'existing_space',
      targetId: 'spc-1',
      payload: { spaceName: 'Family 2026' },
    });
  });

  it('describes a space and preserves its name (description-only payload)', async () => {
    const client = familyClient();
    const outcome = await wf.run({ client, slots: { spaceRef: 'Family', description: 'Our shared memories' } });
    assert.equal(outcome.status, 'planned');
    const ops = client.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations;
    assert.deepEqual(ops[0].payload, { description: 'Our shared memories' });
  });

  it('updates both name and description when both are set', async () => {
    const client = familyClient();
    const outcome = await wf.run({
      client,
      slots: { spaceRef: 'Family', newName: 'Family 2026', description: 'Our shared memories' },
    });
    assert.equal(outcome.status, 'planned');
    const ops = client.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations;
    assert.deepEqual(ops[0].payload, { spaceName: 'Family 2026', description: 'Our shared memories' });
  });

  it('asks which space when the name is ambiguous (no propose)', async () => {
    const client = makeContractClient({
      spaces: [
        { id: 'a', name: 'Family' },
        { id: 'b', name: 'Family' },
      ],
    });
    const outcome = await wf.run({ client, slots: { spaceRef: 'Family', newName: 'X' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAlbumOperations'),
      false,
    );
  });

  it('asks for input when the space is unknown (no propose)', async () => {
    const client = familyClient();
    const outcome = await wf.run({ client, slots: { spaceRef: 'Nope', newName: 'X' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAlbumOperations'),
      false,
    );
  });

  it('fails (gate) without success copy when the plan has no persisted id', async () => {
    const client = makeContractClient({
      spaces: [{ id: 'spc-1', name: 'Family', members: [] }],
      planResult: { status: 'success', plan: {} },
    });
    const outcome = await wf.run({ client, slots: { spaceRef: 'Family', newName: 'X' } });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared/i.test(outcome.text), false);
  });

  it('asks for input (never a no-op plan) when neither field is set', async () => {
    const client = familyClient();
    const outcome = await wf.run({ client, slots: { spaceRef: 'Family' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAlbumOperations'),
      false,
    );
  });
});

// ─── D4a: durable space disambiguation (continuation) ─────────────────────────

const NOW = 1_000_000;

describe('rename_or_describe_space durable disambiguation (D4)', () => {
  // ── non-ambiguous path unchanged (regression) ────────────────────────────────
  it('non-ambiguous path: plans directly, no continuation', async () => {
    const client = makeContractClient({ spaces: [{ id: 'spc-1', name: 'Family', members: [] }] });
    const outcome = await wf.run({
      client,
      slots: { spaceRef: 'Family', newName: 'Family 2026' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'planned');
    assert.equal(outcome.continuation, undefined);
  });

  // ── "not found" stays bare needs_input (no continuation) ────────────────────
  it('not-found space stays bare needs_input without a continuation', async () => {
    const client = makeContractClient({ spaces: [{ id: 'spc-1', name: 'Family', members: [] }] });
    const outcome = await wf.run({
      client,
      slots: { spaceRef: 'Nope', newName: 'Something' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(outcome.continuation, undefined);
  });

  // ── ambiguous space: produces continuation with kind + candidates ─────────────
  it('ambiguous space yields needs_input with continuation (kind + candidates, no raw ids leaked)', async () => {
    const client = makeContractClient({
      spaces: [
        { id: 'spc-a', name: 'Family', members: [] },
        { id: 'spc-b', name: 'Family', members: [] },
      ],
    });
    const outcome = await wf.run({
      client,
      slots: { spaceRef: 'Family', newName: 'Family 2026' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(outcome.continuation, 'continuation must be present');
    assert.equal(outcome.continuation.kind, 'rename_or_describe_space_space');
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

  // ── resume "the first one" → matched ctx resolvedSpaceId → run proposes ──────
  it('resume "the first one" resolves space, then plans rename', async () => {
    const ambig = makeContractClient({
      spaces: [
        { id: 'spc-a', name: 'Family', members: [] },
        { id: 'spc-b', name: 'Family', members: [] },
      ],
    });
    // Turn 1: get the continuation
    const outcome1 = await wf.run({
      client: ambig,
      slots: { spaceRef: 'Family', newName: 'Family 2026' },
      nowMs: NOW,
    });
    assert.equal(outcome1.status, 'needs_input');
    const pending = outcome1.continuation;

    // Turn 2: resume
    const resumed = wf.resumeContinuation({ pending, prompt: 'the first one', nowMs: NOW + 1000 });
    assert.equal(resumed.status, 'matched');
    assert.equal(resumed.ctx.resolvedSpaceId, 'spc-a');
    assert.ok(resumed.ctx.slots, 'slots must be in ctx');

    // Turn 2 run: proposes the rename
    const client2 = makeContractClient({
      spaces: [
        { id: 'spc-a', name: 'Family', members: [] },
        { id: 'spc-b', name: 'Family', members: [] },
      ],
    });
    const outcome2 = await wf.run({
      client: client2,
      slots: resumed.ctx.slots,
      resolvedSpaceId: resumed.ctx.resolvedSpaceId,
      nowMs: NOW + 1000,
    });
    assert.equal(outcome2.status, 'planned');
    const ops = client2.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations;
    assert.equal(ops[0].targetId, 'spc-a');
    assert.deepEqual(ops[0].payload, { spaceName: 'Family 2026' });
  });

  // ── resume "2" → plans rename for spc-b ──────────────────────────────────────
  it('resume "2" resolves second space, then plans describe', async () => {
    const pending = {
      kind: 'rename_or_describe_space_space',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'spc-a', name: 'Family' },
        { index: 2, id: 'spc-b', name: 'Family' },
      ],
      slots: { spaceRef: 'Family', description: 'Our shared memories' },
    };
    const resumed = wf.resumeContinuation({ pending, prompt: '2', nowMs: NOW + 500 });
    assert.equal(resumed.status, 'matched');
    assert.equal(resumed.ctx.resolvedSpaceId, 'spc-b');

    const client2 = makeContractClient({
      spaces: [
        { id: 'spc-a', name: 'Family', members: [] },
        { id: 'spc-b', name: 'Family', members: [] },
      ],
    });
    const outcome = await wf.run({
      client: client2,
      slots: resumed.ctx.slots,
      resolvedSpaceId: resumed.ctx.resolvedSpaceId,
      nowMs: NOW + 500,
    });
    assert.equal(outcome.status, 'planned');
    const ops = client2.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations;
    assert.equal(ops[0].targetId, 'spc-b');
    assert.deepEqual(ops[0].payload, { description: 'Our shared memories' });
  });

  // ── edge: out-of-range ordinal → needs_input ──────────────────────────────────
  it('out-of-range ordinal in resume → needs_input', () => {
    const pending = {
      kind: 'rename_or_describe_space_space',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'spc-a', name: 'Family' },
        { index: 2, id: 'spc-b', name: 'Family' },
      ],
      slots: { spaceRef: 'Family', newName: 'X' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '5', nowMs: NOW + 1000 });
    assert.equal(result.status, 'needs_input');
  });

  // ── edge: name not in list → needs_input ──────────────────────────────────────
  it('name not in list → needs_input', () => {
    const pending = {
      kind: 'rename_or_describe_space_space',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'spc-a', name: 'Family' },
        { index: 2, id: 'spc-b', name: 'Family 2' },
      ],
      slots: { spaceRef: 'Family', newName: 'X' },
    };
    const result = wf.resumeContinuation({ pending, prompt: 'Trips', nowMs: NOW + 1000 });
    assert.equal(result.status, 'needs_input');
  });

  // ── edge: expired continuation → expired message ──────────────────────────────
  it('expired continuation → expired message', () => {
    const pending = {
      kind: 'rename_or_describe_space_space',
      createdAtMs: NOW,
      candidates: [{ index: 1, id: 'spc-a', name: 'Family' }],
      slots: { spaceRef: 'Family', newName: 'X' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: NOW + 15 * 60 * 1000 });
    assert.equal(result.status, 'expired');
    assert.match(result.text, /expired/i);
  });

  // ── workflow exposes resumeContinuation ───────────────────────────────────────
  it('workflow exposes resumeContinuation', () => {
    assert.equal(typeof wf.resumeContinuation, 'function');
  });
});
