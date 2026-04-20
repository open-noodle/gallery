import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/providers/photos_filter/asset_type_mapper.dart';
import 'package:openapi/api.dart';

void main() {
  test('image → IMAGE', () => expect(mapAssetType(AssetType.image), AssetTypeEnum.IMAGE));
  test('video → VIDEO', () => expect(mapAssetType(AssetType.video), AssetTypeEnum.VIDEO));
  test('audio → AUDIO', () => expect(mapAssetType(AssetType.audio), AssetTypeEnum.AUDIO));
  test('other → null ("all media")', () => expect(mapAssetType(AssetType.other), isNull));
  test('null → null', () => expect(mapAssetType(null), isNull));
}
