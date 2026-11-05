import 'package:drift/drift.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:openapi/api.dart' show UserAvatarColor;

/// How many of the user's spaces show an asset, and the colour of the space when there is one.
typedef AssetSpaces = ({int count, UserAvatarColor? color});

const AssetSpaces noAssetSpaces = (count: 0, color: null);

// The paths into a space: added to it, in an album linked to it, or in a library linked to it, whether or not the
// space or album is hidden from the user's timeline. Unlike the server, a cross-owner contribution to an album linked
// to several spaces counts in each of them: the local album rows carry no space, as for the space timelines.
const _assetSpacesSql = '''
SELECT s.color AS color
FROM shared_space_entity s
INNER JOIN shared_space_member_entity m ON m.space_id = s.id AND m.user_id = ?1
WHERE s.id IN (
  SELECT ssa.space_id FROM shared_space_asset_entity ssa WHERE ssa.asset_id = ?2
  UNION
  SELECT ssal.space_id FROM shared_space_album_asset_entity ssaa
  INNER JOIN shared_space_album_link_entity ssal ON ssal.album_id = ssaa.album_id
  WHERE ssaa.asset_id = ?2
  UNION
  SELECT ssl.space_id FROM remote_asset_entity rae
  INNER JOIN shared_space_library_entity ssl ON ssl.library_id = rae.library_id
  WHERE rae.id = ?2
)
''';

/// The spaces of [userId]'s that show the remote asset [assetId], updated as spaces change.
Stream<AssetSpaces> watchAssetSpaces(Drift db, String userId, String assetId) {
  final query = db.customSelect(
    _assetSpacesSql,
    variables: [Variable.withString(userId), Variable.withString(assetId)],
    // Not remote_asset_entity: an asset keeps its library, and every asset write would rerun this.
    readsFrom: {
      db.sharedSpaceEntity,
      db.sharedSpaceMemberEntity,
      db.sharedSpaceAssetEntity,
      db.sharedSpaceAlbumAssetEntity,
      db.sharedSpaceAlbumLinkEntity,
      db.sharedSpaceLibraryEntity,
    },
  );
  return query
      .watch()
      .map(
        (rows) => switch (rows) {
          [] => noAssetSpaces,
          [final row] => (count: 1, color: UserAvatarColor.fromJson(row.readNullable<String>('color'))),
          _ => (count: rows.length, color: null),
        },
      )
      // Every write to the space tables reruns the query: only a change reaches the tile.
      .distinct();
}

final assetSpacesProvider = StreamProvider.autoDispose.family<AssetSpaces, String>((ref, assetId) {
  final userId = ref.watch(currentUserProvider.select((user) => user?.id));
  return userId == null ? Stream.value(noAssetSpaces) : watchAssetSpaces(ref.watch(driftProvider), userId, assetId);
});
