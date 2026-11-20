import { searchAssets, searchSmart, type MetadataSearchDto, type SmartSearchDto } from '@immich/sdk';

const COLLECT_PAGE_SIZE = 1000;

export type SearchTerms = MetadataSearchDto & Pick<SmartSearchDto, 'query' | 'queryAssetId'>;

export type CollectedSearchAsset = { id: string; ownerId: string };

/**
Pages through the search API for the given filter and returns the id and owner of every matching asset.
Only those two fields are kept — `withExif: false` keeps each page payload minimal.
*/
export const collectSearchResultAssets = async (
  terms: SearchTerms,
  options: { smartSearchEnabled: boolean; language: string },
): Promise<CollectedSearchAsset[]> => {
  const collected: CollectedSearchAsset[] = [];
  let page: number | undefined = 1;

  while (page) {
    // Our pagination fields go last so a filter term can never override them.
    const searchDto: SearchTerms = { ...terms, page, size: COLLECT_PAGE_SIZE, withExif: false };

    const useSmart = ('query' in searchDto || 'queryAssetId' in searchDto) && options.smartSearchEnabled;
    const { assets } = useSmart
      ? await searchSmart({ smartSearchDto: { ...searchDto, language: options.language } })
      : await searchAssets({ metadataSearchDto: searchDto });

    collected.push(...assets.items.map(({ id, ownerId }) => ({ id, ownerId })));

    page = assets.items.length > 0 && assets.nextPage ? Number(assets.nextPage) : undefined;
  }

  return collected;
};
