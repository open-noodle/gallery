import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/providers/timeline/highlighted_asset.provider.dart';

void main() {
  group('isHighlightedAsset', () {
    test('nothing highlighted matches nothing', () {
      expect(isHighlightedAsset(null, _remote('a1')), isFalse);
    });

    test('the same asset matches', () {
      expect(isHighlightedAsset(_remote('a1'), _remote('a1')), isTrue);
    });

    test('the same remoteId with a different localId matches', () {
      // The grid's copy may carry localId while the memory's copy does not.
      expect(isHighlightedAsset(_remote('a1'), _remote('a1', localId: 'local-1')), isTrue);
    });

    test('a checksum-only asset matches its counterpart', () {
      expect(isHighlightedAsset(_local('l1', checksum: 'shared'), _remote('a1', checksum: 'shared')), isTrue);
    });

    test('a different asset does not match', () {
      expect(isHighlightedAsset(_remote('a1'), _remote('a2')), isFalse);
    });
  });

  group('TimelineHighlightedAssetNotifier', () {
    test('highlighting sets the asset', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      container.read(timelineHighlightedAssetProvider.notifier).highlight(_remote('a1'));

      expect(container.read(timelineHighlightedAssetProvider), isNotNull);
    });

    test('the highlight clears itself after the duration', () {
      fakeAsync((async) {
        final container = ProviderContainer();
        addTearDown(container.dispose);

        container
            .read(timelineHighlightedAssetProvider.notifier)
            .highlight(_remote('a1'), duration: const Duration(milliseconds: 1500));

        async.elapse(const Duration(milliseconds: 1499));
        expect(container.read(timelineHighlightedAssetProvider), isNotNull);

        async.elapse(const Duration(milliseconds: 2));
        expect(container.read(timelineHighlightedAssetProvider), isNull);
      });
    });

    test('highlighting a second asset cancels the first timer', () {
      fakeAsync((async) {
        final container = ProviderContainer();
        addTearDown(container.dispose);
        final notifier = container.read(timelineHighlightedAssetProvider.notifier);

        notifier.highlight(_remote('a1'), duration: const Duration(milliseconds: 1000));
        async.elapse(const Duration(milliseconds: 900));
        notifier.highlight(_remote('a2'), duration: const Duration(milliseconds: 1000));

        // The first timer would have fired at 1000ms; the second highlight must survive it.
        async.elapse(const Duration(milliseconds: 200));
        expect((container.read(timelineHighlightedAssetProvider) as RemoteAsset?)?.id, 'a2');

        async.elapse(const Duration(milliseconds: 900));
        expect(container.read(timelineHighlightedAssetProvider), isNull);
      });
    });

    test('clear cancels a pending timer so the asset cannot reappear', () {
      fakeAsync((async) {
        final container = ProviderContainer();
        addTearDown(container.dispose);
        final notifier = container.read(timelineHighlightedAssetProvider.notifier);

        notifier.highlight(_remote('a1'), duration: const Duration(milliseconds: 1000));
        notifier.clear();
        expect(container.read(timelineHighlightedAssetProvider), isNull);

        // Highlight a second asset whose own deadline lands after a1's original deadline.
        // If clear() had failed to cancel a1's timer, that stale timer would still fire at
        // a1's original 1000ms mark and null out a2's highlight — this is what makes the
        // test able to fail.
        async.elapse(const Duration(milliseconds: 500));
        notifier.highlight(_remote('a2'), duration: const Duration(milliseconds: 1000));

        // Past a1's original deadline (500 + 600 = 1100ms since a1 was highlighted), a2
        // must still be highlighted.
        async.elapse(const Duration(milliseconds: 600));
        expect((container.read(timelineHighlightedAssetProvider) as RemoteAsset?)?.id, 'a2');

        // Past a2's own deadline, it clears normally.
        async.elapse(const Duration(milliseconds: 400));
        expect(container.read(timelineHighlightedAssetProvider), isNull);
      });
    });

    test('clear is idempotent', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final notifier = container.read(timelineHighlightedAssetProvider.notifier);

      notifier.clear();
      notifier.clear();

      expect(container.read(timelineHighlightedAssetProvider), isNull);
    });

    test('disposal cancels a pending timer', () {
      fakeAsync((async) {
        final container = ProviderContainer();
        container.read(timelineHighlightedAssetProvider.notifier).highlight(_remote('a1'));

        container.dispose();

        // Would throw "Cannot use a Notifier after it has been disposed" if the
        // timer were still live when it fired.
        async.elapse(const Duration(seconds: 5));
      });
    });
  });
}

RemoteAsset _remote(String id, {String? localId, String? checksum}) => RemoteAsset(
  id: id,
  localId: localId,
  name: '$id.jpg',
  ownerId: 'owner-1',
  checksum: checksum ?? 'checksum-$id',
  type: AssetType.image,
  createdAt: DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  isEdited: false,
);

LocalAsset _local(String id, {String? checksum}) => LocalAsset(
  id: id,
  name: '$id.jpg',
  checksum: checksum,
  type: AssetType.image,
  createdAt: DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  playbackStyle: AssetPlaybackStyle.image,
  isEdited: false,
);
