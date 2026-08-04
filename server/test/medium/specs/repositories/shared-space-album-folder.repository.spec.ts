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
