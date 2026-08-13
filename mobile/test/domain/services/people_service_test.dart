import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/services/people.service.dart';
import 'package:immich_mobile/infrastructure/repositories/people.repository.dart';
import 'package:immich_mobile/repositories/person_api.repository.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' as api;

class MockDriftPeopleRepository extends Mock implements DriftPeopleRepository {}

class MockPersonApiRepository extends Mock implements PersonApiRepository {}

class MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

class MockSharedSpacePersonResponseDto extends Mock implements api.SharedSpacePersonResponseDto {}

void main() {
  late DriftPeopleService sut;
  late MockDriftPeopleRepository mockRepository;
  late MockPersonApiRepository mockApiRepository;
  late MockSharedSpaceApiRepository mockSharedSpace;

  DriftPerson person(String id, {String? spaceId}) => DriftPerson(
    id: id,
    createdAt: DateTime(2020),
    updatedAt: DateTime(2020),
    ownerId: 'owner',
    name: 'Alice',
    isFavorite: false,
    isHidden: false,
    color: null,
    spaceId: spaceId,
  );

  setUpAll(() {
    registerFallbackValue(PeopleSortBy.photoCount);
  });

  setUp(() {
    mockRepository = MockDriftPeopleRepository();
    mockApiRepository = MockPersonApiRepository();
    mockSharedSpace = MockSharedSpaceApiRepository();
    sut = DriftPeopleService(mockRepository, mockApiRepository, mockSharedSpace);

    // The local sync DB never receives faces for assets the viewer does not own, so the
    // drift query comes back empty for a Space-shared asset.
    when(() => mockRepository.getAssetPeople(any())).thenAnswer((_) async => <DriftPerson>[]);
    // The server (like the web app) resolves the Space's people for that asset.
    when(() => mockApiRepository.getAssetPeople(any())).thenAnswer((_) async => [person('space-person')]);
  });

  group('getAssetPeople', () {
    // Regression test for issue #727: web showed faces on Space-shared assets but mobile did not.
    test('fetches people from the server for an asset the viewer does not own', () async {
      final result = await sut.getAssetPeople('shared-asset', ownedByCurrentUser: false);

      expect(result, [person('space-person')]);
      verify(() => mockApiRepository.getAssetPeople('shared-asset')).called(1);
      verifyNever(() => mockRepository.getAssetPeople(any()));
    });

    test('reads people from the local sync DB for the viewer\'s own asset', () async {
      when(() => mockRepository.getAssetPeople(any())).thenAnswer((_) async => [person('local-person')]);

      final result = await sut.getAssetPeople('own-asset', ownedByCurrentUser: true);

      expect(result, [person('local-person')]);
      verify(() => mockRepository.getAssetPeople('own-asset')).called(1);
      verifyNever(() => mockApiRepository.getAssetPeople(any()));
    });

    // The supplementary people strip is best-effort for non-owned assets: a network/server
    // failure must silently hide it (empty list) rather than surface a visible error.
    test('returns no people when the server fetch fails for a non-owned asset', () async {
      when(() => mockApiRepository.getAssetPeople(any())).thenThrow(Exception('network down'));

      final result = await sut.getAssetPeople('shared-asset', ownedByCurrentUser: false);

      expect(result, isEmpty);
    });
  });

  group('getAllPeopleWithSharedSpaces', () {
    // Regression test for the People-page sibling of issue #727: the web People page shows
    // people from Space-shared assets (getAllPeople withSharedSpaces:true), but the mobile
    // People page read only the owner-scoped local Drift DB and so was empty for a viewer
    // who owns no people. The service must surface the server's shared-space-inclusive list.
    test('returns the server shared-space-inclusive people list', () async {
      // The local sync DB is owner-scoped: a viewer who owns no people gets nothing from it.
      when(
        () => mockRepository.getAllPeople(
          minFaces: any(named: 'minFaces'),
          sortBy: any(named: 'sortBy'),
        ),
      ).thenAnswer((_) async => <DriftPerson>[]);
      when(
        () => mockApiRepository.getAllPeopleWithSharedSpaces(sortBy: any(named: 'sortBy')),
      ).thenAnswer((_) async => [person('space-person')]);

      final result = await sut.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.photoCount);

      expect(result, [person('space-person')]);
      verify(() => mockApiRepository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.photoCount)).called(1);
      // The online path must never fall through to the local repository, so minFaces threading
      // (which only applies to the offline fallback) cannot leak into the server-backed path.
      verifyNever(
        () => mockRepository.getAllPeople(
          minFaces: any(named: 'minFaces'),
          sortBy: any(named: 'sortBy'),
        ),
      );
    });

    // Offline / server failure must not blank the page: the viewer's own people still render
    // from the owner-scoped local sync DB (their shared-space people are simply unavailable).
    test('falls back to the local sync DB when the server fetch fails', () async {
      when(
        () => mockApiRepository.getAllPeopleWithSharedSpaces(sortBy: any(named: 'sortBy')),
      ).thenThrow(Exception('offline'));
      when(
        () => mockRepository.getAllPeople(
          minFaces: any(named: 'minFaces'),
          sortBy: any(named: 'sortBy'),
        ),
      ).thenAnswer((_) async => [person('local-person')]);

      final result = await sut.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);

      expect(result, [person('local-person')]);
      verify(() => mockRepository.getAllPeople(minFaces: 3, sortBy: PeopleSortBy.name)).called(1);
    });

    // Regression for LOW #12: the offline shared-space People fallback silently used the
    // repository's default minFaces (3) regardless of the caller's minimumFaces preference. The
    // online path already resolves the preference server-side (M2); only the offline fallback
    // needs the value threaded through explicitly.
    test('threads an explicit minFaces into the offline fallback', () async {
      when(
        () => mockApiRepository.getAllPeopleWithSharedSpaces(sortBy: any(named: 'sortBy')),
      ).thenThrow(Exception('offline'));
      when(
        () => mockRepository.getAllPeople(
          minFaces: any(named: 'minFaces'),
          sortBy: any(named: 'sortBy'),
        ),
      ).thenAnswer((_) async => [person('local-person')]);

      final result = await sut.getAllPeopleWithSharedSpaces(minFaces: 5, sortBy: PeopleSortBy.photoCount);

      expect(result, [person('local-person')]);
      // Owner-scoped local list: personal people only.
      expect(result.single.spaceId, isNull);
      verify(() => mockRepository.getAllPeople(minFaces: 5, sortBy: PeopleSortBy.photoCount)).called(1);
    });

    test('defaults the offline fallback to minFaces 3 when the caller passes none', () async {
      when(
        () => mockApiRepository.getAllPeopleWithSharedSpaces(sortBy: any(named: 'sortBy')),
      ).thenThrow(Exception('offline'));
      when(
        () => mockRepository.getAllPeople(
          minFaces: any(named: 'minFaces'),
          sortBy: any(named: 'sortBy'),
        ),
      ).thenAnswer((_) async => [person('local-person')]);

      final result = await sut.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.photoCount);

      expect(result, [person('local-person')]);
      verify(() => mockRepository.getAllPeople(minFaces: 3, sortBy: PeopleSortBy.photoCount)).called(1);
    });
  });

  // The person DETAIL page sibling of #727/#737: a Space-shared person's photos. The local sync
  // DB never receives the face→person links for a person the viewer does not own, so the detail
  // timeline must ask the server which Space assets contain the person (the Space assets
  // themselves do sync). The web person detail page resolves exactly these photos.
  group('getSharedSpacePersonAssetIds', () {
    test('returns the asset ids the server resolved for the Space person', () async {
      when(() => mockSharedSpace.getSpacePersonAssets(any(), any())).thenAnswer((_) async => ['asset-1', 'asset-2']);

      final result = await sut.getSharedSpacePersonAssetIds('space-1', 'sp1');

      expect(result, ['asset-1', 'asset-2']);
      verify(() => mockSharedSpace.getSpacePersonAssets('space-1', 'sp1')).called(1);
    });

    // Best-effort like getAssetPeople: a network/server failure degrades the detail page to
    // "no photos" rather than surfacing a visible error.
    test('returns no asset ids when the server fetch fails', () async {
      when(() => mockSharedSpace.getSpacePersonAssets(any(), any())).thenThrow(Exception('network down'));

      final result = await sut.getSharedSpacePersonAssetIds('space-1', 'sp1');

      expect(result, isEmpty);
    });
  });

  // Edits must route on the person's profile, exactly like the web People page: a personal/owned
  // person (null spaceId) goes to the owner-only person endpoint plus a local Drift write; a
  // Space-scoped person goes to the editor-gated shared-space endpoint with NO local write.
  group('updateName routing', () {
    test('routes a personal person to the owner-only person endpoint and writes locally', () async {
      when(
        () => mockApiRepository.update(any(), name: any(named: 'name')),
      ).thenAnswer((_) async => const PersonDto(id: 'p1', isHidden: false, name: 'Bob', thumbnailPath: ''));
      when(() => mockRepository.updateName(any(), any())).thenAnswer((_) async => 1);

      final result = await sut.updateName(person('p1'), 'Bob');

      expect(result, isNonZero);
      verify(() => mockApiRepository.update('p1', name: 'Bob')).called(1);
      verify(() => mockRepository.updateName('p1', 'Bob')).called(1);
      verifyNever(
        () => mockSharedSpace.updateSpacePerson(
          any(),
          any(),
          name: any(named: 'name'),
          birthday: any(named: 'birthday'),
        ),
      );
    });

    test('routes a Space person to the shared-space endpoint and does not write locally', () async {
      when(
        () => mockSharedSpace.updateSpacePerson(
          any(),
          any(),
          name: any(named: 'name'),
          birthday: any(named: 'birthday'),
        ),
      ).thenAnswer((_) async => MockSharedSpacePersonResponseDto());

      final result = await sut.updateName(person('sp1', spaceId: 'space-1'), 'Bob');

      expect(result, isNonZero);
      verify(() => mockSharedSpace.updateSpacePerson('space-1', 'sp1', name: 'Bob')).called(1);
      verifyNever(() => mockApiRepository.update(any(), name: any(named: 'name')));
      verifyNever(() => mockRepository.updateName(any(), any()));
    });
  });

  group('updateBrithday routing', () {
    final birthday = DateTime(1990, 5, 20);

    test('routes a personal person to the owner-only person endpoint and writes locally', () async {
      when(
        () => mockApiRepository.update(any(), birthday: any(named: 'birthday')),
      ).thenAnswer((_) async => const PersonDto(id: 'p1', isHidden: false, name: 'Alice', thumbnailPath: ''));
      when(() => mockRepository.updateBirthday(any(), any())).thenAnswer((_) async => 1);

      final result = await sut.updateBrithday(person('p1'), birthday);

      expect(result, isNonZero);
      verify(() => mockApiRepository.update('p1', birthday: birthday)).called(1);
      verify(() => mockRepository.updateBirthday('p1', birthday)).called(1);
      verifyNever(
        () => mockSharedSpace.updateSpacePerson(
          any(),
          any(),
          name: any(named: 'name'),
          birthday: any(named: 'birthday'),
        ),
      );
    });

    test('routes a Space person to the shared-space endpoint and does not write locally', () async {
      when(
        () => mockSharedSpace.updateSpacePerson(
          any(),
          any(),
          name: any(named: 'name'),
          birthday: any(named: 'birthday'),
        ),
      ).thenAnswer((_) async => MockSharedSpacePersonResponseDto());

      final result = await sut.updateBrithday(person('sp1', spaceId: 'space-1'), birthday);

      expect(result, isNonZero);
      verify(() => mockSharedSpace.updateSpacePerson('space-1', 'sp1', birthday: birthday)).called(1);
      verifyNever(() => mockApiRepository.update(any(), birthday: any(named: 'birthday')));
      verifyNever(() => mockRepository.updateBirthday(any(), any()));
    });
  });
}
