import { getAlbumInfo } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, url, parent }) => {
  await authenticate(url);
  const { linkedAlbums } = await parent();
  const link = linkedAlbums.find((a) => a.id === params.albumId);
  if (!link) {
    redirect(302, `/spaces/${params.spaceId}/albums`);
  }
  const album = await getAlbumInfo({ id: params.albumId });
  // The folder this album lives in, so the back button returns to that level of the tree rather
  // than dumping the user at the space root. Derived from the album's own placement rather than
  // from how they arrived, so it also works on a refresh, a deep link, or a search result.
  return { album, folderId: link.folderId, meta: { title: album.albumName } };
}) satisfies PageLoad;
