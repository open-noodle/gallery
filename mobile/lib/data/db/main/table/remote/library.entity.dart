import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/entities/user.entity.dart';
import 'package:immich_mobile/infrastructure/utils/drift_default.mixin.dart';

// Mirrors the server `library` row but DROPS the server-side sync cursor
// columns (createId, updateId, refreshedAt) and the import paths/exclusion
// patterns (mobile is read-only on libraries — only the server scans them).
// The sync stream uses createId/updateId purely for delta computation and does
// not persist them locally, same convention as SharedSpaceEntity.
class LibraryEntity extends Table with DriftDefaultsMixin {
  const LibraryEntity();

  TextColumn get id => text()();

  TextColumn get name => text()();

  TextColumn get ownerId => text().references(UserEntity, #id, onDelete: KeyAction.cascade)();

  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();

  DateTimeColumn get updatedAt => dateTime().withDefault(currentDateAndTime)();

  @override
  Set<Column> get primaryKey => {id};
}
