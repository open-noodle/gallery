import { getSharedSpaceAlbumFolders } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  await parent();

  // The folder tree ships with the page load, alongside the layout's linkedAlbums, because the
  // page cannot render a single album correctly without it: getFolderContents promotes any album
  // whose folderId it cannot resolve to the root, so an empty tree makes EVERY album in the space
  // look like a root album. Fetching it on mount instead meant one full round-trip of the wrong
  // albums — the whole space, unscoped and clickable, with no breadcrumb — on every deep link,
  // refresh, and back-navigation from an album detail page.
  //
  // `null` rather than a thrown error: a folders failure must not take the whole page down with
  // it. The page treats null as "no tree to scope by" and degrades to the flat album list, which
  // is strictly better than hiding every album that lives in a folder.
  const folders = await getSharedSpaceAlbumFolders({ id: params.spaceId }).catch(() => null);

  return { folders };
}) satisfies PageLoad;
