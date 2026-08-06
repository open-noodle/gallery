import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanupDuplicatesWorkflow, pickKeeper } from './cleanup-duplicates.mjs';
import { makeContractClient, KNOWN_OPERATION_TYPES } from './contract-fixtures.mjs';

const wf = cleanupDuplicatesWorkflow();

// ── helpers ────────────────────────────────────────────────────────────────────

const makeAsset = (overrides = {}) => ({
  id: overrides.id ?? 'asset-1',
  isFavorite: overrides.isFavorite ?? false,
  rating: overrides.rating ?? null,
  sharpness: overrides.sharpness ?? null,
  width: overrides.width ?? null,
  height: overrides.height ?? null,
  fileCreatedAt: overrides.fileCreatedAt ?? '2025-01-01T00:00:00.000Z',
  ...overrides,
});

const makeGroup = (assets) => ({ duplicateId: 'dup-1', assets });

// ── pickKeeper: deterministic rule ────────────────────────────────────────────

describe('pickKeeper — favorite wins', () => {
  it('picks the favorite over a non-favorite (same rating/resolution/date)', () => {
    const a = makeAsset({ id: 'a', isFavorite: false });
    const b = makeAsset({ id: 'b', isFavorite: true });
    const { keeper, nonKeepers } = pickKeeper([a, b]);
    assert.equal(keeper.id, 'b');
    assert.deepEqual(nonKeepers.map((x) => x.id), ['a']);
  });

  it('picks the first favorite when both are favorites', () => {
    // tie-break falls to rating, then resolution, then date, then id
    const a = makeAsset({ id: 'a', isFavorite: true, rating: 3 });
    const b = makeAsset({ id: 'b', isFavorite: true, rating: 5 });
    const { keeper } = pickKeeper([a, b]);
    assert.equal(keeper.id, 'b'); // higher rating wins
  });
});

describe('pickKeeper — higher rating wins (no favorite)', () => {
  it('picks the higher-rated asset', () => {
    const a = makeAsset({ id: 'a', rating: 2 });
    const b = makeAsset({ id: 'b', rating: 5 });
    const { keeper, nonKeepers } = pickKeeper([a, b]);
    assert.equal(keeper.id, 'b');
    assert.deepEqual(nonKeepers.map((x) => x.id), ['a']);
  });

  it('null rating treated as -1 (loses to any rated asset)', () => {
    const a = makeAsset({ id: 'a', rating: null });
    const b = makeAsset({ id: 'b', rating: 1 });
    const { keeper } = pickKeeper([a, b]);
    assert.equal(keeper.id, 'b');
  });
});

describe('pickKeeper — larger resolution wins (no favorite, same rating)', () => {
  it('picks the asset with larger pixel area', () => {
    const a = makeAsset({ id: 'a', width: 800, height: 600 });   // 480 000
    const b = makeAsset({ id: 'b', width: 1920, height: 1080 }); // 2 073 600
    const { keeper, nonKeepers } = pickKeeper([a, b]);
    assert.equal(keeper.id, 'b');
    assert.deepEqual(nonKeepers.map((x) => x.id), ['a']);
  });

  it('null dimensions treated as 0 (lose to any sized asset)', () => {
    const a = makeAsset({ id: 'a', width: null, height: null });
    const b = makeAsset({ id: 'b', width: 100, height: 100 });
    const { keeper } = pickKeeper([a, b]);
    assert.equal(keeper.id, 'b');
  });
});

