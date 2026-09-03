import { DateTime } from 'luxon';
import { AssetType } from 'src/enum';
import { MemoryPeriodAsset } from 'src/repositories/asset.repository';
import { VideoMomentsMemoryRule } from 'src/services/memory-rules/video-moments.rule';

const target = DateTime.fromISO('2026-07-08', { zone: 'utc' });

const video = (
  id: string,
  year: number,
  hour: number,
  options: { isFavorite?: boolean; duration?: number | null } = {},
): MemoryPeriodAsset => ({
  id,
  localDateTime: DateTime.fromObject({ year, month: 7, day: 1 }, { zone: 'utc' }).plus({ hours: hour }).toJSDate(),
  year,
  country: null,
  city: null,
  isFavorite: options.isFavorite ?? false,
  type: AssetType.Video,
  duration: options.duration === undefined ? 60_000 : options.duration,
});

/** 9 in-band videos, 3 of them favourites (indices 2, 5, 8), all in 2023. */
const workedExampleAssets = (): MemoryPeriodAsset[] =>
  Array.from({ length: 9 }, (_, index) =>
    video(`v-2023-${index}`, 2023, index, { isFavorite: [2, 5, 8].includes(index) }),
  );

const videosForYear = (year: number): MemoryPeriodAsset[] =>
  Array.from({ length: 5 }, (_, index) => video(`v-${year}-${index}`, year, index));

const ruleWith = (assets: MemoryPeriodAsset[]) => {
  const assetRepository = { getMemoryAssetsForPeriod: vi.fn().mockResolvedValue(assets) };
  return { rule: new VideoMomentsMemoryRule(assetRepository as never), assetRepository };
};

