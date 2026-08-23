import { DateTime } from 'luxon';
import { AssetRepository, MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { medianTime, monthName, recencyBonus, sampleAssetsByTime } from 'src/services/memory-rules/curation.util';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';

/** "July 2023" — a recap of all photos from this calendar month in a past year. */
export class MonthRecapMemoryRule implements MemoryRule {
  readonly id = 'month_recap';
  private static readonly MIN_ASSETS = 10;
  private static readonly MAX_YEARS = 3;
  private static readonly ASSET_CAP = 24;
  private static readonly VISIBLE_FOR_DAYS = 7;

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
      if (yearAssets.length < MonthRecapMemoryRule.MIN_ASSETS) {
        continue;
      }

      const count = yearAssets.length;
      candidates.push({
        ruleId: this.id,
        dedupeKey: `month_recap:${year}-${String(month).padStart(2, '0')}`,
        title: `${monthName(month)} ${year}`,
        subtitle: `${count} photos`,
        score: 80 + Math.min(count, 30) + recencyBonus(year, target.year),
        assetIds: sampleAssetsByTime(yearAssets, MonthRecapMemoryRule.ASSET_CAP),
        memoryAt: DateTime.fromJSDate(medianTime(yearAssets), { zone: 'utc' }),
        context: { year, month, count },
        visibleForDays: MonthRecapMemoryRule.VISIBLE_FOR_DAYS,
      });
    }

    return candidates.toSorted((left, right) => right.score - left.score).slice(0, MonthRecapMemoryRule.MAX_YEARS);
  }
}
