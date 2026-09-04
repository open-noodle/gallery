import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.dart';
import 'package:immich_mobile/infrastructure/utils/drift_default.mixin.dart';

// Album folder inside a space (fed by SharedSpaceAlbumFolderV1). spaceId has a cascade FK to
// SharedSpaceEntity.
//
// parentId deliberately has NO foreign key. Sync makes no ordering guarantee, so a child folder
// can arrive before its parent — the same reason albumId on the link table has no FK. A
// self-referencing CASCADE would also be actively wrong: deleting a parent locally would destroy
// its children, while the server PROMOTES them one level and emits updated rows, so a local
// cascade would race those updates and destroy data the server meant to keep.
@TableIndex.sql(
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_folder_space ON shared_space_album_folder_entity (space_id)',
)
class SharedSpaceAlbumFolderEntity extends Table with DriftDefaultsMixin {
  const SharedSpaceAlbumFolderEntity();

  TextColumn get id => text()();

  TextColumn get spaceId => text().references(SharedSpaceEntity, #id, onDelete: KeyAction.cascade)();

  // No FK — the parent folder row may not be synced yet.
  TextColumn get parentId => text().nullable()();

  TextColumn get name => text()();

  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();
  DateTimeColumn get updatedAt => dateTime().withDefault(currentDateAndTime)();

  @override
  Set<Column> get primaryKey => {id};
}
