import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/providers/asset_viewer/scroll_to_asset_notifier.provider.dart';

void main() {
  group('ScrollToAssetNotifier', () {
    test('starts with no pending target', () {
      final notifier = ScrollToAssetNotifier(null);

      expect(notifier.value, isNull);
      expect(notifier.consume(), isNull);
    });

    test('latches the requested asset until a consumer is ready for it', () {
      // The race a broadcast event loses: the request is made (from a memory or a
      // notification) BEFORE the timeline is mounted and subscribed. The latch keeps
      // it so the timeline can drain it once it is ready.
      final notifier = ScrollToAssetNotifier(null);
      final asset = _asset('a1');

      notifier.scrollToAsset(asset);

      expect(notifier.value?.asset, same(asset));
    });

    test('latches the creation time in the viewer local zone, not UTC', () {
      // Regression guard for #28941: the timeline buckets by local date, so a UTC
      // instant must be converted before it is used to match a segment.
      final notifier = ScrollToAssetNotifier(null);
      final utc = DateTime.utc(2026, 4, 3, 23, 30);

      notifier.scrollToAsset(_asset('a1', createdAt: utc));

      expect(notifier.value?.date, utc.toLocal());
      expect(notifier.value?.date.isUtc, isFalse);
    });

    test('applies the pending target at most once', () {
      final notifier = ScrollToAssetNotifier(null);
      notifier.scrollToAsset(_asset('a1'));

      expect(notifier.consume(), isNotNull);
      // A rebuild / second drain must not re-trigger the scroll.
      expect(notifier.consume(), isNull);
    });

    test('notifies listeners on every request, even for the same asset', () {
      // Tapping "view in timeline" twice for the same photo must re-trigger the
      // scroll, so requesting an unchanged target still has to notify.
      final notifier = ScrollToAssetNotifier(null);
      var notifications = 0;
      notifier.addListener(() => notifications++);

      final asset = _asset('a1');
      notifier.scrollToAsset(asset);
      notifier.scrollToAsset(asset);

      expect(notifications, greaterThanOrEqualTo(2));
    });

    test('replaces the target and notifies when a different asset is requested', () {
      final notifier = ScrollToAssetNotifier(null);
      var notifications = 0;
      notifier.addListener(() => notifications++);

      notifier.scrollToAsset(_asset('a1'));
      notifier.scrollToAsset(_asset('a2'));

      expect(notifications, greaterThanOrEqualTo(2));
      expect((notifier.value!.asset as RemoteAsset).id, 'a2');
    });

    test('treats two copies of the same asset as the same target', () {
      // The merged-timeline copy carries localId; the album-fetched copy does not.
      // They must not count as a new request.
      final notifier = ScrollToAssetNotifier(null);
      final createdAt = DateTime(2026, 4, 3, 12);

      notifier.scrollToAsset(_asset('a1', createdAt: createdAt));
      final first = notifier.value;
      notifier.scrollToAsset(_asset('a1', createdAt: createdAt, localId: 'local-1'));

      // `same`, not `equals`: TimelineScrollTarget has value equality, so a replaced
      // target would compare equal too. Only identity proves the request was absorbed.
      expect(notifier.value, same(first));
    });
  });
}

RemoteAsset _asset(String id, {DateTime? createdAt, String? localId}) => RemoteAsset(
  id: id,
  localId: localId,
  name: '$id.jpg',
  ownerId: 'owner-1',
  checksum: 'checksum-$id',
  type: AssetType.image,
  createdAt: createdAt ?? DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  isEdited: false,
);
