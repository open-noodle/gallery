import { DateTime } from 'luxon';
import { AssetRepository, MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { medianTime, recencyBonus, sampleAssetsByTime } from 'src/services/memory-rules/curation.util';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';

export const MIN_ASSETS = 10;
export const MAX_YEARS = 3;
export const ASSET_CAP = 24;
export const VISIBLE_FOR_DAYS = 7;

/** "July 2023" — a recap of all photos from this calendar month in a past year. */
export class MonthRecapMemoryRule implements MemoryRule {
  readonly id = 'month_recap';

  constructor(private assetRepository: Pick<AssetRepository, 'getMemoryAssetsForPeriod'>) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    if (target.day !== 1) {
      return [];
    }

    const month = target.month;
    const assets = await this.assetRepository.getMemoryAssetsForPeriod(ownerId, {
      months: [month],
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
      if (yearAssets.length < MIN_ASSETS) {
        continue;
      }

      const count = yearAssets.length;
      candidates.push({
        ruleId: this.id,
        dedupeKey: `month_recap:${year}-${String(month).padStart(2, '0')}`,
        score: 80 + Math.min(count, 30) + recencyBonus(year, target.year),
        assetIds: sampleAssetsByTime(yearAssets, ASSET_CAP),
        memoryAt: DateTime.fromJSDate(medianTime(yearAssets), { zone: 'utc' }),
        context: { year, month, count },
        visibleForDays: VISIBLE_FOR_DAYS,
      });
    }

    return candidates.toSorted((left, right) => right.score - left.score).slice(0, MAX_YEARS);
  }
}
