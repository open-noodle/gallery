import { DateTime } from 'luxon';
import { ThemeSearchAsset, ThemeSearchPort } from 'src/services/memory-rules/theme-search.port';
import { ASSET_CAP, FETCH_SIZE, MAX_YEARS_BACK, ThemedMemoryRule } from 'src/services/memory-rules/themed.rule';

const target = DateTime.fromISO('2026-07-22', { zone: 'utc' });

const asset = (id: string, year: number, month: number, day: number, hour = 0): ThemeSearchAsset => ({
  id,
  localDateTime: DateTime.utc(year, month, day, hour).toJSDate(),
});

/** `count` assets spread by hour within a single day of `year`, chronological by index. */
const yearAssets = (year: number, count: number, prefix = 'a'): ThemeSearchAsset[] =>
  Array.from({ length: count }, (_, index) => asset(`${prefix}-${year}-${index}`, year, 6, 1, index));

interface FakePort {
  resolveEmbedding: ReturnType<typeof vi.fn>;
  searchByEmbedding: ReturnType<typeof vi.fn>;
}

/**
 * `assetsByYear` keys off the calendar year the rule is querying for (derived from the widened
 * `takenAfter` bound the rule passes), mirroring the real adapter: a single call for year `Y` can
 * return assets whose own `localDateTime` spills into `Y-1`/`Y+1` (§3.4.1 widened-window skew).
 */
const ruleWith = (
  assetsByYear: Record<number, ThemeSearchAsset[]> = {},
  options: { embedding?: string | null; rejectEmbedding?: boolean } = {},
): { rule: ThemedMemoryRule; port: FakePort } => {
  const resolveEmbedding = options.rejectEmbedding
    ? vi.fn().mockRejectedValue(new Error('encode failed'))
    : vi.fn().mockResolvedValue(options.embedding === undefined ? 'embedding-string' : options.embedding);
  const searchByEmbedding = vi
    .fn()
    .mockImplementation(({ takenAfter }: { takenAfter: Date }) =>
      Promise.resolve(assetsByYear[takenAfter.getUTCFullYear()] ?? []),
    );
  const port: FakePort = { resolveEmbedding, searchByEmbedding };
  return { rule: new ThemedMemoryRule(port as unknown as ThemeSearchPort), port };
};

