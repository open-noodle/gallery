/**
 * Small, dependency-free helpers shared by the memory rules for curating and scoring
 * candidate asset sets. Kept pure so the rules stay trivially unit-testable.
 */

interface TimedAsset {
  id: string;
  localDateTime: Date;
}

/**
 * Pick `count` items spread evenly across `items` (first and last always included when
 * `count >= 2`). Ported verbatim from the original inline logic in `recent-trip.rule.ts`.
 */
export const pickEvenlySpaced = <T>(items: T[], count: number): T[] => {
  if (count <= 0 || items.length === 0) {
    return [];
  }

  if (count >= items.length) {
    return [...items];
  }

  if (count === 1) {
    return [items[Math.floor((items.length - 1) / 2)]!];
  }

  const indexes = Array.from({ length: count }, (_, index) => Math.round((index * (items.length - 1)) / (count - 1)));

  return indexes.map((index) => items[index]!);
};

/** Sort assets chronologically, evenly sample down to `cap`, and return their ids in order. */
export const sampleAssetsByTime = (assets: TimedAsset[], cap: number): string[] => {
  const sorted = [...assets].sort((left, right) => left.localDateTime.getTime() - right.localDateTime.getTime());
  return pickEvenlySpaced(sorted, cap).map((asset) => asset.id);
};

/** The lower-middle `localDateTime` after sorting ascending — a representative `memoryAt`. */
export const medianTime = (assets: Pick<TimedAsset, 'localDateTime'>[]): Date => {
  const sorted = [...assets].sort((left, right) => left.localDateTime.getTime() - right.localDateTime.getTime());
  return sorted[Math.floor((sorted.length - 1) / 2)]!.localDateTime;
};

/**
 * Sample up to `cap` ids spread evenly across `groups`, and evenly in time within each group.
 *
 * A multi-year card must show every year it claims, not just the busiest one, so slots are
 * handed out one at a time in round-robin order: every group is served once before any group
 * gets a second. A group smaller than its share simply stops taking slots and the rest absorb
 * them. Group order is preserved in the result.
 */
export const sampleAssetsAcrossGroups = <T extends TimedAsset>(groups: T[][], cap: number): string[] => {
  const quotas = Array.from({ length: groups.length }, () => 0);
  let remaining = Math.min(
    cap,
    groups.reduce((total, group) => total + group.length, 0),
  );

  while (remaining > 0) {
    let served = false;
    for (const [index, group] of groups.entries()) {
      if (remaining === 0 || quotas[index]! >= group.length) {
        continue;
      }
      quotas[index]!++;
      remaining--;
      served = true;
    }
    // Every group is full; the cap simply exceeds what the groups hold.
    if (!served) {
      break;
    }
  }

  return groups.flatMap((group, index) => sampleAssetsByTime(group, quotas[index]!));
};

export interface DominantGroup<T> {
  key: string;
  items: T[];
  ratio: number;
}

/**
 * Group `items` by `key` and return the largest group with its share of the total.
 * Ties break toward the larger group, then the lexicographically smaller key, so the
 * result is deterministic across runs. Empty input yields an empty group with ratio 0.
 */
export const dominantBy = <T>(items: T[], key: (item: T) => string): DominantGroup<T> => {
  if (items.length === 0) {
    return { key: '', items: [], ratio: 0 };
  }

  const groups = new Map<string, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    const group = groups.get(groupKey) ?? [];
    group.push(item);
    groups.set(groupKey, group);
  }

  let bestKey = '';
  let bestItems: T[] = [];
  for (const [groupKey, group] of groups) {
    // The first group is always captured by the length comparison (length >= 1 > 0), so the
    // tie-break below never runs on iteration 1 — meaning a legitimate empty-string key is
    // compared like any other and still wins a tie by being lexicographically smallest.
    const isBetter = group.length > bestItems.length || (group.length === bestItems.length && groupKey < bestKey);
    if (!isBetter) {
      continue;
    }

    bestKey = groupKey;
    bestItems = group;
  }

  return { key: bestKey, items: bestItems, ratio: bestItems.length / items.length };
};

/** Small recency nudge (0–10) so newer memories edge out older ones without dominating count. */
export const recencyBonus = (year: number, targetYear: number): number => Math.max(0, 10 - (targetYear - year));

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The English name of a 1-based month, used in memory titles. */
export const monthName = (month: number): string => MONTH_NAMES[month - 1]!;

// Structural input, decoupled from the repository type so curation.util stays dependency-free.
export interface FaceRow {
  assetId: string;
  personId: string;
  personName: string;
  localDateTime: Date;
}

export interface PairStat {
  a: { id: string; name: string }; // ordered so a.id < b.id (stable, order-independent)
  b: { id: string; name: string };
  assets: { id: string; localDateTime: Date }[]; // assets containing BOTH, chronological
  distinctDays: number; // count of distinct UTC calendar days among those assets
}

/**
 * For every unordered pair of distinct subjects that co-occur on at least one asset, collect the
 * assets where both appear. A person with two faces on the same asset collapses to one subject
 * (no self-pair, no double count). Returned pairs are sorted by co-occurrence count desc, then by
 * the ordered id pair ascending, so the result is deterministic regardless of input row order.
 */
export const pairCounts = (rows: FaceRow[]): PairStat[] => {
  const subjectsByAsset = new Map<string, Map<string, { id: string; name: string }>>();
  const assetTimes = new Map<string, Date>();

  for (const row of rows) {
    const subjects = subjectsByAsset.get(row.assetId) ?? new Map<string, { id: string; name: string }>();
    subjects.set(row.personId, { id: row.personId, name: row.personName });
    subjectsByAsset.set(row.assetId, subjects);
    assetTimes.set(row.assetId, row.localDateTime);
  }

  const pairs = new Map<
    string,
    { a: { id: string; name: string }; b: { id: string; name: string }; assets: Map<string, Date> }
  >();

  for (const [assetId, subjects] of subjectsByAsset) {
    const subjectList = subjects.values().toArray();
    for (let i = 0; i < subjectList.length; i++) {
      for (let j = i + 1; j < subjectList.length; j++) {
        const [a, b] =
          subjectList[i]!.id < subjectList[j]!.id
            ? [subjectList[i]!, subjectList[j]!]
            : [subjectList[j]!, subjectList[i]!];
        const key = `${a.id}:${b.id}`;
        const pair = pairs.get(key) ?? { a, b, assets: new Map<string, Date>() };
        pair.assets.set(assetId, assetTimes.get(assetId)!);
        pairs.set(key, pair);
      }
    }
  }

  const stats: PairStat[] = pairs
    .values()
    .map(({ a, b, assets }) => {
      const sortedAssets = [...assets]
        .map(([id, localDateTime]) => ({ id, localDateTime }))
        .sort((left, right) => left.localDateTime.getTime() - right.localDateTime.getTime());
      const distinctDays = new Set(sortedAssets.map((asset) => asset.localDateTime.toISOString().slice(0, 10))).size;
      return { a, b, assets: sortedAssets, distinctDays };
    })
    .toArray();

  return stats.sort((left, right) => {
    if (right.assets.length !== left.assets.length) {
      return right.assets.length - left.assets.length;
    }
    const leftKey = `${left.a.id}:${left.b.id}`;
    const rightKey = `${right.a.id}:${right.b.id}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
};
