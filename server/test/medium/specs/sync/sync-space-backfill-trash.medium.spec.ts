// M-2 — the space-member-facing sync BACKFILL / getCreates content arms must never stream a
// TRASHED asset's metadata / thumbhash / EXIF (incl. GPS) to a member. Without an
// `asset.deletedAt IS NULL` gate a newly-joined member's initial backfill leaks the trashed
// asset's filename, a reconstructable thumbhash and its coordinates — data reachable through no
// REST surface post-H1. The getUpdates / getUpserts convergence arms stay UNFILTERED: that is how
// an already-synced device learns to hide/purge a newly-trashed asset (the asset.updateId bump
// rides through). Sync-side sibling of H-1.
import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole, SyncEntityType } from 'src/enum';
import { SyncRepository } from 'src/repositories/sync.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const NOW_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';
const BEFORE_UPDATE_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';

const setup = () => new SyncTestContext(defaultDatabase);

const collect = async (stream: AsyncIterable<unknown>): Promise<any[]> => {
  const rows: any[] = await Array.fromAsync(stream);
  return rows;
};

const trash = (db: Kysely<DB>, assetId: string) =>
  db.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', assetId).execute();

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('M-2: SharedSpaceAlbumAssetSync — backfill/getCreates exclude trashed; getUpdates still delivers', () => {
  it('getBackfill excludes a trashed album asset (live sibling present)', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAlbumAsset;
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset: live } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: trashed } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: live.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: trashed.id });
    await trash(defaultDatabase, trashed.id);

    const rows = await collect(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, member.id),
    );
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(live.id);
    expect(ids).not.toContain(trashed.id);
  });

  it('getCreates excludes a trashed album asset for a grant holder', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAlbumAsset;
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset: live } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: trashed } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: live.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: trashed.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await trash(defaultDatabase, trashed.id);

    const rows = await collect(sut.getCreates({ nowId: NOW_ID, userId: member.id }));
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(live.id);
    expect(ids).not.toContain(trashed.id);
  });

  it('getUpdates STILL delivers a trashed album asset (device-purge convergence channel)', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAlbumAsset;
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await trash(defaultDatabase, asset.id);

    const rows = await collect(
      sut.getUpdates(
        { nowId: NOW_ID, userId: member.id },
        { type: SyncEntityType.AlbumToAssetV1, updateId: BEFORE_UPDATE_ID },
      ),
    );

    // The trashed row must still be delivered so the already-synced member's device learns to purge it.
    expect(rows.map((r) => r.id)).toContain(asset.id);
    expect(rows.find((r) => r.id === asset.id)?.deletedAt).not.toBeNull();
  });
});

describe('M-2: SharedSpaceAlbumAssetExifSync — backfill excludes trashed EXIF (GPS)', () => {
  it('getBackfill excludes the EXIF of a trashed album asset', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAlbumAssetExif;
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset: live } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: trashed } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newExif({ assetId: live.id, make: 'LiveCamera' });
    await ctx.newExif({ assetId: trashed.id, make: 'TrashedCamera' });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: live.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: trashed.id });
    await trash(defaultDatabase, trashed.id);

    const rows = await collect(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, owner.id),
    );
    const ids = rows.map((r) => r.assetId);

    expect(ids).toContain(live.id);
    expect(ids).not.toContain(trashed.id);
  });
});

describe('M-2: SharedSpaceAssetSync (direct) — backfill excludes trashed', () => {
  it('getBackfill excludes a trashed direct-space asset', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAsset;
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
    const { asset: live } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: trashed } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: live.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: trashed.id });
    await trash(defaultDatabase, trashed.id);

    const rows = await collect(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, space.id, member.id),
    );
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(live.id);
    expect(ids).not.toContain(trashed.id);
  });
});

