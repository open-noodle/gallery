import type { AssetResponseDto } from '@immich/sdk';
import type { AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { toTimelineAsset } from '$lib/utils/timeline-util';

/**
 * Bulk-action helpers for the smart search results grid (discussion #908).
 *
 * The multi-select toolbars on /photos, /recently-added and /spaces/[id] normally mutate the
 * page's `TimelineManager`. That manager isn't mounted while search results are showing — the
 * results are a plain `AssetResponseDto[]` owned by `smart-search-results.svelte` — so the
 * toolbars route through these helpers instead. All of them mutate the array in place, which
 * is reactive because the host pages hold it in `$state`.
 */

/** Selects every loaded result. Mirrors `selectAllAssets`, minus the timeline paging. */
export const selectAllSearchResults = (results: AssetResponseDto[], assetInteraction: AssetMultiSelectManager) => {
  assetInteraction.selectAll = true;
  assetInteraction.selectAssets(results.map((asset) => toTimelineAsset(asset)));
};

/** Drops assets from the results — for deletes, archives and visibility changes. */
export const removeSearchResults = (results: AssetResponseDto[], assetIds: string[]) => {
  const ids = new Set(assetIds);
  for (let index = results.length - 1; index >= 0; index--) {
    if (ids.has(results[index].id)) {
      results.splice(index, 1);
    }
  }
};

/** Applies an in-place edit to the matching results — for favorite/archive toggles. */
export const updateSearchResults = (
  results: AssetResponseDto[],
  assetIds: string[],
  update: (asset: AssetResponseDto) => void,
) => {
  const ids = new Set(assetIds);
  for (const asset of results) {
    if (ids.has(asset.id)) {
      update(asset);
    }
  }
};
