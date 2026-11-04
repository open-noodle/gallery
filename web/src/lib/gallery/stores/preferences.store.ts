import { persisted } from 'svelte-persisted-store';

export const videoViewerVolume = persisted<number>('video-viewer-volume', 1, {});
export const videoViewerMuted = persisted<boolean>('video-viewer-muted', false, {});

export enum PeopleSortBy {
  PhotoCount = 'photoCount',
  Name = 'name',
}

export enum PeopleFilterBy {
  All = 'All',
  People = 'People',
  Pets = 'Pets',
}

export interface PeopleViewSettings {
  sortBy: PeopleSortBy;
  /** People-page type filter. Persisted alongside sortBy; older stored objects have no value. */
  filterBy?: PeopleFilterBy;
}

// Same serializer as upstream's (module-private) persistedObject: stored fields merge over the defaults.
const defaultPeopleViewSettings: PeopleViewSettings = { sortBy: PeopleSortBy.PhotoCount, filterBy: PeopleFilterBy.All };
export const peopleViewSettings = persisted<PeopleViewSettings>('people-view-settings', defaultPeopleViewSettings, {
  serializer: {
    parse: (text) => ({ ...defaultPeopleViewSettings, ...JSON.parse(text ?? null) }),
    stringify: JSON.stringify,
  },
});

/**
 * Whether the asset-viewer Info panel crops each person's avatar out of the photo on screen
 * (`true`, the long-standing behaviour) or shows their profile face instead (`false`).
 *
 * Defaults to `true` so nothing changes visually on upgrade. The setting is deliberately inert
 * for a viewer with no reachable profile face — see resolvePersonAvatar in $lib/utils/person-avatar.
 */
export const cropFacesFromAsset = persisted<boolean>('crop-faces-from-asset', true, {});

export const recentSpacesDropdown = persisted<boolean>('recent-spaces-open', true, {});

export const recentSpaceAlbumsExpanded = persisted<Record<string, boolean>>('recent-space-albums-open', {}, {});

export const isSpaceAlbumsExpanded = (state: Record<string, boolean>, spaceId: string): boolean => state[spaceId];

export const setSpaceAlbumsExpanded = (spaceId: string, expanded: boolean, validSpaceIds: string[]): void => {
  recentSpaceAlbumsExpanded.update((state) => {
    const valid = new Set(validSpaceIds);
    const next: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(state)) {
      if (valid.has(id)) {
        next[id] = value;
      }
    }
    next[spaceId] = expanded;
    return next;
  });
};