describe('pickKeeper — sharpness (ranked above resolution, below rating)', () => {
  it('prefers the sharper of two equal-resolution duplicates', () => {
    const sharp = makeAsset({ id: 'sharp', width: 1000, height: 1000, sharpness: 80 });
    const blurry = makeAsset({ id: 'blurry', width: 1000, height: 1000, sharpness: 20 });
    const { keeper, nonKeepers } = pickKeeper([blurry, sharp]);
    assert.equal(keeper.id, 'sharp');
    assert.deepEqual(nonKeepers.map((x) => x.id), ['blurry']);
  });

  it('ranks present sharpness above resolution (sharper-but-smaller wins)', () => {
    const sharpSmall = makeAsset({ id: 'sharpSmall', width: 800, height: 600, sharpness: 90 });
    const blurryBig = makeAsset({ id: 'blurryBig', width: 4000, height: 3000, sharpness: 10 });
    const { keeper } = pickKeeper([blurryBig, sharpSmall]);
    assert.equal(keeper.id, 'sharpSmall');
  });

  it('falls back to resolution when sharpness is null on both', () => {
    const big = makeAsset({ id: 'big', width: 4000, height: 3000, sharpness: null });
    const small = makeAsset({ id: 'small', width: 800, height: 600, sharpness: null });
    const { keeper } = pickKeeper([small, big]);
    assert.equal(keeper.id, 'big');
  });

  it('treats null sharpness as lowest (scored asset wins over unscored at equal resolution)', () => {
    const scored = makeAsset({ id: 'scored', width: 1000, height: 1000, sharpness: 5 });
    const unscored = makeAsset({ id: 'unscored', width: 1000, height: 1000, sharpness: null });
    const { keeper } = pickKeeper([unscored, scored]);
    assert.equal(keeper.id, 'scored');
  });

  it('all-null sharpness is identical to the pre-sharpness behavior (resolution, then age, then id)', () => {
    const a = makeAsset({ id: 'a', width: 1000, height: 1000, fileCreatedAt: '2025-01-02T00:00:00.000Z' });
    const b = makeAsset({ id: 'b', width: 1000, height: 1000, fileCreatedAt: '2025-01-01T00:00:00.000Z' });
    const { keeper } = pickKeeper([a, b]);
    assert.equal(keeper.id, 'b'); // older wins at equal resolution + null sharpness
  });

  it('rating still outranks sharpness (higher rating but blurrier wins)', () => {
    const highRatingBlurry = makeAsset({ id: 'rated', rating: 5, sharpness: 10 });
    const lowRatingSharp = makeAsset({ id: 'sharp', rating: 1, sharpness: 99 });
    const { keeper } = pickKeeper([lowRatingSharp, highRatingBlurry]);
    assert.equal(keeper.id, 'rated');
  });
});

describe('pickKeeper — older fileCreatedAt wins (keep original)', () => {
  it('picks the asset with the earlier creation date', () => {
    const a = makeAsset({ id: 'a', fileCreatedAt: '2025-06-01T00:00:00.000Z' });
    const b = makeAsset({ id: 'b', fileCreatedAt: '2024-01-01T00:00:00.000Z' });
    const { keeper, nonKeepers } = pickKeeper([a, b]);
    assert.equal(keeper.id, 'b'); // b is older (earlier date)
    assert.deepEqual(nonKeepers.map((x) => x.id), ['a']);
  });
});

describe('pickKeeper — lexicographic id tiebreak', () => {
  it('picks the lexicographically smaller id when everything else is equal', () => {
    const a = makeAsset({ id: 'asset-zzz' });
    const b = makeAsset({ id: 'asset-aaa' });
    const { keeper, nonKeepers } = pickKeeper([a, b]);
    assert.equal(keeper.id, 'asset-aaa');
    assert.deepEqual(nonKeepers.map((x) => x.id), ['asset-zzz']);
  });

  it('is deterministic for three identical assets (only id differs)', () => {
    const assets = [
      makeAsset({ id: 'c' }),
      makeAsset({ id: 'a' }),
      makeAsset({ id: 'b' }),
    ];
    const { keeper, nonKeepers } = pickKeeper(assets);
    assert.equal(keeper.id, 'a');
    assert.equal(nonKeepers.length, 2);
  });
});

describe('pickKeeper — priority chain', () => {
  it('favorite > rating > sharpness > resolution > date > id chain resolves correctly', () => {
    const fav = makeAsset({ id: 'fav', isFavorite: true, rating: 1 });
    const highRating = makeAsset({ id: 'rating', isFavorite: false, rating: 5 });
    const sharpAsset = makeAsset({ id: 'sharp', isFavorite: false, rating: 3, sharpness: 99 });
    const bigRes = makeAsset({ id: 'res', isFavorite: false, rating: 3, sharpness: 1, width: 4000, height: 3000 });
    const { keeper, nonKeepers } = pickKeeper([highRating, sharpAsset, bigRes, fav]);
    assert.equal(keeper.id, 'fav'); // favorite outranks everything
    assert.equal(nonKeepers.length, 3);
  });

  it('with no favorite and equal rating, sharpness outranks the larger-resolution asset', () => {
    const sharpAsset = makeAsset({ id: 'sharp', rating: 3, sharpness: 99, width: 800, height: 600 });
    const bigRes = makeAsset({ id: 'res', rating: 3, sharpness: 1, width: 4000, height: 3000 });
    const { keeper } = pickKeeper([bigRes, sharpAsset]);
    assert.equal(keeper.id, 'sharp');
  });
});

