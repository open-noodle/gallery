import { DateTime } from 'luxon';
import { MemoryRuleAssetRepository } from 'src/gallery/repositories/memory-rule-asset.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface.js';

export class BirthdayMemoryRule implements MemoryRule {
  readonly id = 'birthday';

  constructor(
    private personRepository: Pick<PersonRepository, 'forBirthdayMemories'>,
    private assetRepository: Pick<MemoryRuleAssetRepository, 'getMemoryAssetsForPerson' | 'getPetPersonGroupIds'>,
  ) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    // Upstream's query, so a 29 February birthday is observed on 28 February in a non-leap year.
    const people = await this.personRepository.forBirthdayMemories(ownerId, {
      year: target.year,
      month: target.month,
      day: target.day,
    });
    const pets =
      people.length > 0
        ? await this.assetRepository.getPetPersonGroupIds(people.map(({ personGroupId }) => personGroupId))
        : new Set<string>();
    const candidates: MemoryRuleCandidate[] = [];

    for (const person of people) {
      if (pets.has(person.personGroupId)) {
        continue;
      }

      const assets = await this.assetRepository.getMemoryAssetsForPerson(
        ownerId,
        person.personGroupId,
        target.endOf('day').toJSDate(),
      );
      const byYear = new Map<number, string[]>();

      for (const asset of assets) {
        const year = DateTime.fromJSDate(asset.localDateTime, { zone: 'utc' }).year;
        const ids = byYear.get(year) ?? [];
        if (!(ids.length < 2)) {
          continue;
        }

        ids.push(asset.id);
        byYear.set(year, ids);
      }

      const assetIds = byYear
        .keys()
        .toArray()
        .toSorted((a, b) => b - a)
        .flatMap((year) => byYear.get(year) ?? [])
        .slice(0, 12);

      if (assetIds.length >= 6 && byYear.size >= 2) {
        candidates.push({
          ruleId: this.id,
          dedupeKey: `birthday:${person.personGroupId}:${target.toFormat('yyyy-MM-dd')}`,
          score: 300 + byYear.size * 10 + assetIds.length,
          assetIds,
          memoryAt: target,
          context: {
            personId: person.personGroupId,
            personName: person.name,
            variant: 'across_years',
            distinctYears: byYear.size,
          },
        });

        continue;
      }

      const fallbackAssetIds = assets
        .toSorted((a, b) => b.localDateTime.getTime() - a.localDateTime.getTime())
        .slice(0, 4)
        .map((asset) => asset.id);

      if (fallbackAssetIds.length < 4) {
        continue;
      }

      candidates.push({
        ruleId: this.id,
        dedupeKey: `birthday:${person.personGroupId}:${target.toFormat('yyyy-MM-dd')}`,
        score: 250 + fallbackAssetIds.length,
        assetIds: fallbackAssetIds,
        memoryAt: target,
        context: {
          personId: person.personGroupId,
          personName: person.name,
          variant: 'recent',
          distinctYears: byYear.size,
        },
      });
    }

    return candidates;
  }
}
