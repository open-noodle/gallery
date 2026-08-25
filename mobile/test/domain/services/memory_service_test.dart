import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/domain/services/memory.service.dart';
import 'package:immich_mobile/infrastructure/repositories/memory.repository.dart';
import 'package:immich_mobile/repositories/memory_api.repository.dart';
import 'package:mocktail/mocktail.dart';

class MockMemoryRepository extends Mock implements MemoryRepository {}

class MockMemoryApiRepository extends Mock implements MemoryApiRepository {}

void main() {
  late DriftMemoryService sut;
  late MockMemoryRepository mockRepository;
  late MockMemoryApiRepository mockApiRepository;

  DriftMemory memory(String id, {String ownerId = 'user-1'}) => DriftMemory(
    id: id,
    createdAt: DateTime.utc(2026),
    updatedAt: DateTime.utc(2026),
    ownerId: ownerId,
    type: MemoryTypeEnum.onThisDay,
    data: const MemoryData({'year': 2019}),
    isSaved: false,
    memoryAt: DateTime.utc(2019, 8, 17),
    assets: const [],
  );

  setUp(() {
    mockRepository = MockMemoryRepository();
    mockApiRepository = MockMemoryApiRepository();
    sut = DriftMemoryService(mockRepository, mockApiRepository);

    // The local sync DB is owner-scoped: `memory` / `memory_asset` only ever stream rows
    // whose ownerId is the viewer, so a Space-shared memory never reaches it.
    when(() => mockRepository.getAll(any())).thenAnswer((_) async => [memory('own-memory')]);
    when(
      () => mockApiRepository.getMemoryLane(),
    ).thenAnswer((_) async => [memory('own-memory'), memory('shared-memory', ownerId: 'space-owner')]);
  });

  group('getMemoryLane', () {
    // Regression test for issue #997: memories built from Space-shared photos showed on
    // web but not in the Android app.
    test('returns the server list, which includes Space-shared memories', () async {
      final result = await sut.getMemoryLane('user-1');

      expect(result.map((m) => m.id), ['own-memory', 'shared-memory']);
      verify(() => mockApiRepository.getMemoryLane()).called(1);
      verifyNever(() => mockRepository.getAll(any()));
    });

    test('falls back to the local sync DB when the server fetch fails', () async {
      when(() => mockApiRepository.getMemoryLane()).thenThrow(Exception('offline'));

      final result = await sut.getMemoryLane('user-1');

      expect(result.map((m) => m.id), ['own-memory']);
      verify(() => mockRepository.getAll('user-1')).called(1);
    });

    // "No memories today" is a valid answer, not a failure. Falling back here would surface
    // stale local memories the server has already decided not to show.
    test('does not fall back when the server returns no memories', () async {
      when(() => mockApiRepository.getMemoryLane()).thenAnswer((_) async => []);

      final result = await sut.getMemoryLane('user-1');

      expect(result, isEmpty);
      verifyNever(() => mockRepository.getAll(any()));
    });
  });

  group('getAll', () {
    test('reads from the server so shared-space memories appear', () async {
      when(() => mockApiRepository.getAllMemories(onlyFavorites: any(named: 'onlyFavorites')))
          .thenAnswer((_) async => [memory('from-server')]);

      final result = await sut.getAll('owner-1');

      expect(result.single.id, 'from-server');
      verifyNever(
        () => mockRepository.getAll(any(), onlyToday: any(named: 'onlyToday'), onlyFavorites: any(named: 'onlyFavorites')),
      );
    });

    test('falls back to the owner-scoped local list when the server fails', () async {
      when(() => mockApiRepository.getAllMemories(onlyFavorites: any(named: 'onlyFavorites')))
          .thenThrow(Exception('offline'));
      when(
        () => mockRepository.getAll('owner-1', onlyToday: false, onlyFavorites: false),
      ).thenAnswer((_) async => [memory('from-local')]);

      expect((await sut.getAll('owner-1')).single.id, 'from-local');
    });

    test('returns empty when the server fails and the local DB is empty', () async {
      when(() => mockApiRepository.getAllMemories(onlyFavorites: any(named: 'onlyFavorites')))
          .thenThrow(Exception('offline'));
      when(
        () => mockRepository.getAll('owner-1', onlyToday: false, onlyFavorites: false),
      ).thenAnswer((_) async => []);

      expect(await sut.getAll('owner-1'), isEmpty);
    });

    test('threads onlyFavorites through to both paths', () async {
      when(() => mockApiRepository.getAllMemories(onlyFavorites: true)).thenAnswer((_) async => []);

      await sut.getAll('owner-1', onlyFavorites: true);

      verify(() => mockApiRepository.getAllMemories(onlyFavorites: true)).called(1);
    });
  });
}
