import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum.js';
import { GalleryAssetService } from 'src/gallery/services/gallery-asset.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { DB } from 'src/schema/index.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) =>
  newMediumService(GalleryAssetService, {
    database: db || defaultDatabase,
    real: [AccessRepository, PartnerRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

/** Anna views; Bob owns the spaces and the assets. */
const newWorld = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user: anna } = await ctx.newUser();
  const { user: bob } = await ctx.newUser();
  const newSpace = async ({ annaShowsIt = true }: { annaShowsIt?: boolean } = {}) => {
    const { space } = await ctx.newSharedSpace({ createdById: bob.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: bob.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: anna.id, role: 'viewer', showInTimeline: annaShowsIt });
    return space;
  };
  const newAsset = async (dto: { ownerId?: string; libraryId?: string; visibility?: AssetVisibility } = {}) => {
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline, ...dto });
    return asset;
  };
  const newLinkedAlbum = async (spaceIds: string[], { showInTimeline = true } = {}) => {
    const { album } = await ctx.newAlbum({ ownerId: bob.id, albumName: 'Linked' });
    for (const spaceId of spaceIds) {
      await ctx.newSharedSpaceAlbum({ spaceId, albumId: album.id, showInTimeline });
    }
    return album;
  };
  return { anna, bob, newSpace, newAsset, newLinkedAlbum };
};

const spacesByAsset = async (sut: GalleryAssetService, userId: string, assetIds: string[]) => {
  const { assets } = await sut.getSpaces(factory.auth({ user: { id: userId } }), { assetIds });
  return Object.fromEntries(assets.map(({ assetId, spaceIds }) => [assetId, spaceIds.toSorted()]));
};