describe(ThemedMemoryRule.name, () => {
  describe('trigger day gating', () => {
    it('emits nothing and never resolves an embedding on days 1, 8, 15, 21, 23', async () => {
      for (const day of [1, 8, 15, 21, 23]) {
        const { rule, port } = ruleWith();
        const result = await rule.evaluate({
          ownerId: 'user-1',
          target: DateTime.fromISO(`2026-07-${String(day).padStart(2, '0')}`, { zone: 'utc' }),
        });
        expect(result).toEqual([]);
        expect(port.resolveEmbedding).not.toHaveBeenCalled();
      }
    });

    it('fires on day 22, resolving the sunset theme embedding for July', async () => {
      const { rule, port } = ruleWith({ 2023: yearAssets(2023, 18) });
      const result = await rule.evaluate({ ownerId: 'user-1', target });
      expect(result).toHaveLength(1);
      expect(port.resolveEmbedding).toHaveBeenCalledWith('sunset', 'a beautiful sunset');
    });
  });

  describe('given 18 qualifying assets in 2023 (theme sunset, target 2026-07-22)', () => {
    it('fires with the pinned dedupeKey/score/visibleForDays/ruleId and no baked-in English', async () => {
      const { rule } = ruleWith({ 2023: yearAssets(2023, 18) });
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });

      expect(candidate).toMatchObject({
        ruleId: 'themed',
        dedupeKey: 'themed:sunset:2023',
        visibleForDays: 5,
        context: { year: 2023, theme: 'sunset', count: 18 },
      });
      // SCORE_BASE(70) + min(18,25) + recencyBonus(2023,2026)=max(0,10-3)=7 => 95
      expect(candidate.score).toBe(95);
      expect(candidate.title).toBeUndefined();
      expect(candidate.subtitle).toBeUndefined();
      expect(candidate.assetIds).toHaveLength(16);
    });
  });

  describe('disabled path', () => {
    it('returns [] and never calls searchByEmbedding when resolveEmbedding resolves null', async () => {
      const { rule, port } = ruleWith({}, { embedding: null });
      const result = await rule.evaluate({ ownerId: 'user-1', target });
      expect(result).toEqual([]);
      expect(port.searchByEmbedding).not.toHaveBeenCalled();
    });
  });

  describe('embedding resolution failure', () => {
    it('swallows a resolveEmbedding rejection, returning [] without throwing', async () => {
      const { rule, port } = ruleWith({}, { rejectEmbedding: true });
      await expect(rule.evaluate({ ownerId: 'user-1', target })).resolves.toEqual([]);
      expect(port.searchByEmbedding).not.toHaveBeenCalled();
    });
  });

  describe('year filter (§3.4.1: takenAfter/takenBefore hit fileCreatedAt, not localDateTime)', () => {
    it('counts only in-year assets when a single call returns Y-1/Y/Y+1', async () => {
      const raw = [
        ...yearAssets(2022, 3, 'prev'), // Y-1, widened-window spillover
        ...yearAssets(2023, 10, 'cur'), // Y
        ...yearAssets(2024, 2, 'next'), // Y+1, widened-window spillover
      ];
      const { rule } = ruleWith({ 2023: raw });
      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });

      expect(candidate.context).toMatchObject({ year: 2023, count: 10 });
      expect(candidate.context).toMatchObject({ count: 10 });
    });

    it('does not fire when 8 raw assets for the year include only 7 in-year (MIN_ASSETS applied after filtering)', async () => {
      const raw = [...yearAssets(2023, 7, 'cur'), ...yearAssets(2024, 1, 'next')];
      const { rule } = ruleWith({ 2023: raw });
      const result = await rule.evaluate({ ownerId: 'user-1', target });
      expect(result).toEqual([]);
    });
  });

  describe('the MIN_ASSETS threshold boundary', () => {
    it('skips a year with 7 in-year assets but fires with exactly 8', async () => {
      const seven = await ruleWith({ 2023: yearAssets(2023, 7) }).rule.evaluate({ ownerId: 'user-1', target });
      expect(seven).toEqual([]);

      const eight = await ruleWith({ 2023: yearAssets(2023, 8) }).rule.evaluate({ ownerId: 'user-1', target });
      expect(eight).toHaveLength(1);
    });
  });

  describe('search window', () => {
    it('searches exactly MAX_YEARS_BACK years, newest first, and never the current year', async () => {
      const { rule, port } = ruleWith();
      await rule.evaluate({ ownerId: 'user-1', target });

      expect(port.searchByEmbedding).toHaveBeenCalledTimes(MAX_YEARS_BACK);
      expect(port.searchByEmbedding).toHaveBeenNthCalledWith(1, {
        ownerId: 'user-1',
        embedding: 'embedding-string',
        takenAfter: new Date('2025-01-01T00:00:00.000Z'),
        takenBefore: new Date('2025-12-31T23:59:59.999Z'),
        size: FETCH_SIZE,
      });
      expect(port.searchByEmbedding).toHaveBeenNthCalledWith(2, {
        ownerId: 'user-1',
        embedding: 'embedding-string',
        takenAfter: new Date('2024-01-01T00:00:00.000Z'),
        takenBefore: new Date('2024-12-31T23:59:59.999Z'),
        size: FETCH_SIZE,
      });
      expect(port.searchByEmbedding).toHaveBeenNthCalledWith(3, {
        ownerId: 'user-1',
        embedding: 'embedding-string',
        takenAfter: new Date('2023-01-01T00:00:00.000Z'),
        takenBefore: new Date('2023-12-31T23:59:59.999Z'),
        size: FETCH_SIZE,
      });
    });
  });

  describe('bounds passed to the port', () => {
    it('passes size: FETCH_SIZE and native Date bounds (not Luxon DateTime)', async () => {
      const { rule, port } = ruleWith();
      await rule.evaluate({ ownerId: 'user-1', target });

      const firstCallArgs = port.searchByEmbedding.mock.calls[0]![0] as {
        size: number;
        takenAfter: Date;
        takenBefore: Date;
      };
      expect(firstCallArgs.size).toBe(FETCH_SIZE);
      expect(firstCallArgs.takenAfter).toBeInstanceOf(Date);
      expect(firstCallArgs.takenBefore).toBeInstanceOf(Date);
      expect(firstCallArgs.takenAfter.constructor.name).toBe('Date');
    });
  });

  describe('multi-year emission (regression guard: hasRuleMemory dedup happens in the engine, after the rule returns)', () => {
    it('returns candidates for BOTH qualifying years, sorted by score desc', async () => {
      const { rule } = ruleWith({ 2025: yearAssets(2025, 10, 'y25'), 2023: yearAssets(2023, 20, 'y23') });
      const result = await rule.evaluate({ ownerId: 'user-1', target });

      expect(result).toHaveLength(2);
      expect(result.map((candidate) => candidate.context?.year)).toEqual([2023, 2025]);
      expect(result.map((candidate) => candidate.dedupeKey)).toEqual(['themed:sunset:2023', 'themed:sunset:2025']);
      // 2023: 70 + min(20,25) + recencyBonus(2023,2026)=7 => 97
      // 2025: 70 + min(10,25) + recencyBonus(2025,2026)=9 => 89
      expect(result[0]!.score).toBe(97);
      expect(result[1]!.score).toBe(89);
    });
  });

  describe('non-tautological ordering (assetIds must not just echo the similarity order)', () => {
    it('returns assetIds in chronological order, evenly sampled and capped at ASSET_CAP', async () => {
      const chronological = Array.from({ length: 17 }, (_, index) => asset(`a${index}`, 2023, 6, 1, index));
      const similarityOrder = chronological.toReversed(); // deliberately NOT chronological
      const { rule } = ruleWith({ 2023: similarityOrder });

      const [candidate] = await rule.evaluate({ ownerId: 'user-1', target });

      expect(ASSET_CAP).toBe(16);
      expect(candidate.assetIds).toEqual([
        'a0',
        'a1',
        'a2',
        'a3',
        'a4',
        'a5',
        'a6',
        'a7',
        'a9',
        'a10',
        'a11',
        'a12',
        'a13',
        'a14',
        'a15',
        'a16',
      ]);
    });
  });

  describe('given zero assets from the port across all years', () => {
    it('returns [] without throwing', async () => {
      const { rule } = ruleWith({});
      await expect(rule.evaluate({ ownerId: 'user-1', target })).resolves.toEqual([]);
    });
  });
});
