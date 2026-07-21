import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType } from 'src/enum';
import { SyncRepository } from 'src/repositories/sync.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

const drain = async (stream: AsyncIterable<any>) => {
  const out: any[] = await Array.fromAsync(stream);
  return out;
};

// Repo-level tests for SharedSpaceAlbumAssetSync:
//   - getBackfill: per-album backfill of full asset rows
//   - getCreates: new album_asset join rows via grant
//   - getUpdates: asset metadata changes gated by albumToAssetAck coupling
//   - isFavorite masking: false for non-owner members

let defaultDatabase: Kysely<DB>;

const NOW_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';
const BEFORE_UPDATE_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';
const ZERO_UPDATE_ID = '00000000-0000-7000-8000-000000000000';
// ZERO_UPDATE_ID is below any real album_asset.updateId (ULIDs start after epoch 0),
// so getUpdates with this ack must return EMPTY — the coupling
// `album_asset.updateId <= albumToAssetAck.updateId` filters everything out.

const setup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return { ctx, db: defaultDatabase, sut: ctx.get(SyncRepository).sharedSpaceAlbumAsset };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('SharedSpaceAlbumAssetSync.getBackfill', () => {
  it('returns asset rows for the given album', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const stream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, owner.id);
    const result: any[] = await Array.fromAsync(stream);
    expect(result.map((r: any) => r.id)).toContain(asset.id);
  });

  it('returns empty for a soft-deleted album', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    // Confirm asset appears before soft-delete
    const streamBefore = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, owner.id);
    const resultBefore: any[] = await Array.fromAsync(streamBefore);
    expect(resultBefore.map((r: any) => r.id)).toContain(asset.id);

    // Soft-delete the album
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    const stream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, owner.id);
    const result: any[] = await Array.fromAsync(stream);
    expect(result).toHaveLength(0);
  });

  it('masks isFavorite to false for non-owners', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    // Set isFavorite to true on the asset (owner's perspective)
    await db.updateTable('asset').set({ isFavorite: true }).where('id', '=', asset.id).execute();

    // Backfill as member (non-owner) — should see isFavorite=false
    const stream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, member.id);
    const result: any[] = await Array.fromAsync(stream);
    const row = result.find((r: any) => r.id === asset.id);
    expect(row).toBeDefined();
    expect(row.isFavorite).toBe(false);

    // Backfill as owner — should see true isFavorite
    const ownerStream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, owner.id);
    const ownerResult: any[] = await Array.fromAsync(ownerStream);
    expect(ownerResult.find((r: any) => r.id === asset.id)?.isFavorite).toBe(true);
  });
});

describe('SharedSpaceAlbumAssetSync.getCreates', () => {
  it('returns new album_asset join rows for grant holders', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const stream = sut.getCreates({ nowId: NOW_ID, userId: member.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result.map((r: any) => r.id)).toContain(asset.id);
  });

  it('does not return rows for non-grant-holders', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const stream = sut.getCreates({ nowId: NOW_ID, userId: stranger.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result.map((r: any) => r.id)).not.toContain(asset.id);
  });

  it('excludes assets from soft-deleted albums', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    // Confirm asset is visible before soft-delete
    const streamBefore = sut.getCreates({ nowId: NOW_ID, userId: member.id });
    const resultBefore: any[] = await Array.fromAsync(streamBefore);
    expect(resultBefore.map((r: any) => r.id)).toContain(asset.id);

    // Soft-delete the album
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    const stream = sut.getCreates({ nowId: NOW_ID, userId: member.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result.map((r: any) => r.id)).not.toContain(asset.id);
  });

  it('masks isFavorite to false for non-owner members in getCreates', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await db.updateTable('asset').set({ isFavorite: true }).where('id', '=', asset.id).execute();

    const stream = sut.getCreates({ nowId: NOW_ID, userId: member.id });
    const result: any[] = await Array.fromAsync(stream);
    const row = result.find((r: any) => r.id === asset.id);
    expect(row?.isFavorite).toBe(false);
  });
});

