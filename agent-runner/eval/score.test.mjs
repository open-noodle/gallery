import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregate, classificationPass, evalScenario, renderScorecard } from './score.mjs';

const base = { kind: 'rename_or_describe_album', parsedSlots: { albumRef: 'Japan' } };

describe('classificationPass — toolSequence', () => {
  it('passes on an exact ordered match', () => {
    const decision = { ...base, toolSequence: ['listAlbums', 'proposeAlbumOperations'] };
    assert.equal(
      classificationPass(decision, { kind: base.kind, toolSequence: ['listAlbums', 'proposeAlbumOperations'] }),
      true,
    );
  });

  it('fails when the order differs', () => {
    const decision = { ...base, toolSequence: ['proposeAlbumOperations', 'listAlbums'] };
    assert.equal(
      classificationPass(decision, { kind: base.kind, toolSequence: ['listAlbums', 'proposeAlbumOperations'] }),
      false,
    );
  });

  it('fails on a redundant extra call (length mismatch)', () => {
    const decision = { ...base, toolSequence: ['listAlbums', 'searchAssets', 'proposeAlbumOperations'] };
    assert.equal(
      classificationPass(decision, { kind: base.kind, toolSequence: ['listAlbums', 'proposeAlbumOperations'] }),
      false,
    );
  });

  it('fails on a missing call', () => {
    const decision = { ...base, toolSequence: ['listAlbums'] };
    assert.equal(
      classificationPass(decision, { kind: base.kind, toolSequence: ['listAlbums', 'proposeAlbumOperations'] }),
      false,
    );
  });

  it('supports asserting no tool calls at all', () => {
    const decision = { kind: 'none', toolSequence: [] };
    assert.equal(classificationPass(decision, { kind: 'none', toolSequence: [] }), true);
  });

  // The check above passes trivially if the new logic sits after the
  // `kind === 'none'` short-circuit, so this is the test that actually pins
  // placement. It MUST fail if the checks are added in the wrong place.
  it('fails a kind:none scenario that nonetheless called tools', () => {
    const decision = { kind: 'none', toolSequence: ['listAlbums'] };
    assert.equal(classificationPass(decision, { kind: 'none', toolSequence: [] }), false);
  });

  it('fails a kind:none scenario that nonetheless proposed a plan', () => {
    const decision = { kind: 'none', planProposed: true, planId: 'plan-1' };
    assert.equal(classificationPass(decision, { kind: 'none', noPlan: true }), false);
  });
});

describe('classificationPass — the raw-asset-id invariant is not opt-in', () => {
  it('fails a decision carrying a leak even when the scenario asserts nothing about it', () => {
    const decision = { ...base, rawAssetIdLeak: 'proposeAlbumOperations.operations[0].assetIds' };
    assert.equal(classificationPass(decision, { kind: base.kind }), false);
  });

  it('fails a negative scenario carrying a leak', () => {
    const decision = { kind: 'none', rawAssetIdLeak: 'proposeAlbumOperations.assetIds' };
    assert.equal(classificationPass(decision, { kind: 'none' }), false);
  });

  it('passes when there is no leak', () => {
    const decision = { ...base, rawAssetIdLeak: null };
    assert.equal(classificationPass(decision, { kind: base.kind }), true);
  });
});

