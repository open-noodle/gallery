import { DateTime } from 'luxon';
import { AssetRepository, MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { medianTime, recencyBonus, sampleAssetsByTime } from 'src/services/memory-rules/curation.util';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';
import { SEASON_MONTHS, seasonStartingOn, seasonYearOf } from 'src/services/memory-rules/season.util';

export const MIN_ASSETS = 15;
export const MAX_YEARS = 2;
export const ASSET_CAP = 30;
export const VISIBLE_FOR_DAYS = 10;

/** "Summer 2024" — a recap of a past meteorological season, shown when that season starts. */
export class SeasonRecapMemoryRule implements MemoryRule {
  readonly id = 'season_recap';

  constructor(private assetRepository: Pick<AssetRepository, 'getMemoryAssetsForPeriod'>) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    const season = seasonStartingOn(target);
    if (season === null) {
      return [];
    }

    const currentSeasonYear = seasonYearOf(target.month, target.year);
    const assets = await this.assetRepository.getMemoryAssetsForPeriod(ownerId, {
      months: SEASON_MONTHS[season],
      takenBefore: target.endOf('day').toJSDate(),
    });

    const byYear = new Map<number, MemoryPeriodAsset[]>();
    for (const asset of assets) {
      const month = DateTime.fromJSDate(asset.localDateTime, { zone: 'utc' }).month;
      const seasonYear = seasonYearOf(month, asset.year);
      if (seasonYear >= currentSeasonYear) {
        continue;
      }
      const yearAssets = byYear.get(seasonYear) ?? [];
      yearAssets.push(asset);
      byYear.set(seasonYear, yearAssets);
    }

    const candidates: MemoryRuleCandidate[] = [];
    for (const [seasonYear, yearAssets] of byYear) {
      if (yearAssets.length < MIN_ASSETS) {
        continue;
      }

      const count = yearAssets.length;
      candidates.push({
        ruleId: this.id,
        dedupeKey: `season_recap:${seasonYear}-${season}`,
        score: 90 + Math.min(count, 40) + recencyBonus(seasonYear, target.year),
        assetIds: sampleAssetsByTime(yearAssets, ASSET_CAP),
        memoryAt: DateTime.fromJSDate(medianTime(yearAssets), { zone: 'utc' }),
        context: { seasonYear, season, count },
        visibleForDays: VISIBLE_FOR_DAYS,
      });
    }

    return candidates.toSorted((left, right) => right.score - left.score).slice(0, MAX_YEARS);
  }
}