describe(VideoMomentsMemoryRule.name, () => {
  describe('trigger day gating', () => {
    it('emits nothing and never queries on days 1, 7, 9, 15, 22', async () => {
      for (const day of [1, 7, 9, 15, 22]) {
        const { rule, assetRepository } = ruleWith([]);
        const result = await rule.evaluate({
          ownerId: 'user-1',
          target: DateTime.fromISO(`2026-07-${String(day).padStart(2, '0')}`, { zone: 'utc' }),
        });
        expect(result).toEqual([]);
        expect(assetRepository.getMemoryAssetsForPeriod).not.toHaveBeenCalled();
      }
    });

    it('fires on day 8', async () => {
      const { rule, assetRepository } = ruleWith(workedExampleAssets());
      const result = await rule.evaluate({ ownerId: 'user-1', target });
      expect(result).toHaveLength(1);
      expect(assetRepository.getMemoryAssetsForPeriod).toHaveBeenCalled();
    });
  });

  describe('given the worked example (9 in-band videos, 3 favourites, year 2023)', () => {
    it('fires with the pinned title/subtitle/dedupeKey/visibleForDays/ruleId', async () => {
      const { rule, assetRepository } = ruleWith(workedExampleAssets());
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });

      expect(assetRepository.getMemoryAssetsForPeriod).toHaveBeenCalledWith('user-1', {
        months: [7],
        type: AssetType.Video,
        takenBefore: target.endOf('day').toJSDate(),
      });
      expect(candidate).toMatchObject({
        ruleId: 'video_moments',
        dedupeKey: 'video_moments:2023-07',
        visibleForDays: 5,
        context: { year: 2023, month: 7, count: 9, favoriteCount: 3 },
      });
      expect(candidate.title).toBeUndefined();
      expect(candidate.subtitle).toBeUndefined();
      expect(candidate.assetIds).toHaveLength(8);
    });

    it('computes the worked score: 60 + min(9,15)*2 + min(3,10)*3 + recencyBonus(2023,2026) = 94', async () => {
      const { rule } = ruleWith(workedExampleAssets());
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });
      expect(candidate.score).toBe(94);
    });
  });

  describe('duration band filter', () => {
    it('excludes 2_999ms, 180_001ms and null; includes the 3_000ms and 180_000ms boundaries', async () => {
      const assets: MemoryPeriodAsset[] = [
        video('clear-1', 2023, 0),
        video('boundary-2999', 2023, 1, { duration: 2999 }),
        video('boundary-3000', 2023, 2, { duration: 3000 }),
        video('boundary-180000', 2023, 3, { duration: 180_000 }),
        video('boundary-180001', 2023, 4, { duration: 180_001 }),
        video('boundary-null', 2023, 5, { duration: null }),
        video('clear-2', 2023, 6),
        video('clear-3', 2023, 7),
      ];
      const { rule } = ruleWith(assets);
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });

      expect(candidate.context).toMatchObject({ count: 5 });
      expect(candidate.context).toMatchObject({ count: 5 });
      expect(candidate.assetIds).toEqual(['clear-1', 'boundary-3000', 'boundary-180000', 'clear-2', 'clear-3']);
    });
  });

  describe('the MIN_ASSETS threshold boundary', () => {
    it('skips a year with 2 survivors but includes exactly 3', async () => {
      const two = await ruleWith([video('a', 2023, 0), video('b', 2023, 1)]).rule.evaluate({
        ownerId: 'user-1',
        target,
      });
      expect(two).toEqual([]);

      const three = await ruleWith([video('a', 2023, 0), video('b', 2023, 1), video('c', 2023, 2)]).rule.evaluate({
        ownerId: 'user-1',
        target,
      });
      expect(three).toHaveLength(1);
    });
  });

  describe('given 4 favourites and 10 non-favourites in band', () => {
    it('selects all favourites plus 4 evenly-spaced others, sorted chronologically', async () => {
      const others = Array.from({ length: 10 }, (_, index) => video(`o${index}`, 2023, index));
      const favourites = Array.from({ length: 4 }, (_, index) =>
        video(`f${index}`, 2023, 10 + index, { isFavorite: true }),
      );
      const { rule } = ruleWith([...others, ...favourites]);

      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });

      expect(candidate.assetIds).toEqual(['o0', 'o3', 'o6', 'o9', 'f0', 'f1', 'f2', 'f3']);
    });
  });

  describe('given 12 favourites (exceeding ASSET_CAP)', () => {
    it('selects exactly 8, evenly spaced', async () => {
      const favourites = Array.from({ length: 12 }, (_, index) =>
        video(`f${index}`, 2023, index, { isFavorite: true }),
      );
      const { rule } = ruleWith(favourites);

      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });

      expect(candidate.assetIds).toEqual(['f0', 'f2', 'f3', 'f5', 'f6', 'f8', 'f9', 'f11']);
    });
  });

  describe('the favourite bonus cap', () => {
    it('scores 20 favourites the same as 10 favourites + 10 non-favourites (both count=20)', async () => {
      const allFavourites = Array.from({ length: 20 }, (_, index) =>
        video(`a${index}`, 2024, index, { isFavorite: true }),
      );
      const mixed = [
        ...Array.from({ length: 10 }, (_, index) => video(`m${index}`, 2024, index, { isFavorite: true })),
        ...Array.from({ length: 10 }, (_, index) => video(`n${index}`, 2024, 10 + index)),
      ];

      const [a] = await ruleWith(allFavourites).rule.evaluate({ ownerId: 'user-1', target });
      const [b] = await ruleWith(mixed).rule.evaluate({ ownerId: 'user-1', target });

      // 60 + min(20,15)*2=30 + min(favoriteCount,10)*3=30 + recencyBonus(2024,2026)=8 = 128, in both cases
      expect(a.score).toBe(128);
      expect(b.score).toBe(128);
    });
  });

  describe('given 12 in-band videos (exceeding ASSET_CAP)', () => {
    it('reports the true count in the subtitle while assetIds stays capped at 8', async () => {
      const assets = Array.from({ length: 12 }, (_, index) => video(`v${index}`, 2022, index));
      const [candidate] = await ruleWith(assets).rule.evaluate({ ownerId: 'user-1', target });

      expect(candidate.context).toMatchObject({ count: 12 });
      expect(candidate.assetIds).toHaveLength(8);
    });
  });

  describe('subtitle pluralization', () => {
    // NOTE: MIN_ASSETS = 3 means a year with only 1 in-band survivor never fires (see the
    // MIN_ASSETS boundary case above), so the singular branch of the subtitle ternary is
    // unreachable through evaluate(). We pin the plural form at the MIN_ASSETS boundary (3)
    // and at a higher count (6) to lock down the exact interpolation.
    it('reads "3 videos" at the MIN_ASSETS boundary and "6 videos" at a higher count', async () => {
      const three = await ruleWith([video('a', 2023, 0), video('b', 2023, 1), video('c', 2023, 2)]).rule.evaluate({
        ownerId: 'user-1',
        target,
      });
      expect(three[0].context).toMatchObject({ count: 3 });

      const six = await ruleWith(
        Array.from({ length: 6 }, (_, index) => video(`v${index}`, 2023, index)),
      ).rule.evaluate({
        ownerId: 'user-1',
        target,
      });
      expect(six[0].context).toMatchObject({ count: 6 });
    });
  });

  describe('given qualifying videos in more years than MAX_YEARS', () => {
    it('skips the current year and caps candidates at 3, newest first', async () => {
      const { rule } = ruleWith([
        ...videosForYear(2021),
        ...videosForYear(2022),
        ...videosForYear(2023),
        ...videosForYear(2024),
        ...videosForYear(2026),
      ]);

      const result = await rule.evaluate({ ownerId: 'user-1', target });

      expect(result).toHaveLength(3);
      expect(result.map((c) => c.context?.year)).toEqual([2024, 2023, 2022]);
    });
  });

  describe('repository call', () => {
    it('passes type: AssetType.Video to getMemoryAssetsForPeriod', async () => {
      const { rule, assetRepository } = ruleWith([]);
      await rule.evaluate({ ownerId: 'user-1', target });
      expect(assetRepository.getMemoryAssetsForPeriod).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: AssetType.Video }),
      );
    });
  });

  describe('given zero assets from the repository', () => {
    it('returns [] without throwing', async () => {
      const { rule } = ruleWith([]);
      await expect(rule.evaluate({ ownerId: 'user-1', target })).resolves.toEqual([]);
    });
  });
});
