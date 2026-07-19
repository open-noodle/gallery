// P0-2 + P1-5 (#752): cross-owner contributions must render in the album they were contributed
// to — grid (time buckets), covers, and metadata counts — for every LIVE member of the tether
// space, and for nobody else (album_user shares, shared links, departed members). Count and grid
// must never desync: both consume the same member-gate (albumSpaceIds / forUserId).
import { Kysely } from 'kysely';
import { AlbumUserRole, AssetVisibility, SharedLinkType, SharedSpaceRole } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { TimelineService } from 'src/services/timeline.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;

const setup = () =>
  newMediumService(TimelineService, {
    database: db,
    real: [AssetRepository, AccessRepository, PartnerRepository, SharedSpaceRepository, AlbumRepository],
    mock: [LoggingRepository],
  });

beforeAll(async () => {
  db = await getKyselyDB();
});

const seed = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user: owner } = await ctx.newUser();
  const { user: contributor } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { user: carol } = await ctx.newUser(); // owns the contributed asset
  const { user: albumUserViewer } = await ctx.newUser(); // album_user share, NOT a space member
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  await ctx.newAlbumUser({ albumId: album.id, userId: albumUserViewer.id, role: AlbumUserRole.Viewer });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: contributor.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

  // owner row — 2020-03-15; contribution — 2020-03-10 (same month bucket, earlier extremum)
  const { asset: owned } = await ctx.newAsset({ ownerId: owner.id, localDateTime: new Date('2020-03-15T12:00:00Z') });
  const { asset: contributed } = await ctx.newAsset({
    ownerId: carol.id,
    localDateTime: new Date('2020-03-10T12:00:00Z'),
  });
  await ctx.newExif({ assetId: owned.id, make: 'Canon' });
  await ctx.newExif({ assetId: contributed.id, make: 'Canon' });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: owned.id });
  await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributed.id, spaceId: space.id });

  return { owner, contributor, viewer, carol, albumUserViewer, album, space, owned, contributed };
};

const bucketTotal = async (sut: TimelineService, userId: string, email: string, albumId: string) => {
  const auth = factory.auth({ user: { id: userId, email } });
  const buckets = await sut.getTimeBuckets(auth, { albumId });
  return buckets.reduce((sum, b) => sum + b.count, 0);
};

describe('P0-2: contributions render in the album grid', () => {
  it('every live member (owner / contributor / viewer) sees the contribution in bucket counts and the asset list', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    for (const u of [s.owner, s.contributor, s.viewer]) {
      expect(await bucketTotal(sut, u.id, u.email, s.album.id)).toBe(2);
      const auth = factory.auth({ user: { id: u.id, email: u.email } });
      const assets = await sut.getTimeBucket(auth, { timeBucket: '2020-03-01', albumId: s.album.id });
      expect(assets).toContain(s.contributed.id);
      expect(assets).toContain(s.owned.id);
    }
  });

  it('album_user shared viewer (non-member) does NOT see the contribution', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    expect(await bucketTotal(sut, s.albumUserViewer.id, s.albumUserViewer.email, s.album.id)).toBe(1);
  });

  it('album owner who LEFT the space does NOT see the contribution (membership gate, not link gate)', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', s.space.id)
      .where('userId', '=', s.owner.id)
      .execute();
    expect(await bucketTotal(sut, s.owner.id, s.owner.email, s.album.id)).toBe(1);
  });

  it('shared-link viewer does NOT see the contribution', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    // ctx.newSharedLink does NOT exist (verified) — create via the repository, mirroring
    // timeline.service.spec.ts:414-436 for the full required insert shape (key is a required,
    // no-default bytea column).
    const sharedLink = await ctx.get(SharedLinkRepository).create({
      userId: s.owner.id,
      albumId: s.album.id,
      type: SharedLinkType.Album,
      key: Buffer.from('timeline-album-contributions-shared-link'),
      allowUpload: false,
    });
    const auth = factory.auth({ user: { id: s.owner.id, email: s.owner.email }, sharedLink });
    const buckets = await sut.getTimeBuckets(auth, { albumId: s.album.id });
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(1);
  });

  it('trashed and Hidden contributions vanish from buckets', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    await db.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', s.contributed.id).execute();
    expect(await bucketTotal(sut, s.viewer.id, s.viewer.email, s.album.id)).toBe(1);
    await db
      .updateTable('asset')
      .set({ deletedAt: null, visibility: AssetVisibility.Hidden })
      .where('id', '=', s.contributed.id)
      .execute();
    expect(await bucketTotal(sut, s.viewer.id, s.viewer.email, s.album.id)).toBe(1);
  });

  it('unlinked album (retained rows, D1-b) excludes the contribution — live-link gate', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    await ctx.get(SharedSpaceRepository).removeAlbum(s.space.id, s.album.id);
    expect(await bucketTotal(sut, s.owner.id, s.owner.email, s.album.id)).toBe(1);
  });

  it('coexistence window (P1-6): (albumId, assetId) in BOTH tables counts once', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    await db.insertInto('album_asset').values({ albumId: s.album.id, assetId: s.contributed.id }).execute();
    expect(await bucketTotal(sut, s.viewer.id, s.viewer.email, s.album.id)).toBe(2);
  });

  it('covers (P0-2): the contribution can be the bucket cover (third consumer of the shared arm)', async () => {
    const { ctx } = setup();
    const s = await seed(ctx);
    // Trash the owned sibling so the contributed asset is the only cover candidate — decisive:
    // without the contributed arm the bucket has NO cover at all.
    await db.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', s.owned.id).execute();
    const albumSpaceIds = await ctx.get(SharedSpaceRepository).getMemberSpaceIdsLinkingAlbum(s.album.id, s.viewer.id);
    const covers = await ctx.get(AssetRepository).getTimeBucketCovers({
      albumId: s.album.id,
      albumSpaceIds,
      timeBuckets: ['2020-03-01'],
    });
    expect(JSON.stringify(covers)).toContain(s.contributed.id);
  });

  it('stacked contribution (P0-2): arm parity with owned stacks', async () => {
    // Pin PARITY, not a specific collapse behavior: a contributed stacked pair must change the
    // bucket total by exactly what an owned stacked pair changes it by.
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    const { asset: ownedChild } = await ctx.newAsset({
      ownerId: s.owner.id,
      localDateTime: new Date('2020-03-15T12:01:00Z'),
    });
    await ctx.newAlbumAsset({ albumId: s.album.id, assetId: ownedChild.id });
    await ctx.newStack({ ownerId: s.owner.id }, [s.owned.id, ownedChild.id]);
    const baseline = await bucketTotal(sut, s.viewer.id, s.viewer.email, s.album.id);
    const ownedDelta = baseline - 2;

    const { asset: contribChild } = await ctx.newAsset({
      ownerId: s.carol.id,
      localDateTime: new Date('2020-03-10T12:01:00Z'),
    });
    await ctx.newAlbumSpaceAsset({ albumId: s.album.id, assetId: contribChild.id, spaceId: s.space.id });
    await ctx.newStack({ ownerId: s.carol.id }, [s.contributed.id, contribChild.id]);
    const total = await bucketTotal(sut, s.viewer.id, s.viewer.email, s.album.id);
    expect(total - baseline).toBe(ownedDelta);

    const auth = factory.auth({ user: { id: s.viewer.id, email: s.viewer.email } });
    const assets = await sut.getTimeBucket(auth, { timeBucket: '2020-03-01', albumId: s.album.id });
    expect(assets).toContain(s.contributed.id); // the contributed stack PRIMARY stays visible
  });
});

