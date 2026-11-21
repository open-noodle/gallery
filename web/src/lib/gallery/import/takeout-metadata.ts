import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import type { ImportOptions } from '#lib/managers/import-manager.svelte.ts';
import type { TakeoutMediaItem } from '#lib/utils/google-takeout-parser.ts';
import { AssetVisibility, getBaseUrl, updateAsset, type UpdateAssetDto } from '@immich/sdk';

// Only ids are persisted, never the sidecar's descriptions or coordinates. Keep an in-memory
// fallback when the browser blocks storage; those retries survive only in the current page.
const pending = new Set<string>();

function hasPendingMetadata(key: string): boolean {
  try {
    return pending.has(key) || localStorage.getItem(key) === 'pending';
  } catch {
    return pending.has(key);
  }
}

function setPendingMetadata(key: string, value: boolean): void {
  if (value) {
    pending.add(key);
  } else {
    pending.delete(key);
  }
  try {
    if (value) {
      localStorage.setItem(key, 'pending');
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Uploading still works when storage is unavailable.
  }
}

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
  if (isDuplicate && !hasPendingMetadata(key)) {
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
    setPendingMetadata(key, true);
    await updateAsset({ id: assetId, updateAssetDto: updateDto });
  }
  setPendingMetadata(key, false);
}
