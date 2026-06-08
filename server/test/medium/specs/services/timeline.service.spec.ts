import { BadRequestException } from '@nestjs/common';
import { Insertable, Kysely } from 'kysely';
import { AssetOrder, AssetType, AssetVisibility, SharedLinkType, TimeBucketSize } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository';
import { DB } from 'src/schema';
import { AssetTable } from 'src/schema/tables/asset.table';
import { TimelineService } from 'src/services/timeline.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(TimelineService, {
    database: db || defaultDatabase,
    real: [AssetRepository, AccessRepository, PartnerRepository],
    mock: [LoggingRepository],
  });
};

const createTimelineAsset = async (
  ctx: ReturnType<typeof setup>['ctx'],
  ownerId: string,
  localDateTime: Date,
  options: Partial<Insertable<AssetTable>> = {},
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    fileCreatedAt: localDateTime,
    localDateTime,
    width: 400,
    height: 200,
    thumbhash: Buffer.from('thumbhash'),
    ...options,
  });
  await ctx.newExif({ assetId: asset.id, make: 'Canon', timeZone: 'UTC' });
  return asset;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(TimelineService.name, () => {
  describe('getTimeBuckets', () => {
    it('should get time buckets by month', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      const dates = [new Date('1970-01-01'), new Date('1970-02-10'), new Date('1970-02-11'), new Date('1970-02-11')];
      for (const localDateTime of dates) {
        const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime });
        await ctx.newExif({ assetId: asset.id, make: 'Canon' });
      }

      const response = sut.getTimeBuckets(auth, {});
      await expect(response).resolves.toEqual([
        expect.objectContaining({ count: 3, timeBucket: '1970-02-01' }),
        expect.objectContaining({ count: 1, timeBucket: '1970-01-01' }),
      ]);
    });

    it('groups time buckets by requested year, month, and day granularity', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });

      await createTimelineAsset(ctx, user.id, new Date('2023-12-31T23:59:59.000Z'));
      await createTimelineAsset(ctx, user.id, new Date('2024-01-01T00:00:00.000Z'));
      await createTimelineAsset(ctx, user.id, new Date('2024-01-31T23:59:59.000Z'));
      await createTimelineAsset(ctx, user.id, new Date('2024-02-01T00:00:00.000Z'));
      await createTimelineAsset(ctx, user.id, new Date('2024-02-29T12:00:00.000Z'));

      await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Year })).resolves.toEqual([
        expect.objectContaining({ timeBucket: '2024-01-01', count: 4 }),
        expect.objectContaining({ timeBucket: '2023-01-01', count: 1 }),
      ]);

      await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Month })).resolves.toEqual([
        expect.objectContaining({ timeBucket: '2024-02-01', count: 2 }),
        expect.objectContaining({ timeBucket: '2024-01-01', count: 2 }),
        expect.objectContaining({ timeBucket: '2023-12-01', count: 1 }),
      ]);

      await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Day })).resolves.toEqual([
        expect.objectContaining({ timeBucket: '2024-02-29', count: 1 }),
        expect.objectContaining({ timeBucket: '2024-02-01', count: 1 }),
        expect.objectContaining({ timeBucket: '2024-01-31', count: 1 }),
        expect.objectContaining({ timeBucket: '2024-01-01', count: 1 }),
        expect.objectContaining({ timeBucket: '2023-12-31', count: 1 }),
      ]);
    });

    it('returns only timeBucket and count — no representative fields', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });

      await createTimelineAsset(ctx, user.id, new Date('2024-01-01T12:00:00.000Z'), {
        thumbhash: Buffer.from('older-thumbhash'),
        width: 100,
        height: 50,
      });
      await createTimelineAsset(ctx, user.id, new Date('2024-01-02T12:00:00.000Z'), {
        thumbhash: Buffer.from('newer-thumbhash'),
        width: 300,
        height: 100,
      });

      const result = await sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Month });
      expect(result).toEqual([expect.objectContaining({ timeBucket: '2024-01-01', count: 2 })]);
      expect(result[0]).not.toHaveProperty('representativeAssetId');
      expect(result[0]).not.toHaveProperty('representativeThumbhash');
      expect(result[0]).not.toHaveProperty('representativeRatio');
    });

    it('count-only result is stable regardless of order option', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });

      await createTimelineAsset(ctx, user.id, new Date('2024-01-01T12:00:00.000Z'));
      await createTimelineAsset(ctx, user.id, new Date('2024-01-02T12:00:00.000Z'));

      await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Month })).resolves.toEqual([
        expect.objectContaining({ timeBucket: '2024-01-01', count: 2 }),
      ]);
      await expect(
        sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Month, order: AssetOrder.Asc }),
      ).resolves.toEqual([expect.objectContaining({ timeBucket: '2024-01-01', count: 2 })]);
    });

    it('filters correctly reduce bucket counts', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });

      await createTimelineAsset(ctx, user.id, new Date('2024-04-02T12:00:00.000Z'), {
        isFavorite: true,
      });
      await createTimelineAsset(ctx, user.id, new Date('2024-04-03T12:00:00.000Z'), {
        isFavorite: false,
      });

      await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Month, isFavorite: true })).resolves.toEqual([
        expect.objectContaining({ count: 1 }),
      ]);
    });

    it('EXIF and rating filters reduce bucket counts', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });

      await createTimelineAsset(ctx, user.id, new Date('2024-04-02T12:00:00.000Z'));
      const matching = await createTimelineAsset(ctx, user.id, new Date('2024-04-02T12:00:00.000Z'));
      await ctx.newExif({
        assetId: matching.id,
        city: 'Berlin',
        country: 'Germany',
        make: 'Canon',
        model: 'R5',
        rating: 5,
      });

      const decoy = await createTimelineAsset(ctx, user.id, new Date('2024-04-03T12:00:00.000Z'));
      await ctx.newExif({ assetId: decoy.id, city: 'Paris', country: 'France', make: 'Nikon', model: 'Z6', rating: 2 });

      await expect(
        sut.getTimeBuckets(auth, {
          bucketSize: TimeBucketSize.Year,
          city: 'Berlin',
          country: 'Germany',
          make: 'Canon',
          model: 'R5',
          rating: 5,
        }),
      ).resolves.toEqual([expect.objectContaining({ count: 1 })]);
    });

    it('returns an empty list when filters match no assets', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });

      await createTimelineAsset(ctx, user.id, new Date('2024-05-01T12:00:00.000Z'), { isFavorite: false });

      await expect(sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Year, isFavorite: true })).resolves.toEqual(
        [],
      );
    });

    it('video-type filter reduces bucket count correctly', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });

      await createTimelineAsset(ctx, user.id, new Date('2024-06-01T12:00:00.000Z'), {
        type: AssetType.Video,
        originalPath: '/path/to/video.mp4',
      });

      await expect(
        sut.getTimeBuckets(auth, { bucketSize: TimeBucketSize.Month, type: AssetType.Video }),
      ).resolves.toEqual([expect.objectContaining({ count: 1 })]);
    });

    it.each([TimeBucketSize.Year, TimeBucketSize.Month, TimeBucketSize.Day])(
      'should return error for %s time buckets with partners asset and archived',
      async (bucketSize) => {
        const { sut } = setup();
        const auth = factory.auth();
        const response1 = sut.getTimeBuckets(auth, {
          bucketSize,
          withPartners: true,
          visibility: AssetVisibility.Archive,
        });
        await expect(response1).rejects.toBeInstanceOf(BadRequestException);
        await expect(response1).rejects.toThrow(
          'withPartners is only supported for non-archived, non-trashed, non-favorited, non-locked assets',
        );

        const response2 = sut.getTimeBuckets(auth, { bucketSize, withPartners: true });
        await expect(response2).rejects.toBeInstanceOf(BadRequestException);
        await expect(response2).rejects.toThrow(
          'withPartners is only supported for non-archived, non-trashed, non-favorited, non-locked assets',
        );
      },
    );

    it('should return error if time bucket is requested with partners asset and favorite', async () => {
      const { sut } = setup();
      const auth = factory.auth();
      const response1 = sut.getTimeBuckets(auth, { withPartners: true, isFavorite: false });
      await expect(response1).rejects.toBeInstanceOf(BadRequestException);
      await expect(response1).rejects.toThrow(
        'withPartners is only supported for non-archived, non-trashed, non-favorited, non-locked assets',
      );

      const response2 = sut.getTimeBuckets(auth, { withPartners: true, isFavorite: true });
      await expect(response2).rejects.toBeInstanceOf(BadRequestException);
      await expect(response2).rejects.toThrow(
        'withPartners is only supported for non-archived, non-trashed, non-favorited, non-locked assets',
      );
    });

    it.each([TimeBucketSize.Year, TimeBucketSize.Month, TimeBucketSize.Day])(
      'should return error for %s time buckets with partners asset and trash',
      async (bucketSize) => {
        const { sut } = setup();
        const auth = factory.auth();
        const response = sut.getTimeBuckets(auth, { bucketSize, withPartners: true, isTrashed: true });
        await expect(response).rejects.toBeInstanceOf(BadRequestException);
        await expect(response).rejects.toThrow(
          'withPartners is only supported for non-archived, non-trashed, non-favorited, non-locked assets',
        );
      },
    );

    it('should return error if time bucket is requested with locked visibility for partner', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();
      await ctx.newPartner({ sharedById: partner.id, sharedWithId: user.id });

      const auth = factory.auth({ user, session: { hasElevatedPermission: true } });

      const response = sut.getTimeBuckets(auth, { userId: partner.id, visibility: AssetVisibility.Locked });
      await expect(response).rejects.toThrow("You may not access another user's locked timeline");
    });

    it('should not allow access for unrelated shared links', async () => {
      const { sut } = setup();
      const auth = factory.auth({ sharedLink: {} });
      const response = sut.getTimeBuckets(auth, {});
      await expect(response).rejects.toBeInstanceOf(BadRequestException);
      await expect(response).rejects.toThrow('Not found or no timeline.read access');
    });
  });

  describe('getTimeBucket', () => {
    it('returns assets only inside the requested bucket granularity', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });

      const jan1 = await createTimelineAsset(ctx, user.id, new Date('2024-01-01T00:00:00.000Z'));
      const jan31 = await createTimelineAsset(ctx, user.id, new Date('2024-01-31T23:59:59.000Z'));
      const feb1 = await createTimelineAsset(ctx, user.id, new Date('2024-02-01T00:00:00.000Z'));

      const year = JSON.parse(
        await sut.getTimeBucket(auth, { bucketSize: TimeBucketSize.Year, timeBucket: '2024-01-01' }),
      );
      expect(year.id).toEqual([feb1.id, jan31.id, jan1.id]);

      const month = JSON.parse(
        await sut.getTimeBucket(auth, { bucketSize: TimeBucketSize.Month, timeBucket: '2024-01-01' }),
      );
      expect(month.id).toEqual([jan31.id, jan1.id]);

      const day = JSON.parse(
        await sut.getTimeBucket(auth, { bucketSize: TimeBucketSize.Day, timeBucket: '2024-01-01' }),
      );
      expect(day.id).toEqual([jan1.id]);
    });

    it('should return time bucket', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({
        ownerId: user.id,
        localDateTime: new Date('1970-02-12'),
        deletedAt: new Date(),
      });
      await ctx.newExif({ assetId: asset.id, make: 'Canon' });
      const auth = factory.auth({ user: { id: user.id } });
      const rawResponse = await sut.getTimeBucket(auth, { timeBucket: '1970-02-01', isTrashed: true });
      const response = JSON.parse(rawResponse);
      expect(response).toEqual(expect.objectContaining({ isTrashed: [true] }));
    });

    it('should handle a bucket without any assets', async () => {
      const { sut } = setup();
      const rawResponse = await sut.getTimeBucket(factory.auth(), { timeBucket: '1970-02-01' });
      const response = JSON.parse(rawResponse);
      expect(response).toEqual({
        city: [],
        country: [],
        createdAt: [],
        duration: [],
        id: [],
        visibility: [],
        isFavorite: [],
        isImage: [],
        isTrashed: [],
        livePhotoVideoId: [],
        fileCreatedAt: [],
        localOffsetHours: [],
        ownerId: [],
        projectionType: [],
        ratio: [],
        status: [],
        thumbhash: [],
      });
    });

    it('should handle 5 digit years', async () => {
      const { sut } = setup();
      const rawResponse = await sut.getTimeBucket(factory.auth(), { timeBucket: '012345-01-01' });
      const response = JSON.parse(rawResponse);
      expect(response).toEqual(expect.objectContaining({ id: [] }));
    });

    it('should return time bucket in trash', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({
        ownerId: user.id,
        localDateTime: new Date('1970-02-12'),
        deletedAt: new Date(),
      });
      await ctx.newExif({ assetId: asset.id, make: 'Canon' });
      const auth = factory.auth({ user: { id: user.id } });
      const rawResponse = await sut.getTimeBucket(auth, { timeBucket: '1970-02-01', isTrashed: true });
      const response = JSON.parse(rawResponse);
      expect(response).toEqual(expect.objectContaining({ isTrashed: [true] }));
    });

    it('should return false for favorite status unless asset owner', async () => {
      const { sut, ctx } = setup();
      const [{ asset: asset1 }, { asset: asset2 }] = await Promise.all([
        ctx.newUser().then(async ({ user }) => {
          const result = await ctx.newAsset({
            ownerId: user.id,
            fileCreatedAt: new Date('1970-02-12'),
            localDateTime: new Date('1970-02-12'),
            isFavorite: true,
          });
          await ctx.newExif({ assetId: result.asset.id, make: 'Canon' });
          return result;
        }),

        ctx.newUser().then(async ({ user }) => {
          const result = await ctx.newAsset({
            ownerId: user.id,
            fileCreatedAt: new Date('1970-02-13'),
            localDateTime: new Date('1970-02-13'),
            isFavorite: true,
          });
          await ctx.newExif({ assetId: result.asset.id, make: 'Canon' });
          return result;
        }),
      ]);

      await Promise.all([
        ctx.newPartner({ sharedById: asset1.ownerId, sharedWithId: asset2.ownerId }),
        ctx.newPartner({ sharedById: asset2.ownerId, sharedWithId: asset1.ownerId }),
      ]);

      const auth1 = factory.auth({ user: { id: asset1.ownerId } });
      const rawResponse1 = await sut.getTimeBucket(auth1, {
        timeBucket: '1970-02-01',
        withPartners: true,
        visibility: AssetVisibility.Timeline,
      });
      const response1 = JSON.parse(rawResponse1);
      expect(response1).toEqual(expect.objectContaining({ id: [asset2.id, asset1.id], isFavorite: [false, true] }));

      const auth2 = factory.auth({ user: { id: asset2.ownerId } });
      const rawResponse2 = await sut.getTimeBucket(auth2, {
        timeBucket: '1970-02-01',
        withPartners: true,
        visibility: AssetVisibility.Timeline,
      });
      const response2 = JSON.parse(rawResponse2);
      expect(response2).toEqual(expect.objectContaining({ id: [asset2.id, asset1.id], isFavorite: [true, false] }));
    });
  });

  it('should strip geodata metadata if shared link without exif', async () => {
    const { sut, ctx } = setup();
    const sharedLinkRepo = ctx.get(SharedLinkRepository);

    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({
      ownerId: user.id,
      localDateTime: new Date('1970-02-12'),
      deletedAt: new Date(),
    });
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const { id: sharedLinkId } = await sharedLinkRepo.create({
      allowUpload: false,
      key: Buffer.from('123'),
      type: SharedLinkType.Album,
      userId: user.id,
      albumId: album.id,
    });

    await ctx.newExif({ assetId: asset.id, city: 'Austin', country: 'USA' });
    const auth = factory.auth({ sharedLink: { id: sharedLinkId, showExif: false } });
    const rawResponse = await sut.getTimeBucket(auth, { albumId: album.id, timeBucket: '1970-02-01', isTrashed: true });
    const response = JSON.parse(rawResponse);
    expect(response).not.toEqual(expect.objectContaining({ city: expect.any(Array), country: expect.any(Array) }));
  });
});
