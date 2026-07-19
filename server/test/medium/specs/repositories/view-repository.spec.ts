import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { ViewRepository } from 'src/repositories/view-repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(ViewRepository) };
};

type Ctx = ReturnType<typeof setup>['ctx'];

// Seed an asset added directly to a space, with `member` joined at the given role.
// The asset is owned by the space creator (a different user), so any visibility the
// member gets comes purely from their space membership — never from ownership.
const seedDirectSpaceAsset = async (
  ctx: Ctx,
  role: SharedSpaceRole,
  originalPath: string,
  visibility: AssetVisibility = AssetVisibility.Timeline,
) => {
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, originalPath, visibility });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role });
  return { owner, member, space, asset };
};

// Seed an asset reachable through an album linked to a space, with `member` joined.
const seedLinkedAlbumAsset = async (ctx: Ctx, role: SharedSpaceRole, originalPath: string) => {
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: `ViewAlbum-${role}` });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, originalPath });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role });
  return { owner, member, space, album, asset };
};

// Seed an asset reachable through a library linked to a space, with `member` joined.
const seedLinkedLibraryAsset = async (ctx: Ctx, role: SharedSpaceRole, originalPath: string) => {
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  const { library } = await ctx.newLibrary({ ownerId: owner.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id, originalPath });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role });
  return { owner, member, space, library, asset };
};

