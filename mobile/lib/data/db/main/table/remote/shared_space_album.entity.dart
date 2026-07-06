import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/utils/drift_default.mixin.dart';

// Space-album METADATA, keyed by albumId (fed by the SharedSpaceAlbumV1 wire
// stream → SyncAlbumV2). Mirrors the wire entity family, NOT the server's
// physical shared_space_album table (which is the link). See the Phase 2B spec
// §4 naming note. No FK on albumId/thumbnailAssetId — the rows may arrive before
// the referenced album/asset is synced.
class SharedSpaceAlbumEntity extends Table with DriftDefaultsMixin {
  const SharedSpaceAlbumEntity();

  TextColumn get id => text()(); // the albumId
  TextColumn get name => text()();
  TextColumn get description => text().nullable()();
  TextColumn get thumbnailAssetId => text().nullable()();
  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();
  DateTimeColumn get updatedAt => dateTime().withDefault(currentDateAndTime)();
  BoolColumn get isActivityEnabled => boolean().withDefault(const Constant(true))();
  // SyncAlbumV2.order is an AssetOrder enum on the wire; store its index. The
  // executor MUST confirm the exact generated Dart type of SyncAlbumV2.order
  // during B1 and align the column (intColumn index vs textEnum) — see Open
  // Items. Defaulting to an int index column here.
  IntColumn get order => integer().withDefault(const Constant(0))();

  @override
  Set<Column> get primaryKey => {id};
}
