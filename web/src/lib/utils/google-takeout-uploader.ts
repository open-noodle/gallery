import {
  AssetMediaStatus,
  AssetUploadAction,
  AssetVisibility,
  checkBulkUpload,
  getBaseUrl,
  updateAsset,
  type AssetMediaResponseDto,
} from '@immich/sdk';
import type { ImportOptions } from '$lib/managers/import-manager.svelte';
import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
import { uploadRequest } from '$lib/utils';
import { createAlbum } from '$lib/utils/album-utils';
import { shouldUploadChunked, uploadFileChunked } from '$lib/utils/chunked-upload';
import type { TakeoutMediaItem } from '$lib/utils/google-takeout-parser';

export interface UploadResult {
  assetId: string;
  status: 'imported' | 'duplicate' | 'error';
  error?: string;
}

async function computeSha1(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function uploadTakeoutItem(item: TakeoutMediaItem, options: ImportOptions): Promise<UploadResult> {
  try {
    const fileCreatedAt = item.metadata?.dateTaken
      ? item.metadata.dateTaken.toISOString()
      : new Date(item.lastModified).toISOString();
    const file = await item.getFile();
    const isFavorite = options.importFavorites && item.metadata?.isFavorite === true;

    // Checksum, used both for the single-shot duplicate-check shortcut below and (for a chunked
    // upload) as the create call's checksum, so the server-side duplicate shortcut covers large
    // takeout items too.
    let checksum: string | undefined;
    if (options.skipDuplicates && crypto?.subtle) {
      try {
        checksum = await computeSha1(file);
      } catch (error) {
        console.error('Error hashing file for duplicate check', error);
      }
    }

    const uploadChunkSize = serverConfigManager.value.uploadChunkSize;
    let assetMedia: AssetMediaResponseDto;

    if (shouldUploadChunked(file.size, uploadChunkSize)) {
      assetMedia = await uploadFileChunked({
        file,
        chunkSize: uploadChunkSize,
        checksum,
        filename: item.name,
        fileCreatedAt,
        fileModifiedAt: fileCreatedAt,
        isFavorite,
      });
    } else {
      if (checksum) {
        try {
          const {
            results: [checkResult],
          } = await checkBulkUpload({
            assetBulkUploadCheckDto: { assets: [{ id: item.name, checksum }] },
          });
          if (checkResult.action === AssetUploadAction.Reject && checkResult.assetId) {
            return { assetId: checkResult.assetId, status: 'duplicate' };
          }
        } catch (error) {
          console.error('Error checking duplicate', error);
        }
      }

      // Build FormData
      const formData = new FormData();
      formData.append('fileCreatedAt', fileCreatedAt);
      formData.append('fileModifiedAt', fileCreatedAt);
      formData.append('isFavorite', String(isFavorite));
      // Do not send `duration`: upstream #28003 changed the server DTO to a numeric (ms) field
      // (z.coerce.number().int()), which rejects the old "0:00:00.000000" string as NaN -> 400.
      // The canonical file-uploader omits duration entirely; the server probes it during processing.
      formData.append('assetData', new File([file], item.name, { lastModified: item.lastModified }));

      // Upload
      const response = await uploadRequest<AssetMediaResponseDto>({
        url: getBaseUrl() + '/assets',
        data: formData,
      });

      assetMedia = response.data;
    }

    const assetId = assetMedia.id;

    if (assetMedia.status === AssetMediaStatus.Duplicate) {
      return { assetId, status: 'duplicate' };
    }

    // Post-upload metadata update
    const updateDto: Record<string, unknown> = {};

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
      await updateAsset({ id: assetId, updateAssetDto: updateDto });
    }

    return { assetId, status: 'imported' };
  } catch (error) {
    return {
      assetId: '',
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
