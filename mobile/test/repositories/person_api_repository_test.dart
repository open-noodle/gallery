import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/repositories/person_api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' as api;

class MockPeopleApi extends Mock implements api.PeopleApi {}

class MockApiService extends Mock implements ApiService {}

void main() {
  late MockPeopleApi mockApi;
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

  setUp(() {
    mockApi = MockPeopleApi();
    mockApiService = MockApiService();
    when(() => mockApiService.peopleApi).thenReturn(mockApi);
    repository = PersonApiRepository(mockApiService);
  });

  group('getAllPeopleWithSharedSpaces', () {
    // Regression test for the People-page sibling of issue #727: the web People page
    // surfaces Space-shared people via getAllPeople(withSharedSpaces: true) but mobile
    // read only the owner-scoped local Drift DB, so a viewer's People page was empty.
    test('requests the shared-space-inclusive list and returns it mapped to DriftPerson', () async {
      stubGetAllPeople(() async => peopleResponse([personDto('space-person', name: 'Alice')]));

      final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.photoCount);

      expect(result, isA<List<DriftPerson>>());
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
  });
}
