import type { TagBulkAssetsResponseDto } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';

/**
Toast the outcome of `PUT /tags/assets` truthfully (specs/2026-11-27-bulk-tag-feedback-design.md). The
server answers 200 even when it skipped requested tags or assets, so the toast reports tagged assets, assets not
tagged and tags that could not be added separately, and its severity follows those counts: success only when
nothing was skipped, info when something was tagged and something skipped, warning when nothing was tagged. A
response without `taggedAssetIds` (a server that predates the field) keeps upstream's toast.
Used by `handleTagAssets` (`$lib/services/asset.service.ts`) in place of its own toast.
*/
export const notifyTagAssets = ($t: MessageFormatter, assetIds: string[], response: TagBulkAssetsResponseDto) => {
  if (!response.taggedAssetIds) {
    toastManager.primary($t('tagged_assets', { values: { count: response.count } }));
    return;
  }

  const tagged = response.taggedAssetIds.length;
  // Covers both assets the caller may not tag and every asset of a request whose tags were all skipped.
  const skipped = new Set(assetIds).size - tagged;
  const tags = response.skippedTagIds?.length ?? 0;

  if (skipped === 0 && tags === 0) {
    toastManager.primary($t('tagged_assets', { values: { count: tagged } }));
    return;
  }

  let description: string;
  if (tags === 0) {
    description = $t('tagged_assets_with_skipped', { values: { tagged, skipped } });
  } else if (skipped === 0) {
    description = $t('tagged_assets_with_skipped_tags', { values: { tagged, tags } });
  } else {
    description = $t('tagged_assets_with_skipped_assets_and_tags', { values: { tagged, skipped, tags } });
  }

  if (tagged > 0) {
    toastManager.info(description);
  } else {
    toastManager.warning(description);
  }
};
