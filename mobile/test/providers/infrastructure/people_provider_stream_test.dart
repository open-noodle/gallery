import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/dao/person.dart';
import 'package:immich_mobile/data/store.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/services/people.service.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:mocktail/mocktail.dart';

import '../../medium/repository_context.dart';

class MockPeopleService extends Mock implements PeopleService {}

void main() {
  setUpAll(() {
    registerFallbackValue(PeopleSortBy.photoCount);
    registerFallbackValue(PeopleFilterBy.all);
  });

  // The whole point of upstream #30660: because the local list is reactive, the fork's edit
  // modals stopped invalidating it. This is the end-to-end proof for the surface that still
  // reads it (the library people card, Store.people.all()) — real repository, real provider
  // over an in-memory DB, with no ref.invalidate anywhere in the test.
  test('library-card live update: a local rename re-emits with no invalidation', () async {
    final ctx = MediumRepositoryContext();
    addTearDown(ctx.dispose);
    final user = await ctx.newUser();
    final asset = await ctx.newRemoteAsset(ownerId: user.id);
    // A named person is admitted by the query's named OR-clause, so one face is enough.
    await ctx.newPerson(id: 'p1', ownerId: user.id, name: 'Alice', isFavorite: false, isHidden: false);
    await ctx.newFace(assetId: asset.id, personId: 'p1', imageWidth: 1000, imageHeight: 1000);

    final container = ProviderContainer(
      overrides: [
        driftProvider.overrideWithValue(ctx.db),
        Store.userMetadata.preferences().overrideWith((ref) => Stream.value(null)),
      ],
    );
    addTearDown(container.dispose);

    final names = <String>[];
    container.listen(Store.people.all(), (_, next) {
      final value = next.valueOrNull;
      if (value != null && value.isNotEmpty) {
        names.add(value.single.name);
      }
    }, fireImmediately: true);
    await container.read(Store.people.all().future);

    await PeopleDatabaseRepository(ctx.db).updateName('p1', 'Alicia');
    await pumpEventQueue(); // deterministic drain, not a sleep

    expect(names.last, 'Alicia');
  });

  group('driftGetAllPeopleWithSharedSpacesProvider filterBy', () {
    Future<void> expectFilterSent({required bool gallery, required PeopleFilterBy sent}) async {
      final service = MockPeopleService();
      when(
        () => service.getAllPeopleWithSharedSpaces(
          minFaces: any(named: 'minFaces'),
          sortBy: any(named: 'sortBy'),
          filterBy: any(named: 'filterBy'),
        ),
      ).thenAnswer((_) async => const <Person>[]);
      final container = ProviderContainer(
        overrides: [
          peopleServiceProvider.overrideWithValue(service),
          Store.userMetadata.preferences().overrideWith((ref) => Stream.value(null)),
          serverSupportsSpacesProvider.overrideWithValue(gallery),
        ],
      );
      addTearDown(container.dispose);

      await container.read(
        driftGetAllPeopleWithSharedSpacesProvider((sortBy: PeopleSortBy.name, filterBy: PeopleFilterBy.pets)).future,
      );

      verify(
        () => service.getAllPeopleWithSharedSpaces(minFaces: 3, sortBy: PeopleSortBy.name, filterBy: sent),
      ).called(1);
    }

    test(
      'passes a persisted Pets choice to a Gallery server',
      () => expectFilterSent(gallery: true, sent: PeopleFilterBy.pets),
    );

    test(
      'drops a persisted Pets choice on a stock Immich server',
      () => expectFilterSent(gallery: false, sent: PeopleFilterBy.all),
    );
  });
}
