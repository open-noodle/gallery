import { DateTime } from 'luxon';
import { AssetRepository, MemoryPeriodFace } from 'src/repositories/asset.repository';
import {
  medianTime,
  monthName,
  pairCounts,
  recencyBonus,
  sampleAssetsByTime,
} from 'src/services/memory-rules/curation.util';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';

/** "Anna & Ben" — a pair often photographed together in a past year's copy of this month. */
export class PeopleTogetherMemoryRule implements MemoryRule {
  readonly id = 'people_together';
  private static readonly TRIGGER_DAY = 20;
  private static readonly MIN_ASSETS = 6;
  private static readonly MIN_DISTINCT_DAYS = 2;
  private static readonly MAX_YEARS = 2;
  private static readonly ASSET_CAP = 8;

  constructor(private assetRepository: Pick<AssetRepository, 'getMemoryFacesForPeriod'>) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    if (target.day !== PeopleTogetherMemoryRule.TRIGGER_DAY) {
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
      if (
        !top ||
        top.assets.length < PeopleTogetherMemoryRule.MIN_ASSETS ||
        top.distinctDays < PeopleTogetherMemoryRule.MIN_DISTINCT_DAYS
      ) {
        continue;
      }

      const count = top.assets.length;
      candidates.push({
        ruleId: this.id,
        dedupeKey: `people_together:${top.a.id}:${top.b.id}:${year}-${mm}`,
        title: `${top.a.name} & ${top.b.name}`,
        subtitle: `${count} photos together · ${monthName(target.month)} ${year}`,
        score: 100 + count * 3 + recencyBonus(year, target.year),
        assetIds: sampleAssetsByTime(top.assets, PeopleTogetherMemoryRule.ASSET_CAP),
        memoryAt: DateTime.fromJSDate(medianTime(top.assets), { zone: 'utc' }),
        visibleForDays: 7,
        context: { year, personAId: top.a.id, personBId: top.b.id, count },
      });
    }

    return candidates.toSorted((left, right) => right.score - left.score).slice(0, PeopleTogetherMemoryRule.MAX_YEARS);
  }
}
