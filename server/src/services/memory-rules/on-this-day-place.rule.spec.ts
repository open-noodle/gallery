import { DateTime } from 'luxon';
import { AssetType } from 'src/enum';
import { MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { recencyBonus } from 'src/services/memory-rules/curation.util';
import {
  ASSET_CAP,
  MAX_COUNT_BONUS,
  OnThisDayPlaceMemoryRule,
  SCORE_BASE,
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

const ruleWith = (assets: MemoryPeriodAsset[]) => {
  const assetRepository = { getMemoryAssetsForPeriod: vi.fn().mockResolvedValue(assets) };
  return { rule: new OnThisDayPlaceMemoryRule(assetRepository as never), assetRepository };
};

describe(OnThisDayPlaceMemoryRule.name, () => {
  beforeEach(() => {
    seq = 0;
  });

  it('queries this month+day and emits a place candidate for a dominant city', async () => {
    const { rule, assetRepository } = ruleWith([...cityAssets(2023, 'Lisbon', 6), ...cityAssets(2023, 'Porto', 2)]);
    const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });

    expect(assetRepository.getMemoryAssetsForPeriod).toHaveBeenCalledWith('user-1', {
      months: [6],
      day: 10,
      takenBefore: target.endOf('day').toJSDate(),
    });
    expect(candidate).toMatchObject({
      ruleId: 'on_this_day_place',
      title: 'On this day in Lisbon',
      subtitle: '6 photos from 2023',
      dedupeKey: 'place_day:2023-06-10:france:lisbon',
      score: 125, // 100 + 6*3 + recencyBonus(2023,2026)=7
      context: { year: 2023, city: 'Lisbon', country: 'France', count: 6 },
    });
    expect(candidate.memoryAt.toISODate()).toBe('2023-06-10');
    expect(candidate.assetIds).toHaveLength(6);
    expect(candidate.visibleForDays).toBeUndefined();
  });

  it('excludes ungeotagged assets from the dominance denominator (only geotagged count)', async () => {
    // 4 Lisbon + 4 null-city: if nulls counted, ratio would be 4/8 = 50% and fail the gate.
    // Because null-city assets are dropped before dominance, Lisbon is 4/4 = 100% -> a candidate.
    const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 4), ...cityAssets(2023, null, 4, null)]);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: 'On this day in Lisbon', subtitle: '4 photos from 2023' });
  });

  it('treats a blank ("") city the same as no city', async () => {
    // EXIF city is usually null when absent but can be an empty string; it must not form a place.
    const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 4), ...cityAssets(2023, '', 4)]);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('On this day in Lisbon');
  });

  it('emits no candidate when no city reaches a 60% majority', async () => {
    const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 4), ...cityAssets(2023, 'Porto', 4)]);
    expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
  });

  it('accepts exactly 60% dominance (inclusive boundary)', async () => {
    const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 6), ...cityAssets(2023, 'Porto', 4)]);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('On this day in Lisbon');
  });

  it('rejects a dominant city below the 60% majority even with >= 4 photos', async () => {
    const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 5), ...cityAssets(2023, 'Porto', 5)]);
    expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
  });

  it('rejects a dominant city with fewer than 4 photos even at high dominance', async () => {
    const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 3), ...cityAssets(2023, 'Porto', 1)]);
    expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
  });

  it('includes only the dominant-city assets, not the whole day', async () => {
    const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 5), ...cityAssets(2023, 'Porto', 2)]);
    const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
    expect(candidate.assetIds.every((id) => id.startsWith('Lisbon-'))).toBe(true);
    expect(candidate.assetIds).toHaveLength(5);
  });

  it('caps the attached assets but keeps the full count in the subtitle', async () => {
    const { rule } = ruleWith(cityAssets(2023, 'Lisbon', 40));
    const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
    expect(candidate.assetIds).toHaveLength(ASSET_CAP);
    expect(candidate.subtitle).toBe('40 photos from 2023');
    expect(candidate.context).toMatchObject({ count: 40 });
  });

  it('emits no candidate when all photos are ungeotagged', async () => {
    const { rule } = ruleWith(cityAssets(2023, null, 8, null));
    expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
  });

  it('emits one candidate per qualifying year', async () => {
    const { rule } = ruleWith([...cityAssets(2023, 'Lisbon', 6), ...cityAssets(2022, 'Rome', 5, 'Italy')]);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result.map((c) => c.title).toSorted()).toEqual(['On this day in Lisbon', 'On this day in Rome']);
  });

  it('caps at the top 3 years by score', async () => {
    const { rule } = ruleWith([
      ...cityAssets(2021, 'A', 5),
      ...cityAssets(2022, 'B', 5),
      ...cityAssets(2023, 'C', 5),
      ...cityAssets(2024, 'D', 5),
    ]);
    const result = await rule.evaluate({ ownerId: 'user-1', target });
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.title)).toEqual(['On this day in D', 'On this day in C', 'On this day in B']);
  });

  // Note: a two-city *tie* can never pass the 60% majority gate (each side is <= 50%), so the
  // deterministic tie-break lives in and is tested by dominantBy (curation.util.spec).

  it('caps the count bonus so 40 photos score the same as 30 (score cap)', async () => {
    const { rule: ruleAt40 } = ruleWith(cityAssets(2023, 'Lisbon', 40));
    const { rule: ruleAt30 } = ruleWith(cityAssets(2023, 'Lisbon', 30));

    const [at40] = await ruleAt40.evaluate({ ownerId: 'user-1', target });
    const [at30] = await ruleAt30.evaluate({ ownerId: 'user-1', target });

    const expectedScore = SCORE_BASE + MAX_COUNT_BONUS * 3 + recencyBonus(2023, 2026);
    expect(at40.score).toBe(expectedScore);
    expect(at30.score).toBe(expectedScore);
  });

  it('emits nothing when only current-year photos exist', async () => {
    const { rule } = ruleWith(cityAssets(2026, 'Lisbon', 8));
    expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
  });

  it('handles a leap-day target without crashing', async () => {
    const leap = DateTime.fromISO('2028-02-29', { zone: 'utc' });
    const { rule, assetRepository } = ruleWith([...cityAssets(2024, 'Lisbon', 6)]);
    await rule.evaluate({ ownerId: 'user-1', target: leap });
    expect(assetRepository.getMemoryAssetsForPeriod).toHaveBeenCalledWith('user-1', {
      months: [2],
      day: 29,
      takenBefore: leap.endOf('day').toJSDate(),
    });
  });
});
