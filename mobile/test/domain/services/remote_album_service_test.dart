import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/remote_album.service.dart';
import 'package:immich_mobile/services/foreground_upload.service.dart';
import 'package:mocktail/mocktail.dart';

import '../../infrastructure/repository.mock.dart';

class MockForegroundUploadService extends Mock implements ForegroundUploadService {}

void main() {
  late RemoteAlbumService sut;
  late MockRemoteAlbumRepository repository;
  late MockDriftAlbumApiRepository albumApiRepository;
  late MockForegroundUploadService uploadService;

  setUpAll(() {
    registerFallbackValue(UserDto(id: 'fallback', email: 'f@e.com', name: 'f', profileChangedAt: DateTime(2024)));
    // Required because the updateAlbum test below stubs `repository.updateAlbum(any())`,
    // and mocktail needs a fallback instance for any type used with `any()`.
    registerFallbackValue(
      RemoteAlbum(
        id: 'fallback',
        name: 'fallback',
        ownerId: 'fallback',
        description: '',
        createdAt: DateTime(2024),
        updatedAt: DateTime(2024),
        isActivityEnabled: false,
        order: AlbumAssetOrder.desc,
        assetCount: 0,
        ownerName: 'fallback',
        isShared: false,
      ),
    );
  });

  setUp(() {
    repository = MockRemoteAlbumRepository();
    albumApiRepository = MockDriftAlbumApiRepository();
    uploadService = MockForegroundUploadService();
    sut = RemoteAlbumService(repository, albumApiRepository, uploadService);
  });

  group('getAll', () {
    test('forwards currentUserId to the repository', () async {
      when(() => repository.getAll(currentUserId: any(named: 'currentUserId'))).thenAnswer((_) async => []);

      await sut.getAll(currentUserId: 'u1');

      verify(() => repository.getAll(currentUserId: 'u1')).called(1);
    });

    test('defaults currentUserId to null when not provided', () async {
      when(() => repository.getAll(currentUserId: any(named: 'currentUserId'))).thenAnswer((_) async => []);

      await sut.getAll();

      verify(() => repository.getAll(currentUserId: null)).called(1);
    });
  });

  group('get', () {
    test('forwards currentUserId to the repository', () async {
      when(() => repository.get(any(), currentUserId: any(named: 'currentUserId'))).thenAnswer((_) async => null);

      await sut.get('a1', currentUserId: 'u1');

      verify(() => repository.get('a1', currentUserId: 'u1')).called(1);
    });
  });

  group('updateAlbum', () {
    final owner = UserDto(id: 'u1', email: 'u1@example.com', name: 'u1', profileChangedAt: DateTime(2024));
    final updated = RemoteAlbum(
      id: 'a1',
      name: 'Album',
      ownerId: 'u1',
      description: '',
      createdAt: DateTime.utc(1996, 6, 15, 14, 30),
      updatedAt: DateTime(2026),
      isActivityEnabled: false,
      order: AlbumAssetOrder.desc,
      assetCount: 0,
      ownerName: 'u1',
      isShared: false,
    );

    test('forwards createdAt to the api repository and stores the result locally', () async {
      when(() => repository.getOwner(any())).thenAnswer((_) async => owner);
      when(() => repository.updateAlbum(any())).thenAnswer((_) async {});
      when(
        () => albumApiRepository.updateAlbum(
          any(),
          any(),
          name: any(named: 'name'),
          description: any(named: 'description'),
          thumbnailAssetId: any(named: 'thumbnailAssetId'),
          isActivityEnabled: any(named: 'isActivityEnabled'),
          order: any(named: 'order'),
          createdAt: any(named: 'createdAt'),
        ),
      ).thenAnswer((_) async => updated);

      final createdAt = DateTime.utc(1996, 6, 15, 14, 30);
      await sut.updateAlbum('a1', createdAt: createdAt);

      verify(
        () => albumApiRepository.updateAlbum(
          'a1',
          owner,
          name: null,
          description: null,
          thumbnailAssetId: null,
          isActivityEnabled: null,
          order: null,
          createdAt: createdAt,
        ),
      ).called(1);
      verify(() => repository.updateAlbum(updated)).called(1);
    });
  });
}
