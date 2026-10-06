import type {
  AlbumResponseDto,
  ServerAboutResponseDto,
  ServerStorageResponseDto,
  ServerVersionHistoryResponseDto,
  SharedSpaceLinkedAlbumDto,
  SharedSpaceResponseDto,
} from '@immich/sdk';
import { getAllSpaces } from '@immich/sdk';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { handleError } from '$lib/utils/handle-error';

interface UserInteractions {
  recentAlbums?: AlbumResponseDto[];
  recentSpaces?: SharedSpaceResponseDto[];
  spaceAlbums?: Record<string, SharedSpaceLinkedAlbumDto[]>;
  versions?: ServerVersionHistoryResponseDto[];
  aboutInfo?: ServerAboutResponseDto;
  serverInfo?: ServerStorageResponseDto;
}

const defaultUserInteraction: UserInteractions = {
  recentAlbums: undefined,
  recentSpaces: undefined,
  spaceAlbums: undefined,
  versions: undefined,
  aboutInfo: undefined,
  serverInfo: undefined,
};

export const userInteraction = $state<UserInteractions>(defaultUserInteraction);

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

const resetRecentAlbums = () => {
  userInteraction.recentAlbums = undefined;
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

const reset = () => {
  Object.assign(userInteraction, defaultUserInteraction);
};

// eslint-disable-next-line unicorn/no-top-level-side-effects
eventManager.on({
  AlbumCreate: () => resetRecentAlbums(),
  AlbumUpdate: () => resetRecentAlbums(),
  AlbumDelete: () => resetRecentAlbums(),
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
  AuthLogout: () => reset(),
});
