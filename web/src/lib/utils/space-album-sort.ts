import type { AlbumResponseDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { orderBy } from 'lodash-es';
import type { Translations } from 'svelte-i18n';
import { AlbumSortBy, SortOrder } from '$lib/stores/preferences.store';
import { sortAlbums, sortOptionsMetadata, stringToSortOrder } from '$lib/utils/album-utils';

/**
 * Space album lists offer everything the regular album list offers, plus
 * `RecentlyLinked` — when the album was linked into *this* space. That option
 * lives here rather than in upstream's `AlbumSortBy` on purpose: the regular
 * /albums page iterates upstream's `sortOptionsMetadata`, and `linkedAt` does
 * not exist on `AlbumResponseDto`, so adding it upstream would surface a dead
 * option there (and dirty a file we keep byte-clean for rebases).
 */
export const SpaceAlbumSortBy = {
  ...AlbumSortBy,
  RecentlyLinked: 'RecentlyLinked',
} as const;

/**
 * The union of every value `SpaceAlbumSortBy` can hold. Used to key the
 * label records that back the sort dropdown, so adding a new option to
 * `SpaceAlbumSortBy` without adding its label is a compile error instead of
 * a blank menu row (Svelte stringifies `undefined` to `''`).
 */
export type SpaceAlbumSortByValue = (typeof SpaceAlbumSortBy)[keyof typeof SpaceAlbumSortBy];

export interface SpaceAlbumSortOptionMetadata {
  id: SpaceAlbumSortByValue;
  defaultOrder: SortOrder;
  columnStyle: string;
}

/**
 * Column widths for the space album table (#972). Upstream's `sortOptionsMetadata` sizes six columns with no
 * action column; the space table has seven sort columns plus the manage menu, so it carries its own set:
 * title, items and the menu everywhere, the two album dates from `sm`, the photo and link dates from `xl`.
 */
const spaceAlbumColumnStyles: Record<SpaceAlbumSortByValue, string> = {
  [SpaceAlbumSortBy.Title]: 'text-start w-7/12 sm:w-[35%] xl:w-[22%]',
  [SpaceAlbumSortBy.ItemCount]: 'text-center w-4/12 sm:w-[15%] xl:w-[10%]',
  [SpaceAlbumSortBy.DateModified]: 'text-center hidden sm:block sm:w-[22%] xl:w-[12%]',
  [SpaceAlbumSortBy.DateCreated]: 'text-center hidden sm:block sm:w-[22%] xl:w-[12%]',
  [SpaceAlbumSortBy.MostRecentPhoto]: 'text-center hidden xl:block xl:w-[12%]',
  [SpaceAlbumSortBy.OldestPhoto]: 'text-center hidden xl:block xl:w-[12%]',
  [SpaceAlbumSortBy.RecentlyLinked]: 'text-center hidden xl:block xl:w-[12%]',
};

/** The manage-menu column that ends every space album table row. */
export const spaceAlbumMenuColumnStyle = 'w-1/12 sm:w-[6%] text-end';

export const spaceAlbumSortOptionsMetadata: SpaceAlbumSortOptionMetadata[] = [
  ...sortOptionsMetadata.map(({ id, defaultOrder }) => ({
    id,
    defaultOrder,
    columnStyle: spaceAlbumColumnStyles[id],
  })),
  {
    id: SpaceAlbumSortBy.RecentlyLinked,
    defaultOrder: SortOrder.Desc,
    columnStyle: spaceAlbumColumnStyles[SpaceAlbumSortBy.RecentlyLinked],
  },
];

/** Labels for the space album sort options, shared by the sort menu and the table header. */
export const getSpaceAlbumSortLabels = (translate: (key: Translations) => string) =>
  ({
    [SpaceAlbumSortBy.Title]: translate('sort_title'),
    [SpaceAlbumSortBy.ItemCount]: translate('sort_items'),
    [SpaceAlbumSortBy.DateModified]: translate('sort_modified'),
    [SpaceAlbumSortBy.DateCreated]: translate('sort_created'),
    [SpaceAlbumSortBy.MostRecentPhoto]: translate('sort_recent'),
    [SpaceAlbumSortBy.OldestPhoto]: translate('sort_oldest'),
    [SpaceAlbumSortBy.RecentlyLinked]: translate('sort_recently_linked'),
  }) satisfies Record<SpaceAlbumSortByValue, string>;

const defaultSortOption = spaceAlbumSortOptionsMetadata.at(-1) as SpaceAlbumSortOptionMetadata;

export const findSpaceAlbumSortOptionMetadata = (sortBy: string): SpaceAlbumSortOptionMetadata =>
  spaceAlbumSortOptionsMetadata.find(({ id }) => id === sortBy) ?? defaultSortOption;

/**
 * Resolve `sortBy` through the finder *before* delegating. Upstream's
 * `sortAlbums` falls back to `DateModified` for an unknown key while upstream's
 * `findSortOptionMetadata` falls back to `MostRecentPhoto` — passing an unknown
 * key straight through would show one option's label while applying another's
 * order.
 */
export const sortSpaceAlbums = (
  albums: SharedSpaceLinkedAlbumDto[],
  { sortBy, orderBy: order }: { sortBy: string; orderBy: string },
): SharedSpaceLinkedAlbumDto[] => {
  const { id } = findSpaceAlbumSortOptionMetadata(sortBy);

  if (id === SpaceAlbumSortBy.RecentlyLinked) {
    return orderBy(albums, [({ linkedAt }) => new Date(linkedAt)], [stringToSortOrder(order)]);
  }

  return sortAlbums(albums as unknown as AlbumResponseDto[], {
    sortBy: id,
    orderBy: order,
  }) as unknown as SharedSpaceLinkedAlbumDto[];
};