describe('P1-5: metadata count/date-range includes contributions, member-gated, grid-consistent', () => {
  it('forUserId=live member → count 2, startDate widens to the contribution', async () => {
    const { ctx } = setup();
    const s = await seed(ctx);
    const albumRepo = ctx.get(AlbumRepository);
    const [meta] = await albumRepo.getMetadataForIds([s.album.id], { forUserId: s.viewer.id });
    expect(meta.assetCount).toBe(2);
    expect(new Date(meta.startDate!).toISOString().slice(0, 10)).toBe('2020-03-10');
    expect(new Date(meta.endDate!).toISOString().slice(0, 10)).toBe('2020-03-15');
    // lastModifiedAssetTimestamp (mobile consumer) must aggregate over the contributed arm too.
    // The contribution is created LAST in seed(), so the max must come from it (don't set
    // updatedAt directly — the updated_at trigger would overwrite it with clock_timestamp).
    const rows = await db
      .selectFrom('asset')
      .select(['id', 'updatedAt'])
      .where('id', 'in', [s.owned.id, s.contributed.id])
      .execute();
    const maxUpdated = Math.max(...rows.map((r) => new Date(r.updatedAt).getTime()));
    expect(new Date(meta.lastModifiedAssetTimestamp!).getTime()).toBe(maxUpdated);
  });

  it('no forUserId (legacy) and departed-member forUserId → count 1', async () => {
    const { ctx } = setup();
    const s = await seed(ctx);
    const albumRepo = ctx.get(AlbumRepository);
    const [legacy] = await albumRepo.getMetadataForIds([s.album.id]);
    expect(legacy.assetCount).toBe(1);
    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', s.space.id)
      .where('userId', '=', s.owner.id)
      .execute();
    const [departed] = await albumRepo.getMetadataForIds([s.album.id], { forUserId: s.owner.id });
    expect(departed.assetCount).toBe(1);
  });

  it('trashed contribution vanishes from the count too (grid/count parity)', async () => {
    const { ctx } = setup();
    const s = await seed(ctx);
    await db.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', s.contributed.id).execute();
    const [meta] = await ctx.get(AlbumRepository).getMetadataForIds([s.album.id], { forUserId: s.viewer.id });
    expect(meta.assetCount).toBe(1);
  });

  it('unlinked album (retained rows, D1-b) excludes the contribution from the count — live-link gate', async () => {
    const { ctx } = setup();
    const s = await seed(ctx);
    await ctx.get(SharedSpaceRepository).removeAlbum(s.space.id, s.album.id);
    const [meta] = await ctx.get(AlbumRepository).getMetadataForIds([s.album.id], { forUserId: s.viewer.id });
    expect(meta.assetCount).toBe(1);
  });

  it('dedup: (albumId, assetId) in both tables counts once', async () => {
    const { ctx } = setup();
    const s = await seed(ctx);
    await db.insertInto('album_asset').values({ albumId: s.album.id, assetId: s.contributed.id }).execute();
    const [meta] = await ctx.get(AlbumRepository).getMetadataForIds([s.album.id], { forUserId: s.viewer.id });
    expect(meta.assetCount).toBe(2);
  });

  it('INVARIANT: Σ bucket counts == metadata assetCount for every viewer class', async () => {
    const { sut, ctx } = setup();
    const s = await seed(ctx);
    const albumRepo = ctx.get(AlbumRepository);
    for (const u of [s.owner, s.contributor, s.viewer, s.albumUserViewer]) {
      const grid = await bucketTotal(sut, u.id, u.email, s.album.id);
      const [meta] = await albumRepo.getMetadataForIds([s.album.id], { forUserId: u.id });
      expect(meta.assetCount).toBe(grid);
    }
  });
});
