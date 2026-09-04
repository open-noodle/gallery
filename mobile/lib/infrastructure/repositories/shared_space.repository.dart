import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';

class SharedSpaceRepository extends DriftDatabaseRepository {
  final Drift _db;
  const SharedSpaceRepository(this._db) : super(_db);

  /// The id of a space that hands [userId] the asset [assetId], or null when none does.
  ///
  /// Local mirror of the server's `findSpaceForAssetAndUser`: an asset reaches a member
  /// either through a `shared_space_asset` row of its own or through a library the space
  /// shares wholesale. Used to send "view in timeline" on a Space photo to the Space's
  /// own timeline, which is the only one guaranteed to hold it (#1047).
  ///
  /// Deliberately two arms, NOT three. A space also reaches assets through a linked ALBUM
  /// (`shared_space_album` + `album_asset` / `album_space_asset`), and the space timeline
  /// on both platforms shows those — but the server lookup this mirrors omits that arm, a
  /// known gap it carries an allowlist entry for (`shared-space-album-scope.guard.spec.ts`,
  /// "GUARD-DISCOVERED album gap ... pre-existing, follow-up"). Web reads its destination
  /// straight off that lookup as `resolvedSpaceId`, so adding the arm here alone would send
  /// mobile somewhere web does not. Close it on the server first, then here in the same
  /// change — an album-only Space photo still jumps to the personal timeline until then.
  Future<String?> findSpaceIdForAsset({required String assetId, required String userId}) async {
    final asset = _db.remoteAssetEntity;
    final member = _db.sharedSpaceMemberEntity;

    final spaceAsset = _db.sharedSpaceAssetEntity;
    final direct =
        await (_db.selectOnly(spaceAsset)
              ..addColumns([spaceAsset.spaceId])
              ..join([
                innerJoin(
                  member,
                  member.spaceId.equalsExp(spaceAsset.spaceId) & member.userId.equals(userId),
                  useColumns: false,
                ),
                innerJoin(asset, asset.id.equalsExp(spaceAsset.assetId) & asset.deletedAt.isNull(), useColumns: false),
              ])
              ..where(spaceAsset.assetId.equals(assetId))
              ..limit(1))
            .getSingleOrNull();
    if (direct != null) {
      return direct.read(spaceAsset.spaceId);
    }

    final spaceLibrary = _db.sharedSpaceLibraryEntity;
    final viaLibrary =
        await (_db.selectOnly(spaceLibrary)
              ..addColumns([spaceLibrary.spaceId])
              ..join([
                innerJoin(
                  member,
                  member.spaceId.equalsExp(spaceLibrary.spaceId) & member.userId.equals(userId),
                  useColumns: false,
                ),
                innerJoin(
                  asset,
                  asset.libraryId.equalsExp(spaceLibrary.libraryId) &
                      asset.id.equals(assetId) &
                      asset.deletedAt.isNull(),
                  useColumns: false,
                ),
              ])
              ..limit(1))
            .getSingleOrNull();

    return viaLibrary?.read(spaceLibrary.spaceId);
  }
}
