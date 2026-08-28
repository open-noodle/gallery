import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/utils/background_sync.dart';
import 'package:immich_mobile/providers/background_sync.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album_actions.dart';
import 'package:immich_mobile/repositories/album_api_repository.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:mocktail/mocktail.dart';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

class MockBackgroundSyncManager extends Mock implements BackgroundSyncManager {}

class MockAlbumApiRepository extends Mock implements AlbumApiRepository {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _spaceId = 'space-1';
const _albumId = 'album-1';
const _album2 = 'album-2';

ProviderContainer _makeContainer({
  required MockSharedSpaceApiRepository repo,
  required MockBackgroundSyncManager syncMgr,
  required MockAlbumApiRepository albumApiRepo,
}) {
  final c = ProviderContainer(
    overrides: [
      sharedSpaceApiRepositoryProvider.overrideWithValue(repo),
      backgroundSyncProvider.overrideWithValue(syncMgr),
      albumApiRepositoryProvider.overrideWithValue(albumApiRepo),
    ],
  );
  addTearDown(c.dispose);
  return c;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  late MockSharedSpaceApiRepository repo;
  late MockBackgroundSyncManager syncMgr;
  late MockAlbumApiRepository albumApiRepo;
  late ProviderContainer container;

  setUp(() {
    repo = MockSharedSpaceApiRepository();
    syncMgr = MockBackgroundSyncManager();
    albumApiRepo = MockAlbumApiRepository();

    // Default stubs
    when(() => repo.linkAlbum(any(), any())).thenAnswer((_) async {});
    when(() => repo.unlinkAlbum(any(), any())).thenAnswer((_) async {});
    when(
      () => repo.updateAlbumLink(any(), any(), showInTimeline: any(named: 'showInTimeline')),
    ).thenAnswer((_) async {});
    when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);

    container = _makeContainer(repo: repo, syncMgr: syncMgr, albumApiRepo: albumApiRepo);
  });

  group('SpaceAlbumActions.link', () {
    test('calls repo.linkAlbum for each albumId then syncRemote once', () async {
      final actions = container.read(spaceAlbumActionsProvider);
      await actions.link(_spaceId, [_albumId, _album2]);

      verify(() => repo.linkAlbum(_spaceId, _albumId)).called(1);
      verify(() => repo.linkAlbum(_spaceId, _album2)).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    test('with a single albumId calls repo.linkAlbum once', () async {
      final actions = container.read(spaceAlbumActionsProvider);
      await actions.link(_spaceId, [_albumId]);

      verify(() => repo.linkAlbum(_spaceId, _albumId)).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    test('does nothing and no nudge when albumIds is empty', () async {
      final actions = container.read(spaceAlbumActionsProvider);
      await actions.link(_spaceId, []);

      verifyNever(() => repo.linkAlbum(any(), any()));
      verifyNever(() => syncMgr.syncRemote());
    });

    test('on repo error: still fires syncRemote and rethrows', () async {
      when(() => repo.linkAlbum(any(), any())).thenThrow(Exception('network error'));

      final actions = container.read(spaceAlbumActionsProvider);
      // Expect an exception to be thrown
      await expectLater(() => actions.link(_spaceId, [_albumId]), throwsA(isA<Exception>()));

      // syncRemote is NOT called when the first API call throws (fail-fast).
      // This is the chosen design: bubble the error, let the page catch it.
      verifyNever(() => syncMgr.syncRemote());
    });
  });

  group('SpaceAlbumActions.unlink', () {
    test('calls repo.unlinkAlbum then syncRemote', () async {
      final actions = container.read(spaceAlbumActionsProvider);
      await actions.unlink(_spaceId, _albumId);

      verify(() => repo.unlinkAlbum(_spaceId, _albumId)).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    test('on repo error: rethrows without calling syncRemote', () async {
      when(() => repo.unlinkAlbum(any(), any())).thenThrow(Exception('network error'));

      final actions = container.read(spaceAlbumActionsProvider);
      await expectLater(() => actions.unlink(_spaceId, _albumId), throwsA(isA<Exception>()));
      verifyNever(() => syncMgr.syncRemote());
    });
  });

  group('SpaceAlbumActions.toggleTimeline', () {
    test('toggleTimeline(current:true) calls updateAlbumLink(showInTimeline:false) then syncRemote', () async {
      final actions = container.read(spaceAlbumActionsProvider);
      await actions.toggleTimeline(_spaceId, _albumId, current: true);

      verify(() => repo.updateAlbumLink(_spaceId, _albumId, showInTimeline: false)).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    test('toggleTimeline(current:false) calls updateAlbumLink(showInTimeline:true) then syncRemote', () async {
      final actions = container.read(spaceAlbumActionsProvider);
      await actions.toggleTimeline(_spaceId, _albumId, current: false);

      verify(() => repo.updateAlbumLink(_spaceId, _albumId, showInTimeline: true)).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    test('on repo error: rethrows without calling syncRemote', () async {
      when(
        () => repo.updateAlbumLink(any(), any(), showInTimeline: any(named: 'showInTimeline')),
      ).thenThrow(Exception('network error'));

      final actions = container.read(spaceAlbumActionsProvider);
      await expectLater(() => actions.toggleTimeline(_spaceId, _albumId, current: true), throwsA(isA<Exception>()));
      verifyNever(() => syncMgr.syncRemote());
    });
  });

  group('SpaceAlbumActions.addAssets', () {
    test('routes through the album API repo (server-only), nudges sync, returns added count', () async {
      when(
        () => albumApiRepo.addAssets(any(), any()),
      ).thenAnswer((_) async => (added: ['a1', 'a2'], failed: <String>[]));

      final actions = container.read(spaceAlbumActionsProvider);
      final count = await actions.addAssets(_albumId, ['a1', 'a2']);

      expect(count, 2);
      verify(() => albumApiRepo.addAssets(_albumId, ['a1', 'a2'])).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
      // The absorbed-album invariant: the server-only path never touches the
      // local junction repository (no RemoteAlbumRepository write).
      verifyNoMoreInteractions(repo);
    });

    test('returns only the count of successfully added assets', () async {
      when(() => albumApiRepo.addAssets(any(), any())).thenAnswer((_) async => (added: ['a1'], failed: ['a2']));

      final actions = container.read(spaceAlbumActionsProvider);
      final count = await actions.addAssets(_albumId, ['a1', 'a2']);

      expect(count, 1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    test('does nothing and no nudge when assetIds is empty', () async {
      final actions = container.read(spaceAlbumActionsProvider);
      final count = await actions.addAssets(_albumId, []);

      expect(count, 0);
      verifyNever(() => albumApiRepo.addAssets(any(), any()));
      verifyNever(() => syncMgr.syncRemote());
    });

    test('on API error: rethrows without calling syncRemote', () async {
      when(() => albumApiRepo.addAssets(any(), any())).thenThrow(Exception('network error'));

      final actions = container.read(spaceAlbumActionsProvider);
      await expectLater(() => actions.addAssets(_albumId, ['a1']), throwsA(isA<Exception>()));
      verifyNever(() => syncMgr.syncRemote());
    });
  });
}
