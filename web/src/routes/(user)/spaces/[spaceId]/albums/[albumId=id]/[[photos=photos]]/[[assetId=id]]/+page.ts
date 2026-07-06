import { getAlbumInfo } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, url, parent }) => {
  await authenticate(url);
  const { linkedAlbums } = await parent();
  if (!linkedAlbums.some((a) => a.id === params.albumId)) {
    redirect(302, `/spaces/${params.spaceId}/albums`);
  }
  const album = await getAlbumInfo({ id: params.albumId });
  return { album, meta: { title: album.albumName } };
}) satisfies PageLoad;
