/**
 * Medium tests for `AccessRepository.asset.checkSharedLinkAccess` — the #1018 space tether.
 *
 * A share link created from inside a space (`shared_link.spaceId`) may serve assets its creator
 * does not own. Those are NOT granted by the `shared_link_asset` row alone: on every read they are
 * re-derived from live space state, so withdrawing a photo from the space, unlinking the album, or
 * the link creator leaving the space all revoke public access immediately.
 *
 * Assets the link creator DOES own are unaffected by any of that — they were always theirs to share.
 */
import { Kysely } from 'kysely';
import { AssetVisibility, SharedLinkType, SharedSpaceRole } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [AccessRepository, AlbumRepository, SharedLinkRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });
  return {
    ctx,
    accessRepo: ctx.get(AccessRepository),
    albumRepo: ctx.get(AlbumRepository),
    sharedLinkRepo: ctx.get(SharedLinkRepository),
  };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

/**
 * A space with a sharer (Editor, who makes the link) and a contributor (Editor, who owns the
 * photo). `contributedAsset` is owned by the contributor, never by the sharer.
 */
const seedSpace = async () => {
  const { ctx, accessRepo, albumRepo, sharedLinkRepo } = setup();
  const { user: sharer } = await ctx.newUser();
  const { user: contributor } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: sharer.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: sharer.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: contributor.id, role: 'editor' });
  const { asset: contributedAsset } = await ctx.newAsset({ ownerId: contributor.id });
  const { asset: ownAsset } = await ctx.newAsset({ ownerId: sharer.id });
  // The link payload inner-joins exif laterally, so an asset with no exif row never shows up there.
  await ctx.newExif({ assetId: contributedAsset.id, make: 'test' });
  await ctx.newExif({ assetId: ownAsset.id, make: 'test' });
  return { ctx, accessRepo, albumRepo, sharedLinkRepo, sharer, contributor, space, contributedAsset, ownAsset };
};

describe('checkSharedLinkAccess — individual link from a space', () => {
  it('serves an asset contributed by another member while it is in the space', async () => {
    const { ctx, accessRepo, sharer, space, contributedAsset } = await seedSpace();
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: contributedAsset.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Individual,
      spaceId: space.id,
      assetIds: [contributedAsset.id],
    });

    await expect(
      accessRepo.asset.checkSharedLinkAccess(sharedLink.id, new Set([contributedAsset.id])),
    ).resolves.toEqual(new Set([contributedAsset.id]));
  });

  it('stops serving it once the contributor removes it from the space', async () => {
    const { ctx, accessRepo, sharer, space, contributedAsset } = await seedSpace();
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: contributedAsset.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Individual,
      spaceId: space.id,
      assetIds: [contributedAsset.id],
    });

    await defaultDatabase
      .deleteFrom('shared_space_asset')
      .where('spaceId', '=', space.id)
      .where('assetId', '=', contributedAsset.id)
      .execute();

    await expect(
      accessRepo.asset.checkSharedLinkAccess(sharedLink.id, new Set([contributedAsset.id])),
    ).resolves.toEqual(new Set());
  });

  it('stops serving it once the link creator leaves the space', async () => {
    const { ctx, accessRepo, sharer, space, contributedAsset } = await seedSpace();
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: contributedAsset.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Individual,
      spaceId: space.id,
      assetIds: [contributedAsset.id],
    });

    await defaultDatabase
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', sharer.id)
      .execute();

    await expect(
      accessRepo.asset.checkSharedLinkAccess(sharedLink.id, new Set([contributedAsset.id])),
    ).resolves.toEqual(new Set());
  });

  // The authority to publish another member's photo is the Owner/Editor role, so losing that role
  // has to stop the publishing — not only losing membership outright. Otherwise a demoted editor
  // keeps a public link over photos they may no longer act on, and the space owner has no way to
  // see it, let alone revoke it.
  it('stops serving it once the link creator is demoted to viewer', async () => {
    const { ctx, accessRepo, sharer, space, contributedAsset } = await seedSpace();
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: contributedAsset.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Individual,
      spaceId: space.id,
      assetIds: [contributedAsset.id],
    });

    await defaultDatabase
      .updateTable('shared_space_member')
      .set({ role: SharedSpaceRole.Viewer })
      .where('spaceId', '=', space.id)
      .where('userId', '=', sharer.id)
      .execute();

    await expect(
      accessRepo.asset.checkSharedLinkAccess(sharedLink.id, new Set([contributedAsset.id])),
    ).resolves.toEqual(new Set());
  });

  it('keeps serving an asset the link creator owns after it leaves the space', async () => {
    const { ctx, accessRepo, sharer, space, ownAsset } = await seedSpace();
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: ownAsset.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Individual,
      spaceId: space.id,
      assetIds: [ownAsset.id],
    });

    await defaultDatabase.deleteFrom('shared_space_asset').where('spaceId', '=', space.id).execute();

    await expect(accessRepo.asset.checkSharedLinkAccess(sharedLink.id, new Set([ownAsset.id]))).resolves.toEqual(
      new Set([ownAsset.id]),
    );
  });

  it('never serves a non-owned asset on a link with no space', async () => {
    const { ctx, accessRepo, sharer, space, contributedAsset } = await seedSpace();
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: contributedAsset.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Individual,
      spaceId: null,
      assetIds: [contributedAsset.id],
    });

    await expect(
      accessRepo.asset.checkSharedLinkAccess(sharedLink.id, new Set([contributedAsset.id])),
    ).resolves.toEqual(new Set());
  });
});

