import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/domain/services/memory.service.dart';
import 'package:immich_mobile/infrastructure/repositories/memory.repository.dart';
import 'package:immich_mobile/repositories/memory_api.repository.dart';
import 'package:mocktail/mocktail.dart';

class MockDriftMemoryRepository extends Mock implements DriftMemoryRepository {}

class MockMemoryApiRepository extends Mock implements MemoryApiRepository {}

void main() {
  late DriftMemoryService sut;
  late MockDriftMemoryRepository mockRepository;
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
    mockRepository = MockDriftMemoryRepository();
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
}
