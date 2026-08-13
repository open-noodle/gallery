import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/services/asset.service.dart';
import 'package:immich_mobile/domain/utils/background_sync.dart';
import 'package:immich_mobile/infrastructure/repositories/space_album.repository.dart';
import 'package:immich_mobile/providers/background_sync.provider.dart';
import 'package:immich_mobile/providers/infrastructure/action.provider.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:immich_mobile/providers/infrastructure/remote_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album_actions.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/services/action.service.dart';
import 'package:immich_mobile/services/download.service.dart';
import 'package:immich_mobile/services/foreground_upload.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

class MockSpaceAlbumActions extends Mock implements SpaceAlbumActions {}

class MockSpaceAlbumRepository extends Mock implements SpaceAlbumRepository {}

class MockBackgroundSyncManager extends Mock implements BackgroundSyncManager {}

class MockActionService extends Mock implements ActionService {}

class MockAssetService extends Mock implements AssetService {}

class MockDownloadService extends Mock implements DownloadService {}

class MockForegroundUploadService extends Mock implements ForegroundUploadService {}

// The real notifier's `addAssets` follows the API call with a state refresh that needs a
// live RemoteAlbumService; this harness only cares that the add "succeeded".
class _StubRemoteAlbumNotifier extends RemoteAlbumNotifier {
  @override
  RemoteAlbumState build() => const RemoteAlbumState(albums: []);

  @override
  Future<({int added, int failed})> addAssets(String albumId, List<String> assetIds) async =>
      (added: assetIds.length, failed: 0);
}

