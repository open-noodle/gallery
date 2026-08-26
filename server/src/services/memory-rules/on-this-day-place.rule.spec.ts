import { DateTime } from 'luxon';
import { AssetType } from 'src/enum';
import { MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { recencyBonus } from 'src/services/memory-rules/curation.util';
import {
  ASSET_CAP,
  MAX_COUNT_BONUS,
  MAX_YEAR_BONUS,
  OnThisDayPlaceMemoryRule,
  SCORE_BASE,
  YEAR_BONUS,
} from 'src/services/memory-rules/on-this-day-place.rule';

const target = DateTime.fromISO('2026-06-10', { zone: 'utc' });

let seq = 0;
const cityAssets = (
  year: number,
  city: string | null,
  count: number,
  country: string | null = 'France',
): MemoryPeriodAsset[] =>
  Array.from({ length: count }, () => ({
    id: `${city ?? 'none'}-${year}-${seq++}`,
    localDateTime: DateTime.fromObject({ year, month: 6, day: 10, hour: 6 }, { zone: 'utc' })
      .plus({ minutes: seq })
      .toJSDate(),
    year,
    country,
    city,
    isFavorite: false,
    type: AssetType.Image,
    duration: null,
  }));

/** The rule needs a place in two years; most tests only care about what happens in one of them. */
const otherYear = (city: string, count = 5, year = 2021, country = 'France') => cityAssets(year, city, count, country);

const ruleWith = (assets: MemoryPeriodAsset[]) => {
  const assetRepository = { getMemoryAssetsForPeriod: vi.fn().mockResolvedValue(assets) };
  return { rule: new OnThisDayPlaceMemoryRule(assetRepository as never), assetRepository };
};

describe(OnThisDayPlaceMemoryRule.name, () => {
  beforeEach(() => {
    seq = 0;
  });

  it('queries this month+day and emits one candidate for a place dominant in two past years', async () => {
    const { rule, assetRepository } = ruleWith([
      ...cityAssets(2023, 'Lisbon', 6),
      ...cityAssets(2023, 'Porto', 2),
      ...otherYear('Lisbon', 5),
    ]);
    const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });

    expect(assetRepository.getMemoryAssetsForPeriod).toHaveBeenCalledWith('user-1', {
      months: [6],
      day: 10,
      takenBefore: target.endOf('day').toJSDate(),
    });
    expect(candidate).toMatchObject({
      ruleId: 'on_this_day_place',
      title: 'On this day in Lisbon',
      subtitle: '11 photos from 2021 and 2023',
      // keyed on the most recent year it covers — the key `trip_anniversary` also emits, so a
      // trip card to the same place on the same day suppresses this one
      dedupeKey: 'place_day:2023-06-10:france:lisbon',
      score: SCORE_BASE + 11 * 3 + recencyBonus(2023, 2026) + YEAR_BONUS,
      context: { city: 'Lisbon', country: 'France', count: 11, years: [2021, 2023] },
    });
    // anchored to the most recent year it covers
    expect(candidate.memoryAt.toISODate()).toBe('2023-06-10');
    expect(candidate.assetIds).toHaveLength(11);
    expect(candidate.visibleForDays).toBeUndefined();
  });

  describe('requiring the place to span multiple years', () => {
    it('emits nothing for a place that only appears in one past year', async () => {
      // Exactly what the plain "3 years ago" memory already shows — naming the city adds nothing.
      const { rule } = ruleWith(cityAssets(2023, 'Lisbon', 8));
      expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
    });

    it('emits nothing when two years each dominate a DIFFERENT place', async () => {
      const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 6), ...cityAssets(2021, 'Rome', 6, 'Italy')]);
      expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
    });

    it('counts a year towards the span only when that year qualifies on its own', async () => {
      // 2021 has Lisbon photos, but only 2 — below MIN_ASSETS — so 2023 is left standing alone.
      const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 6), ...cityAssets(2021, 'Lisbon', 2)]);
      expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
    });

    it('does not count a year where the place fails the dominance gate', async () => {
      // 2021 is 4 Lisbon / 4 Porto — no 60% majority, so 2021 contributes to neither place.
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 6),
        ...cityAssets(2021, 'Lisbon', 4),
        ...cityAssets(2021, 'Porto', 4),
      ]);
      expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
    });

    it('emits a separate candidate per place when two places each span two years', async () => {
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 6),
        ...cityAssets(2022, 'Lisbon', 5),
        ...cityAssets(2021, 'Rome', 6, 'Italy'),
        ...cityAssets(2020, 'Rome', 5, 'Italy'),
      ]);
      const result = await rule.evaluate({ ownerId: 'user-1', target });
      expect(result.map(({ title }) => title).toSorted((left, right) => left!.localeCompare(right!))).toEqual([
        'On this day in Lisbon',
        'On this day in Rome',
      ]);
    });
  });

  describe('the subtitle', () => {
    it('lists two years', async () => {
      const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 6), ...otherYear('Lisbon', 5)]);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      expect(candidate.subtitle).toBe('11 photos from 2021 and 2023');
    });

    it('lists three years oldest first', async () => {
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 4),
        ...cityAssets(2021, 'Lisbon', 4),
        ...cityAssets(2019, 'Lisbon', 4),
      ]);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      expect(candidate.subtitle).toBe('12 photos from 2019, 2021 and 2023');
    });

    it('counts the years instead of listing them beyond three', async () => {
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 4),
        ...cityAssets(2022, 'Lisbon', 4),
        ...cityAssets(2021, 'Lisbon', 4),
        ...cityAssets(2020, 'Lisbon', 4),
      ]);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      expect(candidate.subtitle).toBe('16 photos across 4 years');
    });

    it('keeps the full count even when the attached assets are capped', async () => {
      const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 40), ...otherYear('Lisbon', 5)]);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      expect(candidate.assetIds).toHaveLength(ASSET_CAP);
      expect(candidate.subtitle).toBe('45 photos from 2021 and 2023');
      expect(candidate.context).toMatchObject({ count: 45 });
    });
  });

  describe('the attached assets', () => {
    it('includes only the dominant-place assets, not the whole day', async () => {
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 5),
        ...cityAssets(2023, 'Porto', 2),
        ...otherYear('Lisbon', 5),
      ]);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      expect(candidate.assetIds.every((id) => id.startsWith('Lisbon-'))).toBe(true);
      expect(candidate.assetIds).toHaveLength(10);
    });

    it('spreads the cap across the years rather than filling it from the busiest', async () => {
      // 40 photos in 2023 and 5 in 2021: a plain chronological cap would show 2023 only.
      const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 40), ...otherYear('Lisbon', 5)]);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      const perYear = (year: number) => candidate.assetIds.filter((id) => id.includes(`-${year}-`)).length;
      expect(candidate.assetIds).toHaveLength(ASSET_CAP);
      expect(perYear(2021)).toBe(5); // everything it has
      expect(perYear(2023)).toBe(ASSET_CAP - 5);
    });

    it('splits the cap evenly between years of very different sizes', async () => {
      // 30 in 2021 and 10 in 2023 — both hold more than their fair share of 8, so neither year
      // gets to lean on the other. Sampling the years as one flat timeline would hand 2021 the
      // 12 slots its bulk earns and leave 2023 with 4.
      const { rule } = ruleWith([...cityAssets(2021, 'Lisbon', 30), ...cityAssets(2023, 'Lisbon', 10)]);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      const perYear = (year: number) => candidate.assetIds.filter((id) => id.includes(`-${year}-`)).length;
      expect(perYear(2021)).toBe(ASSET_CAP / 2);
      expect(perYear(2023)).toBe(ASSET_CAP / 2);
    });
  });

  describe('per-year qualification', () => {
    it('excludes ungeotagged assets from the dominance denominator (only geotagged count)', async () => {
      // 4 Lisbon + 4 null-city in 2023: if nulls counted, the ratio would be 4/8 = 50% and fail
      // the gate. Because null-city assets are dropped before dominance, Lisbon is 4/4 = 100%.
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 4),
        ...cityAssets(2023, null, 4, null),
        ...otherYear('Lisbon', 5),
      ]);
      const result = await rule.evaluate({ ownerId: 'user-1', target });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ title: 'On this day in Lisbon', subtitle: '9 photos from 2021 and 2023' });
    });

    it('treats a blank ("") city the same as no city', async () => {
      // EXIF city is usually null when absent but can be an empty string; it must not form a place.
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 4),
        ...cityAssets(2023, '', 4),
        ...otherYear('Lisbon', 5),
      ]);
      const result = await rule.evaluate({ ownerId: 'user-1', target });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('On this day in Lisbon');
    });

    it('accepts exactly 60% dominance (inclusive boundary)', async () => {
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 6),
        ...cityAssets(2023, 'Porto', 4),
        ...otherYear('Lisbon', 5),
      ]);
      const result = await rule.evaluate({ ownerId: 'user-1', target });
      expect(result).toHaveLength(1);
      expect(result[0].subtitle).toBe('11 photos from 2021 and 2023');
    });

    it('drops a year whose dominant place is below the 60% majority even with >= 4 photos', async () => {
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 5),
        ...cityAssets(2023, 'Porto', 5),
        ...otherYear('Lisbon', 5),
      ]);
      expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
    });

    it('drops a year with fewer than 4 photos even at high dominance', async () => {
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 3),
        ...cityAssets(2023, 'Porto', 1),
        ...otherYear('Lisbon', 5),
      ]);
      expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
    });

    it('emits no candidate when all photos are ungeotagged', async () => {
      const { rule } = ruleWith([...cityAssets(2023, null, 8, null), ...cityAssets(2021, null, 8, null)]);
      expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
    });

    it('emits nothing when only current-year photos exist', async () => {
      const { rule } = ruleWith(cityAssets(2026, 'Lisbon', 8));
      expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
    });
  });

  describe('scoring', () => {
    it('caps at the top 3 places by score', async () => {
      // Each place owns its own pair of years: within one year only the dominant place counts,
      // so two places can never both qualify from the same year.
      const { rule } = ruleWith(
        [
          ['A', 2019],
          ['B', 2021],
          ['C', 2023],
          ['D', 2025],
        ].flatMap(([city, year]) => [
          ...cityAssets(year as number, city as string, 5),
          ...cityAssets((year as number) - 1, city as string, 5),
        ]),
      );
      const result = await rule.evaluate({ ownerId: 'user-1', target });
      expect(result).toHaveLength(3);
      // equal sizes and spans, so the recency bonus orders them and the oldest (A) is dropped
      expect(result.map(({ title }) => title)).toEqual(['On this day in D', 'On this day in C', 'On this day in B']);
    });

    it('ranks a place that recurs in more years above an equally sized, more recent one', async () => {
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 4),
        ...cityAssets(2022, 'Lisbon', 4),
        ...cityAssets(2021, 'Lisbon', 4),
        ...cityAssets(2025, 'Rome', 6, 'Italy'),
        ...cityAssets(2024, 'Rome', 6, 'Italy'),
      ]);
      const result = await rule.evaluate({ ownerId: 'user-1', target });
      // Both hold 12 photos, and Rome is the more recent (+2 recency) — but Lisbon's third
      // year is worth YEAR_BONUS, which is decisive.
      expect(result.map(({ title }) => title)).toEqual(['On this day in Lisbon', 'On this day in Rome']);
      expect(result[0].score - result[1].score).toBe(YEAR_BONUS - 2);
    });

    it('caps the multi-year bonus so a place you return to every year cannot outscore a trip', async () => {
      // trip_anniversary shares this rule's dedupe key and must always win that collision, so
      // this rule's ceiling is load-bearing — see the invariant in trip-anniversary.rule.spec.
      const years = Array.from({ length: 9 }, (_, index) => cityAssets(2025 - index, 'Lisbon', 4)).flat();
      const { rule } = ruleWith(years);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });

      expect(candidate.context).toMatchObject({ count: 36 });
      expect(candidate.score).toBe(SCORE_BASE + MAX_COUNT_BONUS * 3 + recencyBonus(2025, 2026) + MAX_YEAR_BONUS);
    });

    it('caps the count bonus so 40 photos score the same as 30', async () => {
      const { rule: ruleAt40 } = ruleWith([...cityAssets(2023, 'Lisbon', 35), ...otherYear('Lisbon', 5)]);
      const { rule: ruleAt30 } = ruleWith([...cityAssets(2023, 'Lisbon', 25), ...otherYear('Lisbon', 5)]);

      const [at40] = await ruleAt40.evaluate({ ownerId: 'user-1', target });
      const [at30] = await ruleAt30.evaluate({ ownerId: 'user-1', target });

      const expectedScore = SCORE_BASE + MAX_COUNT_BONUS * 3 + recencyBonus(2023, 2026) + YEAR_BONUS;
      expect(at40.score).toBe(expectedScore);
      expect(at30.score).toBe(expectedScore);
    });
  });

  describe('superseding the plain "N years ago" memory', () => {
    it('supersedes every year the card holds outright', async () => {
      const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 8), ...cityAssets(2021, 'Lisbon', 6)]);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      expect(candidate.supersedesOnThisDayYears).toEqual([2021, 2023]);
    });

    it('supersedes only the years it covers, not every year it spans', async () => {
      // 2021 is 6 Lisbon + 6 untagged: Lisbon is 100% of that year's GEOTAGGED assets so the
      // year still contributes, but the card holds only half of what 2021 shot that day.
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 8),
        ...cityAssets(2021, 'Lisbon', 6),
        ...cityAssets(2021, null, 6, null),
      ]);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      expect(candidate.supersedesOnThisDayYears).toEqual([2023]);
    });

    it('supersedes nothing when neither year is well covered', async () => {
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 6),
        ...cityAssets(2023, null, 4, null),
        ...cityAssets(2021, 'Lisbon', 6),
        ...cityAssets(2021, null, 4, null),
      ]);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      expect(candidate.supersedesOnThisDayYears).toEqual([]);
    });

    it('supersedes at exactly 75% day coverage (inclusive boundary)', async () => {
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 6),
        ...cityAssets(2023, null, 2, null),
        ...cityAssets(2021, 'Lisbon', 6),
      ]);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      expect(candidate.supersedesOnThisDayYears).toEqual([2021, 2023]);
    });

    it('does not supersede a year just below 75% day coverage', async () => {
      // 5 of 7 = 71.4%
      const { rule } = ruleWith([
        ...cityAssets(2023, 'Lisbon', 5),
        ...cityAssets(2023, null, 2, null),
        ...cityAssets(2021, 'Lisbon', 6),
      ]);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      expect(candidate.supersedesOnThisDayYears).toEqual([2021]);
    });

    it('measures coverage against the day, not the capped asset list', async () => {
      // 40 Lisbon photos in 2023: the card attaches ASSET_CAP overall but still stands in for
      // that whole day.
      const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 40), ...otherYear('Lisbon', 5)]);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      expect(candidate.assetIds).toHaveLength(ASSET_CAP);
      expect(candidate.supersedesOnThisDayYears).toEqual([2021, 2023]);
    });
  });

  // Note: a two-city *tie* can never pass the 60% majority gate (each side is <= 50%), so the
  // deterministic tie-break lives in and is tested by dominantBy (curation.util.spec).

  it('handles a leap-day target without crashing', async () => {
    const leap = DateTime.fromISO('2028-02-29', { zone: 'utc' });
    const { rule, assetRepository } = ruleWith([...cityAssets(2024, 'Lisbon', 6), ...cityAssets(2020, 'Lisbon', 6)]);
    await rule.evaluate({ ownerId: 'user-1', target: leap });
    expect(assetRepository.getMemoryAssetsForPeriod).toHaveBeenCalledWith('user-1', {
      months: [2],
      day: 29,
      takenBefore: leap.endOf('day').toJSDate(),
    });
  });
});
