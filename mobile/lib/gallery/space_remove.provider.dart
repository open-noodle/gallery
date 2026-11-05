import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/presentation/actions/action.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:openapi/api.dart' show UserAvatarColor;

/// A space the selection can be removed from, with the selected assets it holds.
typedef RemovableSpace = ({String id, String name, UserAvatarColor? color, List<String> assetIds});

// The badge's three paths into a space (added to it, in a linked album, in a linked library), hidden spaces and
// albums included, kept to the spaces the user may remove from: one they created, or where they are owner or editor,
// as the server requires. The selection goes in as one JSON array, so its size is not bound by SQLite's variables.
const _removableSpacesSql = '''
WITH selected(asset_id) AS (SELECT value FROM json_each(?2)),
paths(space_id, asset_id) AS (
  SELECT ssa.space_id, ssa.asset_id FROM shared_space_asset_entity ssa
  INNER JOIN selected sel ON sel.asset_id = ssa.asset_id
  UNION
  SELECT ssal.space_id, ssaa.asset_id FROM shared_space_album_asset_entity ssaa
  INNER JOIN shared_space_album_link_entity ssal ON ssal.album_id = ssaa.album_id
  INNER JOIN selected sel ON sel.asset_id = ssaa.asset_id
  UNION
  SELECT ssl.space_id, rae.id FROM remote_asset_entity rae
  INNER JOIN shared_space_library_entity ssl ON ssl.library_id = rae.library_id
  INNER JOIN selected sel ON sel.asset_id = rae.id
)
SELECT s.id AS id, s.name AS name, s.color AS color, p.asset_id AS asset_id
FROM paths p
INNER JOIN shared_space_entity s ON s.id = p.space_id
WHERE s.created_by_id = ?1 OR EXISTS (
  SELECT 1 FROM shared_space_member_entity m
  WHERE m.space_id = s.id AND m.user_id = ?1 AND m.role IN ('owner', 'editor')
)
''';

/// The spaces [userId] may remove some of [assetIds] from, the one holding most of them first, then by name.
Future<List<RemovableSpace>> queryRemovableSpaces(
  Drift db, {
  required String userId,
  required List<String> assetIds,
}) async {
  if (assetIds.isEmpty) {
    return const [];
  }
  final rows = await db
      .customSelect(
        _removableSpacesSql,
        variables: [Variable.withString(userId), Variable.withString(jsonEncode(assetIds))],
      )
      .get();

  final spaces = <String, RemovableSpace>{};
  for (final row in rows) {
    final id = row.read<String>('id');
    final space = spaces[id] ??= (
      id: id,
      name: row.read<String>('name'),
      color: UserAvatarColor.fromJson(row.readNullable<String>('color')),
      assetIds: <String>[],
    );
    space.assetIds.add(row.read<String>('asset_id'));
  }
  return spaces.values.toList()..sort(
    (a, b) => switch (b.assetIds.length.compareTo(a.assetIds.length)) {
      0 => a.name.compareTo(b.name),
      final order => order,
    },
  );
}

/// The spaces the Photos selection can be removed from.
final removableSpacesProvider = FutureProvider.autoDispose<List<RemovableSpace>>((ref) {
  final userId = ref.watch(currentUserProvider.select((user) => user?.id));
  final assetIds = [for (final asset in ref.watch(assetsActionProvider(ActionSource.timeline)).remote()) asset.id];
  if (userId == null || assetIds.isEmpty) {
    return const [];
  }
  return queryRemovableSpaces(ref.watch(driftProvider), userId: userId, assetIds: assetIds);
}, dependencies: [assetsActionProvider]);
