import { Insertable, Kysely } from 'kysely';
import { AssetFileType, AssetOrder, AssetOrderBy, AssetType, AssetVisibility, SharedSpaceRole, TimeBucketSize } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { TagRepository } from 'src/repositories/tag.repository';
import { DB } from 'src/schema';
import { AssetTable } from 'src/schema/tables/asset.table';
import { BaseService } from 'src/services/base.service';
import { upsertTags } from 'src/utils/tag';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

interface TimeBucketAssets {
  id: string[];
}

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(AssetRepository) };
};

const createTimelineAssetWithPeople = async (
  ctx: ReturnType<typeof setup>['ctx'],
  ownerId: string,
  personIds: string[],
  localDateTime = new Date('2026-03-15T12:00:00.000Z'),
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    visibility: AssetVisibility.Timeline,
    fileCreatedAt: localDateTime,
    localDateTime,
  });
  await ctx.newExif({ assetId: asset.id, timeZone: 'UTC' });
  for (const personId of personIds) {
    await ctx.newAssetFace({ assetId: asset.id, personId, isVisible: true });
  }
  return asset;
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
  await ctx.newExif({ assetId: asset.id, timeZone: 'UTC' });
  return asset;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// Metadata extraction is repeatable: probing improves, files get repaired,
// and a re-run has to be able to correct what an earlier run stored.
const audioRow = (assetId: string, n: number) => ({
  assetId,
  bitrate: 100_000 + n,
  index: n,
  profile: n,
  codecName: `codec-${n}`,
});

const videoRow = (assetId: string, n: number) => ({
  assetId,
  bitrate: 200_000 + n,
  frameCount: 300 + n,
  timeBase: 600 + n,
  index: n,
  profile: n,
  level: n,
  colorPrimaries: n,
  colorTransfer: n,
  colorMatrix: n,
  dvProfile: n,
  dvLevel: n,
  dvBlSignalCompatibilityId: n,
  codecName: `vcodec-${n}`,
  formatName: `format-${n}`,
  formatLongName: `format long ${n}`,
  pixelFormat: `pixfmt-${n}`,
});

const keyframeRow = (assetId: string, n: number) => ({
  assetId,
  pts: [n],
  accDuration: [n],
  ownDuration: [n],
  totalDuration: 1000 + n,
  packetCount: 10 + n,
  outputFrames: 20 + n,
});

