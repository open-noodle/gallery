import { DateTime } from 'luxon';
import { AssetRepository, MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { medianTime, monthName, recencyBonus, sampleAssetsByTime } from 'src/services/memory-rules/curation.util';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';

/** "Favorite moments from July 2023" — favorited photos from this month in a past year. */
export class FavoritesThrowbackMemoryRule implements MemoryRule {
  readonly id = 'favorites_throwback';
  private static readonly TRIGGER_DAY = 15;
  private static readonly MIN_FAVORITES = 4;
  private static readonly MAX_YEARS = 3;
  private static readonly ASSET_CAP = 12;
  private static readonly SCORE_COUNT_CAP = 20;
  private static readonly VISIBLE_FOR_DAYS = 7;

  constructor(private assetRepository: Pick<AssetRepository, 'getMemoryAssetsForPeriod'>) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    if (target.day !== FavoritesThrowbackMemoryRule.TRIGGER_DAY) {
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
      if (yearAssets.length < FavoritesThrowbackMemoryRule.MIN_FAVORITES) {
        continue;
      }

      const count = yearAssets.length;
      candidates.push({
        ruleId: this.id,
        dedupeKey: `favorites_throwback:${year}-${String(month).padStart(2, '0')}`,
        title: `Favorite moments from ${monthName(month)} ${year}`,
        subtitle: `${count} favorites`,
        score:
          200 + Math.min(count, FavoritesThrowbackMemoryRule.SCORE_COUNT_CAP) * 3 + recencyBonus(year, target.year),
        assetIds: sampleAssetsByTime(yearAssets, FavoritesThrowbackMemoryRule.ASSET_CAP),
        memoryAt: DateTime.fromJSDate(medianTime(yearAssets), { zone: 'utc' }),
        context: { year, month, count },
        visibleForDays: FavoritesThrowbackMemoryRule.VISIBLE_FOR_DAYS,
      });
    }

    return candidates
      .toSorted((left, right) => right.score - left.score)
      .slice(0, FavoritesThrowbackMemoryRule.MAX_YEARS);
  }
}
