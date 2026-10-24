import { getAllSpaces, getSharedSpaceAlbums } from '@immich/sdk';
import { queryOptions } from '@tanstack/svelte-query';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { queryClient } from '$lib/queries/client';
import { handleError } from '$lib/utils/handle-error';
import { getFormatter } from '$lib/utils/i18n';

/**
 * The viewer's spaces list, shared by the sidebar's recent spaces and the People pages (which read the
 * viewer's role from `members`). Replaces the fork's `userInteraction.recentSpaces` store, the same move
 * upstream made for its recent albums (album.query.ts). While a refetch runs, the last list stays up.
 */
export const spacesQueryKey = ['spaces'];

export const getAllSpacesQuery = () =>
  queryOptions({
    queryKey: spacesQueryKey,
    queryFn: async ({ signal }) => {
      try {
        return await getAllSpaces({ signal });
      } catch (error) {
        // Left unknown (space-person edits stay offered, see isSpaceEditor); the next read retries.
        const $t = await getFormatter();
        handleError(error, $t('failed_to_load_spaces'));
        throw error;
      }
    },
  });

/** A space's linked albums for the sidebar drill-down, newest link first. */
export const getSpaceAlbumsQuery = (spaceId: string) =>
  queryOptions({
    queryKey: [...spacesQueryKey, spaceId, 'albums'],
    queryFn: ({ signal }) => getSharedSpaceAlbums({ id: spaceId }, { signal }),
    select: (albums) => [...albums].sort((a, b) => b.linkedAt.localeCompare(a.linkedAt)),
  });

export const invalidateSpaces = () => queryClient.invalidateQueries({ queryKey: spacesQueryKey, exact: true });

const onSpaceAlbumsChange = (spaceId: string) =>
  Promise.all([invalidateSpaces(), queryClient.invalidateQueries({ queryKey: getSpaceAlbumsQuery(spaceId).queryKey })]);

// Asset and album-link changes move a space's activity and album counts. The query client already
// drops every cached query on logout.
// eslint-disable-next-line unicorn/no-top-level-side-effects
eventManager.on({
  SpaceAddAssets: () => void invalidateSpaces(),
  SpaceRemoveAssets: () => void invalidateSpaces(),
  SpaceLinkAlbum: ({ spaceId }) => void onSpaceAlbumsChange(spaceId),
  SpaceUnlinkAlbum: ({ spaceId }) => void onSpaceAlbumsChange(spaceId),
});
