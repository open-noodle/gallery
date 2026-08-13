import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
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

  api.SharedSpacePersonResponseDto spacePerson(
    String id, {
    String name = '',
    int assetCount = 0,
    bool isHidden = false,
    String spaceId = 'space-1',
    api.Optional<DateTime?> birthDate = const api.Optional.absent(),
  }) => api.SharedSpacePersonResponseDto(
    id: id,
    name: name,
    spaceId: spaceId,
    assetCount: assetCount,
    faceCount: assetCount,
    isHidden: isHidden,
    thumbnailPath: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-02-02T00:00:00.000Z',
    representativeFaceSource: api.SharedSpacePersonResponseDtoRepresentativeFaceSourceEnum.auto,
    birthDate: birthDate,
    // alias / type / representativeFaceId deliberately left Absent: reading them via
    // `.value` throws StateError, which is exactly what B11 guards against.
  );

  void stubGetSpacePeople(Future<List<api.SharedSpacePersonResponseDto>?> Function(int offset) answer) {
    when(
      () => mockApi.getSpacePeople(
        any(),
        limit: any(named: 'limit'),
        offset: any(named: 'offset'),
        withHidden: any(named: 'withHidden'),
      ),
    ).thenAnswer((invocation) => answer(invocation.namedArguments[#offset] as int? ?? 0));
  }

  setUpAll(() {
    registerFallbackValue(api.SharedSpaceCreateDto(name: ''));
    registerFallbackValue(api.SharedSpaceUpdateDto());
    registerFallbackValue(api.SharedSpacePersonUpdateDto());
    registerFallbackValue(
      api.SharedSpaceMemberCreateDto(userId: '', role: const api.Optional.present(api.SharedSpaceRole.viewer)),
    );
    registerFallbackValue(api.SharedSpaceMemberUpdateDto(role: api.SharedSpaceRole.viewer));
    registerFallbackValue(api.SharedSpaceAssetAddDto(assetIds: []));
    registerFallbackValue(api.SharedSpaceAssetRemoveDto(assetIds: []));
    registerFallbackValue(api.SharedSpaceMemberTimelineDto(showInTimeline: false));
    registerFallbackValue(api.SharedSpaceAlbumLinkUpdateDto(showInTimeline: false));
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
      when(() => mockApi.removeAssets('space-1', any())).thenAnswer((_) async => <String>['asset-1']);

      await repository.removeAssets('space-1', ['asset-1']);

      verify(
        () => mockApi.removeAssets(
          'space-1',
          any(that: isA<api.SharedSpaceAssetRemoveDto>().having((d) => d.assetIds, 'assetIds', ['asset-1'])),
        ),
      ).called(1);
    });
  });

  group('linkAlbum', () {
    test('calls SDK linkAlbum(albumId, spaceId) — note arg order', () async {
      when(() => mockApi.linkAlbum('album-1', 'space-1')).thenAnswer((_) async {});

      await repository.linkAlbum('space-1', 'album-1');

      verify(() => mockApi.linkAlbum('album-1', 'space-1')).called(1);
    });
  });

  group('unlinkAlbum', () {
    test('calls SDK unlinkAlbum(albumId, spaceId) — note arg order', () async {
      when(() => mockApi.unlinkAlbum('album-1', 'space-1')).thenAnswer((_) async {});

      await repository.unlinkAlbum('space-1', 'album-1');

      verify(() => mockApi.unlinkAlbum('album-1', 'space-1')).called(1);
    });
  });

  group('updateAlbumLink', () {
    test('calls updateSharedSpaceAlbum with showInTimeline:false', () async {
      when(() => mockApi.updateSharedSpaceAlbum('album-1', 'space-1', any())).thenAnswer((_) async {});

      await repository.updateAlbumLink('space-1', 'album-1', showInTimeline: false);

      verify(
        () => mockApi.updateSharedSpaceAlbum(
          'album-1',
          'space-1',
          any(that: isA<api.SharedSpaceAlbumLinkUpdateDto>().having((d) => d.showInTimeline, 'showInTimeline', false)),
        ),
      ).called(1);
    });

    test('calls updateSharedSpaceAlbum with showInTimeline:true', () async {
      when(() => mockApi.updateSharedSpaceAlbum('album-1', 'space-1', any())).thenAnswer((_) async {});

      await repository.updateAlbumLink('space-1', 'album-1', showInTimeline: true);

      verify(
        () => mockApi.updateSharedSpaceAlbum(
          'album-1',
          'space-1',
          any(that: isA<api.SharedSpaceAlbumLinkUpdateDto>().having((d) => d.showInTimeline, 'showInTimeline', true)),
        ),
      ).called(1);
    });
  });

  group('update', () {
    api.SharedSpaceResponseDto updatedSpace() => api.SharedSpaceResponseDto(
      id: 'space-1',
      name: 'Renamed',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      createdById: 'user-1',
    );

    /// Asserts on the DTO handed to the generated client.
    Matcher dtoThat(bool Function(api.SharedSpaceUpdateDto dto) predicate, String description) =>
        isA<api.SharedSpaceUpdateDto>().having(predicate, description, isTrue);

    test('sends only the name when only the name changed', () async {
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      await repository.update('space-1', name: 'Renamed');

      verify(
        () => mockApi.updateSpace(
          'space-1',
          any(
            that: dtoThat(
              (d) => d.name.isPresent && d.name.value == 'Renamed' && d.description.isEmpty && d.color.isEmpty,
              'name present, description and color absent',
            ),
          ),
        ),
      ).called(1);
    });

    test('sends an empty description verbatim so it clears server-side', () async {
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      await repository.update('space-1', name: 'Renamed', description: '');

      verify(
        () => mockApi.updateSpace(
          'space-1',
          any(
            that: dtoThat((d) => d.description.isPresent && d.description.value == '', 'description present and empty'),
          ),
        ),
      ).called(1);
    });

    test('sends a newly added description', () async {
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      await repository.update('space-1', description: 'Holiday photos');

      verify(
        () => mockApi.updateSpace(
          'space-1',
          any(
            that: dtoThat(
              (d) => d.description.isPresent && d.description.value == 'Holiday photos',
              'description present',
            ),
          ),
        ),
      ).called(1);
    });

    test('omits description entirely when it is not passed', () async {
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      await repository.update('space-1', name: 'Renamed');

      verify(
        () => mockApi.updateSpace(
          'space-1',
          any(
            that: dtoThat(
              // Absent, NOT Optional.present(null) -- the latter is a 400, because the
              // server schema is .optional() but not .nullable().
              (d) => d.description.isEmpty,
              'description absent',
            ),
          ),
        ),
      ).called(1);
    });

    test('sends the colour when it changed', () async {
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      await repository.update('space-1', color: api.UserAvatarColor.amber);

      verify(
        () => mockApi.updateSpace(
          'space-1',
          any(that: dtoThat((d) => d.color.isPresent && d.color.value == api.UserAvatarColor.amber, 'color present')),
        ),
      ).called(1);
    });

    test('never populates the four fields this feature does not own', () async {
      // A stray Optional.present(false) on faceRecognitionEnabled would silently
      // disable face recognition for the whole space on every rename.
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      await repository.update('space-1', name: 'Renamed', description: 'x', color: api.UserAvatarColor.red);

      verify(
        () => mockApi.updateSpace(
          'space-1',
          any(
            that: dtoThat(
              (d) =>
                  d.faceRecognitionEnabled.isEmpty &&
                  d.petsEnabled.isEmpty &&
                  d.thumbnailAssetId.isEmpty &&
                  d.thumbnailCropY.isEmpty,
              'untouched fields all absent',
            ),
          ),
        ),
      ).called(1);
    });

    test('trims the name but not the description', () async {
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      await repository.update('space-1', name: '  Renamed  ', description: '  keep me  ');

      verify(
        () => mockApi.updateSpace(
          'space-1',
          any(
            that: dtoThat(
              (d) => d.name.value == 'Renamed' && d.description.value == '  keep me  ',
              'name trimmed, description verbatim',
            ),
          ),
        ),
      ).called(1);
    });

    test('returns the updated space', () async {
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      final result = await repository.update('space-1', name: 'Renamed');

      expect(result.name, 'Renamed');
    });

    test('throws when the API returns null', () async {
      when(() => mockApi.updateSpace(any(), any())).thenAnswer((_) async => null);

      expect(() => repository.update('space-1', name: 'Renamed'), throwsA(isA<Exception>()));
    });

    test('propagates an API failure unchanged', () async {
      when(() => mockApi.updateSpace(any(), any())).thenThrow(Exception('boom'));

      expect(() => repository.update('space-1', name: 'Renamed'), throwsA(isA<Exception>()));
    });
  });

  group('getSpacePeople mapping', () {
    test('maps a space person onto DriftPerson with the space scope carried', () async {
      stubGetSpacePeople((_) async => [spacePerson('sp1', name: 'Mia', assetCount: 7)]);

      final result = await repository.getSpacePeople('space-1', sortBy: PeopleSortBy.photoCount);

      final person = result.single;
      expect(person.id, 'sp1');
      expect(person.name, 'Mia');
      expect(person.spaceId, 'space-1');
      expect(person.numberOfAssets, 7);
      expect(person.isHidden, false);
      // A space-person profile has no owner, favourite or colour concept.
      expect(person.ownerId, '');
      expect(person.isFavorite, false);
      expect(person.color, isNull);
      expect(person.createdAt, DateTime.parse('2024-01-01T00:00:00.000Z'));
      expect(person.updatedAt, DateTime.parse('2024-02-02T00:00:00.000Z'));
    });

    test('maps an absent birthDate to null without throwing', () async {
      stubGetSpacePeople((_) async => [spacePerson('sp1')]);

      final result = await repository.getSpacePeople('space-1', sortBy: PeopleSortBy.name);

      expect(result.single.birthDate, isNull);
    });

    test('carries a present birthDate through', () async {
      stubGetSpacePeople(
        (_) async => [spacePerson('sp1', birthDate: api.Optional.present(DateTime.utc(1990, 5, 4)))],
      );

      final result = await repository.getSpacePeople('space-1', sortBy: PeopleSortBy.name);

      expect(result.single.birthDate, DateTime.utc(1990, 5, 4));
    });

    test('sorts client-side by the requested mode', () async {
      stubGetSpacePeople(
        (_) async => [spacePerson('zoe', name: 'Zoe', assetCount: 1), spacePerson('amy', name: 'Amy', assetCount: 9)],
      );

      final byName = await repository.getSpacePeople('space-1', sortBy: PeopleSortBy.name);
      final byCount = await repository.getSpacePeople('space-1', sortBy: PeopleSortBy.photoCount);

      expect(byName.map((p) => p.id), ['amy', 'zoe']);
      expect(byCount.map((p) => p.id), ['amy', 'zoe']);
    });

    test('throws when the API returns null', () async {
      stubGetSpacePeople((_) async => null);

      expect(
        () => repository.getSpacePeople('space-1', sortBy: PeopleSortBy.name),
        throwsA(isA<Exception>()),
      );
    });
  });

  group('getSpacePeople paging', () {
    test('issues a single request when the first page is short', () async {
      var calls = 0;
      stubGetSpacePeople((_) async {
        calls++;
        return [spacePerson('sp1', name: 'Mia')];
      });

      final result = await repository.getSpacePeople('space-1', sortBy: PeopleSortBy.name);

      expect(calls, 1);
      expect(result, hasLength(1));
    });

    test('walks pages until a short page and concatenates them', () async {
      final offsets = <int>[];
      stubGetSpacePeople((offset) async {
        offsets.add(offset);
        if (offset == 0) {
          return List.generate(100, (i) => spacePerson('a${i.toString().padLeft(4, '0')}'));
        }
        return [spacePerson('tail')];
      });

      final result = await repository.getSpacePeople('space-1', sortBy: PeopleSortBy.name);

      expect(offsets, [0, 100]);
      expect(result, hasLength(101));
      expect(result.map((p) => p.id), contains('tail'));
    });

    test('stops after an empty page when the total is an exact multiple of the limit', () async {
      final offsets = <int>[];
      stubGetSpacePeople((offset) async {
        offsets.add(offset);
        if (offset == 0) {
          return List.generate(100, (i) => spacePerson('a${i.toString().padLeft(4, '0')}'));
        }
        return const [];
      });

      final result = await repository.getSpacePeople('space-1', sortBy: PeopleSortBy.name);

      // The exactly-`limit` boundary: without the extra probe we would either stop early or
      // never stop at all.
      expect(offsets, [0, 100]);
      expect(result, hasLength(100));
    });

    test('stops at the max-page guard and returns what it gathered', () async {
      var calls = 0;
      stubGetSpacePeople((_) async {
        calls++;
        // Never returns a short page — without the guard this loops forever.
        return List.generate(2, (i) => spacePerson('p$calls-$i'));
      });

      final result = await repository.getSpacePeople(
        'space-1',
        sortBy: PeopleSortBy.name,
        pageSize: 2,
        maxPages: 3,
      );

      expect(calls, 3);
      expect(result, hasLength(6));
    });

    test('always requests withHidden: false', () async {
      stubGetSpacePeople((_) async => [spacePerson('sp1')]);

      await repository.getSpacePeople('space-1', sortBy: PeopleSortBy.name);

      verify(
        () => mockApi.getSpacePeople('space-1', limit: 100, offset: 0, withHidden: false),
      ).called(1);
    });

    // Regression guard: the default page size is a SERVER contract, not a free choice.
    // `SharedSpacePeopleQuerySchema.limit` is `.max(100)` and rejects an over-cap value with a
    // 400 instead of clamping it, so a larger default breaks the page against every real server
    // while every mock-based test here keeps passing. Sending 1000 — copied from `GET /people`,
    // which caps at 1000 — is exactly how this shipped broken the first time.
    test('never requests a page larger than the server limit cap', () async {
      final limits = <int>[];
      when(
        () => mockApi.getSpacePeople(
          any(),
          limit: any(named: 'limit'),
          offset: any(named: 'offset'),
          withHidden: any(named: 'withHidden'),
        ),
      ).thenAnswer((invocation) async {
        limits.add(invocation.namedArguments[#limit] as int);
        return [spacePerson('sp1')];
      });

      await repository.getSpacePeople('space-1', sortBy: PeopleSortBy.name);

      expect(limits, isNotEmpty);
      expect(limits.every((limit) => limit <= 100), isTrue, reason: 'server caps limit at 100');
    });

    test('routes through the current ApiService.sharedSpacesApi after an endpoint change', () async {
      final rebuiltApi = MockSharedSpacesApi();
      when(
        () => rebuiltApi.getSpacePeople(
          any(),
          limit: any(named: 'limit'),
          offset: any(named: 'offset'),
          withHidden: any(named: 'withHidden'),
        ),
      ).thenAnswer((_) async => [spacePerson('after-endpoint-change', name: 'Mia')]);
      when(() => mockApiService.sharedSpacesApi).thenReturn(rebuiltApi);

      final result = await repository.getSpacePeople('space-1', sortBy: PeopleSortBy.name);

      expect(result.single.id, 'after-endpoint-change');
    });
  });
}