describe(AssetRepository.name, () => {
  describe('getTimeBuckets', () => {
    it('defaults to month grouping when bucketSize is omitted', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      await createTimelineAsset(ctx, user.id, new Date('2024-01-01T00:00:00.000Z'));
      await createTimelineAsset(ctx, user.id, new Date('2024-01-31T23:59:59.000Z'));
      await createTimelineAsset(ctx, user.id, new Date('2024-02-01T00:00:00.000Z'));

      await expect(sut.getTimeBuckets({ userIds: [user.id], visibility: AssetVisibility.Timeline })).resolves.toEqual([
        expect.objectContaining({ timeBucket: '2024-02-01', count: 1 }),
        expect.objectContaining({ timeBucket: '2024-01-01', count: 2 }),
      ]);
    });

    it('groups assets by year and day bucket sizes', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      await createTimelineAsset(ctx, user.id, new Date('2023-12-31T12:00:00.000Z'));
      await createTimelineAsset(ctx, user.id, new Date('2024-01-01T00:00:00.000Z'));
      await createTimelineAsset(ctx, user.id, new Date('2024-01-01T23:59:59.000Z'));

      await expect(
        sut.getTimeBuckets({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Year,
        }),
      ).resolves.toEqual([
        expect.objectContaining({ timeBucket: '2024-01-01', count: 2 }),
        expect.objectContaining({ timeBucket: '2023-01-01', count: 1 }),
      ]);

      await expect(
        sut.getTimeBuckets({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Day,
        }),
      ).resolves.toEqual([
        expect.objectContaining({ timeBucket: '2024-01-01', count: 2 }),
        expect.objectContaining({ timeBucket: '2023-12-31', count: 1 }),
      ]);
    });

    it('keeps takenAfter and takenBefore inclusive for bucket counts', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      await createTimelineAsset(ctx, user.id, new Date('2024-01-10T00:00:00.000Z'));
      await createTimelineAsset(ctx, user.id, new Date('2024-01-20T00:00:00.000Z'));
      await createTimelineAsset(ctx, user.id, new Date('2024-01-20T00:00:01.000Z'));

      await expect(
        sut.getTimeBuckets({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Year,
          takenAfter: '2024-01-10T00:00:00.000Z',
          takenBefore: '2024-01-20T00:00:00.000Z',
          order: AssetOrder.Asc,
        }),
      ).resolves.toEqual([expect.objectContaining({ count: 2 })]);

      const result = await sut.getTimeBuckets({
        userIds: [user.id],
        visibility: AssetVisibility.Timeline,
        bucketSize: TimeBucketSize.Day,
        takenAfter: '2024-01-10T00:00:00.000Z',
        takenBefore: '2024-01-20T00:00:00.000Z',
      });
      expect(result).toEqual([
        expect.objectContaining({ timeBucket: '2024-01-20', count: 1 }),
        expect.objectContaining({ timeBucket: '2024-01-10', count: 1 }),
      ]);
      expect(result[0]).not.toHaveProperty('representativeAssetId');
      expect(result[0]).not.toHaveProperty('representativeThumbhash');
      expect(result[0]).not.toHaveProperty('representativeRatio');
    });

    it('scoped filters apply correctly to bucket counts', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const matching = await createTimelineAsset(ctx, user.id, new Date('2024-02-01T12:00:00.000Z'), {
        isFavorite: true,
        thumbhash: Buffer.from('favorite'),
      });
      await ctx.newExif({
        assetId: matching.id,
        latitude: 52.5,
        longitude: 13.4,
        city: 'Berlin',
        country: 'Germany',
        make: 'Canon',
        model: 'R5',
        rating: 4,
      });

      const decoy = await createTimelineAsset(ctx, user.id, new Date('2024-02-02T12:00:00.000Z'), {
        isFavorite: false,
      });
      await ctx.newExif({
        assetId: decoy.id,
        latitude: 48.8,
        longitude: 2.3,
        city: 'Paris',
        country: 'France',
        make: 'Nikon',
        model: 'Z6',
        rating: 2,
      });

      const result = await sut.getTimeBuckets({
        userIds: [user.id],
        visibility: AssetVisibility.Timeline,
        bucketSize: TimeBucketSize.Year,
        isFavorite: true,
        city: 'Berlin',
        country: 'Germany',
        make: 'Canon',
        model: 'R5',
        rating: 4,
      });
      expect(result).toEqual([expect.objectContaining({ count: 1 })]);
      // representative fields must not appear on getTimeBuckets results
      expect(result[0]).not.toHaveProperty('representativeAssetId');
      expect(result[0]).not.toHaveProperty('representativeThumbhash');
      expect(result[0]).not.toHaveProperty('representativeRatio');
    });

    it('returns only timeBucket and count fields (no representative fields)', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      await createTimelineAsset(ctx, user.id, new Date('2024-07-01T23:00:00.000Z'), {
        fileCreatedAt: new Date('2024-07-01T10:00:00.000Z'),
      });
      await createTimelineAsset(ctx, user.id, new Date('2024-07-01T01:00:00.000Z'), {
        fileCreatedAt: new Date('2024-07-01T20:00:00.000Z'),
      });

      const result = await sut.getTimeBuckets({
        userIds: [user.id],
        visibility: AssetVisibility.Timeline,
        bucketSize: TimeBucketSize.Month,
      });
      expect(result).toEqual([expect.objectContaining({ timeBucket: '2024-07-01', count: 2 })]);
      expect(result[0]).not.toHaveProperty('representativeAssetId');
      expect(result[0]).not.toHaveProperty('representativeThumbhash');
      expect(result[0]).not.toHaveProperty('representativeRatio');
    });

    it('applies bbox filtering to counts', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const inside = await createTimelineAsset(ctx, user.id, new Date('2024-03-01T12:00:00.000Z'));
      await ctx.newExif({ assetId: inside.id, latitude: 52.52, longitude: 13.405 });

      await createTimelineAsset(ctx, user.id, new Date('2024-03-02T12:00:00.000Z')).then((outside) =>
        ctx.newExif({ assetId: outside.id, latitude: 48.8566, longitude: 2.3522 }),
      );

      await expect(
        sut.getTimeBuckets({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Year,
          bbox: { west: 13.3, south: 52.4, east: 13.5, north: 52.6 },
        }),
      ).resolves.toEqual([expect.objectContaining({ count: 1 })]);
    });

    it('counts space assets from direct and library paths without double-counting', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { library } = await ctx.newLibrary({ ownerId: user.id });
      const { space } = await ctx.newSharedSpace({ createdById: user.id });

      const directAndLibrary = await createTimelineAsset(ctx, user.id, new Date('2024-04-01T12:00:00.000Z'), {
        libraryId: library.id,
      });
      await createTimelineAsset(ctx, user.id, new Date('2024-04-02T12:00:00.000Z'), {
        libraryId: library.id,
      });
      await createTimelineAsset(ctx, user.id, new Date('2024-04-03T12:00:00.000Z'));

      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: directAndLibrary.id, addedById: user.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: user.id });

      await expect(
        sut.getTimeBuckets({
          spaceId: space.id,
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Year,
        }),
      ).resolves.toEqual([expect.objectContaining({ count: 2 })]);
      await expect(
        sut.getTimeBuckets({ spaceId: space.id, visibility: AssetVisibility.Timeline, bucketSize: TimeBucketSize.Day }),
      ).resolves.toEqual([
        expect.objectContaining({ timeBucket: '2024-04-02', count: 1 }),
        expect.objectContaining({ timeBucket: '2024-04-01', count: 1 }),
      ]);
    });

    it('filters archive, locked, and trashed buckets independently', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      await createTimelineAsset(ctx, user.id, new Date('2024-05-01T12:00:00.000Z'), {
        visibility: AssetVisibility.Archive,
      });
      await createTimelineAsset(ctx, user.id, new Date('2024-06-01T12:00:00.000Z'), {
        visibility: AssetVisibility.Locked,
      });
      await createTimelineAsset(ctx, user.id, new Date('2024-07-01T12:00:00.000Z'), {
        deletedAt: new Date('2024-07-02T00:00:00.000Z'),
      });

      await expect(
        sut.getTimeBuckets({
          userIds: [user.id],
          visibility: AssetVisibility.Archive,
          bucketSize: TimeBucketSize.Year,
        }),
      ).resolves.toEqual([expect.objectContaining({ count: 1 })]);

      await expect(
        sut.getTimeBuckets({
          userIds: [user.id],
          visibility: AssetVisibility.Locked,
          bucketSize: TimeBucketSize.Month,
        }),
      ).resolves.toEqual([expect.objectContaining({ count: 1 })]);

      await expect(
        sut.getTimeBuckets({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Day,
          isTrashed: true,
        }),
      ).resolves.toEqual([expect.objectContaining({ count: 1 })]);
    });

    it('filters by video type, album, tag, and stacked state', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const primary = await createTimelineAsset(ctx, user.id, new Date('2024-08-01T12:00:00.000Z'), {
        type: AssetType.Video,
        originalPath: '/videos/primary.mp4',
      });
      const stacked = await createTimelineAsset(ctx, user.id, new Date('2024-08-02T12:00:00.000Z'), {
        type: AssetType.Video,
        originalPath: '/videos/stacked.mp4',
      });
      await createTimelineAsset(ctx, user.id, new Date('2024-08-03T12:00:00.000Z'), { type: AssetType.Image });
      await ctx.newStack({ ownerId: user.id }, [primary.id, stacked.id]);

      const { album } = await ctx.newAlbum({ ownerId: user.id }, [primary.id]);
      const [tag] = await upsertTags(ctx.get(TagRepository), { userId: user.id, tags: ['trip'] });
      await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [primary.id] });

      const commonOptions = {
        userIds: [user.id],
        visibility: AssetVisibility.Timeline,
        bucketSize: TimeBucketSize.Year,
      };

      await expect(sut.getTimeBuckets({ ...commonOptions, assetType: AssetType.Video })).resolves.toEqual([
        expect.objectContaining({ count: 2 }),
      ]);
      await expect(sut.getTimeBuckets({ ...commonOptions, albumId: album.id })).resolves.toEqual([
        expect.objectContaining({ count: 1 }),
      ]);
      await expect(sut.getTimeBuckets({ ...commonOptions, tagIds: [tag.id] })).resolves.toEqual([
        expect.objectContaining({ count: 1 }),
      ]);
      await expect(sut.getTimeBuckets({ ...commonOptions, withStacked: true })).resolves.toEqual([
        expect.objectContaining({ count: 2 }),
      ]);
    });

    it('filters bucket counts by person, space person, and face identity ids', async () => {
      const { ctx, sut } = setup();
      const faceIdentityRepository = ctx.get(FaceIdentityRepository);
      const sharedSpaceRepo = ctx.get(SharedSpaceRepository);
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      const { space } = await ctx.newSharedSpace({ createdById: user.id });

      const personAsset = await createTimelineAsset(ctx, user.id, new Date('2024-09-01T12:00:00.000Z'));
      const identityAsset = await createTimelineAsset(ctx, user.id, new Date('2024-10-01T12:00:00.000Z'));
      const spacePersonAsset = await createTimelineAsset(ctx, user.id, new Date('2024-11-01T12:00:00.000Z'));
      await createTimelineAsset(ctx, user.id, new Date('2024-12-01T12:00:00.000Z'));

      await ctx.newAssetFace({ assetId: personAsset.id, personId: person.id, isVisible: true });
      const { assetFace: identityFace } = await ctx.newAssetFace({
        assetId: identityAsset.id,
        personId: person.id,
        isVisible: true,
      });
      const identity = await faceIdentityRepository.ensurePersonIdentity(person.id);
      await faceIdentityRepository.linkFace({
        assetFaceId: identityFace.id,
        identityId: identity.id,
        source: 'manual',
      });

      const { assetFace: visibleFace } = await ctx.newAssetFace({ assetId: spacePersonAsset.id, isVisible: true });
      const spacePerson = await sharedSpaceRepo.createPerson({
        spaceId: space.id,
        name: 'Space Alice',
        representativeFaceId: visibleFace.id,
        type: 'person',
      });
      await sharedSpaceRepo.addPersonFaces([{ personId: spacePerson.id, assetFaceId: visibleFace.id }], {
        skipRecount: true,
      });

      await expect(
        sut.getTimeBuckets({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Year,
          personIds: [person.id],
        }),
      ).resolves.toEqual([expect.objectContaining({ count: 2 })]);

      await expect(
        sut.getTimeBuckets({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Month,
          identityIds: [identity.id],
        }),
      ).resolves.toEqual([expect.objectContaining({ count: 1 })]);

      await expect(
        sut.getTimeBuckets({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Day,
          spacePersonIds: [spacePerson.id],
        }),
      ).resolves.toEqual([expect.objectContaining({ count: 1 })]);
    });

    it('includes owner and shared-space timeline assets when timeline space ids are supplied', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });

      await createTimelineAsset(ctx, user.id, new Date('2024-12-01T12:00:00.000Z'));
      const sharedAsset = await createTimelineAsset(ctx, otherUser.id, new Date('2024-12-02T12:00:00.000Z'));
      await createTimelineAsset(ctx, otherUser.id, new Date('2024-12-03T12:00:00.000Z'));
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: sharedAsset.id, addedById: user.id });

      await expect(
        sut.getTimeBuckets({
          userIds: [user.id],
          timelineSpaceIds: [space.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Year,
        }),
      ).resolves.toEqual([expect.objectContaining({ count: 2 })]);

      await expect(
        sut.getTimeBuckets({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Day,
        }),
      ).resolves.toEqual([expect.objectContaining({ count: 1 })]);
    });

    it.each([TimeBucketSize.Year, TimeBucketSize.Month, TimeBucketSize.Day])(
      'returns an empty list for %s buckets when filters match no assets',
      async (bucketSize) => {
        const { ctx, sut } = setup();
        const { user } = await ctx.newUser();

        await createTimelineAsset(ctx, user.id, new Date('2024-05-01T12:00:00.000Z'), {
          type: AssetType.Image,
        });

        await expect(
          sut.getTimeBuckets({
            userIds: [user.id],
            visibility: AssetVisibility.Timeline,
            bucketSize,
            assetType: AssetType.Video,
          }),
        ).resolves.toEqual([]);
      },
    );
  });

  describe('getTimeBucketCovers', () => {
    it('returns an empty list without querying when no buckets are requested', async () => {
      const { sut } = setup();

      await expect(sut.getTimeBucketCovers({ timeBuckets: [] })).resolves.toEqual([]);
      await expect(sut.getTimeBucketCovers({})).resolves.toEqual([]);
    });

    it('picks the latest asset per requested year bucket for descending order', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      await createTimelineAsset(ctx, user.id, new Date('2023-02-01T12:00:00.000Z'), {
        thumbhash: Buffer.from('older-2023'),
      });
      const newer2023 = await createTimelineAsset(ctx, user.id, new Date('2023-11-15T12:00:00.000Z'), {
        thumbhash: Buffer.from('newer-2023'),
      });
      const only2024 = await createTimelineAsset(ctx, user.id, new Date('2024-06-01T12:00:00.000Z'), {
        thumbhash: Buffer.from('only-2024'),
      });

      await expect(
        sut.getTimeBucketCovers({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Year,
          order: AssetOrder.Desc,
          timeBuckets: ['2023-01-01', '2024-01-01'],
        }),
      ).resolves.toEqual([
        {
          timeBucket: '2024-01-01',
          representativeAssetId: only2024.id,
          representativeThumbhash: Buffer.from('only-2024').toString('base64'),
          representativeRatio: 2,
        },
        {
          timeBucket: '2023-01-01',
          representativeAssetId: newer2023.id,
          representativeThumbhash: Buffer.from('newer-2023').toString('base64'),
          representativeRatio: 2,
        },
      ]);
    });

    it('picks the earliest asset per requested year bucket for ascending order', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const older2023 = await createTimelineAsset(ctx, user.id, new Date('2023-02-01T12:00:00.000Z'), {
        thumbhash: Buffer.from('older-2023'),
      });
      await createTimelineAsset(ctx, user.id, new Date('2023-11-15T12:00:00.000Z'), {
        thumbhash: Buffer.from('newer-2023'),
      });

      await expect(
        sut.getTimeBucketCovers({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Year,
          order: AssetOrder.Asc,
          timeBuckets: ['2023-01-01'],
        }),
      ).resolves.toEqual([
        {
          timeBucket: '2023-01-01',
          representativeAssetId: older2023.id,
          representativeThumbhash: Buffer.from('older-2023').toString('base64'),
          representativeRatio: 2,
        },
      ]);
    });

    it('uses fileCreatedAt as a tie-break, matching the bucket representative pick', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const laterTimeEarlierCreated = await createTimelineAsset(ctx, user.id, new Date('2024-07-01T23:00:00.000Z'), {
        fileCreatedAt: new Date('2024-07-01T10:00:00.000Z'),
      });
      const earlierTimeLaterCreated = await createTimelineAsset(ctx, user.id, new Date('2024-07-01T01:00:00.000Z'), {
        fileCreatedAt: new Date('2024-07-01T20:00:00.000Z'),
      });

      // Same day in DESC: latest localDate ties (both 2024-07-01), so latest fileCreatedAt wins.
      await expect(
        sut.getTimeBucketCovers({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Day,
          order: AssetOrder.Desc,
          timeBuckets: ['2024-07-01'],
        }),
      ).resolves.toEqual([
        expect.objectContaining({ timeBucket: '2024-07-01', representativeAssetId: earlierTimeLaterCreated.id }),
      ]);

      // ASC tie-break: earliest fileCreatedAt wins.
      await expect(
        sut.getTimeBucketCovers({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Day,
          order: AssetOrder.Asc,
          timeBuckets: ['2024-07-01'],
        }),
      ).resolves.toEqual([
        expect.objectContaining({ timeBucket: '2024-07-01', representativeAssetId: laterTimeEarlierCreated.id }),
      ]);
    });

    it('omits requested buckets that have no matching assets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const only2024 = await createTimelineAsset(ctx, user.id, new Date('2024-06-01T12:00:00.000Z'));

      await expect(
        sut.getTimeBucketCovers({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Year,
          order: AssetOrder.Desc,
          timeBuckets: ['2023-01-01', '2024-01-01', '2025-01-01'],
        }),
      ).resolves.toEqual([expect.objectContaining({ timeBucket: '2024-01-01', representativeAssetId: only2024.id })]);
    });

    it('honours owner and visibility filters', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();

      const owned = await createTimelineAsset(ctx, user.id, new Date('2024-06-01T12:00:00.000Z'));
      await createTimelineAsset(ctx, user.id, new Date('2024-07-01T12:00:00.000Z'), {
        visibility: AssetVisibility.Archive,
      });
      await createTimelineAsset(ctx, otherUser.id, new Date('2024-08-01T12:00:00.000Z'));

      await expect(
        sut.getTimeBucketCovers({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Year,
          order: AssetOrder.Desc,
          timeBuckets: ['2024-01-01'],
        }),
      ).resolves.toEqual([expect.objectContaining({ timeBucket: '2024-01-01', representativeAssetId: owned.id })]);
    });

    it('picks the representative for a month bucket spanning a year boundary', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const decAsset = await createTimelineAsset(ctx, user.id, new Date('2023-12-15T12:00:00.000Z'));
      await createTimelineAsset(ctx, user.id, new Date('2024-01-10T12:00:00.000Z')); // must be excluded

      await expect(
        sut.getTimeBucketCovers({
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          bucketSize: TimeBucketSize.Month,
          order: AssetOrder.Desc,
          timeBuckets: ['2023-12-01'],
        }),
      ).resolves.toEqual([expect.objectContaining({ timeBucket: '2023-12-01', representativeAssetId: decAsset.id })]);
    });
  });

  describe('getForThumbnail', () => {
    it('should fall back to the preview file when the thumbnail file is missing', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({
        ownerId: user.id,
        originalFileName: 'IMG_001.jpg',
        originalPath: '/uploads/IMG_001.jpg',
      });
      await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: 'preview.jpg' });

      await expect(sut.getForThumbnail(asset.id, AssetFileType.Thumbnail, true)).resolves.toMatchObject({
        path: 'preview.jpg',
      });
    });

    it('should prefer the requested thumbnail file when thumbnail and preview files exist', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({
        ownerId: user.id,
        originalFileName: 'IMG_002.jpg',
        originalPath: '/uploads/IMG_002.jpg',
      });
      await Promise.all([
        ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: 'preview.jpg' }),
        ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Thumbnail, path: 'thumbnail.jpg' }),
      ]);

      await expect(sut.getForThumbnail(asset.id, AssetFileType.Thumbnail, true)).resolves.toMatchObject({
        path: 'thumbnail.jpg',
      });
    });
  });

  describe('getMemoryLocationClusters', () => {
    it('should group previewable timeline assets by country and city within the requested window', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const addAsset = async ({
        localDateTime,
        country,
        city,
        withPreview = true,
      }: {
        localDateTime: Date;
        country: string | null;
        city: string | null;
        withPreview?: boolean;
      }) => {
        const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline, localDateTime });
        await Promise.all([
          ctx.newExif({ assetId: asset.id, country, city }),
          ctx.newJobStatus({ assetId: asset.id }),
          withPreview
            ? ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: `${asset.id}.jpg` })
            : null,
        ]);
      };

      await addAsset({ localDateTime: new Date('2026-04-15T10:00:00Z'), country: 'France', city: 'Paris' });
      await addAsset({ localDateTime: new Date('2026-04-16T10:00:00Z'), country: 'France', city: 'Paris' });
      await addAsset({ localDateTime: new Date('2026-04-17T10:00:00Z'), country: 'France', city: 'Lyon' });
      await addAsset({ localDateTime: new Date('2026-04-18T10:00:00Z'), country: null, city: null });
      await addAsset({
        localDateTime: new Date('2026-04-19T10:00:00Z'),
        country: 'France',
        city: 'Paris',
        withPreview: false,
      });

      const result = await sut.getMemoryLocationClusters(user.id, {
        takenAfter: new Date('2026-04-01T00:00:00Z'),
        takenBefore: new Date('2026-04-30T23:59:59Z'),
      });

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ country: 'France', city: 'Paris', assetCount: 2, dayCount: 2 }),
          expect.objectContaining({ country: 'France', city: 'Lyon', assetCount: 1, dayCount: 1 }),
        ]),
      );
      expect(result).toHaveLength(2);
    });
  });

  describe('getMemoryAssetsForLocation', () => {
    it('should return previewable timeline assets for the requested country and city, including city=null', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const takenAfter = new Date('2026-04-01T00:00:00Z');
      const takenBefore = new Date('2026-04-30T23:59:59Z');

      const { asset: parisAsset } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        localDateTime: new Date('2026-04-15T10:00:00Z'),
      });
      const { asset: countryOnlyAsset } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        localDateTime: new Date('2026-04-16T10:00:00Z'),
      });
      const { asset: berlinAsset } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        localDateTime: new Date('2026-04-17T10:00:00Z'),
      });

      await Promise.all([
        ctx.newExif({ assetId: parisAsset.id, country: 'France', city: 'Paris' }),
        ctx.newExif({ assetId: countryOnlyAsset.id, country: 'France', city: null }),
        ctx.newExif({ assetId: berlinAsset.id, country: 'Germany', city: 'Berlin' }),
        ctx.newAssetFile({ assetId: parisAsset.id, type: AssetFileType.Preview, path: 'paris.jpg' }),
        ctx.newAssetFile({ assetId: countryOnlyAsset.id, type: AssetFileType.Preview, path: 'france.jpg' }),
        ctx.newAssetFile({ assetId: berlinAsset.id, type: AssetFileType.Preview, path: 'berlin.jpg' }),
      ]);

      await expect(
        sut.getMemoryAssetsForLocation(user.id, {
          country: 'France',
          city: 'Paris',
          takenAfter,
          takenBefore,
        }),
      ).resolves.toEqual([expect.objectContaining({ id: parisAsset.id })]);

      await expect(
        sut.getMemoryAssetsForLocation(user.id, {
          country: 'France',
          city: null,
          takenAfter,
          takenBefore,
        }),
      ).resolves.toEqual([expect.objectContaining({ id: countryOnlyAsset.id })]);
    });
  });

  describe('getMemoryAssetsForPerson', () => {
    it('should return previewable timeline assets for the person before the cutoff and deduplicate multiple faces', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      const cutoff = new Date('2026-04-23T23:59:59Z');

      const { asset: matchingAsset } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        localDateTime: new Date('2025-04-01T12:00:00Z'),
      });
      const { asset: duplicateFaceAsset } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        localDateTime: new Date('2024-04-01T12:00:00Z'),
      });
      const { asset: hiddenFaceAsset } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        localDateTime: new Date('2023-04-01T12:00:00Z'),
      });
      const { asset: missingPreviewAsset } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        localDateTime: new Date('2022-04-01T12:00:00Z'),
      });
      const { asset: afterCutoffAsset } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        localDateTime: new Date('2026-05-01T12:00:00Z'),
      });

      await Promise.all([
        ctx.newJobStatus({ assetId: matchingAsset.id }),
        ctx.newJobStatus({ assetId: duplicateFaceAsset.id }),
        ctx.newJobStatus({ assetId: hiddenFaceAsset.id }),
        ctx.newJobStatus({ assetId: missingPreviewAsset.id }),
        ctx.newJobStatus({ assetId: afterCutoffAsset.id }),
        ctx.newAssetFile({ assetId: matchingAsset.id, type: AssetFileType.Preview, path: 'matching-preview.jpg' }),
        ctx.newAssetFile({
          assetId: duplicateFaceAsset.id,
          type: AssetFileType.Preview,
          path: 'duplicate-preview.jpg',
        }),
        ctx.newAssetFile({ assetId: hiddenFaceAsset.id, type: AssetFileType.Preview, path: 'hidden-preview.jpg' }),
        ctx.newAssetFile({ assetId: afterCutoffAsset.id, type: AssetFileType.Preview, path: 'after-preview.jpg' }),
        ctx.newAssetFace({ assetId: matchingAsset.id, personId: person.id, isVisible: true }),
        ctx.newAssetFace({ assetId: duplicateFaceAsset.id, personId: person.id, isVisible: true }),
        ctx.newAssetFace({ assetId: duplicateFaceAsset.id, personId: person.id, isVisible: true }),
        ctx.newAssetFace({ assetId: hiddenFaceAsset.id, personId: person.id, isVisible: false }),
        ctx.newAssetFace({ assetId: missingPreviewAsset.id, personId: person.id, isVisible: true }),
        ctx.newAssetFace({ assetId: afterCutoffAsset.id, personId: person.id, isVisible: true }),
      ]);

      const result = await sut.getMemoryAssetsForPerson(user.id, person.id, cutoff);

      expect(result.map(({ id }) => id).toSorted()).toEqual([duplicateFaceAsset.id, matchingAsset.id].toSorted());
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: matchingAsset.id, localDateTime: new Date('2025-04-01T12:00:00Z') }),
          expect.objectContaining({ id: duplicateFaceAsset.id, localDateTime: new Date('2024-04-01T12:00:00Z') }),
        ]),
      );
    });
  });

  describe('getTimeBucket', () => {
    it('should order assets by local day first and fileCreatedAt within each day', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });

      const [{ asset: previousLocalDayAsset }, { asset: nextLocalDayEarlierAsset }, { asset: nextLocalDayLaterAsset }] =
        await Promise.all([
          ctx.newAsset({
            ownerId: user.id,
            fileCreatedAt: new Date('2026-03-09T00:30:00.000Z'),
            localDateTime: new Date('2026-03-08T22:30:00.000Z'),
          }),
          ctx.newAsset({
            ownerId: user.id,
            fileCreatedAt: new Date('2026-03-08T23:30:00.000Z'),
            localDateTime: new Date('2026-03-09T01:30:00.000Z'),
          }),
          ctx.newAsset({
            ownerId: user.id,
            fileCreatedAt: new Date('2026-03-08T23:45:00.000Z'),
            localDateTime: new Date('2026-03-09T01:45:00.000Z'),
          }),
        ]);

      await Promise.all([
        ctx.newExif({ assetId: previousLocalDayAsset.id, timeZone: 'UTC-2' }),
        ctx.newExif({ assetId: nextLocalDayEarlierAsset.id, timeZone: 'UTC+2' }),
        ctx.newExif({ assetId: nextLocalDayLaterAsset.id, timeZone: 'UTC+2' }),
      ]);

      const descendingBucket = await sut.getTimeBucket(
        '2026-03-01',
        { order: AssetOrder.Desc, userIds: [user.id], visibility: AssetVisibility.Timeline },
        auth,
      );
      expect(JSON.parse(descendingBucket.assets)).toEqual(
        expect.objectContaining({
          id: [nextLocalDayLaterAsset.id, nextLocalDayEarlierAsset.id, previousLocalDayAsset.id],
        }),
      );

      const ascendingBucket = await sut.getTimeBucket(
        '2026-03-01',
        { order: AssetOrder.Asc, userIds: [user.id], visibility: AssetVisibility.Timeline },
        auth,
      );
      expect(JSON.parse(ascendingBucket.assets)).toEqual(
        expect.objectContaining({
          id: [previousLocalDayAsset.id, nextLocalDayEarlierAsset.id, nextLocalDayLaterAsset.id],
        }),
      );
    });

    it('should order assets by originalFileName when fileCreatedAt is the same (takenAt)', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });

      // create all the fake photos
      const [
        { asset: time1DSC0001Asset },
        { asset: time1DSC0002Asset },
        { asset: time2DSC0003Asset },
        { asset: time2DSC0004Asset },
      ] = await Promise.all([
        // both at 12:30AM
        ctx.newAsset({
          ownerId: user.id,
          fileCreatedAt: new Date('2026-03-09T00:30:00.000Z'),
          localDateTime: new Date('2026-03-09T00:30:00.000Z'),
          originalFileName: 'DSC0001.jpg',
        }),
        ctx.newAsset({
          ownerId: user.id,
          fileCreatedAt: new Date('2026-03-09T00:30:00.000Z'),
          localDateTime: new Date('2026-03-09T00:30:00.000Z'),
          originalFileName: 'DSC0002.jpg',
        }),
        // both at 1:45AM
        ctx.newAsset({
          ownerId: user.id,
          fileCreatedAt: new Date('2026-03-09T01:45:00.000Z'),
          localDateTime: new Date('2026-03-09T01:45:00.000Z'),
          originalFileName: 'DSC0003.jpg',
        }),
        ctx.newAsset({
          ownerId: user.id,
          fileCreatedAt: new Date('2026-03-09T01:45:00.000Z'),
          localDateTime: new Date('2026-03-09T01:45:00.000Z'),
          originalFileName: 'DSC0004.jpg',
        }),
      ]);

      // even though im not gonna do anything with these it's required!
      await Promise.all([
        ctx.newExif({ assetId: time1DSC0001Asset.id, timeZone: 'UTC+2' }),
        ctx.newExif({ assetId: time1DSC0002Asset.id, timeZone: 'UTC+2' }),
        ctx.newExif({ assetId: time2DSC0003Asset.id, timeZone: 'UTC+2' }),
        ctx.newExif({ assetId: time2DSC0004Asset.id, timeZone: 'UTC+2' }),
      ]);

      // check the values given by the bucket when descending
      const descendingBucket = await sut.getTimeBucket(
        '2026-03-01',
        {
          order: AssetOrder.Desc,
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          orderBy: AssetOrderBy.TakenAt,
        },
        auth,
      );
      // make sure they're ordered correctly
      expect(JSON.parse(descendingBucket.assets)).toEqual(
        expect.objectContaining({
          id: [time2DSC0004Asset.id, time2DSC0003Asset.id, time1DSC0002Asset.id, time1DSC0001Asset.id],
        }),
      );

      // now do the same when ascending
      const ascendingBucket = await sut.getTimeBucket(
        '2026-03-01',
        {
          order: AssetOrder.Asc,
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          orderBy: AssetOrderBy.TakenAt,
        },
        auth,
      );
      expect(JSON.parse(ascendingBucket.assets)).toEqual(
        expect.objectContaining({
          id: [time1DSC0001Asset.id, time1DSC0002Asset.id, time2DSC0003Asset.id, time2DSC0004Asset.id],
        }),
      );
    });

    it('should order assets by originalFileName when fileCreatedAt is the same (createdAt)', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });

      // create all the fake photos
      const [
        { asset: time1DSC0001Asset },
        { asset: time1DSC0002Asset },
        { asset: time2DSC0003Asset },
        { asset: time2DSC0004Asset },
      ] = await Promise.all([
        // createdAt = uploadedAt, fileCreatedAt = file metadata
        // both at 12:30AM
        ctx.newAsset({
          ownerId: user.id,
          fileCreatedAt: new Date('2026-03-09T00:30:00.000Z'),
          localDateTime: new Date('2026-03-09T00:30:00.000Z'),
          createdAt: new Date('2026-03-09T00:30:00.000Z'),
          originalFileName: 'DSC0001.jpg',
        }),
        ctx.newAsset({
          ownerId: user.id,
          fileCreatedAt: new Date('2026-03-09T00:30:00.000Z'),
          localDateTime: new Date('2026-03-09T00:30:00.000Z'),
          createdAt: new Date('2026-03-09T00:30:00.000Z'),
          originalFileName: 'DSC0002.jpg',
        }),
        // both at 1:45AM
        ctx.newAsset({
          ownerId: user.id,
          fileCreatedAt: new Date('2026-03-09T01:45:00.000Z'),
          localDateTime: new Date('2026-03-09T01:45:00.000Z'),
          createdAt: new Date('2026-03-09T01:45:00.000Z'),
          originalFileName: 'DSC0003.jpg',
        }),
        ctx.newAsset({
          ownerId: user.id,
          fileCreatedAt: new Date('2026-03-09T01:45:00.000Z'),
          localDateTime: new Date('2026-03-09T01:45:00.000Z'),
          createdAt: new Date('2026-03-09T01:45:00.000Z'),
          originalFileName: 'DSC0004.jpg',
        }),
      ]);

      // even though im not gonna do anything with these it's required!
      await Promise.all([
        ctx.newExif({ assetId: time1DSC0001Asset.id, timeZone: 'UTC+2' }),
        ctx.newExif({ assetId: time1DSC0002Asset.id, timeZone: 'UTC+2' }),
        ctx.newExif({ assetId: time2DSC0003Asset.id, timeZone: 'UTC+2' }),
        ctx.newExif({ assetId: time2DSC0004Asset.id, timeZone: 'UTC+2' }),
      ]);

      // check the values given by the bucket when descending
      const descendingBucket = await sut.getTimeBucket(
        '2026-03-01',
        {
          order: AssetOrder.Desc,
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          orderBy: AssetOrderBy.CreatedAt,
        },
        auth,
      );
      // make sure they're ordered correctly
      expect(JSON.parse(descendingBucket.assets)).toEqual(
        expect.objectContaining({
          id: [time2DSC0004Asset.id, time2DSC0003Asset.id, time1DSC0002Asset.id, time1DSC0001Asset.id],
        }),
      );

      // now do the same when ascending
      const ascendingBucket = await sut.getTimeBucket(
        '2026-03-01',
        {
          order: AssetOrder.Asc,
          userIds: [user.id],
          visibility: AssetVisibility.Timeline,
          orderBy: AssetOrderBy.CreatedAt,
        },
        auth,
      );
      expect(JSON.parse(ascendingBucket.assets)).toEqual(
        expect.objectContaining({
          id: [time1DSC0001Asset.id, time1DSC0002Asset.id, time2DSC0003Asset.id, time2DSC0004Asset.id],
        }),
      );
    it('filters bucket assets by description (accent/case-insensitive substring)', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });

      const [{ asset: match }, { asset: other }] = await Promise.all([
        ctx.newAsset({
          ownerId: user.id,
          fileCreatedAt: new Date('2026-03-08T12:00:00.000Z'),
          localDateTime: new Date('2026-03-08T12:00:00.000Z'),
        }),
        ctx.newAsset({
          ownerId: user.id,
          fileCreatedAt: new Date('2026-03-08T13:00:00.000Z'),
          localDateTime: new Date('2026-03-08T13:00:00.000Z'),
        }),
      ]);
      await Promise.all([
        ctx.newExif({ assetId: match.id, description: 'A lovely beach sunset', timeZone: 'UTC' }),
        ctx.newExif({ assetId: other.id, description: 'Mountain hike', timeZone: 'UTC' }),
      ]);

      const bucket = await sut.getTimeBucket(
        '2026-03-01',
        { userIds: [user.id], visibility: AssetVisibility.Timeline, description: 'BEACH' },
        auth,
      );
      expect(JSON.parse(bucket.assets).id).toEqual([match.id]);
    });

    it('filters bucket assets by originalFileName (accent/case-insensitive substring)', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });

      const [{ asset: match }, { asset: other }] = await Promise.all([
        ctx.newAsset({
          ownerId: user.id,
          originalFileName: 'IMG_beach_0001.jpg',
          fileCreatedAt: new Date('2026-03-08T12:00:00.000Z'),
          localDateTime: new Date('2026-03-08T12:00:00.000Z'),
        }),
        ctx.newAsset({
          ownerId: user.id,
          originalFileName: 'IMG_forest_0002.jpg',
          fileCreatedAt: new Date('2026-03-08T13:00:00.000Z'),
          localDateTime: new Date('2026-03-08T13:00:00.000Z'),
        }),
      ]);
      await Promise.all([
        ctx.newExif({ assetId: match.id, timeZone: 'UTC' }),
        ctx.newExif({ assetId: other.id, timeZone: 'UTC' }),
      ]);

      const bucket = await sut.getTimeBucket(
        '2026-03-01',
        { userIds: [user.id], visibility: AssetVisibility.Timeline, originalFileName: 'BEACH' },
        auth,
      );
      expect(JSON.parse(bucket.assets).id).toEqual([match.id]);
    });

    it('filters bucket assets by ocr text', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });

      const [{ asset: match }, { asset: other }] = await Promise.all([
        ctx.newAsset({
          ownerId: user.id,
          fileCreatedAt: new Date('2026-03-08T12:00:00.000Z'),
          localDateTime: new Date('2026-03-08T12:00:00.000Z'),
        }),
        ctx.newAsset({
          ownerId: user.id,
          fileCreatedAt: new Date('2026-03-08T13:00:00.000Z'),
          localDateTime: new Date('2026-03-08T13:00:00.000Z'),
        }),
      ]);
      await Promise.all([
        ctx.newExif({ assetId: match.id, timeZone: 'UTC' }),
        ctx.newExif({ assetId: other.id, timeZone: 'UTC' }),
      ]);
      await ctx.database
        .insertInto('ocr_search')
        .values({ assetId: match.id, text: 'Total amount due invoice receipt' })
        .execute();

      const bucket = await sut.getTimeBucket(
        '2026-03-01',
        { userIds: [user.id], visibility: AssetVisibility.Timeline, ocr: 'invoice receipt' },
        auth,
      );
      expect(JSON.parse(bucket.assets).id).toEqual([match.id]);
    });

    it('projects owner-scoped isFavorite, isImage and ratio for matched assets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });

      const { asset } = await ctx.newAsset({
        ownerId: user.id,
        type: AssetType.Image,
        isFavorite: true,
        fileCreatedAt: new Date('2026-03-08T12:00:00.000Z'),
        localDateTime: new Date('2026-03-08T12:00:00.000Z'),
      });
      await ctx.newExif({ assetId: asset.id, timeZone: 'UTC' });

      const bucket = await sut.getTimeBucket(
        '2026-03-01',
        { userIds: [user.id], visibility: AssetVisibility.Timeline },
        auth,
      );
      const parsed = JSON.parse(bucket.assets);
      expect(parsed.id).toEqual([asset.id]);
      expect(parsed.isImage).toEqual([true]);
      expect(parsed.isFavorite).toEqual([true]);
    });
  });

  describe('upsertExif', () => {
    it('should replace stored audio metadata on a second extraction', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await sut.upsertExif({
        exif: { assetId: asset.id, description: 'first' },
        audio: audioRow(asset.id, 2),
        lockedPropertiesBehavior: 'skip',
      });
      await sut.upsertExif({
        exif: { assetId: asset.id, description: 'second' },
        audio: audioRow(asset.id, 1),
        lockedPropertiesBehavior: 'skip',
      });

      await expect(
        ctx.database.selectFrom('asset_audio').selectAll().where('assetId', '=', asset.id).executeTakeFirstOrThrow(),
      ).resolves.toEqual(audioRow(asset.id, 1));
    });

    it('should replace stored video metadata on a second extraction', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await sut.upsertExif({
        exif: { assetId: asset.id, description: 'first' },
        video: videoRow(asset.id, 2),
        lockedPropertiesBehavior: 'skip',
      });
      await sut.upsertExif({
        exif: { assetId: asset.id, description: 'second' },
        video: videoRow(asset.id, 1),
        lockedPropertiesBehavior: 'skip',
      });

      await expect(
        ctx.database.selectFrom('asset_video').selectAll().where('assetId', '=', asset.id).executeTakeFirstOrThrow(),
      ).resolves.toEqual(videoRow(asset.id, 1));
    });

    it('should replace stored keyframe metadata on a second extraction', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await sut.upsertExif({
        exif: { assetId: asset.id, description: 'first' },
        keyframes: keyframeRow(asset.id, 2),
        lockedPropertiesBehavior: 'skip',
      });
      await sut.upsertExif({
        exif: { assetId: asset.id, description: 'second' },
        keyframes: keyframeRow(asset.id, 1),
        lockedPropertiesBehavior: 'skip',
      });

      await expect(
        ctx.database.selectFrom('asset_keyframe').selectAll().where('assetId', '=', asset.id).executeTakeFirstOrThrow(),
      ).resolves.toEqual(keyframeRow(asset.id, 1));
    });

    // A probe that could not read a stream sends no object at all, and that must
    // not be read as "delete what is already known".
    it('should leave stored media metadata alone when an extraction omits it', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await sut.upsertExif({
        exif: { assetId: asset.id, description: 'first' },
        audio: audioRow(asset.id, 2),
        lockedPropertiesBehavior: 'skip',
      });
      await sut.upsertExif({
        exif: { assetId: asset.id, description: 'second' },
        lockedPropertiesBehavior: 'skip',
      });

      await expect(
        ctx.database.selectFrom('asset_audio').selectAll().where('assetId', '=', asset.id).executeTakeFirstOrThrow(),
      ).resolves.toEqual(audioRow(asset.id, 2));
    });
    it('should append to locked columns', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({
        assetId: asset.id,
        dateTimeOriginal: '2023-11-19T18:11:00',
        lockedProperties: ['dateTimeOriginal'],
      });

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: ['dateTimeOriginal'] });

      await sut.upsertExif({
        exif: { assetId: asset.id, lockedProperties: ['description'] },
        lockedPropertiesBehavior: 'append',
      });

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: ['description', 'dateTimeOriginal'] });
    });

    it('should deduplicate locked columns', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({
        assetId: asset.id,
        dateTimeOriginal: '2023-11-19T18:11:00',
        lockedProperties: ['dateTimeOriginal', 'description'],
      });

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: ['dateTimeOriginal', 'description'] });

      await sut.upsertExif({
        exif: { assetId: asset.id, lockedProperties: ['description'] },
        lockedPropertiesBehavior: 'append',
      });

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: ['description', 'dateTimeOriginal'] });
    });
  });

  describe('stale asset job writes', () => {
    it('should ignore job status upserts for assets deleted by another worker', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await sut.remove(asset);

      await expect(sut.upsertJobStatus({ assetId: asset.id, metadataExtractedAt: new Date() })).resolves.toBe(
        undefined,
      );
      await expect(
        ctx.database
          .selectFrom('asset_job_status')
          .select('assetId')
          .where('assetId', '=', asset.id)
          .executeTakeFirst(),
      ).resolves.toBeUndefined();
    });

    it('should ignore file upserts for assets deleted by another worker', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await sut.remove(asset);

      await expect(
        sut.upsertFile({ assetId: asset.id, type: AssetFileType.Preview, path: 'preview.jpg' }),
      ).resolves.toBe(undefined);
      await expect(
        ctx.database.selectFrom('asset_file').select('assetId').where('assetId', '=', asset.id).executeTakeFirst(),
      ).resolves.toBeUndefined();
    });

    it('should keep valid job status upserts when a bulk write includes a deleted asset', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: deletedAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: existingAsset } = await ctx.newAsset({ ownerId: user.id });
      const metadataExtractedAt = new Date();

      await sut.remove(deletedAsset);

      await expect(
        sut.upsertJobStatus(
          { assetId: deletedAsset.id, metadataExtractedAt },
          { assetId: existingAsset.id, metadataExtractedAt },
        ),
      ).resolves.toBe(undefined);
      await expect(
        ctx.database
          .selectFrom('asset_job_status')
          .select(['assetId', 'metadataExtractedAt'])
          .where('assetId', '=', existingAsset.id)
          .executeTakeFirst(),
      ).resolves.toEqual({ assetId: existingAsset.id, metadataExtractedAt });
    });

    it('should keep valid file upserts when a bulk write includes a deleted asset', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: deletedAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: existingAsset } = await ctx.newAsset({ ownerId: user.id });

      await sut.remove(deletedAsset);

      await expect(
        sut.upsertFiles([
          { assetId: deletedAsset.id, type: AssetFileType.Preview, path: 'deleted-preview.jpg' },
          { assetId: existingAsset.id, type: AssetFileType.Preview, path: 'existing-preview.jpg' },
        ]),
      ).resolves.toBe(undefined);
      await expect(
        ctx.database
          .selectFrom('asset_file')
          .select(['assetId', 'path'])
          .where('assetId', '=', existingAsset.id)
          .executeTakeFirst(),
      ).resolves.toEqual({ assetId: existingAsset.id, path: 'existing-preview.jpg' });
    });
  });

  describe('unlockProperties', () => {
    it('should unlock one property', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({
        assetId: asset.id,
        dateTimeOriginal: '2023-11-19T18:11:00',
        lockedProperties: ['dateTimeOriginal', 'description'],
      });

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: ['dateTimeOriginal', 'description'] });

      await sut.unlockProperties(asset.id, ['dateTimeOriginal']);

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: ['description'] });
    });

    it('should unlock all properties', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({
        assetId: asset.id,
        dateTimeOriginal: '2023-11-19T18:11:00',
        lockedProperties: ['dateTimeOriginal', 'description'],
      });

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: ['dateTimeOriginal', 'description'] });

      await sut.unlockProperties(asset.id, ['description', 'dateTimeOriginal']);

      await expect(
        ctx.database
          .selectFrom('asset_exif')
          .select('lockedProperties')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ lockedProperties: null });
    });
  });

  describe('createAll', () => {
    it('should return an empty array when given an empty input', async () => {
      const { sut } = setup();
      await expect(sut.createAll([])).resolves.toStrictEqual([]);
  describe('people filters use AND semantics', () => {
    it('requires every selected person for time bucket assets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });
      const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });

      await createTimelineAssetWithPeople(ctx, user.id, [alice.id]);
      await createTimelineAssetWithPeople(ctx, user.id, [bob.id]);
      const both = await createTimelineAssetWithPeople(ctx, user.id, [alice.id, bob.id]);

      const bucket = await sut.getTimeBucket(
        '2026-03-01',
        {
          userIds: [user.id],
          personIds: [alice.id, bob.id],
          visibility: AssetVisibility.Timeline,
        },
        auth,
      );

      const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
      expect(assets.id).toEqual([both.id]);
    });

    it('treats duplicate selected person ids as one selected person', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });
      const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      const asset = await createTimelineAssetWithPeople(ctx, user.id, [alice.id]);

      const bucket = await sut.getTimeBucket(
        '2026-03-01',
        {
          userIds: [user.id],
          personIds: [alice.id, alice.id],
          visibility: AssetVisibility.Timeline,
        },
        auth,
      );

      const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
      expect(assets.id).toEqual([asset.id]);
    });

    it('requires every selected space person for time bucket assets', async () => {
      const { ctx, sut } = setup();
      const sharedSpaceRepo = ctx.get(SharedSpaceRepository);
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const bucketDate = new Date('2026-03-15T12:00:00.000Z');

      const aliceOnly = await createTimelineAssetWithPeople(ctx, user.id, [], bucketDate);
      const bobOnly = await createTimelineAssetWithPeople(ctx, user.id, [], bucketDate);
      const both = await createTimelineAssetWithPeople(ctx, user.id, [], bucketDate);

      const { assetFace: aliceOnlyFace } = await ctx.newAssetFace({ assetId: aliceOnly.id, isVisible: true });
      const { assetFace: bobOnlyFace } = await ctx.newAssetFace({ assetId: bobOnly.id, isVisible: true });
      const { assetFace: bothAliceFace } = await ctx.newAssetFace({ assetId: both.id, isVisible: true });
      const { assetFace: bothBobFace } = await ctx.newAssetFace({ assetId: both.id, isVisible: true });

      const alice = await sharedSpaceRepo.createPerson({
        spaceId: space.id,
        name: 'Alice',
        representativeFaceId: aliceOnlyFace.id,
        type: 'person',
      });
      const bob = await sharedSpaceRepo.createPerson({
        spaceId: space.id,
        name: 'Bob',
        representativeFaceId: bobOnlyFace.id,
        type: 'person',
      });
      await sharedSpaceRepo.addPersonFaces(
        [
          { personId: alice.id, assetFaceId: aliceOnlyFace.id },
          { personId: bob.id, assetFaceId: bobOnlyFace.id },
          { personId: alice.id, assetFaceId: bothAliceFace.id },
          { personId: bob.id, assetFaceId: bothBobFace.id },
        ],
        { skipRecount: true },
      );

      const bucket = await sut.getTimeBucket(
        '2026-03-01',
        {
          userIds: [user.id],
          spacePersonIds: [alice.id, bob.id],
          visibility: AssetVisibility.Timeline,
        },
        auth,
      );

      const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
      expect(assets.id).toEqual([both.id]);
    });

    it('treats duplicate selected space person ids as one selected space person', async () => {
      const { ctx, sut } = setup();
      const sharedSpaceRepo = ctx.get(SharedSpaceRepository);
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const asset = await createTimelineAssetWithPeople(ctx, user.id, []);
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, isVisible: true });
      const alice = await sharedSpaceRepo.createPerson({
        spaceId: space.id,
        name: 'Alice',
        representativeFaceId: assetFace.id,
        type: 'person',
      });
      await sharedSpaceRepo.addPersonFaces([{ personId: alice.id, assetFaceId: assetFace.id }], { skipRecount: true });

      const bucket = await sut.getTimeBucket(
        '2026-03-01',
        {
          userIds: [user.id],
          spacePersonIds: [alice.id, alice.id],
          visibility: AssetVisibility.Timeline,
        },
        auth,
      );

      const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
      expect(assets.id).toEqual([asset.id]);
    });

    it('requires every selected identity for time bucket assets', async () => {
      const { ctx, sut } = setup();
      const faceIdentityRepository = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });
      const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
      const aliceIdentity = await faceIdentityRepository.ensurePersonIdentity(alice.id);
      const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);

      const aliceOnly = await createTimelineAssetWithPeople(ctx, user.id, [], new Date('2026-03-15T12:00:00.000Z'));
      const bobOnly = await createTimelineAssetWithPeople(ctx, user.id, [], new Date('2026-03-15T12:00:00.000Z'));
      const both = await createTimelineAssetWithPeople(ctx, user.id, [], new Date('2026-03-15T12:00:00.000Z'));

      const { assetFace: aliceOnlyFace } = await ctx.newAssetFace({ assetId: aliceOnly.id, personId: alice.id });
      const { assetFace: bobOnlyFace } = await ctx.newAssetFace({ assetId: bobOnly.id, personId: bob.id });
      const { assetFace: bothAliceFace } = await ctx.newAssetFace({ assetId: both.id, personId: alice.id });
      const { assetFace: bothBobFace } = await ctx.newAssetFace({ assetId: both.id, personId: bob.id });

      await faceIdentityRepository.linkFace({
        assetFaceId: aliceOnlyFace.id,
        identityId: aliceIdentity.id,
        source: 'manual',
      });
      await faceIdentityRepository.linkFace({
        assetFaceId: bobOnlyFace.id,
        identityId: bobIdentity.id,
        source: 'manual',
      });
      await faceIdentityRepository.linkFace({
        assetFaceId: bothAliceFace.id,
        identityId: aliceIdentity.id,
        source: 'manual',
      });
      await faceIdentityRepository.linkFace({
        assetFaceId: bothBobFace.id,
        identityId: bobIdentity.id,
        source: 'manual',
      });

      const bucket = await sut.getTimeBucket(
        '2026-03-01',
        {
          userIds: [user.id],
          identityIds: [aliceIdentity.id, bobIdentity.id],
          visibility: AssetVisibility.Timeline,
        },
        auth,
      );

      const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
      expect(assets.id).toEqual([both.id]);
    });

    it('treats duplicate selected identity ids as one selected identity', async () => {
      const { ctx, sut } = setup();
      const faceIdentityRepository = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });
      const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      const identity = await faceIdentityRepository.ensurePersonIdentity(alice.id);
      const asset = await createTimelineAssetWithPeople(ctx, user.id, []);
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alice.id, isVisible: true });
      await faceIdentityRepository.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'manual' });

      const bucket = await sut.getTimeBucket(
        '2026-03-01',
        {
          userIds: [user.id],
          identityIds: [identity.id, identity.id],
          visibility: AssetVisibility.Timeline,
        },
        auth,
      );

      const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
      expect(assets.id).toEqual([asset.id]);
    });

    it('counts multiple visible faces for the same person as one selected person', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });
      const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
      const asset = await createTimelineAssetWithPeople(ctx, user.id, [alice.id, alice.id, bob.id]);

      const bucket = await sut.getTimeBucket(
        '2026-03-01',
        {
          userIds: [user.id],
          personIds: [alice.id, bob.id],
          visibility: AssetVisibility.Timeline,
        },
        auth,
      );

      const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
      expect(assets.id).toEqual([asset.id]);
    });

    it('requires every selected person when counting time buckets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person: alice } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });

      await createTimelineAssetWithPeople(ctx, user.id, [alice.id]);
      await createTimelineAssetWithPeople(ctx, user.id, [bob.id]);
      await createTimelineAssetWithPeople(ctx, user.id, [alice.id, bob.id]);

      await expect(
        sut.getTimeBuckets({
          userIds: [user.id],
          personIds: [alice.id, bob.id],
          visibility: AssetVisibility.Timeline,
        }),
      ).resolves.toEqual([expect.objectContaining({ count: 1, timeBucket: '2026-03-01' })]);
    });
  });

  describe('getTimeBucket — tag navigation with shared-space access (issue #647)', () => {
    it('returns an owner-tagged asset to a member only when the shared-space scope is included', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const memberAuth = factory.auth({ user: { id: member.id } });
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });

      // Owner tags their own asset and shares it into the space the member belongs to.
      const asset = await createTimelineAssetWithPeople(ctx, owner.id, []);
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
      // upsertValue (not create) so tag_closure is populated — the tag-id timeline filter
      // (withAnyTagId) joins through tag_closure, matching production's tag creation path.
      const tag = await ctx.get(TagRepository).upsertValue({ userId: owner.id, value: 'family' });
      await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [asset.id] });

      // Mirrors what the tags page now sends for a non-admin member (own + shared-space
      // assets, tag-filtered): the owner's tagged asset must show up.
      const withSpace = await sut.getTimeBucket(
        '2026-03-01',
        {
          userIds: [member.id],
          timelineSpaceIds: [space.id],
          tagIds: [tag.id],
          visibility: AssetVisibility.Timeline,
        },
        memberAuth,
      );
      expect((JSON.parse(withSpace.assets) as TimeBucketAssets).id).toEqual([asset.id]);

      // Without the shared-space scope the member only sees their own assets — none here.
      const ownOnly = await sut.getTimeBucket(
        '2026-03-01',
        { userIds: [member.id], tagIds: [tag.id], visibility: AssetVisibility.Timeline },
        memberAuth,
      );
      expect((JSON.parse(ownOnly.assets) as TimeBucketAssets).id ?? []).not.toContain(asset.id);
    });
  });

  // C5 investigation resolved SAFE: the album arm is not a divergence surface for trash/stack —
  // both are filtered/collapsed once at the `asset` root (withTimeBucketAssetFilters), uniformly
  // across every arm (direct / library / album), matching the normal (non-space) album grid which
  // uses the same getTimeBucket `albumId` path. Pin it so a future album-arm rewrite can't silently
  // start over/under-surfacing trashed or stacked album assets in the space timeline.
  describe('getTimeBucket — C5 album-arm trash + stack parity', () => {
    it('a soft-deleted album asset drops out of the space timeline bucket (album-linked-into-space path)', async () => {
      const { ctx, sut } = setup();
      const sharedSpaceRepo = ctx.get(SharedSpaceRepository);
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const memberAuth = factory.auth({ user: { id: member.id } });
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });

      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'C5TrashParityAlbum' });
      const bucketDate = new Date('2026-04-15T12:00:00.000Z');
      const alive = await createTimelineAsset(ctx, owner.id, bucketDate);
      const trashed = await createTimelineAsset(ctx, owner.id, bucketDate, { deletedAt: new Date() });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: alive.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: trashed.id });
      await sharedSpaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

      const bucket = await sut.getTimeBucket(
        '2026-04-01',
        {
          userIds: [member.id],
          timelineSpaceIds: [space.id],
          visibility: AssetVisibility.Timeline,
        },
        memberAuth,
      );

      const ids = (JSON.parse(bucket.assets) as TimeBucketAssets).id ?? [];
      expect(ids).toContain(alive.id);
      expect(ids).not.toContain(trashed.id);
    });

    it('collapses a stacked child album asset in the space timeline bucket, matching the normal album grid', async () => {
      const { ctx, sut } = setup();
      const sharedSpaceRepo = ctx.get(SharedSpaceRepository);
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const ownerAuth = factory.auth({ user: { id: owner.id } });
      const memberAuth = factory.auth({ user: { id: member.id } });
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });

      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'C5StackParityAlbum' });
      const bucketDate = new Date('2026-04-15T12:00:00.000Z');
      const primary = await createTimelineAsset(ctx, owner.id, bucketDate);
      const child = await createTimelineAsset(ctx, owner.id, bucketDate);
      await ctx.newAlbumAsset({ albumId: album.id, assetId: primary.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: child.id });
      await ctx.newStack({ ownerId: owner.id }, [primary.id, child.id]);
      await sharedSpaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

      // Space timeline bucket (album-linked-into-space path), requested by a non-owner member —
      // isolates the album arm since the member owns nothing directly.
      const spaceBucket = await sut.getTimeBucket(
        '2026-04-01',
        {
          userIds: [member.id],
          timelineSpaceIds: [space.id],
          visibility: AssetVisibility.Timeline,
          withStacked: true,
        },
        memberAuth,
      );
      const spaceIds = (JSON.parse(spaceBucket.assets) as TimeBucketAssets).id ?? [];

      // Normal (non-space) album grid for the identical fixture.
      const albumBucket = await sut.getTimeBucket(
        '2026-04-01',
        {
          userIds: [owner.id],
          albumId: album.id,
          visibility: AssetVisibility.Timeline,
          withStacked: true,
        },
        ownerAuth,
      );
      const albumIds = (JSON.parse(albumBucket.assets) as TimeBucketAssets).id ?? [];

      expect(spaceIds).toEqual([primary.id]);
      expect(spaceIds).not.toContain(child.id);
      expect(albumIds).toEqual(spaceIds);
    });
  });

  // H1 belt-and-suspenders: timeline.service.ts's timeBucketChecks already rejects
  // isTrashed=true on an albumId browse at the service boundary (Slice 1 / H1). This test calls
  // the repository directly with an options shape that can only reach it if that guard is
  // bypassed, proving the album arm's own `deletedAt IS NULL` gate holds independently.
  describe('getTimeBucket — album arm trash gate belt-and-suspenders (Slice 1 / H1)', () => {
    it('never surfaces a trashed album asset via the explicit albumId arm, even with isTrashed=true', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'H1BeltAlbum' });
      const bucketDate = new Date('2026-04-15T12:00:00.000Z');
      const alive = await createTimelineAsset(ctx, owner.id, bucketDate);
      const trashed = await createTimelineAsset(ctx, owner.id, bucketDate, { deletedAt: new Date() });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: alive.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: trashed.id });

      const ownerAuth = factory.auth({ user: { id: owner.id } });

      const bucket = await sut.getTimeBucket(
        '2026-04-01',
        {
          userIds: [owner.id],
          albumId: album.id,
          visibility: AssetVisibility.Timeline,
          isTrashed: true,
        },
        ownerAuth,
      );

      const ids = (JSON.parse(bucket.assets) as TimeBucketAssets).id ?? [];
      // The top-level isTrashed ternary already excludes `alive` (no deletedAt); the album arm's
      // own gate must ALSO exclude `trashed` — pre-fix, the album arm had no deletedAt condition,
      // so `trashed` alone satisfied `deletedAt IS NOT NULL AND album_asset match`, leaking it.
      expect(ids).toEqual([]);
    });
  });

  describe('getTimeBucket with spacePersonIds', () => {
    it('should only return assets whose matching face is visible and not deleted when filtering by spacePersonId', async () => {
      const { ctx, sut } = setup();
      const sharedSpaceRepo = ctx.get(SharedSpaceRepository);

      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });
      const { space } = await ctx.newSharedSpace({ createdById: user.id });

      const bucketDate = new Date('2026-03-15T12:00:00.000Z');
      const assetInput = {
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        fileCreatedAt: bucketDate,
        localDateTime: bucketDate,
      };

      const { asset: assetVisible } = await ctx.newAsset(assetInput);
      const { asset: assetInvisibleFace } = await ctx.newAsset(assetInput);
      const { asset: assetDeletedFace } = await ctx.newAsset(assetInput);

      await Promise.all([
        ctx.newExif({ assetId: assetVisible.id, timeZone: 'UTC' }),
        ctx.newExif({ assetId: assetInvisibleFace.id, timeZone: 'UTC' }),
        ctx.newExif({ assetId: assetDeletedFace.id, timeZone: 'UTC' }),
      ]);

      const { assetFace: visibleFace } = await ctx.newAssetFace({ assetId: assetVisible.id, isVisible: true });
      const { assetFace: invisibleFace } = await ctx.newAssetFace({
        assetId: assetInvisibleFace.id,
        isVisible: false,
      });
      const { assetFace: deletedFace } = await ctx.newAssetFace({
        assetId: assetDeletedFace.id,
        isVisible: true,
        deletedAt: new Date(),
      });

      const spacePerson = await sharedSpaceRepo.createPerson({
        spaceId: space.id,
        name: 'Test',
        representativeFaceId: visibleFace.id,
        type: 'person',
      });
      await sharedSpaceRepo.addPersonFaces(
        [
          { personId: spacePerson.id, assetFaceId: visibleFace.id },
          { personId: spacePerson.id, assetFaceId: invisibleFace.id },
          { personId: spacePerson.id, assetFaceId: deletedFace.id },
        ],
        { skipRecount: true },
      );

      const bucket = await sut.getTimeBucket(
        '2026-03-01',
        {
          userIds: [user.id],
          spacePersonIds: [spacePerson.id],
          visibility: AssetVisibility.Timeline,
        },
        auth,
      );

      const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
      expect(assets.id.toSorted()).toEqual([assetVisible.id]);
    });

    it('should filter time bucket assets by face identity ids', async () => {
      const { ctx, sut } = setup();
      const faceIdentityRepository = ctx.get(FaceIdentityRepository);

      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });

      const bucketDate = new Date('2026-03-15T12:00:00.000Z');
      const assetInput = {
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        fileCreatedAt: bucketDate,
        localDateTime: bucketDate,
      };

      const { asset: matchingAsset } = await ctx.newAsset(assetInput);
      const { asset: nonMatchingAsset } = await ctx.newAsset(assetInput);
      await Promise.all([
        ctx.newExif({ assetId: matchingAsset.id, timeZone: 'UTC' }),
        ctx.newExif({ assetId: nonMatchingAsset.id, timeZone: 'UTC' }),
      ]);

      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      const { assetFace } = await ctx.newAssetFace({ assetId: matchingAsset.id, personId: person.id, isVisible: true });
      const identity = await faceIdentityRepository.ensurePersonIdentity(person.id);
      await faceIdentityRepository.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'manual' });

      const bucket = await sut.getTimeBucket(
        '2026-03-01',
        {
          userIds: [user.id],
          identityIds: [identity.id],
          visibility: AssetVisibility.Timeline,
        },
        auth,
      );

      const assets = JSON.parse(bucket.assets) as TimeBucketAssets;
      expect(assets.id).toEqual([matchingAsset.id]);
    });
  });
});
