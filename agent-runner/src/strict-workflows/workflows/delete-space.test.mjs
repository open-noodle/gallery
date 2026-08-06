import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deleteSpaceWorkflow } from './delete-space.mjs';

const wf = deleteSpaceWorkflow();

const fakeClient = ({ spaces = [{ id: 'sp-1', name: 'Family' }], planResult } = {}) => {
  const calls = [];
  return {
    calls,
    async call(name, args) {
      calls.push({ name, args });
      if (name === 'listSpaces') return { spaces };
      if (name === 'proposeAlbumOperations') return planResult ?? { status: 'success', plan: { id: 'plan-1' } };
      throw new Error(`unexpected ${name}`);
    },
  };
};

// ── match: accepted forms ─────────────────────────────────────────────────────

describe('delete_space router — match accepts', () => {
  it('matches "delete the Family space"', () => {
    const result = wf.match('delete the Family space');
    assert.ok(result, 'should match');
    assert.equal(result.slots.spaceRef, 'Family');
  });

  it('matches "remove the Trip space"', () => {
    const result = wf.match('remove the Trip space');
    assert.ok(result, 'should match');
    assert.equal(result.slots.spaceRef, 'Trip');
  });

  it('matches "get rid of the Beach space"', () => {
    const result = wf.match('get rid of the Beach space');
    assert.ok(result, 'should match');
    assert.equal(result.slots.spaceRef, 'Beach');
  });

  it('matches "delete my Favorites space"', () => {
    const result = wf.match('delete my Favorites space');
    assert.ok(result, 'should match');
    assert.equal(result.slots.spaceRef, 'Favorites');
  });

  it('matches "remove this Italy space"', () => {
    const result = wf.match('remove this Italy space');
    assert.ok(result, 'should match');
    assert.equal(result.slots.spaceRef, 'Italy');
  });

  it('matches "delete the shared space Family" (leading shared space wrapper)', () => {
    const result = wf.match('delete the shared space Family space');
    assert.ok(result, 'should match');
    assert.equal(result.slots.spaceRef, 'Family');
  });
});

// ── match: declined forms ─────────────────────────────────────────────────────

describe('delete_space router — match declines', () => {
  it('declines "delete the photos in the Family space" (photo source + in-the frame)', () => {
    assert.equal(wf.match('delete the photos in the Family space'), undefined);
  });

  it('declines "delete the Family space photos" (photo source word after space noun)', () => {
    assert.equal(wf.match('delete the Family space photos'), undefined);
  });

  it('declines "delete the Family album" (album noun → delete_album)', () => {
    assert.equal(wf.match('delete the Family album'), undefined);
  });

  it('declines "delete the Family space photos" (photos after space)', () => {
    assert.equal(wf.match('delete the Family space photos'), undefined);
  });

  it('declines empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('declines whitespace-only prompt', () => {
    assert.equal(wf.match('   '), undefined);
  });

  it('declines "delete the space" with no space name (ref normalizes to empty)', () => {
    // After stripping "the" + "space" the ref is empty → decline.
    assert.equal(wf.match('delete the space'), undefined);
  });

  it('declines "delete the shared space" with no space name (bare article ref)', () => {
    assert.equal(wf.match('delete the shared space'), undefined);
  });

  it('declines "trash my 2024 screenshots" (no space noun)', () => {
    assert.equal(wf.match('trash my 2024 screenshots'), undefined);
  });

  it('declines "delete my videos from the Family space" (photo source word)', () => {
    assert.equal(wf.match('delete my videos from the Family space'), undefined);
  });

  it('declines "delete the pics in the Trip space" (pics = photo source)', () => {
    assert.equal(wf.match('delete the pics in the Trip space'), undefined);
  });
});

// ── parseSlots ────────────────────────────────────────────────────────────────

describe('delete_space parseSlots', () => {
  it('returns slots when spaceRef is present', () => {
    const slots = wf.parseSlots({ spaceRef: 'Family' });
    assert.deepEqual(slots, { spaceRef: 'Family' });
  });

  it('normalizes leading article from spaceRef', () => {
    const slots = wf.parseSlots({ spaceRef: 'the Family' });
    assert.deepEqual(slots, { spaceRef: 'Family' });
  });

  it('strips trailing "space" noun from spaceRef', () => {
    const slots = wf.parseSlots({ spaceRef: 'Family space' });
    assert.deepEqual(slots, { spaceRef: 'Family' });
  });

  it('returns null when spaceRef is missing', () => {
    assert.equal(wf.parseSlots({}), null);
  });

  it('returns null when rawSlots is null', () => {
    assert.equal(wf.parseSlots(null), null);
  });

  it('returns null when spaceRef normalizes to empty', () => {
    assert.equal(wf.parseSlots({ spaceRef: 'the' }), null);
  });
});

// ── run ───────────────────────────────────────────────────────────────────────

