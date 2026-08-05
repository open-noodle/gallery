import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/services/space_sync_remote_album.service.dart';
import 'package:immich_mobile/services/foreground_upload.service.dart';
import 'package:mocktail/mocktail.dart';

import '../../infrastructure/repository.mock.dart';

class MockForegroundUploadService extends Mock implements ForegroundUploadService {}

void main() {
  late SpaceSyncRemoteAlbumService sut;
  late MockRemoteAlbumRepository repository;
  late MockDriftAlbumApiRepository albumApiRepository;
  late MockForegroundUploadService uploadService;
  late List<String> nudged;

  /// Lets a test hold the nudge open, so "did removeAssets wait for it?" is observable.
  Completer<void>? nudgeGate;

  const albumId = 'album-1';

  void stubRemovedCount(int count) {
    when(
      () => albumApiRepository.removeAssets(any(), any()),
    ).thenAnswer((_) async => (removed: List.generate(count, (i) => 'asset-$i'), failed: <String>[]));
    when(() => repository.removeAssets(any(), any())).thenAnswer((_) async {});
  }

  setUp(() {
    repository = MockRemoteAlbumRepository();
    albumApiRepository = MockDriftAlbumApiRepository();
    uploadService = MockForegroundUploadService();
    nudged = [];
    nudgeGate = null;
    sut = SpaceSyncRemoteAlbumService(
      repository,
      albumApiRepository,
      uploadService,
      onAlbumMutated: (id) async {
        nudged.add(id);
        await nudgeGate?.future;
      },
    );
  });

  group('SpaceSyncRemoteAlbumService.removeAssets', () {
    test('nudges the space sync when the server removed at least one asset', () async {
      stubRemovedCount(2);

      final count = await sut.removeAssets(albumId: albumId, assetIds: ['a', 'b']);
      await pumpEventQueue();

      expect(count, 2);
      expect(nudged, [albumId], reason: 'a linked space album is fed by the sync stream, not the local album write');
    });

    test('does not nudge when the server removed nothing', () async {
      stubRemovedCount(0);

      final count = await sut.removeAssets(albumId: albumId, assetIds: ['a']);
      await pumpEventQueue();

      expect(count, 0);
      expect(nudged, isEmpty, reason: 'nothing changed, so there is nothing for the space surfaces to catch up on');
    });

    test('threads its own albumId to the nudge, not another', () async {
      stubRemovedCount(1);

      await sut.removeAssets(albumId: 'album-2', assetIds: ['a']);
      await pumpEventQueue();

      expect(nudged, ['album-2']);
    });

    test('returns without waiting for the sync to finish', () async {
      stubRemovedCount(1);
      nudgeGate = Completer<void>();

      // syncRemote() only completes when a whole sync round does. Upstream's
      // RemoveFromAlbumAction does `if (!context.mounted) return;` immediately
      // after this call, so awaiting the nudge here would let a dismissed sheet
      // skip both the success toast and clearSelection(), stranding the user in
      // selection mode. Removing the `unawaited()` makes this test time out.
      final count = await sut.removeAssets(albumId: albumId, assetIds: ['a']).timeout(const Duration(seconds: 5));

      expect(count, 1);
      expect(nudged, [albumId], reason: 'the nudge must still have been STARTED, just not awaited');

      nudgeGate!.complete();
      await pumpEventQueue();
    });

    test('applies the local delete before the nudge starts', () async {
      stubRemovedCount(1);
      final order = <String>[];
      when(() => repository.removeAssets(any(), any())).thenAnswer((_) async => order.add('local-delete'));
      sut = SpaceSyncRemoteAlbumService(
        repository,
        albumApiRepository,
        uploadService,
        onAlbumMutated: (_) async => order.add('nudge'),
      );

      await sut.removeAssets(albumId: albumId, assetIds: ['a']);
      await pumpEventQueue();

      // Not cosmetic: a sync that starts before the local row is gone can re-observe
      // the asset and undo the removal on the space surfaces.
      expect(order, ['local-delete', 'nudge']);
    });
  });
}
