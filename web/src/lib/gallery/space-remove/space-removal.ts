import {
  getAssetSpaces,
  getSharedSpaceAssetLinkedAlbums,
  removeAssets,
  SharedSpaceRole,
  type AssetSpacesItemDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { handleError } from '$lib/utils/handle-error';

/** A space the selection can be removed from, with the selected assets it holds. */
export type RemovableSpace = { space: SharedSpaceResponseDto; assetIds: string[] };

/** `POST /assets/spaces` takes at most this many IDs. */
const BATCH_SIZE = 1000;

/** The server lets the creator, an owner or an editor remove photos from a space. */
export const canRemoveFrom = (space: SharedSpaceResponseDto, userId: string) => {
  if (space.createdById === userId) {
    return true;
  }
  const role = space.members?.find((member) => member.userId === userId)?.role;
  return role === SharedSpaceRole.Owner || role === SharedSpaceRole.Editor;
};

/** The spaces of `spaces` that hold some of the answered assets and that the user may remove from, fullest first. */
export const removableSpaces = (
  answers: AssetSpacesItemDto[],
  spaces: SharedSpaceResponseDto[],
  userId: string,
): RemovableSpace[] => {
  const byId = new Map(spaces.filter((space) => canRemoveFrom(space, userId)).map((space) => [space.id, space]));
  const removable = new Map<string, RemovableSpace>();
  for (const { assetId, spaceIds } of answers) {
    for (const spaceId of spaceIds) {
      const space = byId.get(spaceId);
      if (!space) {
        continue;
      }
      let entry = removable.get(spaceId);
      if (!entry) {
        entry = { space, assetIds: [] };
        removable.set(spaceId, entry);
      }
      entry.assetIds.push(assetId);
    }
  }
  // Sorting a fresh array: toSorted() is missing from the oldest supported browsers.
  return [...removable.values()].sort(
    (a, b) => b.assetIds.length - a.assetIds.length || a.space.name.localeCompare(b.space.name),
  );
};

/** Which of the user's spaces show each asset, asked in batches; stops after the current batch once aborted. */
export const fetchSelectionSpaces = async (assetIds: string[], signal?: AbortSignal) => {
  const answers: AssetSpacesItemDto[] = [];
  for (let index = 0; index < assetIds.length && !signal?.aborted; index += BATCH_SIZE) {
    const { assets } = await getAssetSpaces({
      assetSpacesDto: { assetIds: assetIds.slice(index, index + BATCH_SIZE) },
    });
    answers.push(...assets);
  }
  return answers;
};

/**
 * Removes assets from a space after a confirmation, the same from inside the space and from the timeline. The server
 * removes only the assets added directly (with their stacks); the rest reach the space through a linked album or
 * library, and the message says which. The selection is cleared when everything went, and otherwise keeps the rest.
 * Returns the IDs the server removed.
 */
export const removeFromSpace = async (spaceId: string, assetIds: string[]): Promise<string[]> => {
  const $t = get(t);
  const isConfirmed = await modalManager.showDialog({
    prompt: $t('remove_assets_shared_space_confirmation', { values: { count: assetIds.length } }),
  });
  if (!isConfirmed) {
    return [];
  }

  let removedAssetIds: string[];
  try {
    removedAssetIds = await removeAssets({ id: spaceId, sharedSpaceAssetRemoveDto: { assetIds } });
  } catch (error) {
    handleError(error, $t('errors.error_removing_assets_from_space'));
    return [];
  }

  if (removedAssetIds.length > 0) {
    eventManager.emit('SpaceRemoveAssets', { assetIds: removedAssetIds, spaceId });
  }

  const removed = new Set(removedAssetIds);
  const keptAssetIds = assetIds.filter((id) => !removed.has(id));
  if (keptAssetIds.length === 0) {
    toastManager.success($t('assets_removed_count', { values: { count: removedAssetIds.length } }));
    assetMultiSelectManager.clear();
    return removedAssetIds;
  }

  // The rest stay: name the linked albums that hold them, or say a linked library brings them. The selection keeps
  // them so the user can act on them, and drops the ones that went.
  for (const id of removedAssetIds) {
    assetMultiSelectManager.removeAssetFromMultiselectGroup(id);
  }
  let message: string;
  try {
    const albums = await getSharedSpaceAssetLinkedAlbums({
      id: spaceId,
      sharedSpaceAssetRemoveDto: { assetIds: keptAssetIds },
    });
    const albumNames = [...new Set(albums.map((album) => album.albumName))];
    message =
      albumNames.length > 0
        ? $t('remove_from_space_album_blocked', {
            values: { count: keptAssetIds.length, albums: albumNames.join(', ') },
          })
        : $t('remove_from_space_library_blocked', { values: { count: keptAssetIds.length } });
  } catch {
    message = $t('no_assets_removed_from_space');
  }
  toastManager.warning(message);
  return removedAssetIds;
};
