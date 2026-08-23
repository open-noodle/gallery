import { SystemConfig } from 'src/dtos/config.dto';
import { AssetType, AssetVisibility } from 'src/enum';
import { MemoryThemeSearchAdapter, SEARCH_WINDOW_MARGIN_DAYS } from 'src/services/memory-rules/theme-search.adapter';

const buildConfig = (
  overrides: {
    machineLearningEnabled?: boolean;
    clipEnabled?: boolean;
    modelName?: string;
    themeMaxDistance?: number;
  } = {},
): SystemConfig =>
  ({
    machineLearning: {
      enabled: overrides.machineLearningEnabled ?? true,
      clip: {
        enabled: overrides.clipEnabled ?? true,
        modelName: overrides.modelName ?? 'ViT-B-32__openai',
      },
    },
    memories: {
      themeMaxDistance: overrides.themeMaxDistance ?? 0.75,
    },
  }) as SystemConfig;

const buildAdapter = (config: SystemConfig = buildConfig()) => {
  const machineLearningRepository = { encodeText: vi.fn().mockResolvedValue('embedding-string') };
  const searchRepository = { searchSmart: vi.fn().mockResolvedValue({ items: [], hasNextPage: false }) };
  const getConfig = vi.fn().mockResolvedValue(config);
  const logger = { warn: vi.fn() };
  const adapter = new MemoryThemeSearchAdapter(
    machineLearningRepository as never,
    searchRepository as never,
    getConfig,
    logger as never,
  );
  return { adapter, machineLearningRepository, searchRepository, getConfig, logger };
};

describe(MemoryThemeSearchAdapter.name, () => {
  describe('resolveEmbedding', () => {
    it('returns null and never calls encodeText when machine learning is disabled', async () => {
      const { adapter, machineLearningRepository } = buildAdapter(buildConfig({ machineLearningEnabled: false }));

      await expect(adapter.resolveEmbedding('sunset', 'a beautiful sunset')).resolves.toBeNull();
      expect(machineLearningRepository.encodeText).not.toHaveBeenCalled();
    });

    it('returns null and never calls encodeText when clip is disabled', async () => {
      const { adapter, machineLearningRepository } = buildAdapter(buildConfig({ clipEnabled: false }));

      await expect(adapter.resolveEmbedding('sunset', 'a beautiful sunset')).resolves.toBeNull();
      expect(machineLearningRepository.encodeText).not.toHaveBeenCalled();
    });

    it('calls encodeText once for two identical (modelName, language, themeKey) requests, the second a cache hit', async () => {
      const { adapter, machineLearningRepository } = buildAdapter();

      const first = await adapter.resolveEmbedding('sunset', 'a beautiful sunset');
      const second = await adapter.resolveEmbedding('sunset', 'a beautiful sunset');

      expect(machineLearningRepository.encodeText).toHaveBeenCalledTimes(1);
      expect(first).toBe('embedding-string');
      expect(second).toBe('embedding-string');
    });

    it('calls encodeText again when clip.modelName changes between calls', async () => {
      const machineLearningRepository = { encodeText: vi.fn().mockResolvedValue('embedding-string') };
      const searchRepository = { searchSmart: vi.fn() };
      const getConfig = vi
        .fn()
        .mockResolvedValueOnce(buildConfig({ modelName: 'model-a' }))
        .mockResolvedValueOnce(buildConfig({ modelName: 'model-b' }));
      const logger = { warn: vi.fn() };
      const adapter = new MemoryThemeSearchAdapter(
        machineLearningRepository as never,
        searchRepository as never,
        getConfig,
        logger as never,
      );

      await adapter.resolveEmbedding('sunset', 'a beautiful sunset');
      await adapter.resolveEmbedding('sunset', 'a beautiful sunset');

      expect(machineLearningRepository.encodeText).toHaveBeenCalledTimes(2);
    });

    it('calls encodeText again when language changes between calls (cache key includes language)', async () => {
      const { adapter, machineLearningRepository } = buildAdapter(buildConfig({ modelName: 'model-a' }));

      // Seed the cache as if a prior call had been made for the same model/theme but under a
      // different language. If the cache key omitted language, this seeded entry would collide
      // with the real call below and encodeText would incorrectly be skipped (a stale-language
      // cache hit).
      (adapter as unknown as { cache: Map<string, string> }).cache.set('model-a:fr:sunset', 'stale-fr-embedding');

      const result = await adapter.resolveEmbedding('sunset', 'a beautiful sunset');

      expect(machineLearningRepository.encodeText).toHaveBeenCalledTimes(1);
      expect(result).toBe('embedding-string');
      expect(result).not.toBe('stale-fr-embedding');
    });

    it('returns null and does not throw when encodeText rejects', async () => {
      const machineLearningRepository = { encodeText: vi.fn().mockRejectedValue(new Error('ml down')) };
      const searchRepository = { searchSmart: vi.fn() };
      const getConfig = vi.fn().mockResolvedValue(buildConfig());
      const logger = { warn: vi.fn() };
      const adapter = new MemoryThemeSearchAdapter(
        machineLearningRepository as never,
        searchRepository as never,
        getConfig,
        logger as never,
      );

      await expect(adapter.resolveEmbedding('sunset', 'a beautiful sunset')).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('searchByEmbedding', () => {
    it('forwards to searchSmart with the expected options and a 2-day-widened window', async () => {
      const { adapter, searchRepository } = buildAdapter(buildConfig({ themeMaxDistance: 0.75 }));

      const takenAfter = new Date('2023-01-01T00:00:00.000Z');
      const takenBefore = new Date('2023-12-31T23:59:59.999Z');

      await adapter.searchByEmbedding({
        ownerId: 'owner-1',
        embedding: 'embedding-string',
        takenAfter,
        takenBefore,
        size: 40,
      });

      expect(SEARCH_WINDOW_MARGIN_DAYS).toBe(2);
      expect(searchRepository.searchSmart).toHaveBeenCalledTimes(1);
      expect(searchRepository.searchSmart).toHaveBeenCalledWith(
        { page: 1, size: 40 },
        {
          embedding: 'embedding-string',
          userIds: ['owner-1'],
          type: AssetType.Image,
          visibility: AssetVisibility.Timeline,
          maxDistance: 0.75,
          takenAfter: new Date('2022-12-30T00:00:00.000Z'),
          takenBefore: new Date('2024-01-02T23:59:59.999Z'),
        },
      );
    });

    it('maps searchSmart rows to { id, localDateTime } only', async () => {
      const localDateTime = new Date('2023-06-15T12:00:00.000Z');
      const { adapter, searchRepository } = buildAdapter();
      searchRepository.searchSmart.mockResolvedValue({
        items: [{ id: 'asset-1', localDateTime, ownerId: 'owner-1', type: AssetType.Image, extraField: 'ignored' }],
        hasNextPage: false,
      });

      const result = await adapter.searchByEmbedding({
        ownerId: 'owner-1',
        embedding: 'embedding-string',
        takenAfter: new Date('2023-01-01T00:00:00.000Z'),
        takenBefore: new Date('2023-12-31T23:59:59.999Z'),
        size: 40,
      });

      expect(result).toEqual([{ id: 'asset-1', localDateTime }]);
    });
  });
});
