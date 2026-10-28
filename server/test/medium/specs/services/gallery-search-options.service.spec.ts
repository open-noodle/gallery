/**
 * `POST /search/options` (specs/2026-10-23-mobile-search-redesign-design.md, Slice 1): the counting, narrowing and
 * scope SQL against a real database. The core invariant is that every total equals what the results call returns for
 * the same request, so most tests compare against the real `SearchService.searchMetadata` / `searchSmart` and
 * `TimelineService.getTimeBuckets` on the same seeded data.
 */
import { Kysely, sql } from 'kysely';
import { SmartSearchDto } from 'src/dtos/search.dto.js';
import { TimeBucketDto } from 'src/dtos/time-bucket.dto.js';
import { AssetType, AssetVisibility, LibraryView, SharedSpaceRole } from 'src/enum.js';
import {
  SearchOptionsRequestDto,
  SearchOptionsResponseDto,
  searchOptionsDimensions,
} from 'src/gallery/dtos/search.dto.js';
import { FaceSearchRepository } from 'src/gallery/repositories/face-search.repository.js';
import { FilterSuggestionRepository } from 'src/gallery/repositories/filter-suggestion.repository.js';
import { SmartFacetRepository } from 'src/gallery/repositories/smart-facet.repository.js';
import {
  GallerySearchService,
  SEARCH_OPTIONS_REFRESH_INTERVAL_MS,
} from 'src/gallery/services/gallery-search.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { DB } from 'src/schema/index.js';
import { SearchService } from 'src/services/search.service.js';
import { TimelineService } from 'src/services/timeline.service.js';
import { clearConfigCache } from 'src/utils/config.js';
import { seedLibraryView } from 'test/medium/fixtures/library-view.js';
import { MediumTestContext, newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;

const unitVector = (index: number) => JSON.stringify(Array.from({ length: 512 }, (_, i) => (i === index ? 1 : 0)));

const setup = () => {
  const { sut, ctx } = newMediumService(GallerySearchService, {
    database,
    real: [
      AccessRepository,
      AlbumRepository,
      AssetRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      FaceSearchRepository,
      FilterSuggestionRepository,
      PartnerRepository,
      PersonRepository,
      SearchRepository,
      SharedSpaceRepository,
      SmartFacetRepository,
      TagRepository,
    ],
    mock: [LoggingRepository, MachineLearningRepository, SystemMetadataRepository],
  });
  return {
    sut,
    ctx,
    search: ctx.getService(SearchService),
    timeline: ctx.getService(TimelineService),
  };
};

type Ctx = MediumTestContext;

const TAKEN = new Date('2024-06-15T12:00:00.000Z');

type PhotoOptions = {
  ownerId: string;
  city?: string;
  country?: string;
  make?: string;
  model?: string;
  rating?: number;
  description?: string;
  type?: AssetType;
  visibility?: AssetVisibility;
  takenAt?: Date;
  originalFileName?: string;
  isFavorite?: boolean;
};

const photo = async (ctx: Ctx, options: PhotoOptions) => {
  const takenAt = options.takenAt ?? TAKEN;
  const { asset } = await ctx.newAsset({
    ownerId: options.ownerId,
    type: options.type ?? AssetType.Image,
    visibility: options.visibility ?? AssetVisibility.Timeline,
    fileCreatedAt: takenAt,
    localDateTime: takenAt,
    isFavorite: options.isFavorite ?? false,
    ...(options.originalFileName && { originalFileName: options.originalFileName }),
  });
  await ctx.newExif({
    assetId: asset.id,
    timeZone: 'UTC',
    city: options.city ?? null,
    country: options.country ?? null,
    make: options.make ?? null,
    model: options.model ?? null,
    rating: options.rating ?? null,
    description: options.description ?? '',
  });
  return asset.id;
};

const photos = async (ctx: Ctx, count: number, options: PhotoOptions) => {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(await photo(ctx, options));
  }
  return ids;
};

const auth = (userId: string) => factory.auth({ user: { id: userId } });

/** The `/timeline/buckets` request a browse-mode options request stands for: same filters, `albumIds[0]` as `albumId`. */
const toTimelineDto = (dto: SearchOptionsRequestDto): Partial<TimeBucketDto> => {
  const { albumIds, type, takenAfter, takenBefore, tagIds, ...rest } = dto;
  return {
    ...(rest as Partial<TimeBucketDto>),
    ...(albumIds?.length && { albumId: albumIds[0] }),
    ...(type && { type }),
    ...(tagIds && { tagIds }),
    ...(takenAfter && { takenAfter: takenAfter.toISOString() }),
    ...(takenBefore && { takenBefore: takenBefore.toISOString() }),
  };
};

/** Browse results: every asset id `/timeline/buckets` + `/timeline/bucket` return for the same request. */
const resultIds = async (timeline: TimelineService, userId: string, dto: SearchOptionsRequestDto) => {
  const request = toTimelineDto(dto);
  const ids: string[] = [];
  for (const { timeBucket } of await timeline.getTimeBuckets(auth(userId), request)) {
    const bucket = JSON.parse(await timeline.getTimeBucket(auth(userId), { ...request, timeBucket })) as {
      id: string[];
    };
    ids.push(...bucket.id);
  }
  return ids.toSorted();
};

const timelineCount = async (timeline: TimelineService, userId: string, dto: Partial<TimeBucketDto>) => {
  const buckets = await timeline.getTimeBuckets(auth(userId), dto);
  return buckets.reduce((sum, { count }) => sum + count, 0);
};

const smartIds = async (search: SearchService, userId: string, dto: Partial<SmartSearchDto>) => {
  const { assets } = await search.searchSmart(auth(userId), { size: 1000, ...dto } as SmartSearchDto);
  return assets.items.map(({ id }) => id).toSorted();
};

/** Every list and the availability, unless the test asks for less. */
const optionsFor = (sut: GallerySearchService, userId: string, dto: SearchOptionsRequestDto) =>
  sut.getSearchOptions(auth(userId), { dimensions: [...searchOptionsDimensions], ...dto }) as Promise<
    Required<SearchOptionsResponseDto>
  >;

const names = (people: Required<SearchOptionsResponseDto>['people']) =>
  people.map(({ name, count, isSelected }) => `${name}:${count}${isSelected ? '*' : ''}`);

/** Each listed person's name and whether it is a pet. */
const pets = ({ people }: Required<SearchOptionsResponseDto>) =>
  Object.fromEntries(people.map(({ name, isPet }) => [name, isPet]));

/** A personal person on each of `assetIds`, optionally linked to a face identity like production's backfill. */
const personOn = async (
  ctx: Ctx,
  ownerId: string,
  name: string,
  assetIds: string[],
  identityId?: string,
  { pet = false } = {},
) => {
  const { person } = await ctx.newPerson({
    ownerId,
    name,
    ...(identityId && { identityId }),
    ...(pet && { type: 'pet' }),
  });
  for (const assetId of assetIds) {
    const { assetFace } = await ctx.newAssetFace({ assetId, personGroupId: person.personGroupId });
    if (identityId) {
      await ctx.database
        .insertInto('face_identity_face')
        .values({ assetFaceId: assetFace.id, identityId, source: 'owner-person' })
        .execute();
    }
  }
  return person.personGroupId;
};

