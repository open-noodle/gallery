import type { PickerCollection } from '$lib/components/shared-components/collection-selection/collection-selection-utils';
import { MAX_SPACE_ASSETS_PER_REQUEST } from '$lib/constants';
import { addAssetsToAlbums } from '$lib/services/album.service';
import { addAssetsToSpace } from '$lib/services/space.service';
import { getFormatter } from '$lib/utils/i18n';
import { toastManager } from '@immich/ui';

export const addAssetsToCollections = async (collections: PickerCollection[], assetIds: string[]): Promise<boolean> => {
  const $t = await getFormatter();

  const albumIds = collections.filter((c) => c.kind === 'album').map((c) => c.id);
  const spaceIds =
    assetIds.length > MAX_SPACE_ASSETS_PER_REQUEST
      ? []
      : collections.filter((c) => c.kind === 'space').map((c) => c.id);

  const total = albumIds.length + spaceIds.length;
  if (total === 0) {
    return true;
  }

  if (total === 1 && albumIds.length === 1) {
    return addAssetsToAlbums(albumIds, assetIds, { notify: true });
  }
  if (total === 1 && spaceIds.length === 1) {
    return addAssetsToSpace(spaceIds[0], assetIds, { notify: true });
  }

  const tasks: { count: number; run: () => Promise<boolean> }[] = [];
  if (albumIds.length > 0) {
    tasks.push({ count: albumIds.length, run: () => addAssetsToAlbums(albumIds, assetIds, { notify: false }) });
  }
  for (const id of spaceIds) {
    tasks.push({ count: 1, run: () => addAssetsToSpace(id, assetIds, { notify: false }) });
  }

  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  let success = 0;
  for (const [i, result] of settled.entries()) {
    if (result.status === 'fulfilled' && result.value === true) {
      success += tasks[i].count;
    }
  }

  if (success > 0) {
    toastManager.primary($t('added_to_collections_count', { values: { count: success } }));
  }
  return success > 0;
};
