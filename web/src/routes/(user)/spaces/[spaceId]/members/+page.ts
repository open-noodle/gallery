import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, parent }) => {
  await authenticate(url);
  const { space } = await parent();
  return { meta: { title: `${space.name} - Members` } };
}) satisfies PageLoad;
