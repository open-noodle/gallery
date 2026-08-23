import { DateTime } from 'luxon';
import { medianTime, recencyBonus, sampleAssetsByTime } from 'src/services/memory-rules/curation.util';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';
import { ThemeSearchPort } from 'src/services/memory-rules/theme-search.port';
import { themeForMonth } from 'src/services/memory-rules/theme.catalog';

export const TRIGGER_DAY = 22;
export const MAX_YEARS_BACK = 3;
export const FETCH_SIZE = 40;
export const MIN_ASSETS = 8;
export const ASSET_CAP = 16;
export const VISIBLE_FOR_DAYS = 5;
export const MAX_CANDIDATES = 3;
export const SCORE_BASE = 70;

/**
 * "Sunsets from 2023" — a curated CLIP theme (rotated by calendar month) resurfaced from a past
 * year via smart search. Never sees `maxDistance`; the port/adapter owns quality thresholding.
 */
export class ThemedMemoryRule implements MemoryRule {
  readonly id = 'themed';

  constructor(private themeSearchPort: ThemeSearchPort) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    if (target.day !== TRIGGER_DAY) {
      return [];
    }

    const theme = themeForMonth(target.month);

    let embedding: string | null;
    try {
      embedding = await this.themeSearchPort.resolveEmbedding(theme.key, theme.query);
    } catch {
      // resolveEmbedding is documented to never throw, but guard defensively anyway.
      return [];
    }
    if (embedding === null) {
      return [];
    }

    const candidates: MemoryRuleCandidate[] = [];

    for (let year = target.year - 1; year >= target.year - MAX_YEARS_BACK; year--) {
      // No min(..., target) clamp: this range already excludes the current year.
      const takenAfter = DateTime.utc(year, 1, 1).startOf('day');
      const takenBefore = DateTime.utc(year, 12, 31).endOf('day');

      const assets = await this.themeSearchPort.searchByEmbedding({
        ownerId,
        embedding,
        takenAfter: takenAfter.toJSDate(),
        takenBefore: takenBefore.toJSDate(),
        size: FETCH_SIZE,
      });

      // The port's date bounds hit asset.fileCreatedAt (via the adapter's widened window), not
      // localDateTime, so re-filter to exactly this year before applying MIN_ASSETS (§3.4.1).
      const filtered = assets.filter(
        (asset) => DateTime.fromJSDate(asset.localDateTime, { zone: 'utc' }).year === year,
      );
      if (filtered.length < MIN_ASSETS) {
        continue;
      }

      const count = filtered.length;

      candidates.push({
        ruleId: this.id,
        dedupeKey: `themed:${theme.key}:${year}`,
        title: `${theme.label} from ${year}`,
        subtitle: `${count} photos`,
        score: SCORE_BASE + Math.min(count, 25) + recencyBonus(year, target.year),
        assetIds: sampleAssetsByTime(filtered, ASSET_CAP),
        memoryAt: DateTime.fromJSDate(medianTime(filtered), { zone: 'utc' }),
        visibleForDays: VISIBLE_FOR_DAYS,
        context: { year, theme: theme.key, count },
      });
    }

    // Emit every qualifying year (up to MAX_CANDIDATES), not just the best: hasRuleMemory dedup
    // happens in the engine after the rule returns, and recencyBonus always favours the newest
    // year, so a 1-candidate rule would make older years permanently unreachable once the
    // newest year's memory exists.
    return candidates.toSorted((left, right) => right.score - left.score).slice(0, MAX_CANDIDATES);
  }
}
