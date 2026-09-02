import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { AssetFileType, AssetType, AssetVisibility, MemoryType, UserMetadataKey } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MemoryRepository } from 'src/repositories/memory.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { ThemeSearchAsset, ThemeSearchPort } from 'src/services/memory-rules/theme-search.port';
import { MemoryService, RULE_DAILY_LIMIT } from 'src/services/memory.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(MemoryService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      ConfigRepository,
      DatabaseRepository,
      MemoryRepository,
      PersonRepository,
      UserRepository,
      SystemMetadataRepository,
      UserRepository,
      PartnerRepository,
    ],
    mock: [LoggingRepository],
  });
};

const seedRuleAsset = async (
  ctx: ReturnType<typeof setup>['ctx'],
  {
    ownerId,
    localDateTime,
    city = null,
    country = null,
    isFavorite = false,
    type = AssetType.Image,
    duration = null,
    visibility = AssetVisibility.Timeline,
    withPreview = true,
  }: {
    ownerId: string;
    localDateTime: string;
    city?: string | null;
    country?: string | null;
    isFavorite?: boolean;
    type?: AssetType;
    duration?: number | null;
    visibility?: AssetVisibility;
    withPreview?: boolean;
  },
) => {
  const assetRepo = ctx.get(AssetRepository);
  const { asset } = await ctx.newAsset({ ownerId, localDateTime, isFavorite, type, duration, visibility });
  const files = [{ assetId: asset.id, type: AssetFileType.Thumbnail, path: `/thumb-${asset.id}.jpg` }];
  if (withPreview) {
    files.push({ assetId: asset.id, type: AssetFileType.Preview, path: `/preview-${asset.id}.jpg` });
  }
  await Promise.all([
    ctx.newExif({ assetId: asset.id, city, country }),
    ctx.newJobStatus({ assetId: asset.id }),
    assetRepo.upsertFiles(files),
  ]);
  return asset;
};

/**
 * A dormant person with a qualifying chapter: 4 assets in Jan 2020 (padding the lifetime total to
 * MIN_TOTAL_ASSETS (10) without competing for chapter density) plus a 6-day, one-photo-per-day
 * chapter in Aug 2023 (exactly MIN_CHAPTER_ASSETS (6), the only dense window). Both clusters sit
 * well before any dormancy cutoff used in this file's target dates (2026-02-13 or later).
 */
const seedDormantPersonChapter = async (
  ctx: ReturnType<typeof setup>['ctx'],
  {
    ownerId,
    name,
    overrides = {},
  }: { ownerId: string; name: string; overrides?: { type?: string; isHidden?: boolean } },
) => {
  const { person } = await ctx.newPerson({ ownerId, name, ...overrides });

  for (let hour = 10; hour < 14; hour++) {
    const asset = await seedRuleAsset(ctx, { ownerId, localDateTime: `2020-01-10T${hour}:00:00Z` });
    await ctx.newAssetFace({ assetId: asset.id, personId: person.id, isVisible: true });
  }

  const chapterAssetIds: string[] = [];
  for (let day = 5; day <= 10; day++) {
    const asset = await seedRuleAsset(ctx, { ownerId, localDateTime: `2023-08-${day}T12:00:00Z` });
    await ctx.newAssetFace({ assetId: asset.id, personId: person.id, isVisible: true });
    chapterAssetIds.push(asset.id);
  }

  return { person, chapterAssetIds };
};

