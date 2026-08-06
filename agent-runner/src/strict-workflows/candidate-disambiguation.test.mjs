import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCandidateContinuation,
  resumeFromCandidates,
} from './candidate-disambiguation.mjs';

// ─── buildCandidateContinuation ───────────────────────────────────────────────

describe('buildCandidateContinuation', () => {
  const NOW = 1_000_000;
  const candidates = [
    { id: 'a1', name: 'Family', extraAssetIds: ['x', 'y'], unrelatedField: 123 },
    { id: 'b2', name: 'Family 2026', extraAssetIds: ['z'] },
    { id: 'c3', name: 'Trips' },
  ];

  it('compacts candidates to {index, id, name} only — drops extra fields', () => {
    const cont = buildCandidateContinuation({ kind: 'test_kind', candidates, nowMs: NOW });
    assert.deepEqual(cont.candidates, [
      { index: 1, id: 'a1', name: 'Family' },
      { index: 2, id: 'b2', name: 'Family 2026' },
      { index: 3, id: 'c3', name: 'Trips' },
    ]);
  });

  it('sets kind and createdAtMs', () => {
    const cont = buildCandidateContinuation({ kind: 'my_kind', candidates, nowMs: NOW });
    assert.equal(cont.kind, 'my_kind');
    assert.equal(cont.createdAtMs, NOW);
  });

  it('caps at 5 candidates', () => {
    const six = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
      { id: '3', name: 'C' },
      { id: '4', name: 'D' },
      { id: '5', name: 'E' },
      { id: '6', name: 'F' },
    ];
    const cont = buildCandidateContinuation({ kind: 'k', candidates: six, nowMs: NOW });
    assert.equal(cont.candidates.length, 5);
    assert.equal(cont.candidates[4].id, '5');
  });

  it('carries whitelisted extra fields (e.g. resolvedSpaceId)', () => {
    const cont = buildCandidateContinuation({
      kind: 'k',
      candidates,
      nowMs: NOW,
      resolvedSpaceId: 'space-xyz',
      slots: { action: 'add' },
    });
    assert.equal(cont.resolvedSpaceId, 'space-xyz');
    assert.deepEqual(cont.slots, { action: 'add' });
  });

  it('does NOT carry raw asset id arrays from candidates — only id+name survive per candidate', () => {
    const cont = buildCandidateContinuation({ kind: 'k', candidates, nowMs: NOW });
    for (const c of cont.candidates) {
      assert.equal(Object.keys(c).join(','), 'index,id,name');
    }
  });

  it('does NOT carry unexpected fields from the candidates input (only id+name)', () => {
    const withExtra = [{ id: 'a1', name: 'Family', extraAssetIds: ['x'], junk: true }];
    const cont = buildCandidateContinuation({ kind: 'k', candidates: withExtra, nowMs: NOW });
    const c = cont.candidates[0];
    assert.ok(!('extraAssetIds' in c), 'extraAssetIds must not leak through');
    assert.ok(!('junk' in c), 'junk must not leak through');
  });
});

// ─── resumeFromCandidates ─────────────────────────────────────────────────────

