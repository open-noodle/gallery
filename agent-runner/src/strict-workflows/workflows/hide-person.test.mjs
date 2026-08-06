import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hidePersonWorkflow } from './hide-person.mjs';

const NOW = 1_717_000_000_000;

const wf = hidePersonWorkflow();

// ── match ─────────────────────────────────────────────────────────────────────

describe('hide_person match', () => {
  it('matches "Hide Alex"', () => {
    const result = wf.match('Hide Alex');
    assert.ok(result);
    assert.equal(result.slots.personRef, 'Alex');
    assert.equal(result.slots.verb, 'hide');
  });

  it('matches "hide Alex from my People list"', () => {
    const result = wf.match('hide Alex from my People list');
    assert.ok(result);
    assert.equal(result.slots.personRef, 'Alex');
    assert.equal(result.slots.verb, 'hide');
  });

  it('matches "unhide Alex"', () => {
    const result = wf.match('unhide Alex');
    assert.ok(result);
    assert.equal(result.slots.personRef, 'Alex');
    assert.equal(result.slots.verb, 'unhide');
  });

  it('matches "show Alex"', () => {
    const result = wf.match('show Alex');
    assert.ok(result);
    assert.equal(result.slots.personRef, 'Alex');
    assert.equal(result.slots.verb, 'unhide');
  });

  it('matches "un-hide Alex"', () => {
    const result = wf.match('un-hide Alex');
    assert.ok(result);
    assert.equal(result.slots.verb, 'unhide');
  });

  it('does NOT match "hide the Family album" (container noun)', () => {
    assert.equal(wf.match('hide the Family album'), undefined);
  });

  it('does NOT match "rename Alex to Bob" (wrong verb)', () => {
    assert.equal(wf.match('rename Alex to Bob'), undefined);
  });

  // "show" overloads with photo-display intents — must not be stolen by unhide.
  it('does NOT match "show me the good ones" (subjective display intent)', () => {
    assert.equal(wf.match('show me the good ones'), undefined);
  });

  it('does NOT match "show me my photos" (display-pronoun prefix)', () => {
    assert.equal(wf.match('show me my photos'), undefined);
  });

  it('does NOT match "show all my favorites" (display-quantifier prefix)', () => {
    assert.equal(wf.match('show all my favorites'), undefined);
  });

  it('does NOT match empty string', () => {
    assert.equal(wf.match(''), undefined);
  });
});

// ── parseSlots ────────────────────────────────────────────────────────────────

describe('hide_person parseSlots', () => {
  it('returns slots for valid hide', () => {
    const slots = wf.parseSlots({ personRef: 'Alex', verb: 'hide' });
    assert.deepEqual(slots, { personRef: 'Alex', verb: 'hide' });
  });

  it('returns slots for valid unhide', () => {
    const slots = wf.parseSlots({ personRef: 'Alex', verb: 'unhide' });
    assert.deepEqual(slots, { personRef: 'Alex', verb: 'unhide' });
  });

  it('returns null when personRef is missing', () => {
    assert.equal(wf.parseSlots({ verb: 'hide' }), null);
  });

  it('returns null when verb is invalid', () => {
    assert.equal(wf.parseSlots({ personRef: 'Alex', verb: 'rename' }), null);
  });
});

// ── run ───────────────────────────────────────────────────────────────────────