describe('checkSharedLinkAccess — album link from a space', () => {
  it('serves a cross-owner contribution in an album linked to the space', async () => {
    const { ctx, accessRepo, sharer, space, contributedAsset } = await seedSpace();
    const { album } = await ctx.newAlbum({ ownerId: sharer.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributedAsset.id, spaceId: space.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Album,
      albumId: album.id,
      spaceId: space.id,
    });

    await expect(
      accessRepo.asset.checkSharedLinkAccess(sharedLink.id, new Set([contributedAsset.id])),
    ).resolves.toEqual(new Set([contributedAsset.id]));
  });

  it('does not serve a contribution when the album link carries no space', async () => {
    const { ctx, accessRepo, sharer, space, contributedAsset } = await seedSpace();
    const { album } = await ctx.newAlbum({ ownerId: sharer.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributedAsset.id, spaceId: space.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Album,
      albumId: album.id,
      spaceId: null,
    });

    await expect(
      accessRepo.asset.checkSharedLinkAccess(sharedLink.id, new Set([contributedAsset.id])),
    ).resolves.toEqual(new Set());
  });

  it('does not serve a contribution made to a different space', async () => {
    const { ctx, accessRepo, sharer, space, contributedAsset } = await seedSpace();
    const { space: otherSpace } = await ctx.newSharedSpace({ createdById: sharer.id });
    await ctx.newSharedSpaceMember({ spaceId: otherSpace.id, userId: sharer.id, role: 'owner' });
    const { album } = await ctx.newAlbum({ ownerId: sharer.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newSharedSpaceAlbum({ spaceId: otherSpace.id, albumId: album.id });
    // Contributed to the OTHER space, so a link made from `space` must not reach it.
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributedAsset.id, spaceId: otherSpace.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Album,
      albumId: album.id,
      spaceId: space.id,
    });

    await expect(
      accessRepo.asset.checkSharedLinkAccess(sharedLink.id, new Set([contributedAsset.id])),
    ).resolves.toEqual(new Set());
  });

  it('stops serving a contribution once the album is unlinked from the space', async () => {
    const { ctx, accessRepo, sharer, space, contributedAsset } = await seedSpace();
    const { album } = await ctx.newAlbum({ ownerId: sharer.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributedAsset.id, spaceId: space.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Album,
      albumId: album.id,
      spaceId: space.id,
    });

    await defaultDatabase
      .deleteFrom('shared_space_album')
      .where('spaceId', '=', space.id)
      .where('albumId', '=', album.id)
      .execute();

    await expect(
      accessRepo.asset.checkSharedLinkAccess(sharedLink.id, new Set([contributedAsset.id])),
    ).resolves.toEqual(new Set());
  });

  it('still serves the assets the album itself holds', async () => {
    const { ctx, accessRepo, sharer, space, ownAsset } = await seedSpace();
    const { album } = await ctx.newAlbum({ ownerId: sharer.id }, [ownAsset.id]);
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Album,
      albumId: album.id,
      spaceId: space.id,
    });

    await expect(accessRepo.asset.checkSharedLinkAccess(sharedLink.id, new Set([ownAsset.id]))).resolves.toEqual(
      new Set([ownAsset.id]),
    );
  });
});

/**
 * The count behind the link has to agree with the grid the link renders, so it counts the same
 * contributions — and only the ones belonging to the link's own space.
 */
describe('getMetadataForIds — space-scoped contributed arm (#1018)', () => {
  it('counts a contribution made to the given space', async () => {
    const { ctx, albumRepo, sharer, space, contributedAsset, ownAsset } = await seedSpace();
    const { album } = await ctx.newAlbum({ ownerId: sharer.id }, [ownAsset.id]);
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributedAsset.id, spaceId: space.id });

    const [metadata] = await albumRepo.getMetadataForIds([album.id], { forUserId: sharer.id, spaceId: space.id });

    expect(metadata.assetCount).toBe(2);
  });

  it('does not count a contribution made to a different space', async () => {
    const { ctx, albumRepo, sharer, space, contributedAsset, ownAsset } = await seedSpace();
    const { space: otherSpace } = await ctx.newSharedSpace({ createdById: sharer.id });
    await ctx.newSharedSpaceMember({ spaceId: otherSpace.id, userId: sharer.id, role: 'owner' });
    const { album } = await ctx.newAlbum({ ownerId: sharer.id }, [ownAsset.id]);
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newSharedSpaceAlbum({ spaceId: otherSpace.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributedAsset.id, spaceId: otherSpace.id });

    const [metadata] = await albumRepo.getMetadataForIds([album.id], { forUserId: sharer.id, spaceId: space.id });

    expect(metadata.assetCount).toBe(1);
  });

  it('counts every member space when no space is given (unchanged pre-#1018 behaviour)', async () => {
    const { ctx, albumRepo, sharer, space, contributedAsset, ownAsset } = await seedSpace();
    const { album } = await ctx.newAlbum({ ownerId: sharer.id }, [ownAsset.id]);
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributedAsset.id, spaceId: space.id });

    const [metadata] = await albumRepo.getMetadataForIds([album.id], { forUserId: sharer.id });

    expect(metadata.assetCount).toBe(2);
  });
});

