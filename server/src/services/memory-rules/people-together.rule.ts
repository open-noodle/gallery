import { DateTime } from 'luxon';
import { AssetRepository, MemoryPeriodFace } from 'src/repositories/asset.repository';
import { medianTime, pairCounts, recencyBonus, sampleAssetsByTime } from 'src/services/memory-rules/curation.util';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';

export const TRIGGER_DAY = 20;
export const MIN_ASSETS = 6;
export const MIN_DISTINCT_DAYS = 2;
export const MAX_YEARS = 2;
export const ASSET_CAP = 8;

/** "Anna & Ben" — a pair often photographed together in a past year's copy of this month. */
export class PeopleTogetherMemoryRule implements MemoryRule {
  readonly id = 'people_together';

  constructor(private assetRepository: Pick<AssetRepository, 'getMemoryFacesForPeriod'>) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    if (target.day !== TRIGGER_DAY) {
      return [];
    }

    const rows = await this.assetRepository.getMemoryFacesForPeriod(ownerId, {
      months: [target.month],
      takenBefore: target.endOf('day').toJSDate(),
    });

    const byYear = new Map<number, MemoryPeriodFace[]>();
    for (const row of rows) {
      if (row.year >= target.year) {
        continue;
      }
      const yearRows = byYear.get(row.year) ?? [];
      yearRows.push(row);
      byYear.set(row.year, yearRows);
    }

    const mm = String(target.month).padStart(2, '0');
    const candidates: MemoryRuleCandidate[] = [];

    for (const [year, yearRows] of byYear) {
      const top = pairCounts(yearRows)[0];
      if (!top || top.assets.length < MIN_ASSETS || top.distinctDays < MIN_DISTINCT_DAYS) {
        continue;
      }

      const count = top.assets.length;
      candidates.push({
        ruleId: this.id,
        dedupeKey: `people_together:${top.a.id}:${top.b.id}:${year}-${mm}`,
        score: 100 + count * 3 + recencyBonus(year, target.year),
        assetIds: sampleAssetsByTime(top.assets, ASSET_CAP),
        memoryAt: DateTime.fromJSDate(medianTime(top.assets), { zone: 'utc' }),
        visibleForDays: 7,
        context: {
          year,
          month: target.month,
          personAId: top.a.id,
          personAName: top.a.name,
          personBId: top.b.id,
          personBName: top.b.name,
          count,
        },
      });
    }

    return candidates.toSorted((left, right) => right.score - left.score).slice(0, MAX_YEARS);
  }
}
