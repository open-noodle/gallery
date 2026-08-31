import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.dart';
import 'package:immich_mobile/infrastructure/utils/drift_default.mixin.dart';

// gallery-fork (#1041): "this album is hidden from MY timeline", per member per linked album.
//
// SPARSE — a row exists only when this device's user has hidden that album; absence means shown.
// The server streams only the signed-in user's own rows (SharedSpaceAlbumHiddenSync scopes by
// userId), so userId here is always the local user; it is kept in the key to match the server's
// primary key and to make the sync upsert a straight mirror.
//
// albumId is a loose reference (no FK): the album metadata row may not have synced yet, exactly as
// on SharedSpaceAlbumLinkEntity.
@TableIndex.sql(
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_hidden_album_space ON shared_space_album_hidden_entity (album_id, space_id)',
)
class SharedSpaceAlbumHiddenEntity extends Table with DriftDefaultsMixin {
  const SharedSpaceAlbumHiddenEntity();

  TextColumn get spaceId => text().references(SharedSpaceEntity, #id, onDelete: KeyAction.cascade)();

  TextColumn get albumId => text()();

  TextColumn get userId => text()();

  @override
  Set<Column> get primaryKey => {spaceId, albumId, userId};
}
