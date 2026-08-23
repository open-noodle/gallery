import { AssetRepository, MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { dominantBy, recencyBonus, sampleAssetsByTime } from 'src/services/memory-rules/curation.util';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';
import { placeKeyOf } from 'src/services/memory-rules/trip.util';

export const MIN_ASSETS = 4;
export const MIN_DOMINANCE = 0.6;
export const MAX_YEARS = 3;
// The subtitle reports the full dominant-city count, so a stingy cap reads as a broken promise
// ("78 photos from 2025" on a card holding 8). 16 sits between the recap caps (24/30) and the
// smaller single-subject rules, which suits a day's worth of photos in one city.
export const ASSET_CAP = 16;
export const SCORE_BASE = 100;
export const MAX_COUNT_BONUS = 30;

/** A usable place needs a non-blank city (EXIF city is usually null when absent, but can be ''). */
const hasCity = (asset: MemoryPeriodAsset): boolean => asset.city !== null && asset.city.trim() !== '';

/** "On this day in Lisbon" — a past year's on-this-day photos dominated by a single city. */
export class OnThisDayPlaceMemoryRule implements MemoryRule {
  readonly id = 'on_this_day_place';

  constructor(private assetRepository: Pick<AssetRepository, 'getMemoryAssetsForPeriod'>) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    const assets = await this.assetRepository.getMemoryAssetsForPeriod(ownerId, {
      months: [target.month],
      day: target.day,
      takenBefore: target.endOf('day').toJSDate(),
    });

    const byYear = new Map<number, MemoryPeriodAsset[]>();
    for (const asset of assets) {
      if (asset.year >= target.year || !hasCity(asset)) {
        continue;
      }
      const yearAssets = byYear.get(asset.year) ?? [];
      yearAssets.push(asset);
      byYear.set(asset.year, yearAssets);
    }

    const mm = String(target.month).padStart(2, '0');
    const dd = String(target.day).padStart(2, '0');
    const candidates: MemoryRuleCandidate[] = [];

    for (const [year, geotagged] of byYear) {
      const dominant = dominantBy(geotagged, (asset) => placeKeyOf(asset.country, asset.city));
      if (dominant.items.length < MIN_ASSETS || dominant.ratio < MIN_DOMINANCE) {
        continue;
      }

      const city = dominant.items[0]!.city!;
      const count = dominant.items.length;
      candidates.push({
        ruleId: this.id,
        dedupeKey: `place_day:${year}-${mm}-${dd}:${dominant.key}`,
        title: `On this day in ${city}`,
        subtitle: `${count} photos from ${year}`,
        score: SCORE_BASE + Math.min(count, MAX_COUNT_BONUS) * 3 + recencyBonus(year, target.year),
        assetIds: sampleAssetsByTime(dominant.items, ASSET_CAP),
        memoryAt: target.set({ year }),
        context: { year, city, country: dominant.items[0]!.country, count },
      });
    }

    return candidates.toSorted((left, right) => right.score - left.score).slice(0, MAX_YEARS);
  }
}
