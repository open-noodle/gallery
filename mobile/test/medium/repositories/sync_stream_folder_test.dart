import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/infrastructure/repositories/sync_stream.repository.dart';
import 'package:openapi/api.dart';

import '../repository_context.dart';

void main() {
  late MediumRepositoryContext ctx;
  late SyncStreamRepository repo;

  setUp(() {
    ctx = MediumRepositoryContext();
    repo = SyncStreamRepository(ctx.db);
  });
  tearDown(() => ctx.dispose());

  Future<List<Map<String, Object?>>> folderRows() async {
    final rows = await ctx.db.customSelect('SELECT * FROM shared_space_album_folder_entity').get();
    return rows.map((r) => r.data).toList();
  }

  group('updateSharedSpaceAlbumFoldersV1', () {
    // H-01
    test('H-01: inserts folder rows, and re-delivery updates rather than duplicating', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);

      await repo.updateSharedSpaceAlbumFoldersV1([
        SyncSharedSpaceAlbumFolderV1(
          id: 'f1',
          spaceId: space.id,
          parentId: null,
          name: 'Trips',
          createdAt: DateTime.utc(2026, 1, 1),
          updatedAt: DateTime.utc(2026, 1, 1),
        ),
      ]);
      expect(await folderRows(), hasLength(1));

      await repo.updateSharedSpaceAlbumFoldersV1([
        SyncSharedSpaceAlbumFolderV1(
          id: 'f1',
          spaceId: space.id,
          parentId: null,
          name: 'Travel',
          createdAt: DateTime.utc(2026, 1, 1),
          updatedAt: DateTime.utc(2026, 1, 2),
        ),
      ]);

      final rows = await folderRows();
      expect(rows, hasLength(1));
      expect(rows.single['name'], 'Travel');
    });

    // H-03 — sync makes no ordering guarantee, so this is the NORMAL case, not an exotic one.
    // The row must persist with its dangling parentId; the tree module treats it as a root until
    // the parent lands.
    test('H-03: a child arriving before its parent is stored with its parentId intact', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);

      await repo.updateSharedSpaceAlbumFoldersV1([
        SyncSharedSpaceAlbumFolderV1(
          id: 'child',
          spaceId: space.id,
          parentId: 'parent-not-here-yet',
          name: '2026',
          createdAt: DateTime.utc(2026, 1, 1),
          updatedAt: DateTime.utc(2026, 1, 1),
        ),
      ]);

      final rows = await folderRows();
      expect(rows, hasLength(1));
      expect(rows.single['parent_id'], 'parent-not-here-yet');
    });
  });

  group('deleteSharedSpaceAlbumFoldersV1', () {
    // H-02
    test('H-02: removes the named folder rows', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      await ctx.insertSharedSpaceAlbumFolder(spaceId: space.id, id: 'f1', name: 'Trips');
      await ctx.insertSharedSpaceAlbumFolder(spaceId: space.id, id: 'f2', name: 'Family');

      await repo.deleteSharedSpaceAlbumFoldersV1([SyncSharedSpaceAlbumFolderDeleteV1(folderId: 'f1')]);

      final rows = await folderRows();
      expect(rows.map((r) => r['id']), ['f2']);
    });
  });

  group('link placement', () {
    // H-04
    test('H-04: a link upsert carrying folderId writes the column', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'Rome');

      await repo.updateSharedSpaceAlbumLinksV1([
        SyncSharedSpaceAlbumLinkV1(
          spaceId: space.id,
          albumId: album.id,
          showInTimeline: true,
          addedById: null,
          folderId: 'f1',
          createdAt: DateTime.utc(2026, 1, 1),
          updatedAt: DateTime.utc(2026, 1, 1),
        ),
      ]);

      final rows = await ctx.db.customSelect('SELECT * FROM shared_space_album_link_entity').get();
      expect(rows.single.data['folder_id'], 'f1');
    });
  });

  group('space cascade', () {
    // H-06 — losing access to a space must not leave its folder names behind on the device.
    test('H-06: deleting the space removes its folders via the cascade FK', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      await ctx.insertSharedSpaceAlbumFolder(spaceId: space.id, id: 'f1', name: 'Divorce');

      await ctx.db.customStatement('DELETE FROM shared_space_entity WHERE id = ?', [space.id]);

      expect(await folderRows(), isEmpty);
    });
  });

  group('SyncResetV1', () {
    // reset() is the recovery path for a device that fell too far behind (the server sends
    // SyncResetV1 past MAX_DAYS) or whose local DB is suspect. It wipes every remote table so the
    // re-sync can rebuild from scratch — and it runs under `PRAGMA foreign_keys = OFF`, so the
    // spaceId cascade that H-06 relies on does NOT fire here. A table missing from that block is
    // therefore never cleared by anything:
    //
    //   - a folder deleted server-side while the device was away has had its tombstone pruned
    //     (server prunes at MAX_DAYS + 1), so the delete is never re-delivered — the row becomes a
    //     permanent phantom folder in the grid and in the move picker;
    //   - folders for spaces the user was removed from stay on disk, with their names, while every
    //     other space table is rebuilt from what the user can still access.
    //
    // No reset() test existed for ANY space table, which is why the omission was invisible.
    test('clears shared space album folders, which no cascade can reach with FKs off', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      await ctx.insertSharedSpaceAlbumFolder(spaceId: space.id, id: 'f1', name: 'Divorce paperwork');

      await repo.reset();

      expect(await folderRows(), isEmpty);
    });

    // The control: reset() clears the neighbouring fork tables too. Without this, the test above
    // could pass against a reset() that simply dropped everything indiscriminately, and it would
    // not notice if a future table were added to the block but the folder line removed.
    test('clears the space row alongside it', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      await ctx.insertSharedSpaceAlbumFolder(spaceId: space.id, id: 'f1', name: 'Trips');

      await repo.reset();

      final spaces = await ctx.db.customSelect('SELECT * FROM shared_space_entity').get();
      expect(spaces, isEmpty);
    });
  });
}
