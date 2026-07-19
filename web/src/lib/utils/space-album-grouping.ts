import type { AlbumResponseDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { groupBy } from 'lodash-es';
import { get } from 'svelte/store';
import { AlbumSortBy, SortOrder } from '$lib/stores/preferences.store';
import {
  SpaceAlbumGroupBy,
  spaceAlbumViewSettings,
  type SpaceAlbumViewSettings,
} from '$lib/stores/space-album-view-settings.store';
import { sortAlbums, stringToSortOrder } from '$lib/utils/album-utils';

/**
 * ----------------------
 * Space Album Grouping
 * ----------------------
 */

export interface SpaceAlbumGroup {
  id: string;
  name: string;
  albums: SharedSpaceLinkedAlbumDto[];
}

export interface SpaceAlbumGroupOptionMetadata {
  id: SpaceAlbumGroupBy;
  defaultOrder: SortOrder;
  isDisabled: () => boolean;
}

export const spaceGroupOptionsMetadata: SpaceAlbumGroupOptionMetadata[] = [
  {
    id: SpaceAlbumGroupBy.None,
    defaultOrder: SortOrder.Asc,
    isDisabled: () => false,
  },
  {
    id: SpaceAlbumGroupBy.Year,
    defaultOrder: SortOrder.Desc,
    isDisabled() {
      const disabledWithSortOptions: string[] = [AlbumSortBy.DateCreated, AlbumSortBy.DateModified];
      return disabledWithSortOptions.includes(get(spaceAlbumViewSettings).sortBy);
    },
  },
  {
    id: SpaceAlbumGroupBy.LinkedBy,
    defaultOrder: SortOrder.Asc,
    isDisabled: () => false,
  },
  {
    id: SpaceAlbumGroupBy.Owner,
    defaultOrder: SortOrder.Asc,
    isDisabled: () => false,
  },
];

export const findSpaceGroupOptionMetadata = (groupByValue: string) => {
  // Default is no grouping
  const defaultGroupOption = spaceGroupOptionsMetadata[0];
  return spaceGroupOptionsMetadata.find(({ id }) => groupByValue === id) ?? defaultGroupOption;
};

export const getSelectedSpaceAlbumGroupOption = (settings: SpaceAlbumViewSettings): SpaceAlbumGroupBy => {
  const defaultGroupOption = SpaceAlbumGroupBy.None;
  const albumGroupOption = (settings.groupBy as SpaceAlbumGroupBy) ?? defaultGroupOption;

  if (findSpaceGroupOptionMetadata(albumGroupOption).isDisabled()) {
    return defaultGroupOption;
  }
  return albumGroupOption;
};

/**
 * --------------------------------
 * Space Album Groups Collapse/Expand
 * --------------------------------
 */

const getCollapsedSpaceAlbumGroups = (settings: SpaceAlbumViewSettings) => {
  settings.collapsedGroups ??= {};
  const { collapsedGroups, groupBy: currentGroupBy } = settings;
  collapsedGroups[currentGroupBy] ??= [];
  return collapsedGroups[currentGroupBy];
};

export const isSpaceAlbumGroupCollapsed = (settings: SpaceAlbumViewSettings, groupId: string) => {
  if (settings.groupBy === SpaceAlbumGroupBy.None) {
    return false;
  }
  return getCollapsedSpaceAlbumGroups(settings).includes(groupId);
};

export const toggleSpaceAlbumGroupCollapsing = (groupId: string) => {
  const settings = get(spaceAlbumViewSettings);
  if (settings.groupBy === SpaceAlbumGroupBy.None) {
    return;
  }
  const collapsedGroups = getCollapsedSpaceAlbumGroups(settings);
  const groupIndex = collapsedGroups.indexOf(groupId);
  if (groupIndex === -1) {
    // Collapse
    collapsedGroups.push(groupId);
  } else {
    // Expand
    collapsedGroups.splice(groupIndex, 1);
  }
  spaceAlbumViewSettings.set(settings);
};

export const collapseAllSpaceAlbumGroups = (groupIds: string[]) => {
  spaceAlbumViewSettings.update((settings) => {
    const collapsedGroups = getCollapsedSpaceAlbumGroups(settings);
    collapsedGroups.length = 0;
    collapsedGroups.push(...groupIds);
    return settings;
  });
};

export const expandAllSpaceAlbumGroups = () => {
  collapseAllSpaceAlbumGroups([]);
};

/**
 * -----------------------------------------------
 * Build Space Album Groups (pure — no store reads)
 * -----------------------------------------------
 */

export interface SpaceAlbumGroupingCtx {
  ungrouped: string;
  unknownYear: string;
  unassigned: string;
  currentUserId: string;
  members: Array<{ userId: string; name: string }>;
  myAlbums?: string;
}

export const buildSpaceAlbumGroups = (
  albums: SharedSpaceLinkedAlbumDto[],
  settings: SpaceAlbumViewSettings,
  ctx: SpaceAlbumGroupingCtx,
): SpaceAlbumGroup[] => {
  const selectedGroupBy = getSelectedSpaceAlbumGroupOption(settings);
  const order = stringToSortOrder(settings.groupOrder);

  let groups: SpaceAlbumGroup[];

  switch (selectedGroupBy) {
    case SpaceAlbumGroupBy.None: {
      groups = [{ id: ctx.ungrouped, name: ctx.ungrouped, albums }];
      break;
    }

    case SpaceAlbumGroupBy.Year: {
      const useStartDate = settings.sortBy === AlbumSortBy.OldestPhoto;

      const groupedByYear = groupBy(albums, (album) => {
        const date = useStartDate ? album.startDate : album.endDate;
        return date ? String(new Date(date).getFullYear()) : ctx.unknownYear;
      });

      const sortSign = order === SortOrder.Desc ? -1 : 1;
      const sortedByYear = Object.entries(groupedByYear).sort(([a], [b]) => {
        // Unknown-year always last
        if (a === ctx.unknownYear) {
          return 1;
        } else if (b === ctx.unknownYear) {
          return -1;
        } else {
          return (Number.parseInt(a) - Number.parseInt(b)) * sortSign;
        }
      });

      groups = sortedByYear.map(([year, yearAlbums]) => ({
        id: year,
        name: year,
        albums: yearAlbums,
      }));
      break;
    }

    case SpaceAlbumGroupBy.LinkedBy: {
      const UNASSIGNED_KEY = '__unassigned__';

      const groupedByLinker = groupBy(albums, (album) => {
        if (!album.addedById) {
          return UNASSIGNED_KEY;
        }
        const member = ctx.members.find((m) => m.userId === album.addedById);
        return member ? member.userId : UNASSIGNED_KEY;
      });

      const sortSign = order === SortOrder.Desc ? -1 : 1;
      const sortedByLinker = Object.entries(groupedByLinker).sort(([keyA], [keyB]) => {
        // Unassigned always last
        if (keyA === UNASSIGNED_KEY) {
          return 1;
        } else if (keyB === UNASSIGNED_KEY) {
          return -1;
        } else {
          const nameA = ctx.members.find((m) => m.userId === keyA)?.name ?? '';
          const nameB = ctx.members.find((m) => m.userId === keyB)?.name ?? '';
          return nameA.localeCompare(nameB) * sortSign;
        }
      });

      groups = sortedByLinker.map(([key, keyAlbums]) => ({
        id: key === UNASSIGNED_KEY ? ctx.unassigned : key,
        name:
          key === UNASSIGNED_KEY ? ctx.unassigned : (ctx.members.find((m) => m.userId === key)?.name ?? ctx.unassigned),
        albums: keyAlbums,
      }));
      break;
    }

    case SpaceAlbumGroupBy.Owner: {
      const UNASSIGNED_KEY = '__unassigned__';

      // ownerId is not currently exposed on SharedSpaceLinkedAlbumDto (albumUsers was stripped
      // in Slice 7 to prevent PII leakage). Group by ownerId when it becomes available;
      // fall back to UNASSIGNED_KEY so the grouping is safe and crash-free today.
      const groupedByOwner = groupBy(albums, (album) => {
        const ownerId = (album as unknown as { ownerId?: string }).ownerId;
        return ownerId ?? UNASSIGNED_KEY;
      });

      const sortSign = order === SortOrder.Desc ? -1 : 1;
      const sortedByOwner = Object.entries(groupedByOwner).sort(([ownerIdA], [ownerIdB]) => {
        // Unassigned always last
        if (ownerIdA === UNASSIGNED_KEY) {
          return 1;
        } else if (ownerIdB === UNASSIGNED_KEY) {
          return -1;
        }
        // Current user pinned first (before sort direction applies)
        if (ownerIdA === ctx.currentUserId) {
          return -sortSign;
        } else if (ownerIdB === ctx.currentUserId) {
          return sortSign;
        } else {
          const ownerAName = ctx.members.find((m) => m.userId === ownerIdA)?.name ?? '';
          const ownerBName = ctx.members.find((m) => m.userId === ownerIdB)?.name ?? '';
          return ownerAName.localeCompare(ownerBName) * sortSign;
        }
      });

      groups = sortedByOwner.map(([ownerId, ownerAlbums]) => {
        if (ownerId === UNASSIGNED_KEY) {
          return { id: ctx.unassigned, name: ctx.unassigned, albums: ownerAlbums };
        }
        const memberName = ctx.members.find((m) => m.userId === ownerId)?.name;
        const ownerName =
          ownerId === ctx.currentUserId
            ? (ctx.myAlbums ?? memberName ?? ctx.unassigned)
            : (memberName ?? ctx.unassigned);
        return { id: ownerId, name: ownerName, albums: ownerAlbums };
      });
      break;
    }

    default: {
      groups = [{ id: ctx.ungrouped, name: ctx.ungrouped, albums }];
      break;
    }
  }

  // Re-sort each group's albums by the current sort settings
  for (const group of groups) {
    group.albums = sortAlbums(group.albums as unknown as AlbumResponseDto[], {
      sortBy: settings.sortBy,
      orderBy: settings.sortOrder,
    }) as unknown as SharedSpaceLinkedAlbumDto[];
  }

  return groups;
};
