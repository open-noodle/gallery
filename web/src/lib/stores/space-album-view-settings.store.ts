import { persisted } from 'svelte-persisted-store';
import { AlbumViewMode, SortOrder } from '$lib/stores/preferences.store';
import { SpaceAlbumSortBy } from '$lib/utils/space-album-sort';

export enum SpaceAlbumGroupBy {
  None = 'None',
  Year = 'Year',
  LinkedBy = 'LinkedBy',
  Owner = 'Owner',
}

export interface SpaceAlbumViewSettings {
  view: string;
  sortBy: string;
  sortOrder: string;
  groupBy: string;
  groupOrder: string;
  collapsedGroups: { [group: string]: string[] };
}

export const spaceAlbumViewSettings = persisted<SpaceAlbumViewSettings>('space-album-view-settings', {
  view: AlbumViewMode.Cover,
  sortBy: SpaceAlbumSortBy.RecentlyLinked,
  sortOrder: SortOrder.Desc,
  groupBy: SpaceAlbumGroupBy.None,
  groupOrder: SortOrder.Desc,
  collapsedGroups: {},
});