const newIdentity = async (ctx: Ctx) => {
  const identity = await ctx.database
    .insertInto('face_identity')
    .values({ type: 'person' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return identity.id;
};

/** A space person with one visible face on each of `assetIds`. */
const spacePersonOn = async (
  ctx: Ctx,
  spaceId: string,
  name: string,
  assetIds: string[],
  identityId?: string,
  { pet = false } = {},
) => {
  const faceIds: string[] = [];
  for (const assetId of assetIds) {
    const { assetFace } = await ctx.newAssetFace({ assetId });
    faceIds.push(assetFace.id);
    if (identityId) {
      await ctx.database
        .insertInto('face_identity_face')
        .values({ assetFaceId: assetFace.id, identityId, source: 'owner-person' })
        .execute();
    }
  }
  const person = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId,
      name,
      representativeFaceId: faceIds[0],
      isHidden: false,
      ...(identityId && { identityId }),
      ...(pet && { type: 'pet' }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values(faceIds.map((assetFaceId) => ({ personId: person.id, assetFaceId })))
    .execute();
  return person.id;
};

const newSpace = async (
  ctx: Ctx,
  ownerId: string,
  members: Array<{ userId: string; showInTimeline?: boolean }> = [],
) => {
  const { space } = await ctx.newSharedSpace({ createdById: ownerId });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerId, role: SharedSpaceRole.Owner });
  for (const member of members) {
    await ctx.newSharedSpaceMember({ spaceId: space.id, role: SharedSpaceRole.Viewer, ...member });
  }
  return space.id;
};

const setupQueryMode = async () => {
  const context = setup();
  const { ctx } = context;
  ctx.getMock(SystemMetadataRepository).get.mockResolvedValue({ machineLearning: { clip: { maxDistance: 0.5 } } });
  ctx.getMock(MachineLearningRepository).encodeText.mockResolvedValue(unitVector(0));
  const { user } = await ctx.newUser();
  const near = await photos(ctx, 3, { ownerId: user.id, city: 'Nice', country: 'France' });
  const nearElsewhere = await photo(ctx, { ownerId: user.id, city: 'Porto', country: 'Portugal' });
  const far = await photos(ctx, 2, { ownerId: user.id, city: 'Nice', country: 'France' });
  const searchRepository = ctx.get(SearchRepository);
  for (const id of [...near, nearElsewhere]) {
    await searchRepository.upsert(id, unitVector(0));
  }
  for (const id of far) {
    await searchRepository.upsert(id, unitVector(1));
  }
  return { ...context, user, near, nearElsewhere, far };
};

const seedTags = async (ctx: Ctx, userId: string) => {
  // t1 has both tags, t2/t3 only beach, t4 only food; two photos have none
  const [t1, t2, t3, t4] = await photos(ctx, 4, { ownerId: userId, rating: 3 });
  const untagged = await photos(ctx, 2, { ownerId: userId });
  const { tag: beach } = await ctx.newTag({ userId, value: 'beach' });
  const { tag: food } = await ctx.newTag({ userId, value: 'food' });
  await ctx.newTagAsset({ tagIds: [beach.id], assetIds: [t1, t2, t3] });
  await ctx.newTagAsset({ tagIds: [food.id], assetIds: [t1, t4] });
  return { t1, t2, t3, t4, untagged, beach, food };
};

const until = async (check: () => Promise<boolean>) => {
  // Postgres reports the write counters behind the watermark of tag_asset and asset_face late (see the watermark).
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

// The Favorites screen: visibility unset with the timeline's partners and every member space. Archive is the
// owner's private state, so only my own archived favourites come in.
const seedFavoritesScreen = async (ctx: Ctx) => {
  const { user: me } = await ctx.newUser();
  const { user: partner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { user: otherMember } = await ctx.newUser();
  await ctx.newPartner({ sharedById: partner.id, sharedWithId: me.id, inTimeline: true });
  const spaceId = await newSpace(ctx, member.id, [{ userId: me.id }, { userId: otherMember.id }]);
  const hiddenSpaceId = await newSpace(ctx, member.id, [{ userId: me.id, showInTimeline: false }]);

  const myFavorite = await photo(ctx, { ownerId: me.id, isFavorite: true, country: 'Japan' });
  const myArchivedFavorite = await photo(ctx, {
    ownerId: me.id,
    isFavorite: true,
    visibility: AssetVisibility.Archive,
    country: 'Japan',
  });
  await photo(ctx, { ownerId: me.id, visibility: AssetVisibility.Archive });
  await photo(ctx, { ownerId: me.id });
  await photo(ctx, { ownerId: me.id, isFavorite: true, visibility: AssetVisibility.Hidden });
  const partnerFavorite = await photo(ctx, { ownerId: partner.id, country: 'Spain' });
  const partnerArchivedFavorite = await photo(ctx, { ownerId: partner.id, visibility: AssetVisibility.Archive });
  const spaceFavorite = await photo(ctx, { ownerId: member.id, country: 'France' });
  const spaceArchivedFavorite = await photo(ctx, { ownerId: member.id, visibility: AssetVisibility.Archive });
  // favourited by its owner and by another member, never by me
  const othersFavorite = await photo(ctx, { ownerId: member.id, isFavorite: true });
  const hiddenSpaceFavorite = await photo(ctx, { ownerId: member.id });
  for (const assetId of [spaceFavorite, spaceArchivedFavorite, othersFavorite]) {
    await ctx.newSharedSpaceAsset({ spaceId, assetId, addedById: member.id });
  }
  await ctx.newSharedSpaceAsset({ spaceId: hiddenSpaceId, assetId: hiddenSpaceFavorite, addedById: member.id });
  await ctx.database
    .insertInto('asset_favorite')
    .values([
      ...[partnerFavorite, partnerArchivedFavorite, spaceFavorite, spaceArchivedFavorite, hiddenSpaceFavorite].map(
        (assetId) => ({ userId: me.id, assetId }),
      ),
      { userId: otherMember.id, assetId: othersFavorite },
    ])
    .execute();
  return {
    me,
    myFavorite,
    myArchivedFavorite,
    partnerFavorite,
    partnerArchivedFavorite,
    spaceFavorite,
    spaceArchivedFavorite,
    othersFavorite,
    hiddenSpaceFavorite,
  };
};

beforeAll(async () => {
  database = await getKyselyDB();
});

beforeEach(() => {
  clearConfigCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /search/options (GallerySearchService.getSearchOptions)', () => {
  describe('places exclude their own filter', () => {
    it('lists every city with its country and count while a city is selected; the total is the selection', async () => {
      const { sut, ctx, timeline } = setup();
      const { user } = await ctx.newUser();
      const kyoto = await photos(ctx, 4, { ownerId: user.id, city: 'Kyoto', country: 'Japan', make: 'Fujifilm' });
      await photos(ctx, 6, { ownerId: user.id, city: 'Berlin', country: 'Germany', make: 'Leica' });
      await photo(ctx, { ownerId: user.id, country: 'Germany' });

      const result = await optionsFor(sut, user.id, { city: 'Kyoto' });

      expect(result.total).toBe(4);
      expect(result.countries).toEqual([
        { country: 'Germany', count: 7, cities: [{ city: 'Berlin', count: 6 }] },
        { country: 'Japan', count: 4, cities: [{ city: 'Kyoto', count: 4 }] },
      ]);
      // every OTHER dimension is narrowed by the city
      expect(result.cameraMakes).toEqual([{ make: 'Fujifilm', count: 4, models: [] }]);
      expect(await resultIds(timeline, user.id, { city: 'Kyoto' })).toEqual(kyoto.toSorted());
    });

    it('lists cameras with their models while a model is selected', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await photos(ctx, 2, { ownerId: user.id, make: 'Apple', model: 'iPhone 15' });
      await photos(ctx, 1, { ownerId: user.id, make: 'Apple', model: 'iPhone 12' });
      await photos(ctx, 3, { ownerId: user.id, make: 'Canon', model: 'EOS R5' });

      const result = await optionsFor(sut, user.id, { make: 'Apple', model: 'iPhone 12' });

      expect(result.total).toBe(1);
      expect(result.cameraMakes).toEqual([
        {
          make: 'Apple',
          count: 3,
          models: [
            { model: 'iPhone 15', count: 2 },
            { model: 'iPhone 12', count: 1 },
          ],
        },
        { make: 'Canon', count: 3, models: [{ model: 'EOS R5', count: 3 }] },
      ]);
    });

    it('lists ratings and media types ignoring their own filter, and months ignoring the date filter', async () => {
      const { sut, ctx, timeline } = setup();
      const { user } = await ctx.newUser();
      await photo(ctx, { ownerId: user.id, rating: 5, takenAt: new Date('2024-03-10T10:00:00.000Z') });
      await photo(ctx, { ownerId: user.id, rating: 3, takenAt: new Date('2024-05-10T10:00:00.000Z') });
      await photo(ctx, { ownerId: user.id, rating: 3, type: AssetType.Video, takenAt: TAKEN });

      const result = await optionsFor(sut, user.id, {
        rating: 4,
        takenAfter: new Date('2024-03-01T00:00:00.000Z'),
        takenBefore: new Date('2024-04-01T00:00:00.000Z'),
      });

      // rating is a minimum (>=), as on the timeline and smart search
      expect(result.total).toBe(1);
      expect(await timelineCount(timeline, user.id, { rating: 4, takenAfter: '2024-03-01T00:00:00.000Z' })).toBe(1);
      expect(result.ratings).toEqual([{ rating: 5, count: 1 }]);
      expect(result.mediaTypes).toEqual([{ type: AssetType.Image, count: 1 }]);
      // the months ignore the date filter but keep the rating filter
      expect(result.timeBuckets).toEqual([{ timeBucket: '2024-03-01', count: 1 }]);

      const byDate = await optionsFor(sut, user.id, {
        takenAfter: new Date('2024-03-01T00:00:00.000Z'),
        takenBefore: new Date('2024-04-01T00:00:00.000Z'),
      });
      expect(byDate.total).toBe(1);
      expect(byDate.ratings).toEqual([{ rating: 5, count: 1 }]);
      expect(byDate.timeBuckets).toEqual([
        { timeBucket: '2024-06-01', count: 1 },
        { timeBucket: '2024-05-01', count: 1 },
        { timeBucket: '2024-03-01', count: 1 },
      ]);
    });
  });

  describe('people include their own filter', () => {
    it('lists who else is in the selected person’s photos, counting photos with both; the selection is marked', async () => {
      const { sut, ctx, timeline } = setup();
      const { user } = await ctx.newUser();
      const [a1, a2, a3, a4] = await photos(ctx, 4, { ownerId: user.id });
      const [b1] = await photos(ctx, 1, { ownerId: user.id });
      const anna = await personOn(ctx, user.id, 'Anna', [a1, a2, a3, a4]);
      const ben = await personOn(ctx, user.id, 'Ben', [a1, a2, b1]);
      await personOn(ctx, user.id, 'Cara', [a3]);

      const result = await optionsFor(sut, user.id, { personIds: [anna] });

      expect(result.total).toBe(4);
      expect(names(result.people)).toEqual(['Anna:4*', 'Ben:2', 'Cara:1']);
      expect(result.people[0]).toMatchObject({
        id: anna,
        filterId: anna,
        primaryProfile: { type: 'user-person', id: anna },
      });

      // each count is the result count that adding that person leaves
      expect(await resultIds(timeline, user.id, { personIds: [anna] })).toHaveLength(4);
      expect(await resultIds(timeline, user.id, { personIds: [anna, ben] })).toHaveLength(2);
    });

    it('counts identity people (Photos scope) through the person: token, including a space member’s photo', async () => {
      const { sut, ctx, timeline } = setup();
      const { user: me } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const spaceId = await newSpace(ctx, member.id, [{ userId: me.id }]);
      const annaIdentity = await newIdentity(ctx);
      const benIdentity = await newIdentity(ctx);
      const [mine1, mine2] = await photos(ctx, 2, { ownerId: me.id });
      const [theirs] = await photos(ctx, 1, { ownerId: member.id });
      await ctx.newSharedSpaceAsset({ spaceId, assetId: theirs, addedById: member.id });
      const anna = await personOn(ctx, me.id, 'Anna', [mine1, mine2], annaIdentity);
      await personOn(ctx, me.id, 'Ben', [mine1], benIdentity);
      await spacePersonOn(ctx, spaceId, 'Anna', [theirs], annaIdentity);

      const dto = { withSharedSpaces: true, visibility: AssetVisibility.Timeline, personIds: [`person:${anna}`] };
      const result = await optionsFor(sut, me.id, dto);

      expect(result.total).toBe(3);
      expect(await resultIds(timeline, me.id, dto)).toEqual([mine1, mine2, theirs].toSorted());
      expect(names(result.people)).toEqual(['Anna:3*', 'Ben:1']);
      expect(result.people[0]).toMatchObject({ filterId: `person:${anna}`, id: `person:${anna}` });
    });
  });

  describe("a space member's photos in my timeline", () => {
    it('every list counts them, and each option it lists finds them through /timeline/buckets', async () => {
      const { sut, ctx, timeline } = setup();
      const { user: me } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const spaceId = await newSpace(ctx, member.id, [{ userId: me.id }]);
      await photo(ctx, { ownerId: me.id, city: 'Paris', country: 'France', make: 'Canon', model: 'R5', rating: 2 });
      const theirs = await photo(ctx, {
        ownerId: member.id,
        city: 'Kyoto',
        country: 'Japan',
        make: 'Fujifilm',
        model: 'X-T5',
        rating: 4,
        type: AssetType.Video,
        takenAt: new Date('2023-04-10T12:00:00.000Z'),
      });
      await ctx.newSharedSpaceAsset({ spaceId, assetId: theirs, addedById: member.id });
      // the member's own tag, on the member's photo: tags belong to whoever made them
      const { tag } = await ctx.newTag({ userId: member.id, value: 'temple' });
      await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [theirs] });

      const photosScope = { withSharedSpaces: true, visibility: AssetVisibility.Timeline } as const;
      const result = await optionsFor(sut, me.id, photosScope);

      expect(result.total).toBe(2);
      expect(result.availability).toMatchObject({ hasTags: true, hasCameras: true, hasRatings: true, hasVideos: true });
      expect(result.tags).toEqual([{ id: tag.id, value: 'temple', count: 1, isSelected: false }]);
      expect(result.countries.find((c) => c.country === 'Japan')).toEqual({
        country: 'Japan',
        count: 1,
        cities: [{ city: 'Kyoto', count: 1 }],
      });
      expect(result.cameraMakes.find((m) => m.make === 'Fujifilm')).toEqual({
        make: 'Fujifilm',
        count: 1,
        models: [{ model: 'X-T5', count: 1 }],
      });
      expect(result.ratings).toContainEqual({ rating: 4, count: 1 });
      expect(result.mediaTypes).toContainEqual({ type: AssetType.Video, count: 1 });
      expect(result.timeBuckets).toContainEqual({ timeBucket: '2023-04-01', count: 1 });

      // Picking each of those options narrows to the member's photo, in the options and in the results alike.
      const picks: SearchOptionsRequestDto[] = [
        { tagIds: [tag.id] },
        { country: 'Japan', city: 'Kyoto' },
        { make: 'Fujifilm', model: 'X-T5' },
        { rating: 4 },
        { type: AssetType.Video },
        { takenAfter: new Date('2023-04-01T00:00:00.000Z'), takenBefore: new Date('2023-05-01T00:00:00.000Z') },
      ];
      for (const pick of picks) {
        const dto = { ...photosScope, ...pick };
        const narrowed = await optionsFor(sut, me.id, dto);
        expect({ pick, total: narrowed.total }).toEqual({ pick, total: 1 });
        expect({ pick, results: await resultIds(timeline, me.id, dto) }).toEqual({ pick, results: [theirs] });
      }
    });
  });

  describe('tags', () => {
    it('browse: tags match ANY, as /timeline/buckets does, and each tag counts the photos it would add', async () => {
      const { sut, ctx, timeline } = setup();
      const { user } = await ctx.newUser();
      const { t1, t2, t3, t4, beach, food } = await seedTags(ctx, user.id);

      const both = await optionsFor(sut, user.id, { tagIds: [beach.id, food.id] });
      expect(await resultIds(timeline, user.id, { tagIds: [beach.id, food.id] })).toEqual([t1, t2, t3, t4].toSorted());
      expect(both.total).toBe(4);
      expect(both.total).toBe(await timelineCount(timeline, user.id, { tagIds: [beach.id, food.id] }));

      const selected = await optionsFor(sut, user.id, { tagIds: [beach.id] });
      expect(selected.total).toBe(3);
      expect(selected.tags).toEqual([
        { id: beach.id, value: 'beach', count: 3, isSelected: true },
        { id: food.id, value: 'food', count: 2, isSelected: false },
      ]);
    });

    it('query mode: tags match ALL, as /search/smart does', async () => {
      const { sut, ctx, search } = setup();
      ctx.getMock(SystemMetadataRepository).get.mockResolvedValue({ machineLearning: { clip: { maxDistance: 0.5 } } });
      const { user } = await ctx.newUser();
      const { t1, t2, t3, t4, untagged, beach, food } = await seedTags(ctx, user.id);
      for (const id of [t1, t2, t3, t4, ...untagged]) {
        await ctx.get(SearchRepository).upsert(id, unitVector(0));
      }

      const dto = { queryAssetId: t2, tagIds: [beach.id, food.id] };
      const result = await optionsFor(sut, user.id, dto);
      expect(await smartIds(search, user.id, dto)).toEqual([t1]);
      expect(result.total).toBe(1);
      expect(result.tags.map(({ value, count }) => `${value}:${count}`)).toEqual(['beach:1', 'food:1']);
    });

    it('browse: Untagged is dropped for the tag list', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await seedTags(ctx, user.id);

      const untaggedOnly = await optionsFor(sut, user.id, { tagIds: null });
      expect(untaggedOnly.total).toBe(2);
      expect(untaggedOnly.tags.map(({ value, count }) => `${value}:${count}`)).toEqual(['beach:3', 'food:2']);
    });
  });

  describe('rating', () => {
    it('browse: rating is a minimum, as /timeline/buckets reads it', async () => {
      const { sut, ctx, timeline } = setup();
      const { user } = await ctx.newUser();
      await photo(ctx, { ownerId: user.id, rating: 2 });
      const atLeastThree = [
        await photo(ctx, { ownerId: user.id, rating: 3 }),
        await photo(ctx, { ownerId: user.id, rating: 4 }),
        await photo(ctx, { ownerId: user.id, rating: 5 }),
      ];

      const result = await optionsFor(sut, user.id, { rating: 3 });
      expect(await resultIds(timeline, user.id, { rating: 3 })).toEqual(atLeastThree.toSorted());
      expect(result.total).toBe(3);
      expect(result.total).toBe(await timelineCount(timeline, user.id, { rating: 3 }));
    });

    it('query mode: rating is a minimum, as /search/smart reads it', async () => {
      const { sut, ctx, search } = setup();
      ctx.getMock(SystemMetadataRepository).get.mockResolvedValue({ machineLearning: { clip: { maxDistance: 0.5 } } });
      const { user } = await ctx.newUser();
      const ids = [];
      for (const rating of [2, 3, 4, 5]) {
        const id = await photo(ctx, { ownerId: user.id, rating });
        await ctx.get(SearchRepository).upsert(id, unitVector(0));
        ids.push(id);
      }

      const dto = { queryAssetId: ids[0], rating: 3 };
      expect(await smartIds(search, user.id, dto)).toEqual(ids.slice(1).toSorted());
      const result = await optionsFor(sut, user.id, dto);
      expect(result.total).toBe(3);
    });
  });

  describe('counts match results', () => {
    it('browse: agrees with /timeline/buckets + /timeline/bucket on every scope the server sees', async () => {
      const { sut, ctx, timeline } = setup();
      const { user: me } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      await ctx.newPartner({ sharedById: partner.id, sharedWithId: me.id, inTimeline: true });

      const spaceId = await newSpace(ctx, member.id, [{ userId: me.id }]);
      const mine = await photos(ctx, 3, { ownerId: me.id, city: 'Kyoto', country: 'Japan' });
      const myVideo = await photo(ctx, { ownerId: me.id, type: AssetType.Video, city: 'Lisbon', country: 'Portugal' });
      const myArchived = await photos(ctx, 2, { ownerId: me.id, visibility: AssetVisibility.Archive });
      const myFavorite = await photo(ctx, { ownerId: me.id, isFavorite: true, city: 'Kyoto', country: 'Japan' });
      // the timeline's default visibility (timeline + archive) leaves it out; search's not-locked default would not
      await photo(ctx, { ownerId: me.id, visibility: AssetVisibility.Hidden });
      const partners = await photos(ctx, 2, { ownerId: partner.id, city: 'Berlin', country: 'Germany' });
      await photo(ctx, { ownerId: partner.id, visibility: AssetVisibility.Archive });
      const spaceAssets = await photos(ctx, 3, { ownerId: member.id, city: 'Kyoto', country: 'Japan' });
      const spaceVideo = await photo(ctx, { ownerId: member.id, type: AssetType.Video });
      for (const assetId of [...spaceAssets, spaceVideo]) {
        await ctx.newSharedSpaceAsset({ spaceId, assetId, addedById: member.id });
      }
      await ctx.database.insertInto('asset_favorite').values({ userId: me.id, assetId: spaceAssets[0] }).execute();
      const { album } = await ctx.newAlbum({ ownerId: me.id }, [mine[0], myArchived[0], myVideo]);
      // a space-linked album I am not a member of, reachable through the space
      const { album: spaceAlbum } = await ctx.newAlbum({ ownerId: member.id }, [spaceAssets[1], spaceAssets[2]]);
      await ctx.newSharedSpaceAlbum({ spaceId, albumId: spaceAlbum.id });
      const kid = await personOn(ctx, me.id, 'Kid', [mine[0], mine[1]]);
      const spaceKid = await spacePersonOn(ctx, spaceId, 'Space Kid', [spaceAssets[0], spaceAssets[1]]);

      const photosScope = {
        withSharedSpaces: true,
        withPartners: true,
        visibility: AssetVisibility.Timeline,
      } as const;
      const scopes: Array<{ name: string; options: SearchOptionsRequestDto; expected: string[] }> = [
        {
          name: 'photos',
          options: photosScope,
          expected: [...mine, myVideo, myFavorite, ...partners, ...spaceAssets, spaceVideo],
        },
        {
          name: 'photos without partners',
          options: { withSharedSpaces: true, visibility: AssetVisibility.Timeline },
          expected: [...mine, myVideo, myFavorite, ...spaceAssets, spaceVideo],
        },
        { name: 'album', options: { albumIds: [album.id] }, expected: [mine[0], myArchived[0], myVideo] },
        { name: 'space album', options: { albumIds: [spaceAlbum.id] }, expected: [spaceAssets[1], spaceAssets[2]] },
        { name: 'space', options: { spaceId }, expected: [...spaceAssets, spaceVideo] },
        { name: 'personal person', options: { personIds: [kid] }, expected: [mine[0], mine[1]] },
        {
          name: 'space person',
          options: { spaceId, spacePersonIds: [spaceKid] },
          expected: [spaceAssets[0], spaceAssets[1]],
        },
        { name: 'place', options: { ...photosScope, city: 'Kyoto' }, expected: [...mine, myFavorite, ...spaceAssets] },
        // an older client's Favorites screen: my own favourites only
        { name: 'favorites', options: { isFavorite: true }, expected: [myFavorite] },
        {
          // the Favorites screen: partners and spaces as the timeline shows them, my own archive too
          name: 'favorites across partners and spaces',
          options: { isFavorite: true, withSharedSpaces: true, withPartners: true },
          expected: [myFavorite, spaceAssets[0]],
        },
        {
          name: 'favorites with spaces',
          options: { withSharedSpaces: true, visibility: AssetVisibility.Timeline, isFavorite: true },
          expected: [myFavorite, spaceAssets[0]],
        },
        { name: 'archive', options: { visibility: AssetVisibility.Archive, ownerId: me.id }, expected: myArchived },
        { name: 'videos', options: { ...photosScope, type: AssetType.Video }, expected: [myVideo, spaceVideo] },
        {
          name: 'owner only',
          options: { visibility: AssetVisibility.Timeline, ownerId: me.id },
          expected: [...mine, myVideo, myFavorite],
        },
        {
          name: 'recently added',
          options: { ownerId: me.id },
          expected: [...mine, myVideo, ...myArchived, myFavorite],
        },
      ];

      for (const scope of scopes) {
        const result = await optionsFor(sut, me.id, scope.options);
        const results = await resultIds(timeline, me.id, scope.options);
        expect({ scope: scope.name, results }).toEqual({ scope: scope.name, results: scope.expected.toSorted() });
        expect({ scope: scope.name, total: result.total }).toEqual({ scope: scope.name, total: results.length });
        // per-option counts stay inside the scope: without its own filter a dimension adds up to the total
        if (!scope.options.city) {
          expect(result.countries.reduce((sum, { count }) => sum + count, 0)).toBeLessThanOrEqual(result.total);
        }
        if (!scope.options.type) {
          expect(result.mediaTypes.reduce((sum, { count }) => sum + count, 0)).toBe(result.total);
        }
      }
    });
  });

  describe('archive', () => {
    it('covers only my archived photos with visibility=archive and ownerId=me', async () => {
      const { sut, ctx, timeline } = setup();
      const { user: me } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();
      await ctx.newPartner({ sharedById: partner.id, sharedWithId: me.id, inTimeline: true });
      const archived = await photos(ctx, 2, { ownerId: me.id, visibility: AssetVisibility.Archive, country: 'Japan' });
      await photo(ctx, { ownerId: me.id, country: 'France' });
      await photo(ctx, { ownerId: partner.id, visibility: AssetVisibility.Archive, country: 'Spain' });

      const dto = { visibility: AssetVisibility.Archive, ownerId: me.id };
      const result = await optionsFor(sut, me.id, dto);

      expect(result.total).toBe(2);
      expect(await resultIds(timeline, me.id, dto)).toEqual(archived.toSorted());
      expect(result.countries).toEqual([{ country: 'Japan', count: 2, cities: [] }]);
    });
  });

  describe('favorites', () => {
    it('counts my favourites from every member space, including one hidden from my timeline (#763)', async () => {
      const { sut, ctx, timeline } = setup();
      const { user: me } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const shown = await newSpace(ctx, other.id, [{ userId: me.id }]);
      const hidden = await newSpace(ctx, other.id, [{ userId: me.id, showInTimeline: false }]);
      const own = await photo(ctx, { ownerId: me.id, isFavorite: true });
      const [inShown, notFavorite] = await photos(ctx, 2, { ownerId: other.id });
      const inHidden = await photo(ctx, { ownerId: other.id });
      await ctx.newSharedSpaceAsset({ spaceId: shown, assetId: inShown, addedById: other.id });
      await ctx.newSharedSpaceAsset({ spaceId: shown, assetId: notFavorite, addedById: other.id });
      await ctx.newSharedSpaceAsset({ spaceId: hidden, assetId: inHidden, addedById: other.id });
      await ctx.database
        .insertInto('asset_favorite')
        .values([
          { userId: me.id, assetId: inShown },
          { userId: me.id, assetId: inHidden },
        ])
        .execute();

      const dto = { withSharedSpaces: true, visibility: AssetVisibility.Timeline, isFavorite: true };
      const result = await optionsFor(sut, me.id, dto);

      expect(await resultIds(timeline, me.id, dto)).toEqual([own, inShown, inHidden].toSorted());
      expect(result.total).toBe(3);
      expect(result.availability!.hasFavorites).toBe(true);
    });

    it('the Favorites screen: my favourites with archived ones, and partners’ and member spaces’ as the timeline shows them', async () => {
      const { sut, ctx, timeline } = setup();
      const seeded = await seedFavoritesScreen(ctx);
      const { me } = seeded;

      const dto = { isFavorite: true, withSharedSpaces: true, withPartners: true };
      const result = await optionsFor(sut, me.id, dto);
      const results = await resultIds(timeline, me.id, dto);

      expect(results).toEqual(
        [
          seeded.myFavorite,
          seeded.myArchivedFavorite,
          seeded.partnerFavorite,
          seeded.spaceFavorite,
          seeded.hiddenSpaceFavorite,
        ].toSorted(),
      );
      expect(results).not.toContain(seeded.partnerArchivedFavorite);
      expect(results).not.toContain(seeded.spaceArchivedFavorite);
      expect(results).not.toContain(seeded.othersFavorite);
      expect(result.total).toBe(results.length);
      expect(await timelineCount(timeline, me.id, dto)).toBe(results.length);
      expect(result.timeBuckets.reduce((sum, { count }) => sum + count, 0)).toBe(results.length);
      expect(result.countries.map(({ country, count }) => `${country}:${count}`).toSorted()).toEqual([
        'France:1',
        'Japan:2',
        'Spain:1',
      ]);

      // without partners: the same minus the partner's favourite
      const withoutPartners = { isFavorite: true, withSharedSpaces: true };
      const narrowed = await resultIds(timeline, me.id, withoutPartners);
      expect(narrowed).toEqual(results.filter((id) => id !== seeded.partnerFavorite));
      const narrowedOptions = await optionsFor(sut, me.id, withoutPartners);
      expect(narrowedOptions.total).toBe(narrowed.length);
    });

    it('still refuses partners or shared spaces with visibility unset unless the request is for favourites', async () => {
      const { sut, ctx, timeline } = setup();
      const { me } = await seedFavoritesScreen(ctx);

      const refused: SearchOptionsRequestDto[] = [
        { withSharedSpaces: true },
        { withPartners: true },
        { withSharedSpaces: true, withPartners: true, isFavorite: false },
        { withSharedSpaces: true, isFavorite: true, visibility: AssetVisibility.Archive },
        { withPartners: true, isFavorite: true, visibility: AssetVisibility.Archive },
      ];
      for (const dto of refused) {
        await expect(timeline.getTimeBuckets(auth(me.id), toTimelineDto(dto)), JSON.stringify(dto)).rejects.toThrow(
          /only supported for non-archived/,
        );
        await expect(
          timeline.getTimeBucket(auth(me.id), { ...toTimelineDto(dto), timeBucket: '2024-06-01' }),
          JSON.stringify(dto),
        ).rejects.toThrow(/only supported for non-archived/);
        await expect(optionsFor(sut, me.id, dto), JSON.stringify(dto)).rejects.toThrow(
          /only supported for non-archived/,
        );
      }
      await expect(
        timeline.getTimeBuckets(auth(me.id), { isFavorite: true, withSharedSpaces: true, isTrashed: true }),
      ).rejects.toThrow(/only supported for non-archived/);
    });
  });

  describe('text filters', () => {
    it('narrows options and counts by OCR, description and file name, alone and together', async () => {
      const { sut, ctx, timeline } = setup();
      const { user } = await ctx.newUser();
      const menu = await photo(ctx, { ownerId: user.id, country: 'Italy', originalFileName: 'IMG_0001.jpg' });
      const menuDinner = await photo(ctx, {
        ownerId: user.id,
        country: 'France',
        description: 'dinner with friends',
        originalFileName: 'IMG_0002.jpg',
      });
      const dinner = await photo(ctx, {
        ownerId: user.id,
        country: 'Spain',
        description: 'dinner',
        originalFileName: 'DSC_0003.jpg',
      });
      await ctx.database
        .insertInto('ocr_search')
        .values([
          { assetId: menu, text: 'lunch menu today' },
          { assetId: menuDinner, text: 'the dinner menu' },
        ])
        .execute();

      const cases: Array<[SearchOptionsRequestDto, string[]]> = [
        [{ ocr: 'menu' }, [menu, menuDinner]],
        [{ description: 'dinner' }, [menuDinner, dinner]],
        [{ originalFileName: 'IMG_' }, [menu, menuDinner]],
        [{ ocr: 'menu', description: 'dinner', originalFileName: 'IMG_0002' }, [menuDinner]],
      ];

      for (const [dto, expected] of cases) {
        const result = await optionsFor(sut, user.id, dto);
        expect({ dto, results: await resultIds(timeline, user.id, dto) }).toEqual({
          dto,
          results: expected.toSorted(),
        });
        expect({ dto, total: result.total }).toEqual({ dto, total: expected.length });
        expect(result.countries.reduce((sum, { count }) => sum + count, 0)).toBe(expected.length);
      }
    });
  });

  describe('pets', () => {
    it('marks each person or pet, in every people branch: personal, identity (Photos) and space', async () => {
      const { sut, ctx } = setup();
      const { user: me } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const spaceId = await newSpace(ctx, member.id, [{ userId: me.id }]);
      const [p1, p2] = await photos(ctx, 2, { ownerId: me.id });
      const [s1, s2] = await photos(ctx, 2, { ownerId: member.id });
      for (const assetId of [s1, s2]) {
        await ctx.newSharedSpaceAsset({ spaceId, assetId, addedById: member.id });
      }
      const annaIdentity = await newIdentity(ctx);
      const rexIdentity = await newIdentity(ctx);
      await personOn(ctx, me.id, 'Anna', [p1], annaIdentity);
      await personOn(ctx, me.id, 'Rex', [p2], rexIdentity, { pet: true });
      await spacePersonOn(ctx, spaceId, 'Pia', [s1]);
      await spacePersonOn(ctx, spaceId, 'Milo', [s2], undefined, { pet: true });

      // personal: no shared spaces in the request
      const personal = await optionsFor(sut, me.id, {});
      expect(pets(personal)).toEqual({ Anna: false, Rex: true });
      // identity: the Photos scope with timeline spaces
      const photosScope = await optionsFor(sut, me.id, {
        withSharedSpaces: true,
        visibility: AssetVisibility.Timeline,
      });
      expect(pets(photosScope)).toMatchObject({ Anna: false, Rex: true });
      // space
      const space = await optionsFor(sut, me.id, { spaceId });
      expect(pets(space)).toEqual({ Pia: false, Milo: true });
    });
  });

  describe('space people', () => {
    it('lists space people by bare id with counts inside the space', async () => {
      const { sut, ctx, timeline } = setup();
      const { user: me } = await ctx.newUser();
      const { user: owner } = await ctx.newUser();
      const spaceId = await newSpace(ctx, owner.id, [{ userId: me.id }]);
      const [s1, s2, s3] = await photos(ctx, 3, { ownerId: owner.id });
      for (const assetId of [s1, s2, s3]) {
        await ctx.newSharedSpaceAsset({ spaceId, assetId, addedById: owner.id });
      }
      // a personal person outside the space must not appear
      const [outside] = await photos(ctx, 1, { ownerId: me.id });
      await personOn(ctx, me.id, 'Outsider', [outside]);
      const p = await spacePersonOn(ctx, spaceId, 'Pia', [s1, s2]);
      const q = await spacePersonOn(ctx, spaceId, 'Quinn', [s2, s3]);

      const dto = { spaceId, spacePersonIds: [p] };
      const result = await optionsFor(sut, me.id, dto);

      expect(result.total).toBe(2);
      expect(await resultIds(timeline, me.id, dto)).toEqual([s1, s2].toSorted());
      expect(result.people).toEqual([
        {
          id: p,
          filterId: p,
          name: 'Pia',
          primaryProfile: { type: 'space-person', id: p, spaceId },
          count: 2,
          isSelected: true,
          isPet: false,
        },
        {
          id: q,
          filterId: q,
          name: 'Quinn',
          primaryProfile: { type: 'space-person', id: q, spaceId },
          count: 1,
          isSelected: false,
          isPet: false,
        },
      ]);
    });
  });

  describe('space album', () => {
    it('counts exactly the album’s assets, including a contribution made through the space, without spaceId', async () => {
      const { sut, ctx, timeline } = setup();
      const { user: me } = await ctx.newUser();
      const { user: owner } = await ctx.newUser();
      const spaceId = await newSpace(ctx, owner.id, [{ userId: me.id }]);
      const inAlbum = await photos(ctx, 2, { ownerId: owner.id, country: 'Japan' });
      const [outsideAlbum] = await photos(ctx, 1, { ownerId: owner.id, country: 'Peru' });
      await ctx.newSharedSpaceAsset({ spaceId, assetId: outsideAlbum, addedById: owner.id });
      const { album } = await ctx.newAlbum({ ownerId: owner.id }, inAlbum);
      await ctx.newSharedSpaceAlbum({ spaceId, albumId: album.id });
      const contributed = await photo(ctx, { ownerId: me.id, country: 'Japan' });
      await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: contributed, spaceId, addedById: me.id });

      const dto = { albumIds: [album.id] };
      const result = await optionsFor(sut, me.id, dto);

      const expected = [...inAlbum, contributed].toSorted();
      expect(await resultIds(timeline, me.id, dto)).toEqual(expected);
      expect(result.total).toBe(3);
      expect(result.countries).toEqual([{ country: 'Japan', count: 3, cities: [] }]);
    });
  });

  describe('query mode', () => {
    it('counts over the smart-search result set for a text query', async () => {
      const { sut, search, user, near, nearElsewhere } = await setupQueryMode();

      const result = await optionsFor(sut, user.id, { query: 'beach', city: 'Nice' });

      expect(result.total).toBe(3);
      expect(result.countries).toEqual([
        { country: 'France', count: 3, cities: [{ city: 'Nice', count: 3 }] },
        { country: 'Portugal', count: 1, cities: [{ city: 'Porto', count: 1 }] },
      ]);
      const smart = await search.searchSmart(auth(user.id), {
        query: 'beach',
        city: 'Nice',
        size: 100,
      } as SmartSearchDto);
      expect(smart.assets.items.map(({ id }) => id).toSorted()).toEqual(near.toSorted());
      const all = await search.searchSmart(auth(user.id), { query: 'beach', size: 100 } as SmartSearchDto);
      expect(all.assets.items.map(({ id }) => id).toSorted()).toEqual([...near, nearElsewhere].toSorted());
    });

    it('counts over the results similar to a reference asset', async () => {
      const { sut, user, near } = await setupQueryMode();

      const result = await optionsFor(sut, user.id, { queryAssetId: near[0] });

      expect(result.total).toBe(4);
    });

    it('is browse mode, not a 400, with neither query nor queryAssetId', async () => {
      const { sut, user } = await setupQueryMode();

      const result = await optionsFor(sut, user.id, { city: 'Nice' });

      expect(result.total).toBe(5);
    });
  });

  describe('access', () => {
    it('refuses a non-member space, an unreadable album and an unreadable queryAssetId', async () => {
      const { sut, ctx } = setup();
      ctx.getMock(SystemMetadataRepository).get.mockResolvedValue({ machineLearning: { clip: { maxDistance: 0.5 } } });
      const { user: me } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const spaceId = await newSpace(ctx, other.id);
      const [theirs] = await photos(ctx, 1, { ownerId: other.id });
      await ctx.get(SearchRepository).upsert(theirs, unitVector(0));
      const { album } = await ctx.newAlbum({ ownerId: other.id }, [theirs]);

      await expect(optionsFor(sut, me.id, { spaceId })).rejects.toThrow('Not found or no sharedSpace.read access');
      await expect(optionsFor(sut, me.id, { albumIds: [album.id] })).rejects.toThrow(
        'Not found or no album.read access',
      );
      await expect(optionsFor(sut, me.id, { queryAssetId: theirs })).rejects.toThrow(
        'Not found or no asset.read access',
      );
    });
  });

  describe('empty library', () => {
    it('answers a new user with empty lists, total 0 and every flag false', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      await expect(
        optionsFor(sut, user.id, { withSharedSpaces: true, visibility: AssetVisibility.Timeline }),
      ).resolves.toEqual({
        total: 0,
        timeBuckets: [],
        people: [],
        hasUnnamedPeople: false,
        tags: [],
        countries: [],
        cameraMakes: [],
        ratings: [],
        mediaTypes: [],
        availability: {
          hasAssets: false,
          hasPeople: false,
          hasTags: false,
          hasPlaces: false,
          hasCameras: false,
          hasRatings: false,
          hasImages: false,
          hasVideos: false,
          hasFavorites: false,
          hasAssetsInAlbum: false,
          hasAssetsNotInAlbum: false,
        },
      });
    });
  });

  describe('flags', () => {
    it('reports the #910 flags ignoring their own filters', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      // each flag ignores only its own filter: the favourite is not in an album, the filed asset is no favourite
      await photo(ctx, { ownerId: user.id, isFavorite: true });
      const filed = await photo(ctx, { ownerId: user.id });
      await ctx.newAlbum({ ownerId: user.id }, [filed]);
      await photo(ctx, { ownerId: user.id });
      const [face] = await photos(ctx, 1, { ownerId: user.id });
      await personOn(ctx, user.id, '', [face]);

      const result = await optionsFor(sut, user.id, { isNotInAlbum: true, isFavorite: false });

      expect(result.total).toBe(2);
      const narrower = await optionsFor(sut, user.id, { isInAlbum: true, isFavorite: true });
      // the only favourite is outside every album, and the only filed asset is no favourite
      expect(narrower.total).toBe(0);
      expect(narrower.availability).toMatchObject({
        hasAssets: false,
        hasFavorites: false,
        hasAssetsInAlbum: false,
        hasAssetsNotInAlbum: true,
      });
      expect(result.availability).toMatchObject({
        hasAssets: true,
        hasFavorites: true,
        hasAssetsInAlbum: true,
        hasAssetsNotInAlbum: true,
      });
      expect(result.hasUnnamedPeople).toBe(true);
    });
  });

  describe('dimensions', () => {
    it('computes only what is asked for, availability by default', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await photo(ctx, { ownerId: user.id, city: 'Kyoto', country: 'Japan' });

      expect(Object.keys(await sut.getSearchOptions(auth(user.id), {}))).toEqual(['availability']);
      expect(await sut.getSearchOptions(auth(user.id), { dimensions: ['places', 'total'] })).toEqual({
        total: 1,
        countries: [{ country: 'Japan', count: 1, cities: [{ city: 'Kyoto', count: 1 }] }],
      });
    });

    it('availability agrees with the lists, in every people branch and with filters', async () => {
      const { sut, ctx } = setup();
      const { user: me } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const spaceId = await newSpace(ctx, member.id, [{ userId: me.id }]);
      const identity = await newIdentity(ctx);
      const [kyoto, lisbon] = [
        await photo(ctx, { ownerId: me.id, city: 'Kyoto', country: 'Japan', make: 'Sony', rating: 4 }),
        await photo(ctx, { ownerId: me.id, city: 'Lisbon', country: 'Portugal', type: AssetType.Video }),
      ];
      const [spaceAsset] = await photos(ctx, 1, { ownerId: member.id, city: 'Kyoto', country: 'Japan' });
      await ctx.newSharedSpaceAsset({ spaceId, assetId: spaceAsset, addedById: member.id });
      const anna = await personOn(ctx, me.id, 'Anna', [kyoto], identity);
      await personOn(ctx, me.id, '', [lisbon]);
      await spacePersonOn(ctx, spaceId, 'Pia', [spaceAsset]);
      const { tag } = await ctx.newTag({ userId: me.id, value: 'beach' });
      await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [kyoto] });

      const requests: SearchOptionsRequestDto[] = [
        {},
        { city: 'Lisbon' },
        { type: AssetType.Video },
        { tagIds: [tag.id] },
        { tagIds: null },
        { rating: 5 },
        { personIds: [anna] },
        { withSharedSpaces: true, visibility: AssetVisibility.Timeline },
        { withSharedSpaces: true, visibility: AssetVisibility.Timeline, city: 'Lisbon' },
        { withSharedSpaces: true, visibility: AssetVisibility.Timeline, personIds: [`person:${anna}`] },
        { spaceId },
        { spaceId, make: 'Canon' },
      ];
      for (const request of requests) {
        const result = await optionsFor(sut, me.id, request);
        const lists = {
          hasAssets: result.total! > 0,
          hasPeople: result.people!.length > 0,
          hasTags: result.tags!.length > 0,
          hasPlaces: result.countries!.length > 0,
          hasCameras: result.cameraMakes!.length > 0,
          hasRatings: result.ratings!.length > 0,
          hasImages: result.mediaTypes!.some(({ type }) => type === AssetType.Image),
          hasVideos: result.mediaTypes!.some(({ type }) => type === AssetType.Video),
        };
        expect({ request, ...result.availability }).toMatchObject({ request, ...lists });
      }
    });
    it('availability still agrees with the lists when every inline probe runs out of time', async () => {
      const { sut, ctx } = setup();
      const repository = ctx.get(SmartFacetRepository);
      const { user: me } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const spaceId = await newSpace(ctx, member.id, [{ userId: me.id }]);
      const [kyoto, lisbon] = [
        await photo(ctx, { ownerId: me.id, city: 'Kyoto', country: 'Japan', make: 'Sony', rating: 4 }),
        await photo(ctx, { ownerId: me.id, city: 'Lisbon', country: 'Portugal', type: AssetType.Video }),
      ];
      const [spaceAsset] = await photos(ctx, 1, { ownerId: member.id, city: 'Kyoto', country: 'Japan' });
      await ctx.newSharedSpaceAsset({ spaceId, assetId: spaceAsset, addedById: member.id });
      const anna = await personOn(ctx, me.id, 'Anna', [kyoto]);
      await spacePersonOn(ctx, spaceId, 'Pia', [spaceAsset]);
      ctx.getMock(SystemMetadataRepository).get.mockResolvedValue({ machineLearning: { clip: { maxDistance: 0.5 } } });
      for (const id of [kyoto, lisbon, spaceAsset]) {
        await ctx.get(SearchRepository).upsert(id, unitVector(0));
      }

      // Every inline attempt sleeps past its budget, so Postgres cancels it and the materialised answer stands in: the
      // shared statement for the probes that read the request's own set, a probe of its own for the rest (the people
      // probe under a people filter, the places probe under a country). Query mode never tries inline.
      repository.fastProbeMs = 20;
      const probeInline = repository as unknown as { probeInline: (on: Kysely<DB>) => Promise<boolean> };
      const inline = vi.spyOn(probeInline, 'probeInline').mockImplementation(async (on) => {
        await sql`SELECT pg_sleep(1) AS search_options_probe`.execute(on);
        return true;
      });
      const requests: SearchOptionsRequestDto[] = [
        { city: 'Lisbon' },
        { personIds: [anna] },
        { spaceId },
        { spaceId, make: 'Canon' },
        { queryAssetId: kyoto, withSharedSpaces: true, visibility: AssetVisibility.Timeline, country: 'Japan' },
      ];
      for (const request of requests) {
        const result = await optionsFor(sut, me.id, request);
        const lists = {
          hasAssets: result.total! > 0,
          hasPeople: result.people!.length > 0,
          hasPlaces: result.countries!.length > 0,
          hasCameras: result.cameraMakes!.length > 0,
          hasRatings: result.ratings!.length > 0,
          hasImages: result.mediaTypes!.some(({ type }) => type === AssetType.Image),
          hasVideos: result.mediaTypes!.some(({ type }) => type === AssetType.Video),
        };
        expect({ request, ...result.availability }).toMatchObject({ request, ...lists });
      }
      expect(inline).toHaveBeenCalledTimes((requests.length - 1) * 11);
    });
  });

  describe('cache', () => {
    it('serves an unfiltered request from cache until an asset, face or tag it reads changes', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const repository = ctx.get(SmartFacetRepository);
      const compute = vi.spyOn(repository, 'getSearchOptions');
      const [first, second] = await photos(ctx, 2, { ownerId: user.id });
      await personOn(ctx, user.id, 'Anna', [first]);
      // Ben and the tag exist up front, so each step below writes only the one table it is about.
      const { person: ben } = await ctx.newPerson({ ownerId: user.id, name: 'Ben' });
      const { tag } = await ctx.newTag({ userId: user.id, value: 'beach' });
      const unfiltered = { dimensions: ['total', 'people', 'tags'] } as SearchOptionsRequestDto;
      // Only Date is faked, and every read moves it past the refresh interval: a change (including Postgres's write
      // counters, which land late) is refreshed on the next read rather than after 30 s.
      vi.useFakeTimers({ toFake: ['Date'] });
      const read = () => {
        vi.setSystemTime(Date.now() + SEARCH_OPTIONS_REFRESH_INTERVAL_MS);
        return sut.getSearchOptions(auth(user.id), unfiltered);
      };

      const initial = await read();
      expect(initial.total).toBe(2);
      await read();
      expect(compute).toHaveBeenCalledTimes(1);

      // an asset row alone
      await ctx.newAsset({ ownerId: user.id, fileCreatedAt: TAKEN, localDateTime: TAKEN });
      // stale while revalidate: the previous result at once, flagged, then the refreshed one
      const afterAsset = await read();
      expect(afterAsset).toMatchObject({ total: 2, stale: true });
      expect(
        await until(async () => {
          const { total, stale } = await read();
          return total === 3 && !stale;
        }),
      ).toBe(true);

      // an asset_face row alone
      await ctx.newAssetFace({ assetId: second, personGroupId: ben.personGroupId });
      expect(
        await until(async () => {
          const { people } = await read();
          return people?.length === 2;
        }),
      ).toBe(true);

      // a tag_asset row alone
      await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [second] });
      expect(
        await until(async () => {
          const { tags } = await read();
          return tags?.length === 1;
        }),
      ).toBe(true);

      const calls = compute.mock.calls.length;
      await read();
      expect(compute).toHaveBeenCalledTimes(calls);
    });

    it('never caches a filtered request, and keys the cache by user and scope', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      await photo(ctx, { ownerId: user.id, city: 'Kyoto', country: 'Japan' });
      const compute = vi.spyOn(ctx.get(SmartFacetRepository), 'getSearchOptions');
      const total = (userId: string, dto: SearchOptionsRequestDto) =>
        sut.getSearchOptions(auth(userId), { ...dto, dimensions: ['total'] }).then((result) => result.total);

      expect(await total(user.id, { city: 'Kyoto' })).toBe(1);
      expect(await total(user.id, { city: 'Kyoto' })).toBe(1);
      expect(compute).toHaveBeenCalledTimes(2);

      expect(await total(user.id, {})).toBe(1);
      expect(await total(other.id, {})).toBe(0);
      expect(await total(user.id, { visibility: AssetVisibility.Archive })).toBe(0);
      expect(compute).toHaveBeenCalledTimes(5);
    });
  });
});

