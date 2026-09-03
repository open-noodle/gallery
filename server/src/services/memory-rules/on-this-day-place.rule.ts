import { AssetRepository, MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { dominantBy, recencyBonus, sampleAssetsAcrossGroups } from 'src/services/memory-rules/curation.util';
import { MemoryRule, MemoryRuleCandidate, MemoryRuleContext } from 'src/services/memory-rules/memory-rule.interface';
import { placeKeyOf } from 'src/services/memory-rules/trip.util';

/** Per contributing year: how many photos the dominant place must hold that year. */
export const MIN_ASSETS = 4;
/** Per contributing year: the dominant place's share of that year's geotagged photos. */
export const MIN_DOMINANCE = 0.6;
/**
 * How many past years must share a place before a card is emitted.
 *
 * One year in one city is already what the plain `on_this_day` memory shows — naming the city
 * adds nothing the "3 years ago" card does not carry, which is why a single year is not worth
 * a card of its own. The memory earns its place when you have been back on this date: "you
 * were in Lisbon on this day in 2021 and again in 2023" is a thing no other memory type says.
 */
export const MIN_YEARS = 2;
/** Cap on cards per day — one per place, highest scoring first. */
export const MAX_PLACES = 3;
// The subtitle reports the full dominant-place count across the years, so a stingy cap reads as
// a broken promise ("78 photos from 2021 and 2025" on a card holding 8). 16 sits between the
// recap caps (24/30) and the smaller single-subject rules.
export const ASSET_CAP = 16;
export const SCORE_BASE = 100;
export const MAX_COUNT_BONUS = 30;
/** Per extra year the place recurs, so a three-year run outranks a two-year one. */
export const YEAR_BONUS = 10;
/**
 * Ceiling on the multi-year bonus, mirroring MAX_COUNT_BONUS.
 *
 * `trip_anniversary` shares this rule's dedupe key and is meant to always win the collision,
 * which its spec pins as an invariant: trip's MINIMUM score (260 + 2*4 + 7 = 275) must beat this
 * rule's MAXIMUM. Without a ceiling, a place you are in on this date every year — your home city,
 * most often — would add 10 a year and eventually outscore a real trip. Capped, this rule tops out
 * at 100 + 90 + 9 + 30 = 229.
 */
export const MAX_YEAR_BONUS = 30;
/**
 * Share of *all* of a year's photos for the day — not just the geotagged ones — that the card
 * must hold before it stands in for that year's plain "N years ago" memory.
 *
 * MIN_DOMINANCE is measured over geotagged assets only, so a year that is 60% Lisbon-tagged and
 * 40% untagged still contributes. Superseding on that would silently drop the untagged 40% from
 * the memory lane, so supersession asks the stricter question: does this card actually represent
 * that year's day? At 0.75 a year loses at most a quarter of its photos, and only when three
 * quarters of them share one place. Evaluated per year: a card can stand in for one of its years
 * and not another.
 */
export const SUPERSEDE_COVERAGE = 0.75;

/** A usable place needs a non-blank city (EXIF city is usually null when absent, but can be ''). */
const hasCity = (asset: MemoryPeriodAsset): boolean => asset.city !== null && asset.city.trim() !== '';

/** One past year whose photos for the day are dominated by a single place. */
interface ContributingYear {
  year: number;
  city: string;
  country: string | null;
  assets: MemoryPeriodAsset[];
  /** the place's share of ALL that year's photos for the day, geotagged or not */
  dayCoverage: number;
}

/** "On this day in Lisbon" — a place you were in on this date across two or more past years. */
export class OnThisDayPlaceMemoryRule implements MemoryRule {
  readonly id = 'on_this_day_place';

  constructor(private assetRepository: Pick<AssetRepository, 'getMemoryAssetsForPeriod'>) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> {
    const assets = await this.assetRepository.getMemoryAssetsForPeriod(ownerId, {
      months: [target.month],
      day: target.day,
      takenBefore: target.endOf('day').toJSDate(),
    });

    // Keyed on every past-year asset for the day, geotagged or not: dominance is measured over
    // the geotagged subset (below), but supersession needs the day's full denominator.
    const byYear = new Map<number, MemoryPeriodAsset[]>();
    for (const asset of assets) {
      if (asset.year >= target.year) {
        continue;
      }
      const yearAssets = byYear.get(asset.year) ?? [];
      yearAssets.push(asset);
      byYear.set(asset.year, yearAssets);
    }

    // A year contributes to at most one place — the one that dominates it — so no year is ever
    // counted twice, and no year can be superseded by two cards.
    const byPlace = new Map<string, ContributingYear[]>();
    for (const [year, dayAssets] of byYear) {
      const geotagged = dayAssets.filter((asset) => hasCity(asset));
      const dominant = dominantBy(geotagged, (asset) => placeKeyOf(asset.country, asset.city));
      if (dominant.items.length < MIN_ASSETS || dominant.ratio < MIN_DOMINANCE) {
        continue;
      }

      const years = byPlace.get(dominant.key) ?? [];
      years.push({
        year,
        city: dominant.items[0]!.city!,
        country: dominant.items[0]!.country,
        assets: dominant.items,
        dayCoverage: dominant.items.length / dayAssets.length,
      });
      byPlace.set(dominant.key, years);
    }

    const mm = String(target.month).padStart(2, '0');
    const dd = String(target.day).padStart(2, '0');
    const candidates: MemoryRuleCandidate[] = [];

    for (const [placeKey, contributing] of byPlace) {
      if (contributing.length < MIN_YEARS) {
        continue;
      }

      const years = contributing.toSorted((left, right) => left.year - right.year);
      const latest = years.at(-1)!;
      const yearNumbers = years.map(({ year }) => year);
      const count = years.reduce((total, { assets }) => total + assets.length, 0);

      candidates.push({
        ruleId: this.id,
        // Keyed on the most recent year it covers. `trip_anniversary` deliberately emits this
        // same `place_day:` key for a trip to the same place on the same day, so that the
        // higher-scoring trip card suppresses this one through `seenDedupeKeys` rather than
        // both appearing — see the shared-key contract test in trip-anniversary.rule.spec.
        // Do not re-key this without re-keying that rule too.
        dedupeKey: `place_day:${latest.year}-${mm}-${dd}:${placeKey}`,
        score:
          SCORE_BASE +
          Math.min(count, MAX_COUNT_BONUS) * 3 +
          recencyBonus(latest.year, target.year) +
          Math.min((years.length - 1) * YEAR_BONUS, MAX_YEAR_BONUS),
        assetIds: sampleAssetsAcrossGroups(
          years.map(({ assets }) => assets),
          ASSET_CAP,
        ),
        memoryAt: target.set({ year: latest.year }),
        context: { city: latest.city, country: latest.country, count, years: yearNumbers },
        // The plain "N years ago" card for a year this one covers holds the very same photos.
        supersedesOnThisDayYears: years
          .filter(({ dayCoverage }) => dayCoverage >= SUPERSEDE_COVERAGE)
          .map(({ year }) => year),
      });
    }

    return candidates.toSorted((left, right) => right.score - left.score).slice(0, MAX_PLACES);
  }
}
