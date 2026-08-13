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

// Album description is `string`, space description is `string | null | undefined` — normalise both to
// '' so an absent description can never match (`''.includes(query)` is false for a non-empty query,
// and the converter only filters when the query is non-empty).
export const descriptionOf = (c: PickerCollection): string =>
  (c.kind === 'album' ? c.album.description : c.space.description) ?? '';

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

// Name or description, for albums and spaces alike. Upstream matches album descriptions in its
// album-only picker (#30462); this list mixes both kinds, and a user typing a word cannot tell which
// rows are albums and which are spaces, so both kinds match on the same fields.
export const matchesCollection = (c: PickerCollection, search: string): boolean =>
  matchesSearch(c.name, search) || matchesSearch(descriptionOf(c), search);

export enum CollectionModalRowType {
  NEW_ALBUM = 'newAlbum',
  NEW_SPACE = 'newSpace',
  SECTION = 'section',
  MESSAGE = 'message',
  COLLECTION_ITEM = 'collectionItem',
  /** "Add to space" — the space's own pool, offered as a child of an expanded space row (#965). */
  SPACE_POOL_CHILD = 'spacePoolChild',
}

export type CollectionModalRow = {
  type: CollectionModalRowType;
  selected?: boolean;
  multiSelected?: boolean;
  text?: string;
  collection?: PickerCollection;
  /** Space rows only: the space has linked albums, so clicking it toggles instead of selecting. */
  expandable?: boolean;
  /** Space rows only: this space is the currently-expanded one. */
  expanded?: boolean;
  /** A child of an expanded space row — the pool, a linked album, or the empty-state message. */
  indented?: boolean;
};

export const isSelectableRowType = (type: CollectionModalRowType): boolean =>
  [
    CollectionModalRowType.NEW_ALBUM,
    CollectionModalRowType.NEW_SPACE,
    CollectionModalRowType.COLLECTION_ITEM,
    CollectionModalRowType.SPACE_POOL_CHILD,
  ].includes(type);

/**
 * Whether a space row can expand into linked-album children.
 *
 * `albumCount` comes back on every `GET /shared-spaces` row, so this needs no extra request —
 * that is the whole point of the accordion: a space's albums are fetched only once the user
 * asks for them. An absent count (older server) reads as "nothing to expand into".
 */
const isExpandableSpace = (collection: PickerCollection): boolean =>
  collection.kind === 'space' && (collection.space.albumCount ?? 0) > 0;

export class CollectionModalRowConverter {
  toModalRows(
    search: string,
    recent: PickerCollection[],
    all: PickerCollection[],
    selectedRowIndex: number,
    multiSelectedKeys: string[],
    options: {
      showSpaces: boolean;
      allowCreate?: boolean;
      emptyText?: string;
      noMatchText?: string;
      /** The one space currently expanded into its linked albums, if any (#965). */
      expandedSpaceId?: string | null;
      /**
       * The expanded space's linked albums. `undefined` means the request is still in flight —
       * distinct from `[]`, which means the space genuinely has none.
       */
      expandedSpaceAlbums?: PickerCollection[];
    },
  ): CollectionModalRow[] {
    const $t = get(t);
    // Restricted mode passes allowCreate:false — a freshly created album is not linked to the
    // space, so cross-owner contributions could never land in it.
    const allowCreate = options.allowCreate ?? true;
    const rows: CollectionModalRow[] = allowCreate
      ? [{ type: CollectionModalRowType.NEW_ALBUM, selected: selectedRowIndex === 0 }]
      : [];
    if (allowCreate && options.showSpaces) {
      rows.push({ type: CollectionModalRowType.NEW_SPACE, selected: selectedRowIndex === 1 });
    }
    const createCount = rows.length;

    const visible = options.showSpaces ? all : all.filter((c) => c.kind !== 'space');
    const isSearching = search.trim().length > 0;
    const recentToShow = isSearching ? [] : recent;
    const filtered = sortByNameAsc(isSearching ? visible.filter((c) => matchesCollection(c, search)) : visible);

    if (filtered.length === 0) {
      rows.push({
        type: CollectionModalRowType.MESSAGE,
        text:
          visible.length > 0
            ? (options.noMatchText ?? $t('no_albums_or_spaces_with_name'))
            : (options.emptyText ?? $t('no_albums_or_spaces_yet')),
      });
      return rows;
    }

    let index = createCount;
    const pushSelectable = (row: CollectionModalRow) => {
      rows.push({ ...row, selected: selectedRowIndex === index });
      index++;
    };
    const pushItem = (c: PickerCollection) => {
      pushSelectable({
        type: CollectionModalRowType.COLLECTION_ITEM,
        multiSelected: multiSelectedKeys.includes(collectionKey(c)),
        collection: c,
        expandable: isExpandableSpace(c),
        expanded: c.kind === 'space' && c.id === options.expandedSpaceId,
      });
      if (c.kind !== 'space' || c.id !== options.expandedSpaceId) {
        return;
      }
      // The pool keeps the space's own collection key, so ticking the parent row and ticking
      // "Add to space" are the same multi-select — they name the same destination.
      pushSelectable({
        type: CollectionModalRowType.SPACE_POOL_CHILD,
        multiSelected: multiSelectedKeys.includes(collectionKey(c)),
        collection: c,
        indented: true,
      });
      const linked = options.expandedSpaceAlbums;
      if (linked === undefined) {
        return; // still loading — anything else here would be a claim we cannot back yet
      }
      if (linked.length === 0) {
        rows.push({ type: CollectionModalRowType.MESSAGE, text: $t('no_albums_in_space_yet'), indented: true });
        return;
      }
      for (const child of linked) {
        pushSelectable({
          type: CollectionModalRowType.COLLECTION_ITEM,
          multiSelected: multiSelectedKeys.includes(collectionKey(child)),
          collection: child,
          indented: true,
        });
      }
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