describe(MemoryService.name, () => {
  beforeEach(async () => {
    defaultDatabase = await getKyselyDB();
  });

  // Each test opens its own connection pool (up to 10 conns) via getKyselyDB() and nothing
  // previously closed it, so pools accumulated for the lifetime of the whole file. With enough
  // tests in one file that exhausts Postgres's max_connections ("sorry, too many clients
  // already"). Close the pool after every test so at most one test's connections are open at a
  // time.
  afterEach(async () => {
    await defaultDatabase.destroy();
  });

  describe('create', () => {
    it('should create a new memory', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      const dto = {
        type: MemoryType.OnThisDay,
        data: { year: 2021 },
        memoryAt: new Date(2021),
      };

      await expect(sut.create(auth, dto)).resolves.toEqual({
        id: expect.any(String),
        type: dto.type,
        data: dto.data,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        isSaved: false,
        memoryAt: dto.memoryAt,
        ownerId: user.id,
        assets: [],
      });
    });

    it('should create a new memory (with assets)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset: asset1 } = await ctx.newAsset({ ownerId: user.id });
      const { asset: asset2 } = await ctx.newAsset({ ownerId: user.id });
      const auth = factory.auth({ user });
      const dto = {
        type: MemoryType.OnThisDay,
        data: { year: 2021 },
        memoryAt: new Date(2021),
        assetIds: [asset1.id, asset2.id],
      };

      await expect(sut.create(auth, dto)).resolves.toEqual(
        expect.objectContaining({
          id: expect.any(String),
          assets: [expect.objectContaining({ id: asset1.id }), expect.objectContaining({ id: asset2.id })],
        }),
      );
    });

    it('should create a new memory and ignore assets the user does not have access to', async () => {
      const { sut, ctx } = setup();
      const { user: user1 } = await ctx.newUser();
      const { user: user2 } = await ctx.newUser();
      const { asset: asset1 } = await ctx.newAsset({ ownerId: user1.id });
      const { asset: asset2 } = await ctx.newAsset({ ownerId: user2.id });
      const auth = factory.auth({ user: user1 });
      const dto = {
        type: MemoryType.OnThisDay,
        data: { year: 2021 },
        memoryAt: new Date(2021),
        assetIds: [asset1.id, asset2.id],
      };

      await expect(sut.create(auth, dto)).resolves.toEqual(
        expect.objectContaining({
          id: expect.any(String),
          assets: [expect.objectContaining({ id: asset1.id })],
        }),
      );
    });
  });

  describe('search', () => {
    it('should return memories containing assets visible through an album linked to a shared space', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'MemoryAlbum' });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });
      const { memory } = await ctx.newMemory({ ownerId: owner.id });
      await ctx.newMemoryAsset({ memoryId: memory.id, assetId: asset.id });

      await expect(sut.search(factory.auth({ user: member }), {})).resolves.toEqual([
        expect.objectContaining({
          id: memory.id,
          assets: [expect.objectContaining({ id: asset.id })],
        }),
      ]);
    });

    it('should return memories containing assets visible through a shared space', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const { memory } = await ctx.newMemory({ ownerId: owner.id });
      await ctx.newMemoryAsset({ memoryId: memory.id, assetId: asset.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });

      await expect(sut.search(factory.auth({ user: member }), {})).resolves.toEqual([
        expect.objectContaining({
          id: memory.id,
          assets: [expect.objectContaining({ id: asset.id })],
        }),
      ]);
    });
  });

  describe('onMemoryCreate', () => {
    it('should work on an empty database', async () => {
      const { sut } = setup();
      await expect(sut.onMemoriesCreate()).resolves.not.toThrow();
    });

    it('should create a memory from an asset', async () => {
      const { sut, ctx } = setup();
      const assetRepo = ctx.get(AssetRepository);
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2025, month: 2, day: 25 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime: now.minus({ years: 1 }).toISO() });
      await Promise.all([
        ctx.newExif({ assetId: asset.id, make: 'Canon' }),
        ctx.newJobStatus({ assetId: asset.id }),
        assetRepo.upsertFiles([
          { assetId: asset.id, type: AssetFileType.Preview, path: '/path/to/preview.jpg' },
          { assetId: asset.id, type: AssetFileType.Thumbnail, path: '/path/to/thumbnail.jpg' },
        ]),
      ]);

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, {});
      expect(memories.length).toBe(1);
      expect(memories[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          createdAt: expect.any(Date),
          memoryAt: expect.any(Date),
          updatedAt: expect.any(Date),
          deletedAt: null,
          ownerId: user.id,
          assets: expect.arrayContaining([expect.objectContaining({ id: asset.id })]),
          isSaved: false,
          showAt: now.startOf('day').toJSDate(),
          hideAt: now.endOf('day').toJSDate(),
          seenAt: null,
          type: 'on_this_day',
          data: { year: 2024 },
        }),
      );
    });

    it('should create a memory from an asset - in advance', async () => {
      const { sut, ctx } = setup();
      const assetRepo = ctx.get(AssetRepository);
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2035, month: 2, day: 26 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime: now.minus({ years: 1 }).toISO() });
      await Promise.all([
        ctx.newExif({ assetId: asset.id, make: 'Canon' }),
        ctx.newJobStatus({ assetId: asset.id }),
        assetRepo.upsertFiles([
          { assetId: asset.id, type: AssetFileType.Preview, path: '/path/to/preview.jpg' },
          { assetId: asset.id, type: AssetFileType.Thumbnail, path: '/path/to/thumbnail.jpg' },
        ]),
      ]);

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, {});
      expect(memories.length).toBe(1);
      expect(memories[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          createdAt: expect.any(Date),
          memoryAt: expect.any(Date),
          updatedAt: expect.any(Date),
          deletedAt: null,
          ownerId: user.id,
          assets: expect.arrayContaining([expect.objectContaining({ id: asset.id })]),
          isSaved: false,
          showAt: now.startOf('day').toJSDate(),
          hideAt: now.endOf('day').toJSDate(),
          seenAt: null,
          type: 'on_this_day',
          data: { year: 2034 },
        }),
      );
    });

    it('should not generate a memory twice for the same day', async () => {
      const { sut, ctx } = setup();
      const assetRepo = ctx.get(AssetRepository);
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2025, month: 2, day: 20 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();
      for (const dto of [
        {
          ownerId: user.id,
          localDateTime: now.minus({ year: 1 }).plus({ days: 3 }).toISO(),
        },
        {
          ownerId: user.id,
          localDateTime: now.minus({ year: 1 }).plus({ days: 4 }).toISO(),
        },
        {
          ownerId: user.id,
          localDateTime: now.minus({ year: 1 }).plus({ days: 5 }).toISO(),
        },
      ]) {
        const { asset } = await ctx.newAsset(dto);
        await Promise.all([
          ctx.newExif({ assetId: asset.id, make: 'Canon' }),
          ctx.newJobStatus({ assetId: asset.id }),
          assetRepo.upsertFiles([
            { assetId: asset.id, type: AssetFileType.Preview, path: '/path/to/preview.jpg' },
            { assetId: asset.id, type: AssetFileType.Thumbnail, path: '/path/to/thumbnail.jpg' },
          ]),
        ]);
      }

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const defaultMemories = await memoryRepo.search(user.id, {});
      expect(defaultMemories.length).toBe(0);

      const memories = await memoryRepo.search(user.id, { for: now.plus({ days: 3 }).toJSDate() });
      expect(memories.length).toBe(1);

      await sut.onMemoriesCreate();

      const memoriesAfter = await memoryRepo.search(user.id, { for: now.plus({ days: 3 }).toJSDate() });
      expect(memoriesAfter.length).toBe(1);
    });

    it('creates a birthday rule memory on the birthday itself', async () => {
      const { sut, ctx } = setup();
      const assetRepo = ctx.get(AssetRepository);
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 4, day: 23 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({
        ownerId: user.id,
        name: 'Alice',
        birthDate: new Date('1990-04-23T00:00:00Z'),
      });

      const addBirthdayAsset = async (localDateTime: string) => {
        const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime });
        await Promise.all([
          ctx.newExif({ assetId: asset.id, city: 'Berlin', country: 'Germany' }),
          ctx.newJobStatus({ assetId: asset.id }),
          ctx.newAssetFace({ assetId: asset.id, personId: person.id }),
          assetRepo.upsertFiles([
            { assetId: asset.id, type: AssetFileType.Preview, path: `/preview-${asset.id}.jpg` },
            { assetId: asset.id, type: AssetFileType.Thumbnail, path: `/thumb-${asset.id}.jpg` },
          ]),
        ]);
      };

      await addBirthdayAsset('2025-04-01T12:00:00Z');
      await addBirthdayAsset('2024-04-01T12:00:00Z');
      await addBirthdayAsset('2023-04-01T12:00:00Z');
      await addBirthdayAsset('2022-04-01T12:00:00Z');
      await addBirthdayAsset('2021-04-01T12:00:00Z');
      await addBirthdayAsset('2020-04-01T12:00:00Z');

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories).toEqual([
        expect.objectContaining({
          type: MemoryType.Rule,
          data: expect.objectContaining({
            ruleId: 'birthday',
            title: 'Happy birthday, Alice',
            subtitle: 'Photos from different years',
          }),
        }),
      ]);
    });

    it('creates a fallback birthday memory from four single-year Pierre photos', async () => {
      const { sut, ctx } = setup();
      const assetRepo = ctx.get(AssetRepository);
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 4, day: 24 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({
        ownerId: user.id,
        name: 'Pierre',
        birthDate: new Date('2025-04-24T00:00:00Z'),
      });
      const pierreAssetIds: string[] = [];

      const addPierreAsset = async (localDateTime: string) => {
        const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime });
        pierreAssetIds.push(asset.id);
        await Promise.all([
          ctx.newExif({ assetId: asset.id, city: 'Berlin', country: 'Germany' }),
          ctx.newJobStatus({ assetId: asset.id }),
          ctx.newAssetFace({ assetId: asset.id, personId: person.id }),
          assetRepo.upsertFiles([
            { assetId: asset.id, type: AssetFileType.Preview, path: `/preview-${asset.id}.jpg` },
            { assetId: asset.id, type: AssetFileType.Thumbnail, path: `/thumb-${asset.id}.jpg` },
          ]),
        ]);
      };

      await addPierreAsset('2026-04-18T15:25:07.335Z');
      await addPierreAsset('2026-04-18T15:25:08.244Z');
      await addPierreAsset('2026-04-18T15:25:09.803Z');
      await addPierreAsset('2026-04-18T15:25:11.543Z');

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories).toEqual([
        expect.objectContaining({
          type: MemoryType.Rule,
          data: expect.objectContaining({
            ruleId: 'birthday',
            title: 'Happy birthday, Pierre',
            subtitle: 'Recent photos of Pierre',
          }),
        }),
      ]);
      expect(memories[0]?.assets).toHaveLength(4);
      expect(memories[0]?.assets.map(({ id }) => id).toSorted()).toEqual([...pierreAssetIds].toSorted());
    });

    it('creates a recent-trip rule memory for a dense non-home cluster', async () => {
      const { sut, ctx } = setup();
      const assetRepo = ctx.get(AssetRepository);
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 4, day: 23 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      const addTripAsset = async ({
        localDateTime,
        city,
        country,
      }: {
        localDateTime: string;
        city: string;
        country: string;
      }) => {
        const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime });
        await Promise.all([
          ctx.newExif({ assetId: asset.id, city, country }),
          ctx.newJobStatus({ assetId: asset.id }),
          assetRepo.upsertFiles([
            { assetId: asset.id, type: AssetFileType.Preview, path: `/preview-${asset.id}.jpg` },
            { assetId: asset.id, type: AssetFileType.Thumbnail, path: `/thumb-${asset.id}.jpg` },
          ]),
        ]);
      };

      await addTripAsset({ localDateTime: '2026-01-15T12:00:00Z', city: 'Berlin', country: 'Germany' });
      await addTripAsset({ localDateTime: '2026-01-22T12:00:00Z', city: 'Berlin', country: 'Germany' });
      await addTripAsset({ localDateTime: '2026-02-01T12:00:00Z', city: 'Berlin', country: 'Germany' });
      await addTripAsset({ localDateTime: '2026-02-10T12:00:00Z', city: 'Berlin', country: 'Germany' });
      await addTripAsset({ localDateTime: '2026-02-18T12:00:00Z', city: 'Berlin', country: 'Germany' });
      await addTripAsset({ localDateTime: '2026-03-01T12:00:00Z', city: 'Berlin', country: 'Germany' });
      await addTripAsset({ localDateTime: '2026-03-12T12:00:00Z', city: 'Berlin', country: 'Germany' });
      await addTripAsset({ localDateTime: '2026-04-15T10:00:00Z', city: 'Paris', country: 'France' });
      await addTripAsset({ localDateTime: '2026-04-15T18:00:00Z', city: 'Paris', country: 'France' });
      await addTripAsset({ localDateTime: '2026-04-16T10:00:00Z', city: 'Paris', country: 'France' });
      await addTripAsset({ localDateTime: '2026-04-16T18:00:00Z', city: 'Paris', country: 'France' });
      await addTripAsset({ localDateTime: '2026-04-17T10:00:00Z', city: 'Paris', country: 'France' });
      await addTripAsset({ localDateTime: '2026-04-17T18:00:00Z', city: 'Paris', country: 'France' });
      await addTripAsset({ localDateTime: '2026-04-18T10:00:00Z', city: 'Paris', country: 'France' });

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: MemoryType.Rule,
            data: expect.objectContaining({
              ruleId: 'recent_trip',
              context: expect.objectContaining({ placeLabel: 'Paris, France' }),
            }),
          }),
        ]),
      );
    });

    it('reads back curated recent-trip assets in chronological localDateTime order', async () => {
      const { sut, ctx } = setup();
      const assetRepo = ctx.get(AssetRepository);
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 4, day: 23 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      const addTripAsset = async ({
        localDateTime,
        fileCreatedAt,
        city,
        country,
      }: {
        localDateTime: string;
        fileCreatedAt: string;
        city: string;
        country: string;
      }) => {
        const { asset } = await ctx.newAsset({
          ownerId: user.id,
          localDateTime: new Date(localDateTime),
          fileCreatedAt: new Date(fileCreatedAt),
        });
        await Promise.all([
          ctx.newExif({ assetId: asset.id, city, country }),
          ctx.newJobStatus({ assetId: asset.id }),
          assetRepo.upsertFiles([
            { assetId: asset.id, type: AssetFileType.Preview, path: `/preview-${asset.id}.jpg` },
            { assetId: asset.id, type: AssetFileType.Thumbnail, path: `/thumb-${asset.id}.jpg` },
          ]),
        ]);
        return asset.id;
      };

      await addTripAsset({
        localDateTime: '2026-01-15T12:00:00Z',
        fileCreatedAt: '2026-01-15T12:00:00Z',
        city: 'Berlin',
        country: 'Germany',
      });
      await addTripAsset({
        localDateTime: '2026-01-22T12:00:00Z',
        fileCreatedAt: '2026-01-22T12:00:00Z',
        city: 'Berlin',
        country: 'Germany',
      });
      await addTripAsset({
        localDateTime: '2026-02-01T12:00:00Z',
        fileCreatedAt: '2026-02-01T12:00:00Z',
        city: 'Berlin',
        country: 'Germany',
      });
      await addTripAsset({
        localDateTime: '2026-02-10T12:00:00Z',
        fileCreatedAt: '2026-02-10T12:00:00Z',
        city: 'Berlin',
        country: 'Germany',
      });
      await addTripAsset({
        localDateTime: '2026-02-18T12:00:00Z',
        fileCreatedAt: '2026-02-18T12:00:00Z',
        city: 'Berlin',
        country: 'Germany',
      });
      await addTripAsset({
        localDateTime: '2026-03-01T12:00:00Z',
        fileCreatedAt: '2026-03-01T12:00:00Z',
        city: 'Berlin',
        country: 'Germany',
      });
      await addTripAsset({
        localDateTime: '2026-03-12T12:00:00Z',
        fileCreatedAt: '2026-03-12T12:00:00Z',
        city: 'Berlin',
        country: 'Germany',
      });

      const expectedTripIds = [
        await addTripAsset({
          localDateTime: '2026-04-15T10:00:00Z',
          fileCreatedAt: '2026-04-16T20:00:00Z',
          city: 'Paris',
          country: 'France',
        }),
        await addTripAsset({
          localDateTime: '2026-04-15T10:01:00Z',
          fileCreatedAt: '2026-04-16T19:59:00Z',
          city: 'Paris',
          country: 'France',
        }),
        await addTripAsset({
          localDateTime: '2026-04-15T12:00:00Z',
          fileCreatedAt: '2026-04-16T19:58:00Z',
          city: 'Paris',
          country: 'France',
        }),
        await addTripAsset({
          localDateTime: '2026-04-15T12:01:00Z',
          fileCreatedAt: '2026-04-16T19:57:00Z',
          city: 'Paris',
          country: 'France',
        }),
        await addTripAsset({
          localDateTime: '2026-04-15T16:00:00Z',
          fileCreatedAt: '2026-04-16T19:56:00Z',
          city: 'Paris',
          country: 'France',
        }),
        await addTripAsset({
          localDateTime: '2026-04-16T09:00:00Z',
          fileCreatedAt: '2026-04-16T19:55:00Z',
          city: 'Paris',
          country: 'France',
        }),
        await addTripAsset({
          localDateTime: '2026-04-16T09:01:00Z',
          fileCreatedAt: '2026-04-16T19:54:00Z',
          city: 'Paris',
          country: 'France',
        }),
        await addTripAsset({
          localDateTime: '2026-04-16T13:00:00Z',
          fileCreatedAt: '2026-04-16T19:53:00Z',
          city: 'Paris',
          country: 'France',
        }),
        await addTripAsset({
          localDateTime: '2026-04-16T17:00:00Z',
          fileCreatedAt: '2026-04-16T19:52:00Z',
          city: 'Paris',
          country: 'France',
        }),
        await addTripAsset({
          localDateTime: '2026-04-16T20:00:00Z',
          fileCreatedAt: '2026-04-16T19:51:00Z',
          city: 'Paris',
          country: 'France',
        }),
      ];

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const [memory] = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memory?.data).toMatchObject({
        ruleId: 'recent_trip',
        context: { placeLabel: 'Paris, France' },
      });
      expect(memory?.assets).toHaveLength(7);
      expect(memory?.assets.map(({ id }) => id)).toEqual([
        expectedTripIds[0],
        expectedTripIds[2],
        expectedTripIds[4],
        expectedTripIds[5],
        expectedTripIds[7],
        expectedTripIds[8],
        expectedTripIds[9],
      ]);
      expect(memory?.assets.map(({ localDateTime }) => new Date(localDateTime).toISOString())).toEqual([
        '2026-04-15T10:00:00.000Z',
        '2026-04-15T12:00:00.000Z',
        '2026-04-15T16:00:00.000Z',
        '2026-04-16T09:00:00.000Z',
        '2026-04-16T13:00:00.000Z',
        '2026-04-16T17:00:00.000Z',
        '2026-04-16T20:00:00.000Z',
      ]);
    });

    it('does not create a recent-trip rule memory for weak signals', async () => {
      const { sut, ctx } = setup();
      const assetRepo = ctx.get(AssetRepository);
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 4, day: 23 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      const addWeakAsset = async (localDateTime: string, city: string, country: string) => {
        const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime });
        await Promise.all([
          ctx.newExif({ assetId: asset.id, city, country }),
          ctx.newJobStatus({ assetId: asset.id }),
          assetRepo.upsertFiles([
            { assetId: asset.id, type: AssetFileType.Preview, path: `/preview-${asset.id}.jpg` },
            { assetId: asset.id, type: AssetFileType.Thumbnail, path: `/thumb-${asset.id}.jpg` },
          ]),
        ]);
      };

      await addWeakAsset('2026-02-01T12:00:00Z', 'Berlin', 'Germany');
      await addWeakAsset('2026-03-01T12:00:00Z', 'Berlin', 'Germany');
      await addWeakAsset('2026-04-15T10:00:00Z', 'Paris', 'France');
      await addWeakAsset('2026-04-15T18:00:00Z', 'Paris', 'France');
      await addWeakAsset('2026-04-16T10:00:00Z', 'Paris', 'France');

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories).toEqual([]);
    });
  });

  describe('onMemoriesCreate — Tier 1 rules (end-to-end generation)', () => {
    it('creates a month_recap memory on the 1st with a 7-day visibility window', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 7, day: 1 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      // 12 ungeotagged July 2023 photos spread across days 5–16 (no city -> no on_this_day_place;
      // not on the ±3-day on-this-day window around Jul 1 -> no OnThisDay memory).
      const assetIds: string[] = [];
      for (let day = 5; day <= 16; day++) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime: `2023-07-${day}T12:00:00Z` });
        assetIds.push(asset.id);
      }

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories).toEqual([
        expect.objectContaining({
          type: MemoryType.Rule,
          memoryAt: expect.any(Date),
          showAt: now.startOf('day').toJSDate(),
          hideAt: now.startOf('day').plus({ days: 6 }).endOf('day').toJSDate(),
          data: expect.objectContaining({
            ruleId: 'month_recap',
            title: 'July 2023',
            subtitle: '12 photos',
            context: expect.objectContaining({ year: 2023, month: 7, count: 12 }),
          }),
        }),
      ]);
      expect(memories[0]?.assets.map(({ id }) => id).toSorted()).toEqual([...assetIds].toSorted());
      // still visible three days later, gone after the window
      expect(
        await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.plus({ days: 3 }).toJSDate() }),
      ).toHaveLength(1);
      expect(
        await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.plus({ days: 8 }).toJSDate() }),
      ).toHaveLength(0);
    });

    it('creates one on_this_day_place memory spanning the years the place recurs (1-day window)', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 7, day: 10 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      // Jul 10 2023: 6 Lisbon + 2 Porto -> Lisbon dominates 6/8 = 75%.
      // Jul 10 2021: 5 Lisbon          -> Lisbon dominates 5/5 = 100%.
      // Lisbon therefore spans two past years and earns a single card covering both.
      const lisbonIds: string[] = [];
      for (let i = 0; i < 6; i++) {
        const asset = await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2023-07-10T0${i}:00:00Z`,
          city: 'Lisbon',
          country: 'Portugal',
        });
        lisbonIds.push(asset.id);
      }
      for (let i = 0; i < 2; i++) {
        await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2023-07-10T1${i}:00:00Z`,
          city: 'Porto',
          country: 'Portugal',
        });
      }
      for (let i = 0; i < 5; i++) {
        const asset = await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2021-07-10T0${i}:00:00Z`,
          city: 'Lisbon',
          country: 'Portugal',
        });
        lisbonIds.push(asset.id);
      }

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories).toEqual([
        expect.objectContaining({
          type: MemoryType.Rule,
          showAt: now.startOf('day').toJSDate(),
          hideAt: now.endOf('day').toJSDate(), // single-day window
          // anchored to the most recent year it covers
          memoryAt: DateTime.fromISO('2023-07-10T00:00:00Z')!.toJSDate(),
          data: expect.objectContaining({
            ruleId: 'on_this_day_place',
            title: 'On this day in Lisbon',
            subtitle: '11 photos from 2021 and 2023',
            context: expect.objectContaining({
              city: 'Lisbon',
              country: 'Portugal',
              count: 11,
              years: [2021, 2023],
            }),
          }),
        }),
      ]);
      // only the dominant-city (Lisbon) assets are attached, from both years
      expect(memories[0]?.assets.map(({ id }) => id).toSorted()).toEqual([...lisbonIds].toSorted());

      // Lisbon covers 75% of 2023's day and 100% of 2021's, so the card stands in for BOTH
      // years' plain cards rather than sitting beside them holding the same photos.
      const onThisDay = await memoryRepo.search(user.id, { type: MemoryType.OnThisDay, for: now.toJSDate() });
      expect(onThisDay).toEqual([]);
    });

    it('does not create an on_this_day_place memory for a place seen in only one past year', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 7, day: 10 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      // A city-dominant day, but in 2023 alone — the plain "3 years ago" card already shows it.
      for (let i = 0; i < 8; i++) {
        await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2023-07-10T0${i}:00:00Z`,
          city: 'Lisbon',
          country: 'Portugal',
        });
      }

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      expect(await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() })).toEqual([]);
      const onThisDay = await memoryRepo.search(user.id, { type: MemoryType.OnThisDay, for: now.toJSDate() });
      expect(onThisDay).toEqual([expect.objectContaining({ data: { year: 2023 } })]);
    });

    it('supersedes only the years the place card covers, keeping the rest', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 7, day: 10 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      // 2023 is all Lisbon -> superseded. 2021 is 5 Lisbon + 5 ungeotagged: Lisbon is 100% of
      // that year's GEOTAGGED photos so the year still contributes, but the card holds only
      // half of what 2021 shot that day, so 2021's plain card must survive.
      for (let i = 0; i < 6; i++) {
        await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2023-07-10T0${i}:00:00Z`,
          city: 'Lisbon',
          country: 'Portugal',
        });
      }
      for (let i = 0; i < 5; i++) {
        await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2021-07-10T0${i}:00:00Z`,
          city: 'Lisbon',
          country: 'Portugal',
        });
      }
      for (let i = 0; i < 5; i++) {
        await seedRuleAsset(ctx, { ownerId: user.id, localDateTime: `2021-07-10T1${i}:00:00Z` });
      }

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const rules = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(rules).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({ ruleId: 'on_this_day_place', title: 'On this day in Lisbon' }),
        }),
      ]);

      const onThisDay = await memoryRepo.search(user.id, { type: MemoryType.OnThisDay, for: now.toJSDate() });
      expect(onThisDay).toEqual([expect.objectContaining({ data: { year: 2021 } })]);
    });
  });

  describe('onMemoriesCreate — people_together (end-to-end generation)', () => {
    it('creates a people_together memory for two people co-occurring across a past June', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 6, day: 20 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();
      const { person: anna } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
      const { person: ben } = await ctx.newPerson({ ownerId: user.id, name: 'Ben' });

      // 6 ungeotagged June 2023 photos across 6 distinct days (no city -> no on_this_day_place;
      // none of them land on day 20 -> no on_this_day_place either), both people in every photo.
      const assetIds: string[] = [];
      for (let day = 5; day <= 10; day++) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime: `2023-06-${day}T12:00:00Z` });
        await ctx.newAssetFace({ assetId: asset.id, personId: anna.id, isVisible: true });
        await ctx.newAssetFace({ assetId: asset.id, personId: ben.id, isVisible: true });
        assetIds.push(asset.id);
      }

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });

      // Title/dedupeKey/context are ordered by person id (D6) — the ids are random UUIDs, so
      // derive the expected order from the created people rather than hardcoding "Anna & Ben".
      const [first, second] = [anna, ben].toSorted((a, b) => (a.id === b.id ? 0 : a.id < b.id ? -1 : 1));

      expect(memories).toEqual([
        expect.objectContaining({
          type: MemoryType.Rule,
          memoryAt: expect.any(Date),
          showAt: now.startOf('day').toJSDate(),
          hideAt: now.startOf('day').plus({ days: 6 }).endOf('day').toJSDate(),
          data: expect.objectContaining({
            ruleId: 'people_together',
            title: `${first.name} & ${second.name}`,
            subtitle: '6 photos together · June 2023',
            context: expect.objectContaining({
              year: 2023,
              count: 6,
              personAId: first.id,
              personBId: second.id,
            }),
          }),
        }),
      ]);
      expect(memories[0]?.assets.map(({ id }) => id).toSorted()).toEqual([...assetIds].toSorted());
    });

    it('does not create a people_together memory below the minimum co-occurring photo count', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 6, day: 20 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();
      const { person: anna } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
      const { person: ben } = await ctx.newPerson({ ownerId: user.id, name: 'Ben' });

      // Only 5 co-occurring photos across 5 distinct days — below MIN_ASSETS (6).
      for (let day = 5; day <= 9; day++) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime: `2023-06-${day}T12:00:00Z` });
        await ctx.newAssetFace({ assetId: asset.id, personId: anna.id, isVisible: true });
        await ctx.newAssetFace({ assetId: asset.id, personId: ben.id, isVisible: true });
      }

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories.some((memory) => (memory.data as { ruleId?: string }).ruleId === 'people_together')).toBe(false);
    });
  });

  describe('onMemoriesCreate — Tier 3 rules (end-to-end generation)', () => {
    it('creates a video_moments rule memory for videos in the target month of a past year (day 8)', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 7, day: 8 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      // 3 videos in the 3s-180s duration band, filmed in July of a past year (2023).
      const videoIds: string[] = [];
      for (const day of [5, 10, 15]) {
        const asset = await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2023-07-${day}T12:00:00Z`,
          type: AssetType.Video,
          duration: 5000,
        });
        videoIds.push(asset.id);
      }

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories).toEqual([
        expect.objectContaining({
          type: MemoryType.Rule,
          data: expect.objectContaining({
            ruleId: 'video_moments',
            title: 'Video moments from July 2023',
            subtitle: '3 videos',
            context: expect.objectContaining({ year: 2023, month: 7, count: 3, favoriteCount: 0 }),
          }),
        }),
      ]);
      expect(memories[0]?.assets.map(({ id }) => id).toSorted()).toEqual([...videoIds].toSorted());
    });

    it('does not create a video_moments rule memory the day before the trigger day', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 7, day: 7 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      // Identical to the positive case above (band-qualifying videos), but evaluated on day 7 --
      // proves the TRIGGER_DAY gate, not the duration band.
      for (const day of [5, 10, 15]) {
        await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2023-07-${day}T12:00:00Z`,
          type: AssetType.Video,
          duration: 5000,
        });
      }

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories).toEqual([]);
    });

    it('does not create a video_moments rule memory for videos outside the duration band', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 7, day: 8 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      // Same day (8) and month/year pattern as the positive case, but every video is below
      // MIN_DURATION_MS -- proves the duration band, not the trigger day.
      for (const day of [5, 10, 15]) {
        await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2023-07-${day}T12:00:00Z`,
          type: AssetType.Video,
          duration: 1000,
        });
      }

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories).toEqual([]);
    });

    it('creates a trip_anniversary rule memory for a multi-day away cluster starting on the anniversary', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 7, day: 15 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      // Home baseline: a dominant Berlin/Germany cluster >=90 days before the anniversary
      // (2024-07-15), ending well before the GAP_DAYS pre-window.
      for (const localDateTime of [
        '2024-05-01T12:00:00Z',
        '2024-05-15T12:00:00Z',
        '2024-06-01T12:00:00Z',
        '2024-06-15T12:00:00Z',
        '2024-07-01T12:00:00Z',
      ]) {
        await seedRuleAsset(ctx, { ownerId: user.id, localDateTime, city: 'Berlin', country: 'Germany' });
      }

      // Away cluster: Paris/France, first day exactly on the anniversary, across 2 distinct days,
      // 7 assets total (meets MIN_TRIP_ASSETS/MIN_TRIP_DAYS exactly). The 3 day-1 assets also
      // satisfy the cheap on-this-day probe (>=3 geotagged, single dominant city).
      const parisIds: string[] = [];
      for (const localDateTime of ['2024-07-15T12:00:00Z', '2024-07-15T13:00:00Z', '2024-07-15T14:00:00Z']) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime, city: 'Paris', country: 'France' });
        parisIds.push(asset.id);
      }
      for (const localDateTime of [
        '2024-07-16T12:00:00Z',
        '2024-07-16T13:00:00Z',
        '2024-07-16T14:00:00Z',
        '2024-07-16T15:00:00Z',
      ]) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime, city: 'Paris', country: 'France' });
        parisIds.push(asset.id);
      }

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories).toEqual([
        expect.objectContaining({
          type: MemoryType.Rule,
          data: expect.objectContaining({
            ruleId: 'trip_anniversary',
            title: 'Your trip to Paris, France',
            subtitle: '2 years ago · 7 photos over 2 days',
            context: expect.objectContaining({
              year: 2024,
              country: 'France',
              city: 'Paris',
              assetCount: 7,
              dayCount: 2,
            }),
          }),
        }),
      ]);
      expect(memories[0]?.assets.map(({ id }) => id).toSorted()).toEqual([...parisIds].toSorted());
    });

    it('does not create a trip_anniversary rule memory when the away cluster spans a single day', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 7, day: 15 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      // Identical home baseline to the positive case above.
      for (const localDateTime of [
        '2024-05-01T12:00:00Z',
        '2024-05-15T12:00:00Z',
        '2024-06-01T12:00:00Z',
        '2024-06-15T12:00:00Z',
        '2024-07-01T12:00:00Z',
      ]) {
        await seedRuleAsset(ctx, { ownerId: user.id, localDateTime, city: 'Berlin', country: 'Germany' });
      }

      // Same 7-asset away cluster and same first day as the positive case, but ALL 7 assets fall
      // on that single day -> dayCount 1. Proves the MIN_TRIP_DAYS gate, not asset count or home.
      for (const localDateTime of [
        '2024-07-15T09:00:00Z',
        '2024-07-15T10:00:00Z',
        '2024-07-15T11:00:00Z',
        '2024-07-15T12:00:00Z',
        '2024-07-15T13:00:00Z',
        '2024-07-15T14:00:00Z',
        '2024-07-15T15:00:00Z',
      ]) {
        await seedRuleAsset(ctx, { ownerId: user.id, localDateTime, city: 'Paris', country: 'France' });
      }

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories.some((memory) => (memory.data as { ruleId?: string }).ruleId === 'trip_anniversary')).toBe(false);
    });

    it('creates a themed rule memory from a stubbed theme search port (day 22)', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 7, day: 22 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      // 8 assets in the target year (2025), spread across months that never land on month=7/day=22
      // so the place-based rules' on-this-day probe stays empty and doesn't compete for slots.
      const themeAssets: ThemeSearchAsset[] = [];
      for (const localDateTime of [
        '2025-01-10T12:00:00Z',
        '2025-03-05T12:00:00Z',
        '2025-05-20T12:00:00Z',
        '2025-06-11T12:00:00Z',
        '2025-08-02T12:00:00Z',
        '2025-09-14T12:00:00Z',
        '2025-11-03T12:00:00Z',
        '2025-12-25T12:00:00Z',
      ]) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime });
        themeAssets.push({ id: asset.id, localDateTime: new Date(localDateTime) });
      }

      const searchByEmbedding = vi.fn().mockResolvedValue(themeAssets);
      const stub: ThemeSearchPort = {
        resolveEmbedding: vi.fn().mockResolvedValue('embedding-stub'),
        searchByEmbedding,
      };
      // Instance-override of the protected factory seam: getThemeSearchPort() memoizes lazily on
      // first use, so the override must land before the first onMemoriesCreate() call.
      (sut as unknown as { createThemeSearchPort: () => ThemeSearchPort }).createThemeSearchPort = () => stub;

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories).toEqual([
        expect.objectContaining({
          type: MemoryType.Rule,
          data: expect.objectContaining({
            ruleId: 'themed',
            title: 'Sunsets from 2025',
            subtitle: '8 photos',
            context: expect.objectContaining({ year: 2025, theme: 'sunset', count: 8 }),
          }),
        }),
      ]);
      expect(memories[0]?.assets.map(({ id }) => id).toSorted()).toEqual(themeAssets.map(({ id }) => id).toSorted());
    });

    it('does not create a themed rule memory when the theme search port resolves no embedding', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 7, day: 22 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      const searchByEmbedding = vi.fn();
      const stub: ThemeSearchPort = {
        resolveEmbedding: vi.fn().mockResolvedValue(null),
        searchByEmbedding,
      };
      (sut as unknown as { createThemeSearchPort: () => ThemeSearchPort }).createThemeSearchPort = () => stub;

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories.some((memory) => (memory.data as { ruleId?: string }).ruleId === 'themed')).toBe(false);
      expect(searchByEmbedding).not.toHaveBeenCalled();
    });

    it('does not insert another rule memory when the daily slot budget is already full', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2026, month: 7, day: 8 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();

      // Data that would otherwise qualify for a video_moments memory today (see the positive
      // video_moments case above).
      for (const day of [5, 10, 15]) {
        await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2023-07-${day}T12:00:00Z`,
          type: AssetType.Video,
          duration: 5000,
        });
      }

      // Fill every daily slot with pre-existing rule memories already visible today.
      const showAt = now.startOf('day').toJSDate();
      const hideAt = now.endOf('day').toJSDate();
      const dummyRuleIds = Array.from({ length: RULE_DAILY_LIMIT }, (_, index) => `dummy_${index}`);
      for (const ruleId of dummyRuleIds) {
        await ctx.newMemory({
          ownerId: user.id,
          type: MemoryType.Rule,
          data: { ruleId, dedupeKey: `${ruleId}:x`, title: ruleId, subtitle: '', score: 1, context: {} },
          memoryAt: now.toJSDate(),
          showAt,
          hideAt,
        });
      }

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: now.toJSDate() });
      expect(memories).toHaveLength(RULE_DAILY_LIMIT);
      expect(memories.map((memory) => (memory.data as { ruleId: string }).ruleId).toSorted()).toEqual(
        dummyRuleIds.toSorted(),
      );
    });
  });

  describe('onMemoriesCreate — person_throwback (end-to-end generation)', () => {
    // Trigger day 13, per §3.5. Dormancy cutoff = personThrowbackDormancyMonths (default 6) before
    // this, i.e. 2026-02-13 -- every fixture's assets below (Jan 2020, Aug 2023) sit well before that.
    const target = DateTime.fromObject({ year: 2026, month: 8, day: 13 }, { zone: 'utc' }) as DateTime<true>;

    it('creates a person_throwback rule memory for a dormant named person with a dense chapter', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const { user } = await ctx.newUser();
      const { person, chapterAssetIds } = await seedDormantPersonChapter(ctx, { ownerId: user.id, name: 'Anna' });

      vi.setSystemTime(target.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: target.toJSDate() });
      expect(memories).toEqual([
        expect.objectContaining({
          type: MemoryType.Rule,
          memoryAt: expect.any(Date),
          showAt: target.startOf('day').toJSDate(),
          hideAt: target.startOf('day').plus({ days: 6 }).endOf('day').toJSDate(),
          data: expect.objectContaining({
            ruleId: 'person_throwback',
            title: `Times with ${person.name}`,
            subtitle: '6 photos · August 2023',
            context: expect.objectContaining({ personId: person.id, count: 6 }),
          }),
        }),
      ]);
      expect(memories[0]?.assets.map(({ id }) => id).toSorted()).toEqual([...chapterAssetIds].toSorted());
    });

    it('does not create a person_throwback memory when the person is a pet', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const { user } = await ctx.newUser();
      // Identical dormant-chapter fixture to the positive case above (10 total / 6-asset chapter),
      // except `person.type = 'pet'` -- proves the D7 pet exclusion, not some unrelated gap.
      await seedDormantPersonChapter(ctx, { ownerId: user.id, name: 'Rex', overrides: { type: 'pet' } });

      vi.setSystemTime(target.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: target.toJSDate() });
      expect(memories.some((memory) => (memory.data as { ruleId?: string }).ruleId === 'person_throwback')).toBe(false);
    });

    it('does not create a person_throwback memory when the person is hidden', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const { user } = await ctx.newUser();
      // Same otherwise-qualifying fixture, `person.isHidden = true` only.
      await seedDormantPersonChapter(ctx, { ownerId: user.id, name: 'Anna', overrides: { isHidden: true } });

      vi.setSystemTime(target.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: target.toJSDate() });
      expect(memories.some((memory) => (memory.data as { ruleId?: string }).ruleId === 'person_throwback')).toBe(false);
    });

    it('does not create a person_throwback memory when the person has no name', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const { user } = await ctx.newUser();
      // Same otherwise-qualifying fixture, `person.name = ''` only.
      await seedDormantPersonChapter(ctx, { ownerId: user.id, name: '' });

      vi.setSystemTime(target.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: target.toJSDate() });
      expect(memories.some((memory) => (memory.data as { ruleId?: string }).ruleId === 'person_throwback')).toBe(false);
    });

    it('still creates a person_throwback memory when recent photos exist but are archived', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const { user } = await ctx.newUser();
      const { person, chapterAssetIds } = await seedDormantPersonChapter(ctx, { ownerId: user.id, name: 'Anna' });

      // A recent (2026), otherwise-qualifying photo of Anna that is Archived, not Timeline. If the
      // dormancy query didn't filter visibility, this would push her last-seen date past the
      // cutoff and she would no longer look dormant.
      const recentArchived = await seedRuleAsset(ctx, {
        ownerId: user.id,
        localDateTime: '2026-07-01T12:00:00Z',
        visibility: AssetVisibility.Archive,
      });
      await ctx.newAssetFace({ assetId: recentArchived.id, personId: person.id, isVisible: true });

      vi.setSystemTime(target.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: target.toJSDate() });
      expect(memories).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            ruleId: 'person_throwback',
            subtitle: '6 photos · August 2023',
            context: expect.objectContaining({ count: 6 }),
          }),
        }),
      ]);
      expect(memories[0]?.assets.map(({ id }) => id).toSorted()).toEqual([...chapterAssetIds].toSorted());
    });

    it('excludes assets with no Preview file from both the dormancy count and the chapter', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const { user } = await ctx.newUser();

      // Anna qualifies on real (preview-bearing) data alone -- the standard 10-total/6-chapter
      // fixture. 6 no-preview decoys land on the SAME 6 chapter days (a different hour), so a
      // regression in either the density query (getMemoryPersonDailyCounts) or the final window
      // fetch (getMemoryAssetsForPersonWindow) would inflate the subtitle count and/or the
      // attached asset list past the real 6 -- both queries scan that identical date range.
      const { person: anna, chapterAssetIds } = await seedDormantPersonChapter(ctx, { ownerId: user.id, name: 'Anna' });
      for (const day of [5, 6, 7, 8, 9, 10]) {
        const asset = await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2023-08-${day}T18:00:00Z`,
          withPreview: false,
        });
        await ctx.newAssetFace({ assetId: asset.id, personId: anna.id, isVisible: true });
      }

      // Ben's only real (preview-bearing) history is a 6-asset chapter with no padding -- below
      // MIN_TOTAL_ASSETS (10) on its own. 8 more no-preview assets, on one day far from the
      // chapter, would push his lifetime total over 10 if getDormantPeople's own preview filter
      // didn't exclude them -- the chapter query still finds his real 6-asset Aug chapter either
      // way, so this isolates the dormancy-count filter specifically.
      const { person: ben } = await ctx.newPerson({ ownerId: user.id, name: 'Ben' });
      for (const day of [5, 6, 7, 8, 9, 10]) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime: `2023-08-${day}T12:00:00Z` });
        await ctx.newAssetFace({ assetId: asset.id, personId: ben.id, isVisible: true });
      }
      for (let hour = 10; hour < 18; hour++) {
        const asset = await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2020-01-10T${hour}:00:00Z`,
          withPreview: false,
        });
        await ctx.newAssetFace({ assetId: asset.id, personId: ben.id, isVisible: true });
      }

      vi.setSystemTime(target.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: target.toJSDate() });
      expect(memories).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            ruleId: 'person_throwback',
            title: `Times with ${anna.name}`,
            subtitle: '6 photos · August 2023',
          }),
        }),
      ]);
      expect(memories[0]?.assets.map(({ id }) => id).toSorted()).toEqual([...chapterAssetIds].toSorted());
    });

    it('excludes assets whose face is soft-deleted or invisible from the chapter', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const { user } = await ctx.newUser();

      // Anna qualifies on real (visible-face) data alone. 6 decoy assets land on the SAME 6
      // chapter days, each with a real Preview file but a face that is invisible or soft-deleted
      // for Anna -- if either the density query or the final window fetch wrongly counted them,
      // the subtitle count and/or attached asset list would balloon past the real 6.
      const { person: anna, chapterAssetIds } = await seedDormantPersonChapter(ctx, { ownerId: user.id, name: 'Anna' });
      for (const day of [5, 6, 7]) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime: `2023-08-${day}T18:00:00Z` });
        await ctx.newAssetFace({ assetId: asset.id, personId: anna.id, isVisible: false });
      }
      for (const day of [8, 9, 10]) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime: `2023-08-${day}T18:00:00Z` });
        await ctx.newAssetFace({ assetId: asset.id, personId: anna.id, isVisible: true, deletedAt: new Date() });
      }

      // Ben's only real (visible-face) history is a 6-asset chapter with no padding -- below
      // MIN_TOTAL_ASSETS on its own. 8 more assets far from the chapter, split between invisible
      // and soft-deleted faces, would push his lifetime total over 10 if getDormantPeople's own
      // face filters didn't exclude them.
      const { person: ben } = await ctx.newPerson({ ownerId: user.id, name: 'Ben' });
      for (const day of [5, 6, 7, 8, 9, 10]) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime: `2023-08-${day}T12:00:00Z` });
        await ctx.newAssetFace({ assetId: asset.id, personId: ben.id, isVisible: true });
      }
      for (let hour = 10; hour < 14; hour++) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime: `2020-01-10T${hour}:00:00Z` });
        await ctx.newAssetFace({ assetId: asset.id, personId: ben.id, isVisible: false });
      }
      for (let hour = 14; hour < 18; hour++) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime: `2020-01-10T${hour}:00:00Z` });
        await ctx.newAssetFace({ assetId: asset.id, personId: ben.id, isVisible: true, deletedAt: new Date() });
      }

      vi.setSystemTime(target.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: target.toJSDate() });
      expect(memories).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            ruleId: 'person_throwback',
            title: `Times with ${anna.name}`,
            subtitle: '6 photos · August 2023',
          }),
        }),
      ]);
      expect(memories[0]?.assets.map(({ id }) => id).toSorted()).toEqual([...chapterAssetIds].toSorted());
    });

    it('does not create a person_throwback memory when the user has the type toggled off', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const { user } = await ctx.newUser();
      await seedDormantPersonChapter(ctx, { ownerId: user.id, name: 'Anna' });
      await ctx.get(UserRepository).upsertMetadata(user.id, {
        key: UserMetadataKey.Preferences,
        value: { memories: { types: { person_throwback: false } } },
      });

      vi.setSystemTime(target.toJSDate());
      await sut.onMemoriesCreate();

      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: target.toJSDate() });
      expect(memories.some((memory) => (memory.data as { ruleId?: string }).ruleId === 'person_throwback')).toBe(false);
    });

    it('skips a person whose person_throwback already fired and uses a different dormant person instead', async () => {
      const { sut, ctx } = setup();
      const memoryRepo = ctx.get(MemoryRepository);
      const { user } = await ctx.newUser();

      // Anna's chapter (9 assets) is deliberately bigger than Ben's (6, the standard fixture), so
      // her score is STRICTLY higher (110 + 9*3 + 7 = 144 vs 110 + 6*3 + 7 = 135) -- deterministic
      // regardless of the two people's random UUID order, so the engine always considers Anna
      // first. That pins the dedupe skip on Anna specifically, rather than leaving the outcome to
      // coincide with the (unrelated) one-slot-per-multi-day-rule cap depending on which of two
      // equally-scored candidates happened to sort first.
      const { person: anna } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
      for (let hour = 10; hour < 14; hour++) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime: `2020-01-10T${hour}:00:00Z` });
        await ctx.newAssetFace({ assetId: asset.id, personId: anna.id, isVisible: true });
      }
      for (const day of [5, 6, 7, 8, 9, 10, 11, 12, 13]) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime: `2023-08-${day}T12:00:00Z` });
        await ctx.newAssetFace({ assetId: asset.id, personId: anna.id, isVisible: true });
      }

      const { person: ben } = await seedDormantPersonChapter(ctx, { ownerId: user.id, name: 'Ben' });

      // Anna's person_throwback already fired a year before `target`. Dates sit well outside
      // `target`'s search window, so this pre-existing memory doesn't itself occupy one of
      // today's rule slots -- the test isolates the dedupeKey skip (D8), not the slot cap.
      const dedupeKeyAnna = `person_throwback:${anna.id}`;
      const priorShowAt = DateTime.fromObject({ year: 2025, month: 8, day: 13 }, { zone: 'utc' });
      await ctx.newMemory({
        ownerId: user.id,
        type: MemoryType.Rule,
        data: {
          ruleId: 'person_throwback',
          dedupeKey: dedupeKeyAnna,
          title: `Times with ${anna.name}`,
          subtitle: '9 photos · August 2023',
          score: 144,
          context: { personId: anna.id, count: 9 },
        },
        memoryAt: priorShowAt.plus({ days: 2 }).toJSDate(),
        showAt: priorShowAt.toJSDate(),
        hideAt: priorShowAt.plus({ days: 6 }).endOf('day').toJSDate(),
      });

      vi.setSystemTime(target.toJSDate());
      await sut.onMemoriesCreate();

      // Only Ben's fresh memory shows up today -- Anna's dedupeKey already fired, so the engine
      // skips her (score-sorted first, since her chapter is bigger) and falls through to the next
      // dormant candidate the rule returned (D8).
      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: target.toJSDate() });
      expect(memories).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({ ruleId: 'person_throwback', title: `Times with ${ben.name}` }),
        }),
      ]);

      // Anna's original memory is still there, and only there -- exactly one, not a second copy.
      const priorMemories = await memoryRepo.search(user.id, {
        type: MemoryType.Rule,
        for: priorShowAt.plus({ days: 2 }).toJSDate(),
      });
      expect(priorMemories.map((memory) => (memory.data as { dedupeKey?: string }).dedupeKey)).toEqual([dedupeKeyAnna]);
    });
  });

  describe('onMemoriesCleanup', () => {
    it('should run without error', async () => {
      const { sut } = setup();
      await expect(sut.onMemoriesCleanup()).resolves.not.toThrow();
    });
  });
});
