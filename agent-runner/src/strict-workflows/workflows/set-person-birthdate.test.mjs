import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDateString, setPersonBirthdateWorkflow } from './set-person-birthdate.mjs';

const NOW = 1_717_000_000_000;

const wf = setPersonBirthdateWorkflow();

// ── parseDateString ───────────────────────────────────────────────────────────

describe('parseDateString', () => {
  it('parses ISO YYYY-MM-DD', () => {
    assert.equal(parseDateString('1990-05-01'), '1990-05-01');
  });

  it('parses "May 1 1990"', () => {
    assert.equal(parseDateString('May 1 1990'), '1990-05-01');
  });

  it('parses "May 1, 1990"', () => {
    assert.equal(parseDateString('May 1, 1990'), '1990-05-01');
  });

  it('parses "1 May 1990"', () => {
    assert.equal(parseDateString('1 May 1990'), '1990-05-01');
  });

  it('parses "1st May 1990"', () => {
    assert.equal(parseDateString('1st May 1990'), '1990-05-01');
  });

  it('returns null for unparseable string', () => {
    assert.equal(parseDateString('last Tuesday'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseDateString(''), null);
  });

  it('returns "future" for a date in the future', () => {
    const future = new Date(Date.now() + 365 * 86400 * 1000);
    const iso = future.toISOString().slice(0, 10);
    assert.equal(parseDateString(iso), 'future');
  });

  it('parses "December 25 2000"', () => {
    assert.equal(parseDateString('December 25 2000'), '2000-12-25');
  });
});

// ── match ─────────────────────────────────────────────────────────────────────

describe('set_person_birthdate match', () => {
  it('matches "set Alex\'s birthday to 1990-05-01"', () => {
    const result = wf.match("set Alex's birthday to 1990-05-01");
    assert.ok(result);
    assert.equal(result.slots.personRef, 'Alex');
    assert.equal(result.slots.dateStr, '1990-05-01');
  });

  it('matches "set Alex\'s birthdate to May 1 1990"', () => {
    const result = wf.match("set Alex's birthdate to May 1 1990");
    assert.ok(result);
    assert.equal(result.slots.personRef, 'Alex');
    assert.equal(result.slots.dateStr, 'May 1 1990');
  });

  it('matches "set Alex\'s date of birth to 1990-05-01"', () => {
    const result = wf.match("set Alex's date of birth to 1990-05-01");
    assert.ok(result);
    assert.equal(result.slots.personRef, 'Alex');
  });

  it('does NOT match "rename Alex to Bob"', () => {
    assert.equal(wf.match('rename Alex to Bob'), undefined);
  });

  it('does NOT match "hide Alex"', () => {
    assert.equal(wf.match('hide Alex'), undefined);
  });
});

// ── parseSlots ────────────────────────────────────────────────────────────────

describe('set_person_birthdate parseSlots', () => {
  it('returns slots when both fields are present', () => {
    const slots = wf.parseSlots({ personRef: 'Alex', dateStr: '1990-05-01' });
    assert.deepEqual(slots, { personRef: 'Alex', dateStr: '1990-05-01' });
  });

  it('returns null when personRef is missing', () => {
    assert.equal(wf.parseSlots({ dateStr: '1990-05-01' }), null);
  });

  it('returns null when dateStr is missing', () => {
    assert.equal(wf.parseSlots({ personRef: 'Alex' }), null);
  });
});

// ── run ───────────────────────────────────────────────────────────────────────

describe('set_person_birthdate run', () => {
  const makeMatchedClient = () => ({
    call: async (tool, request) => {
      if (tool === 'searchPeople') {
        return { people: { status: 'matched', personId: 'pid-1', name: 'Alex', thumbnailAssetId: null } };
      }
      if (tool === 'proposeAlbumOperations') {
        return { status: 'success', plan: { id: 'plan-1' } };
      }
      throw new Error(`Unexpected tool: ${tool}`);
    },
  });

  it('matched → proposes person.update with birthDate payload', async () => {
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
      slots: { personRef: 'Alex', dateStr: '1990-05-01' },
      nowMs: NOW,
    });

    assert.equal(result.status, 'planned');
    assert.equal(proposedOps[0].type, 'person.update');
    assert.deepEqual(proposedOps[0].payload, { birthDate: '1990-05-01' });
  });

  it('unparseable date → needsInput', async () => {
    const result = await wf.run({
      client: makeMatchedClient(),
      slots: { personRef: 'Alex', dateStr: 'next summer' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'needs_input');
    assert.match(result.text, /parse/i);
  });

  it('future date → needsInput', async () => {
    const future = new Date(Date.now() + 365 * 86400 * 1000).toISOString().slice(0, 10);
    const result = await wf.run({
      client: makeMatchedClient(),
      slots: { personRef: 'Alex', dateStr: future },
      nowMs: NOW,
    });
    assert.equal(result.status, 'needs_input');
    assert.match(result.text, /future/i);
  });

  it('natural date "May 1 1990" is correctly parsed and proposed', async () => {
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

    await wf.run({ client, slots: { personRef: 'Alex', dateStr: 'May 1 1990' }, nowMs: NOW });

    assert.equal(proposedOps[0].payload.birthDate, '1990-05-01');
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
      slots: { personRef: 'Zzzqqq', dateStr: '1990-05-01' },
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
      slots: { personRef: 'Alex', dateStr: '1990-05-01' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'needs_input');
    assert.ok(result.continuation);
  });
});
