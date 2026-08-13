import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/pages/library/spaces/collection_sort.dart';
import 'package:openapi/api.dart';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

List<String> names(List<SpaceAlbum> items) => items.map((a) => a.name).toList();

List<String> spaceNames(List<SharedSpaceResponseDto> items) => items.map((s) => s.name).toList();

/// Space-album fixtures exercising: diacritics (not folded), two "Italy 2022*"
/// names (substring + tie-break-by-name), rows whose `linkedAt` and
/// `updatedAt` disagree in overall order, differing `assetCount`s (including
/// a tie), and a same-name/same-count pair to prove the `id` tie-break.
final sample = <SpaceAlbum>[
  SpaceAlbum(
    id: 'album-b-italy',
    name: 'Italy 2022',
    assetCount: 10,
    showInTimeline: true,
    linkedAt: DateTime.utc(2026, 1, 5),
    updatedAt: DateTime.utc(2026, 1, 20),
    createdAt: DateTime.utc(2025, 3, 10),
  ),
  SpaceAlbum(
    id: 'album-a-italy-summary',
    name: 'Italy 2022 summary',
    assetCount: 10,
    showInTimeline: true,
    linkedAt: DateTime.utc(2026, 1, 5),
    updatedAt: DateTime.utc(2026, 1, 25),
    createdAt: DateTime.utc(2025, 5, 22),
  ),
  SpaceAlbum(
    id: 'album-sachsen',
    name: 'Sächsische Schweiz Wanderung',
    assetCount: 25,
    showInTimeline: true,
    linkedAt: DateTime.utc(2026, 2, 1),
    updatedAt: DateTime.utc(2026, 1, 10),
    createdAt: DateTime.utc(2024, 11, 3),
  ),
  SpaceAlbum(
    id: 'album-alps',
    name: 'Alps Weekend',
    assetCount: 1,
    showInTimeline: true,
    linkedAt: DateTime.utc(2026, 1, 15),
    updatedAt: DateTime.utc(2026, 2, 10),
    createdAt: DateTime.utc(2026, 1, 2),
  ),
  SpaceAlbum(
    id: 'dup-2',
    name: 'Documentary Duplicate',
    assetCount: 3,
    showInTimeline: true,
    linkedAt: DateTime.utc(2026, 1, 1),
    updatedAt: DateTime.utc(2026, 1, 1),
    createdAt: DateTime.utc(2025, 8, 15),
  ),
  SpaceAlbum(
    id: 'dup-1',
    name: 'Documentary Duplicate',
    assetCount: 3,
    showInTimeline: true,
    linkedAt: DateTime.utc(2026, 1, 1),
    updatedAt: DateTime.utc(2026, 1, 1),
    createdAt: DateTime.utc(2025, 12, 30),
  ),
];

SpaceAlbum _album({
  required String id,
  required String name,
  String? description,
  int assetCount = 0,
  DateTime? linkedAt,
  DateTime? updatedAt,
  DateTime? createdAt,
  DateTime? startDate,
  DateTime? endDate,
}) => SpaceAlbum(
  id: id,
  name: name,
  description: description,
  assetCount: assetCount,
  showInTimeline: true,
  linkedAt: linkedAt ?? DateTime.utc(2026, 1, 1),
  updatedAt: updatedAt ?? DateTime.utc(2026, 1, 1),
  createdAt: createdAt ?? DateTime.utc(2026, 1, 1),
  startDate: startDate,
  endDate: endDate,
);

