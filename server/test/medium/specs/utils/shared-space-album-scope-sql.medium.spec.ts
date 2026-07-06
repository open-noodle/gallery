// Slice 3 — cross-style equivalence: the raw-SQL album-arm fragment
// (spaceAlbumAssetExistsSql) must return the SAME asset set as the Kysely
// spaceAlbumAssetExists over identical data + scope (spec §3.4). This is the wire
// that keeps the two authoring styles from drifting.
import { Kysely, sql } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { spaceAlbumAssetExists, spaceAlbumAssetExistsSql } from 'src/utils/shared-space-album-scope';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx };
};

type Ctx = ReturnType<typeof setup>['ctx'];

const kyselyIds = async (spaceId: string, requireAlbumNotDeleted = true): Promise<Set<string>> => {
  const rows = await db
    .selectFrom('asset')
    .select('asset.id')
    .where((eb) =>
      spaceAlbumAssetExists(eb, { correlateAssetId: 'asset.id', scope: { spaceId }, requireAlbumNotDeleted }),
    )
    .execute();
  return new Set(rows.map((r) => r.id));
};

const rawIds = async (spaceId: string, requireAlbumNotDeleted = true): Promise<Set<string>> => {
  const existsFragment = spaceAlbumAssetExistsSql({
    assetIdColumn: sql`asset.id`,
    spaceScopeJoin: sql`INNER JOIN shared_space ON shared_space.id = shared_space_album."spaceId" AND shared_space.id = ${spaceId}`,
    requireAlbumNotDeleted,
  });
  const result = await sql<{ id: string }>`SELECT asset.id FROM asset WHERE ${existsFragment}`.execute(db);
  return new Set(result.rows.map((r) => r.id));
};

beforeAll(async () => {
  db = await getKyselyDB();
});

const seedCombos = async (ctx: Ctx) => {
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  const { library } = await ctx.newLibrary({ ownerId: user.id });

  const { result: shown } = await ctx.newAlbum({ ownerId: user.id, albumName: 'shown' });
  const { result: hidden } = await ctx.newAlbum({ ownerId: user.id, albumName: 'hidden' });
  const { result: deleted } = await ctx.newAlbum({ ownerId: user.id, albumName: 'deleted' });

  const { asset: viaShown } = await ctx.newAsset({ ownerId: user.id });
  const { asset: viaHidden } = await ctx.newAsset({ ownerId: user.id });
  const { asset: viaDeleted } = await ctx.newAsset({ ownerId: user.id });
  const { asset: viaDirect } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newAsset({ ownerId: user.id, libraryId: library.id }); // via library
  await ctx.newAsset({ ownerId: user.id }); // none

  await ctx.newAlbumAsset({ albumId: shown.id, assetId: viaShown.id });
  await ctx.newAlbumAsset({ albumId: hidden.id, assetId: viaHidden.id });
  await ctx.newAlbumAsset({ albumId: deleted.id, assetId: viaDeleted.id });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: shown.id, showInTimeline: true });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: hidden.id, showInTimeline: false });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: deleted.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: viaDirect.id, addedById: user.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: user.id });
  await ctx.softDeleteAlbum(deleted.id);

  return { space, viaShown, viaHidden };
};

describe('raw-SQL album arm ≡ Kysely album arm', () => {
  it('returns the identical asset set (A1 on) across all path combinations', async () => {
    const { ctx } = setup();
    const { space, viaShown, viaHidden } = await seedCombos(ctx);

    const kysely = await kyselyIds(space.id);
    const raw = await rawIds(space.id);

    expect(raw).toEqual(kysely);
    // sanity: album assets present regardless of showInTimeline (arm has no timeline gate);
    // soft-deleted album excluded (A1); direct/library assets absent from the album arm.
    expect(kysely.has(viaShown.id)).toBe(true);
    expect(kysely.has(viaHidden.id)).toBe(true);
  });

  it('returns the identical asset set with A1 off (soft-deleted album included by both)', async () => {
    const { ctx } = setup();
    const { space } = await seedCombos(ctx);

    const kysely = await kyselyIds(space.id, false);
    const raw = await rawIds(space.id, false);

    expect(raw).toEqual(kysely);
    expect(raw.size).toBe(kysely.size);
  });
});
