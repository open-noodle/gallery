/**
 * Medium tests for `AccessRepository.asset.checkSpaceEditAccess` — the space-editor
 * write rule (#734, spec §2).
 *
 * Rule: you may edit an asset if you own it, or if you are Owner/Editor of a space
 * that shows it AND its owner is a member of that space.
 *
 * These tests are the only place S-4 (Carol), S-5 (Dave), S-7/S-8 (Hidden/Locked),
 * S-9 (trashed) and S-10 (offline) can fail. A refactor that swaps the bespoke arms
 * for `spaceAssetPathBranches` drops those gates and still compiles — this file is
 * what catches it.
 */
import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
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
    real: [AccessRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });
  return { ctx, accessRepo: ctx.get(AccessRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const markOffline = (assetId: string) =>
  defaultDatabase.updateTable('asset').set({ isOffline: true }).where('id', '=', assetId).execute();

const trash = (assetId: string) =>
  defaultDatabase.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', assetId).execute();

/** Anna (Editor) + Bob (Member) in one space. */
const newSpaceWithEditorAndMember = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user: anna } = await ctx.newUser();
  const { user: bob } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: bob.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: bob.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: anna.id, role: 'editor' });
  return { anna, bob, space };
};

describe('checkSpaceEditAccess — the three access paths', () => {
  it('S-1: grants a directly-added asset owned by a space member', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set([asset.id]));
  });

  it('S-2: grants an asset reaching the space through a linked library', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { library } = await ctx.newLibrary({ ownerId: bob.id });
    const { asset } = await ctx.newAsset({
      ownerId: bob.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set([asset.id]));
  });

  it('S-3: grants an asset reaching the space through a linked album (NEW)', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: 'Trip' });
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set([asset.id]));
  });

  it('S-11: the album arm ignores showInTimeline', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: 'Quiet' });
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: false });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set([asset.id]));
  });
});

describe('checkSpaceEditAccess — owner must be a space member', () => {
  it('S-4: denies Carol’s asset, reached via a linked album, when Carol is not in the space', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { user: carol } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: 'Shared' });
    await ctx.newAlbumUser({ albumId: album.id, userId: carol.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it('S-5: denies Dave’s partner-shared asset that Bob direct-added (tightening, spec §2.3)', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { user: dave } = await ctx.newUser();
    await ctx.newPartner({ sharedById: dave.id, sharedWithId: bob.id });
    const { asset } = await ctx.newAsset({ ownerId: dave.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: bob.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it('S-13: membership binds to the space granting the role, not to any space', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space: spaceA } = await newSpaceWithEditorAndMember(ctx);
    // Bob leaves A; he is a member of B only. His asset still reaches A via a linked album.
    await defaultDatabase
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', spaceA.id)
      .where('userId', '=', bob.id)
      .execute();
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: bob.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: bob.id, role: 'owner' });

    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: 'Cross' });
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: spaceA.id, albumId: album.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });
});

describe('checkSpaceEditAccess — role gate', () => {
  it('S-6: denies a Viewer on the direct path', async () => {
    const { ctx, accessRepo } = setup();
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { user: vic } = await ctx.newUser();
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: vic.id, role: 'viewer' });
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(vic.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it('S-44: denies a Viewer on the NEW album path', async () => {
    const { ctx, accessRepo } = setup();
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { user: vic } = await ctx.newUser();
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: vic.id, role: 'viewer' });
    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: 'ViewerAlbum' });
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(vic.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it('S-43: grants a space Owner, not only an Editor', async () => {
    const { ctx, accessRepo } = setup();
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { user: olive } = await ctx.newUser();
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: olive.id, role: 'owner' });
    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: 'OwnerAlbum' });
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(olive.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set([asset.id]));
  });
});

describe('checkSpaceEditAccess — gates that must survive any refactor', () => {
  it.each([
    ['S-7 Hidden', AssetVisibility.Hidden],
    ['S-8 Locked', AssetVisibility.Locked],
  ])('%s: denies a non-space-shareable visibility on every path', async (_label, visibility) => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);

    const { asset: direct } = await ctx.newAsset({ ownerId: bob.id, visibility });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: direct.id });

    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: 'V' });
    const { asset: viaAlbum } = await ctx.newAsset({ ownerId: bob.id, visibility });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: viaAlbum.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([direct.id, viaAlbum.id]));

    expect(allowed).toEqual(new Set());
  });

  it('S-9: denies a trashed asset', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
    await trash(asset.id);

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it('S-10: denies an offline library asset', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { library } = await ctx.newLibrary({ ownerId: bob.id });
    const { asset } = await ctx.newAsset({
      ownerId: bob.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await markOffline(asset.id);

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it('S-12: resolves the motion half of a live photo', async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { asset: motion } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    const { asset: still } = await ctx.newAsset({
      ownerId: bob.id,
      visibility: AssetVisibility.Timeline,
      livePhotoVideoId: motion.id,
    });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: still.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([motion.id]));

    expect(allowed).toEqual(new Set([motion.id]));
  });
});
