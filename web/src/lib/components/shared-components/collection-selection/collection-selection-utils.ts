// collection-selection-utils.ts
import { SharedSpaceRole, type AlbumResponseDto, type SharedSpaceResponseDto } from '@immich/sdk';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { normalizeSearchString } from '$lib/utils/string-utils';

export type PickerCollection =
  | { kind: 'album'; id: string; name: string; album: AlbumResponseDto }
  | { kind: 'space'; id: string; name: string; space: SharedSpaceResponseDto };

export const collectionKey = (c: PickerCollection): string => `${c.kind}:${c.id}`;

export const albumToCollection = (album: AlbumResponseDto): PickerCollection => ({
  kind: 'album',
  id: album.id,
  name: album.albumName,
  album,
});

export const spaceToCollection = (space: SharedSpaceResponseDto): PickerCollection => ({
  kind: 'space',
  id: space.id,
  name: space.name,
  space,
});

export const isWritableSpace = (space: SharedSpaceResponseDto, currentUserId: string | null): boolean => {
  if (currentUserId && space.createdById === currentUserId) {
    return true;
  }
  const role = space.members?.find((member) => member.userId === currentUserId)?.role;
  return role === SharedSpaceRole.Owner || role === SharedSpaceRole.Editor;
};

export const recencyOf = (c: PickerCollection): number =>
  c.kind === 'album'
    ? new Date(c.album.updatedAt).getTime()
    : new Date(c.space.lastActivityAt ?? c.space.createdAt).getTime();

export const sortByNameAsc = (collections: PickerCollection[]): PickerCollection[] =>
  [...collections].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

export const pickRecent = (collections: PickerCollection[], limit = 3): PickerCollection[] =>
  [...collections].sort((a, b) => recencyOf(b) - recencyOf(a)).slice(0, limit);

export const isValidNewSpaceName = (name: string): boolean => {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 100;
};

// `normalizeSearchString` is re-exported intentionally so the converter (Task 2) and
// row components share one matcher. (Imported above to keep a single source of truth.)
export const matchesSearch = (name: string, search: string): boolean =>
  normalizeSearchString(name).includes(normalizeSearchString(search));

export enum CollectionModalRowType {
  NEW_ALBUM = 'newAlbum',
  NEW_SPACE = 'newSpace',
  SECTION = 'section',
  MESSAGE = 'message',
  COLLECTION_ITEM = 'collectionItem',
}

export type CollectionModalRow = {
  type: CollectionModalRowType;
  selected?: boolean;
  multiSelected?: boolean;
  text?: string;
  collection?: PickerCollection;
};

export const isSelectableRowType = (type: CollectionModalRowType): boolean =>
  [CollectionModalRowType.NEW_ALBUM, CollectionModalRowType.NEW_SPACE, CollectionModalRowType.COLLECTION_ITEM].includes(
    type,
  );

export class CollectionModalRowConverter {
  toModalRows(
    search: string,
    recent: PickerCollection[],
    all: PickerCollection[],
    selectedRowIndex: number,
    multiSelectedKeys: string[],
    options: { showSpaces: boolean },
  ): CollectionModalRow[] {
    const $t = get(t);
    const rows: CollectionModalRow[] = [{ type: CollectionModalRowType.NEW_ALBUM, selected: selectedRowIndex === 0 }];
    if (options.showSpaces) {
      rows.push({ type: CollectionModalRowType.NEW_SPACE, selected: selectedRowIndex === 1 });
    }
    const createCount = rows.length;

    const visible = options.showSpaces ? all : all.filter((c) => c.kind !== 'space');
    const isSearching = search.trim().length > 0;
    const recentToShow = isSearching ? [] : recent;
    const filtered = sortByNameAsc(isSearching ? visible.filter((c) => matchesSearch(c.name, search)) : visible);

    if (filtered.length === 0) {
      rows.push({
        type: CollectionModalRowType.MESSAGE,
        text: visible.length > 0 ? $t('no_albums_or_spaces_with_name') : $t('no_albums_or_spaces_yet'),
      });
      return rows;
    }

    let index = createCount;
    const pushItem = (c: PickerCollection) => {
      rows.push({
        type: CollectionModalRowType.COLLECTION_ITEM,
        selected: selectedRowIndex === index,
        multiSelected: multiSelectedKeys.includes(collectionKey(c)),
        collection: c,
      });
      index++;
    };

    if (recentToShow.length > 0) {
      rows.push({ type: CollectionModalRowType.SECTION, text: $t('recent').toUpperCase() });
      for (const c of recentToShow) {
        pushItem(c);
      }
    }

    rows.push({ type: CollectionModalRowType.SECTION, text: $t('all_albums_and_spaces').toUpperCase() });
    for (const c of filtered) {
      pushItem(c);
    }
    return rows;
  }
}
