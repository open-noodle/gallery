import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/dao/person.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/user_metadata.model.dart';
import 'package:immich_mobile/domain/services/people.service.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user_metadata.provider.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';

import '../../medium/repository_context.dart';

class MockPeopleService extends Mock implements PeopleService {}

/// PeopleService also takes the two API repositories, which resolve the server endpoint
/// out of Store. The live-update test below exercises only the local Drift path, so the API
/// half is stubbed rather than initialised — same idiom as the timeline provider tests.
class _MockApiService extends Mock implements ApiService {}

void main() {
  setUpAll(() {
    registerFallbackValue(PeopleSortBy.photoCount);
  });

  test('the documented Stream.value override shape works', () async {
    // Nine test files override this provider. It used to be a FutureProvider taking
    // `async =>`; as a StreamProvider the override returns a Stream instead. Pinning the
    // shape here means a future signature change fails one small, obvious test rather than
    // scattering compile errors across every people test file.
    final container = ProviderContainer(
      overrides: [
        getAllPeopleProvider.overrideWith((ref, sortBy) => Stream.value(const [Person(id: 'p1', name: 'Alice')])),
      ],
    );
    addTearDown(container.dispose);

    expect((await container.read(getAllPeopleProvider(PeopleSortBy.photoCount).future)).single.id, 'p1');
  });

  test('emits loading first, then data', () async {
    final container = ProviderContainer(
      overrides: [getAllPeopleProvider.overrideWith((ref, sortBy) => Stream.value(const <Person>[]))],
    );
    addTearDown(container.dispose);

    expect(container.read(getAllPeopleProvider(PeopleSortBy.photoCount)), isA<AsyncLoading<List<Person>>>());
    await container.read(getAllPeopleProvider(PeopleSortBy.photoCount).future);
    expect(container.read(getAllPeopleProvider(PeopleSortBy.photoCount)).hasValue, isTrue);
  });

  test('threads the minimumFaces preference and the requested sort into watch()', () async {
    final service = MockPeopleService();
    when(
      () => service.watch(
        minFaces: any(named: 'minFaces'),
        sortBy: any(named: 'sortBy'),
      ),
    ).thenAnswer((_) => Stream.value(const <Person>[]));
    final container = ProviderContainer(
      overrides: [
        peopleServiceProvider.overrideWithValue(service),
        userMetadataPreferencesProvider.overrideWith((ref) async => const Preferences(minimumFaces: 7)),
      ],
    );
    addTearDown(container.dispose);

    await container.read(getAllPeopleProvider(PeopleSortBy.name).future);

    verify(() => service.watch(minFaces: 7, sortBy: PeopleSortBy.name)).called(1);
  });

  test('falls back to a minimumFaces of 3 when there are no preferences', () async {
    final service = MockPeopleService();
    when(
      () => service.watch(
        minFaces: any(named: 'minFaces'),
        sortBy: any(named: 'sortBy'),
      ),
    ).thenAnswer((_) => Stream.value(const <Person>[]));
    final container = ProviderContainer(
      overrides: [
        peopleServiceProvider.overrideWithValue(service),
        userMetadataPreferencesProvider.overrideWith((ref) async => null),
      ],
    );
    addTearDown(container.dispose);

    await container.read(getAllPeopleProvider(PeopleSortBy.photoCount).future);

    verify(() => service.watch(minFaces: 3, sortBy: PeopleSortBy.photoCount)).called(1);
  });

  // The whole point of upstream #30660: because the local list is reactive, the fork's edit
  // modals stopped invalidating it. This is the end-to-end proof for the surface that still
  // reads it (the library people card) — real repository, real service, real provider over an
  // in-memory DB, with no ref.invalidate anywhere in the test.
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
        apiServiceProvider.overrideWithValue(_MockApiService()),
        userMetadataPreferencesProvider.overrideWith((ref) async => null),
      ],
    );
    addTearDown(container.dispose);

    final names = <String>[];
    container.listen(getAllPeopleProvider(PeopleSortBy.photoCount), (_, next) {
      final value = next.valueOrNull;
      if (value != null && value.isNotEmpty) {
        names.add(value.single.name);
      }
    }, fireImmediately: true);
    await container.read(getAllPeopleProvider(PeopleSortBy.photoCount).future);

    await PeopleRepository(ctx.db).updateName('p1', 'Alicia');
    await pumpEventQueue(); // deterministic drain, not a sleep

    expect(names.last, 'Alicia');
  });
}
