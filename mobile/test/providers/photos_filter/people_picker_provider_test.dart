import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/photos_filter/people_picker.provider.dart';

DriftPerson _d(String id, String name, {bool isHidden = false, int? numberOfAssets}) => DriftPerson(
  id: id,
  createdAt: DateTime(2024, 1, 1),
  updatedAt: DateTime(2024, 1, 1),
  ownerId: 'owner',
  name: name,
  isFavorite: false,
  isHidden: isHidden,
  color: null,
  numberOfAssets: numberOfAssets,
);

PersonDto _p(String id, String name) => PersonDto(id: id, name: name, isHidden: false, thumbnailPath: '');

// peoplePickerAllProvider sources driftGetAllPeopleWithSharedSpacesProvider (not the
// owner-scoped-only driftGetAllPeopleProvider) so the picker includes shared-space people,
// mirroring the web People picker. See slice 3 plan.
ProviderContainer _containerWith(List<DriftPerson> people) {
  return ProviderContainer(
    overrides: [driftGetAllPeopleWithSharedSpacesProvider.overrideWith((ref, sortBy) async => people)],
  );
}

void main() {
  group('peoplePickerAllProvider', () {
    test('excludes hidden people', () async {
      final c = _containerWith([_d('a', 'Alice'), _d('b', 'Bob', isHidden: true)]);
      addTearDown(c.dispose);
      final result = await c.read(peoplePickerAllProvider.future);
      expect(result.map((p) => p.id), ['a']);
    });

    test('excludes blank names', () async {
      final c = _containerWith([_d('a', 'Alice'), _d('b', '')]);
      addTearDown(c.dispose);
      final result = await c.read(peoplePickerAllProvider.future);
      expect(result.map((p) => p.id), ['a']);
    });

    test('maps DriftPerson to PersonDto with empty thumbnailPath', () async {
      final c = _containerWith([_d('a', 'Alice')]);
      addTearDown(c.dispose);
      final result = await c.read(peoplePickerAllProvider.future);
      expect(result.single.id, 'a');
      expect(result.single.name, 'Alice');
      expect(result.single.thumbnailPath, '');
      expect(result.single.isHidden, false);
    });

    test('pins photoCount ordering regardless of the people sort preference', () async {
      final c = ProviderContainer(
        overrides: [
          driftGetAllPeopleWithSharedSpacesProvider.overrideWith(
            (ref, sortBy) async => sortBy == PeopleSortBy.photoCount ? [_d('pinned', 'Alice')] : [_d('leaked', 'Bob')],
          ),
        ],
      );
      addTearDown(c.dispose);
      final result = await c.read(peoplePickerAllProvider.future);
      expect(result.map((p) => p.id), ['pinned']);
    });

    // Slice 3: the picker row's photo count reads straight off the already-fetched
    // DriftPerson — no extra network call.
    test('carries numberOfAssets from the source DriftPerson', () async {
      final c = _containerWith([
        _d('a', 'Alice', numberOfAssets: 1204),
        _d('b', 'Bob', numberOfAssets: 0),
        _d('c', 'Carol'),
      ]);
      addTearDown(c.dispose);
      final result = await c.read(peoplePickerAllProvider.future);
      expect(result.firstWhere((p) => p.id == 'a').numberOfAssets, 1204);
      expect(result.firstWhere((p) => p.id == 'b').numberOfAssets, 0);
      expect(result.firstWhere((p) => p.id == 'c').numberOfAssets, isNull);
    });
  });

  group('peoplePickerFilteredProvider', () {
    test('empty query returns full list', () async {
      final c = _containerWith([_d('a', 'Alice'), _d('b', 'Bob')]);
      addTearDown(c.dispose);
      final result = await c.read(peoplePickerFilteredProvider.future);
      expect(result.length, 2);
    });

    test('substring match (case-insensitive)', () async {
      final c = _containerWith([_d('a', 'Alice'), _d('b', 'Bob'), _d('c', 'Charlie')]);
      addTearDown(c.dispose);
      c.read(peoplePickerQueryProvider.notifier).state = 'aL';
      final result = await c.read(peoplePickerFilteredProvider.future);
      expect(result.map((p) => p.id), ['a']);
    });

    test('whitespace-only query returns full list', () async {
      final c = _containerWith([_d('a', 'Alice')]);
      addTearDown(c.dispose);
      c.read(peoplePickerQueryProvider.notifier).state = '   ';
      final result = await c.read(peoplePickerFilteredProvider.future);
      expect(result.length, 1);
    });

    test('non-matching query returns empty', () async {
      final c = _containerWith([_d('a', 'Alice')]);
      addTearDown(c.dispose);
      c.read(peoplePickerQueryProvider.notifier).state = 'zzzzz';
      final result = await c.read(peoplePickerFilteredProvider.future);
      expect(result, isEmpty);
    });
  });

  group('peopleAlphaIndex', () {
    test('ASCII first letter', () {
      final index = peopleAlphaIndex([_p('p1', 'Alice'), _p('p2', 'Bob')]);
      expect(index.keys, containsAll(['A', 'B']));
      expect(index['A']!.single.id, 'p1');
      expect(index['B']!.single.id, 'p2');
    });

    test('diacritics fold to base letter', () {
      final index = peopleAlphaIndex([_p('p1', 'Ångström'), _p('p2', 'Østergaard'), _p('p3', 'Čapek')]);
      expect(index['A']!.first.id, 'p1');
      expect(index['O']!.first.id, 'p2');
      expect(index['C']!.first.id, 'p3');
    });

    test('non-Latin name maps to #', () {
      final index = peopleAlphaIndex([_p('p1', '中村'), _p('p2', 'Алексей')]);
      expect(index['#']!.map((p) => p.id), containsAll(['p1', 'p2']));
    });

    test('empty name maps to #', () {
      final index = peopleAlphaIndex([_p('p1', '')]);
      expect(index['#']!.single.id, 'p1');
    });

    test('lowercase first letter is upper-cased', () {
      final index = peopleAlphaIndex([_p('p1', 'alice')]);
      expect(index['A']!.single.id, 'p1');
    });

    test('input order preserved within bucket', () {
      final index = peopleAlphaIndex([_p('p1', 'Adrian'), _p('p2', 'Alice'), _p('p3', 'Aaron')]);
      expect(index['A']!.map((p) => p.id), ['p1', 'p2', 'p3']);
    });
  });

  group('recentPeopleProvider', () {
    test('returns only people with updatedAt within last 7 days', () async {
      final now = DateTime.now();
      final c = _containerWith([
        _d('a', 'Alice').copyWith(updatedAt: now.subtract(const Duration(days: 1))),
        _d('b', 'Bob').copyWith(updatedAt: now.subtract(const Duration(days: 6))),
        _d('c', 'Carol').copyWith(updatedAt: now.subtract(const Duration(days: 8))),
      ]);
      addTearDown(c.dispose);
      final recent = await c.read(recentPeopleProvider.future);
      expect(recent.map((p) => p.id), ['a', 'b']);
    });

    test('caps result at 7 items, newest first', () async {
      final now = DateTime.now();
      final c = _containerWith([
        for (var i = 0; i < 10; i++) _d('p$i', 'P$i').copyWith(updatedAt: now.subtract(Duration(hours: i + 1))),
      ]);
      addTearDown(c.dispose);
      final recent = await c.read(recentPeopleProvider.future);
      expect(recent, hasLength(7));
      // p0 is newest, then p1, ..., p6.
      expect(recent.map((p) => p.id), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    });

    test('empty when no people updated in last 7 days', () async {
      final now = DateTime.now();
      final c = _containerWith([_d('a', 'Alice').copyWith(updatedAt: now.subtract(const Duration(days: 30)))]);
      addTearDown(c.dispose);
      expect(await c.read(recentPeopleProvider.future), isEmpty);
    });

    test('excludes hidden people via peoplePickerAllProvider', () async {
      final now = DateTime.now();
      final c = _containerWith([
        _d('a', 'Alice', isHidden: true).copyWith(updatedAt: now.subtract(const Duration(days: 1))),
      ]);
      addTearDown(c.dispose);
      expect(await c.read(recentPeopleProvider.future), isEmpty);
    });
  });
}
