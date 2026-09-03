import { DateTime } from 'luxon';
import { AssetType } from 'src/enum';
import { MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { SeasonRecapMemoryRule } from 'src/services/memory-rules/season-recap.rule';

const summerStart = DateTime.fromISO('2026-06-01', { zone: 'utc' });
const winterStart = DateTime.fromISO('2026-12-01', { zone: 'utc' });

let seq = 0;
const assetsIn = (year: number, month: number, count: number): MemoryPeriodAsset[] =>
  Array.from({ length: count }, () => ({
    id: `a-${year}-${month}-${seq++}`,
    localDateTime: DateTime.fromObject({ year, month, day: 1, hour: 6 }, { zone: 'utc' })
      .plus({ minutes: seq })
      .toJSDate(),
    year,
    country: null,
    city: null,
    isFavorite: false,
    type: AssetType.Image,
    duration: null,
  }));

const ruleWith = (assets: MemoryPeriodAsset[]) => {
  const assetRepository = { getMemoryAssetsForPeriod: vi.fn().mockResolvedValue(assets) };
  return { rule: new SeasonRecapMemoryRule(assetRepository as never), assetRepository };
};

describe(SeasonRecapMemoryRule.name, () => {
  beforeEach(() => {
    seq = 0;
  });

  describe('given the target is not a season start', () => {
    it.each([
      ['a non-first day', DateTime.fromISO('2026-06-02', { zone: 'utc' })],
      ['a non-season-start month', DateTime.fromISO('2026-01-01', { zone: 'utc' })],
    ])('emits nothing and never queries (%s)', async (_label, target) => {
      const { rule, assetRepository } = ruleWith([]);
      expect(await rule.evaluate({ ownerId: 'user-1', target })).toEqual([]);
      expect(assetRepository.getMemoryAssetsForPeriod).not.toHaveBeenCalled();
    });
  });

  describe('given a season start with a rich prior season', () => {
    it('emits one candidate for that season-year with spec fields', async () => {
      const { rule, assetRepository } = ruleWith(assetsIn(2024, 7, 15));
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target: summerStart });

      expect(assetRepository.getMemoryAssetsForPeriod).toHaveBeenCalledWith('user-1', {
        months: [6, 7, 8],
        takenBefore: summerStart.endOf('day').toJSDate(),
      });
      expect(candidate).toMatchObject({
        ruleId: 'season_recap',
        dedupeKey: 'season_recap:2024-summer',
        score: 113, // 90 + min(15,40)=15 + recencyBonus(2024,2026)=8
        visibleForDays: 10,
        context: { seasonYear: 2024, season: 'summer', count: 15 },
      });
      expect(candidate.title).toBeUndefined();
      expect(candidate.subtitle).toBeUndefined();
      expect(candidate.memoryAt.toISODate()).toBe('2024-07-01');
      expect(candidate.assetIds).toHaveLength(15);
      expect(candidate.assetIds[0]).toBe('a-2024-7-0');
    });
  });

  describe('winter cross-year grouping', () => {
    it('groups December and the following January/February into one season-year', async () => {
      const { rule } = ruleWith([...assetsIn(2024, 12, 8), ...assetsIn(2025, 1, 5), ...assetsIn(2025, 2, 3)]);
      const result = await rule.evaluate({ ownerId: 'user-1', target: winterStart });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ context: { seasonYear: 2024, season: 'winter', count: 16 } });
    });

    it('drops the in-progress winter (season starting today)', async () => {
      // Dec 2026 belongs to Winter 2026, the season starting today -> excluded
      const { rule } = ruleWith(assetsIn(2026, 12, 20));
      expect(await rule.evaluate({ ownerId: 'user-1', target: winterStart })).toEqual([]);
    });
  });

  describe('the inclusive threshold boundary', () => {
    it('skips a season-year with 14 photos but includes exactly 15', async () => {
      expect(await ruleWith(assetsIn(2024, 7, 14)).rule.evaluate({ ownerId: 'user-1', target: summerStart })).toEqual(
        [],
      );
      expect(
        await ruleWith(assetsIn(2024, 7, 15)).rule.evaluate({ ownerId: 'user-1', target: summerStart }),
      ).toHaveLength(1);
    });
  });

  describe('given more qualifying season-years than the cap', () => {
    it('emits only the top 2, newest first', async () => {
      const { rule } = ruleWith([...assetsIn(2022, 7, 15), ...assetsIn(2023, 7, 15), ...assetsIn(2024, 7, 15)]);
      const result = await rule.evaluate({ ownerId: 'user-1', target: summerStart });
      expect(result.map((c) => c.context)).toEqual([
        { seasonYear: 2024, season: 'summer', count: 15 },
        { seasonYear: 2023, season: 'summer', count: 15 },
      ]);
    });
  });

  describe('given only the current in-progress season-year', () => {
    it('emits nothing', async () => {
      const { rule } = ruleWith(assetsIn(2026, 7, 20));
      expect(await rule.evaluate({ ownerId: 'user-1', target: summerStart })).toEqual([]);
    });
  });

  describe('given more assets than the cap', () => {
    it('caps assetIds at 30 while keeping the true count in the subtitle', async () => {
      const { rule } = ruleWith(assetsIn(2024, 7, 35));
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target: summerStart });
      expect(candidate.assetIds).toHaveLength(30);
      expect(candidate.context).toMatchObject({ count: 35 });
    });
  });
});
