// collection-selection-utils.spec.ts
import { SharedSpaceRole, type AlbumResponseDto, type SharedSpaceResponseDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import {
  albumToCollection,
  collectionKey,
  isValidNewSpaceName,
  isWritableSpace,
  pickRecent,
  recencyOf,
  sortByNameAsc,
  spaceToCollection,
} from './collection-selection-utils';
import { CollectionModalRowConverter, CollectionModalRowType, isSelectableRowType } from './collection-selection-utils';

const album = (id: string, name: string, updatedAt = '2024-01-01T00:00:00Z') =>
  ({ id, albumName: name, updatedAt, assetCount: 0, shared: false }) as unknown as AlbumResponseDto;
const space = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    name,
    createdById: 'me',
    createdAt: '2024-01-01T00:00:00Z',
    members: [],
    ...extra,
  }) as unknown as SharedSpaceResponseDto;

describe('collection helpers', () => {
  it('builds discriminated collections with stable keys', () => {
    const a = albumToCollection(album('a1', 'Trip'));
    const s = spaceToCollection(space('s1', 'Trip'));
    expect(a.kind).toBe('album');
    expect(s.kind).toBe('space');
    expect(collectionKey(a)).toBe('album:a1');
    expect(collectionKey(s)).toBe('space:s1');
    // same id across types must not collide
    expect(collectionKey(albumToCollection(album('x', 'A')))).not.toBe(
      collectionKey(spaceToCollection(space('x', 'A'))),
    );
  });

  it('treats owner and editor as writable, viewer as not', () => {
    expect(isWritableSpace(space('s', 'n', { createdById: 'me' }), 'me')).toBe(true);
    expect(
      isWritableSpace(
        space('s', 'n', { createdById: 'other', members: [{ userId: 'me', role: SharedSpaceRole.Editor }] }),
        'me',
      ),
    ).toBe(true);
    expect(
      isWritableSpace(
        space('s', 'n', { createdById: 'other', members: [{ userId: 'me', role: SharedSpaceRole.Viewer }] }),
        'me',
      ),
    ).toBe(false);
    expect(isWritableSpace(space('s', 'n', { createdById: 'other', members: [] }), 'me')).toBe(false);
    expect(isWritableSpace(space('s', 'n', { createdById: 'other', members: [] }), null)).toBe(false);
  });

  it('ranks recency: album updatedAt, space lastActivityAt ?? createdAt', () => {
    const a = albumToCollection(album('a', 'A', '2024-05-01T00:00:00Z'));
    const sActive = spaceToCollection(space('s1', 'S1', { lastActivityAt: '2024-06-01T00:00:00Z' }));
    const sNoActivity = spaceToCollection(
      space('s2', 'S2', { lastActivityAt: null, createdAt: '2024-01-01T00:00:00Z' }),
    );
    expect(recencyOf(sActive)).toBeGreaterThan(recencyOf(a));
    expect(recencyOf(a)).toBeGreaterThan(recencyOf(sNoActivity));
    expect(pickRecent([sNoActivity, a, sActive], 2).map((c) => c.id)).toEqual(['s1', 'a']);
  });

  it('sorts by name case-insensitively', () => {
    const list = [spaceToCollection(space('s', 'banana')), albumToCollection(album('a', 'Apple'))];
    expect(sortByNameAsc(list).map((c) => c.name)).toEqual(['Apple', 'banana']);
  });

  it('validates new space names (1..100 chars, trimmed)', () => {
    expect(isValidNewSpaceName('')).toBe(false);
    expect(isValidNewSpaceName(' '.repeat(3))).toBe(false);
    expect(isValidNewSpaceName('Family')).toBe(true);
    expect(isValidNewSpaceName('x'.repeat(101))).toBe(false);
    expect(isValidNewSpaceName('x'.repeat(100))).toBe(true);
  });
});