describe('hide_person run', () => {
  const makeMatchedClientHide = (personId = 'pid-1', personName = 'Alex') => ({
    call: async (tool, request) => {
      if (tool === 'searchPeople') {
        // For hide, includeHidden should NOT be set.
        if (request.includeHidden) {
          throw new Error('Expected includeHidden to be absent for hide');
        }
        return { people: { status: 'matched', personId, name: personName, thumbnailAssetId: null } };
      }
      if (tool === 'proposeAlbumOperations') {
        return { status: 'success', plan: { id: 'plan-1' } };
      }
      throw new Error(`Unexpected tool: ${tool}`);
    },
  });

  it('hide → proposes person.update with isHidden:true', async () => {
    let proposedOps;
    const client = {
      call: async (tool, request) => {
        if (tool === 'searchPeople') {
          return { people: { status: 'matched', personId: 'pid-1', name: 'Alex', thumbnailAssetId: null } };
        }
        if (tool === 'proposeAlbumOperations') {
          proposedOps = request.operations;
          return { status: 'success', plan: { id: 'plan-1' } };
        }
        throw new Error(`Unexpected tool: ${tool}`);
      },
    };

    const result = await wf.run({
      client,
      slots: { personRef: 'Alex', verb: 'hide' },
      nowMs: NOW,
    });

    assert.equal(result.status, 'planned');
    assert.equal(proposedOps[0].type, 'person.update');
    assert.deepEqual(proposedOps[0].payload, { isHidden: true });
  });

  it('unhide → proposes person.update with isHidden:false', async () => {
    let proposedOps;
    const client = {
      call: async (tool, request) => {
        if (tool === 'searchPeople') {
          return { people: { status: 'matched', personId: 'pid-1', name: 'Alex', thumbnailAssetId: null } };
        }
        if (tool === 'proposeAlbumOperations') {
          proposedOps = request.operations;
          return { status: 'success', plan: { id: 'plan-1' } };
        }
        throw new Error(`Unexpected tool: ${tool}`);
      },
    };

    const result = await wf.run({
      client,
      slots: { personRef: 'Alex', verb: 'unhide' },
      nowMs: NOW,
    });

    assert.equal(result.status, 'planned');
    assert.deepEqual(proposedOps[0].payload, { isHidden: false });
  });

  it('unhide passes includeHidden:true to searchPeople', async () => {
    let includeHiddenSent;
    const client = {
      call: async (tool, request) => {
        if (tool === 'searchPeople') {
          includeHiddenSent = request.includeHidden;
          return { people: { status: 'matched', personId: 'pid-1', name: 'Alex', thumbnailAssetId: null } };
        }
        if (tool === 'proposeAlbumOperations') {
          return { status: 'success', plan: { id: 'plan-1' } };
        }
        throw new Error(`Unexpected tool: ${tool}`);
      },
    };

    await wf.run({ client, slots: { personRef: 'Alex', verb: 'unhide' }, nowMs: NOW });

    assert.equal(includeHiddenSent, true);
  });

  it('hide does NOT pass includeHidden to searchPeople', async () => {
    let includeHiddenSent;
    const client = {
      call: async (tool, request) => {
        if (tool === 'searchPeople') {
          includeHiddenSent = request.includeHidden;
          return { people: { status: 'matched', personId: 'pid-1', name: 'Alex', thumbnailAssetId: null } };
        }
        if (tool === 'proposeAlbumOperations') {
          return { status: 'success', plan: { id: 'plan-1' } };
        }
        throw new Error(`Unexpected tool: ${tool}`);
      },
    };

    await wf.run({ client, slots: { personRef: 'Alex', verb: 'hide' }, nowMs: NOW });

    assert.equal(includeHiddenSent, undefined);
  });

  it('not_found → needsInput', async () => {
    const client = {
      call: async (tool) => {
        if (tool === 'searchPeople') return { people: { status: 'not_found' } };
        throw new Error(`Unexpected tool: ${tool}`);
      },
    };
    const result = await wf.run({
      client,
      slots: { personRef: 'Zzzqqq', verb: 'hide' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'needs_input');
  });

  it('ambiguous → needsInput with continuation', async () => {
    const client = {
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
    };
    const result = await wf.run({
      client,
      slots: { personRef: 'Alex', verb: 'hide' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'needs_input');
    assert.ok(result.continuation);
  });

  it('resolvedPersonId skips search', async () => {
    let searchCalled = false;
    let proposedOps;
    const client = {
      call: async (tool, request) => {
        if (tool === 'searchPeople') {
          searchCalled = true;
          return { people: { status: 'matched', personId: 'pid-x', name: 'X', thumbnailAssetId: null } };
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
      slots: { personRef: 'Alex', verb: 'hide' },
      resolvedPersonId: 'pid-direct',
      nowMs: NOW,
    });

    assert.equal(searchCalled, false);
    assert.equal(proposedOps[0].targetId, 'pid-direct');
  });
});

// ── resumeContinuation ────────────────────────────────────────────────────────

describe('hide_person resumeContinuation', () => {
  it('returns matched ctx on valid pick', () => {
    const pending = {
      kind: 'hide_person_person',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'id-1', name: 'Alex A' },
        { index: 2, id: 'id-2', name: 'Alex B' },
      ],
      slots: { personRef: 'Alex', verb: 'hide' },
    };

    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: NOW });

    assert.equal(result.status, 'matched');
    assert.equal(result.ctx.resolvedPersonId, 'id-1');
    assert.deepEqual(result.ctx.slots, { personRef: 'Alex', verb: 'hide' });
  });

  it('returns needs_input for wrong kind', () => {
    const pending = { kind: 'wrong_kind', createdAtMs: NOW, candidates: [], slots: {} };
    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: NOW });
    assert.equal(result.status, 'needs_input');
  });
});
