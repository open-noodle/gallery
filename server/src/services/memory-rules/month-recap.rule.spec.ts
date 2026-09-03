import { DateTime } from 'luxon';
import { AssetType } from 'src/enum';
import { MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { MonthRecapMemoryRule } from 'src/services/memory-rules/month-recap.rule';

const target = DateTime.fromISO('2026-07-01', { zone: 'utc' });

const assetsForYear = (year: number, count: number, month = 7): MemoryPeriodAsset[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `a-${year}-${index}`,
    localDateTime: DateTime.fromObject({ year, month, day: 1 }, { zone: 'utc' }).plus({ hours: index }).toJSDate(),
    year,
    country: null,
    city: null,
    isFavorite: false,
    type: AssetType.Image,
    duration: null,
  }));

const ruleWith = (assets: MemoryPeriodAsset[]) => {
  const assetRepository = { getMemoryAssetsForPeriod: vi.fn().mockResolvedValue(assets) };
  return { rule: new MonthRecapMemoryRule(assetRepository as never), assetRepository };
};

describe(MonthRecapMemoryRule.name, () => {
  describe('given the target day is not the 1st', () => {
    it('emits no candidates and never queries', async () => {
      const { rule, assetRepository } = ruleWith([]);
      const result = await rule.evaluate({
        ownerId: 'user-1',
        target: DateTime.fromISO('2026-07-05', { zone: 'utc' }),
      });
      expect(result).toEqual([]);
      expect(assetRepository.getMemoryAssetsForPeriod).not.toHaveBeenCalled();
    });
  });

  describe('given at least 10 photos in a prior-year copy of this month', () => {
    it('emits one candidate with the fields from the spec', async () => {
      const { rule, assetRepository } = ruleWith(assetsForYear(2023, 12));
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });

      expect(assetRepository.getMemoryAssetsForPeriod).toHaveBeenCalledWith('user-1', {
        months: [7],
        takenBefore: target.endOf('day').toJSDate(),
      });
      expect(candidate).toMatchObject({
        ruleId: 'month_recap',
        dedupeKey: 'month_recap:2023-07',
        score: 99, // 80 + min(12,30) + recencyBonus(2023, 2026)=7
        visibleForDays: 7,
        context: { year: 2023, month: 7, count: 12 },
      });
      expect(candidate.title).toBeUndefined();
      expect(candidate.subtitle).toBeUndefined();
      expect(candidate.memoryAt.toISODate()).toBe('2023-07-01');
      expect(candidate.assetIds).toHaveLength(12);
      expect(candidate.assetIds[0]).toBe('a-2023-0');
      expect(candidate.assetIds.at(-1)).toBe('a-2023-11');
    });
  });

  describe('given more qualifying years than the cap', () => {
    it('emits only the top 3, score-sorted (newest first at equal count)', async () => {
      const { rule } = ruleWith([
        ...assetsForYear(2022, 10),
        ...assetsForYear(2023, 10),
        ...assetsForYear(2024, 10),
        ...assetsForYear(2025, 10),
      ]);
      const result = await rule.evaluate({ ownerId: 'user-1', target });
      expect(result.map((c) => c.context)).toEqual([
        { year: 2025, month: 7, count: 10 },
        { year: 2024, month: 7, count: 10 },
        { year: 2023, month: 7, count: 10 },
      ]);
    });
  });

  describe('the inclusive threshold boundary', () => {
    it('skips a year with 9 photos but includes exactly 10', async () => {
      const nine = await ruleWith(assetsForYear(2023, 9)).rule.evaluate({ ownerId: 'user-1', target });
      expect(nine).toEqual([]);

      const ten = await ruleWith(assetsForYear(2023, 10)).rule.evaluate({ ownerId: 'user-1', target });
      expect(ten).toHaveLength(1);
    });
  });

  describe('given only current-year photos', () => {
    it('emits nothing', async () => {
      const { rule } = ruleWith(assetsForYear(2026, 20));
      expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
    });
  });

  describe('given more assets than the cap', () => {
    it('caps assetIds at 24, chronologically', async () => {
      const { rule } = ruleWith(assetsForYear(2023, 30));
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      expect(candidate.assetIds).toHaveLength(24);
      expect(candidate.assetIds[0]).toBe('a-2023-0');
      expect(candidate.assetIds.at(-1)).toBe('a-2023-29');
      expect(candidate.context).toMatchObject({ count: 30 }); // true count, not the capped sample
    });
  });

  describe('recency', () => {
    it('scores a newer year above an older year at equal count', async () => {
      const { rule } = ruleWith([...assetsForYear(2020, 10), ...assetsForYear(2024, 10)]);
      const result = await rule.evaluate({ ownerId: 'user-1', target });
      expect(result[0].context).toMatchObject({ year: 2024 });
      expect(result[0].score).toBeGreaterThan(result[1].score);
    });
  });
});