/**
 * The payload the visitor's page is built from (`GET /shared-links/me`) has to list the same assets
 * the access gate serves, or the grid renders holes.
 */
describe('SharedLinkRepository.get — payload (#1018)', () => {
  it('lists an asset contributed by another member on an individual link', async () => {
    const { ctx, sharedLinkRepo, sharer, space, contributedAsset } = await seedSpace();
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: contributedAsset.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Individual,
      spaceId: space.id,
      assetIds: [contributedAsset.id],
    });

    const result = await sharedLinkRepo.get(sharer.id, sharedLink.id);

    expect(result?.assets.map(({ id }) => id)).toEqual([contributedAsset.id]);
  });

  it('drops it from the payload once it leaves the space', async () => {
    const { ctx, sharedLinkRepo, sharer, space, contributedAsset } = await seedSpace();
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: contributedAsset.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Individual,
      spaceId: space.id,
      assetIds: [contributedAsset.id],
    });

    await defaultDatabase.deleteFrom('shared_space_asset').where('spaceId', '=', space.id).execute();

    const result = await sharedLinkRepo.get(sharer.id, sharedLink.id);

    expect(result?.assets).toEqual([]);
  });

  it("lists contributions among an album link's assets", async () => {
    const { ctx, sharedLinkRepo, sharer, space, contributedAsset, ownAsset } = await seedSpace();
    const { album } = await ctx.newAlbum({ ownerId: sharer.id }, [ownAsset.id]);
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributedAsset.id, spaceId: space.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Album,
      albumId: album.id,
      spaceId: space.id,
    });

    const result = await sharedLinkRepo.get(sharer.id, sharedLink.id);

    expect(result?.album?.assets.map(({ id }) => id).sort()).toEqual([contributedAsset.id, ownAsset.id].sort());
  });

  it('drops contributions from an album link once the creator is demoted to viewer', async () => {
    const { ctx, sharedLinkRepo, sharer, space, contributedAsset, ownAsset } = await seedSpace();
    const { album } = await ctx.newAlbum({ ownerId: sharer.id }, [ownAsset.id]);
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributedAsset.id, spaceId: space.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Album,
      albumId: album.id,
      spaceId: space.id,
    });

    await defaultDatabase
      .updateTable('shared_space_member')
      .set({ role: SharedSpaceRole.Viewer })
      .where('spaceId', '=', space.id)
      .where('userId', '=', sharer.id)
      .execute();

    const result = await sharedLinkRepo.get(sharer.id, sharedLink.id);

    // The album's own asset survives; only the contributed one goes.
    expect(result?.album?.assets.map(({ id }) => id)).toEqual([ownAsset.id]);
  });

  it('never lists a hidden contribution', async () => {
    const { ctx, sharedLinkRepo, sharer, space, ownAsset, contributor } = await seedSpace();
    const { asset: hidden } = await ctx.newAsset({ ownerId: contributor.id, visibility: AssetVisibility.Hidden });
    await ctx.newExif({ assetId: hidden.id, make: 'test' });
    const { album } = await ctx.newAlbum({ ownerId: sharer.id }, [ownAsset.id]);
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: hidden.id, spaceId: space.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Album,
      albumId: album.id,
      spaceId: space.id,
    });

    const result = await sharedLinkRepo.get(sharer.id, sharedLink.id);

    expect(result?.album?.assets.map(({ id }) => id)).toEqual([ownAsset.id]);
  });

  it("lists only the album's own assets when the link carries no space", async () => {
    const { ctx, sharedLinkRepo, sharer, space, contributedAsset, ownAsset } = await seedSpace();
    const { album } = await ctx.newAlbum({ ownerId: sharer.id }, [ownAsset.id]);
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributedAsset.id, spaceId: space.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Album,
      albumId: album.id,
      spaceId: null,
    });

    const result = await sharedLinkRepo.get(sharer.id, sharedLink.id);

    expect(result?.album?.assets.map(({ id }) => id)).toEqual([ownAsset.id]);
  });
});
