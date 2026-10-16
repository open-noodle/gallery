import { getAllSpaces } from '@immich/sdk';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { userInteraction } from '$lib/stores/user.svelte';
import { handleError } from '$lib/utils/handle-error';

// Module state: a test that leaves getAllSpaces pending blocks loadSpaces for the rest of its file.
let spacesRequest: Promise<void> | undefined;

const fetchSpaces = async () => {
  try {
    userInteraction.recentSpaces = await getAllSpaces();
  } catch (error) {
    // Left unknown (space-person edits stay offered, see isSpaceEditor); the next loadSpaces call retries.
    handleError(error, get(t)('failed_to_load_spaces'));
  } finally {
    spacesRequest = undefined;
  }
};

/** Fills the shared spaces-list cache (sidebar and People pages) unless it is already there or on its way. */
export const loadSpaces = () => {
  if (!userInteraction.recentSpaces && !spacesRequest) {
    spacesRequest = fetchSpaces();
  }
};

const resetRecentSpaces = () => {
  userInteraction.recentSpaces = undefined;
};

const dropSpaceAlbumCache = (spaceId: string) => {
  if (!userInteraction.spaceAlbums) {
    return;
  }

  const { [spaceId]: _, ...rest } = userInteraction.spaceAlbums;
  userInteraction.spaceAlbums = rest;
};

// Registered on first import: every writer of this cache (loadSpaces, the sidebar album list) imports this module.
// eslint-disable-next-line unicorn/no-top-level-side-effects
eventManager.on({
  SpaceAddAssets: () => resetRecentSpaces(),
  SpaceRemoveAssets: () => resetRecentSpaces(),
  SpaceLinkAlbum: ({ spaceId }) => {
    resetRecentSpaces();
    dropSpaceAlbumCache(spaceId);
  },
  SpaceUnlinkAlbum: ({ spaceId }) => {
    resetRecentSpaces();
    dropSpaceAlbumCache(spaceId);
  },
});
