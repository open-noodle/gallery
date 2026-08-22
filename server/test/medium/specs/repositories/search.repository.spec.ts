import { Kysely } from 'kysely';
import { AlbumUserRole, AssetType, AssetVisibility } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { TagRepository } from 'src/repositories/tag.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { upsertTags } from 'src/utils/tag';
import { newMediumService } from 'test/medium.factory';
import { newEmbedding } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const matchingEmbedding = `[${Array.from({ length: 512 }, () => '0.01').join(',')}]`;
const farEmbedding = `[${Array.from({ length: 512 }, () => '-0.01').join(',')}]`;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [AssetRepository, SearchRepository, PersonRepository, SharedSpaceRepository, TagRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(SearchRepository) };
};

const addEmbedding = async (db: Kysely<DB>, assetId: string, embedding = matchingEmbedding) => {
  await db.insertInto('smart_search').values({ assetId, embedding }).execute();
};

/**
 * Two Canon bodies on one owner: an R5 image and a 7D image. Every #858 test narrows some
 * dimension so that only the R5 asset survives, then asserts the 7D model disappeared.
 */
const newCanonPair = async (ctx: Awaited<ReturnType<typeof setup>>['ctx'], userId: string) => {
  const { asset: r5 } = await ctx.newAsset({ ownerId: userId });
  await ctx.newExif({ assetId: r5.id, make: 'Canon', model: 'Canon EOS R5' });

  const { asset: sevenD } = await ctx.newAsset({ ownerId: userId });
  await ctx.newExif({ assetId: sevenD.id, make: 'Canon', model: 'Canon EOS 7D' });

  return { r5, sevenD };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SearchRepository.name, () => {
  describe('getSmartSearchFacets', () => {
    it('aggregates exact facets from all smart-search candidates and ignores nonmatching embeddings', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { asset: january } = await ctx.newAsset({
        ownerId: user.id,
        fileCreatedAt: new Date('2024-01-15T10:00:00.000Z'),
        localDateTime: new Date('2024-01-15T10:00:00.000Z'),
      });
      const { asset: february } = await ctx.newAsset({
        ownerId: user.id,
        type: AssetType.Video,
        isFavorite: true,
        fileCreatedAt: new Date('2024-02-20T10:00:00.000Z'),
        localDateTime: new Date('2024-02-20T10:00:00.000Z'),
      });
      const { asset: farAway } = await ctx.newAsset({ ownerId: user.id });
      const { asset: inaccessible } = await ctx.newAsset({ ownerId: otherUser.id });

      await ctx.newExif({
        assetId: january.id,
        country: 'Germany',
        city: 'Berlin',
        make: 'Sony',
        model: 'A7',
        rating: 4,
      });
      await ctx.newExif({
        assetId: february.id,
        country: 'France',
        city: 'Paris',
        make: 'Canon',
        model: 'R5',
        rating: 5,
      });
      await ctx.newExif({
        assetId: farAway.id,
        country: 'Norway',
        city: 'Bergen',
        make: 'Nikon',
        model: 'Z8',
        rating: 5,
      });
      await ctx.newExif({
        assetId: inaccessible.id,
        country: 'Spain',
        city: 'Madrid',
        make: 'Leica',
        model: 'Q3',
        rating: 5,
      });
      await addEmbedding(ctx.database, january.id);
      await addEmbedding(ctx.database, february.id);
      await addEmbedding(ctx.database, farAway.id, farEmbedding);
      await addEmbedding(ctx.database, inaccessible.id);

      const [travel] = await upsertTags(ctx.get(TagRepository), { userId: user.id, tags: ['Travel'] });
      await ctx.newTagAsset({ tagIds: [travel.id], assetIds: [january.id, february.id] });

      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ada' });
      await ctx.newAssetFace({ assetId: january.id, personGroupId: person.personGroupId });

      const result = await sut.getSmartSearchFacets({
        embedding: matchingEmbedding,
        userIds: [user.id],
        maxDistance: 0.01,
      });

      expect(result.total).toBe(2);
      expect(result.timeBuckets).toEqual([
        { timeBucket: '2024-02-01', count: 1 },
        { timeBucket: '2024-01-01', count: 1 },
      ]);
      expect(result.countries).toEqual(['France', 'Germany']);
      expect(result.cities).toEqual(['Berlin', 'Paris']);
      expect(result.cameraMakes).toEqual(['Canon', 'Sony']);
      expect(result.cameraModels).toEqual(['A7', 'R5']);
      expect(result.tags).toEqual([{ id: travel.id, value: 'Travel' }]);
      expect(result.people).toEqual([
        { id: person.personGroupId, name: 'Ada', primaryProfile: { type: 'user-person', id: person.personGroupId } },
      ]);
      expect(result.ratings).toEqual([4, 5]);
      expect(result.mediaTypes).toEqual(['IMAGE', 'VIDEO']);
      expect(result.hasUnnamedPeople).toBe(false);
    });

    it('applies date filters to total while timeBuckets exclude the date filter group', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: january } = await ctx.newAsset({
        ownerId: user.id,
        fileCreatedAt: new Date('2024-01-15T10:00:00.000Z'),
        localDateTime: new Date('2024-01-15T10:00:00.000Z'),
      });
      const { asset: february } = await ctx.newAsset({
        ownerId: user.id,
        fileCreatedAt: new Date('2024-02-20T10:00:00.000Z'),
        localDateTime: new Date('2024-02-20T10:00:00.000Z'),
      });
      await addEmbedding(ctx.database, january.id);
      await addEmbedding(ctx.database, february.id);

      const result = await sut.getSmartSearchFacets({
        embedding: matchingEmbedding,
        userIds: [user.id],
        maxDistance: 0.01,
        takenAfter: new Date('2024-02-01T00:00:00.000Z'),
        takenBefore: new Date('2024-03-01T00:00:00.000Z'),
      });

      expect(result.total).toBe(1);
      expect(result.timeBuckets).toEqual([
        { timeBucket: '2024-02-01', count: 1 },
        { timeBucket: '2024-01-01', count: 1 },
      ]);
    });

    it('uses localDateTime for smart facet time buckets to match timeline buckets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({
        ownerId: user.id,
        fileCreatedAt: new Date('2024-03-01T00:30:00.000Z'),
        localDateTime: new Date('2024-02-29T23:30:00.000Z'),
      });
      await addEmbedding(ctx.database, asset.id);

      const result = await sut.getSmartSearchFacets({
        embedding: matchingEmbedding,
        userIds: [user.id],
        maxDistance: 0,
      });

      expect(result.timeBuckets).toEqual([{ timeBucket: '2024-02-01', count: 1 }]);
    });

    it('uses all embedded accessible assets when maxDistance is disabled', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      for (let index = 0; index < 125; index++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await ctx.newExif({ assetId: asset.id, country: 'Germany' });
        await addEmbedding(ctx.database, asset.id, index % 2 === 0 ? matchingEmbedding : farEmbedding);
      }

      const result = await sut.getSmartSearchFacets({
        embedding: matchingEmbedding,
        userIds: [user.id],
        maxDistance: 0,
      });

      expect(result.total).toBe(125);
      expect(result.countries).toEqual(['Germany']);
    });

    it('treats rating null as an unrated filter and numeric rating as an inclusive minimum', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: unrated } = await ctx.newAsset({ ownerId: user.id });
      const { asset: ratedThree } = await ctx.newAsset({ ownerId: user.id });
      const { asset: ratedFive } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: unrated.id, rating: null });
      await ctx.newExif({ assetId: ratedThree.id, rating: 3 });
      await ctx.newExif({ assetId: ratedFive.id, rating: 5 });
      await addEmbedding(ctx.database, unrated.id);
      await addEmbedding(ctx.database, ratedThree.id);
      await addEmbedding(ctx.database, ratedFive.id);

      await expect(
        sut.getSmartSearchFacets({ embedding: matchingEmbedding, userIds: [user.id], maxDistance: 0, rating: null }),
      ).resolves.toMatchObject({ total: 1 });
      await expect(
        sut.getSmartSearchFacets({ embedding: matchingEmbedding, userIds: [user.id], maxDistance: 0, rating: 4 }),
      ).resolves.toMatchObject({ total: 1, ratings: [3, 5] });
    });

    it('applies null country filters to total and dependent city facets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: withoutCountry } = await ctx.newAsset({ ownerId: user.id });
      const { asset: withCountry } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: withoutCountry.id, country: null, city: 'Unplaced' });
      await ctx.newExif({ assetId: withCountry.id, country: 'Germany', city: 'Berlin' });
      await addEmbedding(ctx.database, withoutCountry.id);
      await addEmbedding(ctx.database, withCountry.id);

      const result = await sut.getSmartSearchFacets({
        embedding: matchingEmbedding,
        userIds: [user.id],
        maxDistance: 0,
        country: null,
      });

      expect(result.total).toBe(1);
      expect(result.cities).toEqual(['Unplaced']);
    });

    it('applies tagIds null as an untagged filter outside the tag facet group', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: untagged } = await ctx.newAsset({ ownerId: user.id });
      const { asset: tagged } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: untagged.id, country: 'Germany' });
      await ctx.newExif({ assetId: tagged.id, country: 'France' });
      await addEmbedding(ctx.database, untagged.id);
      await addEmbedding(ctx.database, tagged.id);
      const [travel] = await upsertTags(ctx.get(TagRepository), { userId: user.id, tags: ['Travel'] });
      await ctx.newTagAsset({ tagIds: [travel.id], assetIds: [tagged.id] });

      const result = await sut.getSmartSearchFacets({
        embedding: matchingEmbedding,
        userIds: [user.id],
        maxDistance: 0,
        tagIds: null,
      });

      expect(result.total).toBe(1);
      expect(result.countries).toEqual(['Germany']);
      expect(result.tags).toEqual([{ id: travel.id, value: 'Travel' }]);
    });

    it('keeps country/city and make/model dependent facet semantics', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const fixtures = [
        { country: 'Germany', city: 'Berlin', make: 'Sony', model: 'A7' },
        { country: 'Germany', city: 'Munich', make: 'Sony', model: 'A9' },
        { country: 'France', city: 'Paris', make: 'Canon', model: 'R5' },
      ];

      for (const fixture of fixtures) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await ctx.newExif({ assetId: asset.id, ...fixture });
        await addEmbedding(ctx.database, asset.id);
      }

      const locationResult = await sut.getSmartSearchFacets({
        embedding: matchingEmbedding,
        userIds: [user.id],
        maxDistance: 0,
        country: 'Germany',
        city: 'Berlin',
      });

      const cameraResult = await sut.getSmartSearchFacets({
        embedding: matchingEmbedding,
        userIds: [user.id],
        maxDistance: 0,
        make: 'Sony',
        model: 'A7',
      });

      expect(locationResult.total).toBe(1);
      expect(locationResult.countries).toEqual(['France', 'Germany']);
      expect(locationResult.cities).toEqual(['Berlin', 'Munich']);
      expect(cameraResult.total).toBe(1);
      expect(cameraResult.cameraMakes).toEqual(['Canon', 'Sony']);
      expect(cameraResult.cameraModels).toEqual(['A7', 'A9']);
    });

    it('returns empty facets and total 0 when no candidates match', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const result = await sut.getSmartSearchFacets({
        embedding: matchingEmbedding,
        userIds: [user.id],
        maxDistance: 0.01,
      });

      expect(result).toEqual({
        total: 0,
        timeBuckets: [],
        countries: [],
        cities: [],
        cameraMakes: [],
        cameraModels: [],
        tags: [],
        people: [],
        ratings: [],
        mediaTypes: [],
        hasUnnamedPeople: false,
      });
    });

    it('excludes hidden and deleted asset faces from global people facets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: visibleAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: hiddenFaceAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: deletedFaceAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: hiddenUnnamedAsset } = await ctx.newAsset({ ownerId: user.id });
      await addEmbedding(ctx.database, visibleAsset.id);
      await addEmbedding(ctx.database, hiddenFaceAsset.id);
      await addEmbedding(ctx.database, deletedFaceAsset.id);
      await addEmbedding(ctx.database, hiddenUnnamedAsset.id);

      const { person: visiblePerson } = await ctx.newPerson({ ownerId: user.id, name: 'Visible Ada' });
      const { person: hiddenFacePerson } = await ctx.newPerson({ ownerId: user.id, name: 'Hidden Face' });
      const { person: deletedFacePerson } = await ctx.newPerson({ ownerId: user.id, name: 'Deleted Face' });
      const { person: hiddenUnnamedPerson } = await ctx.newPerson({
        ownerId: user.id,
        name: 'Temporary',
        isHidden: true,
      });
      await ctx.database.updateTable('person').set({ name: '' }).where('personGroupId', '=', hiddenUnnamedPerson.personGroupId).execute();

      await ctx.newAssetFace({ assetId: visibleAsset.id, personGroupId: visiblePerson.personGroupId });
      await ctx.newAssetFace({ assetId: hiddenFaceAsset.id, personGroupId: hiddenFacePerson.personGroupId, isVisible: false });
      await ctx.newAssetFace({
        assetId: deletedFaceAsset.id,
        personGroupId: deletedFacePerson.personGroupId,
        deletedAt: new Date('2024-01-01T00:00:00.000Z'),
      });
      await ctx.newAssetFace({ assetId: hiddenUnnamedAsset.id, personGroupId: hiddenUnnamedPerson.personGroupId });

      const result = await sut.getSmartSearchFacets({
        embedding: matchingEmbedding,
        userIds: [user.id],
        maxDistance: 0,
      });

      expect(result.people).toEqual([
        { id: visiblePerson.personGroupId, name: 'Visible Ada', primaryProfile: { type: 'user-person', id: visiblePerson.personGroupId } },
      ]);
      expect(result.hasUnnamedPeople).toBe(false);
    });

    it('returns shared-space person ids when spaceId is set', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      await addEmbedding(ctx.database, asset.id);

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

      const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'Personal Ada' });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const sharedPerson = await ctx.database
        .insertInto('shared_space_person')
        .values({
          spaceId: space.id,
          name: 'Space Ada',
          representativeFaceId: assetFace.id,
          isHidden: false,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await ctx.database
        .insertInto('shared_space_person_face')
        .values({ personId: sharedPerson.id, assetFaceId: assetFace.id })
        .execute();

      const result = await sut.getSmartSearchFacets({
        embedding: matchingEmbedding,
        userIds: [member.id],
        maxDistance: 0.01,
        spaceId: space.id,
      });

      expect(result.people).toEqual([
        {
          id: sharedPerson.id,
          name: 'Space Ada',
          primaryProfile: { type: 'space-person', id: sharedPerson.id, spaceId: space.id },
        },
      ]);
    });

    it('excludes hidden and deleted asset faces from shared-space people facets', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });

      const makeSharedPerson = async (name: string, isVisible = true, deletedAt: Date | null = null) => {
        const { asset } = await ctx.newAsset({ ownerId: owner.id });
        await addEmbedding(ctx.database, asset.id);
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, isVisible, deletedAt });
        const sharedPerson = await ctx.database
          .insertInto('shared_space_person')
          .values({ spaceId: space.id, name, representativeFaceId: assetFace.id, isHidden: false })
          .returningAll()
          .executeTakeFirstOrThrow();
        await ctx.database
          .insertInto('shared_space_person_face')
          .values({ personId: sharedPerson.id, assetFaceId: assetFace.id })
          .execute();
        return sharedPerson;
      };

      const visiblePerson = await makeSharedPerson('Visible Space Ada');
      await makeSharedPerson('Hidden Space Face', false);
      await makeSharedPerson('Deleted Space Face', true, new Date('2024-01-01T00:00:00.000Z'));

      const result = await sut.getSmartSearchFacets({
        embedding: matchingEmbedding,
        userIds: [member.id],
        maxDistance: 0,
        spaceId: space.id,
      });

      expect(result.people).toEqual([
        {
          id: visiblePerson.id,
          name: 'Visible Space Ada',
          primaryProfile: { type: 'space-person', id: visiblePerson.id, spaceId: space.id },
        },
      ]);
      expect(result.hasUnnamedPeople).toBe(false);
    });
  });

  describe('getFilterSuggestions', () => {
    it('returns album facets for a viewer who owns none of the shared album assets', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newExif({ assetId: asset.id, country: 'Germany', city: 'Berlin', make: 'Sony', model: 'A7' });

      const [travel] = await upsertTags(ctx.get(TagRepository), { userId: owner.id, tags: ['Travel'] });
      await ctx.newTagAsset({ tagIds: [travel.id], assetIds: [asset.id] });

      const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'Ada' });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });

      const { album } = await ctx.newAlbum({ ownerId: owner.id }, [asset.id]);
      await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer });

      // A viewer owns none of the album's assets and is in no shared space, so the
      // service calls the repository with the viewer's own id and no timelineSpaceIds.
      const result = await sut.getFilterSuggestions([viewer.id], { albumId: album.id });

      expect(result.countries).toContain('Germany');
      expect(result.cameraMakes).toContain('Sony');
      expect(result.tags.map((tag) => tag.value)).toContain('Travel');
      expect(result.people.map((p) => p.name)).toContain('Ada');
    });

    it('follows the not-locked default: includes archived values, excludes locked-only values (LOW #7)', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: timelineAsset.id, country: 'Germany', make: 'Sony' });

      const { asset: archivedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
      await ctx.newExif({ assetId: archivedAsset.id, country: 'Norway', make: 'ArchivedMake' });

      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      await ctx.newExif({ assetId: lockedAsset.id, country: 'Spain', make: 'LockedMake' });

      const result = await sut.getFilterSuggestions([user.id], { visibility: 'not-locked' });

      expect(result.countries).toEqual(['Germany', 'Norway']);
      expect(result.cameraMakes).toEqual(['ArchivedMake', 'Sony']);
      expect(result.countries).not.toContain('Spain');
      expect(result.cameraMakes).not.toContain('LockedMake');
    });

    it('lets an elevated caller (visibility undefined) see locked-only values too (LOW #7)', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      await ctx.newExif({ assetId: lockedAsset.id, country: 'Spain', make: 'LockedMake' });

      const result = await sut.getFilterSuggestions([user.id], {});

      expect(result.countries).toContain('Spain');
      expect(result.cameraMakes).toContain('LockedMake');
    });

    it('returns empty suggestions with no error when there are no matching assets (LOW #7)', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const result = await sut.getFilterSuggestions([user.id], { visibility: 'not-locked' });

      expect(result).toEqual({
        countries: [],
        cameraMakes: [],
        tags: [],
        people: [],
        ratings: [],
        mediaTypes: [],
        hasUnnamedPeople: false,
      });
    });
  });

  describe('getCameraMakes (LOW #7)', () => {
    it('includes archived-only values under not-locked, excludes locked-only values', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: timelineAsset.id, make: 'Sony' });

      const { asset: archivedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
      await ctx.newExif({ assetId: archivedAsset.id, make: 'ArchivedMake' });

      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      await ctx.newExif({ assetId: lockedAsset.id, make: 'LockedMake' });

      const makes = await sut.getCameraMakes([user.id], { visibility: 'not-locked' });

      expect(makes).toEqual(['ArchivedMake', 'Sony']);
    });
  });

  describe('getCameraModels (#858)', () => {
    it('narrows models by an active tag filter', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { r5 } = await newCanonPair(ctx, user.id);
      const [nature] = await upsertTags(ctx.get(TagRepository), { userId: user.id, tags: ['nature'] });
      await ctx.newTagAsset({ tagIds: [nature.id], assetIds: [r5.id] });

      const models = await sut.getCameraModels([user.id], { make: 'Canon', tagIds: [nature.id] });

      expect(models).toEqual(['Canon EOS R5']);
    });

    it('narrows models by an active person filter', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { r5 } = await newCanonPair(ctx, user.id);
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ada' });
      await ctx.newAssetFace({ assetId: r5.id, personGroupId: person.personGroupId });

      const models = await sut.getCameraModels([user.id], { make: 'Canon', personIds: [person.personGroupId] });

      expect(models).toEqual(['Canon EOS R5']);
    });

    it('narrows models by rating, treating rating as a minimum', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { r5, sevenD } = await newCanonPair(ctx, user.id);
      await ctx.newExif({ assetId: r5.id, rating: 5 });
      await ctx.newExif({ assetId: sevenD.id, rating: 3 });

      const models = await sut.getCameraModels([user.id], { make: 'Canon', rating: 4 });

      expect(models).toEqual(['Canon EOS R5']);
    });

    it('narrows models by media type', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: r5 } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: r5.id, make: 'Canon', model: 'Canon EOS R5' });

      const { asset: sevenD } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
      await ctx.newExif({ assetId: sevenD.id, make: 'Canon', model: 'Canon EOS 7D' });

      const models = await sut.getCameraModels([user.id], { make: 'Canon', mediaType: AssetType.Image });

      expect(models).toEqual(['Canon EOS R5']);
    });

    it('narrows models by the favourite filter', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: r5 } = await ctx.newAsset({ ownerId: user.id, isFavorite: true });
      await ctx.newExif({ assetId: r5.id, make: 'Canon', model: 'Canon EOS R5' });

      const { asset: sevenD } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: sevenD.id, make: 'Canon', model: 'Canon EOS 7D' });

      const models = await sut.getCameraModels([user.id], { make: 'Canon', isFavorite: true });

      expect(models).toEqual(['Canon EOS R5']);
    });

    it('narrows models by an active location filter', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { r5, sevenD } = await newCanonPair(ctx, user.id);
      await ctx.newExif({ assetId: r5.id, country: 'Germany' });
      await ctx.newExif({ assetId: sevenD.id, country: 'France' });

      const models = await sut.getCameraModels([user.id], { make: 'Canon', country: 'Germany' });

      expect(models).toEqual(['Canon EOS R5']);
    });

    it('narrows models by the active date range', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: r5 } = await ctx.newAsset({
        ownerId: user.id,
        fileCreatedAt: new Date('2024-01-15T10:00:00.000Z'),
        localDateTime: new Date('2024-01-15T10:00:00.000Z'),
      });
      await ctx.newExif({ assetId: r5.id, make: 'Canon', model: 'Canon EOS R5' });

      const { asset: sevenD } = await ctx.newAsset({
        ownerId: user.id,
        fileCreatedAt: new Date('2023-01-15T10:00:00.000Z'),
        localDateTime: new Date('2023-01-15T10:00:00.000Z'),
      });
      await ctx.newExif({ assetId: sevenD.id, make: 'Canon', model: 'Canon EOS 7D' });

      const models = await sut.getCameraModels([user.id], {
        make: 'Canon',
        takenAfter: new Date('2024-01-01T00:00:00.000Z'),
      });

      expect(models).toEqual(['Canon EOS R5']);
    });

    it('narrows models by the not-in-album filter', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { sevenD } = await newCanonPair(ctx, user.id);
      await ctx.newAlbum({ ownerId: user.id }, [sevenD.id]);

      const models = await sut.getCameraModels([user.id], { make: 'Canon', isNotInAlbum: true });

      expect(models).toEqual(['Canon EOS R5']);
    });

    it('still narrows by the parent make', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      await newCanonPair(ctx, user.id);

      const { asset: nikon } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: nikon.id, make: 'Nikon', model: 'Nikon Z8' });

      const models = await sut.getCameraModels([user.id], { make: 'Canon' });

      expect(models).toEqual(['Canon EOS 7D', 'Canon EOS R5']);
    });

    it('still narrows by lens model', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { r5, sevenD } = await newCanonPair(ctx, user.id);
      await ctx.newExif({ assetId: r5.id, lensModel: 'RF 24-70' });
      await ctx.newExif({ assetId: sevenD.id, lensModel: 'EF 50' });

      const models = await sut.getCameraModels([user.id], { make: 'Canon', lensModel: 'RF 24-70' });

      expect(models).toEqual(['Canon EOS R5']);
    });

    it('does not self-narrow when a model is already selected', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      await newCanonPair(ctx, user.id);

      const models = await sut.getCameraModels([user.id], { make: 'Canon', model: 'Canon EOS R5' });

      expect(models).toEqual(['Canon EOS 7D', 'Canon EOS R5']);
    });

    it('returns nothing when forceEmptyResult is set', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      await newCanonPair(ctx, user.id);

      const models = await sut.getCameraModels([user.id], { make: 'Canon', forceEmptyResult: true });

      expect(models).toEqual([]);
    });

    it('narrows models by an active face-identity filter', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { r5 } = await newCanonPair(ctx, user.id);

      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ada' });
      const { assetFace } = await ctx.newAssetFace({ assetId: r5.id, personGroupId: person.personGroupId });
      const identity = await ctx.database
        .insertInto('face_identity')
        .values({ type: 'person' })
        .returningAll()
        .executeTakeFirstOrThrow();
      await ctx.database
        .insertInto('face_identity_face')
        .values({ identityId: identity.id, assetFaceId: assetFace.id, source: 'backfill' })
        .execute();

      const models = await sut.getCameraModels([user.id], { make: 'Canon', identityIds: [identity.id] });

      expect(models).toEqual(['Canon EOS R5']);
    });

    it('includes archived-only models under not-locked and excludes locked-only models', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: r5 } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
      await ctx.newExif({ assetId: r5.id, make: 'Canon', model: 'Canon EOS R5' });

      const { asset: sevenD } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: sevenD.id, make: 'Canon', model: 'Canon EOS 7D' });

      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      await ctx.newExif({ assetId: lockedAsset.id, make: 'Canon', model: 'Canon EOS 90D' });

      const models = await sut.getCameraModels([user.id], { make: 'Canon', visibility: 'not-locked' });

      expect(models).toEqual(['Canon EOS 7D', 'Canon EOS R5']);
      expect(models).not.toContain('Canon EOS 90D');
    });

    it('lets an elevated caller (visibility undefined) see locked-only models', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      await ctx.newExif({ assetId: lockedAsset.id, make: 'Canon', model: 'Canon EOS 90D' });

      const models = await sut.getCameraModels([user.id], { make: 'Canon' });

      expect(models).toContain('Canon EOS 90D');
    });

    it("never returns another user's models", async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      await newCanonPair(ctx, user.id);

      const { asset: otherAsset } = await ctx.newAsset({ ownerId: otherUser.id });
      await ctx.newExif({ assetId: otherAsset.id, make: 'Canon', model: 'Canon EOS 90D' });

      const models = await sut.getCameraModels([user.id], { make: 'Canon' });

      expect(models).not.toContain('Canon EOS 90D');
    });

    it('excludes trashed assets', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { sevenD } = await newCanonPair(ctx, user.id);
      await ctx.softDeleteAsset(sevenD.id);

      const models = await sut.getCameraModels([user.id], { make: 'Canon' });

      expect(models).toEqual(['Canon EOS R5']);
    });

    it('returns distinct values sorted ascending', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      await newCanonPair(ctx, user.id);

      const { asset: r5b } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: r5b.id, make: 'Canon', model: 'Canon EOS R5' });

      const models = await sut.getCameraModels([user.id], { make: 'Canon' });

      expect(models).toEqual(['Canon EOS 7D', 'Canon EOS R5']);
    });

    it('returns an empty list when the filter set matches nothing, without throwing', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      await newCanonPair(ctx, user.id);
      const [unused] = await upsertTags(ctx.get(TagRepository), { userId: user.id, tags: ['unused'] });

      const models = await sut.getCameraModels([user.id], { make: 'Canon', tagIds: [unused.id] });

      expect(models).toEqual([]);
    });
  });

  describe('getCameraMakes (#858)', () => {
    it('narrows makes by an active tag filter', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: canonAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: canonAsset.id, make: 'Canon' });

      const { asset: nikonAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: nikonAsset.id, make: 'Nikon' });

      const [nature] = await upsertTags(ctx.get(TagRepository), { userId: user.id, tags: ['nature'] });
      await ctx.newTagAsset({ tagIds: [nature.id], assetIds: [canonAsset.id] });

      const makes = await sut.getCameraMakes([user.id], { tagIds: [nature.id] });

      expect(makes).toEqual(['Canon']);
    });

    it('narrows makes by rating and the favourite filter', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: canonAsset } = await ctx.newAsset({ ownerId: user.id, isFavorite: true });
      await ctx.newExif({ assetId: canonAsset.id, make: 'Canon', rating: 5 });

      const { asset: nikonAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: nikonAsset.id, make: 'Nikon', rating: 2 });

      const makes = await sut.getCameraMakes([user.id], { rating: 4, isFavorite: true });

      expect(makes).toEqual(['Canon']);
    });

    it('does not self-narrow when a make is already selected', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: canonAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: canonAsset.id, make: 'Canon' });

      const { asset: nikonAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: nikonAsset.id, make: 'Nikon' });

      const makes = await sut.getCameraMakes([user.id], { make: 'Canon' });

      expect(makes).toEqual(['Canon', 'Nikon']);
    });

    it('still narrows by the sibling model', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: canonAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: canonAsset.id, make: 'Canon', model: 'Canon EOS R5' });

      const { asset: nikonAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: nikonAsset.id, make: 'Nikon', model: 'Nikon Z8' });

      const makes = await sut.getCameraMakes([user.id], { model: 'Nikon Z8' });

      expect(makes).toEqual(['Nikon']);
    });

    it('returns nothing when forceEmptyResult is set', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: canonAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: canonAsset.id, make: 'Canon' });

      const makes = await sut.getCameraMakes([user.id], { forceEmptyResult: true });

      expect(makes).toEqual([]);
    });

    it('keeps the not-locked visibility semantics', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: timelineAsset.id, make: 'Sony' });

      const { asset: archivedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
      await ctx.newExif({ assetId: archivedAsset.id, make: 'ArchivedMake' });

      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      await ctx.newExif({ assetId: lockedAsset.id, make: 'LockedMake' });

      const makes = await sut.getCameraMakes([user.id], { visibility: 'not-locked' });

      expect(makes).toEqual(['ArchivedMake', 'Sony']);
      expect(makes).not.toContain('LockedMake');
    });

    it('returns distinct makes when several assets share a make', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: asset1 } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset1.id, make: 'Canon' });

      const { asset: asset2 } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset2.id, make: 'Canon' });

      const { asset: asset3 } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset3.id, make: 'Canon' });

      const makes = await sut.getCameraMakes([user.id], {});

      expect(makes).toEqual(['Canon']);
    });
  });

  describe('getCountries (#858)', () => {
    it('narrows countries by an active tag filter', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: germanyAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: germanyAsset.id, country: 'Germany' });

      const { asset: franceAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: franceAsset.id, country: 'France' });

      const [nature] = await upsertTags(ctx.get(TagRepository), { userId: user.id, tags: ['nature'] });
      await ctx.newTagAsset({ tagIds: [nature.id], assetIds: [germanyAsset.id] });

      const countries = await sut.getCountries([user.id], { tagIds: [nature.id] });

      expect(countries).toEqual(['Germany']);
    });

    it('does not self-narrow when a country is already selected', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: germanyAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: germanyAsset.id, country: 'Germany' });

      const { asset: franceAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: franceAsset.id, country: 'France' });

      const countries = await sut.getCountries([user.id], { country: 'Germany' });

      expect(countries).toEqual(['France', 'Germany']);
    });

    it('does not self-narrow when a city is already selected', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: berlinAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: berlinAsset.id, country: 'Germany', city: 'Berlin' });

      const { asset: parisAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: parisAsset.id, country: 'France', city: 'Paris' });

      const countries = await sut.getCountries([user.id], { city: 'Berlin' });

      expect(countries).toEqual(['France', 'Germany']);
    });

    it('keeps the not-locked visibility semantics', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: timelineAsset.id, country: 'Germany' });

      const { asset: archivedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
      await ctx.newExif({ assetId: archivedAsset.id, country: 'Austria' });

      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      await ctx.newExif({ assetId: lockedAsset.id, country: 'Spain' });

      const countries = await sut.getCountries([user.id], { visibility: 'not-locked' });

      expect(countries).toEqual(['Austria', 'Germany']);
      expect(countries).not.toContain('Spain');
    });
  });

  describe('getStates (#858)', () => {
    it('narrows states by an active tag filter', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: berlinAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: berlinAsset.id, country: 'Germany', state: 'Berlin' });

      const { asset: bavariaAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: bavariaAsset.id, country: 'Germany', state: 'Bavaria' });

      const [nature] = await upsertTags(ctx.get(TagRepository), { userId: user.id, tags: ['nature'] });
      await ctx.newTagAsset({ tagIds: [nature.id], assetIds: [berlinAsset.id] });

      const states = await sut.getStates([user.id], { tagIds: [nature.id] });

      expect(states).toEqual(['Berlin']);
    });

    it('still narrows by the parent country', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: berlinAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: berlinAsset.id, country: 'Germany', state: 'Berlin' });

      const { asset: idfAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: idfAsset.id, country: 'France', state: 'Ile-de-France' });

      const states = await sut.getStates([user.id], { country: 'Germany' });

      expect(states).toEqual(['Berlin']);
    });

    it('does not self-narrow when a city is already selected', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: berlinAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: berlinAsset.id, country: 'Germany', state: 'Berlin', city: 'Berlin' });

      const { asset: munichAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: munichAsset.id, country: 'Germany', state: 'Bavaria', city: 'Munich' });

      const states = await sut.getStates([user.id], { country: 'Germany', city: 'Berlin' });

      expect(states).toEqual(['Bavaria', 'Berlin']);
    });

    it('keeps the not-locked visibility semantics', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: timelineAsset.id, state: 'Bavaria' });

      const { asset: archivedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
      await ctx.newExif({ assetId: archivedAsset.id, state: 'ArchivedState' });

      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      await ctx.newExif({ assetId: lockedAsset.id, state: 'LockedState' });

      const states = await sut.getStates([user.id], { visibility: 'not-locked' });

      expect(states).toEqual(['ArchivedState', 'Bavaria']);
      expect(states).not.toContain('LockedState');
    });
  });

  describe('getCameraLensModels (#858)', () => {
    it('narrows lens models by an active tag filter', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: rfAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: rfAsset.id, make: 'Canon', lensModel: 'RF 24-70' });

      const { asset: efAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: efAsset.id, make: 'Canon', lensModel: 'EF 50' });

      const [nature] = await upsertTags(ctx.get(TagRepository), { userId: user.id, tags: ['nature'] });
      await ctx.newTagAsset({ tagIds: [nature.id], assetIds: [rfAsset.id] });

      const lensModels = await sut.getCameraLensModels([user.id], { tagIds: [nature.id] });

      expect(lensModels).toEqual(['RF 24-70']);
    });

    it('still narrows by make and model', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: r5Asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: r5Asset.id, make: 'Canon', model: 'Canon EOS R5', lensModel: 'RF 24-70' });

      const { asset: sevenDAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: sevenDAsset.id, make: 'Canon', model: 'Canon EOS 7D', lensModel: 'EF 50' });

      const lensModels = await sut.getCameraLensModels([user.id], { make: 'Canon', model: 'Canon EOS 7D' });

      expect(lensModels).toEqual(['EF 50']);
    });

    it('keeps the not-locked visibility semantics', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: timelineAsset.id, lensModel: 'RF 24-70mm' });

      const { asset: archivedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
      await ctx.newExif({ assetId: archivedAsset.id, lensModel: 'Archived 24mm' });

      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      await ctx.newExif({ assetId: lockedAsset.id, lensModel: 'Locked 50mm' });

      const lensModels = await sut.getCameraLensModels([user.id], { visibility: 'not-locked' });

      expect(lensModels).toEqual(['Archived 24mm', 'RF 24-70mm']);
      expect(lensModels).not.toContain('Locked 50mm');
    });
  });

  describe('getAccessibleTags (LOW #7)', () => {
    it('includes tags from archived assets under not-locked, excludes locked-only tags', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: archivedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });

      const [timelineTag, archivedTag, lockedTag] = await upsertTags(ctx.get(TagRepository), {
        userId: user.id,
        tags: ['TimelineTag', 'ArchivedTag', 'LockedTag'],
      });
      await ctx.newTagAsset({ tagIds: [timelineTag.id], assetIds: [timelineAsset.id] });
      await ctx.newTagAsset({ tagIds: [archivedTag.id], assetIds: [archivedAsset.id] });
      await ctx.newTagAsset({ tagIds: [lockedTag.id], assetIds: [lockedAsset.id] });

      const tags = await sut.getAccessibleTags([user.id], { visibility: 'not-locked' });

      expect(tags.map((tag) => tag.value)).toEqual(expect.arrayContaining(['TimelineTag', 'ArchivedTag']));
      expect(tags.map((tag) => tag.value)).not.toContain('LockedTag');
    });
  });

  // #867: /places ("view all" for the Explore strip) was scoped to own + partner assets only, so a
  // space member saw none of the cities from the assets shared with them.
  describe('getAssetsByCity — shared-space scope (issue #867)', () => {
    it('returns a city that only exists on an asset shared into a timeline-enabled space', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });

      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newExif({ assetId: asset.id, city: 'Valparaiso' });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

      const withSpace = await sut.getAssetsByCity([member.id], [space.id]);
      expect(withSpace.map((item) => item.id)).toContain(asset.id);

      const ownOnly = await sut.getAssetsByCity([member.id]);
      expect(ownOnly.map((item) => item.id)).not.toContain(asset.id);
    });

    it('returns a city from an album linked into the space only while the link is on-timeline', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });

      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newExif({ assetId: asset.id, city: 'Ushuaia' });
      const { result: album } = await ctx.newAlbum({ ownerId: owner.id }, [asset.id]);
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: true });

      const shown = await sut.getAssetsByCity([member.id], [space.id]);
      expect(shown.map((item) => item.id)).toContain(asset.id);

      await ctx.database
        .updateTable('shared_space_album')
        .set({ showInTimeline: false })
        .where('spaceId', '=', space.id)
        .where('albumId', '=', album.id)
        .execute();

      const hidden = await sut.getAssetsByCity([member.id], [space.id]);
      expect(hidden.map((item) => item.id)).not.toContain(asset.id);
    });

    it('does not return archived space assets', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });

      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
      await ctx.newExif({ assetId: asset.id, city: 'Punta Arenas' });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

      const result = await sut.getAssetsByCity([member.id], [space.id]);
      expect(result.map((item) => item.id)).not.toContain(asset.id);
    });
  });

  describe('searchFaces hasPerson tri-state', () => {
    let ownerId: string;
    let assignedFaceId: string;
    let unassignedFaceId: string;
    let faceEmbedding: string;

    beforeAll(async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      ownerId = user.id;

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ada' });

      const { assetFace: assignedFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const { assetFace: unassignedFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: null });

      assignedFaceId = assignedFace.id;
      unassignedFaceId = unassignedFace.id;

      faceEmbedding = newEmbedding();
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: assignedFaceId, embedding: faceEmbedding })
        .execute();
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: unassignedFaceId, embedding: faceEmbedding })
        .execute();
    });

    it('hasPerson:false returns only unassigned faces', async () => {
      const { sut } = setup();
      const result = await sut.searchFaces({
        userIds: [ownerId],
        embedding: faceEmbedding,
        numResults: 10,
        maxDistance: 2,
        hasPerson: false,
      });
      const ids = result.map((r) => r.id);
      expect(ids).toContain(unassignedFaceId);
      expect(ids).not.toContain(assignedFaceId);
      expect(result.every((r) => r.personGroupId === null)).toBe(true);
    });

    it('hasPerson:true returns only assigned faces (regression)', async () => {
      const { sut } = setup();
      const result = await sut.searchFaces({
        userIds: [ownerId],
        embedding: faceEmbedding,
        numResults: 10,
        maxDistance: 2,
        hasPerson: true,
      });
      const ids = result.map((r) => r.id);
      expect(ids).toContain(assignedFaceId);
      expect(ids).not.toContain(unassignedFaceId);
      expect(result.every((r) => r.personGroupId !== null)).toBe(true);
    });

    it('hasPerson omitted returns both assigned and unassigned', async () => {
      const { sut } = setup();
      const result = await sut.searchFaces({
        userIds: [ownerId],
        embedding: faceEmbedding,
        numResults: 10,
        maxDistance: 2,
      });
      const ids = result.map((r) => r.id);
      expect(ids).toContain(assignedFaceId);
      expect(ids).toContain(unassignedFaceId);
    });

    it('spaceId returns unassigned faces from direct shared assets and linked libraries without owner filtering', async () => {
      const { ctx, sut } = setup();
      const { user: spaceOwner } = await ctx.newUser();
      const { user: directOwner } = await ctx.newUser();
      const { user: libraryOwner } = await ctx.newUser();
      const { user: outsideOwner } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: spaceOwner.id });
      const { library } = await ctx.newLibrary({ ownerId: libraryOwner.id });

      const { asset: directAsset } = await ctx.newAsset({ ownerId: directOwner.id });
      const { asset: libraryAsset } = await ctx.newAsset({ ownerId: libraryOwner.id, libraryId: library.id });
      const { asset: outsideAsset } = await ctx.newAsset({ ownerId: outsideOwner.id });

      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: directAsset.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

      const { assetFace: directFace } = await ctx.newAssetFace({ assetId: directAsset.id, personGroupId: null });
      const { assetFace: libraryFace } = await ctx.newAssetFace({ assetId: libraryAsset.id, personGroupId: null });
      const { assetFace: outsideFace } = await ctx.newAssetFace({ assetId: outsideAsset.id, personGroupId: null });

      const embedding = newEmbedding();
      await ctx.database
        .insertInto('face_search')
        .values([
          { faceId: directFace.id, embedding },
          { faceId: libraryFace.id, embedding },
          { faceId: outsideFace.id, embedding },
        ])
        .execute();

      const result = await sut.searchFaces({
        spaceId: space.id,
        embedding,
        numResults: 10,
        maxDistance: 2,
        hasPerson: false,
      });

      const ids = result.map((face) => face.id);
      expect(ids).toEqual(expect.arrayContaining([directFace.id, libraryFace.id]));
      expect(ids).not.toContain(outsideFace.id);
    });

    it('spaceId still respects hasPerson:false by excluding assigned faces', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Grace' });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

      const { assetFace: assignedFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const { assetFace: unassignedFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: null });

      const embedding = newEmbedding();
      await ctx.database
        .insertInto('face_search')
        .values([
          { faceId: assignedFace.id, embedding },
          { faceId: unassignedFace.id, embedding },
        ])
        .execute();

      const result = await sut.searchFaces({
        spaceId: space.id,
        embedding,
        numResults: 10,
        maxDistance: 2,
        hasPerson: false,
      });

      const ids = result.map((face) => face.id);
      expect(ids).toContain(unassignedFace.id);
      expect(ids).not.toContain(assignedFace.id);
      expect(result.every((face) => face.personGroupId === null)).toBe(true);
    });

    it('rejects mixed spaceId and userIds scopes', async () => {
      const { sut } = setup();

      await expect(
        sut.searchFaces({
          spaceId: ownerId,
          userIds: [ownerId],
          embedding: faceEmbedding,
          numResults: 10,
          maxDistance: 2,
        }),
      ).rejects.toThrow('Cannot mix spaceId and userIds');
    });
  });

  // Slice 1 (F2): the owner-scoped branch of searchFaces has no visibility gate by default — a Locked or
  // Hidden asset's faces flow into the suggestion/cleanup scans unfiltered. `visibility` is a new, opt-in
  // option; passing it excludes non-reviewable assets. S1.1-S1.3.
  describe('searchFaces visibility option (Slice 1)', () => {
    it('S1.1: with visibility: [archive, timeline], omits a face on a locked asset and returns a control face on a timeline asset', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });

      const embedding = newEmbedding();
      const { assetFace: lockedFace } = await ctx.newAssetFace({ assetId: lockedAsset.id, personGroupId: null });
      const { assetFace: timelineFace } = await ctx.newAssetFace({ assetId: timelineAsset.id, personGroupId: null });
      await ctx.database
        .insertInto('face_search')
        .values([
          { faceId: lockedFace.id, embedding },
          { faceId: timelineFace.id, embedding },
        ])
        .execute();

      const result = await sut.searchFaces({
        userIds: [user.id],
        embedding,
        numResults: 10,
        maxDistance: 1,
        visibility: [AssetVisibility.Archive, AssetVisibility.Timeline],
      });

      const ids = result.map((face) => face.id);
      expect(ids).toContain(timelineFace.id); // positive control
      expect(ids).not.toContain(lockedFace.id);
    });

    it('S1.2 (pin): without the visibility option, the locked asset face is still returned (recognition unchanged)', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });

      const embedding = newEmbedding();
      const { assetFace: lockedFace } = await ctx.newAssetFace({ assetId: lockedAsset.id, personGroupId: null });
      const { assetFace: timelineFace } = await ctx.newAssetFace({ assetId: timelineAsset.id, personGroupId: null });
      await ctx.database
        .insertInto('face_search')
        .values([
          { faceId: lockedFace.id, embedding },
          { faceId: timelineFace.id, embedding },
        ])
        .execute();

      const result = await sut.searchFaces({
        userIds: [user.id],
        embedding,
        numResults: 10,
        maxDistance: 1,
      });

      const ids = result.map((face) => face.id);
      expect(ids).toContain(timelineFace.id); // positive control
      expect(ids).toContain(lockedFace.id);
    });

    it('S1.3 (pin): the space branch already gates locked assets out, with a timeline control returned', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      const { asset: timelineAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: lockedAsset.id, addedById: user.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: timelineAsset.id, addedById: user.id });

      const embedding = newEmbedding();
      const { assetFace: lockedFace } = await ctx.newAssetFace({ assetId: lockedAsset.id, personGroupId: null });
      const { assetFace: timelineFace } = await ctx.newAssetFace({ assetId: timelineAsset.id, personGroupId: null });
      await ctx.database
        .insertInto('face_search')
        .values([
          { faceId: lockedFace.id, embedding },
          { faceId: timelineFace.id, embedding },
        ])
        .execute();

      // Deliberately WITHOUT the new `visibility` option — this isolates the PRE-EXISTING space-branch
      // gate (spaceVisibilityGate, applied unconditionally whenever spaceId is set) from the new opt-in
      // option under test elsewhere in this describe block (S1.1/S1.2).
      const result = await sut.searchFaces({
        spaceId: space.id,
        embedding,
        numResults: 10,
        maxDistance: 1,
      });

      const ids = result.map((face) => face.id);
      expect(ids).toContain(timelineFace.id); // positive control
      expect(ids).not.toContain(lockedFace.id);
    });
  });
});
