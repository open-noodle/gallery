import { SystemConfig } from 'src/dtos/config.dto';
import { AssetType, AssetVisibility } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { ThemeSearchAsset, ThemeSearchPort } from 'src/services/memory-rules/theme-search.port';
import { isSmartSearchEnabled } from 'src/utils/misc';

/**
 * `searchAssetBuilder` filters `takenAfter`/`takenBefore` against `asset.fileCreatedAt`
 * (`src/utils/database.ts:725-726`), not `localDateTime`, which every memory rule buckets by.
 * Widening the search window by this many days on each side ensures no in-year asset is missed
 * by that skew; the calling rule then filters the results to the exact year by `localDateTime`.
 */
export const SEARCH_WINDOW_MARGIN_DAYS = 2;
const SEARCH_WINDOW_MARGIN_MS = SEARCH_WINDOW_MARGIN_DAYS * 24 * 60 * 60 * 1000;

/** `ThemeSearchPort` backed by real CLIP text encoding + smart search. Memoizes embeddings. */
export class MemoryThemeSearchAdapter implements ThemeSearchPort {
  private readonly cache = new Map<string, string>();

  constructor(
    private machineLearningRepository: Pick<MachineLearningRepository, 'encodeText'>,
    private searchRepository: Pick<SearchRepository, 'searchSmart'>,
    private getConfig: () => Promise<SystemConfig>,
    private logger: Pick<LoggingRepository, 'warn'>,
  ) {}

  async resolveEmbedding(themeKey: string, query: string): Promise<string | null> {
    const config = await this.getConfig();
    if (!isSmartSearchEnabled(config.machineLearning)) {
      return null;
    }

    const { modelName } = config.machineLearning.clip;
    // No caller passes a language in this batch (model default). Still included in the cache
    // key so a future non-English deployment cannot serve a stale English embedding.
    const language: string | undefined = undefined;
    const cacheKey = `${modelName}:${language ?? 'default'}:${themeKey}`;

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const embedding = await this.machineLearningRepository.encodeText(query, { modelName, language });
      this.cache.set(cacheKey, embedding);
      return embedding;
    } catch (error) {
      this.logger.warn(
        `Failed to resolve theme embedding for "${themeKey}": ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  async searchByEmbedding({
    ownerId,
    embedding,
    takenAfter,
    takenBefore,
    size,
  }: {
    ownerId: string;
    embedding: string;
    takenAfter: Date;
    takenBefore: Date;
    size: number;
  }): Promise<ThemeSearchAsset[]> {
    const config = await this.getConfig();
    const widenedAfter = new Date(takenAfter.getTime() - SEARCH_WINDOW_MARGIN_MS);
    const widenedBefore = new Date(takenBefore.getTime() + SEARCH_WINDOW_MARGIN_MS);

    const { items } = await this.searchRepository.searchSmart(
      { page: 1, size },
      {
        embedding,
        userIds: [ownerId],
        takenAfter: widenedAfter,
        takenBefore: widenedBefore,
        type: AssetType.Image,
        visibility: AssetVisibility.Timeline,
        maxDistance: config.memories.themeMaxDistance,
      },
    );

    return items.map(({ id, localDateTime }) => ({ id, localDateTime }));
  }
}
