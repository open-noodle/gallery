import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/utils/drift_default.mixin.dart';

// Album↔asset MEMBERSHIP (fed by SharedSpaceAlbumToAssetV1 {albumId, assetId}).
// Keyed (albumId, assetId) — per-album, so an album linked to two spaces dedupes
// here. No FK on either id (loose refs; ordering between streams not guaranteed).
@TableIndex.sql(
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_asset_album ON shared_space_album_asset_entity (album_id)',
)
@TableIndex.sql(
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_asset_asset_album ON shared_space_album_asset_entity (asset_id, album_id)',
)
class SharedSpaceAlbumAssetEntity extends Table with DriftDefaultsMixin {
  const SharedSpaceAlbumAssetEntity();

  TextColumn get albumId => text()();
  TextColumn get assetId => text()();

  @override
  Set<Column> get primaryKey => {albumId, assetId};
}
