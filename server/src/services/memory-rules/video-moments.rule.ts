import { DateTime } from 'luxon';
import { AssetType } from 'src/enum';
import { AssetRepository, MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { medianTime, pickEvenlySpaced, recencyBonus } from 'src/services/memory-rules/curation.util';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';

export const TRIGGER_DAY = 8;
export const MIN_DURATION_MS = 3000;
export const MAX_DURATION_MS = 180_000;
export const MIN_ASSETS = 3;
export const MAX_YEARS = 3;
export const ASSET_CAP = 8;
export const VISIBLE_FOR_DAYS = 5;
export const MAX_FAVORITE_BONUS = 10;
export const SCORE_BASE = 60;

const byTime = (left: MemoryPeriodAsset, right: MemoryPeriodAsset): number =>
  left.localDateTime.getTime() - right.localDateTime.getTime();

const inDurationBand = (asset: MemoryPeriodAsset): boolean =>
  asset.duration !== null && asset.duration >= MIN_DURATION_MS && asset.duration <= MAX_DURATION_MS;

/** "Video moments from July 2023" — videos filmed in this calendar month in a past year. */
export class VideoMomentsMemoryRule implements MemoryRule {
  readonly id = 'video_moments';

  constructor(private assetRepository: Pick<AssetRepository, 'getMemoryAssetsForPeriod'>) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    if (target.day !== TRIGGER_DAY) {
      return [];
    }

    const month = target.month;
    const assets = await this.assetRepository.getMemoryAssetsForPeriod(ownerId, {
      months: [month],
      type: AssetType.Video,
      takenBefore: target.endOf('day').toJSDate(),
    });

    const byYear = new Map<number, MemoryPeriodAsset[]>();
    for (const asset of assets) {
      if (asset.year >= target.year || !inDurationBand(asset)) {
        continue;
      }
      const yearAssets = byYear.get(asset.year) ?? [];
      yearAssets.push(asset);
      byYear.set(asset.year, yearAssets);
    }

    const mm = String(month).padStart(2, '0');
    const candidates: MemoryRuleCandidate[] = [];

    for (const [year, survivors] of byYear) {
      if (survivors.length < MIN_ASSETS) {
        continue;
      }

      const count = survivors.length;
      const favourites = survivors.filter((asset) => asset.isFavorite).sort(byTime);
      const others = survivors.filter((asset) => !asset.isFavorite).sort(byTime);
      const favoriteCount = favourites.length;

      const selected =
        favourites.length >= ASSET_CAP
          ? pickEvenlySpaced(favourites, ASSET_CAP)
          : [...favourites, ...pickEvenlySpaced(others, ASSET_CAP - favourites.length)];
      selected.sort(byTime);

      candidates.push({
        ruleId: this.id,
        dedupeKey: `video_moments:${year}-${mm}`,
        score:
          SCORE_BASE +
          Math.min(count, 15) * 2 +
          Math.min(favoriteCount, MAX_FAVORITE_BONUS) * 3 +
          recencyBonus(year, target.year),
        assetIds: selected.map((asset) => asset.id),
        memoryAt: DateTime.fromJSDate(medianTime(selected), { zone: 'utc' }),
        context: { year, month, count, favoriteCount },
        visibleForDays: VISIBLE_FOR_DAYS,
      });
    }

    return candidates.toSorted((left, right) => right.score - left.score).slice(0, MAX_YEARS);
  }
}