describe('GalleryAssetService.getSpaces', () => {
  it('finds each path into a space on its own: added, linked library, linked album', async () => {
    const { sut, ctx } = setup();
    const { anna, bob, newSpace, newAsset, newLinkedAlbum } = await newWorld(ctx);
    const [added, byLibrary, byAlbum] = [await newSpace(), await newSpace(), await newSpace()];

    const direct = await newAsset();
    await ctx.newSharedSpaceAsset({ spaceId: added.id, assetId: direct.id });

    const { library } = await ctx.newLibrary({ ownerId: bob.id });
    const inLibrary = await newAsset({ libraryId: library.id });
    await ctx.newSharedSpaceLibrary({ spaceId: byLibrary.id, libraryId: library.id });

    const album = await newLinkedAlbum([byAlbum.id]);
    const inAlbum = await newAsset();
    await ctx.newAlbumAsset({ albumId: album.id, assetId: inAlbum.id });

    await expect(spacesByAsset(sut, anna.id, [direct.id, inLibrary.id, inAlbum.id])).resolves.toEqual({
      [direct.id]: [added.id],
      [inLibrary.id]: [byLibrary.id],
      [inAlbum.id]: [byAlbum.id],
    });
  });

  it('counts a space reached by two paths once, and lists every space', async () => {
    const { sut, ctx } = setup();
    const { anna, newSpace, newAsset, newLinkedAlbum } = await newWorld(ctx);
    const [first, second] = [await newSpace(), await newSpace()];
    const album = await newLinkedAlbum([first.id]);
    const asset = await newAsset();
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAsset({ spaceId: first.id, assetId: asset.id });
    await ctx.newSharedSpaceAsset({ spaceId: second.id, assetId: asset.id });

    await expect(spacesByAsset(sut, anna.id, [asset.id])).resolves.toEqual({
      [asset.id]: [first.id, second.id].toSorted(),
    });
  });

  it('counts what is hidden from the timeline: a hidden space, a hidden link, a personally hidden album', async () => {
    const { sut, ctx } = setup();
    const { anna, newSpace, newAsset, newLinkedAlbum } = await newWorld(ctx);
    const hiddenSpace = await newSpace({ annaShowsIt: false });
    const direct = await newAsset();
    await ctx.newSharedSpaceAsset({ spaceId: hiddenSpace.id, assetId: direct.id });

    const linkOff = await newSpace();
    const offAlbum = await newLinkedAlbum([linkOff.id], { showInTimeline: false });
    const inOffAlbum = await newAsset();
    await ctx.newAlbumAsset({ albumId: offAlbum.id, assetId: inOffAlbum.id });

    const annaHides = await newSpace();
    const hiddenAlbum = await newLinkedAlbum([annaHides.id]);
    await ctx.newSharedSpaceAlbumHidden({ spaceId: annaHides.id, albumId: hiddenAlbum.id, userId: anna.id });
    const inHiddenAlbum = await newAsset();
    await ctx.newAlbumAsset({ albumId: hiddenAlbum.id, assetId: inHiddenAlbum.id });

    await expect(spacesByAsset(sut, anna.id, [direct.id, inOffAlbum.id, inHiddenAlbum.id])).resolves.toEqual({
      [direct.id]: [hiddenSpace.id],
      [inOffAlbum.id]: [linkOff.id],
      [inHiddenAlbum.id]: [annaHides.id],
    });
  });

  it('counts a contribution only in the space it went through, and nothing from a deleted album', async () => {
    const { sut, ctx } = setup();
    const { anna, newSpace, newAsset, newLinkedAlbum } = await newWorld(ctx);
    const [through, other] = [await newSpace(), await newSpace()];
    const album = await newLinkedAlbum([through.id, other.id]);
    const { user: carol } = await ctx.newUser();
    const contributed = await newAsset({ ownerId: carol.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributed.id, spaceId: through.id });

    const gone = await newSpace();
    const deletedAlbum = await newLinkedAlbum([gone.id]);
    const inDeletedAlbum = await newAsset();
    await ctx.newAlbumAsset({ albumId: deletedAlbum.id, assetId: inDeletedAlbum.id });
    await defaultDatabase
      .updateTable('album')
      .set({ deletedAt: new Date() })
      .where('id', '=', deletedAlbum.id)
      .execute();

    await expect(spacesByAsset(sut, anna.id, [contributed.id, inDeletedAlbum.id])).resolves.toEqual({
      [contributed.id]: [through.id],
    });
  });

  it("leaves out another user's spaces and the viewer's own photos in no space", async () => {
    const { sut, ctx } = setup();
    const { anna, bob, newSpace, newAsset } = await newWorld(ctx);
    const shared = await newSpace();
    const mine = await newAsset({ ownerId: anna.id });
    const mineShared = await newAsset({ ownerId: anna.id });
    await ctx.newSharedSpaceAsset({ spaceId: shared.id, assetId: mineShared.id });
    const { space: bobsOwn } = await ctx.newSharedSpace({ createdById: bob.id });
    await ctx.newSharedSpaceMember({ spaceId: bobsOwn.id, userId: bob.id, role: 'owner' });
    await ctx.newSharedSpaceAsset({ spaceId: bobsOwn.id, assetId: mineShared.id });

    await expect(spacesByAsset(sut, anna.id, [mine.id, mineShared.id])).resolves.toEqual({
      [mineShared.id]: [shared.id],
    });
  });

  it('counts archived photos, and keeps hidden, locked and trashed ones out of every space, the owner included', async () => {
    const { sut, ctx } = setup();
    const { bob, newSpace, newAsset } = await newWorld(ctx);
    const space = await newSpace();
    const archived = await newAsset({ visibility: AssetVisibility.Archive });
    const hidden = await newAsset({ visibility: AssetVisibility.Hidden });
    const locked = await newAsset({ visibility: AssetVisibility.Locked });
    const { asset: trashed } = await ctx.newAsset({ ownerId: bob.id, deletedAt: new Date() });
    for (const asset of [archived, hidden, locked, trashed]) {
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
    }
    const elevated = factory.auth({ user: { id: bob.id }, session: { hasElevatedPermission: true } });

    const { assets } = await sut.getSpaces(elevated, { assetIds: [archived.id, hidden.id, locked.id, trashed.id] });

    expect(assets).toEqual([{ assetId: archived.id, spaceIds: [space.id] }]);
  });

  it("answers only about assets the viewer can read, and never for a shared link's visitor", async () => {
    const { sut, ctx } = setup();
    const { anna, bob, newSpace, newAsset } = await newWorld(ctx);
    const space = await newSpace();
    const asset = await newAsset();
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
    // Anna is removed from the space: she can no longer read the asset, nor is the space hers.
    await defaultDatabase
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', anna.id)
      .execute();

    await expect(spacesByAsset(sut, anna.id, [asset.id])).resolves.toEqual({});
    const link = factory.auth({ user: { id: bob.id }, sharedLink: {} });
    await expect(sut.getSpaces(link, { assetIds: [asset.id] })).resolves.toEqual({ assets: [] });
  });
});
