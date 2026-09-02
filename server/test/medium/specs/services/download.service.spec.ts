/**
 * Medium tests for `DownloadService.getDownloadInfo` on a space-linked album — issue #1048.
 *
 * A share link created from inside a Space (#1018) shows every member's photos, and so does the
 * album page for a member browsing it. "Download all" must ship exactly what was shown: the album
 * owner's own `album_asset` rows AND the cross-owner `album_space_asset` contributions (#764).
 *
 * These run the real service against the real DB so both halves of the download are covered — the
 * archive manifest built here, and the `AssetDownload` gate `downloadArchive` applies to the ids it
 * returns. A manifest listing an asset the gate then rejects would 400 the whole download, so the
 * two are asserted together.
 */
import { Kysely } from 'kysely';
import { StorageCore } from 'src/cores/storage.core';
import { SharedLinkType, SharedSpaceRole } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { DownloadRepository } from 'src/repositories/download.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { DownloadService } from 'src/services/download.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () =>
  newMediumService(DownloadService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      DownloadRepository,
      SharedLinkRepository,
      SharedSpaceRepository,
      UserRepository,
    ],
    mock: [LoggingRepository],
  });

beforeAll(async () => {
  // getDownloadInfo's live-photo branch reads StorageCore.isAndroidMotionPath.
  StorageCore.setMediaLocation('/tmp/test-immich-media');
  defaultDatabase = await getKyselyDB();
});

/**
 * A space whose owner (`sharer`) owns the linked album, plus an Editor (`contributor`) who owns one
 * photo contributed to it. `contributed` is never owned by the sharer — that is the whole point.
 */
const seedSpaceAlbum = async () => {
  const { sut, ctx } = setup();
  const { user: sharer } = await ctx.newUser();
  const { user: contributor } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: sharer.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: sharer.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: contributor.id, role: SharedSpaceRole.Editor });

  const { asset: ownAsset } = await ctx.newAsset({ ownerId: sharer.id });
  await ctx.newExif({ assetId: ownAsset.id, fileSizeInByte: 1024 });
  const { result: album } = await ctx.newAlbum({ ownerId: sharer.id, albumName: 'Trip' }, [ownAsset.id]);
  await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: sharer.id });

  const { asset: contributed } = await ctx.newAsset({ ownerId: contributor.id });
  await ctx.newExif({ assetId: contributed.id, fileSizeInByte: 2048 });
  await ctx.newAlbumSpaceAsset({
    albumId: album.id,
    assetId: contributed.id,
    spaceId: space.id,
    addedById: contributor.id,
  });

  return { sut, ctx, sharer, contributor, space, album, ownAsset, contributed };
};

const seedOfflineContribution = async () => {
  const seeded = await seedSpaceAlbum();
  const { ctx, contributor, space, album } = seeded;
  const { library } = await ctx.newLibrary({ ownerId: contributor.id });
  const { asset: offline } = await ctx.newAsset({
    ownerId: contributor.id,
    libraryId: library.id,
    isOffline: true,
  });
  await ctx.newExif({ assetId: offline.id, fileSizeInByte: 2048 });
  await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: offline.id, spaceId: space.id });
  return { ...seeded, offline };
};

const seedTwoSpaces = async () => {
  const seeded = await seedSpaceAlbum();
  const { ctx, sharer, album } = seeded;
  const { user: outsider } = await ctx.newUser();
  const { space: otherSpace } = await ctx.newSharedSpace({ createdById: sharer.id });
  await ctx.newSharedSpaceMember({ spaceId: otherSpace.id, userId: sharer.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: otherSpace.id, userId: outsider.id, role: SharedSpaceRole.Editor });
  await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: otherSpace.id, albumId: album.id, addedById: sharer.id });

  const { asset: otherContribution } = await ctx.newAsset({ ownerId: outsider.id });
  await ctx.newExif({ assetId: otherContribution.id, fileSizeInByte: 4096 });
  await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: otherContribution.id, spaceId: otherSpace.id });

  return { ...seeded, otherSpace, otherContribution };
};

const manifestIds = (response: { archives: { assetIds: string[] }[] }) =>
  new Set(response.archives.flatMap((archive) => archive.assetIds));