/// Space fixtures. `space-d` has `lastActivityAt`/`memberCount`/`assetCount`
/// all absent (null-safety); `space-a`/`space-e` tie on `memberCount` and
/// `space-c`/`space-e` tie on `assetCount` to exercise the name tie-break.
final spacesSample = <SharedSpaceResponseDto>[
  SharedSpaceResponseDto(
    id: 'space-a',
    name: 'Family Photos',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-06-01T00:00:00Z',
    createdById: 'user-1',
    lastActivityAt: const Optional.present('2026-05-01T00:00:00Z'),
    memberCount: const Optional.present(8),
    assetCount: const Optional.present(500),
  ),
  SharedSpaceResponseDto(
    id: 'space-b',
    name: 'Travel 2024',
    createdAt: '2025-03-01T00:00:00Z',
    updatedAt: '2025-04-01T00:00:00Z',
    createdById: 'user-1',
    lastActivityAt: const Optional.present('2026-06-01T00:00:00Z'),
    memberCount: const Optional.present(2),
    assetCount: const Optional.present(42),
  ),
  SharedSpaceResponseDto(
    id: 'space-c',
    name: 'Team Project',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    createdById: 'user-1',
    lastActivityAt: const Optional.absent(),
    memberCount: const Optional.present(12),
    assetCount: const Optional.present(10),
  ),
  SharedSpaceResponseDto(
    id: 'space-d',
    name: 'Empty Space',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    createdById: 'user-1',
    lastActivityAt: const Optional.absent(),
    memberCount: const Optional.absent(),
    assetCount: const Optional.absent(),
  ),
  SharedSpaceResponseDto(
    id: 'space-e',
    name: 'Family Photos Archive',
    createdAt: '2025-06-15T00:00:00Z',
    updatedAt: '2025-06-15T00:00:00Z',
    createdById: 'user-1',
    lastActivityAt: const Optional.absent(),
    memberCount: const Optional.present(8),
    assetCount: const Optional.present(10),
  ),
];

