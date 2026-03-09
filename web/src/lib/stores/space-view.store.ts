import { SortOrder } from '$lib/stores/preferences.store';
import { persisted } from 'svelte-persisted-store';
import type { Translations } from 'svelte-i18n';

export enum SpaceSortBy {
  Name = 'Name',
  LastActivity = 'LastActivity',
  DateCreated = 'DateCreated',
  AssetCount = 'AssetCount',
}

export interface SpaceViewSettings {
  sortBy: string;
  sortOrder: string;
}

export const spaceViewSettings = persisted<SpaceViewSettings>('space-view-settings', {
  sortBy: SpaceSortBy.LastActivity,
  sortOrder: SortOrder.Desc,
});

export interface SpaceSortOptionMetadata {
  id: SpaceSortBy;
  label: Translations;
  defaultOrder: SortOrder;
}

export const sortOptionsMetadata: SpaceSortOptionMetadata[] = [
  { id: SpaceSortBy.Name, label: 'name', defaultOrder: SortOrder.Asc },
  { id: SpaceSortBy.LastActivity, label: 'last_activity', defaultOrder: SortOrder.Desc },
  { id: SpaceSortBy.DateCreated, label: 'date_created', defaultOrder: SortOrder.Desc },
  { id: SpaceSortBy.AssetCount, label: 'asset_count', defaultOrder: SortOrder.Desc },
];
