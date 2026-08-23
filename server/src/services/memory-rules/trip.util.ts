import { DateTime } from 'luxon';
import { MemoryAsset, MemoryLocationCluster } from 'src/repositories/asset.repository';
import { pickEvenlySpaced } from 'src/services/memory-rules/curation.util';

export const BURST_WINDOW_MS = 2 * 60 * 1000;
export const SMALL_TRIP_MAX = 6;
export const HOME_DOMINANCE_RATIO = 1.25;

export interface TripThresholds {
  minAssets: number;
  minDays: number;
}

/** Canonical place key. BOTH place-based rules must use this (spec §3.3). */
export const placeKeyOf = (country: string | null, city: string | null): string =>
  `${country ?? ''}:${city ?? ''}`.toLowerCase();

/** Top cluster, or null when it has no country or a different-country runner-up is within the ratio. */
export const inferHome = (clusters: MemoryLocationCluster[]): MemoryLocationCluster | null => {
  const [home, runnerUp] = clusters;
  if (!home?.country) {
    return null;
  }

  const isAmbiguousHome =
    !!runnerUp && runnerUp.country !== home.country && runnerUp.assetCount >= home.assetCount / HOME_DOMINANCE_RATIO;
  if (isAmbiguousHome) {
    return null;
  }

  return home;
};

/** Away from home when the country differs, or the country matches but both cities are known and differ. */
export const isAwayFromHome = (item: MemoryLocationCluster, home: MemoryLocationCluster): boolean => {
  if (item.country !== home.country) {
    return true;
  }

  return !!home.city && !!item.city && item.city !== home.city;
};

/**
 * The strongest cluster whose UTC calendar day of `firstDate` equals `anniversary`'s UTC day,
 * is away from home, and meets both thresholds. Ties break on higher assetCount, then on
 * placeKeyOf ascending (deterministic). Returns null when none qualify or `clusters` is empty.
 */
export const findTripStartingOn = (
  clusters: MemoryLocationCluster[],
  anniversary: DateTime,
  home: MemoryLocationCluster,
  thresholds: TripThresholds,
): MemoryLocationCluster | null => {
  const qualifying = clusters.filter(
    (item) =>
      DateTime.fromJSDate(item.firstDate, { zone: 'utc' }).hasSame(anniversary, 'day') &&
      isAwayFromHome(item, home) &&
      item.assetCount >= thresholds.minAssets &&
      item.dayCount >= thresholds.minDays,
  );

  const sorted = qualifying.toSorted((left, right) => {
    if (right.assetCount !== left.assetCount) {
      return right.assetCount - left.assetCount;
    }

    const leftKey = placeKeyOf(left.country, left.city);
    const rightKey = placeKeyOf(right.country, right.city);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  return sorted[0] ?? null;
};

const collapseBurstAssets = (assets: MemoryAsset[]): MemoryAsset[] => {
  const representatives: MemoryAsset[] = [];
  let previous: MemoryAsset | undefined;

  for (const asset of assets) {
    if (!previous || asset.localDateTime.getTime() - previous.localDateTime.getTime() > BURST_WINDOW_MS) {
      representatives.push(asset);
    }
    previous = asset;
  }

  return representatives;
};

const groupAssetsByDay = (assets: MemoryAsset[]): MemoryAsset[][] => {
  const byDay = new Map<string, MemoryAsset[]>();

  for (const asset of assets) {
    const dayKey = DateTime.fromJSDate(asset.localDateTime, { zone: 'utc' }).toISODate();
    const dayAssets = byDay.get(dayKey!) ?? [];
    dayAssets.push(asset);
    byDay.set(dayKey!, dayAssets);
  }

  return byDay.values().toArray();
};

const getTripTargetSize = (dayCount: number, representativeCount: number): number => {
  if (representativeCount <= SMALL_TRIP_MAX) {
    return representativeCount;
  }

  if (dayCount >= 5 || representativeCount >= 18) {
    return 10;
  }

  if (dayCount >= 4 || representativeCount >= 12) {
    return 8;
  }

  return 7;
};

const pickDayCoverage = (dayBuckets: MemoryAsset[][], targetSize: number): MemoryAsset[] => {
  const buckets = dayBuckets.length <= targetSize ? dayBuckets : pickEvenlySpaced(dayBuckets, targetSize);
  return buckets.map((assets) => assets[Math.floor((assets.length - 1) / 2)]!);
};

/** Burst-collapse + per-day coverage sampling, capped at `cap`. Chronological, duplicate-free. */
export const curateTripAssets = (assets: MemoryAsset[], cap: number): string[] => {
  const representatives = collapseBurstAssets(assets);
  if (representatives.length <= SMALL_TRIP_MAX) {
    return representatives.map(({ id }) => id);
  }

  const dayBuckets = groupAssetsByDay(representatives);
  const targetSize = Math.min(cap, getTripTargetSize(dayBuckets.length, representatives.length));
  const selected = pickDayCoverage(dayBuckets, targetSize);
  const selectedIds = new Set(selected.map(({ id }) => id));

  if (selected.length < targetSize) {
    const remaining = representatives.filter(({ id }) => !selectedIds.has(id));
    selected.push(...pickEvenlySpaced(remaining, targetSize - selected.length));
  }

  return [...selected]
    .toSorted((left, right) => left.localDateTime.getTime() - right.localDateTime.getTime())
    .map(({ id }) => id);
};
