import { createAlbum } from '#lib/gallery/album/album-add.ts';
import { applyTakeoutMetadata } from '#lib/gallery/import/takeout-metadata.ts';
import type { ImportOptions } from '#lib/managers/import-manager.svelte.ts';
import { uploadRequest } from '#lib/utils.ts';
import { hashFile } from '#lib/utils/file-uploader.ts';
import type { TakeoutMediaItem } from '#lib/utils/google-takeout-parser.ts';
import {
  AssetMediaStatus,
  AssetUploadAction,
  checkBulkUpload,
  getBaseUrl,
  type AssetMediaResponseDto,
} from '@immich/sdk';

export interface UploadResult {
  assetId: string;
  status: 'imported' | 'duplicate' | 'error';
  error?: string;
}

export async function uploadTakeoutItem(item: TakeoutMediaItem, options: ImportOptions): Promise<UploadResult> {
  let assetId = '';
  try {
    const fileCreatedAt = item.metadata?.dateTaken
      ? item.metadata.dateTaken.toISOString()
      : new Date(item.lastModified).toISOString();
    const file = await item.getFile();

    // Duplicate check
    if (options.skipDuplicates) {
      try {
        const checksum = await hashFile(file);
        const {
          results: [checkResult],
        } = await checkBulkUpload({
          assetBulkUploadCheckDto: { assets: [{ id: item.name, checksum }] },
        });
        if (checkResult.action === AssetUploadAction.Reject && checkResult.assetId) {
          assetId = checkResult.assetId;
        }
      } catch (error) {
        console.error('Error checking duplicate', error);
      }
      if (assetId) {
        await applyTakeoutMetadata(assetId, item, options, true);
        return { assetId, status: 'duplicate' };
      }
    }

    // Build FormData
    const formData = new FormData();
    formData.append('fileCreatedAt', fileCreatedAt);
    formData.append('fileModifiedAt', fileCreatedAt);
    formData.append('isFavorite', String(options.importFavorites && item.metadata?.isFavorite === true));
    // Do not send `duration`: upstream #28003 changed the server DTO to a numeric (ms) field
    // (z.coerce.number().int()), which rejects the old "0:00:00.000000" string as NaN -> 400.
    // The canonical file-uploader omits duration entirely; the server probes it during processing.
    formData.append('assetData', new File([file], item.name, { lastModified: item.lastModified }));

    // Upload
    const response = await uploadRequest<AssetMediaResponseDto>({
      url: getBaseUrl() + '/assets',
      data: formData,
    });

    assetId = response.data.id;
    const isDuplicate = response.data.status === AssetMediaStatus.Duplicate;
    await applyTakeoutMetadata(assetId, item, options, isDuplicate);
    return { assetId, status: isDuplicate ? 'duplicate' : 'imported' };
  } catch (error) {
    return {
      assetId,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function createImportAlbums(
  items: TakeoutMediaItem[],
  assetIdMap: Map<string, string>,
  selectedAlbums: Set<string>,
): Promise<number> {
  // Group items by albumName
  const albumItemsMap = new Map<string, string[]>();
  for (const item of items) {
    if (!item.albumName) {
      continue;
    }
    const assetId = assetIdMap.get(item.path);
    if (!assetId) {
      continue;
    }
    const existing = albumItemsMap.get(item.albumName);
    if (existing) {
      existing.push(assetId);
    } else {
      albumItemsMap.set(item.albumName, [assetId]);
    }
  }

  let created = 0;
  for (const [albumName, assetIds] of albumItemsMap) {
    if (!selectedAlbums.has(albumName)) {
      continue;
    }
    try {
      await createAlbum(albumName, assetIds);
      created++;
    } catch (error) {
      console.error(`Failed to create album "${albumName}":`, error);
    }
  }

  return created;
}