void main() {
  group('filterAndSortSpaceAlbums — filter', () {
    test('empty query returns all', () {
      expect(filterAndSortSpaceAlbums(sample, '', SpaceAlbumSortMode.name, false).length, sample.length);
    });

    test('whitespace-only query returns all', () {
      expect(filterAndSortSpaceAlbums(sample, '   ', SpaceAlbumSortMode.name, false).length, sample.length);
    });

    test('case-insensitive substring', () {
      expect(names(filterAndSortSpaceAlbums(sample, 'ITA', SpaceAlbumSortMode.name, false)), [
        'Italy 2022',
        'Italy 2022 summary',
      ]);
      // Query is trimmed and matches anywhere in the name.
      expect(names(filterAndSortSpaceAlbums(sample, '  2022  ', SpaceAlbumSortMode.name, false)), [
        'Italy 2022',
        'Italy 2022 summary',
      ]);
    });

    test('diacritics are NOT folded', () {
      expect(filterAndSortSpaceAlbums(sample, 'säch', SpaceAlbumSortMode.name, false), isNotEmpty);
      expect(filterAndSortSpaceAlbums(sample, 'SÄCH', SpaceAlbumSortMode.name, false), isNotEmpty);
      expect(filterAndSortSpaceAlbums(sample, 'sach', SpaceAlbumSortMode.name, false), isEmpty);
    });

    test('no match on a non-empty list returns empty, source untouched', () {
      final before = List<SpaceAlbum>.of(sample);
      expect(filterAndSortSpaceAlbums(sample, 'zzz-no-such-album', SpaceAlbumSortMode.name, false), isEmpty);
      expect(sample, orderedEquals(before));
    });

    test('query matching every item returns full list', () {
      // Every fixture name contains a lowercase 'a' somewhere.
      expect(filterAndSortSpaceAlbums(sample, 'a', SpaceAlbumSortMode.name, false).length, sample.length);
    });

    test('regex-meta characters are treated literally, never as a pattern', () {
      for (final q in ['.*', '(', r'\', '*', '.', '[a-z]']) {
        expect(
          () => filterAndSortSpaceAlbums(sample, q, SpaceAlbumSortMode.name, false),
          returnsNormally,
          reason: 'query: $q',
        );
      }
      expect(filterAndSortSpaceAlbums(sample, '.*', SpaceAlbumSortMode.name, false), isEmpty);
    });
  });

  // #973 — web's album search box matches name OR description
  // (`space-albums-list.svelte`). Mobile matched the name only, so a query that
  // hit only a description found the album on web and nothing here.
  //
  // Kept on its own fixtures: the shared `sample` list has null descriptions
  // throughout, which is what keeps the group above honest about names.
  group('filterAndSortSpaceAlbums — description search', () {
    // 'chamonix' deliberately appears in one row's description and another's
    // name; 'City Break' carries no description at all.
    final described = <SpaceAlbum>[
      _album(id: 'd-alps', name: 'Alps Weekend', description: 'Hiking above Chamonix'),
      _album(id: 'd-city', name: 'City Break'),
      _album(id: 'd-market', name: 'Chamonix Market', description: 'Sunday stalls'),
    ];

    test('matches a description when the name does not', () {
      expect(names(filterAndSortSpaceAlbums(described, 'hiking', SpaceAlbumSortMode.name, false)), ['Alps Weekend']);
    });

    test('description matching is case-insensitive and trimmed, like the name', () {
      expect(names(filterAndSortSpaceAlbums(described, '  SUNDAY  ', SpaceAlbumSortMode.name, false)), [
        'Chamonix Market',
      ]);
    });

    test('name and description hits union without duplicating a row', () {
      expect(names(filterAndSortSpaceAlbums(described, 'chamonix', SpaceAlbumSortMode.name, false)), [
        'Alps Weekend',
        'Chamonix Market',
      ]);
    });

    test('a null description is skipped, not matched or thrown on', () {
      // The null-description row is still reachable by name...
      expect(names(filterAndSortSpaceAlbums(described, 'city', SpaceAlbumSortMode.name, false)), ['City Break']);
      // ...and a query that matches nothing anywhere stays empty rather than
      // matching the null row or blowing up on it.
      expect(filterAndSortSpaceAlbums(described, 'zzz-no-such-text', SpaceAlbumSortMode.name, false), isEmpty);
    });

    test('descriptions are not diacritic-folded either', () {
      final accented = [_album(id: 'd-a', name: 'Trip', description: 'Sächsische Schweiz')];
      expect(filterAndSortSpaceAlbums(accented, 'sächsische', SpaceAlbumSortMode.name, false), isNotEmpty);
      expect(filterAndSortSpaceAlbums(accented, 'sachsische', SpaceAlbumSortMode.name, false), isEmpty);
    });
  });

  group('filterAndSortSpaceAlbums — sort', () {
    test('name: default asc, reversed desc', () {
      expect(names(filterAndSortSpaceAlbums(sample, '', SpaceAlbumSortMode.name, false)).first, 'Alps Weekend');
      expect(
        names(filterAndSortSpaceAlbums(sample, '', SpaceAlbumSortMode.name, true)).first,
        'Sächsische Schweiz Wanderung',
      );
    });

    test('photoCount desc by default, reversed asc', () {
      expect(
        names(filterAndSortSpaceAlbums(sample, '', SpaceAlbumSortMode.photoCount, false)).first,
        'Sächsische Schweiz Wanderung',
      );
      expect(names(filterAndSortSpaceAlbums(sample, '', SpaceAlbumSortMode.photoCount, true)).first, 'Alps Weekend');
    });

    test('recentlyLinked uses linkedAt, recentlyUpdated uses updatedAt (not swapped)', () {
      final byLinked = filterAndSortSpaceAlbums(sample, '', SpaceAlbumSortMode.recentlyLinked, false);
      final byUpdated = filterAndSortSpaceAlbums(sample, '', SpaceAlbumSortMode.recentlyUpdated, false);

      // linkedAt desc: Sächsische (Feb 1) is the most-recently-linked album.
      expect(byLinked.first.name, 'Sächsische Schweiz Wanderung');
      // updatedAt desc: Alps Weekend (Feb 10) is the most-recently-updated album.
      expect(byUpdated.first.name, 'Alps Weekend');
      // The two orders genuinely disagree (not just reading the same field twice).
      expect(names(byLinked), isNot(equals(names(byUpdated))));

      // Reversed flips both independently: ascending linkedAt / updatedAt puts
      // the "Documentary Duplicate" pair (earliest on both fields) first.
      final byLinkedReversed = filterAndSortSpaceAlbums(sample, '', SpaceAlbumSortMode.recentlyLinked, true);
      final byUpdatedReversed = filterAndSortSpaceAlbums(sample, '', SpaceAlbumSortMode.recentlyUpdated, true);
      expect(byLinkedReversed.first.id, 'dup-1');
      expect(byUpdatedReversed.first.id, 'dup-1');
    });

    test('ties break deterministically by name then id', () {
      // "Italy 2022" and "Italy 2022 summary" tie on assetCount (10) and on
      // linkedAt; the name comparison resolves the tie.
      final byCount = filterAndSortSpaceAlbums(sample, 'italy', SpaceAlbumSortMode.photoCount, false);
      expect(names(byCount), ['Italy 2022', 'Italy 2022 summary']);

      // "Documentary Duplicate" appears twice with identical name, assetCount,
      // linkedAt and updatedAt; only `id` differs ('dup-1' < 'dup-2').
      final dups = filterAndSortSpaceAlbums(sample, 'duplicate', SpaceAlbumSortMode.photoCount, false);
      expect(dups.map((a) => a.id).toList(), ['dup-1', 'dup-2']);

      // Re-running the sort never reshuffles the tied group.
      final again = filterAndSortSpaceAlbums(sample, 'duplicate', SpaceAlbumSortMode.photoCount, false);
      expect(dups.map((a) => a.id).toList(), again.map((a) => a.id).toList());
    });

    test('search + sort compose: sort applies within the filtered subset', () {
      final filtered = filterAndSortSpaceAlbums(sample, 'italy', SpaceAlbumSortMode.recentlyUpdated, false);
      expect(names(filtered), ['Italy 2022 summary', 'Italy 2022']);

      // Clearing the query restores the full sorted list.
      final cleared = filterAndSortSpaceAlbums(sample, '', SpaceAlbumSortMode.recentlyUpdated, false);
      expect(cleared.length, sample.length);
    });

    test('empty list and single-item list do not throw', () {
      expect(filterAndSortSpaceAlbums(<SpaceAlbum>[], '', SpaceAlbumSortMode.name, false), isEmpty);
      final single = [_album(id: 'only', name: 'Solo')];
      expect(names(filterAndSortSpaceAlbums(single, '', SpaceAlbumSortMode.photoCount, true)), ['Solo']);
    });
  });

  group('filterAndSortSpaces — filter', () {
    test('empty query returns all', () {
      expect(filterAndSortSpaces(spacesSample, '', SpaceSortMode.name, false).length, spacesSample.length);
    });

    test('whitespace-only query returns all', () {
      expect(filterAndSortSpaces(spacesSample, '   ', SpaceSortMode.name, false).length, spacesSample.length);
    });

    test('case-insensitive substring', () {
      expect(spaceNames(filterAndSortSpaces(spacesSample, 'family', SpaceSortMode.name, false)), [
        'Family Photos',
        'Family Photos Archive',
      ]);
    });

    test('no match on a non-empty list returns empty, source untouched', () {
      final before = List<SharedSpaceResponseDto>.of(spacesSample);
      expect(filterAndSortSpaces(spacesSample, 'zzz-no-such-space', SpaceSortMode.name, false), isEmpty);
      expect(spacesSample, orderedEquals(before));
    });

    test('regex-meta characters are treated literally, never as a pattern', () {
      for (final q in ['.*', '(', r'\', '*']) {
        expect(
          () => filterAndSortSpaces(spacesSample, q, SpaceSortMode.name, false),
          returnsNormally,
          reason: 'query: $q',
        );
      }
      expect(filterAndSortSpaces(spacesSample, '.*', SpaceSortMode.name, false), isEmpty);
    });
  });

  group('filterAndSortSpaces — sort', () {
    test('name: default asc, reversed desc', () {
      expect(spaceNames(filterAndSortSpaces(spacesSample, '', SpaceSortMode.name, false)).first, 'Empty Space');
      expect(spaceNames(filterAndSortSpaces(spacesSample, '', SpaceSortMode.name, true)).first, 'Travel 2024');
    });

    test('recentActivity: falls back updatedAt -> createdAt, reversed flips', () {
      final byActivity = filterAndSortSpaces(spacesSample, '', SpaceSortMode.recentActivity, false);
      expect(spaceNames(byActivity).first, 'Travel 2024'); // lastActivityAt 2026-06-01, the latest
      expect(spaceNames(byActivity).last, 'Empty Space'); // absent -> updatedAt 2024-01-01, the earliest

      final reversed = filterAndSortSpaces(spacesSample, '', SpaceSortMode.recentActivity, true);
      expect(spaceNames(reversed).first, 'Empty Space');
    });

    test('dateCreated desc by default, reversed asc', () {
      expect(spaceNames(filterAndSortSpaces(spacesSample, '', SpaceSortMode.dateCreated, false)).first, 'Team Project');
      expect(spaceNames(filterAndSortSpaces(spacesSample, '', SpaceSortMode.dateCreated, true)).first, 'Empty Space');
    });

    test('members desc by default (absent treated as 0), ties break by name, reversed flips', () {
      final byMembers = filterAndSortSpaces(spacesSample, '', SpaceSortMode.members, false);
      expect(spaceNames(byMembers).first, 'Team Project'); // memberCount 12
      expect(spaceNames(byMembers).last, 'Empty Space'); // absent -> 0
      // 'Family Photos' (8) and 'Family Photos Archive' (8) tie; name breaks it.
      final tiedNames = spaceNames(byMembers).where((n) => n.startsWith('Family')).toList();
      expect(tiedNames, ['Family Photos', 'Family Photos Archive']);

      final reversed = filterAndSortSpaces(spacesSample, '', SpaceSortMode.members, true);
      expect(spaceNames(reversed).first, 'Empty Space');
      expect(spaceNames(reversed).last, 'Team Project');
    });

    test('photos desc by default (absent treated as 0), ties break by name, reversed flips', () {
      final byPhotos = filterAndSortSpaces(spacesSample, '', SpaceSortMode.photos, false);
      expect(spaceNames(byPhotos).first, 'Family Photos'); // assetCount 500
      expect(spaceNames(byPhotos).last, 'Empty Space'); // absent -> 0
      // 'Team Project' (10) and 'Family Photos Archive' (10) tie; name breaks it.
      final tiedIndexE = spaceNames(byPhotos).indexOf('Family Photos Archive');
      final tiedIndexC = spaceNames(byPhotos).indexOf('Team Project');
      expect(tiedIndexE, lessThan(tiedIndexC));

      final reversed = filterAndSortSpaces(spacesSample, '', SpaceSortMode.photos, true);
      expect(spaceNames(reversed).first, 'Empty Space');
      expect(spaceNames(reversed).last, 'Family Photos');
    });

    test('space with absent lastActivityAt/memberCount/assetCount does not throw and sorts stably', () {
      for (final mode in SpaceSortMode.values) {
        expect(() => filterAndSortSpaces(spacesSample, '', mode, false), returnsNormally, reason: 'mode: $mode');
        expect(() => filterAndSortSpaces(spacesSample, '', mode, true), returnsNormally, reason: 'mode: $mode');
      }
      // Deterministic across repeated calls (no arbitrary reshuffle).
      final first = filterAndSortSpaces(
        spacesSample,
        '',
        SpaceSortMode.recentActivity,
        false,
      ).map((s) => s.id).toList();
      final second = filterAndSortSpaces(
        spacesSample,
        '',
        SpaceSortMode.recentActivity,
        false,
      ).map((s) => s.id).toList();
      expect(first, second);
    });

    test('empty list and single-item list do not throw', () {
      expect(filterAndSortSpaces(<SharedSpaceResponseDto>[], '', SpaceSortMode.name, false), isEmpty);
      final single = [spacesSample.first];
      expect(spaceNames(filterAndSortSpaces(single, '', SpaceSortMode.photos, true)), [spacesSample.first.name]);
    });

    test('memberCount/lastActivityAt Optional.present(null) (explicit null, not absent) sorts as 0 / falls back '
        'without throwing', () {
      // `Optional.present(null)` is a distinct state from `Optional.absent()`
      // (the server explicitly sent `null` rather than omitting the field).
      // `.value` on a present Optional never throws (even when the value
      // itself is null), so the `isPresent` guards in `_members`/`_activity`
      // must not be the only thing standing between this and a NullCheck /
      // type-cast crash.
      final presentNullSpace = SharedSpaceResponseDto(
        id: 'present-null',
        name: 'Present Null',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-05T00:00:00Z',
        createdById: 'user-1',
        lastActivityAt: const Optional.present(null),
        memberCount: const Optional.present(null),
      );
      final hasMembers = SharedSpaceResponseDto(
        id: 'has-members',
        name: 'Has Members',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        createdById: 'user-1',
        lastActivityAt: const Optional.present('2026-02-01T00:00:00Z'),
        memberCount: const Optional.present(3),
      );
      final items = [presentNullSpace, hasMembers];

      for (final mode in SpaceSortMode.values) {
        expect(() => filterAndSortSpaces(items, '', mode, false), returnsNormally, reason: 'mode: $mode');
      }

      // members desc by default: present-but-null memberCount treated as 0,
      // sorting after the space with 3 members.
      expect(filterAndSortSpaces(items, '', SpaceSortMode.members, false).map((s) => s.id).toList(), [
        'has-members',
        'present-null',
      ]);

      // recentActivity: present-but-null lastActivityAt falls back to
      // updatedAt (not a crash on a null `.value`); hasMembers' real
      // lastActivityAt (Feb 1) is later than presentNullSpace's fallback
      // updatedAt (Jan 5).
      expect(filterAndSortSpaces(items, '', SpaceSortMode.recentActivity, false).first.id, 'has-members');
    });
  });

  group('space-album sort parity (#966)', () {
    SpaceAlbum a({
      required String id,
      required String name,
      DateTime? createdAt,
      DateTime? linkedAt,
      DateTime? startDate,
      DateTime? endDate,
      int assetCount = 0,
    }) => SpaceAlbum(
      id: id,
      name: name,
      showInTimeline: true,
      assetCount: assetCount,
      linkedAt: linkedAt ?? DateTime.utc(2026, 1, 1),
      updatedAt: DateTime.utc(2026, 1, 1),
      createdAt: createdAt ?? DateTime.utc(2026, 1, 1),
      startDate: startDate,
      endDate: endDate,
    );

    // The contract order from the design spec — the menu is built from
    // SpaceAlbumSortMode.values, so declaration order IS menu order.
    test('offers the seven contract options in order with the contract labels', () {
      expect(SpaceAlbumSortMode.values.map((m) => m.name), [
        'name',
        'photoCount',
        'recentlyUpdated',
        'dateCreated',
        'mostRecentPhoto',
        'oldestPhoto',
        'recentlyLinked',
      ]);
      expect(SpaceAlbumSortMode.values.map((m) => m.label), [
        'sort_title',
        'sort_items',
        'sort_modified',
        'sort_created',
        'sort_recent',
        'sort_oldest',
        'sort_recently_linked',
      ]);
    });

    test('defaults Title to ascending and every other option to descending', () {
      expect(SpaceAlbumSortMode.name.defaultOrder, SortOrder.asc);
      for (final mode in SpaceAlbumSortMode.values.where((m) => m != SpaceAlbumSortMode.name)) {
        expect(mode.defaultOrder, SortOrder.desc, reason: '${mode.name} should default to descending');
      }
    });

    // S6 / S9 — createdAt order is the reverse of linkedAt order here
    test('Date created and Recently linked read different fields', () {
      final items = [
        a(id: 'old', name: 'Old', createdAt: DateTime.utc(2026, 1, 1), linkedAt: DateTime.utc(2026, 3, 1)),
        a(id: 'new', name: 'New', createdAt: DateTime.utc(2026, 2, 1), linkedAt: DateTime.utc(2026, 2, 2)),
      ];
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.dateCreated, false)), ['New', 'Old']);
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.recentlyLinked, false)), ['Old', 'New']);
    });

    // S7 / S8 — B has the newest photo but also the oldest, so the two modes
    // must disagree at the same direction. Both default to descending:
    //   mostRecentPhoto desc -> B (Jan 20) then A (Jan 10)
    //   oldestPhoto     desc -> A (Jan 5)  then B (Jan 1)
    // A comparator reading the wrong field therefore fails rather than passing
    // by coincidence.
    test('Most recent photo and Oldest photo read different fields', () {
      final items = [
        a(id: 'a', name: 'A', startDate: DateTime.utc(2026, 1, 5), endDate: DateTime.utc(2026, 1, 10)),
        a(id: 'b', name: 'B', startDate: DateTime.utc(2026, 1, 1), endDate: DateTime.utc(2026, 1, 20)),
      ];
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.mostRecentPhoto, false)), ['B', 'A']);
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.oldestPhoto, false)), ['A', 'B']);
      // reversed
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.mostRecentPhoto, true)), ['A', 'B']);
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.oldestPhoto, true)), ['B', 'A']);
    });

    // S10 / S11 / S12 — matches upstream sortUnknownYearAlbums: last in BOTH directions
    test('albums with no photo dates sort last regardless of direction', () {
      final items = [
        a(id: 'empty', name: 'Empty'),
        a(id: 'full', name: 'HasPhotos', startDate: DateTime.utc(2026, 1, 1), endDate: DateTime.utc(2026, 1, 10)),
      ];
      for (final mode in [SpaceAlbumSortMode.mostRecentPhoto, SpaceAlbumSortMode.oldestPhoto]) {
        for (final isReverse in [false, true]) {
          expect(names(filterAndSortSpaceAlbums(items, '', mode, isReverse)), [
            'HasPhotos',
            'Empty',
          ], reason: '$mode isReverse=$isReverse');
        }
      }
    });

    // S14
    test('keeps every album when none has photo dates', () {
      final items = [a(id: '1', name: 'One'), a(id: '2', name: 'Two'), a(id: '3', name: 'Three')];
      final sorted = filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.mostRecentPhoto, false);
      expect(sorted, hasLength(3));
      expect(names(sorted).toSet(), {'One', 'Two', 'Three'});
    });

    // S15 — the repository truncates to a UTC day, so same-day albums arrive equal
    // and must fall through to the name/id tie-break rather than to time of day.
    test('same-day albums fall through to the tie-break', () {
      final items = [
        a(id: 'z', name: 'Zebra', endDate: DateTime.utc(2026, 1, 10)),
        a(id: 'a', name: 'Antelope', endDate: DateTime.utc(2026, 1, 10)),
      ];
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.mostRecentPhoto, false)), [
        'Antelope',
        'Zebra',
      ]);
    });

    // S17
    test('bulk-linked albums sharing a linkedAt tie-break by name then id', () {
      final linked = DateTime.utc(2026, 4, 1);
      final items = [
        a(id: 'c', name: 'Charlie', linkedAt: linked),
        a(id: 'a', name: 'Alpha', linkedAt: linked),
        a(id: 'b', name: 'Bravo', linkedAt: linked),
      ];
      expect(names(filterAndSortSpaceAlbums(items, '', SpaceAlbumSortMode.recentlyLinked, false)), [
        'Alpha',
        'Bravo',
        'Charlie',
      ]);
    });

    // S18 / S19
    test('handles empty and single-item lists for every mode and direction', () {
      final one = [a(id: 'only', name: 'Only')];
      for (final mode in SpaceAlbumSortMode.values) {
        for (final isReverse in [false, true]) {
          expect(filterAndSortSpaceAlbums(const [], '', mode, isReverse), isEmpty);
          expect(names(filterAndSortSpaceAlbums(one, '', mode, isReverse)), ['Only']);
        }
      }
    });

    // S21 — filtering still runs before sorting, for the new modes too
    test('filters by query before sorting', () {
      final items = [
        a(id: '1', name: 'Italy 2022', endDate: DateTime.utc(2026, 1, 20)),
        a(id: '2', name: 'Alps Weekend', endDate: DateTime.utc(2026, 1, 10)),
      ];
      expect(names(filterAndSortSpaceAlbums(items, 'alps', SpaceAlbumSortMode.mostRecentPhoto, false)), [
        'Alps Weekend',
      ]);
    });
  });

  group('sort-mode enum shape', () {
    test('SpaceAlbumSortMode carries storeIndex/label/defaultOrder and effectiveOrder', () {
      expect(SpaceAlbumSortMode.name.storeIndex, 0);
      expect(SpaceAlbumSortMode.name.defaultOrder, SortOrder.asc);
      expect(SpaceAlbumSortMode.name.effectiveOrder(false), SortOrder.asc);
      expect(SpaceAlbumSortMode.name.effectiveOrder(true), SortOrder.desc);

      expect(SpaceAlbumSortMode.photoCount.storeIndex, 1);
      expect(SpaceAlbumSortMode.photoCount.defaultOrder, SortOrder.desc);
      expect(SpaceAlbumSortMode.recentlyLinked.storeIndex, 2);
      expect(SpaceAlbumSortMode.recentlyLinked.defaultOrder, SortOrder.desc);
      expect(SpaceAlbumSortMode.recentlyUpdated.storeIndex, 3);
      expect(SpaceAlbumSortMode.recentlyUpdated.defaultOrder, SortOrder.desc);
      expect(SpaceAlbumSortMode.dateCreated.storeIndex, 4);
      expect(SpaceAlbumSortMode.dateCreated.defaultOrder, SortOrder.desc);
      expect(SpaceAlbumSortMode.mostRecentPhoto.storeIndex, 5);
      expect(SpaceAlbumSortMode.mostRecentPhoto.defaultOrder, SortOrder.desc);
      expect(SpaceAlbumSortMode.oldestPhoto.storeIndex, 6);
      expect(SpaceAlbumSortMode.oldestPhoto.defaultOrder, SortOrder.desc);

      // storeIndex is stable/unique (persisted later — must not collide).
      final indices = SpaceAlbumSortMode.values.map((m) => m.storeIndex).toSet();
      expect(indices.length, SpaceAlbumSortMode.values.length);
    });

    test('SpaceSortMode carries storeIndex/label/defaultOrder and effectiveOrder', () {
      expect(SpaceSortMode.name.defaultOrder, SortOrder.asc);
      expect(SpaceSortMode.recentActivity.defaultOrder, SortOrder.desc);
      expect(SpaceSortMode.dateCreated.defaultOrder, SortOrder.desc);
      expect(SpaceSortMode.members.defaultOrder, SortOrder.desc);
      expect(SpaceSortMode.photos.defaultOrder, SortOrder.desc);
      expect(SpaceSortMode.members.effectiveOrder(true), SortOrder.asc);

      final indices = SpaceSortMode.values.map((m) => m.storeIndex).toSet();
      expect(indices.length, SpaceSortMode.values.length);
    });
  });
}
