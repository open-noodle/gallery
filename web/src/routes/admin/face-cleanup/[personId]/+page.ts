import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url, params }) => {
  await authenticate(url, { admin: true });
  const $t = await getFormatter();

  return {
    personId: params.personId,
    meta: {
      title: $t('admin.face_cleanup_review_title'),
    },
  };
}) satisfies PageLoad;