describe('delete_space run — unique space', () => {
  it('proposes space.delete with the correct targetId and success text', async () => {
    const client = fakeClient({ spaces: [{ id: 'sp-1', name: 'Family' }] });
    const slots = wf.parseSlots({ spaceRef: 'Family' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'planned');
    const planCall = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.ok(planCall, 'proposeAlbumOperations must be called');
    const op = planCall.args.operations[0];
    assert.equal(op.type, 'space.delete');
    assert.equal(op.targetKind, 'existing_space');
    assert.equal(op.targetId, 'sp-1');
    assert.match(op.summary, /Family/);
  });

  it('success text contains the members/photos disclosure', async () => {
    const client = fakeClient({ spaces: [{ id: 'sp-1', name: 'Family' }] });
    const slots = wf.parseSlots({ spaceRef: 'Family' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'planned');
    assert.match(outcome.text, /photos stay in members' libraries|membership|members/i);
  });

  it('success text mentions the space name', async () => {
    const client = fakeClient({ spaces: [{ id: 'sp-1', name: 'Family' }] });
    const slots = wf.parseSlots({ spaceRef: 'Family' });
    const outcome = await wf.run({ client, slots });
    assert.match(outcome.text, /Family/);
  });
});

describe('delete_space run — not found', () => {
  it('returns needs_input when no space matches', async () => {
    const client = fakeClient({ spaces: [] });
    const slots = wf.parseSlots({ spaceRef: 'Nonexistent' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'needs_input');
    assert.match(outcome.text, /Nonexistent/);
  });
});

describe('delete_space run — ambiguous space', () => {
  it('returns needs_input with a continuation when multiple spaces share the name', async () => {
    const client = fakeClient({
      spaces: [
        { id: 'a', name: 'Family' },
        { id: 'b', name: 'Family' },
      ],
    });
    const slots = wf.parseSlots({ spaceRef: 'Family' });
    const outcome = await wf.run({ client, slots, nowMs: 1000 });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(outcome.continuation, 'must include a continuation');
    assert.equal(outcome.continuation.kind, 'delete_space_space');
  });
});

describe('delete_space run — listSpaces throws', () => {
  it('returns failed when listSpaces throws', async () => {
    const client = {
      calls: [],
      async call(name) {
        if (name === 'listSpaces') throw new Error('network error');
        throw new Error(`unexpected ${name}`);
      },
    };
    const slots = wf.parseSlots({ spaceRef: 'Family' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'failed');
    assert.doesNotMatch(outcome.text, /created|proposed|ready/i);
  });
});

describe('delete_space run — proposeAlbumOperations throws', () => {
  it('returns failed when the planning tool throws', async () => {
    const client = {
      calls: [],
      async call(name) {
        if (name === 'listSpaces') return { spaces: [{ id: 'sp-1', name: 'Family' }] };
        if (name === 'proposeAlbumOperations') throw new Error('planner down');
        throw new Error(`unexpected ${name}`);
      },
    };
    const slots = wf.parseSlots({ spaceRef: 'Family' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'failed');
    assert.doesNotMatch(outcome.text, /created|proposed|ready/i);
  });
});

describe('delete_space run — no plan id', () => {
  it('fails without success language when planning returns no plan id', async () => {
    const client = fakeClient({ planResult: { status: 'success' } });
    const slots = wf.parseSlots({ spaceRef: 'Family' });
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'failed');
    assert.doesNotMatch(outcome.text, /created|proposed|ready/i);
  });
});

// ── resumeContinuation ────────────────────────────────────────────────────────

describe('delete_space resumeContinuation', () => {
  it('resolves a candidate pick to resolvedSpaceId in ctx', () => {
    const pending = {
      kind: 'delete_space_space',
      createdAtMs: 1000,
      candidates: [
        { index: 1, id: 'a', name: 'Family' },
        { index: 2, id: 'b', name: 'Family' },
      ],
      slots: { spaceRef: 'Family' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: 2000 });
    assert.equal(result.status, 'matched');
    assert.equal(result.ctx.resolvedSpaceId, 'a');
    assert.deepEqual(result.ctx.slots, { spaceRef: 'Family' });
  });

  it('returns needs_input for an unknown continuation kind', () => {
    const pending = { kind: 'other_kind', createdAtMs: 1000, candidates: [] };
    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: 2000 });
    assert.equal(result.status, 'needs_input');
  });

  it('resolves with second candidate when user picks 2', () => {
    const pending = {
      kind: 'delete_space_space',
      createdAtMs: 1000,
      candidates: [
        { index: 1, id: 'a', name: 'Family' },
        { index: 2, id: 'b', name: 'Family' },
      ],
      slots: { spaceRef: 'Family' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '2', nowMs: 2000 });
    assert.equal(result.status, 'matched');
    assert.equal(result.ctx.resolvedSpaceId, 'b');
  });
});

// ── run with resolvedSpaceId (continuation path) ──────────────────────────────

describe('delete_space run — continuation path (resolvedSpaceId)', () => {
  it('proposes space.delete for the resolved space without re-listing', async () => {
    const client = fakeClient({ spaces: [{ id: 'sp-1', name: 'Family' }] });
    const slots = wf.parseSlots({ spaceRef: 'Family' });
    const outcome = await wf.run({ client, slots, resolvedSpaceId: 'sp-1' });
    assert.equal(outcome.status, 'planned');
    const planCall = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.ok(planCall);
    const op = planCall.args.operations[0];
    assert.equal(op.targetId, 'sp-1');
    // listSpaces should NOT be called (resolvedSpaceId skips lookup)
    const listCall = client.calls.find((c) => c.name === 'listSpaces');
    assert.equal(listCall, undefined, 'listSpaces should be skipped on continuation path');
  });
});
