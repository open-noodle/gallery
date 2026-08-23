import { DateTime } from 'luxon';
import { AssetRepository, MemoryAsset } from 'src/repositories/asset.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { Chapter, CHAPTER_MAX_SPAN_DAYS, DayCount, densestChapter } from 'src/services/memory-rules/chapter.util';
import { medianTime, monthName, recencyBonus, sampleAssetsByTime } from 'src/services/memory-rules/curation.util';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';

export const TRIGGER_DAY = 13;
/** Fallback when `memories.personThrowbackDormancyMonths` is absent (see `gallery/config.dto.ts`). */
export const DEFAULT_DORMANCY_MONTHS = 6;
export const MIN_TOTAL_ASSETS = 10;
export const MIN_CHAPTER_ASSETS = 6;
export const CANDIDATE_POOL = 10;
export const MAX_CANDIDATES = 5;
export const ASSET_CAP = 8;
export const VISIBLE_FOR_DAYS = 7;
export const SCORE_BASE = 110;
export const MAX_COUNT_BONUS = 30;

interface RankedCandidate {
  personId: string;
  name: string;
  chapter: Chapter;
  score: number;
}

/**
 * "Times with Anna" — a person who hasn't appeared in the user's photos for
 * `dormancyMonths` or more, resurfaced via their densest chapter (D4/D9). Gap length is never
 * shown and never scored (D1/D5); ranking rewards chapter richness, with a mild `recencyBonus`
 * nudge (D6). Returns up to `MAX_CANDIDATES` so the engine's per-key dedup can skip an
 * already-fired person (D8).
 */
export class PersonThrowbackMemoryRule implements MemoryRule {
  readonly id = 'person_throwback';

  constructor(
    private personRepository: Pick<PersonRepository, 'getDormantPeople'>,
    private assetRepository: Pick<AssetRepository, 'getMemoryPersonDailyCounts' | 'getMemoryAssetsForPersonWindow'>,
    private dormancyMonths: number = DEFAULT_DORMANCY_MONTHS,
  ) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    if (target.day !== TRIGGER_DAY) {
      return [];
    }

    const lastSeenBefore = target.startOf('day').minus({ months: this.dormancyMonths }).toJSDate();

    const people = await this.personRepository.getDormantPeople(ownerId, {
      lastSeenBefore,
      minAssets: MIN_TOTAL_ASSETS,
      limit: CANDIDATE_POOL,
    });

    // Load-bearing: an empty `personIds` array below would emit `IN ()`, which is invalid SQL.
    if (people.length === 0) {
      return [];
    }

    const dayCounts = await this.assetRepository.getMemoryPersonDailyCounts(
      ownerId,
      people.map((person) => person.id),
      { takenBefore: lastSeenBefore },
    );

    const daysByPerson = new Map<string, DayCount[]>();
    for (const row of dayCounts) {
      const days = daysByPerson.get(row.personId) ?? [];
      days.push({ day: row.day, count: row.count });
      daysByPerson.set(row.personId, days);
    }

    const ranked: RankedCandidate[] = [];
    for (const person of people) {
      const chapter = densestChapter(daysByPerson.get(person.id) ?? [], CHAPTER_MAX_SPAN_DAYS);
      if (chapter === null || chapter.count < MIN_CHAPTER_ASSETS) {
        continue;
      }

      // The chapter window's own year, available before the (costly) per-person window fetch
      // below, and identical to the eventual `memoryAt`'s year except when a chapter straddles a
      // calendar year boundary.
      const chapterYear = DateTime.fromJSDate(chapter.to, { zone: 'utc' }).year;
      const score = SCORE_BASE + Math.min(chapter.count, MAX_COUNT_BONUS) * 3 + recencyBonus(chapterYear, target.year);
      ranked.push({ personId: person.id, name: person.name, chapter, score });
    }

    ranked.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.personId < right.personId ? -1 : left.personId > right.personId ? 1 : 0;
    });

    const survivors = ranked.slice(0, MAX_CANDIDATES);
    const candidates: MemoryRuleCandidate[] = [];

    for (const candidate of survivors) {
      let assets: MemoryAsset[];
      try {
        assets = await this.assetRepository.getMemoryAssetsForPersonWindow(ownerId, candidate.personId, {
          from: candidate.chapter.from,
          to: candidate.chapter.to,
        });
      } catch {
        // One person's window query failing must not sink the whole rule (row 20).
        continue;
      }

      // Read skew between the step-5 daily-counts query and this query: `chapter.count` came
      // from a different, earlier read, so re-check against the assets actually returned.
      if (assets.length < MIN_CHAPTER_ASSETS) {
        continue;
      }

      const memoryAt = DateTime.fromJSDate(medianTime(assets), { zone: 'utc' });

      candidates.push({
        ruleId: this.id,
        dedupeKey: `person_throwback:${candidate.personId}`,
        title: `Times with ${candidate.name}`,
        // `chapter.count` — the full chapter total — never `assetIds.length` (capped at ASSET_CAP).
        subtitle: `${candidate.chapter.count} photos · ${monthName(memoryAt.month)} ${memoryAt.year}`,
        score: candidate.score,
        assetIds: sampleAssetsByTime(assets, ASSET_CAP),
        memoryAt,
        visibleForDays: VISIBLE_FOR_DAYS,
        context: {
          personId: candidate.personId,
          chapterFrom: candidate.chapter.from,
          chapterTo: candidate.chapter.to,
          count: candidate.chapter.count,
        },
      });
    }

    return candidates;
  }
}