// ── match accepts ─────────────────────────────────────────────────────────────

describe('cleanup_duplicates router — match accepts', () => {
  it('matches "clean up my duplicate photos"', () => {
    assert.ok(wf.match('clean up my duplicate photos'), 'should match');
  });

  it('matches "find and remove duplicates"', () => {
    assert.ok(wf.match('find and remove duplicates'), 'should match');
  });

  it('matches "trash duplicate photos"', () => {
    assert.ok(wf.match('trash duplicate photos'), 'should match');
  });

  it('matches "dedupe my library"', () => {
    assert.ok(wf.match('dedupe my library'), 'should match');
  });

  it('matches "get rid of duplicates"', () => {
    assert.ok(wf.match('get rid of duplicates'), 'should match');
  });

  it('matches "remove duplicate photos"', () => {
    assert.ok(wf.match('remove duplicate photos'), 'should match');
  });

  it('matches "delete my duplicate photos"', () => {
    assert.ok(wf.match('delete my duplicate photos'), 'should match');
  });

  it('matches "deduplicate my library"', () => {
    assert.ok(wf.match('deduplicate my library'), 'should match');
  });

  it('matches "duplicate cleanup"', () => {
    assert.ok(wf.match('duplicate cleanup'), 'should match');
  });
});

// ── match rejects ─────────────────────────────────────────────────────────────

describe('cleanup_duplicates router — match rejects (no duplicate keyword)', () => {
  it('rejects "trash my newest 20 photos" (no duplicate keyword → trash_assets)', () => {
    assert.equal(wf.match('trash my newest 20 photos'), undefined);
  });

  it('rejects "find my best photos" (no duplicate keyword)', () => {
    assert.equal(wf.match('find my best photos'), undefined);
  });

  it('rejects "delete the Family album" (no duplicate keyword)', () => {
    assert.equal(wf.match('delete the Family album'), undefined);
  });

  it('rejects empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('rejects "archive my screenshots" (no duplicate keyword)', () => {
    assert.equal(wf.match('archive my screenshots'), undefined);
  });
});

// ── run tests ─────────────────────────────────────────────────────────────────

describe('cleanup_duplicates execution — happy path', () => {
  const makeClient = (groups, planResult) =>
    makeContractClient({ duplicateGroups: groups, planResult });

  const twoGroups = [
    {
      duplicateId: 'dup-1',
      assets: [
        makeAsset({ id: 'keeper-1', isFavorite: true }),
        makeAsset({ id: 'dupe-1a' }),
        makeAsset({ id: 'dupe-1b' }),
      ],
    },
    {
      duplicateId: 'dup-2',
      assets: [
        makeAsset({ id: 'keeper-2', rating: 5 }),
        makeAsset({ id: 'dupe-2a', rating: 1 }),
      ],
    },
  ];

  it('proposes ONE asset.trash op over the explicit non-keeper assetIds', async () => {
    const client = makeClient(twoGroups);
    const outcome = await wf.run({ client });
    assert.equal(outcome.status, 'planned');

    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.ok(propose, 'proposeAlbumOperations was called');
    const ops = propose.args.operations;
    assert.equal(ops.length, 1);
    const op = ops[0];
    assert.equal(op.type, 'asset.trash');
    assert.equal(op.targetKind, 'asset_batch');
    assert.ok(Array.isArray(op.assetIds), 'op should have assetIds');
    assert.equal(op.riskLevel, 'high');
    // No assetSource (not a selection handle) — this uses explicit assetIds
    assert.equal(op.assetSource, undefined);
  });

  it('the keeper is NEVER in the trashed assetIds', async () => {
    const client = makeClient(twoGroups);
    await wf.run({ client });
    const propose = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    const trashedIds = propose.args.operations[0].assetIds;
    assert.ok(!trashedIds.includes('keeper-1'), 'keeper-1 must not be trashed');
    assert.ok(!trashedIds.includes('keeper-2'), 'keeper-2 must not be trashed');
    // The non-keepers should be there
    assert.ok(trashedIds.includes('dupe-1a'), 'dupe-1a should be trashed');
    assert.ok(trashedIds.includes('dupe-1b'), 'dupe-1b should be trashed');
    assert.ok(trashedIds.includes('dupe-2a'), 'dupe-2a should be trashed');
  });

  it('the trash op passes the (relaxed) validateAssetTrash with assetIds', async () => {
    // The fixture now accepts assetIds — no throw expected
    const client = makeContractClient({ duplicateGroups: twoGroups });
    const outcome = await wf.run({ client });
    assert.equal(outcome.status, 'planned');
  });

  it('success text discloses the keep rule, group count, and trash count', async () => {
    const client = makeClient(twoGroups);
    const outcome = await wf.run({ client });
    assert.equal(outcome.status, 'planned');
    assert.ok(/favorite|rating|largest/i.test(outcome.text), 'text should mention the keep rule');
    assert.ok(/2.*dup(?:licate|e)/i.test(outcome.text) || /dup.*2/i.test(outcome.text), 'text should mention group count');
    assert.ok(/3.*photo/i.test(outcome.text) || /photo.*3/i.test(outcome.text), 'text should mention trash count (3 non-keepers)');
    assert.ok(/trash/i.test(outcome.text), 'text should mention Trash');
  });

  it('gated: returns failed when proposeAlbumOperations returns no plan id', async () => {
    const client = makeClient(twoGroups, { status: 'success', plan: {} });
    const outcome = await wf.run({ client });
    assert.equal(outcome.status, 'failed');
  });
});

