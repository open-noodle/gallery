import { addAssetsToAlbum, BulkIdErrorReason } from '@immich/sdk';
import { notifyAddToAlbum } from '$lib/gallery/album/notify-add-to-album';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import {
  addAssetsToAlbumsMutation,
  createAlbumMutation,
  invalidateAlbum,
  invalidateAlbums,
} from '$lib/queries/album.query';
import { executeMutation } from '$lib/queries/client';
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
 *
 * Upstream's addAssetsToAlbumsMutation (album.query.ts) only resolves the raw results; this keeps
 * the same event and query invalidation it performs.
 */
export const addAssetsToAlbumWithOutcome = async (
  albumId: string,
  assetIds: string[],
  { notify }: { notify: boolean },
): Promise<{ ok: boolean; addedIds: string[]; deniedIds: string[] }> => {
  const $t = await getFormatter();

  try {
    const results = await addAssetsToAlbum({ ...authManager.params, id: albumId, bulkIdsDto: { ids: assetIds } });
    if (notify) {
      notifyAddToAlbum($t, albumId, assetIds, results);
    }
    eventManager.emit('AlbumAddAssets', { assetIds, albumIds: [albumId] });
    await Promise.all([invalidateAlbum(albumId), invalidateAlbums()]);
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

/**
 * Add to one or more albums through upstream's addAssetsToAlbumsMutation, resolving whether the call
 * succeeded. Keeps the boolean call shape the unified album + Space picker (#708) composes into one
 * aggregate toast. executeMutation swallows the error (the mutation toasts it) and resolves undefined.
 */
export const addAssetsToAlbums = async (albumIds: string[], assetIds: string[], { notify }: { notify: boolean }) =>
  (await executeMutation(() => addAssetsToAlbumsMutation({ notify }), { albumIds, assetIds })) !== undefined;

/**
 * Create an album through upstream's createAlbumMutation (which toasts a failure), resolving the album
 * or undefined. Keeps the call shape the fork's Google Takeout import and Space album creation use.
 */
export const createAlbum = (albumName = '', assetIds?: string[]) =>
  executeMutation(createAlbumMutation, [{ createAlbumDto: { albumName, assetIds } }]);
