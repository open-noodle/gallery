import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/repositories/person_api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' as api;

class MockPeopleApi extends Mock implements api.PeopleApi {}

class MockAssetsApi extends Mock implements api.AssetsApi {}

class MockAssetInfo extends Mock implements api.AssetResponseDto {}

class MockApiService extends Mock implements ApiService {}

void main() {
  late MockPeopleApi mockApi;
  late MockAssetsApi mockAssetsApi;
  late MockApiService mockApiService;
  late PersonApiRepository repository;

  api.PersonResponseDto personDto(
    String id, {
    String name = '',
    bool isFavorite = false,
    int numberOfAssets = 0,
    bool isHidden = false,
    api.ScopedPrimaryProfile? primaryProfile,
  }) => api.PersonResponseDto(
    id: id,
    name: name,
    thumbnailPath: '',
    isHidden: isHidden,
    // v3 openapi wraps these optional fields in Optional<...?>.
    isFavorite: api.Optional.present(isFavorite),
    numberOfAssets: api.Optional.present(numberOfAssets),
    birthDate: null,
    primaryProfile: primaryProfile == null ? const api.Optional.absent() : api.Optional.present(primaryProfile),
  );

  api.PeopleResponseDto peopleResponse(List<api.PersonResponseDto> people, {bool hasNextPage = false}) =>
      api.PeopleResponseDto(
        total: people.length,
        hidden: 0,
        hasNextPage: api.Optional.present(hasNextPage),
        people: people,
      );

  void stubGetAllPeople(Future<api.PeopleResponseDto?> Function() answer) {
    when(
      () => mockApi.getAllPeople(
        withHidden: any(named: 'withHidden'),
        withSharedSpaces: any(named: 'withSharedSpaces'),
        page: any(named: 'page'),
        size: any(named: 'size'),
      ),
    ).thenAnswer((_) => answer());
  }

  // v3 merged PersonWithFacesResponseDto into PersonResponseDto; getAssetInfo().people are
  // PersonResponseDto, and spacePersonId is Optional<String?>.
  api.PersonResponseDto personWithFaces(String id, {String name = '', bool isHidden = false, String? spacePersonId}) =>
      api.PersonResponseDto(
        id: id,
        name: name,
        thumbnailPath: '',
        isHidden: isHidden,
        birthDate: null,
        spacePersonId: spacePersonId == null ? const api.Optional.absent() : api.Optional.present(spacePersonId),
      );

  void stubAssetInfo({required List<api.PersonResponseDto> people, required String ownerId, String? resolvedSpaceId}) {
    final info = MockAssetInfo();
    // v3 openapi wraps these AssetResponseDto fields in Optional<...?>.
    when(() => info.people).thenReturn(api.Optional.present(people));
    when(() => info.ownerId).thenReturn(ownerId);
    when(
      () => info.resolvedSpaceId,
    ).thenReturn(resolvedSpaceId == null ? const api.Optional.absent() : api.Optional.present(resolvedSpaceId));
    when(() => mockAssetsApi.getAssetInfo(any())).thenAnswer((_) async => info);
  }

  setUp(() {
    mockApi = MockPeopleApi();
    mockAssetsApi = MockAssetsApi();
    mockApiService = MockApiService();
    when(() => mockApiService.peopleApi).thenReturn(mockApi);
    when(() => mockApiService.assetsApi).thenReturn(mockAssetsApi);
    repository = PersonApiRepository(mockApiService);
  });

  // Face-tap entry to the person detail page (open a photo → info → tap a face). The asset-info
  // endpoint carries the space-person id separately (spacePersonId) from the global identity id
  // (dto.id), and the space id on the asset (resolvedSpaceId). To make the face-tap Person
  // shape-identical to the People-page one — so buildPersonTimelineRouteService takes the space
  // branch and the detail page loads photos — a shared-space person must be mapped with
  // id = spacePersonId and spaceId = resolvedSpaceId. This is the face-tap sibling of #727/#737.
  group('getAssetPeople space-person mapping', () {
    test('maps a shared-space person to id=spacePersonId and spaceId=resolvedSpaceId', () async {
      stubAssetInfo(
        people: [personWithFaces('global-1', name: 'Alice', spacePersonId: 'space-person-1')],
        ownerId: 'admin',
        resolvedSpaceId: 'space-1',
      );

      final result = await repository.getAssetPeople('asset-1');

      expect(result.single.id, 'space-person-1');
      expect(result.single.spaceId, 'space-1');
      expect(result.single.name, 'Alice');
    });

    test('keeps the global id and null spaceId for a personal person (no spacePersonId)', () async {
      stubAssetInfo(
        people: [personWithFaces('global-2', name: 'Bob')],
        ownerId: 'me',
        resolvedSpaceId: null,
      );

      final result = await repository.getAssetPeople('asset-2');

      expect(result.single.id, 'global-2');
      expect(result.single.spaceId, isNull);
    });

    test('stays on the owner path when the asset has no resolvedSpaceId even if spacePersonId is set', () async {
      // The space assets endpoint needs BOTH ids; without a resolved space id there is no space
      // to query, so fall back to the owner-scoped shape rather than build an unroutable person.
      stubAssetInfo(
        people: [personWithFaces('global-3', name: 'Carol', spacePersonId: 'space-person-3')],
        ownerId: 'me',
        resolvedSpaceId: null,
      );

      final result = await repository.getAssetPeople('asset-3');

      expect(result.single.id, 'global-3');
      expect(result.single.spaceId, isNull);
    });

    test('excludes hidden people', () async {
      stubAssetInfo(
        people: [
          personWithFaces('visible', name: 'Dan'),
          personWithFaces('hidden', name: 'Eve', isHidden: true),
        ],
        ownerId: 'me',
      );

      final result = await repository.getAssetPeople('asset-4');

      expect(result.map((p) => p.id), ['visible']);
    });
  });

  group('getAllPeopleWithSharedSpaces', () {
    // Regression test for the People-page sibling of issue #727: the web People page
    // surfaces Space-shared people via getAllPeople(withSharedSpaces: true) but mobile
    // read only the owner-scoped local Drift DB, so a viewer's People page was empty.
    test('requests the shared-space-inclusive list and returns it mapped to Person', () async {
      stubGetAllPeople(() async => peopleResponse([personDto('space-person', name: 'Alice')]));

      final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.photoCount);

      expect(result, isA<List<Person>>());
      expect(result.map((p) => p.id), ['space-person']);
      expect(result.single.name, 'Alice');
      // withSharedSpaces mirrors the web People page; withHidden:false matches the local
      // query, which excludes hidden people from the grid.
      verify(
        () => mockApi.getAllPeople(
          withHidden: false,
          withSharedSpaces: true,
          page: any(named: 'page'),
          size: any(named: 'size'),
        ),
      ).called(1);
    });

    test('sorts by photo count: favorites first, then named, then most assets', () async {
      stubGetAllPeople(
        () async => peopleResponse([
          personDto('bob', name: 'Bob', numberOfAssets: 2),
          personDto('carol', name: 'Carol', numberOfAssets: 9),
          personDto('fav', name: 'Zed', isFavorite: true, numberOfAssets: 1),
        ]),
      );

      final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.photoCount);

      expect(result.map((p) => p.id), ['fav', 'carol', 'bob']);
    });

    test('sorts by name: favorites first, then alphabetical', () async {
      stubGetAllPeople(
        () async => peopleResponse([
          personDto('bob', name: 'Bob', numberOfAssets: 9),
          personDto('carol', name: 'Carol', numberOfAssets: 1),
          personDto('alice', name: 'Alice', numberOfAssets: 1),
        ]),
      );

      final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);

      expect(result.map((p) => p.id), ['alice', 'bob', 'carol']);
    });

    test('paginates until hasNextPage is false', () async {
      var call = 0;
      stubGetAllPeople(() async {
        call++;
        return call == 1
            ? peopleResponse([personDto('p1', name: 'A')], hasNextPage: true)
            : peopleResponse([personDto('p2', name: 'B')]);
      });

      final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);

      expect(result.map((p) => p.id).toSet(), {'p1', 'p2'});
      verify(
        () => mockApi.getAllPeople(
          withHidden: any(named: 'withHidden'),
          withSharedSpaces: any(named: 'withSharedSpaces'),
          page: any(named: 'page'),
          size: any(named: 'size'),
        ),
      ).called(2);
    });

    test('throws when the API returns null', () async {
      stubGetAllPeople(() async => null);

      expect(() => repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name), throwsA(isA<Exception>()));
    });

    // Space-scoped people must carry their spaceId so edits route to the editor-gated
    // shared-space endpoint and the page can gate the edit affordance, mirroring web
    // (getSpaceProfile / isSpacePrimary). Personal/owned people stay null (always editable).
    test('carries spaceId from a space-person primaryProfile', () async {
      stubGetAllPeople(
        () async => peopleResponse([
          personDto(
            'space-person',
            name: 'Alice',
            primaryProfile: api.ScopedPrimaryProfile(
              id: 'profile-1',
              spaceId: const api.Optional.present('space-1'),
              type: api.ScopedPrimaryProfileTypeEnum.spacePerson,
            ),
          ),
        ]),
      );

      final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);

      expect(result.single.spaceId, 'space-1');
    });

    test('leaves spaceId null for a user-person primaryProfile', () async {
      stubGetAllPeople(
        () async => peopleResponse([
          personDto(
            'user-person',
            name: 'Bob',
            primaryProfile: api.ScopedPrimaryProfile(
              id: 'profile-2',
              type: api.ScopedPrimaryProfileTypeEnum.userPerson,
            ),
          ),
        ]),
      );

      final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);

      expect(result.single.spaceId, isNull);
    });

    test('leaves spaceId null when there is no primaryProfile', () async {
      stubGetAllPeople(() async => peopleResponse([personDto('plain', name: 'Carol')]));

      final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);

      expect(result.single.spaceId, isNull);
    });

    // Slice 3: the picker's per-row photo count reads Person.numberOfAssets, sourced
    // straight from the already-fetched PersonResponseDto — no extra network call.
    test('carries numberOfAssets from the DTO onto Person', () async {
      stubGetAllPeople(() async => peopleResponse([personDto('counted', name: 'Alice', numberOfAssets: 1204)]));

      final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);

      expect(result.single.numberOfAssets, 1204);
    });

    // Edges of the unified-model mapping. updatedAt became genuinely nullable (the old
    // two-class mapping substituted an epoch-0 sentinel), and isFavorite must survive the
    // mapping or the client-side "favorites first" sort silently stops working — a break the
    // type system cannot catch, because the field simply falls back to its default.
    group('unified-person mapping edges', () {
      test('an absent updatedAt stays null rather than becoming an epoch-0 sentinel', () async {
        stubGetAllPeople(() async => peopleResponse([personDto('p1', name: 'Alice')]));

        final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);

        expect(result.single.updatedAt, isNull);
      });

      test('an absent isFavorite maps to false', () async {
        stubGetAllPeople(
          () async => peopleResponse([
            api.PersonResponseDto(
              id: 'p1',
              name: 'Alice',
              thumbnailPath: '',
              isHidden: false,
              birthDate: null,
              isFavorite: const api.Optional.absent(),
            ),
          ]),
        );

        final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);

        expect(result.single.isFavorite, isFalse);
      });

      test('a present isFavorite is carried onto Person', () async {
        stubGetAllPeople(() async => peopleResponse([personDto('p1', name: 'Alice', isFavorite: true)]));

        final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);

        expect(result.single.isFavorite, isTrue);
      });

      test('an empty page stops paging immediately even when hasNextPage is set', () async {
        var calls = 0;
        stubGetAllPeople(() async {
          calls++;
          return peopleResponse(const [], hasNextPage: true);
        });

        final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);

        expect(result, isEmpty);
        expect(calls, 1);
      });

      test('a server that never clears hasNextPage stops at the page ceiling', () async {
        var calls = 0;
        stubGetAllPeople(() async {
          calls++;
          return peopleResponse([personDto('p$calls', name: 'A$calls')], hasNextPage: true);
        });

        final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);

        // The runaway guard is maxPages = 100 in the repository: the call terminates with what
        // it has instead of looping forever against a misbehaving server.
        expect(calls, 100);
        expect(result, hasLength(100));
      });
    });
  });
}
