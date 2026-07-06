import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' as api;

class MockSharedSpacesApi extends Mock implements api.SharedSpacesApi {}

class MockApiService extends Mock implements ApiService {}

class MockSharedSpacePersonResponseDto extends Mock implements api.SharedSpacePersonResponseDto {}

void main() {
  late MockSharedSpacesApi mockApi;
  late MockApiService mockApiService;
  late SharedSpaceApiRepository repository;

  api.SharedSpaceMemberResponseDto member(String userId, api.SharedSpaceRole role) => api.SharedSpaceMemberResponseDto(
    userId: userId,
    name: userId,
    email: '$userId@example.com',
    role: role,
    joinedAt: '2024-01-01T00:00:00Z',
    sharePersonMetadata: true,
    showInTimeline: true,
  );

  setUpAll(() {
    registerFallbackValue(api.SharedSpaceCreateDto(name: ''));
    registerFallbackValue(api.SharedSpacePersonUpdateDto());
    registerFallbackValue(
      api.SharedSpaceMemberCreateDto(userId: '', role: const api.Optional.present(api.SharedSpaceRole.viewer)),
    );
    registerFallbackValue(api.SharedSpaceMemberUpdateDto(role: api.SharedSpaceRole.viewer));
    registerFallbackValue(api.SharedSpaceAssetAddDto(assetIds: []));
    registerFallbackValue(api.SharedSpaceAssetRemoveDto(assetIds: []));
    registerFallbackValue(api.SharedSpaceMemberTimelineDto(showInTimeline: false));
  });

  setUp(() {
    mockApi = MockSharedSpacesApi();
    mockApiService = MockApiService();
    when(() => mockApiService.sharedSpacesApi).thenReturn(mockApi);
    repository = SharedSpaceApiRepository(mockApiService);
  });

  group('lazy SharedSpacesApi resolution', () {
    // Regression guard: ApiService.setEndpoint() reassigns the *Api fields to new
    // instances tied to a new ApiClient (fresh basePath). The repository must
    // resolve apiService.sharedSpacesApi on each call, not capture it at
    // construction. Otherwise a cold-start read of sharedSpaceApiRepositoryProvider
    // (before login) pins the repo to an empty-basePath ApiClient forever.
    test('routes calls to current ApiService.sharedSpacesApi after endpoint change', () async {
      final oldApi = MockSharedSpacesApi();
      final newApi = MockSharedSpacesApi();

      when(() => mockApiService.sharedSpacesApi).thenReturn(oldApi);
      final repo = SharedSpaceApiRepository(mockApiService);

      // Simulate ApiService.setEndpoint reassigning the field.
      when(() => mockApiService.sharedSpacesApi).thenReturn(newApi);
      when(() => newApi.getAllSpaces()).thenAnswer((_) async => []);

      await repo.getAll();

      verify(() => newApi.getAllSpaces()).called(1);
      verifyNever(() => oldApi.getAllSpaces());
    });
  });

  group('getAll', () {
    test('returns list of spaces', () async {
      final spaces = [
        api.SharedSpaceResponseDto(
          id: 'space-1',
          name: 'Test Space',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          createdById: 'user-1',
        ),
      ];
      when(() => mockApi.getAllSpaces()).thenAnswer((_) async => spaces);

      final result = await repository.getAll();

      expect(result, equals(spaces));
      verify(() => mockApi.getAllSpaces()).called(1);
    });

    test('throws when API returns null', () async {
      when(() => mockApi.getAllSpaces()).thenAnswer((_) async => null);

      expect(() => repository.getAll(), throwsA(isA<Exception>()));
    });
  });

  group('get', () {
    test('returns space by id', () async {
      final space = api.SharedSpaceResponseDto(
        id: 'space-1',
        name: 'Test Space',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdById: 'user-1',
      );
      when(() => mockApi.getSpace('space-1')).thenAnswer((_) async => space);

      final result = await repository.get('space-1');

      expect(result.id, equals('space-1'));
      expect(result.name, equals('Test Space'));
    });
  });

  group('create', () {
    test('creates space with name only', () async {
      final space = api.SharedSpaceResponseDto(
        id: 'space-new',
        name: 'New Space',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdById: 'user-1',
      );
      when(() => mockApi.createSpace(any())).thenAnswer((_) async => space);

      final result = await repository.create('New Space');

      expect(result.name, equals('New Space'));
      verify(
        () => mockApi.createSpace(
          any(
            that: isA<api.SharedSpaceCreateDto>()
                .having((d) => d.name, 'name', 'New Space')
                .having((d) => d.description.isPresent, 'description absent', false),
          ),
        ),
      ).called(1);
    });

    test('creates space with name and description', () async {
      final space = api.SharedSpaceResponseDto(
        id: 'space-new',
        name: 'New Space',
        description: const api.Optional.present('A description'),
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdById: 'user-1',
      );
      when(() => mockApi.createSpace(any())).thenAnswer((_) async => space);

      final result = await repository.create('New Space', description: 'A description');

      expect(result.description.value, equals('A description'));
    });
  });

  group('delete', () {
    test('calls removeSpace on API', () async {
      when(() => mockApi.removeSpace('space-1')).thenAnswer((_) async => true);

      await repository.delete('space-1');

      verify(() => mockApi.removeSpace('space-1')).called(1);
    });
  });

  group('getMembers', () {
    test('returns list of members', () async {
      final members = [
        api.SharedSpaceMemberResponseDto(
          userId: 'user-1',
          name: 'Alice',
          email: 'alice@example.com',
          role: api.SharedSpaceRole.owner,
          joinedAt: '2024-01-01T00:00:00Z',
          sharePersonMetadata: true,
          showInTimeline: true,
        ),
        api.SharedSpaceMemberResponseDto(
          userId: 'user-2',
          name: 'Bob',
          email: 'bob@example.com',
          role: api.SharedSpaceRole.editor,
          joinedAt: '2024-01-01T00:00:00Z',
          sharePersonMetadata: true,
          showInTimeline: true,
        ),
      ];
      when(() => mockApi.getMembers('space-1')).thenAnswer((_) async => members);

      final result = await repository.getMembers('space-1');

      expect(result.length, equals(2));
      expect(result[0].name, equals('Alice'));
      expect(result[1].role, equals(api.SharedSpaceRole.editor));
    });
  });

  // Mirrors the web resolveSpaceEditable (person.service.ts): owner/editor may edit Space
  // people; viewers may not; a membership-lookup failure fails open (the server enforces the
  // role on every write, so hiding a working action would be worse than showing a rejected one).
  group('isSpaceEditor', () {
    test('returns true for an owner', () async {
      when(() => mockApi.getMembers('space-1')).thenAnswer((_) async => [member('user-1', api.SharedSpaceRole.owner)]);

      expect(await repository.isSpaceEditor('space-1', 'user-1'), isTrue);
    });

    test('returns true for an editor', () async {
      when(() => mockApi.getMembers('space-1')).thenAnswer((_) async => [member('user-1', api.SharedSpaceRole.editor)]);

      expect(await repository.isSpaceEditor('space-1', 'user-1'), isTrue);
    });

    test('returns false for a viewer', () async {
      when(() => mockApi.getMembers('space-1')).thenAnswer((_) async => [member('user-1', api.SharedSpaceRole.viewer)]);

      expect(await repository.isSpaceEditor('space-1', 'user-1'), isFalse);
    });

    test('returns false when the user is not a member', () async {
      when(
        () => mockApi.getMembers('space-1'),
      ).thenAnswer((_) async => [member('someone-else', api.SharedSpaceRole.owner)]);

      expect(await repository.isSpaceEditor('space-1', 'user-1'), isFalse);
    });

    test('fails open (true) when the membership lookup throws', () async {
      when(() => mockApi.getMembers('space-1')).thenThrow(Exception('network down'));

      expect(await repository.isSpaceEditor('space-1', 'user-1'), isTrue);
    });
  });

  group('updateSpacePerson', () {
    test('routes name edits to the shared-space endpoint with the right ids', () async {
      when(
        () => mockApi.updateSpacePerson('space-1', 'person-1', any()),
      ).thenAnswer((_) async => MockSharedSpacePersonResponseDto());

      await repository.updateSpacePerson('space-1', 'person-1', name: 'Alice');

      verify(
        () => mockApi.updateSpacePerson(
          'space-1',
          'person-1',
          any(that: isA<api.SharedSpacePersonUpdateDto>().having((d) => d.name.value, 'name', 'Alice')),
        ),
      ).called(1);
    });

    test('sends the birthday as a UTC date', () async {
      when(
        () => mockApi.updateSpacePerson('space-1', 'person-1', any()),
      ).thenAnswer((_) async => MockSharedSpacePersonResponseDto());

      await repository.updateSpacePerson('space-1', 'person-1', birthday: DateTime(1990, 5, 20));

      verify(
        () => mockApi.updateSpacePerson(
          'space-1',
          'person-1',
          any(
            that: isA<api.SharedSpacePersonUpdateDto>().having(
              (d) => d.birthDate.value,
              'birthDate',
              DateTime.utc(1990, 5, 20),
            ),
          ),
        ),
      ).called(1);
    });

    test('throws when the API returns null', () async {
      when(() => mockApi.updateSpacePerson(any(), any(), any())).thenAnswer((_) async => null);

      expect(() => repository.updateSpacePerson('space-1', 'person-1', name: 'Alice'), throwsA(isA<Exception>()));
    });
  });

  group('addMember', () {
    test('adds member with default viewer role', () async {
      final member = api.SharedSpaceMemberResponseDto(
        userId: 'user-2',
        name: 'Bob',
        email: 'bob@example.com',
        role: api.SharedSpaceRole.viewer,
        joinedAt: '2024-01-01T00:00:00Z',
        sharePersonMetadata: true,
        showInTimeline: true,
      );
      when(() => mockApi.addMember('space-1', any())).thenAnswer((_) async => member);

      final result = await repository.addMember('space-1', 'user-2');

      expect(result.userId, equals('user-2'));
      verify(
        () => mockApi.addMember(
          'space-1',
          any(
            that: isA<api.SharedSpaceMemberCreateDto>()
                .having((d) => d.userId, 'userId', 'user-2')
                .having((d) => d.role.value, 'role', api.SharedSpaceRole.viewer),
          ),
        ),
      ).called(1);
    });

    test('adds member with editor role', () async {
      final member = api.SharedSpaceMemberResponseDto(
        userId: 'user-2',
        name: 'Bob',
        email: 'bob@example.com',
        role: api.SharedSpaceRole.editor,
        joinedAt: '2024-01-01T00:00:00Z',
        sharePersonMetadata: true,
        showInTimeline: true,
      );
      when(() => mockApi.addMember('space-1', any())).thenAnswer((_) async => member);

      final result = await repository.addMember('space-1', 'user-2', role: api.SharedSpaceRole.editor);

      expect(result.role, equals(api.SharedSpaceRole.editor));
    });
  });

  group('removeMember', () {
    test('calls removeMember on API', () async {
      when(() => mockApi.removeMember('space-1', 'user-2')).thenAnswer((_) async => true);

      await repository.removeMember('space-1', 'user-2');

      verify(() => mockApi.removeMember('space-1', 'user-2')).called(1);
    });
  });

  group('updateMember', () {
    test('updates member role', () async {
      final member = api.SharedSpaceMemberResponseDto(
        userId: 'user-2',
        name: 'Bob',
        email: 'bob@example.com',
        role: api.SharedSpaceRole.editor,
        joinedAt: '2024-01-01T00:00:00Z',
        sharePersonMetadata: true,
        showInTimeline: true,
      );
      when(() => mockApi.updateMember('space-1', 'user-2', any())).thenAnswer((_) async => member);

      final result = await repository.updateMember('space-1', 'user-2', api.SharedSpaceRole.editor);

      expect(result.role, equals(api.SharedSpaceRole.editor));
      verify(
        () => mockApi.updateMember(
          'space-1',
          'user-2',
          any(that: isA<api.SharedSpaceMemberUpdateDto>().having((d) => d.role, 'role', api.SharedSpaceRole.editor)),
        ),
      ).called(1);
    });
  });

  group('updateMemberTimeline', () {
    test('enables showInTimeline', () async {
      final member = api.SharedSpaceMemberResponseDto(
        userId: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        role: api.SharedSpaceRole.viewer,
        joinedAt: '2024-01-01T00:00:00Z',
        sharePersonMetadata: true,
        showInTimeline: true,
      );
      when(() => mockApi.updateMemberTimeline('space-1', any())).thenAnswer((_) async => member);

      final result = await repository.updateMemberTimeline('space-1', showInTimeline: true);

      expect(result.showInTimeline, isTrue);
      verify(
        () => mockApi.updateMemberTimeline(
          'space-1',
          any(that: isA<api.SharedSpaceMemberTimelineDto>().having((d) => d.showInTimeline, 'showInTimeline', true)),
        ),
      ).called(1);
    });

    test('disables showInTimeline', () async {
      final member = api.SharedSpaceMemberResponseDto(
        userId: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        role: api.SharedSpaceRole.viewer,
        joinedAt: '2024-01-01T00:00:00Z',
        sharePersonMetadata: true,
        showInTimeline: false,
      );
      when(() => mockApi.updateMemberTimeline('space-1', any())).thenAnswer((_) async => member);

      final result = await repository.updateMemberTimeline('space-1', showInTimeline: false);

      expect(result.showInTimeline, isFalse);
      verify(
        () => mockApi.updateMemberTimeline(
          'space-1',
          any(that: isA<api.SharedSpaceMemberTimelineDto>().having((d) => d.showInTimeline, 'showInTimeline', false)),
        ),
      ).called(1);
    });
  });

  group('addAssets', () {
    test('calls addAssets on API with correct DTO', () async {
      when(() => mockApi.addAssets('space-1', any())).thenAnswer((_) async => true);

      await repository.addAssets('space-1', ['asset-1', 'asset-2']);

      verify(
        () => mockApi.addAssets(
          'space-1',
          any(that: isA<api.SharedSpaceAssetAddDto>().having((d) => d.assetIds, 'assetIds', ['asset-1', 'asset-2'])),
        ),
      ).called(1);
    });
  });

  group('removeAssets', () {
    test('calls removeAssets on API with correct DTO', () async {
      when(() => mockApi.removeAssets('space-1', any())).thenAnswer((_) async => true);

      await repository.removeAssets('space-1', ['asset-1']);

      verify(
        () => mockApi.removeAssets(
          'space-1',
          any(that: isA<api.SharedSpaceAssetRemoveDto>().having((d) => d.assetIds, 'assetIds', ['asset-1'])),
        ),
      ).called(1);
    });
  });
}
