// M8: mobile album owners can't view/revoke space links. This pins the new
// AlbumApiRepository.getSharedSpaceLinks fetch — the owner-only
// AlbumResponseDto.sharedSpaceLinks field, not part of the Drift sync stream.
//
// Upstream added its own add-assets result-mapping suite to this same path; both
// are kept below. The fork's AlbumApiRepository takes an ApiService rather
// than an AlbumsApi (so getSharedSpaceLinks can reach other APIs), so upstream's
// cases construct it through the mocked ApiService.albumsApi getter.
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/repositories/album_api_repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' as api;

class MockAlbumsApi extends Mock implements api.AlbumsApi {}

class MockApiService extends Mock implements ApiService {}

api.AlbumResponseDto _album({
  required String id,
  api.Optional<List<api.AlbumSharedSpaceLinkResponseDto>?> sharedSpaceLinks = const api.Optional.absent(),
}) {
  return api.AlbumResponseDto(
    albumName: 'Test Album',
    albumThumbnailAssetId: null,
    assetCount: 0,
    createdAt: DateTime(2024),
    description: '',
    hasSharedLink: false,
    id: id,
    isActivityEnabled: true,
    shared: false,
    sharedSpaceLinks: sharedSpaceLinks,
    updatedAt: DateTime(2024),
  );
}

