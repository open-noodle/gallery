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
  ),
  SpaceAlbum(
    id: 'album-a-italy-summary',
    name: 'Italy 2022 summary',
    assetCount: 10,
    showInTimeline: true,
    linkedAt: DateTime.utc(2026, 1, 5),
    updatedAt: DateTime.utc(2026, 1, 25),
  ),
  SpaceAlbum(
    id: 'album-sachsen',
    name: 'Sächsische Schweiz Wanderung',
    assetCount: 25,
    showInTimeline: true,
    linkedAt: DateTime.utc(2026, 2, 1),
    updatedAt: DateTime.utc(2026, 1, 10),
  ),
  SpaceAlbum(
    id: 'album-alps',
    name: 'Alps Weekend',
    assetCount: 1,
    showInTimeline: true,
    linkedAt: DateTime.utc(2026, 1, 15),
    updatedAt: DateTime.utc(2026, 2, 10),
  ),
  SpaceAlbum(
    id: 'dup-2',
    name: 'Documentary Duplicate',
    assetCount: 3,
    showInTimeline: true,
    linkedAt: DateTime.utc(2026, 1, 1),
    updatedAt: DateTime.utc(2026, 1, 1),
  ),
  SpaceAlbum(
    id: 'dup-1',
    name: 'Documentary Duplicate',
    assetCount: 3,
    showInTimeline: true,
    linkedAt: DateTime.utc(2026, 1, 1),
    updatedAt: DateTime.utc(2026, 1, 1),
  ),
];

SpaceAlbum _album({
  required String id,
  required String name,
  int assetCount = 0,
  DateTime? linkedAt,
  DateTime? updatedAt,
}) => SpaceAlbum(
  id: id,
  name: name,
  assetCount: assetCount,
  showInTimeline: true,
  linkedAt: linkedAt ?? DateTime.utc(2026, 1, 1),
  updatedAt: updatedAt ?? DateTime.utc(2026, 1, 1),
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
      expect(
        filterAndSortSpaces(items, '', SpaceSortMode.members, false).map((s) => s.id).toList(),
        ['has-members', 'present-null'],
      );

      // recentActivity: present-but-null lastActivityAt falls back to
      // updatedAt (not a crash on a null `.value`); hasMembers' real
      // lastActivityAt (Feb 1) is later than presentNullSpace's fallback
      // updatedAt (Jan 5).
      expect(filterAndSortSpaces(items, '', SpaceSortMode.recentActivity, false).first.id, 'has-members');
    });
  });

  group('sort-mode enum shape', () {
    test('SpaceAlbumSortMode carries storeIndex/label/defaultOrder and effectiveOrder', () {
      expect(SpaceAlbumSortMode.name.storeIndex, 0);
      expect(SpaceAlbumSortMode.name.defaultOrder, SortOrder.asc);
      expect(SpaceAlbumSortMode.name.effectiveOrder(false), SortOrder.asc);
      expect(SpaceAlbumSortMode.name.effectiveOrder(true), SortOrder.desc);

      expect(SpaceAlbumSortMode.photoCount.defaultOrder, SortOrder.desc);
      expect(SpaceAlbumSortMode.recentlyLinked.defaultOrder, SortOrder.desc);
      expect(SpaceAlbumSortMode.recentlyUpdated.defaultOrder, SortOrder.desc);

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
