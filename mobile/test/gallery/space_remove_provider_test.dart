import 'package:drift/drift.dart' hide isNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/data/db/main/table/remote/asset.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_album_asset.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_album_link.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_asset.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_library.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_member.drift.dart';
import 'package:immich_mobile/data/db/main/table/user/user.drift.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/gallery/space_remove.provider.dart';
import 'package:openapi/api.dart' show UserAvatarColor;

void main() {
  late Drift db;

  setUp(() async {
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    for (final id in ['me', 'other']) {
      await db.into(db.userEntity).insert(UserEntityCompanion.insert(id: id, email: '$id@test', name: id));
    }
  });

  tearDown(() => db.close());

  Future<void> asset(String id, {String? libraryId}) => db
      .into(db.remoteAssetEntity)
      .insert(
        RemoteAssetEntityCompanion.insert(
          id: id,
          name: '$id.jpg',
          type: AssetType.image,
          checksum: 'c-$id',
          ownerId: 'other',
          visibility: AssetVisibility.timeline,
          libraryId: Value(libraryId),
        ),
      );

  /// A space created by [createdBy], where 'me' has [role] (no row when null).
  Future<void> space(String id, {String? role = 'editor', String createdBy = 'other', String? color}) async {
    await db
        .into(db.sharedSpaceEntity)
        .insert(SharedSpaceEntityCompanion.insert(id: id, name: id, createdById: createdBy, color: Value(color)));
    if (role != null) {
      await db
          .into(db.sharedSpaceMemberEntity)
          .insert(SharedSpaceMemberEntityCompanion.insert(spaceId: id, userId: 'me', role: role));
    }
  }

  Future<void> add(String spaceId, String assetId) => db
      .into(db.sharedSpaceAssetEntity)
      .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: assetId));

  Future<void> linkAlbum(String spaceId, String albumId, List<String> assetIds) async {
    await db
        .into(db.sharedSpaceAlbumLinkEntity)
        .insert(SharedSpaceAlbumLinkEntityCompanion.insert(spaceId: spaceId, albumId: albumId));
    for (final assetId in assetIds) {
      await db
          .into(db.sharedSpaceAlbumAssetEntity)
          .insertOnConflictUpdate(SharedSpaceAlbumAssetEntityCompanion.insert(albumId: albumId, assetId: assetId));
    }
  }

  Future<void> linkLibrary(String spaceId, String libraryId) => db
      .into(db.sharedSpaceLibraryEntity)
      .insert(SharedSpaceLibraryEntityCompanion.insert(spaceId: spaceId, libraryId: libraryId));

  Future<List<RemovableSpace>> removable(List<String> assetIds) =>
      queryRemovableSpaces(db, userId: 'me', assetIds: assetIds);

  Map<String, List<String>> byId(List<RemovableSpace> spaces) => {
    for (final space in spaces) space.id: space.assetIds..sort(),
  };

  test('finds the space of each selected photo, whatever the path', () async {
    await asset('a1');
    await asset('a2');
    await asset('a3', libraryId: 'lib');
    await space('added', color: 'pink');
    await space('album');
    await space('library');
    await add('added', 'a1');
    await linkAlbum('album', 'trip', ['a2']);
    await linkLibrary('library', 'lib');

    final spaces = await removable(['a1', 'a2', 'a3']);

    expect(byId(spaces), {
      'added': ['a1'],
      'album': ['a2'],
      'library': ['a3'],
    });
    final added = spaces.firstWhere((space) => space.id == 'added');
    expect(added.name, 'added');
    expect(added.color, UserAvatarColor.pink);
  });

  test('counts a photo that reaches a space twice once', () async {
    await asset('a1');
    await space('family');
    await add('family', 'a1');
    await linkAlbum('family', 'trip', ['a1']);

    expect(byId(await removable(['a1'])), {
      'family': ['a1'],
    });
  });

  test('offers only the spaces the user owns, edits or created', () async {
    await asset('a1');
    for (final (id, role, createdBy) in [
      ('owned', 'owner', 'other'),
      ('edited', 'editor', 'other'),
      ('created', null, 'me'),
      ('viewed', 'viewer', 'other'),
      ('theirs', null, 'other'),
    ]) {
      await space(id, role: role, createdBy: createdBy);
      await add(id, 'a1');
    }

    expect(byId(await removable(['a1'])).keys, unorderedEquals(['owned', 'edited', 'created']));
  });

  test('puts the space holding most of the selection first, then sorts by name', () async {
    for (final id in ['a1', 'a2', 'a3']) {
      await asset(id);
    }
    await space('Gamma');
    await space('Beta');
    await space('Alpha');
    await add('Beta', 'a1');
    await add('Beta', 'a2');
    await add('Gamma', 'a3');
    await add('Alpha', 'a3');

    expect(
      [
        for (final space in await removable(['a1', 'a2', 'a3'])) space.id,
      ],
      ['Beta', 'Alpha', 'Gamma'],
    );
  });

  test('takes a selection larger than the SQL variable limit', () async {
    await asset('a1');
    await asset('a2');
    await space('family');
    await add('family', 'a1');
    await add('family', 'a2');

    final selection = [for (var i = 0; i < 1500; i++) 'missing-$i', 'a1', 'a2'];

    expect(byId(await removable(selection)), {
      'family': ['a1', 'a2'],
    });
  });

  test('is empty for an empty selection', () async {
    await asset('a1');
    await space('family');
    await add('family', 'a1');

    expect(await removable(const []), isEmpty);
  });
}
