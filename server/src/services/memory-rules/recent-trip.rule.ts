import { DateTime } from 'luxon';
import { AssetOrderWithRandom, MemoryType } from 'src/enum';
import { AssetRepository, MemoryLocationCluster } from 'src/repositories/asset.repository';
import { MemoryRepository } from 'src/repositories/memory.repository';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';
import { curateTripAssets, inferHome, isAwayFromHome, placeKeyOf } from 'src/services/memory-rules/trip.util';

export class RecentTripMemoryRule implements MemoryRule {
  readonly id = 'recent_trip';

  constructor(
    private assetRepository: Pick<AssetRepository, 'getMemoryLocationClusters' | 'getMemoryAssetsForLocation'>,
    private memoryRepository: Pick<MemoryRepository, 'search'>,
  ) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    const recentFrom = target.minus({ days: 30 }).startOf('day');
    const baselineFrom = recentFrom.minus({ days: 90 });
    const baselineTo = recentFrom.minus({ days: 1 }).endOf('day');

    const [baseline, recent, recentRuleMemories] = await Promise.all([
      this.assetRepository.getMemoryLocationClusters(ownerId, {
        takenAfter: baselineFrom.toJSDate(),
        takenBefore: baselineTo.toJSDate(),
      }),
      this.assetRepository.getMemoryLocationClusters(ownerId, {
        takenAfter: recentFrom.toJSDate(),
        takenBefore: target.endOf('day').toJSDate(),
      }),
      this.memoryRepository.search(ownerId, {
        type: MemoryType.Rule,
        size: 20,
        order: AssetOrderWithRandom.Desc,
      }),
    ]);

    const home = inferHome(baseline);
    if (!home) {
      return [];
    }

    const candidate = recent.find((item) => this.isTripCandidate(item, home));
    if (!candidate) {
      return [];
    }

    if (!candidate.country) {
      return [];
    }

    const placeKey = placeKeyOf(candidate.country, candidate.city);
    const isCoolingDown = recentRuleMemories.some((memory) => {
      const data = memory.data as Record<string, unknown>;
      if (data.ruleId !== this.id) {
        return false;
      }

      const context = data.context as Record<string, unknown> | undefined;
      const seenPlaceKey = typeof context?.placeKey === 'string' ? context.placeKey : undefined;
      return seenPlaceKey === placeKey && DateTime.fromJSDate(memory.memoryAt) >= target.minus({ days: 30 });
    });

    if (isCoolingDown) {
      return [];
    }

    const locationAssets = await this.assetRepository.getMemoryAssetsForLocation(ownerId, {
      country: candidate.country,
      city: candidate.city,
      takenAfter: recentFrom.toJSDate(),
      takenBefore: target.endOf('day').toJSDate(),
    });
    const assetIds = curateTripAssets(locationAssets, 10);

    const placeLabel = candidate.city ? `${candidate.city}, ${candidate.country}` : candidate.country;
    const dedupeDay = target.toFormat('yyyy-MM-dd');

    return [
      {
        ruleId: this.id,
        dedupeKey: `recent_trip:${placeKey}:${dedupeDay}`,
        score: 50 + candidate.dayCount * 5 + Math.min(candidate.assetCount, 20),
        assetIds,
        memoryAt: target,
        // A trip fires at most once per place per 30 days, so a single-day window meant anyone
        // not opening the app that day missed it entirely. Scaled by trip length, matching
        // `trip_anniversary`.
        visibleForDays: Math.min(Math.max(candidate.dayCount, 3), 7),
        context: {
          placeKey,
          placeLabel,
          country: candidate.country,
          city: candidate.city,
          assetCount: candidate.assetCount,
          dayCount: candidate.dayCount,
          tripWindowStart: candidate.firstDate.toISOString(),
          tripWindowEnd: candidate.lastDate.toISOString(),
        },
      },
    ];
  }

  private isTripCandidate(item: MemoryLocationCluster, home: MemoryLocationCluster) {
    if (item.assetCount < 7 || item.dayCount < 2) {
      return false;
    }

    return isAwayFromHome(item, home);
  }
}
