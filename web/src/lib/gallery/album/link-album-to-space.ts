import { linkAlbum, type AlbumResponseDto, type SharedSpaceResponseDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import SpacePickerModal from '$lib/modals/SpacePickerModal.svelte';
import { handleError } from '$lib/utils/handle-error';
import { getFormatter } from '$lib/utils/i18n';

// L15: "Link to space" entry point from the album itself (mirrors the existing "link an album"
// flow already available from inside a space — see SpaceLinkAlbumModal / the space albums page).
// Reuses SpacePickerModal and the `linkAlbum` PUT /shared-spaces/{id}/albums/{albumId} SDK call.
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
