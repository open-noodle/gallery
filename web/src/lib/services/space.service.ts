import { addAssets, updateSpace, type UserAvatarColor } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { Route } from '$lib/route';
import { handleError } from '$lib/utils/handle-error';

export const addAssetsToSpace = async (spaceId: string, assetIds: string[], { notify }: { notify: boolean }) => {
  const $t = get(t);

  try {
    await addAssets({ id: spaceId, sharedSpaceAssetAddDto: { assetIds } });
    eventManager.emit('SpaceAddAssets', { assetIds, spaceId });

    if (notify) {
      toastManager.primary(
        {
          description: $t('added_to_space_count', { values: { count: assetIds.length } }),
          button: { label: $t('view_space'), onclick: () => goto(Route.viewSpace({ id: spaceId })) },
        },
        { timeout: 5000 },
      );
    }

    return true;
  } catch (error) {
    handleError(error, $t('errors.error_adding_assets_to_space'));
    return false;
  }
};

export const updateSpaceDetails = async (
  spaceId: string,
  dto: { name: string; description?: string; color: UserAvatarColor },
) => {
  const $t = get(t);

  try {
    // `description` is omitted entirely when unchanged (SpaceEditModal decides this) so a pure
    // rename doesn't clobber an untouched `null` description with `''`. When the caller DOES
    // include `description` — e.g. the user cleared it — it must be sent verbatim: an empty
    // string clears it server-side, whereas `undefined` would be dropped from the update
    // payload and keep the old value.
    await updateSpace({ id: spaceId, sharedSpaceUpdateDto: dto });
    toastManager.primary($t('spaces_edit_success'));

    return true;
  } catch (error) {
    handleError(error, $t('errors.unable_to_update_space'));
    return false;
  }
};
