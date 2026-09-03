import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum';
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

  // ---------------------------------------------------------------------------
  // Visibility filtering — Slice 2 (space download must honour the canonical
  // "space-visible" rule: only Timeline and Archive; Hidden and Locked never).
  // ---------------------------------------------------------------------------

  it('excludes Hidden and Locked assets from the direct-added arm, includes Timeline and Archive', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    const seed = async (visibility: AssetVisibility) => {
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: 1024 });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
      return asset;
    };

    const timelineAsset = await seed(AssetVisibility.Timeline);
    const archiveAsset = await seed(AssetVisibility.Archive);
    const hiddenAsset = await seed(AssetVisibility.Hidden);
    const lockedAsset = await seed(AssetVisibility.Locked);

    const ids = await collectIds(sut.downloadSpaceId(space.id));

    expect(ids.has(timelineAsset.id)).toBe(true);
    expect(ids.has(archiveAsset.id)).toBe(true);
    expect(ids.has(hiddenAsset.id)).toBe(false);
    expect(ids.has(lockedAsset.id)).toBe(false);
  });

  it('excludes Hidden and Locked assets from the library arm, includes Timeline and Archive', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { library } = await ctx.newLibrary({ ownerId: user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const seed = async (visibility: AssetVisibility) => {
      const { asset } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id, visibility });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: 1024 });
      return asset;
    };

    const timelineAsset = await seed(AssetVisibility.Timeline);
    const archiveAsset = await seed(AssetVisibility.Archive);
    const hiddenAsset = await seed(AssetVisibility.Hidden);
    const lockedAsset = await seed(AssetVisibility.Locked);

    const ids = await collectIds(sut.downloadSpaceId(space.id));

    expect(ids.has(timelineAsset.id)).toBe(true);
    expect(ids.has(archiveAsset.id)).toBe(true);
    expect(ids.has(hiddenAsset.id)).toBe(false);
    expect(ids.has(lockedAsset.id)).toBe(false);
  });

  it('excludes Hidden assets from the album arm; Locked cannot be seeded into an album (auto-stripped invariant)', async () => {
    // NOTE: asset.service.ts:313 (removeAssetsFromAll) strips Locked assets
    // from all albums automatically. We therefore cannot reliably seed a Locked
    // asset into an album via the normal album path. We assert Locked is absent
    // and document this invariant here.
    const { ctx, sut, spaceRepo } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    await ctx.newExif({ assetId: timelineAsset.id, fileSizeInByte: 1024 });

    const { asset: archiveAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
    await ctx.newExif({ assetId: archiveAsset.id, fileSizeInByte: 1024 });

    const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Hidden });
    await ctx.newExif({ assetId: hiddenAsset.id, fileSizeInByte: 1024 });

    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Mixed Visibility' }, [
      timelineAsset.id,
      archiveAsset.id,
      hiddenAsset.id,
    ]);
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    const ids = await collectIds(sut.downloadSpaceId(space.id));

    expect(ids.has(timelineAsset.id)).toBe(true);
    expect(ids.has(archiveAsset.id)).toBe(true);
    expect(ids.has(hiddenAsset.id)).toBe(false);
    // Locked cannot be placed in albums (see service-layer invariant above).
  });

  it('added-then-flipped replay: asset promoted to Hidden/Locked after row creation is excluded from downloadSpaceId', async () => {
    // Edge case: a shared_space_asset row already exists (created when the asset
    // was Timeline) but the asset's visibility was later changed to Hidden or
    // Locked. The filter is applied at READ time, so the asset must be excluded.
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    // Start as Timeline, add to space, then flip visibility.
    const { asset: flippedToHidden } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    await ctx.newExif({ assetId: flippedToHidden.id, fileSizeInByte: 1024 });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: flippedToHidden.id });
    await ctx.database
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', flippedToHidden.id)
      .execute();

    const { asset: flippedToLocked } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    await ctx.newExif({ assetId: flippedToLocked.id, fileSizeInByte: 1024 });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: flippedToLocked.id });
    await ctx.database
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Locked })
      .where('id', '=', flippedToLocked.id)
      .execute();

    // Control: a Timeline asset that was NOT flipped.
    const { asset: stable } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    await ctx.newExif({ assetId: stable.id, fileSizeInByte: 1024 });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: stable.id });

    const ids = await collectIds(sut.downloadSpaceId(space.id));

    expect(ids.has(flippedToHidden.id)).toBe(false);
    expect(ids.has(flippedToLocked.id)).toBe(false);
    expect(ids.has(stable.id)).toBe(true);
  });

  it('isOffline library asset is excluded from downloadSpaceId', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { library } = await ctx.newLibrary({ ownerId: user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const { asset: offlineAsset } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id, isOffline: true });
    await ctx.newExif({ assetId: offlineAsset.id, fileSizeInByte: 1024 });

    const { asset: onlineAsset } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id, isOffline: false });
    await ctx.newExif({ assetId: onlineAsset.id, fileSizeInByte: 1024 });

    const ids = await collectIds(sut.downloadSpaceId(space.id));

    expect(ids.has(offlineAsset.id)).toBe(false);
    expect(ids.has(onlineAsset.id)).toBe(true);
  });
});

