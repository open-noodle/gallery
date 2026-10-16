import {
  addAssetsToAlbum as addToAlbum,
  BulkIdErrorReason,
  linkAlbum,
  type AlbumResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import SpacePickerModal from '$lib/modals/SpacePickerModal.svelte';
import { notifyAddToAlbum } from '$lib/services/album.service';
import { handleError } from '$lib/utils/handle-error';
import { getFormatter } from '$lib/utils/i18n';

/**
 * Single-album add that reports WHICH assets the server accepted.
 *
 * `POST /albums/:id/assets` answers HTTP 200 with per-asset outcomes, so "the call did not throw"
 * is not "every photo landed" — an asset can come back `success:false, error:no_permission`. A
 * caller that paints the whole selection into the album on a non-throwing call shows photos that
 * disappear on the next reload. Cross-owner adds make that routine, because an asset visible
 * through a space is not necessarily one the #764 contribution path will accept.
 */
export const addAssetsToAlbumWithOutcome = async (
  albumId: string,
  assetIds: string[],
  { notify }: { notify: boolean },
): Promise<{ ok: boolean; addedIds: string[]; deniedIds: string[] }> => {
  const $t = await getFormatter();

  try {
    const results = await addToAlbum({ ...authManager.params, id: albumId, bulkIdsDto: { ids: assetIds } });
    if (notify) {
      notifyAddToAlbum($t, albumId, assetIds, results);
    }
    eventManager.emit('AlbumAddAssets', { assetIds, albumIds: [albumId] });
    return {
      ok: true,
      addedIds: results.filter(({ success }) => success).map(({ id }) => id),
      // An asset already in the album comes back `success:false, error:duplicate`. That is not a
      // refusal — the photo is already where the caller wanted it and there is nothing to retry —
      // so it must not be lumped in with a genuine permission denial.
      deniedIds: results
        .filter(({ success, error }) => !success && error !== BulkIdErrorReason.Duplicate)
        .map(({ id }) => id),
    };
  } catch (error) {
    handleError(error, $t('errors.error_adding_assets_to_album'));
    return { ok: false, addedIds: [], deniedIds: [] };
  }
};

// L15: "Link to space" entry point from the album itself (mirrors the existing "link an album"
// flow already available from inside a space — see SpaceLinkAlbumModal / the space albums page).
// Reuses the existing SpacePickerModal (built for cmdk selection, never wired up) and the existing
// `linkAlbum` PUT /shared-spaces/{id}/albums/{albumId} SDK call — no new backend, no new modal.
export const handleLinkAlbumToSpace = async (album: AlbumResponseDto) => {
  const $t = await getFormatter();

  const space = await modalManager.show<{ onClose: (space?: SharedSpaceResponseDto) => void }>(SpacePickerModal, {});
  if (!space) {
    return false;
  }

  try {
    await linkAlbum({ id: space.id, albumId: album.id });
    toastManager.primary($t('album_linked_to_space', { values: { space: space.name } }));
    return true;
  } catch (error) {
    handleError(error, $t('spaces_linked_albums_error_link'));
    return false;
  }
};
