import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/entities/user.entity.dart';
import 'package:immich_mobile/infrastructure/utils/drift_default.mixin.dart';

// Mirrors the server `shared_space` row but DROPS the server-side sync cursor
// columns (`createId`, `updateId`) and bookkeeping (`createdAt` is server-set,
// `updatedAt` is set by the updated_at trigger). Mobile only stores user-visible
// fields. The sync stream uses the cursor columns purely for delta computation
// and does not persist them locally — same convention as RemoteAlbumEntity.
@TableIndex.sql('CREATE INDEX IF NOT EXISTS idx_shared_space_created_by_id ON shared_space_entity (created_by_id)')
class SharedSpaceEntity extends Table with DriftDefaultsMixin {
  const SharedSpaceEntity();

  TextColumn get id => text()();

  TextColumn get name => text()();

  TextColumn get description => text().nullable()();

  TextColumn get color => text().nullable()();

  TextColumn get createdById => text().references(UserEntity, #id, onDelete: KeyAction.cascade)();

  // No FK reference on thumbnailAssetId — see shared-space drift sync design doc.
  // The asset may not be locally synced when the space row arrives.
  TextColumn get thumbnailAssetId => text().nullable()();

  IntColumn get thumbnailCropY => integer().nullable()();

  BoolColumn get faceRecognitionEnabled => boolean().withDefault(const Constant(true))();

  BoolColumn get petsEnabled => boolean().withDefault(const Constant(false))();

  DateTimeColumn get lastActivityAt => dateTime().nullable()();

  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();

  DateTimeColumn get updatedAt => dateTime().withDefault(currentDateAndTime)();

  @override
  Set<Column> get primaryKey => {id};
}
