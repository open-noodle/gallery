import { persisted } from 'svelte-persisted-store';
import { AlbumSortBy, AlbumViewMode, SortOrder } from '$lib/stores/preferences.store';

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
  sortBy: AlbumSortBy.MostRecentPhoto,
  sortOrder: SortOrder.Desc,
  groupBy: SpaceAlbumGroupBy.None,
  groupOrder: SortOrder.Desc,
  collapsedGroups: {},
});
