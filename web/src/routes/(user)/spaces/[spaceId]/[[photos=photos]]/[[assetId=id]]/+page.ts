import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

// space + members come from the parent [spaceId] layout load.
export const load = (async ({ url, parent }) => {
  await authenticate(url);
  await parent();
  return {};
}) satisfies PageLoad;
