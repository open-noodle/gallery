import { DateTime } from 'luxon';
import { AssetType } from 'src/enum';
import { MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { FavoritesThrowbackMemoryRule } from 'src/services/memory-rules/favorites-throwback.rule';

const target = DateTime.fromISO('2026-07-15', { zone: 'utc' });

const favoritesForYear = (year: number, count: number, month = 7): MemoryPeriodAsset[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `f-${year}-${index}`,
    localDateTime: DateTime.fromObject({ year, month, day: 1 }, { zone: 'utc' }).plus({ hours: index }).toJSDate(),
    year,
    country: null,
    city: null,
    isFavorite: true,
    type: AssetType.Image,
    duration: null,
  }));

const ruleWith = (assets: MemoryPeriodAsset[]) => {
  const assetRepository = { getMemoryAssetsForPeriod: vi.fn().mockResolvedValue(assets) };
  return { rule: new FavoritesThrowbackMemoryRule(assetRepository as never), assetRepository };
};

describe(FavoritesThrowbackMemoryRule.name, () => {
  describe('given the target day is not the 15th', () => {
    it('emits no candidates and never queries', async () => {
      const { rule, assetRepository } = ruleWith([]);
      const result = await rule.evaluate({
        ownerId: 'user-1',
        target: DateTime.fromISO('2026-07-01', { zone: 'utc' }),
      });
      expect(result).toEqual([]);
      expect(assetRepository.getMemoryAssetsForPeriod).not.toHaveBeenCalled();
    });
  });

  describe('given at least 4 favorites in a prior-year copy of this month', () => {
    it('queries favorites only and emits one candidate with spec fields', async () => {
      const { rule, assetRepository } = ruleWith(favoritesForYear(2023, 6));
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });

      expect(assetRepository.getMemoryAssetsForPeriod).toHaveBeenCalledWith('user-1', {
        months: [7],
        favoritesOnly: true,
        takenBefore: target.endOf('day').toJSDate(),
      });
      expect(candidate).toMatchObject({
        ruleId: 'favorites_throwback',
        dedupeKey: 'favorites_throwback:2023-07',
        score: 225, // 200 + min(6,20)*3=18 + recencyBonus(2023,2026)=7
        visibleForDays: 7,
        context: { year: 2023, month: 7, count: 6 },
      });
      expect(candidate.assetIds).toEqual(['f-2023-0', 'f-2023-1', 'f-2023-2', 'f-2023-3', 'f-2023-4', 'f-2023-5']);
      expect(candidate.title).toBeUndefined();
      expect(candidate.subtitle).toBeUndefined();
      expect(candidate.memoryAt.toISODate()).toBe('2023-07-01');
    });
  });

  describe('given favorites across several prior years', () => {
    it('emits three candidates score-sorted; caps at three when five qualify', async () => {
      const three = await ruleWith([
        ...favoritesForYear(2021, 4),
        ...favoritesForYear(2022, 4),
        ...favoritesForYear(2023, 4),
      ]).rule.evaluate({ ownerId: 'user-1', target });
      expect(three.map((c) => c.context)).toEqual([
        { year: 2023, month: 7, count: 4 },
        { year: 2022, month: 7, count: 4 },
        { year: 2021, month: 7, count: 4 },
      ]);

      const five = await ruleWith([
        ...favoritesForYear(2019, 4),
        ...favoritesForYear(2020, 4),
        ...favoritesForYear(2021, 4),
        ...favoritesForYear(2022, 4),
        ...favoritesForYear(2023, 4),
      ]).rule.evaluate({ ownerId: 'user-1', target });
      expect(five).toHaveLength(3);
    });
  });

  describe('the inclusive threshold boundary', () => {
    it('skips a year with 3 favorites but includes exactly 4', async () => {
      const three = await ruleWith(favoritesForYear(2023, 3)).rule.evaluate({ ownerId: 'user-1', target });
      expect(three).toEqual([]);

      const four = await ruleWith(favoritesForYear(2023, 4)).rule.evaluate({ ownerId: 'user-1', target });
      expect(four).toHaveLength(1);
    });
  });

  describe('given only current-year favorites', () => {
    it('emits nothing', async () => {
      const { rule } = ruleWith(favoritesForYear(2026, 10));
      expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
    });
  });

  describe('given more favorites than the cap', () => {
    it('caps assetIds at 12 but keeps the true count in the subtitle', async () => {
      const { rule } = ruleWith(favoritesForYear(2023, 25));
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      expect(candidate.assetIds).toHaveLength(12);
      expect(candidate.context).toMatchObject({ count: 25 });
      // score cap: min(25,20)*3 = 60 -> 200 + 60 + recencyBonus(2023,2026)=7 = 267
      expect(candidate.score).toBe(267);
    });
  });
});
