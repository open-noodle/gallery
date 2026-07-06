import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType } from 'src/enum';
import { SyncRepository } from 'src/repositories/sync.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

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
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
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
    const resultBefore: any[] = [];
    for await (const row of streamBefore) {
      resultBefore.push(row);
    }
    expect(resultBefore.map((r: any) => r.id)).toContain(asset.id);

    // Soft-delete the album
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    const stream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, owner.id);
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
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
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
    const row = result.find((r: any) => r.id === asset.id);
    expect(row).toBeDefined();
    expect(row.isFavorite).toBe(false);

    // Backfill as owner — should see true isFavorite
    const ownerStream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, owner.id);
    const ownerResult: any[] = [];
    for await (const row of ownerStream) {
      ownerResult.push(row);
    }
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
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
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
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
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
    const resultBefore: any[] = [];
    for await (const row of streamBefore) {
      resultBefore.push(row);
    }
    expect(resultBefore.map((r: any) => r.id)).toContain(asset.id);

    // Soft-delete the album
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    const stream = sut.getCreates({ nowId: NOW_ID, userId: member.id });
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
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
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
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
    const resultBefore: any[] = [];
    for await (const row of streamBefore) {
      resultBefore.push(row);
    }
    expect(resultBefore.map((r: any) => r.id)).toContain(asset.id);

    // Soft-delete the album
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    const stream = sut.getUpdates(
      { nowId: NOW_ID, userId: member.id },
      { type: SyncEntityType.AlbumToAssetV1, updateId: BEFORE_UPDATE_ID },
    );
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
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
    const resultZero: any[] = [];
    for await (const row of streamZero) {
      resultZero.push(row);
    }
    // With ack at max — all assets known, so updates should come through
    const streamMax = sut.getUpdates(
      { nowId: NOW_ID, userId: member.id },
      { type: SyncEntityType.AlbumToAssetV1, updateId: BEFORE_UPDATE_ID },
    );
    const resultMax: any[] = [];
    for await (const row of streamMax) {
      resultMax.push(row);
    }
    // With ack BELOW the asset's album_asset.updateId → result must be EMPTY.
    // (Dropping the `album_asset.updateId <= albumToAssetAck.updateId` coupling
    // would cause this assertion to fail because the asset would appear here.)
    expect(resultZero).toHaveLength(0);

    // With ack ABOVE the asset's album_asset.updateId → asset must be returned.
    expect(resultMax.map((r: any) => r.id)).toContain(asset.id);
  });
});
