import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { AssetFileType, AssetType, AssetVisibility, MemoryType, SystemMetadataKey, UserMetadataKey } from 'src/enum';
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
      // Three assets on the same target day: on_this_day's floor is 3 (unconditional -- spec
      // P3/§6.2), so a single asset would be generated then swept before this test could observe
      // it. See 'sweeps an on_this_day memory that holds fewer photos than its floor' below for
      // that case.
      const assetIds: string[] = [];
      for (let hour = 0; hour < 3; hour++) {
        const { asset } = await ctx.newAsset({
          ownerId: user.id,
          localDateTime: now.minus({ years: 1 }).plus({ hours: hour }).toISO(),
        });
        assetIds.push(asset.id);
        await Promise.all([
          ctx.newExif({ assetId: asset.id, make: 'Canon' }),
          ctx.newJobStatus({ assetId: asset.id }),
          assetRepo.upsertFiles([
            { assetId: asset.id, type: AssetFileType.Preview, path: `/path/to/preview-${asset.id}.jpg` },
            { assetId: asset.id, type: AssetFileType.Thumbnail, path: `/path/to/thumbnail-${asset.id}.jpg` },
          ]),
        ]);
      }

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
          assets: expect.arrayContaining(assetIds.map((id) => expect.objectContaining({ id }))),
          isSaved: false,
          showAt: now.startOf('day').toJSDate(),
          hideAt: now.endOf('day').toJSDate(),
          seenAt: null,
          type: 'on_this_day',
          data: { year: 2024 },
        }),
      );
      expect(memories[0]?.assets).toHaveLength(3);
    });

    it('should create a memory from an asset - in advance', async () => {
      const { sut, ctx } = setup();
      const assetRepo = ctx.get(AssetRepository);
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2035, month: 2, day: 26 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();
      // Three assets on the same target day -- see the floor comment in the previous test.
      const assetIds: string[] = [];
      for (let hour = 0; hour < 3; hour++) {
        const { asset } = await ctx.newAsset({
          ownerId: user.id,
          localDateTime: now.minus({ years: 1 }).plus({ hours: hour }).toISO(),
        });
        assetIds.push(asset.id);
        await Promise.all([
          ctx.newExif({ assetId: asset.id, make: 'Canon' }),
          ctx.newJobStatus({ assetId: asset.id }),
          assetRepo.upsertFiles([
            { assetId: asset.id, type: AssetFileType.Preview, path: `/path/to/preview-${asset.id}.jpg` },
            { assetId: asset.id, type: AssetFileType.Thumbnail, path: `/path/to/thumbnail-${asset.id}.jpg` },
          ]),
        ]);
      }

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
          assets: expect.arrayContaining(assetIds.map((id) => expect.objectContaining({ id }))),
          isSaved: false,
          showAt: now.startOf('day').toJSDate(),
          hideAt: now.endOf('day').toJSDate(),
          seenAt: null,
          type: 'on_this_day',
          data: { year: 2034 },
        }),
      );
      expect(memories[0]?.assets).toHaveLength(3);
    });

    it('should not generate a memory twice for the same day', async () => {
      const { sut, ctx } = setup();
      const assetRepo = ctx.get(AssetRepository);
      const memoryRepo = ctx.get(MemoryRepository);
      const now = DateTime.fromObject({ year: 2025, month: 2, day: 20 }, { zone: 'utc' }) as DateTime<true>;
      const { user } = await ctx.newUser();
      // All three assets land on the SAME target day (now + 3 days) so the resulting on_this_day
      // memory clears its floor of 3 -- see the floor comment on 'should create a memory from an
      // asset' above.
      for (const dto of [
        {
          ownerId: user.id,
          localDateTime: now.minus({ year: 1 }).plus({ days: 3, hours: 0 }).toISO(),
        },
        {
          ownerId: user.id,
          localDateTime: now.minus({ year: 1 }).plus({ days: 3, hours: 1 }).toISO(),
        },
        {
          ownerId: user.id,
          localDateTime: now.minus({ year: 1 }).plus({ days: 3, hours: 2 }).toISO(),
        },
      ]) {
        const { asset } = await ctx.newAsset(dto);
        await Promise.all([
          ctx.newExif({ assetId: asset.id, make: 'Canon' }),
          ctx.newJobStatus({ assetId: asset.id }),
          assetRepo.upsertFiles([
            { assetId: asset.id, type: AssetFileType.Preview, path: `/path/to/preview-${asset.id}.jpg` },
            { assetId: asset.id, type: AssetFileType.Thumbnail, path: `/path/to/thumbnail-${asset.id}.jpg` },
          ]),
        ]);
      }

      vi.setSystemTime(now.toJSDate());
      await sut.onMemoriesCreate();

      const defaultMemories = await memoryRepo.search(user.id, {});
      expect(defaultMemories.length).toBe(0);

      const memories = await memoryRepo.search(user.id, { for: now.plus({ days: 3 }).toJSDate() });
      expect(memories.length).toBe(1);
      expect(memories[0]?.assets).toHaveLength(3);

      await sut.onMemoriesCreate();

      const memoriesAfter = await memoryRepo.search(user.id, { for: now.plus({ days: 3 }).toJSDate() });
      expect(memoriesAfter.length).toBe(1);
      expect(memoriesAfter[0]?.assets).toHaveLength(3);
    });

    it('sweeps an on_this_day memory that holds fewer photos than its floor', async () => {
      // on_this_day's floor is 3 (`minAssets` on the 'on_this_day' entry in
      // `src/services/memory-rules/memory-type.metadata.ts`), applied unconditionally per spec
      // §6.2/P3 -- even with nothing else visible that day. This is deliberately what removes
      // the reporter's original 2-photo card, so pin it here rather than leaving it as an
      // incidental side effect of the overlap-reconciliation tests below.
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
      expect(memories).toEqual([]);
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
            context: expect.objectContaining({ personName: 'Alice', variant: 'across_years' }),
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
            context: expect.objectContaining({ personName: 'Pierre', variant: 'recent' }),
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
          data: expect.objectContaining({
            ruleId: 'on_this_day_place',
            context: expect.objectContaining({ city: 'Lisbon' }),
          }),
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
            context: expect.objectContaining({
              year: 2023,
              month: 6,
              count: 6,
              personAId: first.id,
              personAName: first.name,
              personBId: second.id,
              personBName: second.name,
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
            context: expect.objectContaining({
              year: 2024,
              yearsAgo: 2,
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
            context: expect.objectContaining({
              personId: person.id,
              personName: person.name,
              count: 6,
              month: 8,
              year: 2023,
            }),
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
            context: expect.objectContaining({ count: 6, month: 8, year: 2023 }),
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
            context: expect.objectContaining({ personName: anna.name, count: 6, month: 8, year: 2023 }),
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
            context: expect.objectContaining({ personName: anna.name, count: 6, month: 8, year: 2023 }),
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
      const annaChapterAssetIds: string[] = [];
      for (const day of [5, 6, 7, 8, 9, 10, 11, 12, 13]) {
        const asset = await seedRuleAsset(ctx, { ownerId: user.id, localDateTime: `2023-08-${day}T12:00:00Z` });
        await ctx.newAssetFace({ assetId: asset.id, personId: anna.id, isVisible: true });
        annaChapterAssetIds.push(asset.id);
      }

      const { person: ben } = await seedDormantPersonChapter(ctx, { ownerId: user.id, name: 'Ben' });

      // Anna's person_throwback already fired a year before `target`. Dates sit well outside
      // `target`'s search window, so this pre-existing memory doesn't itself occupy one of
      // today's rule slots -- the test isolates the dedupeKey skip (D8), not the slot cap.
      const dedupeKeyAnna = `person_throwback:${anna.id}`;
      const priorShowAt = DateTime.fromObject({ year: 2025, month: 8, day: 13 }, { zone: 'utc' });
      const { memory: annaMemory } = await ctx.newMemory({
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
      // The overlap sweep now enforces the person_throwback floor (4) unconditionally (spec P14:
      // a memory holding zero real assets is removed). A hand-built prior memory row with no
      // `memory_asset` rows would otherwise vanish during `onMemoriesCreate`'s history backfill
      // before the dedupe check ever runs, which is a test-fixture gap, not a production bug --
      // link Anna's real chapter assets (the same 9 the subtitle already claims) so the fixture
      // matches what a real person_throwback memory always has.
      for (const assetId of annaChapterAssetIds) {
        await ctx.newMemoryAsset({ memoryId: annaMemory.id, assetId });
      }

      vi.setSystemTime(target.toJSDate());
      await sut.onMemoriesCreate();

      // Only Ben's fresh memory shows up today -- Anna's dedupeKey already fired, so the engine
      // skips her (score-sorted first, since her chapter is bigger) and falls through to the next
      // dormant candidate the rule returned (D8).
      const memories = await memoryRepo.search(user.id, { type: MemoryType.Rule, for: target.toJSDate() });
      expect(memories).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            ruleId: 'person_throwback',
            context: expect.objectContaining({ personName: ben.name }),
          }),
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

  describe('onMemoriesCreate — overlap reconciliation (end-to-end)', () => {
    it('drops the thin overlapping cards on a modest library', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      // ~30 photos across September 2025, two of them on the 2nd.
      for (let index = 0; index < 30; index++) {
        await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2025-09-${String((index % 28) + 1).padStart(2, '0')}T12:00:00Z`,
        });
      }

      vi.setSystemTime(new Date('2026-09-01T02:00:00Z'));
      await sut.onMemoriesCreate();

      const memories = await sut.search(factory.auth({ user }), {});
      const titles = memories.map((memory) => memory.title);

      // The season recap claims first; the month recap starves out (it can only ever pick a
      // subset of the same September pool, and the season recap already claims the lot).
      expect(titles).toContain('Autumn 2025');
      expect(titles).not.toContain('September 2025');
    });

    it('keeps all three cards on a large library, with disjoint photos and different covers', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      for (let index = 0; index < 600; index++) {
        const month = 9 + Math.floor(index / 200);
        const day = (index % 28) + 1;
        await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00Z`,
        });
      }

      vi.setSystemTime(new Date('2026-09-01T02:00:00Z'));
      await sut.onMemoriesCreate();

      const memories = await sut.search(factory.auth({ user }), {});

      // All three of the reporter's cards survive: the season recap, the month recap (with
      // enough of the September pool left over after the season recap claims first), and the
      // plain on_this_day card (untitled — title is only set for MemoryType.Rule).
      const titles = memories.map((memory) => memory.title);
      expect(titles).toContain('Autumn 2025');
      expect(titles).toContain('September 2025');
      expect(memories).toHaveLength(3);

      const assetIdSets = memories.map((memory) => memory.assets.map((asset) => asset.id));

      // No photo appears in two memories.
      const all = assetIdSets.flat();
      expect(new Set(all).size).toBe(all.length);

      // Every cover is distinct — this is the reported symptom.
      const covers = assetIdSets.map((ids) => ids[0]);
      expect(new Set(covers).size).toBe(covers.length);
    });

    it('makes no further changes on a second run', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      for (let index = 0; index < 120; index++) {
        await seedRuleAsset(ctx, {
          ownerId: user.id,
          localDateTime: `2025-09-${String((index % 28) + 1).padStart(2, '0')}T12:00:00Z`,
        });
      }

      vi.setSystemTime(new Date('2026-09-01T02:00:00Z'));
      await sut.onMemoriesCreate();

      const snapshot = await ctx.database
        .selectFrom('memory_asset')
        .select(['memoriesId', 'assetId'])
        .orderBy('memoriesId')
        .orderBy('assetId')
        .execute();

      // Non-empty, so the equality below isn't vacuously true of two empty result sets.
      expect(snapshot.length).toBeGreaterThan(0);

      await sut.onMemoriesCreate();

      const after = await ctx.database
        .selectFrom('memory_asset')
        .select(['memoriesId', 'assetId'])
        .orderBy('memoriesId')
        .orderBy('assetId')
        .execute();

      expect(after).toEqual(snapshot);
    });

    // F2: the four other e2e scenarios in this describe block all create their memories during
    // the run itself, so they only ever exercise the nightly `[today, today+3]` window -- the
    // historical backfill (`backfillMemoryOverlap`, spec §11's "largest single behaviour change")
    // never runs against a real database anywhere in the suite. Reproduces that path end to end:
    // seed two overlapping memories dated well outside the nightly window, run once, and prove
    // both that they reconcile and that the cursor advances.
    it('reconciles overlapping memories in the historical backfill, then makes no further writes on a second run', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const today = DateTime.fromObject({ year: 2026, month: 9, day: 1 }, { zone: 'utc' });
      // 65 days back: well outside `[today, today+3]`, so only the backfill -- not the nightly
      // pass -- ever reaches these two memories.
      const past = today.minus({ days: 65 });
      const pastIso = past.toJSDate().toISOString();

      const { asset: shared } = await ctx.newAsset({ ownerId: user.id, localDateTime: pastIso });
      const tripOwn = await Promise.all(
        Array.from({ length: 2 }, () => ctx.newAsset({ ownerId: user.id, localDateTime: pastIso })),
      );
      const anniversaryOwn = await Promise.all(
        Array.from({ length: 2 }, () => ctx.newAsset({ ownerId: user.id, localDateTime: pastIso })),
      );

      // Both clear their own floor (2) on their own-only assets alone, so overlap resolution
      // strips the loser rather than deleting it -- isolating the reconciliation itself.
      const { memory: trip } = await ctx.newMemory({
        ownerId: user.id,
        type: MemoryType.Rule,
        data: { ruleId: 'recent_trip', dedupeKey: 'trip', title: 'Trip', score: 130 },
        memoryAt: past.toJSDate(),
        showAt: past.startOf('day').toJSDate(),
        hideAt: past.endOf('day').toJSDate(),
      });
      const { memory: anniversary } = await ctx.newMemory({
        ownerId: user.id,
        type: MemoryType.Rule,
        data: { ruleId: 'trip_anniversary', dedupeKey: 'anniversary', title: 'Anniversary', score: 110 },
        memoryAt: past.toJSDate(),
        showAt: past.startOf('day').toJSDate(),
        hideAt: past.endOf('day').toJSDate(),
      });

      for (const { asset } of [...tripOwn, { asset: shared }]) {
        await ctx.newMemoryAsset({ memoryId: trip.id, assetId: asset.id });
      }
      for (const { asset } of [...anniversaryOwn, { asset: shared }]) {
        await ctx.newMemoryAsset({ memoryId: anniversary.id, assetId: asset.id });
      }

      const assetsOf = async (memoryId: string) => {
        const rows = await ctx.database
          .selectFrom('memory_asset')
          .select('assetId')
          .where('memoriesId', '=', memoryId)
          .execute();
        return rows.map((row) => row.assetId);
      };

      // Confirm the two memories genuinely existed and overlapped BEFORE the run -- otherwise
      // the "disjoint after" assertion below would be vacuously true.
      const tripBefore = await assetsOf(trip.id);
      const anniversaryBefore = await assetsOf(anniversary.id);
      expect(tripBefore).toContain(shared.id);
      expect(anniversaryBefore).toContain(shared.id);

      vi.setSystemTime(today.toJSDate());
      await sut.onMemoriesCreate();

      const state = await ctx.get(SystemMetadataRepository).get(SystemMetadataKey.MemoriesState);
      expect(state?.overlapBackfilledAt).toBeDefined();

      const tripAfterFirst = await assetsOf(trip.id);
      const anniversaryAfterFirst = await assetsOf(anniversary.id);

      // Disjoint: the shared asset now belongs to exactly one of the two. `trip` (score 130)
      // outranks `anniversary` (score 110) and keeps everything; `anniversary` loses the shared
      // asset but still clears its own floor of 2 on its two own-only assets.
      expect(tripAfterFirst.toSorted()).toEqual([shared.id, ...tripOwn.map(({ asset }) => asset.id)].toSorted());
      expect(anniversaryAfterFirst.toSorted()).toEqual(anniversaryOwn.map(({ asset }) => asset.id).toSorted());

      await sut.onMemoriesCreate();

      const tripAfterSecond = await assetsOf(trip.id);
      const anniversaryAfterSecond = await assetsOf(anniversary.id);

      expect(tripAfterSecond.toSorted()).toEqual(tripAfterFirst.toSorted());
      expect(anniversaryAfterSecond.toSorted()).toEqual(anniversaryAfterFirst.toSorted());
    });

    it('never deletes a memory created through the API', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset: first } = await ctx.newAsset({ ownerId: user.id, localDateTime: '2025-09-02T12:00:00Z' });
      const { asset: second } = await ctx.newAsset({ ownerId: user.id, localDateTime: '2025-09-02T12:01:00Z' });

      const manual = await sut.create(factory.auth({ user }), {
        type: MemoryType.OnThisDay,
        data: { year: 2025 },
        memoryAt: new Date('2025-09-02T12:00:00Z'),
        assetIds: [first.id, second.id],
        isSaved: false,
      });

      vi.setSystemTime(new Date('2026-09-01T02:00:00Z'));
      await sut.onMemoriesCreate();

      const stillThere = await ctx.database
        .selectFrom('memory')
        .select('id')
        .where('id', '=', manual.id)
        .executeTakeFirst();

      expect(stillThere).toBeDefined();

      // Untouched, not merely un-deleted: both assets are still attached, neither stripped away
      // by the reconciliation sweep despite carrying the same MemoryType as a generated on_this_day.
      const attachedAssetIds = await ctx.database
        .selectFrom('memory_asset')
        .select('assetId')
        .where('memoriesId', '=', manual.id)
        .execute();
      expect(attachedAssetIds.map((row) => row.assetId).toSorted()).toEqual([first.id, second.id].toSorted());
    });

    // F5: pins the `managed` boundary the sibling test above does NOT cover. That test leaves
    // showAt/hideAt unset, which is what actually keeps an API-created memory safe (see
    // `toReservable`, spec §6.2.1). Here both are set — a shape no first-party client sends, but
    // one `POST /memories` accepts — so the memory IS `managed` and strippable/deletable, same as
    // a generated card. This is a DELIBERATE accepted limitation, pinned here so a future reader
    // knows it was a decision, not an oversight. Do not change production behaviour to make this
    // test pass differently.
    it('deletes an API-created memory when showAt/hideAt are both set — accepted limitation, spec §6.2.1', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset: first } = await ctx.newAsset({ ownerId: user.id, localDateTime: '2025-09-02T12:00:00Z' });
      const { asset: second } = await ctx.newAsset({ ownerId: user.id, localDateTime: '2025-09-02T12:01:00Z' });

      // showAt/hideAt deliberately land on 2026-09-01, NOT on the photos' own 2025-09-02 date, so
      // this memory never overlaps the auto-generated on_this_day card the run below creates for
      // the same two photos on their actual 2026-09-02 anniversary — isolating the assertion to
      // the `managed` boundary itself rather than ordinary same-day claim competition.
      const manual = await sut.create(factory.auth({ user }), {
        type: MemoryType.OnThisDay,
        data: { year: 2025 },
        memoryAt: new Date('2025-09-02T12:00:00Z'),
        assetIds: [first.id, second.id],
        showAt: new Date('2026-09-01T00:00:00Z'),
        hideAt: new Date('2026-09-01T23:59:59Z'),
      });

      vi.setSystemTime(new Date('2026-09-01T02:00:00Z'));
      await sut.onMemoriesCreate();

      const stillThere = await ctx.database
        .selectFrom('memory')
        .select('id')
        .where('id', '=', manual.id)
        .executeTakeFirst();

      // Only 2 assets — below the on_this_day floor of 3 — so once `managed`, the sweep deletes
      // it exactly as it would a generated card.
      expect(stillThere).toBeUndefined();
    });
  });

  describe('onMemoriesCleanup', () => {
    it('should run without error', async () => {
      const { sut } = setup();
      await expect(sut.onMemoriesCleanup()).resolves.not.toThrow();
    });
  });
});
