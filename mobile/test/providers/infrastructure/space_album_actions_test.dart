import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/utils/background_sync.dart';
import 'package:immich_mobile/providers/background_sync.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album_actions.dart';
import 'package:immich_mobile/repositories/drift_album_api_repository.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

class MockBackgroundSyncManager extends Mock implements BackgroundSyncManager {}

class MockDriftAlbumApiRepository extends Mock implements DriftAlbumApiRepository {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _spaceId = 'space-1';
const _albumId = 'album-1';
const _album2 = 'album-2';

ProviderContainer _makeContainer({
  required MockSharedSpaceApiRepository repo,
  required MockBackgroundSyncManager syncMgr,
  required MockDriftAlbumApiRepository albumApiRepo,
}) {
  final c = ProviderContainer(
    overrides: [
      sharedSpaceApiRepositoryProvider.overrideWithValue(repo),
      backgroundSyncProvider.overrideWithValue(syncMgr),
      driftAlbumApiRepositoryProvider.overrideWithValue(albumApiRepo),
    ],
  );
  addTearDown(c.dispose);
  return c;
}

// The folder-action tests only exercise the SharedSpaceApiRepository and BackgroundSyncManager
// mocks, so the album-api repo is a plain unused mock rather than a fixture shared with setUp.
SpaceAlbumActions _makeActions({
  required MockSharedSpaceApiRepository repo,
  required MockBackgroundSyncManager syncMgr,
}) {
  final container = _makeContainer(repo: repo, syncMgr: syncMgr, albumApiRepo: MockDriftAlbumApiRepository());
  return container.read(spaceAlbumActionsProvider);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  late MockSharedSpaceApiRepository repo;
  late MockBackgroundSyncManager syncMgr;
  late MockDriftAlbumApiRepository albumApiRepo;
  late ProviderContainer container;

  setUp(() {
    repo = MockSharedSpaceApiRepository();
    syncMgr = MockBackgroundSyncManager();
    albumApiRepo = MockDriftAlbumApiRepository();

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
      // local junction repository (no DriftRemoteAlbumRepository write).
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

  group('folder actions', () {
    // A-01–A-05: each operation calls its endpoint, then fires exactly one sync-nudge.
    test('A-01: createFolder calls the API then nudges sync', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.createAlbumFolder(any(), any(), parentId: any(named: 'parentId'))).thenAnswer((_) async {});
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await actions.createFolder(_spaceId, 'Trips', parentId: null);

      verify(() => repo.createAlbumFolder(_spaceId, 'Trips', parentId: null)).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    test('A-02: renameFolder calls the API then nudges sync', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.renameAlbumFolder(any(), any(), any())).thenAnswer((_) async {});
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await actions.renameFolder(_spaceId, 'f1', 'Travel');

      verify(() => repo.renameAlbumFolder(_spaceId, 'f1', 'Travel')).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    test('A-03: moveFolder calls the API then nudges sync', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.moveAlbumFolder(any(), any(), any())).thenAnswer((_) async {});
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await actions.moveFolder(_spaceId, 'f1', 'f2');

      verify(() => repo.moveAlbumFolder(_spaceId, 'f1', 'f2')).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    test('A-04: deleteFolder calls the API then nudges sync', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.deleteAlbumFolder(any(), any())).thenAnswer((_) async {});
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await actions.deleteFolder(_spaceId, 'f1');

      verify(() => repo.deleteAlbumFolder(_spaceId, 'f1')).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    test('A-05: moveAlbumToFolder calls the API then nudges sync', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.setAlbumFolder(any(), any(), any())).thenAnswer((_) async {});
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await actions.moveAlbumToFolder(_spaceId, _albumId, 'f1');

      verify(() => repo.setAlbumFolder(_spaceId, _albumId, 'f1')).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    // A-07 — the invisible one. Moving a folder to the ROOT must send parentId EXPLICITLY null.
    // If the wrapper used the repo's usual `null ? absent : present` idiom the key would be
    // omitted, the server would leave the folder where it was, and nothing else would notice.
    test('A-07: moveFolder to the root sends an explicitly-null parentId', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.moveAlbumFolder(any(), any(), any())).thenAnswer((_) async {});
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await actions.moveFolder(_spaceId, 'f1', null);

      verify(() => repo.moveAlbumFolder(_spaceId, 'f1', null)).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    // A-08
    test('A-08: moveAlbumToFolder to the root sends a null folderId', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.setAlbumFolder(any(), any(), any())).thenAnswer((_) async {});
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await actions.moveAlbumToFolder(_spaceId, _albumId, null);

      verify(() => repo.setAlbumFolder(_spaceId, _albumId, null)).called(1);
      verify(() => syncMgr.syncRemote()).called(1);
    });

    // A-06 — the nudge is deliberately NOT fired on failure; the next regular cycle reconciles.
    // The existing SpaceAlbumActions comment states this, so it is a documented contract, not an
    // implementation detail.
    test('A-06: a failed call propagates and fires NO sync-nudge', () async {
      final repo = MockSharedSpaceApiRepository();
      final syncMgr = MockBackgroundSyncManager();
      when(() => repo.createAlbumFolder(any(), any(), parentId: any(named: 'parentId'))).thenThrow(Exception('boom'));
      when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);
      final actions = _makeActions(repo: repo, syncMgr: syncMgr);

      await expectLater(actions.createFolder(_spaceId, 'Trips'), throwsException);

      verifyNever(() => syncMgr.syncRemote());
    });

    // A-07 — the DTO-level pin. The test above verifies SpaceAlbumActions passes null through to
    // the repository, but it mocks the repository, so it cannot see the Optional decision the
    // repository makes when building the request. This asserts the DTO class itself: present(null)
    // serialises `parentId: null`, while absent() omits the key — the distinction the repository's
    // moveAlbumFolder wrapper (shared_space_api.repository.dart) depends on getting right.
    test('A-07: the move wrapper sends parentId as present-null, not absent', () {
      final dto = SharedSpaceAlbumFolderUpdateDto(parentId: const Optional.present(null));

      expect(dto.parentId.isPresent, isTrue);
      expect(dto.toJson().containsKey('parentId'), isTrue);
      expect(dto.toJson()['parentId'], isNull);

      final absent = SharedSpaceAlbumFolderUpdateDto();
      expect(absent.toJson().containsKey('parentId'), isFalse);
    });
  });
}