describe('classificationPass — planOps', () => {
  it('passes when every expected op type is present', () => {
    const decision = { ...base, planOps: [{ type: 'album.updateDetails' }] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.updateDetails'] }), true);
  });

  it('allows extra ops the scenario does not assert', () => {
    const decision = { ...base, planOps: [{ type: 'album.create' }, { type: 'album.addAssets' }] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.create'] }), true);
  });

  it('ignores order', () => {
    const decision = { ...base, planOps: [{ type: 'album.addAssets' }, { type: 'album.create' }] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.create', 'album.addAssets'] }), true);
  });

  it('fails when an expected op type is missing', () => {
    const decision = { ...base, planOps: [{ type: 'album.create' }] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.updateDetails'] }), false);
  });

  it('fails when no plan ops were recorded at all', () => {
    const decision = { ...base, planOps: [] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.updateDetails'] }), false);
  });
});

describe('classificationPass — noPlan', () => {
  it('passes when nothing was proposed', () => {
    const decision = { ...base, planProposed: false, planId: null };
    assert.equal(classificationPass(decision, { kind: base.kind, noPlan: true }), true);
  });

  it('fails when a plan was proposed', () => {
    const decision = { ...base, planProposed: true, planId: 'plan-1' };
    assert.equal(classificationPass(decision, { kind: base.kind, noPlan: true }), false);
  });
});

describe('classificationPass — existing keys still work', () => {
  it('ignores the new keys when a scenario does not opt in', () => {
    const decision = { ...base, toolSequence: ['listAlbums'], planOps: [], planProposed: false };
    assert.equal(classificationPass(decision, { kind: base.kind, slotsSurvive: true }), true);
  });

  it('still fails on the wrong kind', () => {
    const decision = { ...base, toolSequence: [] };
    assert.equal(classificationPass(decision, { kind: 'delete_album', toolSequence: [] }), false);
  });
});

describe('evalScenario — multi-turn prompt rendering', () => {
  // L2 widened a turn to `string | { approve: boolean } | { advanceMs: number }`
  // (Task 4). `sc.prompt` used to render an object turn as the default
  // `[object Object]` in both the scorecard and --json output. This pins the
  // readable rendering without touching pass/fail: the driver's decision
  // always matches `expect`, so any regression here is caught by the prompt
  // assertion alone.
  const passingDriver = {
    converse: async () => ({ kind: 'rename_or_describe_album', toolSequence: [], rawAssetIdLeak: null }),
  };

  it('renders a mixed turns array (string + approval + advanceMs) readably', async () => {
    const sc = {
      id: 'mixed.turns',
      category: 'execution',
      turns: ['rename my Japan album', { approve: true }, { advanceMs: 660000 }],
      expect: { kind: 'rename_or_describe_album' },
    };
    const result = await evalScenario(passingDriver, sc, 1);
    assert.equal(result.prompt, 'rename my Japan album → approve:true → +660000ms');
  });

  it('leaves a string-only turns array unchanged', async () => {
    const sc = {
      id: 'string.turns',
      category: 'execution',
      turns: ['hello', 'world'],
      expect: { kind: 'rename_or_describe_album' },
    };
    const result = await evalScenario(passingDriver, sc, 1);
    assert.equal(result.prompt, 'hello → world');
  });
});

describe('renderScorecard — failure detail rendering', () => {
  // Regression coverage: the "got:" line used to omit toolSequence/planOps
  // entirely, so a failing L2 scenario gave no clue what actually ran — the
  // operator had to reach for a standalone driver call to see it. See the L2
  // Task 6 regression probe.
  it('shows the actual toolSequence and planOps for a failing L2-shaped result', () => {
    const results = [
      {
        id: 'l2.rename.planned',
        category: 'execution',
        prompt: 'rename my Japan album to Japan 2026',
        score: 0,
        passed: false,
        threshold: 1,
        detail: {
          kind: 'rename_or_describe_album',
          via: 'regex',
          parsedSlots: undefined,
          planProposed: true,
          outcomeStatus: 'planned',
          toolSequence: ['listAlbums', 'listAlbums', 'proposeAlbumOperations'],
          planOps: [{ type: 'album.updateDetails' }],
        },
        expect: { kind: 'rename_or_describe_album', toolSequence: ['listAlbums', 'proposeAlbumOperations'] },
      },
    ];
    const agg = aggregate(results);
    const card = renderScorecard(agg, results, {
      model: 'l2-fake-mcp',
      baseUrl: 'in-memory',
      routerMode: 'regex',
      runs: 1,
      layer: 'L2',
    });
    assert.match(card, /toolSequence=\["listAlbums","listAlbums","proposeAlbumOperations"\]/);
    assert.match(card, /planOps=\["album\.updateDetails"\]/);
  });

  it('renders an L1-shaped failure (no toolSequence/planOps) without either key, and without printing "undefined"', () => {
    const results = [
      {
        id: 'recall.trip.greece',
        category: 'recall',
        prompt: 'make an album from my Greece trip',
        score: 0,
        passed: false,
        threshold: 0.6,
        // Mirrors createL1Driver's decision shape exactly: only
        // { kind, via, confidence, slots, parsedSlots } — no planProposed,
        // outcomeStatus, toolSequence, or planOps keys at all.
        detail: {
          kind: 'none',
          via: 'llm',
          confidence: 0.4,
          slots: {},
          parsedSlots: null,
        },
        expect: { kind: 'create_recent_trip_album', slotsSurvive: true },
      },
    ];
    const agg = aggregate(results);
    const card = renderScorecard(agg, results, {
      model: 'local-model',
      baseUrl: 'http://127.0.0.1:8080',
      routerMode: 'hybrid',
      runs: 3,
      layer: 'L1',
    });
    assert.ok(!card.includes('toolSequence'), 'L1 failure must not print a toolSequence field at all');
    assert.ok(!card.includes('planOps'), 'L1 failure must not print a planOps field at all');
    assert.ok(!card.includes('undefined'), 'a missing field must degrade to nothing, never the literal "undefined"');
  });
});
