import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum';
import { AlbumRepository } from 'src/repositories/album.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { asDateTimeString } from 'src/utils/date';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { vi } from 'vitest';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(AlbumRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(AlbumRepository.name, () => {
  describe('getOwnedNames', () => {
    it('returns lightweight projection of owned albums', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const { album } = await ctx.newAlbum({
        ownerId: owner.id,
        albumName: 'Hawaii 2024',
        albumThumbnailAssetId: asset.id,
      });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const rows = await sut.getOwnedNames(owner.id);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: album.id,
        albumName: 'Hawaii 2024',
        albumThumbnailAssetId: expect.any(String),
        assetCount: 1,
      });

      // startDate / endDate must be coercible by asDateTimeString. Postgres timestamp
      // returns Date | string depending on Kysely driver config; asDateTimeString handles both.
      expect(() => asDateTimeString(rows[0].startDate ?? undefined)).not.toThrow();
      expect(() => asDateTimeString(rows[0].endDate ?? undefined)).not.toThrow();
    });

    it('does not call updateThumbnails', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const spy = vi.spyOn(sut, 'updateThumbnails');

      await sut.getOwnedNames(owner.id);

      expect(spy).not.toHaveBeenCalled();
    });

    it('returns empty-album with assetCount=0 and null date range', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      await ctx.newAlbum({ ownerId: owner.id, albumName: 'Empty' });

      const rows = await sut.getOwnedNames(owner.id);

      expect(rows).toHaveLength(1);
      expect(rows[0].assetCount).toBe(0);
      expect(rows[0].startDate).toBeNull();
      expect(rows[0].endDate).toBeNull();
    });
  });

  describe('getSharedNames', () => {
    it('returns lightweight projection of albums shared with the user', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Shared Trip' });
      await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id });

      const rows = await sut.getSharedNames(viewer.id);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: album.id,
        albumName: 'Shared Trip',
      });
      // Note: `shared: true` is NOT asserted at the repo layer — service (Task 3)
      // hardcodes it based on which repo method produced the record.
    });

    it('includes albums owned-and-shared-out (dedup is downstream responsibility)', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: buddy } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Beach' });
      await ctx.newAlbumUser({ albumId: album.id, userId: buddy.id });

      // Owner's "shared" query returns the album too (they share it out)
      const ownerShared = await sut.getSharedNames(owner.id);
      expect(ownerShared.map((r) => r.id)).toContain(album.id);
    });
  });

  // L1: getContributorCounts previously counted every non-deleted asset regardless of visibility,
  // letting a caller infer a contributor's Hidden/Locked asset count from the per-user totals even
  // though the service layer (album.service.get) now gates the whole field to direct readers. Close
  // the leak in the repo itself so no future caller re-opens it.
  describe('getContributorCounts', () => {
    it('excludes a contributor Hidden/Locked assets from their count (L1)', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: contributor } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ContributorCounts' });

      const { asset: timelineAsset } = await ctx.newAsset({
        ownerId: contributor.id,
        visibility: AssetVisibility.Timeline,
      });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: timelineAsset.id });

      const { asset: hiddenAsset } = await ctx.newAsset({
        ownerId: contributor.id,
        visibility: AssetVisibility.Hidden,
      });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: hiddenAsset.id });

      const { asset: lockedAsset } = await ctx.newAsset({
        ownerId: contributor.id,
        visibility: AssetVisibility.Locked,
      });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: lockedAsset.id });

      const rows = await sut.getContributorCounts(album.id);

      const contributorRow = rows.find((row) => row.userId === contributor.id);
      // Only the Timeline asset counts — Hidden/Locked must not inflate (or reveal) the total.
      expect(contributorRow?.assetCount).toBe(1);
    });

    it('includes a contributor Timeline and Archive assets in their count (positive control)', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: contributor } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'ContributorCounts2' });

      const { asset: timelineAsset } = await ctx.newAsset({
        ownerId: contributor.id,
        visibility: AssetVisibility.Timeline,
      });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: timelineAsset.id });

      const { asset: archiveAsset } = await ctx.newAsset({
        ownerId: contributor.id,
        visibility: AssetVisibility.Archive,
      });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: archiveAsset.id });

      const rows = await sut.getContributorCounts(album.id);

      const contributorRow = rows.find((row) => row.userId === contributor.id);
      expect(contributorRow?.assetCount).toBe(2);
    });
  });

  describe('getByAssetId', () => {
    it('returns an album the user is shared into directly', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const { album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Shared Album' });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id });

      const rows = await sut.getByAssetId(viewer.id, asset.id);

      expect(rows.map((row) => row.id)).toEqual([album.id]);
    });

    it('returns an album linked into a shared space the user is a member of', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const { album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Space Linked Album' });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

      const rows = await sut.getByAssetId(viewer.id, asset.id);

      expect(rows.map((row) => row.id)).toEqual([album.id]);
    });

    it('does not return an album the user has no access path to', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: stranger } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const { album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Private Album' });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const rows = await sut.getByAssetId(stranger.id, asset.id);

      expect(rows).toEqual([]);
    });

    it('does not return an album linked only to a space the user is not in', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: outsider } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const { album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Other Space Album' });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      // The album is linked into space A; the outsider is a member of unrelated space B.
      const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceAlbum({ spaceId: spaceA.id, albumId: album.id });
      const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: outsider.id });

      const rows = await sut.getByAssetId(outsider.id, asset.id);

      expect(rows).toEqual([]);
    });

    it('stops returning a space-linked album once the album is unlinked from the space', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const { album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Unlinked Album' });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

      expect(await sut.getByAssetId(viewer.id, asset.id)).toHaveLength(1);

      await ctx.database.deleteFrom('shared_space_album').where('albumId', '=', album.id).execute();

      expect(await sut.getByAssetId(viewer.id, asset.id)).toEqual([]);
    });

    it('stops returning a space-linked album once the user leaves the space', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const { album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Departed Album' });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

      expect(await sut.getByAssetId(viewer.id, asset.id)).toHaveLength(1);

      await ctx.database.deleteFrom('shared_space_member').where('userId', '=', viewer.id).execute();

      expect(await sut.getByAssetId(viewer.id, asset.id)).toEqual([]);
    });

    it('does not reveal a space-linked album for another member Hidden asset', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
      const { album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Album With Hidden Asset' });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

      const rows = await sut.getByAssetId(viewer.id, asset.id);

      expect(rows).toEqual([]);
    });

    it('does not reveal a space-linked album for another member Locked asset', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
      const { album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Album With Locked Asset' });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

      const rows = await sut.getByAssetId(viewer.id, asset.id);

      expect(rows).toEqual([]);
    });

    it('still shows the owner their own Hidden asset album membership', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
      const { album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'My Hidden Asset Album' });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      // newAlbum already creates the owner's album_user row — the owner reaches this album through
      // the album_user arm, which is why gating the SPACE arm on visibility cannot regress them.

      const rows = await sut.getByAssetId(owner.id, asset.id);

      expect(rows.map((row) => row.id)).toEqual([album.id]);
    });

    // Known incompleteness, pinned so it stays visible: a cross-owner contribution (#764) lives in
    // album_space_asset, not album_asset, and this query inner-joins album_asset. A contributor
    // therefore sees no "Contained in" for their own contributed asset. This under-reports rather
    // than over-reports, so it is not a disclosure — but it is a gap worth closing separately.
    it('does not yet surface a linked album for a cross-owner contributed asset', async () => {
      const { ctx, sut } = setup();
      const { user: albumOwner } = await ctx.newUser();
      const { user: contributor } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: contributor.id });
      const { album } = await ctx.newAlbum({ ownerId: albumOwner.id, albumName: 'Contribution Album' });

      const { space } = await ctx.newSharedSpace({ createdById: albumOwner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: contributor.id });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
      await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

      const rows = await sut.getByAssetId(contributor.id, asset.id);

      expect(rows).toEqual([]);
    });

    it('does not return a space-linked album that has been soft-deleted', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const { album } = await ctx.newAlbum({
        ownerId: owner.id,
        albumName: 'Deleted Album',
        deletedAt: new Date(),
      });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

      const rows = await sut.getByAssetId(viewer.id, asset.id);

      expect(rows).toEqual([]);
    });
  });
});
