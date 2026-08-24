import 'package:drift/drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space.dart';
import 'package:immich_mobile/data/db/main/table/user/user.dart';
import 'package:immich_mobile/data/db/util/defaults_mixin.dart';

class SharedSpaceMemberEntity extends Table with DriftDefaultsMixin {
  const SharedSpaceMemberEntity();

  TextColumn get spaceId => text().references(SharedSpaceEntity, #id, onDelete: KeyAction.cascade)();

  TextColumn get userId => text().references(UserEntity, #id, onDelete: KeyAction.cascade)();

  TextColumn get role => text()();

  DateTimeColumn get joinedAt => dateTime().withDefault(currentDateAndTime)();

  BoolColumn get showInTimeline => boolean().withDefault(const Constant(true))();

  @override
  Set<Column> get primaryKey => {spaceId, userId};
}
