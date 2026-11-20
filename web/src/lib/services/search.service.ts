import {
  searchAssets,
  searchSmart,
  type AssetResponseDto,
  type MetadataSearchDto,
  type SmartSearchDto,
} from '@immich/sdk';

const COLLECT_PAGE_SIZE = 1000;

export type SearchTerms = MetadataSearchDto & Pick<SmartSearchDto, 'query' | 'queryAssetId'>;

export type CollectedSearchAsset = Pick<AssetResponseDto, 'id' | 'ownerId' | 'visibility'>;

/**
Pages through the search API for the given filter and returns the id, owner and visibility of every matching
asset: what a caller needs to tell which of them a space accepts (see `resolveSpaceShareableAssetIds`). Only those
fields are kept; `withExif: false` keeps each page payload minimal.
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

    collected.push(...assets.items.map(({ id, ownerId, visibility }) => ({ id, ownerId, visibility })));

    page = assets.items.length > 0 && assets.nextPage ? Number(assets.nextPage) : undefined;
  }

  return collected;
};
