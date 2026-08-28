import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/presentation/widgets/memory/memory_bottom_info.widget.dart';

void main() {
  group('memoryAssetForPage', () {
    final assets = [_asset('a0'), _asset('a1'), _asset('a2')];
    final memory = Memory(
      id: 'm1',
      createdAt: DateTime(2026, 4, 3),
      updatedAt: DateTime(2026, 4, 3),
      ownerId: 'owner-1',
      type: MemoryTypeEnum.onThisDay,
      data: const MemoryData({}),
      isSaved: false,
      memoryAt: DateTime(2026, 4, 3),
      assets: assets,
    );

    test('returns the asset on the requested page', () {
      // The whole point of #822: the arrow must target the photo on screen, not
      // whichever one happens to be first in the memory.
      expect(memoryAssetForPage(memory, 1).id, 'a1');
      expect(memoryAssetForPage(memory, 2).id, 'a2');
    });

    test('returns the first asset for page zero', () {
      expect(memoryAssetForPage(memory, 0).id, 'a0');
    });

    test('clamps a page past the end to the last asset', () {
      // currentAssetPage belongs to the ACTIVE memory; an inactive page in the
      // vertical PageView can ask with an index this memory does not have.
      expect(memoryAssetForPage(memory, 99).id, 'a2');
    });

    test('clamps a negative page to the first asset', () {
      expect(memoryAssetForPage(memory, -1).id, 'a0');
    });
  });
}

RemoteAsset _asset(String id) => RemoteAsset(
  id: id,
  name: '$id.jpg',
  ownerId: 'owner-1',
  checksum: 'checksum-$id',
  type: AssetType.image,
  createdAt: DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  isEdited: false,
);
