import { Kysely } from 'kysely';
import { DownloadRepository } from 'src/repositories/download.repository';
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
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(DownloadRepository), spaceRepo: ctx.get(SharedSpaceRepository) };
};

async function collectIds(stream: AsyncIterable<{ id: string }>): Promise<Set<string>> {
  const ids = new Set<string>();
  for await (const row of stream) {
    ids.add(row.id);
  }
  return ids;
}

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('DownloadRepository.downloadSpaceId', () => {
  it('includes assets reachable via a linked album, alongside direct and library paths', async () => {
    const { ctx, sut, spaceRepo } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    // Direct-added asset.
    const { asset: direct } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newExif({ assetId: direct.id, fileSizeInByte: 1024 });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: direct.id });

    // Library asset, library linked to the space.
    const { result: library } = await ctx.newLibrary({ ownerId: user.id });
    const { asset: libAsset } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
    await ctx.newExif({ assetId: libAsset.id, fileSizeInByte: 1024 });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    // Album-linked asset, album linked to the space.
    const { asset: albumAsset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newExif({ assetId: albumAsset.id, fileSizeInByte: 1024 });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Linked' }, [albumAsset.id]);
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    const ids = await collectIds(sut.downloadSpaceId(space.id));

    expect(ids.has(direct.id)).toBe(true);
    expect(ids.has(libAsset.id)).toBe(true);
    expect(ids.has(albumAsset.id)).toBe(true);
  });

  it('includes linked-album assets even when the album is hidden from the timeline (download != timeline)', async () => {
    const { ctx, sut, spaceRepo } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    const { asset: albumAsset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newExif({ assetId: albumAsset.id, fileSizeInByte: 1024 });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Hidden' }, [albumAsset.id]);
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    await spaceRepo.setAlbumShowInTimeline(space.id, album.id, false);

    const ids = await collectIds(sut.downloadSpaceId(space.id));

    expect(ids.has(albumAsset.id)).toBe(true);
  });

  it('excludes a soft-deleted asset in a linked album', async () => {
    const { ctx, sut, spaceRepo } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    const { asset: live } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newExif({ assetId: live.id, fileSizeInByte: 1024 });
    const { asset: deleted } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newExif({ assetId: deleted.id, fileSizeInByte: 1024 });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Mixed' }, [live.id, deleted.id]);
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    await ctx.softDeleteAsset(deleted.id);

    const ids = await collectIds(sut.downloadSpaceId(space.id));

    expect(ids.has(live.id)).toBe(true);
    expect(ids.has(deleted.id)).toBe(false);
  });

  it('excludes assets of a soft-deleted (trashed) linked album', async () => {
    const { ctx, sut, spaceRepo } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    // Asset reachable only via a linked album that we then trash → must be EXCLUDED.
    const { asset: trashedAlbumAsset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newExif({ assetId: trashedAlbumAsset.id, fileSizeInByte: 1024 });
    const { result: trashedAlbum } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Trashed' }, [
      trashedAlbumAsset.id,
    ]);
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: trashedAlbum.id, addedById: user.id });

    // Control: asset in a live linked album → must remain INCLUDED (fix must not over-filter).
    const { asset: liveAlbumAsset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newExif({ assetId: liveAlbumAsset.id, fileSizeInByte: 1024 });
    const { result: liveAlbum } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Live' }, [liveAlbumAsset.id]);
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: liveAlbum.id, addedById: user.id });

    // Trash the first album (album.deletedAt = now(), link row survives).
    await ctx.softDeleteAlbum(trashedAlbum.id);

    const ids = await collectIds(sut.downloadSpaceId(space.id));

    expect(ids.has(trashedAlbumAsset.id)).toBe(false);
    expect(ids.has(liveAlbumAsset.id)).toBe(true);
  });
});
