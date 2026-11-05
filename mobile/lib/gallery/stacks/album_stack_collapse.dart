import 'package:drift/drift.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/data/db/main/table/remote/asset.drift.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';

/// The signed-in user, whose stacks collapse in albums; `null` before sign-in, or where no store is set up.
String? signedInUserId() {
  try {
    return Store.tryGet(StoreKey.currentUser)?.id;
  } catch (_) {
    return null;
  }
}

/// Stack collapse on an album timeline, the mobile twin of the server's `withAlbumStackCollapse`
/// (server/src/gallery/utils/album-stack-collapse.ts; specs/2026-11-01-album-stack-collapse-design.md).
///
/// A `WHERE` on the album query's `remote_asset_entity` row: a photo is hidden when another member of its stack ranks
/// ahead of it and is itself in this album view ([inAlbum]: membership, visibility, temporal scope). Rank: the stack's
/// primary, then the earliest `created_at` (the asset's `fileCreatedAt`), then id. So the album shows the primary when it
/// holds it, otherwise its earliest member of the stack, and a scope never hides a photo behind a sibling it excluded.
///
/// Only [viewerId]'s own stacks collapse, as on the server: another user's stacked photos in a shared album stay
/// separate. With no [viewerId] (no signed-in user) nothing collapses.
Expression<bool> albumStackCollapse(
  Drift db, {
  required String? viewerId,
  required Expression<bool> Function($RemoteAssetEntityTable ahead) inAlbum,
}) {
  if (viewerId == null) {
    return const Constant(true);
  }
  final row = db.remoteAssetEntity;
  final ahead = db.alias(db.remoteAssetEntity, 'stack_ahead');
  final stack = db.alias(db.stackEntity, 'stack_rank');
  final rankedAhead = db.selectOnly(ahead)
    ..addColumns([ahead.id])
    ..join([innerJoin(stack, stack.id.equalsExp(ahead.stackId), useColumns: false)])
    ..where(
      ahead.stackId.equalsExp(row.stackId) &
          ahead.id.equalsExp(row.id).not() &
          ahead.deletedAt.isNull() &
          stack.ownerId.equals(viewerId) &
          inAlbum(ahead) &
          (ahead.id.equalsExp(stack.primaryAssetId) |
              (row.id.equalsExp(stack.primaryAssetId).not() &
                  (ahead.createdAt.isSmallerThan(row.createdAt) |
                      (ahead.createdAt.equalsExp(row.createdAt) & ahead.id.isSmallerThan(row.id))))),
    );
  return row.stackId.isNull() | notExistsQuery(rankedAhead);
}
