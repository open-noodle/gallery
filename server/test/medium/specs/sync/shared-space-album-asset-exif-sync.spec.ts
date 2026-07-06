import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType } from 'src/enum';
import { SyncRepository } from 'src/repositories/sync.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Repo-level tests for SharedSpaceAlbumAssetExifSync:
//   - getBackfill: per-album backfill of asset_exif rows
//   - getCreates: new album_asset exif join rows via grant
//   - getUpdates: exif changes gated by albumToAssetAck coupling

let defaultDatabase: Kysely<DB>;

const NOW_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';
const BEFORE_UPDATE_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';
const ZERO_UPDATE_ID = '00000000-0000-7000-8000-000000000000';
// ZERO_UPDATE_ID is below any real album_asset.updateId (ULIDs start after epoch 0),
// so getUpdates with this ack must return EMPTY — the coupling
// `album_asset.updateId <= albumToAssetAck.updateId` filters everything out.

const setup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return { ctx, db: defaultDatabase, sut: ctx.get(SyncRepository).sharedSpaceAlbumAssetExif };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('SharedSpaceAlbumAssetExifSync.getBackfill', () => {
  it('returns exif rows for assets in the given album', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newExif({ assetId: asset.id, make: 'TestCamera' });

    const stream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id);
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
    expect(result.map((r: any) => r.assetId)).toContain(asset.id);
  });

  it('does not return exif rows for a different album', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album: a1 } = await ctx.newAlbum({ ownerId: owner.id });
    const { album: a2 } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: a1.id, assetId: asset.id });
    await ctx.newExif({ assetId: asset.id, make: 'TestCamera' });

    const stream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, a2.id);
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
    expect(result).toHaveLength(0);
  });

  it('returns empty for a soft-deleted album', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newExif({ assetId: asset.id, make: 'TestCamera' });

    // Confirm exif appears before soft-delete
    const streamBefore = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id);
    const resultBefore: any[] = [];
    for await (const row of streamBefore) {
      resultBefore.push(row);
    }
    expect(resultBefore.map((r: any) => r.assetId)).toContain(asset.id);

    // Soft-delete the album
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    const stream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id);
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
    expect(result).toHaveLength(0);
  });
});

describe('SharedSpaceAlbumAssetExifSync.getCreates', () => {
  it('returns exif rows for album assets accessible via space grant', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newExif({ assetId: asset.id, make: 'TestCamera' });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const stream = sut.getCreates({ nowId: NOW_ID, userId: member.id });
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
    expect(result.map((r: any) => r.assetId)).toContain(asset.id);
  });

  it('does not return exif rows for non-grant-holders', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newExif({ assetId: asset.id, make: 'TestCamera' });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const stream = sut.getCreates({ nowId: NOW_ID, userId: stranger.id });
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
    expect(result.map((r: any) => r.assetId)).not.toContain(asset.id);
  });

  it('excludes exif rows from soft-deleted albums', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newExif({ assetId: asset.id, make: 'TestCamera' });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    // Confirm exif is visible before soft-delete
    const streamBefore = sut.getCreates({ nowId: NOW_ID, userId: member.id });
    const resultBefore: any[] = [];
    for await (const row of streamBefore) {
      resultBefore.push(row);
    }
    expect(resultBefore.map((r: any) => r.assetId)).toContain(asset.id);

    // Soft-delete the album
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    const stream = sut.getCreates({ nowId: NOW_ID, userId: member.id });
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
    expect(result.map((r: any) => r.assetId)).not.toContain(asset.id);
  });
});

describe('SharedSpaceAlbumAssetExifSync.getUpdates', () => {
  it('excludes exif updates for soft-deleted albums', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newExif({ assetId: asset.id, make: 'TestCamera' });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    // Confirm exif is visible in updates before soft-delete (with max ack)
    const streamBefore = sut.getUpdates(
      { nowId: NOW_ID, userId: member.id },
      { type: SyncEntityType.AlbumToAssetV1, updateId: BEFORE_UPDATE_ID },
    );
    const resultBefore: any[] = [];
    for await (const row of streamBefore) {
      resultBefore.push(row);
    }
    expect(resultBefore.map((r: any) => r.assetId)).toContain(asset.id);

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
    expect(result.map((r: any) => r.assetId)).not.toContain(asset.id);
  });

  it('honors albumToAssetAck coupling — only sends exif updates for assets the client already knows about', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newExif({ assetId: asset.id, make: 'TestCamera' });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    // With ack BELOW the asset's album_asset.updateId → result must be EMPTY.
    // (Dropping the `album_asset.updateId <= albumToAssetAck.updateId` coupling
    // would cause this assertion to fail because the exif row would appear here.)
    const streamZero = sut.getUpdates(
      { nowId: NOW_ID, userId: member.id },
      { type: SyncEntityType.AlbumToAssetV1, updateId: ZERO_UPDATE_ID },
    );
    const resultZero: any[] = [];
    for await (const row of streamZero) {
      resultZero.push(row);
    }
    expect(resultZero).toHaveLength(0);

    // With ack ABOVE the asset's album_asset.updateId → exif must be returned.
    const streamMax = sut.getUpdates(
      { nowId: NOW_ID, userId: member.id },
      { type: SyncEntityType.AlbumToAssetV1, updateId: BEFORE_UPDATE_ID },
    );
    const resultMax: any[] = [];
    for await (const row of streamMax) {
      resultMax.push(row);
    }
    expect(resultMax.map((r: any) => r.assetId)).toContain(asset.id);
  });
});
