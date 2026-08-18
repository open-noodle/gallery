import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:mocktail/mocktail.dart';

class MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

Person _p(String id, {String name = ''}) =>
    Person(id: id, updatedAt: DateTime(2024, 1, 1), name: name, spaceId: 'space-1');

void main() {
  setUpAll(() {
    registerFallbackValue(PeopleSortBy.name);
  });

  late MockSharedSpaceApiRepository mockRepository;
  late ProviderContainer container;

  setUp(() {
    mockRepository = MockSharedSpaceApiRepository();
    container = ProviderContainer(overrides: [sharedSpaceApiRepositoryProvider.overrideWithValue(mockRepository)]);
    addTearDown(container.dispose);
  });

  test('passes the requested sort mode through to the repository', () async {
    when(
      () => mockRepository.getSpacePeople(any(), sortBy: any(named: 'sortBy')),
    ).thenAnswer((_) async => [_p('sp1', name: 'Mia')]);

    final result = await container.read(
      driftSpacePeopleProvider((spaceId: 'space-1', sortBy: PeopleSortBy.name)).future,
    );

    expect(result.single.id, 'sp1');
    verify(() => mockRepository.getSpacePeople('space-1', sortBy: PeopleSortBy.name)).called(1);
  });

  test('re-fetches when the sort mode changes because it is part of the family key', () async {
    when(() => mockRepository.getSpacePeople(any(), sortBy: any(named: 'sortBy'))).thenAnswer((_) async => [_p('sp1')]);

    await container.read(driftSpacePeopleProvider((spaceId: 'space-1', sortBy: PeopleSortBy.name)).future);
    await container.read(driftSpacePeopleProvider((spaceId: 'space-1', sortBy: PeopleSortBy.photoCount)).future);

    verify(() => mockRepository.getSpacePeople('space-1', sortBy: PeopleSortBy.name)).called(1);
    verify(() => mockRepository.getSpacePeople('space-1', sortBy: PeopleSortBy.photoCount)).called(1);
  });

  test('surfaces the failure instead of falling back to the owner-scoped local list', () async {
    when(() => mockRepository.getSpacePeople(any(), sortBy: any(named: 'sortBy'))).thenThrow(Exception('offline'));

    // A local fallback would list people who are NOT in this space, which is wrong rather
    // than merely stale — so the error must reach the UI.
    await expectLater(
      container.read(driftSpacePeopleProvider((spaceId: 'space-1', sortBy: PeopleSortBy.name)).future),
      throwsA(isA<Exception>()),
    );
  });

  test('autoDispose: dropping the last listener tears the provider down, so re-reading re-fetches', () {
    // The route to SpacePeoplePage (Spaces tab -> space detail -> app-bar face icon)
    // invalidates nothing on entry, unlike the Library tab. autoDispose is what keeps the
    // list fresh across visits: with no listeners, the provider is disposed, and a fresh
    // read after that must issue a brand-new fetch rather than replaying a cached instance.
    fakeAsync((async) {
      when(
        () => mockRepository.getSpacePeople(any(), sortBy: any(named: 'sortBy')),
      ).thenAnswer((_) async => [_p('sp1', name: 'Mia')]);

      const key = (spaceId: 'space-1', sortBy: PeopleSortBy.name);

      final subscription = container.listen(driftSpacePeopleProvider(key), (_, _) {});
      async.flushMicrotasks();
      verify(() => mockRepository.getSpacePeople('space-1', sortBy: PeopleSortBy.name)).called(1);

      // Drop the only listener and let the scheduler's disposal task run (it is scheduled
      // via a real Timer, not a microtask, so this needs elapse(), not just flushMicrotasks()).
      subscription.close();
      async.elapse(const Duration(milliseconds: 1));
      async.flushMicrotasks();

      container.listen(driftSpacePeopleProvider(key), (_, _) {});
      async.flushMicrotasks();

      verify(() => mockRepository.getSpacePeople('space-1', sortBy: PeopleSortBy.name)).called(1);
    });
  });
}