describe('resumeFromCandidates', () => {
  const KIND = 'space_pick';
  const TTL = 10 * 60 * 1000;
  const NOW = 1_000_000;

  const makePending = (overrides = {}) =>
    buildCandidateContinuation({
      kind: KIND,
      candidates: [
        { id: 'a1', name: 'Family' },
        { id: 'b2', name: 'Family 2026' },
      ],
      nowMs: NOW,
      ...overrides,
    });

  const resume = (prompt, pendingOverride, nowOverride) =>
    resumeFromCandidates({
      pending: pendingOverride ?? makePending(),
      prompt,
      nowMs: nowOverride ?? NOW,
      ttlMs: TTL,
      kind: KIND,
    });

  // ── ordinal matching ──────────────────────────────────────────────────────

  it('"1" → index 1', () => {
    const r = resume('1');
    assert.equal(r.status, 'matched');
    assert.deepEqual(r.choice, { index: 1, id: 'a1', name: 'Family' });
  });

  it('"first" → index 1', () => {
    const r = resume('first');
    assert.equal(r.status, 'matched');
    assert.equal(r.choice.index, 1);
  });

  it('"2" → index 2', () => {
    const r = resume('2');
    assert.equal(r.status, 'matched');
    assert.equal(r.choice.index, 2);
  });

  it('"the second one" → index 2', () => {
    const r = resume('the second one');
    assert.equal(r.status, 'matched');
    assert.equal(r.choice.index, 2);
  });

  it('out-of-range ordinal ("5" when 2 candidates) → needs_input', () => {
    const r = resume('5');
    assert.equal(r.status, 'needs_input');
  });

  // ── single-candidate yes ──────────────────────────────────────────────────

  it('single candidate + "yes" → matched', () => {
    const single = buildCandidateContinuation({
      kind: KIND,
      candidates: [{ id: 'x1', name: 'Trips' }],
      nowMs: NOW,
    });
    const r = resumeFromCandidates({ pending: single, prompt: 'yes', nowMs: NOW, ttlMs: TTL, kind: KIND });
    assert.equal(r.status, 'matched');
    assert.equal(r.choice.id, 'x1');
  });

  it('single candidate + "use it" → matched', () => {
    const single = buildCandidateContinuation({
      kind: KIND,
      candidates: [{ id: 'x1', name: 'Trips' }],
      nowMs: NOW,
    });
    const r = resumeFromCandidates({ pending: single, prompt: 'use it', nowMs: NOW, ttlMs: TTL, kind: KIND });
    assert.equal(r.status, 'matched');
  });

  it('"yes" with two candidates → needs_input (no single-candidate shortcut)', () => {
    const r = resume('yes');
    assert.equal(r.status, 'needs_input');
  });

  // ── name matching ─────────────────────────────────────────────────────────

  it('exact name match (case-insensitive) → matched', () => {
    const r = resume('family 2026');
    assert.equal(r.status, 'matched');
    assert.equal(r.choice.id, 'b2');
  });

  it('substring match "Family 2026" → matched', () => {
    const r = resume('use Family 2026');
    assert.equal(r.status, 'matched');
    assert.equal(r.choice.id, 'b2');
  });

  it('ambiguous substring ("family" matches both candidates) → needs_input', () => {
    // "family" is a substring of both "Family" and "Family 2026"
    const r = resume('family');
    assert.equal(r.status, 'needs_input');
  });

  it('name not in the list → needs_input', () => {
    const r = resume('Holidays');
    assert.equal(r.status, 'needs_input');
  });

  // ── duplicate names ───────────────────────────────────────────────────────

  it('duplicate candidate names → needs_input asking to use the number', () => {
    const dupPending = buildCandidateContinuation({
      kind: KIND,
      candidates: [
        { id: 'a1', name: 'Family' },
        { id: 'b2', name: 'Family' },
      ],
      nowMs: NOW,
    });
    const r = resumeFromCandidates({ pending: dupPending, prompt: 'Family', nowMs: NOW, ttlMs: TTL, kind: KIND });
    assert.equal(r.status, 'needs_input');
    // message should hint the user to use a number
    assert.ok(/\d/.test(r.text), 'needs_input text should mention a number for disambiguation');
  });

  // ── numeric candidate name — ordinal-by-index precedence ─────────────────
  // A space literally named "2" is still overridden by the ordinal index pick.
  // Rule: ordinal is checked before name-match; prompt "2" picks index 2, even
  // if there is a candidate at index 1 literally named "2".
  it('numeric candidate name: ordinal wins over name-match by index precedence', () => {
    const numericPending = buildCandidateContinuation({
      kind: KIND,
      candidates: [
        { id: 'n1', name: '2' },    // index 1, but named "2"
        { id: 'n2', name: 'Other' }, // index 2
      ],
      nowMs: NOW,
    });
    // "2" should pick index 2 (ordinal), NOT index 1 (which is named "2")
    const r = resumeFromCandidates({ pending: numericPending, prompt: '2', nowMs: NOW, ttlMs: TTL, kind: KIND });
    assert.equal(r.status, 'matched');
    assert.equal(r.choice.index, 2);
    assert.equal(r.choice.id, 'n2');
  });

  // ── TTL / expiry ──────────────────────────────────────────────────────────

  it('expired continuation → status expired', () => {
    const r = resumeFromCandidates({
      pending: makePending(),
      prompt: '1',
      nowMs: NOW + TTL + 1,
      ttlMs: TTL,
      kind: KIND,
    });
    assert.equal(r.status, 'expired');
    assert.ok(typeof r.text === 'string' && r.text.length > 0);
  });

  it('exactly at TTL boundary → not yet expired', () => {
    const r = resumeFromCandidates({
      pending: makePending(),
      prompt: '1',
      nowMs: NOW + TTL,
      ttlMs: TTL,
      kind: KIND,
    });
    assert.equal(r.status, 'matched');
  });

  // ── wrong / absent kind ───────────────────────────────────────────────────

  it('wrong kind → missing', () => {
    const r = resumeFromCandidates({
      pending: makePending(),
      prompt: '1',
      nowMs: NOW,
      ttlMs: TTL,
      kind: 'wrong_kind',
    });
    assert.equal(r.status, 'missing');
  });

  it('null pending → missing', () => {
    const r = resumeFromCandidates({
      pending: null,
      prompt: '1',
      nowMs: NOW,
      ttlMs: TTL,
      kind: KIND,
    });
    assert.equal(r.status, 'missing');
  });

  // ── matched return shape ──────────────────────────────────────────────────

  it('matched result carries pending so callers can read extra fields (e.g. resolvedSpaceId)', () => {
    const withExtra = buildCandidateContinuation({
      kind: KIND,
      candidates: [{ id: 'x1', name: 'Trips' }],
      nowMs: NOW,
      resolvedSpaceId: 'space-abc',
      slots: { action: 'add' },
    });
    const r = resumeFromCandidates({ pending: withExtra, prompt: '1', nowMs: NOW, ttlMs: TTL, kind: KIND });
    assert.equal(r.status, 'matched');
    assert.deepEqual(r.choice, { index: 1, id: 'x1', name: 'Trips' });
    // pending is returned on match so callers can access resolvedSpaceId etc.
    assert.equal(r.pending.resolvedSpaceId, 'space-abc');
    assert.deepEqual(r.pending.slots, { action: 'add' });
  });
});
