import { Kysely, sql } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(SharedSpaceRepository) };
};

const seed = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  return { user, space };
};

/** Insert a folder with raw SQL — the repository does not exist yet in this task. */
const insertFolder = async (
  ctx: ReturnType<typeof setup>['ctx'],
  values: { spaceId: string; parentId?: string | null; name: string; createdById?: string | null },
) => {
  const row = await ctx.database
    .insertInto('shared_space_album_folder')
    .values({
      spaceId: values.spaceId,
      parentId: values.parentId ?? null,
      name: values.name,
      createdById: values.createdById ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return row;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('shared_space_album_folder schema', () => {
  // F-03 (index half): case-insensitive sibling uniqueness at the ROOT level.
  // PG14 has no NULLS NOT DISTINCT, so this is the partial index that had to be split out.
  it('rejects two root folders whose names differ only by case', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);

    await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });

    await expect(insertFolder(ctx, { spaceId: space.id, name: 'trips' })).rejects.toThrow(
      /shared_space_album_folder_root_name_key/,
    );
  });

  // F-03 (index half): the same rule one level down, via the other partial index.
  it('rejects two sibling folders whose names differ only by case', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);
    const parent = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });

    await insertFolder(ctx, { spaceId: space.id, parentId: parent.id, name: '2026' });

    await expect(insertFolder(ctx, { spaceId: space.id, parentId: parent.id, name: '2026' })).rejects.toThrow(
      /shared_space_album_folder_nested_name_key/,
    );
  });

  // F-03: names are compared after trimming, so padding cannot smuggle a duplicate past the index.
  it('rejects a sibling whose name differs only by surrounding whitespace', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);

    await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });

    await expect(insertFolder(ctx, { spaceId: space.id, name: '  Trips  ' })).rejects.toThrow(
      /shared_space_album_folder_root_name_key/,
    );
  });

  // F-04: the same name under DIFFERENT parents is legal — this is what a single
  // (spaceId, parentId, lower(name)) index would have got wrong for root rows.
  it('allows the same name under different parents', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);
    const parent = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });

    await insertFolder(ctx, { spaceId: space.id, parentId: parent.id, name: '2026' });
    const root2026 = await insertFolder(ctx, { spaceId: space.id, name: '2026' });

    expect(root2026.parentId).toBeNull();
  });

  // F-04: and the same name in a different SPACE is likewise legal.
  it('allows the same root name in a different space', async () => {
    const { ctx } = setup();
    const { user, space } = await seed(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: user.id });

    await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });
    const twin = await insertFolder(ctx, { spaceId: other.id, name: 'Trips' });

    expect(twin.spaceId).toBe(other.id);
  });

  // X-01: spaces are hard-deleted (shared_space has no deletedAt), so this exercises a real
  // cascade — including the self-FK, which must not error on a nested tree.
  it('X-01: deleting the space cascades the whole folder tree', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);
    const a = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });
    const b = await insertFolder(ctx, { spaceId: space.id, parentId: a.id, name: '2026' });
    await insertFolder(ctx, { spaceId: space.id, parentId: b.id, name: 'Italy' });

    await ctx.database.deleteFrom('shared_space').where('id', '=', space.id).execute();

    const remaining = await ctx.database
      .selectFrom('shared_space_album_folder')
      .selectAll()
      .where('spaceId', '=', space.id)
      .execute();
    expect(remaining).toEqual([]);
  });

  // X-02: the existing album_soft_delete_shared_space_album trigger (1782050000000) tombstones
  // the link into shared_space_album_audit for sync and revokes member grants, but — verified
  // against its actual PLPGSQL body and against shared-space-album-soft-delete-triggers.spec.ts —
  // it does NOT physically delete the shared_space_album row (that only happens on a real
  // hard-delete, see X-03; soft-delete is reversible via restore, which re-grants against the
  // still-present link). So the link row, and its folderId, survive a soft-delete intact —
  // along with the folder itself.
  it('X-02: soft-deleting an album tombstones the link for sync but leaves the row and the folder intact', async () => {
    const { ctx } = setup();
    const { user, space } = await seed(ctx);
    const folder = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });

    await ctx.database
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, folderId: folder.id })
      .execute();

    await ctx.database.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('spaceId', '=', space.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBe(folder.id);

    const linkAudit = await ctx.database
      .selectFrom('shared_space_album_audit')
      .selectAll()
      .where('spaceId', '=', space.id)
      .where('albumId', '=', album.id)
      .execute();
    expect(linkAudit).toHaveLength(1);

    const folders = await ctx.database
      .selectFrom('shared_space_album_folder')
      .selectAll()
      .where('id', '=', folder.id)
      .execute();
    expect(folders).toHaveLength(1);
  });

  // X-03: hard-deleting the album cascades the link away; the folder remains, now empty.
  it('X-03: deleting the album cascades the link and leaves the folder empty', async () => {
    const { ctx } = setup();
    const { user, space } = await seed(ctx);
    const folder = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });

    await ctx.database
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, folderId: folder.id })
      .execute();

    await ctx.database.deleteFrom('album').where('id', '=', album.id).execute();

    const links = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('folderId', '=', folder.id)
      .execute();
    expect(links).toEqual([]);

    const folders = await ctx.database
      .selectFrom('shared_space_album_folder')
      .selectAll()
      .where('id', '=', folder.id)
      .execute();
    expect(folders).toHaveLength(1);
  });

  // Guards the ON DELETE SET NULL on folderId. The service always promotes children first
  // (Task 3), so this path only fires on a direct SQL delete — but if it ever CASCADEd
  // instead, deleting a folder would silently unlink albums.
  it('nulls folderId rather than deleting the link when a folder row is deleted directly', async () => {
    const { ctx } = setup();
    const { user, space } = await seed(ctx);
    const folder = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });

    await ctx.database
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, folderId: folder.id })
      .execute();

    await ctx.database.deleteFrom('shared_space_album_folder').where('id', '=', folder.id).execute();

    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('spaceId', '=', space.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBeNull();
  });

  // The self-FK is CASCADE, so a subtree disappears with its root on a direct delete.
  it('cascades child folders when a parent folder row is deleted directly', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);
    const parent = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });
    const child = await insertFolder(ctx, { spaceId: space.id, parentId: parent.id, name: '2026' });

    await ctx.database.deleteFrom('shared_space_album_folder').where('id', '=', parent.id).execute();

    const rows = await ctx.database
      .selectFrom('shared_space_album_folder')
      .selectAll()
      .where('id', '=', child.id)
      .execute();
    expect(rows).toEqual([]);
  });

  // createId/updateId are the mobile-parity hedge: they must default like every other
  // fork table, or a future sync entity needs a second migration.
  it('defaults createId and updateId to uuid v7 values', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);

    const folder = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });

    expect(folder.createId).toEqual(expect.any(String));
    expect(folder.updateId).toEqual(expect.any(String));
  });

  // The updatedAt trigger must be registered, or PATCH would leave updatedAt stale.
  it('bumps updatedAt via the trigger on update', async () => {
    const { ctx } = setup();
    const { space } = await seed(ctx);
    const folder = await insertFolder(ctx, { spaceId: space.id, name: 'Trips' });

    await sql`SELECT pg_sleep(0.01)`.execute(ctx.database);
    const updated = await ctx.database
      .updateTable('shared_space_album_folder')
      .set({ name: 'Travel' })
      .where('id', '=', folder.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(updated.updatedAt.getTime()).toBeGreaterThan(folder.updatedAt.getTime());
  });
});

