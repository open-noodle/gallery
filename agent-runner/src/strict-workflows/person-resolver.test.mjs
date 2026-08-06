import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolvePerson, resumePersonFromCandidates } from './person-resolver.mjs';

const NOW = 1_717_000_000_000;
const KIND = 'test_person_kind';

const makeClient = (response) => ({
  call: async () => response,
});

const makeErrorClient = (error) => ({
  call: async () => { throw error; },
});

describe('resolvePerson', () => {
  it('returns matched when searchPeople returns a single matched result', async () => {
    const personId = 'person-abc';
    const client = makeClient({ people: { status: 'matched', personId, name: 'Alice', thumbnailAssetId: null } });

    const result = await resolvePerson({ client, name: 'Alice', nowMs: NOW, kind: KIND });

    assert.equal(result.status, 'matched');
    assert.equal(result.personId, personId);
    assert.equal(result.name, 'Alice');
  });

  it('returns needs_input when searchPeople returns not_found', async () => {
    const client = makeClient({ people: { status: 'not_found' } });

    const result = await resolvePerson({ client, name: 'Zzzqqq', nowMs: NOW, kind: KIND });

    assert.equal(result.status, 'needs_input');
    assert.match(result.text, /Zzzqqq/);
  });

  it('returns candidates with continuation when searchPeople returns ambiguous', async () => {
    const client = makeClient({
      people: {
        status: 'ambiguous',
        choices: [
          { personId: 'id-1', name: 'Alex A', thumbnailAssetId: null },
          { personId: 'id-2', name: 'Alex B', thumbnailAssetId: null },
        ],
      },
    });

    const result = await resolvePerson({ client, name: 'Alex', nowMs: NOW, kind: KIND, slots: { personRef: 'Alex' } });

    assert.equal(result.status, 'candidates');
    assert.ok(result.continuation);
    assert.equal(result.continuation.kind, KIND);
    assert.equal(result.continuation.candidates.length, 2);
    assert.match(result.text, /Alex/);
  });

  it('returns failed when the searchPeople tool throws', async () => {
    const client = makeErrorClient(new Error('network error'));

    const result = await resolvePerson({ client, name: 'Alice', nowMs: NOW, kind: KIND });

    assert.equal(result.status, 'failed');
    assert.match(result.text, /network error/);
  });

  it('passes includeHidden to searchPeople when set', async () => {
    let calledWith;
    const client = {
      call: async (_name, request) => {
        calledWith = request;
        return { people: { status: 'not_found' } };
      },
    };

    await resolvePerson({ client, name: 'HiddenAlex', includeHidden: true, nowMs: NOW, kind: KIND });

    assert.equal(calledWith.includeHidden, true);
  });

  it('does not include includeHidden in request when false (default)', async () => {
    let calledWith;
    const client = {
      call: async (_name, request) => {
        calledWith = request;
        return { people: { status: 'not_found' } };
      },
    };

    await resolvePerson({ client, name: 'Alice', nowMs: NOW, kind: KIND });

    assert.equal(calledWith.includeHidden, undefined);
  });
});

describe('resumePersonFromCandidates', () => {
  const makePending = (candidates, slots = {}) => ({
    kind: KIND,
    createdAtMs: NOW,
    candidates: candidates.map((c, i) => ({ index: i + 1, id: c.id, name: c.name })),
    slots,
  });

  it('resolves by ordinal "1" / "first"', () => {
    const pending = makePending([
      { id: 'id-1', name: 'Alex A' },
      { id: 'id-2', name: 'Alex B' },
    ], { personRef: 'Alex' });

    const result = resumePersonFromCandidates({ pending, prompt: 'the first one', nowMs: NOW, kind: KIND });

    assert.equal(result.status, 'matched');
    assert.equal(result.personId, 'id-1');
    assert.equal(result.personName, 'Alex A');
    assert.deepEqual(result.slots, { personRef: 'Alex' });
  });

  it('resolves by ordinal "2"', () => {
    const pending = makePending([
      { id: 'id-1', name: 'Alex A' },
      { id: 'id-2', name: 'Alex B' },
    ]);

    const result = resumePersonFromCandidates({ pending, prompt: '2', nowMs: NOW, kind: KIND });

    assert.equal(result.status, 'matched');
    assert.equal(result.personId, 'id-2');
  });

  it('resolves by name substring', () => {
    const pending = makePending([
      { id: 'id-1', name: 'Alice Smith' },
      { id: 'id-2', name: 'Bob Jones' },
    ]);

    const result = resumePersonFromCandidates({ pending, prompt: 'Alice', nowMs: NOW, kind: KIND });

    assert.equal(result.status, 'matched');
    assert.equal(result.personId, 'id-1');
  });

  it('returns needs_input for expired continuation', () => {
    const pending = makePending([{ id: 'id-1', name: 'Alex' }]);
    const expired = NOW + 15 * 60 * 1000; // 15 min later

    const result = resumePersonFromCandidates({ pending, prompt: '1', nowMs: expired, kind: KIND });

    assert.equal(result.status, 'expired');
  });

  it('returns needs_input when no match is found', () => {
    const pending = makePending([
      { id: 'id-1', name: 'Alice' },
      { id: 'id-2', name: 'Bob' },
    ]);

    const result = resumePersonFromCandidates({ pending, prompt: 'Charlie', nowMs: NOW, kind: KIND });

    assert.equal(result.status, 'needs_input');
  });
});
