import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

// Manual review page (design §6.4): person name/ownerId/faceCount are fetched CLIENT-SIDE from the URL param
// (getFaceRepairPersonMetadata) — not passed through navigation state — so a hard refresh or a deep link
// resolves them correctly. This load only authenticates and resolves the static page title.
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
