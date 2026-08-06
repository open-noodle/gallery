import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeContractClient } from './contract-fixtures.mjs';
import { mergePeopleWorkflow } from './merge-people.mjs';

const NOW = 1_717_000_000_000;

const wf = mergePeopleWorkflow();

// ── match ─────────────────────────────────────────────────────────────────────

describe('merge_people match', () => {
  it('matches "merge Alejandra into Karina" (into form)', () => {
    const result = wf.match('merge Alejandra into Karina');
    assert.ok(result);
    assert.equal(result.slots.sourceRef, 'Alejandra');
    assert.equal(result.slots.keepRef, 'Karina');
  });

  it('matches "Merge Alex into Alexander" (case-insensitive)', () => {
    const result = wf.match('Merge Alex into Alexander');
    assert.ok(result);
    assert.equal(result.slots.sourceRef, 'Alex');
    assert.equal(result.slots.keepRef, 'Alexander');
  });

  it('matches "merge Alex and Karina" (and form — keep = last-named)', () => {
    const result = wf.match('merge Alex and Karina');
    assert.ok(result);
    assert.equal(result.slots.sourceRef, 'Alex');
    assert.equal(result.slots.keepRef, 'Karina');
  });

  it('does NOT match "rename Alex to Karina" (wrong verb)', () => {
    assert.equal(wf.match('rename Alex to Karina'), undefined);
  });

  it('does NOT match "merge" alone with no names', () => {
    assert.equal(wf.match('merge'), undefined);
  });

  it('does NOT match an empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('strips trailing punctuation from keepRef', () => {
    const result = wf.match('merge Alejandra into Karina.');
    assert.ok(result);
    assert.equal(result.slots.keepRef, 'Karina');
  });
});

// ── parseSlots ────────────────────────────────────────────────────────────────

describe('merge_people parseSlots', () => {
  it('returns slots when both sourceRef and keepRef are present', () => {
    const slots = wf.parseSlots({ sourceRef: 'Alejandra', keepRef: 'Karina' });
    assert.deepEqual(slots, { sourceRef: 'Alejandra', keepRef: 'Karina' });
  });

  it('returns null when sourceRef is missing', () => {
    assert.equal(wf.parseSlots({ keepRef: 'Karina' }), null);
  });

  it('returns null when keepRef is missing', () => {
    assert.equal(wf.parseSlots({ sourceRef: 'Alejandra' }), null);
  });

  it('returns null when both are missing', () => {
    assert.equal(wf.parseSlots({}), null);
  });
});

// ── run helpers ───────────────────────────────────────────────────────────────

const makePeopleClient = ({
  people = [
    { id: 'pid-alejandra', name: 'Alejandra' },
    { id: 'pid-karina', name: 'Karina' },
  ],
  planResult,
} = {}) =>
  makeContractClient({
    people,
    ...(planResult !== undefined ? { planResult } : {}),
  });

const getProposedOp = (client) =>
  client.calls.find((c) => c.name === 'proposeAlbumOperations')?.args?.operations?.[0];

// ── run ───────────────────────────────────────────────────────────────────────

