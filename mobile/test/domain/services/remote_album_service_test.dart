import 'package:flutter_test/flutter_test.dart';
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
}
