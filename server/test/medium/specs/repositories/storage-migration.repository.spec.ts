import { Kysely } from 'kysely';
import { AssetFileType } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { StorageMigrationRepository } from 'src/repositories/storage-migration.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Every test in this file asserts absolute counts (totals, exact rows), so each gets its own
// isolated database rather than sharing one across the file — there is no `defaultDatabase`
// fallback to keep in sync.
const setup = (db: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(StorageMigrationRepository) };
};

// Seeds a fixture with a disk-resident and an S3-resident row for every kind the router
// exposes (originals, sidecars, thumbnails/previews/fullsize, encoded video, person
// thumbnails, profile images), plus an external-library asset with its own sidecar and
// thumbnail to exercise the exclusion. Returns the totals `getRoutingCounts` must sum to.
const seedMixedFixture = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user } = await ctx.newUser();
  await ctx.newUser({ profileImagePath: '/data/profile/u2.jpeg' });
  await ctx.newUser({ profileImagePath: 'profile/u3.jpeg' });
  const { library } = await ctx.newLibrary({ ownerId: user.id });

  const { asset: a1 } = await ctx.newAsset({ ownerId: user.id, originalPath: '/data/library/u1/a1.jpg' });
  const { asset: a2 } = await ctx.newAsset({ ownerId: user.id, originalPath: '/data/library/u1/a2.jpg' });
  const { asset: a3 } = await ctx.newAsset({ ownerId: user.id, originalPath: 'originals/u1/a3.jpg' });
  const { asset: a4 } = await ctx.newAsset({ ownerId: user.id, originalPath: 'originals/u1/a4.jpg' });
  const { asset: aExt } = await ctx.newAsset({
    ownerId: user.id,
    libraryId: library.id,
    originalPath: '/mnt/nas/photos/ext.jpg',
  });

  // Sidecars: two owned (disk + s3), one on the external asset (must be excluded).
  await ctx.newAssetFile({ assetId: a1.id, type: AssetFileType.Sidecar, path: '/data/library/u1/a1.jpg.xmp' });
  await ctx.newAssetFile({ assetId: a3.id, type: AssetFileType.Sidecar, path: 'originals/u1/a3.jpg.xmp' });
  await ctx.newAssetFile({ assetId: aExt.id, type: AssetFileType.Sidecar, path: '/mnt/nas/photos/ext.jpg.xmp' });

  // Thumbnails/previews/fullsize: spread across disk and s3, including one on the external
  // asset that must NOT be excluded (only its sidecar is).
  await ctx.newAssetFile({ assetId: a1.id, type: AssetFileType.Thumbnail, path: '/data/thumbs/u1/a1_thumbnail.webp' });
  await ctx.newAssetFile({ assetId: a2.id, type: AssetFileType.Preview, path: '/data/thumbs/u1/a2_preview.jpeg' });
  await ctx.newAssetFile({ assetId: a3.id, type: AssetFileType.Thumbnail, path: 'thumbs/u1/a3_thumbnail.webp' });
  await ctx.newAssetFile({ assetId: a4.id, type: AssetFileType.FullSize, path: 'thumbs/u1/a4_fullsize.jpeg' });
  await ctx.newAssetFile({
    assetId: aExt.id,
    type: AssetFileType.Thumbnail,
    path: '/data/thumbs/u1/ext_thumbnail.webp',
  });

  // Encoded video: disk + s3, including one on the external asset (also not excluded).
  await ctx.newAssetFile({ assetId: a1.id, type: AssetFileType.EncodedVideo, path: '/data/encoded-video/u1/a1.mp4' });
  await ctx.newAssetFile({ assetId: a2.id, type: AssetFileType.EncodedVideo, path: 'encoded-video/u1/a2.mp4' });
  await ctx.newAssetFile({
    assetId: aExt.id,
    type: AssetFileType.EncodedVideo,
    path: '/data/encoded-video/u1/ext.mp4',
  });

  // Person thumbnails: disk, s3, and an empty path that must be excluded.
  await ctx.newPerson({ ownerId: user.id, thumbnailPath: '/data/thumbs/u1/p1.jpeg' });
  await ctx.newPerson({ ownerId: user.id, thumbnailPath: 'thumbs/u1/p2.jpeg' });
  await ctx.newPerson({ ownerId: user.id, thumbnailPath: '' });

  return {
    // 4 owned originals (2 disk + 2 s3) + 2 owned sidecars (1 disk + 1 s3); the external
    // asset and its sidecar are excluded entirely.
    originalsTotal: 6,
    // 3 disk (a1 thumbnail, a2 preview, external thumbnail) + 2 s3 (a3 thumbnail, a4
    // fullsize) asset_file rows, + 1 disk/1 s3 person thumbnail, + 1 disk/1 s3 profile image.
    thumbnailsTotal: 9,
    // 2 disk (a1, external) + 1 s3 (a2).
    encodedVideoTotal: 3,
  };
};

