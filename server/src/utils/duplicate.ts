import { AssetResponseDto } from 'src/dtos/asset-response.dto';

/**
 * Counts all truthy values in the exifInfo object.
 * This matches the client implementation in web/src/lib/utils/exif-utils.ts
 *
 * @param asset Asset with optional exifInfo
 * @returns Count of truthy EXIF values
 */
export const getExifCount = (asset: AssetResponseDto): number => {
  return Object.values(asset.exifInfo ?? {}).filter(Boolean).length;
};

export interface DuplicateMetadataAccessors<T> {
  getFileSizeInByte: (asset: T) => number | null | undefined;
  getExifCount: (asset: T) => number | null | undefined;
}

export const suggestDuplicateByMetadata = <T>(
  assets: T[],
  { getFileSizeInByte, getExifCount }: DuplicateMetadataAccessors<T>,
): T | undefined => {
  if (assets.length === 0) {
    return undefined;
  }

  let duplicateAssets = [...assets].toSorted((a, b) => (getFileSizeInByte(a) ?? 0) - (getFileSizeInByte(b) ?? 0));
  const largestFileSize = getFileSizeInByte(duplicateAssets.at(-1)!) ?? 0;
  duplicateAssets = duplicateAssets.filter((asset) => (getFileSizeInByte(asset) ?? 0) === largestFileSize);

  if (duplicateAssets.length >= 2) {
    duplicateAssets = duplicateAssets.toSorted((a, b) => (getExifCount(a) ?? 0) - (getExifCount(b) ?? 0));
  }

  return duplicateAssets.at(-1);
};

/**
 * Suggests the best duplicate asset to keep from a list of duplicates.
 * This is a direct port of the client logic from web/src/lib/utils/duplicate-utils.ts
 *
 * The best asset is determined by the following criteria:
 *  1. Largest image file size in bytes
 *  2. Largest count of EXIF data (as tie-breaker)
 *
 * @param assets List of duplicate assets
 * @returns The best asset to keep, or undefined if empty list
 */
export const suggestDuplicate = (assets: AssetResponseDto[]): AssetResponseDto | undefined => {
  return suggestDuplicateByMetadata(assets, {
    getFileSizeInByte: (asset) => asset.exifInfo?.fileSizeInByte,
    getExifCount,
  });
};

/**
 * Suggests the best duplicate asset IDs to keep from a list of duplicates.
 * Returns an array with a single asset ID (the best candidate), or empty if no assets.
 *
 * @param assets List of duplicate assets
 * @returns Array of suggested asset IDs to keep (0 or 1 element)
 */
export const suggestDuplicateKeepAssetIds = (assets: AssetResponseDto[]): string[] => {
  const suggested = suggestDuplicate(assets);
  return suggested ? [suggested.id] : [];
};
