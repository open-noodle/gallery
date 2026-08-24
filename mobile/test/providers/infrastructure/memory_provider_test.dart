import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/infrastructure/repositories/memory.repository.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/memory_api.repository.dart';
import 'package:mocktail/mocktail.dart';

import '../../infrastructure/repository.mock.dart';

class MockUserService extends Mock implements UserService {}

class MockMemoryApiRepository extends Mock implements MemoryApiRepository {}

void main() {
  late MockMemoryRepository memoryRepository;
  late MockMemoryApiRepository memoryApiRepository;
  late MockUserService userService;

  UserDto user({bool memoryEnabled = true}) => UserDto(
    id: 'user-1',
    email: 'user@test.dev',
    name: 'user',
    memoryEnabled: memoryEnabled,
    profileChangedAt: DateTime(2026),
  );

  Drift mockDrift(MemoryRepository repository) {
    final drift = MockDrift();
    when(() => drift.memoryRepository).thenReturn(repository);
    return drift;
  }

  ProviderContainer makeContainer() {
    final container = ProviderContainer(
      overrides: [
        driftProvider.overrideWithValue(mockDrift(memoryRepository)),
        memoryApiRepositoryProvider.overrideWithValue(memoryApiRepository),
        currentUserProvider.overrideWith((ref) => CurrentUserProvider(userService)),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  setUp(() {
    memoryRepository = MockMemoryRepository();
    memoryApiRepository = MockMemoryApiRepository();
    userService = MockUserService();

    // #997 moved the memory lane onto the server, falling back to the local table only on
    // failure — so the API repository, not `getAll`, is what a successful refresh calls.
    when(() => memoryApiRepository.getMemoryLane()).thenAnswer((_) async => []);
    when(() => memoryRepository.getAll('user-1')).thenAnswer((_) async => []);
    when(() => userService.tryGetMyUser()).thenReturn(user());
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream.empty());
  });

  group('memoryLaneProvider', () {
    test('re-queries after local midnight', () {
      fakeAsync((async) {
        final container = makeContainer();
        container.listen(memoryLaneProvider, (_, _) {});
        async.flushMicrotasks();

        verify(() => memoryApiRepository.getMemoryLane()).called(1);

        async.elapse(const Duration(seconds: 4));
        async.flushMicrotasks();
        verifyNever(() => memoryApiRepository.getMemoryLane());

        async.elapse(const Duration(hours: 25));
        async.flushMicrotasks();
        verify(() => memoryApiRepository.getMemoryLane()).called(greaterThanOrEqualTo(1));
      });
    });

    test('cancels the midnight timer when disposed', () {
      fakeAsync((async) {
        final container = makeContainer();
        final subscription = container.listen(memoryLaneProvider, (_, _) {});
        async.flushMicrotasks();
        verify(() => memoryApiRepository.getMemoryLane()).called(1);

        subscription.close();
        async.elapse(const Duration(hours: 25));
        async.flushMicrotasks();

        verifyNever(() => memoryApiRepository.getMemoryLane());
      });
    });

    test('does not query or arm the timer when memories are disabled', () {
      when(() => userService.tryGetMyUser()).thenReturn(user(memoryEnabled: false));

      fakeAsync((async) {
        final container = makeContainer();
        container.listen(memoryLaneProvider, (_, _) {});
        async.flushMicrotasks();

        async.elapse(const Duration(hours: 25));
        async.flushMicrotasks();

        verifyNever(() => memoryRepository.getAll(any()));
      });
    });
  });
}
