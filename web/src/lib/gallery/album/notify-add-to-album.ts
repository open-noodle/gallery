import type { BulkIdResponseDto } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';
import { goto } from '$app/navigation';
import { Route } from '$lib/route';

/**
 * Toast the outcome of an add-to-album call truthfully (#764). The server returns HTTP 200 with
 * per-asset failures, so severity must follow the result counts — a green "Successful" heading is
 * reserved for the all-succeeded case; nothing-added is a warning; partial / already-present is info.
 * Used by upstream's addAssetsToAlbumsMutation (album.query.ts) in place of its own toast.
 */
export const notifyAddToAlbum = (
  $t: MessageFormatter,
  albumId: string,
  assetIds: string[],
  results: BulkIdResponseDto[],
) => {
  const successCount = results.filter(({ success }) => success).length;
  const duplicateCount = results.filter(({ error }) => error === 'duplicate').length;
  const total = assetIds.length;
  const viewButton = { label: $t('view_album'), onclick: () => goto(Route.viewAlbum({ id: albumId })) };
  const options = { timeout: 5000 };

  if (successCount === total) {
    toastManager.primary(
      { description: $t('assets_added_to_album_count', { values: { count: successCount } }), button: viewButton },
      options,
    );
  } else if (duplicateCount === total) {
    toastManager.info(
      { description: $t('assets_were_part_of_album_count', { values: { count: duplicateCount } }), button: viewButton },
      options,
    );
  } else if (successCount > 0) {
    toastManager.info(
      {
        description: $t('assets_added_to_album_partial_count', { values: { successCount, totalCount: total } }),
        button: viewButton,
      },
      options,
    );
  } else {
    // Nothing was added (no_permission and/or a mix that netted zero) — never render as success.
    toastManager.warning(
      { description: $t('assets_cannot_be_added_to_album_count', { values: { count: total } }) },
      options,
    );
  }
};
