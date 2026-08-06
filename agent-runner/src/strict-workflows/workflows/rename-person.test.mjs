import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renamePersonWorkflow } from './rename-person.mjs';

const NOW = 1_717_000_000_000;

const wf = renamePersonWorkflow();

// ── match ─────────────────────────────────────────────────────────────────────

describe('rename_person match', () => {
  it('matches "Rename Alejandra to Karina"', () => {
    const result = wf.match('Rename Alejandra to Karina');
    assert.ok(result);
    assert.equal(result.slots.personRef, 'Alejandra');
    assert.equal(result.slots.newName, 'Karina');
  });

  it('matches "rename alex to alexander"', () => {
    const result = wf.match('rename alex to alexander');
    assert.ok(result);
    assert.equal(result.slots.personRef, 'alex');
    assert.equal(result.slots.newName, 'alexander');
  });

  it('matches "re-name this person to Bob"', () => {
    const result = wf.match('re-name this person to Bob');
    assert.ok(result);
    assert.equal(result.slots.newName, 'Bob');
  });

  it('does NOT match "Rename the Family album to Family 2026" (container noun)', () => {
    assert.equal(wf.match('Rename the Family album to Family 2026'), undefined);
  });

  it('does NOT match "Rename the Family space to Family 2026" (container noun)', () => {
    assert.equal(wf.match('Rename the Family space to Family 2026'), undefined);
  });

  it('does NOT match "Hide Alex" (wrong verb)', () => {
    assert.equal(wf.match('Hide Alex'), undefined);
  });

  it('does NOT match when no "to" separator', () => {
    assert.equal(wf.match('rename alex'), undefined);
  });
});

// ── parseSlots ────────────────────────────────────────────────────────────────

describe('rename_person parseSlots', () => {
  it('returns slots when both personRef and newName are present', () => {
    const slots = wf.parseSlots({ personRef: 'Alejandra', newName: 'Karina' });
    assert.deepEqual(slots, { personRef: 'Alejandra', newName: 'Karina' });
  });

  it('returns null when personRef is missing', () => {
    assert.equal(wf.parseSlots({ newName: 'Karina' }), null);
  });

  it('returns null when newName is missing', () => {
    assert.equal(wf.parseSlots({ personRef: 'Alex' }), null);
  });
});

// ── run ───────────────────────────────────────────────────────────────────────

const makeMatchedClient = (personId = 'pid-1', personName = 'Alejandra') => ({
  call: async (tool, request) => {
    if (tool === 'searchPeople') {
      return { people: { status: 'matched', personId, name: personName, thumbnailAssetId: null } };
    }
    if (tool === 'proposeAlbumOperations') {
      return { status: 'success', plan: { id: 'plan-123' } };
    }
    throw new Error(`Unexpected tool: ${tool}`);
  },
});

const makeNotFoundClient = () => ({
  call: async (tool) => {
    if (tool === 'searchPeople') {
      return { people: { status: 'not_found' } };
    }
    throw new Error(`Unexpected tool: ${tool}`);
  },
});

const makeAmbiguousClient = () => ({
  call: async (tool) => {
    if (tool === 'searchPeople') {
      return {
        people: {
          status: 'ambiguous',
          choices: [
            { personId: 'id-1', name: 'Alex A', thumbnailAssetId: null },
            { personId: 'id-2', name: 'Alex B', thumbnailAssetId: null },
          ],
        },
      };
    }
    throw new Error(`Unexpected tool: ${tool}`);
  },
});

const makePlanErrorClient = (personId = 'pid-1', personName = 'Alejandra') => ({
  call: async (tool) => {
    if (tool === 'searchPeople') {
      return { people: { status: 'matched', personId, name: personName, thumbnailAssetId: null } };
    }
    if (tool === 'proposeAlbumOperations') {
      throw new Error('plan tool error');
    }
    throw new Error(`Unexpected tool: ${tool}`);
  },
});

