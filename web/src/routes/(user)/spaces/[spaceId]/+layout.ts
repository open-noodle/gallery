import { getMembers, getSharedSpaceAlbums, getSpace } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { Route } from '$lib/route';
import { authenticate } from '$lib/utils/auth';
import type { LayoutLoad } from './$types';

export const load = (async ({ url, params }) => {
  await authenticate(url);
  try {
    const [space, members, linkedAlbums] = await Promise.all([
      getSpace({ id: params.spaceId }),
      getMembers({ id: params.spaceId }),
      getSharedSpaceAlbums({ id: params.spaceId }),
    ]);
    return { space, members, linkedAlbums, meta: { title: space.name } };
  } catch (error) {
    // Space deleted or access revoked mid-session → return to the spaces list rather than erroring.
    const status = (error as { status?: number })?.status;
    if (status === 403 || status === 404) {
      redirect(302, Route.spaces());
    }
    throw error;
  }
}) satisfies LayoutLoad;
