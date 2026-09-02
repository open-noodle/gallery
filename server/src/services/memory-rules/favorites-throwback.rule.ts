import { DateTime } from 'luxon';
import { AssetRepository, MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { medianTime, recencyBonus, sampleAssetsByTime } from 'src/services/memory-rules/curation.util';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';

export const TRIGGER_DAY = 15;
export const MIN_FAVORITES = 4;
export const MAX_YEARS = 3;
export const ASSET_CAP = 12;
export const SCORE_COUNT_CAP = 20;
export const VISIBLE_FOR_DAYS = 7;

/** "Favorite moments from July 2023" — favorited photos from this month in a past year. */
export class FavoritesThrowbackMemoryRule implements MemoryRule {
  readonly id = 'favorites_throwback';

  constructor(private assetRepository: Pick<AssetRepository, 'getMemoryAssetsForPeriod'>) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    if (target.day !== TRIGGER_DAY) {
      return [];
    }

    const month = target.month;
    const assets = await this.assetRepository.getMemoryAssetsForPeriod(ownerId, {
      months: [month],
      favoritesOnly: true,
      takenBefore: target.endOf('day').toJSDate(),
    });

    const byYear = new Map<number, MemoryPeriodAsset[]>();
    for (const asset of assets) {
      if (asset.year >= target.year) {
        continue;
      }
      const yearAssets = byYear.get(asset.year) ?? [];
      yearAssets.push(asset);
      byYear.set(asset.year, yearAssets);
    }

    const candidates: MemoryRuleCandidate[] = [];
    for (const [year, yearAssets] of byYear) {
      if (yearAssets.length < MIN_FAVORITES) {
        continue;
      }

      const count = yearAssets.length;
      candidates.push({
        ruleId: this.id,
        dedupeKey: `favorites_throwback:${year}-${String(month).padStart(2, '0')}`,
        score: 200 + Math.min(count, SCORE_COUNT_CAP) * 3 + recencyBonus(year, target.year),
        assetIds: sampleAssetsByTime(yearAssets, ASSET_CAP),
        memoryAt: DateTime.fromJSDate(medianTime(yearAssets), { zone: 'utc' }),
        context: { year, month, count },
        visibleForDays: VISIBLE_FOR_DAYS,
      });
    }

    return candidates
      .toSorted((left, right) => right.score - left.score)
      .slice(0, MAX_YEARS);
  }
}