describe('cleanup_duplicates execution — no groups / edge cases', () => {
  it('returns handoff_open when no duplicate groups exist', async () => {
    const client = makeContractClient({ duplicateGroups: [] });
    const outcome = await wf.run({ client });
    assert.equal(outcome.status, 'handoff_open');
    // Must not have called proposeAlbumOperations
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('returns handoff_open when every group has only 1 asset (nothing to trash)', async () => {
    const groups = [
      { duplicateId: 'dup-1', assets: [makeAsset({ id: 'a' })] },
    ];
    const client = makeContractClient({ duplicateGroups: groups });
    const outcome = await wf.run({ client });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('returns failed when listDuplicateGroups throws', async () => {
    const client = {
      calls: [],
      async call(name) {
        this.calls.push({ name });
        if (name === 'listDuplicateGroups') throw new Error('network error');
        throw new Error(`unexpected ${name}`);
      },
    };
    const outcome = await wf.run({ client });
    assert.equal(outcome.status, 'failed');
    assert.equal(client.calls.some((c) => c.name === 'proposeAlbumOperations'), false);
  });

  it('returns failed when proposeAlbumOperations throws', async () => {
    const groups = [
      {
        duplicateId: 'dup-1',
        assets: [makeAsset({ id: 'a' }), makeAsset({ id: 'b' })],
      },
    ];
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'listDuplicateGroups') return { groups };
        if (name === 'proposeAlbumOperations') throw new Error('planning failed');
        throw new Error(`unexpected ${name}`);
      },
    };
    const outcome = await wf.run({ client });
    assert.equal(outcome.status, 'failed');
  });
});

describe('cleanup_duplicates — workflow identity', () => {
  it('is a hybrid workflow with kind cleanup_duplicates', () => {
    assert.equal(wf.kind, 'cleanup_duplicates');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
    assert.equal(typeof wf.match, 'function');
    assert.equal(typeof wf.parseSlots, 'function');
  });

  it('KNOWN_OPERATION_TYPES includes asset.trash', () => {
    assert.ok(KNOWN_OPERATION_TYPES.has('asset.trash'));
  });

  it('singular "group" copy when exactly 1 group', async () => {
    const groups = [
      {
        duplicateId: 'dup-1',
        assets: [makeAsset({ id: 'a', isFavorite: true }), makeAsset({ id: 'b' })],
      },
    ];
    const client = makeContractClient({ duplicateGroups: groups });
    const outcome = await wf.run({ client });
    assert.equal(outcome.status, 'planned');
    // "1 duplicate group" (singular)
    assert.ok(/1.*group|group.*1/i.test(outcome.text), 'text should say 1 group');
  });
});
