import { searchAssets, searchSmart, type MetadataSearchDto, type SmartSearchDto } from '@immich/sdk';

const COLLECT_PAGE_SIZE = 1000;

export type SearchTerms = MetadataSearchDto & Pick<SmartSearchDto, 'query' | 'queryAssetId'>;

/**
 * Pages through the search API for the given filter and returns the ids of every matching asset.
 * IDs only — `withExif: false` keeps each page payload minimal.
 */
export const collectSearchResultAssetIds = async (
  terms: SearchTerms,
  options: { smartSearchEnabled: boolean; language: string },
): Promise<string[]> => {
  const ids: string[] = [];
  let page: number | undefined = 1;

  while (page) {
    // Our pagination fields go last so a filter term can never override them.
    const searchDto: SearchTerms = { ...terms, page, size: COLLECT_PAGE_SIZE, withExif: false };

    const useSmart = ('query' in searchDto || 'queryAssetId' in searchDto) && options.smartSearchEnabled;
    const { assets } = useSmart
      ? await searchSmart({ smartSearchDto: { ...searchDto, language: options.language } })
      : await searchAssets({ metadataSearchDto: searchDto });

    ids.push(...assets.items.map((asset) => asset.id));

    page = assets.items.length > 0 && assets.nextPage ? Number(assets.nextPage) : undefined;
  }

  return ids;
};