describe(`${DownloadService.name} — space-linked album (#1048)`, () => {
  it("includes another member's contribution in a share link's album download", async () => {
    const { sut, ctx, sharer, space, album, ownAsset, contributed } = await seedSpaceAlbum();
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Album,
      albumId: album.id,
      spaceId: space.id,
    });
    const auth = factory.auth({
      user: sharer,
      sharedLink: { id: sharedLink.id, albumId: album.id, spaceId: space.id },
    });

    const ids = manifestIds(await sut.getDownloadInfo(auth, { albumId: album.id }));

    expect(ids).toEqual(new Set([ownAsset.id, contributed.id]));
    // The archive step re-checks every id under AssetDownload; a manifest the gate rejects 400s.
    await expect(ctx.get(AccessRepository).asset.checkSharedLinkAccess(sharedLink.id, ids)).resolves.toEqual(ids);
  });

  it('stops including it once the contributor pulls the photo out of the space', async () => {
    const { sut, ctx, sharer, space, album, ownAsset, contributed } = await seedSpaceAlbum();
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Album,
      albumId: album.id,
      spaceId: space.id,
    });
    const auth = factory.auth({
      user: sharer,
      sharedLink: { id: sharedLink.id, albumId: album.id, spaceId: space.id },
    });

    await ctx.database.deleteFrom('album_space_asset').where('assetId', '=', contributed.id).execute();

    const ids = manifestIds(await sut.getDownloadInfo(auth, { albumId: album.id }));

    expect(ids).toEqual(new Set([ownAsset.id]));
  });

  it('serves only the album owner once the link creator is demoted to Viewer', async () => {
    const { sut, ctx, sharer, space, album, ownAsset } = await seedSpaceAlbum();
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Album,
      albumId: album.id,
      spaceId: space.id,
    });
    const auth = factory.auth({
      user: sharer,
      sharedLink: { id: sharedLink.id, albumId: album.id, spaceId: space.id },
    });

    await ctx.database
      .updateTable('shared_space_member')
      .set({ role: SharedSpaceRole.Viewer })
      .where('spaceId', '=', space.id)
      .where('userId', '=', sharer.id)
      .execute();

    const ids = manifestIds(await sut.getDownloadInfo(auth, { albumId: album.id }));

    expect(ids).toEqual(new Set([ownAsset.id]));
  });

  it('includes the contribution for a signed-in member downloading the album', async () => {
    const { sut, ctx, contributor, ownAsset, album, contributed } = await seedSpaceAlbum();
    const auth = factory.auth({ user: contributor });

    const ids = manifestIds(await sut.getDownloadInfo(auth, { albumId: album.id }));

    expect(ids).toEqual(new Set([ownAsset.id, contributed.id]));
    await expect(ctx.get(AccessRepository).asset.checkSpaceAccess(contributor.id, ids)).resolves.toEqual(ids);
  });

  it('serves only the album owner to a plain album share with no space behind it', async () => {
    const { sut, ctx, sharer, album, ownAsset } = await seedSpaceAlbum();
    const { sharedLink } = await ctx.newSharedLink({
      userId: sharer.id,
      type: SharedLinkType.Album,
      albumId: album.id,
    });
    const auth = factory.auth({ user: sharer, sharedLink: { id: sharedLink.id, albumId: album.id } });

    const ids = manifestIds(await sut.getDownloadInfo(auth, { albumId: album.id }));

    expect(ids).toEqual(new Set([ownAsset.id]));
  });

  // -------------------------------------------------------------------------
  // The manifest and the gate must agree. `downloadArchive` re-checks every id
  // under `AssetDownload` and `requireAccess` is all-or-nothing, so one row the
  // gate rejects does not go quietly missing — it 400s the whole download.
  // -------------------------------------------------------------------------
  describe('manifest never outruns the AssetDownload gate', () => {
    it('omits an OFFLINE contribution rather than 400-ing the member download', async () => {
      const { sut, ctx, contributor, ownAsset, contributed, album, offline } = await seedOfflineContribution();
      const auth = factory.auth({ user: contributor });

      const ids = manifestIds(await sut.getDownloadInfo(auth, { albumId: album.id }));

      expect(ids).toEqual(new Set([ownAsset.id, contributed.id]));
      expect(ids.has(offline.id)).toBe(false);
      await expect(ctx.get(AccessRepository).asset.checkSpaceAccess(contributor.id, ids)).resolves.toEqual(ids);
    });

    it('omits an OFFLINE asset the album OWNER contributed to the space', async () => {
      const { sut, ctx, sharer, space, album, ownAsset, contributed } = await seedSpaceAlbum();
      const { user: member } = await ctx.newUser();
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });

      const { library } = await ctx.newLibrary({ ownerId: sharer.id });
      const { asset: offline } = await ctx.newAsset({ ownerId: sharer.id, libraryId: library.id, isOffline: true });
      await ctx.newExif({ assetId: offline.id, fileSizeInByte: 2048 });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: offline.id });

      const ids = manifestIds(await sut.getDownloadInfo(factory.auth({ user: member }), { albumId: album.id }));

      expect(ids).toEqual(new Set([ownAsset.id, contributed.id]));
      await expect(ctx.get(AccessRepository).asset.checkSpaceAccess(member.id, ids)).resolves.toEqual(ids);
    });

    it("carries a contributed live photo's motion part, and the gate grants it on both paths", async () => {
      const { sut, ctx, sharer, contributor, space, album, ownAsset, contributed } = await seedSpaceAlbum();

      const { asset: motion } = await ctx.newAsset({ ownerId: contributor.id });
      await ctx.newExif({ assetId: motion.id, fileSizeInByte: 500 });
      const { asset: still } = await ctx.newAsset({ ownerId: contributor.id, livePhotoVideoId: motion.id });
      await ctx.newExif({ assetId: still.id, fileSizeInByte: 2048 });
      await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: still.id, spaceId: space.id });

      const expected = new Set([ownAsset.id, contributed.id, still.id, motion.id]);

      const memberIds = manifestIds(
        await sut.getDownloadInfo(factory.auth({ user: contributor }), { albumId: album.id }),
      );
      expect(memberIds).toEqual(expected);
      await expect(ctx.get(AccessRepository).asset.checkSpaceAccess(contributor.id, memberIds)).resolves.toEqual(
        memberIds,
      );

      const { sharedLink } = await ctx.newSharedLink({
        userId: sharer.id,
        type: SharedLinkType.Album,
        albumId: album.id,
        spaceId: space.id,
      });
      const linkIds = manifestIds(
        await sut.getDownloadInfo(
          factory.auth({ user: sharer, sharedLink: { id: sharedLink.id, albumId: album.id, spaceId: space.id } }),
          { albumId: album.id },
        ),
      );
      expect(linkIds).toEqual(expected);
      await expect(ctx.get(AccessRepository).asset.checkSharedLinkAccess(sharedLink.id, linkIds)).resolves.toEqual(
        linkIds,
      );
    });
  });

  // -------------------------------------------------------------------------
  // An album may be linked to several spaces at once. A contribution is only
  // ever reachable through the ONE space it was made to (#764), so what you get
  // depends on which of those spaces you are actually a member of.
  // -------------------------------------------------------------------------
  describe('album linked to two spaces', () => {
    it("gives a member of only one space that space's contributions, not the other's", async () => {
      const { sut, contributor, album, ownAsset, contributed, otherContribution } = await seedTwoSpaces();

      const ids = manifestIds(await sut.getDownloadInfo(factory.auth({ user: contributor }), { albumId: album.id }));

      expect(ids).toEqual(new Set([ownAsset.id, contributed.id]));
      expect(ids.has(otherContribution.id)).toBe(false);
    });

    it('gives a member of both spaces both sets', async () => {
      const { sut, sharer, album, ownAsset, contributed, otherContribution } = await seedTwoSpaces();

      const ids = manifestIds(await sut.getDownloadInfo(factory.auth({ user: sharer }), { albumId: album.id }));

      expect(ids).toEqual(new Set([ownAsset.id, contributed.id, otherContribution.id]));
    });

    it("scopes a link made from one space to that space alone, never the album's other space", async () => {
      const { sut, ctx, sharer, space, album, ownAsset, contributed, otherContribution } = await seedTwoSpaces();
      const { sharedLink } = await ctx.newSharedLink({
        userId: sharer.id,
        type: SharedLinkType.Album,
        albumId: album.id,
        spaceId: space.id,
      });

      const ids = manifestIds(
        await sut.getDownloadInfo(
          factory.auth({ user: sharer, sharedLink: { id: sharedLink.id, albumId: album.id, spaceId: space.id } }),
          { albumId: album.id },
        ),
      );

      expect(ids).toEqual(new Set([ownAsset.id, contributed.id]));
      expect(ids.has(otherContribution.id)).toBe(false);
    });
  });
});
