import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/infrastructure/repositories/people.repository.dart';

import '../../medium/repository_context.dart';

void main() {
  late MediumRepositoryContext ctx;
  late PeopleRepository sut;
  late String userId;
  late String assetId;

  setUp(() async {
    ctx = MediumRepositoryContext();
    sut = PeopleRepository(ctx.db);
    final user = await ctx.newUser();
    userId = user.id;
    final asset = await ctx.newRemoteAsset(ownerId: userId);
    assetId = asset.id;
  });

  tearDown(() async {
    await ctx.dispose();
  });

  /// Inserts a person with [faces] visible face rows on the shared asset.
  Future<String> seedPerson({
    required String id,
    String name = '',
    bool isFavorite = false,
    bool isHidden = false,
    int faces = 3,
  }) async {
    await ctx.newPerson(id: id, ownerId: userId, name: name, isFavorite: isFavorite, isHidden: isHidden);
    for (var i = 0; i < faces; i++) {
      // Fixed dimensions: newFace's randomized sizes can roll imageWidth == 1,
      // which makes its internal randInt(imageWidth - 1) throw a RangeError.
      await ctx.newFace(assetId: assetId, personId: id, imageWidth: 1000, imageHeight: 1000);
    }
    return id;
  }

  group('getAllPeople', () {
    test('photoCount mode: favorites first, then named by face count, unnamed last', () async {
      await seedPerson(id: 'named-mid', name: 'Zoe', faces: 5);
      await seedPerson(id: 'unnamed-high', faces: 9);
      await seedPerson(id: 'named-top', name: 'Mara', faces: 7);
      await seedPerson(id: 'fav-unnamed', isFavorite: true, faces: 3);
      await seedPerson(id: 'fav-named', name: 'Ada', isFavorite: true, faces: 3);

      final people = await sut.getAllPeople(sortBy: PeopleSortBy.photoCount);

      expect(people.map((p) => p.id), ['fav-named', 'fav-unnamed', 'named-top', 'named-mid', 'unnamed-high']);
    });

    test('photoCount mode: equal counts tie-break by name then id', () async {
      await seedPerson(id: 'tie-b', name: 'bob', faces: 4);
      await seedPerson(id: 'tie-a', name: 'Alice', faces: 4);
      await seedPerson(id: 'u-b', faces: 4);
      await seedPerson(id: 'u-a', faces: 4);

      final people = await sut.getAllPeople(sortBy: PeopleSortBy.photoCount);

      expect(people.map((p) => p.id), ['tie-a', 'tie-b', 'u-a', 'u-b']);
    });

    test('name mode: named A-Z case-insensitively ignoring counts, unnamed by count last', () async {
      await seedPerson(id: 'named-b', name: 'bob', faces: 9);
      await seedPerson(id: 'named-a', name: 'Alice', faces: 3);
      await seedPerson(id: 'unnamed-low', faces: 4);
      await seedPerson(id: 'unnamed-high', faces: 6);

      final people = await sut.getAllPeople(sortBy: PeopleSortBy.name);

      expect(people.map((p) => p.id), ['named-a', 'named-b', 'unnamed-high', 'unnamed-low']);
    });

    test('whitespace-only names land in the unnamed tier in both modes', () async {
      await seedPerson(id: 'blank', name: '  ', faces: 9);
      await seedPerson(id: 'named', name: 'Zoe', faces: 3);

      for (final mode in PeopleSortBy.values) {
        final people = await sut.getAllPeople(sortBy: mode);
        expect(people.map((p) => p.id), ['named', 'blank'], reason: 'mode: $mode');
      }
    });

    test('defaults to photoCount ordering when no mode is passed', () async {
      await seedPerson(id: 'named-small', name: 'Alice', faces: 3);
      await seedPerson(id: 'named-big', name: 'Zoe', faces: 8);

      final people = await sut.getAllPeople();

      expect(people.map((p) => p.id), ['named-big', 'named-small']);
    });

    test('keeps exclusion rules: hidden people and unnamed people with fewer than 3 faces', () async {
      await seedPerson(id: 'hidden', name: 'Hidden', isHidden: true, faces: 9);
      await seedPerson(id: 'unnamed-two-faces', faces: 2);
      await seedPerson(id: 'named-one-face', name: 'Solo', faces: 1);

      final people = await sut.getAllPeople(sortBy: PeopleSortBy.photoCount);

      expect(people.map((p) => p.id), ['named-one-face']);
    });
  });

  // The local people list became reactive upstream (#30660): the provider is a StreamProvider
  // over this watch(), which is why the fork's edit modals no longer invalidate it. These pin
  // that the stream actually re-emits — a watch() that silently degraded to a one-shot read
  // would leave every local people surface stale with no other test noticing.
  group('watch', () {
    test('re-emits when a person is renamed', () async {
      await seedPerson(id: 'p1', name: 'Alice');

      // Deterministic, not timing-based: drift schedules the initial emission on listen, so
      // drain the event queue and assert the settled state BEFORE mutating. Attaching the
      // matcher concurrently with the write races the initial query and can coalesce the
      // two emissions into one.
      final emissions = <List<String>>[];
      final sub = sut
          .watch(sortBy: PeopleSortBy.photoCount)
          .listen((people) => emissions.add(people.map((p) => p.name).toList()));
      await pumpEventQueue();
      expect(emissions.last, ['Alice']);

      await sut.updateName('p1', 'Alicia');
      await pumpEventQueue();

      expect(emissions.last, ['Alicia']);
      await sub.cancel();
    });

    test('re-emits when a face link crosses the minFaces threshold', () async {
      await seedPerson(id: 'p1', faces: 2); // unnamed and below the threshold: not emitted yet

      final emissions = <List<String>>[];
      final sub = sut
          .watch(sortBy: PeopleSortBy.photoCount)
          .listen((people) => emissions.add(people.map((p) => p.id).toList()));
      await pumpEventQueue();
      expect(emissions.last, isEmpty);

      await ctx.newFace(assetId: assetId, personId: 'p1', imageWidth: 1000, imageHeight: 1000);
      await pumpEventQueue();

      expect(emissions.last, ['p1']);
      await sub.cancel();
    });

    test('two sortBy family members order independently', () async {
      await seedPerson(id: 'b-many', name: 'Bob', faces: 5);
      await seedPerson(id: 'a-few', name: 'Ann', faces: 3);

      expect((await sut.watch(sortBy: PeopleSortBy.photoCount).first).map((p) => p.id), ['b-many', 'a-few']);
      expect((await sut.watch(sortBy: PeopleSortBy.name).first).map((p) => p.id), ['a-few', 'b-many']);
    });

    test('the first emission equals getAllPeople', () async {
      await seedPerson(id: 'p1', name: 'Alice');
      await seedPerson(id: 'p2', faces: 5);

      expect(await sut.watch().first, await sut.getAllPeople());
    });
  });
}
