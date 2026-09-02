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
});