const ALL_ROLES = [SharedSpaceRole.Viewer, SharedSpaceRole.Editor, SharedSpaceRole.Owner];

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(ViewRepository.name, () => {
  // ============================================================================
  // Folder tree (getUniqueOriginalPaths) — permission matrix
  // ============================================================================
  describe('getUniqueOriginalPaths', () => {
    it('GRANT — owner sees folders for assets they own', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      await ctx.newAsset({ ownerId: user.id, originalPath: '/lib/owner/family/p1.jpg' });

      const result = await sut.getUniqueOriginalPaths(user.id);

      expect(result).toContain('/lib/owner/family');
    });

    it.each(ALL_ROLES)('GRANT — space %s sees folders for assets shared directly into the space', async (role) => {
      const { ctx, sut } = setup();
      const { member } = await seedDirectSpaceAsset(ctx, role, `/archive/2025/${role}-direct/IMG.jpg`);

      const result = await sut.getUniqueOriginalPaths(member.id);

      expect(result).toContain(`/archive/2025/${role}-direct`);
    });

    it.each(ALL_ROLES)('GRANT — space %s sees folders for assets in a library linked to the space', async (role) => {
      const { ctx, sut } = setup();
      const { member } = await seedLinkedLibraryAsset(ctx, role, `/external/cam/${role}-lib/clip.jpg`);

      const result = await sut.getUniqueOriginalPaths(member.id);

      expect(result).toContain(`/external/cam/${role}-lib`);
    });

    it.each(ALL_ROLES)('GRANT — space %s sees folders for assets in an album linked to the space', async (role) => {
      const { ctx, sut } = setup();
      const { member } = await seedLinkedAlbumAsset(ctx, role, `/album/folder/${role}-album/photo.jpg`);

      const result = await sut.getUniqueOriginalPaths(member.id);

      expect(result).toContain(`/album/folder/${role}-album`);
    });

    it('DENY — album with showInTimeline=false does not expose folder paths in the folder view', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'HiddenTimeline' });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: false });
      const { asset } = await ctx.newAsset({ ownerId: owner.id, originalPath: '/album/no-timeline/IMG.jpg' });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });

      const result = await sut.getUniqueOriginalPaths(member.id);

      expect(result).not.toContain('/album/no-timeline');
    });

    it('GRANT — same album with showInTimeline=true still exposes folder paths', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'VisibleTimeline' });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: true });
      const { asset } = await ctx.newAsset({ ownerId: owner.id, originalPath: '/album/yes-timeline/IMG.jpg' });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });

      const result = await sut.getUniqueOriginalPaths(member.id);

      expect(result).toContain('/album/yes-timeline');
    });

    it('GRANT — member sees the folder even when showInTimeline is disabled', async () => {
      const { ctx, sut } = setup();
      const { member, space } = await seedDirectSpaceAsset(ctx, SharedSpaceRole.Viewer, '/archive/no-timeline/IMG.jpg');
      await ctx.database
        .updateTable('shared_space_member')
        .set({ showInTimeline: false })
        .where('spaceId', '=', space.id)
        .where('userId', '=', member.id)
        .execute();

      const result = await sut.getUniqueOriginalPaths(member.id);

      expect(result).toContain('/archive/no-timeline');
    });

    it('DENY — non-member sees no folders for space assets', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: stranger } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      const { asset } = await ctx.newAsset({ ownerId: owner.id, originalPath: '/private/owner/secret/p1.jpg' });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

      const result = await sut.getUniqueOriginalPaths(stranger.id);

      expect(result).toEqual([]);
    });

    it('DENY — member of a different space does not see the asset folder', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: outsider } = await ctx.newUser();
      const { space: withAsset } = await ctx.newSharedSpace({ createdById: owner.id });
      const { space: other } = await ctx.newSharedSpace({ createdById: owner.id });
      const { asset } = await ctx.newAsset({ ownerId: owner.id, originalPath: '/private/owner/other-space/p1.jpg' });
      await ctx.newSharedSpaceAsset({ spaceId: withAsset.id, assetId: asset.id, addedById: owner.id });
      // outsider belongs to a different space that does NOT contain the asset
      await ctx.newSharedSpaceMember({ spaceId: other.id, userId: outsider.id, role: SharedSpaceRole.Viewer });

      const result = await sut.getUniqueOriginalPaths(outsider.id);

      expect(result).not.toContain('/private/owner/other-space');
    });

    it('DENY — a removed member no longer sees the folder', async () => {
      const { ctx, sut } = setup();
      const { member, space } = await seedDirectSpaceAsset(ctx, SharedSpaceRole.Editor, '/archive/removed/IMG.jpg');

      await expect(sut.getUniqueOriginalPaths(member.id)).resolves.toContain('/archive/removed');

      await ctx.database
        .deleteFrom('shared_space_member')
        .where('spaceId', '=', space.id)
        .where('userId', '=', member.id)
        .execute();

      await expect(sut.getUniqueOriginalPaths(member.id)).resolves.not.toContain('/archive/removed');
    });

    it('DENY — member does not see folders for non-timeline (hidden) shared assets', async () => {
      const { ctx, sut } = setup();
      const { member } = await seedDirectSpaceAsset(
        ctx,
        SharedSpaceRole.Viewer,
        '/archive/hidden/IMG.jpg',
        AssetVisibility.Hidden,
      );

      const result = await sut.getUniqueOriginalPaths(member.id);

      expect(result).not.toContain('/archive/hidden');
    });
  });

  // ============================================================================
  // Folder contents (getAssetsByOriginalPath) — permission matrix
  // ============================================================================
  describe('getAssetsByOriginalPath', () => {
    it.each(ALL_ROLES)('GRANT — space %s gets folder contents shared directly into the space', async (role) => {
      const { ctx, sut } = setup();
      const path = `/archive/contents/${role}-direct`;
      const { member, asset } = await seedDirectSpaceAsset(ctx, role, `${path}/IMG_8997.jpg`);

      const result = await sut.getAssetsByOriginalPath(member.id, path);

      expect(result.map((a) => a.id)).toEqual([asset.id]);
    });

    it.each(ALL_ROLES)('GRANT — space %s gets folder contents from a linked library', async (role) => {
      const { ctx, sut } = setup();
      const path = `/external/contents/${role}-lib`;
      const { member, asset } = await seedLinkedLibraryAsset(ctx, role, `${path}/clip.jpg`);

      const result = await sut.getAssetsByOriginalPath(member.id, path);

      expect(result.map((a) => a.id)).toEqual([asset.id]);
    });

    it.each(ALL_ROLES)('GRANT — space %s gets folder contents from a linked album', async (role) => {
      const { ctx, sut } = setup();
      const path = `/album/contents/${role}-album`;
      const { member, asset } = await seedLinkedAlbumAsset(ctx, role, `${path}/photo.jpg`);

      const result = await sut.getAssetsByOriginalPath(member.id, path);

      expect(result.map((a) => a.id)).toEqual([asset.id]);
    });

    it('DENY — non-member gets no folder contents', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: stranger } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      const { asset } = await ctx.newAsset({ ownerId: owner.id, originalPath: '/private/owner/contents/p1.jpg' });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

      const result = await sut.getAssetsByOriginalPath(stranger.id, '/private/owner/contents');

      expect(result).toEqual([]);
    });

    it('DENY — a removed member no longer gets folder contents', async () => {
      const { ctx, sut } = setup();
      const path = '/archive/contents/removed';
      const { member, space, asset } = await seedDirectSpaceAsset(ctx, SharedSpaceRole.Editor, `${path}/IMG.jpg`);

      await expect(sut.getAssetsByOriginalPath(member.id, path)).resolves.toEqual([
        expect.objectContaining({ id: asset.id }),
      ]);

      await ctx.database
        .deleteFrom('shared_space_member')
        .where('spaceId', '=', space.id)
        .where('userId', '=', member.id)
        .execute();

      await expect(sut.getAssetsByOriginalPath(member.id, path)).resolves.toEqual([]);
    });

    it('DENY — album with showInTimeline=false does not expose folder contents in the folder view', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'HiddenTimelineContents' });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: false });
      const path = '/album/no-timeline-contents';
      const { asset } = await ctx.newAsset({ ownerId: owner.id, originalPath: `${path}/IMG.jpg` });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });

      const result = await sut.getAssetsByOriginalPath(member.id, path);

      expect(result.map((a) => a.id)).not.toContain(asset.id);
    });

    it('GRANT — same album with showInTimeline=true still exposes folder contents', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'VisibleTimelineContents' });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: true });
      const path = '/album/yes-timeline-contents';
      const { asset } = await ctx.newAsset({ ownerId: owner.id, originalPath: `${path}/IMG.jpg` });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });

      const result = await sut.getAssetsByOriginalPath(member.id, path);

      expect(result.map((a) => a.id)).toContain(asset.id);
    });
  });
});
