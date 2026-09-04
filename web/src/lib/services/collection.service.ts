import { toastManager } from '@immich/ui';
import {
  isHiddenFromMyTimeline,
  type PickerCollection,
} from '$lib/components/shared-components/collection-selection/collection-selection-utils';
import { MAX_SPACE_ASSETS_PER_REQUEST } from '$lib/constants';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { addAssetsToAlbums } from '$lib/services/album.service';
import { addAssetsToSpace } from '$lib/services/space.service';
import { getFormatter } from '$lib/utils/i18n';

type AddToCollectionsOptions = {
  /**
   * The selection contains assets the caller does not own, so they can only land as #764
   * space contributions. Two consequences:
   *
   * - every album is dispatched on its own, because only the single-album endpoint
   *   (`POST /albums/:id/assets`) runs `tryContributeDeniedAssets`; the batched
   *   `PUT /albums/assets` would silently drop every non-owned asset;
   * - spaces are dropped, because `POST /shared-spaces/:id/assets` requires
   *   `Permission.AssetShare` on every id and rejects the whole request otherwise.
   *
   * The picker already hides spaces in this mode; dropping them here keeps the guarantee
   * even if a caller passes some anyway.
   */
  contributionMode?: boolean;
};

export const addAssetsToCollections = async (
  collections: PickerCollection[],
  assetIds: string[],
  { contributionMode = false }: AddToCollectionsOptions = {},
): Promise<boolean> => {
  const $t = await getFormatter();

  const albumIds = collections.filter((c) => c.kind === 'album').map((c) => c.id);
  // #1041: carry the caller's own "hidden from my timeline" flag alongside each space id, resolved
  // here from the picker's already-loaded DTO, so `addAssetsToSpace` can tell the timeline that
  // assets landing in a hidden space have just left it.
  const spaces =
    contributionMode || assetIds.length > MAX_SPACE_ASSETS_PER_REQUEST
      ? []
      : collections
          .filter((c) => c.kind === 'space')
          .map((c) => ({
            id: c.id,
            hiddenFromMyTimeline: isHiddenFromMyTimeline(c.space, authManager.user?.id ?? null),
          }));

  const total = albumIds.length + spaces.length;
  if (total === 0) {
    return true;
  }

  if (total === 1 && albumIds.length === 1) {
    return addAssetsToAlbums(albumIds, assetIds, { notify: true });
  }
  if (total === 1 && spaces.length === 1) {
    return addAssetsToSpace(spaces[0].id, assetIds, {
      notify: true,
      hiddenFromMyTimeline: spaces[0].hiddenFromMyTimeline,
    });
  }

  const tasks: { count: number; run: () => Promise<boolean> }[] = [];
  if (contributionMode) {
    for (const id of albumIds) {
      tasks.push({ count: 1, run: () => addAssetsToAlbums([id], assetIds, { notify: false }) });
    }
  } else if (albumIds.length > 0) {
    tasks.push({ count: albumIds.length, run: () => addAssetsToAlbums(albumIds, assetIds, { notify: false }) });
  }
  for (const space of spaces) {
    tasks.push({
      count: 1,
      run: () =>
        addAssetsToSpace(space.id, assetIds, { notify: false, hiddenFromMyTimeline: space.hiddenFromMyTimeline }),
    });
  }

  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  let success = 0;
  for (const [i, result] of settled.entries()) {
    if (result.status === 'fulfilled' && result.value) {
      success += tasks[i].count;
    }
  }

  if (success > 0) {
    toastManager.primary($t('added_to_collections_count', { values: { count: success } }));
  }
  return success > 0;
};
