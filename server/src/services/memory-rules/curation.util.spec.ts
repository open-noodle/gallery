import { DateTime } from 'luxon';
import {
  dominantBy,
  FaceRow,
  medianTime,
  monthName,
  pairCounts,
  pickEvenlySpaced,
  recencyBonus,
  sampleAssetsAcrossGroups,
  sampleAssetsByTime,
} from 'src/services/memory-rules/curation.util';

const asset = (id: string, iso: string) => ({ id, localDateTime: DateTime.fromISO(iso, { zone: 'utc' }).toJSDate() });

const face = (assetId: string, personId: string, personName: string, iso: string): FaceRow => ({
  assetId,
  personId,
  personName,
  localDateTime: DateTime.fromISO(iso, { zone: 'utc' }).toJSDate(),
});

/** `count` assets one day apart, ids prefixed so a test can tell the groups apart. */
const group = (prefix: string, count: number, startIso: string) =>
  Array.from({ length: count }, (_, index) =>
    asset(`${prefix}${index}`, DateTime.fromISO(startIso, { zone: 'utc' }).plus({ days: index }).toISO()!),
  );

describe('pickEvenlySpaced', () => {
  it('returns [] when count is zero or negative', () => {
    expect(pickEvenlySpaced([1, 2, 3], 0)).toEqual([]);
    expect(pickEvenlySpaced([1, 2, 3], -1)).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(pickEvenlySpaced([], 3)).toEqual([]);
  });

  it('returns all items (copied) when count >= length', () => {
    const items = [1, 2, 3];
    const result = pickEvenlySpaced(items, 5);
    expect(result).toEqual([1, 2, 3]);
    expect(result).not.toBe(items);
  });

  it('returns the middle element when count === 1', () => {
    expect(pickEvenlySpaced([0, 1, 2, 3, 4], 1)).toEqual([2]);
    // even length -> lower-middle
    expect(pickEvenlySpaced([0, 1, 2, 3], 1)).toEqual([1]);
  });

  it('returns first and last when count === 2', () => {
    expect(pickEvenlySpaced([0, 1, 2, 3, 4], 2)).toEqual([0, 4]);
  });

  it('spaces evenly for counts in between (parity with recent_trip)', () => {
    expect(pickEvenlySpaced([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4)).toEqual([0, 3, 6, 9]);
    expect(pickEvenlySpaced([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([0, 5, 9]);
  });
});

describe('sampleAssetsByTime', () => {
  it('sorts by time and returns ids chronologically', () => {
    const assets = [
      asset('b', '2023-07-10T00:00:00'),
      asset('a', '2023-07-01T00:00:00'),
      asset('c', '2023-07-20T00:00:00'),
    ];
    expect(sampleAssetsByTime(assets, 3)).toEqual(['a', 'b', 'c']);
  });

  it('returns all ids chronologically when cap exceeds input', () => {
    const assets = [asset('b', '2023-07-10T00:00:00'), asset('a', '2023-07-01T00:00:00')];
    expect(sampleAssetsByTime(assets, 10)).toEqual(['a', 'b']);
  });

  it('returns [] when cap is zero', () => {
    expect(sampleAssetsByTime([asset('a', '2023-07-01T00:00:00')], 0)).toEqual([]);
  });

  it('evenly samples down to the cap, chronologically', () => {
    const assets = Array.from({ length: 10 }, (_, i) =>
      asset(`a${i}`, DateTime.fromISO('2023-07-01T00:00:00', { zone: 'utc' }).plus({ days: i }).toISO()!),
    );
    expect(sampleAssetsByTime(assets, 4)).toEqual(['a0', 'a3', 'a6', 'a9']);
  });
});

describe('sampleAssetsAcrossGroups', () => {
  it('returns [] for no groups, and for a zero cap', () => {
    expect(sampleAssetsAcrossGroups([], 5)).toEqual([]);
    expect(sampleAssetsAcrossGroups([group('a', 3, '2021-07-01T00:00:00')], 0)).toEqual([]);
  });

  it('returns everything, in group order, when the cap exceeds what the groups hold', () => {
    const groups = [group('a', 2, '2021-07-01T00:00:00'), group('b', 2, '2023-07-01T00:00:00')];
    expect(sampleAssetsAcrossGroups(groups, 10)).toEqual(['a0', 'a1', 'b0', 'b1']);
  });

  it('splits the cap evenly between groups of very different sizes', () => {
    // The 30-strong group does not get to claim the slots its bulk would earn from a flat sample.
    const groups = [group('a', 30, '2021-07-01T00:00:00'), group('b', 10, '2023-07-01T00:00:00')];
    const result = sampleAssetsAcrossGroups(groups, 16);
    expect(result.filter((id) => id.startsWith('a'))).toHaveLength(8);
    expect(result.filter((id) => id.startsWith('b'))).toHaveLength(8);
  });

  it('lets a group too small for its share release the remainder to the others', () => {
    const groups = [group('a', 40, '2021-07-01T00:00:00'), group('b', 5, '2023-07-01T00:00:00')];
    const result = sampleAssetsAcrossGroups(groups, 16);
    expect(result.filter((id) => id.startsWith('b'))).toHaveLength(5);
    expect(result.filter((id) => id.startsWith('a'))).toHaveLength(11);
  });

  it('spreads the share a group receives evenly in time', () => {
    const groups = [group('a', 10, '2021-07-01T00:00:00'), group('b', 10, '2023-07-01T00:00:00')];
    expect(sampleAssetsAcrossGroups(groups, 8)).toEqual(['a0', 'a3', 'a6', 'a9', 'b0', 'b3', 'b6', 'b9']);
  });

  it('skips an empty group without stalling the round-robin', () => {
    const groups = [group('a', 4, '2021-07-01T00:00:00'), [], group('b', 4, '2023-07-01T00:00:00')];
    expect(sampleAssetsAcrossGroups(groups, 4)).toEqual(['a0', 'a3', 'b0', 'b3']);
  });
});

describe('medianTime', () => {
  it('returns the middle time for an odd count', () => {
    const assets = [
      asset('a', '2023-07-01T00:00:00'),
      asset('b', '2023-07-02T00:00:00'),
      asset('c', '2023-07-03T00:00:00'),
    ];
    expect(medianTime(assets)).toEqual(DateTime.fromISO('2023-07-02T00:00:00', { zone: 'utc' }).toJSDate());
  });

  it('returns the lower-middle time for an even count', () => {
    const assets = [
      asset('a', '2023-07-01T00:00:00'),
      asset('b', '2023-07-02T00:00:00'),
      asset('c', '2023-07-03T00:00:00'),
      asset('d', '2023-07-04T00:00:00'),
    ];
    expect(medianTime(assets)).toEqual(DateTime.fromISO('2023-07-02T00:00:00', { zone: 'utc' }).toJSDate());
  });

  it('handles unsorted input', () => {
    const assets = [
      asset('c', '2023-07-03T00:00:00'),
      asset('a', '2023-07-01T00:00:00'),
      asset('b', '2023-07-02T00:00:00'),
    ];
    expect(medianTime(assets)).toEqual(DateTime.fromISO('2023-07-02T00:00:00', { zone: 'utc' }).toJSDate());
  });
});

describe('dominantBy', () => {
  it('returns a single group with ratio 1', () => {
    const result = dominantBy(['x', 'x', 'x'], (v) => v);
    expect(result).toEqual({ key: 'x', items: ['x', 'x', 'x'], ratio: 1 });
  });

  it('returns the largest group with its share of the total', () => {
    const result = dominantBy(['a', 'a', 'a', 'b'], (v) => v);
    expect(result.key).toBe('a');
    expect(result.items).toHaveLength(3);
    expect(result.ratio).toBeCloseTo(0.75);
  });

  it('breaks ties by larger group then lexicographically smaller key', () => {
    // equal counts of 'b' and 'a' -> 'a' wins on lexical order
    const result = dominantBy(['b', 'b', 'a', 'a'], (v) => v);
    expect(result.key).toBe('a');
    expect(result.items).toHaveLength(2);
  });

  it('returns an empty result for empty input', () => {
    expect(dominantBy([] as string[], (v) => v)).toEqual({ key: '', items: [], ratio: 0 });
  });

  it('lets a real empty-string key win a tie (no sentinel confusion), regardless of order', () => {
    // '' is lexicographically smallest, so it must win an equal-sized tie whether seen first or last.
    expect(dominantBy(['', '', 'a', 'a'], (v) => v)).toMatchObject({ key: '', items: ['', ''] });
    expect(dominantBy(['a', 'a', '', ''], (v) => v)).toMatchObject({ key: '', items: ['', ''] });
  });
});

describe('monthName', () => {
  it('returns the English name for a 1-based month', () => {
    expect(monthName(1)).toBe('January');
    expect(monthName(7)).toBe('July');
    expect(monthName(12)).toBe('December');
  });
});

describe('recencyBonus', () => {
  it('is 10 for the same year', () => {
    expect(recencyBonus(2026, 2026)).toBe(10);
  });

  it('decreases by one per year', () => {
    expect(recencyBonus(2023, 2026)).toBe(7);
  });

  it('is 0 for ten or more years ago and never negative', () => {
    expect(recencyBonus(2016, 2026)).toBe(0);
    expect(recencyBonus(2000, 2026)).toBe(0);
  });
});

describe('pairCounts', () => {
  describe('given an asset with 2 subjects', () => {
    it('then returns one pair containing that asset', () => {
      const rows = [face('a1', 'p1', 'Anna', '2023-06-10T10:00:00'), face('a1', 'p2', 'Ben', '2023-06-10T10:00:00')];

      const result = pairCounts(rows);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        a: { id: 'p1', name: 'Anna' },
        b: { id: 'p2', name: 'Ben' },
        assets: [{ id: 'a1', localDateTime: rows[0]!.localDateTime }],
        distinctDays: 1,
      });
    });
  });

  describe('given an asset with 3 subjects', () => {
    it('then returns 3 pairs (all unordered combinations)', () => {
      const rows = [
        face('a1', 'p1', 'Anna', '2023-06-10T10:00:00'),
        face('a1', 'p2', 'Ben', '2023-06-10T10:00:00'),
        face('a1', 'p3', 'Cara', '2023-06-10T10:00:00'),
      ];

      const result = pairCounts(rows);

      expect(result).toHaveLength(3);
      const keys = result.map((pair) => `${pair.a.id}:${pair.b.id}`).sort();
      expect(keys).toEqual(['p1:p2', 'p1:p3', 'p2:p3']);
      for (const pair of result) {
        expect(pair.assets).toHaveLength(1);
        expect(pair.assets[0]!.id).toBe('a1');
      }
    });
  });

  describe('given an asset with 1 subject', () => {
    it('then returns no pair (no self-pair)', () => {
      const rows = [face('a1', 'p1', 'Anna', '2023-06-10T10:00:00')];

      expect(pairCounts(rows)).toEqual([]);
    });
  });

  describe('given one subject appearing via two faces on the same asset, plus a second subject', () => {
    it('then produces exactly one pair, counted once (no self-pair, no inflation)', () => {
      const rows = [
        face('a1', 'p1', 'Anna', '2023-06-10T10:00:00'),
        face('a1', 'p1', 'Anna', '2023-06-10T10:00:00'),
        face('a1', 'p2', 'Ben', '2023-06-10T10:00:00'),
      ];

      const result = pairCounts(rows);

      expect(result).toHaveLength(1);
      expect(result[0]!.a).toEqual({ id: 'p1', name: 'Anna' });
      expect(result[0]!.b).toEqual({ id: 'p2', name: 'Ben' });
      expect(result[0]!.assets).toHaveLength(1);
    });
  });

  describe('given the same pair across 3 assets on 2 distinct UTC calendar days', () => {
    it('then assets.length is 3, distinctDays is 2, and assets are chronological ascending', () => {
      const rows = [
        face('a1', 'p1', 'Anna', '2023-06-10T10:00:00'),
        face('a1', 'p2', 'Ben', '2023-06-10T10:00:00'),
        face('a2', 'p1', 'Anna', '2023-06-10T15:00:00'),
        face('a2', 'p2', 'Ben', '2023-06-10T15:00:00'),
        face('a3', 'p1', 'Anna', '2023-06-11T09:00:00'),
        face('a3', 'p2', 'Ben', '2023-06-11T09:00:00'),
      ];

      const result = pairCounts(rows);

      expect(result).toHaveLength(1);
      const [pair] = result;
      expect(pair!.assets.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
      expect(pair!.distinctDays).toBe(2);
    });
  });

  describe('given two pairs with different counts', () => {
    it('then sorts by assets.length desc', () => {
      const rows = [
        face('a1', 'p1', 'Anna', '2023-06-10T10:00:00'),
        face('a1', 'p2', 'Ben', '2023-06-10T10:00:00'),
        face('a2', 'p1', 'Anna', '2023-06-11T10:00:00'),
        face('a2', 'p2', 'Ben', '2023-06-11T10:00:00'),
        face('a3', 'p1', 'Anna', '2023-06-12T10:00:00'),
        face('a3', 'p3', 'Cara', '2023-06-12T10:00:00'),
      ];

      const result = pairCounts(rows);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ a: { id: 'p1' }, b: { id: 'p2' } });
      expect(result[0]!.assets).toHaveLength(2);
      expect(result[1]).toMatchObject({ a: { id: 'p1' }, b: { id: 'p3' } });
      expect(result[1]!.assets).toHaveLength(1);
    });
  });

  describe('given two pairs with equal counts', () => {
    it('then orders deterministically by the ordered id pair ascending', () => {
      const rows = [
        face('a1', 'p2', 'Ben', '2023-06-10T10:00:00'),
        face('a1', 'p3', 'Cara', '2023-06-10T10:00:00'),
        face('a2', 'p1', 'Anna', '2023-06-11T10:00:00'),
        face('a2', 'p2', 'Ben', '2023-06-11T10:00:00'),
      ];

      const result = pairCounts(rows);

      expect(result).toHaveLength(2);
      expect(result.map((pair) => `${pair.a.id}:${pair.b.id}`)).toEqual(['p1:p2', 'p2:p3']);
    });
  });

  describe('given rows in shuffled input order', () => {
    it('then returns identical output to sorted input, and every pair keeps a.id < b.id', () => {
      const inOrder = [
        face('a1', 'p1', 'Anna', '2023-06-10T10:00:00'),
        face('a1', 'p2', 'Ben', '2023-06-10T10:00:00'),
        face('a1', 'p3', 'Cara', '2023-06-10T10:00:00'),
        face('a2', 'p1', 'Anna', '2023-06-11T10:00:00'),
        face('a2', 'p2', 'Ben', '2023-06-11T10:00:00'),
      ];
      const shuffled = [inOrder[3]!, inOrder[1]!, inOrder[4]!, inOrder[0]!, inOrder[2]!];

      const resultInOrder = pairCounts(inOrder);
      const resultShuffled = pairCounts(shuffled);

      expect(resultShuffled).toEqual(resultInOrder);
      for (const pair of resultInOrder) {
        expect(pair.a.id < pair.b.id).toBe(true);
      }
    });
  });

  describe('given empty input', () => {
    it('then returns []', () => {
      expect(pairCounts([])).toEqual([]);
    });
  });
});
