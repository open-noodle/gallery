import { Kysely } from 'kysely';
import { FilterSuggestionsResponseDto, SearchSuggestionType } from 'src/dtos/search.dto';
import { AlbumUserRole, AssetOrder, AssetVisibility, SearchOrderField } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { TagRepository } from 'src/repositories/tag.repository';
import { DB } from 'src/schema';
import { SearchService } from 'src/services/search.service';
import { upsertTags } from 'src/utils/tag';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const unitVector = (index: number) => JSON.stringify(Array.from({ length: 512 }, (_, i) => (i === index ? 1 : 0)));

const setup = (db?: Kysely<DB>) => {
  return newMediumService(SearchService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      DatabaseRepository,
      // Slice 1: the albumIds+personIds edge-case test exercises searchMetadata's person path, which calls
      // faceIdentityRepository.resolveScopedPersonTokens — wire it real so the resolver runs (returns no
      // scoped tokens for a plain personId) instead of throwing on an undefined repo.
      FaceIdentityRepository,
      SearchRepository,
      SharedSpaceRepository,
      PartnerRepository,
      PersonRepository,
      TagRepository,
    ],
    mock: [LoggingRepository],
  });
};

type SearchCtx = ReturnType<typeof setup>['ctx'];

// Seed one asset, owned by `ownerId`, carrying a distinct value for every facet type so
// presence/absence of `${marker}-...` strings in a suggestions response is unambiguous.
const seedFacetAsset = async (ctx: SearchCtx, ownerId: string, marker: string) => {
  const { asset } = await ctx.newAsset({ ownerId, visibility: AssetVisibility.Timeline });
  await ctx.newExif({
    assetId: asset.id,
    country: `${marker}-Country`,
    city: `${marker}-City`,
    make: `${marker}-Make`,
    model: `${marker}-Model`,
    rating: 5,
  });
  const [tag] = await upsertTags(ctx.get(TagRepository), { userId: ownerId, tags: [`${marker}-Tag`] });
  await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [asset.id] });
  const { person } = await ctx.newPerson({ ownerId, name: `${marker}-Person` });
  await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  return asset;
};

const expectFacetsPresent = (result: FilterSuggestionsResponseDto, marker: string) => {
  expect(result.countries).toContain(`${marker}-Country`);
  expect(result.cameraMakes).toContain(`${marker}-Make`);
  expect(result.tags.map((tag) => tag.value)).toContain(`${marker}-Tag`);
  expect(result.people.map((person) => person.name)).toContain(`${marker}-Person`);
};

const expectFacetsAbsent = (result: FilterSuggestionsResponseDto, marker: string) => {
  expect(result.countries).not.toContain(`${marker}-Country`);
  expect(result.cameraMakes).not.toContain(`${marker}-Make`);
  expect(result.tags.map((tag) => tag.value)).not.toContain(`${marker}-Tag`);
  expect(result.people.map((person) => person.name)).not.toContain(`${marker}-Person`);
  // Catch-all: no facet category (city/model/etc.) may surface the marker either.
  expect(JSON.stringify(result)).not.toContain(`${marker}-`);
};

// Like expectFacetsPresent but omits the people check — used for space-scoped suggestions
// where people come from shared_space_person / face_identity_face (not plain person rows)
// and seeding those requires additional setup outside the scope of the visibility leak tests.
const expectNonPersonFacetsPresent = (result: FilterSuggestionsResponseDto, marker: string) => {
  expect(result.countries).toContain(`${marker}-Country`);
  expect(result.cameraMakes).toContain(`${marker}-Make`);
  expect(result.tags.map((tag) => tag.value)).toContain(`${marker}-Tag`);
};

// Mirror: assert absence of non-person facets for space-scoped tests.
const expectNonPersonFacetsAbsent = (result: FilterSuggestionsResponseDto, marker: string) => {
  expect(result.countries).not.toContain(`${marker}-Country`);
  expect(result.cameraMakes).not.toContain(`${marker}-Make`);
  expect(result.tags.map((tag) => tag.value)).not.toContain(`${marker}-Tag`);
  expect(JSON.stringify(result)).not.toContain(`${marker}-Country`);
  expect(JSON.stringify(result)).not.toContain(`${marker}-Make`);
  expect(JSON.stringify(result)).not.toContain(`${marker}-Tag`);
};

// M3: elevation only unlocks the CALLER'S OWN locked/archived folder. Other shared-space
// members' assets must always be Timeline-only in space-scoped search — the v3
// `undefined`-for-elevated visibility default must not leak their Archived/Hidden/Locked assets.
const setupSpace = async (ctx: SearchCtx) => {
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
  return { owner, member, space };
};

const shareAsset = async (ctx: SearchCtx, spaceId: string, ownerId: string, visibility: AssetVisibility) => {
  const { asset } = await ctx.newAsset({ ownerId, visibility });
  await ctx.newSharedSpaceAsset({ spaceId, assetId: asset.id, addedById: ownerId });
  return asset;
};

const elevated = (userId: string) => factory.auth({ user: { id: userId }, session: { hasElevatedPermission: true } });

// Slice 5: seed a directly-shared space asset with distinct facet values for each type.
// `visibility` controls whether this asset is Hidden/Locked/etc. Returns the asset.
const seedSpaceAssetWithFacets = async (
  ctx: SearchCtx,
  spaceId: string,
  ownerId: string,
  marker: string,
  visibility: AssetVisibility,
) => {
  const { asset } = await ctx.newAsset({ ownerId, visibility });
  await ctx.newSharedSpaceAsset({ spaceId, assetId: asset.id, addedById: ownerId });
  await ctx.newExif({
    assetId: asset.id,
    country: `${marker}-Country`,
    city: `${marker}-City`,
    make: `${marker}-Make`,
    model: `${marker}-Model`,
  });
  const [tag] = await upsertTags(ctx.get(TagRepository), { userId: ownerId, tags: [`${marker}-Tag`] });
  await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [asset.id] });
  const { person } = await ctx.newPerson({ ownerId, name: `${marker}-Person` });
  await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  return asset;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// Owner's album carrying one asset per visibility, linked into a space with a Viewer member.
const seedAlbumWithVisibilities = async (ctx: SearchCtx) => {
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'VisAlbum' });

  const { asset: timelineAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
  const { asset: archiveAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
  const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
  const { asset: lockedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
  for (const asset of [timelineAsset, archiveAsset, hiddenAsset, lockedAsset]) {
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
  }

  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

  return { owner, member, album, space, timelineAsset, archiveAsset, hiddenAsset, lockedAsset };
};

// Owner's album carrying a trashed asset (still linked via album_asset) alongside a live
// sibling, linked into a space with a Viewer member. H1: the album-granted search scope had
// no `deletedAt` gate, so a Viewer could read the owner's TRASHED asset metadata (ids, EXIF,
// people, thumbhash) via `withDeleted` / `trashedBefore` / `trashedAfter`.
const seedAlbumWithTrashedAsset = async (ctx: SearchCtx) => {
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'TrashAlbum' });

  const { asset: trashedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
  const { asset: liveAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: trashedAsset.id });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: liveAsset.id });
  await ctx.softDeleteAsset(trashedAsset.id);

  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

  return { owner, member, album, space, trashedAsset, liveAsset };
};