describe('POST /search/options with a library view (#1038)', () => {
  it('counts what /timeline/buckets shows under each view, each view cached on its own', async () => {
    const { sut, ctx, timeline } = setup();
    const { me, name } = await seedLibraryView(ctx);
    const photosScope = { withSharedSpaces: true, withPartners: true, visibility: AssetVisibility.Timeline } as const;

    // Unfiltered requests are served from the cache, so asking each view in turn also checks that the view is part of
    // the cache key.
    for (const [libraryView, expected] of [
      [undefined, ['mine', 'mineInAlbum', 'mineInLibrary', 'mineInSpace', 'partner', 'peerInSpace']],
      [LibraryView.Personal, ['mine']],
      [LibraryView.Spaces, ['mineInAlbum', 'mineInLibrary', 'mineInSpace', 'peerInSpace']],
      [undefined, ['mine', 'mineInAlbum', 'mineInLibrary', 'mineInSpace', 'partner', 'peerInSpace']],
    ] as const) {
      const dto = { ...photosScope, libraryView };
      const results = name(await resultIds(timeline, me.id, dto));
      const { total } = await optionsFor(sut, me.id, dto);
      expect({ libraryView, results, total }).toEqual({ libraryView, results: expected, total: expected.length });
    }
  });

  it('narrows a filtered request too', async () => {
    const { sut, ctx } = setup();
    const { me } = await seedLibraryView(ctx);
    const dto = {
      withSharedSpaces: true,
      withPartners: true,
      visibility: AssetVisibility.Timeline,
      libraryView: LibraryView.Spaces,
      isNotInAlbum: true,
    } as const;

    // mineInSpace, mineInLibrary and peerInSpace are in no album; mineInAlbum is.
    const { total } = await optionsFor(sut, me.id, dto);
    expect(total).toBe(3);
  });
});
