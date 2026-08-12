import { BadRequestException } from '@nestjs/common';
import { Insertable, Kysely } from 'kysely';
import { AuthDto } from 'src/dtos/auth.dto';
import { TimeBucketDto } from 'src/dtos/time-bucket.dto';
import {
  AlbumUserRole,
  AssetOrder,
  AssetType,
  AssetVisibility,
  SharedLinkType,
  SharedSpaceRole,
  TimeBucketSize,
} from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { AssetTable } from 'src/schema/tables/asset.table';
import { TimelineService } from 'src/services/timeline.service';
import { newMediumService } from 'test/medium.factory';
import { createTwoOwnerSpace, SPACE_BUCKET, SPACE_DATE } from 'test/medium/fixtures/two-owner-space';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(TimelineService, {
    database: db || defaultDatabase,
    real: [AssetRepository, AccessRepository, PartnerRepository, SharedSpaceRepository],
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

// The two-owner Space fixture (anna + ben contribute, viewer + editor own nothing) lives in
// test/medium/fixtures/two-owner-space.ts: the SAME fixture pins the ownerId contract on the
// search/map builder (searchAssetBuilder) in search.service.spec.ts, which is a different query
// builder that has to enforce the same RBAC rules as withTimeBucketAssetFilters below.

/** Asset ids returned by the Space timeline for the given filter. */
const spaceBucketAssetIds = async (
  sut: ReturnType<typeof setup>['sut'],
  auth: AuthDto,
  spaceId: string,
  filter: Partial<TimeBucketDto>,
): Promise<string[]> => {
  const json = await sut.getTimeBucket(auth, { ...filter, spaceId, timeBucket: SPACE_BUCKET });
  const parsed = JSON.parse(json) as { id?: string[] };
  return parsed.id ?? [];
};

/**
 * An album on the viewer's PERSONAL timeline, holding a mix of owners (D3 fixture — see the
 * '/photos: albumId ANDs with userId' describe for what each asset is there to prove).
 */
const createPhotosAlbumFixture = async (ctx: ReturnType<typeof setup>['ctx']) => {
  // viewer is a member of the two-owner space (timeline-enabled) and owns nothing in it.
  const { viewer, annaAsset } = await createTwoOwnerSpace(ctx);
  const { user: carol } = await ctx.newUser(); // in NO space of the viewer's

  const myAsset = await createTimelineAsset(ctx, viewer.id, SPACE_DATE);
  const myFavoriteAsset = await createTimelineAsset(ctx, viewer.id, SPACE_DATE, { isFavorite: true });
  // Album-only assets of another user: the co-member contributions the D3 bug leaked.
  const carolAsset = await createTimelineAsset(ctx, carol.id, SPACE_DATE);
  const carolFavoriteAsset = await createTimelineAsset(ctx, carol.id, SPACE_DATE, { isFavorite: true });

  const { album } = await ctx.newAlbum({ ownerId: viewer.id }, [
    myAsset.id,
    myFavoriteAsset.id,
    carolAsset.id,
    carolFavoriteAsset.id,
    annaAsset.id,
  ]);

  return { viewer, album, myAsset, myFavoriteAsset, carolAsset, carolFavoriteAsset, annaAsset };
};

/** Asset ids returned for the exact shape /photos sends: personal scope + a time bucket. */
const photosBucketAssetIds = async (
  sut: ReturnType<typeof setup>['sut'],
  auth: AuthDto,
  dto: Partial<TimeBucketDto>,
): Promise<string[]> => {
  const json = await sut.getTimeBucket(auth, {
    visibility: AssetVisibility.Timeline,
    withStacked: true,
    ...dto,
    timeBucket: SPACE_BUCKET,
  });
  return (JSON.parse(json) as { id?: string[] }).id ?? [];
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
    // Not trashed: Slice 1 / H1 now flatly rejects isTrashed=true on any album/space browse
    // (including a shared link, which is a third party relative to the album owner) — this test's
    // intent is EXIF stripping, which doesn't require the trash path.
    const { asset } = await ctx.newAsset({
      ownerId: user.id,
      localDateTime: new Date('1970-02-12'),
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
    const rawResponse = await sut.getTimeBucket(auth, { albumId: album.id, timeBucket: '1970-02-01' });
    const response = JSON.parse(rawResponse);
    expect(response).not.toEqual(expect.objectContaining({ city: expect.any(Array), country: expect.any(Array) }));
  });

  // Slice 1 / H1: a shared link is a third party relative to the album owner — the same flat
  // isTrashed=true rejection that protects a space Viewer must also protect a shared-link holder.
  it('rejects isTrashed=true on an albumId browse via a shared link', async () => {
    const { sut, ctx } = setup();
    const sharedLinkRepo = ctx.get(SharedLinkRepository);

    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime: new Date('1970-02-12') });
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.softDeleteAsset(asset.id);

    const { id: sharedLinkId } = await sharedLinkRepo.create({
      allowUpload: false,
      key: Buffer.from('456'),
      type: SharedLinkType.Album,
      userId: user.id,
      albumId: album.id,
    });

    const auth = factory.auth({ sharedLink: { id: sharedLinkId, showExif: true } });

    await expect(
      sut.getTimeBucket(auth, { albumId: album.id, timeBucket: '1970-02-01', isTrashed: true }),
    ).rejects.toThrow(BadRequestException);
  });

  describe('contextual filters — lensModel / state (Slice 1)', () => {
    it('E17: a Space VIEWER filters by a lens model on an asset they do not own', async () => {
      const { sut, ctx } = setup();
      const { space, viewer, annaAsset } = await createTwoOwnerSpace(ctx);
      const auth = factory.auth({ user: viewer });

      const ids = await spaceBucketAssetIds(sut, auth, space.id, {
        lensModel: 'iPhone 17 Pro Max back triple camera',
      });

      // The viewer owns NOTHING in this space. Anna's asset must still come back.
      expect(ids).toEqual([annaAsset.id]);
    });

    it('E18: a Space EDITOR filters by a lens model on an asset they do not own', async () => {
      const { sut, ctx } = setup();
      const { space, editor, benAsset } = await createTwoOwnerSpace(ctx);
      const auth = factory.auth({ user: editor });

      const ids = await spaceBucketAssetIds(sut, auth, space.id, {
        lensModel: 'RF24-70mm F2.8 L IS USM',
      });

      expect(ids).toEqual([benAsset.id]);
    });

    it('E17: a Space VIEWER filters by state on an asset they do not own', async () => {
      const { sut, ctx } = setup();
      const { space, viewer, annaAsset } = await createTwoOwnerSpace(ctx);
      const auth = factory.auth({ user: viewer });

      const ids = await spaceBucketAssetIds(sut, auth, space.id, { state: 'State of Berlin' });

      expect(ids).toEqual([annaAsset.id]);
    });

    it('filters by lensModel are exact-match, not substring', async () => {
      const { sut, ctx } = setup();
      const { space, viewer } = await createTwoOwnerSpace(ctx);
      const auth = factory.auth({ user: viewer });

      const ids = await spaceBucketAssetIds(sut, auth, space.id, { lensModel: 'RF24-70mm' });

      expect(ids).toEqual([]);
    });

    it('lensModel and state compose with make as an AND', async () => {
      const { sut, ctx } = setup();
      const { space, viewer } = await createTwoOwnerSpace(ctx);
      const auth = factory.auth({ user: viewer });

      const ids = await spaceBucketAssetIds(sut, auth, space.id, {
        make: 'Canon',
        state: 'State of Berlin', // Anna's state, but Ben's make → no asset has both
      });

      expect(ids).toEqual([]);
    });

    it('E17: a Space VIEWER filters by a CAMERA MAKE on an asset they do not own', async () => {
      const { sut, ctx } = setup();
      const { space, viewer, annaAsset } = await createTwoOwnerSpace(ctx);
      const auth = factory.auth({ user: viewer });

      const ids = await spaceBucketAssetIds(sut, auth, space.id, {
        make: 'Apple',
        model: 'iPhone 17 Pro Max',
      });

      // Regression guard: passes today. If someone reintroduces an ownerId predicate into the
      // Space timeline scope, this flips to [] — issue #655.
      expect(ids).toEqual([annaAsset.id]);
    });
  });

  describe('contextual filters — ownerId (Slice 1)', () => {
    it('narrows a Space timeline to one contributor', async () => {
      const { sut, ctx } = setup();
      const { space, anna, viewer, annaAsset } = await createTwoOwnerSpace(ctx);
      const auth = factory.auth({ user: viewer });

      const ids = await spaceBucketAssetIds(sut, auth, space.id, { ownerId: anna.id });

      // Anna's contribution only — Ben's asset is excluded.
      expect(ids).toEqual([annaAsset.id]);
    });

    it('E20: ownerId of a non-member returns EMPTY inside a Space (narrows, never widens)', async () => {
      const { sut, ctx } = setup();
      const { space, viewer } = await createTwoOwnerSpace(ctx);
      const { user: carol } = await ctx.newUser(); // not a member of the space
      const auth = factory.auth({ user: viewer });

      const ids = await spaceBucketAssetIds(sut, auth, space.id, { ownerId: carol.id });

      expect(ids).toEqual([]);
    });

    it('E21: ownerId of a stranger on the personal timeline returns EMPTY (no leak)', async () => {
      const { sut, ctx } = setup();
      const { user: me } = await ctx.newUser();
      const { user: carol } = await ctx.newUser();

      // I MUST own an asset in the same bucket. Without this the assertion is vacuous:
      // an empty timeline returns [] whether or not the filter is applied at all, so the
      // test would pass on the RED run and prove nothing.
      const date = new Date('2026-01-15T10:00:00Z');
      const { asset: myAsset } = await ctx.newAsset({
        ownerId: me.id,
        fileCreatedAt: date,
        localDateTime: date,
      });
      await ctx.newExif({ assetId: myAsset.id, make: 'Apple', timeZone: 'UTC' });

      // Carol has an asset. It must never surface on my timeline.
      const { asset: carolAsset } = await ctx.newAsset({
        ownerId: carol.id,
        fileCreatedAt: date,
        localDateTime: date,
      });
      await ctx.newExif({ assetId: carolAsset.id, make: 'Apple', timeZone: 'UTC' });

      const auth = factory.auth({ user: me });

      // Baseline: my timeline is NOT empty. This is what makes the assertion below meaningful.
      const unfiltered = await sut.getTimeBuckets(auth, {});
      expect(unfiltered).not.toEqual([]);

      // timeBucketChecks defaults dto.userId to auth.user.id when no album/space scope is set
      // (timeline.service.ts:132), so the query is (ownerId = me) AND (ownerId = carol) = empty.
      const buckets = await sut.getTimeBuckets(auth, { ownerId: carol.id });
      expect(buckets).toEqual([]);
    });

    it('ownerId does NOT widen: it must not be OR-ed with the space predicate', async () => {
      const { sut, ctx } = setup();
      const { space, anna, viewer, annaAsset } = await createTwoOwnerSpace(ctx);
      const auth = factory.auth({ user: viewer });

      // Anna also owns an asset OUTSIDE the space, in the SAME bucket. Filtering the space by
      // owner=anna must not pull it in.
      const { asset: outsideAsset } = await ctx.newAsset({
        ownerId: anna.id,
        fileCreatedAt: SPACE_DATE,
        localDateTime: SPACE_DATE,
      });
      await ctx.newExif({ assetId: outsideAsset.id, timeZone: 'UTC' });

      const ids = await spaceBucketAssetIds(sut, auth, space.id, { ownerId: anna.id });

      expect(ids).toEqual([annaAsset.id]);
      expect(ids).not.toContain(outsideAsset.id);
    });

    /**
     * THE ACTUAL WIDENING VECTOR. The userIds/timelineSpaceIds OR-group at
     * asset.repository.ts:362-380 only fires when `timelineSpaceIds` is set, and that only
     * happens under `withSharedSpaces: true` (timeline.service.ts:81-86).
     *
     * Every other test in this file leaves timelineSpaceIds undefined, so the `:359` clause
     * already ANDs — meaning an implementer who WRONGLY merged ownerId into options.userIds
     * would still pass all of them. These two tests are the only thing standing between that
     * mistake and a data leak. Do not delete them.
     */
    it('E21b: ownerId of a stranger under withSharedSpaces returns EMPTY (the real leak vector)', async () => {
      const { sut, ctx } = setup();
      const { viewer } = await createTwoOwnerSpace(ctx);
      const { user: carol } = await ctx.newUser();

      // Carol is a stranger with an asset, outside every space the viewer can see.
      const { asset: carolAsset } = await ctx.newAsset({
        ownerId: carol.id,
        fileCreatedAt: SPACE_DATE,
        localDateTime: SPACE_DATE,
      });
      await ctx.newExif({ assetId: carolAsset.id, make: 'Apple', timeZone: 'UTC' });

      const auth = factory.auth({ user: viewer });

      // withSharedSpaces sets timelineSpaceIds, which activates the userIds OR-group.
      // If ownerId were routed through userIds, Carol's asset would be OR-ed in => LEAK.
      //
      // `visibility` is REQUIRED here: timeline.service.ts:158-168 throws BadRequestException
      // when withSharedSpaces is combined with an undefined visibility. Omit it and the test
      // fails for the wrong reason and can never go green.
      const json = await sut.getTimeBucket(auth, {
        withSharedSpaces: true,
        visibility: AssetVisibility.Timeline,
        ownerId: carol.id,
        timeBucket: SPACE_BUCKET,
      });
      const ids = (JSON.parse(json) as { id?: string[] }).id ?? [];

      expect(ids).toEqual([]);
      expect(ids).not.toContain(carolAsset.id);
    });

    it('E21c: ownerId under withSharedSpaces narrows to that member, not to everything', async () => {
      const { sut, ctx } = setup();
      const { anna, viewer, annaAsset, benAsset } = await createTwoOwnerSpace(ctx);
      const auth = factory.auth({ user: viewer });

      const json = await sut.getTimeBucket(auth, {
        withSharedSpaces: true,
        visibility: AssetVisibility.Timeline,
        ownerId: anna.id,
        timeBucket: SPACE_BUCKET,
      });
      const ids = (JSON.parse(json) as { id?: string[] }).id ?? [];

      expect(ids).toContain(annaAsset.id);
      expect(ids).not.toContain(benAsset.id);
    });
  });

  it("E22: an album viewer filters by the album owner's camera and sees their assets", async () => {
    const { sut, ctx } = setup();
    const { user: anna } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();

    const date = new Date('2026-01-15T10:00:00Z');
    const { asset } = await ctx.newAsset({ ownerId: anna.id, fileCreatedAt: date, localDateTime: date });
    await ctx.newExif({ assetId: asset.id, make: 'Apple', timeZone: 'UTC' });

    const { album } = await ctx.newAlbum({ ownerId: anna.id }, [asset.id]);
    await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer });

    const auth = factory.auth({ user: viewer });
    const json = await sut.getTimeBucket(auth, {
      albumId: album.id,
      make: 'Apple',
      timeBucket: SPACE_BUCKET,
    });

    expect((JSON.parse(json) as { id?: string[] }).id ?? []).toEqual([asset.id]);
  });

  /**
   * D3 — the album gate ANDs with the owner gate on the PERSONAL timeline.
   *
   * `timeBucketChecks` deliberately does NOT default `userId` under an `albumId` (that branch is
   * what E22 above depends on: on the ALBUM page, album ACCESS is the entire scope, and a viewer
   * must see the owner's assets). So the *caller* decides the scope, and /photos — which is my
   * personal timeline — must send `userId` alongside the album chip
   * (web/src/lib/utils/photos-filter-options.ts). The tests below pin what each shape means, so a
   * "fix" that defaults userId server-side (breaking E22) or a web regression that drops it (the
   * D3 bug: `?albumId=A&ownerId=<co-member>` listing a co-member's assets, and the Favorites chip
   * the album OWNER's favourites, on MY timeline) both get caught.
   *
   * THE FIXTURE TRAP: /photos also sends `withPartners` + `withSharedSpaces`, so `userIds` is not a
   * plain AND — asset.repository.ts makes the scope `ownerId IN userIds` **OR** "in one of my
   * timeline spaces". A co-member asset that ALSO lives in one of my timeline spaces therefore
   * stays visible, correctly. The asset that must drop out is the **album-only** one: owned by
   * someone else, in the album, in NO shared space of mine (`carolAsset` / `carolFavoriteAsset`).
   * `annaAsset` (in the album AND in my space) is asserted present in the same test to keep that
   * distinction honest — a fixture without it would pass an over-narrow implementation too.
   */
  describe('/photos: albumId ANDs with userId (D3)', () => {
    it("an album chip does not put a co-member's album-only asset on my personal timeline", async () => {
      const { sut, ctx } = setup();
      const { viewer, album, myAsset, carolAsset, annaAsset } = await createPhotosAlbumFixture(ctx);
      const auth = factory.auth({ user: viewer });

      const ids = await photosBucketAssetIds(sut, auth, {
        userId: viewer.id,
        albumId: album.id,
        withPartners: true,
        withSharedSpaces: true,
      });

      // Mine, in the album: present (non-vacuity — the query is not simply empty).
      expect(ids).toContain(myAsset.id);
      // Anna's, in the album AND in a space that IS in my timeline: present, and correctly so —
      // withSharedSpaces widens the owner scope to my timeline spaces.
      expect(ids).toContain(annaAsset.id);
      // Carol's, in the album but in NO space of mine: NOT on my personal timeline. This is D3.
      expect(ids).not.toContain(carolAsset.id);
    });

    it('the same album query WITHOUT userId returns it — the album-scoped branch E22 relies on', async () => {
      const { sut, ctx } = setup();
      const { viewer, album, carolAsset } = await createPhotosAlbumFixture(ctx);
      const auth = factory.auth({ user: viewer });

      // Exactly what /photos used to send. `userId` is the ONLY difference from the test above, so
      // this pins that the exclusion there is the owner gate doing its job — and that the
      // album-only scope (album ACCESS is the boundary) still exists for the album page.
      const ids = await photosBucketAssetIds(sut, auth, {
        albumId: album.id,
        withPartners: true,
        withSharedSpaces: true,
      });

      expect(ids).toContain(carolAsset.id);
    });

    it("the favorites chip returns MY favourites, not the album owner's", async () => {
      const { sut, ctx } = setup();
      const { viewer, album, myFavoriteAsset, carolFavoriteAsset } = await createPhotosAlbumFixture(ctx);
      const auth = factory.auth({ user: viewer });

      // `isFavorite` is the asset OWNER's flag, and /photos drops withPartners/withSharedSpaces for
      // a favourites query (the server 400s that combination anyway) — so here `userId` is the ONLY
      // thing standing between me and a co-member's favourites.
      const ids = await photosBucketAssetIds(sut, auth, {
        userId: viewer.id,
        albumId: album.id,
        isFavorite: true,
      });

      expect(ids).toEqual([myFavoriteAsset.id]);
      expect(ids).not.toContain(carolFavoriteAsset.id);
    });
  });

  /**
   * `spaceId` + `albumId` together: BOTH permissions must be checked.
   *
   * The check used to be an `else if` chain, so with both set only AlbumRead was verified while the
   * space predicate still applied to the query — letting a caller with album access learn WHICH of
   * that album's assets belong to a space they are not a member of (a membership oracle; no asset
   * leaks, since every returned asset is in an album they can read). The filtered map endpoint
   * refuses the same combination outright (shared-space.service.ts getFilteredMapMarkers), but the
   * timeline answers it — so it must at least enforce the space boundary it is querying.
   */
  describe('spaceId + albumId requires access to BOTH', () => {
    it('rejects an album query that also scopes to a space the caller is not a member of', async () => {
      const { sut, ctx } = setup();
      const { user: me } = await ctx.newUser();
      const { user: stranger } = await ctx.newUser();

      const myAsset = await createTimelineAsset(ctx, me.id, SPACE_DATE);
      const { album } = await ctx.newAlbum({ ownerId: me.id }, [myAsset.id]);

      // A space I am not a member of.
      const { space } = await ctx.newSharedSpace({ createdById: stranger.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: stranger.id, role: SharedSpaceRole.Owner });

      const auth = factory.auth({ user: me });

      // Baseline: the album alone is readable — so the rejection below is the space check firing,
      // not a broken album fixture.
      const albumOnly = await sut.getTimeBucket(auth, { albumId: album.id, timeBucket: SPACE_BUCKET });
      expect((JSON.parse(albumOnly) as { id?: string[] }).id ?? []).toEqual([myAsset.id]);

      const response = sut.getTimeBucket(auth, {
        albumId: album.id,
        spaceId: space.id,
        timeBucket: SPACE_BUCKET,
      });
      await expect(response).rejects.toBeInstanceOf(BadRequestException);
      await expect(response).rejects.toThrow('Not found or no sharedSpace.read access');
    });

    it('allows it when the caller can read both, and intersects them', async () => {
      const { sut, ctx } = setup();
      const { space, anna, viewer, annaAsset, benAsset } = await createTwoOwnerSpace(ctx);
      const auth = factory.auth({ user: viewer });

      // An album (owned by anna, shared with the viewer) holding only ONE of the space's assets.
      const { album } = await ctx.newAlbum({ ownerId: anna.id }, [annaAsset.id]);
      await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer });

      const json = await sut.getTimeBucket(auth, {
        albumId: album.id,
        spaceId: space.id,
        timeBucket: SPACE_BUCKET,
      });
      const ids = (JSON.parse(json) as { id?: string[] }).id ?? [];

      expect(ids).toEqual([annaAsset.id]);
      expect(ids).not.toContain(benAsset.id);
    });
  });
});
