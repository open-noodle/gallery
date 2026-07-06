import 'package:drift/drift.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';

class SpaceAlbumRepository extends DriftDatabaseRepository {
  final Drift _db;
  const SpaceAlbumRepository(this._db) : super(_db);

  /// Watches albums linked to [spaceId], joining metadata + link fields.
  /// Emits ordered by album name (ascending) and reacts to Drift row changes.
  Stream<List<SpaceAlbum>> watchLinkedAlbums(String spaceId) {
    final link = _db.sharedSpaceAlbumLinkEntity;
    final meta = _db.sharedSpaceAlbumEntity;
    final assetMembership = _db.sharedSpaceAlbumAssetEntity;

    // COUNT of membership rows per album (correlated via groupBy + LEFT JOIN).
    final assetCountExp = assetMembership.assetId.count();

    final query =
        _db.select(link).join([
            innerJoin(meta, meta.id.equalsExp(link.albumId)),
            leftOuterJoin(assetMembership, assetMembership.albumId.equalsExp(link.albumId), useColumns: false),
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