describe(StorageMigrationRepository.name, () => {
  describe('external library exclusion', () => {
    it('should not stream external-library originals', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      const { library } = await ctx.newLibrary({ ownerId: user.id });

      await ctx.newAsset({ ownerId: user.id, originalPath: '/data/library/u/a.jpg' });
      await ctx.newAsset({ ownerId: user.id, libraryId: library.id, originalPath: '/mnt/nas/photos/b.jpg' });

      const rows = await Array.fromAsync(sut.streamOriginals('toS3'));

      expect(rows.map((r) => r.originalPath)).toEqual(['/data/library/u/a.jpg']);
    });

    it('should not stream external-library sidecars but should stream their thumbnails', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      const { library } = await ctx.newLibrary({ ownerId: user.id });
      const { asset } = await ctx.newAsset({
        ownerId: user.id,
        libraryId: library.id,
        originalPath: '/mnt/nas/photos/b.jpg',
      });

      await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Sidecar, path: '/mnt/nas/photos/b.jpg.xmp' });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Thumbnail,
        path: '/data/thumbs/u/b_thumbnail.webp',
      });

      const rows = await Array.fromAsync(
        sut.streamAssetFiles('toS3', [AssetFileType.Sidecar, AssetFileType.Thumbnail]),
      );

      expect(rows.map((r) => r.type)).toEqual([AssetFileType.Thumbnail]);
    });
  });

  describe('getRoutingCounts', () => {
    it('should return zero for every kind on an empty library', async () => {
      const { sut } = setup(await getKyselyDB());

      await expect(sut.getRoutingCounts()).resolves.toEqual({
        originals: { disk: 0, s3: 0 },
        thumbnails: { disk: 0, s3: 0 },
        encodedVideo: { disk: 0, s3: 0 },
      });
    });

    it('should exclude empty person thumbnail and profile image paths', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser({ profileImagePath: '' });
      await ctx.newPerson({ ownerId: user.id, thumbnailPath: '' });

      const counts = await sut.getRoutingCounts();

      expect(counts.thumbnails).toEqual({ disk: 0, s3: 0 });
    });

    it('should have disk and s3 counts that sum to the total for every kind', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { originalsTotal, thumbnailsTotal, encodedVideoTotal } = await seedMixedFixture(ctx);

      const counts = await sut.getRoutingCounts();

      expect(counts.originals.disk + counts.originals.s3).toBe(originalsTotal);
      expect(counts.thumbnails.disk + counts.thumbnails.s3).toBe(thumbnailsTotal);
      expect(counts.encodedVideo.disk + counts.encodedVideo.s3).toBe(encodedVideoTotal);
    });

    it('should agree with the streams for every kind and direction', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      await seedMixedFixture(ctx);

      for (const direction of ['toS3', 'toDisk'] as const) {
        const streamed = { originals: 0, thumbnails: 0, encodedVideo: 0 };

        for await (const _ of sut.streamOriginals(direction)) {
          streamed.originals++;
        }
        for await (const _ of sut.streamAssetFiles(direction, [AssetFileType.Sidecar])) {
          streamed.originals++;
        }
        for await (const _ of sut.streamAssetFiles(direction, [
          AssetFileType.Thumbnail,
          AssetFileType.Preview,
          AssetFileType.FullSize,
        ])) {
          streamed.thumbnails++;
        }
        for await (const _ of sut.streamEncodedVideos(direction)) {
          streamed.encodedVideo++;
        }
        for await (const _ of sut.streamPersonThumbnails(direction)) {
          streamed.thumbnails++;
        }
        for await (const _ of sut.streamProfileImages(direction)) {
          streamed.thumbnails++;
        }

        const counts = await sut.getRoutingCounts();
        const side = direction === 'toS3' ? 'disk' : 's3';
        expect(streamed.originals).toBe(counts.originals[side]);
        expect(streamed.thumbnails).toBe(counts.thumbnails[side]);
        expect(streamed.encodedVideo).toBe(counts.encodedVideo[side]);
      }
    });
  });

  describe('getOriginalsSizeEstimate', () => {
    it('should exclude external-library originals from the estimate', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      const { library } = await ctx.newLibrary({ ownerId: user.id });

      const { asset: owned } = await ctx.newAsset({ ownerId: user.id, originalPath: '/data/library/u/owned.jpg' });
      await ctx.newExif({ assetId: owned.id, fileSizeInByte: 1000 });

      // Same disk-resident shape as the owned asset — if the exclusion were missing, this
      // would still match the 'toS3' direction filter and inflate the estimate.
      const { asset: external } = await ctx.newAsset({
        ownerId: user.id,
        libraryId: library.id,
        originalPath: '/mnt/nas/photos/external.jpg',
      });
      await ctx.newExif({ assetId: external.id, fileSizeInByte: 5000 });

      await expect(sut.getOriginalsSizeEstimate('toS3')).resolves.toBe(1000);
    });
  });
});
