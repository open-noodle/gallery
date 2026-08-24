import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.dart';
import 'package:immich_mobile/infrastructure/utils/drift_default.mixin.dart';

// Space↔album LINK row (fed by SharedSpaceAlbumLinkV1). spaceId has a cascade FK
// to SharedSpaceEntity. albumId is a loose reference (no FK) — the album
// metadata row may not be synced yet. Carries the per-space showInTimeline.
@TableIndex.sql(
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_link_space ON shared_space_album_link_entity (space_id)',
)
@TableIndex.sql(
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_link_album_space ON shared_space_album_link_entity (album_id, space_id)',
)
class SharedSpaceAlbumLinkEntity extends Table with DriftDefaultsMixin {
  const SharedSpaceAlbumLinkEntity();

  TextColumn get spaceId => text().references(SharedSpaceEntity, #id, onDelete: KeyAction.cascade)();

  // No FK — the album metadata row may not be synced yet.
  TextColumn get albumId => text()();

  BoolColumn get showInTimeline => boolean().withDefault(const Constant(true))();
  TextColumn get addedById => text().nullable()();
  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();
  DateTimeColumn get updatedAt => dateTime().withDefault(currentDateAndTime)();

  @override
  Set<Column> get primaryKey => {spaceId, albumId};
}
