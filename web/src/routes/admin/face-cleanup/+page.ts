import { getLatestScan, searchUsersAdmin } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url, { admin: true });

  // The user count decorates the manual card (§6.2) — no global people total exists, since people are
  // only counted per owner.
  const users = await searchUsersAdmin({ withDeleted: true });

  // Resolve the scan here and swallow its failure into null, rather than awaiting a rejecting promise in
  // onMount: that pattern is untestable under vitest 4 + happy-dom (its unhandled-rejection detector fails
  // the test even when the component catches correctly) and has already cost this feature hours. A null
  // scan means "never scanned" — the same signal the dashboard already treats a resolved null as.
  const scan = await getLatestScan().catch(() => null);

  const $t = await getFormatter();

  return {
    users,
    scan,
    meta: {
      title: $t('admin.face_cleanup'),
    },
  };
}) satisfies PageLoad;
