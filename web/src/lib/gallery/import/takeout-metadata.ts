import { takeoutMetadataManager } from '#lib/gallery/managers/takeout-metadata-manager.svelte.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import type { ImportOptions } from '#lib/managers/import-manager.svelte.ts';
import type { TakeoutMediaItem } from '#lib/utils/google-takeout-parser.ts';
import { AssetVisibility, getBaseUrl, updateAsset, type UpdateAssetDto } from '@immich/sdk';

/** Finish this import's metadata work without changing ordinary pre-existing duplicates. */
export async function applyTakeoutMetadata(
  assetId: string,
  item: TakeoutMediaItem,
  options: ImportOptions,
  isDuplicate: boolean,
): Promise<void> {
  if (!item.metadata) {
    return;
  }
  const key = `gallery:takeout-metadata:${JSON.stringify([getBaseUrl(), authManager.user.id, assetId])}`;
  if (isDuplicate && !takeoutMetadataManager.hasPending(key)) {
    return;
  }

  const updateDto: UpdateAssetDto = {};
  if (item.metadata?.latitude !== undefined && item.metadata?.longitude !== undefined) {
    updateDto.latitude = item.metadata.latitude;
    updateDto.longitude = item.metadata.longitude;
  }
  if (options.importDescriptions && item.metadata?.description) {
    updateDto.description = item.metadata.description;
  }
  if (options.importArchived && item.metadata?.isArchived) {
    updateDto.visibility = AssetVisibility.Archive;
  }
  if (item.metadata?.dateTaken) {
    updateDto.dateTimeOriginal = item.metadata.dateTaken.toISOString();
  }

  if (Object.keys(updateDto).length > 0) {
    // Record before awaiting: a failed/ambiguous response must remain retryable, including
    // after a reload. Only clear the marker once the metadata write succeeds.
    takeoutMetadataManager.setPending(key, true);
    await updateAsset({ id: assetId, updateAssetDto: updateDto });
  }
  takeoutMetadataManager.setPending(key, false);
}
