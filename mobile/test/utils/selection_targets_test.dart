import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/constants/collection.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/utils/selection_targets.dart';

RemoteAsset _remote(String id, {String ownerId = 'me', AssetVisibility visibility = AssetVisibility.timeline}) =>
    RemoteAsset(
      id: id,
      name: id,
      ownerId: ownerId,
      checksum: id,
      type: AssetType.image,
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
      isEdited: false,
      visibility: visibility,
    );

LocalAsset _local(String id) => LocalAsset(
  id: id,
  name: id,
  checksum: id,
  type: AssetType.image,
  createdAt: DateTime(2026, 1, 1),
  updatedAt: DateTime(2026, 1, 1),
  isEdited: false,
  playbackStyle: AssetPlaybackStyle.image,
);

void main() {
  group('selectionHasNonOwned', () {
    test('is false when every remote asset is mine', () {
      expect(selectionHasNonOwned([_remote('a'), _remote('b')], 'me'), isFalse);
    });

    test('is true when any remote asset belongs to someone else', () {
      expect(selectionHasNonOwned([_remote('a'), _remote('b', ownerId: 'other')], 'me'), isTrue);
    });

    test('treats local-only assets as mine -- they will be uploaded as mine', () {
      expect(selectionHasNonOwned([_local('l1'), _remote('a')], 'me'), isFalse);
    });

    test('fails closed when the current user is unknown', () {
      expect(selectionHasNonOwned([_remote('a')], null), isTrue);
    });

    test('is false for an empty selection', () {
      expect(selectionHasNonOwned([], 'me'), isFalse);
    });
  });

  group('selectionHasLocked', () {
    test('is true when any asset is in the locked folder', () {
      expect(selectionHasLocked([_remote('a'), _remote('b', visibility: AssetVisibility.locked)]), isTrue);
    });

    test('is false for ordinary timeline assets', () {
      expect(selectionHasLocked([_remote('a'), _local('l1')]), isFalse);
    });
  });

  group('selectionExceedsSpaceCap', () {
    test('allows exactly the cap', () {
      final assets = [for (var i = 0; i < kMaxSpaceAssetsPerRequest; i++) _local('l$i')];
      expect(selectionExceedsSpaceCap(assets), isFalse);
    });

    test('rejects one over the cap', () {
      final assets = [for (var i = 0; i < kMaxSpaceAssetsPerRequest + 1; i++) _local('l$i')];
      expect(selectionExceedsSpaceCap(assets), isTrue);
    });
  });
}