describe('merge_people run', () => {
  it('matched → proposes person.merge with correct payload (into form)', async () => {
    const client = makePeopleClient();
    const result = await wf.run({
      client,
      slots: { sourceRef: 'Alejandra', keepRef: 'Karina' },
      nowMs: NOW,
    });

    assert.equal(result.status, 'planned');
    const op = getProposedOp(client);
    assert.ok(op, 'expected a proposeAlbumOperations call');
    assert.equal(op.type, 'person.merge');
    assert.equal(op.targetKind, 'person');
    assert.equal(op.targetId, 'pid-karina');
    assert.equal(op.riskLevel, 'high');
    assert.deepEqual(op.payload, { sourcePersonIds: ['pid-alejandra'] });
    // Must NOT include raw face data.
    assert.equal(op.payload.faceAssetId, undefined);
  });

  it('plan success text discloses irreversibility', async () => {
    const client = makePeopleClient();
    const result = await wf.run({
      client,
      slots: { sourceRef: 'Alejandra', keepRef: 'Karina' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'planned');
    assert.ok(/cannot be undone|irreversible/i.test(result.text ?? ''));
  });

  it('successSummary has workflowKind, keepName, mergeName', async () => {
    const client = makePeopleClient();
    const result = await wf.run({
      client,
      slots: { sourceRef: 'Alejandra', keepRef: 'Karina' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'planned');
    assert.equal(result.successSummary?.workflowKind, 'merge_people');
    assert.ok(result.successSummary?.keepName);
    assert.ok(result.successSummary?.mergeName);
  });

  it('source not_found → needsInput (no propose)', async () => {
    const client = makePeopleClient({ people: [{ id: 'pid-karina', name: 'Karina' }] });
    const result = await wf.run({
      client,
      slots: { sourceRef: 'Zzzqqq', keepRef: 'Karina' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('keep not_found → needsInput (no propose)', async () => {
    const client = makePeopleClient({ people: [{ id: 'pid-alejandra', name: 'Alejandra' }] });
    const result = await wf.run({
      client,
      slots: { sourceRef: 'Alejandra', keepRef: 'Zzzqqq' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('source ambiguous → needsInput with continuation (no propose)', async () => {
    const client = makeContractClient({
      peopleResult: {
        status: 'ambiguous',
        choices: [
          { personId: 'id-1', name: 'Alex A', thumbnailAssetId: null },
          { personId: 'id-2', name: 'Alex B', thumbnailAssetId: null },
        ],
      },
    });
    // Override to return matched for keep (but source search runs first and gets ambiguous)
    // Actually contract-fixtures only has one searchPeople handler; source is searched first
    // and gets ambiguous — keep is never searched.
    const result = await wf.run({
      client,
      slots: { sourceRef: 'Alex', keepRef: 'Karina' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'needs_input');
    assert.ok(result.continuation, 'expected a continuation for ambiguous source');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('same-person → needsInput (decline)', async () => {
    const client = makePeopleClient({
      people: [{ id: 'pid-alejandra', name: 'Alejandra' }],
    });
    const result = await wf.run({
      client,
      slots: { sourceRef: 'Alejandra', keepRef: 'Alejandra' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'needs_input');
    assert.ok(/same person/i.test(result.text ?? ''));
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('needsInput when no sourceRef or keepRef provided', async () => {
    const client = makePeopleClient();
    const result = await wf.run({ client, slots: {}, nowMs: NOW });
    assert.equal(result.status, 'needs_input');
  });

  it('plan error → failed', async () => {
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'searchPeople') {
          const people = [
            { id: 'pid-alejandra', name: 'Alejandra' },
            { id: 'pid-karina', name: 'Karina' },
          ];
          const q = String(args?.name ?? '').trim().toLowerCase();
          const match = people.find((p) => p.name.toLowerCase() === q);
          if (match) return { people: { status: 'matched', personId: match.id, name: match.name, thumbnailAssetId: null } };
          return { people: { status: 'not_found' } };
        }
        if (name === 'proposeAlbumOperations') throw new Error('plan tool error');
        throw new Error(`Unexpected tool: ${name}`);
      },
    };
    const result = await wf.run({
      client,
      slots: { sourceRef: 'Alejandra', keepRef: 'Karina' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'failed');
  });

  it('resolvedSourcePersonId skips source search, still resolves keep', async () => {
    let searchCallCount = 0;
    let proposedOp;
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'searchPeople') {
          searchCallCount++;
          return { people: { status: 'matched', personId: 'pid-karina', name: 'Karina', thumbnailAssetId: null } };
        }
        if (name === 'proposeAlbumOperations') {
          proposedOp = args.operations[0];
          return { status: 'success', plan: { id: 'plan-1' } };
        }
        throw new Error(`Unexpected tool: ${name}`);
      },
    };

    await wf.run({
      client,
      slots: { sourceRef: 'Alejandra', keepRef: 'Karina' },
      resolvedSourcePersonId: 'pid-alejandra-direct',
      nowMs: NOW,
    });

    // Source search is skipped; only keep search happens.
    assert.equal(searchCallCount, 1);
    assert.equal(proposedOp.payload.sourcePersonIds[0], 'pid-alejandra-direct');
    assert.equal(proposedOp.targetId, 'pid-karina');
  });

  it('resolvedKeepPersonId skips keep search and proposes immediately', async () => {
    let searchCallCount = 0;
    let proposedOp;
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'searchPeople') {
          searchCallCount++;
          return { people: { status: 'matched', personId: 'pid-alejandra', name: 'Alejandra', thumbnailAssetId: null } };
        }
        if (name === 'proposeAlbumOperations') {
          proposedOp = args.operations[0];
          return { status: 'success', plan: { id: 'plan-1' } };
        }
        throw new Error(`Unexpected tool: ${name}`);
      },
    };

    await wf.run({
      client,
      slots: { sourceRef: 'Alejandra', keepRef: 'Karina' },
      resolvedSourcePersonId: 'pid-alejandra',
      resolvedKeepPersonId: 'pid-karina-direct',
      nowMs: NOW,
    });

    // Both are pre-resolved; no search calls needed.
    assert.equal(searchCallCount, 0);
    assert.equal(proposedOp.payload.sourcePersonIds[0], 'pid-alejandra');
    assert.equal(proposedOp.targetId, 'pid-karina-direct');
  });

  it('plan gate fails when plan has no persisted id', async () => {
    const client = makePeopleClient({ planResult: { status: 'success', plan: {} } });
    const result = await wf.run({
      client,
      slots: { sourceRef: 'Alejandra', keepRef: 'Karina' },
      nowMs: NOW,
    });
    assert.equal(result.status, 'failed');
    assert.equal(/prepared/i.test(result.text ?? ''), false);
  });
});

// ── resumeContinuation ────────────────────────────────────────────────────────

describe('merge_people resumeContinuation', () => {
  it('returns matched ctx for source candidate pick', () => {
    const pending = {
      kind: 'merge_people_source',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'id-1', name: 'Alex A' },
        { index: 2, id: 'id-2', name: 'Alex B' },
      ],
      slots: { sourceRef: 'Alex', keepRef: 'Karina' },
    };

    const result = wf.resumeContinuation({ pending, prompt: 'the first one', nowMs: NOW });

    assert.equal(result.status, 'matched');
    assert.equal(result.ctx.resolvedSourcePersonId, 'id-1');
    assert.equal(result.ctx.resolvedKeepPersonId, undefined);
    assert.deepEqual(result.ctx.slots, { sourceRef: 'Alex', keepRef: 'Karina' });
  });

  it('returns matched ctx for keep candidate pick (carries resolvedSourcePersonId)', () => {
    const pending = {
      kind: 'merge_people_keep',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'pid-k1', name: 'Karina A' },
        { index: 2, id: 'pid-k2', name: 'Karina B' },
      ],
      slots: { sourceRef: 'Alejandra', keepRef: 'Karina', resolvedSourcePersonId: 'pid-alejandra' },
    };

    const result = wf.resumeContinuation({ pending, prompt: '2', nowMs: NOW });

    assert.equal(result.status, 'matched');
    assert.equal(result.ctx.resolvedKeepPersonId, 'pid-k2');
    assert.equal(result.ctx.resolvedSourcePersonId, 'pid-alejandra');
  });

  it('returns needs_input for wrong kind', () => {
    const pending = { kind: 'wrong_kind', createdAtMs: NOW, candidates: [], slots: {} };
    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: NOW });
    assert.equal(result.status, 'needs_input');
  });
});