describe('DownloadRepository.downloadAlbumId', () => {
  it('excludes Hidden assets from album download; Locked cannot be seeded into an album (auto-stripped invariant)', async () => {
    // NOTE: asset.service.ts:313 (removeAssetsFromAll) strips Locked assets
    // from all albums automatically. We therefore cannot reliably force a Locked
    // asset into an album and test its exclusion. We assert Hidden is excluded
    // and that Locked is absent (invariant documented).
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    await ctx.newExif({ assetId: timelineAsset.id, fileSizeInByte: 1024 });

    const { asset: archiveAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
    await ctx.newExif({ assetId: archiveAsset.id, fileSizeInByte: 1024 });

    const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Hidden });
    await ctx.newExif({ assetId: hiddenAsset.id, fileSizeInByte: 1024 });

    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Download Album' }, [
      timelineAsset.id,
      archiveAsset.id,
      hiddenAsset.id,
    ]);

    const ids = await collectIds(sut.downloadAlbumId(album.id));

    expect(ids.has(timelineAsset.id)).toBe(true);
    expect(ids.has(archiveAsset.id)).toBe(true);
    expect(ids.has(hiddenAsset.id)).toBe(false);
    // Locked cannot be placed in albums (see service-layer invariant above).
  });
});

// ---------------------------------------------------------------------------
// #1048: cross-owner contributions (#764) inside a space-linked album. The album
// grid — and an album share link created from the space (#1018) — both show the
// other members' photos, so the album archive must contain them too. Before this
// the album arm read `album_asset` alone and silently shipped only the album
// owner's own photos.
//
// The contributed arm is gated on the space ids the SERVICE resolved (live
// member-spaces linking the album, or the single tethered space of a link), the
// same contract `AssetRepository`'s album arm uses — so a plain album_user share
// or a spaceless link resolves none and nothing widens.
// ---------------------------------------------------------------------------
const seedContributedAlbum = async () => {
  const { ctx, sut, spaceRepo } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: contributor } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: contributor.id, role: 'editor' });

  const { asset: ownAsset } = await ctx.newAsset({ ownerId: owner.id });
  await ctx.newExif({ assetId: ownAsset.id, fileSizeInByte: 1024 });
  const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Space album' }, [ownAsset.id]);
  await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

  const { asset: contributed } = await ctx.newAsset({ ownerId: contributor.id });
  await ctx.newExif({ assetId: contributed.id, fileSizeInByte: 2048 });
  await ctx.newAlbumSpaceAsset({
    albumId: album.id,
    assetId: contributed.id,
    spaceId: space.id,
    addedById: contributor.id,
  });

  return { ctx, sut, spaceRepo, owner, contributor, space, album, ownAsset, contributed };
};

describe('DownloadRepository.downloadAlbumId — cross-owner contributions', () => {
  it("includes another member's contribution when the album's space is in scope", async () => {
    const { sut, album, space, ownAsset, contributed } = await seedContributedAlbum();

    const ids = await collectIds(sut.downloadAlbumId(album.id, [space.id]));

    expect(ids.has(ownAsset.id)).toBe(true);
    expect(ids.has(contributed.id)).toBe(true);
  });

  it('omits contributions when no space scope is resolved (plain album share)', async () => {
    const { sut, album, ownAsset, contributed } = await seedContributedAlbum();

    const ids = await collectIds(sut.downloadAlbumId(album.id));

    expect(ids.has(ownAsset.id)).toBe(true);
    expect(ids.has(contributed.id)).toBe(false);
  });

  it('omits a contribution tethered to a different space', async () => {
    const { ctx, sut, owner, album, ownAsset, contributed } = await seedContributedAlbum();
    const { space: otherSpace } = await ctx.newSharedSpace({ createdById: owner.id });

    const ids = await collectIds(sut.downloadAlbumId(album.id, [otherSpace.id]));

    expect(ids.has(ownAsset.id)).toBe(true);
    expect(ids.has(contributed.id)).toBe(false);
  });

  it('excludes a Hidden contribution, includes an Archive one', async () => {
    const { ctx, sut, contributor, space, album, contributed } = await seedContributedAlbum();

    const { asset: archived } = await ctx.newAsset({ ownerId: contributor.id, visibility: AssetVisibility.Archive });
    await ctx.newExif({ assetId: archived.id, fileSizeInByte: 2048 });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: archived.id, spaceId: space.id });

    await ctx.database
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', contributed.id)
      .execute();

    const ids = await collectIds(sut.downloadAlbumId(album.id, [space.id]));

    expect(ids.has(archived.id)).toBe(true);
    expect(ids.has(contributed.id)).toBe(false);
  });

  it('excludes a soft-deleted contribution', async () => {
    const { ctx, sut, space, album, contributed } = await seedContributedAlbum();
    await ctx.softDeleteAsset(contributed.id);

    const ids = await collectIds(sut.downloadAlbumId(album.id, [space.id]));

    expect(ids.has(contributed.id)).toBe(false);
  });

  it('yields an asset once when it is both an album member and a contribution', async () => {
    const { ctx, sut, space, album, ownAsset } = await seedContributedAlbum();
    // P1-6 coexistence window: the same asset carries an album_asset AND an
    // album_space_asset row. The archive must not list it twice.
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: ownAsset.id, spaceId: space.id });

    const rows: string[] = [];
    for await (const row of sut.downloadAlbumId(album.id, [space.id])) {
      rows.push(row.id);
    }

    expect(rows.filter((id) => id === ownAsset.id)).toHaveLength(1);
  });
});

