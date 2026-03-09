import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' as api;

import '../../test_utils.dart';
import '../shared/shared_mocks.dart';

class MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

void main() {
  late MockSharedSpaceApiRepository mockRepo;

  setUp(() {
    mockRepo = MockSharedSpaceApiRepository();
  });

  group('sharedSpacesProvider', () {
    test('returns list of spaces from repository', () async {
      final spaces = <api.SharedSpaceResponseDto>[
        api.SharedSpaceResponseDto(
          id: 'space-1',
          name: 'Family Photos',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          createdById: 'user-1',
        ),
        api.SharedSpaceResponseDto(
          id: 'space-2',
          name: 'Work',
          createdAt: '2024-01-02T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          createdById: 'user-1',
        ),
      ];
      when(() => mockRepo.getAll()).thenAnswer((_) async => spaces);

      final container = TestUtils.createContainer(
        overrides: [
          sharedSpaceApiRepositoryProvider.overrideWithValue(mockRepo),
          currentUserProvider.overrideWith((ref) => MockCurrentUserProvider()),
        ],
      );

      final result = await container.read(sharedSpacesProvider.future);

      expect(result.length, equals(2));
      expect(result[0].name, equals('Family Photos'));
      expect(result[1].name, equals('Work'));
    });

    test('propagates errors from repository', () async {
      when(() => mockRepo.getAll()).thenThrow(Exception('Network error'));

      final container = TestUtils.createContainer(
        overrides: [
          sharedSpaceApiRepositoryProvider.overrideWithValue(mockRepo),
          currentUserProvider.overrideWith((ref) => MockCurrentUserProvider()),
        ],
      );

      expect(
        () => container.read(sharedSpacesProvider.future),
        throwsA(isA<Exception>()),
      );
    });
  });

  group('sharedSpaceProvider', () {
    test('returns single space by id', () async {
      final space = api.SharedSpaceResponseDto(
        id: 'space-1',
        name: 'Family Photos',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdById: 'user-1',
      );
      when(() => mockRepo.get('space-1')).thenAnswer((_) async => space);

      final container = TestUtils.createContainer(
        overrides: [
          sharedSpaceApiRepositoryProvider.overrideWithValue(mockRepo),
        ],
      );

      final result = await container.read(sharedSpaceProvider('space-1').future);

      expect(result.id, equals('space-1'));
      expect(result.name, equals('Family Photos'));
    });
  });

  group('sharedSpaceMembersProvider', () {
    test('returns members for a space', () async {
      final members = <api.SharedSpaceMemberResponseDto>[
        api.SharedSpaceMemberResponseDto(
          userId: 'user-1',
          name: 'Alice',
          email: 'alice@test.com',
          role: api.SharedSpaceMemberResponseDtoRoleEnum.owner,
          joinedAt: '2024-01-01T00:00:00Z',
          showInTimeline: true,
        ),
        api.SharedSpaceMemberResponseDto(
          userId: 'user-2',
          name: 'Bob',
          email: 'bob@test.com',
          role: api.SharedSpaceMemberResponseDtoRoleEnum.viewer,
          joinedAt: '2024-01-01T00:00:00Z',
          showInTimeline: true,
        ),
      ];
      when(() => mockRepo.getMembers('space-1')).thenAnswer((_) async => members);

      final container = TestUtils.createContainer(
        overrides: [
          sharedSpaceApiRepositoryProvider.overrideWithValue(mockRepo),
        ],
      );

      final result = await container.read(sharedSpaceMembersProvider('space-1').future);

      expect(result.length, equals(2));
      expect(result[0].role, equals(api.SharedSpaceMemberResponseDtoRoleEnum.owner));
      expect(result[1].role, equals(api.SharedSpaceMemberResponseDtoRoleEnum.viewer));
    });
  });

  group('spaceAssetsProvider', () {
    test('returns assets from repository', () async {
      when(() => mockRepo.getSpaceAssets('space-1')).thenAnswer((_) async => []);

      final container = TestUtils.createContainer(
        overrides: [
          sharedSpaceApiRepositoryProvider.overrideWithValue(mockRepo),
        ],
      );

      final result = await container.read(spaceAssetsProvider('space-1').future);

      expect(result, isEmpty);
      verify(() => mockRepo.getSpaceAssets('space-1')).called(1);
    });
  });
}
