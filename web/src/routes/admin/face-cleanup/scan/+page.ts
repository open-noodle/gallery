import { searchUsersAdmin } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url, { admin: true });

  // The owner column maps each cluster's ownerId → the owning user (name + avatar).
  const users = await searchUsersAdmin({ withDeleted: true });

  const $t = await getFormatter();

  return {
    users,
    meta: {
      title: $t('admin.face_cleanup_mode_guided'),
    },
  };
}) satisfies PageLoad;