describe('SharedSpaceAlbumAssetSync.getUpdates', () => {
  it('excludes asset updates for soft-deleted albums', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    // Confirm asset is visible in updates before soft-delete (with max ack)
    const streamBefore = sut.getUpdates(
      { nowId: NOW_ID, userId: member.id },
      { type: SyncEntityType.AlbumToAssetV1, updateId: BEFORE_UPDATE_ID },
    );
    const resultBefore: any[] = await Array.fromAsync(streamBefore);
    expect(resultBefore.map((r: any) => r.id)).toContain(asset.id);

    // Soft-delete the album
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    const stream = sut.getUpdates(
      { nowId: NOW_ID, userId: member.id },
      { type: SyncEntityType.AlbumToAssetV1, updateId: BEFORE_UPDATE_ID },
    );
    const result: any[] = await Array.fromAsync(stream);
    expect(result.map((r: any) => r.id)).not.toContain(asset.id);
  });

  it('honors albumToAssetAck coupling — only sends updates for assets the client already knows about', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    // With a zero ack — no assets "known" by client, so updates should be filtered
    const streamZero = sut.getUpdates(
      { nowId: NOW_ID, userId: member.id },
      { type: SyncEntityType.AlbumToAssetV1, updateId: ZERO_UPDATE_ID },
    );
    const resultZero: any[] = await Array.fromAsync(streamZero);
    // With ack at max — all assets known, so updates should come through
    const streamMax = sut.getUpdates(
      { nowId: NOW_ID, userId: member.id },
      { type: SyncEntityType.AlbumToAssetV1, updateId: BEFORE_UPDATE_ID },
    );
    const resultMax: any[] = await Array.fromAsync(streamMax);
    // With ack BELOW the asset's album_asset.updateId → result must be EMPTY.
    // (Dropping the `album_asset.updateId <= albumToAssetAck.updateId` coupling
    // would cause this assertion to fail because the asset would appear here.)
    expect(resultZero).toHaveLength(0);

    // With ack ABOVE the asset's album_asset.updateId → asset must be returned.
    expect(resultMax.map((r: any) => r.id)).toContain(asset.id);
  });
});

describe('SharedSpaceAlbumAssetSync — contributions (album_space_asset)', () => {
  // eslint-disable-next-line unicorn/consistent-function-scoping -- test-local seed factory, co-located with its cases
  const seed = async (ctx: SyncTestContext) => {
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id }); // owned by someone else
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });
    return { owner, member, carol, album, asset, space };
  };

  it('getCreates emits the contributed asset payload to a member', async () => {
    const { ctx, sut } = setup();
    const { member, asset } = await seed(ctx);
    const rows = await drain(sut.getCreates({ nowId: NOW_ID, userId: member.id }));
    expect(rows.some((r: any) => r.id === asset.id)).toBe(true);
  });

  it('getBackfill emits the contributed asset payload for the album', async () => {
    const { ctx, sut } = setup();
    const { member, album, asset } = await seed(ctx);
    const rows = await drain(sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, member.id));
    expect(rows.some((r: any) => r.id === asset.id)).toBe(true);
  });

  it('getUpdates emits the contributed asset payload to a member (coupling satisfied)', async () => {
    const { ctx, sut } = setup();
    const { member, asset } = await seed(ctx);
    // albumToAssetAck at max → the `album_space_asset.updateId <= ack` coupling passes.
    const rows = await drain(
      sut.getUpdates(
        { nowId: NOW_ID, userId: member.id },
        { type: SyncEntityType.AlbumToAssetV1, updateId: BEFORE_UPDATE_ID },
      ),
    );
    expect(rows.some((r: any) => r.id === asset.id)).toBe(true);
  });
});

describe('SharedSpaceAlbumAssetSync — multi-space co-linked album (I2 §8.3)', () => {
  // Payload/exif arms leak the raw photo bytes + EXIF, so the space-correlation gate must cover them too.
  // eslint-disable-next-line unicorn/consistent-function-scoping -- test-local seed factory, co-located with its cases
  const seedDisjoint = async (ctx: SyncTestContext) => {
    const { user: owner } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { user: memberS1 } = await ctx.newUser();
    const { user: memberS2 } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id });

    const { space: s1 } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s1.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: s1.id, userId: memberS1.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: s1.id, albumId: album.id });

    const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s2.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: s2.id, userId: memberS2.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: s2.id, albumId: album.id });

    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: s1.id });
    return { album, asset, memberS1, memberS2 };
  };

  it('does not emit an S1 contribution payload to an S2-only member across getCreates/getBackfill/getUpdates', async () => {
    const { ctx, sut } = setup();
    const { album, asset, memberS1, memberS2 } = await seedDisjoint(ctx);
    const ack = { type: SyncEntityType.AlbumToAssetV1, updateId: BEFORE_UPDATE_ID };

    const s2Creates = await drain(sut.getCreates({ nowId: NOW_ID, userId: memberS2.id }));
    expect(s2Creates.some((r: any) => r.id === asset.id)).toBe(false);
    const s2Backfill = await drain(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, memberS2.id),
    );
    expect(s2Backfill.some((r: any) => r.id === asset.id)).toBe(false);
    const s2Updates = await drain(sut.getUpdates({ nowId: NOW_ID, userId: memberS2.id }, ack));
    expect(s2Updates.some((r: any) => r.id === asset.id)).toBe(false);

    const s1Creates = await drain(sut.getCreates({ nowId: NOW_ID, userId: memberS1.id }));
    expect(s1Creates.some((r: any) => r.id === asset.id)).toBe(true);
    const s1Backfill = await drain(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, memberS1.id),
    );
    expect(s1Backfill.some((r: any) => r.id === asset.id)).toBe(true);
    const s1Updates = await drain(sut.getUpdates({ nowId: NOW_ID, userId: memberS1.id }, ack));
    expect(s1Updates.some((r: any) => r.id === asset.id)).toBe(true);
  });
});