describe('rename_person run', () => {
  it('matched → proposes person.update with name payload', async () => {
    let proposedOps;
    const client = {
      call: async (tool, request) => {
        if (tool === 'searchPeople') {
          return { people: { status: 'matched', personId: 'pid-1', name: 'Alejandra', thumbnailAssetId: null } };
        }
        if (tool === 'proposeAlbumOperations') {
          proposedOps = request.operations;
          return { status: 'success', plan: { id: 'plan-123' } };
        }
        throw new Error(`Unexpected tool: ${tool}`);
      },
    };

    const result = await wf.run({
      client,
      slots: { personRef: 'Alejandra', newName: 'Karina' },
      nowMs: NOW,
    });

    assert.equal(result.status, 'planned');
    assert.equal(proposedOps.length, 1);
    assert.equal(proposedOps[0].type, 'person.update');
    assert.equal(proposedOps[0].targetKind, 'person');
    assert.equal(proposedOps[0].targetId, 'pid-1');
    assert.deepEqual(proposedOps[0].payload, { name: 'Karina' });
    // Must NOT include raw face data.
    assert.equal(proposedOps[0].payload.faceAssetId, undefined);
  });

  it('not_found → needsInput', async () => {
    const result = await wf.run({
      client: makeNotFoundClient(),
      slots: { personRef: 'Zzzqqq', newName: 'Bob' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'needs_input');
  });

  it('ambiguous → needsInput with continuation', async () => {
    const result = await wf.run({
      client: makeAmbiguousClient(),
      slots: { personRef: 'Alex', newName: 'Alexander' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'needs_input');
    assert.ok(result.continuation);
  });

  it('plan error → failed', async () => {
    const result = await wf.run({
      client: makePlanErrorClient(),
      slots: { personRef: 'Alejandra', newName: 'Karina' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'failed');
  });

  it('resolvedPersonId skips search, still proposes', async () => {
    let searchCalled = false;
    let proposedOps;
    const client = {
      call: async (tool, request) => {
        if (tool === 'searchPeople') {
          searchCalled = true;
          return { people: { status: 'matched', personId: 'pid-x', name: 'Alice', thumbnailAssetId: null } };
        }
        if (tool === 'proposeAlbumOperations') {
          proposedOps = request.operations;
          return { status: 'success', plan: { id: 'plan-1' } };
        }
        throw new Error(`Unexpected tool: ${tool}`);
      },
    };

    await wf.run({
      client,
      slots: { personRef: 'Alice', newName: 'Alicia' },
      resolvedPersonId: 'pid-direct',
      nowMs: NOW,
    });

    assert.equal(searchCalled, false);
    assert.equal(proposedOps[0].targetId, 'pid-direct');
  });

  it('needsInput when no personRef or newName provided', async () => {
    const client = makeMatchedClient();
    const result = await wf.run({ client, slots: {}, nowMs: NOW });
    assert.equal(result.status, 'needs_input');
  });
});

// ── resumeContinuation ────────────────────────────────────────────────────────

describe('rename_person resumeContinuation', () => {
  it('returns matched ctx on valid ordinal pick', () => {
    const pending = {
      kind: 'rename_person_person',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'id-1', name: 'Alex A' },
        { index: 2, id: 'id-2', name: 'Alex B' },
      ],
      slots: { personRef: 'Alex', newName: 'Alexander' },
    };

    const result = wf.resumeContinuation({ pending, prompt: 'the first one', nowMs: NOW });

    assert.equal(result.status, 'matched');
    assert.equal(result.ctx.resolvedPersonId, 'id-1');
    assert.deepEqual(result.ctx.slots, { personRef: 'Alex', newName: 'Alexander' });
  });

  it('returns needs_input for wrong kind', () => {
    const pending = { kind: 'wrong_kind', createdAtMs: NOW, candidates: [], slots: {} };
    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: NOW });
    assert.equal(result.status, 'needs_input');
  });
});
