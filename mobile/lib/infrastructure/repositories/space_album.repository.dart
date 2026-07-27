import 'package:drift/drift.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';

class SpaceAlbumRepository extends DriftDatabaseRepository {
  final Drift _db;
  const SpaceAlbumRepository(this._db) : super(_db);

  /// Whether [albumId] is linked to at least one space. Cheap point lookup used to
  /// decide if an album mutation needs the space sync-nudge.
  Future<bool> isAlbumLinked(String albumId) async {
    final link = _db.sharedSpaceAlbumLinkEntity;
    final row =
        await (_db.selectOnly(link)
              ..addColumns([link.albumId])
              ..where(link.albumId.equals(albumId))
              ..limit(1))
            .getSingleOrNull();
    return row != null;
  }

  /// Watches albums linked to [spaceId], joining metadata + link fields.
  /// Emits ordered by album name (ascending) and reacts to Drift row changes.
  Stream<List<SpaceAlbum>> watchLinkedAlbums(String spaceId) {
    final link = _db.sharedSpaceAlbumLinkEntity;
    final meta = _db.sharedSpaceAlbumEntity;
    final assetMembership = _db.sharedSpaceAlbumAssetEntity;
    final asset = _db.remoteAssetEntity;

    // mobile-5: count only assets the detail view would show. LEFT JOIN
    // membership → remote_asset and apply the space-album detail predicate
    // (deletedAt IS NULL AND visibility IN (timeline, archive) — matching
    // _getSpaceAlbumBucketAssets after mobile-6) in the JOIN ON-clause, NOT the
    // WHERE, so an album with zero visible assets still surfaces with count 0.
    // remote_asset.id.count() ignores the NULLs a LEFT JOIN produces.
    final assetCountExp = asset.id.count();

    final query =
        _db.select(link).join([
            innerJoin(meta, meta.id.equalsExp(link.albumId)),
            leftOuterJoin(assetMembership, assetMembership.albumId.equalsExp(link.albumId), useColumns: false),
            leftOuterJoin(
              asset,
              asset.id.equalsExp(assetMembership.assetId) &
                  asset.deletedAt.isNull() &
                  (asset.visibility.equalsValue(AssetVisibility.timeline) |
                      asset.visibility.equalsValue(AssetVisibility.archive)),
              useColumns: false,
            ),
          ])
          ..where(link.spaceId.equals(spaceId))
          ..addColumns([assetCountExp])
          ..groupBy([link.spaceId, link.albumId, meta.id])
          ..orderBy([OrderingTerm.asc(meta.name)]);

    return query.watch().map(
      (rows) => rows.map((row) {
        final m = row.readTable(meta);
        final l = row.readTable(link);
        return SpaceAlbum(
          id: m.id,
          name: m.name,
          thumbnailAssetId: m.thumbnailAssetId,
          showInTimeline: l.showInTimeline,
          assetCount: row.read(assetCountExp) ?? 0,
          linkedAt: l.createdAt,
          updatedAt: m.updatedAt,
        );
      }).toList(),
    );
  }

  // §4.4 sweep: drop metadata + its membership; remote_asset blobs untouched.
  Future<void> deleteAlbumMetadata(String albumId) async {
    await _db.transaction(() async {
      await (_db.delete(_db.sharedSpaceAlbumAssetEntity)..where((t) => t.albumId.equals(albumId))).go();
      await (_db.delete(_db.sharedSpaceAlbumEntity)..where((t) => t.id.equals(albumId))).go();
    });
  }

  Future<void> deleteLink({required String spaceId, required String albumId}) {
    return (_db.delete(
      _db.sharedSpaceAlbumLinkEntity,
    )..where((t) => t.spaceId.equals(spaceId) & t.albumId.equals(albumId))).go();
  }
}
