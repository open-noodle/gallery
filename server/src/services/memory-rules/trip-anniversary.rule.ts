import { DateTime } from 'luxon';
import { AssetRepository, MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { dominantBy, recencyBonus } from 'src/services/memory-rules/curation.util';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';
import { curateTripAssets, findTripStartingOn, inferHome, placeKeyOf } from 'src/services/memory-rules/trip.util';

export const MIN_PROBE_ASSETS = 3;
export const MIN_PROBE_DOMINANCE = 0.6;
export const MAX_PROBE_YEARS = 4;
export const GAP_DAYS = 5;
export const TRIP_WINDOW_DAYS = 21;
export const MIN_TRIP_ASSETS = 7;
export const MIN_TRIP_DAYS = 2;
export const HOME_BASELINE_DAYS = 90;
export const ASSET_CAP = 10;
export const MAX_CANDIDATES = 2;
export const SCORE_BASE = 260;

/** A usable place needs a non-blank city (EXIF city is usually null when absent, but can be ''). */
const hasCity = (asset: MemoryPeriodAsset): boolean => asset.city !== null && asset.city.trim() !== '';

/** "Your trip to Rome" — a past trip resurfaced on the anniversary of the day it began. */
export class TripAnniversaryMemoryRule implements MemoryRule {
  readonly id = 'trip_anniversary';

  constructor(
    private assetRepository: Pick<
      AssetRepository,
      'getMemoryAssetsForPeriod' | 'getMemoryLocationClusters' | 'getMemoryAssetsForLocation'
    >,
  ) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    const probeYears = await this.probeQualifyingYears(ownerId, target);
    if (probeYears.length === 0) {
      return [];
    }

    const mm = String(target.month).padStart(2, '0');
    const dd = String(target.day).padStart(2, '0');
    const candidates: MemoryRuleCandidate[] = [];

    for (const year of probeYears) {
      const anniversary = target.set({ year }).startOf('day');
      if (anniversary.day !== target.day || anniversary.month !== target.month) {
        // Luxon silently clamps an invalid (year, month, day) combination (e.g. Feb 29 in a
        // non-leap year) to the nearest valid date -- detect the clamp and skip the year.
        continue;
      }

      const homeClusters = await this.assetRepository.getMemoryLocationClusters(ownerId, {
        takenAfter: anniversary.minus({ days: HOME_BASELINE_DAYS }).toJSDate(),
        takenBefore: anniversary
          .minus({ days: GAP_DAYS + 1 })
          .endOf('day')
          .toJSDate(),
      });
      const home = inferHome(homeClusters);
      if (!home) {
        continue;
      }

      const tripClusters = await this.assetRepository.getMemoryLocationClusters(ownerId, {
        takenAfter: anniversary.minus({ days: GAP_DAYS }).toJSDate(),
        takenBefore: anniversary.plus({ days: TRIP_WINDOW_DAYS }).endOf('day').toJSDate(),
      });
      const cluster = findTripStartingOn(tripClusters, anniversary, home, {
        minAssets: MIN_TRIP_ASSETS,
        minDays: MIN_TRIP_DAYS,
      });
      if (!cluster || !cluster.country) {
        continue;
      }

      const locationAssets = await this.assetRepository.getMemoryAssetsForLocation(ownerId, {
        country: cluster.country,
        city: cluster.city,
        takenAfter: cluster.firstDate,
        takenBefore: cluster.lastDate,
      });
      const assetIds = curateTripAssets(locationAssets, ASSET_CAP);

      const yearsAgo = target.year - year;
      const placeKey = placeKeyOf(cluster.country, cluster.city);
      const placeLabel = cluster.city ? `${cluster.city}, ${cluster.country}` : cluster.country;

      candidates.push({
        ruleId: this.id,
        dedupeKey: `place_day:${year}-${mm}-${dd}:${placeKey}`,
        score: SCORE_BASE + cluster.dayCount * 4 + Math.min(cluster.assetCount, 20) + recencyBonus(year, target.year),
        assetIds,
        memoryAt: DateTime.fromJSDate(cluster.firstDate, { zone: 'utc' }),
        visibleForDays: Math.min(Math.max(cluster.dayCount, 3), 7),
        context: {
          year,
          yearsAgo,
          placeKey,
          placeLabel,
          country: cluster.country,
          city: cluster.city,
          assetCount: cluster.assetCount,
          dayCount: cluster.dayCount,
          tripStart: cluster.firstDate.toISOString(),
          tripEnd: cluster.lastDate.toISOString(),
        },
      });
    }

    return candidates.toSorted((left, right) => right.score - left.score).slice(0, MAX_CANDIDATES);
  }

  /** The most recent `MAX_PROBE_YEARS` past years whose on-this-day photos are dominated by one place. */
  private async probeQualifyingYears(ownerId: string, target: DateTime): Promise<number[]> {
    const probeAssets = await this.assetRepository.getMemoryAssetsForPeriod(ownerId, {
      months: [target.month],
      day: target.day,
      takenBefore: target.endOf('day').toJSDate(),
    });

    const byYear = new Map<number, MemoryPeriodAsset[]>();
    for (const asset of probeAssets) {
      if (asset.year >= target.year || !hasCity(asset)) {
        continue;
      }
      const yearAssets = byYear.get(asset.year) ?? [];
      yearAssets.push(asset);
      byYear.set(asset.year, yearAssets);
    }

    const qualifyingYears: number[] = [];
    for (const [year, assets] of byYear) {
      const dominant = dominantBy(assets, (asset) => placeKeyOf(asset.country, asset.city));
      if (dominant.items.length >= MIN_PROBE_ASSETS && dominant.ratio >= MIN_PROBE_DOMINANCE) {
        qualifyingYears.push(year);
      }
    }

    return qualifyingYears.toSorted((left, right) => right - left).slice(0, MAX_PROBE_YEARS);
  }
}