describe('SharedSpaceRepository — album folder primitives', () => {
  // P-01
  it('P-01: createAlbumFolder persists the row and getAlbumFolderById round-trips it', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);

    const created = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    expect(created).toMatchObject({ spaceId: space.id, parentId: null, name: 'Trips', createdById: user.id });
    await expect(sut.getAlbumFolderById(space.id, created.id)).resolves.toMatchObject({ id: created.id });
  });

  // P-01: getAlbumFolderById is space-scoped, so a folder id from another space reads as absent
  // rather than leaking. This is the read-side half of the same-space invariant.
  it('P-01: getAlbumFolderById does not return a folder from another space', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: user.id });
    const folder = await sut.createAlbumFolder({
      spaceId: other.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.getAlbumFolderById(space.id, folder.id)).resolves.toBeUndefined();
  });

  // P-02 — this is the repository half of R-08, the cross-space read-leak test.
  it('P-02: getAlbumFoldersBySpace returns every folder of the space and none from another', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: user.id });

    const a = await sut.createAlbumFolder({ spaceId: space.id, parentId: null, name: 'Trips', createdById: user.id });
    const b = await sut.createAlbumFolder({ spaceId: space.id, parentId: a.id, name: '2026', createdById: user.id });
    await sut.createAlbumFolder({ spaceId: other.id, parentId: null, name: 'Secret', createdById: user.id });

    const rows = await sut.getAlbumFoldersBySpace(space.id);

    expect(rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  // P-03
  it('P-03: getAlbumFolderAncestors returns the chain self-first up to the root', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const y2026 = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });
    const italy = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: y2026.id,
      name: 'Italy',
      createdById: user.id,
    });

    const chain = await sut.getAlbumFolderAncestors(italy.id);

    expect(chain.map((c) => c.id)).toEqual([italy.id, y2026.id, trips.id]);
  });

  // P-03: a root folder is its own single-element chain — depth 1, per the spec's convention.
  it('P-03: getAlbumFolderAncestors returns a single element for a root folder', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.getAlbumFolderAncestors(trips.id)).resolves.toHaveLength(1);
  });

  // P-04
  it('P-04: getAlbumFolderSubtree returns the folder and all descendants with relative depth', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const y2026 = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });
    const italy = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: y2026.id,
      name: 'Italy',
      createdById: user.id,
    });

    const subtree = await sut.getAlbumFolderSubtree(trips.id);

    expect(subtree.sort((x, y) => x.depth - y.depth)).toEqual([
      { id: trips.id, depth: 0 },
      { id: y2026.id, depth: 1 },
      { id: italy.id, depth: 2 },
    ]);
  });

  // P-04: a leaf is depth 0 and alone — this is what makes height() zero for a leaf, which
  // the move depth formula (depth(target) + 1 + height) depends on.
  it('P-04: getAlbumFolderSubtree returns only self for a leaf', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.getAlbumFolderSubtree(trips.id)).resolves.toEqual([{ id: trips.id, depth: 0 }]);
  });

  // P-05: promotion is ONE LEVEL and SHALLOW. Grandchildren keep their parents.
  it('P-05: deleteAlbumFolderPromotingChildren promotes direct children one level only', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const y2026 = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });
    const italy = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: y2026.id,
      name: 'Italy',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, folderId: italy.id })
      .execute();

    const deleted = await sut.deleteAlbumFolderPromotingChildren(space.id, y2026.id);

    expect(deleted).toBe(true);
    // 2026's direct child Italy moves up to Trips…
    await expect(sut.getAlbumFolderById(space.id, italy.id)).resolves.toMatchObject({ parentId: trips.id });
    // …but the album inside Italy is untouched.
    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBe(italy.id);
  });

  // P-05: album links directly inside the deleted folder are repointed, never unlinked.
  it('P-05: deleteAlbumFolderPromotingChildren repoints album links and never unlinks', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const archive = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Archive',
      createdById: user.id,
    });
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: archive.id,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, folderId: trips.id })
      .execute();

    await sut.deleteAlbumFolderPromotingChildren(space.id, trips.id);

    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBe(archive.id);
  });

  it('P-05: deleteAlbumFolderPromotingChildren returns false for an unknown folder', async () => {
    const { ctx, sut } = setup();
    const { space } = await seed(ctx);

    await expect(
      sut.deleteAlbumFolderPromotingChildren(space.id, '00000000-0000-4000-8000-000000000000'),
    ).resolves.toBe(false);
  });

  // P-06
  it('P-06: countAlbumFoldersBySpace counts only this space', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: user.id });
    await sut.createAlbumFolder({ spaceId: space.id, parentId: null, name: 'A', createdById: user.id });
    await sut.createAlbumFolder({ spaceId: space.id, parentId: null, name: 'B', createdById: user.id });
    await sut.createAlbumFolder({ spaceId: other.id, parentId: null, name: 'C', createdById: user.id });

    await expect(sut.countAlbumFoldersBySpace(space.id)).resolves.toBe(2);
  });

  // P-07
  it('P-07: setAlbumLinkFolder writes folderId on the link', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database.insertInto('shared_space_album').values({ spaceId: space.id, albumId: album.id }).execute();

    await expect(sut.setAlbumLinkFolder(space.id, album.id, trips.id)).resolves.toBe(true);

    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBe(trips.id);
  });

  // P-07: no link row -> nothing updated. This is what turns A-06 into a 400 rather than a
  // silent success.
  it('P-07: setAlbumLinkFolder returns false when the album is not linked to the space', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Unlinked' });

    await expect(sut.setAlbumLinkFolder(space.id, album.id, trips.id)).resolves.toBe(false);
  });

  it('P-07: setAlbumLinkFolder clears the placement when given null', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, folderId: trips.id })
      .execute();

    await sut.setAlbumLinkFolder(space.id, album.id, null);

    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBeNull();
  });

  it('hasSiblingAlbumFolderName detects a case-insensitive collision and honours excludeId', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.hasSiblingAlbumFolderName(space.id, null, 'trips', null)).resolves.toBe(true);
    // Excluding the row itself is what makes rename-to-same-name (N-03) a no-op instead of a 400.
    await expect(sut.hasSiblingAlbumFolderName(space.id, null, 'trips', trips.id)).resolves.toBe(false);
    await expect(sut.hasSiblingAlbumFolderName(space.id, null, 'Family', null)).resolves.toBe(false);
  });

  it('updateAlbumFolder renames and reparents, and returns false for an unknown folder', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const archive = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Archive',
      createdById: user.id,
    });
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.updateAlbumFolder(space.id, trips.id, { name: 'Travel', parentId: archive.id })).resolves.toBe(
      true,
    );
    await expect(sut.getAlbumFolderById(space.id, trips.id)).resolves.toMatchObject({
      name: 'Travel',
      parentId: archive.id,
    });

    await expect(sut.updateAlbumFolder(space.id, '00000000-0000-4000-8000-000000000000', { name: 'X' })).resolves.toBe(
      false,
    );
  });
});