const seedLibraryInSpace = async (ctx: SyncTestContext) => {
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { library } = await ctx.newLibrary({ ownerId: owner.id, name: 'Lib' });
  const { asset: live } = await ctx.newAsset({
    ownerId: owner.id,
    libraryId: library.id,
    visibility: AssetVisibility.Timeline,
  });
  const { asset: trashed } = await ctx.newAsset({
    ownerId: owner.id,
    libraryId: library.id,
    visibility: AssetVisibility.Timeline,
  });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });
  await trash(defaultDatabase, trashed.id);
  return { owner, member, library, live, trashed };
};

describe('M-2: LibraryAssetSync — non-owner backfill excludes trashed; owner keeps their own', () => {
  it('a non-owner member does NOT receive the trashed library asset', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).libraryAsset;
    const { member, library, live, trashed } = await seedLibraryInSpace(ctx);

    const rows = await collect(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, library.id, member.id),
    );
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(live.id);
    expect(ids).not.toContain(trashed.id);
  });

  it('the owner still receives their OWN trashed library asset (owner branch unfiltered)', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).libraryAsset;
    const { owner, library, trashed } = await seedLibraryInSpace(ctx);

    const rows = await collect(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, library.id, owner.id),
    );
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(trashed.id);
  });
});

const seedContributionInSpace = async (ctx: SyncTestContext) => {
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { user: carol } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { asset: live } = await ctx.newAsset({ ownerId: carol.id });
  const { asset: trashed } = await ctx.newAsset({ ownerId: carol.id });
  await ctx.newExif({ assetId: live.id, make: 'LiveCamera' });
  await ctx.newExif({ assetId: trashed.id, make: 'TrashedCamera' });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
  await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: live.id, spaceId: space.id });
  await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: trashed.id, spaceId: space.id });
  await trash(defaultDatabase, trashed.id);
  return { owner, member, album, live, trashed };
};

describe('M-2 (P2-8): contributed arms — backfill/creates exclude trashed; updates still deliver', () => {
  it('ToAsset.getBackfill excludes a trashed contribution (live sibling present)', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAlbumToAsset;
    const { member, album, live, trashed } = await seedContributionInSpace(ctx);
    const rows = await collect(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, member.id),
    );
    const ids = rows.map((r) => r.assetId);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(trashed.id);
  });

  it('ToAsset.getBackfill album_asset arm also gates trash (line :1690 pin)', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAlbumToAsset;
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset: live } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: trashed } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: live.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: trashed.id });
    await trash(defaultDatabase, trashed.id);
    const rows = await collect(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, owner.id),
    );
    expect(rows.map((r) => r.assetId)).not.toContain(trashed.id);
  });

  it('Asset content sync (getBackfill + getCreates) excludes the trashed contributed asset', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAlbumAsset;
    const { member, album, live, trashed } = await seedContributionInSpace(ctx);
    const backfill = await collect(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, member.id),
    );
    expect(backfill.map((r) => r.id)).toContain(live.id);
    expect(backfill.map((r) => r.id)).not.toContain(trashed.id);
    const creates = await collect(sut.getCreates({ nowId: NOW_ID, userId: member.id }));
    expect(creates.map((r) => r.id)).toContain(live.id);
    expect(creates.map((r) => r.id)).not.toContain(trashed.id);
  });

  it('Exif sync getBackfill excludes the trashed contribution’s EXIF', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAlbumAssetExif;
    const { member, album, live, trashed } = await seedContributionInSpace(ctx);
    const rows = await collect(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id, member.id),
    );
    expect(rows.map((r) => r.assetId)).toContain(live.id);
    expect(rows.map((r) => r.assetId)).not.toContain(trashed.id);
  });

  it('Asset content getUpdates STILL delivers the trashed contribution (purge convergence)', async () => {
    const ctx = setup();
    const sut = ctx.get(SyncRepository).sharedSpaceAlbumAsset;
    const { member, trashed } = await seedContributionInSpace(ctx);
    const rows = await collect(
      sut.getUpdates(
        { nowId: NOW_ID, userId: member.id },
        { type: SyncEntityType.AlbumToAssetV1, updateId: BEFORE_UPDATE_ID },
      ),
    );
    expect(rows.map((r) => r.id)).toContain(trashed.id);
  });
});