const itemIds = (response: Awaited<ReturnType<SearchService['searchMetadata']>>) =>
  response.assets.items.map((item) => item.id);

describe(SearchService.name, () => {
  it('should work', () => {
    const { sut } = setup();
    expect(sut).toBeDefined();
  });

  it('should return assets', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();

    const assets = [];
    const sizes = [12_334, 599, 123_456];

    for (let i = 0; i < sizes.length; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: sizes[i] });
      assets.push(asset);
    }

    const auth = factory.auth({ user: { id: user.id } });

    await expect(sut.searchLargeAssets(auth, { size: 250 })).resolves.toEqual([
      expect.objectContaining({ id: assets[2].id }),
      expect.objectContaining({ id: assets[0].id }),
      expect.objectContaining({ id: assets[1].id }),
    ]);
  });

  describe('searchStatistics', () => {
    it('should return statistics when filtering by personIds', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });

      const auth = factory.auth({ user: { id: user.id } });

      const result = await sut.searchStatistics(auth, { personIds: [person.personGroupId] });

      expect(result).toEqual({ total: 1 });
    });

    it('should return zero when no assets match the personIds filter', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });

      const auth = factory.auth({ user: { id: user.id } });

      const result = await sut.searchStatistics(auth, { personIds: [person.personGroupId] });

      expect(result).toEqual({ total: 0 });
    });

    it('should not return locked assets of partner in elevated session', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();

      await ctx.newPartner({ sharedById: partner.id, sharedWithId: user.id });

      await ctx.newAsset({ ownerId: partner.id, visibility: AssetVisibility.Locked });

      const auth = factory.auth({ user: { id: user.id }, session: { hasElevatedPermission: true } });

      const result = await sut.searchStatistics(auth, { visibility: AssetVisibility.Locked });

      expect(result).toEqual({ total: 0 });
    });
  });

  describe('library-linked space assets', () => {
    it('should include library-linked assets in searchMetadata when filtering by spaceId', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      // Create a library and an asset belonging to that library
      const { library } = await ctx.newLibrary({ ownerId: owner.id });
      const { asset: libraryAsset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });

      // Create a space, add member, link the library
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.searchMetadata(auth, { spaceId: space.id });

      expect(result.assets.items).toEqual([expect.objectContaining({ id: libraryAsset.id })]);
    });

    it('should include library-linked assets in searchLargeAssets when filtering by spaceId', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      const { library } = await ctx.newLibrary({ ownerId: owner.id });
      const { asset: libraryAsset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
      await ctx.newExif({ assetId: libraryAsset.id, fileSizeInByte: 999_999 });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.searchLargeAssets(auth, { spaceId: space.id });

      expect(result).toEqual([expect.objectContaining({ id: libraryAsset.id })]);
    });

    it('should include library-linked assets in getSearchSuggestions for countries', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      const { library } = await ctx.newLibrary({ ownerId: owner.id });
      const { asset: libraryAsset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
      await ctx.newExif({ assetId: libraryAsset.id, country: 'Germany' });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.getSearchSuggestions(auth, {
        type: SearchSuggestionType.COUNTRY,
        spaceId: space.id,
        includeNull: false,
      });

      expect(result).toContain('Germany');
    });

    it('should include library-linked assets in getSearchSuggestions for cities', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      const { library } = await ctx.newLibrary({ ownerId: owner.id });
      const { asset: libraryAsset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
      await ctx.newExif({ assetId: libraryAsset.id, city: 'Berlin', country: 'Germany' });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.getSearchSuggestions(auth, {
        type: SearchSuggestionType.CITY,
        spaceId: space.id,
        includeNull: false,
      });

      expect(result).toContain('Berlin');
    });

    it('should include library-linked assets in getSearchSuggestions for camera makes', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      const { library } = await ctx.newLibrary({ ownerId: owner.id });
      const { asset: libraryAsset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
      await ctx.newExif({ assetId: libraryAsset.id, make: 'Sony' });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.getSearchSuggestions(auth, {
        type: SearchSuggestionType.CAMERA_MAKE,
        spaceId: space.id,
        includeNull: false,
      });

      expect(result).toContain('Sony');
    });
  });

  describe('album-linked space assets', () => {
    it('should include album-linked assets in getSearchSuggestions for countries', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      // Create an album and an asset belonging to that album
      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'SearchAlbumCountry' });
      const { asset: albumAsset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: albumAsset.id });
      await ctx.newExif({ assetId: albumAsset.id, country: 'France' });

      // Create a space, add member, link the album
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.getSearchSuggestions(auth, {
        type: SearchSuggestionType.COUNTRY,
        spaceId: space.id,
        includeNull: false,
      });

      expect(result).toContain('France');
    });

    it('should include album-linked assets in getSearchSuggestions for cities', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'SearchAlbumCity' });
      const { asset: albumAsset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: albumAsset.id });
      await ctx.newExif({ assetId: albumAsset.id, city: 'Paris', country: 'France' });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.getSearchSuggestions(auth, {
        type: SearchSuggestionType.CITY,
        spaceId: space.id,
        includeNull: false,
      });

      expect(result).toContain('Paris');
    });

    it('should include album-linked assets in getSearchSuggestions for camera makes', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'SearchAlbumMake' });
      const { asset: albumAsset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: albumAsset.id });
      await ctx.newExif({ assetId: albumAsset.id, make: 'Nikon' });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.getSearchSuggestions(auth, {
        type: SearchSuggestionType.CAMERA_MAKE,
        spaceId: space.id,
        includeNull: false,
      });

      expect(result).toContain('Nikon');
    });
  });

  describe('withStacked option', () => {
    it('should exclude stacked assets when withStacked is false', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset: primaryAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: stackedAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: unstackedAsset } = await ctx.newAsset({ ownerId: user.id });

      await ctx.newStack({ ownerId: user.id }, [primaryAsset.id, stackedAsset.id]);

      const auth = factory.auth({ user: { id: user.id } });

      const response = await sut.searchMetadata(auth, { size: 250, withStacked: false });

      expect(response.assets.items.length).toBe(1);
      expect(response.assets.items[0].id).toBe(unstackedAsset.id);
    });

    describe('visibility', () => {
      it('should filter out locked assets in a default session', async () => {
        const { sut, ctx } = setup();
        const { user } = await ctx.newUser();

        await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });

        const auth = factory.auth({ user: { id: user.id } });

        const response = await sut.searchMetadata(auth, { size: 250, withStacked: false });

        expect(response.assets.items.length).toBe(0);
      });

      it('should return locked assets in an elevated session', async () => {
        const { sut, ctx } = setup();
        const { user } = await ctx.newUser();

        await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });

        const auth = factory.auth({ user: { id: user.id }, session: { hasElevatedPermission: true } });

        const response = await sut.searchMetadata(auth, { size: 250, withStacked: false });

        expect(response.assets.items.length).toBe(1);
      });
    });
  });

  describe('albumIds option', () => {
    it('should return assets from shared album', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: otherUser.id });
      const { album } = await ctx.newAlbum({ ownerId: otherUser.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      await ctx.newAlbumUser({ albumId: album.id, userId: user.id, role: AlbumUserRole.Editor });

      const auth = factory.auth({ user: { id: user.id } });

      const response = await sut.searchMetadata(auth, { size: 250, albumIds: [album.id] });

      expect(response.assets.items.length).toBe(1);
    });

    it('should not return assets for album, a user is not in, when partner sharing is enabled', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();

      await ctx.newPartner({ sharedById: otherUser.id, sharedWithId: user.id });

      const { asset } = await ctx.newAsset({ ownerId: otherUser.id });
      const { album } = await ctx.newAlbum({ ownerId: otherUser.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const auth = factory.auth({ user: { id: user.id } });

      await expect(sut.searchMetadata(auth, { size: 250, albumIds: [album.id] })).rejects.toThrow(
        'Not found or no album.read access',
      );
    });
  });

  describe('albumIds option — visibility gate (Slice 1 / security-1)', () => {
    it('hides a Hidden album asset from a Viewer member (default visibility); Timeline+Archive present, Locked absent', async () => {
      const { sut, ctx } = setup();
      const s = await seedAlbumWithVisibilities(ctx);
      const auth = factory.auth({ user: { id: s.member.id } });

      const response = await sut.searchMetadata(auth, { albumIds: [s.album.id] });
      const ids = itemIds(response);

      expect(ids).toContain(s.timelineAsset.id);
      expect(ids).toContain(s.archiveAsset.id); // Archive is shareable — not stripped
      expect(ids).not.toContain(s.hiddenAsset.id); // security-1: Hidden gated on the album path
      expect(ids).not.toContain(s.lockedAsset.id); // Locked never present
    });

    it('hides a Hidden album asset even when the member explicitly requests visibility=hidden', async () => {
      const { sut, ctx } = setup();
      const s = await seedAlbumWithVisibilities(ctx);
      const auth = factory.auth({ user: { id: s.member.id } });

      const response = await sut.searchMetadata(auth, { albumIds: [s.album.id], visibility: AssetVisibility.Hidden });

      expect(itemIds(response)).not.toContain(s.hiddenAsset.id);
    });

    it("hides the OWNER's own Hidden album asset via the album path (flat gate, matches the grid)", async () => {
      const { sut, ctx } = setup();
      const s = await seedAlbumWithVisibilities(ctx);
      const ownerAuth = factory.auth({ user: { id: s.owner.id } });

      const response = await sut.searchMetadata(ownerAuth, {
        albumIds: [s.album.id],
        visibility: AssetVisibility.Hidden,
      });

      expect(itemIds(response)).not.toContain(s.hiddenAsset.id);
    });

    it('OWNER still finds their Hidden asset via the non-album userIds search path (untouched)', async () => {
      const { sut, ctx } = setup();
      const s = await seedAlbumWithVisibilities(ctx);
      const ownerAuth = factory.auth({ user: { id: s.owner.id } });

      // No albumIds -> userIds = [owner], scoped to ownerId + explicit Hidden. This path keeps its
      // own `own OR gate` and is untouched by the fix.
      const response = await sut.searchMetadata(ownerAuth, { visibility: AssetVisibility.Hidden });

      expect(itemIds(response)).toContain(s.hiddenAsset.id);
    });

    it('gates a Hidden asset reachable via an album linked into TWO spaces (member of one)', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'TwoSpaceAlbum' });

      const { asset: timelineAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: timelineAsset.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: hiddenAsset.id });

      const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.id });
      const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: owner.id, role: 'owner' });
      // member belongs ONLY to spaceA
      await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceAlbum({ spaceId: spaceA.id, albumId: album.id });
      await ctx.newSharedSpaceAlbum({ spaceId: spaceB.id, albumId: album.id });

      const auth = factory.auth({ user: { id: member.id } });
      const response = await sut.searchMetadata(auth, { albumIds: [album.id] });
      const ids = itemIds(response);

      expect(ids).toContain(timelineAsset.id);
      expect(ids).not.toContain(hiddenAsset.id);
    });

    it('a member of NEITHER space has no album.read access (403-empty)', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: stranger } = await ctx.newUser();
      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'NoAccessAlbum' });
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

      const strangerAuth = factory.auth({ user: { id: stranger.id } });

      await expect(sut.searchMetadata(strangerAuth, { albumIds: [album.id] })).rejects.toThrow(
        'Not found or no album.read access',
      );
    });

    it('gate still applies when albumIds is combined with a personIds filter', async () => {
      const { sut, ctx } = setup();
      const s = await seedAlbumWithVisibilities(ctx);

      // A person whose face sits on BOTH the Timeline and the Hidden album asset. The OWNER searches
      // (they hold PersonRead on their own person — a member could not filter by it). Combining the album
      // scope with the person scope must not open a bypass: the flat album gate still hides the Hidden
      // asset from the owner too (matches the album grid), while the Timeline asset comes through.
      const { person } = await ctx.newPerson({ ownerId: s.owner.id, name: 'ComboPerson' });
      await ctx.newAssetFace({ assetId: s.timelineAsset.id, personId: person.id });
      await ctx.newAssetFace({ assetId: s.hiddenAsset.id, personId: person.id });

      const auth = factory.auth({ user: { id: s.owner.id } });
      const response = await sut.searchMetadata(auth, { albumIds: [s.album.id], personIds: [person.id] });
      const ids = itemIds(response);

      expect(ids).toContain(s.timelineAsset.id);
      expect(ids).not.toContain(s.hiddenAsset.id);
    });
  });

  describe('albumIds option — trash gate (Slice 1 / H1)', () => {
    it('excludes a trashed album asset from a Viewer member when withDeleted is requested', async () => {
      const { sut, ctx } = setup();
      const s = await seedAlbumWithTrashedAsset(ctx);
      const auth = factory.auth({ user: { id: s.member.id } });

      const response = await sut.searchMetadata(auth, { albumIds: [s.album.id], withDeleted: true });
      const ids = itemIds(response);

      expect(ids).toContain(s.liveAsset.id);
      expect(ids).not.toContain(s.trashedAsset.id); // H1: trashed album asset must never leak via withDeleted
    });

    it('excludes the trashed album asset with no trash params too (regression)', async () => {
      const { sut, ctx } = setup();
      const s = await seedAlbumWithTrashedAsset(ctx);
      const auth = factory.auth({ user: { id: s.member.id } });

      const response = await sut.searchMetadata(auth, { albumIds: [s.album.id] });
      const ids = itemIds(response);

      expect(ids).toContain(s.liveAsset.id);
      expect(ids).not.toContain(s.trashedAsset.id);
    });

    it('excludes the trashed album asset when queried via a matching trashedBefore/trashedAfter range', async () => {
      const { sut, ctx } = setup();
      const s = await seedAlbumWithTrashedAsset(ctx);
      const auth = factory.auth({ user: { id: s.member.id } });

      const response = await sut.searchMetadata(auth, {
        albumIds: [s.album.id],
        trashedAfter: new Date('2000-01-01T00:00:00.000Z'),
        trashedBefore: new Date('2999-01-01T00:00:00.000Z'),
      });
      const ids = itemIds(response);

      // Note: liveAsset (deletedAt IS NULL) never matches a trashedBefore/After range on its
      // own — that's plain SQL null-comparison semantics, not the fix under test here. The
      // assertion that matters is that the flat `deletedAt IS NULL` album gate wins over a
      // trashedAfter/trashedBefore range that WOULD otherwise match the trashed asset.
      expect(ids).not.toContain(s.trashedAsset.id);
    });

    it("excludes the OWNER's own trashed album asset via the album path too (flat gate, no owner exception)", async () => {
      const { sut, ctx } = setup();
      const s = await seedAlbumWithTrashedAsset(ctx);
      const ownerAuth = factory.auth({ user: { id: s.owner.id } });

      const response = await sut.searchMetadata(ownerAuth, { albumIds: [s.album.id], withDeleted: true });

      expect(itemIds(response)).not.toContain(s.trashedAsset.id);
    });

    it('OWNER still finds their trashed asset via the non-album userIds search path (untouched)', async () => {
      const { sut, ctx } = setup();
      const s = await seedAlbumWithTrashedAsset(ctx);
      const ownerAuth = factory.auth({ user: { id: s.owner.id } });

      // No albumIds -> userIds = [owner]; this path keeps its own withDeleted handling and is
      // untouched by the fix.
      const response = await sut.searchMetadata(ownerAuth, { withDeleted: true });

      expect(itemIds(response)).toContain(s.trashedAsset.id);
    });

    it('gates a trashed asset reachable via an album linked into TWO spaces (member of one)', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'TwoSpaceTrashAlbum' });

      const { asset: liveAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      const { asset: trashedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: liveAsset.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: trashedAsset.id });
      await ctx.softDeleteAsset(trashedAsset.id);

      const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.id });
      const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: owner.id, role: 'owner' });
      // member belongs ONLY to spaceA
      await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceAlbum({ spaceId: spaceA.id, albumId: album.id });
      await ctx.newSharedSpaceAlbum({ spaceId: spaceB.id, albumId: album.id });

      const auth = factory.auth({ user: { id: member.id } });
      const response = await sut.searchMetadata(auth, { albumIds: [album.id], withDeleted: true });
      const ids = itemIds(response);

      expect(ids).toContain(liveAsset.id);
      expect(ids).not.toContain(trashedAsset.id);
    });

    it('gate still applies when albumIds is combined with a personIds filter', async () => {
      const { sut, ctx } = setup();
      const s = await seedAlbumWithTrashedAsset(ctx);

      // A person whose face sits on BOTH the live and the trashed album asset. Combining the
      // album scope with the person scope must not open a bypass: the trash gate still hides
      // the trashed asset even for the owner, while the live asset comes through.
      const { person } = await ctx.newPerson({ ownerId: s.owner.id, name: 'TrashComboPerson' });
      await ctx.newAssetFace({ assetId: s.liveAsset.id, personId: person.id });
      await ctx.newAssetFace({ assetId: s.trashedAsset.id, personId: person.id });

      const auth = factory.auth({ user: { id: s.owner.id } });
      const response = await sut.searchMetadata(auth, {
        albumIds: [s.album.id],
        personIds: [person.id],
        withDeleted: true,
      });
      const ids = itemIds(response);

      expect(ids).toContain(s.liveAsset.id);
      expect(ids).not.toContain(s.trashedAsset.id);
    });

    it('a Hidden album asset stays excluded alongside the new trash gate (both gates hold)', async () => {
      const { sut, ctx } = setup();
      const s = await seedAlbumWithVisibilities(ctx);
      await ctx.softDeleteAsset(s.timelineAsset.id);
      const auth = factory.auth({ user: { id: s.member.id } });

      const response = await sut.searchMetadata(auth, { albumIds: [s.album.id], withDeleted: true });
      const ids = itemIds(response);

      expect(ids).not.toContain(s.hiddenAsset.id); // visibility gate still holds
      expect(ids).not.toContain(s.lockedAsset.id);
      expect(ids).not.toContain(s.timelineAsset.id); // now trashed -> excluded by the new gate
      expect(ids).toContain(s.archiveAsset.id); // untouched, live Archive asset still present
    });
  });

  describe('getSearchSuggestions', () => {
    it('should filter out empty search suggestions', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, make: 'Canon' });

      const { asset: assetWithEmptyMake } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: assetWithEmptyMake.id, make: '' });

      const auth = factory.auth({ user: { id: user.id } });
      const suggestions = await sut.getSearchSuggestions(auth, {
        type: SearchSuggestionType.CAMERA_MAKE,
        includeNull: true,
      });

      expect(suggestions).toEqual(['Canon', null]);
    });
  });

  describe('searchRandom', () => {
    it('should filter out locked assets in a default session', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });

      const auth = factory.auth({ user: { id: user.id } });

      const response = await sut.searchRandom(auth, { size: 250 });

      expect(response.length).toBe(0);
    });
  });

  describe('new search shape', () => {
    it('should filter by an exif field and return a cursor-less single page', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, city: 'Oslo' });
      const { asset: other } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: other.id, city: 'Bergen' });

      const auth = factory.auth({ user: { id: user.id } });
      const response = await sut.searchMetadata(auth, { size: 250, filter: { city: { eq: 'Oslo' } } });

      expect(response.assets.items).toEqual([expect.objectContaining({ id: asset.id })]);
      expect(response.assets.nextPage).toBeNull();
      expect(response.assets.nextCursor).toBeNull();
    });

    it('should combine OR branches', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset: oslo } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: oslo.id, city: 'Oslo' });
      const { asset: favorite } = await ctx.newAsset({ ownerId: user.id, isFavorite: true });
      await ctx.newAsset({ ownerId: user.id });

      const auth = factory.auth({ user: { id: user.id } });
      const response = await sut.searchMetadata(auth, {
        size: 250,
        filter: { or: [{ city: { eq: 'Oslo' } }, { isFavorite: { eq: true } }] },
      });

      expect(response.assets.items.map(({ id }) => id).toSorted()).toEqual([oslo.id, favorite.id].toSorted());
    });

    it('should scope a top-level album constraint to the album', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: otherUser.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const auth = factory.auth({ user: { id: user.id } });
      const response = await sut.searchMetadata(auth, { size: 250, filter: { albumIds: { any: [album.id] } } });

      expect(response.assets.items).toEqual([expect.objectContaining({ id: asset.id })]);
    });

    it('should scope an album-constrained branch to the album', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: otherUser.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

      const auth = factory.auth({ user: { id: user.id } });
      const response = await sut.searchMetadata(auth, {
        size: 250,
        filter: { or: [{ albumIds: { any: [album.id] } }] },
      });

      expect(response.assets.items).toEqual([expect.objectContaining({ id: asset.id })]);
    });

    it('should keep the ownership scope for branches without an album constraint', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { asset: ownOslo } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: ownOslo.id, city: 'Oslo' });
      const { asset: foreignOslo } = await ctx.newAsset({ ownerId: otherUser.id });
      await ctx.newExif({ assetId: foreignOslo.id, city: 'Oslo' });
      const { asset: albumAsset } = await ctx.newAsset({ ownerId: otherUser.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: albumAsset.id });

      const auth = factory.auth({ user: { id: user.id } });
      const response = await sut.searchMetadata(auth, {
        size: 250,
        filter: { or: [{ albumIds: { any: [album.id] } }, { city: { eq: 'Oslo' } }] },
      });

      // the album branch searches the album, the city branch stays confined to the caller's own assets
      expect(response.assets.items.map(({ id }) => id).toSorted()).toEqual([ownOslo.id, albumAsset.id].toSorted());
    });

    it('should reject an inaccessible album anywhere in the filter', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: otherUser.id });

      const auth = factory.auth({ user: { id: user.id } });

      await expect(
        sut.searchMetadata(auth, { size: 250, filter: { or: [{ albumIds: { none: [album.id] } }] } }),
      ).rejects.toThrow('Not found or no album.read access');
    });

    it('should return locked assets only to an elevated session that asks for them', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset: timeline } = await ctx.newAsset({ ownerId: user.id });
      const { asset: locked } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });

      const unelevated = await sut.searchMetadata(factory.auth({ user: { id: user.id } }), { size: 250, filter: {} });
      expect(unelevated.assets.items).toEqual([expect.objectContaining({ id: timeline.id })]);

      const elevatedAuth = factory.auth({ user: { id: user.id }, session: { hasElevatedPermission: true } });
      const elevated = await sut.searchMetadata(elevatedAuth, {
        size: 250,
        filter: { visibility: { eq: AssetVisibility.Locked } },
      });
      expect(elevated.assets.items).toEqual([expect.objectContaining({ id: locked.id })]);
    });

    it('should exclude partner assets from a locked-only search', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();
      await ctx.newPartner({ sharedById: partner.id, sharedWithId: user.id });
      const { asset: ownLocked } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      await ctx.newAsset({ ownerId: partner.id, visibility: AssetVisibility.Locked });

      const auth = factory.auth({ user: { id: user.id }, session: { hasElevatedPermission: true } });
      const response = await sut.searchMetadata(auth, {
        size: 250,
        filter: { visibility: { eq: AssetVisibility.Locked } },
      });

      expect(response.assets.items).toEqual([expect.objectContaining({ id: ownLocked.id })]);
    });

    it('should never return partner locked assets, even for locked-matching mixed filters', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();
      await ctx.newPartner({ sharedById: partner.id, sharedWithId: user.id });
      const { asset: ownLocked } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      const { asset: partnerTimeline } = await ctx.newAsset({ ownerId: partner.id });
      await ctx.newAsset({ ownerId: partner.id, visibility: AssetVisibility.Locked });

      const auth = factory.auth({ user: { id: user.id }, session: { hasElevatedPermission: true } });
      const response = await sut.searchMetadata(auth, {
        size: 250,
        filter: { visibility: { in: [AssetVisibility.Locked, AssetVisibility.Timeline] } },
      });

      const ids = response.assets.items.map(({ id }) => id);
      expect(ids.toSorted()).toEqual([ownLocked.id, partnerTimeline.id].toSorted());
    });

    it('should paginate with an opaque cursor', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      for (let i = 0; i < 3; i++) {
        await ctx.newAsset({ ownerId: user.id });
      }

      const auth = factory.auth({ user: { id: user.id } });

      const firstPage = await sut.searchMetadata(auth, { filter: {}, size: 2 });
      expect(firstPage.assets.items.length).toBe(2);
      expect(firstPage.assets.nextPage).toBeNull();
      expect(firstPage.assets.nextCursor).toEqual(expect.any(String));

      const secondPage = await sut.searchMetadata(auth, { cursor: firstPage.assets.nextCursor!, size: 2 });
      expect(secondPage.assets.items.length).toBe(1);
      expect(secondPage.assets.nextCursor).toBeNull();

      const ids = [...firstPage.assets.items, ...secondPage.assets.items].map(({ id }) => id);
      expect(new Set(ids).size).toBe(3);
    });

    it('should order by fileSizeInBytes', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const sizes = [12_334, 599, 123_456];
      const assetIds: string[] = [];
      for (const fileSizeInByte of sizes) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await ctx.newExif({ assetId: asset.id, fileSizeInByte });
        assetIds.push(asset.id);
      }

      const auth = factory.auth({ user: { id: user.id } });
      const response = await sut.searchMetadata(auth, {
        size: 250,
        orderBy: { field: SearchOrderField.FileSizeInBytes, direction: AssetOrder.Asc },
      });

      expect(response.assets.items.map(({ id }) => id)).toEqual([assetIds[1], assetIds[0], assetIds[2]]);
    });

    it('should order smart search results by embedding distance with cursor offsets', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const searchRepository = ctx.get(SearchRepository);

      const assetIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        await searchRepository.upsert(asset.id, unitVector(i));
        assetIds.push(asset.id);
      }

      const options = { filter: {}, embedding: unitVector(0) };
      const scope = { userIds: [user.id], lockedOwnerId: user.id };
      const firstPage = await searchRepository.searchSmartV3({ take: 2 }, options, scope);
      expect(firstPage.items.length).toBe(2);
      expect(firstPage.items[0].id).toBe(assetIds[0]);
      expect(firstPage.hasNextPage).toBe(true);

      const secondPage = await searchRepository.searchSmartV3({ take: 2, skip: 2 }, options, scope);
      expect(secondPage.items.length).toBe(1);
      expect(secondPage.hasNextPage).toBe(false);
  describe('getFilterSuggestions', () => {
    it('should return countries from the user assets', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, country: 'Germany' });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getFilterSuggestions(auth, {});

      expect(result.countries).toContain('Germany');
    });

    it('should return countries when withSharedSpaces is true and the user has no shared spaces', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, country: 'Germany' });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getFilterSuggestions(auth, { withSharedSpaces: true });

      expect(result.countries).toContain('Germany');
    });

    it('should return tagged people for the user', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
      await ctx.newAssetFace({ assetId: asset.id, personId: person.id });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getFilterSuggestions(auth, {});

      expect(result.people.map((p) => p.name)).toContain('Alice');
    });

    it('should return people whose thumbnail has not been generated yet', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Bob', thumbnailPath: '' });
      await ctx.newAssetFace({ assetId: asset.id, personId: person.id });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getFilterSuggestions(auth, {});

      expect(result.people.map((p) => p.name)).toContain('Bob');
    });

    it('should return favorite people before alphabetical matches', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset: favoriteAsset } = await ctx.newAsset({ ownerId: user.id });
      const { person: favoritePerson } = await ctx.newPerson({ ownerId: user.id, name: 'Zelda', isFavorite: true });
      await ctx.newAssetFace({ assetId: favoriteAsset.id, personId: favoritePerson.id });

      const { asset: nonFavoriteAsset } = await ctx.newAsset({ ownerId: user.id });
      const { person: nonFavoritePerson } = await ctx.newPerson({ ownerId: user.id, name: 'Alice', isFavorite: false });
      await ctx.newAssetFace({ assetId: nonFavoriteAsset.id, personId: nonFavoritePerson.id });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getFilterSuggestions(auth, {});

      expect(result.people.map((p) => p.name)).toEqual(['Zelda', 'Alice']);
    });

    it('should not leak owner favorite state into space people ordering', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });

      const { asset: favoriteAsset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: favoriteAsset.id, addedById: owner.id });
      const { person: favoritePerson } = await ctx.newPerson({ ownerId: owner.id, name: 'Zelda', isFavorite: true });
      const { assetFace: favoriteFace } = await ctx.newAssetFace({
        assetId: favoriteAsset.id,
        personId: favoritePerson.id,
      });
      const favoriteSpacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, name: 'Zelda Space', representativeFaceId: favoriteFace.id })
        .returningAll()
        .executeTakeFirstOrThrow();
      await ctx.database
        .insertInto('shared_space_person_face')
        .values({ personId: favoriteSpacePerson.id, assetFaceId: favoriteFace.id })
        .execute();

      const { asset: nonFavoriteAsset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: nonFavoriteAsset.id, addedById: owner.id });
      const { person: nonFavoritePerson } = await ctx.newPerson({
        ownerId: owner.id,
        name: 'Alice',
        isFavorite: false,
      });
      const { assetFace: nonFavoriteFace } = await ctx.newAssetFace({
        assetId: nonFavoriteAsset.id,
        personId: nonFavoritePerson.id,
      });
      const nonFavoriteSpacePerson = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, name: 'Alice Space', representativeFaceId: nonFavoriteFace.id })
        .returningAll()
        .executeTakeFirstOrThrow();
      await ctx.database
        .insertInto('shared_space_person_face')
        .values({ personId: nonFavoriteSpacePerson.id, assetFaceId: nonFavoriteFace.id })
        .execute();

      const auth = factory.auth({ user: { id: member.id } });
      const result = await sut.getFilterSuggestions(auth, { spaceId: space.id });

      expect(result.people.map((p) => p.name)).toEqual(['Alice Space', 'Zelda Space']);
    });

    it('returns album facets for a viewer-role user who owns none of the shared album assets (issue #655)', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newExif({ assetId: asset.id, country: 'Germany', make: 'Sony' });
      const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'Ada' });
      await ctx.newAssetFace({ assetId: asset.id, personId: person.id });

      const { album } = await ctx.newAlbum({ ownerId: owner.id }, [asset.id]);
      await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer });

      const auth = factory.auth({ user: { id: viewer.id } });
      const result = await sut.getFilterSuggestions(auth, { albumId: album.id });

      expect(result.countries).toContain('Germany');
      expect(result.cameraMakes).toContain('Sony');
      expect(result.people.map((p) => p.name)).toContain('Ada');
    });
  });

  describe('getFilterSuggestions album permission boundaries', () => {
    it('exposes every facet type of the album owner assets to a shared viewer', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const asset = await seedFacetAsset(ctx, owner.id, 'Owner');
      const { album } = await ctx.newAlbum({ ownerId: owner.id }, [asset.id]);
      await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer });

      const result = await sut.getFilterSuggestions(factory.auth({ user: { id: viewer.id } }), { albumId: album.id });

      expectFacetsPresent(result, 'Owner');
      expect(result.ratings).toContain(5);
      expect(result.mediaTypes.length).toBeGreaterThan(0);
    });

    it('exposes assets contributed by a shared editor to other album members', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: editor } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const ownerAsset = await seedFacetAsset(ctx, owner.id, 'Owner');
      const editorAsset = await seedFacetAsset(ctx, editor.id, 'Editor');
      const { album } = await ctx.newAlbum({ ownerId: owner.id }, [ownerAsset.id]);
      await ctx.newAlbumUser({ albumId: album.id, userId: editor.id, role: AlbumUserRole.Editor });
      await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: editorAsset.id });

      const result = await sut.getFilterSuggestions(factory.auth({ user: { id: viewer.id } }), { albumId: album.id });

      expectFacetsPresent(result, 'Owner');
      expectFacetsPresent(result, 'Editor');
    });

    it('does not leak a non-participant asset that was placed in the album', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { user: stranger } = await ctx.newUser();
      const ownerAsset = await seedFacetAsset(ctx, owner.id, 'Owner');
      const strangerAsset = await seedFacetAsset(ctx, stranger.id, 'Stranger');
      const { album } = await ctx.newAlbum({ ownerId: owner.id }, [ownerAsset.id]);
      await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer });
      // The stranger is neither the album owner nor a shared user, yet their asset is
      // referenced by the album — it must never surface in the album facets.
      await ctx.newAlbumAsset({ albumId: album.id, assetId: strangerAsset.id });

      const result = await sut.getFilterSuggestions(factory.auth({ user: { id: viewer.id } }), { albumId: album.id });

      expectFacetsPresent(result, 'Owner');
      expectFacetsAbsent(result, 'Stranger');
    });

    it('exposes a timeline-sharing partner asset to the album viewer', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();
      await ctx.newPartner({ sharedById: partner.id, sharedWithId: viewer.id, inTimeline: true });
      const ownerAsset = await seedFacetAsset(ctx, owner.id, 'Owner');
      const partnerAsset = await seedFacetAsset(ctx, partner.id, 'Partner');
      const { album } = await ctx.newAlbum({ ownerId: owner.id }, [ownerAsset.id]);
      await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: partnerAsset.id });

      const result = await sut.getFilterSuggestions(factory.auth({ user: { id: viewer.id } }), { albumId: album.id });

      expectFacetsPresent(result, 'Partner');
    });

    it('does not leak an asset from a partner who is not sharing their timeline', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();
      await ctx.newPartner({ sharedById: partner.id, sharedWithId: viewer.id, inTimeline: false });
      const ownerAsset = await seedFacetAsset(ctx, owner.id, 'Owner');
      const partnerAsset = await seedFacetAsset(ctx, partner.id, 'Partner');
      const { album } = await ctx.newAlbum({ ownerId: owner.id }, [ownerAsset.id]);
      await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: partnerAsset.id });

      const result = await sut.getFilterSuggestions(factory.auth({ user: { id: viewer.id } }), { albumId: album.id });

      expectFacetsPresent(result, 'Owner');
      expectFacetsAbsent(result, 'Partner');
    });

    it('denies filter suggestions to a user without album access', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: outsider } = await ctx.newUser();
      const ownerAsset = await seedFacetAsset(ctx, owner.id, 'Owner');
      const { album } = await ctx.newAlbum({ ownerId: owner.id }, [ownerAsset.id]);

      await expect(
        sut.getFilterSuggestions(factory.auth({ user: { id: outsider.id } }), { albumId: album.id }),
      ).rejects.toThrow();
    });

    it('scopes facets to the requested album and not the owner other albums', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const sharedAsset = await seedFacetAsset(ctx, owner.id, 'Shared');
      const otherAsset = await seedFacetAsset(ctx, owner.id, 'Other');
      const { album: shared } = await ctx.newAlbum({ ownerId: owner.id }, [sharedAsset.id]);
      await ctx.newAlbum({ ownerId: owner.id }, [otherAsset.id]);
      await ctx.newAlbumUser({ albumId: shared.id, userId: viewer.id, role: AlbumUserRole.Viewer });

      const result = await sut.getFilterSuggestions(factory.auth({ user: { id: viewer.id } }), { albumId: shared.id });

      expectFacetsPresent(result, 'Shared');
      expectFacetsAbsent(result, 'Other');
    });

    it('does not leak a non-participant asset city into album city drill-down suggestions', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { user: stranger } = await ctx.newUser();
      const ownerAsset = await seedFacetAsset(ctx, owner.id, 'Owner');
      const strangerAsset = await seedFacetAsset(ctx, stranger.id, 'Stranger');
      const { album } = await ctx.newAlbum({ ownerId: owner.id }, [ownerAsset.id]);
      await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: strangerAsset.id });

      const cities = await sut.getSearchSuggestions(factory.auth({ user: { id: viewer.id } }), {
        type: SearchSuggestionType.CITY,
        albumId: album.id,
      });

      expect(cities).toContain('Owner-City');
      expect(cities).not.toContain('Stranger-City');
    });
  });

  // Slice 10: Archive assets of other space members now surface in space-scoped search
  // (matching the browse / timeline gate). Hidden and Locked remain excluded always.
  describe('space-scoped visibility (Slice 10 — Archive exposed, Hidden/Locked blocked)', () => {
    it('shows another member archived asset in an elevated spaceId metadata search (spaceId path)', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      const archived = await shareAsset(ctx, space.id, owner.id, AssetVisibility.Archive);
      const timeline = await shareAsset(ctx, space.id, owner.id, AssetVisibility.Timeline);

      const result = await sut.searchMetadata(elevated(member.id), { spaceId: space.id });
      const ids = result.assets.items.map((a) => a.id);

      expect(ids).toContain(timeline.id);
      expect(ids).toContain(archived.id);
    });

    it('hides another member hidden and locked assets from an elevated spaceId metadata search', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      const hidden = await shareAsset(ctx, space.id, owner.id, AssetVisibility.Hidden);
      const locked = await shareAsset(ctx, space.id, owner.id, AssetVisibility.Locked);
      const timeline = await shareAsset(ctx, space.id, owner.id, AssetVisibility.Timeline);

      const result = await sut.searchMetadata(elevated(member.id), { spaceId: space.id });
      const ids = result.assets.items.map((a) => a.id);

      expect(ids).toContain(timeline.id);
      expect(ids).not.toContain(hidden.id);
      expect(ids).not.toContain(locked.id);
    });

    it("exposes the caller's OWN archived asset in a space (elevated, per-owner elevation)", async () => {
      const { sut, ctx } = setup();
      const { member, space } = await setupSpace(ctx);
      const ownArchived = await shareAsset(ctx, space.id, member.id, AssetVisibility.Archive);

      const result = await sut.searchMetadata(elevated(member.id), { spaceId: space.id });
      const ids = result.assets.items.map((a) => a.id);

      expect(ids).toContain(ownArchived.id);
    });

    it('shows another member Archive but hides Hidden/Locked for a non-elevated member (spaceId path)', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      const archived = await shareAsset(ctx, space.id, owner.id, AssetVisibility.Archive);
      const hidden = await shareAsset(ctx, space.id, owner.id, AssetVisibility.Hidden);
      const locked = await shareAsset(ctx, space.id, owner.id, AssetVisibility.Locked);
      const timeline = await shareAsset(ctx, space.id, owner.id, AssetVisibility.Timeline);

      const auth = factory.auth({ user: { id: member.id } });
      const result = await sut.searchMetadata(auth, { spaceId: space.id });
      const ids = result.assets.items.map((a) => a.id);

      expect(ids).toContain(timeline.id);
      expect(ids).toContain(archived.id);
      expect(ids).not.toContain(hidden.id);
      expect(ids).not.toContain(locked.id);
    });

    it('exposes another member archived when the caller explicitly requests visibility=Archive (spaceId path)', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      const otherArchived = await shareAsset(ctx, space.id, owner.id, AssetVisibility.Archive);
      const ownArchived = await shareAsset(ctx, space.id, member.id, AssetVisibility.Archive);

      const result = await sut.searchMetadata(elevated(member.id), {
        spaceId: space.id,
        visibility: AssetVisibility.Archive,
      });
      const ids = result.assets.items.map((a) => a.id);

      expect(ids).toContain(ownArchived.id);
      expect(ids).toContain(otherArchived.id);
    });

    it('shows another member archived asset in the withSharedSpaces (timeline) path for an elevated caller', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      const archived = await shareAsset(ctx, space.id, owner.id, AssetVisibility.Archive);
      const timeline = await shareAsset(ctx, space.id, owner.id, AssetVisibility.Timeline);

      const result = await sut.searchMetadata(elevated(member.id), { withSharedSpaces: true });
      const ids = result.assets.items.map((a) => a.id);

      expect(ids).toContain(timeline.id);
      expect(ids).toContain(archived.id);
    });

    it('includes another member archived asset in elevated spaceId statistics', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      await shareAsset(ctx, space.id, owner.id, AssetVisibility.Archive);
      await shareAsset(ctx, space.id, owner.id, AssetVisibility.Timeline);

      const result = await sut.searchStatistics(elevated(member.id), { spaceId: space.id });

      // Both Archive and Timeline count — Slice 10 aligns search with browse.
      expect(result).toEqual({ total: 2 });
    });

    it('shows archived assets of every other owner in a mixed-owner space (elevated)', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      const { user: secondOwner } = await ctx.newUser();
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: secondOwner.id, role: 'viewer' });

      const archivedA = await shareAsset(ctx, space.id, owner.id, AssetVisibility.Archive);
      const archivedC = await shareAsset(ctx, space.id, secondOwner.id, AssetVisibility.Archive);
      const timelineA = await shareAsset(ctx, space.id, owner.id, AssetVisibility.Timeline);

      const result = await sut.searchMetadata(elevated(member.id), { spaceId: space.id });
      const ids = result.assets.items.map((a) => a.id);

      expect(ids).toContain(timelineA.id);
      expect(ids).toContain(archivedA.id);
      expect(ids).toContain(archivedC.id);
    });

    it('shows another member archived asset in searchLargeAssets (spaceId path)', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      const { asset: archived } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: archived.id, addedById: owner.id });
      await ctx.newExif({ assetId: archived.id, fileSizeInByte: 999_999 });

      const auth = factory.auth({ user: { id: member.id } });
      const result = await sut.searchLargeAssets(auth, { spaceId: space.id });

      expect(result.map((a) => a.id)).toContain(archived.id);
    });

    it('shows another member archived asset in searchLargeAssets (withSharedSpaces path)', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      const { asset: archived } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: archived.id, addedById: owner.id });
      await ctx.newExif({ assetId: archived.id, fileSizeInByte: 999_999 });

      const result = await sut.searchLargeAssets(elevated(member.id), { withSharedSpaces: true });

      expect(result.map((a) => a.id)).toContain(archived.id);
    });

    it('hides another member Hidden/Locked from searchLargeAssets (spaceId path)', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      const { asset: hidden } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
      const { asset: locked } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hidden.id, addedById: owner.id });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: locked.id, addedById: owner.id });
      await ctx.newExif({ assetId: hidden.id, fileSizeInByte: 999_999 });
      await ctx.newExif({ assetId: locked.id, fileSizeInByte: 999_999 });

      const result = await sut.searchLargeAssets(elevated(member.id), { spaceId: space.id });
      const ids = result.map((a) => a.id);

      expect(ids).not.toContain(hidden.id);
      expect(ids).not.toContain(locked.id);
    });
  });

  // ── Slice 5: facets / suggestions must apply the same M3 visibility gate as search ──
  describe('space-scoped facet/suggestion visibility (M3 — Slice 5)', () => {
    // getFilterSuggestions (spaceId path)
    // NOTE: people facets in the spaceId path come from shared_space_person rows (not plain person
    // rows), so seedSpaceAssetWithFacets is insufficient to populate them. We assert non-person
    // facets (country/make/tag) which are enough to prove the visibility gate fires.
    it('hides another member Hidden asset from spaceId getFilterSuggestions', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      await seedSpaceAssetWithFacets(ctx, space.id, owner.id, 'HiddenOwner', AssetVisibility.Hidden);
      // Positive control: owner's Timeline asset is present
      await seedSpaceAssetWithFacets(ctx, space.id, owner.id, 'TimelineOwner', AssetVisibility.Timeline);

      const result = await sut.getFilterSuggestions(factory.auth({ user: { id: member.id } }), {
        spaceId: space.id,
      });

      expectNonPersonFacetsAbsent(result, 'HiddenOwner');
      expectNonPersonFacetsPresent(result, 'TimelineOwner');
    });

    it('hides another member Locked asset from spaceId getFilterSuggestions (elevated)', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      await seedSpaceAssetWithFacets(ctx, space.id, owner.id, 'LockedOwner', AssetVisibility.Locked);
      await seedSpaceAssetWithFacets(ctx, space.id, owner.id, 'TimelineOwner2', AssetVisibility.Timeline);

      const result = await sut.getFilterSuggestions(elevated(member.id), { spaceId: space.id });

      expectNonPersonFacetsAbsent(result, 'LockedOwner');
      expectNonPersonFacetsPresent(result, 'TimelineOwner2');
    });

    it("exposes the caller's own Locked asset from spaceId getFilterSuggestions (elevated, own-M3)", async () => {
      const { sut, ctx } = setup();
      const { member, space } = await setupSpace(ctx);
      await seedSpaceAssetWithFacets(ctx, space.id, member.id, 'OwnLocked', AssetVisibility.Locked);

      const result = await sut.getFilterSuggestions(elevated(member.id), { spaceId: space.id });

      expectNonPersonFacetsPresent(result, 'OwnLocked');
    });

    it('hides showInTimeline=false album asset from spaceId getFilterSuggestions', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'NoTimelineAlbumFacet' });
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      await ctx.newExif({ assetId: asset.id, country: 'NoTimeline-Country', make: 'NoTimeline-Make' });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: false });

      const result = await sut.getFilterSuggestions(factory.auth({ user: { id: member.id } }), {
        spaceId: space.id,
      });

      expect(result.countries).not.toContain('NoTimeline-Country');
      expect(result.cameraMakes).not.toContain('NoTimeline-Make');
    });

    // getFilterSuggestions (timelineSpaceIds / withSharedSpaces path)
    // NOTE: people in this path come from getFilteredIdentityPeople (face_identity_face linkage),
    // not plain person rows, so we assert non-person facets only.
    it('hides another member Hidden asset from withSharedSpaces getFilterSuggestions', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      await seedSpaceAssetWithFacets(ctx, space.id, owner.id, 'TLHiddenOwner', AssetVisibility.Hidden);
      await seedSpaceAssetWithFacets(ctx, space.id, owner.id, 'TLTimelineOwner', AssetVisibility.Timeline);

      const result = await sut.getFilterSuggestions(elevated(member.id), { withSharedSpaces: true });

      expectNonPersonFacetsAbsent(result, 'TLHiddenOwner');
      expectNonPersonFacetsPresent(result, 'TLTimelineOwner');
    });

    it('hides showInTimeline=false album asset from withSharedSpaces getFilterSuggestions', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'TLNoTimelineAlbum' });
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      await ctx.newExif({ assetId: asset.id, country: 'TLNoTimeline-Country' });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: false });

      const result = await sut.getFilterSuggestions(factory.auth({ user: { id: member.id } }), {
        withSharedSpaces: true,
      });

      expect(result.countries).not.toContain('TLNoTimeline-Country');
    });

    // getSearchSuggestions (spaceId path)
    it('hides another member Hidden city from spaceId getSearchSuggestions', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      await seedSpaceAssetWithFacets(ctx, space.id, owner.id, 'SugHidden', AssetVisibility.Hidden);
      await seedSpaceAssetWithFacets(ctx, space.id, owner.id, 'SugTimeline', AssetVisibility.Timeline);

      const cities = await sut.getSearchSuggestions(factory.auth({ user: { id: member.id } }), {
        type: SearchSuggestionType.CITY,
        spaceId: space.id,
      });

      expect(cities).not.toContain('SugHidden-City');
      expect(cities).toContain('SugTimeline-City');
    });

    it('hides showInTimeline=false album city from spaceId getSearchSuggestions', async () => {
      const { sut, ctx } = setup();
      const { owner, member, space } = await setupSpace(ctx);
      const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'SugNoTimelineAlbum' });
      const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
      await ctx.newExif({ assetId: asset.id, city: 'SugNoTimeline-City', country: 'France' });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: false });

      const cities = await sut.getSearchSuggestions(factory.auth({ user: { id: member.id } }), {
        type: SearchSuggestionType.CITY,
        spaceId: space.id,
      });

      expect(cities).not.toContain('SugNoTimeline-City');
    });
  });

  describe('album-linked space assets', () => {
    it('should include album-linked assets in searchMetadata when filtering by spaceId (showInTimeline=true)', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      const { album } = await ctx.newAlbum({ ownerId: owner.id });
      const { asset: albumAsset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: albumAsset.id });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: true });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.searchMetadata(auth, { spaceId: space.id });

      expect(result.assets.items).toEqual([expect.objectContaining({ id: albumAsset.id })]);
    });

    it('should NOT include album-linked assets in searchMetadata when showInTimeline=false', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();

      const { album } = await ctx.newAlbum({ ownerId: owner.id });
      const { asset: albumAsset } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: albumAsset.id });

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: false });

      const auth = factory.auth({ user: { id: member.id } });

      const result = await sut.searchMetadata(auth, { spaceId: space.id });

      expect(result.assets.items.find((a) => a.id === albumAsset.id)).toBeUndefined();
    });
  });
});