describe('SharedSpaceRepository — album folder moves', () => {
  it('moveAlbumFolderChecked reparents a folder', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const archive = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Archive',
      createdById: user.id,
    });
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.moveAlbumFolderChecked(space.id, trips.id, archive.id)).resolves.toBe('ok');
    await expect(sut.getAlbumFolderById(space.id, trips.id)).resolves.toMatchObject({ parentId: archive.id });
  });

  it('moveAlbumFolderChecked reports a cycle when the target is a descendant', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const y2026 = await sut.createAlbumFolder({
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });

    await expect(sut.moveAlbumFolderChecked(space.id, trips.id, y2026.id)).resolves.toBe('cycle');
    await expect(sut.getAlbumFolderById(space.id, trips.id)).resolves.toMatchObject({ parentId: null });
  });

  it('moveAlbumFolderChecked reports notfound for a folder in another space', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: user.id });
    const foreign = await sut.createAlbumFolder({
      spaceId: other.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.moveAlbumFolderChecked(space.id, foreign.id, null)).resolves.toBe('notfound');
  });

  // C-01: the mutual race. Both pre-checks pass before either write lands, so correctness
  // depends entirely on the per-space advisory lock serialising the two transactions —
  // locking only the moved row would leave them touching disjoint rows and both would commit,
  // producing a detached cycle.
  it('C-01: concurrent X->Y and Y->X moves cannot both succeed', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const x = await sut.createAlbumFolder({ spaceId: space.id, parentId: null, name: 'X', createdById: user.id });
    const y = await sut.createAlbumFolder({ spaceId: space.id, parentId: null, name: 'Y', createdById: user.id });

    const results = await Promise.all([
      sut.moveAlbumFolderChecked(space.id, x.id, y.id),
      sut.moveAlbumFolderChecked(space.id, y.id, x.id),
    ]);

    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'cycle')).toHaveLength(1);

    // And the tree is still a tree: exactly one of them still sits at the root.
    const rows = await sut.getAlbumFoldersBySpace(space.id);
    expect(rows.filter((r) => r.parentId === null)).toHaveLength(1);
  });
});