describe('CollectionModalRowConverter', () => {
  const conv = new CollectionModalRowConverter();
  const a = (id: string, name: string, extra: Record<string, unknown> = {}) =>
    albumToCollection({ ...album(id, name), ...extra } as AlbumResponseDto);
  const s = (id: string, name: string, extra: Record<string, unknown> = {}) =>
    spaceToCollection(space(id, name, extra));
  const opts = { showSpaces: true };

  it('always emits New Album then New Space first when spaces shown', () => {
    const rows = conv.toModalRows('', [], [], -1, [], opts);
    expect(rows[0].type).toBe(CollectionModalRowType.NEW_ALBUM);
    expect(rows[1].type).toBe(CollectionModalRowType.NEW_SPACE);
  });

  it('omits New Space and all spaces when showSpaces is false (over-cap)', () => {
    const rows = conv.toModalRows('', [a('a', 'A')], [a('a', 'A')], -1, [], { showSpaces: false });
    expect(rows.find((r) => r.type === CollectionModalRowType.NEW_SPACE)).toBeUndefined();
    // create-row offset is now 1: index 0 = New Album, index 1 = first item
    expect(rows[0].type).toBe(CollectionModalRowType.NEW_ALBUM);
  });

  it('shows both same-name collections with correct kind', () => {
    const all = [a('a1', 'Tuscany 2024'), s('s1', 'Tuscany 2024')];
    const rows = conv
      .toModalRows('', [], all, -1, [], opts)
      .filter((r) => r.type === CollectionModalRowType.COLLECTION_ITEM);
    expect(rows.map((r) => r.collection!.kind).sort()).toEqual(['album', 'space']);
  });

  it('hides RECENT while searching and filters both types via normalize', () => {
    const all = [a('a1', 'Tüscany'), s('s1', 'Rome')];
    const rows = conv.toModalRows('tuscany', [a('a1', 'Tüscany')], all, -1, [], opts);
    expect(
      rows.find((r) => r.type === CollectionModalRowType.SECTION && r.text?.toUpperCase().includes('RECENT')),
    ).toBeUndefined();
    const items = rows.filter((r) => r.type === CollectionModalRowType.COLLECTION_ITEM);
    expect(items).toHaveLength(1);
    expect(items[0].collection!.id).toBe('a1');
  });

  it('matches descriptions as well as names, for albums and spaces alike', () => {
    const all = [
      a('a1', 'Vacances 2019', { description: 'Crete' }),
      s('s1', 'Sommer', { description: 'Crete again' }),
      a('a2', 'Construction'),
      s('s2', 'Renovation'),
    ];
    const items = conv
      .toModalRows('crete', [], all, -1, [], opts)
      .filter((r) => r.type === CollectionModalRowType.COLLECTION_ITEM);
    expect(items.map((r) => r.collection!.id).sort()).toEqual(['a1', 's1']);
  });

  it('normalizes description matches the same way it normalizes names', () => {
    const all = [a('a1', 'Trip', { description: 'Tüscany' }), s('s1', 'Other')];
    const items = conv
      .toModalRows('tuscany', [], all, -1, [], opts)
      .filter((r) => r.type === CollectionModalRowType.COLLECTION_ITEM);
    expect(items.map((r) => r.collection!.id)).toEqual(['a1']);
  });

  it('tolerates absent and null descriptions without matching everything', () => {
    // Space description is `string | null | undefined` in the SDK; album description may be ''.
    const all = [a('a1', 'Alpha', { description: '' }), s('s1', 'Beta', { description: null }), s('s2', 'Gamma')];
    const items = conv
      .toModalRows('zzz', [], all, -1, [], opts)
      .filter((r) => r.type === CollectionModalRowType.COLLECTION_ITEM);
    expect(items).toHaveLength(0);
  });

  it('focus offset is 2 (two create rows): index 2 selects the first item', () => {
    const all = [a('a1', 'A'), s('s1', 'B')];
    const rows = conv
      .toModalRows('', [], all, 2, [], opts)
      .filter((r) => r.type === CollectionModalRowType.COLLECTION_ITEM);
    expect(rows[0].selected).toBe(true);
    expect(rows[1].selected).toBe(false);
  });

  it('renders a RECENT section and shifts the ALL focus offset by the recent count', () => {
    const recent = [s('s1', 'B')];
    const all = [a('a1', 'A'), s('s1', 'B')]; // sorted ALL → A (album a1), B (space s1)
    const sections = conv
      .toModalRows('', recent, all, -1, [], opts)
      .filter((r) => r.type === CollectionModalRowType.SECTION)
      .map((r) => (r.text ?? '').toUpperCase());
    expect(sections[0]).toContain('RECENT'); // RECENT precedes ALL

    // selectable order: NewAlbum(0) NewSpace(1) recent[0](2) all[0](3) all[1](4)
    const selectedAt = (i: number) =>
      conv.toModalRows('', recent, all, i, [], opts).find((r) => r.selected && r.collection)?.collection;
    expect(selectedAt(2)?.id).toBe('s1'); // first RECENT item
    expect(selectedAt(3)?.id).toBe('a1'); // first ALL item — offset includes the 1 recent row
  });

  it('marks multiSelected rows by collectionKey', () => {
    const all = [a('a1', 'A'), s('s1', 'B')];
    const rows = conv
      .toModalRows('', [], all, -1, ['space:s1'], opts)
      .filter((r) => r.type === CollectionModalRowType.COLLECTION_ITEM);
    expect(rows.find((r) => r.collection!.id === 's1')!.multiSelected).toBe(true);
    expect(rows.find((r) => r.collection!.id === 'a1')!.multiSelected).toBe(false);
  });

  it('emits no-match message when search matches nothing but library is non-empty', () => {
    const rows = conv.toModalRows('zzz', [], [a('a1', 'A')], -1, [], opts);
    expect(rows.some((r) => r.type === CollectionModalRowType.MESSAGE)).toBe(true);
    expect(rows.some((r) => r.type === CollectionModalRowType.COLLECTION_ITEM)).toBe(false);
  });

  it('emits empty-library message when there is nothing at all', () => {
    const rows = conv.toModalRows('', [], [], -1, [], opts);
    expect(rows.some((r) => r.type === CollectionModalRowType.MESSAGE)).toBe(true);
  });

  it('isSelectableRowType: create rows and items are selectable, section/message are not', () => {
    expect(isSelectableRowType(CollectionModalRowType.NEW_ALBUM)).toBe(true);
    expect(isSelectableRowType(CollectionModalRowType.NEW_SPACE)).toBe(true);
    expect(isSelectableRowType(CollectionModalRowType.COLLECTION_ITEM)).toBe(true);
    expect(isSelectableRowType(CollectionModalRowType.SPACE_POOL_CHILD)).toBe(true);
    expect(isSelectableRowType(CollectionModalRowType.SECTION)).toBe(false);
    expect(isSelectableRowType(CollectionModalRowType.MESSAGE)).toBe(false);
  });

  it('excludes space items from the list when showSpaces is false', () => {
    const all = [a('a1', 'A'), s('s1', 'B')];
    const items = conv
      .toModalRows('', [], all, -1, [], { showSpaces: false })
      .filter((r) => r.type === CollectionModalRowType.COLLECTION_ITEM);
    expect(items).toHaveLength(1);
    expect(items[0].collection!.kind).toBe('album');
  });

  // #965: a space row with linked albums expands into "Add to space" plus one row per linked
  // album, mirroring mobile's SpaceCollectionSection. A linked album is an ordinary `album`
  // collection, so the dispatch (POST /albums/:id/assets) is unchanged.
  describe('space expansion (#965)', () => {
    const withAlbums = (id: string, name: string, albumCount: number) => s(id, name, { albumCount });
    const items = (rows: ReturnType<typeof conv.toModalRows>) =>
      rows.filter((r) => r.type === CollectionModalRowType.COLLECTION_ITEM);

    it('marks a space with linked albums expandable, and one without not', () => {
      const all = [withAlbums('s1', 'Family', 2), s('s2', 'Empty', { albumCount: 0 }), s('s3', 'Unknown')];
      const rows = items(conv.toModalRows('', [], all, -1, [], opts));
      expect(rows.find((r) => r.collection!.id === 's1')!.expandable).toBe(true);
      expect(rows.find((r) => r.collection!.id === 's2')!.expandable).toBe(false);
      // albumCount absent (older server) — treated as "nothing to expand into".
      expect(rows.find((r) => r.collection!.id === 's3')!.expandable).toBe(false);
    });

    it('emits no children until the space is the expanded one', () => {
      const all = [withAlbums('s1', 'Family', 2)];
      const rows = conv.toModalRows('', [], all, -1, [], opts);
      expect(rows.some((r) => r.type === CollectionModalRowType.SPACE_POOL_CHILD)).toBe(false);
      expect(rows.find((r) => r.collection?.id === 's1')!.expanded).toBe(false);
    });

    it('expands into the pool child then one indented album row per linked album', () => {
      const all = [withAlbums('s1', 'Family', 2)];
      const rows = conv.toModalRows('', [], all, -1, [], {
        ...opts,
        expandedSpaceId: 's1',
        expandedSpaceAlbums: [a('sa1', 'Holiday'), a('sa2', 'Birthday')],
      });
      const kinds = rows
        .filter(
          (r) =>
            r.type === CollectionModalRowType.COLLECTION_ITEM || r.type === CollectionModalRowType.SPACE_POOL_CHILD,
        )
        .map((r) => `${r.type}:${r.collection!.id}`);
      expect(kinds).toEqual([
        `${CollectionModalRowType.COLLECTION_ITEM}:s1`,
        `${CollectionModalRowType.SPACE_POOL_CHILD}:s1`,
        `${CollectionModalRowType.COLLECTION_ITEM}:sa1`,
        `${CollectionModalRowType.COLLECTION_ITEM}:sa2`,
      ]);
      expect(rows.find((r) => r.collection?.id === 's1')!.expanded).toBe(true);
      // The children are the ones that carry the indent, not the space row itself.
      expect(rows.find((r) => r.type === CollectionModalRowType.SPACE_POOL_CHILD)!.indented).toBe(true);
      expect(rows.find((r) => r.collection?.id === 'sa1')!.indented).toBe(true);
      expect(rows.find((r) => r.collection?.id === 's1')!.indented).toBeFalsy();
    });

    it('emits only the pool child while the albums are still loading', () => {
      const all = [withAlbums('s1', 'Family', 2)];
      // `expandedSpaceAlbums` undefined == request in flight. Showing "no albums yet" here would
      // be a lie that flashes on every expand.
      const rows = conv.toModalRows('', [], all, -1, [], { ...opts, expandedSpaceId: 's1' });
      expect(rows.some((r) => r.type === CollectionModalRowType.SPACE_POOL_CHILD)).toBe(true);
      expect(rows.some((r) => r.type === CollectionModalRowType.MESSAGE)).toBe(false);
      expect(items(rows)).toHaveLength(1); // the space row only
    });

    it('explains an expanded space that turned out to have no linked albums', () => {
      const all = [withAlbums('s1', 'Family', 2)];
      const rows = conv.toModalRows('', [], all, -1, [], {
        ...opts,
        expandedSpaceId: 's1',
        expandedSpaceAlbums: [],
      });
      const message = rows.find((r) => r.type === CollectionModalRowType.MESSAGE);
      expect(message!.text).toBe('no_albums_in_space_yet');
      expect(message!.indented).toBe(true);
    });

    it('keeps arrow-key order flat: children take the indices right after their space', () => {
      const all = [a('a1', 'Aardvark'), withAlbums('s1', 'Family', 1)];
      const selectedAt = (i: number) =>
        conv.toModalRows('', [], all, i, [], {
          ...opts,
          expandedSpaceId: 's1',
          expandedSpaceAlbums: [a('sa1', 'Holiday')],
        });
      // NewAlbum(0) NewSpace(1) a1(2) s1(3) pool(4) sa1(5)
      expect(selectedAt(2).find((r) => r.selected && r.collection)!.collection!.id).toBe('a1');
      expect(selectedAt(3).find((r) => r.selected && r.collection)!.collection!.id).toBe('s1');
      const pool = selectedAt(4).find((r) => r.selected)!;
      expect(pool.type).toBe(CollectionModalRowType.SPACE_POOL_CHILD);
      expect(selectedAt(5).find((r) => r.selected && r.collection)!.collection!.id).toBe('sa1');
    });

    it('multi-selects a linked album by its own key, and the pool by the space key', () => {
      const all = [withAlbums('s1', 'Family', 1)];
      const rows = conv.toModalRows('', [], all, -1, ['album:sa1'], {
        ...opts,
        expandedSpaceId: 's1',
        expandedSpaceAlbums: [a('sa1', 'Holiday')],
      });
      expect(rows.find((r) => r.collection?.id === 'sa1')!.multiSelected).toBe(true);
      expect(rows.find((r) => r.type === CollectionModalRowType.SPACE_POOL_CHILD)!.multiSelected).toBe(false);
    });

    it('renders the children under every occurrence of the space, RECENT included', () => {
      const recent = [withAlbums('s1', 'Family', 1)];
      const all = [withAlbums('s1', 'Family', 1)];
      const rows = conv.toModalRows('', recent, all, -1, [], {
        ...opts,
        expandedSpaceId: 's1',
        expandedSpaceAlbums: [a('sa1', 'Holiday')],
      });
      // Same row, same affordance, in both sections — rather than the same row behaving
      // differently depending on which section it was rendered in.
      expect(rows.filter((r) => r.type === CollectionModalRowType.SPACE_POOL_CHILD)).toHaveLength(2);
      expect(rows.filter((r) => r.collection?.id === 'sa1')).toHaveLength(2);
    });

    it('emits nothing space-related when spaces are hidden, even if a space is marked expanded', () => {
      const all = [a('a1', 'A'), withAlbums('s1', 'Family', 1)];
      const rows = conv.toModalRows('', [], all, -1, [], {
        showSpaces: false,
        expandedSpaceId: 's1',
        expandedSpaceAlbums: [a('sa1', 'Holiday')],
      });
      expect(rows.some((r) => r.type === CollectionModalRowType.SPACE_POOL_CHILD)).toBe(false);
      expect(items(rows).map((r) => r.collection!.id)).toEqual(['a1']);
    });
  });

  // Restricted (space-contribution) mode: no create rows, and both empty-state messages
  // are overridable so they never name a collection type that was not on offer.
  describe('allowCreate / message overrides', () => {
    const restricted = { showSpaces: false, allowCreate: false };

    it('omits both create rows when allowCreate is false', () => {
      const rows = conv.toModalRows('', [], [a('a1', 'A')], -1, [], restricted);
      expect(rows.some((r) => r.type === CollectionModalRowType.NEW_ALBUM)).toBe(false);
      expect(rows.some((r) => r.type === CollectionModalRowType.NEW_SPACE)).toBe(false);
    });

    it('keeps row indices contiguous from 0 so keyboard navigation still lands on the first item', () => {
      const rows = conv.toModalRows('', [], [a('a1', 'A')], 0, [], restricted);
      const firstItem = rows.find((r) => r.type === CollectionModalRowType.COLLECTION_ITEM);
      // With no create rows consuming indices 0/1, selectedRowIndex 0 must select the first item.
      expect(firstItem!.selected).toBe(true);
    });

    it('uses emptyText when there is nothing to show', () => {
      const rows = conv.toModalRows('', [], [], -1, [], { ...restricted, emptyText: 'nothing here' });
      const message = rows.find((r) => r.type === CollectionModalRowType.MESSAGE);
      expect(message!.text).toBe('nothing here');
    });

    it('uses noMatchText when a search matches nothing', () => {
      const rows = conv.toModalRows('zzz', [], [a('a1', 'A')], -1, [], { ...restricted, noMatchText: 'no match' });
      const message = rows.find((r) => r.type === CollectionModalRowType.MESSAGE);
      expect(message!.text).toBe('no match');
    });

    it('falls back to the default messages when no override is supplied', () => {
      const empty = conv.toModalRows('', [], [], -1, [], { showSpaces: true });
      const noMatch = conv.toModalRows('zzz', [], [a('a1', 'A')], -1, [], { showSpaces: true });
      expect(empty.find((r) => r.type === CollectionModalRowType.MESSAGE)!.text).toBeTruthy();
      expect(noMatch.find((r) => r.type === CollectionModalRowType.MESSAGE)!.text).toBeTruthy();
    });
  });
});