void main() {
  late MockSharedSpaceApiRepository spaceRepo;
  late MockSpaceAlbumActions albumActions;
  late MockSpaceAlbumRepository spaceAlbumRepo;
  late MockBackgroundSyncManager syncManager;
  late MockActionService actionService;
  late ProviderContainer container;

  SharedSpaceResponseDto theSpace() => SharedSpaceResponseDto(
    id: 'space-1',
    name: 'Family',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdById: 'user-1',
  );

  RemoteAlbum plainAlbum() => RemoteAlbum(
    id: 'album-1',
    name: 'Ski trip',
    ownerId: 'user-1',
    description: '',
    createdAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
    isActivityEnabled: false,
    order: AlbumAssetOrder.desc,
    assetCount: 0,
    ownerName: 'user-1',
    isShared: false,
  );

  SpaceAlbum theAlbum() => SpaceAlbum(
    id: 'album-1',
    name: 'Ski trip',
    showInTimeline: true,
    linkedAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
    createdAt: DateTime(2026, 1, 1),
  );

  RemoteAsset remote(String id) => RemoteAsset(
    id: id,
    name: id,
    ownerId: 'user-1',
    checksum: id,
    type: AssetType.image,
    createdAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
    isEdited: false,
  );

  /// Seeds the timeline multiselect so `_getAssets(timeline)` sees them. The notifier
  /// only exposes `selectAsset` (one at a time) -- there is no bulk setter.
  void select(Iterable<BaseAsset> assets) {
    final notifier = container.read(multiSelectProvider.notifier);
    for (final asset in assets) {
      notifier.selectAsset(asset);
    }
  }

  setUpAll(() {
    registerFallbackValue(<String>[]);
  });

  setUp(() {
    spaceRepo = MockSharedSpaceApiRepository();
    albumActions = MockSpaceAlbumActions();
    spaceAlbumRepo = MockSpaceAlbumRepository();
    syncManager = MockBackgroundSyncManager();
    actionService = MockActionService();
    when(() => spaceRepo.addAssets(any(), any())).thenAnswer((_) async {});
    when(() => albumActions.addAssets(any(), any())).thenAnswer((_) async => 2);
    when(() => spaceAlbumRepo.isAlbumLinked(any())).thenAnswer((_) async => false);
    when(() => syncManager.syncRemote()).thenAnswer((_) async => true);
    container = ProviderContainer(
      overrides: [
        sharedSpaceApiRepositoryProvider.overrideWithValue(spaceRepo),
        spaceAlbumActionsProvider.overrideWithValue(albumActions),
        spaceAlbumRepositoryProvider.overrideWithValue(spaceAlbumRepo),
        backgroundSyncProvider.overrideWithValue(syncManager),
        actionServiceProvider.overrideWithValue(actionService),
        remoteAlbumProvider.overrideWith(() => _StubRemoteAlbumNotifier()),
        // ActionNotifier.build() watches these; without overrides it dies before
        // initializing its late service fields.
        assetServiceProvider.overrideWithValue(MockAssetService()),
        downloadServiceProvider.overrideWithValue(MockDownloadService()),
        foregroundUploadServiceProvider.overrideWithValue(MockForegroundUploadService()),
      ],
    );
    addTearDown(container.dispose);
  });

  test('a space pool add sends every id in ONE call', () async {
    select([remote('a'), remote('b')]);

    final result = await container.read(actionProvider.notifier).addToSpace(ActionSource.timeline, theSpace());

    final captured = verify(() => spaceRepo.addAssets('space-1', captureAny())).captured.single as List<String>;
    expect(captured..sort(), ['a', 'b']);
    expect(result.success, isTrue);
  });

  test('a space pool add reports the REQUEST length, because the endpoint returns no body', () async {
    select([remote('a'), remote('b'), remote('c')]);

    final result = await container.read(actionProvider.notifier).addToSpace(ActionSource.timeline, theSpace());

    expect(result.count, 3);
  });

  test('a space album add reports the SERVER count, so duplicates are not over-claimed', () async {
    when(() => albumActions.addAssets(any(), any())).thenAnswer((_) async => 0);
    select([remote('a'), remote('b')]);

    final result = await container
        .read(actionProvider.notifier)
        .addToSpaceAlbum(ActionSource.timeline, 'space-1', theAlbum());

    expect(result.count, 0, reason: 'all already present -- do not claim "added 2"');
    expect(result.success, isTrue);
  });

  test('a space album add never touches the space pool endpoint', () async {
    select([remote('a')]);

    await container.read(actionProvider.notifier).addToSpaceAlbum(ActionSource.timeline, 'space-1', theAlbum());

    verify(() => albumActions.addAssets('album-1', any())).called(1);
    verifyNever(() => spaceRepo.addAssets(any(), any()));
  });

  test('an empty selection makes no call and succeeds with zero', () async {
    select([]);

    final result = await container.read(actionProvider.notifier).addToSpace(ActionSource.timeline, theSpace());

    expect(result.count, 0);
    expect(result.success, isTrue);
    verifyNever(() => spaceRepo.addAssets(any(), any()));
  });

  test('a failed add returns a failure AND leaves the selection intact for retry', () async {
    when(() => spaceRepo.addAssets(any(), any())).thenThrow(Exception('403'));
    select([remote('a')]);

    final result = await container.read(actionProvider.notifier).addToSpace(ActionSource.timeline, theSpace());

    expect(result.success, isFalse);
    expect(container.read(multiSelectProvider).selectedAssets, isNotEmpty);
  });

  test('a successful add clears the selection', () async {
    select([remote('a')]);

    await container.read(actionProvider.notifier).addToSpace(ActionSource.timeline, theSpace());

    expect(container.read(multiSelectProvider).selectedAssets, isEmpty);
  });

  test('a second add while one is in flight is ignored', () async {
    final gate = Completer<void>();
    when(() => spaceRepo.addAssets(any(), any())).thenAnswer((_) => gate.future);
    select([remote('a')]);

    final notifier = container.read(actionProvider.notifier);
    final first = notifier.addToSpace(ActionSource.timeline, theSpace());
    final second = await notifier.addToSpace(ActionSource.timeline, theSpace());

    expect(second.success, isFalse);
    gate.complete();
    await first;

    verify(() => spaceRepo.addAssets(any(), any())).called(1);
  });

  group('linked-album mutations nudge a remote sync', () {
    // Space-album surfaces read sync-fed Drift tables, not the optimistic local write the
    // album view uses — without the nudge they stay stale until the next natural sync.

    test('adding to a LINKED album fires the sync nudge', () async {
      when(() => spaceAlbumRepo.isAlbumLinked('album-1')).thenAnswer((_) async => true);
      select([remote('a')]);

      final result = await container.read(actionProvider.notifier).addToAlbum(ActionSource.timeline, plainAlbum());

      expect(result.success, isTrue);
      verify(() => syncManager.syncRemote()).called(1);
    });

    test('adding to an UNLINKED album does not sync', () async {
      select([remote('a')]);

      await container.read(actionProvider.notifier).addToAlbum(ActionSource.timeline, plainAlbum());

      verifyNever(() => syncManager.syncRemote());
    });

    test('a failed sync nudge does not fail the add', () async {
      when(() => spaceAlbumRepo.isAlbumLinked('album-1')).thenAnswer((_) async => true);
      when(() => syncManager.syncRemote()).thenThrow(Exception('offline'));
      select([remote('a')]);

      final result = await container.read(actionProvider.notifier).addToAlbum(ActionSource.timeline, plainAlbum());

      expect(result.success, isTrue, reason: 'the add itself succeeded; the stream catches up next cycle');
    });

    test('removing from a LINKED album fires the sync nudge', () async {
      when(() => actionService.removeFromAlbum(any(), any())).thenAnswer((_) async => 1);
      when(() => spaceAlbumRepo.isAlbumLinked('album-1')).thenAnswer((_) async => true);
      select([remote('a')]);

      final result = await container.read(actionProvider.notifier).removeFromAlbum(ActionSource.timeline, 'album-1');

      expect(result.error, isNull);
      expect(result.success, isTrue);
      verify(() => syncManager.syncRemote()).called(1);
    });

    test('removing from an UNLINKED album does not sync', () async {
      when(() => actionService.removeFromAlbum(any(), any())).thenAnswer((_) async => 1);
      select([remote('a')]);

      await container.read(actionProvider.notifier).removeFromAlbum(ActionSource.timeline, 'album-1');

      verifyNever(() => syncManager.syncRemote());
    });
  });
}
