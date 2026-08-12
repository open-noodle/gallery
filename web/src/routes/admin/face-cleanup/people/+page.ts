import { searchUsersAdmin } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url, { admin: true });

  // Same call the guided dashboard already makes for its owner column (§6.3) — drives the owner selector.
  // People themselves are NOT fetched here: owner selection drives that client-side, so switching owners
  // never re-runs SvelteKit's load and can cleanly reset page/list state per owner.
  const users = await searchUsersAdmin({ withDeleted: true });

  const $t = await getFormatter();

  return {
    users,
    meta: {
      title: $t('admin.face_cleanup_mode_manual'),
    },
  };
}) satisfies PageLoad;
