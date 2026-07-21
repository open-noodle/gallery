import type {
  AlbumResponseDto,
  ServerAboutResponseDto,
  ServerStorageResponseDto,
  ServerVersionHistoryResponseDto,
  SharedSpaceLinkedAlbumDto,
  SharedSpaceResponseDto,
} from '@immich/sdk';
import { eventManager } from '$lib/managers/event-manager.svelte';

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