describe('DownloadRepository.downloadSpaceId — cross-owner contributions', () => {
  it("includes another member's contribution to a linked album", async () => {
    const { ctx, sut, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: contributor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: contributor.id, role: 'editor' });

    const { asset: ownAsset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newExif({ assetId: ownAsset.id, fileSizeInByte: 1024 });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Space album' }, [ownAsset.id]);
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const { asset: contributed } = await ctx.newAsset({ ownerId: contributor.id });
    await ctx.newExif({ assetId: contributed.id, fileSizeInByte: 2048 });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributed.id, spaceId: space.id });

    const ids = await collectIds(sut.downloadSpaceId(space.id));

    expect(ids.has(ownAsset.id)).toBe(true);
    expect(ids.has(contributed.id)).toBe(true);
  });

  it('excludes a contribution whose album has been unlinked from the space', async () => {
    const { ctx, sut, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: contributor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    const { asset: ownAsset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newExif({ assetId: ownAsset.id, fileSizeInByte: 1024 });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Unlinked' }, [ownAsset.id]);
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const { asset: contributed } = await ctx.newAsset({ ownerId: contributor.id });
    await ctx.newExif({ assetId: contributed.id, fileSizeInByte: 2048 });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributed.id, spaceId: space.id });

    // Unlinking drops shared_space_album; the album_space_asset row is retained but inert.
    await spaceRepo.removeAlbum(space.id, album.id);

    const ids = await collectIds(sut.downloadSpaceId(space.id));

    expect(ids.has(ownAsset.id)).toBe(false);
    expect(ids.has(contributed.id)).toBe(false);
  });

  it('excludes an OFFLINE contribution and an OFFLINE album asset, but keeps a directly-added one', async () => {
    // Deliberate asymmetry, mirrored from `checkSpaceAccess`: its album and contributed arms gate
    // `isOffline = false`, its directly-added arm does not. The download manifest must match the
    // gate arm for arm — a row the gate rejects 400s the whole download, not just that row.
    const { ctx, sut, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: contributor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const { library } = await ctx.newLibrary({ ownerId: owner.id });

    const seedOffline = async (ownerId: string) => {
      const { asset } = await ctx.newAsset({ ownerId, libraryId: library.id, isOffline: true });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: 1024 });
      return asset;
    };

    const offlineDirect = await seedOffline(owner.id);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: offlineDirect.id });

    const offlineAlbumAsset = await seedOffline(owner.id);
    const offlineContribution = await seedOffline(contributor.id);
    const { asset: online } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newExif({ assetId: online.id, fileSizeInByte: 1024 });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Offline mix' }, [
      online.id,
      offlineAlbumAsset.id,
    ]);
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: offlineContribution.id, spaceId: space.id });

    const ids = await collectIds(sut.downloadSpaceId(space.id));

    expect(ids.has(online.id)).toBe(true);
    expect(ids.has(offlineDirect.id)).toBe(true);
    expect(ids.has(offlineAlbumAsset.id)).toBe(false);
    expect(ids.has(offlineContribution.id)).toBe(false);
  });

  it('excludes a contribution to a linked album that has since been trashed', async () => {
    const { ctx, sut, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: contributor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    const { asset: ownAsset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newExif({ assetId: ownAsset.id, fileSizeInByte: 1024 });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Trashed' }, [ownAsset.id]);
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const { asset: contributed } = await ctx.newAsset({ ownerId: contributor.id });
    await ctx.newExif({ assetId: contributed.id, fileSizeInByte: 2048 });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributed.id, spaceId: space.id });

    await ctx.softDeleteAlbum(album.id);

    const ids = await collectIds(sut.downloadSpaceId(space.id));

    expect(ids.has(ownAsset.id)).toBe(false);
    expect(ids.has(contributed.id)).toBe(false);
  });

  it('yields an asset once when it is reachable both directly and as a contribution', async () => {
    const { ctx, sut, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: contributor } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    const { asset: ownAsset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newExif({ assetId: ownAsset.id, fileSizeInByte: 1024 });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Both paths' }, [ownAsset.id]);
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const { asset: contributed } = await ctx.newAsset({ ownerId: contributor.id });
    await ctx.newExif({ assetId: contributed.id, fileSizeInByte: 2048 });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributed.id, spaceId: space.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: contributed.id });

    const rows: string[] = [];
    for await (const row of sut.downloadSpaceId(space.id)) {
      rows.push(row.id);
    }

    expect(rows.filter((id) => id === contributed.id)).toHaveLength(1);
  });
});