void main() {
  late MockAlbumsApi mockApi;
  late MockApiService mockApiService;
  late AlbumApiRepository repository;

  setUpAll(() {
    registerFallbackValue(api.BulkIdsDto(ids: const []));
    registerFallbackValue(api.UpdateAlbumDto());
  });

  setUp(() {
    mockApi = MockAlbumsApi();
    mockApiService = MockApiService();
    when(() => mockApiService.albumsApi).thenReturn(mockApi);
    repository = AlbumApiRepository(mockApiService);
  });

  group('addAssets', () {
    void stubResponse(List<api.BulkIdResponseDto> response) {
      when(
        () => mockApi.addAssetsToAlbum(any(), any(), abortTrigger: any(named: 'abortTrigger')),
      ).thenAnswer((_) async => response);
    }

    test('no_permission failure surfaces as failed, not added (the #22342 bug)', () async {
      stubResponse([
        api.BulkIdResponseDto(
          id: 'a1',
          success: false,
          error: const api.Optional.present(api.BulkIdErrorReason.noPermission),
        ),
      ]);

      final result = await repository.addAssets('album1', ['a1']);

      expect(result.added, isEmpty);
      expect(result.failed, ['a1']);
    });

    test('duplicate is neither added nor failed (genuinely already in album)', () async {
      stubResponse([
        api.BulkIdResponseDto(
          id: 'a1',
          success: false,
          error: const api.Optional.present(api.BulkIdErrorReason.duplicate),
        ),
      ]);

      final result = await repository.addAssets('album1', ['a1']);

      expect(result.added, isEmpty);
      expect(result.failed, isEmpty);
    });

    test('success is added', () async {
      stubResponse([api.BulkIdResponseDto(id: 'a1', success: true)]);

      final result = await repository.addAssets('album1', ['a1']);

      expect(result.added, ['a1']);
      expect(result.failed, isEmpty);
    });

    test('not_found and unknown count as failures', () async {
      stubResponse([
        api.BulkIdResponseDto(
          id: 'a1',
          success: false,
          error: const api.Optional.present(api.BulkIdErrorReason.notFound),
        ),
        api.BulkIdResponseDto(
          id: 'a2',
          success: false,
          error: const api.Optional.present(api.BulkIdErrorReason.unknown),
        ),
      ]);

      final result = await repository.addAssets('album1', ['a1', 'a2']);

      expect(result.added, isEmpty);
      expect(result.failed, ['a1', 'a2']);
    });

    test('mixed: added kept, no_permission failed, duplicate dropped', () async {
      stubResponse([
        api.BulkIdResponseDto(id: 'ok', success: true),
        api.BulkIdResponseDto(
          id: 'perm',
          success: false,
          error: const api.Optional.present(api.BulkIdErrorReason.noPermission),
        ),
        api.BulkIdResponseDto(
          id: 'dup',
          success: false,
          error: const api.Optional.present(api.BulkIdErrorReason.duplicate),
        ),
      ]);

      final result = await repository.addAssets('album1', ['ok', 'perm', 'dup']);

      expect(result.added, ['ok']);
      expect(result.failed, ['perm']);
    });
  });

  group('getSharedSpaceLinks', () {
    test('returns the links from GET /albums/:id', () async {
      final links = [
        api.AlbumSharedSpaceLinkResponseDto(
          linkedById: 'user-1',
          showInTimeline: true,
          spaceId: 'space-1',
          spaceName: 'Family',
        ),
        api.AlbumSharedSpaceLinkResponseDto(
          linkedById: 'user-1',
          showInTimeline: false,
          spaceId: 'space-2',
          spaceName: 'Friends',
        ),
      ];
      when(
        () => mockApi.getAlbumInfo('album-1'),
      ).thenAnswer((_) async => _album(id: 'album-1', sharedSpaceLinks: api.Optional.present(links)));

      final result = await repository.getSharedSpaceLinks('album-1');

      expect(result, hasLength(2));
      expect(result[0].spaceId, 'space-1');
      expect(result[0].showInTimeline, isTrue);
      expect(result[1].spaceId, 'space-2');
      expect(result[1].showInTimeline, isFalse);
      verify(() => mockApi.getAlbumInfo('album-1')).called(1);
    });

    test('returns an empty list when the server omits the field (non-owner / no links)', () async {
      when(() => mockApi.getAlbumInfo('album-1')).thenAnswer((_) async => _album(id: 'album-1'));

      final result = await repository.getSharedSpaceLinks('album-1');

      expect(result, isEmpty);
    });

    test('returns an empty list when the field is explicitly present but null', () async {
      when(
        () => mockApi.getAlbumInfo('album-1'),
      ).thenAnswer((_) async => _album(id: 'album-1', sharedSpaceLinks: const api.Optional.present(null)));

      final result = await repository.getSharedSpaceLinks('album-1');

      expect(result, isEmpty);
    });

    test('throws when the API returns null', () async {
      when(() => mockApi.getAlbumInfo('album-1')).thenAnswer((_) async => null);

      expect(() => repository.getSharedSpaceLinks('album-1'), throwsA(isA<Exception>()));
    });
  });

  group('updateAlbum', () {
    final owner = UserDto(id: 'u1', email: 'u1@example.com', name: 'u1', profileChangedAt: DateTime(2024));

    test('sends createdAt as Optional.present and serializes it as UTC', () async {
      when(() => mockApi.updateAlbumInfo(any(), any())).thenAnswer((_) async => _album(id: 'a1'));
      final createdAt = DateTime.utc(1996, 6, 15, 14, 30);

      await repository.updateAlbum('a1', owner, createdAt: createdAt);

      final dto = verify(() => mockApi.updateAlbumInfo('a1', captureAny())).captured.single as api.UpdateAlbumDto;
      expect(dto.createdAt.isPresent, isTrue);
      expect(dto.createdAt.value, createdAt);
      // The generated toJson branches on _isEpochMarker(pattern) — it emits a raw
      // millisecondsSinceEpoch *number* when a field's OpenAPI pattern is the literal
      // 'epoch' (mobile/openapi/lib/api.dart:576,583), and value.toUtc().toIso8601String()
      // otherwise. createdAt carries the long ISO regex, so it takes the string branch and
      // satisfies the server's required timezone designator whatever zone the picker used.
      // Assert it rather than trust it: this is invisible generated code.
      expect(dto.toJson()['createdAt'], endsWith('Z'));
    });

    test('omits createdAt when it is not supplied', () async {
      when(() => mockApi.updateAlbumInfo(any(), any())).thenAnswer((_) async => _album(id: 'a1'));

      await repository.updateAlbum('a1', owner, name: 'Renamed');

      final dto = verify(() => mockApi.updateAlbumInfo('a1', captureAny())).captured.single as api.UpdateAlbumDto;
      expect(dto.createdAt.isPresent, isFalse);
    });
  });
}
