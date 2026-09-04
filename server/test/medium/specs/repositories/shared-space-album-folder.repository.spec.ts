import { Kysely, sql } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { ALBUM_FOLDER_TRAVERSAL_LIMIT, SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { SHARED_SPACE_ALBUM_FOLDER_MAX_DEPTH } from 'src/services/shared-space.service';
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

/**
 * Fixture helper: creates a folder through the repository and unwraps the capped result.
 *
 * `createAlbumFolder` enforces the per-space cap inside its own locked transaction, so it returns
 * a discriminated result rather than a row. Fixtures are never trying to exercise the cap — they
 * pass NO_FIXTURE_CAP and treat anything but 'ok' as a broken fixture, loudly. The cap's own
 * behaviour is covered by the P-06 tests, which pass a deliberately small cap.
 */
const NO_FIXTURE_CAP = 10_000;

const createFolder = async (
  sut: SharedSpaceRepository,
  dto: { spaceId: string; parentId: string | null; name: string; createdById: string | null },
) => {
  const result = await sut.createAlbumFolder(dto, NO_FIXTURE_CAP);
  if (result.outcome !== 'ok') {
    throw new Error(`fixture folder create returned '${result.outcome}', expected 'ok'`);
  }
  return result.folder;
};

/** Fails loudly instead of hanging the run if a guard is ever removed. */
const withinTimeout = async <T>(label: string, work: Promise<T>, ms = 15_000): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const bomb = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not terminate within ${ms}ms — cycle guard missing?`)), ms);
  });
  try {
    return await Promise.race([work, bomb]);
  } finally {
    clearTimeout(timer);
  }
};

/** A ↔ B, neither reachable from a root. */
const seedCycle = async (ctx: ReturnType<typeof setup>['ctx'], spaceId: string) => {
  const a = await insertFolder(ctx, { spaceId, name: 'A' });
  const b = await insertFolder(ctx, { spaceId, parentId: a.id, name: 'B' });
  await ctx.database.updateTable('shared_space_album_folder').set({ parentId: b.id }).where('id', '=', a.id).execute();
  return { a, b };
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

    const created = await createFolder(sut, {
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
    const folder = await createFolder(sut, {
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

    const a = await createFolder(sut, { spaceId: space.id, parentId: null, name: 'Trips', createdById: user.id });
    const b = await createFolder(sut, { spaceId: space.id, parentId: a.id, name: '2026', createdById: user.id });
    await createFolder(sut, { spaceId: other.id, parentId: null, name: 'Secret', createdById: user.id });

    const rows = await sut.getAlbumFoldersBySpace(space.id);

    expect(rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  // P-03
  it('P-03: getAlbumFolderAncestors returns the chain self-first up to the root', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const y2026 = await createFolder(sut, {
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });
    const italy = await createFolder(sut, {
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
    const trips = await createFolder(sut, {
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
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const y2026 = await createFolder(sut, {
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });
    const italy = await createFolder(sut, {
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
    const trips = await createFolder(sut, {
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
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const y2026 = await createFolder(sut, {
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });
    const italy = await createFolder(sut, {
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

    expect(deleted).toEqual({ outcome: 'ok' });
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
    const archive = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Archive',
      createdById: user.id,
    });
    const trips = await createFolder(sut, {
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

  it('P-05: deleteAlbumFolderPromotingChildren reports notfound for an unknown folder', async () => {
    const { ctx, sut } = setup();
    const { space } = await seed(ctx);

    await expect(
      sut.deleteAlbumFolderPromotingChildren(space.id, '00000000-0000-4000-8000-000000000000'),
    ).resolves.toEqual({ outcome: 'notfound' });
  });

  // The CRITICAL fix: deleting "Trips" (root "Trips" -> "Trips/2026", plus a second root "2026")
  // promotes "2026" straight into a root that already has a folder called "2026" (F-04 explicitly
  // allows the same name under different parents, so this precondition is legal to construct).
  // Both partial unique indexes are non-deferrable, so a naive promote UPDATE would 23505 and
  // escape as an unmapped 500. The fix refuses the delete with a 'conflict' outcome instead, and
  // the transaction must roll back completely: the folder survives, and its children are untouched.
  it('P-05: deleteAlbumFolderPromotingChildren refuses a promote that collides with a sibling name, rolling back', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const nested2026 = await createFolder(sut, {
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });
    const root2026 = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: '2026',
      createdById: user.id,
    });

    // `reason: 'sibling'` is the classification that makes the 400 say "at the destination" — which
    // is accurate HERE, where a pre-existing root "2026" is the thing being collided with. The
    // other classification ('parent') is covered below.
    await expect(sut.deleteAlbumFolderPromotingChildren(space.id, trips.id)).resolves.toEqual({
      outcome: 'conflict',
      name: '2026',
      reason: 'sibling',
    });

    // Rolled back: "Trips" still exists, its child is still nested under it, and the pre-existing
    // root "2026" was never touched.
    await expect(sut.getAlbumFolderById(space.id, trips.id)).resolves.toMatchObject({ id: trips.id });
    await expect(sut.getAlbumFolderById(space.id, nested2026.id)).resolves.toMatchObject({ parentId: trips.id });
    await expect(sut.getAlbumFolderById(space.id, root2026.id)).resolves.toMatchObject({ parentId: null });
  });

  // The OTHER collision, and the one that used to arrive nameless from the 23505 backstop: the
  // child is named like the folder being deleted. Spec F-04 permits that pair (same name, different
  // parents), so it is reachable — and the deleted folder still holds its own unique-index entry
  // while its children are promoted past it, because the DELETE comes several statements later.
  // Classifying it here is what lets the service say "rename it first" instead of blaming the
  // destination, where nothing is wrong.
  it('P-05: deleteAlbumFolderPromotingChildren reports a child colliding with the deleted folder itself', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    // Same name as its parent, differing only by case — the indexes fold case, so this collides.
    await createFolder(sut, { spaceId: space.id, parentId: trips.id, name: 'trips', createdById: user.id });

    await expect(sut.deleteAlbumFolderPromotingChildren(space.id, trips.id)).resolves.toEqual({
      outcome: 'conflict',
      name: 'trips',
      reason: 'parent',
    });

    // Rolled back, not half-promoted.
    await expect(sut.getAlbumFolderById(space.id, trips.id)).resolves.toMatchObject({ id: trips.id });
  });

  // Non-colliding sibling: the delete must still succeed normally when there is no name clash —
  // proves the new pre-check doesn't false-positive on an ordinary promote.
  it('P-05: deleteAlbumFolderPromotingChildren still promotes normally when no sibling name collides', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const y2026 = await createFolder(sut, {
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });
    await createFolder(sut, { spaceId: space.id, parentId: null, name: 'Unrelated', createdById: user.id });

    await expect(sut.deleteAlbumFolderPromotingChildren(space.id, trips.id)).resolves.toEqual({ outcome: 'ok' });

    await expect(sut.getAlbumFolderById(space.id, y2026.id)).resolves.toMatchObject({ parentId: null });
    await expect(sut.getAlbumFolderById(space.id, trips.id)).resolves.toBeUndefined();
  });

  // P-06: the per-space folder cap. Enforced inside createAlbumFolder's own locked transaction
  // rather than by a count in the service followed by an insert — see the method's comment.
  it('P-06: refuses the create once the space is at the cap', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    await createFolder(sut, { spaceId: space.id, parentId: null, name: 'A', createdById: user.id });
    await createFolder(sut, { spaceId: space.id, parentId: null, name: 'B', createdById: user.id });

    await expect(
      sut.createAlbumFolder({ spaceId: space.id, parentId: null, name: 'C', createdById: user.id }, 2),
    ).resolves.toEqual({ outcome: 'cap' });

    const rows = await ctx.database
      .selectFrom('shared_space_album_folder')
      .selectAll()
      .where('spaceId', '=', space.id)
      .execute();
    expect(rows.map((r) => r.name).sort()).toEqual(['A', 'B']);
  });

  it('P-06: allows the create at one below the cap', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    await createFolder(sut, { spaceId: space.id, parentId: null, name: 'A', createdById: user.id });

    await expect(
      sut.createAlbumFolder({ spaceId: space.id, parentId: null, name: 'B', createdById: user.id }, 2),
    ).resolves.toMatchObject({ outcome: 'ok', folder: { name: 'B' } });
  });

  // P-06: the cap is scoped to ONE space. Without the spaceId predicate on the count, a busy
  // instance would start refusing creates in every space at once.
  it('P-06: counts only this space toward the cap', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: user.id });
    await createFolder(sut, { spaceId: other.id, parentId: null, name: 'A', createdById: user.id });
    await createFolder(sut, { spaceId: other.id, parentId: null, name: 'B', createdById: user.id });

    await expect(
      sut.createAlbumFolder({ spaceId: space.id, parentId: null, name: 'C', createdById: user.id }, 2),
    ).resolves.toMatchObject({ outcome: 'ok' });
  });

  // P-06: THE reason the count moved inside the transaction. Counting in the service and
  // inserting afterwards is a TOCTOU — under READ COMMITTED every concurrent create sitting at
  // cap-minus-one reads the same count and every one of them inserts. Four racing creates into
  // a space holding 2 folders with a cap of 3 must yield exactly one winner.
  it('P-06: concurrent creates at the cap admit exactly one', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    await createFolder(sut, { spaceId: space.id, parentId: null, name: 'A', createdById: user.id });
    await createFolder(sut, { spaceId: space.id, parentId: null, name: 'B', createdById: user.id });

    const results = await Promise.all(
      ['W', 'X', 'Y', 'Z'].map((name) =>
        sut.createAlbumFolder({ spaceId: space.id, parentId: null, name, createdById: user.id }, 3),
      ),
    );

    expect(results.filter((r) => r.outcome === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'cap')).toHaveLength(3);

    const rows = await ctx.database
      .selectFrom('shared_space_album_folder')
      .selectAll()
      .where('spaceId', '=', space.id)
      .execute();
    expect(rows).toHaveLength(3);
  });

  // P-07
  it('P-07: setAlbumLinkFolder writes folderId on the link', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await createFolder(sut, {
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
    const trips = await createFolder(sut, {
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
    const trips = await createFolder(sut, {
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

  // A-03: setAlbumLinkFolder is an unconditional overwrite with no conflict detection, so
  // repeating the exact same placement must be a true no-op — both calls return true and the
  // link's final state is unchanged. (Replaces a mocked unit test in shared-space.service.spec.ts
  // that only asserted the mock was CALLED twice, which cannot fail for any non-throwing stub.)
  it('A-03: setAlbumLinkFolder is idempotent when repeated with the same folderId', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database.insertInto('shared_space_album').values({ spaceId: space.id, albumId: album.id }).execute();

    await expect(sut.setAlbumLinkFolder(space.id, album.id, trips.id)).resolves.toBe(true);
    await expect(sut.setAlbumLinkFolder(space.id, album.id, trips.id)).resolves.toBe(true);

    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBe(trips.id);
  });

  // A-04: placement lives on the (spaceId, albumId) join row, so linking the SAME album into a
  // SECOND space and placing it there must not disturb its placement in the first space. (Replaces
  // a mocked unit test in shared-space.service.spec.ts that was byte-identical to A-01's
  // arrange/act/assert and so could not fail independently of it. No equivalent medium test
  // already existed — every other cross-space fixture in this file exercises FOLDERS in two
  // spaces, not the same ALBUM linked into two spaces.)
  it('A-04: setAlbumLinkFolder scopes the write to the given space, leaving the placement in another space untouched', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const { space: otherSpace } = await ctx.newSharedSpace({ createdById: user.id });
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database.insertInto('shared_space_album').values({ spaceId: space.id, albumId: album.id }).execute();
    await ctx.database.insertInto('shared_space_album').values({ spaceId: otherSpace.id, albumId: album.id }).execute();

    await expect(sut.setAlbumLinkFolder(space.id, album.id, trips.id)).resolves.toBe(true);

    const otherLink = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('spaceId', '=', otherSpace.id)
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    expect(otherLink.folderId).toBeNull();
  });

  it('hasSiblingAlbumFolderName detects a case-insensitive collision and honours excludeId', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await createFolder(sut, {
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

  // Every case above uses ROOT folders (parentId null), which is also all the e2e suite exercises
  // — the `parentId IS NULL` branch had zero coverage of the NON-null branch at any layer, so this
  // could be mutated to an unconditional `parentId IS NULL` and every existing test would still
  // pass. Two folders sharing a name under the SAME non-null parent must collide exactly like two
  // roots do.
  it('hasSiblingAlbumFolderName detects a case-insensitive collision under a NON-NULL parent', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const y2026 = await createFolder(sut, {
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });

    // Would false-negative under an unconditional `parentId IS NULL`: y2026's parentId is
    // trips.id, never NULL, so that mutation would never find it here.
    await expect(sut.hasSiblingAlbumFolderName(space.id, trips.id, '2026', null)).resolves.toBe(true);
    // excludeId still applies one level down.
    await expect(sut.hasSiblingAlbumFolderName(space.id, trips.id, '2026', y2026.id)).resolves.toBe(false);
  });

  // Task 3 review, Part B: updateAlbumFolder's dto is narrowed to `{ name: string }` only — a
  // parentId write through this method would bypass the advisory-lock + cycle machinery in
  // moveAlbumFolderChecked, which is now the compiler-enforced only path for reparenting (see
  // "moveAlbumFolderChecked reparents a folder" below for that coverage).
  it('updateAlbumFolder renames, and returns false for an unknown folder', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.updateAlbumFolder(space.id, trips.id, { name: 'Travel' })).resolves.toBe(true);
    await expect(sut.getAlbumFolderById(space.id, trips.id)).resolves.toMatchObject({
      name: 'Travel',
      parentId: null,
    });

    await expect(sut.updateAlbumFolder(space.id, '00000000-0000-4000-8000-000000000000', { name: 'X' })).resolves.toBe(
      false,
    );
  });
});

// A cycle should be impossible to create through the service — moveAlbumFolderChecked re-checks
// the ancestor chain under a per-space advisory lock. These tests build one with raw SQL anyway,
// because "impossible" only covers the code paths we know about: a restored backup, a manual
// UPDATE, or a future defect can all put one in the table. A `WITH RECURSIVE` walk over a cyclic
// adjacency list does not error, it SPINS — holding a request-path connection until something
// kills it. Every assertion below is really "this returned at all"; without the traversal guard
// each one hangs until the test times out.
describe('folder-tree traversal guards', () => {
  // The bound must sit ABOVE the service's depth cap. Below or equal, and a legitimate chain
  // would be truncated — under-reporting a folder's depth and letting a create through that
  // should have been refused. That would be a correctness bug wearing a safety guard's clothes.
  it('the traversal limit is above the depth cap, so it can never truncate a legal chain', () => {
    expect(ALBUM_FOLDER_TRAVERSAL_LIMIT).toBeGreaterThan(SHARED_SPACE_ALBUM_FOLDER_MAX_DEPTH);
  });

  it('getAlbumFolderAncestors returns a chain at the cap in full', async () => {
    const { ctx, sut } = setup();
    const { space } = await seed(ctx);
    let parentId: string | null = null;
    let deepest = '';
    for (let level = 1; level <= SHARED_SPACE_ALBUM_FOLDER_MAX_DEPTH; level++) {
      const row = await insertFolder(ctx, { spaceId: space.id, parentId, name: `L${level}` });
      parentId = row.id;
      deepest = row.id;
    }

    await expect(sut.getAlbumFolderAncestors(deepest)).resolves.toHaveLength(SHARED_SPACE_ALBUM_FOLDER_MAX_DEPTH);
  });

  it('getAlbumFolderAncestors terminates on a cycle instead of spinning', async () => {
    const { ctx, sut } = setup();
    const { space } = await seed(ctx);
    const { a } = await seedCycle(ctx, space.id);

    const chain = await withinTimeout('getAlbumFolderAncestors', sut.getAlbumFolderAncestors(a.id));

    // hops 0..LIMIT inclusive — the walk is cut off, not completed.
    expect(chain).toHaveLength(ALBUM_FOLDER_TRAVERSAL_LIMIT + 1);
  });

  it('getAlbumFolderSubtree terminates on a cycle instead of spinning', async () => {
    const { ctx, sut } = setup();
    const { space } = await seed(ctx);
    const { a } = await seedCycle(ctx, space.id);

    const subtree = await withinTimeout('getAlbumFolderSubtree', sut.getAlbumFolderSubtree(a.id));

    expect(subtree).toHaveLength(ALBUM_FOLDER_TRAVERSAL_LIMIT + 1);
    // The height it reports is over the depth cap, so the service refuses the move rather than
    // silently accepting one into corrupt structure.
    expect(Math.max(...subtree.map((node) => node.depth))).toBeGreaterThan(SHARED_SPACE_ALBUM_FOLDER_MAX_DEPTH);
  });

  // The worst place to hang: this walk IS the cycle check, and it runs holding the per-space
  // advisory lock, so spinning here would block every other folder move in the space too.
  it('moveAlbumFolderChecked terminates when the destination sits in a pre-existing cycle', async () => {
    const { ctx, sut } = setup();
    const { space } = await seed(ctx);
    const { a } = await seedCycle(ctx, space.id);
    const loose = await insertFolder(ctx, { spaceId: space.id, name: 'Loose' });

    // Terminating is the point of this test — hence the bomb. The verdict used to be 'ok' here,
    // with the refusal left to the service's depth pre-check; now that the depth cap is re-checked
    // under the lock the repository refuses it directly, which is what the sibling test above
    // ("getAlbumFolderSubtree terminates on a cycle") already describes as the intended outcome:
    // the bounded walk reports an over-cap depth, so a move into corrupt structure is refused
    // rather than silently accepted.
    await expect(
      withinTimeout('moveAlbumFolderChecked', sut.moveAlbumFolderChecked(space.id, loose.id, a.id)),
    ).resolves.toMatchObject({ depth: expect.any(Number) });
  });

  // And the case the guard must NOT break: a genuine descendant is still detected as a cycle.
  it('still detects a real cycle once the guard is in place', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await createFolder(sut, { spaceId: space.id, parentId: null, name: 'Trips', createdById: user.id });
    const nested = await createFolder(sut, {
      spaceId: space.id,
      parentId: trips.id,
      name: '2026',
      createdById: user.id,
    });

    await expect(sut.moveAlbumFolderChecked(space.id, trips.id, nested.id)).resolves.toBe('cycle');
  });
});

describe('SharedSpaceRepository — album folder moves', () => {
  it('moveAlbumFolderChecked reparents a folder', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const archive = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Archive',
      createdById: user.id,
    });
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.moveAlbumFolderChecked(space.id, trips.id, archive.id)).resolves.toBe('ok');
    await expect(sut.getAlbumFolderById(space.id, trips.id)).resolves.toMatchObject({ parentId: archive.id });
  });

  // The depth cap has to be re-checked HERE, under the advisory lock, not only in the service's
  // optimistic pre-check. Two concurrent moves each pass their own pre-check against a tree that
  // is still shallow, then serialise on the lock and compose:
  //
  //   T at depth 1, F at depth 1 with subtree height 8, U at depth 2
  //   A: move F under T  -> pre-check 1 + 1 + 8 = 10, allowed
  //   B: move T under U  -> pre-check 2 + 1 + 0 = 3,  allowed (T's height is still 0)
  //   both commit        -> U(2) -> T(3) -> F(4) -> ... -> depth 12
  //
  // Calling the repository directly is the deterministic form of the same hole: it is the writer,
  // so its verdict has to be authoritative for depth the way it already is for cycles.
  it('moveAlbumFolderChecked refuses a move that would exceed the depth cap', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);

    // A chain of 9: depth 1 (root) .. depth 9.
    const chain = [];
    let parentId: string | null = null;
    for (let i = 0; i < 9; i++) {
      const folder: { id: string } = await createFolder(sut, {
        spaceId: space.id,
        parentId,
        name: `level-${i}`,
        createdById: user.id,
      });
      chain.push(folder);
      parentId = folder.id;
    }
    // A separate root folder with one child, so its subtree height is 1.
    const loose = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Loose',
      createdById: user.id,
    });
    await createFolder(sut, { spaceId: space.id, parentId: loose.id, name: 'Child', createdById: user.id });

    // Destination is depth 9, moved subtree has height 1 -> 9 + 1 + 1 = 11, over the cap of 10.
    const destination = chain.at(-1)!;

    await expect(sut.moveAlbumFolderChecked(space.id, loose.id, destination.id)).resolves.toMatchObject({ depth: 11 });
    await expect(sut.getAlbumFolderById(space.id, loose.id)).resolves.toMatchObject({ parentId: null });
  });

  it('moveAlbumFolderChecked allows a move that lands exactly on the depth cap', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);

    const chain = [];
    let parentId: string | null = null;
    for (let i = 0; i < 9; i++) {
      const folder: { id: string } = await createFolder(sut, {
        spaceId: space.id,
        parentId,
        name: `level-${i}`,
        createdById: user.id,
      });
      chain.push(folder);
      parentId = folder.id;
    }
    const loose = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Loose',
      createdById: user.id,
    });

    // Destination depth 9, subtree height 0 -> 9 + 1 + 0 = 10, exactly the cap. Inclusive, so ok.
    const destination = chain.at(-1)!;

    await expect(sut.moveAlbumFolderChecked(space.id, loose.id, destination.id)).resolves.toBe('ok');
  });

  it('moveAlbumFolderChecked reports a cycle when the target is a descendant', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const y2026 = await createFolder(sut, {
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
    const foreign = await createFolder(sut, {
      spaceId: other.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.moveAlbumFolderChecked(space.id, foreign.id, null)).resolves.toBe('notfound');
  });

  // B-1: the destination already has a folder named exactly what the MOVED folder is currently
  // called. A naive two-statement implementation (UPDATE parentId, then UPDATE name) would write
  // the row into the destination still under its old name — "Trips" — colliding with the
  // existing "Trips" there via shared_space_album_folder_nested_name_key, even though the
  // caller's pre-check (which validates the NEW name "Trips 2024" against the destination) says
  // this move is legal. The combined UPDATE must never pass through that transient state.
  it('moveAlbumFolderChecked renames and reparents atomically, without a transient name collision', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const archive = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Archive',
      createdById: user.id,
    });
    // Archive already holds a folder named "Trips" — the CURRENT name of the folder about to move in.
    await createFolder(sut, { spaceId: space.id, parentId: archive.id, name: 'Trips', createdById: user.id });
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    await expect(sut.moveAlbumFolderChecked(space.id, trips.id, archive.id, 'Trips 2024')).resolves.toBe('ok');

    await expect(sut.getAlbumFolderById(space.id, trips.id)).resolves.toMatchObject({
      parentId: archive.id,
      name: 'Trips 2024',
    });
  });

  // C-01: the mutual race. Both pre-checks pass before either write lands, so correctness
  // depends entirely on the per-space advisory lock serialising the two transactions —
  // locking only the moved row would leave them touching disjoint rows and both would commit,
  // producing a detached cycle.
  //
  // B-2: this end-to-end race is NOT a reliable regression detector by itself. postgres.js opens
  // connections lazily and kysely-postgres-js reserves one per transaction, so with only one
  // connection open when Promise.all fires, the first move's three sub-millisecond loopback
  // queries and commit typically finish before the second move's fresh TCP connect + auth
  // handshake completes — the two end up serialised by connection setup, not by the lock under
  // test. Deleting the lock line does not reliably fail this test. The two mechanism tests below
  // are the actual regression coverage; this one stays as a smoke check.
  it('C-01: concurrent X->Y and Y->X moves cannot both succeed', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const x = await createFolder(sut, { spaceId: space.id, parentId: null, name: 'X', createdById: user.id });
    const y = await createFolder(sut, { spaceId: space.id, parentId: null, name: 'Y', createdById: user.id });

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

  // B-2 mechanism test: hold the exact advisory lock key moveAlbumFolderChecked takes, from a
  // second connection we control directly, and prove a concurrent move on the SAME space blocks
  // until we release it. Unlike the C-01 race above, this is deterministic on any machine —
  // deleting the lock line fails it instantly, because there is nothing left to make the move
  // wait.
  it('C-01 mechanism: a held lock on the same space blocks a concurrent move until released', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const archive = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Archive',
      createdById: user.id,
    });

    const { promise: releaseSignal, resolve: releaseLock } = Promise.withResolvers<void>();
    const { promise: lockAcquiredSignal, resolve: lockAcquired } = Promise.withResolvers<void>();

    const holder = ctx.database.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('shared-space-album-folder-move'), hashtext(${space.id}))`.execute(
        trx,
      );
      lockAcquired();
      await releaseSignal;
    });

    await lockAcquiredSignal;

    const movePromise = sut.moveAlbumFolderChecked(space.id, trips.id, archive.id);

    const raceResult = await Promise.race([
      movePromise.then(() => 'resolved' as const),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 300)),
    ]);
    expect(raceResult).toBe('pending');

    releaseLock();
    await holder;

    await expect(movePromise).resolves.toBe('ok');
  });

  // B-2 negative control: the lock must be scoped PER SPACE, not global — holding the identical
  // lock key for a DIFFERENT space must not block this move at all. Without this, a test that
  // merely proves "some lock exists" could pass even if the space id were dropped from the key
  // entirely (i.e. every move in the whole instance serialised against every other).
  it('C-01 mechanism: a held lock on a different space does not block the move', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const { space: otherSpace } = await ctx.newSharedSpace({ createdById: user.id });
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const archive = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Archive',
      createdById: user.id,
    });

    const { promise: releaseSignal, resolve: releaseLock } = Promise.withResolvers<void>();
    const { promise: lockAcquiredSignal, resolve: lockAcquired } = Promise.withResolvers<void>();

    const holder = ctx.database.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('shared-space-album-folder-move'), hashtext(${otherSpace.id}))`.execute(
        trx,
      );
      lockAcquired();
      await releaseSignal;
    });

    await lockAcquiredSignal;

    await expect(sut.moveAlbumFolderChecked(space.id, trips.id, archive.id)).resolves.toBe('ok');

    releaseLock();
    await holder;
  });

  // A delete is a structural rewrite of the tree just like a move, so it takes the SAME per-space
  // lock. Without it, moving X into F while F is being deleted races the promote: F's
  // self-referencing CASCADE would delete X and its whole subtree instead of promoting it one
  // level, and in the orderings where the foreign-key check blocks instead, the move dies with a
  // raw 23503. Holding the move lock must therefore hold the delete too.
  it('C-03 mechanism: a held move lock on the same space blocks a concurrent delete until released', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    const { promise: releaseSignal, resolve: releaseLock } = Promise.withResolvers<void>();
    const { promise: lockAcquiredSignal, resolve: lockAcquired } = Promise.withResolvers<void>();

    const holder = ctx.database.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('shared-space-album-folder-move'), hashtext(${space.id}))`.execute(
        trx,
      );
      lockAcquired();
      await releaseSignal;
    });

    await lockAcquiredSignal;

    const deletePromise = sut.deleteAlbumFolderPromotingChildren(space.id, trips.id);

    const raceResult = await Promise.race([
      deletePromise.then(() => 'resolved' as const),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 300)),
    ]);
    expect(raceResult).toBe('pending');

    releaseLock();
    await holder;

    await expect(deletePromise).resolves.toEqual({ outcome: 'ok' });
  });

  // Negative control, mirroring the move's: the delete's lock must be scoped per space too, so a
  // test proving only "some lock exists" cannot pass with the space id dropped from the key.
  it('C-03 mechanism: a held move lock on a different space does not block the delete', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const { space: otherSpace } = await ctx.newSharedSpace({ createdById: user.id });
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });

    const { promise: releaseSignal, resolve: releaseLock } = Promise.withResolvers<void>();
    const { promise: lockAcquiredSignal, resolve: lockAcquired } = Promise.withResolvers<void>();

    const holder = ctx.database.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('shared-space-album-folder-move'), hashtext(${otherSpace.id}))`.execute(
        trx,
      );
      lockAcquired();
      await releaseSignal;
    });

    await lockAcquiredSignal;

    await expect(sut.deleteAlbumFolderPromotingChildren(space.id, trips.id)).resolves.toEqual({ outcome: 'ok' });

    releaseLock();
    await holder;
  });
});

describe('album placement lifecycle', () => {
  // A-07: unlinking drops the link row entirely, so no orphan placement survives, and a
  // re-link starts at the root.
  it('A-07: unlinking removes the placement and re-linking lands at the root', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const folder = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, folderId: folder.id })
      .execute();

    await ctx.database
      .deleteFrom('shared_space_album')
      .where('spaceId', '=', space.id)
      .where('albumId', '=', album.id)
      .execute();

    await ctx.database.insertInto('shared_space_album').values({ spaceId: space.id, albumId: album.id }).execute();

    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBeNull();
  });

  // C-03 was previously one Promise.allSettled race between deleteAlbumFolderPromotingChildren
  // and setAlbumLinkFolder (Task 3 review): both rejections were swallowed by allSettled, and the
  // only substantive assertion sat inside an `if (link.folderId !== null)` branch that either
  // outcome could make unreachable — so the test could pass without ever running its own
  // assertion. Replaced by the two deterministic, sequenced orderings below, which is everything
  // "whichever order the two land in" could mean once the race itself is removed.

  // C-03(a): place the link in a NESTED folder, then delete that folder. deleteAlbumFolderPromotingChildren
  // must repoint the link to the deleted folder's own parent — asserting against a real (non-null)
  // parent id, rather than a root folder, is what makes this sensitive to the repoint UPDATE: a root
  // folder's parent is null, which is also what Postgres's own ON DELETE SET NULL on
  // shared_space_album.folderId would produce even if that UPDATE were removed entirely.
  it("C-03a: setAlbumLinkFolder then deleteAlbumFolderPromotingChildren repoints the link to the folder's parent", async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const archive = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Archive',
      createdById: user.id,
    });
    const trips = await createFolder(sut, {
      spaceId: space.id,
      parentId: archive.id,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database.insertInto('shared_space_album').values({ spaceId: space.id, albumId: album.id }).execute();

    await expect(sut.setAlbumLinkFolder(space.id, album.id, trips.id)).resolves.toBe(true);
    await expect(sut.deleteAlbumFolderPromotingChildren(space.id, trips.id)).resolves.toEqual({ outcome: 'ok' });

    const link = await ctx.database
      .selectFrom('shared_space_album')
      .selectAll()
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    expect(link.folderId).toBe(archive.id);
  });

  // C-03(b): the opposite order — delete the folder FIRST, then try to place the link there. The
  // folder id no longer exists, so the UPDATE trips shared_space_album_folderId_fkey and must
  // reject with a foreign-key violation (23503), not silently write a dangling folderId.
  // The repository deliberately does NOT soften this: a foreign-key violation is the honest
  // report that the folder is gone. SharedSpaceService.withAlbumFolderConstraintsMapped is what
  // turns it into the 400 the design's C-03 row promises, keyed on this exact constraint name —
  // so this test is also what pins the name that mapping matches on.
  it('C-03b: setAlbumLinkFolder rejects with a foreign-key error when the folder was already deleted', async () => {
    const { ctx, sut } = setup();
    const { user, space } = await seed(ctx);
    const folder = await createFolder(sut, {
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: user.id,
    });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Rome' });
    await ctx.database.insertInto('shared_space_album').values({ spaceId: space.id, albumId: album.id }).execute();

    await expect(sut.deleteAlbumFolderPromotingChildren(space.id, folder.id)).resolves.toEqual({ outcome: 'ok' });

    await expect(sut.setAlbumLinkFolder(space.id, album.id, folder.id)).rejects.toMatchObject({
      code: '23503',
      // Load-bearing on BOTH counts, and only observable here.
      //
      // The service maps on the CONSTRAINT, not the code alone, so that a concurrently-deleted
      // ALBUM (a different foreign key on this same row) is never misreported as a missing
      // folder. Rename the constraint and that mapping goes silent.
      //
      // And the FIELD NAME is `constraint_name`, not node-postgres's `constraint`: this server
      // runs Kysely's postgres.js dialect, which spells it that way. A unit test that hand-rolls
      // the error object cannot catch that — this assertion is the only thing standing between
      // the mapping and being a no-op against a real database.
      constraint_name: 'shared_space_album_folderId_fkey',
    });
  });
});
