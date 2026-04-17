import { Kysely } from 'kysely';
import { AlbumRepository } from 'src/repositories/album.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { asDateString } from 'src/utils/date';
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

      // startDate / endDate must be coercible by asDateString. Postgres timestamp
      // returns Date | string depending on Kysely driver config; asDateString handles both.
      expect(() => asDateString(rows[0].startDate ?? undefined)).not.toThrow();
      expect(() => asDateString(rows[0].endDate ?? undefined)).not.toThrow();
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
});
