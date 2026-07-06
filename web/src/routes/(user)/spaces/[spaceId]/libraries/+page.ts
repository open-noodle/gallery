import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, parent }) => {
  // External libraries are admin-only; non-admins are redirected away by the guard.
  await authenticate(url, { admin: true });
  await parent();
  return {};
}) satisfies PageLoad;
