import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, parent }) => {
  await authenticate(url);
  await parent();
  return {};
}) satisfies PageLoad;
