import type { AlbumResponseDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { orderBy } from 'lodash-es';
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

export const spaceAlbumSortOptionsMetadata: SpaceAlbumSortOptionMetadata[] = [
  ...sortOptionsMetadata,
  {
    id: SpaceAlbumSortBy.RecentlyLinked,
    defaultOrder: SortOrder.Desc,
    columnStyle: 'text-center hidden xl:block xl:w-[15%] 2xl:w-[12%]',
  },
];

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
